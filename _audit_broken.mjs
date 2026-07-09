import { NOTES, SCALE_TYPES, toSharp } from './src/core/music-theory.js';
import { customTuning, getNoteAtFret, getInst } from './src/core/tuning.js';
import { findScaleBoxes, getDisplayPositionsForBox } from './src/core/voicings.js';

const brokenPairs = (arr, skip) => { const out = []; for (let i = 0; i + skip < arr.length; i++) { out.push(arr[i]); out.push(arr[i + skip]); } return out.length ? out : arr; };

function getPositionNotes(box, { startOnRoot=false, patternSeq='straight', direction='asc', root }) {
  if (!box.positions) return [];
  let asc = [...box.positions].filter(pp => pp.fret >= 0).sort((a, b) => b.si - a.si || a.fret - b.fret);
  if (startOnRoot && !box.perString) {
    const ri = asc.findIndex(pp => pp.note === root);
    if (ri > 0) asc = [...asc.slice(ri), ...asc.slice(0, ri)];
  }
  if (patternSeq === 'broken3') asc = brokenPairs(asc, 2);
  else if (patternSeq === 'broken4') asc = brokenPairs(asc, 3);
  if (direction === 'asc')  return asc;
  if (direction === 'desc') return [...asc].reverse();
  if (box.perString) return [...asc, ...[...asc].reverse().slice(1)];
  const desc2 = [...asc].reverse().slice(1, -1);
  return [...asc, ...desc2];
}

function semi(a,b){ return ((NOTES.indexOf(toSharp(b)) - NOTES.indexOf(toSharp(a)))%12+12)%12; }

// C major box1: asc sorted note list, then show broken3 PAIR intervals
const cboxes = findScaleBoxes('C',[0,2,4,5,7,9,11],{scaleCat:'Diatonic',scaleName:'Major'});
// pick the lowest box that contains a clean run
const box = cboxes.find(b=>b.lo<=5) || cboxes[0];
const asc = getPositionNotes(box,{root:'C',direction:'asc'});
console.log('C major chosen box', box.label, 'lo',box.lo,'hi',box.hi);
console.log('asc notes:', asc.map(n=>`${n.note}${n.octave}`).join(' '));
const b3 = getPositionNotes(box,{root:'C',direction:'asc',patternSeq:'broken3'});
console.log('broken3 notes:', b3.map(n=>n.note).join(' '));
// intervals of each PAIR (even index -> odd index) in semitones
let pairInts3 = [];
for(let i=0;i+1<b3.length;i+=2) pairInts3.push(semi(b3[i].note,b3[i+1].note));
console.log('broken3 pair intervals (semitones):', pairInts3.join(' '), ' (a diatonic 3rd = 3 or 4)');

const b4 = getPositionNotes(box,{root:'C',direction:'asc',patternSeq:'broken4'});
let pairInts4 = [];
for(let i=0;i+1<b4.length;i+=2) pairInts4.push(semi(b4[i].note,b4[i+1].note));
console.log('broken4 pair intervals (semitones):', pairInts4.join(' '), ' (a 4th = 5)');

// Now: does sorting by (b.si-a.si || a.fret-b.fret) yield true pitch-ascending order?
// Check midi monotonicity of asc list:
let mono=true, prev=-1;
asc.forEach(n=>{ const m=n.octave*12+NOTES.indexOf(toSharp(n.note)); if(m<prev) mono=false; prev=m; });
console.log('C major asc strictly pitch-ascending by midi?', mono);

// Check a multi-octave box where same string has notes across octaves
// E major box1 (low register) — verify monotonic
const eboxes = findScaleBoxes('E',[0,2,4,5,7,9,11],{scaleCat:'Diatonic',scaleName:'Major'});
const ebox = eboxes[0];
const easc = getPositionNotes(ebox,{root:'E',direction:'asc'});
let emono=true, ep=-1;
easc.forEach(n=>{ const m=n.octave*12+NOTES.indexOf(toSharp(n.note)); if(m<ep) emono=false; ep=m; });
console.log('E major box1', ebox.label, 'asc pitch-ascending?', emono, ' notes:', easc.map(n=>`${n.note}${n.octave}`).join(' '));

// startOnRoot test: A minor pent box1, does it begin on A and stay in-scale?
const aboxes = findScaleBoxes('A',[0,3,5,7,10],{scaleCat:'Pentatonic',scaleName:'Minor Pent.'});
const abox = aboxes[0];
const sr = getPositionNotes(abox,{root:'A',direction:'asc',startOnRoot:true});
console.log('A minPent box1 startOnRoot first note:', sr[0]?.note, ' full:', sr.map(n=>n.note).join(' '));
const noSr = getPositionNotes(abox,{root:'A',direction:'asc',startOnRoot:false});
console.log('A minPent box1 NO startOnRoot first note:', noSr[0]?.note, ' full:', noSr.map(n=>n.note).join(' '));

// startOnRoot + broken interaction order (rotation happens BEFORE brokenPairs)
const srB3 = getPositionNotes(abox,{root:'A',direction:'asc',startOnRoot:true,patternSeq:'broken3'});
console.log('A minPent box1 startOnRoot+broken3:', srB3.map(n=>n.note).join(' '));

// cycle direction with straight (up then down) — check it returns to start, no dup at turn
const cyc = getPositionNotes(abox,{root:'A',direction:'cycle'});
console.log('A minPent box1 cycle:', cyc.map(n=>n.note).join(' '));
