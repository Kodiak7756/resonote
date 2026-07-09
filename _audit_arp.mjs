import { findScaleBoxes as findArp, getDisplayPositionsForBox as dispArp, ARP_TYPES } from './src/pedals/arpeggios.js';
import { NOTES, getChordNotes } from './src/core/music-theory.js';

const DEG = ['1','b2','2','b3','3','4','b5','5','#5','6','b7','7'];

function inspect(root, cat, name) {
  const intervals = ARP_TYPES[cat][name];
  const expected = getChordNotes(root, intervals);
  console.log(`\n### ARP ${root} ${name} tones=[${expected}] (${intervals.length} tones)`);
  const boxes = findArp(root, intervals, { arpCat: cat, arpName: name });
  console.log(`  ${boxes.length} boxes (CAGED expects 5)`);
  boxes.forEach((b,i) => {
    const cardDegs = [...new Set(b.positions.map(p=>p.deg))].sort((a,b)=>a-b).map(d=>DEG[d]);
    // what the fretboard shows when this box is selected:
    const disp = dispArp(b, root);
    const dispDegs = [...new Set(disp.map(p=>p.deg))].sort((a,b)=>a-b).map(d=>DEG[d]);
    const cardComplete = intervals.every(iv => b.positions.some(p=>p.deg===iv));
    console.log(`    Box${i+1} card-degs=[${cardDegs}] complete=${cardComplete} | selected-fretboard-degs=[${dispDegs}]`);
  });
}

inspect('C', 'Triads', 'Major');
inspect('A', '7ths', 'Min7');
inspect('C', '7ths', 'Maj7');
inspect('C', '7ths', 'Dim7');
inspect('G', 'Triads', 'Major');
