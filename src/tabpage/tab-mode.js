// ─── TAB page — full-page tab reader (pro) ────────────────────────────────────
// Songsterr-style reading, Resonote-style: a proportional 6-line tab lane with a
// moving playhead, and the REAL fretboard stays on screen above it — every step
// lights the neck as it plays (playPlan does that for free). Reads everything the
// app knows: reference transcriptions, saved sketches, text songs, pasted ASCII.
import { NOTES } from '../core/music-theory.js';
import { customTuning, getNoteAtFret, currentInstrument, INSTRUMENTS } from '../core/tuning.js';
import { noteToMidi } from '../core/midi-writer.js';
import { setChordHighlight, setGhostHighlight, clearChordHighlight, clearGhostHighlight, chordHighlight, metroClock } from '../core/state.js';
import { setFretboardClickHandler } from '../main.js';
import { audio } from '../core/audio.js';
import { expectNotes } from '../core/listen.js';
import { decodeToMono } from '../core/audio-analysis.js';
import { playNote } from '../core/synth.js';
import { updateOverlays } from '../ui/fretboard.js';
import { masterTempoBlock, wireMasterTempo, tempoTerm } from '../ui/tempo-control.js';
import { playPlan } from '../curriculum/drill-runner.js';
import { pcColor } from '../core/colors.js';
import { REF_SKETCHES, songToSteps, loadSketchLib, loadTextSongs } from '../pedals/sketchpad.js';
import { SONG_LIBRARY } from '../pedals/song-directory.js';
import { parseAsciiTab } from '../pedals/tab.js';
import { read, write, KEYS } from '../core/store.js';

const ACC = '#e8b84a';
const ACC_INK = '#ffe0a0', ACC_WASH = 'rgba(232,184,74,.18)';   // the page's lit label + lit fill
const COL = { root: ACC, tone: ACC, rootStroke: '#ffd98a', toneStroke: '#ffd98a' };
const LINE_GAP = 15, PAD_TOP = 30, PAD_X = 14;
const ZOOMS = [22, 34, 50];          // px per beat
const STAFF_GAP = 8;                 // staff line to staff line = two letter names
const HALF = STAFF_GAP / 2;          // one letter name
const HEAD_H = 22;                   // § flags + bar numbers strip at the top of the svg
const WAVE_H = 58, PEAK_HOP = 256;   // reference-recording lane
const MIDI_ROW = 7;                  // px per semitone in the piano-roll lane

const T = {
  song: null,        // { name, steps, sections, about, tsig, bpm }
  loop: true, zoom: 1,
  playing: false, playIdx: null, stop: null,
  range: null,       // [from, to] loop range (section or custom) or null = whole
  sel: 0,
  pasting: false,
  click: true,       // 🔔 click track during playback
  countIn: true,     // ♩ one-bar count-in before playback
  staff: true,       // 🎼 notation staff above the tab lane
  neck: true,        // 🎸 the fretboard below — collapsible, it's the tallest thing here
  counting: false, countTimer: null,
  listen: false,     // 🎤 mode: advance only when the mic hears the step
  listening: false, heard: null,
  wave: null,        // { name, sr, duration, mn, mx } — the take you're transcribing
  waveShow: true, waveOff: 0, waveBusy: false, waveErr: '',
  grid: true,        // 🎹 piano-roll lane under the neck
  // ── ✎ EDIT: step-time entry, Sibelius-style ──────────────────────────────
  // The order that makes step entry feel right is DURATION FIRST, then pitch:
  // set the note value, play the notes in, commit, and the caret advances by that
  // much. All four views (staff, tab, roll, neck) are projections of ONE step
  // list, so an edit anywhere redraws everywhere without any syncing code.
  edit: false,
  caret: 0,          // the step being written
  dur: 1,            // pending note value in beats (4=𝅝 2=𝅗𝅥 1=♩ .5=♪ .25=𝅘𝅥𝅯)
  dotted: false,
  triplet: false,    // three in the time of two
  clip: null,        // copy/paste buffer: an array of steps
  lastGrip: null,    // the last chord pulled off the neck, so ⤓ can repeat it
};

// T.bpm IS the session tempo. There is no page-local copy to drift out of sync:
// read it and you read the master clock, write it and the ⏱️ Metronome pedal, the
// session bar and every tempo-linked pedal move with you.
Object.defineProperty(T, 'bpm', {
  get: () => metroClock.bpm,
  set: v => metroClock.set(v, T.song?.tsig || metroClock.ts),
});

const alive = () => { const el = document.getElementById('tab-mode'); return !!el && el.style.display !== 'none'; };
const posOf = (si, fret) => { const n = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret); return { si, fret, note: n.note, octave: n.octave }; };

// ── click track: the ⏱️ Metronome pedal's, not the page's ─────────────
// This page used to run a private setInterval + AudioContext click at its own
// tempo — a second metronome, drifting against the real one and improved
// separately. Now it asks: the pedal owns the click, the accents, the
// subdivisions and the sample-accurate scheduling, and `metroClock` is the one
// tempo both read. Pages stay lean cores; pedals are the extension mechanism.
const metroReq = (action) => window.dispatchEvent(new CustomEvent('resonote:metro', {
  detail: { action, bpm: T.bpm, ts: T.song?.tsig || 4 },
}));
// Delegation needs something to delegate TO — put the pedal on the board if the
// player hasn't got one, and bring it forward if it's buried.
const needMetronome = () => window.dispatchEvent(new CustomEvent('resonote:need-pedal', {
  detail: { type: 'metronome', reveal: true },
}));
const clickOn  = () => { if (T.click) metroReq('start'); };
const clickOff = () => metroReq('stop');

// ── tempo ────────────────────────────────────────────────────────────
// The readout, the nudges and the tempo vocabulary all come from the shared
// control now (src/ui/tempo-control.js). This page used to carry its own
// tempoTerm with different breakpoints, so 120 BPM read "Allegro" here and
// "Moderato" on the ⏱️ Metronome.
// Patch the tempo UI in place — a full render() would rebuild the lane and
// throw away the scroll position mid-practice.
// Every tempo change — from here, from the ⏱️ Metronome pedal, from any linked
// pedal — lands on metroClock, so the clock listener in initTabMode is the ONE
// place that reacts (repaint, rescale the waveform, re-arm playback). Writing the
// reaction here as well would run it twice for a change that came from this page.
function setBpm(v) {
  const b = Math.max(30, Math.min(280, Math.round(v || 0)));
  if (b) T.bpm = b;
}
// Re-arming playback: playPlan bakes each step's duration when the plan is BUILT,
// so a running plan keeps the tempo it started at no matter what the clock says.
let lastClockBpm = null, rearmTimer = null;
function onTempoChanged() {
  // the shared tempo block repaints itself off the master clock — all that is
  // left here is the page's own reaction to a new tempo
  const pct = Math.round((T.bpm / (T.origBpm || T.bpm)) * 100);
  document.querySelectorAll('.tabp-pct').forEach(el2 => {
    const on = +el2.dataset.p === pct;
    el2.style.background  = on ? 'rgba(232,184,74,.18)' : '#17130c';
    el2.style.borderColor = on ? ACC : '#332b1b';
    el2.style.color       = on ? '#ffe0a0' : '#a89468';
  });
  drawWave();          // the recording is measured in seconds — a new tempo rescales it
  if (T.bpm === lastClockBpm) return;
  lastClockBpm = T.bpm;
  if (!T.playing) return;
  // Debounced: a nudge or a slider release can land several changes in a row, and
  // each re-arm restarts the loop. The click is stopped and restarted with the song
  // so the two keep sharing a downbeat.
  clearTimeout(rearmTimer);
  rearmTimer = setTimeout(() => {
    if (!alive() || !T.playing) return;
    const wasCount = T.countIn;
    T.countIn = false;
    stopPlay();
    beginPlay();
    T.countIn = wasCount;
  }, 180);
}

// ── song sources ─────────────────────────────────────────────────────
function sources() {
  const out = [];
  REF_SKETCHES.forEach((e, i) => out.push({ group: 'TRANSCRIPTIONS', label: e.name, key: `ref:${i}` }));
  loadSketchLib().forEach((e, i) => out.push({ group: 'MY SKETCHES', label: e.name || 'Sketch', key: `sk:${i}` }));
  SONG_LIBRARY.forEach((e, i) => out.push({ group: 'REFERENCE SONGS', label: `${e.title} — ${e.artist}`, key: `song:${i}` }));
  loadTextSongs().forEach((e, i) => out.push({ group: 'MY TEXT SONGS', label: e.title, key: `txt:${i}` }));
  return out;
}
function loadSource(key) {
  const [kind, iRaw] = key.split(':');
  const i = +iRaw;
  let e;
  if (kind === 'ref') { e = REF_SKETCHES[i]; if (!e) return; setSong({ name: e.name, steps: e.steps, sections: e.sections || [], about: e.about || '', tsig: e.tsig || 4, bpm: e.bpm || 90 }); }
  else if (kind === 'sk') {
    // Entries saved before pieces had identities get one now, written back once —
    // that is what makes an older piece editable instead of only duplicable.
    const lib = readLib();
    e = lib[i]; if (!e) return;
    if (!e.id) { e.id = newLibId(); writeLib(lib); }
    setSong({ name: e.name || 'Sketch', libId: e.id, steps: e.steps || [], sections: e.sections || [], about: e.about || '', tsig: e.tsig || 4, bpm: e.bpm || 90 });
  }
  else if (kind === 'song') { e = SONG_LIBRARY[i]; if (!e) return; setSong({ name: e.title, steps: songToSteps(e.prog), sections: [], about: `${e.artist} · ${e.key} · one chord per bar`, tsig: 4, bpm: 90 }); }
  else if (kind === 'txt') { e = loadTextSongs()[i]; if (!e) return; setSong({ name: e.title, steps: songToSteps(e.prog), sections: [], about: e.artist || '', tsig: 4, bpm: 90 }); }
}
function setSong(song) {
  stopPlay();
  T.song = { ...song, steps: JSON.parse(JSON.stringify(song.steps)) };
  T.bpm = song.bpm || 90; T.origBpm = T.bpm;   // the chart's own tempo — % buttons key off it
  T.range = null; T.sel = 0; T.playIdx = null;
  render();
}

// ── ✎ edit model ─────────────────────────────────────────────────────
// Every edit mutates T.song.steps and calls redraw(). There is no per-view sync
// because there is nothing to sync: laneSvg (staff+tab) and midiSvg (roll) both
// read the same array, and the neck is lit from the caret's own notes.
const NOTE_VALUES = [
  { beats: 4,    glyph: '𝅝',  name: 'whole' },
  { beats: 2,    glyph: '𝅗𝅥',  name: 'half' },
  { beats: 1,    glyph: '♩',  name: 'quarter' },
  { beats: 0.5,  glyph: '♪',  name: 'eighth' },
  { beats: 0.25, glyph: '𝅘𝅥𝅯', name: '16th' },
];
// A triplet is three in the time of two, which in a beats-based model is simply
// two thirds of the value. It plays and lays out correctly today; what it does
// NOT get is a bracket on the staff — that is engraving, and engraving is the
// rabbit hole this page deliberately stays out of.
const pendingDur = () => +(T.dur * (T.dotted ? 1.5 : 1) * (T.triplet ? 2 / 3 : 1)).toFixed(4);

