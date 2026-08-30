// ── Notes & Enharmonics ──────────────────────────────────────────────
export const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export const ENHARMONIC = {
  'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B','E#':'F','B#':'C'
};

export function toSharp(n) { return ENHARMONIC[n] || n; }
export function toFlat(n) {
  const m = {'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb'};
  return m[n] || n;
}
export function displayNoteName(n) { return n; }

// ── Chord Types ──────────────────────────────────────────────────────
// Intervals are semitones from the root. Values ≥12 (9th=14, 11th=17, 13th=21)
// fold to pitch-classes via getChordNotes; they're kept literal so a voicing
// engine / synth can place an extension in its proper octave when desired.
export const CHORD_TYPES = {
  'Triads': {
    'Major':[0,4,7], 'Minor':[0,3,7], 'Dim':[0,3,6], 'Aug':[0,4,8],
    'Sus2':[0,2,7], 'Sus4':[0,5,7], '5':[0,7]
  },
  '7ths': {
    'Maj7':[0,4,7,11], '7 (Dom)':[0,4,7,10], 'Min7':[0,3,7,10],
    'Dim7':[0,3,6,9], 'm7♭5':[0,3,6,10], 'Aug7':[0,4,8,10], 'mMaj7':[0,3,7,11],
    'AugMaj7':[0,4,8,11]
  },
  'Extended': {
    'Add9':[0,4,7,14], '9':[0,4,7,10,14], 'Min9':[0,3,7,10,14],
    'Maj9':[0,4,7,11,14], '6':[0,4,7,9], 'Min6':[0,3,7,9],
    '6/9':[0,4,7,9,14], '11':[0,7,10,14,17], 'Min11':[0,3,7,10,14,17],
    '13':[0,4,7,10,14,21], 'Maj13':[0,4,7,11,14,21]
  },
  // ── Beyond the 7th-chord ceiling: altered dominants ────────────────
  // The tension chords most apps never teach — a dominant 7 with one (or two)
  // chromatically-bent extensions. These are the engines of pull & release.
  'Altered': {
    '7♭5':[0,4,6,10], '7♯5':[0,4,8,10],
    '7♭9':[0,4,7,10,13], '7♯9':[0,4,7,10,15],
    '7♯11':[0,4,7,10,18], '7♭13':[0,4,7,10,20]
  }
};

// ── Key Patterns ─────────────────────────────────────────────────────
export const KEY_PATTERNS = {
  'Major':     { intervals:[0,2,4,5,7,9,11], qualities:['Major','Minor','Minor','Major','Major','Minor','Dim'],    numerals:['I','ii','iii','IV','V','vi','vii°'] },
  'Minor':     { intervals:[0,2,3,5,7,8,10], qualities:['Minor','Dim','Major','Minor','Minor','Major','Major'],   numerals:['i','ii°','III','iv','v','VI','VII'] },
  'Harm. Minor':{ intervals:[0,2,3,5,7,8,11], qualities:['Minor','Dim','Aug','Minor','Major','Major','Dim'],      numerals:['i','ii°','III+','iv','V','VI','vii°'] },
  'Dorian':    { intervals:[0,2,3,5,7,9,10], qualities:['Minor','Minor','Major','Major','Minor','Dim','Major'],   numerals:['i','ii','III','IV','v','vi°','VII'] }
};

// ── Scale Types ──────────────────────────────────────────────────────
export const SCALE_TYPES = {
  'Pentatonic': {
    'Major Pent.':[0,2,4,7,9],
    'Minor Pent.':[0,3,5,7,10]
  },
  'Blues': {
    'Blues Minor':[0,3,5,6,7,10],
    'Blues Major':[0,2,3,4,7,9]
  },
  'Diatonic': {
    'Major':[0,2,4,5,7,9,11],
    'Nat. Minor':[0,2,3,5,7,8,10],
    'Harm. Minor':[0,2,3,5,7,8,11],
    'Mel. Minor':[0,2,3,5,7,9,11]
  },
  'Modes': {
    'Ionian':[0,2,4,5,7,9,11],
    'Dorian':[0,2,3,5,7,9,10],
    'Phrygian':[0,1,3,5,7,8,10],
    'Lydian':[0,2,4,6,7,9,11],
    'Mixolydian':[0,2,4,5,7,9,10],
    'Aeolian':[0,2,3,5,7,8,10],
    'Locrian':[0,1,3,5,6,8,10]
  },
  'Symmetric': {
    'Whole Tone':[0,2,4,6,8,10],
    'Dim (W-H)':[0,2,3,5,6,8,9,11],
    'Dim (H-W)':[0,1,3,4,6,7,9,10]
  }
};

