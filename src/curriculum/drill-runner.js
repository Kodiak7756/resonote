// ── Drill runner ─────────────────────────────────────────────────────
// Turns a curriculum teach-demo or practice-drill into a SEQUENCE of fretboard
// positions, and plays that sequence on the MAIN fretboard (lighting each note
// as it sounds). Shared by the Theory Path ("Hear & see it" previews) and the
// Practice Manager's Theory library (looping practice exercises) so both speak
// the exact same engine. A "plan" is { root, notes, label, positions, steps }
// where each step is { focus:[{si,fret}], play:[{note,octave}], dur, gap? }.
import { NOTES, SCALE_TYPES, CHORD_TYPES, getChordNotes, toSharp } from '../core/music-theory.js';
import { customTuning, getNoteAtFret, getInst } from '../core/tuning.js';
import { setChordHighlight, setGhostHighlight, clearGhostHighlight, fretboardView } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { playNote, playChordNotes } from '../core/synth.js';
import { pickGrip, assignFingers, findScaleBoxes } from '../core/voicings.js';

export const SEQ_COLORS = { root: '#5ad1c0', tone: '#3a8f7f', rootStroke: '#7ddccb', toneStroke: '#46897e' };

// ── Position math ────────────────────────────────────────────────────
const nfrets = () => getInst().frets || 24;
const noteAt = (si, fret) => { const s = customTuning[si]; return getNoteAtFret(s.note, s.octave, fret); }; // {note,octave}
const posWithNote = (si, fret) => ({ si, fret, ...noteAt(si, fret) });
function fretOfOn(si, noteName) { for (let f = 0; f <= 11; f++) if (noteAt(si, f).note === toSharp(noteName)) return f; return -1; }
// A thick, low string to climb a scale on (prefer low E / A / D), keeping the span on the neck.
function pickClimbStart(root, span) {
  let best = null;
  for (let si = customTuning.length - 1; si >= 0; si--) {
    const f = fretOfOn(si, root);
    if (f < 0 || f + span > nfrets()) continue;
    if (!best || f < best.fret) best = { si, fret: f };
    if (best && best.fret <= 3) break;
  }
  return best || { si: customTuning.length - 1, fret: Math.max(0, fretOfOn(customTuning.length - 1, root)) };
}
// Lowest single position of a pitch-class (thick string preferred on ties).
function lowestPos(noteName, maxFret = 12) {
  for (let f = 0; f <= maxFret; f++)
    for (let si = customTuning.length - 1; si >= 0; si--)
      if (noteAt(si, f).note === toSharp(noteName)) return posWithNote(si, f);
  return posWithNote(customTuning.length - 1, 0);
}
const seqSteps = (seq, dur) => seq.map(pp => ({ focus: [{ si: pp.si, fret: pp.fret }], play: [{ note: pp.note, octave: pp.octave }], dur }));
const uniqNotes = arr => [...new Set(arr.map(x => x.note))];

