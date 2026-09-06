// ════════════════════════════════════════════════════════════════════
//  Scale Explorer — scale-box RENDERING for the Scale & Arpeggio Explorer.
//
//  The box-finding ENGINE now lives ENTIRELY in core/voicings.js (the single
//  source of truth shared by every pedal). This file re-exports findScaleBoxes
//  and getDisplayPositionsForBox from there and keeps only the cyan scale-card
//  diagram renderers + colors.
//
//  (Until 2026-06-14 this file carried its own private CAGED engine — a stale
//  pre-fix copy that returned broken positions for natural/harmonic/melodic
//  minor & blues. It was removed in favour of the corrected voicings.js engine,
//  which the Technique Workshop / Position pedals already used.)
// ════════════════════════════════════════════════════════════════════
import { NOTES, intervalLabel } from '../core/music-theory.js';
import { currentInstrument, customTuning, getInst } from '../core/tuning.js';
import { showIntervals } from '../core/state.js';
import {
  findScaleBoxes as coreFindScaleBoxes,
  getDisplayPositionsForBox as coreGetDisplayPositionsForBox,
} from '../core/voicings.js';

// ── Module-private constants ──────────────────────────────────────────
const PIANO_BLACK = [1, 3, 6, 8, 10]; // C# D# F# G# A# semitones

const ENHARMONIC = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#',
  Cb: 'B', 'E#': 'F', 'B#': 'C'
};

// The NOTE DOTS on the neck and on these cards, not pedal chrome. Cyan for a
// scale against the Arpeggio pedal's magenta is the one place a saturated colour
// earns its keep here — it says "this is a scale", and it says it identically on
// the big fretboard and on the little cards. The card FRAME around them is chrome
// and reads from the kit tokens.
export const SCALE_COLORS = {
  root: '#44bbcc',
  tone: '#2a7a8a',
  rootStroke: '#66ddee',
  toneStroke: '#3a9aaa'
};

// ── Display helpers ───────────────────────────────────────────────────
function toSharp(n) {
  return ENHARMONIC[n] || n;
}

function displayLabel(note, rootNote) {
  if (showIntervals && rootNote) return intervalLabel(rootNote, note);
  return note;
}

// ── Instrument context (drives extended-instrument card layout) ───────
function isStandardBass4Context() {
  if (currentInstrument !== 'bass4' || customTuning.length !== 4) return false;
  const std = ['G2', 'D2', 'A1', 'E1'];
  return customTuning.every((s, i) => `${s.note}${s.octave}` === std[i]);
}

function isStandardGuitar8Context() {
  if (currentInstrument !== 'guitar8' || customTuning.length !== 8) return false;
  const std = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1', 'F#1'];
  return customTuning.every((s, i) => `${s.note}${s.octave}` === std[i]);
}

function isExtendedCanonicalStringContext() {
  return isStandardBass4Context() || isStandardGuitar8Context();
}

// ── Box-finding engine: delegated to the single source of truth ───────
export const findScaleBoxes = coreFindScaleBoxes;
export const getDisplayPositionsForBox = coreGetDisplayPositionsForBox;

// ── Keyboard box diagram ──────────────────────────────────────────────
// This one draws a PIANO, so its ivory, its key outline and its unlit black keys
// stay literal for the same reason the fretboard's wood does: they are a picture
// of an instrument, not chrome. The card frame around it is tokenised.
function renderKeyboardBoxDiagram(box, root, isActive, theme) {
  const colorRoot = theme.root;
  const colorTone = theme.tone;
  const border = isActive ? theme.border : 'var(--rk-edge-soft)';
  const bg = isActive ? theme.bgActive : 'var(--rk-panel2)';
  const keys = [];
  for (let o = box.lo; o <= box.hi; o++) {
    ['C', 'D', 'E', 'F', 'G', 'A', 'B'].forEach(n => keys.push({ note: n, octave: o, isBlack: false }));
  }
  const xForWhite = i => 10 + i * 9;
  const whiteCount = keys.length;
  const w = whiteCount * 9 + 20;
  const h = 64;
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="${border}" stroke-width="1"/>`;
  s += `<text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-size="6" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-mute)">${box.label}</text>`;
  keys.forEach((k, i) => {
    s += `<rect x="${xForWhite(i)}" y="10" width="8" height="36" rx="1.5" fill="#f4f4f4" stroke="#666" stroke-width="0.7"/>`;
  });
  const blackOffsets = { C: 0.68, D: 1.68, F: 3.68, G: 4.68, A: 5.68 };
  keys.forEach((k, i) => {
    const next = keys[i + 1];
    if (!next || !Object.prototype.hasOwnProperty.call(blackOffsets, k.note)) return;
    const noteSharp = toSharp(k.note + '#');
    const pos = box.positions.find(p => p.note === noteSharp && p.octave === k.octave);
    const bx = xForWhite(i) + blackOffsets[k.note] * 9 - 5;
    const fill = pos ? (pos.isRoot ? colorRoot : colorTone) : '#111';
    const opacity = pos ? 0.95 : 1;
    s += `<rect x="${bx}" y="10" width="6" height="22" rx="1.5" fill="${fill}" opacity="${opacity}" stroke="#000" stroke-width="0.6"/>`;
    if (pos) {
      const dl = pos.isRoot ? 'R' : displayLabel(pos.note, root);
      s += `<text x="${bx + 3}" y="26" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
    }
  });
  box.positions
    .filter(p => !PIANO_BLACK.includes(NOTES.indexOf(p.note)))
    .forEach(p => {
      const idx = keys.findIndex(k => k.note === p.note && k.octave === p.octave);
      if (idx < 0) return;
      const x = xForWhite(idx) + 4;
      const y = 38;
      const isRoot = p.isRoot;
      const dl = isRoot ? 'R' : displayLabel(p.note, root);
      s += `<circle cx="${x}" cy="${y}" r="4.2" fill="${isRoot ? colorRoot : colorTone}"/>`;
      s += `<text x="${x}" y="${y + 2}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
    });
  s += '</svg>';
  return s;
}