// ── Interval System ──────────────────────────────────────────────────
export const INTERVAL_LABELS = ['R','♭2','2','♭3','3','4','♭5','5','♯5','6','♭7','7'];
// Function-color palette: interval (semitones from root) → a learnable colour so the
// HARMONIC FUNCTION of a note reads at a glance (root gold, 3rd red, 5th blue, 7th purple).
export const DEGREE_COLORS = ['#ffd23f','#d65db1','#6ec6ff','#ff9e3d','#ff5e5e','#56c271','#c77dff','#4d9de0','#b08968','#2ec4b6','#9d6bff','#7b5cff'];
export const SCALE_DEGREE_LABELS = ['1','♭2','2','♭3','3','4','♭5','5','♯5','6','♭7','7'];

export function intervalLabel(rootNote, note) {
  const semitones = ((NOTES.indexOf(note) - NOTES.indexOf(rootNote)) % 12 + 12) % 12;
  return INTERVAL_LABELS[semitones];
}

export function getScaleDegree(rootIdx, noteIdx) { return (noteIdx - rootIdx + 12) % 12; }

// ── Chord helpers ────────────────────────────────────────────────────
export function getChordNotes(root, intervals) {
  return intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
}

export function getKeyChords(root, pattern) {
  const p = KEY_PATTERNS[pattern];
  if (!p) return [];
  return p.intervals.map((int, i) => {
    const chordRoot = NOTES[(NOTES.indexOf(root) + int) % 12];
    const quality   = p.qualities[i];
    const formula   = CHORD_TYPES['Triads'][quality] || [0,4,7];
    return { root: chordRoot, quality, numeral: p.numerals[i], notes: getChordNotes(chordRoot, formula) };
  });
}

export function getScaleNotes(root, intervals) {
  return intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
}