function blankSong(name = 'Untitled') {
  // libId null = "not in the library yet", so the first 💾 Keep creates an entry
  // and every one after that updates THAT entry instead of piling up copies.
  return { name, libId: null, steps: [{ notes: [], dur: 1 }], sections: [], about: '', tsig: 4, bpm: T.bpm || 90 };
}

// ── the saved-pieces library ──────────────────────────────────────────
// Read and write go through the store so the TAB page and the Sketchpad cannot
// disagree about the library's shape OR its size — the keep-last cap lives in
// core/store.js, once, and a cap hard-coded here would silently trim a library
// the ⬆ Import just grew. Entries get an id the first time they are touched —
// that is what makes "save" mean UPDATE rather than "add another copy".
const readLib  = () => { const v = read(KEYS.pieces, []); return Array.isArray(v) ? v : []; };
const writeLib = lib => write(KEYS.pieces, lib);
const newLibId = () => 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

function keepPiece() {
  if (!T.song) return;
  // drop a trailing empty beat so a saved piece does not end on a rest you only
  // created by locking the last note
  const steps = T.song.steps.filter((s2, i) => (s2.notes || []).length || i < T.song.steps.length - 1);
  if (!steps.some(s2 => (s2.notes || []).length)) return { ok: false, msg: 'nothing to save yet' };
  const lib = readLib();
  const entry = {
    id: T.song.libId || newLibId(),
    name: (T.song.name || '').trim() || 'Untitled',
    bpm: T.bpm, tsig: T.song.tsig || 4,
    about: T.song.about || 'Written on the TAB page.',
    sections: T.song.sections || [], steps,
  };
  const at = T.song.libId ? lib.findIndex(x => x.id === T.song.libId) : -1;
  if (at >= 0) lib[at] = entry; else lib.push(entry);       // update in place, or add once
  T.song.libId = entry.id;
  return { ok: writeLib(lib), msg: at >= 0 ? 'updated' : 'saved', fresh: at < 0 };
}

function deletePiece() {
  if (!T.song?.libId) return false;
  const lib = readLib().filter(x => x.id !== T.song.libId);
  writeLib(lib);
  T.song.libId = null;      // still open in front of you, just no longer in the library
  return true;
}
// The caret always has a step to write into — reaching the end creates one.
function caretStep() {
  if (!T.song) setSong(blankSong());
  const s = T.song.steps;
  if (!s.length) s.push({ notes: [], dur: pendingDur() });
  T.caret = Math.max(0, Math.min(T.caret, s.length - 1));
  return s[T.caret];
}
// Clicking a fret that is already in this beat removes it — the same gesture adds
// and un-adds, so a mis-clicked chord tone costs one click, not an undo.
function toggleNoteAtCaret(si, fret) {
  const st = caretStep();
  st.notes = st.notes || [];
  const at = st.notes.findIndex(n => n.si === si);
  if (at >= 0 && st.notes[at].fret === fret) st.notes.splice(at, 1);
  else if (at >= 0) st.notes[at] = { si, fret };     // one note per string
  else st.notes.push({ si, fret });
  st.dur = pendingDur();
  const p = posOf(si, fret);
  playNote(p.note, p.octave, { dur: 0.35, gain: 0.18 });
  redraw();
}
// Commit = lock this beat and move on, creating the next one at the end.
function commitBeat() {
  const st = caretStep();
  st.dur = pendingDur();
  if (T.caret >= T.song.steps.length - 1) T.song.steps.push({ notes: [], dur: pendingDur() });
  T.caret++;
  redraw();
}
function caretBack() {
  // stepping back off an empty tail tidies it away rather than leaving a rest
  const s = T.song.steps;
  if (T.caret === s.length - 1 && s.length > 1 && !(s[T.caret].notes || []).length) s.pop();
  T.caret = Math.max(0, T.caret - 1);
  redraw();
}
// Pure navigation, unlike ✓ Lock: it walks back to where you were without
// committing a duration or growing a beat off the end.
function caretFwd() {
  if (T.caret < T.song.steps.length - 1) { T.caret++; redraw(); }
}
function deleteAtCaret() {
  const s = T.song.steps;
  const st = s[T.caret];
  if (st && (st.notes || []).length) st.notes = [];      // first press clears the beat
  else if (s.length > 1) { s.splice(T.caret, 1); T.caret = Math.max(0, T.caret - 1); }
  redraw();
}
function setPendingDur(beats) {
  T.dur = beats;
  const st = T.song?.steps?.[T.caret];
  if (st) st.dur = pendingDur();     // retime the beat you are standing on
  redraw();
}
// Light the caret's own notes on the neck, so the instrument shows what you are
// building rather than what last played.
function showCaretOnNeck() {
  const st = T.song?.steps?.[T.caret];
  const ps = (st?.notes || []).map(n => posOf(n.si, n.fret));
  if (ps.length) setChordHighlight(null, ps.map(x => x.note), `beat ${T.caret + 1}`, ps, COL);
  else clearChordHighlight();
  // Where you are MOVING FROM, ghosted — the same affordance as the next-note
  // ghost in practice, pointed backwards. Writing a line is mostly deciding what
  // moves where, and you cannot judge the move if the last shape has vanished.
  // The nearest previous beat that actually sounded: skipping rests keeps the
  // reference on the last thing you can still hear in your head.
  let prev = null;
  for (let i = T.caret - 1; i >= 0; i--) {
    const n = T.song.steps[i]?.notes || [];
    if (n.length) { prev = n; break; }
  }
  if (prev) setGhostHighlight(prev.map(n => ({ si: n.si, fret: n.fret })),
    { stroke: 'rgba(160,150,200,.55)', fill: 'rgba(160,150,200,.09)' });
  else clearGhostHighlight();
  updateOverlays();
}

// ── copy / paste ──────────────────────────────────────────────────────
// The selection is the LOOP RANGE the page already has (⟦ start here / end here ⟧),
// so there is one idea of "this bit of the piece" rather than two competing ones —
// the range you loop to practise is the range you copy.
const clipRange = () => T.range ? [T.range[0], T.range[1]] : [T.caret, T.caret];
function copyRange(cut = false) {
  const [a, b] = clipRange();
  T.clip = JSON.parse(JSON.stringify(T.song.steps.slice(a, b + 1)));
  if (cut) {
    T.song.steps.splice(a, b - a + 1);
    if (!T.song.steps.length) T.song.steps.push({ notes: [], dur: pendingDur() });
    T.caret = Math.max(0, Math.min(a, T.song.steps.length - 1));
    T.range = null;
  }
  redraw();
}
function pasteAtCaret() {
  if (!T.clip?.length) return;
  T.song.steps.splice(T.caret, 0, ...JSON.parse(JSON.stringify(T.clip)));
  T.caret += T.clip.length;                    // land after what you just pasted
  redraw();
}

// ── take whatever is lit on the neck ──────────────────────────────────
// The 🎵 Chord Directory, the 🧪 Chord-Family Lab, the Voicing Lab and the Theory
// Path all already put a real grip on the fretboard. Rather than teach each of
// them to write into the score, write mode just READS the neck — so every pedal
// that can light a chord is a chord-entry tool for free, including ones not
// built yet.
const neckGrip = () => (chordHighlight.active ? (chordHighlight.positions || []) : [])
  .filter(p => p && p.si !== undefined && p.fret !== undefined && p.fret >= 0)
  .map(p => ({ si: p.si, fret: p.fret }));

// Drops the chord and moves on in one press — writing a progression is chord,
// next bar, chord, next bar, and stopping to hit ✓ between each one is friction.
// Committing also clears the neck (the new beat is empty), so the grip is
// remembered: pressing ⤓ again repeats the same chord, which is what a bar of
// one chord actually needs.
function insertFromNeck() {
  const live = neckGrip();
  const grip = live.length ? live : (T.lastGrip || []);
  if (!grip.length) return;
  T.lastGrip = grip.slice();
  const st = caretStep();
  st.notes = grip.slice(0, customTuning.length);
  commitBeat();                       // applies the pending duration and advances
}

// ── arpeggiate ────────────────────────────────────────────────────────
// Not a notation feature — a TRANSFORMATION. One chord becomes its notes in
// order, spread across the time the chord already occupied, so the piece stays
// the same length and you can see exactly how the shape unpacks. Sorted by real
// pitch, not by string: an open string can sound above a fretted one.
function arpeggiate(pattern = 'up') {
  const st = T.song?.steps?.[T.caret];
  const notes = (st?.notes || []).slice();
  if (notes.length < 2) return;
  const ranked = notes
    .map(n => { const p = posOf(n.si, n.fret); return { n, midi: noteToMidi(p.note, p.octave) }; })
    .sort((a, b) => a.midi - b.midi)
    .map(x => x.n);
  let seq = pattern === 'down' ? ranked.slice().reverse() : ranked.slice();
  // up-and-back without striking the top and bottom twice: 1 2 3 → 1 2 3 2
  if (pattern === 'updown' && ranked.length > 2) seq = ranked.concat(ranked.slice(1, -1).reverse());
  const each = +((st.dur || 1) / seq.length).toFixed(4);
  T.song.steps.splice(T.caret, 1, ...seq.map(n => ({ notes: [{ si: n.si, fret: n.fret }], dur: each })));
  redraw();
}
// A full render would throw away the scroll position mid-phrase, so keep it.
function redraw() {
  const wrap = document.getElementById('tab-scroll');
  const sl = wrap ? wrap.scrollLeft : 0;
  render();
  const w2 = document.getElementById('tab-scroll');
  if (w2) {
    w2.scrollLeft = sl;
    const xs = stepXs(), x = xs[T.caret];
    if (x != null) {                                    // keep the caret on screen
      if (x < w2.scrollLeft + 60) w2.scrollLeft = Math.max(0, x - 60);
      if (x > w2.scrollLeft + w2.clientWidth - 90) w2.scrollLeft = x - w2.clientWidth + 90;
    }
  }
  if (T.edit) { T.sel = T.caret; showCaretOnNeck(); }   // ⟦ start/end ⟧ mark from the caret
}
function setEdit(on) {
  T.edit = on;
  if (on) {
    stopPlay();
    if (!T.song) setSong(blankSong());
    T.caret = Math.min(T.caret, Math.max(0, T.song.steps.length - 1));
    setFretboardClickHandler(info => {
      // hand the neck back the moment this page stops owning it — the Sketchpad
      // and the Write It pedal want the same single handler slot
      if (!alive() || !T.edit) { setFretboardClickHandler(null); return; }
      if (info.si === undefined || info.fret === undefined) return;
      toggleNoteAtCaret(info.si, info.fret);
    });
  } else {
    setFretboardClickHandler(null);
    clearChordHighlight(); clearGhostHighlight(); updateOverlays();
  }
  redraw();
}

