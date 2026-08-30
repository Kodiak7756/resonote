// Node test for the bridge MIDI encoder: writes a C-major I-IV-V-I test
// export to D:\Guitar\ResonoteBridge\outbox for (a) byte-level verification
// by an independent parser and (b) a first live REAPER import test.
import { encodeMidi, PPQ, noteToMidi } from '../src/core/midi-writer.js';
import { writeFileSync } from 'node:fs';

const chords = [
  ['C3', 'E3', 'G3'],   // I
  ['F3', 'A3', 'C4'],   // IV
  ['G3', 'B3', 'D4'],   // V
  ['C3', 'E3', 'G3'],   // I
];
const parse = (s) => noteToMidi(s.slice(0, -1), parseInt(s.slice(-1)));

const notes = [];
chords.forEach((ch, bar) => {
  ch.forEach((n) => notes.push({ tick: bar * 4 * PPQ, note: parse(n), vel: 96, dur: 4 * PPQ - 20 }));
});

const bytes = encodeMidi({ bpm: 95, timeSig: [4, 4], trackName: 'Resonote test', notes, endTick: 16 * PPQ });
const out = 'D:/Guitar/ResonoteBridge/outbox/resonote_test-i-iv-v-i_20260707_000000.mid';
writeFileSync(out, bytes);
console.log('wrote', out, bytes.length, 'bytes,', notes.length, 'notes');
console.log('expected midi notes:', chords.flat().map(parse).join(','));
