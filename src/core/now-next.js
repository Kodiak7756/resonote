// Now & Next — the chord to play now, the one coming next, and how many beats
// until the change. One small shared record, read by the Now & Next pedal
// (pedals/now-next-coach.js) wherever it is open: on the board, in a pop-out,
// or as a window in the headset.
//
// WHO WRITES IT. A pedal that plays chords in time hands over what it is
// playing, a few lines each: the Backing Track (with chords), the Workouts
// Chord Trainer, an Improv Lab jam, Progression Studio. Each one clears it
// when it stops. Whichever pedal STARTED most recently owns the record, so two
// running at once never flicker between each other.
//
// HOW IT TRAVELS. The window a feeder runs in (normally the PC's main window)
// publishes every change with sync's generic post('nownext'); every other
// window applies what arrives and never sends it back out. A window that opens
// later (a pop-out, a headset window) asks with post('nownext?') and the PC's
// main window answers it directly. A received record that stops being renewed
// while it is counting beats is dropped, so a sleeping headset or a lost
// message can never leave a frozen countdown on screen.
//
// WHAT IT HOLDS (null when nothing is playing):
//   { now:  chord, next: chord | null,
//     beatsLeft      beats until the change, counting this one (null = no clock: it waits for you)
//     beatsPerChord  how long the current chord lasts, in beats
//     beat           the beat within the bar, 0-based
//     beatsPerBar
//     bpm, source }  source = the feeding pedal's type ('beatmaker', 'workouts', …)
//   chord = { name, root, quality, notes:[…], numeral?, hint?, grip: { ns, cells:[{si,fret,note}] } | null }
// The grip is worked out HERE, in the feeding window, from that window's
// tuning — so the headset draws the same grip the PC's neck is using, whatever
// its own browser has saved.

import { post, onSyncMessage, isMainWindow, onPcLink } from './sync.js';
import { NOTES, CHORD_TYPES, toSharp, getChordNotes } from './music-theory.js';
import { customTuning, getInst, getNoteAtFret } from './tuning.js';
import { pickGrip } from './voicings.js';

let state = null;
let fromHere = false;          // the record was fed in this window (not received)
let lastHeard = 0;             // when a received record was last renewed
const fns = [];

export const getNowNext = () => state;

// Subscribe; returns the unsubscribe.
export function onNowNext(fn) {
  fns.push(fn);
  return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); };
}

function setState(s, local) {
  state = s || null;
  fromHere = !!local;
  if (!local) lastHeard = Date.now();
  fns.slice().forEach(fn => { try { fn(state); } catch (e) { console.warn(e); } });
  if (local) post('nownext', { state });
  if (!local && state) watchStale();
}

// ── Feeding ──────────────────────────────────────────────────────────
const live = new Set();        // feeders that have started and not cleared, in this window
let owner = null;

// A feeder says what it is playing. now / next are chord-ish objects:
// { root, quality?, notes?, name?, numeral?, hint?, positions? } — positions,
// when the feeder already has the exact grip it lit on the neck.
export function feedNowNext(source, { now, next = null, beatsLeft = null, beatsPerChord = null, beat = 0, beatsPerBar = 4, bpm = null } = {}) {
  if (!now) return;
  if (!live.has(source)) live.add(source);              // a fresh start takes over…
  else if (owner && owner !== source) return;           // …until another pedal starts after it
  owner = source;
  const n = chordOf(now);
  if (!n) return;
  const x = next ? chordOf(next) : null;
  setState({
    now: n,
    next: x && x.name !== n.name ? x : null,
    beatsLeft: x && Number.isFinite(beatsLeft) ? Math.max(1, Math.round(beatsLeft)) : null,
    beatsPerChord: Number.isFinite(beatsPerChord) ? Math.round(beatsPerChord) : null,
    beat: Math.max(0, Math.round(beat) || 0),
    beatsPerBar: Math.max(1, Math.round(beatsPerBar) || 4),
    bpm: bpm ? Math.round(bpm) : null,
    source,
  }, true);
}

// Playback stopped. Only the pedal that owns the record can clear it.
export function clearNowNext(source) {
  stopChordClock(source);
  live.delete(source);
  if (owner !== source) return;
  owner = null;
  setState(null, true);
}

// A loop laid out one entry per beat: a chord where one starts, null where the
// one before it is still sounding (Progression Studio's grid is exactly this;
// the Backing Track's bars become it). `at` is the beat now playing. Two
// neighbouring cells with the same chord count as one chord.
export function feedLoop(source, cells, at, { beatsPerBar = 4, bpm = null } = {}) {
  const n = cells?.length || 0;
  if (!n) return;
  const ix = i => ((i % n) + n) % n;
  const key = c => (c ? chordKey(c) : null);
  let back = 0;
  while (back < n && !cells[ix(at - back)]) back++;
  if (back >= n) return;
  let start = at - back;
  const now = cells[ix(start)], nk = key(now);
  // where this chord began (a repeat of it just before counts as the same chord)
  for (let guard = 0; guard < n; guard++) {
    let m = 1;
    while (m < n && !cells[ix(start - m)]) m++;
    if (m >= n || key(cells[ix(start - m)]) !== nk || at - (start - m) >= n) break;
    start -= m;
  }
  // the first beat that starts a different chord
  let ahead = 0, next = null;
  for (let j = 1; j < n; j++) {
    const c = cells[ix(at + j)];
    if (c && key(c) !== nk) { ahead = j; next = c; break; }
  }
  feedNowNext(source, {
    now, next,
    beatsLeft: next ? ahead : null,
    beatsPerChord: next ? ahead + (at - start) : n,
    beat: ix(at) % beatsPerBar, beatsPerBar, bpm,
  });
}

