import { NOTES, SCALE_TYPES, toSharp } from './src/core/music-theory.js';
import { customTuning, getNoteAtFret, getInst } from './src/core/tuning.js';
import { findScaleBoxes, getDisplayPositionsForBox } from './src/core/voicings.js';

// ===== Verbatim copies of technique-workshop.js positions-tab functions =====
const ARP_TYPES = {
  'Triads': { 'Major':[0,4,7],'Minor':[0,3,7],'Dim':[0,3,6],'Aug':[0,4,8],'Sus2':[0,2,7],'Sus4':[0,5,7] },
  '7ths':   { 'Maj7':[0,4,7,11],'Dom7':[0,4,7,10],'Min7':[0,3,7,10],'Dim7':[0,3,6,9],'m7♭5':[0,3,6,10],'mMaj7':[0,3,7,11] },
  'Other':  { '6':[0,4,7,9],'Min6':[0,3,7,9],'Aug7':[0,4,8,10] },
};
const _noteAtWS = (si, fret) => { const st = customTuning[si]; return getNoteAtFret(st.note, st.octave, fret); };
function _fretOfOnWS(si, noteName) { for (let f = 0; f <= 11; f++) if (_noteAtWS(si, f).note === toSharp(noteName)) return f; return -1; }
function _pickClimbString(root, span) {
  const nf = (getInst() && getInst().frets) || 22;
  let best = null;
  for (let si = customTuning.length - 1; si >= 0; si--) {
    const f = _fretOfOnWS(si, root);
    if (f < 0 || f + span > nf) continue;
    if (!best || f < best.fret) best = { si, fret: f };
    if (best && best.fret <= 3) break;
  }
  return best || { si: customTuning.length - 1, fret: Math.max(0, _fretOfOnWS(customTuning.length - 1, root)) };
}
function buildStringClimb(root, intervals) {
  const start = _pickClimbString(root, 12);
  return [...intervals, 12].map(iv => {
    const fr = start.fret + iv, na = _noteAtWS(start.si, fr);
    return { si: start.si, fret: fr, note: na.note, octave: na.octave, deg: iv % 12, isRoot: iv % 12 === 0 };
  });
}
const brokenPairs = (arr, skip) => { const out = []; for (let i = 0; i + skip < arr.length; i++) { out.push(arr[i]); out.push(arr[i + skip]); } return out.length ? out : arr; };

// getPositionNotes logic, parameterized
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

function getSequenceBoxes(mode, root, intervals, scaleCat, scaleName, pathMode) {
  if (pathMode === 'string') return [{ label: 'Single string', positions: buildStringClimb(root, intervals), perString: true }];
  return findScaleBoxes(root, intervals, { scaleCat, scaleName });
}
const boxDisplayPositions = (box, root) => (box && box.perString) ? box.positions : getDisplayPositionsForBox(box, root);

// ===== Verification helpers =====
function pc(note) { return NOTES.indexOf(toSharp(note)); }
function scaleSetPCs(root, intervals) {
  const ri = NOTES.indexOf(root);
  return new Set(intervals.map(i => (ri + i) % 12));
}

let problems = [];
function flag(msg) { problems.push(msg); }

// What the runner actually plays for a box: it uses box.positions directly in getPositionNotes
// (NOT boxDisplayPositions). boxDisplayPositions is only used for the FRETBOARD preview overlay.
// So verify BOTH: (a) box.positions are in-scale & complete, (b) display positions are in-scale.