// ── playback ─────────────────────────────────────────────────────────
function buildPlan(from, to) {
  const spb = 60 / T.bpm, positions = [], seen = new Set();
  const steps = T.song.steps.slice(from, to + 1).map(st => {
    const ps = (st.notes || []).map(n => posOf(n.si, n.fret));
    ps.forEach(x => { const k = x.si + ':' + x.fret; if (!seen.has(k)) { seen.add(k); positions.push(x); } });
    const t = spb * (st.dur || 1);
    return { focus: ps.map(x => ({ si: x.si, fret: x.fret })), play: ps.map(x => ({ note: x.note, octave: x.octave })), dur: t * 0.95, gap: t };
  });
  return { root: null, notes: [...new Set(positions.map(x => x.note))], label: T.song.name, positions, colors: COL, steps, focusOnly: true };
}
function stopPlay() {
  if (T.stop) { T.stop(); T.stop = null; }
  if (T.countTimer) { clearInterval(T.countTimer); T.countTimer = null; }
  clickOff();
  T.playing = false; T.counting = false; T.listening = false; T.playIdx = null;
  clearChordHighlight(); clearGhostHighlight(); updateOverlays();
  paintPlayhead(); syncTransport(); refreshListenStrip();
}
function beginPlay() {
  const [a, b] = T.range || [0, T.song.steps.length - 1];
  const plan = buildPlan(a, b);
  if (!plan.steps.some(st => st.play.length)) { T.playing = false; syncTransport(); return; }
  T.playing = true; syncTransport();
  clickOn();
  T.stop = playPlan(plan, {
    loop: T.loop, isAlive: alive, gain: 0.22,
    onStep: i => { T.playIdx = a + i; paintPlayhead(); },
  });
  if (!T.loop) {
    const total = plan.steps.reduce((x, st) => x + (st.gap || 0), 0) * 1000 + 450;
    setTimeout(() => { if (T.playing && !T.loop) stopPlay(); }, total);
  }
}
// ── 🎤 Listen mode ───────────────────────────────────────────────────
// No clock: the playhead sits on a step until the mic hears every note in it,
// then moves on. Learning at your own speed, with the tab keeping your place.
let tabGate = null;          // shared mic gate (core/listen.js), armed in initTabMode
const rangeBounds = () => T.range || [0, T.song.steps.length - 1];
const stepNotes = i => [...new Set((T.song.steps[i]?.notes || []).map(n => posOf(n.si, n.fret).note))];

function listenShow(i) {
  T.playIdx = i;
  tabGate?.reset();                          // clean slate for this step
  T.heard = tabGate?.heard || new Set();
  const ps = (T.song.steps[i]?.notes || []).map(n => posOf(n.si, n.fret));
  const nx = (T.song.steps[i + 1]?.notes || []).map(n => posOf(n.si, n.fret));
  if (ps.length) setChordHighlight(null, ps.map(x => x.note), `step ${i + 1}`, ps, COL);
  else clearChordHighlight();
  if (nx.length) setGhostHighlight(nx.map(x => ({ si: x.si, fret: x.fret, note: x.note })));
  else clearGhostHighlight();
  updateOverlays(); paintPlayhead(); refreshListenStrip();
  if (!ps.length) setTimeout(() => { if (T.listening) listenNext(); }, 350);   // rests pass through
}
function listenNext() {
  if (!T.listening) return;
  const [a, b] = rangeBounds();
  let n = T.playIdx + 1;
  if (n > b) {
    if (!T.loop) { stopPlay(); return; }
    n = a;
  }
  listenShow(n);
}
function startListen() {
  const [a] = rangeBounds();
  T.listening = true; T.playing = true;
  syncTransport();
  listenShow(a);
}
function refreshListenStrip() {
  const el2 = document.getElementById('tabp-listen-strip');
  if (!el2) return;
  if (!T.listening) { el2.style.display = 'none'; return; }
  el2.style.display = 'flex';
  const want = stepNotes(T.playIdx);
  let h = `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui));letter-spacing:1.5px">PLAY THIS</span>`;
  if (!want.length) h += `<span class="mono" style="color:#7a6b4a;font-size:calc(10px*var(--ui))">— rest —</span>`;
  want.forEach(n => {
    const got = T.heard?.has(n);
    h += `<span class="mono" style="font-size:calc(11px*var(--ui));font-weight:700;padding:3px 9px;border-radius:6px;border:1px solid ${got ? pcColor(n, 90, 60) : '#332b1b'};background:${got ? pcColor(n, 80, 26) : 'transparent'};color:${got ? pcColor(n, 95, 80) : '#7a6b4a'}">${n}${got ? ' ✓' : ''}</span>`;
  });
  h += `<span class="mono" style="color:#3f3626;font-size:calc(10px*var(--ui));margin-left:auto">step ${T.playIdx + 1}${audio.connected ? '' : ' · mic not connected'}</span>`;
  if (!audio.connected) h += `<button id="tabp-mic" class="mono" style="min-height:calc(28px*var(--ui));background:rgba(232,184,74,.16);border:1px solid ${ACC};border-radius:6px;color:#ffe0a0;font-size:calc(10px*var(--ui));padding:4px 10px;cursor:pointer">🎤 Connect mic</button>`;
  el2.innerHTML = h;
  document.getElementById('tabp-mic')?.addEventListener('click', async () => { try { await audio.connect(); } catch (e) { /* denied */ } refreshListenStrip(); });
}

function togglePlay() {
  if (T.playing || T.counting || T.listening) { stopPlay(); return; }
  if (!T.song?.steps?.length) return;
  if (T.listen) { startListen(); return; }
  if (!T.countIn) { beginPlay(); return; }
  // ♩ one-bar count-in, clicked by the Metronome pedal: it starts, we count its
  // bar off on the play button, then the song begins. If the click isn't wanted
  // during playback, beginPlay's clickOn() simply doesn't re-ask and the pedal is
  // told to stop — the count-in still gets heard.
  const tsig = T.song.tsig || 4;
  T.counting = true;
  let c = 1;
  metroReq('start');
  syncTransport(tsig);
  T.countTimer = setInterval(() => {
    if (!alive()) { stopPlay(); return; }
    if (c >= tsig) {
      clearInterval(T.countTimer); T.countTimer = null;
      T.counting = false;
      if (!T.click) clickOff();      // the count-in was the only thing it was for
      beginPlay();
      return;
    }
    c++; syncTransport(tsig - c + 1);
  }, 60000 / T.bpm);
}

// ── notation staff ───────────────────────────────────────────────────
// Guitar is conventionally written an octave above where it sounds, so the clef
// carries a small 8 and the low strings land near the staff instead of under a
// stack of ledger lines. Every x here comes from stepXs() — the heads sit in the
// same columns as the fret numbers, and the bar lines run through both.
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const BOTTOM_DIA = 4 * 7 + LETTER.E;            // written E4 = the bottom line
// letter-steps above the bottom line for a sounding pitch (written an octave up)
const staffPos = p => (p.octave + 1) * 7 + LETTER[p.note[0]] - BOTTOM_DIA;

// one entry per distinct pitch in a step, low to high — a chord shares a stem
function stepPos(st) {
  const uniq = [];
  (st.notes || []).forEach(n => {
    const p = posOf(n.si, n.fret);
    if (!uniq.some(u => u.note === p.note && u.octave === p.octave)) uniq.push(p);
  });
  return uniq.sort((a, b) => staffPos(a) - staffPos(b));
}
const STEM = 6.5;                                // stem length in letter-steps ≈ an octave
const stemUp = (lo, hi) => (lo + hi) / 2 < 4;    // below the middle line, stems point up

// The staff block only reserves the headroom this chart actually needs — stems
// and ledger lines included — so a first-position song stays compact and a
// 15th-fret melody still fits without clipping into the bar numbers.
function staffPad() {
  let hi = 0, lo = 0;
  (T.song?.steps || []).forEach(st => {
    const ps = stepPos(st);
    if (!ps.length) return;
    const a = staffPos(ps[0]), b = staffPos(ps[ps.length - 1]), up = stemUp(a, b);
    hi = Math.max(hi, (up ? b + STEM : b) - 8);
    lo = Math.max(lo, -(up ? a : a - STEM));
  });
  return { above: Math.min(56, 10 + Math.ceil(Math.max(0, hi)) * HALF), below: Math.min(56, 10 + Math.ceil(Math.max(0, lo)) * HALF) };
}
function staffMetrics() {
  if (!T.staff || !T.song) return null;
  const { above, below } = staffPad();
  const top = HEAD_H + above;
  return { top, mid: top + 2 * STAFF_GAP, bottom: top + 4 * STAFF_GAP, h: above + 4 * STAFF_GAP + below };
}
const tabTop = () => { const m = staffMetrics(); return m ? HEAD_H + m.h : PAD_TOP; };

// A step's duration is a plain beat count, so the note value is read off it.
// [beats, flags, dotted]
const VALUES = [[4, 0, false], [3, 0, true], [2, 0, false], [1.5, 0, true], [1, 0, false],
                [0.75, 1, true], [0.5, 1, false], [0.375, 2, true], [0.25, 2, false]];