export function sameIntervals(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function isFivePositionMajorScale(intervals)       { return sameIntervals(intervals, [0,2,4,5,7,9,11]); }
export function isFivePositionMajorPentatonic(intervals)  { return sameIntervals(intervals, [0,2,4,7,9]); }
export function isFivePositionMinorPentatonic(intervals)  { return sameIntervals(intervals, [0,3,5,7,10]); }

// ── Key Position Zones ───────────────────────────────────────────────
export const KEY_POSITION_ZONES = [
  { label:'Open Position', lo:0, hi:3, short:'OPEN' },
  ...Array.from({ length:21 }, (_, i) => ({
    label:`Position ${i+1}`, lo:i+1, hi:i+4, short:`P${i+1}`
  }))
];

// ── Canonical Scale Position Boxes (Standard E-tuning guitar) ───────
export const CANONICAL_MAJOR_TEMPLATE_BOXES = [
  [
    {si:5,fret:2,deg:11},{si:5,fret:3,deg:0},{si:5,fret:5,deg:2},
    {si:4,fret:2,deg:4},{si:4,fret:3,deg:5},{si:4,fret:5,deg:7},
    {si:3,fret:2,deg:9},{si:3,fret:4,deg:11},{si:3,fret:5,deg:0},
    {si:2,fret:2,deg:2},{si:2,fret:4,deg:4},{si:2,fret:5,deg:5},
    {si:1,fret:3,deg:7},{si:1,fret:5,deg:9},
    {si:0,fret:2,deg:11},{si:0,fret:3,deg:0},{si:0,fret:5,deg:2}
  ],
  [
    {si:5,fret:5,deg:2},{si:5,fret:7,deg:4},{si:5,fret:8,deg:5},
    {si:4,fret:5,deg:7},{si:4,fret:7,deg:9},
    {si:3,fret:4,deg:11},{si:3,fret:5,deg:0},{si:3,fret:7,deg:2},
    {si:2,fret:4,deg:4},{si:2,fret:5,deg:5},{si:2,fret:7,deg:7},
    {si:1,fret:5,deg:9},{si:1,fret:7,deg:11},{si:1,fret:8,deg:0},
    {si:0,fret:5,deg:2},{si:0,fret:7,deg:4},{si:0,fret:8,deg:5}
  ],
  [
    {si:5,fret:7,deg:4},{si:5,fret:8,deg:5},{si:5,fret:10,deg:7},
    {si:4,fret:7,deg:9},{si:4,fret:9,deg:11},{si:4,fret:10,deg:0},
    {si:3,fret:7,deg:2},{si:3,fret:9,deg:4},{si:3,fret:10,deg:5},
    {si:2,fret:7,deg:7},{si:2,fret:9,deg:9},
    {si:1,fret:7,deg:11},{si:1,fret:8,deg:0},{si:1,fret:10,deg:2},
    {si:0,fret:7,deg:4},{si:0,fret:8,deg:5},{si:0,fret:10,deg:7}
  ],
  [
    {si:5,fret:8,deg:5},{si:5,fret:10,deg:7},{si:5,fret:12,deg:9},
    {si:4,fret:9,deg:11},{si:4,fret:10,deg:0},{si:4,fret:12,deg:2},
    {si:3,fret:9,deg:4},{si:3,fret:10,deg:5},{si:3,fret:12,deg:7},
    {si:2,fret:9,deg:9},{si:2,fret:11,deg:11},{si:2,fret:12,deg:0},
    {si:1,fret:10,deg:2},{si:1,fret:12,deg:4},{si:1,fret:13,deg:5},
    {si:0,fret:10,deg:7},{si:0,fret:12,deg:9}
  ],
  [
    {si:5,fret:12,deg:9},{si:5,fret:14,deg:11},{si:5,fret:15,deg:0},
    {si:4,fret:12,deg:2},{si:4,fret:14,deg:4},{si:4,fret:15,deg:5},
    {si:3,fret:12,deg:7},{si:3,fret:14,deg:9},
    {si:2,fret:11,deg:11},{si:2,fret:12,deg:0},{si:2,fret:14,deg:2},
    {si:1,fret:12,deg:4},{si:1,fret:13,deg:5},{si:1,fret:15,deg:7},
    {si:0,fret:12,deg:9},{si:0,fret:14,deg:11},{si:0,fret:15,deg:0}
  ]
];

export const CANONICAL_MINOR_PENT_TEMPLATE_BOXES = [
  [
    {si:5,fret:3,deg:0},{si:5,fret:6,deg:3},
    {si:4,fret:3,deg:5},{si:4,fret:5,deg:7},
    {si:3,fret:3,deg:10},{si:3,fret:5,deg:0},
    {si:2,fret:3,deg:3},{si:2,fret:5,deg:5},
    {si:1,fret:3,deg:7},{si:1,fret:6,deg:10},
    {si:0,fret:3,deg:0},{si:0,fret:6,deg:3}
  ],
  [
    {si:5,fret:6,deg:3},{si:5,fret:8,deg:5},
    {si:4,fret:5,deg:7},{si:4,fret:8,deg:10},
    {si:3,fret:5,deg:0},{si:3,fret:8,deg:3},
    {si:2,fret:5,deg:5},{si:2,fret:7,deg:7},
    {si:1,fret:6,deg:10},{si:1,fret:8,deg:0},
    {si:0,fret:6,deg:3},{si:0,fret:8,deg:5}
  ],
  [
    {si:5,fret:8,deg:5},{si:5,fret:10,deg:7},
    {si:4,fret:8,deg:10},{si:4,fret:10,deg:0},
    {si:3,fret:8,deg:3},{si:3,fret:10,deg:5},
    {si:2,fret:7,deg:7},{si:2,fret:10,deg:10},
    {si:1,fret:8,deg:0},{si:1,fret:11,deg:3},
    {si:0,fret:8,deg:5},{si:0,fret:10,deg:7}
  ],
  [
    {si:5,fret:10,deg:7},{si:5,fret:13,deg:10},
    {si:4,fret:10,deg:0},{si:4,fret:13,deg:3},
    {si:3,fret:10,deg:5},{si:3,fret:12,deg:7},
    {si:2,fret:10,deg:10},{si:2,fret:12,deg:0},
    {si:1,fret:11,deg:3},{si:1,fret:13,deg:5},
    {si:0,fret:10,deg:7},{si:0,fret:13,deg:10}
  ],
  [
    {si:5,fret:13,deg:10},{si:5,fret:15,deg:0},
    {si:4,fret:15,deg:5},
    {si:3,fret:12,deg:7},{si:3,fret:15,deg:10},
    {si:2,fret:12,deg:0},{si:2,fret:15,deg:3},
    {si:1,fret:13,deg:5},{si:1,fret:15,deg:7},
    {si:0,fret:13,deg:10},{si:0,fret:15,deg:0}
  ]
];

export const CANONICAL_MAJOR_PENT_TEMPLATE_BOXES = [
  // G major pentatonic (G A B D E), root on low-E fret 3, 2 notes/string. Audit-verified 2026-06-14.
  [
    {si:5,fret:3,deg:0},{si:5,fret:5,deg:2},{si:4,fret:2,deg:4},{si:4,fret:5,deg:7},
    {si:3,fret:2,deg:9},{si:3,fret:5,deg:0},{si:2,fret:2,deg:2},{si:2,fret:4,deg:4},
    {si:1,fret:3,deg:7},{si:1,fret:5,deg:9},{si:0,fret:3,deg:0},{si:0,fret:5,deg:2}
  ],
  [
    {si:5,fret:5,deg:2},{si:5,fret:7,deg:4},{si:4,fret:5,deg:7},{si:4,fret:7,deg:9},
    {si:3,fret:5,deg:0},{si:3,fret:7,deg:2},{si:2,fret:4,deg:4},{si:2,fret:7,deg:7},
    {si:1,fret:5,deg:9},{si:1,fret:8,deg:0},{si:0,fret:5,deg:2},{si:0,fret:7,deg:4}
  ],
  [
    {si:5,fret:7,deg:4},{si:5,fret:10,deg:7},{si:4,fret:7,deg:9},{si:4,fret:10,deg:0},
    {si:3,fret:7,deg:2},{si:3,fret:9,deg:4},{si:2,fret:7,deg:7},{si:2,fret:9,deg:9},
    {si:1,fret:8,deg:0},{si:1,fret:10,deg:2},{si:0,fret:7,deg:4},{si:0,fret:10,deg:7}
  ],
  [
    {si:5,fret:10,deg:7},{si:5,fret:12,deg:9},{si:4,fret:10,deg:0},{si:4,fret:12,deg:2},
    {si:3,fret:9,deg:4},{si:3,fret:12,deg:7},{si:2,fret:9,deg:9},{si:2,fret:12,deg:0},
    {si:1,fret:10,deg:2},{si:1,fret:12,deg:4},{si:0,fret:10,deg:7},{si:0,fret:12,deg:9}
  ],
  [
    {si:5,fret:12,deg:9},{si:5,fret:15,deg:0},{si:4,fret:12,deg:2},{si:4,fret:14,deg:4},
    {si:3,fret:12,deg:7},{si:3,fret:14,deg:9},{si:2,fret:12,deg:0},{si:2,fret:14,deg:2},
    {si:1,fret:12,deg:4},{si:1,fret:15,deg:7},{si:0,fret:12,deg:9},{si:0,fret:15,deg:0}
  ]
];
