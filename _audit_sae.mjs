import { findScaleBoxes as findScale, getDisplayPositionsForBox as dispScale } from './src/pedals/scale-explorer.js';
import { findScaleBoxes as findArp, getDisplayPositionsForBox as dispArp, ARP_TYPES } from './src/pedals/arpeggios.js';
import { NOTES, SCALE_TYPES, getScaleNotes, getChordNotes } from './src/core/music-theory.js';

const DEG = ['1','b2','2','b3','3','4','b5','5','#5','6','b7','7'];

function summarizeBoxes(boxes, root, expectedNotes) {
  const expSet = new Set(expectedNotes);
  console.log(`  -> ${boxes.length} boxes`);
  boxes.forEach((b, i) => {
    const notes = [...new Set(b.positions.map(p => p.note))].sort();
    const foreign = notes.filter(n => !expSet.has(n));
    const hasRoot = b.positions.some(p => p.isRoot);
    const degs = [...new Set(b.positions.map(p => p.deg))].sort((a,b)=>a-b).map(d=>DEG[d]).join(',');
    console.log(`    Box${i+1} [${b.label}] frets ${b.lo}-${b.hi} n=${b.totalNotes} root=${hasRoot} degs=[${degs}] foreign=[${foreign.join(',')}]`);
  });
  // missing notes across all boxes
  const allNotes = new Set(boxes.flatMap(b => b.positions.map(p => p.note)));
  const missing = expectedNotes.filter(n => !allNotes.has(n));
  if (missing.length) console.log(`    !! NOTES MISSING from ALL boxes: ${missing.join(',')}`);
}

function testScale(root, cat, name) {
  const intervals = SCALE_TYPES[cat][name];
  const expected = getScaleNotes(root, intervals);
  console.log(`\n### SCALE ${root} ${name} (${cat}) intervals=[${intervals}] notes=[${expected}]`);
  const boxes = findScale(root, intervals, { scaleCat: cat, scaleName: name });
  summarizeBoxes(boxes, root, expected);
}

function testArp(root, cat, name) {
  const intervals = ARP_TYPES[cat][name];
  const expected = getChordNotes(root, intervals);
  console.log(`\n### ARP ${root} ${name} (${cat}) intervals=[${intervals}] tones=[${expected}]`);
  const boxes = findArp(root, intervals, { arpCat: cat, arpName: name });
  summarizeBoxes(boxes, root, expected);
}

// === The six required samples ===
testScale('C', 'Diatonic', 'Major');
testScale('A', 'Diatonic', 'Nat. Minor');
testScale('A', 'Diatonic', 'Harm. Minor');
testScale('G', 'Pentatonic', 'Major Pent.');
testArp('C', 'Triads', 'Major');
testArp('A', '7ths', 'Min7');

// Extra coverage for context claims
testScale('C', 'Diatonic', 'Harm. Minor');
testScale('A', 'Diatonic', 'Mel. Minor');
testScale('C', 'Diatonic', 'Nat. Minor');
