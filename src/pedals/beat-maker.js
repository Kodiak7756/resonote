import { metroClock } from '../core/state.js';
import { encodeMidi, downloadMidi, midiFilename, PPQ } from '../core/midi-writer.js';
import { NOTES } from '../core/music-theory.js';
import { GENRES, GENRE_NAMES, genreChords, compOf } from '../core/genres.js';
import { playChordNotes } from '../core/synth.js';
import { setChordHighlight, clearChordHighlight } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { bus } from '../core/mixer.js';
import { createPulse, audioCtx, clickSound } from '../core/pulse.js';
import { DRUM_PIECES, PIECE, LEGACY_KEYS, DRUM_MIDI_MAPS, playDrum, stepVel, drumOut,
         drumBus, drumEdit, setDrumEdit, registerMaker, unregisterMaker, touchMaker } from '../core/drums.js';

// The kit — pieces, voices, lane colours and the REAPER note maps — lives in
// core/drums.js, shared with the 🥁 DRUMS instrument, so the snare you hit on
// the kit is the snare row here in every respect.
const STEPS = 16;                 // one 4/4 bar of sixteenths
const BAR_CHOICES = [1, 2, 4];    // pattern length — room for a fill and a crash

// Fretboard overlay ink. Painted into the shared fretboard SVG, which lives
// OUTSIDE this pedal's card — a kit token would resolve against the page instead
// of against this pedal and the chord would come out unpainted.
const NECK = { root: '#9977ee', tone: '#5a4a8a', rootStroke: '#c0b4ff', toneStroke: '#8a7cc0' };

// ── Beat presets ─────────────────────────────────────────────────────
// Sixteen steps is one bar; a preset written as thirty-two steps is two bars and
// stretches the pattern to fit. core/genres.js names these as its grooves.
const BEAT_PRESETS = {
  'Rock':    { kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] },
  'Pop':     { kick: [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
  'Funk':    { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,0,1], snare: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0] },
  'Hip Hop': { kick: [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] },
  'Jazz':    { ride: [1,0,1,0,0,1,1,0,1,0,1,0,0,1,1,0], kick: [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0], hatClosed: [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0] },
  'Latin':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], tom2: [0,0,0,0,1,0,0,1,0,0,0,1,0,0,1,0] },
  'EDM':     { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1] },
  'Reggae':  { kick: [0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], ride: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] },
  'Blues':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], ride: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], hatClosed: [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1] },
  // Tom-led and loose, with the backbeat left half-open — psychedelia's drummer is
  // playing the ROOM, not the click. None of the nine above gave that.
  'Psych':   { kick: [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], tom2: [0,0,1,0,0,0,0,1,1,0,1,0,0,0,1,1], ride: [1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1] },
  // The whole kit in two bars: a crash on the one, a rock beat, and a fill down
  // the toms (high → mid → floor) that falls straight back into the crash.
  'Rock Fill': {
    crash1:    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    kick:      [1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,  1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    snare:     [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,  0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0],
    hatClosed: [0,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,  1,0,1,0,1,0,1,0,1,0,1,0,0,0,0,0],
    tom1:      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0],
    tom2:      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    floor:     [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  },
  // The floor tom on a 3-3-2 — the groove under half of film-score drumming.
  'Toms':    { floor: [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], tom2: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], tom1: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], hatClosed: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0] },
};

// A saved grid from before the kit grew — or a preset — fitted to this pattern:
// a retired row lands on the piece that replaced it, a short row is repeated
// out to the length (a one-bar beat stretched to four bars IS that beat four
// times), and a long one keeps its first bars.
function fitRow(row, len) {
  const src = Array.isArray(row) && row.length ? row : [0];
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = src[i % src.length] ? 1 : 0;
  return out;
}
function normaliseGrid(saved, len) {
  const g = { ...(saved || {}) };
  Object.entries(LEGACY_KEYS).forEach(([old, now]) => {
    if (!g[old]) return;
    if (!g[now] || !g[now].some(Boolean)) g[now] = g[old];
    delete g[old];
  });
  const out = {};
  DRUM_PIECES.forEach(pc => { out[pc.key] = g[pc.key] ? fitRow(g[pc.key], len) : new Array(len).fill(0); });
  return out;
}

// ── WAV buffer helper ────────────────────────────────────────────────
function bufferToWaveBlob(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numOfChan * 2 + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);
  function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  let offset = 0;
  writeString(offset, 'RIFF'); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString(offset, 'WAVE'); offset += 4;
  writeString(offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numOfChan * 2, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString(offset, 'data'); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i] || 0));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample | 0, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// The count a drummer says: 1 e & a 2 e & a … — one syllable per column header,
// and the whole name ("2&") when a step is named on its own.
const countOf = i => i % 4 === 0 ? String(i / 4 + 1) : ['', 'e', '&', 'a'][i % 4];
const stepName = i => { const j = i % STEPS; return `${Math.floor(j / 4) + 1}${['', 'e', '&', 'a'][j % 4]}`; };

