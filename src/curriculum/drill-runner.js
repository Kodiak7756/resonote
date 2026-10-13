// ── Drill runner ─────────────────────────────────────────────────────
// Turns a curriculum teach-demo or practice-drill into a SEQUENCE of fretboard
// positions, and plays that sequence on the MAIN fretboard (lighting each note
// as it sounds). Shared by the Theory Path ("Hear & see it" previews) and the
// Practice Manager's Theory library (looping practice exercises) so both speak
// the exact same engine. A "plan" is { root, notes, label, positions, steps }
// where each step is { focus:[{si,fret}], play:[{note,octave}], dur, gap? }.
import { NOTES, SCALE_TYPES, CHORD_TYPES, KEY_PATTERNS, getChordNotes, toSharp, toFlat, intervalLabel, semitonesAbove } from '../core/music-theory.js';
import { customTuning, getNoteAtFret, getInst } from '../core/tuning.js';
import { setChordHighlight, setGhostHighlight, clearGhostHighlight, setConceptInfo, fretboardView } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { playNote, playChordNotes, playPitches } from '../core/synth.js';
import { pickGrip, assignFingers, findScaleBoxes, findTriadsOnSet, TRIAD_QUALITIES } from '../core/voicings.js';

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
  const dur = 60 / (opts.bpm || 100), label = opts.label || `${root} scale`;
  if (opts.barBeats) {   // a drill: hold home to the bar line so the loop comes round on beat 1
    const steps = padToBar(seqSteps(seq, dur), dur, opts.barBeats);
    return { root: toSharp(root), notes: uniqNotes(asc), label, positions: asc, steps, scaleParts: [{ from: 0, to: steps.length, root: toSharp(root), label }] };
  }
  return { root: toSharp(root), notes: uniqNotes(asc), label, positions: asc, steps: seqSteps(seq, dur) };
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
const _pmidi = p => p.octave * 12 + NOTES.indexOf(p.note);
// A box in strict pitch order, one position per pitch (a shape that doubles a pitch on two
// strings would otherwise sound it twice in a row).
function _pitchAsc(ps) {
  const out = [];
  ps.slice().sort((a, b) => _pmidi(a) - _pmidi(b) || b.si - a.si).forEach(p => { if (!out.length || _pmidi(out[out.length - 1]) !== _pmidi(p)) out.push(p); });
  return out;
}
const _rootIdx = (asc, rootPc) => asc.reduce((o, p, i) => (NOTES.indexOf(p.note) === rootPc ? o.concat(i) : o), []);
// Root to root, the way a scale is practised: from the box's LOWEST root up to its highest root
// (or just one octave with opts.octaves = 1) and back down to where it started, so the run begins
// and ends on home. A box that holds only one root plays root → top → bottom → root instead.
function rootRun(asc, rootPc, opts = {}) {
  const idx = _rootIdx(asc, rootPc);
  if (!idx.length) return null;
  const lo = idx[0], hi = opts.octaves === 1 && idx.length >= 2 ? idx[1] : idx[idx.length - 1];
  if (hi > lo) {
    const up = asc.slice(lo, hi + 1);
    return opts.downToo === false ? up : up.concat(up.slice(0, -1).reverse());
  }
  const top = asc.slice(lo), below = asc.slice(0, lo);
  if (!below.length) return opts.downToo === false ? top : top.concat(top.slice(0, -1).reverse());
  return top.concat(top.slice(0, -1).reverse().slice(0, -1), below.slice().reverse(), below.slice(1), [asc[lo]]);
}
// Hold the last note to the next bar line (at least one extra beat), so a looping run always
// comes round on beat 1 and the home note rings instead of being clipped by the restart.
function padToBar(steps, spb, beatsPerBar = 4) {
  if (!steps.length) return steps;
  const bar = Math.max(1, Math.round(beatsPerBar) || 4);
  const total = steps.reduce((t, st) => t + (st.gap || st.dur || spb), 0) / spb;
  let extra = Math.ceil(total / bar - 1e-6) * bar - total;
  if (extra < 1 - 1e-6) extra += bar;
  const last = steps[steps.length - 1];
  const slot = (last.gap || last.dur || spb) + extra * spb;
  steps[steps.length - 1] = { ...last, dur: slot, gap: slot };
  return steps;
}
// The box to run: the one asked for, else the first that holds a full octave root to root.
function pickRunBox(boxes, rootPc, boxIndex) {
  if (boxIndex != null) return boxes[Math.min(boxIndex, boxes.length - 1)];
  return boxes.find(b => _rootIdx(_pitchAsc(_boxAsc(b)), rootPc).length >= 2) || boxes[0];
}
const _posLabel = ps => { const minF = Math.min(...ps.map(p => p.fret)); return minF <= 0 ? 'open position' : `pos. ${minF}fr`; };
// opts.rootToRoot: play from the lowest root to the highest (opts.octaves = 1 → one octave) and
// back, holding home to the bar line (opts.barBeats). Without it the whole box is played edge to
// edge — the Workouts pedal's position drills rely on that.
export function buildScaleBox(root, intervals, opts = {}) {
  const r = toSharp(root), rootPc = NOTES.indexOf(r);
  const boxes = findScaleBoxes(r, intervals, { scaleCat: opts.scaleCat, scaleName: opts.scaleName });
  if (!boxes || !boxes.length) return buildScaleClimb(r, intervals, opts);
  const dur = 60 / (opts.bpm || 100);
  const label0 = opts.label || `${r} ${opts.name || 'scale'}`;
  if (opts.connect && boxes.length >= 2) {
    if (opts.rootToRoot) {
      const linked = buildBoxConnect(r, _pitchAsc(_boxAsc(boxes[0])), _pitchAsc(_boxAsc(boxes[1])), { ...opts, dur, label: label0 });
      if (linked) return linked;
    } else {
      const positions = [..._boxAsc(boxes[0]), ..._boxAsc(boxes[1])];
      const seq = positions.concat(positions.slice(0, -1).reverse());
      return { root: r, notes: uniqNotes(positions), label: `${label0} · ${boxes[0].label} → ${boxes[1].label}`, positions, steps: seqSteps(seq, dur) };
    }
  }
  if (opts.rootToRoot) {
    const asc = _pitchAsc(_boxAsc(pickRunBox(boxes, rootPc, opts.boxIndex)));
    const seq = asc.length >= 2 && rootRun(asc, rootPc, opts);
    if (seq) {
      const positions = asc.filter(p => seq.includes(p));   // light what is played, nothing outside it
      const label = `${label0} · ${_posLabel(positions)}`;
      const steps = padToBar(seqSteps(seq, dur), dur, opts.barBeats);
      return { root: r, notes: uniqNotes(positions), label, positions, steps, scaleParts: [{ from: 0, to: steps.length, root: r, label }] };
    }
  }
  const box = boxes[Math.min(opts.boxIndex || 0, boxes.length - 1)];
  const positions = _boxAsc(box);
  if (positions.length < 2) return buildScaleClimb(r, intervals, opts);
  const seq = opts.downToo === false ? positions : positions.concat(positions.slice(0, -1).reverse());
  return { root: r, notes: uniqNotes(positions), label: `${label0} · ${_posLabel(positions)}`, positions, steps: seqSteps(seq, dur) };
}
// Box 1 → Box 2 the way the link is taught: climb Box 1 from its low root, SLIDE one finger up a
// string (the G string first — it is where the two boxes overlap most comfortably) into Box 2,
// climb on to Box 2's top root and hold it, then come back down the same way, sliding back into
// Box 1 and finishing on the low root.
function buildBoxConnect(r, ascA, ascB, opts) {
  const rootPc = NOTES.indexOf(r), dur = opts.dur;
  const lowA = _rootIdx(ascA, rootPc)[0];
  if (lowA == null) return null;
  const STRING_NAMES = ['high E', 'B', 'G', 'D', 'A', 'low E'];
  for (const si of [2, 3, 1, 4]) {
    if (si >= customTuning.length) continue;
    const onA = ascA.filter(p => p.si === si), onB = ascB.filter(p => p.si === si);
    if (!onA.length || !onB.length) continue;
    const from = onA[onA.length - 1];
    const to = onB.find(p => p.fret > from.fret && p.fret - from.fret <= 3 && _pmidi(p) > _pmidi(from));
    if (!to) continue;
    const iFrom = ascA.indexOf(from), iTo = ascB.indexOf(to);
    const topB = _rootIdx(ascB, rootPc).filter(i => i >= iTo).pop();
    if (iFrom < lowA || topB == null) continue;
    const upA = ascA.slice(lowA, iFrom + 1), upB = ascB.slice(iTo, topB + 1);
    const sName = STRING_NAMES[si] || `string ${6 - si}`;
    const boxA = 'Box 1', boxB = 'Box 2';
    const up = upA.map(p => ({ p, label: boxA })).concat(upB.map((p, k) => ({ p, label: k === 0 ? `slide ↗ on the ${sName} string (${from.fret}→${to.fret}) into ${boxB}` : boxB })));
    const down = up.slice(0, -1).reverse().map(e => ({ ...e, label: e.p === from ? `slide ↘ on the ${sName} string (${to.fret}→${from.fret}) back into ${boxA}` : (upA.includes(e.p) ? boxA : boxB) }));
    const seq = up.concat(down);
    const steps = padToBar(seq.map(e => ({ focus: [{ si: e.p.si, fret: e.p.fret }], play: [{ note: e.p.note, octave: e.p.octave }], dur, label: e.label })), dur, opts.barBeats);
    const positions = upA.concat(upB);
    const label = `${opts.label} · ${boxA} → ${boxB}`;
    return { root: r, notes: uniqNotes(positions), label, positions, steps, scaleParts: [{ from: 0, to: steps.length, root: r, label }] };
  }
  return null;
}
// ── Backing: a home under the run ────────────────────────────────────
// A scale, and a mode above all, means little until the ear knows where home is. A steps plan
// may carry plan.backing = [{ t, dur, pitches, gain, hold, label }] (seconds from the start of
// a pass): audio-only hits the player sounds under the run — the drill's own chords struck on
// each bar, or a held root-and-5th drone (it names home without giving away major or minor,
// so an ear question stays fair).
const _fromMidi = m => ({ note: NOTES[((m % 12) + 12) % 12], octave: Math.floor(m / 12) });
const _lowMidi = pc => 24 + pc + (pc < 4 ? 12 : 0);   // the pitch class in E2…D♯3, the guitar's bottom octave
function backingPitches(root, quality) {
  const r = toSharp(root), q = quality || 'Major', notes = getChordNotes(r, chordIntervalsFor(q));
  const g = pickGrip(r, notes, q, 'open', 0);
  const ps = g ? g.positions.filter(p => p.fret >= 0).map(p => noteAt(p.si, p.fret)) : [];
  if (ps.length >= 3) return ps.sort((a, b) => _pmidi(a) - _pmidi(b));
  const out = []; let m = _lowMidi(NOTES.indexOf(r)) - 1;   // no grip: stack the tones up from a low root
  notes.forEach(n => { const pc = NOTES.indexOf(toSharp(n)); m += ((pc - m) % 12 + 12) % 12 || 12; out.push(_fromMidi(m)); });
  return out;
}
const dronePitches = root => { const m = _lowMidi(NOTES.indexOf(toSharp(root))); return [_fromMidi(m), _fromMidi(m + 7)]; };
// segments: [{ from, to (beats), root, quality, kind: 'chord' | 'drone' }] → one hit per bar
function backingEvents(segments, spb, bar = 4) {
  const ev = [];
  segments.forEach(sg => {
    const drone = sg.kind === 'drone';
    const pitches = drone ? dronePitches(sg.root) : backingPitches(sg.root, sg.quality);
    const label = drone ? `${toSharp(sg.root)} drone` : `${toSharp(sg.root)}${chordSuffix(sg.quality)}`;
    for (let b = sg.from; b < sg.to - 1e-6; b += bar) {
      const len = Math.min(bar, sg.to - b);
      ev.push({ t: b * spb, dur: len * spb, pitches, hold: drone, gain: drone ? 0.05 : 0.055, label });
    }
  });
  return ev;
}
const planBeats = (steps, spb) => steps.reduce((t, st) => t + (st.gap || st.dur || spb), 0) / spb;
// The drill's own chords, in order and for the beats written, looped under the whole run. When
// they change chord, the run's last note is held so the pass ends with the progression.
function withProgBacking(plan, prog, spb, bar) {
  if (!plan || !plan.steps || !plan.steps.length || !prog || !prog.length) return plan;
  let total = planBeats(plan.steps, spb);
  const cycle = prog.reduce((t, c) => t + beatsOf(c), 0);
  if (new Set(prog.map(c => toSharp(c.root) + (c.quality || ''))).size > 1) {
    const want = Math.ceil(total / cycle - 1e-6) * cycle;
    if (want - total > 1e-6) {
      const last = plan.steps[plan.steps.length - 1], slot = (last.gap || last.dur) + (want - total) * spb;
      plan.steps[plan.steps.length - 1] = { ...last, dur: slot, gap: slot };
      if (plan.scaleParts) plan.scaleParts[plan.scaleParts.length - 1].to = plan.steps.length;
      total = want;
    }
  }
  const segs = [];
  for (let b = 0; b < total - 1e-6;) for (const c of prog) {
    if (b >= total - 1e-6) break;
    segs.push({ from: b, to: Math.min(total, b + beatsOf(c)), root: c.root, quality: c.quality });
    b += beatsOf(c);
  }
  plan.backing = backingEvents(segs, spb, bar);
  return plan;
}
function withDrone(plan, root, spb, bar) {
  if (!plan || !plan.steps || !plan.steps.length) return plan;
  plan.backing = backingEvents([{ from: 0, to: planBeats(plan.steps, spb), root, kind: 'drone' }], spb, bar);
  return plan;
}
// "A mode needs a vamp": the run over its vamp, then the very same run with the vamp stopped,
// so the ear hears the colour bloom and then fade back into plain notes.
function vampThenBare(plan, vampName) {
  if (!plan || !plan.backing || !plan.steps.length) return plan;
  const n = plan.steps.length, r = plan.root;
  const over = `${plan.label.split(' · ')[0]} over the ${vampName}`, bare = 'vamp stopped: the same notes, no home under them';
  const a = plan.steps.map(st => ({ ...st, label: over })), b = plan.steps.map(st => ({ ...st, label: bare }));
  return { ...plan, steps: a.concat(b), scaleParts: [{ from: 0, to: n, root: r, label: over }, { from: n, to: 2 * n, root: r, label: bare }] };
}
const progLabelNamed = prog => prog.map(c => toSharp(c.root) + chordSuffix(c.quality)).join('–');

