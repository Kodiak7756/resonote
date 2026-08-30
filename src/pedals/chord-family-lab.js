// ── Chord-Family Lab (+ Resolution Drill) ────────────────────────────
// The flagship "beyond the 7th-chord ceiling" trainer. For any chord family
// (sus / add9 / 9·11·13 / augmented / diminished / altered dominants) it runs
// the closed learning loop:
//   HEAR it (A/B colour reveal) → SEE the shape on the fretboard →
//   PLAY it (mic-scored single-note check) → RESOLVE it (tension meter drops).
import { CHORD_TYPES, getChordNotes, intervalLabel, NOTES } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, setConceptInfo, pedalBus } from '../core/state.js';
import { findVoicings, findSlashVoicings, renderMiniDiagram } from '../core/voicings.js';
import { updateOverlays } from '../ui/fretboard.js';
import { audio } from '../core/audio.js';
import { CHORD_FAMILIES, getFamily, chordName, transposeRoot, buildChord, slashVoicingSpec } from '../harmony/chord-vocabulary.js';
import { playChordNotes, playNote } from '../core/synth.js';

// Fretboard overlay palettes — the neck's own language (tense vs released), not
// pedal chrome. They stay literal on purpose: the panel wears the card's accent,
// the NECK keeps saying the same thing in every pedal that lights it.
const TENSION_COLORS = { root: '#e0556b', tone: '#5a2230', rootStroke: '#ff8095', toneStroke: '#bb5566' };
const RESOLVE_COLORS = { root: '#7ad17a', tone: '#234a23', rootStroke: '#a6f0a6', toneStroke: '#4a9a4a' };

