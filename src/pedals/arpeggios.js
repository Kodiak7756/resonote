// ════════════════════════════════════════════════════════════════════
//  Arpeggios — arpeggio sweep positions + magenta box RENDERING for the
//  Scale & Arpeggio Explorer.
//
//  The general scale-box ENGINE lives in core/voicings.js (single source of
//  truth). Arpeggios keep ONE thing of their own: buildSweepArpeggioBoxes,
//  which produces one-note-per-string sweep fingerings voicings.js doesn't
//  model. findScaleBoxes here runs the sweep builder for arpeggio lookups
//  ({arpCat,arpName} present) and delegates everything else to voicings.js.
//
//  (Until 2026-06-14 this file carried a full stale copy of the pre-fix CAGED
//  engine; it was removed — only the sweep builder + renderers remain.)
// ════════════════════════════════════════════════════════════════════
import { NOTES, intervalLabel } from '../core/music-theory.js';
import { currentInstrument, customTuning, getInst, getNoteAtFret } from '../core/tuning.js';
import { showIntervals } from '../core/state.js';
import {
  findScaleBoxes as coreFindScaleBoxes,
  getDisplayPositionsForBox as coreGetDisplayPositionsForBox,
} from '../core/voicings.js';

// ─── Arpeggio type definitions ───────────────────────────────────────────────

export const ARP_TYPES = {
  Triads: {
    Major:  [0, 4, 7],
    Minor:  [0, 3, 7],
    Dim:    [0, 3, 6],
    Aug:    [0, 4, 8],
    Sus2:   [0, 2, 7],
    Sus4:   [0, 5, 7],
  },
  '7ths': {
    Maj7:   [0, 4, 7, 11],
    Dom7:   [0, 4, 7, 10],
    Min7:   [0, 3, 7, 10],
    Dim7:   [0, 3, 6,  9],
    'm7♭5': [0, 3, 6, 10],
    mMaj7:  [0, 3, 7, 11],
  },
  Other: {
    '6':    [0, 4, 7,  9],
    Min6:   [0, 3, 7,  9],
    Aug7:   [0, 4, 8, 10],
  },
};

export const ARP_COLORS = {
  root:       '#cc66aa',
  tone:       '#884477',
  rootStroke: '#ee88cc',
  toneStroke: '#aa5588',
};

// ─── Enharmonic / display helpers ────────────────────────────────────────────

const ENHARMONIC = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
  'E#': 'F', 'B#': 'C',
};

function toSharp(n) {
  return ENHARMONIC[n] || n;
}

/** Show interval label when the global toggle is on, otherwise raw note name. */
function displayLabel(note, rootNote) {
  if (showIntervals && rootNote) return intervalLabel(rootNote, note);
  return note;
}

// ─── Piano / keyboard constants ───────────────────────────────────────────────

const PIANO_BLACK = [1, 3, 6, 8, 10]; // semitone indices for C# D# F# G# A#

// ─── Instrument / context helpers ─────────────────────────────────────────────

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

// ─── Sweep arpeggio position builder ─────────────────────────────────────────
//
// Produces one-note-per-string sweep patterns (e.g. 1-3-5-1-3-5 for major).
//
// Strategy:
//   1. Find every arpeggio-tone occurrence on the lowest string — each becomes
//      an anchor for one sweep position.
//   2. From each anchor, walk string-by-string toward the highest string,
//      picking the single arpeggio note closest to the previous string's fret
//      within a ±search window.  This naturally produces sweep fingerings.
//   3. Deduplicate, drop any sweep missing the root, and label the survivors.
//
// No canonical template needed — works for any root / arpeggio type / tuning.

