// ── Tiny chord/voice synth ───────────────────────────────────────────
// A single shared AudioContext that voices chords as gently-strummed
// triangle tones. Used by the Chord-Family Lab to "reveal" a chord's colour
// and to play tension → resolution. Kept deliberately simple (no samples).
import { NOTES } from './music-theory.js';
import { bus } from './mixer.js';

let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function freqOf(note, octave) {
  return 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (octave - 4));
}

// Voice an array of pitch-class note names upward from a base octave so the
// chord rises naturally instead of jumping around.
export function voiceUp(notes, baseOct = 3) {
  const out = [];
  let oct = baseOct, prev = -1;
  notes.forEach(n => {
    const idx = NOTES.indexOf(n);
    if (idx <= prev) oct++;
    out.push({ note: n, octave: oct });
    prev = idx;
  });
  return out;
}

// Play a chord (array of pitch-class note names). Returns the note duration (s).
export function playChordNotes(notes, opts = {}) {
  if (!notes || !notes.length) return 0;
  const { baseOct = 3, dur = 1.4, strum = 0.04, wave = 'triangle', gain = 0.15, bass = true } = opts;
  const c = ctx();
  const t0 = c.currentTime + 0.02;
  const voiced = voiceUp(notes, baseOct);
  if (bass) voiced.unshift({ note: notes[0], octave: baseOct - 1 });
  voiced.forEach((v, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = wave;
    o.frequency.value = freqOf(v.note, v.octave);
    const st = t0 + i * strum;
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(gain, st + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0008, st + dur);
    o.connect(g); g.connect(bus(c, 'notes'));
    o.start(st); o.stop(st + dur + 0.05);
  });
  return dur;
}

// Play a single sustained note (used for "play the color tone" reference).
export function playNote(note, octave = 3, opts = {}) {
  return playChordNotes([note], { baseOct: octave, bass: false, strum: 0, dur: opts.dur || 0.9, gain: opts.gain || 0.22 });
}