function checkScaleType(scaleCat, scaleName, intervals, roots) {
  for (const root of roots) {
    const allowed = scaleSetPCs(root, intervals);
    const boxes = getSequenceBoxes('scales', root, intervals, scaleCat, scaleName, 'boxes');
    if (!boxes.length) { flag(`${root} ${scaleName}: NO boxes returned`); continue; }
    if (boxes.length !== 5 && intervals.length >= 5) flag(`${root} ${scaleName}: ${boxes.length} boxes (expected 5)`);
    boxes.forEach((box, bi) => {
      // (a) runner notes from box.positions
      const notes = getPositionNotes(box, { root, direction:'asc' });
      if (!notes.length) { flag(`${root} ${scaleName} box${bi+1}(${box.label}): runner notes EMPTY`); return; }
      // every note in scale
      const foreign = notes.filter(n => !allowed.has(pc(n.note)));
      if (foreign.length) flag(`${root} ${scaleName} box${bi+1}(${box.label}): foreign notes ${[...new Set(foreign.map(f=>f.note))].join(',')}`);
      // box should contain the root (positions tab cares about complete shapes; a box w/o root is suspect)
      if (!box.positions.some(p => p.isRoot || p.note === root)) flag(`${root} ${scaleName} box${bi+1}(${box.label}): NO root note in box`);
      // coverage: distinct scale degrees present should == intervals.length for a full box
      const degs = new Set(box.positions.map(p => pc(p.note)));
      if (degs.size < allowed.size) flag(`${root} ${scaleName} box${bi+1}(${box.label}): only ${degs.size}/${allowed.size} scale tones present`);
      // monotonic ascending (asc) sanity: sorting key b.si-a.si || a.fret-b.fret -> midi should be generally increasing-ish; just check no foreign
      // (b) display positions in-scale
      const disp = boxDisplayPositions(box, root);
      const dForeign = (disp||[]).filter(n => !allowed.has(pc(n.note)));
      if (dForeign.length) flag(`${root} ${scaleName} box${bi+1}(${box.label}): DISPLAY foreign ${[...new Set(dForeign.map(f=>f.note))].join(',')}`);
      // high-fret cluster check
      if (box.lo !== undefined && box.lo >= 17) flag(`${root} ${scaleName} box${bi+1}(${box.label}): anchored high at fret ${box.lo}`);
    });
  }
}

function checkArp(arpCat, arpName, intervals, roots) {
  for (const root of roots) {
    const allowed = scaleSetPCs(root, intervals);
    const boxes = getSequenceBoxes('arps', root, intervals, arpCat, arpName, 'boxes');
    if (!boxes.length) { flag(`ARP ${root} ${arpName}: NO boxes`); continue; }
    boxes.forEach((box, bi) => {
      const notes = getPositionNotes(box, { root, direction:'asc' });
      if (!notes.length) { flag(`ARP ${root} ${arpName} box${bi+1}: EMPTY`); return; }
      const foreign = notes.filter(n => !allowed.has(pc(n.note)));
      if (foreign.length) flag(`ARP ${root} ${arpName} box${bi+1}(${box.label}): foreign ${[...new Set(foreign.map(f=>f.note))].join(',')}`);
      if (!box.positions.some(p => p.note === root)) flag(`ARP ${root} ${arpName} box${bi+1}(${box.label}): NO root`);
      const degs = new Set(box.positions.map(p => pc(p.note)));
      if (degs.size < allowed.size) flag(`ARP ${root} ${arpName} box${bi+1}(${box.label}): only ${degs.size}/${allowed.size} chord tones`);
    });
  }
}

// ---- Single-string climb ----
function checkStringClimb(root, intervals, label) {
  const allowed = scaleSetPCs(root, intervals);
  const boxes = getSequenceBoxes('scales', root, intervals, '', '', 'string');
  const box = boxes[0];
  const notes = getPositionNotes(box, { root, direction:'asc', startOnRoot:false });
  const climb = box.positions;
  // first note must be root
  if (climb[0].note !== root) flag(`STRING ${label} ${root}: first note ${climb[0].note} != root`);
  // last note must be root one octave up
  const last = climb[climb.length-1];
  if (last.note !== root) flag(`STRING ${label} ${root}: last note ${last.note} != root`);
  // strictly ascending frets
  for (let i=1;i<climb.length;i++) if (climb[i].fret <= climb[i-1].fret) flag(`STRING ${label} ${root}: non-ascending fret at ${i}`);
  // all in scale
  const foreign = climb.filter(n => !allowed.has(pc(n.note)));
  if (foreign.length) flag(`STRING ${label} ${root}: foreign ${[...new Set(foreign.map(f=>f.note))].join(',')}`);
  // octave span = 12 frets
  if (last.fret - climb[0].fret !== 12) flag(`STRING ${label} ${root}: span ${last.fret-climb[0].fret} != 12`);
}