export function buildChordLabContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let familyId  = s.familyId  || 'suspended';
  let memberIdx = s.memberIdx ?? 0;
  let root      = s.root      || 'C';
  let selVoicing = null;
  const listen = { on: false, target: null };

  const family  = () => getFamily(familyId);
  const member  = () => { const f = family(); return f.members[Math.min(memberIdx, f.members.length - 1)]; };

  function memberChord() {
    const m = member();
    return { ...buildChord(root, m.cat, m.type), colorNote: transposeRoot(root, m.colorDeg), mem: m };
  }
  function baseChord()   { const b = family().base; return buildChord(root, b.cat, b.type); }
  function targetChord() {
    const m = member();
    const r = transposeRoot(root, m.resolveTo.rootInt);
    return { ...buildChord(r, m.resolveTo.cat, m.resolveTo.type), motion: m.resolveTo.motion };
  }
  function voicings() {
    const m = member(), c = memberChord();
    // Slash chords are bass + upper triad — findVoicings can't build those, so ask the
    // dedicated generator for real grips (bass on E or A string, triad stacked above).
    // slashVoicingSpec handles both families: inversions (bass = a chord tone) and
    // upper structures (bass = the root, triad on some degree above it).
    if (m.cat === 'Slash') {
      const spec = slashVoicingSpec(m.type, root);
      if (spec) return findSlashVoicings(spec.bass, spec.upperSemis, spec.upperQual);
    }
    return findVoicings(c.root, c.notes, c.type);
  }

  // ── Fretboard + meter helpers ──────────────────────────────────────
  function highlight(chord, label, colors, positions) {
    setChordHighlight(chord.root, chord.notes, label, positions || null, colors || null);
    updateOverlays();
  }
  // Objective facts strip under the fretboard — the theory of what's lit up, stated plainly:
  // structure (for slash: which triad over which bass), spelled notes, degrees, resolution.
  function conceptFacts(c, m) {
    if (!c) return null;
    const rows = [];
    if (m && m.cat === 'Slash') {
      const spec = slashVoicingSpec(m.type, root);
      const upper = c.name.split('/')[0];
      if (spec) rows.push({ label: 'STRUCTURE', value: `${upper} ${spec.upperQual === 'min' ? 'minor' : spec.upperQual === 'dim' ? 'diminished' : 'major'} triad over a ${spec.bass} bass` });
    }
    rows.push({ label: 'NOTES', value: c.notes.join(' · ') });
    // intervals above the octave read as extensions (14 = 9, not 2) — that's how musicians name them
    const EXT = { 13: '♭9', 14: '9', 15: '♯9', 17: '11', 18: '♯11', 20: '♭13', 21: '13' };
    rows.push({ label: 'DEGREES', value: c.intervals.map(iv => EXT[iv] || intervalLabel(c.root, NOTES[(NOTES.indexOf(c.root) + iv) % 12])).join(' · ') + ' of ' + c.root });
    if (m && m.colorDeg != null) {
      // prefer the extension name (9/♯11/13) when the chord actually stacks that tone above the octave
      const extIv = c.intervals.find(iv => iv > 12 && iv % 12 === m.colorDeg % 12);
      const EXT2 = { 13: '♭9', 14: '9', 15: '♯9', 17: '11', 18: '♯11', 20: '♭13', 21: '13' };
      const dl = extIv ? EXT2[extIv] : intervalLabel(root, transposeRoot(root, m.colorDeg));
      rows.push({ label: 'COLOR TONE', value: `${transposeRoot(root, m.colorDeg)} (${dl})` });
    }
    if (m && m.resolveTo && m.resolveTo.motion) rows.push({ label: 'RESOLVES', value: m.resolveTo.motion });
    return { title: c.name, rows };
  }
  function setMeter(val, hot) {
    const bar = document.getElementById(`cl-meter-fill-${p.id}`);
    const lab = document.getElementById(`cl-meter-lab-${p.id}`);
    if (bar) {
      bar.style.width = Math.round(val * 100) + '%';
      // Tension climbs into the pedal's hot lamp; resolution lands on the shared
      // "you got it" green. Same two values the initial render uses below.
      bar.style.background = hot
        ? 'linear-gradient(90deg,var(--rk-dim),var(--rk-hot))'
        : 'linear-gradient(90deg,color-mix(in srgb,var(--rk-ok) 55%,var(--rk-panel)),var(--rk-ok))';
    }
    if (lab) lab.textContent = hot ? `tension ${Math.round(val * 100)}%` : `resolved`;
  }

  function showColored() {
    const c = memberChord();
    const vs = voicings();   // slash: light the actual grip so the bass-under-triad build stays visible
    const pos = member().cat === 'Slash' && selVoicing !== null && vs[selVoicing] ? vs[selVoicing].positions : null;
    setConceptInfo(conceptFacts(c, member()));
    highlight(c, `${c.name}  ·  ${c.mem.name}`, TENSION_COLORS, pos);
    setMeter(c.mem.tension, true);
    playChordNotes(c.notes);
  }
  function showPlain() {
    const b = baseChord();
    setConceptInfo(conceptFacts(b, null));
    highlight(b, `${b.name}  ·  plain`, null);
    setMeter(0.12, false);
    playChordNotes(b.notes);
  }
  function hearResolve() {
    const c = memberChord(), t = targetChord();
    const vs = voicings();
    const pos = member().cat === 'Slash' && selVoicing !== null && vs[selVoicing] ? vs[selVoicing].positions : null;
    highlight(c, `${c.name}  (tension)`, TENSION_COLORS, pos);
    setMeter(c.mem.tension, true);
    const d = playChordNotes(c.notes);
    setTimeout(() => {
      if (!document.getElementById(`body-${p.id}`)) return;
      setConceptInfo(conceptFacts(t, null));
      highlight(t, `${t.name}  (resolved)`, RESOLVE_COLORS);
      setMeter(0.12, false);
      playChordNotes(t.notes);
    }, Math.round(d * 1000) + 220);
  }

  // ── Play-along listen check (monophonic, precise) ──────────────────
  function startListen() {
    const c = memberChord();
    listen.on = true; listen.target = c.colorNote;
    playNote(c.colorNote, 3);
    updateListenStatus();
  }
  function updateListenStatus(matched) {
    const node = document.getElementById(`cl-listen-${p.id}`);
    if (!node) return;
    if (!audio.connected) {
      node.innerHTML = `<button class="cl-mini" id="cl-connect-${p.id}" style="border-color:var(--rk-bad);color:var(--rk-bad)">🎛 Connect guitar input to play along</button>`;
      const b = document.getElementById(`cl-connect-${p.id}`);
      if (b) b.onclick = e => { e.stopPropagation(); audio.connect(audio.selectedDeviceId); setTimeout(updateListenStatus, 400); };
      return;
    }
    if (matched) {
      node.innerHTML = `<span style="color:var(--rk-ok);font-weight:700">✓ ${listen.target} — that's the colour tone!</span>`;
      return;
    }
    if (listen.on) {
      node.innerHTML = `<span style="color:var(--rk-accent)">🎧 Listening… play the <b>${listen.target}</b> (the colour tone)</span>`;
    } else {
      node.innerHTML = `<button class="cl-mini" id="cl-play-${p.id}">🎧 Play the colour tone &amp; check my pitch</button>`;
      const b = document.getElementById(`cl-play-${p.id}`);
      if (b) b.onclick = e => { e.stopPropagation(); startListen(); };
    }
  }

  // One audio subscriber per build; it goes inert once the pedal is gone.
  audio.on(() => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!listen.on) return;
    const d = audio.detected;
    if (d && d.note === listen.target && Math.abs(d.cents) < 45) {
      listen.on = false;
      updateListenStatus(true);
      playNote(listen.target, 3, { gain: 0.12 });
    }
  });

  // Sync root from other pedals / the key bus.
  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    if (ev.root !== root) { root = ev.root; selVoicing = null; persist(); render(); applyHighlight(); }
  });

  function applyHighlight() {
    const c = memberChord();
    const vs = voicings();
    setConceptInfo(conceptFacts(c, member()));
    if (selVoicing !== null && vs[selVoicing]) {
      highlight(c, `${c.name}`, TENSION_COLORS, vs[selVoicing].positions);
    } else {
      highlight(c, `${c.name}`, TENSION_COLORS);
    }
  }

  function persist() { Object.assign(s, { familyId, memberIdx, root }); }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    // One accent for the whole panel — the card's. Each chord family used to
    // paint the chrome its own saturated hue, which is how one pedal ended up
    // looking like seven, and those hues sat right on top of note colours.
    const f = family(), m = member(), c = memberChord(), t = targetChord(), acc = 'var(--rk-accent)';
    const vs = voicings();
    // Slash chords always show a REAL grip by default — an all-neck pitch-class wash hides
    // the bass-vs-triad construction that IS the lesson.
    if (selVoicing === null && m.cat === 'Slash' && vs.length) selVoicing = 0;

    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:9px">`;

    // Family selector
    h += `<div class="cl-row" style="display:flex;flex-wrap:wrap;gap:4px">`;
    CHORD_FAMILIES.forEach(fam => {
      const on = fam.id === familyId;
      h += `<button class="cl-fam${on ? ' on' : ''}" data-fam="${fam.id}">${fam.icon} ${fam.label}</button>`;
    });
    h += `</div>`;

    // Blurb
    h += `<div style="font-size:calc(10px*var(--ui));line-height:1.5;color:var(--rk-ink-dim);background:var(--rk-soft);border-left:2px solid ${acc};padding:6px 8px;border-radius:4px">${f.blurb}</div>`;

    // Member chips (when a family has >1) — members may carry a `group` label ({R} = current root),
    // rendered as headed rows so big families (slash) read as a SYSTEM, not a pile of chips.
    if (f.members.length > 1) {
      const grouped = [];
      f.members.forEach((mm, i) => {
        const g = mm.group || '';
        if (!grouped.length || grouped[grouped.length - 1].g !== g) grouped.push({ g, items: [] });
        grouped[grouped.length - 1].items.push([mm, i]);
      });
      grouped.forEach(gr => {
        if (gr.g) h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1.2px;margin-top:3px">${gr.g.replace('{R}', root)}</div>`;
        h += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
        gr.items.forEach(([mm, i]) => {
          const on = i === memberIdx;
          h += `<button class="cl-mem${on ? ' on' : ''}" data-mem="${i}">${mm.name}</button>`;
        });
        h += `</div>`;
      });
    }

    // Root picker
    h += `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-right:2px">ROOT</span>`;
    NOTES.forEach(n => {
      const on = n === root;
      h += `<button class="cl-root${on ? ' on' : ''}" data-root="${n}">${n}</button>`;
    });
    h += `</div>`;

    // Headline chord + notes (colour tone emphasised)
    h += `<div style="background:var(--rk-panel2);border:1px solid var(--rk-edge);border-radius:8px;padding:8px 10px">`;
    h += `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">`;
    h += `<span class="mono" style="color:${acc};font-size:calc(22px*var(--ui));font-weight:800">${c.name}</span>`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">vs plain <b style="color:var(--rk-ink-dim)">${baseChord().name}</b></span>`;
    h += `</div>`;
    h += `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">`;
    c.notes.forEach(n => {
      const isColor = n === c.colorNote, isRoot = n === root;
      const col = isColor ? acc : isRoot ? 'var(--rk-ink)' : 'var(--rk-ink-dim)';
      h += `<span class="mono" style="font-size:calc(13px*var(--ui));font-weight:${isColor ? 800 : 600};color:${col}">${n}<span style="font-size:calc(8px*var(--ui));opacity:.65;margin-left:1px">${intervalLabel(root, n)}</span>${isColor ? ' ◆' : ''}</span>`;
    });
    h += `</div></div>`;

    // A/B colour reveal
    h += `<div style="display:flex;gap:6px">`;
    h += `<button class="cl-ab" id="cl-plain-${p.id}">▶ Plain<br><span style="font-size:calc(8px*var(--ui));opacity:.6">${baseChord().name}</span></button>`;
    h += `<button class="cl-ab on" id="cl-color-${p.id}">▶ Coloured<br><span style="font-size:calc(8px*var(--ui));opacity:.7">${c.name}</span></button>`;
    h += `</div>`;

    // Why it works
    h += `<div style="font-size:calc(10px*var(--ui));line-height:1.5;color:var(--rk-ink)"><span style="color:${acc};font-weight:700">Why it works · </span>${m.why}</div>`;

    // Voicings
    if (vs.length) {
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-top:2px">SHAPES ON THE NECK · tap to light it up</div>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:168px;overflow-y:auto;padding:2px 0">`;
      vs.forEach((v, vi) => {
        h += `<div class="cl-voicing" data-vi="${vi}" style="display:inline-block">${renderMiniDiagram(v, root, selVoicing === vi, true, intervalLabel)}</div>`;
      });
      h += `</div>`;
    }

    // Resolution drill
    h += `<div style="border:1px solid var(--rk-edge);border-radius:8px;padding:8px 10px;background:var(--rk-panel)">`;
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-bottom:6px">RESOLUTION DRILL — tension wants to release</div>`;
    h += `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px">`;
    h += `<span class="mono" style="color:${acc};font-size:calc(13px*var(--ui));font-weight:800">${c.name}</span>`;
    h += `<span style="color:var(--rk-ink-mute)">→</span>`;
    h += `<span class="mono" style="color:var(--rk-ok);font-size:calc(13px*var(--ui));font-weight:800">${t.name}</span>`;
    h += `<span style="color:var(--rk-ink-dim);font-size:calc(9px*var(--ui))">${t.motion}</span>`;
    h += `</div>`;
    // tension meter
    h += `<div style="height:9px;border-radius:5px;background:var(--rk-panel);overflow:hidden;border:1px solid var(--rk-edge-soft)">`;
    h += `<div id="cl-meter-fill-${p.id}" style="height:100%;width:${Math.round(m.tension * 100)}%;background:linear-gradient(90deg,var(--rk-dim),var(--rk-hot));transition:width .35s ease,background .35s ease"></div>`;
    h += `</div>`;
    h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">`;
    h += `<span id="cl-meter-lab-${p.id}" class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">tension ${Math.round(m.tension * 100)}%</span>`;
    h += `<button class="cl-mini" id="cl-resolve-${p.id}" style="border-color:color-mix(in srgb,var(--rk-ok) 50%,transparent);color:var(--rk-ok)">▶ Hear it resolve</button>`;
    h += `</div></div>`;

    // Play-along check
    h += `<div id="cl-listen-${p.id}" style="font-size:calc(10px*var(--ui));text-align:center;min-height:18px"></div>`;

    h += `</div>`;
    el.innerHTML = STYLE + h;
    wire();
    updateListenStatus();
  }

  function wire() {
    el.querySelectorAll('.cl-fam').forEach(b => b.onclick = e => {
      e.stopPropagation(); familyId = b.dataset.fam; memberIdx = 0; selVoicing = null; listen.on = false;
      persist(); render(); applyHighlight();
    });
    el.querySelectorAll('.cl-mem').forEach(b => b.onclick = e => {
      e.stopPropagation(); memberIdx = parseInt(b.dataset.mem); selVoicing = null; listen.on = false;
      persist(); render(); applyHighlight();
    });
    el.querySelectorAll('.cl-root').forEach(b => b.onclick = e => {
      e.stopPropagation(); root = b.dataset.root; selVoicing = null; listen.on = false;
      pedalBus.setKey(root, 'Major', { source: p.id });
      persist(); render(); applyHighlight();
    });
    el.querySelectorAll('.cl-voicing').forEach(b => b.onclick = e => {
      e.stopPropagation(); const vi = parseInt(b.dataset.vi);
      selVoicing = selVoicing === vi ? null : vi; render(); applyHighlight();
    });
    const plain = document.getElementById(`cl-plain-${p.id}`);   if (plain) plain.onclick = e => { e.stopPropagation(); showPlain(); };
    const color = document.getElementById(`cl-color-${p.id}`);   if (color) color.onclick = e => { e.stopPropagation(); showColored(); };
    const res   = document.getElementById(`cl-resolve-${p.id}`); if (res)   res.onclick   = e => { e.stopPropagation(); hearResolve(); };
  }

  render();
  applyHighlight();
}

