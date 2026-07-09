// ── Melody Lab (+ Resolution Drill for single notes) ─────────────────
// Teaches melodic phrasing the Chord-Family-Lab way: over a given chord +
// scale, it shows which notes are STABLE landing tones (chord tones) and
// which are TENSIONS that want to RESOLVE — by step — into a chord tone.
// HEAR a tension resolve → SEE it on the neck → PLAY it (mic-checked).
import { NOTES, CHORD_TYPES, SCALE_TYPES, getChordNotes, getScaleNotes, intervalLabel } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, pedalBus } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { findVoicings, renderMiniDiagram } from '../core/voicings.js';
import { playNote, playChordNotes } from '../core/synth.js';
import { audio } from '../core/audio.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const ACCENT = '#ec6a8a';
const STABLE_COLORS  = { root: '#7ad17a', tone: '#2a7a4a', rootStroke: '#a6f0a6', toneStroke: '#4a9a6a' };
const SCALE_COLORS   = { root: '#ec6a8a', tone: '#7a3a4e', rootStroke: '#ff9bb5', toneStroke: '#b85a72' };
const TENSION_COLORS = { root: '#e0a14a', tone: '#6a4a22', rootStroke: '#ffce80', toneStroke: '#b8853a' };

const CHORD_CHOICES = [ // [cat, type, short]
  ['Triads', 'Major', 'maj'], ['Triads', 'Minor', 'min'],
  ['7ths', 'Maj7', 'maj7'], ['7ths', '7 (Dom)', '7'], ['7ths', 'Min7', 'm7'],
];
const SCALE_CHOICES = [ // [cat, name, short]
  ['Diatonic', 'Major', 'Major'], ['Modes', 'Dorian', 'Dorian'], ['Modes', 'Mixolydian', 'Mixo'],
  ['Diatonic', 'Nat. Minor', 'Nat. Min'], ['Pentatonic', 'Major Pent.', 'Maj Pent'],
  ['Pentatonic', 'Minor Pent.', 'Min Pent'], ['Blues', 'Blues Minor', 'Blues'],
];

const VIEWS = [
  { id: 'stable',  icon: '🎯', label: 'Chord Tones',
    blurb: 'These are <b>home</b> — the notes of the chord. A melody that lands on a chord tone on a strong beat sounds resolved and intentional. Aim for them.' },
  { id: 'tension', icon: '🎨', label: 'Tensions',
    blurb: 'The scale notes that are <b>not</b> in the chord. They create pull and colour — but the magic is <b>resolving</b> each one, by step, into a chord tone. That motion is what makes a line sing.' },
  { id: 'scale',   icon: '🎼', label: 'Full Scale',
    blurb: 'Your whole note pool over this chord. Use tensions as <b>passing notes</b> between chord tones, not as places to stop. Stepwise lines that target chord tones almost always sound good.' },
];

const MELODY_THEORY = {
  kicker: 'MELODY', title: 'Making melodies: target & resolve',
  what: `A good melody is mostly two ideas. <b>Chord tones</b> (1·3·5·7 of the chord under you) are <b>stable</b> — land on them on strong beats and at phrase ends. Everything else in the scale is a <b>tension</b> — it sounds unfinished until it <b>resolves</b>, usually by a half- or whole-step, into a chord tone.`,
  why: `That's why aimless scale-running sounds like exercises, not music: it never resolves. Pick a <b>target</b> chord tone, approach it from a step above or below, and let the tension lean in. Do that over each chord in a progression and you're <i>spelling the harmony</i> with your melody — the secret behind every memorable solo and vocal line.`,
  lessonId: 'targeting-chord-tones',
};

