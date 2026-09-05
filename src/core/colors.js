// ── The Resonote note spectrum ───────────────────────────────────────
// Every pitch class owns one hue, and the hues run around the wheel in
// FIFTHS order (C=0°, G=30°, D=60° … F=330°). Neighbouring keys are
// neighbouring colours, so diatonic material clusters into a colour family
// and a jump to a distant key reads as a jump across the spectrum.
//
// This is the app's ONE colour code: the fretboard legend, the 🌈 Spectrum
// neck view, both circles of fifths, and the ear trainer's colour-retrieval
// mode all import from here — no local palettes (a code that contradicts
// itself never gets learned). The note LETTER always rides with the colour;
// that letter is the redundant channel for colour-blind players.
import { toSharp } from './music-theory.js';

export const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
export const PC_HUE = {};
FIFTHS.forEach((n, i) => { PC_HUE[n] = i * 30; });

export const pcColor = (note, s = 78, l = 58) => `hsl(${PC_HUE[toSharp(note)] ?? 0},${s}%,${l}%)`;

// dark text reads better on the bright middle of the spectrum (yellows/greens)
export const pcTextOn = note => { const h = PC_HUE[toSharp(note)] ?? 0; return h >= 30 && h <= 110 ? '#141208' : '#fff'; };

// ── The interval ladder ───────────────────────────────────────────────
// A SECOND code, for a different question. The spectrum above answers "which
// note is this?" — identity — and it is a wheel, because pitch classes are a
// circle. The ⟡ Intervals view answers "what is this note DOING against the
// key?" — function — and function is not a circle, it is a ladder: from the
// root, which is home, out through the chord tones, the colour tones, and the
// notes that pull hardest to get back. So this is drawn as a ladder, and it
// deliberately looks like a different MATERIAL from the spectrum: earth and
// slate at ~45% saturation, never the spectrum's neon at 78%. Green on the neck
// can only ever mean E; a sage dot can only ever mean "the 4th". Two codes
// that cannot be mistaken for each other can both be learned.
//
// The rows are the musical grouping a player actually thinks in, warmest at the
// most stable and cooling as the pull increases; inside a row the major form is
// lighter than the minor so 3 vs ♭3 and 7 vs ♭7 read at a glance:
//   the frame     R · 5              golds
//   the quality   3 · ♭3             amber · terracotta
//   the pull      7 · ♭7             rose · wine
//   the colour    2 · 4 · 6          sage · teal-grey · olive
//   the outside   ♭2 · ♭5 · ♭6       slate · indigo · plum
// Indexed by semitones above the root, 0..11, like DEGREE_COLORS.
export const INTERVAL_COLORS = [
  '#f0c75e',  // 0  R    gold — home
  '#8c7fae',  // 1  ♭2   slate-violet
  '#a9bd74',  // 2  2    sage
  '#c9643f',  // 3  ♭3   terracotta
  '#e58a45',  // 4  3    amber
  '#78b39d',  // 5  4    teal-grey
  '#6e7ea9',  // 6  ♭5   indigo
  '#dba43e',  // 7  5    deep gold
  '#9c6f9e',  // 8  ♭6   plum
  '#b7b264',  // 9  6    olive
  '#b25b70',  // 10 ♭7   wine
  '#dc8aa0',  // 11 7    rose
];
// Dark ink on the light warm rungs, light ink on the dark cool ones.
export const INTERVAL_TEXT = INTERVAL_COLORS.map((_, i) => [0, 2, 4, 7, 9, 11].includes(i) ? '#151109' : '#f4f1ea');
export const INTERVAL_LABELS = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
export const intervalColor = deg => INTERVAL_COLORS[((deg % 12) + 12) % 12];
export const intervalTextOn = deg => INTERVAL_TEXT[((deg % 12) + 12) % 12];