// ── Plan builders ────────────────────────────────────────────────────
function buildScaleClimb(root, intervals, opts = {}) {
  const start = pickClimbStart(root, 12);
  const asc = [...intervals, 12].map(iv => posWithNote(start.si, start.fret + iv));
  const seq = opts.downToo === false ? asc : asc.concat(asc.slice(0, -1).reverse());
  return { root: toSharp(root), notes: uniqNotes(asc), label: opts.label || `${root} scale`, positions: asc, steps: seqSteps(seq, 60 / (opts.bpm || 100)) };
}
// Play a scale AS A CAGED BOX — a real hand position spread across the strings, the way
// guitar is actually taught and played. Ascends low string→high then back down, in ONE
// position. (Single-string climbs are kept only where the POINT is the W-W-H formula or
// the open-string alphabet.) opts.connect links Box 1 → Box 2 to start building neck-spanning.
function _boxAsc(box) {
  let ps = [...box.positions].filter(p => p.fret >= 0).map(p => ({ si: p.si, fret: p.fret, note: p.note, octave: p.octave }));
  // The box engine centres shapes on the neck; for a "Box 1" drill octave-drop a high-centred
  // box to its classic low position (root on the low strings, e.g. A-min-pent at fret 5).
  while (ps.length && Math.min(...ps.map(p => p.fret)) >= 12) {
    ps = ps.map(p => { const na = noteAt(p.si, p.fret - 12); return { si: p.si, fret: p.fret - 12, note: na.note, octave: na.octave }; });
  }
  return ps.sort((a, b) => b.si - a.si || a.fret - b.fret);
}
function buildScaleBox(root, intervals, opts = {}) {
  const r = toSharp(root);
  const boxes = findScaleBoxes(r, intervals, { scaleCat: opts.scaleCat, scaleName: opts.scaleName });
  if (!boxes || !boxes.length) return buildScaleClimb(r, intervals, opts);
  const dur = 60 / (opts.bpm || 100);
  let positions, seq, posLabel;
  if (opts.connect && boxes.length >= 2) {
    positions = [..._boxAsc(boxes[0]), ..._boxAsc(boxes[1])];
    seq = positions.concat(positions.slice(0, -1).reverse());
    posLabel = `${boxes[0].label} → ${boxes[1].label}`;
  } else {
    const box = boxes[Math.min(opts.boxIndex || 0, boxes.length - 1)];
    positions = _boxAsc(box);
    if (positions.length < 2) return buildScaleClimb(r, intervals, opts);
    seq = opts.downToo === false ? positions : positions.concat(positions.slice(0, -1).reverse());
    const minF = Math.min(...positions.map(p => p.fret));   // label from the ACTUAL played frets (post octave-drop)
    posLabel = minF <= 0 ? 'open position' : `pos. ${minF}fr`;
  }
  return { root: r, notes: uniqNotes(positions), label: `${opts.label || `${r} ${opts.name || 'scale'}`} · ${posLabel}`, positions, steps: seqSteps(seq, dur) };
}
function buildChromatic(root, count, opts = {}) {
  const start = opts.si != null
    ? { si: opts.si, fret: opts.fret != null ? opts.fret : Math.max(0, fretOfOn(opts.si, root)) }
    : pickClimbStart(root, count - 1);
  const ps = Array.from({ length: count }, (_, i) => posWithNote(start.si, start.fret + i));
  const seq = opts.downToo ? ps.concat(ps.slice(0, -1).reverse()) : ps;
  return { root: ps[0].note, notes: uniqNotes(ps), label: opts.label || `${root} chromatic`, positions: ps, steps: seqSteps(seq, 60 / (opts.bpm || 90)) };
}
// Render a harmonic interval as a real, PLAYABLE two-string DOUBLE-STOP — two notes sounded
// TOGETHER can't share a string. Pick a root string low enough that the smallest interval still
// lands on a HIGHER string, then place each interval note at its most compact higher-string spot.
function dyadFor(siRoot, fRoot, semi) {
  const omid = si => { const n = noteAt(si, 0); return n.octave * 12 + NOTES.indexOf(n.note); };
  const target = omid(siRoot) + fRoot + semi;
  let best = null;
  for (let s = siRoot - 1; s >= 0; s--) {            // only HIGHER strings (lower index)
    const g = target - omid(s);
    if (g < 0 || g > 22) continue;
    const span = Math.abs(g - fRoot);
    if (span > 6) continue;                          // keep the shape within a hand span
    if (!best || span < best.span || (span === best.span && s > best.s)) best = { s, g, span };
  }
  return best ? posWithNote(best.s, best.g) : posWithNote(siRoot, fRoot + semi);   // fallback: same string
}
// Spell an interval by FUNCTION relative to the root (so a minor 3rd over C reads E♭, not D♯ —
// it keeps the 3rd's letter, E, just flattened). Lowered intervals → flats; the tritone stays ♯4.
const _SP_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const _SP_LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const _SP_STEPS = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6, 12: 0 };
function spellInterval(rootName, semi) {
  const r = toSharp(rootName), letter = r[0];
  const target = _SP_LETTERS[(_SP_LETTERS.indexOf(letter) + _SP_STEPS[((semi % 12) + 12) % 12]) % 7];
  const targetPc = (NOTES.indexOf(r) + semi) % 12;
  let acc = ((targetPc - _SP_LETTER_PC[target]) % 12 + 12) % 12; if (acc > 6) acc -= 12;
  return target + (acc === 0 ? '' : acc === 1 ? '#' : acc === -1 ? '♭' : acc === 2 ? '##' : acc === -2 ? '♭♭' : (acc > 0 ? '#' : '♭'));
}
function buildIntervalShape(root, intervals, opts = {}) {
  const r = toSharp(root), dur = 60 / (opts.bpm || 80);
  const omid = si => { const n = noteAt(si, 0); return n.octave * 12 + NOTES.indexOf(n.note); };
  const minSemi = Math.min(...intervals, opts.resolve != null ? opts.resolve : 99);
  const siRoot = minSemi < 3 ? customTuning.length - 1 : customTuning.length - 2;  // low E for 2nds, else A
  let fRoot = ((NOTES.indexOf(r) - (omid(siRoot) % 12)) % 12 + 12) % 12; if (fRoot < 2) fRoot += 12;
  const lo = posWithNote(siRoot, fRoot); lo.disp = r;   // disp = the note as it should READ (functional spelling)
  const positions = [lo], steps = [];
  intervals.forEach(semi => {
    const hi = dyadFor(siRoot, fRoot, semi); hi.disp = spellInterval(r, semi);
    positions.push(hi);
    steps.push({ focus: [{ si: lo.si, fret: lo.fret }], play: [{ note: lo.note, octave: lo.octave }], dur });
    steps.push({ focus: [{ si: hi.si, fret: hi.fret }], play: [{ note: hi.note, octave: hi.octave }], dur });
    steps.push({ focus: [{ si: lo.si, fret: lo.fret }, { si: hi.si, fret: hi.fret }], play: [{ note: lo.note, octave: lo.octave }, { note: hi.note, octave: hi.octave }], dur: dur * 1.5, gap: dur * 1.9 });
  });
  if (opts.resolve != null) {   // sound the tension dyad, then resolve it (still on two strings)
    const res = dyadFor(siRoot, fRoot, opts.resolve); res.disp = spellInterval(r, opts.resolve);
    positions.push(res);
    steps.push({ focus: [{ si: lo.si, fret: lo.fret }, { si: res.si, fret: res.fret }], play: [{ note: lo.note, octave: lo.octave }, { note: res.note, octave: res.octave }], dur: dur * 1.8, gap: dur * 2.2, label: 'resolves → ' + lo.note + '+' + res.note });
  }
  // focusOnly: these double-stops light up only the note(s) currently sounding — no dim cluster
  // of every position, which reads as a mess on the small interval shapes.
  return { root: r, notes: uniqNotes(positions), label: opts.label || `${r} intervals (double-stops)`, positions, steps, focusOnly: true };
}
function buildArpeggio(root, ints, opts = {}) {
  const start = pickClimbStart(root, ints[ints.length - 1] || 7);
  const ps = ints.map(iv => posWithNote(start.si, start.fret + iv));
  const seq = ps.concat(ps.slice(0, -1).reverse());
  return { root: toSharp(root), notes: uniqNotes(ps), label: opts.label || `${root} arpeggio`, positions: ps, steps: seqSteps(seq, 60 / (opts.bpm || 90)) };
}
// Melodic minor done right: ascend with the raised 6th & 7th (bright), DESCEND with natural
// minor (the 6th & 7th fall back) — the classical "up bright, down dark" rule. A single-string
// run so the learner clearly sees F♯/G♯ on the way up swap to F/G on the way down.
function buildMelodicMinorRun(root, opts = {}) {
  const r = toSharp(root);
  const start = pickClimbStart(r, 12);
  const upInts = [0, 2, 3, 5, 7, 9, 11, 12];   // A B C D E F♯ G♯ A — melodic minor ascending
  const downInts = [10, 8, 7, 5, 3, 2, 0];      // G F E D C B A — natural minor descending
  const mk = s => posWithNote(start.si, start.fret + s);
  const seq = upInts.map(mk).concat(downInts.map(mk));
  const seen = new Set(), positions = [];
  seq.forEach(p => { const k = p.si + ':' + p.fret; if (!seen.has(k)) { seen.add(k); positions.push(p); } });
  return { root: r, notes: uniqNotes(seq), label: opts.label || `${r} melodic minor ↑ · natural minor ↓`, positions, steps: seqSteps(seq, 60 / (opts.bpm || 72)) };
}
// Guide-tone targeting: for each chord, land on its 3rd on the downbeat, walk the 5th and ♭7,
// then step up by a half-step into the NEXT chord's 3rd. Makes the line actually sound the
// guide tones the lesson names (e.g. B over G7, E over C7) instead of a generic scale run.
function buildGuideTones(prog, opts = {}) {
  const dur = 60 / (opts.bpm || 60);
  const isMin = c => /min|^m|m7|dim|°|ø|♭5|b5/.test((c.quality || '').toLowerCase());
  const thirdOf = c => isMin(c) ? 3 : 4;
  const positions = [], steps = [];
  prog.forEach((c, i) => {
    const r = toSharp(c.root), rootPc = NOTES.indexOf(r);
    const ints = chordIntervalsFor(c.quality);
    const next = prog[(i + 1) % prog.length];
    const nextThirdPc = (NOTES.indexOf(toSharp(next.root)) + thirdOf(next)) % 12;
    const approachSemi = (((nextThirdPc - 1 + 12) % 12) - rootPc + 24) % 12;   // half step below the next 3rd
    const cell = [thirdOf(c), ints[2] != null ? ints[2] : 7, ints[3] != null ? ints[3] : 10, approachSemi];
    const start = pickClimbStart(r, Math.max(...cell, 7));
    cell.forEach((semi, idx) => {
      const p = posWithNote(start.si, start.fret + semi);
      positions.push(p);
      steps.push({ focus: [{ si: p.si, fret: p.fret }], play: [{ note: p.note, octave: p.octave }], dur: idx === 0 ? dur * 1.25 : dur, gap: idx === 3 ? dur * 0.5 : 0, label: idx === 0 ? `${r}: 3rd on beat 1` : (idx === 3 ? 'approach ↗' : undefined) });
    });
  });
  return { root: toSharp(prog[0].root), notes: uniqNotes(positions), label: opts.label || 'Guide tones — land on the 3rd', positions, steps };
}
function twoNotePlan(lo, hi, label, dur) {
  const both = [{ si: lo.si, fret: lo.fret }, { si: hi.si, fret: hi.fret }];
  return { root: lo.note, notes: uniqNotes([lo, hi]), label, positions: [lo, hi], steps: [
    { focus: [both[0]], play: [{ note: lo.note, octave: lo.octave }], dur },
    { focus: [both[1]], play: [{ note: hi.note, octave: hi.octave }], dur },
    { focus: both, play: [{ note: lo.note, octave: lo.octave }, { note: hi.note, octave: hi.octave }], dur: dur * 1.6, gap: dur * 1.9 },
  ] };
}
function buildInterval(root, semis, opts = {}) {
  const start = pickClimbStart(root, semis);
  return twoNotePlan(posWithNote(start.si, start.fret), posWithNote(start.si, start.fret + semis), opts.label || `${root} + ${semis}st`, 60 / (opts.bpm || 84));
}
function buildOctave(root, opts = {}) {
  let si = -1; for (let s = customTuning.length - 1; s >= 0; s--) if (customTuning[s].note === toSharp(root)) { si = s; break; }
  if (si < 0) return buildInterval(root, 12, { ...opts, label: `${root} octave` });
  return twoNotePlan(posWithNote(si, 0), posWithNote(si, 12), `${root} octave`, 60 / (opts.bpm || 80));
}
function buildNoteDemo(noteName, opts = {}) {
  const pos = opts.pos || lowestPos(noteName);
  const dur = 60 / (opts.bpm || 100), f = [{ si: pos.si, fret: pos.fret }];
  const steps = Array.from({ length: opts.times || 2 }, () => ({ focus: f, play: [{ note: pos.note, octave: pos.octave }], dur, gap: dur * 1.3 }));
  return { root: toSharp(noteName), notes: [pos.note], label: opts.label || pos.note, positions: [pos], steps };
}
// Light EVERY occurrence of a note across the whole neck and play them in pitch order, so the
// learner sees the SAME note living in many places (open A = 5th-fret low E = 7th-fret D…). The
// point of "Finding Any Note on the Neck" — the relationship of one note across the fretboard.
function buildNoteEverywhere(noteName, opts = {}) {
  const n = toSharp(noteName), nf = nfrets();
  const all = [];
  for (let si = customTuning.length - 1; si >= 0; si--)
    for (let f = 0; f <= nf; f++) {
      const na = noteAt(si, f);
      if (na.note === n) all.push({ si, fret: f, note: na.note, octave: na.octave, midi: na.octave * 12 + NOTES.indexOf(na.note) });
    }
  if (!all.length) return buildNoteDemo(n, opts);
  // pitch order — unisons (open A = 5th-fret low E) land back-to-back; positions match the
  // play sequence so the connecting path follows what's actually played.
  const seq = all.slice().sort((a, b) => a.midi - b.midi || b.si - a.si).map(p => ({ si: p.si, fret: p.fret, note: p.note, octave: p.octave }));
  return { root: n, notes: [n], label: opts.label || `Every ${n} on the neck`, positions: seq, steps: seqSteps(seq, 60 / (opts.bpm || 88)) };
}
function buildOpenStrings(opts = {}) {
  const order = []; for (let si = customTuning.length - 1; si >= 0; si--) order.push(posWithNote(si, 0));
  return { root: order[0].note, notes: uniqNotes(order), label: 'Open strings', positions: order, steps: seqSteps(order, 60 / (opts.bpm || 90)) };
}
function buildStepSizes(opts = {}) {
  const si = customTuning.length - 1, dur = 60 / (opts.bpm || 80);   // low E (thickest)
  const positions = [], steps = [];
  [[0, 1], [3, 5]].forEach(([a, b]) => {  // E→F (½ step), G→A (whole step)
    const pa = posWithNote(si, a), pb = posWithNote(si, b); positions.push(pa, pb);
    steps.push({ focus: [{ si, fret: a }], play: [{ note: pa.note, octave: pa.octave }], dur });
    steps.push({ focus: [{ si, fret: b }], play: [{ note: pb.note, octave: pb.octave }], dur });
    steps.push({ focus: [{ si, fret: a }, { si, fret: b }], play: [{ note: pa.note, octave: pa.octave }, { note: pb.note, octave: pb.octave }], dur: dur * 1.4, gap: dur * 1.9 });
  });
  return { root: positions[0].note, notes: uniqNotes(positions), label: 'Half vs whole steps', positions, steps };
}
function buildEnharmonic(opts = {}) {
  const dur = 60 / (opts.bpm || 70), positions = [], steps = [];
  const si = Math.min(4, customTuning.length - 2);   // keep the twins on ONE string so the climb reads cleanly
  ['C#', 'D#', 'F#'].forEach(n => {  // one pitch, two names — same fret played twice
    let f = fretOfOn(si, n); if (f < 0) f = 0;
    const pos = posWithNote(si, f); positions.push(pos);
    steps.push({ focus: [{ si, fret: f }], play: [{ note: pos.note, octave: pos.octave }], dur });
    steps.push({ focus: [{ si, fret: f }], play: [{ note: pos.note, octave: pos.octave }], dur, gap: dur * 1.7 });
  });
  return { root: positions[0].note, notes: uniqNotes(positions), label: 'Enharmonic twins — one pitch, two names', positions, steps };
}
function guessScale(sig) {
  if (/pentatonic|\bpent\b/.test(sig)) return ['Pentatonic', /major/.test(sig) && !/minor/.test(sig) ? 'Major Pent.' : 'Minor Pent.'];
  if (/dorian/.test(sig)) return ['Modes', 'Dorian'];
  if (/mixolydian/.test(sig)) return ['Modes', 'Mixolydian'];
  if (/\bminor\b|aeolian/.test(sig)) return ['Diatonic', 'Nat. Minor'];
  return ['Diatonic', 'Major'];
}