export function buildMelodyContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});

  let root      = s.melRoot || 'C';
  let chordIdx  = s.melChord ?? 0;   // index into CHORD_CHOICES
  let scaleIdx  = s.melScale ?? 0;   // index into SCALE_CHOICES
  let view      = s.melView || 'stable';
  let tensionIdx = 0;                 // which tension the drill is on
  let selVoicing = null;
  const listen = { on: false, target: null };

  const chord = () => CHORD_CHOICES[Math.min(chordIdx, CHORD_CHOICES.length - 1)];
  const scale = () => SCALE_CHOICES[Math.min(scaleIdx, SCALE_CHOICES.length - 1)];
  const chordType = () => { const [cat, type] = chord(); return CHORD_TYPES[cat][type]; };
  const scaleIvls = () => { const [cat, name] = scale(); return SCALE_TYPES[cat][name]; };
  const chordName = () => { const [, , short] = chord(); return `${root}${short === 'maj' ? '' : short}`; };

  // ── Analysis: chord tones, scale tones, and each tension's resolution ──
  function analyze() {
    const chordNotes = getChordNotes(root, chordType());
    const scaleNotes = getScaleNotes(root, scaleIvls());
    const chordSet = new Set(chordNotes);
    const ri = NOTES.indexOf(root);
    const tensions = scaleNotes.filter(n => !chordSet.has(n)).map(n => {
      const ni = NOTES.indexOf(n);
      let best = null;
      chordNotes.forEach(ct => {
        const ci = NOTES.indexOf(ct);
        const down = (ni - ci + 12) % 12;   // semitones to step DOWN onto ct
        const up   = (ci - ni + 12) % 12;    // semitones to step UP onto ct
        const dist = Math.min(down, up);
        const dir  = down <= up ? 'down' : 'up';
        if (!best || dist < best.dist || (dist === best.dist && dir === 'down')) best = { ct, dir, dist };
      });
      const motion = best.dist === 1 ? `½-step ${best.dir}` : best.dist === 2 ? `whole-step ${best.dir}` : `${best.dist} semis ${best.dir}`;
      return { note: n, deg: intervalLabel(root, n), resolvesTo: best.ct, resolvesDeg: intervalLabel(root, best.ct), motion, dir: best.dir, dist: best.dist };
    });
    return { chordNotes, scaleNotes, tensions };
  }

  function curTension() { const a = analyze(); return a.tensions.length ? a.tensions[Math.min(tensionIdx, a.tensions.length - 1)] : null; }
  function voicings() { return findVoicings(root, getChordNotes(root, chordType()), chord()[1]); }

  // ── Fretboard ──────────────────────────────────────────────────────
  function applyHighlight(opts = {}) {
    const a = analyze();
    if (opts.focusNote) {
      // resolution-drill focus: scale backdrop + the focused note spotlit
      setChordHighlight(root, a.scaleNotes, opts.label || chordName(), null, opts.colors || SCALE_COLORS, { note: opts.focusNote });
    } else if (view === 'stable') {
      setChordHighlight(root, a.chordNotes, `${chordName()} — chord tones (land here)`, null, STABLE_COLORS);
    } else if (view === 'scale') {
      setChordHighlight(root, a.scaleNotes, `${root} ${scale()[1]} — full scale`, null, SCALE_COLORS);
    } else { // tension
      const t = curTension();
      setChordHighlight(root, a.scaleNotes, t ? `tension ${t.deg} → ${t.resolvesDeg}` : chordName(), null, SCALE_COLORS, t ? { note: t.note } : null);
    }
    updateOverlays();
  }

  function setMeter(val, hot) {
    const bar = document.getElementById(`ml-meter-${p.id}`);
    const lab = document.getElementById(`ml-meter-lab-${p.id}`);
    if (bar) { bar.style.width = Math.round(val * 100) + '%'; bar.style.background = hot ? 'linear-gradient(90deg,#e0a14a,#ec6a8a)' : 'linear-gradient(90deg,#3a8f5a,#7ad17a)'; }
    if (lab) lab.textContent = hot ? `tension` : `resolved ✓`;
  }

  function hearResolve() {
    const t = curTension(); if (!t) return;
    applyHighlight({ focusNote: t.note, colors: TENSION_COLORS, label: `${t.deg} (tension)` });
    setMeter(0.85, true);
    playNote(t.note, 3);
    setTimeout(() => {
      if (!document.getElementById(`body-${p.id}`)) return;
      applyHighlight({ focusNote: t.resolvesTo, colors: STABLE_COLORS, label: `${t.resolvesDeg} (resolved)` });
      setMeter(0.1, false);
      playNote(t.resolvesTo, 3);
    }, 850);
  }

  // ── Play-along mic check ───────────────────────────────────────────
  function startListen() {
    const t = curTension(); if (!t) return;
    listen.on = true; listen.target = t.resolvesTo;
    playNote(t.note, 3);                       // play the tension; user must resolve it
    setTimeout(() => playNote(t.resolvesTo, 3, { gain: 0.1 }), 700);
    updateListenStatus();
  }
  function updateListenStatus(matched) {
    const node = document.getElementById(`ml-listen-${p.id}`); if (!node) return;
    const t = curTension();
    if (!audio.connected) {
      node.innerHTML = `<button class="rk-chip ml-connect">🎛 Connect guitar input to play along</button>`;
      const b = node.querySelector('.ml-connect');
      if (b) b.onclick = e => { e.stopPropagation(); audio.connect(audio.selectedDeviceId); setTimeout(() => updateListenStatus(), 400); };
      return;
    }
    if (matched) { node.innerHTML = `<span style="color:#7ad17a;font-weight:700">✓ resolved to ${listen.target} — that's the chord tone!</span>`; return; }
    if (listen.on) node.innerHTML = `<span style="color:${ACCENT}">🎧 now play the <b>${listen.target}</b> to resolve the ${t ? t.deg : ''}…</span>`;
    else node.innerHTML = `<button class="rk-chip ml-play">🎧 Play a tension &amp; resolve it (mic check)</button>`;
    const pb = node.querySelector('.ml-play'); if (pb) pb.onclick = e => { e.stopPropagation(); startListen(); };
  }
  audio.on(() => {
    if (!document.getElementById(`body-${p.id}`) || !listen.on) return;
    const d = audio.detected;
    if (d && d.note === listen.target && Math.abs(d.cents) < 45) { listen.on = false; updateListenStatus(true); playNote(listen.target, 3, { gain: 0.12 }); }
  });

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    if (ev.root !== root) { root = ev.root; tensionIdx = 0; selVoicing = null; persist(); render(); applyHighlight(); }
  });

  function persist() { Object.assign(s, { melRoot: root, melChord: chordIdx, melScale: scaleIdx, melView: view }); }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const a = analyze(), vmeta = VIEWS.find(v => v.id === view), vs = voicings();
    let h = `<div class="rk rk-melody" style="--rk-accent:${ACCENT}">`;

    // Concept tabs
    h += `<div class="rk-seg" style="gap:5px">`;
    VIEWS.forEach(v => h += `<button class="rk-seg-btn ml-view${v.id === view ? ' is-active' : ''}" data-v="${v.id}" style="flex:1;font-size:8.5px;padding:6px 2px">${v.icon} ${v.label}</button>`);
    h += `</div>`;

    // Top blurb for the active tab
    h += `<div style="font-size:10px;line-height:1.5;color:#cfcfcf;background:${ACCENT}14;border-left:2px solid ${ACCENT};padding:7px 9px;border-radius:4px">${vmeta.blurb}</div>`;

    // Chord + scale pickers
    h += `<div class="rk-section"><div class="rk-label">CHORD UNDER YOU</div><div class="rk-seg" style="gap:3px">`;
    NOTES.forEach(n => h += `<button class="rk-seg-btn ml-root${n === root ? ' is-active' : ''}" data-r="${n}" style="min-width:24px;padding:4px 0;font-size:8px">${n}</button>`);
    h += `</div><div class="rk-seg" style="gap:3px;margin-top:5px">`;
    CHORD_CHOICES.forEach(([, , short], i) => h += `<button class="rk-seg-btn ml-chord${i === chordIdx ? ' is-active' : ''}" data-c="${i}" style="font-size:8.5px;padding:5px 9px">${short}</button>`);
    h += `</div></div>`;
    h += `<div class="rk-section"><div class="rk-label">SOLO WITH (scale)</div><div class="rk-seg" style="gap:3px">`;
    SCALE_CHOICES.forEach(([, , short], i) => h += `<button class="rk-seg-btn ml-scale${i === scaleIdx ? ' is-active' : ''}" data-sc="${i}" style="font-size:8px;padding:5px 8px">${short}</button>`);
    h += `</div></div>`;

    // Headline: chord tones vs tensions
    h += `<div style="background:rgba(255,255,255,.03);border:1px solid ${ACCENT}44;border-radius:8px;padding:8px 10px">`;
    h += `<div class="mono" style="color:${ACCENT};font-size:18px;font-weight:800">${chordName()} <span style="color:#666;font-size:9px;font-weight:500">· ${root} ${scale()[1]}</span></div>`;
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">`;
    // Show the scale tones PLUS any chord tone that lives outside the chosen scale —
    // an out-of-scale chord tone is still a ◆ landing note, so it shouldn't vanish.
    const riHead = NOTES.indexOf(root);
    const headNotes = [...new Set([...a.scaleNotes, ...a.chordNotes])]
      .sort((x, y) => ((NOTES.indexOf(x) - riHead + 12) % 12) - ((NOTES.indexOf(y) - riHead + 12) % 12));
    headNotes.forEach(n => {
      const isChord = a.chordNotes.includes(n), isRoot = n === root;
      const inScale = a.scaleNotes.includes(n);
      const col = isChord ? '#7ad17a' : ACCENT;
      h += `<span class="mono" style="font-size:12px;font-weight:${isChord ? 800 : 600};color:${col}${inScale ? '' : ';opacity:.7'}">${n}<span style="font-size:7px;opacity:.7">${intervalLabel(root, n)}</span>${isChord ? (isRoot ? '⌂' : '◆') : ''}</span>`;
    });
    h += `</div><div class="mono" style="color:#666;font-size:8px;margin-top:5px"><span style="color:#7ad17a">◆ chord tone (stable)</span> · <span style="color:${ACCENT}">tension (resolves)</span></div>`;
    h += `</div>`;

    // Tension → resolution map
    if (a.tensions.length) {
      h += `<div class="rk-section"><div class="rk-label">TENSIONS → WHERE THEY RESOLVE</div><div style="display:flex;flex-direction:column;gap:3px">`;
      a.tensions.forEach((t, i) => {
        const on = view === 'tension' && i === tensionIdx;
        h += `<button class="ml-tension" data-ti="${i}" style="display:flex;align-items:center;gap:8px;background:${on ? ACCENT + '22' : 'rgba(255,255,255,.03)'};border:1px solid ${on ? ACCENT : 'rgba(255,255,255,.06)'};border-radius:6px;padding:4px 8px;cursor:pointer;text-align:left;width:100%">
          <span class="mono" style="color:${ACCENT};font-size:12px;font-weight:800;min-width:26px">${t.note}</span>
          <span class="mono" style="color:#666;font-size:9px">${t.deg}</span>
          <span style="color:#777">→</span>
          <span class="mono" style="color:#7ad17a;font-size:12px;font-weight:800;min-width:26px">${t.resolvesTo}</span>
          <span class="mono" style="color:#666;font-size:9px;flex:1">${t.resolvesDeg} · ${t.motion}</span>
        </button>`;
      });
      h += `</div></div>`;
    }

    // Chord shape diagram (readable, CFL style)
    if (vs.length) {
      h += `<div class="rk-label" style="margin-top:2px">CHORD SHAPE · the harmony you're soloing over</div>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:150px;overflow-y:auto;padding:2px 0">`;
      vs.slice(0, 4).forEach((v, vi) => h += `<div class="ml-voicing" data-vi="${vi}" style="display:inline-block">${renderMiniDiagram(v, root, selVoicing === vi, true, intervalLabel)}</div>`);
      h += `</div>`;
    }

    // Resolution drill
    const t = curTension();
    h += `<div style="border:1px solid #333;border-radius:8px;padding:8px 10px;background:rgba(0,0,0,.18)">`;
    h += `<div class="mono" style="color:#888;font-size:8px;letter-spacing:1px;margin-bottom:6px">RESOLUTION DRILL — a tension wants to release</div>`;
    if (t) {
      h += `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px">
        <span class="mono" style="color:${ACCENT};font-size:14px;font-weight:800">${t.note}</span>
        <span style="color:#666">→</span>
        <span class="mono" style="color:#7ad17a;font-size:14px;font-weight:800">${t.resolvesTo}</span>
        <span style="color:#777;font-size:9px">${t.motion}</span></div>`;
      h += `<div style="height:9px;border-radius:5px;background:#1a1a1a;overflow:hidden;border:1px solid #2a2a2a"><div id="ml-meter-${p.id}" style="height:100%;width:80%;background:linear-gradient(90deg,#e0a14a,#ec6a8a);transition:width .35s ease,background .35s ease"></div></div>`;
      h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        <span id="ml-meter-lab-${p.id}" class="mono" style="color:#888;font-size:8px">tension</span>
        <button class="rk-chip ml-resolve" style="border-color:#7ad17a;color:#7ad17a">▶ Hear it resolve</button></div>`;
    } else {
      h += `<div class="mono" style="color:#666;font-size:9px">This chord/scale combo has no tensions — every scale note is a chord tone. Try a fuller scale (e.g. Major) over a triad.</div>`;
    }
    h += `</div>`;

    h += `<div id="ml-listen-${p.id}" style="font-size:10px;text-align:center;min-height:18px"></div>`;

    h += theoryPanelHTML('melody', MELODY_THEORY);
    h += `</div>`;
    el.innerHTML = h;
    wire();
    wireTheoryPanel(el);
    updateListenStatus();
  }

  function wire() {
    el.querySelectorAll('.ml-view').forEach(b => b.onclick = e => { e.stopPropagation(); view = b.dataset.v; listen.on = false; persist(); render(); applyHighlight(); });
    el.querySelectorAll('.ml-root').forEach(b => b.onclick = e => { e.stopPropagation(); root = b.dataset.r; tensionIdx = 0; selVoicing = null; listen.on = false; pedalBus.setKey(root, 'Major', { source: p.id }); persist(); render(); applyHighlight(); });
    el.querySelectorAll('.ml-chord').forEach(b => b.onclick = e => { e.stopPropagation(); chordIdx = parseInt(b.dataset.c); tensionIdx = 0; selVoicing = null; listen.on = false; persist(); render(); applyHighlight(); });
    el.querySelectorAll('.ml-scale').forEach(b => b.onclick = e => { e.stopPropagation(); scaleIdx = parseInt(b.dataset.sc); tensionIdx = 0; listen.on = false; persist(); render(); applyHighlight(); });
    el.querySelectorAll('.ml-tension').forEach(b => b.onclick = e => { e.stopPropagation(); view = 'tension'; tensionIdx = parseInt(b.dataset.ti); listen.on = false; persist(); render(); applyHighlight(); });
    el.querySelectorAll('.ml-voicing').forEach(b => b.onclick = e => { e.stopPropagation(); const vi = parseInt(b.dataset.vi); selVoicing = selVoicing === vi ? null : vi; render(); });
    const r = el.querySelector('.ml-resolve'); if (r) r.onclick = e => { e.stopPropagation(); hearResolve(); };
  }

  render();
  applyHighlight();
}