function noteValue(dur) {
  const d = (dur || 1) + 1e-6;
  const [beats, flags, dot] = VALUES.find(v => v[0] <= d) || VALUES[VALUES.length - 1];
  return { beats, flags, dot, open: beats >= 2, stem: beats < 4 };
}
function staffLines(W, m) {
  let h = '';
  for (let k = 0; k < 5; k++) h += `<line x1="0" y1="${m.top + k * STAFF_GAP}" x2="${W}" y2="${m.top + k * STAFF_GAP}" stroke="#3a3324" stroke-width="1"/>`;
  return h;
}
function restGlyph(x, m, v) {
  const y = m.mid;
  if (v.beats >= 4) return `<rect x="${x - 5}" y="${m.top + STAFF_GAP}" width="10" height="${HALF}" fill="currentColor"/>`;
  if (v.beats >= 2) return `<rect x="${x - 5}" y="${y - HALF}" width="10" height="${HALF}" fill="currentColor"/>`;
  if (!v.flags) return `<path d="M ${x - 2.5} ${y - 8} L ${x + 2.5} ${y - 2} L ${x - 2.5} ${y + 2} L ${x + 2.5} ${y + 8}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`;
  let h = `<path d="M ${x + 1.8} ${y - 6} L ${x - 1.8} ${y + 6}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
  for (let f = 0; f < v.flags; f++) h += `<circle cx="${x - 1.4}" cy="${y - 4.5 + f * 4.5}" r="1.8" fill="currentColor"/>`;
  return h;
}
function staffNotes(xs, m) {
  const yAt = pos => m.bottom - pos * HALF;
  let h = '';
  T.song.steps.forEach((st, i) => {
    const v = noteValue(st.dur), x = xs[i];
    h += `<g class="staff-step" data-i="${i}" style="color:#c9b98a">`;
    const uniq = stepPos(st);
    if (!uniq.length) { h += restGlyph(x, m, v) + `</g>`; return; }
    const loPos = staffPos(uniq[0]), hiPos = staffPos(uniq[uniq.length - 1]);
    const up = stemUp(loPos, hiPos);
    if (v.stem) {
      const sx = up ? x + 3.4 : x - 3.4;
      const yTail = up ? yAt(hiPos + STEM) : yAt(loPos - STEM);
      h += `<line x1="${sx}" y1="${up ? yAt(loPos) : yAt(hiPos)}" x2="${sx}" y2="${yTail}" stroke="currentColor" stroke-width="1.3"/>`;
      for (let f = 0; f < v.flags; f++) {
        const fy = yTail + (up ? f * 4.5 : -f * 4.5);
        h += `<path d="M ${sx} ${fy} q 5 ${up ? 3 : -3} 4.6 ${up ? 8.5 : -8.5}" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
      }
    }
    let prevPos = null, side = 0, accX = null, accPos = null;
    uniq.forEach(p => {
      const pos = staffPos(p), yy = yAt(pos);
      side = (prevPos !== null && pos - prevPos === 1) ? (side ? 0 : 1) : 0;   // seconds can't share a column
      prevPos = pos;
      const hx = x + side * 6.6;
      // ledger lines, one per even step between the staff and the head
      for (let q = 10; q <= pos; q += 2) h += `<line x1="${hx - 6.5}" y1="${yAt(q)}" x2="${hx + 6.5}" y2="${yAt(q)}" stroke="#4a4130" stroke-width="1"/>`;
      for (let q = -2; q >= pos; q -= 2) h += `<line x1="${hx - 6.5}" y1="${yAt(q)}" x2="${hx + 6.5}" y2="${yAt(q)}" stroke="#4a4130" stroke-width="1"/>`;
      if (p.note.length > 1) {
        accX = (accPos !== null && pos - accPos < 6) ? accX - 6 : hx - 8.5;    // stack tight accidentals leftwards
        accPos = pos;
        h += `<text x="${accX}" y="${yy + 3.4}" text-anchor="middle" fill="currentColor" font-size="10" font-family="'JetBrains Mono',monospace">♯</text>`;
      }
      h += `<ellipse cx="${hx}" cy="${yy}" rx="3.7" ry="2.9" transform="rotate(-16 ${hx} ${yy})" fill="${v.open ? '#100d08' : 'currentColor'}" stroke="currentColor" stroke-width="${v.open ? 1.4 : 0.7}"/>`;
      if (v.dot) h += `<circle cx="${hx + 7.5}" cy="${pos % 2 === 0 ? yy - HALF : yy}" r="1.4" fill="currentColor"/>`;
    });
    h += `</g>`;
  });
  return h;
}