// ── Chord helpers ────────────────────────────────────────────────────
function chordIntervalsFor(quality) {
  const q = quality || 'Major';
  for (const cat of Object.values(CHORD_TYPES)) if (cat[q]) return cat[q];
  const s = q.toLowerCase();
  if (/maj7/.test(s)) return [0, 4, 7, 11];
  if (/m7♭5|m7b5|ø|half.?dim/.test(s)) return [0, 3, 6, 10];
  if (/dim7/.test(s)) return [0, 3, 6, 9];
  if (/min7|m7/.test(s)) return [0, 3, 7, 10];
  if (/dom|\b7\b|7 \(/.test(s)) return [0, 4, 7, 10];
  if (/dim/.test(s)) return [0, 3, 6];
  if (/aug|\+/.test(s)) return [0, 4, 8];
  if (/sus4/.test(s)) return [0, 5, 7];
  if (/sus2/.test(s)) return [0, 2, 7];
  if (/min|^m/.test(s)) return [0, 3, 7];
  return [0, 4, 7];
}
function chordSuffix(quality) {
  const q = (quality || 'Major');
  if (q === 'Major') return '';
  if (q === 'Minor') return 'm';
  return ({ Dim: '°', Aug: '+', Maj7: 'maj7', Min7: 'm7', 'm7♭5': 'ø7', Dim7: '°7', Sus4: 'sus4', Sus2: 'sus2', '7♯9': '7♯9', '7♭9': '7♭9', '9': '9', '13': '13', Add9: 'add9' })[q] || q;
}
const progLabel = prog => prog.map(c => c.numeral || (toSharp(c.root) + chordSuffix(c.quality))).join('–');

// Which intervals an interval drill should demonstrate (semitones). Keyed on the
// VOICING (a stable signal) so a chord-progression lesson that merely *mentions* an
// interval in its prose ("the tritone's pull") isn't mistaken for an interval drill.
function intervalSetFor(voicing) {
  const v = voicing;
  if (/stacked interval/.test(v))                  return { intervals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], label: 'Every interval, unison→octave' };
  if (/tritone/.test(v))                           return { intervals: [6], label: 'The tritone (♭5)', resolve: /resolution|resolve/.test(v) ? 7 : undefined };
  if (/perfect|5ths and 4ths|4ths and 5/.test(v))  return { intervals: [7, 5], label: 'Perfect 5th & Perfect 4th' };
  if (/thirds|root and 3rd/.test(v))               return { intervals: [4, 3], label: 'Major 3rd vs Minor 3rd' };
  if (/octaves and other/.test(v))                 return { intervals: [12, 4, 7, 11], label: 'Octave, then 3rd · 5th · 7th' };
  if (/intervals mixed/.test(v))                   return { intervals: [4, 1, 7, 6], label: 'Consonant vs dissonant' };
  return null;
}
// Which scale a single-note scale/run drill should climb.
function scaleFor(sig, prog) {
  const r = toSharp(prog[0]?.root || 'C');
  if (/blue note/.test(sig)) return { root: r, cat: 'Blues', name: 'Blues Minor' };  // the blue note IS the lesson — show it
  if (/pentatonic|box|single-note scale run|five boxes/.test(sig))
    return /major/.test(sig) && !/minor pent/.test(sig) ? { root: r, cat: 'Pentatonic', name: 'Major Pent.' } : { root: r, cat: 'Pentatonic', name: 'Minor Pent.' };
  if (/dorian/.test(sig))     return { root: r, cat: 'Modes', name: 'Dorian' };
  if (/phrygian/.test(sig))   return { root: r, cat: 'Modes', name: 'Phrygian' };
  if (/lydian/.test(sig))     return { root: r, cat: 'Modes', name: 'Lydian' };
  if (/mixolydian/.test(sig)) return { root: r, cat: 'Modes', name: 'Mixolydian' };
  if (/locrian/.test(sig))    return { root: r, cat: 'Modes', name: 'Locrian' };
  if (/harmonic minor/.test(sig)) return { root: r, cat: 'Diatonic', name: 'Harm. Minor' };
  if (/melodic minor/.test(sig))  return { root: r, cat: 'Diatonic', name: 'Mel. Minor' };
  // Default from the HOME CHORD's quality — prose words like "minor"/"leading tone"
  // appear in too many lessons to be a reliable signal.
  if (/min/.test((prog[0]?.quality || '').toLowerCase())) return { root: r, cat: 'Diatonic', name: 'Nat. Minor' };
  return { root: r, cat: 'Diatonic', name: 'Major' };
}