// A <button> with no rule of its own is not unstyled — it is styled by the browser,
// as a light-grey 3D slab in Arial. That is how a dark pedal ends up with a white
// pill in it, and why the A/B pair used to read as one broken button beside one good
// one: only the "on" half happened to set a background inline. So every button in
// this lab takes its enclosure from ONE base and differs only in size and state.
// Nothing here names a colour — it is all kit tokens, so re-pointing this pedal's
// accent in the CATALOG re-skins the whole lab. The exceptions stay inline at the
// call site: --rk-ok / --rk-bad are the app-wide "resolved" and "not connected"
// signals, and those must not change meaning when you change pedals.
const STYLE = `<style>
.cl-fam,.cl-mem,.cl-root,.cl-ab,.cl-mini{
  font-family:inherit;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);
  color:var(--rk-ink-dim);border-radius:6px;cursor:pointer;
  transition:background .14s,border-color .14s,color .14s}
.cl-fam,.cl-mem{padding:4px 8px;font-size:calc(10px*var(--ui));font-weight:600}
.cl-root{min-width:24px;padding:4px 0;font-size:calc(10px*var(--ui));font-weight:700;background:transparent}
.cl-ab{flex:1;padding:7px 9px;font-size:calc(11px*var(--ui));font-weight:700;line-height:1.35}
.cl-mini{padding:4px 9px;font-size:calc(9px*var(--ui));font-weight:700}
.cl-fam:not(.on):hover,.cl-mem:not(.on):hover,.cl-root:not(.on):hover,.cl-ab:not(.on):hover{
  border-color:var(--rk-line);color:var(--rk-accent)}
/* the ok/bad minis set colour inline, so their hover is carried by the wash instead */
.cl-mini:hover{background:var(--rk-soft)}
.cl-fam.on,.cl-ab.on{background:var(--rk-soft);border-color:var(--rk-line);color:var(--rk-accent)}
.cl-mem.on{background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)}
.cl-root.on{background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-ink)}
</style>`;
