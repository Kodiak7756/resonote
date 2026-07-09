import { NOTES } from './music-theory.js';

// ── Instruments ──────────────────────────────────────────────────────
export const INSTRUMENTS = {
  guitar6: {
    name:'6-String Guitar', renderer:'fretboard', frets:24, woundFrom:3,
    freqRange:[60,1400], tuningRange:{low:{note:'B',octave:1},high:{note:'G',octave:4}},
    strings:[{note:'E',octave:4,label:'e'},{note:'B',octave:3,label:'B'},{note:'G',octave:3,label:'G'},{note:'D',octave:3,label:'D'},{note:'A',octave:2,label:'A'},{note:'E',octave:2,label:'E'}]
  },
  guitar8: {
    name:'8-String Guitar', renderer:'fretboard', frets:24, woundFrom:3,
    freqRange:[28,1400], tuningRange:{low:{note:'F#',octave:1},high:{note:'G',octave:4}},
    strings:[{note:'E',octave:4,label:'e'},{note:'B',octave:3,label:'B'},{note:'G',octave:3,label:'G'},{note:'D',octave:3,label:'D'},{note:'A',octave:2,label:'A'},{note:'E',octave:2,label:'E'},{note:'B',octave:1,label:'B'},{note:'F#',octave:1,label:'F#'}]
  },
  bass4: {
    name:'4-String Bass', renderer:'fretboard', frets:24, woundFrom:0,
    freqRange:[28,600], tuningRange:{low:{note:'C',octave:1},high:{note:'G',octave:2}},
    strings:[{note:'G',octave:2,label:'G'},{note:'D',octave:2,label:'D'},{note:'A',octave:1,label:'A'},{note:'E',octave:1,label:'E'}]
  },
  banjo5: {
    name:'5-String Banjo', renderer:'fretboard', frets:22, woundFrom:3,
    freqRange:[100,2000], tuningRange:{low:{note:'C',octave:3},high:{note:'G',octave:4}},
    strings:[{note:'D',octave:4,label:'D'},{note:'B',octave:3,label:'B'},{note:'G',octave:3,label:'G'},{note:'D',octave:3,label:'D'},{note:'G',octave:4,label:'g'}]
  },
  mandolin: {
    name:'Mandolin', renderer:'fretboard', frets:20, woundFrom:2,
    freqRange:[190,3000], tuningRange:{low:{note:'F',octave:3},high:{note:'G',octave:5}},
    strings:[{note:'E',octave:5,label:'E'},{note:'A',octave:4,label:'A'},{note:'D',octave:4,label:'D'},{note:'G',octave:3,label:'G'}]
  },
  piano: {
    name:'Piano', renderer:'keyboard', frets:0,
    freqRange:[28,4200], octaves:3, startOctave:2, strings:[]
  },
  vocals: {
    name:'Vocals', renderer:'vocals', frets:0,
    freqRange:[80,1100], strings:[],
    vocalRange:{ low:{ note:'C', octave:2 }, high:{ note:'C', octave:6 } }
  }
};

// ── Tuning Presets ───────────────────────────────────────────────────
export const TUNING_PRESETS = {
  guitar6: [
    {name:'Standard',  strings:[{note:'E',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'E',octave:2}]},
    {name:'Drop D',    strings:[{note:'E',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'D',octave:2}]},
    {name:'D Standard',strings:[{note:'D',octave:4},{note:'A',octave:3},{note:'F',octave:3},{note:'C',octave:3},{note:'G',octave:2},{note:'D',octave:2}]},
    {name:'Open G',    strings:[{note:'D',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'G',octave:2},{note:'D',octave:2}]},
    {name:'Open D',    strings:[{note:'D',octave:4},{note:'A',octave:3},{note:'F#',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'D',octave:2}]},
    {name:'DADGAD',    strings:[{note:'D',octave:4},{note:'A',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'D',octave:2}]}
  ],
  guitar8: [
    {name:'Standard',  strings:[{note:'E',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'E',octave:2},{note:'B',octave:1},{note:'F#',octave:1}]},
    {name:'Drop E',    strings:[{note:'E',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'A',octave:2},{note:'E',octave:2},{note:'B',octave:1},{note:'E',octave:1}]}
  ],
  bass4: [
    {name:'Standard',  strings:[{note:'G',octave:2},{note:'D',octave:2},{note:'A',octave:1},{note:'E',octave:1}]},
    {name:'Drop D',    strings:[{note:'G',octave:2},{note:'D',octave:2},{note:'A',octave:1},{note:'D',octave:1}]}
  ],
  banjo5: [
    {name:'Open G',    strings:[{note:'D',octave:4},{note:'B',octave:3},{note:'G',octave:3},{note:'D',octave:3},{note:'G',octave:4}]},
    {name:'Double C',  strings:[{note:'D',octave:4},{note:'C',octave:4},{note:'G',octave:3},{note:'C',octave:3},{note:'G',octave:4}]},
    {name:'Open D',    strings:[{note:'D',octave:4},{note:'A',octave:3},{note:'F#',octave:3},{note:'D',octave:3},{note:'F#',octave:4}]},
    {name:'Sawmill',   strings:[{note:'D',octave:4},{note:'C',octave:4},{note:'G',octave:3},{note:'D',octave:3},{note:'G',octave:4}]}
  ],
  mandolin: [
    {name:'Standard',  strings:[{note:'E',octave:5},{note:'A',octave:4},{note:'D',octave:4},{note:'G',octave:3}]},
    {name:'GDAD',      strings:[{note:'D',octave:5},{note:'A',octave:4},{note:'D',octave:4},{note:'G',octave:3}]},
    {name:'ADAE',      strings:[{note:'E',octave:5},{note:'A',octave:4},{note:'D',octave:4},{note:'A',octave:3}]}
  ]
};

// ── Runtime tuning state (mutable, shared) ───────────────────────────
export let currentInstrument = 'guitar6';
export let customTuning = INSTRUMENTS.guitar6.strings.map(s => ({...s}));

export function setCurrentInstrument(id) {
  currentInstrument = id;
}

export function setCustomTuning(strings) {
  customTuning = strings.map(s => ({...s}));
}

export function getInst() { return INSTRUMENTS[currentInstrument]; }

export function applyTuning(strings) {
  customTuning = strings.map(x => ({
    note: x.note,
    octave: x.octave,
    label: x.note === 'E' && x.octave >= 4 ? 'e' : x.note
  }));
}

export function getTuningOptions() {
  const inst = getInst();
  if (!inst.tuningRange) return [];
  const r = inst.tuningRange;
  const lo = NOTES.indexOf(r.low.note)  + r.low.octave  * 12;
  const hi = NOTES.indexOf(r.high.note) + r.high.octave * 12;
  const o = [];
  for (let oct = 0; oct <= 6; oct++) {
    NOTES.forEach((n, ni) => {
      const idx = ni + oct * 12;
      if (idx >= lo && idx <= hi) o.push({ note: n, octave: oct });
    });
  }
  return o;
}

export function getNoteAtFret(n, o, f) {
  const i = NOTES.indexOf(n);
  return { note: NOTES[(i + f) % 12], octave: o + Math.floor((i + f) / 12) };
}

export function isStandardMajorPatternContext() {
  if (currentInstrument !== 'guitar6' || customTuning.length !== 6) return false;
  const std = ['E4','B3','G3','D3','A2','E2'];
  return customTuning.every((s, i) => `${s.note}${s.octave}` === std[i]);
}