// Detect TWO-PART CONTRAST lessons → the two scales to play in sequence (else null).
function contrastFor(sig, prog) {
  const r0 = prog[0] && toSharp(prog[0].root), r1 = prog[1] && toSharp(prog[1].root);
  if (/all white-key notes|major vs\.? *d dorian/.test(sig))
    return [{ root: 'C', cat: 'Diatonic', name: 'Major', label: 'C Major (Ionian)' }, { root: 'D', cat: 'Modes', name: 'Dorian', label: 'D Dorian' }];
  if (/bright ionian|ionian and dark aeolian|anchor modes/.test(sig) && r0)
    return [{ root: r0, cat: 'Diatonic', name: 'Major', label: `${r0} Major (Ionian)` }, { root: r0, cat: 'Diatonic', name: 'Nat. Minor', label: `${r0} Minor (Aeolian)` }];
  if (/share all their notes|same notes, new home/.test(sig) && r0 && r1)
    return [{ root: r0, cat: 'Diatonic', name: 'Major', label: `${r0} Major` }, { root: r1, cat: 'Diatonic', name: 'Nat. Minor', label: `${r1} Natural Minor` }];
  if (/accidentals|one sharp.*one flat|sharps and flats preserve/.test(sig) && r0 && r1)
    return [{ root: r0, cat: 'Diatonic', name: 'Major', label: `${r0} Major` }, { root: r1, cat: 'Diatonic', name: 'Major', label: `${r1} Major` }];
  if (/major pentatonic.*minor pent|same shape, two moods/.test(sig) && r0)
    return [{ root: r0, cat: 'Pentatonic', name: 'Major Pent.', label: `${r0} Major Pent.` }, { root: r0, cat: 'Pentatonic', name: 'Minor Pent.', label: `${r0} Minor Pent.` }];
  // Dorian's ♮6: natural minor THEN Dorian, so the one-note (♭6→♮6) change is heard.
  if (/dorian.s hope|natural minor.*then d dorian/.test(sig) && r0)
    return [{ root: r0, cat: 'Diatonic', name: 'Nat. Minor', label: `${r0} Natural Minor` }, { root: r0, cat: 'Modes', name: 'Dorian', label: `${r0} Dorian` }];
  // Phrygian (♭2) vs Lydian (♯4): two extreme modes back to back (different roots).
  if (/dark phrygian.*dreamy lydian|two extremes, each defined/.test(sig) && r0 && r1)
    return [{ root: r0, cat: 'Modes', name: 'Phrygian', label: `${r0} Phrygian` }, { root: r1, cat: 'Modes', name: 'Lydian', label: `${r1} Lydian` }];
  // Mixolydian's ♭7: major THEN Mixolydian, so the F♯→F♮ drop is heard.
  if (/major gone bluesy|hear f natural drop in/.test(sig) && r0)
    return [{ root: r0, cat: 'Diatonic', name: 'Major', label: `${r0} Major` }, { root: r0, cat: 'Modes', name: 'Mixolydian', label: `${r0} Mixolydian` }];
  return null;
}

