// ─── Improv Lab — call & response + backing-track jamming ─────────────────────
// The two skills that turn theory into MUSIC you can make on your own:
//   🗣️ CALL & RESPONSE — the app plays a short phrase (a musical question); you
//      answer it. A scaffold from ECHO (play it back) → ANSWER (copy a model
//      response) → CREATE (improvise a resolving answer, graded by ear). Teaches
//      the grammar of a musical conversation.
//   🎸 JAM — a chord progression loops in any key with a groove; the neck shows
//      the safe scale + the current chord's arpeggio + the target tone to aim
//      for, so you learn WHAT to play over changes and IN WHAT ORDER.
import { NOTES, SCALE_TYPES, CHORD_TYPES, getScaleNotes, getChordNotes, toSharp } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { setChordHighlight, setGhostHighlight, clearChordHighlight, clearGhostHighlight, setNowBanner, pedalBus, metroClock } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';
import { playPlan } from '../curriculum/drill-runner.js';
import { playNote, playChordNotes } from '../core/synth.js';
import { audio } from '../core/audio.js';
import { createListener } from '../core/listen.js';
import { CURRICULUM } from '../curriculum/curriculum-data.js';
import { bus } from '../core/mixer.js';

// BOARD colours, not pedal chrome. setChordHighlight / setNowBanner paint the
// main fretboard, which sits outside this pedal's card and so cannot inherit
// --rk-accent — the renderer is handed plain colour strings. Left literal for
// the same reason the fretboard's ghost blue is: it is shared board language.
const ACC = '#8a7cff';
const COL = { root: ACC, tone: '#5a4fb0', rootStroke: '#c0b4ff', toneStroke: '#7a6fd0' };
const pick = a => a[Math.floor(Math.random() * a.length)];
const midiOf = (note, octave) => (octave + 1) * 12 + NOTES.indexOf(toSharp(note));

// rhythmic cells (beats, sum ≈ 4) — the phrase's rhythm; responses echo it
const RHYTHM_CELLS = [[1, 1, 2], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [0.5, 0.5, 0.5, 0.5, 2], [2, 2], [1, 1, 1, 1], [0.5, 0.5, 1, 1, 1]];

// "feels" — the scale a phrase draws from, plus which degrees resolve (home)
// vs. ask a question (tension). Semitones from the key root.
const FEELS = [
  { id: 'minpent', name: 'Minor Pentatonic', cat: 'Pentatonic', scale: 'Minor Pent.', home: [0, 3, 7], tension: [5, 10] },
  { id: 'majpent', name: 'Major Pentatonic', cat: 'Pentatonic', scale: 'Major Pent.', home: [0, 4, 7], tension: [2, 9] },
  { id: 'blues',   name: 'Blues',            cat: 'Blues',      scale: 'Blues Minor', home: [0, 3, 7], tension: [5, 6, 10] },
  { id: 'major',   name: 'Major',            cat: 'Diatonic',   scale: 'Major',       home: [0, 4, 7], tension: [2, 5, 9, 11] },
  { id: 'dorian',  name: 'Dorian',           cat: 'Modes',      scale: 'Dorian',      home: [0, 3, 7], tension: [2, 5, 9, 10] },
];
const feelById = id => FEELS.find(f => f.id === id) || FEELS[0];
const feelInts = f => SCALE_TYPES[f.cat][f.scale];

const chordFormula = q => { for (const g of Object.values(CHORD_TYPES)) if (g[q]) return g[q]; return [0, 4, 7]; };
// minor = the chord actually contains a ♭3 and no major 3rd (name-matching a
// bare "m" wrongly flags "Major"/"Maj7"). Sus/aug have no ♭3 → not minor.
const isMinorQual = q => { const f = chordFormula(q); return f.includes(3) && !f.includes(4); };
const thirdOf = (root, q) => NOTES[(NOTES.indexOf(toSharp(root)) + (isMinorQual(q) ? 3 : 4)) % 12];
const degName = semi => ({ 0: 'root', 1: '♭2', 2: '2nd', 3: '♭3', 4: '3rd', 5: '4th', 6: '♭5', 7: '5th', 8: '♭6', 9: '6th', 10: '♭7', 11: '7th' })[semi] || '';