function buildSweepArpeggioBoxes(root, intervals) {
  if (!customTuning.length || !intervals.length) return null;
  const ns      = customTuning.length;
  const nf      = getInst().frets;
  const rootIdx = NOTES.indexOf(root);
  const allowed = new Set(intervals);

  // ── Step 1: anchors on the lowest string ──
  const lowestSi = ns - 1;
  const anchors  = [];
  for (let fret = 0; fret <= nf; fret++) {
    const info = getNoteAtFret(customTuning[lowestSi].note, customTuning[lowestSi].octave, fret);
    const deg  = (NOTES.indexOf(info.note) - rootIdx + 12) % 12;
    if (!allowed.has(deg)) continue;
    anchors.push({
      si: lowestSi, fret,
      note:   info.note,
      octave: info.octave,
      midi:   info.octave * 12 + NOTES.indexOf(info.note),
      isRoot: info.note === root,
      deg,
    });
  }
  if (!anchors.length) return null;

  // ── Step 2: build a sweep from each anchor ──
  const sweepBoxes = [];

  for (const anchor of anchors) {
    const positions = [anchor];
    let prevFret    = anchor.fret;

    for (let si = lowestSi - 1; si >= 0; si--) {
      const candidates = [];
      // Window: 3 frets back (sweep can fold slightly) to 8 frets forward.
      // This covers all standard-tuning inter-string intervals (3–5 semitones).
      for (let fret = Math.max(0, prevFret - 3); fret <= Math.min(nf, prevFret + 8); fret++) {
        const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
        const deg  = (NOTES.indexOf(info.note) - rootIdx + 12) % 12;
        if (!allowed.has(deg)) continue;
        const midi = info.octave * 12 + NOTES.indexOf(info.note);
        candidates.push({ si, fret, note: info.note, octave: info.octave, midi, isRoot: info.note === root, deg });
      }
      if (!candidates.length) continue;

      // Closest fret to prevFret; tie-break towards higher MIDI pitch.
      candidates.sort((a, b) =>
        Math.abs(a.fret - prevFret) - Math.abs(b.fret - prevFret) || a.midi - b.midi
      );
      const best = candidates[0];
      positions.push(best);
      prevFret = best.fret;
    }

    // Need at least half the strings covered
    if (positions.length < Math.max(3, Math.ceil(ns * 0.5))) continue;

    const lo = Math.min(...positions.map(p => p.fret));
    const hi = Math.max(...positions.map(p => p.fret));
    sweepBoxes.push({
      sf: lo, lo, hi,
      label:      `Pos ${sweepBoxes.length + 1}`,
      positions:  positions.slice().sort((a, b) => b.si - a.si || a.fret - b.fret),
      totalNotes: positions.length,
      canonical:  true,
      sweep:      true,
    });
  }

  // ── Step 3: deduplicate, then drop any sweep that doesn't contain the root ──
  // A card labelled as the chord's arpeggio with no root is misleading, so we
  // never render a rootless sweep (the all-notes fretboard highlight is complete).
  const seen   = new Set();
  const unique = [];
  for (const box of sweepBoxes) {
    const sig = box.positions.map(p => `${p.si}:${p.fret}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (!box.positions.some(p => p.isRoot)) continue;
    unique.push(box);
  }

  // Re-label survivors
  unique.forEach((box, i) => { box.label = `Pos ${i + 1}`; });

  return unique.length >= 2 ? unique : null;
}

// ─── Main scale/arpeggio box finder ───────────────────────────────────────────
//
// Arpeggio lookups (the live consumer always passes {arpCat,arpName}) get
// instrument-agnostic sweep cards; everything else — and the keyboard renderer —
// delegates to the shared scale-box engine in core/voicings.js.

export function findScaleBoxes(root, intervals, opts = {}) {
  if (getInst().renderer === 'keyboard') return coreFindScaleBoxes(root, intervals, opts);
  if (opts.arpCat || opts.arpName) {
    const sweepBoxes = buildSweepArpeggioBoxes(root, intervals);
    if (sweepBoxes && sweepBoxes.length) return sweepBoxes;
  }
  return coreFindScaleBoxes(root, intervals, opts);
}

// ─── Display positions for fretboard highlight ────────────────────────────────

export const getDisplayPositionsForBox = coreGetDisplayPositionsForBox;

// ─── Keyboard box diagram renderer ────────────────────────────────────────────

function renderKeyboardBoxDiagram(box, root, isActive, theme) {
  const colorRoot = theme.root;
  const colorTone = theme.tone;
  const border    = isActive ? theme.border    : '#444';
  const bg        = isActive ? theme.bgActive  : 'rgba(255,255,255,.03)';

  const keys = [];
  for (let o = box.lo; o <= box.hi; o++) {
    ['C', 'D', 'E', 'F', 'G', 'A', 'B'].forEach(n => keys.push({ note: n, octave: o, isBlack: false }));
  }

  const xForWhite  = i => 10 + i * 9;
  const whiteCount = keys.length;
  const w = whiteCount * 9 + 20;
  const h = 64;

  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="${border}" stroke-width="1"/>`;
  s += `<text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-size="6" font-family="'JetBrains Mono',monospace" fill="#555">${box.label}</text>`;

  // White keys
  keys.forEach((k, i) => {
    s += `<rect x="${xForWhite(i)}" y="10" width="8" height="36" rx="1.5" fill="#f4f4f4" stroke="#666" stroke-width="0.7"/>`;
  });

  // Black keys and their note labels
  const blackOffsets = { C: 0.68, D: 1.68, F: 3.68, G: 4.68, A: 5.68 };
  keys.forEach((k, i) => {
    const next = keys[i + 1];
    if (!next || !Object.prototype.hasOwnProperty.call(blackOffsets, k.note)) return;
    const noteSharp = toSharp(k.note + '#');
    const pos       = box.positions.find(p => p.note === noteSharp && p.octave === k.octave);
    const bx        = xForWhite(i) + blackOffsets[k.note] * 9 - 5;
    const fill      = pos ? (pos.isRoot ? colorRoot : colorTone) : '#111';
    const opacity   = pos ? 0.95 : 1;
    s += `<rect x="${bx}" y="10" width="6" height="22" rx="1.5" fill="${fill}" opacity="${opacity}" stroke="#000" stroke-width="0.6"/>`;
    if (pos) {
      const dl = pos.isRoot ? 'R' : displayLabel(pos.note, root);
      s += `<text x="${bx + 3}" y="26" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
    }
  });

  // White key note dots
  box.positions.filter(p => !PIANO_BLACK.includes(NOTES.indexOf(p.note))).forEach(p => {
    const idx = keys.findIndex(k => k.note === p.note && k.octave === p.octave);
    if (idx < 0) return;
    const x     = xForWhite(idx) + 4;
    const y     = 38;
    const isRoot = p.isRoot;
    const dl    = isRoot ? 'R' : displayLabel(p.note, root);
    s += `<circle cx="${x}" cy="${y}" r="4.2" fill="${isRoot ? colorRoot : colorTone}"/>`;
    s += `<text x="${x}" y="${y + 2}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
  });

  s += '</svg>';
  return s;
}

// ─── Arpeggio fretboard box diagram renderer ──────────────────────────────────

export function renderArpBoxDiagram(box, root, isActive) {
  if (getInst().renderer === 'keyboard') {
    return renderKeyboardBoxDiagram(box, root, isActive, {
      root:     '#cc66aa',
      tone:     '#884477',
      border:   '#cc66aa',
      bgActive: 'rgba(204,102,170,.1)',
    });
  }

  const ns       = customTuning.length;
  const startFret = box.lo;
  const numFrets  = box.hi - box.lo + 1;
  const extended  = isExtendedCanonicalStringContext();
  const strW      = extended ? (ns <= 4 ? 18 : 12) : (ns <= 4 ? 12 : ns <= 6 ? 10 : 8);
  const w         = extended ? (24 + ns * strW) : (14 + ns * strW);
  const h         = (extended ? 22 : 18) + numFrets * 14 + 12;
  const sx        = 14;
  const sy        = 18;
  const sw        = (ns - 1) * strW;
  const fh        = (h - sy - 10) / numFrets;
  const bdr       = isActive ? '#cc66aa' : '#444';
  const bg        = isActive ? 'rgba(204,102,170,.1)' : 'rgba(255,255,255,.03)';

  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="${bdr}" stroke-width="1"/>`;
  s += `<text x="${w / 2}" y="${h - 2}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" fill="#555">${box.label}</text>`;

  // Nut or fret number
  if (startFret === 0) {
    s += `<rect x="${sx - 2}" y="${sy - 2}" width="${sw + 4}" height="3" rx="1" fill="#ccc"/>`;
  } else {
    s += `<text x="4" y="${sy + fh / 2 + 3}" font-size="6" font-family="'JetBrains Mono',monospace" fill="#888">${startFret}fr</text>`;
  }

  // Fret lines
  for (let f = 0; f <= numFrets; f++) {
    s += `<line x1="${sx}" y1="${sy + f * fh}" x2="${sx + sw}" y2="${sy + f * fh}" stroke="#555" stroke-width="${f === 0 ? 1.5 : 0.6}"/>`;
  }

  // String lines
  for (let i = 0; i < ns; i++) {
    s += `<line x1="${sx + i * strW}" y1="${sy}" x2="${sx + i * strW}" y2="${sy + numFrets * fh}" stroke="#777" stroke-width="${0.4 + (ns - 1 - i) * 0.12}"/>`;
  }

  // Note dots
  box.positions.forEach(p => {
    const x    = sx + (ns - 1 - p.si) * strW;
    const fy   = sy + (p.fret - startFret) * fh + fh / 2;
    const isR  = p.isRoot;
    const dl   = isR ? 'R' : displayLabel(p.note, root);
    s += `<circle cx="${x}" cy="${fy}" r="4.5" fill="${isR ? '#cc66aa' : '#884477'}"/>`;
    s += `<text x="${x}" y="${fy + 2.5}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
  });

  s += '</svg>';
  return s;
}