// A compact close voicing (one chord tone per string, A·D·G·B·e) for the Voice-Leading view.
// Every chord tone is guaranteed a slot (a pitch-class always appears within 12 frets),
// so nothing gets dropped.
function chordVoicing(notes) {
  const strs = [4, 3, 2, 1, 0].filter(s => s < customTuning.length);
  const out = [];
  notes.slice(0, strs.length).forEach((pc, i) => {
    const si = strs[i];
    for (let f = 0; f <= 11; f++) { const na = noteAt(si, f); if (na.note === toSharp(pc)) { out.push({ si, fret: f, note: na.note, octave: na.octave }); break; } }
  });
  return out;
}
// Minimal-motion VOICE LEADING: re-voice the next chord from the previous chord's voicing so each
// voice (string) moves as little as possible — common tones stay on the same fret (held), the rest
// step a fret or two. This is what the Voice-Leading view's flow arrows + "hold" markers visualise.
function permsOf(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => permsOf(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([x, ...p])));
  return out;
}
function voiceLead(prevVoicing, nextNotes) {
  const pv = (prevVoicing || []).filter(p => p && p.fret >= 0);
  const pcs = (nextNotes || []).map(toSharp);
  if (!pv.length || pcs.length !== pv.length || pv.length > 4) return chordVoicing(nextNotes);
  const nf = nfrets();
  const nearest = (si, pc, target) => {
    let f0 = -1; for (let f = 0; f <= 11; f++) if (noteAt(si, f).note === pc) { f0 = f; break; }
    if (f0 < 0) return Math.max(0, target);
    let best = f0;
    for (let k = 1; k <= 2; k++) { const f = f0 + k * 12; if (f <= nf && Math.abs(f - target) < Math.abs(best - target)) best = f; }
    return best;
  };
  let best = null, cost = Infinity;
  permsOf(pcs).forEach(perm => {
    let c = 0; const v = [];
    for (let i = 0; i < pv.length; i++) { const f = nearest(pv[i].si, perm[i], pv[i].fret); c += Math.abs(f - pv[i].fret); v.push(posWithNote(pv[i].si, f)); }
    if (c < cost) { cost = c; best = v; }
  });
  return best;
}

// Position strategy for a chord drill — derived from the lesson's own language:
//   'climb'      → walk the chords UP the neck (movable-shape / "across the neck" lessons)
//   { near:5 }   → keep every chord in ONE mid-neck hand position (voice-leading / "stay" lessons)
//   'open'       → comfortable open/low shapes (the default for most progressions)
function positionStrategyFor(sig) {
  if (/across the neck|three-string triad|sliding them up|movable triad|move it up the neck|slide the (?:exact|shape)/.test(sig)) return 'climb';
  if (/barely move|stay in.{0,8}zone|nearest|common tone|hand barely|minimal.{0,5}move|one (?:small )?fret zone|same.{0,5}position/.test(sig)) return { near: 5 };
  return 'open';
}

// ── Chord-progression drill: walk the chords in time (loops via playPlan) ──
// Each chord shows ONE specific, fingered voicing (not every note on the neck), placed by the
// position strategy — so a learner sees exactly WHERE on the neck and WHAT to fret.
function buildProgression(prog, opts = {}) {
  const bpm = opts.bpm || 90, dur = (2 * 60) / bpm;   // ~two beats per chord
  const strategy = opts.position || 'open';
  let floor = 0;
  const chords = prog.map(c => {
    const r = toSharp(c.root), notes = getChordNotes(r, chordIntervalsFor(c.quality));
    const grip = pickGrip(r, notes, c.quality, strategy, floor);
    const positions = grip ? grip.positions : assignFingers(chordVoicing(notes));
    const fretted = positions.filter(p => p.fret > 0);
    const mf = grip && grip.minFret != null ? grip.minFret : (fretted.length ? Math.min(...fretted.map(p => p.fret)) : 0);
    if (strategy === 'climb') floor = mf + 2;
    const hasOpen = positions.some(p => p.fret === 0);
    // open-position drills read "open"; climb / stay-in-position drills show the fret to emphasise WHERE
    const where = mf <= 0 ? ' · open'
      : (strategy === 'open' && hasOpen) ? ' · open'
      : ` · ${mf}fr`;
    return { root: r, notes, label: `${c.numeral ? c.numeral + ' · ' : ''}${r}${chordSuffix(c.quality)}${where}`, dur, positions };
  });
  return { type: 'chords', label: opts.label || progLabel(prog), chords };
}