// jam presets = the 15 curriculum improv blocks (authored, previously unused)
const JAM_PRESETS = CURRICULUM.units.filter(u => u.improv && u.improv.backing?.progression?.length)
  .map(u => ({ ...u.improv, unit: u.title }));

// ── neck: a 5-fret melody zone on the top 3 strings, anchored to the key ──
function melodyZone(keyRoot) {
  let anchor = 5;
  for (let f = 3; f <= 12; f++) { if (getNoteAtFret(customTuning[1].note, customTuning[1].octave, f).note === toSharp(keyRoot)) { anchor = f; break; } }
  const lo = Math.max(0, anchor - 2), hi = lo + 5;
  const zone = [];
  [0, 1, 2].forEach(si => { for (let f = lo; f <= hi; f++) { const n = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f); zone.push({ si, fret: f, note: n.note, octave: n.octave, midi: midiOf(n.note, n.octave) }); } });
  return zone;
}
// lay a pitch-class sequence into the zone with smooth voice-leading
function layPhrase(pcs, zone) {
  const out = []; let prev = null;
  pcs.forEach(pc => {
    const cands = zone.filter(z => z.note === toSharp(pc));
    if (!cands.length) return;
    const target = prev == null ? 64 : prev;
    const p = cands.reduce((a, b) => Math.abs(b.midi - target) < Math.abs(a.midi - target) ? b : a);
    prev = p.midi; out.push(p);
  });
  return out;
}
// nearest scale-degree index whose semitone-from-root ∈ set
function nearestDegreeOfType(scalePcs, keyRoot, set, fromDeg) {
  const rootPc = NOTES.indexOf(toSharp(keyRoot));
  let best = fromDeg, bd = 99;
  scalePcs.forEach((pc, d) => {
    const semi = ((NOTES.indexOf(pc) - rootPc) % 12 + 12) % 12;
    if (set.includes(semi) && Math.abs(d - fromDeg) < bd) { bd = Math.abs(d - fromDeg); best = d; }
  });
  return best;
}

// ── phrase generation ────────────────────────────────────────────────
function genPhrase(keyRoot, feel, endOn) {
  const scalePcs = getScaleNotes(keyRoot, feelInts(feel));
  const cell = pick(RHYTHM_CELLS), n = cell.length;
  let deg = pick([0, 1, 2]);
  const degs = [deg];
  for (let i = 1; i < n; i++) { deg = Math.max(0, Math.min(scalePcs.length - 1, deg + pick([-2, -1, -1, 1, 1, 2]))); degs.push(deg); }
  degs[n - 1] = nearestDegreeOfType(scalePcs, keyRoot, endOn === 'tension' ? feel.tension : feel.home, degs[n - 1]);
  return { notes: degs.map((d, i) => ({ pc: scalePcs[d], dur: cell[i] })), cell, degs };
}
function genResponse(call, keyRoot, feel) {
  const scalePcs = getScaleNotes(keyRoot, feelInts(feel));
  const callDegs = call.notes.map(nt => Math.max(0, scalePcs.indexOf(toSharp(nt.pc))));
  const mean = callDegs.reduce((a, b) => a + b, 0) / callDegs.length;
  let degs = callDegs.map(d => Math.max(0, Math.min(scalePcs.length - 1, Math.round(2 * mean - d))));   // invert contour
  degs[degs.length - 1] = nearestDegreeOfType(scalePcs, keyRoot, feel.home, degs[degs.length - 1]);
  return { notes: degs.map((d, i) => ({ pc: scalePcs[d], dur: call.cell[i] })), cell: call.cell, degs };
}
// analyse a phrase: contour + how it ends (relative to the key)
function analyse(laid, keyRoot) {
  if (laid.length < 2) return { contour: '—', endText: '' };
  const first = laid[0].midi, last = laid[laid.length - 1].midi, peak = Math.max(...laid.map(z => z.midi)), trough = Math.min(...laid.map(z => z.midi));
  let contour = 'level';
  if (peak - first > 2 && peak - last > 2) contour = 'an arch ⌒ (rises then falls)';
  else if (last > first + 1) contour = 'rising ↗';
  else if (last < first - 1) contour = 'falling ↘';
  else if (first - trough > 2) contour = 'a dip ⌣';
  const endSemi = ((NOTES.indexOf(laid[laid.length - 1].note) - NOTES.indexOf(toSharp(keyRoot))) % 12 + 12) % 12;
  const resolved = [0, 4, 3, 7].includes(endSemi);
  const endText = resolved ? `resolved — it lands on the ${degName(endSemi)}, at rest` : `left hanging on the ${degName(endSemi)} — it wants to come home`;
  return { contour, endText, resolved };
}