// ── lane geometry ────────────────────────────────────────────────────
function stepXs() {
  const ppb = ZOOMS[T.zoom];
  let cum = 0;
  return T.song.steps.map(st => { const x = PAD_X + cum * ppb; cum += (st.dur || 1); return x; });
}
const laneW = () => T.song ? Math.ceil(PAD_X * 2 + T.song.steps.reduce((a, st) => a + (st.dur || 1), 0) * ZOOMS[T.zoom]) : 0;
const laneH = () => tabTop() + (customTuning.length - 1) * LINE_GAP + 22;
// bar boundaries — the staff, the tab and the waveform ticks all read from here
function barXs() {
  const xs = stepXs(), tsig = T.song.tsig || 4;
  const out = [];
  let cum = 0, lastBar = -1;
  T.song.steps.forEach((st, i) => {
    const bar = Math.floor(cum / tsig + 1e-6);
    if (bar > lastBar) { lastBar = bar; out.push({ x: xs[i], bar }); }
    cum += (st.dur || 1);
  });
  return out;
}
function laneSvg() {
  const steps = T.song.steps, ns = customTuning.length;
  const W = laneW(), H = laneH(), m = staffMetrics(), top = tabTop();
  const y = si => top + si * LINE_GAP;
  const xs = stepXs();
  let h = `<svg id="tab-svg" width="${W}" height="${H}" style="display:block">`;
  // the caret: the beat you are writing into, drawn behind everything so the
  // notes stay readable on top of it
  if (T.edit && xs[T.caret] != null) {
    const cx = xs[T.caret] - 8;
    const cw = Math.max(12, ((T.caret + 1 < xs.length ? xs[T.caret + 1] : W) - 6) - cx);
    h += `<rect x="${cx}" y="0" width="${cw}" height="${H}" fill="rgba(110,198,255,.13)"/>`;
    h += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#6ec6ff" stroke-width="2"/>`;
  }
  // active loop range — soft amber wash behind everything
  if (T.range) {
    const [ra, rb] = T.range;
    const rx = (xs[ra] ?? PAD_X) - 8;
    const rx2 = (rb + 1 < xs.length ? xs[rb + 1] : W) - 6;
    h += `<rect x="${rx}" y="0" width="${Math.max(8, rx2 - rx)}" height="${H}" fill="rgba(232,184,74,0.07)"/>`;
    h += `<line x1="${rx}" y1="0" x2="${rx}" y2="${H}" stroke="${ACC}" stroke-width="1" opacity="0.5"/>`;
    h += `<line x1="${rx2}" y1="0" x2="${rx2}" y2="${H}" stroke="${ACC}" stroke-width="1" opacity="0.5"/>`;
  }
  // staff lines, then string lines
  if (m) h += staffLines(W, m);
  for (let si = 0; si < ns; si++) h += `<line x1="0" y1="${y(si)}" x2="${W}" y2="${y(si)}" stroke="#3a3324" stroke-width="1"/>`;
  // bars — one line through the staff and the tab, so the two read as one system
  barXs().forEach(({ x, bar }) => {
    h += `<line x1="${x - 6}" y1="${m ? m.top : top - 8}" x2="${x - 6}" y2="${y(ns - 1) + 6}" stroke="#2a2419" stroke-width="${bar % 4 === 0 ? 2 : 1}"/>`;
    h += `<text x="${x - 4}" y="${m ? HEAD_H - 4 : top - 12}" fill="#5a4f38" font-size="8" font-family="'JetBrains Mono',monospace">${bar + 1}</text>`;
  });
  (T.song.sections || []).forEach(s2 => {
    if (xs[s2.at] == null) return;
    h += `<rect x="${xs[s2.at] - 7}" y="2" width="2" height="10" fill="${ACC}"/>`;
    h += `<text x="${xs[s2.at] - 2}" y="10" fill="${ACC}" font-size="9" font-weight="700" font-family="'JetBrains Mono',monospace">§ ${s2.name}</text>`;
  });
  if (m) h += staffNotes(xs, m);
  // notes
  steps.forEach((st, i) => {
    const cur = i === T.playIdx, sel = i === T.sel && !cur;
    h += `<g class="tab-step" data-i="${i}">`;
    (st.notes || []).forEach(n => {
      const yy = y(n.si);
      const txt = String(n.fret);
      const wBox = 7 + txt.length * 5;
      h += `<rect x="${xs[i] - wBox / 2}" y="${yy - 6}" width="${wBox}" height="12" fill="#171310" rx="2"/>`;
      h += `<text x="${xs[i]}" y="${yy + 3.5}" text-anchor="middle" fill="${cur ? '#ffe9b0' : sel ? ACC : '#c9b98a'}" font-size="10" font-weight="${cur ? 800 : 600}" font-family="'JetBrains Mono',monospace">${txt}</text>`;
    });
    h += `</g>`;
    // click zone
    const nextX = i + 1 < xs.length ? xs[i + 1] : W;
    h += `<rect class="tab-hit" data-i="${i}" x="${xs[i] - 8}" y="0" width="${Math.max(10, nextX - xs[i])}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
  });
  // playhead — one line for the staff and the tab together
  const px = T.playIdx != null && xs[T.playIdx] != null ? xs[T.playIdx] : -50;
  h += `<line id="tab-playhead" x1="${px}" y1="${m ? m.top - 8 : top - 10}" x2="${px}" y2="${y(ns - 1) + 8}" stroke="${ACC}" stroke-width="2" opacity="${T.playIdx != null ? 0.9 : 0}" style="transition:x1 .08s,x2 .08s"/>`;
  h += `</svg>`;
  return h;
}
// ── 🎹 piano-roll lane ───────────────────────────────────────────────
// Same x-axis as the staff and the tab (stepXs/laneW), so the three read as one
// system: a shape you can see in the roll is a shape you can find on the neck.
// Notes carry the app's ONE colour code — the fifths spectrum — so the roll, the
// 🌈 neck view and both circles all say "this is an A" the same way.
function midiRange() {
  if (!T.song) return null;
  let lo = 128, hi = -1;
  T.song.steps.forEach(st => (st.notes || []).forEach(n => {
    const p = posOf(n.si, n.fret), m = noteToMidi(p.note, p.octave);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }));
  if (hi < 0) return null;
  return { lo: lo - 1, hi: hi + 1 };            // a semitone of air top and bottom
}
const midiH = () => { const r = midiRange(); return r ? (r.hi - r.lo + 1) * MIDI_ROW : 0; };
function midiSvg() {
  const r = midiRange();
  if (!r) return '';
  const W = laneW(), H = midiH(), xs = stepXs(), ppb = ZOOMS[T.zoom];
  const yOf = m => (r.hi - m) * MIDI_ROW;
  let h = `<svg id="tab-midi" width="${W}" height="${H}" style="display:block">`;
  if (T.edit && xs[T.caret] != null) {          // same caret, third view of it
    const cx = xs[T.caret] - 8;
    const cw = Math.max(12, ((T.caret + 1 < xs.length ? xs[T.caret + 1] : W) - 6) - cx);
    h += `<rect x="${cx}" y="0" width="${cw}" height="${H}" fill="rgba(110,198,255,.13)"/>`;
    h += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#6ec6ff" stroke-width="2"/>`;
  }
  if (T.range) {
    const [ra, rb] = T.range;
    const rx = (xs[ra] ?? PAD_X) - 8, rx2 = (rb + 1 < xs.length ? xs[rb + 1] : W) - 6;
    h += `<rect x="${rx}" y="0" width="${Math.max(8, rx2 - rx)}" height="${H}" fill="rgba(232,184,74,0.07)"/>`;
  }
  // piano rows: the black keys tinted, a line under every C
  for (let m = r.lo; m <= r.hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    if ([1, 3, 6, 8, 10].includes(pc)) h += `<rect x="0" y="${yOf(m)}" width="${W}" height="${MIDI_ROW}" fill="rgba(255,255,255,.03)"/>`;
    if (pc === 0) h += `<line x1="0" y1="${yOf(m) + MIDI_ROW}" x2="${W}" y2="${yOf(m) + MIDI_ROW}" stroke="#2a2419" stroke-width="1"/>`;
  }
  barXs().forEach(({ x, bar }) => {
    h += `<line x1="${x - 6}" y1="0" x2="${x - 6}" y2="${H}" stroke="#2a2419" stroke-width="${bar % 4 === 0 ? 2 : 1}"/>`;
  });
  T.song.steps.forEach((st, i) => {
    const w = Math.max(3, (st.dur || 1) * ppb - 3);
    h += `<g class="midi-step" data-i="${i}">`;
    (st.notes || []).forEach(n => {
      const p = posOf(n.si, n.fret), m = noteToMidi(p.note, p.octave);
      h += `<rect class="midi-note" x="${xs[i] - 6}" y="${yOf(m) + 0.5}" width="${w}" height="${MIDI_ROW - 1}" rx="1.5"`
         + ` fill="${pcColor(p.note, 70, 55)}" stroke="none"/>`;
    });
    h += `</g>`;
    const nextX = i + 1 < xs.length ? xs[i + 1] : W;
    h += `<rect class="tab-hit" data-i="${i}" x="${xs[i] - 8}" y="0" width="${Math.max(10, nextX - xs[i])}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
  });
  h += `</svg>`;
  return h;
}
// Note names down the side of the roll, at every C — enough to read the register
// without spending width on a full keyboard.
function midiLabels(yOff = 0) {
  const r = midiRange();
  if (!r) return '';
  let h = '';
  for (let m = r.lo; m <= r.hi; m++) {
    if (((m % 12) + 12) % 12 !== 0) continue;
    h += `<span class="mono" style="position:absolute;left:0;width:26px;text-align:center;top:${yOff + (r.hi - m) * MIDI_ROW - 3}px;font-size:calc(8px*var(--ui));color:#5a4f38">C${Math.floor(m / 12) - 1}</span>`;
  }
  return h;
}

function paintPlayhead() {
  const svg = document.getElementById('tab-svg');
  if (!svg || !T.song) return;
  const xs = stepXs();
  const ph = document.getElementById('tab-playhead');
  if (ph) {
    const px = T.playIdx != null && xs[T.playIdx] != null ? xs[T.playIdx] : -50;
    ph.setAttribute('x1', px); ph.setAttribute('x2', px);
    ph.setAttribute('opacity', T.playIdx != null ? 0.9 : 0);
  }
  // recolor current step's numbers
  svg.querySelectorAll('.tab-step').forEach(g => {
    const cur = +g.dataset.i === T.playIdx;
    g.querySelectorAll('text').forEach(t => { t.setAttribute('fill', cur ? '#ffe9b0' : '#c9b98a'); t.setAttribute('font-weight', cur ? 800 : 600); });
  });
  // the staff heads light with the tab — every glyph inherits the group's colour
  svg.querySelectorAll('.staff-step').forEach(g => { g.style.color = +g.dataset.i === T.playIdx ? '#ffe9b0' : '#c9b98a'; });
  // the roll lights with the tab — same step, same moment, three views of it
  document.querySelectorAll('#tab-midi .midi-step').forEach(g => {
    const cur = +g.dataset.i === T.playIdx;
    g.querySelectorAll('.midi-note').forEach(rc => {
      rc.setAttribute('stroke', cur ? '#fff' : 'none');
      rc.setAttribute('stroke-width', cur ? '1.2' : '0');
    });
  });
  // the waveform and roll lanes ride outside the svg but on the same x
  const px2 = T.playIdx != null && xs[T.playIdx] != null ? xs[T.playIdx] : -50;
  ['tab-waveph', 'tab-midiph'].forEach(id => {
    const ph2 = document.getElementById(id);
    if (!ph2) return;
    ph2.style.left = `${px2}px`;
    ph2.style.opacity = T.playIdx != null ? 0.9 : 0;
  });
  // keep the playhead ~40% from the left (the bottom box follows by scroll-sync)
  const wrap = document.getElementById('tab-scroll');
  if (wrap && T.playIdx != null && xs[T.playIdx] != null) {
    const target = xs[T.playIdx] - wrap.clientWidth * 0.4;
    if (Math.abs(wrap.scrollLeft - target) > 24) wrap.scrollLeft = Math.max(0, target);
  }
}
function previewStep(i) {
  T.sel = i;
  const st = T.song.steps[i];
  const ps = (st?.notes || []).map(n => posOf(n.si, n.fret));
  if (ps.length) { setChordHighlight(null, ps.map(x => x.note), `step ${i + 1}`, ps, COL); clearGhostHighlight(); updateOverlays(); }
  // move the selection tint without a full re-render (which would reset scroll)
  const svg = document.getElementById('tab-svg');
  if (svg) svg.querySelectorAll('.tab-step').forEach(g2 => {
    const isCur = +g2.dataset.i === T.playIdx, isSel = +g2.dataset.i === i;
    g2.querySelectorAll('text').forEach(t2 => t2.setAttribute('fill', isCur ? '#ffe9b0' : isSel ? ACC : '#c9b98a'));
  });
  if (svg) svg.querySelectorAll('.staff-step').forEach(g2 => {
    const isCur = +g2.dataset.i === T.playIdx, isSel = +g2.dataset.i === i;
    g2.style.color = isCur ? '#ffe9b0' : isSel ? ACC : '#c9b98a';
  });
  document.querySelectorAll('#tab-midi .midi-step').forEach(g2 => {
    const isCur = +g2.dataset.i === T.playIdx, isSel = +g2.dataset.i === i;
    g2.querySelectorAll('.midi-note').forEach(rc => {
      rc.setAttribute('stroke', isCur ? '#fff' : isSel ? ACC : 'none');
      rc.setAttribute('stroke-width', isCur || isSel ? '1.2' : '0');
    });
  });
}

// ── 〜 reference recording ────────────────────────────────────────────
// The take you're transcribing, drawn under the tab in the same scroll box and
// on the same x-axis: px-per-second is the tab's px-per-beat at the current
// tempo, so setting the chart's BPM to the record's tempo lines the two up, and
// OFFSET slides the recording onto beat 1.
async function loadAudioFile(file) {
  T.waveBusy = true; T.waveErr = ''; render();
  try {
    const { samples, sr, duration } = await decodeToMono(await file.arrayBuffer());
    // keep min/max buckets and drop the samples — a redraw has to be instant on
    // every tempo nudge, and holding 8M floats per song buys nothing here
    const n = Math.ceil(samples.length / PEAK_HOP);
    const mn = new Float32Array(n), mx = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let lo = 1, hi = -1;
      const s0 = b * PEAK_HOP, s1 = Math.min(samples.length, s0 + PEAK_HOP);
      for (let i = s0; i < s1; i++) { const v = samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      mn[b] = lo; mx[b] = hi;
    }
    T.wave = { name: file.name, sr, duration, mn, mx };
    T.waveOff = 0; T.waveShow = true;
  } catch (err) {
    T.wave = null; T.waveErr = String(err?.message || err);
  }
  T.waveBusy = false;
  render();
}
function setWaveOff(sec) {
  T.waveOff = Math.max(-120, Math.min(120, sec));
  const num = document.getElementById('tabp-woff');
  if (num && document.activeElement !== num) num.value = Math.round(T.waveOff * 1000);
  drawWave();
}
// Most takes have a breath (or a count-in) before the downbeat — put the first
// thing you can hear on step 1 and fine-tune from there.
function snapFirstSound() {
  if (!T.wave) return;
  const { mn, mx, sr } = T.wave;
  let peak = 0;
  for (let b = 0; b < mx.length; b++) peak = Math.max(peak, mx[b], -mn[b]);
  const thr = peak * 0.12;
  for (let b = 0; b < mx.length; b++) {
    if (mx[b] >= thr || -mn[b] >= thr) { setWaveOff(-(b * PEAK_HOP / sr)); return; }
  }
}
function drawWave() {
  const cv = document.getElementById('tab-wave');
  if (!cv || !T.wave || !T.song) return;
  const W = laneW(), pps = ZOOMS[T.zoom] * T.bpm / 60;
  const dpr = W > 6000 ? 1 : Math.min(2, window.devicePixelRatio || 1);   // wide charts already push the canvas limit
  cv.width = Math.round(W * dpr); cv.height = Math.round(WAVE_H * dpr);
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0d0b06'; g.fillRect(0, 0, W, WAVE_H);
  if (T.range) {
    const xs = stepXs();
    const rx = (xs[T.range[0]] ?? PAD_X) - 8;
    const rx2 = (T.range[1] + 1 < xs.length ? xs[T.range[1] + 1] : W) - 6;
    g.fillStyle = 'rgba(232,184,74,0.07)'; g.fillRect(rx, 0, Math.max(8, rx2 - rx), WAVE_H);
  }
  g.strokeStyle = '#2a2419'; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 0.5); g.lineTo(W, 0.5);
  barXs().forEach(({ x }) => { g.moveTo(x - 5.5, 0); g.lineTo(x - 5.5, WAVE_H); });   // the grid to align against
  g.stroke();
  const mid = WAVE_H / 2, amp = mid - 3, { mn, mx, sr, duration } = T.wave;
  g.strokeStyle = 'rgba(232,184,74,.5)';
  g.beginPath();
  for (let x = 0; x < W; x++) {
    const t0 = (x - PAD_X) / pps - T.waveOff, t1 = t0 + 1 / pps;
    if (t1 <= 0 || t0 >= duration) continue;
    const b0 = Math.max(0, Math.floor(t0 * sr / PEAK_HOP)), b1 = Math.min(mn.length - 1, Math.ceil(t1 * sr / PEAK_HOP));
    let lo = 1, hi = -1;
    for (let b = b0; b <= b1; b++) { if (mn[b] < lo) lo = mn[b]; if (mx[b] > hi) hi = mx[b]; }
    if (hi < lo) continue;
    g.moveTo(x + 0.5, mid - hi * amp); g.lineTo(x + 0.5, mid - lo * amp);
  }
  g.stroke();
}
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── render ───────────────────────────────────────────────────────────
// The transport is the one button on this page whose colour tracks state: the page's
// amber while it offers to start, the app-wide stop red the instant it becomes ⏹ Stop.
// Stop is a reflex you hit mid-phrase — it has to be the red thing, not one more amber
// chip in a row of amber chips. render() and syncTransport() both paint from here,
// because playback starts and ends without a re-render.
const transportCSS = halting => halting
  ? ';color:var(--rk-stop);border-color:var(--rk-stop-edge);background:var(--rk-stop-soft)'
  : `;color:${ACC_INK};border-color:${ACC};background:${ACC_WASH}`;

function syncTransport(countLeft) {
  const b = document.getElementById('tabp-play');
  if (!b) return;
  const halting = T.playing || T.listening;
  b.textContent = T.counting ? `♩ ${countLeft ?? ''}…`
    : halting ? '⏹ Stop'
    : T.listen ? '🎤 Start' : '▶ Play';
  b.style.color       = halting ? 'var(--rk-stop)'      : ACC_INK;
  b.style.borderColor = halting ? 'var(--rk-stop-edge)' : ACC;
  b.style.background  = halting ? 'var(--rk-stop-soft)' : ACC_WASH;
}

// The page had its own circle of fifths built in. It's gone: the 🔮 Circle PEDAL
// floats over every page, already listens to `resonote:played`, and is the one
// that gets improved. A page-local copy is a second thing to maintain and a
// second answer to the same question. Pages stay lean cores; pedals extend them.

// The toggle that took its place names whatever instrument is actually loaded —
// "Neck" is a lie on a piano.
function instToggleLabel() {
  const r = INSTRUMENTS[currentInstrument]?.renderer;
  // Match on the renderer names tuning.js actually uses ('keyboard', 'hex',
  // 'vocals'); anything fretted is a neck.
  return r === 'keyboard' ? '🎹 Keys' : r === 'hex' ? '⬡ Hex' : r === 'vocals' ? '🎤 Voice' : '🎸 Neck';
}
// The instrument sits below the lanes and is the tallest thing on the page, so it
// collapses like any other lane. switchMode resets it on every entry to the page,
// which is exactly what this re-applies over.
function applyNeck() {
  const nk = document.getElementById('instrument-display');
  const bar = document.getElementById('instrument-bar');
  if (nk) nk.style.display = T.neck ? '' : 'none';
  if (bar) bar.style.display = T.neck ? '' : 'none';
}
function render() {
  const el = document.getElementById('tab-mode');
  if (!el) return;
  const btn = (id, lab, on, extra = '') => `<button id="${id}" class="mono" style="min-height:calc(28px*var(--ui));background:${on ? 'rgba(232,184,74,.18)' : '#17130c'};border:1px solid ${on ? ACC : '#332b1b'};border-radius:6px;color:${on ? '#ffe0a0' : '#a89468'};font-size:calc(10px*var(--ui));padding:6px 12px;cursor:pointer;letter-spacing:.5px;${extra}">${lab}</button>`;

  let h = `<div style="padding:10px 14px;display:flex;flex-direction:column;gap:8px">`;
  // header row
  h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">`;
  h += `<span class="mono" style="color:${ACC};font-size:calc(12px*var(--ui));font-weight:800;letter-spacing:2px">🎼 TAB</span>`;
  h += `<span class="mono" style="font-size:calc(8px*var(--ui));color:#ffc832;border:1px solid rgba(255,200,50,.3);border-radius:4px;padding:0 5px">PRO</span>`;
  h += `<select id="tabp-src" style="background:#17130c;border:1px solid #332b1b;border-radius:6px;color:#ffe0a0;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:6px;max-width:320px">`;
  h += `<option value="">— open a song —</option>`;
  let lastGroup = '';
  sources().forEach(s2 => {
    if (s2.group !== lastGroup) { if (lastGroup) h += `</optgroup>`; h += `<optgroup label="${s2.group}">`; lastGroup = s2.group; }
    h += `<option value="${s2.key}" ${T.song && T.song.name === s2.label ? 'selected' : ''}>${s2.label}</option>`;
  });
  if (lastGroup) h += `</optgroup>`;
  h += `</select>`;
  h += btn('tabp-new', '✎ New', false);
  h += btn('tabp-paste', '📋 Paste tab', T.pasting);
  h += `<span style="flex:1"></span>`;
  h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">ZOOM</span>` + [0, 1, 2].map(z => btn(`tabp-z${z}`, ['S', 'M', 'L'][z], T.zoom === z, 'padding:5px 9px')).join('');
  h += `</div>`;

  if (T.pasting) {
    h += `<div style="display:flex;flex-direction:column;gap:5px;background:#0f0c07;border:1px dashed #332b1b;border-radius:8px;padding:8px">
      <textarea id="tabp-ta" rows="7" placeholder="e|--0--2--3--|&#10;B|--1--------|&#10;…" style="background:#0a0805;color:#ffe0a0;border:1px solid #332b1b;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:6px;resize:vertical;outline:none;line-height:1.6"></textarea>
      <div style="display:flex;gap:5px">${btn('tabp-load', '↓ Load', true, 'flex:1')}${btn('tabp-cancel', 'Cancel', false)}</div></div>`;
  }

  if (T.song) {
    // transport row: play (space works too) · loop · click · count-in · circle · bpm
    const secs = (T.song.sections || []).filter(s2 => s2.at < T.song.steps.length);
    h += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">`;
    const halting = T.playing || T.listening;
    h += btn('tabp-play', T.counting ? '♩ …' : halting ? '⏹ Stop' : T.listen ? '🎤 Start' : '▶ Play', true,
             `font-size:calc(12px*var(--ui));padding:7px 16px${transportCSS(halting)}`);
    h += btn('tabp-loop', '🔁 Loop', T.loop);
    h += btn('tabp-listen', '🎤 Listen', T.listen, `border-style:${T.listen ? 'solid' : 'dashed'}`);
    h += btn('tabp-click', '🔔 Click', T.click, T.listen ? 'opacity:.4' : '');
    h += btn('tabp-count', '♩ Count-in', T.countIn, T.listen ? 'opacity:.4' : '');
    h += btn('tabp-staff', '🎼 Staff', T.staff);
    h += btn('tabp-grid', '🎹 Roll', T.grid);
    h += btn('tabp-neck', instToggleLabel(), T.neck);
    h += btn('tabp-edit', '✎ Write', T.edit, 'border-style:solid');
    h += btn('tabp-wave', T.waveBusy ? '〜 reading…' : '〜 Waveform', !!T.wave && T.waveShow, `border-style:${T.wave ? 'solid' : 'dashed'}`);
    h += `<input id="tabp-file" type="file" accept="audio/*" style="display:none"/>`;
    h += `<span class="mono" style="color:#3f3626;font-size:calc(8px*var(--ui));margin-left:auto">${T.edit ? 'SPACE = lock the beat' : 'SPACE = play/stop'}</span>`;
    h += `</div>`;
    // ── ✎ WRITE bar: duration first, then pitch ──
    if (T.edit) {
      const st = T.song.steps[T.caret] || { notes: [] };
      const bar = Math.floor(T.song.steps.slice(0, T.caret).reduce((a, s2) => a + (s2.dur || 1), 0) / (T.song.tsig || 4)) + 1;
      h += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:rgba(110,198,255,.07);border:1px solid #6ec6ff55;border-radius:10px;padding:7px 10px">`;
      h += `<span class="mono" style="color:#6ec6ff;font-size:calc(8px*var(--ui));letter-spacing:1.5px">WRITE</span>`;
      // the piece's name, editable in place — a saved piece you cannot name is a
      // saved piece you will never find again
      h += `<input id="tabp-title" value="${(T.song.name || '').replace(/"/g, '&quot;')}" placeholder="name this piece"
              title="${T.song.libId ? 'saved in your Library — 💾 updates it' : 'not saved yet — 💾 adds it to your Library'}"
              style="width:150px;background:#0a0805;border:1px solid ${T.song.libId ? '#6ec6ff55' : '#332b1b'};border-radius:6px;color:#ffe0a0;font-family:'JetBrains Mono',monospace;font-size:calc(11px*var(--ui));font-weight:700;padding:4px 7px;outline:none"/>`;
      h += `<span class="mono" title="${T.song.libId ? 'in your Library' : 'unsaved'}" style="color:${T.song.libId ? '#7ec98f' : '#5a4f38'};font-size:calc(8px*var(--ui))">${T.song.libId ? '● saved' : '○ unsaved'}</span>`;
      NOTE_VALUES.forEach(v => {
        const on = T.dur === v.beats;
        h += `<button class="tabp-dur mono" data-b="${v.beats}" title="${v.name}" style="min-height:calc(28px*var(--ui));min-width:30px;background:${on ? 'rgba(110,198,255,.22)' : '#17130c'};border:1px solid ${on ? '#6ec6ff' : '#332b1b'};border-radius:6px;color:${on ? '#cfeaff' : '#a89468'};font-size:calc(14px*var(--ui));line-height:1;padding:4px 7px;cursor:pointer">${v.glyph}</button>`;
      });
      h += `<button id="tabp-dot" class="mono" title="dotted — one and a half times the value" style="min-height:calc(28px*var(--ui));background:${T.dotted ? 'rgba(110,198,255,.22)' : '#17130c'};border:1px solid ${T.dotted ? '#6ec6ff' : '#332b1b'};border-radius:6px;color:${T.dotted ? '#cfeaff' : '#a89468'};font-size:calc(13px*var(--ui));padding:4px 9px;cursor:pointer">·</button>`;
      h += `<button id="tabp-trip" class="mono" title="triplet — three in the time of two" style="min-height:calc(28px*var(--ui));background:${T.triplet ? 'rgba(110,198,255,.22)' : '#17130c'};border:1px solid ${T.triplet ? '#6ec6ff' : '#332b1b'};border-radius:6px;color:${T.triplet ? '#cfeaff' : '#a89468'};font-size:calc(11px*var(--ui));font-weight:700;padding:5px 8px;cursor:pointer">3</button>`;
      h += `<span class="mono" style="color:#5a4f38;font-size:calc(10px*var(--ui))">= ${pendingDur()} beat${pendingDur() === 1 ? '' : 's'}</span>`;
      h += `<span style="width:1px;height:16px;background:#332b1b"></span>`;
      h += btn('tabp-lock', '✓ Lock beat', true, 'font-size:calc(11px*var(--ui))');
      h += btn('tabp-fromneck', '⤓ Lock chord', !!(neckGrip().length || T.lastGrip?.length), 'font-size:calc(11px*var(--ui))');
      h += btn('tabp-rest', '𝄽 Rest', false);
      h += btn('tabp-back', '←', false, 'padding:6px 10px');
      h += btn('tabp-fwd', '→', false,
        `padding:6px 10px;${T.caret >= T.song.steps.length - 1 ? 'opacity:.35' : ''}`);
      h += btn('tabp-del', '⌫', false, 'padding:6px 10px');
      h += `<span style="width:1px;height:16px;background:#332b1b"></span>`;
      h += btn('tabp-arp-up', '⤴↑', false, 'padding:6px 8px');
      h += btn('tabp-arp-dn', '⤴↓', false, 'padding:6px 8px');
      h += btn('tabp-arp-ud', '⤴↑↓', false, 'padding:6px 8px');
      h += `<span style="width:1px;height:16px;background:#332b1b"></span>`;
      h += btn('tabp-copy', '📋', false, 'padding:6px 9px');
      h += btn('tabp-cut', '✂', false, 'padding:6px 9px');
      h += btn('tabp-paste2', `📄${T.clip?.length ? ' ' + T.clip.length : ''}`, !!T.clip?.length, 'padding:6px 9px');
      h += btn('tabp-keep', T.song.libId ? '💾 Save' : '💾 Keep', false);
      if (T.song.libId) h += btn('tabp-delpiece', '🗑', false, 'padding:6px 9px;border-color:#5a3a3a;color:#c98f8f');
      h += `<span style="flex:1"></span>`;
      // beats per bar — the writing needs to know where the bar lines fall, and so
      // does anything exported from it
      h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">BAR</span>`;
      h += `<select id="tabp-tsig" title="beats per bar" style="background:#17130c;border:1px solid #332b1b;border-radius:5px;color:#ffe0a0;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:3px">
              ${[2,3,4,5,6,7].map(n => `<option value="${n}" ${(T.song.tsig || 4) === n ? 'selected' : ''}>${n}/4</option>`).join('')}
            </select>`;
      h += `<span class="mono" style="color:#6ec6ff;font-size:calc(10px*var(--ui))">beat <b>${T.caret + 1}</b>/${T.song.steps.length} · bar ${bar} · ${(st.notes || []).length ? (st.notes || []).map(n => posOf(n.si, n.fret).note).join(' ') : 'empty'}</span>`;
      h += `</div>`;
      h += `<div class="mono" style="color:#3f3626;font-size:calc(8px*var(--ui))">pick a note value, then tap the neck — tap again to remove. Notes stack into a chord; SPACE or ✓ locks the beat and moves on. <b style="color:#5a4f38">⤓ From neck</b> drops whatever a pedal has lit on the fretboard (Chord Directory, Chord Lab…) straight onto this beat. <b style="color:#5a4f38">⤴</b> spreads the chord on this beat into its notes, over the same length.</div>`;
    }
    // 🎤 listen strip — the notes the current step wants, lighting up as you hit them
    h += `<div id="tabp-listen-strip" style="display:${T.listening ? 'flex' : 'none'};align-items:center;gap:7px;flex-wrap:wrap;background:rgba(232,184,74,.05);border:1px solid ${ACC}44;border-radius:10px;padding:7px 10px"></div>`;
    // ── tempo: the shared control, reading and writing the same master clock the
    // ⏱️ Metronome pedal does — set it here and the pedal moves with you. Beside it
    // is the one tempo control the pedal can't have: a percentage of THIS song's own
    // recorded tempo, which is how you actually woodshed a part you can't play yet.
    const orig = T.origBpm || T.bpm;
    const pctOf = Math.round((T.bpm / orig) * 100);
    h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#0f0c07;border:1px solid #2a2419;border-radius:10px;padding:7px 10px">`;
    h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui));letter-spacing:1.5px">TEMPO</span>`;
    h += `<div class="rk" style="--rk-accent:${ACC}">${masterTempoBlock('tabpage', { min: 30, max: 280, compact: true })}</div>`;
    h += btn('tabp-metro', '⏱️ Metronome', false, 'padding:5px 10px');
    h += `<span class="mono" style="color:#3f3626;font-size:calc(8px*var(--ui))">the session tempo — moving it here moves the pedal too</span>`;
    h += `<span style="flex:1"></span>`;
    h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">OF ORIGINAL (${orig})</span>`;
    [50, 75, 90, 100].forEach(pc => {
      const on = pctOf === pc;
      const at = Math.round(orig * pc / 100);
      h += `<button class="tabp-pct mono" data-p="${pc}" title="${at} BPM · ${tempoTerm(at)}" style="min-height:calc(28px*var(--ui));background:${on ? 'rgba(232,184,74,.18)' : '#17130c'};border:1px solid ${on ? ACC : '#332b1b'};border-radius:6px;color:${on ? '#ffe0a0' : '#a89468'};font-size:calc(10px*var(--ui));padding:4px 8px;cursor:pointer">${pc}%</button>`;
    });
    h += `</div>`;
    // loop-range row: whole song · sections · exact range from the selected step
    h += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">`;
    h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">LOOP</span>`;
    h += btn('tabp-whole', 'whole song', !T.range);
    secs.forEach((s2, k) => {
      const to = secs[k + 1] ? secs[k + 1].at - 1 : T.song.steps.length - 1;
      const on = T.range && T.range[0] === s2.at && T.range[1] === to;
      h += `<button class="tabp-sec mono" data-a="${s2.at}" data-b="${to}" style="min-height:calc(28px*var(--ui));background:${on ? 'rgba(232,184,74,.18)' : '#17130c'};border:1px dashed ${on ? ACC : '#332b1b'};border-radius:6px;color:${on ? '#ffe0a0' : '#a89468'};font-size:calc(10px*var(--ui));padding:5px 9px;cursor:pointer">§ ${s2.name}</button>`;
    });
    h += `<span style="flex:1"></span>`;
    h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">EXACT · tap a step, then</span>`;
    h += btn('tabp-ra', '⟦ start here', false);
    h += btn('tabp-rb', 'end here ⟧', false);
    if (T.range) h += `<span class="mono" style="color:#ffe0a0;font-size:calc(10px*var(--ui));border:1px solid ${ACC}55;border-radius:6px;padding:4px 8px">steps ${T.range[0] + 1}–${T.range[1] + 1}</span>`;
    h += `</div>`;
    // ── 〜 audio row: line the recording up with the grid ──
    if (T.wave || T.waveErr) {
      h += `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:#0f0c07;border:1px solid #2a2419;border-radius:10px;padding:7px 10px">`;
      h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui));letter-spacing:1.5px">AUDIO</span>`;
      if (T.waveErr) h += `<span class="mono" style="color:#c8724a;font-size:calc(9px*var(--ui))">couldn't read that file — ${T.waveErr}</span>`;
      else {
        h += `<span class="mono" style="color:#ffe0a0;font-size:calc(10px*var(--ui));max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${T.wave.name}</span>`;
        h += `<span class="mono" style="color:#7a6b4a;font-size:calc(10px*var(--ui))">${fmtDur(T.wave.duration)}</span>`;
        h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui));margin-left:6px">OFFSET</span>`;
        h += btn('tabp-woff-m50', '−50', false, 'padding:5px 8px') + btn('tabp-woff-m5', '−5', false, 'padding:5px 8px');
        h += `<input id="tabp-woff" type="number" step="5" value="${Math.round(T.waveOff * 1000)}" title="Slide the recording against beat 1"
          style="width:62px;background:#0a0805;border:1px solid #332b1b;border-radius:6px;color:#ffe0a0;font-family:'JetBrains Mono',monospace;font-size:calc(12px*var(--ui));font-weight:700;padding:4px 2px;text-align:center;outline:none"/>`;
        h += `<span class="mono" style="color:#5a4f38;font-size:calc(8px*var(--ui))">ms</span>`;
        h += btn('tabp-woff-p5', '+5', false, 'padding:5px 8px') + btn('tabp-woff-p50', '+50', false, 'padding:5px 8px');
        h += btn('tabp-wsnap', '⊙ First sound → beat 1', false, 'padding:5px 10px');
        h += btn('tabp-wclear', '✕', false, 'padding:5px 9px');
        h += `<span class="mono" style="color:#3f3626;font-size:calc(8px*var(--ui));margin-left:auto">set TEMPO to the record's tempo — the waveform stretches with it</span>`;
      }
      h += `</div>`;
    }
    // what the song is — the 🔮 Circle pedal covers the harmony view
    if (T.song.about) h += `<div class="mono" style="color:#7a6b4a;font-size:calc(9px*var(--ui));line-height:1.5">${T.song.about}</div>`;
    // ── the lanes: staff, tab, piano roll and waveform, one scroll box, one axis.
    // They live in ONE box on purpose — a shared scroll container is alignment you
    // cannot get wrong, and the instrument now follows underneath them all.
    const ns = customTuning.length, m = staffMetrics();
    const showWave = !!T.wave && T.waveShow, showGrid = T.grid && midiH() > 0;
    h += `<div style="display:flex;background:#0f0c07;border:1px solid #2a2419;border-radius:10px;overflow:hidden">`;
    h += `<div style="flex:0 0 26px;display:flex;flex-direction:column;padding-top:${tabTop() - 6}px;background:#131009;border-right:1px solid #2a2419;position:relative">`;
    // the clef stays pinned while the lanes scroll — the small 8 is the octave-down mark
    if (m) h += `<div style="position:absolute;left:0;top:${m.top - 6}px;width:26px;height:${4 * STAFF_GAP + 24}px;display:flex;align-items:center;justify-content:center;font-size:calc(40px*var(--ui));line-height:1;color:#8a7850;font-family:'Segoe UI Symbol','Noto Music','Apple Symbols',serif">𝄞</div>`
           + `<span class="mono" style="position:absolute;left:8px;top:${m.bottom + 2}px;font-size:calc(8px*var(--ui));color:#5a4f38">8vb</span>`;
    for (let si = 0; si < ns; si++) h += `<span class="mono" style="color:#7a6b4a;font-size:calc(9px*var(--ui));height:${LINE_GAP}px;line-height:12px;text-align:center">${customTuning[si].label || customTuning[si].note}</span>`;
    if (showGrid) h += midiLabels(laneH());
    if (showWave) h += `<span class="mono" style="position:absolute;left:0;width:26px;text-align:center;top:${laneH() + (showGrid ? midiH() : 0) + WAVE_H / 2 - 5}px;font-size:calc(9px*var(--ui));color:#7a6b4a">〜</span>`;
    h += `</div>`;
    h += `<div id="tab-scroll" style="flex:1;overflow-x:auto;overflow-y:hidden">`;
    h += `<div id="tab-lanes" style="position:relative;width:${laneW()}px">${laneSvg()}`;
    if (showGrid) h += midiSvg()
                    + `<div id="tab-midiph" style="position:absolute;left:-50px;top:${laneH()}px;width:2px;height:${midiH()}px;background:${ACC};opacity:0;pointer-events:none;transition:left .08s"></div>`;
    if (showWave) h += `<canvas id="tab-wave" width="${laneW()}" height="${WAVE_H}" style="display:block;width:${laneW()}px;height:${WAVE_H}px;cursor:pointer"></canvas>`
                    + `<div id="tab-waveph" style="position:absolute;left:-50px;top:${laneH() + (showGrid ? midiH() : 0)}px;width:2px;height:${WAVE_H}px;background:${ACC};opacity:0;pointer-events:none;transition:left .08s"></div>`;
    h += `</div></div>`;
    h += `</div>`;
    h += `<div class="mono" style="color:#3f3626;font-size:calc(8px*var(--ui));text-align:center">tap any lane to put that step on the instrument below · 🎹 roll colours are the app's 12-note spectrum, same code as the 🌈 neck view and the Circle pedal</div>`;
  } else {
    h += `<div class="mono" style="color:#5a4f38;font-size:calc(11px*var(--ui));text-align:center;padding:40px 10px;line-height:1.8">Open a song — your transcriptions, sketches and text songs are all here.<br>Or 📋 paste an ASCII tab straight in.</div>`;
  }
  h += `</div>`;

  el.innerHTML = h;
  applyNeck();

  // wire
  const qsa = sel => [...el.querySelectorAll(sel)];
  document.getElementById('tabp-src')?.addEventListener('change', e => { if (e.target.value) loadSource(e.target.value); });
  document.getElementById('tabp-new')?.addEventListener('click', () => {
    setSong(blankSong());
    T.caret = 0;
    setEdit(true);          // a blank page is only useful with the caret already live
  });
  document.getElementById('tabp-paste')?.addEventListener('click', () => { T.pasting = !T.pasting; render(); });
  document.getElementById('tabp-cancel')?.addEventListener('click', () => { T.pasting = false; render(); });
  document.getElementById('tabp-load')?.addEventListener('click', () => {
    const res = parseAsciiTab(document.getElementById('tabp-ta')?.value || '');
    if (!res?.columns?.length) return;
    T.pasting = false;
    setSong({ name: 'Pasted tab', steps: res.columns.map(c => ({ notes: Object.entries(c.notes).map(([si, fret]) => ({ si: +si, fret })), dur: 1 })), sections: [], about: 'ASCII import — every column is a quarter note', tsig: 4, bpm: 90 });
  });
  [0, 1, 2].forEach(z => document.getElementById(`tabp-z${z}`)?.addEventListener('click', () => { T.zoom = z; render(); }));
  document.getElementById('tabp-play')?.addEventListener('click', togglePlay);
  document.getElementById('tabp-loop')?.addEventListener('click', () => { T.loop = !T.loop; render(); });
  document.getElementById('tabp-listen')?.addEventListener('click', async () => {
    T.listen = !T.listen;
    if (T.playing || T.listening || T.counting) stopPlay();
    if (T.listen && !audio.connected) { try { await audio.connect(); } catch (e) { /* user declined — the strip offers a retry */ } }
    render();
  });
  document.getElementById('tabp-click')?.addEventListener('click', () => {
    T.click = !T.click;
    if (T.click) { needMetronome(); if (T.playing) metroReq('start'); } else clickOff();
    render();
  });
  document.getElementById('tabp-metro')?.addEventListener('click', needMetronome);
  document.getElementById('tabp-count')?.addEventListener('click', () => { T.countIn = !T.countIn; render(); });
  document.getElementById('tabp-staff')?.addEventListener('click', () => { T.staff = !T.staff; render(); });
  document.getElementById('tabp-neck')?.addEventListener('click', () => { T.neck = !T.neck; render(); });
  // ── ✎ write-mode controls ──
  document.getElementById('tabp-edit')?.addEventListener('click', () => setEdit(!T.edit));
  qsa('.tabp-dur').forEach(b => b.addEventListener('click', () => setPendingDur(+b.dataset.b)));
  document.getElementById('tabp-dot') ?.addEventListener('click', () => { T.dotted = !T.dotted; setPendingDur(T.dur); });
  document.getElementById('tabp-trip')?.addEventListener('click', () => { T.triplet = !T.triplet; setPendingDur(T.dur); });
  document.getElementById('tabp-fromneck')?.addEventListener('click', insertFromNeck);
  document.getElementById('tabp-arp-up')?.addEventListener('click', () => arpeggiate('up'));
  document.getElementById('tabp-arp-dn')?.addEventListener('click', () => arpeggiate('down'));
  document.getElementById('tabp-arp-ud')?.addEventListener('click', () => arpeggiate('updown'));
  document.getElementById('tabp-copy')?.addEventListener('click', () => copyRange(false));
  document.getElementById('tabp-cut')  ?.addEventListener('click', () => copyRange(true));
  document.getElementById('tabp-paste2')?.addEventListener('click', pasteAtCaret);
  document.getElementById('tabp-tsig')?.addEventListener('change', e => {
    T.song.tsig = +e.target.value;
    metroClock.set(T.bpm, T.song.tsig);      // the click counts the same bar you write
    redraw();
  });
  document.getElementById('tabp-lock')?.addEventListener('click', commitBeat);
  document.getElementById('tabp-rest')?.addEventListener('click', () => { caretStep().notes = []; commitBeat(); });
  document.getElementById('tabp-back')?.addEventListener('click', caretBack);
  document.getElementById('tabp-fwd') ?.addEventListener('click', caretFwd);
  document.getElementById('tabp-del') ?.addEventListener('click', deleteAtCaret);
  const titleEl = document.getElementById('tabp-title');
  titleEl?.addEventListener('input', () => { T.song.name = titleEl.value; });
  // renaming is only real once it is written back, so Enter saves
  titleEl?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { titleEl.blur(); keepPiece(); redraw(); }
  });
  document.getElementById('tabp-keep')?.addEventListener('click', () => {
    const r = keepPiece();
    if (!r) return;
    const b = document.getElementById('tabp-keep');
    if (b) b.textContent = r.ok ? (r.msg === 'updated' ? '✓ Updated' : '✓ Saved') : '⚠ ' + r.msg;
    setTimeout(() => { if (T.edit) redraw(); }, 1000);
  });
  document.getElementById('tabp-delpiece')?.addEventListener('click', () => {
    const b = document.getElementById('tabp-delpiece');
    // two-press delete: the first press asks, the second does it
    if (b && b.dataset.armed !== '1') {
      b.dataset.armed = '1'; b.textContent = '🗑 sure?';
      setTimeout(() => { if (document.getElementById('tabp-delpiece') === b) { b.dataset.armed = '0'; b.textContent = '🗑'; } }, 2500);
      return;
    }
    deletePiece();
    redraw();
  });
  document.getElementById('tabp-grid')?.addEventListener('click', () => { T.grid = !T.grid; render(); });
  document.getElementById('tabp-wave')?.addEventListener('click', () => {
    if (!T.wave) { document.getElementById('tabp-file')?.click(); return; }   // nothing loaded yet — pick a take
    T.waveShow = !T.waveShow; render();
  });
  document.getElementById('tabp-file')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) loadAudioFile(f);
  });
  [['tabp-woff-m50', -50], ['tabp-woff-m5', -5], ['tabp-woff-p5', 5], ['tabp-woff-p50', 50]].forEach(([id, d]) =>
    document.getElementById(id)?.addEventListener('click', () => setWaveOff(T.waveOff + d / 1000)));
  const woffEl = document.getElementById('tabp-woff');
  woffEl?.addEventListener('input', () => { const v = parseFloat(woffEl.value); if (!isNaN(v)) setWaveOff(v / 1000); });
  woffEl?.addEventListener('keydown', e => { if (e.key === 'Enter') woffEl.blur(); e.stopPropagation(); });
  document.getElementById('tabp-wsnap')?.addEventListener('click', snapFirstSound);
  document.getElementById('tabp-wclear')?.addEventListener('click', () => { T.wave = null; T.waveOff = 0; T.waveErr = ''; render(); });
  document.getElementById('tab-wave')?.addEventListener('click', e => {
    const xs = stepXs();
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - e.offsetX) < Math.abs(xs[best] - e.offsetX)) best = i;
    previewStep(best);
  });
  // the shared tempo control reads AND writes metroClock, which T.bpm already is —
  // no local mirror to keep, and the % chips below write through the same clock
  wireMasterTempo('tabpage');
  qsa('.tabp-pct').forEach(b => b.addEventListener('click', () => setBpm((T.origBpm || T.bpm) * (+b.dataset.p / 100))));
  document.getElementById('tabp-whole')?.addEventListener('click', () => { T.range = null; if (T.playing || T.counting) stopPlay(); render(); });
  const setRange = (a, b) => {
    T.range = [Math.max(0, Math.min(a, b)), Math.min(T.song.steps.length - 1, Math.max(a, b))];
    if (T.playing || T.counting) stopPlay();
    render();
    const xs = stepXs(); const wrap = document.getElementById('tab-scroll');
    if (wrap && xs[T.range[0]] != null) wrap.scrollLeft = Math.max(0, xs[T.range[0]] - 40);
  };
  document.getElementById('tabp-ra')?.addEventListener('click', () => setRange(T.sel, T.range ? T.range[1] : T.song.steps.length - 1));
  document.getElementById('tabp-rb')?.addEventListener('click', () => setRange(T.range ? T.range[0] : 0, T.sel));
  qsa('.tabp-sec').forEach(b => b.addEventListener('click', () => {
    T.range = [+b.dataset.a, +b.dataset.b];
    if (T.playing) stopPlay();
    render();
    const xs = stepXs(); const wrap = document.getElementById('tab-scroll');
    if (wrap && xs[T.range[0]] != null) wrap.scrollLeft = Math.max(0, xs[T.range[0]] - 40);
  }));
  // every lane in both blocks — notation, roll, waveform — puts a step on the neck
  // In write mode a lane click MOVES THE CARET there — that is how you go back and
  // fix a beat. Otherwise it previews the step on the neck as before.
  qsa('.tab-hit').forEach(r => r.addEventListener('click', () => {
    const i = +r.dataset.i;
    if (T.edit) { T.caret = i; redraw(); } else previewStep(i);
  }));
  syncTransport();
  drawWave();          // the canvas only exists after the innerHTML swap
}

