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