export function buildImprovLabContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  if (!s.mode) s.mode = 'call';
  if (!s.key) s.key = pedalBus.masterKey?.root || 'A';
  if (!s.feel) s.feel = 'minpent';
  if (!s.level) s.level = 'echo';
  if (!s.crBpm) s.crBpm = 84;
  if (s.jamIdx == null) s.jamIdx = 0;
  if (!s.jamBpm) s.jamBpm = metroClock.bpm;   // mirrors the master clock (see wireMasterTempo below)
  if (s.drums == null) s.drums = true;

  const alive = () => !!document.getElementById(`body-${p.id}`);
  const feel = () => feelById(s.feel);

  // runtime (not persisted)
  let cr = { phase: 'idle', call: null, callLaid: [], target: [], idx: 0, resp: null, heard: [] };
  let jam = null;   // { prog, scalePcs, scaleRoot, bpm, ci, chordTimer, grooveTimer, beat }

  // ── mic gate (core/listen.js; hooked once per pedal, survives rebuilds) ──
  createListener({ owner: p, key: 'ilAudio', isActive: alive, onAttack: onHeardNote, onSilence });

  // ── CALL & RESPONSE ─────────────────────────────────────────────────
  const spbCR = () => 60 / s.crBpm;
  function playPhrase(phrase, { gain = 0.32, withTonic = false } = {}) {
    const zone = melodyZone(s.key);
    const laid = layPhrase(phrase.notes.map(n => n.pc), zone).map((z, i) => ({ ...z, dur: phrase.notes[i].dur }));
    const spb = spbCR();
    const steps = laid.map(z => ({ focus: [{ si: z.si, fret: z.fret }], play: [{ note: z.note, octave: z.octave }], dur: spb * z.dur * 0.9, gap: spb * z.dur }));
    if (withTonic) { const total = laid.reduce((a, z) => a + z.dur, 0) * spb; const third = feel().home.includes(3) ? 3 : 4; playChordNotes(getChordNotes(s.key, [0, third, 7]), { gain: 0.09, dur: total, strum: 0.02 }); }
    const stop = playPlan({ root: s.key, notes: [...new Set(laid.map(z => z.note))], label: 'call', positions: laid, colors: COL, steps, focusOnly: true }, { isAlive: alive, gain });
    return { laid, stop, secs: laid.reduce((a, z) => a + z.dur, 0) * spb };
  }
  function ghostTarget() {
    // show the notes the user should play, ghosted on the neck
    const t = cr.target;
    if (!t.length) return;
    setChordHighlight(s.key, [...new Set(t.map(z => z.note))], 'your turn', t, COL, t[cr.idx] ? [{ si: t[cr.idx].si, fret: t[cr.idx].fret }] : null, null, true);
    setGhostHighlight(t.slice(cr.idx + 1).map(z => ({ si: z.si, fret: z.fret, note: z.note })));
    updateOverlays();
  }
  function playCall() {
    stopAll();
    const call = genPhrase(s.key, feel(), 'tension');
    const { laid, secs } = playPhrase(call, { withTonic: true });
    cr = { phase: 'calling', call, callLaid: laid, target: [], idx: 0, resp: null, heard: [] };
    render();
    setTimeout(() => {
      if (!alive() || cr.phase !== 'calling') return;
      // set up "your turn" based on level
      if (s.level === 'echo') { cr.target = laid; }
      else if (s.level === 'answer') { cr.resp = genResponse(call, s.key, feel()); }
      else { cr.target = []; }
      cr.phase = 'yourturn'; cr.idx = 0; cr.heard = [];
      if (s.level === 'answer') showModelThenTurn(); else { if (s.level === 'echo') ghostTarget(); else showCreateHelp(); render(); }
    }, secs * 1000 + 300);
  }
  function showModelThenTurn() {
    // play the model response, then ghost it as the target to copy
    const { laid } = playPhrase(cr.resp, { gain: 0.3 });
    cr.target = laid;
    render();
    setTimeout(() => { if (alive() && cr.phase === 'yourturn') { ghostTarget(); render(); } }, laid.reduce((a, z) => a + z.dur, 0) * spbCR() * 1000 + 200);
  }
  function showCreateHelp() {
    // create mode: light the scale (palette) + home tones as landing spots
    const scalePcs = getScaleNotes(s.key, feelInts(feel()));
    const homePcs = feel().home.map(semi => NOTES[(NOTES.indexOf(toSharp(s.key)) + semi) % 12]);
    const zone = melodyZone(s.key);
    const homePos = zone.filter(z => homePcs.includes(z.note));
    setChordHighlight(s.key, scalePcs, 'improvise a resolving answer', null, COL, homePos, null, false);
    clearGhostHighlight(); updateOverlays();
    setNowBanner({ now: { text: 'Your turn — answer the call', color: ACC }, next: { text: `land on ${homePcs.join(' · ')} to resolve` } });
  }
  function onHeardNote(note) {
    if (s.mode !== 'call' || cr.phase !== 'yourturn') return;
    if (s.level === 'create') {
      cr.heard.push({ note, t: Date.now() });
      // grade continuously: light played note; final grade on silence
      pulseNeck(note);
      return;
    }
    // echo / answer: match the target sequence in order
    const want = cr.target[cr.idx];
    if (!want) return;
    if (note === want.note) {
      playNote(want.note, want.octave, { dur: 0.3, gain: 0.14 });
      cr.idx++;
      if (cr.idx >= cr.target.length) crSuccess();
      else { ghostTarget(); render(); }
    }
  }
  let silenceTimer = null;
  function onSilence() {
    if (s.mode !== 'call' || cr.phase !== 'yourturn' || s.level !== 'create') return;
    if (silenceTimer) return;
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (cr.phase === 'yourturn' && s.level === 'create' && cr.heard.length >= 2) gradeCreate();
    }, 1300);
  }
  function pulseNeck(note) {
    const zone = melodyZone(s.key);
    const z = zone.find(z2 => z2.note === toSharp(note));
    if (z) { setGhostHighlight([{ si: z.si, fret: z.fret, note: z.note }]); updateOverlays(); }
  }
  function gradeCreate() {
    const last = cr.heard[cr.heard.length - 1].note;
    const semi = ((NOTES.indexOf(toSharp(last)) - NOTES.indexOf(toSharp(s.key))) % 12 + 12) % 12;
    const resolved = feel().home.includes(semi);
    cr.phase = 'graded'; cr.grade = { resolved, last, semi };
    render();
  }
  function crSuccess() {
    cr.phase = 'done';
    // confirm back
    cr.target.forEach((z, k) => setTimeout(() => playNote(z.note, z.octave, { dur: 0.28, gain: 0.12 }), k * 30));
    render();
  }
  function stopAll() {
    if (cr.stop) { cr.stop(); cr.stop = null; }
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    stopJam();
    setNowBanner(null); clearChordHighlight(); clearGhostHighlight(); updateOverlays();
  }
  p._ilStop = stopAll;

  // ── JAM ─────────────────────────────────────────────────────────────
  let jamActx = null;
  function drum(type) {
    try {
      jamActx = jamActx || new (window.AudioContext || window.webkitAudioContext)();
      const t = jamActx.currentTime;
      if (type === 'kick') {
        const o = jamActx.createOscillator(), g = jamActx.createGain();
        o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
        g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(g); g.connect(bus(jamActx, 'drums')); o.start(); o.stop(t + 0.18);
      } else {
        const dur = type === 'snare' ? 0.18 : 0.04, vol = type === 'snare' ? 0.22 : 0.07, pw = type === 'snare' ? 2 : 3;
        const nb = jamActx.createBuffer(1, Math.floor(jamActx.sampleRate * dur), jamActx.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, pw);
        const ns = jamActx.createBufferSource(), g = jamActx.createGain();
        ns.buffer = nb; g.gain.value = vol; ns.connect(g); g.connect(bus(jamActx, 'drums')); ns.start();
      }
    } catch (e) { /* no audio */ }
  }
  function jamPreset() { return JAM_PRESETS[Math.min(s.jamIdx, JAM_PRESETS.length - 1)] || JAM_PRESETS[0]; }
  function showJamChord(c, next) {
    const formula = chordFormula(c.quality);
    const chordTones = getChordNotes(c.root, formula);
    const zone = melodyZone(jam.scaleRoot);
    const tonePos = zone.filter(z => chordTones.includes(z.note));
    setChordHighlight(jam.scaleRoot, jam.scalePcs, `${c.numeral || ''} ${c.root}${isMinorQual(c.quality) ? 'm' : ''}`, null, COL, tonePos, null, false);
    updateOverlays();
    const third = thirdOf(c.root, c.quality);
    const nThird = next ? thirdOf(next.root, next.quality) : null;
    setNowBanner({ now: { text: `${c.root}${isMinorQual(c.quality) ? 'm' : ''} — land on ${third} (3rd)`, color: ACC }, next: next ? { text: `${next.root}${isMinorQual(next.quality) ? 'm' : ''} → aim ${nThird}` } : null });
  }
  function startJam() {
    stopAll();
    const pr = jamPreset();
    const keyRoot = s.key;
    const delta = ((NOTES.indexOf(toSharp(keyRoot)) - NOTES.indexOf(toSharp(pr.scale.root))) % 12 + 12) % 12;
    const prog = pr.backing.progression.map(c => ({ ...c, root: NOTES[(NOTES.indexOf(toSharp(c.root)) + delta) % 12] }));
    const scaleInts = SCALE_TYPES[pr.scale.scaleCat]?.[pr.scale.scaleName] || SCALE_TYPES.Diatonic.Major;
    const bpm = s.jamBpm || pr.bpm || 90;
    jam = { prog, scaleRoot: keyRoot, scalePcs: getScaleNotes(keyRoot, scaleInts), scaleName: pr.scale.scaleName, bpm, ci: 0, beat: 0, spb: 60 / bpm, playing: true };
    render();
    fireChord();
    // groove at 8th notes
    if (s.drums) {
      jam.grooveTimer = setInterval(() => {
        if (!alive() || !jam) { stopJam(); return; }
        const eighth = jam.beat % 2, quarter = Math.floor(jam.beat / 2) % 4;
        if (eighth === 0 && quarter === 0) drum('kick');
        if (eighth === 0 && quarter === 2) { drum('kick'); }
        if (eighth === 0 && (quarter === 1 || quarter === 3)) drum('snare');
        drum('hat');
        jam.beat++;
      }, (60 / bpm) / 2 * 1000);
    }
  }
  function fireChord() {
    if (!jam || !alive()) return;
    const c = jam.prog[jam.ci], next = jam.prog[(jam.ci + 1) % jam.prog.length];
    const notes = c.notes || getChordNotes(c.root, chordFormula(c.quality));
    playChordNotes(notes, { gain: 0.13, dur: (c.beats || 4) * jam.spb * 0.95, strum: 0.03 });
    showJamChord(c, next);
    jam.chordTimer = setTimeout(() => { if (!jam) return; jam.ci = (jam.ci + 1) % jam.prog.length; fireChord(); }, (c.beats || 4) * jam.spb * 1000);
  }
  function stopJam() {
    if (jam) { clearTimeout(jam.chordTimer); clearInterval(jam.grooveTimer); jam = null; }
  }

  // ── render ──────────────────────────────────────────────────────────
  const chip = (cls, data, lab, on, extra = '') => `<button class="${cls} mono" ${data} style="min-height:calc(28px*var(--ui));background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:5px;color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};font-size:calc(10px*var(--ui));padding:4px 7px;cursor:pointer;${extra}">${lab}</button>`;

  function render() {
    // class="rk" puts the whole pedal inside the kit's token scope, so Call &
    // Response and Jam cannot drift into two different-looking products.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:8px">`;
    // mode tabs
    h += `<div style="display:flex;gap:5px">`;
    h += chip('il-mode', 'data-m="call"', '🗣️ Call &amp; Response', s.mode === 'call', 'flex:1;font-size:calc(10px*var(--ui));padding:6px 0');
    h += chip('il-mode', 'data-m="jam"', '🎸 Jam', s.mode === 'jam', 'flex:1;font-size:calc(10px*var(--ui));padding:6px 0');
    h += `</div>`;
    // key + feel (shared)
    h += `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">KEY</span>`;
    NOTES.forEach(n => h += chip('il-key', `data-n="${n}"`, n, s.key === n, 'padding:3px 4px;min-width:15px'));
    h += `</div>`;

    if (s.mode === 'call') {
      h += `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">FEEL</span>`;
      FEELS.forEach(f => h += chip('il-feel', `data-f="${f.id}"`, f.name, s.feel === f.id));
      h += `</div>`;
      // level
      h += `<div style="display:flex;gap:4px">`;
      [['echo', '① Echo', 'play it back'], ['answer', '② Answer', 'copy a model reply'], ['create', '③ Create', 'improvise a reply']].forEach(([v, l, sub]) =>
        h += `<button class="il-level" data-v="${v}" style="min-height:calc(28px*var(--ui));flex:1;background:${s.level === v ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${s.level === v ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:6px;color:${s.level === v ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};padding:5px 3px;cursor:pointer;font-family:'JetBrains Mono',monospace"><div style="font-size:calc(10px*var(--ui));font-weight:700">${l}</div><div style="font-size:calc(8px*var(--ui));opacity:.7">${sub}</div></button>`);
      h += `</div>`;
      // stage
      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-edge);border-radius:8px;padding:10px;min-height:96px;display:flex;flex-direction:column;gap:6px">`;
      if (cr.phase === 'idle') {
        h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));text-align:center;line-height:1.5">Press <b style="color:var(--rk-accent)">▶ Play the call</b>.<br>The app plays a short phrase that asks a question — then it's your turn to answer.</div>`;
      } else {
        const a = analyse(cr.callLaid, s.key);
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px">THE CALL</div>`;
        h += `<div class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:700">${cr.callLaid.map(z => z.note).join(' · ')}</div>`;
        h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));line-height:1.5">Shape: <b>${a.contour}</b> · ${a.endText}</div>`;
        if (cr.phase === 'yourturn') {
          if (s.level === 'create') {
            const homePcs = feel().home.map(semi => NOTES[(NOTES.indexOf(toSharp(s.key)) + semi) % 12]);
            h += `<div class="mono" style="color:var(--rk-ok);font-size:calc(10px*var(--ui));font-weight:700">🎤 Your turn — answer it, and resolve.</div>`;
            h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">End on <b style="color:var(--rk-dim)">${homePcs.join(' · ')}</b> to bring it home. ${audio.connected ? 'Listening…' : ''}</div>`;
          } else {
            h += `<div class="mono" style="color:var(--rk-ok);font-size:calc(10px*var(--ui));font-weight:700">🎤 Your turn — ${s.level === 'echo' ? 'play the call back' : 'play the model answer'}.</div>`;
            // The cursor gold below is the app-wide "now" of the step strip and the
            // fretboard — cross-pedal language, so it stays literal here too.
            h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">Target: ${cr.target.map((z, i) => `<span style="color:${i < cr.idx ? 'var(--rk-ok)' : i === cr.idx ? '#ffd23f' : 'var(--rk-ink-mute)'}">${z.note}${i < cr.idx ? '✓' : ''}</span>`).join(' · ')}</div>`;
          }
        } else if (cr.phase === 'graded') {
          h += cr.grade.resolved
            ? `<div class="mono" style="color:var(--rk-ok);font-size:calc(11px*var(--ui));font-weight:700">✓ Resolved! You landed on the ${degName(cr.grade.semi)} — that answers the call and brings it home.</div>`
            : `<div class="mono" style="color:var(--rk-bad);font-size:calc(10px*var(--ui));font-weight:700">You ended on the ${degName(cr.grade.semi)} — that leaves it hanging, like the call did. Try landing on a home tone (${feel().home.map(x => NOTES[(NOTES.indexOf(toSharp(s.key)) + x) % 12]).join(' · ')}).</div>`;
        } else if (cr.phase === 'done') {
          h += `<div class="mono" style="color:var(--rk-ok);font-size:calc(11px*var(--ui));font-weight:700">✓ Nailed it — that's the phrase.</div>`;
        }
      }
      h += `</div>`;
      // transport
      h += `<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">`;
      h += `<button id="il-play" style="min-height:calc(28px*var(--ui));flex:1;background:var(--rk-soft2);border:1px solid var(--rk-accent);border-radius:6px;color:var(--rk-accent);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;padding:7px;cursor:pointer">▶ Play the call</button>`;
      if (cr.phase !== 'idle' && cr.phase !== 'calling') h += chip('il-again', '', '🔊 Hear call', false, 'padding:7px 9px');
      if (s.level !== 'echo' && cr.phase !== 'idle') h += chip('il-model', '', '🔊 Model answer', false, 'padding:7px 9px');
      h += `</div>`;
      if (!audio.connected) h += `<button id="il-mic" class="mono" style="min-height:calc(28px*var(--ui));background:var(--rk-panel2);border:1px dashed var(--rk-edge-soft);border-radius:6px;color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));padding:5px;cursor:pointer">🎤 Connect your guitar to play answers back (or just listen &amp; learn)</button>`;
      // grammar card
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));line-height:1.7;border-top:1px solid var(--rk-edge-soft);padding-top:6px">
        <b style="color:var(--rk-ink)">Ways to answer a call:</b><br>
        • <b style="color:var(--rk-dim)">Repeat</b> — echo it exactly (Echo mode).<br>
        • <b style="color:var(--rk-dim)">Rhythmic echo</b> — same rhythm, new notes.<br>
        • <b style="color:var(--rk-dim)">Answer</b> — mirror the shape but resolve home (Answer mode).<br>
        • <b style="color:var(--rk-dim)">Develop</b> — take a fragment and extend it.</div>`;
    } else {
      // ── JAM ──
      const pr = jamPreset();
      h += `<div style="display:flex;align-items:center;gap:4px"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">BACKING</span>
        <select id="il-preset" style="flex:1;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:6px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:4px">`;
      JAM_PRESETS.forEach((pp, i) => h += `<option value="${i}" ${i === s.jamIdx ? 'selected' : ''}>${pp.title}</option>`);
      h += `</select></div>`;
      // the progression, transposed to the chosen key
      const delta = ((NOTES.indexOf(toSharp(s.key)) - NOTES.indexOf(toSharp(pr.scale.root))) % 12 + 12) % 12;
      const progTxt = pr.backing.progression.map(c => `${c.numeral || ''} ${NOTES[(NOTES.indexOf(toSharp(c.root)) + delta) % 12]}${isMinorQual(c.quality) ? 'm' : ''}`).join('  ');
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:6px 8px">${progTxt}</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));line-height:1.5">Play <b style="color:var(--rk-dim)">${s.key} ${pr.scale.scaleName}</b> over it. The bright dots are the current chord's tones — your safe landing notes. Aim for the <b style="color:var(--rk-dim)">3rd</b> when the chord changes.</div>`;
      // tempo + drums — the shared master control, so the jam runs at the same
      // tempo as the Metronome and every other open pedal
      h += `<div class="rk">`;
      h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">`;
      h += `<div style="flex:1;min-width:150px">${masterTempoBlock('il-' + p.id, { min: 30, max: 280, compact: true })}</div>`;
      h += chip('il-drums', '', '🥁 Drums', s.drums);
      h += `</div></div>`;
      // The moment this reads STOP it is the halt control, and every halt in the
      // app wears the same red — you reach for it mid-phrase with both hands on
      // the guitar, so it has to be found without being read. Hue 345 keeps it
      // off C. The lit chord tones and the banner stay on the accent: those only
      // report that the jam is running, and running is not stopping.
      h += `<button id="il-jam" style="min-height:calc(28px*var(--ui));background:${jam ? 'var(--rk-stop-soft)' : 'var(--rk-soft)'};border:1px solid ${jam ? 'var(--rk-stop-edge)' : 'var(--rk-accent)'};border-radius:6px;color:${jam ? 'var(--rk-stop)' : 'var(--rk-accent)'};font-family:'JetBrains Mono',monospace;font-size:calc(11px*var(--ui));font-weight:700;padding:8px;cursor:pointer">${jam ? '⏹ Stop jam' : '▶ Start jam'}</button>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${pr.prompt ? pr.prompt.slice(0, 120) : ''}</div>`;
    }
    h += `</div>`;
    el.innerHTML = h;
    wire();
  }

  function wire() {
    el.querySelectorAll('.il-mode').forEach(b => b.addEventListener('click', () => { stopAll(); s.mode = b.dataset.m; cr = { phase: 'idle', callLaid: [], target: [], idx: 0, heard: [] }; render(); }));
    el.querySelectorAll('.il-key').forEach(b => b.addEventListener('click', () => { s.key = b.dataset.n; stopAll(); if (s.mode === 'call') cr = { phase: 'idle', callLaid: [], target: [], idx: 0, heard: [] }; render(); }));
    el.querySelectorAll('.il-feel').forEach(b => b.addEventListener('click', () => { s.feel = b.dataset.f; render(); }));
    el.querySelectorAll('.il-level').forEach(b => b.addEventListener('click', () => { s.level = b.dataset.v; render(); }));
    document.getElementById('il-play')?.addEventListener('click', playCall);
    el.querySelector('.il-again')?.addEventListener('click', () => { if (cr.call) playPhrase(cr.call, { withTonic: true }); });
    el.querySelector('.il-model')?.addEventListener('click', () => { const r = cr.resp || genResponse(cr.call, s.key, feel()); cr.resp = r; playPhrase(r, { gain: 0.3 }); });
    document.getElementById('il-mic')?.addEventListener('click', async () => { try { await audio.connect(); } catch (e) { /* declined */ } render(); });
    // jam
    el.querySelector('#il-preset')?.addEventListener('change', e => { s.jamIdx = +e.target.value; stopAll(); render(); });
    // tempo: read AND write the master clock. `mirror` fires on our own commit and
    // when the tempo moves somewhere else, so a running jam re-times either way.
    // The equality guard matters — startJam() re-renders, which re-wires this.
    wireMasterTempo('il-' + p.id, { mirror: v => { if (s.jamBpm === v) return; s.jamBpm = v; if (jam) startJam(); } });
    el.querySelector('.il-drums')?.addEventListener('click', () => { s.drums = !s.drums; if (jam) startJam(); else render(); });
    document.getElementById('il-jam')?.addEventListener('click', () => { if (jam) { stopAll(); render(); } else startJam(); });
  }

  render();
}