// ── Requested scale-pattern variations (broken 3rds/4ths, N-per-string, string skip) ──
// All produce a single-position ascending pattern from a chosen start; play one octave+.
function _scaleAscFrom(root, intervals) {
  const start = pickClimbStart(root, 12);
  return [...intervals, 12].map(iv => posWithNote(start.si, start.fret + iv));
}
export function buildBrokenInterval(root, intervals, skip, opts = {}) {
  // "broken 3rds" = play scale tones in pairs a 3rd (2 scale-steps) apart: 1-3,2-4,3-5…
  const asc = _scaleAscFrom(toSharp(root), intervals), seq = [];
  for (let i = 0; i < asc.length - skip; i++) { seq.push(asc[i]); seq.push(asc[i + skip]); }
  const dur = 60 / (opts.bpm || 90);
  return { root: toSharp(root), notes: uniqNotes(asc), label: opts.label || `${root} broken ${skip + 1}${skip === 1 ? 'rds' : 'ths'}`, positions: asc, steps: seqSteps(seq, dur) };
}
export function buildStringSkip(root, intervals, opts = {}) {
  // Climb the scale skipping every other string (1st, 3rd, 5th strings…).
  const r = toSharp(root), nf = nfrets();
  const ri = NOTES.indexOf(r), pcs = intervals.map(i => (ri + i) % 12);
  const out = [];
  for (let si = customTuning.length - 1; si >= 0; si -= 2)
    for (let f = 0; f <= Math.min(nf, 15); f++) { const na = noteAt(si, f); if (pcs.includes(NOTES.indexOf(na.note))) out.push({ si, fret: f, note: na.note, octave: na.octave }); }
  const dur = 60 / (opts.bpm || 90);
  return { root: r, notes: uniqNotes(out), label: opts.label || `${root} string-skip scale`, positions: out, steps: seqSteps(out, dur) };
}

// Two-part CONTRAST: play scale A, then scale B (relative major↔minor, sharp vs flat key,
// major vs parallel mode, major-pent vs minor-pent). Each step carries its part's label so
// the readout names which scale is sounding; a longer gap separates the two halves.
function buildContrast(specs, opts = {}) {
  const bpm = opts.bpm || 96;
  const subs = specs.map(sp => {
    const ints = SCALE_TYPES[sp.cat]?.[sp.name] || [0, 2, 4, 5, 7, 9, 11];
    return buildScaleBox(sp.root, ints, { bpm, scaleCat: sp.cat, scaleName: sp.name, name: sp.name, downToo: opts.downToo !== false, label: sp.label || `${sp.root} ${sp.name}` });
  });
  const positions = [], notes = [], steps = [];
  subs.forEach((pl, i) => {
    positions.push(...pl.positions);
    pl.notes.forEach(n => { if (!notes.includes(n)) notes.push(n); });
    pl.steps.forEach((st, j) => {
      const boundary = j === pl.steps.length - 1 && i < subs.length - 1;
      steps.push({ ...st, label: pl.label, gap: boundary ? (st.dur || 0.5) * 2.6 : st.gap });
    });
  });
  return { root: subs[0].root, notes, label: opts.label || subs.map(s => s.label).join('  →  '), positions, steps };
}

// Triad inversions — arpeggiate root position, then 1st inversion, then 2nd inversion,
// each ascending and stacked higher, so the SAME chord is heard with three bottom notes.
function buildInversions(root, ints, opts = {}) {
  const r = toSharp(root), dur = 60 / (opts.bpm || 88);
  const pcs = ints.slice(0, 3).map(iv => NOTES[(NOTES.indexOf(r) + iv) % 12]);
  const orders = [[0, 1, 2], [1, 2, 0], [2, 0, 1]], names = ['root position', '1st inversion', '2nd inversion'];
  const positions = [], steps = [];
  let minMidi = -1;
  orders.forEach((ord, k) => {
    const grp = [];
    ord.map(i => pcs[i]).forEach(pc => {
      let best = null;
      for (let f = 0; f <= nfrets(); f++) for (let si = customTuning.length - 1; si >= 0; si--) {
        const na = noteAt(si, f); if (na.note !== pc) continue;
        const midi = na.octave * 12 + NOTES.indexOf(na.note);
        if (midi <= minMidi) continue;
        if (!best || midi < best.midi) best = { si, fret: f, note: na.note, octave: na.octave, midi };
      }
      if (best) { grp.push(best); minMidi = best.midi; }
    });
    grp.forEach(pp => { positions.push(pp); steps.push({ focus: [{ si: pp.si, fret: pp.fret }], play: [{ note: pp.note, octave: pp.octave }], dur, label: `${r}${chordSuffix(opts.quality)} — ${names[k]}` }); });
    if (k < orders.length - 1 && steps.length) steps[steps.length - 1].gap = dur * 2.2;
  });
  return { root: r, notes: uniqNotes(positions), label: opts.label || `${r} triad inversions`, positions, steps };
}

// Single-note root hops — play a sequence of root notes ascending (e.g. the circle of
// fifths C→G→D→A), one per beat, so the MOTION between keys is heard, not chords.
function buildRootHops(roots, opts = {}) {
  const dur = 60 / (opts.bpm || 84);
  const positions = []; let minMidi = -1;
  roots.forEach(rn => {
    const r = toSharp(rn); let best = null;
    for (let f = 0; f <= nfrets(); f++) for (let si = customTuning.length - 1; si >= 0; si--) {
      const na = noteAt(si, f); if (na.note !== r) continue;
      const midi = na.octave * 12 + NOTES.indexOf(na.note);
      if (midi <= minMidi) continue;
      if (!best || midi < best.midi) best = { si, fret: f, note: na.note, octave: na.octave, midi };
    }
    if (best) { positions.push(best); minMidi = best.midi; }
  });
  if (!positions.length) return null;
  return { root: positions[0].note, notes: uniqNotes(positions), label: opts.label || 'Root motion', positions, steps: seqSteps(positions, dur) };
}

// teach.demo → synced plan (scale / interval / note). chord & progression keep
// their existing chord-by-chord playback in the Theory Path's playDemo().
export function demoToPlan(demo) {
  if (!demo) return null;
  const root = toSharp(demo.root || demo.note || 'C');
  if (demo.kind === 'scale') {
    // The musical-alphabet lesson demonstrates A natural minor from the open A string —
    // the seven letters starting on A — so the demo matches its practice-drill preview.
    if (/alphabet/.test(demo.caption || '')) {
      return buildScaleClimb('A', SCALE_TYPES.Diatonic['Nat. Minor'], { bpm: 96, downToo: true, label: 'A natural minor — the musical alphabet, up one octave from open A' });
    }
    const ints = SCALE_TYPES[demo.scaleCat]?.[demo.scaleName] || [0, 2, 4, 5, 7, 9, 11];
    return buildScaleBox(root, ints, { bpm: 96, scaleCat: demo.scaleCat, scaleName: demo.scaleName, name: demo.scaleName, label: demo.caption || `${root} ${demo.scaleName || 'scale'}` });
  }
  if (demo.kind === 'interval') {
    const semis = (((demo.intervalSemitones || 0) % 24) + 24) % 24;
    return semis === 12 ? buildOctave(root, { bpm: 80, label: demo.caption }) : buildInterval(root, semis, { bpm: 84, label: demo.caption });
  }
  if (demo.kind === 'note') {
    const nn = toSharp(demo.note || demo.root);
    return demo.all ? buildNoteEverywhere(nn, { bpm: 88, label: demo.caption }) : buildNoteDemo(nn, { bpm: 100, label: demo.caption, times: 3 });
  }
  return null;
}