function buildChromatic(root, count, opts = {}) {
  const start = opts.si != null
    ? { si: opts.si, fret: opts.fret != null ? opts.fret : Math.max(0, fretOfOn(opts.si, root)) }
    : pickClimbStart(root, count - 1);
  const ps = Array.from({ length: count }, (_, i) => posWithNote(start.si, start.fret + i));
  const seq = opts.downToo ? ps.concat(ps.slice(0, -1).reverse()) : ps;
  return { root: ps[0].note, notes: uniqNotes(ps), label: opts.label || `${root} chromatic`, positions: ps, steps: seqSteps(seq, 60 / (opts.bpm || 90)) };
}
// Render a harmonic interval as a real, PLAYABLE two-string DOUBLE-STOP — two notes sounded
// TOGETHER can't share a string. The top note goes on a HIGHER string within three frets of the
// root (an open string costs nothing), the way interval shapes are actually fingered: a 5th is
// the next string two frets up, an octave two strings over and two frets up (three when the B
// string is crossed), a minor 2nd the G string with the B string three frets back. null = no
// such shape from this root position.
function dyadNear(lo, semi) {
  const target = _pmidi(lo) + semi;
  let best = null;
  for (let s = lo.si - 1; s >= 0; s--) {            // only HIGHER strings (lower index)
    const g = target - _pmidi(noteAt(s, 0));
    if (g < 0 || g > nfrets()) continue;
    const span = g === 0 ? 0 : lo.fret === 0 ? Math.max(0, g - 3) : Math.abs(g - lo.fret);
    if (span > 3) continue;
    // nearest string first; a fretted shape within two frets beats an open string, because the
    // fretted one is the shape that moves to every other root
    const cost = (g === 0 && lo.fret > 0 ? 2.5 : span) + (lo.si - 1 - s) * 0.5;
    if (!best || cost < best.cost) best = { s, g, cost };
  }
  return best ? posWithNote(best.s, best.g) : null;
}
// Where to put the root so EVERY interval asked for has such a shape: closest in pitch to C3
// (or to C of opts.octave), on the G string or lower, then lowest on the neck, A string before
// low E on a tie. opts.along = semitones the clip also shows up the root's own string (keep that
// within the 12th fret when it can be).
// A minor 2nd has no shape near C3 (C on the A string has no lower string to borrow; on the low E
// it is a five-fret reach), so a set that includes one moves up to C4 on the G string.
function intervalRootPos(r, semis, opts = {}) {
  const pref = (opts.octave || 3) * 12;   // C of that octave
  let best = null;
  for (let si = customTuning.length - 1; si >= 1; si--) for (let f = 0; f <= 12; f++) {
    const lo = posWithNote(si, f);
    if (lo.note !== r) continue;
    if (semis.some(x => !dyadNear(lo, x))) continue;
    const open = f === 0 && semis.every(x => dyadNear(lo, x).fret === 0);
    const cost = Math.abs(_pmidi(lo) - pref) + (opts.preferOpen && !open ? 5 : 0) + f * 0.1 + (si === customTuning.length - 1 ? 0.05 : 0)
      + (si < 2 ? 3 : 0) + (opts.along && f + opts.along > 12 ? 3 : 0);
    if (!best || cost < best.cost) best = { lo, cost };
  }
  return best && best.lo;
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
  const all = opts.resolve != null ? [...intervals, opts.resolve] : intervals;
  const lo0 = intervalRootPos(r, all, opts);
  if (!lo0) return buildInterval(r, intervals[0], opts);   // (a tuning with no two-string shape)
  const lo = { ...lo0, disp: r };   // disp = the note as it should READ (functional spelling)
  const positions = [lo], steps = [];
  intervals.forEach(semi => {
    const hi = dyadNear(lo, semi); hi.disp = spellInterval(r, semi);
    positions.push(hi);
    steps.push({ focus: [{ si: lo.si, fret: lo.fret }], play: [{ note: lo.note, octave: lo.octave }], dur });
    steps.push({ focus: [{ si: hi.si, fret: hi.fret }], play: [{ note: hi.note, octave: hi.octave }], dur });
    steps.push({ focus: [{ si: lo.si, fret: lo.fret }, { si: hi.si, fret: hi.fret }], play: [{ note: lo.note, octave: lo.octave }, { note: hi.note, octave: hi.octave }], dur: dur * 1.5, gap: dur * 1.9 });
  });
  if (opts.resolve != null) {   // sound the tension dyad, then resolve it (still on two strings)
    const res = dyadNear(lo, opts.resolve); res.disp = spellInterval(r, opts.resolve);
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
// minor (the 6th & 7th fall back) — the classical "up bright, down dark" rule. Over the V chord
// (E in A minor) the way down keeps the raised 7th — harmonic minor — because the chord itself
// holds G♯ and a G would clash. One position (5th position for A, low root on the 6th string),
// so only the two changing notes move; eighth notes, up and back in two bars per chord, with
// the chord sounding under it. opts.prog = the drill's chords (default: the home minor chord).
function buildMelodicMinorRun(root, opts = {}) {
  const r = toSharp(root), rootPc = NOTES.indexOf(r);
  const spb = 60 / (opts.bpm || 72), dur = spb / 2;
  const scale = name => SCALE_TYPES.Diatonic[name], pcs = name => scale(name).map(i => (rootPc + i) % 12);
  const cands = (findScaleBoxes(r, scale('Nat. Minor'), { scaleCat: 'Diatonic', scaleName: 'Nat. Minor' }) || [])
    .map(b => _pitchAsc(_boxAsc(b))).filter(a => _rootIdx(a, rootPc).length >= 2);
  // the octave from the low root, and the position where that root sits under the first finger
  const octave = asc => { const i = _rootIdx(asc, rootPc); return asc.slice(i[0], i[1] + 1); };
  const lowRoot = a => a[_rootIdx(a, rootPc)[0]];
  const base = cands.find(a => lowRoot(a).si === customTuning.length - 1 && lowRoot(a).fret > 0 && Math.min(...octave(a).map(p => p.fret)) >= lowRoot(a).fret)
    || cands.find(a => lowRoot(a).si === customTuning.length - 1 && lowRoot(a).fret > 0) || cands[0];
  const mel = base && morphBox(base, pcs('Nat. Minor'), pcs('Mel. Minor'));
  const harm = base && morphBox(base, pcs('Nat. Minor'), pcs('Harm. Minor'));
  if (!mel || !harm) return buildScaleClimb(r, scale('Mel. Minor'), { bpm: opts.bpm, label: `${r} melodic minor` });
  const up = octave(mel.asc), downNat = octave(base).reverse().slice(1), downHarm = octave(harm.asc).reverse().slice(1);
  const n6 = NOTES[(rootPc + 9) % 12], n7 = NOTES[(rootPc + 11) % 12], b6 = NOTES[(rootPc + 8) % 12], b7 = NOTES[(rootPc + 10) % 12];
  const prog = opts.prog && opts.prog.length ? opts.prog : [{ root: r, quality: 'Minor', beats: 8 }];
  const steps = [], scaleParts = [], segs = [], seen = new Set(), positions = [];
  let beat = 0;
  prog.forEach(c => {
    const cr = toSharp(c.root), isV = NOTES.indexOf(cr) === (rootPc + 7) % 12 && !/min|m7|dim|ø/i.test(c.quality || '');
    const name = `${cr}${chordSuffix(c.quality)}`;
    const down = isV ? downHarm : downNat;
    const upLab = `${name}: up with ${n6} and ${n7} (melodic minor)`;
    const downLab = isV ? `${name}: down keeping ${n7} — ${name} holds it (harmonic minor)` : `${name}: down with ${b7} and ${b6} (natural minor)`;
    const part = up.map(p => ({ p, label: upLab })).concat(down.map(p => ({ p, label: downLab })))
      .map(e => ({ focus: [{ si: e.p.si, fret: e.p.fret }], play: [{ note: e.p.note, octave: e.p.octave }], dur, label: e.label }));
    padToBar(part, dur, Math.max(2, beatsOf(c) * 2));
    scaleParts.push({ from: steps.length, to: steps.length + part.length, root: r, label: name });
    steps.push(...part);
    const len = planBeats(part, spb);
    segs.push({ from: beat, to: beat + len, root: cr, quality: c.quality });
    beat += len;
    up.concat(down).forEach(p => { const k = p.si + ':' + p.fret; if (!seen.has(k)) { seen.add(k); positions.push(p); } });
  });
  const plan = { root: r, notes: uniqNotes(positions), label: opts.label || `${r} melodic minor ↑ · natural minor ↓ · ${_posLabel(positions)}`, positions, steps, scaleParts };
  plan.backing = backingEvents(segs, spb, opts.barBeats || 4);
  return plan;
}
// Guide-tone targeting: for each chord, land on its 3rd on the downbeat, walk the 5th and 7th
// (the octave root on a plain triad), then step up by a half-step into the NEXT chord's 3rd. Makes the line actually sound the
// guide tones the lesson names (e.g. B over G7, E over C7) instead of a generic scale run.
function buildGuideTones(prog, opts = {}) {
  const dur = 60 / (opts.bpm || 60);
  // The 3rd comes from the chord's real intervals — a quality-name regex can't tell "Major"
  // or "Maj7" from minor (both start with "m"), which turned every major chord minor.
  const thirdOf = c => { const ints = chordIntervalsFor(c.quality); return ints.find(s => s === 3 || s === 4) ?? ints[1] ?? 4; };
  const positions = [], steps = [];
  prog.forEach((c, i) => {
    const r = toSharp(c.root), rootPc = NOTES.indexOf(r);
    const ints = chordIntervalsFor(c.quality);
    const next = prog[(i + 1) % prog.length];
    const nextThirdPc = (NOTES.indexOf(toSharp(next.root)) + thirdOf(next)) % 12;
    const approachSemi = (((nextThirdPc - 1 + 12) % 12) - rootPc + 24) % 12;   // half step below the next 3rd
    // a plain triad has no 7th to walk — use the root an octave up rather than inventing a ♭7
    const cell = [thirdOf(c), ints[2] != null ? ints[2] : 7, ints[3] != null ? ints[3] : 12, approachSemi];
    const start = pickClimbStart(r, Math.max(...cell, 7));
    cell.forEach((semi, idx) => {
      const p = posWithNote(start.si, start.fret + semi);
      positions.push(p);
      steps.push({ focus: [{ si: p.si, fret: p.fret }], play: [{ note: p.note, octave: p.octave }], dur: idx === 0 ? dur * 1.25 : dur, gap: idx === 3 ? dur * 0.5 : 0, label: idx === 0 ? `${r}: 3rd on beat 1` : (idx === 3 ? 'approach ↗' : undefined) });
    });
  });
  return { root: toSharp(prog[0].root), notes: uniqNotes(positions), label: opts.label || 'Guide tones — land on the 3rd', positions, steps };
}
// Chord-tone arpeggios: root–3rd–5th–3rd for each chord, one note per beat, in close position
// (the 3rd and 5th straight above the grip's lowest root), so the safe landing notes are heard
// (and seen) moving when the chord changes. A tone the grip already holds is played where the
// grip has it; otherwise it goes on the fret nearest the root (open strings count as in position
// down low), so the hand stays in one spot.
function buildChordToneArps(prog, opts = {}) {
  const dur = 60 / (opts.bpm || 70);
  const midi = p => p.octave * 12 + NOTES.indexOf(p.note);
  const positions = [], steps = [], seen = new Set();
  prog.forEach(c => {
    const r = toSharp(c.root), ints = chordIntervalsFor(c.quality);
    const notes = getChordNotes(r, ints);
    const third = ints.find(s => s === 3 || s === 4) ?? ints[1] ?? 4, fifth = ints.find(s => s >= 6 && s <= 8) ?? 7;
    const grip = pickGrip(r, notes, c.quality, 'open', 0);
    const pool = (grip ? grip.positions : chordVoicing(notes)).filter(p => p.fret >= 0)
      .map(p => posWithNote(p.si, p.fret)).sort((a, b) => midi(a) - midi(b));
    const lo = pool.find(p => p.note === r) || lowestPos(r);
    const cost = p => (p.fret === 0 && lo.fret <= 4) ? 0 : Math.abs(p.fret - lo.fret);
    const at = semi => {   // the pitch exactly `semi` above the root: in the grip if it's there, else nearest the root's fret
      const want = midi(lo) + semi, inGrip = pool.find(p => midi(p) === want);
      if (inGrip) return inGrip;
      let best = null;
      for (let si = customTuning.length - 1; si >= 0; si--) for (let f = 0; f <= Math.min(nfrets(), 15); f++) {
        const p = posWithNote(si, f);
        if (midi(p) === want && (!best || cost(p) < cost(best))) best = p;
      }
      return best || posWithNote(lo.si, lo.fret + semi);
    };
    const t3 = at(third), t5 = at(fifth);
    [lo, t3, t5, t3].forEach((p, idx) => {
      const k = p.si + ':' + p.fret; if (!seen.has(k)) { seen.add(k); positions.push(p); }
      steps.push({ focus: [{ si: p.si, fret: p.fret }], play: [{ note: p.note, octave: p.octave }], dur, label: idx === 0 ? `${r}${chordSuffix(c.quality)}: root–3rd–5th–3rd` : undefined });
    });
  });
  return { root: toSharp(prog[0].root), notes: uniqNotes(positions), label: opts.label || 'Chord tones — root, 3rd, 5th, 3rd', positions, steps };
}
// Slash-chord FLAVORS: hold one bass note (C on the lowest string) and cycle upper-structure
// triads on the D-G-B strings. Each triad "harvests" different extensions of the bass —
// G/C = 5·7·9 (maj9), D/C = 9·♯11·13 (Lydian) — so the same bass wears seven colors.
function buildSlashFlavors(opts = {}) {
  const dur = 60 / (opts.bpm || 60);
  const rootName = toSharp(opts.root || 'C');
  const rootPc = NOTES.indexOf(rootName);
  // Two authored positions, same seven harvests. 'e' (default): bass on the lowest
  // string, C at fret 8, trio mid-neck. 'a': bass on the 5th string, C at fret 3,
  // trio in the low-fret zone where the open-position walkdown chords live.
  const aPos = opts.pos === 'a';
  const bassSi = customTuning.length - (aPos ? 2 : 1);
  const anchor = aPos ? 3 : 8;
  // grips are authored around a C bass at the anchor fret — shift everything to the
  // requested root, keeping the bass in the reachable 3–14 zone so the trio stays on the neck
  let bf = fretOfOn(bassSi, rootName); if (bf < 0) bf = anchor;
  if (bf < 3) bf += 12;
  const delta = bf - anchor;
  const bass = posWithNote(bassSi, bf);
  const FLAT = { 'A#': 'B♭', 'D#': 'E♭', 'G#': 'A♭' };
  // [upper semitones above bass, minor?, harvest, sound, [D-string, G-string, B-string] frets for a C bass]
  const FLAVORS = aPos ? [
    [0,  false, '1·3·5',    'home base',            [5, 5, 5]],
    [4,  true,  '3·5·7',    'maj7 — jazzy calm',    [5, 4, 5]],
    [7,  false, '5·7·9',    'maj9 — open, dreamy',  [5, 4, 3]],
    [9,  true,  '1·3·6',    '6 — sweet, vintage',   [7, 5, 5]],
    [2,  false, '9·♯11·13', 'Lydian float',         [4, 2, 3]],
    [5,  false, '1·4·6',    'sus color — “amen”',   [3, 2, 1]],
    [10, false, '♭7·9·11',  'gospel / funk 9sus',   [3, 3, 3]],
  ] : [
    [0,  false, '1·3·5',    'home base',            [10, 9, 8]],
    [4,  true,  '3·5·7',    'maj7 — jazzy calm',    [9, 9, 8]],
    [7,  false, '5·7·9',    'maj9 — open, dreamy',  [9, 7, 8]],
    [9,  true,  '1·3·6',    '6 — sweet, vintage',   [7, 5, 5]],
    [2,  false, '9·♯11·13', 'Lydian float',         [7, 7, 7]],
    [5,  false, '1·4·6',    'sus color — “amen”',   [10, 10, 10]],
    [10, false, '♭7·9·11',  'gospel / funk 9sus',   [8, 7, 6]],
  ];
  const positions = [bass], steps = [];
  const seen = new Set([bass.si + ':' + bass.fret]);
  // resolve every flavor's grip first, so each step can preview what's coming
  const flavors = FLAVORS.map(([semi, minor, harvest, sound, frets]) => {
    const up0 = NOTES[(rootPc + semi) % 12];
    const lab = (FLAT[up0] || up0) + (minor ? 'm' : '') + '/' + rootName;
    return {
      lab, harvest, sound,
      trio: frets.map((f, i) => {
        const p = posWithNote(3 - i, f + delta);      // si 3=D, 2=G, 1=B (same indices on 6- and 8-string)
        if (FLAT[p.note]) p.disp = FLAT[p.note];      // spell flat-side tones properly (B♭, E♭, A♭)
        const k = p.si + ':' + p.fret; if (!seen.has(k)) { seen.add(k); positions.push(p); }
        return p;
      })
    };
  });
  const ghostOf = trio => trio.map(p => ({ si: p.si, fret: p.fret, note: p.disp || p.note }));
  flavors.forEach((fl, fi) => {
    const upper = fl.lab.split('/')[0];
    const next = flavors[(fi + 1) % flavors.length];
    // ONE stable instruction phrase for the whole flavor — it stays on screen for the full
    // chord (bass → notes → strum) and only switches when the next flavor begins.
    const phrase = `${fl.lab} — ${rootName} bass + ${upper} triad on D·G·B · harvests ${fl.harvest} (${fl.sound}) · next: ${next.lab}`;
    // bass first — and GHOST the whole grip so the fretting hand can set up before the notes come
    steps.push({ focus: [{ si: bass.si, fret: bass.fret }], play: [{ note: bass.note, octave: bass.octave }], dur, label: phrase, ghost: ghostOf(fl.trio) });
    fl.trio.forEach((p, i) => steps.push({ focus: [{ si: p.si, fret: p.fret }], play: [{ note: p.note, octave: p.octave }], dur: dur * 0.7, label: phrase, ghost: ghostOf(fl.trio.slice(i + 1)) }));
    const all = [bass, ...fl.trio];
    steps.push({ focus: all.map(p => ({ si: p.si, fret: p.fret })), play: all.map(p => ({ note: p.note, octave: p.octave })), dur: dur * 2, gap: dur * 2.6, label: phrase, ghost: ghostOf(next.trio) });
  });
  return { root: rootName, notes: uniqNotes(positions), label: opts.label || `Flavors over one bass — slash chords (${rootName}${aPos ? ' · A-string bass' : ''})`, positions, steps, focusOnly: true };
}

// The WALKDOWN étude: a descending bass line through the major key, harmonised the way
// songs actually do it — root-position chords where the bass meets a root, slash chords
// everywhere between. Inversions (G/B, C/E) put a chord tone in the bass; seventh-basses
// (Am/G = Am7) tuck the ♭7 underneath. Authored in open position for C; other roots slide
// every grip capo-style (open strings become fretted), so the bass LINE survives any key.
function buildWalkdown(opts = {}) {
  const bpm = opts.bpm || 66, spb = 60 / bpm;
  const beatsAt = i => (opts.beats && opts.beats[i] > 0 ? opts.beats[i] : 2);   // the drill's own bar plan, two beats a grip by default
  const rootName = toSharp(opts.root || 'C');
  const delta = ((NOTES.indexOf(rootName) - NOTES.indexOf('C')) % 12 + 12) % 12;
  // [numeral·name label, chord root, chord tones, grip [si,fret] low→high — si 5 = low E]
  const WALK = [
    ['I · C — bass C (root)',        'C', ['C','E','G'],     [[4,3],[3,2],[2,0],[1,1],[0,0]]],
    ['V · G/B — bass B (3rd of G)',  'G', ['G','B','D'],     [[4,2],[3,0],[2,0],[1,0]]],
    ['vi · Am — bass A (root)',      'A', ['A','C','E'],     [[4,0],[3,2],[2,2],[1,1],[0,0]]],
    ['Am/G = Am7 — bass G (♭7)',     'A', ['A','C','E','G'], [[5,3],[3,2],[2,2],[1,1],[0,0]]],
    ['IV · F — bass F (root)',       'F', ['F','A','C'],     [[5,1],[4,3],[3,3],[2,2],[1,1],[0,1]]],
    ['I · C/E — bass E (3rd of C)',  'C', ['C','E','G'],     [[5,0],[4,3],[3,2],[2,0],[1,1],[0,0]]],
    ['ii · Dm7 — bass D (root)',     'D', ['D','F','A','C'], [[3,0],[2,2],[1,1],[0,1]]],
    ['V · G7 — bass G, turns home',  'G', ['G','B','D','F'], [[5,3],[4,2],[3,0],[2,0],[1,0],[0,1]]],
  ];
  const shift = n => NOTES[(NOTES.indexOf(n) + delta) % 12];
  const chords = WALK.map(([label, cRoot, tones, grip], i) => ({
    root: shift(cRoot),
    notes: tones.map(shift),
    label: delta ? label.replace(/[A-G][♭#]?/g, m => shift(toSharp(m))) : label,
    dur: beatsAt(i) * spb,
    positions: assignFingers(grip.map(([si, f]) => posWithNote(si, f + delta))),
  }));
  return { type: 'chords', label: opts.label || `The walkdown — walking bass through ${rootName}`, chords, timeSig: opts.timeSig };
}

function twoNotePlan(lo, hi, label, dur) {
  const both = [{ si: lo.si, fret: lo.fret }, { si: hi.si, fret: hi.fret }];
  const steps = [
    { focus: [both[0]], play: [{ note: lo.note, octave: lo.octave }], dur },
    { focus: [both[1]], play: [{ note: hi.note, octave: hi.octave }], dur, gap: lo.si === hi.si ? dur * 1.9 : undefined },
  ];
  // two notes on ONE string can only follow each other — sound them together only across strings
  if (lo.si !== hi.si) steps.push({ focus: both, play: [{ note: lo.note, octave: lo.octave }, { note: hi.note, octave: hi.octave }], dur: dur * 1.6, gap: dur * 1.9 });
  return { root: lo.note, notes: uniqNotes([lo, hi]), label, positions: [lo, hi], steps };
}
function buildInterval(root, semis, opts = {}) {
  const start = pickClimbStart(root, semis);
  return twoNotePlan(posWithNote(start.si, start.fret), posWithNote(start.si, start.fret + semis), opts.label || `${root} + ${semis}st`, 60 / (opts.bpm || 84));
}
const _fp = p => ({ si: p.si, fret: p.fret }), _pp = p => ({ note: p.note, octave: p.octave });
const _strName = si => (si === 0 ? 'high ' : si === customTuning.length - 1 ? 'low ' : '') + (customTuning[si].label || customTuning[si].note);
const _nth = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
// An interval CLIP (ear questions, "Hear it" demos): the root, then the top note, then both
// together as a two-string shape. When the caption talks in frets ("C up 1 fret", "A up 12 half
// steps") the top note is first shown up the root's own string, the way the caption says it.
// opts.octave picks the register (an ear pair passes the same one, so neither clip gives itself
// away by sounding higher); opts.preferOpen keeps a pair of open strings open; opts.melodic plays
// the two notes one after the other, overlapping, and never struck together.
function buildIntervalClip(root, semis, opts = {}) {
  const r = toSharp(root), dur = 60 / (opts.bpm || 84);
  const lo0 = intervalRootPos(r, [semis], { ...opts, along: opts.alongString ? semis : 0 });
  if (!lo0) return buildInterval(r, semis, opts);
  const lo = { ...lo0, disp: r }, hi = dyadNear(lo, semis);
  hi.disp = spellInterval(r, semis);
  const along = opts.alongString && lo.fret + semis <= 15 ? { ...posWithNote(lo.si, lo.fret + semis), disp: hi.disp } : null;
  const base = opts.label || `${r} up to ${hi.disp}`;
  const steps = [{ focus: [_fp(lo)], play: [_pp(lo)], dur }];
  if (opts.melodic) {   // two separate plinks, close together, both left ringing
    steps[0] = { ...steps[0], dur: dur * 2, gap: dur * 0.5 };
    steps.push({ focus: [_fp(hi)], play: [_pp(hi)], dur: dur * 2 });
  } else {
    const top = along || hi;
    steps.push({ focus: [_fp(top)], play: [_pp(top)], dur, label: along ? `${base} · ${semis} fret${semis === 1 ? '' : 's'} up the same string` : undefined });
    steps.push({ focus: [_fp(lo), _fp(hi)], play: [_pp(lo), _pp(hi)], dur: dur * 1.6, gap: dur * 1.9, label: `${base} · together: ${_strName(lo.si)} string ${lo.fret ? _nth(lo.fret) + ' fret' : 'open'}, ${_strName(hi.si)} string ${hi.fret ? _nth(hi.fret) + ' fret' : 'open'}` });
  }
  const positions = along ? [lo, along, hi] : [lo, hi];
  return { root: r, notes: uniqNotes(positions), label: base, positions, steps };
}
// "Octave leaps": each open bass string up to its 12th fret and back (same name, higher), then
// the same octave as the two-string shape guitarists actually grab — two strings over and two
// frets up, three when the B string is crossed (open A + G string 2nd fret, open low E + D string
// 2nd fret, open D + B string 3rd fret). Starts on the drill's root string.
function buildOctave(root, opts = {}) {
  const r = toSharp(root), dur = 60 / (opts.bpm || 80), low = customTuning.length - 1;
  const own = [low, low - 1, low - 2].find(s => s >= 0 && customTuning[s].note === r);
  const starts = own != null
    ? [own, ...[low, low - 1, low - 2].filter(s => s !== own)].map(s => posWithNote(s, 0))
    : [low, low - 1].map(s => posWithNote(s, Math.max(0, fretOfOn(s, r)))).filter(p => p.fret + 12 <= nfrets());
  const steps = [], positions = [];
  starts.forEach(lo => {
    const up = posWithNote(lo.si, lo.fret + 12), shape = dyadNear(lo, 12);
    const where = `${lo.note}: 12 frets up the ${_strName(lo.si)} string and back`;
    positions.push(lo, up);
    steps.push({ focus: [_fp(lo)], play: [_pp(lo)], dur, label: where });
    steps.push({ focus: [_fp(up)], play: [_pp(up)], dur, label: where });
    steps.push({ focus: [_fp(lo)], play: [_pp(lo)], dur, label: where });
    if (shape) {
      positions.push(shape);
      steps.push({ focus: [_fp(lo), _fp(shape)], play: [_pp(lo), _pp(shape)], dur, label: `${lo.note}: the same octave on two strings — ${_strName(shape.si)} string, ${_nth(shape.fret)} fret` });
    } else steps[steps.length - 1].dur = steps[steps.length - 1].gap = dur * 2;
  });
  return { root: r, notes: uniqNotes(positions), label: opts.label || `${r} octaves`, positions, steps };
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
// Half vs whole steps, one note after the other up the low E string (two notes can't sound
// together on one string, and a step is a MOVE anyway): half steps one fret apart (E-F, F-F♯,
// F♯-G), then whole steps two frets apart (G-A, A-B). Each pair takes two beats.
function buildStepSizes(opts = {}) {
  const si = customTuning.length - 1, dur = 60 / (opts.bpm || 80);   // low E (thickest)
  const positions = [], steps = [];
  [[0, 1], [1, 2], [2, 3], [3, 5], [5, 7]].forEach(([a, b]) => {
    const pa = posWithNote(si, a), pb = posWithNote(si, b);
    [pa, pb].forEach(p => { if (!positions.some(q => q.fret === p.fret)) positions.push(p); });
    const label = b - a === 1 ? `half step — 1 fret: ${pa.note} to ${pb.note}` : `whole step — 2 frets: ${pa.note} to ${pb.note}`;
    steps.push({ focus: [_fp(pa)], play: [_pp(pa)], dur, label }, { focus: [_fp(pb)], play: [_pp(pb)], dur, label });
  });
  return { root: positions[0].note, notes: uniqNotes(positions), label: 'Half vs whole steps', positions, steps: padToBar(steps, dur, opts.barBeats || 4) };
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
  return ({ Dim: '°', Aug: '+', Maj7: 'maj7', Min7: 'm7', 'm7♭5': 'ø7', Dim7: '°7', '7 (Dom)': '7', Sus4: 'sus4', Sus2: 'sus2', '7♯9': '7♯9', '7♭9': '7♭9', '9': '9', '13': '13', Add9: 'add9' })[q] || q;
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
  // Phrygian (♭2) vs Lydian (♯4), taught in parallel from ONE root, each beside the anchor it
  // bends: natural minor → Phrygian (the 2nd drops a fret), major → Lydian (the 4th rises one).
  if (/dark phrygian.*dreamy lydian|two extremes, each defined/.test(sig) && r0)
    return [
      { root: r0, cat: 'Diatonic', name: 'Nat. Minor', label: `${r0} natural minor`, home: { root: r0, quality: 'Minor' } },
      { root: r0, cat: 'Modes', name: 'Phrygian', label: `${r0} Phrygian (♭2)`, home: { root: r0, quality: 'Minor' } },
      { root: r0, cat: 'Diatonic', name: 'Major', label: `${r0} major`, home: { root: r0, quality: 'Major' } },
      { root: r0, cat: 'Modes', name: 'Lydian', label: `${r0} Lydian (♯4)`, home: { root: r0, quality: 'Major' } },
    ];
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
// Each chord lasts the beats the drill gives it (4 — one bar of 4/4 — when it gives none), so
// "4 beats each", a two-bar home chord and a 3/4 waltz all play at the length they are written.
const beatsOf = c => (c && c.beats > 0 ? c.beats : 4);
// The drill's time signature as [beats per bar, unit]. Data writes it as an array ([3,4]);
// accept "3/4" too so a hand-edited lesson can't silently fall back to 4.
export function timeSigOf(ts) {
  if (Array.isArray(ts) && ts[0] > 0) return [+ts[0], +ts[1] || 4];
  const m = /(\d+)\s*\/\s*(\d+)/.exec(String(ts || ''));
  return m ? [+m[1], +m[2]] : [4, 4];
}
function buildProgression(prog, opts = {}) {
  const bpm = opts.bpm || 90, spb = 60 / bpm;
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
    return { root: r, notes, label: `${c.numeral ? c.numeral + ' · ' : ''}${r}${chordSuffix(c.quality)}${where}`, dur: beatsOf(c) * spb, positions };
  });
  return { type: 'chords', label: opts.label || progLabel(prog), chords, timeSig: opts.timeSig };
}

// ── Requested scale-pattern variations (broken 3rds/4ths, N-per-string, string skip) ──
// All produce a single-position ascending pattern from a chosen start; play one octave+.
function _scaleAscFrom(root, intervals) {
  const start = pickClimbStart(root, 12);
  return [...intervals, 12].map(iv => posWithNote(start.si, start.fret + iv));
}
// The ascending note pool for a PATTERN drill taken as a real hand position — a CAGED/positional
// box spread across the strings — instead of one octave up one string. Two reasons: patterns that
// step by 5ths/6ths/7ths run OUT of notes on a one-octave climb (a 5-note pentatonic paired in
// 7ths has literally nothing to play), and the pattern lives in the shape anyway — that is where
// a guitarist actually practises it. opts.boxIndex CYCLES (modulo) rather than clamping, so a
// caller can walk positions 0,1,2,3… forever without knowing how many boxes a scale has.
function _positionalAsc(root, intervals, opts = {}) {
  const boxes = findScaleBoxes(root, intervals, { scaleCat: opts.scaleCat, scaleName: opts.scaleName });
  if (boxes && boxes.length) {
    const bi = ((Math.round(opts.boxIndex || 0) % boxes.length) + boxes.length) % boxes.length;
    const asc = _boxAsc(boxes[bi]);
    if (asc.length >= 3) {
      const minF = Math.min(...asc.map(p => p.fret));
      return { asc, posLabel: minF <= 0 ? 'open position' : `pos. ${minF}fr`, boxCount: boxes.length, boxIndex: bi };
    }
  }
  return { asc: _scaleAscFrom(root, intervals), posLabel: 'one string', boxCount: 1, boxIndex: 0 };
}
// English ordinal for an interval NUMBER (2nd…7th). The number is skip+1 — a "3rd" is TWO scale
// steps wide — so the suffix has to be decided by skip+1, never by skip (that printed "3ths").
const _ORD = n => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export function buildBrokenInterval(root, intervals, skip, opts = {}) {
  // "broken 3rds" = play scale tones in pairs a 3rd (2 scale-steps) apart: 1-3,2-4,3-5…
  const r = toSharp(root);
  // Default pool is unchanged (one octave up one string) so every existing caller keeps its exact
  // drill; pass opts.boxIndex (or opts.useBox) to pair the tones inside a real position instead.
  let asc = (opts.boxIndex != null || opts.useBox) ? _positionalAsc(r, intervals, opts).asc : _scaleAscFrom(r, intervals);
  // A wide skip over a short pool runs out of scale: minor pentatonic in 7ths yields NO pairs at
  // all (a zero-step plan LOOKS like it is running while playing nothing) and in 6ths yields one,
  // which is a fragment, not an exercise. Below three pairs, widen to the positional pool. Three
  // is chosen so that every skip the pedal ships today (2 and 3, on all four run scales) keeps
  // its exact single-string drill and only the genuinely starved widths change.
  if (asc.length - skip < 3) { const p = _positionalAsc(r, intervals, opts); if (p.asc.length - skip > asc.length - skip) asc = p.asc; }
  const seq = [];
  for (let i = 0; i < asc.length - skip; i++) { seq.push(asc[i]); seq.push(asc[i + skip]); }
  const dur = 60 / (opts.bpm || 90);
  return { root: r, notes: uniqNotes(asc), label: opts.label || `${root} broken ${_ORD(skip + 1)}s`, positions: asc, steps: seqSteps(seq, dur) };
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

// ── N-note scale SEQUENCES ("note runs") ─────────────────────────────
// A scale played straight is one line you climb once. A SEQUENCE breaks it into overlapping
// CELLS that each begin one scale degree higher — n=3 gives 1-2-3, 2-3-4, 3-4-5…; n=4 gives
// 1-2-3-4, 2-3-4-5… Every note therefore gets played in several positions inside the cell
// (first, middle, last), which is how a position stops being a ladder and becomes somewhere
// you can start from ANY degree — the actual skill behind improvising inside a box.
// Built on a positional box, not a single-string climb, because that is where the cell
// fingerings live; the box is also what the fretboard dims in behind the moving focus.
export function buildScaleSequence(root, intervals, n, opts = {}) {
  const r = toSharp(root);
  const bpm = opts.bpm || 90, dur = 60 / bpm;
  const { asc, posLabel, boxCount, boxIndex } = _positionalAsc(r, intervals, opts);
  // 2 is the smallest group that is still a sequence; 7 is a whole diatonic octave — past that
  // the "cell" IS the scale and the exercise has no point. Clamp to the pool as a safety net.
  let cell = Math.max(2, Math.min(7, Math.round(n) || 3));
  if (cell > asc.length) cell = Math.max(2, asc.length);
  // Cells are FULL or they are not played. A truncated last group ("6-7" where every other cell
  // was three notes) does not sound like an ending, it sounds like a mistake — a teacher stops
  // the pattern at the last complete cell, which conveniently tops out on the highest box note
  // anyway (the final ascending cell always ends on it). So: stop cleanly, never wrap.
  const up = [];
  for (let i = 0; i + cell <= asc.length; i++) up.push(asc.slice(i, i + cell));
  // Coming down, the cells mirror (…6-7-8 | 7-6-5 | 6-5-4…). The top cell is NOT replayed
  // backwards: that would sound the turn note twice in a row, which reads as a stumble.
  const groups = opts.downToo === false ? up : up.concat(up.slice(0, -1).reverse().map(g => g.slice().reverse()));
  // A breath after each cell so the EAR parses repeating groups rather than one undifferentiated
  // stream — the whole point of practising a sequence. Pass groupGap:0 to keep it strictly in time.
  const breath = opts.groupGap != null ? opts.groupGap : dur * 0.5;
  const steps = [];
  groups.forEach(g => g.forEach((pp, i) => {
    const st = { focus: [{ si: pp.si, fret: pp.fret }], play: [{ note: pp.note, octave: pp.octave }], dur };
    if (i === g.length - 1 && breath > 0) st.gap = dur + breath;
    steps.push(st);
  }));
  // Label from the root AS WRITTEN (B♭ stays B♭ — NOTES is sharp-only and a theory app that
  // prints A♯ for the key of B♭ teaches the wrong letter); the math above uses the sharp name.
  const written = String(root).replace(/b$/, '♭');
  const base = opts.label || `${written} ${opts.name || opts.scaleName || 'scale'} · sequence in ${cell}s`;
  return { root: r, notes: uniqNotes(asc), label: `${base} · ${posLabel}`, positions: asc, steps, cell, cells: groups.length, boxCount, boxIndex };
}

// Two-part CONTRAST: play scale A, then scale B (relative major↔minor, sharp vs flat key,
// major vs parallel mode, major-pent vs minor-pent) in ONE hand position, so the only thing
// that moves is the note that changes (C major → G major: every F slides up a fret to F♯).
// Each part runs one octave root to root and holds its home to the bar line. Each step carries
// its part's label and shape (step.shape), so the readout and the lit shape follow the part.
const _scalePcs = sp => { const ints = SCALE_TYPES[sp.cat]?.[sp.name] || [0, 2, 4, 5, 7, 9, 11], r = NOTES.indexOf(toSharp(sp.root)); return ints.map(i => (r + i) % 12); };
// Re-finger a box for a scale that differs by a few notes: each outgoing note moves a half step
// (one fret) to its incoming neighbour on the same string. A note that would fall off the nut
// moves to the next lower string instead (counted, so the search can avoid it). null = the two
// scales don't differ by half-step swaps (e.g. pentatonic vs a seven-note scale).
function morphBox(asc, fromPcs, toPcs) {
  const removed = [...new Set(fromPcs)].filter(pc => !toPcs.includes(pc));
  const added = [...new Set(toPcs)].filter(pc => !fromPcs.includes(pc));
  if (removed.length !== added.length || removed.length > 5) return null;
  let move = null;
  if (removed.length) {
    for (const perm of permsOf(added)) {
      const d = removed.map((pc, i) => { const s = ((perm[i] - pc) % 12 + 12) % 12; return s === 1 ? 1 : s === 11 ? -1 : 0; });
      if (d.every(x => x)) { move = new Map(removed.map((pc, i) => [pc, d[i]])); break; }
    }
    if (!move) return null;
  }
  let reloc = 0;
  const out = [];
  for (const p of asc) {
    const pc = NOTES.indexOf(p.note);
    if (!move || !move.has(pc)) { out.push(p); continue; }
    let si = p.si, f = p.fret + move.get(pc);
    if (f < 0) { si = p.si + 1; if (si >= customTuning.length) return null; f = _pmidi(p) - 1 - _pmidi(noteAt(si, 0)); reloc++; }
    if (f < 0 || f > nfrets()) return null;
    out.push(posWithNote(si, f));
  }
  return { asc: _pitchAsc(out), reloc };
}
function buildContrast(specs, opts = {}) {
  const bpm = opts.bpm || 96, dur = 60 / bpm;
  const pcsOf = specs.map(_scalePcs), rootPcs = specs.map(sp => NOTES.indexOf(toSharp(sp.root)));
  const intsOf = sp => SCALE_TYPES[sp.cat]?.[sp.name] || [0, 2, 4, 5, 7, 9, 11];
  // Try every box of every scale in the comparison as the shared position. Keep the one that
  // needs no string changes, stays within a hand span and gives every part a full octave root to
  // root; among those prefer open position (where these lessons' open chords live), then the box
  // the first scale is normally run in (so a pentatonic comparison stays in Box 1), then the
  // lowest on the neck.
  let best = null;
  specs.forEach((sp, i) => {
    const boxes = findScaleBoxes(toSharp(sp.root), intsOf(sp), { scaleCat: sp.cat, scaleName: sp.name }) || [];
    const usual = i === 0 && boxes.length ? pickRunBox(boxes, rootPcs[0]) : null;
    boxes.forEach(b => {
      const base = _pitchAsc(_boxAsc(b));
      let reloc = 0; const parts = [];
      for (let k = 0; k < specs.length; k++) {
        const m = k === i ? { asc: base, reloc: 0 } : morphBox(base, pcsOf[i], pcsOf[k]);
        if (!m) return;
        reloc += m.reloc; parts.push(m.asc);
      }
      const frets = parts.flat().map(p => p.fret), fretted = frets.filter(f => f > 0);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      const thin = parts.some((asc, k) => _rootIdx(asc, rootPcs[k]).length < 2);
      const maxF = Math.max(...frets), open = Math.min(...frets) === 0 && maxF <= 4;
      const score = reloc * 20 + (thin ? 50 : 0) + Math.max(0, span - 4) * 6 + (open ? maxF / 10 : b === usual ? 5 : 5 + maxF);
      if (!best || score < best.score) best = { score, parts };
    });
  });
  const runs = best && best.parts.map((asc, k) => ({ asc, seq: rootRun(asc, rootPcs[k], { octaves: 1 }) }));
  const steps = [], scaleParts = [], allPos = [];
  let first = null;
  specs.forEach((sp, k) => {
    const r = toSharp(sp.root), name = sp.label || `${r} ${sp.name}`;
    let shown, seq;
    if (runs && runs.every(x => x.seq)) { seq = runs[k].seq; shown = runs[k].asc.filter(p => seq.includes(p)); }
    else {   // no shared position (different note counts): each part in its own box, still root to root
      const pl = buildScaleBox(r, intsOf(sp), { bpm, scaleCat: sp.cat, scaleName: sp.name, rootToRoot: true, octaves: 1 });
      shown = pl.positions; seq = pl.steps.map(st => posWithNote(st.focus[0].si, st.focus[0].fret));
    }
    const label = `${name} · ${_posLabel(shown)}`;
    const shape = { root: r, notes: uniqNotes(shown), positions: shown };
    if (!first) first = shape;
    const part = padToBar(seq.map(p => ({ focus: [{ si: p.si, fret: p.fret }], play: [{ note: p.note, octave: p.octave }], dur, label, shape })), dur, opts.barBeats);
    scaleParts.push({ from: steps.length, to: steps.length + part.length, root: r, label });
    steps.push(...part);
    shown.forEach(p => { if (!allPos.some(q => q.si === p.si && q.fret === p.fret)) allPos.push(p); });
  });
  const where = [...new Set(scaleParts.map(s => s.label.split(' · ').pop()))];
  const label = opts.label || (where.length === 1 ? `${specs.map(sp => sp.label || `${toSharp(sp.root)} ${sp.name}`).join('  →  ')} · ${where[0]}` : scaleParts.map(s => s.label).join('  →  '));
  // plan-level root/notes/positions = the FIRST part's shape (what the board shows before it plays)
  const plan = { root: first.root, notes: first.notes, label, positions: first.positions, allPositions: allPos, steps, scaleParts };
  // each part over its own home chord (opts.homes[k] = {root, quality}), or over a drone
  if (opts.homes || opts.drone) {
    let b = 0;
    const segs = scaleParts.map((sp, k) => {
      const len = planBeats(steps.slice(sp.from, sp.to), dur), h = opts.homes && opts.homes[k];
      const seg = h ? { from: b, to: b + len, root: h.root, quality: h.quality } : { from: b, to: b + len, root: specs[k].root, kind: 'drone' };
      b += len;
      return seg;
    });
    plan.backing = backingEvents(segs, dur, opts.barBeats || 4);
  }
  return plan;
}
// The chord a scale calls home, when the lesson doesn't name one.
function homeChordOf(sp) {
  const n = sp.name || '';
  const quality = /Locrian/.test(n) ? 'm7♭5' : /Mixolydian/.test(n) ? '7 (Dom)' : /Minor|Aeolian|Dorian|Phrygian/.test(n) ? 'Minor' : 'Major';
  return { root: sp.root, quality };
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

// ── Triad March ──────────────────────────────────────────────────────
// Six of the curriculum's triad drills were written out longhand in C. They are not really six
// drills — they are four MOVES you can make with close-position triads on a 3-string set, and
// each one is generated, not authored, so it transposes for free: change the key root and every
// grip re-derives from findTriadsOnSet. Nothing here stores a fret for a key.
//   set        🪜 one chord, every inversion it owns on ONE string set, low → high
//   across     🎚 one chord, set by set, hand parked in one zone — it climbs in register
//                 while the fingers barely move, and the inversion rotates by itself
//   path       🪢 a diatonic progression, each chord taking the grip whose three fingers move
//                 LEAST from the last — voice leading you can measure in frets
//   inversions 🎯 the ladder arpeggiated, one note per beat, so the ear hears the same chord
//                 with three different bottom notes
// Every type returns a STEPS plan (chord types sound their three notes in one step) — a
// {type:'chords'} plan never fires playPlan's onStep, which would leave a step-strip playhead
// frozen at chip 0. `plan.items` additionally exposes the march as flash-queue-shaped items
// ({label, sub, root, notes, positions}) for a pedal that drives its own bar timer.
const MARCH_QSUF = { Major: '', Minor: 'm', Dim: '°', Aug: '+' };
const MARCH_INV = ['root position', '1st inv (3rd low)', '2nd inv (5th low)'];
const MARCH_ALIAS = { set: 'set', ladder: 'set', across: 'across', neck: 'across', path: 'path', prog: 'path', voicelead: 'path', inversions: 'inversions', arp: 'inversions', arpeggio: 'inversions' };

export const TRIAD_MARCH_TYPES = [
  { id: 'set',        alias: 'ladder', icon: '🪜', name: 'Ladder',        sub: 'one chord · every inversion up one string set', transport: 'flash' },
  { id: 'across',     alias: 'across', icon: '🎚', name: 'Across',        sub: 'one chord · set by set · hand stays in one zone', transport: 'flash' },
  { id: 'path',       alias: 'path',   icon: '🪢', name: 'Shortest path', sub: 'a progression voice-led by nearest grip',        transport: 'flash' },
  { id: 'inversions', alias: 'arp',    icon: '🎯', name: 'Arpeggio',      sub: 'the ladder note by note · root → 3rd → 5th',     transport: 'run' },
];
// Degree arrays, never chord names — that IS the transposition. Two come straight from the
// curriculum's own triad drills ("Hold the Common Tone", "Stay in the Zone").
export const TRIAD_MARCH_PROGRESSIONS = [
  { name: 'I–V–vi–IV (pop)',    degs: [0, 4, 5, 3] },
  { name: 'I–vi–IV–V (50s)',    degs: [0, 5, 3, 4] },
  { name: 'ii–V–I (jazz)',      degs: [1, 4, 0] },
  { name: 'I–IV–V–I (anthem)',  degs: [0, 3, 4, 0] },
  { name: 'vi–IV–I–V',          degs: [5, 3, 0, 4] },
  { name: 'I–vi–IV–I (common tone)', degs: [0, 5, 3, 0] },
];

// Every run of 3 adjacent strings, low→high inside the set; index 0 = the TOP set (G·B·e on
// standard). Adapts to whatever tuning.js says the instrument is, so an 8-string gets 6 sets.
function marchStringSets() {
  const out = [];
  for (let i = 0; i + 2 < customTuning.length; i++) {
    const idxs = [i + 2, i + 1, i];
    out.push({ idxs, label: idxs.map(si => customTuning[si].label || customTuning[si].note).join('·') });
  }
  return out;
}
// Which side of the circle of fifths the key lives on, so a march in F reads B♭ and not A♯.
// NOTES is sharp-only; printing A♯ in F major actively teaches the wrong letter. Labels only —
// plan.notes and step.play keep the sharp names the synth and the mic gate match on.
function marchSpeller(rootRaw, keyType) {
  const raw = String(rootRaw || 'C').replace('♭', 'b').replace('♯', '#');
  if (raw.slice(1).includes('#')) return n => n;                        // written sharp → keep sharps
  const tonicPc = Math.max(0, NOTES.indexOf(toSharp(raw)));
  // the key signature belongs to the PARENT major: a minor key borrows its relative major's
  // accidentals (D minor is one flat because F major is), Dorian its major a whole step down.
  const rel = keyType === 'Dorian' ? (tonicPc + 10) % 12 : (keyType === 'Minor' || keyType === 'Harm. Minor') ? (tonicPc + 3) % 12 : tonicPc;
  let sharps = (rel * 7) % 12; if (sharps > 6) sharps -= 12;            // +n sharps / −n flats
  const useFlats = raw.slice(1).includes('b') || sharps < 0;
  return n => useFlats ? toFlat(n).replace('b', '♭') : n;
}
const _midi = p => p.octave * 12 + NOTES.indexOf(p.note);
const _gripCost = (a, b) => a.frets.reduce((t, f, k) => t + Math.abs(f - b.frets[k]), 0);

export function buildTriadMarch(root, quality, opts = {}) {
  const type = MARCH_ALIAS[String(opts.type || 'set').toLowerCase()] || 'set';
  const keyType = KEY_PATTERNS[opts.keyType] ? opts.keyType : 'Major';
  const pat = KEY_PATTERNS[keyType];
  const rootName = toSharp(String(root || 'C').replace('♭', 'b').replace('♯', '#'));
  const tonicPc = Math.max(0, NOTES.indexOf(rootName));
  const spell = marchSpeller(root, keyType);
  const sets = marchStringSets();
  const setIdx = Math.max(0, Math.min(sets.length - 1, (opts.setIdx != null ? opts.setIdx : opts.set) | 0));
  const set = sets[setIdx];
  const bpm = opts.bpm || 80;
  const chordDur = (opts.beatsPerChord || 4) * 60 / bpm;   // one 4/4 bar per grip by default
  const noteDur = 60 / bpm;
  const anchor = opts.anchor != null ? opts.anchor : 5;
  // A march deliberately CLIMBS, so the flash engine's min<=12 "stay low" filter is wrong here:
  // a diatonic climb legitimately reaches fret 13–14 in keys like G and B, and truncating it
  // would make the march end early in some keys and not others — the exact key-dependence the
  // generated march exists to kill. findTriadsOnSet hard-caps at fret 17 regardless.
  const ceiling = opts.ceiling != null ? opts.ceiling : Math.max(12, Math.min(15, nfrets() - 4));
  const dir = opts.dir || (opts.descend ? 'down' : 'up');

  const gripsOn = (pc, q, idxs) => {
    const all = findTriadsOnSet(pc, q, idxs) || [];
    const on = all.filter(g => g.min <= ceiling);
    return on.length ? on : all;                       // a non-standard tuning could empty this
  };
  const chordOfDeg = deg => {
    const d = ((deg % 7) + 7) % 7, pc = (tonicPc + pat.intervals[d]) % 12, q = pat.qualities[d];
    return { pc, quality: q, numeral: pat.numerals[d], name: spell(NOTES[pc]) + (MARCH_QSUF[q] ?? '') };
  };
  const litQuality = TRIAD_QUALITIES[quality] ? quality : 'Major';
  // Degree-of-key (follows the session key) if asked for, else the literal root+quality given.
  const subject = opts.deg != null ? chordOfDeg(opts.deg)
    : { pc: tonicPc, quality: litQuality, numeral: '', name: spell(rootName) + (MARCH_QSUF[litQuality] ?? '') };

  const mkItem = (ch, g, label) => ({
    root: NOTES[ch.pc], quality: ch.quality, numeral: ch.numeral, label, sub: `${set.label} strings`,
    notes: (TRIAD_QUALITIES[ch.quality] || TRIAD_QUALITIES.Major).map(iv => NOTES[(ch.pc + iv) % 12]),
    frets: g.frets, rot: g.rot, minFret: g.min, span: Math.max(...g.frets) - Math.min(...g.frets),
    positions: assignFingers(g.frets.map((f, k) => {
      const si = (g.idxs || set.idxs)[k], p = posWithNote(si, f);
      const d = spell(p.note); if (d !== p.note) p.disp = d;      // ghost/readout spelling follows the key
      return p;
    })),
  });

  let items = [], travel = 0, loopTravel = 0, headline = '';

  if (type === 'across') {
    // Low set → high set with the fretting hand parked at `anchor`: the chord climbs in register
    // while the hand barely moves, and root→1st→2nd→root rotates all by itself. Note the shape is
    // NOT identical set to set — crossing the B string costs a fret — which is the real lesson.
    let order = sets.slice().reverse();
    if (dir === 'down') order = order.slice().reverse();
    items = order.map(st => {
      const gs = gripsOn(subject.pc, subject.quality, st.idxs);
      if (!gs.length) return null;
      const g = gs.reduce((a, b) => {
        const da = Math.abs(a.min - anchor), db = Math.abs(b.min - anchor);
        return (db < da || (db === da && b.min < a.min)) ? b : a;
      }, gs[0]);
      const it = mkItem(subject, { ...g, idxs: st.idxs }, `${subject.name} · ${MARCH_INV[g.rot]} · ${g.min}fr`);
      it.sub = `${st.label} strings`;
      return it;
    }).filter(Boolean);
    headline = `${subject.name} across the neck · hand at ${anchor}fr`;
  } else if (type === 'path') {
    // Greedy nearest-grip voice leading. (Measured against a full DP with loop closure over
    // 5 progressions × 12 keys × 4 string sets: greedy was globally optimal in all 240 — so the
    // simple rule IS the right rule, and the fret total it produces is a number worth printing.)
    const degs = resolveMarchProg(opts.progression, pat);
    let prev = null, first = null;
    items = degs.map(d => {
      const ch = chordOfDeg(d), gs = gripsOn(ch.pc, ch.quality, set.idxs);
      if (!gs.length) return null;
      const g = prev
        ? gs.reduce((a, b) => (_gripCost(b, prev) < _gripCost(a, prev) ? b : a), gs[0])
        : gs.reduce((a, b) => (Math.abs(b.avg - anchor) < Math.abs(a.avg - anchor) ? b : a), gs[0]);
      if (prev) travel += _gripCost(g, prev);
      prev = g; if (!first) first = g;
      return mkItem(ch, g, `${ch.numeral} · ${ch.name} · ${g.min}fr`);
    }).filter(Boolean);
    if (first && prev) loopTravel = _gripCost(first, prev);
    headline = `${progNameOf(opts.progression)} in ${spell(rootName)} ${keyType} · ${set.label} · ${travel} frets of travel`;
  } else {
    // 'set' (ladder) and 'inversions' (the same ladder, arpeggiated).
    let gs = gripsOn(subject.pc, subject.quality, set.idxs);   // already sorted low → high
    if (dir === 'down') gs = gs.slice().reverse();
    else if (dir === 'updown') gs = gs.concat(gs.slice(1, -1).reverse());
    // Do NOT force a root-position start: for a root sitting high on the set's bottom string
    // there simply is no root-position grip low enough to fit two inversions above it under the
    // 17-fret ceiling (true in 63 of 192 root×quality×set combinations). March the grips in the
    // order the neck actually presents them and name each inversion honestly — the varying
    // entry point is itself the lesson about where a shape lives.
    items = gs.map(g => mkItem(subject, g, `${subject.name} · ${MARCH_INV[g.rot]} · ${g.min}fr`));
    headline = type === 'inversions'
      ? `${subject.name} inversion cycle · ${set.label} strings`
      : `${subject.name} triad ladder · ${set.label} strings`;
  }

  // Last-resort guard: findTriadsOnSet returns 3–5 grips for all 192 standard-tuning cases, but a
  // user-defined tuning could starve a set. Fall back to the whole-neck inversion stack.
  if (!items.length) return buildInversions(rootName, TRIAD_QUALITIES[subject.quality] || TRIAD_QUALITIES.Major, { bpm, quality: subject.quality, label: opts.label });

  const positions = [], seen = new Set();
  items.forEach(it => it.positions.forEach(p => { const k = p.si + ':' + p.fret; if (!seen.has(k)) { seen.add(k); positions.push(p); } }));

  let steps;
  if (type === 'inversions') {
    // One note per beat, root → 3rd → 5th of each grip, so the SAME chord is heard three times
    // with three different bottom notes. A steps plan (not chords), so it drives onStep — the
    // strip playhead and note-by-note mic listening work exactly as they do for a scale run.
    const flat = [];
    items.forEach((it, gi) => it.positions.slice().sort((a, b) => _midi(a) - _midi(b)).forEach(p => flat.push({ p, gi, label: it.label })));
    const seq = (opts.downToo === false || dir === 'updown') ? flat : flat.concat(flat.slice(0, -1).reverse());
    steps = seq.map((e, i) => {
      const st = { focus: [{ si: e.p.si, fret: e.p.fret }], play: [{ note: e.p.note, octave: e.p.octave }], dur: noteDur, label: e.label };
      if (i < seq.length - 1 && seq[i + 1].gi !== e.gi) st.gap = noteDur * 1.75;   // breathe between inversions
      return st;
    });
  } else {
    steps = items.map(it => ({
      focus: it.positions.map(p => ({ si: p.si, fret: p.fret })),
      play: it.positions.map(p => ({ note: p.note, octave: p.octave })),
      dur: chordDur, label: it.label,
    }));
  }

  return {
    root: type === 'path' ? rootName : NOTES[subject.pc],
    notes: uniqNotes(positions),
    label: opts.label || headline,
    positions, steps, items,
    march: { type, setIdx, setLabel: set.label, anchor, ceiling, keyType, travel, loopTravel, grips: items.length, span: Math.max(...items.map(it => it.span)) },
  };
}
function resolveMarchProg(p, pat) {
  if (Array.isArray(p) && p.length) {
    if (typeof p[0] === 'number') return p.map(d => ((d % 7) + 7) % 7);
    // numerals are key-relative already, so 'I' means degree 0 in ANY key; strip figures
    // ("Imaj7"→I, "vii°7"→VII) and compare case-insensitively — major and minor cores match.
    const core = s => String(s).replace(/[^ivxIVX]/g, '').toUpperCase();
    return p.map(nm => Math.max(0, pat.numerals.findIndex(x => core(x) === core(nm)))).filter(d => d >= 0);
  }
  if (typeof p === 'string') {
    const hit = TRIAD_MARCH_PROGRESSIONS.find(x => x.name.toLowerCase().startsWith(p.toLowerCase()) || x.name.toLowerCase().includes(p.toLowerCase()));
    if (hit) return hit.degs;
  }
  const i = typeof p === 'number' ? ((p % TRIAD_MARCH_PROGRESSIONS.length) + TRIAD_MARCH_PROGRESSIONS.length) % TRIAD_MARCH_PROGRESSIONS.length : 0;
  return TRIAD_MARCH_PROGRESSIONS[i].degs;
}
function progNameOf(p) {
  if (typeof p === 'string') { const hit = TRIAD_MARCH_PROGRESSIONS.find(x => x.name.toLowerCase().includes(p.toLowerCase())); if (hit) return hit.name; return p; }
  if (Array.isArray(p)) return 'Custom path';
  const i = typeof p === 'number' ? ((p % TRIAD_MARCH_PROGRESSIONS.length) + TRIAD_MARCH_PROGRESSIONS.length) % TRIAD_MARCH_PROGRESSIONS.length : 0;
  return TRIAD_MARCH_PROGRESSIONS[i].name;
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
    const run = buildScaleBox(root, ints, { bpm: 96, scaleCat: demo.scaleCat, scaleName: demo.scaleName, name: demo.scaleName, label: demo.caption || `${root} ${demo.scaleName || 'scale'}`, rootToRoot: true, octaves: 1 });
    // a home under the clip: demo.over = {root, quality} strikes that chord each bar (an ear
    // question can play two scales over the SAME chord); demo.drone holds the root and 5th
    if (demo.over && demo.over.root) return withProgBacking(run, [{ root: demo.over.root, quality: demo.over.quality, beats: 4 }], 60 / 96, 4);
    if (demo.drone) return withDrone(run, root, 60 / 96, 4);
    return run;
  }
  if (demo.kind === 'interval') {
    const semis = (((demo.intervalSemitones || 0) % 24) + 24) % 24;
    const cap = demo.caption || '';
    return buildIntervalClip(root, semis || 12, {
      bpm: semis === 12 ? 80 : 84, label: demo.caption, octave: demo.octave, melodic: !!demo.melodic,
      preferOpen: /open string/i.test(cap), alongString: /\bfrets?\b|half steps?\b/i.test(cap),
    });
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
  const timeSig = timeSigOf(drill.timeSig);

  // 1) Single-note FOUNDATION drills (named, unambiguous)
  if (/alphabet/.test(title)) return buildScaleClimb('A', SCALE_TYPES.Diatonic['Nat. Minor'], { bpm: bpmOverride || 120, downToo: true, label: 'A natural minor — the musical alphabet, up one octave from open A' });
  // "Finding any note" → show the SAME note EVERYWHERE on the neck (every A, etc.), so the
  // relationship across the fretboard reads — not just one position.
  if (/finding notes|finding any note/.test(sig)) return buildNoteEverywhere(root, { bpm, label: `Every ${root} on the neck` });
  if (/count|chromatic|finding/.test(title) || /one fret at a time/.test(sig)) return buildChromatic('E', 9, { bpm, si: customTuning.length - 1, fret: 0, label: 'Counting up the low E string by half steps' });
  if (/enharmonic/.test(title)) return buildEnharmonic({ bpm });
  if (voicing.includes('open string')) return buildOpenStrings({ bpm });
  if (/step size/.test(title) || /half[- ]?step|whole[- ]?step/.test(title)) return buildStepSizes({ bpm, barBeats: timeSig[0] });
  if (/two-note octaves|octave leaps/.test(sig)) return buildOctave(root, { bpm });

  // 1.4) The WALKDOWN étude — authored open-position descent (bass = the scale, down). Keyed on
  // "walkdown" only: the Walking Bass Lines lesson (I–vi–ii–V) also says "walking bass" and
  // must fall through to its own progression, not borrow this étude.
  if (/walkdown/.test(sig)) return buildWalkdown({ bpm, root, beats: prog.map(c => c.beats), timeSig });

  // 1.5) SLASH-CHORD flavors — one held bass, cycling upper-structure triads above it.
  // "A string / 5th string" in the drill text moves the bass to the second authored position.
  if (/upper.structure|slash chord/.test(sig)) return buildSlashFlavors({ bpm, root, pos: /a[- ]string|5th[- ]string/.test(sig) ? 'a' : 'e' });

  // 2) INTERVAL drills (Unit 2 etc.) — root → each interval (fixes "shows a triad")
  const iv = intervalSetFor(voicing);
  if (iv) return buildIntervalShape(root, iv.intervals, { bpm, label: iv.label, resolve: iv.resolve });

  // 2.5) TWO-PART CONTRAST — play scale A then scale B (relative maj↔min, sharp vs flat key,
  // major vs parallel mode, major-pent vs minor-pent) so the lesson's whole comparison is heard.
  const contrast = contrastFor(sig, prog);
  if (contrast) {
    // each part over its home chord: the drill's own chord when it names one per part, else the scale's
    const same = (a, b) => NOTES.indexOf(toSharp(a)) === NOTES.indexOf(toSharp(b));
    const homes = contrast.map((sp, k) => sp.home || (prog.length === contrast.length && same(prog[k].root, sp.root) ? prog[k] : homeChordOf(sp)));
    return buildContrast(contrast, { bpm, barBeats: timeSig[0], homes });
  }

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
    return buildMelodicMinorRun(root, { bpm, prog, barBeats: timeSig[0] });

  // 2.85) Chord-tone arpeggios — root–3rd–5th–3rd through each chord (C-E-G-E over C…).
  if ((/land on chord tones/.test(title) || /root[–-]3rd[–-]5th[–-]3rd/.test(sig)) && prog.length)
    return buildChordToneArps(prog, { bpm, label: progLabel(prog) + ' — chord tones' });

  // 2.9) Guide-tone targeting — land on each chord's 3rd on the downbeat (B over G7, E over C7…).
  if (/hit the 3rd|targeting the 3rd|3rd on beat 1/.test(sig) && prog.length)
    return buildGuideTones(prog, { bpm, label: progLabel(prog) + ' — guide tones' });

  // 3) SCALE runs — play a real CAGED BOX (positional, across the strings) the way guitar is
  // actually taught & played, NOT up a single string. Exception: the W-W-H lesson stays a
  // single-string climb so the whole-step/half-step pattern (2 frets vs 1) reads clearly.
  if (/scale ascending|scale run|scale climb|single-note scale|single note scale|w-w-h|scale degrees|scales|pentatonic|box|five boxes|blue note|aeolian climb|melodic minor/.test(sig)) {
    const sc = scaleFor(sig, prog), ints = SCALE_TYPES[sc.cat][sc.name];
    // the drill's chords sound under the run, so every scale is heard against its home
    if (/w-w-h/.test(sig)) return withProgBacking(buildScaleClimb(sc.root, ints, { bpm, downToo: true, label: `${sc.root} ${sc.name}`, barBeats: timeSig[0] }), prog, 60 / bpm, timeSig[0]);
    const connect = /five boxes|box.to.box|box to box|connecting/.test(sig);
    return withProgBacking(buildScaleBox(sc.root, ints, { bpm, scaleCat: sc.cat, scaleName: sc.name, name: sc.name, label: `${sc.root} ${sc.name}`, connect, rootToRoot: true, barBeats: timeSig[0] }), prog, 60 / bpm, timeSig[0]);
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
        const run = withProgBacking(buildScaleBox(root, SCALE_TYPES.Modes[name], { bpm, scaleCat: 'Modes', scaleName: name, name, label: `${root} ${name}`, rootToRoot: true, barBeats: timeSig[0] }), prog, 60 / bpm, timeSig[0]);
        return /stop the vamp/.test(sig) ? vampThenBare(run, `${progLabelNamed(prog)} vamp`) : run;
      }
    }
  }

  // 4) Single-chord ARPEGGIO / triad-build drills
  if (prog.length === 1 && /arpeggi|triad build|augmented triad|root position arpeggi/.test(sig)) {
    const c = prog[0];
    return buildArpeggio(toSharp(c.root), chordIntervalsFor(c.quality), { bpm, label: `${toSharp(c.root)}${chordSuffix(c.quality)} arpeggio` });
  }

  // 5) CHORD-PROGRESSION drills (the majority) — walk the changes, one voicing per chord
  if (prog.length) return buildProgression(prog, { bpm, label: progLabel(prog), position: positionStrategyFor(sig), timeSig });

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
    // A chord that BRINGS its own positions (e.g. the Voicing Lab's string-set grips, already
    // voice-led on a chosen string set) keeps them — the generic chain only fills the gaps.
    const vl = [];
    plan.chords.forEach((c, i) => { vl[i] = c.positions ? c.positions : (i === 0 ? chordVoicing(c.notes) : voiceLead(vl[i - 1], c.notes)); });
    const showChord = (c, idx) => {
      if (stopped || !isAlive()) return;
      const next = plan.chords[(idx + 1) % plan.chords.length];
      // facts strip updates PER CHORD as it lands — name, spelled notes, degrees — so the
      // theory of the moment is restated under the neck all through a looping practice.
      if (c.notes && c.notes.length) {
        const rows = [{ label: 'NOTES', value: c.notes.join(' · ') }];
        if (c.root) rows.push({ label: 'DEGREES', value: c.notes.map(n => intervalLabel(c.root, n, semitonesAbove(c.root, c.notes))).join(' · ') + ' of ' + c.root });
        setConceptInfo({ title: c.label || c.root || '', rows });
      }
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
          // broadcast what's sounding so other pedals (Circle of Fifths trace…) can follow along
          window.dispatchEvent(new CustomEvent('resonote:played', { detail: { pcs: c.notes.slice(), root: c.root, label: c.label } }));
        }, t * 1000));
        t += c.dur || 1;
      });
      // the next pass starts exactly one chord-length after the last chord — no dead air at the seam
      if (loop) timers.push(setTimeout(() => { if (!stopped && isAlive()) { clearTimers(); if (onCycle) onCycle(); cycleChords(); } }, t * 1000));
    }
    showChord(plan.chords[0], 0);
    cycleChords();
    return function stop() { stopped = true; clearTimers(); clearGhostHighlight(); updateOverlays(); };
  }

  if (!plan.steps || !plan.steps.length) return () => {};
  // A step may carry its own `shape` ({root, notes, positions}) — a two-scale comparison lights
  // the scale that is sounding, so the one note that changes is seen to move.
  const set = (focus, label, trail, st) => {
    if (stopped || !isAlive()) return;
    const sh = (st && st.shape) || plan;
    setChordHighlight(sh.root || plan.root, sh.notes || plan.notes, label || plan.label, sh.positions || plan.positions, plan.colors || colors, focus, trail || null, plan.focusOnly);
    updateOverlays();
  };
  // Anticipation: build ghost dots (carrying note names) from a step's focus positions.
  const focusToGhost = st => (st.focus || []).map((f, i) => {
    const pos = ((st.shape && st.shape.positions) || plan.positions || []).find(p => p.si === f.si && p.fret === f.fret);   // use the functional spelling (E♭, not D♯)
    return { si: f.si, fret: f.fret, note: (pos && pos.disp) || ((st.play && (st.play[i] || st.play[0])) || {}).note || '' };
  });
  function cycle() {
    let t = 0;
    // the home under the run (chords struck each bar, or a held drone) — audio only, every pass
    (plan.backing || []).forEach(ev => timers.push(setTimeout(() => {
      if (stopped || !isAlive()) return;
      playPitches(ev.pitches, { dur: ev.dur * 0.98, strum: ev.hold ? 0 : 0.025, gain: ev.gain || 0.055, hold: !!ev.hold });
    }, ev.t * 1000)));
    plan.steps.forEach((st, i) => {
      timers.push(setTimeout(() => {
        if (stopped || !isAlive()) return;
        const nxt = plan.steps[i + 1] || (loop ? plan.steps[0] : null);
        const prv = i > 0 ? plan.steps[i - 1] : (loop ? plan.steps[plan.steps.length - 1] : null);
        // ghost the NEXT note(s) so the eye/hand can read ahead; trail the PREVIOUS one for motion.
        // A step may carry its own `ghost` positions (e.g. the slash-chord drill previews the WHOLE
        // upcoming grip so fingers can be placed early); otherwise default to the next step's focus.
        // (focusToGhost carries the functional spelling, so interval drills ghost E♭, not D♯.)
        const gh = (st.ghost && st.ghost.length) ? st.ghost
          : (nxt && nxt !== st && nxt.focus && nxt.focus.length) ? focusToGhost(nxt) : null;
        if (gh) setGhostHighlight(gh, { stroke: 'rgba(255,205,90,0.55)', fill: 'rgba(255,205,90,0.07)' });
        else clearGhostHighlight();
        const trail = prv && prv !== st && prv.focus ? prv.focus.map(f => ({ si: f.si, fret: f.fret })) : null;
        set(st.focus, st.label, trail, st);
        if (opts.onStep) opts.onStep(i);   // let a pedal sync its own UI (NOW/NEXT readout) to playback
        (st.play || []).forEach(pl => playNote(pl.note, pl.octave ?? 3, { dur: (st.dur || 0.4) * 0.96, gain }));
        // broadcast what's sounding so other pedals (Circle of Fifths trace…) can follow along
        if (st.play && st.play.length) window.dispatchEvent(new CustomEvent('resonote:played', { detail: { pcs: st.play.map(pl => pl.note), label: st.label || plan.label } }));
      }, t * 1000));
      t += st.gap || st.dur || 0.4;
    });
    if (loop) {   // seamless: the next pass lands on the beat after the last step's slot
      timers.push(setTimeout(() => { if (!stopped && isAlive()) { clearTimers(); if (onCycle) onCycle(); cycle(); } }, t * 1000));
    } else {
      timers.push(setTimeout(() => { clearGhostHighlight(); set(null); }, t * 1000 + 250));  // settle on the whole shape
    }
  }
  set(plan.steps[0].focus, plan.steps[0].label, null, plan.steps[0]);
  cycle();
  return function stop() { stopped = true; clearTimers(); clearGhostHighlight(); };
}