// ── Mini scale box diagram ────────────────────────────────────────────
export function renderScaleBoxDiagram(box, root, isActive) {
  // Anything that is not strings-and-frets gets the piano card: voicings.js
  // hands the keyboard AND the Lumatone hex grid octave-window boxes (lo/hi
  // octaves, note+octave positions, no fret), and the string diagram below
  // would read p.fret off them and draw a NaN-sized SVG. A pitch-ordered
  // octave strip is the honest picture of a scale on any isomorphic layout.
  const renderer = getInst().renderer;
  if (renderer === 'keyboard' || renderer === 'hex') {
    return renderKeyboardBoxDiagram(box, root, isActive, {
      root: SCALE_COLORS.root,
      tone: SCALE_COLORS.tone,
      border: 'var(--rk-accent)',
      bgActive: 'var(--rk-soft)'
    });
  }
  const ns = customTuning.length;
  const extended = isExtendedCanonicalStringContext();
  const isBass = currentInstrument === 'bass4';
  const cardPositions = box.positions || [];
  const startFret = Math.min(...cardPositions.map(p => p.fret));
  const hiFret = Math.max(...cardPositions.map(p => p.fret));
  const numFrets = Math.max(1, hiFret - startFret + 1);
  const strW = extended
    ? isBass ? 24 : ns <= 4 ? 18 : 12
    : ns <= 4 ? 12 : ns <= 6 ? 10 : 8;
  const leftPad = extended ? (isBass ? 24 : 18) : 14;
  const topPad = extended ? (isBass ? 26 : 22) : 18;
  const bottomPad = extended ? (isBass ? 18 : 16) : 10;
  const fretH = extended ? (isBass ? 14 : 16) : 14;
  const w = leftPad * 2 + (ns - 1) * strW;
  const h = topPad + numFrets * fretH + bottomPad;
  const sx = leftPad;
  const sy = topPad;
  const sw = (ns - 1) * strW;
  const fh = fretH;
  // Frame = chrome (the pedal's accent when the card is selected); dots = the
  // scale's own cyan, below.
  const bdr = isActive ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
  const bg = isActive ? 'var(--rk-soft)' : 'var(--rk-panel2)';
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  s += `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${bg}" stroke="${bdr}" stroke-width="1"/>`;
  if (extended) {
    s += `<text x="${w / 2}" y="10" text-anchor="middle" font-size="${isBass ? 7 : 6}" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-dim)">${box.label}</text>`;
    s += `<text x="${w / 2}" y="18" text-anchor="middle" font-size="${isBass ? 6 : 5}" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-mute)">Frets ${startFret}–${hiFret}</text>`;
    if (isBass) {
      s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-mute)">Root-to-root bass view</text>`;
    }
  } else {
    s += `<text x="${w / 2}" y="${h - 2}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-mute)">${box.label}</text>`;
  }
  if (startFret === 0) {
    s += `<rect x="${sx - 2}" y="${sy - 2}" width="${sw + 4}" height="3" rx="1" fill="var(--rk-ink)"/>`;
  } else {
    s += `<text x="4" y="${sy + fh / 2 + 3}" font-size="6" font-family="'JetBrains Mono',monospace" fill="var(--rk-ink-mute)">${startFret}fr</text>`;
  }
  for (let f = 0; f <= numFrets; f++) {
    s += `<line x1="${sx}" y1="${sy + f * fh}" x2="${sx + sw}" y2="${sy + f * fh}" stroke="var(--rk-edge)" stroke-width="${f === 0 ? 1.5 : 0.6}"/>`;
  }
  for (let i = 0; i < ns; i++) {
    const x = sx + i * strW;
    s += `<line x1="${x}" y1="${sy}" x2="${x}" y2="${sy + numFrets * fh}" stroke="var(--rk-ink-mute)" stroke-width="${extended ? (isBass ? 1.2 : 1) : 0.4 + (ns - 1 - i) * 0.12}"/>`;
  }
  cardPositions.forEach(p => {
    const x = sx + (ns - 1 - p.si) * strW;
    const fy = sy + (p.fret - startFret) * fh + fh / 2;
    const isR = p.isRoot;
    const dl = isR ? 'R' : displayLabel(p.note, root);
    s += `<circle cx="${x}" cy="${fy}" r="${extended ? (isBass ? 5.4 : 5) : 4.5}" fill="${isR ? SCALE_COLORS.root : SCALE_COLORS.tone}"/>`;
    s += `<text x="${x}" y="${fy + 2.5}" text-anchor="middle" font-size="${extended ? (isBass ? 5.8 : 5.5) : 5}" font-family="'JetBrains Mono',monospace" font-weight="700" fill="var(--rk-ink)">${dl}</text>`;
  });
  s += '</svg>';
  return s;
}