// drill → synced plan. `bpmOverride` lets the Practice Manager re-time the same
// exercise to a chosen tempo without changing the curriculum data.
export function drillToPlan(drill, bpmOverride) {
  if (!drill) return null;
  // Match on the drill's TITLE / VOICING first (stable signals); only fall back to the
  // free-text pattern for the generic scale case — the pattern often name-drops other
  // concepts ("…match the open A string…") that would mis-route a keyword search.
  const title   = (drill.title   || '').toLowerCase();
  const voicing = (drill.voicing || '').toLowerCase();
  const focus   = (drill.focus   || '').toLowerCase();
  const sig     = `${title} ${voicing} ${focus} ${(drill.pattern || '').toLowerCase()}`;
  const prog = Array.isArray(drill.progression) ? drill.progression : [];
  const root = toSharp(prog[0]?.root || 'C');
  const bpm = bpmOverride || drill.bpm || 90;

  // 1) Single-note FOUNDATION drills (named, unambiguous)
  if (/alphabet/.test(title)) return buildScaleClimb('A', SCALE_TYPES.Diatonic['Nat. Minor'], { bpm: bpmOverride || 120, downToo: true, label: 'A natural minor — the musical alphabet, up one octave from open A' });
  // "Finding any note" → show the SAME note EVERYWHERE on the neck (every A, etc.), so the
  // relationship across the fretboard reads — not just one position.
  if (/finding notes|finding any note/.test(sig)) return buildNoteEverywhere(root, { bpm, label: `Every ${root} on the neck` });
  if (/count|chromatic|finding/.test(title) || /one fret at a time/.test(sig)) return buildChromatic('E', 9, { bpm, si: customTuning.length - 1, fret: 0, label: 'Counting up the low E string by half steps' });
  if (/enharmonic/.test(title)) return buildEnharmonic({ bpm });
  if (voicing.includes('open string')) return buildOpenStrings({ bpm });
  if (/step size/.test(title) || /half[- ]?step|whole[- ]?step/.test(title)) return buildStepSizes({ bpm });
  if (/two-note octaves|octave leaps/.test(sig)) return buildOctave(root, { bpm });

  // 2) INTERVAL drills (Unit 2 etc.) — root → each interval (fixes "shows a triad")
  const iv = intervalSetFor(voicing);
  if (iv) return buildIntervalShape(root, iv.intervals, { bpm, label: iv.label, resolve: iv.resolve });

  // 2.5) TWO-PART CONTRAST — play scale A then scale B (relative maj↔min, sharp vs flat key,
  // major vs parallel mode, major-pent vs minor-pent) so the lesson's whole comparison is heard.
  const contrast = contrastFor(sig, prog);
  if (contrast) return buildContrast(contrast, { bpm });

  // 2.6) Triad INVERSIONS — root position → 1st → 2nd of the home triad.
  if (/1st and 2nd inversion|root position, 1st/.test(voicing) && prog.length)
    return buildInversions(prog[0].root, chordIntervalsFor(prog[0].quality), { bpm, quality: prog[0].quality });

  // 2.7) Circle-of-fifths root MOTION — single notes hopping by 5ths, not chords.
  if (/root notes of each key|circle hop|jump up a perfect 5th|step clockwise/.test(sig) && prog.length >= 2) {
    const hops = buildRootHops(prog.map(c => c.root), { bpm, label: 'Circle of fifths — root motion' });
    if (hops) return hops;
  }

  // 2.8) Melodic minor "up bright, down dark" — ascend with raised 6/7, descend natural minor.
  if (/melodic minor/.test(sig) && /up bright|down dark|natural[- ]minor descent|down with natural/.test(sig))
    return buildMelodicMinorRun(root, { bpm });

  // 2.9) Guide-tone targeting — land on each chord's 3rd on the downbeat (B over G7, E over C7…).
  if (/hit the 3rd|targeting the 3rd|land on chord tones|3rd on beat 1/.test(sig) && prog.length)
    return buildGuideTones(prog, { bpm, label: progLabel(prog) + ' — guide tones' });

  // 3) SCALE runs — play a real CAGED BOX (positional, across the strings) the way guitar is
  // actually taught & played, NOT up a single string. Exception: the W-W-H lesson stays a
  // single-string climb so the whole-step/half-step pattern (2 frets vs 1) reads clearly.
  if (/scale ascending|scale run|scale climb|single-note scale|single note scale|w-w-h|scale degrees|scales|pentatonic|box|five boxes|blue note|aeolian climb|melodic minor/.test(sig)) {
    const sc = scaleFor(sig, prog), ints = SCALE_TYPES[sc.cat][sc.name];
    if (/w-w-h/.test(sig)) return buildScaleClimb(sc.root, ints, { bpm, downToo: true, label: `${sc.root} ${sc.name}` });
    const connect = /five boxes|box.to.box|box to box|connecting/.test(sig);
    return buildScaleBox(sc.root, ints, { bpm, scaleCat: sc.cat, scaleName: sc.name, name: sc.name, label: `${sc.root} ${sc.name}`, connect });
  }

  // 3b) MODE lessons — play the characteristic mode SCALE, rooted on the home chord.
  // Quality-match the home chord (minor modes need a minor home) so an ambiguous
  // "C major vs D Dorian" lesson (major home) isn't mis-rooted to C Dorian — those stay chords.
  if (prog.length) {
    const homeMin = /min|m7|♭5|dim|°|ø/.test((prog[0].quality || '').toLowerCase());
    // mixolydian before lydian (and lydian excludes mixolydian) — "mixoLYDIAN" contains "lydian".
    const MODE_KEYS = [['dorian', 'Dorian', true], ['phrygian', 'Phrygian', true], ['mixolydian', 'Mixolydian', false], ['lydian', 'Lydian', false], ['locrian', 'Locrian', true]];
    for (const [kw, name, wantMin] of MODE_KEYS) {
      const hit = kw === 'lydian' ? (sig.includes('lydian') && !sig.includes('mixolydian')) : sig.includes(kw);
      if (hit && wantMin === homeMin) {
        return buildScaleBox(root, SCALE_TYPES.Modes[name], { bpm, scaleCat: 'Modes', scaleName: name, name, label: `${root} ${name}` });
      }
    }
  }

  // 4) Single-chord ARPEGGIO / triad-build drills
  if (prog.length === 1 && /arpeggi|triad build|augmented triad|root position arpeggi/.test(sig)) {
    const c = prog[0];
    return buildArpeggio(toSharp(c.root), chordIntervalsFor(c.quality), { bpm, label: `${toSharp(c.root)}${chordSuffix(c.quality)} arpeggio` });
  }

  // 5) CHORD-PROGRESSION drills (the majority) — walk the changes, one voicing per chord
  if (prog.length) return buildProgression(prog, { bpm, label: progLabel(prog), position: positionStrategyFor(sig) });

  // 6) fallback
  return buildScaleClimb(root, SCALE_TYPES.Diatonic.Major, { bpm, downToo: true, label: `${root} Major` });
}