// ---- broken-interval transform sanity on a known box ----
function inspectBroken(root, scaleName, scaleCat, intervals) {
  const boxes = getSequenceBoxes('scales', root, intervals, scaleCat, scaleName, 'boxes');
  const box = boxes[0];
  const asc = getPositionNotes(box, { root, direction:'asc' });
  const b3 = getPositionNotes(box, { root, direction:'asc', patternSeq:'broken3' });
  const b4 = getPositionNotes(box, { root, direction:'asc', patternSeq:'broken4' });
  return { ascLen: asc.length, b3Len: b3.length, b4Len: b4.length,
    ascNotes: asc.map(n=>n.note), b3Notes: b3.map(n=>n.note), b4Notes: b4.map(n=>n.note) };
}

// ===== RUN =====
const roots = ['A','C','E','G','D','F','B'];

// Scales
checkScaleType('Pentatonic','Minor Pent.',[0,3,5,7,10], roots);
checkScaleType('Pentatonic','Major Pent.',[0,2,4,7,9], roots);
checkScaleType('Diatonic','Major',[0,2,4,5,7,9,11], roots);
checkScaleType('Diatonic','Nat. Minor',[0,2,3,5,7,8,10], roots);
checkScaleType('Diatonic','Harm. Minor',[0,2,3,5,7,8,11], roots);
checkScaleType('Diatonic','Mel. Minor',[0,2,3,5,7,9,11], roots);
checkScaleType('Modes','Dorian',[0,2,3,5,7,9,10], roots);
checkScaleType('Modes','Mixolydian',[0,2,4,5,7,9,10], roots);
checkScaleType('Blues','Blues Minor',[0,3,5,6,7,10], roots);
checkScaleType('Blues','Blues Major',[0,2,3,4,7,9], roots);
checkScaleType('Symmetric','Whole Tone',[0,2,4,6,8,10], ['A','C']);

// Arps
checkArp('Triads','Major',[0,4,7], roots);
checkArp('Triads','Minor',[0,3,7], roots);
checkArp('Triads','Dim',[0,3,6], roots);
checkArp('Triads','Aug',[0,4,8], roots);
checkArp('7ths','Maj7',[0,4,7,11], roots);
checkArp('7ths','Dom7',[0,4,7,10], roots);
checkArp('7ths','Min7',[0,3,7,10], roots);
checkArp('7ths','Dim7',[0,3,6,9], roots);
checkArp('7ths','m7♭5',[0,3,6,10], roots);
checkArp('Other','6',[0,4,7,9], roots);
checkArp('Other','Aug7',[0,4,8,10], roots);

// String climb
for (const r of roots) checkStringClimb(r,[0,3,5,7,10],'MinPent');
for (const r of roots) checkStringClimb(r,[0,2,4,5,7,9,11],'Major');
for (const r of roots) checkStringClimb(r,[0,4,7],'MajTriad');

// Broken inspection (A minor pent box 1)
console.log('--- broken inspect A Minor Pent box1 ---');
console.log(JSON.stringify(inspectBroken('A','Minor Pent.','Pentatonic',[0,3,5,7,10]), null, 0));
console.log('--- broken inspect A Major box1 ---');
console.log(JSON.stringify(inspectBroken('A','Major','Diatonic',[0,2,4,5,7,9,11]), null, 0));
console.log('--- broken inspect C Major Triad arp box1 ---');
{
  const boxes = getSequenceBoxes('arps','C',[0,4,7],'Triads','Major','boxes');
  const box = boxes[0];
  const asc = getPositionNotes(box, { root:'C', direction:'asc' });
  const b3 = getPositionNotes(box, { root:'C', direction:'asc', patternSeq:'broken3' });
  console.log('asc:', asc.map(n=>n.note).join(' '));
  console.log('b3 :', b3.map(n=>n.note).join(' '));
}

console.log('\n========== PROBLEMS (' + problems.length + ') ==========');
problems.forEach(p => console.log(' - ' + p));
