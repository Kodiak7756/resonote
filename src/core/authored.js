// ─── Kevin's own exercises ────────────────────────────────────────────
// The generated engines can spell every scale in every key, but they cannot know
// which FINGERING you want. So the practices in the Workouts pedal are not
// generated — they are the pieces written by hand on the TAB page, transposed.
//
// THE SEED. Ten of the thirteen written pieces fall out of ONE of them. The
// hand-fingered two-octave C major in 8th position is the seed, and:
//     broken 3rds …7ths  =  pairs of its notes 2…6 scale-steps apart
//     3…7-note runs      =  cells of 3…7 of its notes, one cell per degree
// Both derivations were checked against the hand-written pieces and came back
// byte-identical, all eight of them. That is not a coincidence — it means the
// seed IS the exercise, and everything else is a way of walking it. So the app
// derives them instead of storing them: change the seed fingering and all ten
// follow, and the 6- and 7-note runs that were never finished simply exist.
//
// The triad marches are NOT derivable and are not derived. Each walks every
// diatonic triad of the key through every inversion up one string set, one voice
// moving at a time. That is real authorship and it is kept verbatim.
import { NOTES, toSharp, SCALE_TYPES, SCALE_DEGREE_LABELS } from './music-theory.js';
import { customTuning, getNoteAtFret, getInst } from './tuning.js';

const LIB_KEY  = 'rn-sketch-lib';
const SEED_KEY = 'rn-seed-scale';       // which piece is the seed, if not the default match

export const readPieces = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } };

const nfrets = () => (getInst?.()?.frets ?? 22);
// Leave two frets of headroom: a transposed exercise that ends ON the last fret is
// technically in range and practically unplayable.
export const neckCeiling = () => Math.max(12, nfrets() - 2);

// Absolute pitch of a fretted note, for ordering. si 0 = HIGHEST string.
export function pitchOf(si, fret) {
  const s = customTuning[si];
  if (!s) return 0;
  const n = getNoteAtFret(s.note, s.octave, fret);
  return n.octave * 12 + NOTES.indexOf(n.note);
}
export const noteNameAt = (si, fret) => {
  const s = customTuning[si];
  return s ? getNoteAtFret(s.note, s.octave, fret).note : '';
};

// ── the seed ──────────────────────────────────────────────────────────
// Named by convention, overridable by id — you should be able to re-finger the
// scale you practise out of without editing code.
export function findSeed(pieces = readPieces()) {
  let id = null;
  try { id = localStorage.getItem(SEED_KEY); } catch (e) {}
  return (id && pieces.find(p => p.id === id))
      || pieces.find(p => /base\s*scale/i.test(p.name || ''))
      || null;
}
export function setSeed(id) { try { localStorage.setItem(SEED_KEY, id); } catch (e) {} }

// A single-note piece → a flat list of {si,fret}. Chords in a "scale" are a
// mistake rather than a feature, so only the first note of a step is taken.
export const seedNotes = piece =>
  (piece?.steps || []).map(st => (st.notes || [])[0]).filter(Boolean).map(n => ({ si: n.si, fret: n.fret }));