// ── Player ───────────────────────────────────────────────────────────
// Drive a plan on the main fretboard: light the dimmed path, then step a gold
// focus through each note in time while it sounds. Returns a stop() function.
// opts: { loop, isAlive, gain, colors, onCycle }.
export function playPlan(plan, opts = {}) {
  const { loop = false, isAlive = () => true, gain = 0.2, colors = SEQ_COLORS, onCycle = null } = opts;
  if (!plan) return () => {};
  let timers = [], stopped = false;
  const clearTimers = () => { timers.forEach(t => clearTimeout(t)); timers = []; };

  // ── Chord-progression plan: light each chord across the neck + strum it ──
  if (plan.type === 'chords') {
    if (!plan.chords || !plan.chords.length) return () => {};
    // Voice-led voicing CHAIN: each chord re-voiced from the previous so common tones hold and the
    // rest move minimally — the next-chord ghost then equals the next current, so the flow arrows line up.
    const vl = [];
    plan.chords.forEach((c, i) => { vl[i] = i === 0 ? chordVoicing(c.notes) : voiceLead(vl[i - 1], c.notes); });
    const showChord = (c, idx) => {
      if (stopped || !isAlive()) return;
      const next = plan.chords[(idx + 1) % plan.chords.length];
      if (fretboardView === 'voice') {   // Voice-Leading view: the voice-led grip + the next chord ghosted
        setChordHighlight(c.root, c.notes, c.label, assignFingers(vl[idx]), colors);
        setGhostHighlight(vl[(idx + 1) % plan.chords.length], { stroke: 'rgba(110,198,255,.6)', fill: 'rgba(110,198,255,.08)' });
      } else {                           // every other view: this chord's own fingered grip + ghost the next chord
        setChordHighlight(c.root, c.notes, c.label, c.positions || assignFingers(chordVoicing(c.notes)), colors);
        setGhostHighlight(next.positions || chordVoicing(next.notes), { stroke: 'rgba(255,205,90,.5)', fill: 'rgba(255,205,90,.07)' });
      }
      updateOverlays();
    };
    function cycleChords() {
      let t = 0;
      plan.chords.forEach((c, idx) => {
        timers.push(setTimeout(() => {
          if (stopped || !isAlive()) return;
          showChord(c, idx);
          playChordNotes(c.notes, { dur: (c.dur || 1) * 0.92, strum: 0.03, gain: 0.16 });
        }, t * 1000));
        t += c.dur || 1;
      });
      if (loop) timers.push(setTimeout(() => { if (!stopped && isAlive()) { clearTimers(); if (onCycle) onCycle(); cycleChords(); } }, t * 1000 + 350));
    }
    showChord(plan.chords[0], 0);
    cycleChords();
    return function stop() { stopped = true; clearTimers(); clearGhostHighlight(); updateOverlays(); };
  }

  if (!plan.steps || !plan.steps.length) return () => {};
  const set = (focus, label, trail) => { if (!stopped && isAlive()) { setChordHighlight(plan.root, plan.notes, label || plan.label, plan.positions, plan.colors || colors, focus, trail || null, plan.focusOnly); updateOverlays(); } };
  // Anticipation: build ghost dots (carrying note names) from a step's focus positions.
  const focusToGhost = st => (st.focus || []).map((f, i) => {
    const pos = (plan.positions || []).find(p => p.si === f.si && p.fret === f.fret);   // use the functional spelling (E♭, not D♯)
    return { si: f.si, fret: f.fret, note: (pos && pos.disp) || ((st.play && (st.play[i] || st.play[0])) || {}).note || '' };
  });
  function cycle() {
    let t = 0;
    plan.steps.forEach((st, i) => {
      timers.push(setTimeout(() => {
        if (stopped || !isAlive()) return;
        const nxt = plan.steps[i + 1] || (loop ? plan.steps[0] : null);
        const prv = i > 0 ? plan.steps[i - 1] : (loop ? plan.steps[plan.steps.length - 1] : null);
        // ghost the NEXT note(s) so the eye/hand can read ahead; trail the PREVIOUS one for motion.
        // (focusToGhost carries the functional spelling, so interval drills ghost E♭, not D♯.)
        if (nxt && nxt !== st && nxt.focus && nxt.focus.length) setGhostHighlight(focusToGhost(nxt), { stroke: 'rgba(255,205,90,0.55)', fill: 'rgba(255,205,90,0.07)' });
        else clearGhostHighlight();
        const trail = prv && prv !== st && prv.focus ? prv.focus.map(f => ({ si: f.si, fret: f.fret })) : null;
        set(st.focus, st.label, trail);
        if (opts.onStep) opts.onStep(i);   // let a pedal sync its own UI (NOW/NEXT readout) to playback
        (st.play || []).forEach(pl => playNote(pl.note, pl.octave ?? 3, { dur: (st.dur || 0.4) * 0.96, gain }));
      }, t * 1000));
      t += st.gap || st.dur || 0.4;
    });
    if (loop) {
      timers.push(setTimeout(() => { if (!stopped && isAlive()) { clearTimers(); if (onCycle) onCycle(); cycle(); } }, t * 1000 + 400));
    } else {
      timers.push(setTimeout(() => { clearGhostHighlight(); set(null); }, t * 1000 + 250));  // settle on the whole shape
    }
  }
  set(plan.steps[0].focus, plan.steps[0].label);
  cycle();
  return function stop() { stopped = true; clearTimers(); clearGhostHighlight(); };
}