export function initTabMode() {
  if (!T._wired) {
    T._wired = true;
    // SPACE toggles play whenever the TAB page is showing (and no field is focused)
    document.addEventListener('keydown', e => {
      if (!alive()) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // In write mode the keyboard is a note-entry keypad: SPACE locks the beat,
      // arrows walk it, 1–5 pick the note value, . dots it.
      if (T.edit) {
        if (e.code === 'Space')      { e.preventDefault(); commitBeat(); return; }
        if (e.code === 'ArrowRight') { e.preventDefault(); caretFwd(); return; }
        if (e.code === 'ArrowLeft')  { e.preventDefault(); caretBack(); return; }
        if (e.code === 'Backspace' || e.code === 'Delete') { e.preventDefault(); deleteAtCaret(); return; }
        if (e.code === 'Period')     { e.preventDefault(); T.dotted = !T.dotted; setPendingDur(T.dur); return; }
        const n = '12345'.indexOf(e.key);
        if (n >= 0) { e.preventDefault(); setPendingDur(NOTE_VALUES[n].beats); return; }
        if (e.code === 'Escape')     { e.preventDefault(); setEdit(false); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); copyRange(false); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyX') { e.preventDefault(); copyRange(true);  return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); pasteAtCaret();   return; }
        return;
      }
      if (e.code !== 'Space') return;
      e.preventDefault(); togglePlay();
    });
    // (playPlan's `resonote:played` broadcast is what the 🔮 Circle pedal listens to
    // — the page no longer needs a hook of its own.)
    // Tempo set on the Metronome pedal (or any linked pedal) IS this page's tempo.
    metroClock.on(() => { if (alive() && T.song) onTempoChanged(); });
    // dev/test hook: window.__tabLoadAudioUrl('/take.wav') — no file dialog
    window.__tabLoadAudioUrl = async url => {
      const ab = await (await fetch(url)).arrayBuffer();
      await loadAudioFile({ name: url.split('/').pop(), arrayBuffer: () => Promise.resolve(ab) });
      return T.wave && { name: T.wave.name, duration: T.wave.duration, sr: T.wave.sr };
    };
    // 🎤 listen mode: your playing drives the playhead
    tabGate = expectNotes({
      want: () => stepNotes(T.playIdx),
      isActive: () => T.listening && alive(),
      onProgress: () => refreshListenStrip(),
      onComplete: () => {
        // confirm the step back, then move on
        (T.song.steps[T.playIdx]?.notes || []).forEach((n, k) => {
          const p = posOf(n.si, n.fret);
          setTimeout(() => playNote(p.note, p.octave, { dur: 0.35, gain: 0.13 }), k * 25);
        });
        setTimeout(() => { if (T.listening) listenNext(); }, 220);
      },
    });
  }
  // default to the first transcription on first open
  if (!T.song && REF_SKETCHES.length) {
    const e = REF_SKETCHES[Math.min(1, REF_SKETCHES.length - 1)];
    T.song = { name: e.name, steps: JSON.parse(JSON.stringify(e.steps)), sections: e.sections || [], about: e.about || '', tsig: e.tsig || 4, bpm: e.bpm || 90 };
    T.bpm = e.bpm || 90; T.origBpm = T.bpm;
  }
  render();
}