// ── the two derivations ───────────────────────────────────────────────
// n consecutive scale tones, restarting one degree higher each time: 3 → 1-2-3,
// 2-3-4, 3-4-5 … The last cell is a FULL cell — a truncated group at the top
// sounds like a fumble, not an ending, so the run stops at the last complete one.
export function deriveRun(notes, n) {
  const out = [];
  for (let i = 0; i + n <= notes.length; i++) for (let k = 0; k < n; k++) out.push(notes[i + k]);
  return out;
}
// Pairs `skip` SCALE-steps apart. A 3rd is two scale steps, not two semitones —
// which is why these stay diatonic and never need an accidental.
export const BROKEN_SKIP = { 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
export function deriveBroken(notes, skip) {
  const out = [];
  for (let i = 0; i + skip < notes.length; i++) { out.push(notes[i]); out.push(notes[i + skip]); }
  return out;
}
// How many notes each derivation yields, for a label that can be shown before you commit.
export const runLength    = (len, n)    => Math.max(0, len - n + 1) * n;
export const brokenLength = (len, skip) => Math.max(0, len - skip) * 2;

// ── transposition ─────────────────────────────────────────────────────
// On guitar, transposing is fret arithmetic: add N to every fret and the shape,
// the fingering and the feel all survive intact. Two things can go wrong, and
// they need different answers.
//
// A NARROW piece (a box shape, three or four frets wide) can always be placed:
// if +N runs off the top, +N−12 puts the identical shape an octave lower. One
// decision for the whole piece, and the exercise is untouched.
//
// A LADDER (the triad marches — one shape climbing thirteen frets) is wider than
// an octave, so no single offset fits. But a ladder is CYCLIC: it is the same
// seven triads repeating up the neck. So the rungs that fall off the top wrap an
// octave down and become the bottom rungs — a ROTATION, not a re-sort. You get
// the same complete ladder, entered at a different rung. Re-sorting would also
// "work" and would silently destroy any piece that isn't monotonic, so the code
// rotates only what it has PROVEN is a monotonic ladder.
const stepLo = st => Math.min(...(st.notes || []).map(n => pitchOf(n.si, n.fret)));
const shiftStep = (st, k) => ({ ...st, notes: (st.notes || []).map(n => ({ ...n, fret: n.fret + k })) });
const fretsOf = steps => steps.flatMap(st => (st.notes || []).map(n => n.fret));

// Is every step at least as high as the one before it? Then it is a ladder.
export function isMonotonic(steps) {
  const withNotes = steps.filter(st => (st.notes || []).length);
  for (let i = 1; i < withNotes.length; i++) if (stepLo(withNotes[i]) < stepLo(withNotes[i - 1])) return false;
  return withNotes.length > 1;
}

// semis = how far to move. Returns { steps, mode, offset, wrapped } — `mode` tells
// the caller WHICH of the two things happened, so the UI can say so out loud
// ("moved down an octave to stay on the neck") instead of quietly relocating your
// exercise somewhere your hands don't expect it.
export function transposeSteps(steps, semis, opts = {}) {
  const ceiling = opts.ceiling ?? neckCeiling();
  const fits = k => { const f = fretsOf(steps.map(st => shiftStep(st, k))); return !f.length || (Math.min(...f) >= 0 && Math.max(...f) <= ceiling); };

  // 1. the whole piece, moved as one — trying the NEAREST offset first, not the
  // first one that happens to fit. Both +11 and −1 put you in B, but +11 drags a
  // shape written at the 7th fret up to the 18th where the frets are half the
  // width and your hand has nowhere to go. A guitarist transposing C→B moves down
  // one fret; the app should do what the hand does.
  const norm = ((semis % 12) + 12) % 12;
  for (const k of [norm, norm - 12, norm + 12].sort((a, b) => Math.abs(a) - Math.abs(b))) {
    if (fits(k)) return { steps: steps.map(st => shiftStep(st, k)), mode: k === norm ? 'shift' : 'octave', offset: k, wrapped: 0 };
  }

  // 2. wider than the neck. Only a proven ladder may be rotated.
  const shifted = steps.map(st => shiftStep(st, norm));
  if (!isMonotonic(steps)) {
    // Not a ladder — clamping or reordering would change the exercise, so hand it
    // back honestly out of range and let the caller refuse or warn.
    const f = fretsOf(shifted);
    return { steps: shifted, mode: 'overflow', offset: norm, wrapped: 0,
             overflow: { min: Math.min(...f), max: Math.max(...f), ceiling } };
  }
  const over = [], under = [], keep = [];
  shifted.forEach(st => {
    const f = (st.notes || []).map(n => n.fret);
    if (!f.length) { keep.push(st); return; }
    if (Math.max(...f) > ceiling)  over.push(shiftStep(st, -12));
    else if (Math.min(...f) < 0)   under.push(shiftStep(st, 12));
    else keep.push(st);
  });
  // Rungs that wrapped DOWN are now the lowest — they belong at the front. Rungs
  // that wrapped UP are now the highest and belong at the back. The ladder still
  // ascends and no rung is lost.
  return { steps: [...over, ...keep, ...under], mode: 'rotate', offset: norm, wrapped: over.length + under.length };
}

// Convenience: move a piece from the key it was written in to another key.
export function transposeToKey(steps, fromRoot, toRoot, opts = {}) {
  const a = NOTES.indexOf(toSharp(fromRoot)), b = NOTES.indexOf(toSharp(toRoot));
  if (a < 0 || b < 0) return { steps, mode: 'shift', offset: 0, wrapped: 0 };
  return transposeSteps(steps, b - a, opts);
}

// ── steps → a playable plan ───────────────────────────────────────────
// The Workouts strip and playPlan both want the drill-plan shape, and a written
// piece is one field away from it.
export function stepsToPlan(steps, { bpm = 100, label = '', root = 'C' } = {}) {
  const beat = 60 / Math.max(1, bpm);
  const positions = [], planSteps = [];
  steps.forEach(st => {
    const ns = st.notes || [];
    const focus = ns.map(n => ({ si: n.si, fret: n.fret }));
    const play  = ns.map(n => { const s = customTuning[n.si]; const g = getNoteAtFret(s.note, s.octave, n.fret); return { note: g.note, octave: g.octave }; });
    ns.forEach((n, i) => positions.push({ si: n.si, fret: n.fret, note: play[i].note, octave: play[i].octave }));
    planSteps.push({ focus, play, dur: (st.dur || 1) * beat, label: st.label });
  });
  const notes = [];
  positions.forEach(p => { if (!notes.includes(p.note)) notes.push(p.note); });
  return { root: toSharp(root), notes, label, positions, steps: planSteps };
}

// Wrap a flat note list back into one-note-per-step, with a breath at the end of
// each cell so the ear hears repeating groups instead of one long stream.
export function notesToSteps(notes, { cell = 0, gapBeats = 0.5 } = {}) {
  return notes.map((n, i) => {
    const st = { notes: [{ si: n.si, fret: n.fret }], dur: 1 };
    if (cell > 1 && (i + 1) % cell === 0 && i < notes.length - 1) st.gapBeats = gapBeats;
    return st;
  });
}

// ── the seed as a DEGREE MAP ──────────────────────────────────────────
// The seed is not sixteen notes. It is a map from SCALE DEGREE to a place under
// the hand: "the 3rd lives on the A string, the 6th lives on the D string one
// higher up," and so on for two octaves, in the string layout Kevin chose
// (2-3-3-3-2-3). Once you see it that way, every other scale is the same map
// with a few degrees moved a fret:
//
//     nat. minor  ♭3 ♭6 ♭7      three degrees reach back one fret
//     dorian      ♭3 ♭7
//     lydian      ♯4            one degree reaches up one fret
//     major pent  degrees 4 and 7 simply have no note
//     blues       minor pent plus a ♭5 that belongs to no degree at all
//
// That is the whole trick, and it matters because a GENERATED box would throw
// away the only thing here that was actually authored — his position, his string
// layout, his fingering. Generating the notes is easy; keeping the hand is not.
//
// Nothing below invents a transposer. A shape is built in the seed's own key and
// then handed to transposeToKey, which already knows about nearest offsets and
// octave wrapping.

const MAJOR_IV   = SCALE_TYPES.Diatonic.Major;      // [0,2,4,5,7,9,11] — the ruler everything is measured against
const pcOf       = name => NOTES.indexOf(toSharp(name));
const stringName = si => customTuning[si]?.label || customTuning[si]?.note || `#${si + 1}`;

// Name a note by the DEGREE IT IS SITTING ON, not by its distance from the root.
// The ♭6 of a minor scale and the ♯5 of an altered dominant are the same fret and
// a different note, and a plain semitone count cannot tell them apart — it would
// call natural minor "♭3 ♯5 ♭7", which is nobody's idea of natural minor. Extras
// have no degree to sit on, so they fall back to the interval name.
const degLabel = (deg, delta) => deg === null ? SCALE_DEGREE_LABELS[((delta % 12) + 12) % 12]
                                              : (delta < 0 ? '♭' : delta > 0 ? '♯' : '') + (deg + 1);

export const SEED_ROOT = 'C';   // the key the written seed is in

// Find a scale by name. The category is a hint — a caller that has the name but
// has forgotten which drawer it lives in should still get an answer.
export function findScale(scaleCat, scaleName) {
  if (SCALE_TYPES[scaleCat]?.[scaleName]) return { cat: scaleCat, name: scaleName, iv: SCALE_TYPES[scaleCat][scaleName] };
  for (const c in SCALE_TYPES) if (SCALE_TYPES[c][scaleName]) return { cat: c, name: scaleName, iv: SCALE_TYPES[c][scaleName] };
  return null;
}

// Does this scale map onto ITSELF when you transpose it? Whole tone does (move it
// up a whole step and you get the same six notes); both diminished scales do (a
// minor 3rd). A scale like that has no unique tonic — every note is as much the
// root as every other — so it has no 1st, no 3rd, no 6th, and therefore nothing
// the degree map can hold on to. This is not a technicality about note counts; it
// is the reason the seed cannot say anything useful about them.
export function isSymmetricScale(iv) {
  const set = new Set(iv);
  for (let t = 1; t < 12; t++) if (iv.every(x => set.has((x + t) % 12))) return true;
  return false;
}

// ── matching a scale to the seven degrees ─────────────────────────────
// Rather than a hand-written table of "minor = ♭3♭6♭7", each scale is MATCHED to
// the major ruler: walk both in ascending order and pair each scale tone with a
// degree it is within one fret of. Ascending order is a real constraint, not a
// convenience — the 6th cannot be fingered where the 3rd lives.
//
// Three outcomes fall out on their own, which is the point of doing it this way:
//   • 7-note scales pair one-to-one and you get the flats and sharps for free;
//   • pentatonics leave degrees unpaired — those notes are simply absent;
//   • a blues ♭5 can pair with nothing, so it becomes an EXTRA: a real note that
//     has to be placed by hand, next to a degree that is already under a finger.
// Leaving a tone unpaired costs more than bending one a fret, so extras are a
// last resort — which is exactly how blues works (♭5 is the odd one out, the
// other five notes are the minor pentatonic).
//
// One tie-break, and it earns its keep. Bending a degree DOWN and bending the one
// below it UP cost the same fret either way, so a plain cost can pick either: the
// E♭ in C minor pentatonic came out as a "♯2" sitting in the 2nd's seat instead of
// a ♭3 in the 3rd's. Same pitches, but the shape stopped being natural-minor-with-
// two-notes-removed, which is the thing worth seeing. Alterations are named with
// flats almost without exception (♭2 ♭3 ♭5 ♭6 ♭7 are scales; ♯2 is a typo), so a
// raise pays a hair more and the flat reading wins every tie.
const EXTRA_COST = 1.5;
const RAISE_BIAS = 0.1;
const MAX_EXTRAS = 1;

function assignDegrees(iv) {
  const n = iv.length, memo = new Map();
  const solve = (i, d) => {
    if (i === n) return { cost: 0, plan: [] };
    const key = i * 8 + d;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    for (let dd = d; dd < 7; dd++) {
      const delta = iv[i] - MAJOR_IV[dd];
      if (delta >  1) continue;   // this degree still sits below the tone — keep looking up
      if (delta < -1) break;      // and every degree after this one is higher still
      const rest = solve(i + 1, dd + 1);
      const cost = Math.abs(delta) + (delta > 0 ? RAISE_BIAS : 0) + rest.cost;
      if (!best || cost < best.cost) best = { cost, plan: [{ iv: iv[i], deg: dd, delta }, ...rest.plan] };
    }
    const rest = solve(i + 1, d);  // an extra consumes no degree, so `d` does not advance
    if (!best || EXTRA_COST + rest.cost < best.cost)
      best = { cost: EXTRA_COST + rest.cost, plan: [{ iv: iv[i], deg: null, delta: 0 }, ...rest.plan] };
    memo.set(key, best);
    return best;
  };
  return solve(0, 0);
}

// Can the seed say anything about this scale? Returns { ok, reason, plan } — the
// REASON is the useful half: seedScale() returns null when it cannot help, and a
// null with no explanation is how a UI ends up silently doing the wrong thing.
// The caller shows the reason and falls back to the generated engine.
export function seedDerivable(scaleCat, scaleName) {
  const s = findScale(scaleCat, scaleName);
  if (!s) return { ok: false, reason: `no scale called "${scaleName}"` };
  const iv = s.iv;
  if (!iv.length || iv[0] !== 0) return { ok: false, reason: 'scale is not written from its root' };
  if (isSymmetricScale(iv))      return { ok: false, reason: `${s.name} transposes onto itself, so it has no functional degrees for the seed to move — use the generated shape` };
  if (iv.length > 7)             return { ok: false, reason: `${iv.length} notes will not fit a seven-degree hand shape` };
  const { plan } = assignDegrees(iv);
  const extras = plan.filter(p => p.deg === null);
  if (extras.length > MAX_EXTRAS)
    return { ok: false, reason: `${extras.length} of its notes have no degree in the parent major scale — too much guesswork` };
  return { ok: true, reason: '', cat: s.cat, name: s.name, iv, plan, extras,
           shifted: plan.filter(p => p.deg !== null && p.delta) };
}

// Every SCALE_TYPES entry, split into the ones the seed can finger and the ones
// it cannot, so a picker can grey the second list out instead of discovering the
// nulls one click at a time.
export function seedDerivableScales() {
  const yes = [], no = [];
  for (const cat in SCALE_TYPES) for (const name in SCALE_TYPES[cat]) {
    const d = seedDerivable(cat, name);
    (d.ok ? yes : no).push({ cat, name, reason: d.reason });
  }
  return { derivable: yes, notDerivable: no };
}

// ── the map itself ────────────────────────────────────────────────────
// Each seed note tagged with its degree (0-based, 0 = the root) in the parent
// major scale, plus which octave of the shape it belongs to. Degrees are read
// from PITCH, not from position in the list, so a re-fingered seed that skips a
// note or crosses strings differently still reads correctly.
export function seedDegreeMap(notes = null) {
  const src = notes && notes.length ? notes : seedNotes(findSeed());
  if (!src || !src.length) return null;
  const rootPc  = pcOf(SEED_ROOT);
  const pitches = src.map(n => pitchOf(n.si, n.fret));
  // Count octaves from the lowest ROOT at or below the shape, so "register 0" is
  // the first octave of the scale rather than an accident of where C happens to be.
  let base = Math.min(...pitches);
  while (((base % 12) + 12) % 12 !== rootPc) base--;
  return src.map((n, i) => {
    const k   = pitches[i] - base;
    const deg = MAJOR_IV.indexOf(((k % 12) + 12) % 12);
    return { si: n.si, fret: n.fret, deg: deg < 0 ? null : deg, reg: Math.floor(k / 12), pitch: pitches[i] };
  });
}

// The same pitch, somewhere else in the position. Neighbouring strings first,
// because that is where a hand would look.
function relocate(n, lo, hi, taken) {
  for (const d of [1, -1, 2, -2]) {
    const si = n.si + d;
    if (!customTuning[si]) continue;
    const f = n.fret + (pitchOf(n.si, 0) - pitchOf(si, 0));
    if (f < 0 || f < lo || f > hi) continue;
    if (taken.has(`${si}:${f}`)) continue;
    return { ...n, si, fret: f };
  }
  return null;
}

// ── seedScale: any scale, any key, out of his one shape ───────────────
// Returns { notes:[{si,fret,deg,iv,extra}], label, degrees, warnings, ... } or
// null when the seed genuinely cannot answer (no seed saved, symmetric scale,
// shape falls off the neck). Ask seedDerivable() for the reason.
//
// `degrees` runs parallel to `notes` and holds SEMITONES ABOVE THE ROOT (0..11),
// not 0-6 degree indices — because a blues ♭5 has no degree index and labelling
// it as one would be a lie. Each note also carries `deg` (its parent-major slot,
// null for an extra) for callers that want the functional reading.
export function seedScale(rootName, scaleCat, scaleName, opts = {}) {
  const d = seedDerivable(scaleCat, scaleName);
  if (!d.ok) return null;
  const map = seedDegreeMap(opts.seed || null);
  if (!map) return null;
  // A seed with a note outside its own parent scale is not a scale, and every
  // degree lookup after this point would be a guess.
  if (map.some(m => m.deg === null)) return null;

  const warnings = [];
  const byDeg = new Map();
  d.plan.forEach(p => { if (p.deg !== null) byDeg.set(p.deg, p.delta); });

  const seedLo = Math.min(...map.map(m => m.fret)), seedHi = Math.max(...map.map(m => m.fret));
  // One fret either side of the written box. A ♭3 reaches back with the index
  // finger and a ♯4 reaches up with the pinky; both are ordinary guitar, and both
  // are how you keep the string layout. See the note on off-position tones below.
  const winLo = Math.max(0, seedLo - 1), winHi = seedHi + 1;

  // 1 ── every degree this scale HAS, at its seat, moved by its own delta.
  const shape = [];
  for (const m of map) {
    if (!byDeg.has(m.deg)) continue;                       // pentatonic: this degree has no note
    const delta = byDeg.get(m.deg);
    shape.push({ si: m.si, fret: m.fret + delta, deg: m.deg, reg: m.reg, lab: degLabel(m.deg, delta),
                 iv: (((MAJOR_IV[m.deg] + delta) % 12) + 12) % 12, extra: false });
  }
  if (!shape.length) return null;

  // 2 ── the extra (the blues ♭5, and nothing else in SCALE_TYPES). It has no
  // seat of its own, so it borrows one: placed relative to whichever neighbouring
  // degree is already fingered, in every octave that has BOTH neighbours. Both
  // neighbours, because a passing note you can approach but never leave is a note
  // stranded at the top of the run — the same fumble a truncated cell would be.
  for (const ex of d.extras) {
    const seated = [...byDeg.keys()].map(k => ({ deg: k, iv: MAJOR_IV[k] + byDeg.get(k) })).sort((a, b) => a.iv - b.iv);
    const below = [...seated].reverse().find(s => s.iv < ex.iv);
    const above = seated.find(s => s.iv > ex.iv);
    if (!below || !above) return null;                     // nothing to hang it on
    let placed = 0;
    for (const reg of [...new Set(shape.map(n => n.reg))].sort((a, b) => a - b)) {
      const lo = shape.find(n => n.reg === reg && n.deg === below.deg);
      const hi = shape.find(n => n.reg === reg && n.deg === above.deg);
      if (!lo || !hi) continue;
      const taken = new Set(shape.map(n => `${n.si}:${n.fret}`));
      // Reached up from the note below, or back from the note above — whichever
      // stays inside the written box. Ties go to the lower one: in blues you walk
      // UP into the ♭5 far more often than you fall back onto it.
      const rank = c => (c.fret >= seedLo && c.fret <= seedHi ? 0 : c.fret >= winLo && c.fret <= winHi ? 1 : 2);
      const cands = [{ si: lo.si, fret: lo.fret + (ex.iv - below.iv) }, { si: hi.si, fret: hi.fret - (above.iv - ex.iv) }]
        .filter(c => c.fret >= 0 && !taken.has(`${c.si}:${c.fret}`))
        .sort((a, b) => rank(a) - rank(b));
      if (!cands.length || rank(cands[0]) === 2) continue;
      shape.push({ ...cands[0], deg: null, reg, iv: ex.iv, lab: degLabel(null, ex.iv), extra: true });
      placed++;
    }
    if (!placed) return null;                              // a scale missing one of its notes is not that scale
    const regs = new Set(shape.map(n => n.reg)).size;
    if (placed < regs) warnings.push(`${degLabel(null, ex.iv)} sits in ${placed} of the ${regs} octaves of the shape — the others stop before its neighbours.`);
  }

  // 3 ── collisions. Two degrees a semitone apart in the major scale (3–4, 7–1)
  // can be shifted onto the SAME fret of the SAME string, at which point they are
  // not two notes, they are one note the shape would play twice — a stumble, not
  // a scale. Move the newcomer to the same pitch on a neighbouring string if the
  // position has room; if it does not, it is played once and we SAY SO. Nothing
  // is lost either way: the pitch is still in the shape, sounded by the note it
  // collided with. (No SCALE_TYPES entry actually triggers this — it is a guard
  // for scales added later, not a routine path.)
  const seen = new Map(), kept = [];
  for (const n of shape) {
    const k = `${n.si}:${n.fret}`, prev = seen.get(k);
    if (!prev) { seen.set(k, n); kept.push(n); continue; }
    const moved = relocate(n, winLo, winHi, seen);
    if (moved) {
      seen.set(`${moved.si}:${moved.fret}`, moved); kept.push(moved);
      warnings.push(`${n.lab} landed on the ${prev.lab} at ${stringName(n.si)} fret ${n.fret}; moved to ${stringName(moved.si)} fret ${moved.fret}.`);
    } else {
      warnings.push(`${n.lab} and ${prev.lab} are the same note at ${stringName(n.si)} fret ${n.fret} — it is played once, not twice.`);
    }
  }

  // 4 ── ascending order is the exercise. Sort by pitch, not by string.
  kept.sort((a, b) => pitchOf(a.si, a.fret) - pitchOf(b.si, b.fret));
  if (kept.some(n => n.fret < 0)) return null;             // seed written too low to bend this way

  // 5 ── into the key. transposeToKey owns the neck arithmetic; a box this narrow
  // always fits, so `rotate` and `overflow` mean something is wrong upstream.
  const steps = kept.map(n => ({ notes: [{ si: n.si, fret: n.fret, deg: n.deg, iv: n.iv, lab: n.lab, extra: n.extra }], dur: 1 }));
  const tr = transposeToKey(steps, SEED_ROOT, rootName, { ceiling: opts.ceiling });
  if (tr.mode === 'overflow' || tr.mode === 'rotate') return null;
  const notes = tr.steps.map(st => st.notes[0]);

  const frets = notes.map(n => n.fret);
  const lo = Math.min(...frets), hi = Math.max(...frets);
  if (hi - lo > seedHi - seedLo) {
    const back = d.shifted.filter(p => p.delta < 0).map(p => degLabel(p.deg, p.delta));
    const up   = d.shifted.filter(p => p.delta > 0).map(p => degLabel(p.deg, p.delta));
    const how  = [back.length ? `${back.join(', ')} reach${back.length > 1 ? '' : 'es'} back a fret` : '',
                  up.length   ? `${up.join(', ')} reach${up.length > 1 ? '' : 'es'} up a fret`      : '',
                  d.extras.length ? `${d.extras.map(p => degLabel(null, p.iv)).join(', ')} is a passing note between two seats` : '']
                 .filter(Boolean).join(', and ');
    warnings.push(`Position spans ${hi - lo + 1} frets (${lo}–${hi}) instead of ${seedHi - seedLo + 1}: ${how}. The string layout is unchanged.`);
  }
  if (tr.mode === 'octave') warnings.push(`Moved an octave to stay on the neck — same shape, frets ${lo}–${hi}.`);

  // Read back off the FRETBOARD, not off the intervals we intended — this is the
  // number that tells you the shape is really the scale.
  const pitchClasses = [...new Set(notes.map(n => ((pitchOf(n.si, n.fret) % 12) + 12) % 12))].sort((a, b) => a - b);
  return {
    notes, degrees: notes.map(n => n.iv), labels: notes.map(n => n.lab),
    warnings, pitchClasses, span: { lo, hi }, mode: tr.mode, offset: tr.offset,
    root: toSharp(rootName), scale: d.name, source: 'seed',
    label: `${rootName} ${d.name} · seed shape, frets ${lo}–${hi}`
  };
}