// ── Main builder ─────────────────────────────────────────────────────
export function buildBeatMakerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  // Backing-track state: a genre carries its own groove, mode, tempo and chords.
  // BEATS ONLY plays the kit alone; FULL BACKING adds the chord loop over it, so
  // one pedal covers "give me a beat" and "give me something to play over".
  if (s.bmRoot === undefined) s.bmRoot = 'A';
  if (s.bmGenre === undefined) s.bmGenre = '';
  if (s.bmFull === undefined) s.bmFull = false;
  // Drums are their own switch, so the pedal covers three real uses: time only
  // (beats), a full backing track, and changes-without-drums — which is what you
  // want when you're listening to voice leading rather than playing in the pocket.
  // A separate flag rather than a tri-state enum: saved boards already hold
  // bmFull, and this keeps every one of them valid with no migration.
  if (s.bmDrums === undefined) s.bmDrums = true;

  let bars = BAR_CHOICES.includes(s.bmBars) ? s.bmBars : 1;
  let grid = normaliseGrid(s.bmGrid, STEPS * bars);
  let presetName = s.bmPreset || '';
  let curStep = -1;
  let viewBar = 0;                       // which bar the grid is showing
  let lastClockConfig = metroClock.getConfigSignature();

  // A rebuild replaces this closure but not the card, so every listener checks it
  // still belongs to the CURRENT build — a stale one would otherwise answer the
  // clock with an old grid.
  const build = {};
  p._bmBuild = build;
  const alive = () => p._bmBuild === build && !!document.getElementById(`body-${p.id}`);

  // A rebuild stops the beat, as it always has.
  if (p._bmPulse) p._bmPulse.stop();
  closeRun();
  p._bmPlaying = false;
  (p._bmOff || []).forEach(off => off());
  p._bmOff = [];
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._bmPlaying) stopBeat(); });

  // ── Undo ──
  // Live recording is messy by nature — a take you don't like has to be one
  // press from gone. The history rides on the card, so a rebuild keeps it.
  const undo = p._bmUndo || (p._bmUndo = []);
  const snapshot = () => ({ grid: JSON.parse(JSON.stringify(grid)), bars, preset: presetName });
  function pushUndo() { undo.push(snapshot()); if (undo.length > 40) undo.shift(); }
  function doUndo() {
    const u = undo.pop();
    if (!u) return false;
    bars = u.bars; grid = normaliseGrid(u.grid, STEPS * bars); presetName = u.preset;
    viewBar = Math.min(viewBar, bars - 1);
    takeOpen = false;
    saveGrid(); render(); changed();
    return true;
  }
  let takeOpen = false;      // one recording pass = one undo step, not one per hit

  // Anything that changes the beat says so: the kit redraws what it shows, and
  // ↶ Undo wakes up without waiting for a full render.
  function changed() {
    const u = el.querySelector('.bm-undo');
    if (u) { u.disabled = !undo.length; u.style.opacity = undo.length ? '' : '.4'; }
    drumBus.emit('state', { id: p.id });
  }

  // ── Load a preset ──
  function loadPreset(name) {
    const pr = BEAT_PRESETS[name];
    if (!pr) return;
    pushUndo();
    const len = Math.max(...Object.values(pr).map(r => r.length));
    const need = Math.ceil(len / STEPS);
    if (need > bars) bars = BAR_CHOICES.find(b => b >= need) || 4;
    DRUM_PIECES.forEach(pc => { grid[pc.key] = pr[pc.key] ? fitRow(pr[pc.key], STEPS * bars) : new Array(STEPS * bars).fill(0); });
    presetName = name;
    if ((s.bmTrackBars || 1) < bars) s.bmTrackBars = bars;
    saveGrid();
  }

  // ── Chords (FULL BACKING) ──
  // ONE clock. The chords hang off the drum sequencer's own 16th tick rather than
  // running a second timer, so they cannot drift against the kit no matter what
  // the tempo does. The progression is flattened to one entry PER BAR, which is
  // what makes "bar 3 of 12" answerable — and being able to answer that is how
  // you get back in after a mistake.
  let chordBars = [];     // one chord object per bar of the progression
  let compBar = 0;        // which bar of the progression we are in
  function buildChordBars() {
    chordBars = [];
    if (!s.bmGenre) return;
    genreChords(s.bmGenre, s.bmRoot).forEach(c => {
      for (let b = 0; b < (c.bars || 1); b++) chordBars.push({ ...c, barInChord: b, spanBars: c.bars || 1 });
    });
  }
  const nowChord  = () => chordBars[compBar % (chordBars.length || 1)] || null;
  const nextChord = () => {
    if (!chordBars.length) return null;
    for (let k = 1; k <= chordBars.length; k++) {
      const c = chordBars[(compBar + k) % chordBars.length];
      if (c.label !== nowChord()?.label) return c;
    }
    return null;
  };
  function lightChord() {
    const c = nowChord();
    if (!c || !s.bmFull) return;
    setChordHighlight(c.root, c.notes, c.label, null, NECK);
    updateOverlays();
  }
  // Switching to "+ chords" or changing the key mid-groove: the chart is rebuilt
  // in place and the groove keeps going.
  function startChords() {
    buildChordBars();
    if (chordBars.length) compBar %= chordBars.length;
    lightChord();
  }
  function stopChords() {
    compBar = 0;
    if (s.bmFull) { clearChordHighlight(); updateOverlays(); }
  }

  // ── The sequencer ─────────────────────────────────────────────────
  // The app's shared pulse (core/pulse.js) instead of a setInterval: it hands
  // over each sixteenth a moment BEFORE it sounds, with the exact audio-clock
  // time it will sound at. The drums are scheduled at that time, so the groove
  // cannot drift or stumble, and the kit can quantize a live hit against the
  // very times the beat was played at.
  let nextStep = 0;                   // the step the next scheduled tick plays
  const ticks = [];                   // recent scheduled ticks {gi, step, time}
  const skip = new Set();             // `${key}@${tick}` — recorded into a tick not yet scheduled
  function ensurePulse() {
    if (!p._bmPulse) p._bmPulse = createPulse({ bpm: metroClock.bpm || 120, subdiv: 4, onTick: t => p._bmOnTick && p._bmOnTick(t) });
    return p._bmPulse;
  }
  p._bmOnTick = handleTick;

  // Each run gets its own output gains. STOP ramps them shut, which silences
  // hits already queued in the lookahead — and a restart opens NEW ones, so
  // those queued hits can't sneak back in under the next run.
  function openRun() {
    closeRun();
    const ctx = audioCtx();
    const mk = dest => { const g = ctx.createGain(); g.gain.value = 1; g.connect(dest); return g; };
    // the drums join the kit's own bus (one glue compressor for kit and beat alike)
    p._bmRun = { drums: mk(drumOut(ctx)), click: mk(bus(ctx, 'click')) };
  }
  function closeRun() {
    const r = p._bmRun;
    if (!r) return;
    p._bmRun = null;
    try {
      const t = audioCtx().currentTime;
      [r.drums, r.click].forEach(g => {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.012);
      });
    } catch (e) {}
    setTimeout(() => [r.drums, r.click].forEach(g => { try { g.disconnect(); } catch (e) {} }), 700);
  }

  function handleTick(t) {
    // the card went without its ✕ (a load-out reset) — go quiet with it
    if (!alive()) { p._bmPulse?.stop(); closeRun(); p._bmPlaying = false; return; }
    if (!p._bmPlaying) { p._bmPulse?.stop(); return; }
    const total = STEPS * bars;
    const step = nextStep % total;
    nextStep = (step + 1) % total;
    ticks.push({ gi: t.index, step, time: t.time });
    if (ticks.length > 48) ticks.shift();

    const ctx = audioCtx(), run = p._bmRun;
    const hits = [];
    if (s.bmDrums !== false) DRUM_PIECES.forEach(pc => {
      if (!grid[pc.key][step]) return;
      hits.push(pc.key);
      // just recorded into this very tick — the player already heard their own hit
      if (skip.delete(`${pc.key}@${t.index}`)) return;
      playDrum(pc.key, { ctx, time: t.time, vel: stepVel(step), dest: run?.drums });
    });
    // Recording into an empty grid needs something to play against: a quiet
    // click on the beats while armed (🔔 on the kit turns it off).
    const inBar = step % STEPS;
    if (drumEdit.mode === 'rec' && drumEdit.click && inBar % 4 === 0 && run) {
      clickSound(ctx, t.time, { accent: inBar === 0, gain: inBar === 0 ? 0.34 : 0.2, dest: run.click });
    }
    t.visual(() => stepArrived(step, hits, t.index));
  }

  // Everything you SEE happens here, when the sound arrives rather than when it
  // was scheduled — the playhead, the chord chart, the lit pieces on the kit.
  function stepArrived(step, hits, gi) {
    if (!alive() || !p._bmPlaying) return;
    curStep = step;
    const inBar = step % STEPS;
    // a new bar moves the progression on and relights the neck
    if (inBar === 0 && gi > 0 && chordBars.length) {
      compBar = (compBar + 1) % chordBars.length;
      lightChord();
    }
    // the chord is struck on the genre's comp slots, on this same tick
    if (s.bmFull && chordBars.length) {
      const comp = compOf(s.bmGenre);
      if (comp.hits.includes(inBar)) {
        const c = nowChord();
        if (c) playChordNotes(c.notes, {
          dur: comp.accent.includes(inBar) ? 0.34 : 0.2,
          strum: 0.012,
          gain: comp.accent.includes(inBar) ? 0.15 : 0.095,
        });
      }
    }
    if (inBar % 4 === 0) {
      const beatIdx = Math.floor(inBar / 4) % Math.max(1, metroClock.ts || 4);
      metroClock.playing = true;
      metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
    }
    // while recording, the grid follows the playhead so every hit is seen landing
    if (drumEdit.mode === 'rec' && bars > 1) {
      const b = Math.floor(step / STEPS);
      if (b !== viewBar) { viewBar = b; renderGrid(); }
    }
    updateStepDisplay();
    drumBus.emit('seq', { id: p.id, step, keys: hits });
  }

  // ── Start / stop ──
  function startBeat() {
    metroClock.stopOthers(p.id);
    touchMaker(p.id);
    p._bmPlaying = true; curStep = -1; nextStep = 0;
    ticks.length = 0; skip.clear(); takeOpen = false;
    buildChordBars(); compBar = 0; lightChord();
    openRun();
    const pl = ensurePulse();
    pl.setBpm(metroClock.bpm || 120); pl.setSubdiv(4);
    metroClock.playing = true;
    pl.start();
    render();
    changed();
  }

  function stopBeat() {
    p._bmPlaying = false;
    p._bmPulse?.stop();
    closeRun();
    stopChords();
    curStep = -1; takeOpen = false; skip.clear();
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    if (alive()) render();
    changed();
    drumBus.emit('seq', { id: p.id, step: -1, keys: [] });
  }

  // ── Writing from the kit ──────────────────────────────────────────
  // ● REC: a hit lands on the sixteenth nearest to what the player was HEARING
  // (core/drums.js heardTime takes the output and input latency off). The
  // candidates are the ticks already scheduled plus the one about to be; a hit
  // that lands on that last one is marked so the loop doesn't play it a second
  // time on top of the player's own.
  function recordHit(key, heard, erase) {
    const k = LEGACY_KEYS[key] || key;
    if (!p._bmPlaying || !ticks.length || !grid[k]) return null;
    const stepDur = 60 / (p._bmPulse?.bpm || metroClock.bpm || 120) / 4;
    const last = ticks[ticks.length - 1];
    const cands = [...ticks, { gi: last.gi + 1, step: nextStep, time: last.time + stepDur, ahead: true }];
    let best = null, bestD = Infinity;
    cands.forEach(c => { const d = Math.abs(c.time - heard); if (d < bestD) { bestD = d; best = c; } });
    if (!best || bestD > stepDur) return null;
    if (!takeOpen) { pushUndo(); takeOpen = true; }
    if (erase) grid[k][best.step] = 0;
    else {
      grid[k][best.step] = 1;
      if (best.ahead) skip.add(`${k}@${best.gi}`);
    }
    presetName = '';
    saveGrid();
    paintCell(k, best.step);
    changed();
    return { step: best.step, bar: Math.floor(best.step / STEPS), inBar: best.step % STEPS, erase: !!erase };
  }

  // ✎ STEP: the piece is toggled on the step the cursor is on.
  function toggleStep(key, i) {
    const k = LEGACY_KEYS[key] || key;
    if (!grid[k] || i < 0 || i >= STEPS * bars) return null;
    pushUndo();
    grid[k][i] = grid[k][i] ? 0 : 1;
    presetName = '';
    saveGrid();
    viewBar = Math.floor(i / STEPS);
    renderGrid();
    changed();
    return !!grid[k][i];
  }
  function clearStep(i) {
    if (i < 0 || i >= STEPS * bars) return;
    if (!DRUM_PIECES.some(pc => grid[pc.key][i])) return;
    pushUndo();
    DRUM_PIECES.forEach(pc => { grid[pc.key][i] = 0; });
    presetName = '';
    saveGrid(); renderGrid(); changed();
  }

  function setBars(n) {
    if (n === bars || !BAR_CHOICES.includes(n)) return;
    pushUndo();
    DRUM_PIECES.forEach(pc => { grid[pc.key] = fitRow(grid[pc.key], STEPS * n); });
    bars = n;
    viewBar = Math.min(viewBar, bars - 1);
    if ((s.bmTrackBars || 1) < bars) s.bmTrackBars = bars;
    saveGrid();
    if (drumEdit.cursor >= STEPS * bars) setDrumEdit({ cursor: STEPS * bars - 1 });
    render();
    changed();
  }

  registerMaker(p.id, {
    id: p.id,
    alive,
    isPlaying: () => !!p._bmPlaying,
    start:  () => { if (!p._bmPlaying) startBeat(); },
    stop:   () => { if (p._bmPlaying) stopBeat(); },
    total:  () => STEPS * bars,
    bars:   () => bars,
    has:    (key, i) => !!grid[key]?.[i],
    keysAt: i => DRUM_PIECES.filter(pc => grid[pc.key][i]).map(pc => pc.key),
    recordHit, toggleStep, clearStep,
    undo: doUndo, canUndo: () => undo.length > 0,
    playhead: () => curStep,
    // while it runs, the beat's own tempo (an unlinked pedal keeps the one it started at)
    bpm: () => Math.round((p._bmPlaying && p._bmPulse?.bpm) || metroClock.bpm || 120),
  });
  p._teardown = () => {
    if (p._bmPlaying) stopBeat();
    unregisterMaker(p.id);
    (p._bmOff || []).forEach(off => off());
    p._bmOff = [];
    if (p._bmReq) { window.removeEventListener('resonote:beat', p._bmReq); p._bmReq = null; }
  };

  // ── Live step indicator (no full re-render) ──
  function updateStepDisplay() {
    const cells = el.querySelectorAll('.bm-cell');
    cells.forEach(c => {
      // the playhead is the pedal's own lamp, so it reads as "this one is sounding"
      // rather than as another drum lane
      const isCur = p._bmPlaying && parseInt(c.dataset.si) === curStep;
      c.style.boxShadow = isCur ? 'inset 0 0 0 2px var(--rk-hot)' : 'none';
    });
    el.querySelectorAll('.bm-dot').forEach(d => {
      d.style.background = p._bmPlaying && +d.dataset.si === curStep ? 'var(--rk-accent)' : 'var(--rk-panel2)';
    });
    el.querySelectorAll('.bm-bartab').forEach(b => {
      const lamp = b.querySelector('i');
      if (lamp) lamp.style.background = p._bmPlaying && Math.floor(curStep / STEPS) === +b.dataset.b ? 'var(--rk-hot)' : 'transparent';
    });
    // the chord chart follows the same tick — this is the part you read when you
    // have lost your place, so it updates every step, not every bar
    const nowEl = document.getElementById(`bm-now-${p.id}`);
    if (nowEl && chordBars.length) {
      const c = nowChord(), nx = nextChord();
      const beat = Math.floor((curStep % STEPS) / 4) + 1;
      // NOW is the readout, NEXT is the same accent held quiet — one colour, two
      // weights, so "where am I" and "what's coming" cannot be confused for each other
      nowEl.innerHTML = `<span style="color:var(--rk-ink-mute)">NOW</span>`
        + `<b style="color:var(--rk-accent);font-size:calc(14px*var(--ui))">${c ? c.label : '—'}</b>`
        + `<span style="color:var(--rk-ink-dim)">bar <b style="color:var(--rk-ink)">${compBar + 1}</b> of ${chordBars.length}`
        + `${p._bmPlaying ? ` · beat <b style="color:var(--rk-ink)">${beat}</b>` : ''}</span>`
        + `<span style="flex:1"></span>`
        + `<span style="color:var(--rk-ink-mute)">NEXT</span><b style="color:var(--rk-dim)">${nx ? nx.label : '↻'}</b>`;
    }
    el.querySelectorAll('.bm-bar').forEach(b => {
      // must stay identical to the resting values render() builds, or the lane
      // flips appearance on the first tick
      const on = p._bmPlaying && +b.dataset.b === compBar;
      b.style.borderColor = on ? 'var(--rk-line)' : 'var(--rk-edge-soft)';
      b.style.background  = on ? 'var(--rk-soft2)' : 'var(--rk-panel)';
      const sp = b.querySelector('span');
      if (sp) sp.style.color = on ? 'var(--rk-accent)' : 'var(--rk-ink-dim)';
    });
    el.querySelectorAll('.bm-comp').forEach(d => {
      const i = +d.dataset.i;
      const comp = compOf(s.bmGenre);
      const hit = comp.hits.includes(i), acc = comp.accent.includes(i);
      const cur = p._bmPlaying && i === curStep % STEPS;
      d.style.background = cur ? 'var(--rk-hot)' : acc ? 'var(--rk-accent)' : hit ? 'var(--rk-dim)' : 'var(--rk-panel)';
    });
  }

  function cellBg(pc, on, isCur) {
    // a painted cell keeps its lane's ink; an empty one is ordinary chrome
    return on ? `${pc.color}${isCur ? 'cc' : '88'}` : isCur ? 'var(--rk-soft)' : 'var(--rk-panel2)';
  }
  function paintCell(key, i) {
    const c = el.querySelector(`.bm-cell[data-rk="${key}"][data-si="${i}"]`);
    if (!c) return;
    c.style.background = cellBg(PIECE[key], grid[key][i], p._bmPlaying && i === curStep);
    // a fresh hit flashes so you SEE it land
    c.animate?.([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], { duration: 260, easing: 'ease-out' });
  }

  // ── Render beat to offline context → WAV blob ──
  async function uploadBeatAsTrack() {
    try {
      const trackBars = Math.max(1, parseInt(s.bmTrackBars || bars) || 1);
      const bpm = metroClock.bpm || 120;
      const secPerBeat = 60 / bpm;
      const stepDur    = secPerBeat / 4;
      const barDur     = stepDur * STEPS;
      const totalDur   = barDur * trackBars;
      const tail       = 2.5;                 // room for a crash to ring out
      const sampleRate = 44100;
      const offline = new OfflineAudioContext(2, Math.ceil((totalDur + tail) * sampleRate), sampleRate);
      const dest = drumOut(offline);

      for (let b = 0; b < trackBars; b++) {
        const src = (b % bars) * STEPS;       // the pattern repeats to fill the track
        DRUM_PIECES.forEach(pc => {
          for (let i = 0; i < STEPS; i++) {
            if (grid[pc.key][src + i]) playDrum(pc.key, { ctx: offline, time: b * barDur + i * stepDur, vel: stepVel(i), dest });
          }
        });
      }

      const rendered = await offline.startRendering();
      const blob = bufferToWaveBlob(rendered);
      const url  = URL.createObjectURL(blob);

      // Dispatch to studio module if available (studio-mode.js listens for this)
      const event = new CustomEvent('resonote:beattrack', {
        detail: {
          url, blob,
          name: (presetName || 'Custom Beat') + ' ' + trackBars + ' bar' + (trackBars > 1 ? 's' : ''),
          duration: totalDur, bars: trackBars
        }
      });
      window.dispatchEvent(event);
      flashMsg('Beat rendered (' + trackBars + ' bar' + (trackBars > 1 ? 's' : '') + ') — sent to Studio', 'var(--rk-accent)');
    } catch (err) {
      console.error(err);
      flashMsg('Could not render beat: ' + err.message, 'var(--rk-bad)');
    }
  }

  // ── REAPER Bridge: export the grid as a .mid file ───────────────────
  function exportBeatMidi() {
    const trackBars = Math.max(1, parseInt(s.bmTrackBars || bars) || 1);
    const bpm = metroClock.bpm || 120;
    const map = DRUM_MIDI_MAPS[s.bmMidiMap] || DRUM_MIDI_MAPS.GM;
    const stepTicks = PPQ / 4;                 // 16 steps = one 4/4 bar of 16ths
    const notes = [];
    for (let b = 0; b < trackBars; b++) {
      const src = (b % bars) * STEPS;
      DRUM_PIECES.forEach(pc => {
        for (let i = 0; i < STEPS; i++) {
          if (!grid[pc.key][src + i] || map[pc.key] == null) continue;
          notes.push({
            tick: (b * STEPS + i) * stepTicks,
            note: map[pc.key],
            vel: Math.round(110 * stepVel(i)),   // the same accents you hear
            dur: stepTicks / 2,
          });
        }
      });
    }
    if (!notes.length) return flashMsg('Nothing to export — paint some steps first', 'var(--rk-bad)');
    const bytes = encodeMidi({
      bpm, timeSig: [4, 4],
      trackName: `Resonote beat ${presetName || 'custom'}`,
      notes, endTick: trackBars * STEPS * stepTicks,
    });
    downloadMidi(bytes, midiFilename(`beat-${presetName || 'custom'}-${bpm}bpm`));
    flashMsg(`MIDI exported (${trackBars} bar${trackBars > 1 ? 's' : ''} @ ${bpm} BPM, ${s.bmMidiMap || 'GM'} map) — run Resonote Import in REAPER`, 'var(--rk-accent)');
  }

  function flashMsg(text, color) {
    // toasts hang off the pedal BODY, outside the .rk wrapper, so they can only use
    // the two tokens that live further up: --rk-accent (the card) and --rk-bad (:root)
    const msg = document.createElement('div');
    msg.className = 'mono';
    msg.textContent = text;
    msg.style.cssText = `color:${color};font-size:calc(8px*var(--ui));text-align:center;margin-top:4px`;
    el.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  }

  // One active style for every toggle in this pedal. The genre row used to be amber
  // while the mode row beside it was violet, which is how one pedal ends up looking
  // like two.
  const ON = 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)';
  const BTN = 'min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 5px';

  // ── The grid (its own container, so following the playhead or moving the
  //    step cursor redraws sixteen columns, not the whole pedal) ──
  function gridHTML() {
    if (drumEdit.mode === 'step') viewBar = Math.min(bars - 1, Math.floor(drumEdit.cursor / STEPS));
    viewBar = Math.max(0, Math.min(bars - 1, viewBar));
    const base = viewBar * STEPS;
    const cursorOn = drumEdit.mode === 'step';
    let h = '';

    // Bar tabs — only when there is more than one bar. The lamp says which bar is
    // sounding, so a four-bar beat never leaves you guessing where the loop is.
    if (bars > 1) {
      h += `<div style="display:flex;gap:2px;align-items:center">
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));width:40px">BAR</span>`;
      for (let b = 0; b < bars; b++) {
        h += `<button class="chord-btn bm-bartab" data-b="${b}" style="${BTN};flex:1;display:flex;align-items:center;justify-content:center;gap:4px;${b === viewBar ? ON : ''}">
          <i style="width:6px;height:6px;border-radius:50%;background:${p._bmPlaying && Math.floor(curStep / STEPS) === b ? 'var(--rk-hot)' : 'transparent'}"></i>${b + 1}</button>`;
      }
      h += `</div>`;
    }

    // The count, 1 e & a — tap a column to put the step cursor on it
    h += `<div style="display:flex;gap:1px;align-items:flex-end;padding:0 4px">
      <span style="min-width:40px"></span>`;
    for (let i = 0; i < STEPS; i++) {
      const si = base + i, cur = cursorOn && si === drumEdit.cursor;
      h += `<div class="bm-count mono" data-si="${si}" title="Edit step ${countOf(i)} with the kit" style="flex:1;min-width:14px;text-align:center;cursor:pointer;font-size:calc(${i % 4 ? 7.5 : 9}px*var(--ui));font-weight:${i % 4 ? 500 : 800};color:${cur ? 'var(--rk-accent)' : i % 4 ? 'var(--rk-ink-faint)' : 'var(--rk-ink-dim)'}">${countOf(i)}</div>`;
    }
    h += `</div>`;
    h += `<div style="display:flex;gap:1px;padding:0 4px"><span style="min-width:40px"></span>`;
    for (let i = 0; i < STEPS; i++) {
      h += `<div class="bm-dot" data-si="${base + i}" style="flex:1;height:3px;border-radius:1px;background:${p._bmPlaying && base + i === curStep ? 'var(--rk-accent)' : 'var(--rk-panel2)'}"></div>`;
    }
    h += `</div>`;

    h += `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:4px;overflow-x:auto">`;
    DRUM_PIECES.forEach(pc => {
      h += `<div style="display:flex;gap:1px;margin-bottom:1px;align-items:center">`;
      // the lane name is also its preview button — tap it to hear the piece
      h += `<button class="mono bm-lane" data-tk="${pc.key}" title="${pc.name} — tap to hear it" style="all:unset;box-sizing:border-box;cursor:pointer;color:${pc.color};font-size:calc(9.5px*var(--ui));font-weight:700;min-width:40px;text-align:right;padding-right:4px;white-space:nowrap">${pc.label}</button>`;
      for (let i = 0; i < STEPS; i++) {
        const si = base + i;
        const on = grid[pc.key][si];
        const isCur = p._bmPlaying && si === curStep;
        const border = i % 4 === 0 ? 'border-left:1.5px solid var(--rk-edge-soft);' : '';
        const shadow = isCur ? 'box-shadow:inset 0 0 0 2px var(--rk-hot);' : '';
        // the step cursor is an outline, so it can sit on top of the playhead
        const cursor = cursorOn && si === drumEdit.cursor ? 'outline:1.5px solid var(--rk-accent);outline-offset:-1px;' : '';
        h += `<div class="bm-cell" data-rk="${pc.key}" data-si="${si}" style="flex:1;min-width:14px;height:15px;background:${cellBg(pc, on, isCur)};border-radius:2px;cursor:pointer;transition:background .08s;${border}${shadow}${cursor}"></div>`;
      }
      h += `</div>`;
    });
    h += `</div>`;
    return h;
  }

  function wireGrid() {
    const g = document.getElementById(`bm-grid-${p.id}`);
    if (!g) return;
    // Grid cells — toggle + instant preview
    g.querySelectorAll('.bm-cell').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      touchMaker(p.id);
      const rk = c.dataset.rk, si = parseInt(c.dataset.si);
      pushUndo();
      grid[rk][si] = grid[rk][si] ? 0 : 1;
      presetName = '';
      if (grid[rk][si]) {
        playDrum(rk);
        drumBus.emit('seq', { id: p.id, step: null, keys: [rk] });
      }
      saveGrid();
      if (drumEdit.mode === 'step' && drumEdit.cursor !== si) setDrumEdit({ cursor: si });   // redraws via 'edit'
      else renderGrid();
      changed();
    }));
    g.querySelectorAll('.bm-lane').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      playDrum(b.dataset.tk);
      drumBus.emit('seq', { id: p.id, step: null, keys: [b.dataset.tk] });
    }));
    g.querySelectorAll('.bm-count').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      touchMaker(p.id);
      setDrumEdit({ mode: 'step', cursor: +c.dataset.si });
    }));
    g.querySelectorAll('.bm-bartab').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const nb = +b.dataset.b;
      // in step mode the view IS the cursor's bar, so the cursor moves with it
      if (drumEdit.mode === 'step') setDrumEdit({ cursor: nb * STEPS + (drumEdit.cursor % STEPS) });
      else { viewBar = nb; renderGrid(); }
    }));
  }

  function renderGrid() {
    const g = document.getElementById(`bm-grid-${p.id}`);
    if (!g) return render();
    g.innerHTML = gridHTML();
    wireGrid();
  }

  // ── Full render ──────────────────────────────────────────────────────
  function render() {
    if (!alive()) return;
    const useBpm = metroClock.bpm || 120;

    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:5px">`;

    // ── BACKING: genre → groove + mode + chords, in your key ──
    const g = GENRES[s.bmGenre];
    const chords = s.bmGenre ? genreChords(s.bmGenre, s.bmRoot) : [];
    h += `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge);border-radius:8px;padding:6px 7px">`;
    h += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px;flex:1">BACKING TRACK</span>
        <button id="bm-mode-beats-${p.id}" class="chord-btn" title="Drums only — time to play against" style="${BTN};${!s.bmFull ? ON : ''}">beats</button>
        <button id="bm-mode-full-${p.id}" class="chord-btn" title="Drums and chords — a full backing track" style="${BTN};${s.bmFull && s.bmDrums !== false ? ON : ''}">+ chords</button>
        <button id="bm-mode-chords-${p.id}" class="chord-btn" title="Chords only — the changes with no drums" style="${BTN};${s.bmFull && s.bmDrums === false ? ON : ''}">chords</button>
      </div>`;
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:4px">`;
    h += `<button class="chord-btn bm-genre" data-g="" style="${BTN};${!s.bmGenre ? ON : ''}">none</button>`;
    GENRE_NAMES.forEach(n => {
      h += `<button class="chord-btn bm-genre" data-g="${n}" style="${BTN};${s.bmGenre === n ? ON : ''}">${n}</button>`;
    });
    h += `</div>`;
    if (g) {
      h += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">KEY</span>
          <select id="bm-root-${p.id}" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:4px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:2px">
            ${NOTES.map(n => `<option ${n === s.bmRoot ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <span class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${g.mode} · ${g.bpm} BPM</span>
          <span class="mono" style="color:var(--rk-dim);font-size:calc(10px*var(--ui));flex:1;text-align:right">${chords.map(c => c.label + (c.bars > 1 ? `·${c.bars}` : '')).join('  ')}</span>
        </div>
        <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));line-height:1.5;margin-top:4px">${g.why}</div>`;
      // ── where you are, so you can get back in ──
      // A chord chart you can only hear is useless the moment you lose your place.
      // NOW / bar n of m / NEXT answers "where am I" at a glance, and the lane
      // below draws the whole loop plus the comp hits, so the strum is something
      // you can see coming instead of guess at.
      if (s.bmFull) {
        const comp = compOf(s.bmGenre);
        const cbars = [];
        chords.forEach(c => { for (let b = 0; b < (c.bars || 1); b++) cbars.push(c.label); });
        h += `<div id="bm-now-${p.id}" class="mono" style="display:flex;align-items:baseline;gap:6px;margin-top:6px;font-size:calc(10px*var(--ui));color:var(--rk-ink-mute)"></div>`;
        h += `<div id="bm-lane-${p.id}" style="display:flex;gap:2px;margin-top:3px">
            ${cbars.map((lab, i) => `<div class="bm-bar" data-b="${i}" style="flex:1;min-width:0;text-align:center;padding:3px 1px;border-radius:4px;border:1px solid var(--rk-edge-soft);background:var(--rk-panel);overflow:hidden">
                 <span class="mono" style="font-size:calc(10px*var(--ui));color:var(--rk-ink-dim)">${lab}</span></div>`).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:3px;margin-top:4px">
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));width:32px">STRUM</span>
            <div style="flex:1;display:flex;gap:1px">
              ${Array.from({ length: 16 }, (_, i) => {
                const hit = comp.hits.includes(i), acc = comp.accent.includes(i);
                return `<div class="bm-comp" data-i="${i}" style="flex:1;height:9px;border-radius:2px;background:${acc ? 'var(--rk-accent)' : hit ? 'var(--rk-dim)' : 'var(--rk-panel)'}"></div>`;
              }).join('')}
            </div>
          </div>
          <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));line-height:1.45;margin-top:3px">${comp.feel}</div>`;
      }
    }
    h += `</div>`;

    // Preset buttons
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    Object.keys(BEAT_PRESETS).forEach(name => {
      h += `<button class="chord-btn bm-preset" data-bp="${name}" style="${BTN};${presetName === name ? ON : ''}">${name}</button>`;
    });
    h += `</div>`;

    // ── THE KIT: how the 🥁 Drums instrument writes into this beat ──
    // The same three modes the kit's own bar shows, because you may be looking at
    // either one when you decide to record.
    const mode = drumEdit.mode;
    const modeBtn = (m, label, title) => `<button class="chord-btn bm-emode" data-m="${m}" title="${title}" style="${BTN};${mode === m ? ON : ''}">${label}</button>`;
    h += `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap">
      <button class="chord-btn bm-kit" title="Show the drum kit — play it, record into this beat, or edit it step by step" style="${BTN}">🥁 Kit</button>
      ${modeBtn('jam', 'Jam', 'The kit just plays — nothing is written')}
      ${modeBtn('rec', `<span style="color:${mode === 'rec' ? 'var(--rk-stop)' : 'inherit'}">●</span> Rec`, 'Record: hits on the kit land on the nearest 16th while the beat loops')}
      ${modeBtn('step', '✎ Step', 'Step edit: pick a step, then hit pieces on the kit to toggle them there')}
      <button class="chord-btn bm-undo" title="Undo the last change (a whole recording pass is one step)" style="${BTN};${undo.length ? '' : 'opacity:.4'}" ${undo.length ? '' : 'disabled'}>↶ Undo</button>
      <span style="flex:1"></span>
      <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">BARS</span>
      ${BAR_CHOICES.map(b => `<button class="chord-btn bm-bars" data-b="${b}" title="Pattern length: ${b} bar${b > 1 ? 's' : ''}" style="${BTN};min-width:calc(24px*var(--ui));${bars === b ? ON : ''}">${b}</button>`).join('')}
    </div>`;
    const hint = mode === 'rec'
      ? (p._bmPlaying ? 'Recording — play the kit and each hit lands on the nearest 16th. Every pass adds to the beat; Shift-hit erases.'
                      : 'Armed — press ▶ PLAY below (or ▶ on the kit), then play along. Hits snap to the nearest 16th.')
      : mode === 'step'
      ? `Editing step ${stepName(drumEdit.cursor)}${bars > 1 ? ` of bar ${Math.floor(drumEdit.cursor / STEPS) + 1}` : ''} — hit pieces on the kit to toggle them here. Tap the count above the grid to move.`
      : '';
    if (hint) h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));line-height:1.45">${hint}</div>`;

    // The grid lives in its own box — see renderGrid
    h += `<div id="bm-grid-${p.id}" style="display:flex;flex-direction:column;gap:3px">${gridHTML()}</div>`;

    // Tempo display + Clear
    h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">TEMPO</span>`;
    h += `<span id="bm-bpm-${p.id}" class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:700">${useBpm}</span>`;
    h += `<button class="chord-btn bm-clear" style="${BTN};margin-left:auto;color:var(--rk-bad);border-color:var(--rk-edge-soft)">Clear</button>`;
    h += `</div>`;

    // Track length selector
    const trackBars = s.bmTrackBars || bars;
    h += `<div style="display:flex;gap:6px;align-items:center">`;
    h += `<label class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));white-space:nowrap">TRACK LEN</label>`;
    h += `<select class="bm-track-bars" style="flex:1;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:6px;padding:5px 6px;font-size:calc(10px*var(--ui))">`;
    [1, 2, 4, 8].forEach(v => { h += `<option value="${v}" ${trackBars === v ? 'selected' : ''}>${v} bar${v > 1 ? 's' : ''}</option>`; });
    h += `</select></div>`;

    // Upload to studio
    h += `<button class="chord-btn bm-upload-track" style="${BTN};width:100%;padding:6px 8px;color:var(--rk-accent);border-color:var(--rk-line);background:var(--rk-soft)">⬆ Upload Beat as Track</button>`;

    // REAPER Bridge: MIDI export (drum map + button)
    h += `<div style="display:flex;gap:4px;align-items:stretch">`;
    h += `<select class="bm-midi-map" title="Drum note map for the export" style="width:74px;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:6px;padding:4px;font-size:calc(10px*var(--ui))">`;
    Object.keys(DRUM_MIDI_MAPS).forEach(m => { h += `<option value="${m}" ${(s.bmMidiMap || 'GM') === m ? 'selected' : ''}>${m}</option>`; });
    h += `</select>`;
    h += `<button class="chord-btn bm-export-midi" style="${BTN};flex:1;padding:6px 8px;color:var(--rk-accent);border-color:var(--rk-line);background:var(--rk-soft)">⇄ Export MIDI for REAPER</button>`;
    h += `</div>`;

    // Play / Stop. The moment this reads STOP it is the halt control, and every
    // halt in the app wears the same red — you reach for it mid-groove with both
    // hands on the guitar, so it has to be found without being read. That is a
    // different job from the playhead, the lit cells and the strum lane, which
    // stay on --rk-hot: those only report that the pedal is running, and running
    // is not stopping.
    const pc = p._bmPlaying ? 'var(--rk-stop-soft)' : 'var(--rk-soft)';
    const pb = p._bmPlaying ? 'var(--rk-stop-edge)' : 'var(--rk-line)';
    const pt = p._bmPlaying ? 'var(--rk-stop)'      : 'var(--rk-accent)';
    h += `<button class="bm-play mono" style="min-height:calc(28px*var(--ui));background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${p._bmPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;

    el.innerHTML = h;
    wireGrid();

    // ── Wire events ──────────────────────────────────────────────────
    // Touching the pedal makes it the beat the kit writes into.
    el.onpointerdown = () => touchMaker(p.id);

    // Presets
    el.querySelectorAll('.bm-preset').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      loadPreset(b.dataset.bp);
      if (p._bmPlaying) { stopBeat(); startBeat(); } else render();
      changed();
    }));

    // ── Backing-track controls ──
    // Picking a genre IS the preset: it loads that groove, moves the tempo, and
    // sets the chords. One choice, three things, which is what a genre is.
    el.querySelectorAll('.bm-genre').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const name = b.dataset.g;
      s.bmGenre = name || '';
      if (name) {
        loadPreset(GENRES[name].groove);
        metroClock.set(GENRES[name].bpm, metroClock.ts);
      }
      if (p._bmPlaying) { stopBeat(); startBeat(); } else render();
      changed();
    }));
    [['bm-mode-beats-', false, true], ['bm-mode-full-', true, true], ['bm-mode-chords-', true, false]]
      .forEach(([id, full, drums]) => {
      document.getElementById(id + p.id)?.addEventListener('click', e => {
        e.stopPropagation();
        s.bmFull = full; s.bmDrums = drums;
        if (p._bmPlaying) { if (full) startChords(); else stopChords(); }
        render();
      });
    });
    document.getElementById(`bm-root-${p.id}`)?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmRoot = e.target.value;
      if (p._bmPlaying && s.bmFull) startChords();
      render();
    });

    // The kit bar
    el.querySelector('.bm-kit')?.addEventListener('click', e => {
      e.stopPropagation();
      touchMaker(p.id);
      // the instrument bar's own button, so switching here is exactly switching there
      document.querySelector('#instrument-bar .inst-btn[data-inst="drums"]')?.click();
    });
    el.querySelectorAll('.bm-emode').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      touchMaker(p.id);
      setDrumEdit({ mode: b.dataset.m });
    }));
    el.querySelector('.bm-undo')?.addEventListener('click', e => { e.stopPropagation(); doUndo(); });
    el.querySelectorAll('.bm-bars').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      setBars(+b.dataset.b);
    }));

    // Clear
    el.querySelector('.bm-clear')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!DRUM_PIECES.some(pc => grid[pc.key].some(Boolean))) return;
      pushUndo();
      DRUM_PIECES.forEach(pc => { grid[pc.key] = new Array(STEPS * bars).fill(0); });
      presetName = '';
      saveGrid();
      render();
      changed();
    });

    // Track length
    el.querySelector('.bm-track-bars')?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmTrackBars = parseInt(e.target.value) || 1;
    });

    // Upload to studio
    el.querySelector('.bm-upload-track')?.addEventListener('click', async e => {
      e.stopPropagation();
      await uploadBeatAsTrack();
    });

    // REAPER Bridge: MIDI export
    el.querySelector('.bm-midi-map')?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmMidiMap = e.target.value;
    });
    el.querySelector('.bm-export-midi')?.addEventListener('click', e => {
      e.stopPropagation();
      exportBeatMidi();
    });

    // Play / Stop
    el.querySelector('.bm-play')?.addEventListener('click', e => {
      e.stopPropagation();
      if (p._bmPlaying) stopBeat(); else startBeat();
    });
  }

  // ── Persist grid to settings ──
  function saveGrid() {
    s.bmGrid    = grid;
    s.bmBars    = bars;
    s.bmPreset  = presetName;
    s.bmTrackBars = s.bmTrackBars || bars;
  }

  // ── Other pedals can ask for a groove ────────────────────────────────
  // Same contract as the ⏱️ Metronome's `resonote:metro`: a pedal that needs a
  // backing beat asks for one instead of growing its own drum machine. The Write
  // It pedal uses this so a genre choice starts the matching groove here — one
  // kit, one sequencer, one place to improve it.
  if (p._bmReq) window.removeEventListener('resonote:beat', p._bmReq);
  p._bmReq = e => {
    if (!alive()) return;
    const d = e.detail || {};
    if (d.action === 'stop') { if (p._bmPlaying) stopBeat(); return; }
    if (d.action === 'toggle') { p._bmPlaying ? stopBeat() : startBeat(); return; }
    if (d.action !== 'start') return;
    // a caller can ask for a whole genre (groove + key + chords), not just a groove
    if (d.genre && GENRES[d.genre]) {
      s.bmGenre = d.genre;
      if (d.root) s.bmRoot = d.root;
      if (d.full !== undefined) s.bmFull = !!d.full;
      loadPreset(GENRES[d.genre].groove);
    } else if (d.groove && BEAT_PRESETS[d.groove]) loadPreset(d.groove);
    if (p._bmPlaying) { stopBeat(); startBeat(); }   // adopt the new groove mid-flight
    else startBeat();                                 // startBeat renders once internally
  };
  window.addEventListener('resonote:beat', p._bmReq);

  // The kit changed mode or moved the step cursor — both show here.
  p._bmOff.push(drumBus.on('edit', () => {
    if (!alive()) return;
    takeOpen = false;
    render();
  }));

  // ── React to metroClock BPM changes ──
  // A linked tempo change retunes the running beat in place — the groove keeps
  // its place in the bar instead of jumping back to the one.
  metroClock.on(clock => {
    if (!alive()) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._bmPlaying) {
      p._bmPulse?.setBpm(metroClock.bpm || 120);
      const b = document.getElementById(`bm-bpm-${p.id}`);
      if (b) b.textContent = metroClock.bpm || 120;
      changed();
    } else render();
  });

  render();
  changed();
}
