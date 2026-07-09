// ── Chord-Family Lab (+ Resolution Drill) ────────────────────────────
// The flagship "beyond the 7th-chord ceiling" trainer. For any chord family
// (sus / add9 / 9·11·13 / augmented / diminished / altered dominants) it runs
// the closed learning loop:
//   HEAR it (A/B colour reveal) → SEE the shape on the fretboard →
//   PLAY it (mic-scored single-note check) → RESOLVE it (tension meter drops).
import { CHORD_TYPES, getChordNotes, intervalLabel, NOTES } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, pedalBus } from '../core/state.js';
import { findVoicings, renderMiniDiagram } from '../core/voicings.js';
import { updateOverlays } from '../ui/fretboard.js';
import { audio } from '../core/audio.js';
import { CHORD_FAMILIES, getFamily, chordName, transposeRoot, buildChord } from '../harmony/chord-vocabulary.js';
import { playChordNotes, playNote } from '../core/synth.js';

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
  function voicings() { const c = memberChord(); return findVoicings(c.root, c.notes, c.type); }

  // ── Fretboard + meter helpers ──────────────────────────────────────
  function highlight(chord, label, colors, positions) {
    setChordHighlight(chord.root, chord.notes, label, positions || null, colors || null);
    updateOverlays();
  }
  function setMeter(val, hot) {
    const bar = document.getElementById(`cl-meter-fill-${p.id}`);
    const lab = document.getElementById(`cl-meter-lab-${p.id}`);
    if (bar) {
      bar.style.width = Math.round(val * 100) + '%';
      bar.style.background = hot
        ? 'linear-gradient(90deg,#e0a14a,#e0556b)'
        : 'linear-gradient(90deg,#3a8f5a,#7ad17a)';
    }
    if (lab) lab.textContent = hot ? `tension ${Math.round(val * 100)}%` : `resolved`;
  }

  function showColored() {
    const c = memberChord();
    highlight(c, `${c.name}  ·  ${c.mem.name}`, TENSION_COLORS);
    setMeter(c.mem.tension, true);
    playChordNotes(c.notes);
  }
  function showPlain() {
    const b = baseChord();
    highlight(b, `${b.name}  ·  plain`, null);
    setMeter(0.12, false);
    playChordNotes(b.notes);
  }
  function hearResolve() {
    const c = memberChord(), t = targetChord();
    highlight(c, `${c.name}  (tension)`, TENSION_COLORS);
    setMeter(c.mem.tension, true);
    const d = playChordNotes(c.notes);
    setTimeout(() => {
      if (!document.getElementById(`body-${p.id}`)) return;
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
      node.innerHTML = `<button class="cl-mini" id="cl-connect-${p.id}" style="border-color:#e0556b;color:#e0556b">🎛 Connect guitar input to play along</button>`;
      const b = document.getElementById(`cl-connect-${p.id}`);
      if (b) b.onclick = e => { e.stopPropagation(); audio.connect(audio.selectedDeviceId); setTimeout(updateListenStatus, 400); };
      return;
    }
    if (matched) {
      node.innerHTML = `<span style="color:#7ad17a;font-weight:700">✓ ${listen.target} — that's the colour tone!</span>`;
      return;
    }
    if (listen.on) {
      node.innerHTML = `<span style="color:${family().accent}">🎧 Listening… play the <b>${listen.target}</b> (the colour tone)</span>`;
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
    if (selVoicing !== null && vs[selVoicing]) {
      highlight(c, `${c.name}`, TENSION_COLORS, vs[selVoicing].positions);
    } else {
      highlight(c, `${c.name}`, TENSION_COLORS);
    }
  }

  function persist() { Object.assign(s, { familyId, memberIdx, root }); }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const f = family(), m = member(), c = memberChord(), t = targetChord(), acc = f.accent;
    const vs = voicings();

    let h = `<div style="display:flex;flex-direction:column;gap:9px">`;

    // Family selector
    h += `<div class="cl-row" style="display:flex;flex-wrap:wrap;gap:4px">`;
    CHORD_FAMILIES.forEach(fam => {
      const on = fam.id === familyId;
      h += `<button class="cl-fam" data-fam="${fam.id}" style="border-color:${on ? fam.accent : '#3a3a3a'};color:${on ? fam.accent : '#999'};background:${on ? fam.accent + '1f' : 'rgba(255,255,255,.02)'}">${fam.icon} ${fam.label}</button>`;
    });
    h += `</div>`;

    // Blurb
    h += `<div style="font-size:10px;line-height:1.5;color:#bdbdbd;background:${acc}12;border-left:2px solid ${acc};padding:6px 8px;border-radius:4px">${f.blurb}</div>`;

    // Member chips (when a family has >1)
    if (f.members.length > 1) {
      h += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
      f.members.forEach((mm, i) => {
        const on = i === memberIdx;
        h += `<button class="cl-mem" data-mem="${i}" style="border-color:${on ? acc : '#3a3a3a'};color:${on ? acc : '#aaa'};background:${on ? acc + '22' : 'rgba(255,255,255,.02)'}">${mm.name}</button>`;
      });
      h += `</div>`;
    }

    // Root picker
    h += `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">`;
    h += `<span class="mono" style="color:#555;font-size:8px;letter-spacing:1px;margin-right:2px">ROOT</span>`;
    NOTES.forEach(n => {
      const on = n === root;
      h += `<button class="cl-root" data-root="${n}" style="min-width:24px;border-color:${on ? acc : '#333'};color:${on ? '#fff' : '#999'};background:${on ? acc + '33' : 'transparent'}">${n}</button>`;
    });
    h += `</div>`;

    // Headline chord + notes (colour tone emphasised)
    h += `<div style="background:rgba(255,255,255,.03);border:1px solid ${acc}55;border-radius:8px;padding:8px 10px">`;
    h += `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">`;
    h += `<span class="mono" style="color:${acc};font-size:22px;font-weight:800">${c.name}</span>`;
    h += `<span class="mono" style="color:#666;font-size:9px">vs plain <b style="color:#999">${baseChord().name}</b></span>`;
    h += `</div>`;
    h += `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">`;
    c.notes.forEach(n => {
      const isColor = n === c.colorNote, isRoot = n === root;
      const col = isColor ? acc : isRoot ? '#eee' : '#2a8a5a';
      h += `<span class="mono" style="font-size:13px;font-weight:${isColor ? 800 : 600};color:${col}">${n}<span style="font-size:8px;opacity:.65;margin-left:1px">${intervalLabel(root, n)}</span>${isColor ? ' ◆' : ''}</span>`;
    });
    h += `</div></div>`;

    // A/B colour reveal
    h += `<div style="display:flex;gap:6px">`;
    h += `<button class="cl-ab" id="cl-plain-${p.id}" style="flex:1;border-color:#3a3a3a;color:#bbb">▶ Plain<br><span style="font-size:8px;opacity:.6">${baseChord().name}</span></button>`;
    h += `<button class="cl-ab" id="cl-color-${p.id}" style="flex:1;border-color:${acc};color:${acc};background:${acc}18">▶ Coloured<br><span style="font-size:8px;opacity:.7">${c.name}</span></button>`;
    h += `</div>`;

    // Why it works
    h += `<div style="font-size:10px;line-height:1.5;color:#d2d2d2"><span style="color:${acc};font-weight:700">Why it works · </span>${m.why}</div>`;

    // Voicings
    if (vs.length) {
      h += `<div class="mono" style="color:#666;font-size:8px;letter-spacing:1px;margin-top:2px">SHAPES ON THE NECK · tap to light it up</div>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:168px;overflow-y:auto;padding:2px 0">`;
      vs.forEach((v, vi) => {
        h += `<div class="cl-voicing" data-vi="${vi}" style="display:inline-block">${renderMiniDiagram(v, root, selVoicing === vi, true, intervalLabel)}</div>`;
      });
      h += `</div>`;
    }

    // Resolution drill
    h += `<div style="border:1px solid #333;border-radius:8px;padding:8px 10px;background:rgba(0,0,0,.18)">`;
    h += `<div class="mono" style="color:#888;font-size:8px;letter-spacing:1px;margin-bottom:6px">RESOLUTION DRILL — tension wants to release</div>`;
    h += `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px">`;
    h += `<span class="mono" style="color:${acc};font-size:13px;font-weight:800">${c.name}</span>`;
    h += `<span style="color:#666">→</span>`;
    h += `<span class="mono" style="color:#7ad17a;font-size:13px;font-weight:800">${t.name}</span>`;
    h += `<span style="color:#777;font-size:9px">${t.motion}</span>`;
    h += `</div>`;
    // tension meter
    h += `<div style="height:9px;border-radius:5px;background:#1a1a1a;overflow:hidden;border:1px solid #2a2a2a">`;
    h += `<div id="cl-meter-fill-${p.id}" style="height:100%;width:${Math.round(m.tension * 100)}%;background:linear-gradient(90deg,#e0a14a,#e0556b);transition:width .35s ease,background .35s ease"></div>`;
    h += `</div>`;
    h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">`;
    h += `<span id="cl-meter-lab-${p.id}" class="mono" style="color:#888;font-size:8px">tension ${Math.round(m.tension * 100)}%</span>`;
    h += `<button class="cl-mini" id="cl-resolve-${p.id}" style="border-color:#7ad17a;color:#7ad17a">▶ Hear it resolve</button>`;
    h += `</div></div>`;

    // Play-along check
    h += `<div id="cl-listen-${p.id}" style="font-size:10px;text-align:center;min-height:18px"></div>`;

    h += `</div>`;
    el.innerHTML = h;
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