// For a pedal that keeps its own timers and only knows when a chord STARTS
// (Improv Lab's jam): count the beats here, from the tempo, until it calls
// again. Counted from elapsed time rather than ticks, so a timer that fires a
// little early or late never shifts the count. If no new chord arrives two
// beats after the expected change, the pedal has gone quiet without saying so,
// and the record is cleared.
const clocks = new Map();
export function chordClock(source, { now, next = null, beats = 4, bpm = 90, beat0 = 0, beatsPerBar = 4 }) {
  stopChordClock(source);
  const t0 = performance.now(), ms = 60000 / Math.max(20, bpm || 90);
  const at = k => feedNowNext(source, { now, next, beatsLeft: beats - k, beatsPerChord: beats,
                                        beat: (beat0 + k) % beatsPerBar, beatsPerBar, bpm });
  at(0);
  clocks.set(source, setInterval(() => {
    const k = Math.round((performance.now() - t0) / ms);
    if (k > beats + 1) { clearNowNext(source); return; }
    if (k > 0 && k < beats) at(k);
  }, ms));
}
function stopChordClock(source) {
  const t = clocks.get(source);
  if (t) { clearInterval(t); clocks.delete(source); }
}

// ── Chords ───────────────────────────────────────────────────────────
const FORMULAS = [];           // [name, pitch-class set] in CHORD_TYPES order: triads first
Object.values(CHORD_TYPES).forEach(g => Object.entries(g).forEach(([q, iv]) =>
  FORMULAS.push([q, [...new Set(iv.map(i => i % 12))].sort((a, b) => a - b).join(',')])));
const SUFFIX = { Major: '', Minor: 'm', Dim: 'dim', Aug: 'aug', Sus2: 'sus2', Sus4: 'sus4', '5': '5',
  Maj7: 'maj7', '7 (Dom)': '7', Min7: 'm7', Dim7: 'dim7', 'm7♭5': 'm7♭5', Aug7: 'aug7', mMaj7: 'm(maj7)',
  AugMaj7: 'maj7♯5', Add9: 'add9', Min9: 'm9', Maj9: 'maj9', Min6: 'm6', Min11: 'm11', Maj13: 'maj13' };
const formulaOf = q => { for (const g of Object.values(CHORD_TYPES)) if (g[q]) return g[q]; return null; };

// The chord's real quality, read off its notes where it has them: the Backing
// Track names a blues I7 'Major', and a Workouts triad carries only its notes.
function qualityOf(root, notes, quality) {
  if (notes?.length) {
    const r = NOTES.indexOf(root);
    const set = [...new Set(notes.map(n => (NOTES.indexOf(toSharp(n)) - r + 12) % 12))].sort((a, b) => a - b).join(',');
    const hit = FORMULAS.find(([, f]) => f === set);
    if (hit) return hit[0];
  }
  return formulaOf(quality) ? quality : 'Major';
}
const chordKey = c => c.name || c.label || `${toSharp(c.root)}|${c.quality || ''}`;

function chordOf(c) {
  const root = toSharp(c.root || '');
  if (!NOTES.includes(root)) return null;
  const quality = qualityOf(root, c.notes, c.quality);
  const notes = c.notes?.length ? [...new Set(c.notes.map(toSharp))] : getChordNotes(root, formulaOf(quality) || [0, 4, 7]);
  return {
    name: root + (SUFFIX[quality] ?? quality),
    root, quality, notes,
    numeral: c.numeral || null,
    hint: c.hint || null,
    grip: gripOf(root, notes, quality, c.positions),
  };
}

// The grip to draw: the feeder's own when it has one (what the neck shows),
// else the app's usual open-position choice. Cached per chord and tuning.
const grips = new Map();
function gripOf(root, notes, quality, positions) {
  const ns = customTuning.length;
  if (getInst()?.renderer !== 'fretboard' || ns < 4 || ns > 8) return null;
  const cellsOf = list => list.filter(p => p && p.si >= 0 && p.si < ns && p.fret >= 0).map(p => ({
    si: p.si, fret: p.fret, note: toSharp(p.note || getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, p.fret).note),
  }));
  if (positions?.length) return { ns, cells: cellsOf(positions) };
  const k = `${root}|${quality}|${customTuning.map(s => s.note + s.octave).join('')}`;
  if (!grips.has(k)) {
    let g = null;
    try { g = pickGrip(root, notes, quality, 'open'); } catch (e) {}
    grips.set(k, g?.positions?.length ? { ns, cells: cellsOf(g.positions) } : null);
  }
  return grips.get(k);
}

// ── Receiving ────────────────────────────────────────────────────────
onSyncMessage(m => {
  if (m.kind === 'nownext') setState(m.state, false);
  else if (m.kind === 'nownext?') { if (isMainWindow()) post('nownext', { to: m.from, state }); }
  else if (m.kind === 'main-hello') askNowNext();       // the PC's main window (re)loaded
});

// A window that shows the record but does not own it asks the PC's main window
// what is playing: when a coach opens, and again when the PC comes back.
export function askNowNext() {
  if (!isMainWindow() && fns.length) post('nownext?');
}
let pcWas = false;
onPcLink(up => { if (up && !pcWas) askNowNext(); pcWas = up; });

let staleTimer = null;
function watchStale() {
  if (staleTimer) return;
  staleTimer = setInterval(() => {
    if (!state || fromHere) { clearInterval(staleTimer); staleTimer = null; return; }
    if (state.beatsLeft == null) return;                  // no clock to renew it (it waits for you)
    if (Date.now() - lastHeard > Math.max(4000, 4 * 60000 / (state.bpm || 90))) { setState(null, false); askNowNext(); }
  }, 1000);
}
