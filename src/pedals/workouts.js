// ─── Workouts — pick a workout, set it up, then run it ────────────────────────
// Five workouts, each a FAMILY rather than a fixed drill. Tap a card and it opens into
// its own options panel: key, scale, position, interval, direction — then ▶ START.
// That card→options→start step is the whole point of the redesign. A preset that always
// ran in C major is a demo, not a practice tool: the one thing you must be able to do
// with any of this material is move it to another key, and a drill that can't move is
// the drill that teaches you not to. Options are remembered per workout on p.settings,
// because a practice tool that forgets your key every time is one you stop opening.
//
//   🎸 CHORD TRAINER  flash — random grips you must FIND cold: open chords, or 3-string
//                             triads on any string set, drawn from any key or all 12 roots
//   🔺 TRIAD MARCH    run   — the same triads in ORDER: inversion ladders, one chord across
//                             the neck, or a voice-led progression (see TRIAD_MARCH_TYPES)
//   🎼 SCALES         run   — one scale in one position: Kevin's own written fingering, or
//                             a generated CAGED box / n-notes-per-string
//   🪜 NOTE RUNS      run   — that same fingering in overlapping cells: 1-2-3, 2-3-4… up to 7
//   🎶 BROKEN SCALES  run   — that same fingering in pairs a 3rd through a 7th apart
//
// The last three do not generate a shape by default. Kevin hand-fingered one two-octave
// scale, and his runs and broken pairs are that one fingering walked in a different order —
// core/authored.js proved the derivations byte-identical to the pieces he wrote. So the
// SEED is the source and the engine is the fallback, exactly as the written march already
// outranks the generated ladder. Which one is playing is said out loud, because a run in
// his fingering and a run in a generated box are different exercises that look identical.
//
// Engines all live elsewhere (drill-runner for plans, voicings for grips/boxes); this file
// is transport + UI only. metroClock drives the beat, core/listen drives 🎤 advance, and
// every note sounds through playNote → the mixer's 'notes' bus.
import { NOTES, KEY_PATTERNS, SCALE_TYPES, CHORD_TYPES, getChordNotes, getKeyChords } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { setChordHighlight, setGhostHighlight, clearChordHighlight, clearGhostHighlight, setNowBanner, pedalBus, metroClock } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { audio } from '../core/audio.js';
import { createListener, expectNotes } from '../core/listen.js';
import { playNote } from '../core/synth.js';
import { playPlan, buildScaleBox, buildBrokenInterval, buildScaleSequence, buildTriadMarch, TRIAD_MARCH_TYPES, TRIAD_MARCH_PROGRESSIONS } from '../curriculum/drill-runner.js';
import { readPieces, transposeToKey, stepsToPlan, notesToSteps, findSeed, seedNotes, seedScale, deriveRun, deriveBroken, BROKEN_SKIP, SEED_ROOT } from '../core/authored.js';
import { pickGrip, assignFingers, findTriadsOnSet, buildNpsBoxes, findScaleBoxes } from '../core/voicings.js';
import { stepStripHTML, wireStepStrip, followStrip, paintStripAt, planToStripSteps } from '../ui/step-strip.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';

const QSUF = { Major: '', Minor: 'm', Dim: '°', Aug: '+' };
const INV_NAME = ['root pos', '1st inv', '2nd inv'];
const CHORD_POOL = ['C','Am','G','Em','D','Dm','A','E','F','Fm','Bm','B','A7','D7','E7','G7','Am7','Dm7','Cmaj7'];
const QUAL_MAP = { '': 'Major', 'm': 'Minor', 'm7': 'Min7', '7': '7 (Dom)', 'maj7': 'Maj7' };
const QUAL_CHIPS = [['Major', 'maj'], ['Minor', 'min'], ['Dim', 'dim °'], ['Aug', 'aug +']];
// The march's types and progressions come FROM the engine, never from a copy here — a
// duplicated list is a list that drifts, and the progressions are degree arrays precisely
// so that changing the key root transposes them for free.
// The hand-written march goes FIRST, and therefore becomes the default — it is the
// exercise actually being practised, and the generated types are the alternatives.
// It is a different animal from the engine's Ladder: the Ladder walks one chord's
// three inversions, this walks every diatonic triad OF THE KEY up one string set,
// one voice moving at a time. Both are worth having; neither replaces the other.
const MY_MARCH = { id: 'mine', icon: '🎸', name: 'My March', sub: 'every diatonic triad of the key, up one string set' };
const MARCH_TYPES = [MY_MARCH, ...((Array.isArray(TRIAD_MARCH_TYPES) && TRIAD_MARCH_TYPES.length)
  ? TRIAD_MARCH_TYPES : [{ id: 'set', icon: '🪜', name: 'Ladder', sub: 'inversions up one string set' }])];

// One written piece per string set, in the pedal's own set order (0 = G·B·e).
// Matched by name so re-writing a march on the TAB page updates the workout with no
// code change — that is the whole point of the exercises being authored, not generated.
const MY_MARCH_PIECES = ['Triad March GBe', 'Triad March DGB', 'Triad March ADG', 'Triad March EAD'];
const MARCH_PROGS = (Array.isArray(TRIAD_MARCH_PROGRESSIONS) && TRIAD_MARCH_PROGRESSIONS.length)
  ? TRIAD_MARCH_PROGRESSIONS : [{ name: 'I–V–vi–IV (pop)', degs: [0, 4, 5, 3] }];
// English ordinals for 2nd–7th — the only range an interval NUMBER can take here.
const ORD = n => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function chordIntervalsFor(quality) {
  for (const group of Object.values(CHORD_TYPES)) if (group[quality]) return group[quality];
  return [0, 4, 7];
}
function parseChordName(nm) {
  const rn = nm.length > 1 && (nm[1] === '#' || nm[1] === 'b') ? nm.slice(0, 2) : nm[0];
  return { root: rn, quality: QUAL_MAP[nm.slice(rn.length)] || 'Major' };
}
// string sets like the Voicing Lab: i → [i+2, i+1, i] low→high. Derived from the tuning,
// so an 8-string gets its extra sets and nothing here hardcodes "three sets".
function stringSets() {
  const out = [];
  for (let i = 0; i + 2 < customTuning.length; i++) {
    const idxs = [i + 2, i + 1, i];
    out.push({ idxs, label: idxs.map(si => customTuning[si].label || customTuning[si].note).join('·') });
  }
  return out;
}
const setLabel = i => stringSets()[i]?.label || '';
const setChips = () => stringSets().map((st, i) => [String(i), st.label]);
// Chord Trainer's POSITION option: open grips, one 3-string set, or roll a new set each item.
// The set names follow the tuning rather than the words "upper/mid/low", so they stay true.
function positionChips() {
  const nick = ['Upper', 'Mid', 'Low', 'Bass'];
  return [['open', '🤠 Open']]
    .concat(stringSets().map((st, i) => [String(i), `${nick[i] || 'Set ' + (i + 1)} ${st.label}`]))
    .concat([['all', '⁙ All sets']]);
}

// ── where the notes come from ────────────────────────────────────────────────
// Kevin wrote ONE two-octave scale by hand, and the runs and broken pairs he practises are
// that same fingering walked in a different order. So the three scale workouts ask
// seedScale for HIS shape moved into the key you picked, the way the march asks for his
// written march. The engine answers only when the seed genuinely cannot: a symmetric scale
// (whole tone, diminished) has no scale degrees to map a fingering onto, a fresh install
// has no seed written yet, and 3-or-4-per-string is a deliberate request for a different
// fingering rather than a failure.
const sessionRoot = () => pedalBus.masterKey?.root || pedalBus.root || 'C';
const rootFor = bag => (bag.key && bag.key !== 'any' && bag.key !== 'session') ? bag.key : sessionRoot();
// Same pitch class, tolerant of spelling. -1 vs -1 must NOT read as a match, or two names
// that are both unknown to NOTES would claim to be the same key.
const samePc = (a, b) => { const i = NOTES.indexOf(a); return i >= 0 && i === NOTES.indexOf(b); };
const SHAPE_WORD = { mine: 'my fingering', caged: 'CAGED', '3nps': '3 / string', '4nps': '4 / string' };
const seedWorkout = (id, bag) => id === 'runs' || id === 'broken' || (id === 'scales' && bag.shape === 'mine');

// Resolving a source re-reads the library and re-derives the scale, and the card grid asks
// once per card. Memoise it for the length of ONE repaint only — the seed can be re-fingered
// on the TAB page between two of them, and a stale answer would name the wrong exercise.
const _seedCache = new Map();
const clearSeedCache = () => _seedCache.clear();
function seedScaleFor(bag) {
  const root = rootFor(bag);
  const k = `${root}|${bag.scaleCat}|${bag.scaleName}`;
  if (!_seedCache.has(k)) {
    let sc = null;
    try { sc = seedScale(root, bag.scaleCat, bag.scaleName); } catch (e) { sc = null; }   // a malformed piece falls back, it doesn't crash the pedal
    _seedCache.set(k, sc);
  }
  return _seedCache.get(k);
}
const haveSeed = () => seedNotes(findSeed()).length > 0;

// { kind, scale, line, warn }. `line` is the one-glance sentence, shown in the options panel
// before you start and again in the status block while you play — the two moments you decide
// what you're doing. `warn` is seedScale's own report of what the key cost the shape (a ♭3
// reaching back a fret, an octave move); it belongs where there is room to read it, so only
// the options panel prints it, never the running readout.
function sourceFor(id, bag) {
  if (!seedWorkout(id, bag)) return { kind: 'engine', scale: null, warn: '', line: `⚙ generated ${SHAPE_WORD[bag.shape] || 'shape'} — the engine's fingering, not yours` };
  const sc = seedScaleFor(bag);
  if (sc && (sc.notes || []).length >= 2) {
    const where = samePc(rootFor(bag), SEED_ROOT) ? 'as you wrote it' : `moved to ${rootFor(bag)}`;
    return { kind: 'seed', scale: sc, warn: (sc.warnings || [])[0] || '', line: `🎸 your seed scale, ${where}` };
  }
  return { kind: 'engine', scale: null, warn: '', line: haveSeed()
    ? `⚙ generated — ${bag.scaleName} can't be fingered out of your seed scale`
    : '⚙ generated — no seed scale written yet (write one on the TAB page and name it “base scale”)' };
}
const srcMark = (id, bag) => (sourceFor(id, bag).kind === 'seed' ? '🎸 ' : '');

// ── the workout registry ─────────────────────────────────────────────────────
// One declarative spec per workout drives the options panel, the card sub-line and the
// saved-custom record, so there is exactly one place where a workout's vocabulary lives.
//   kind 'key'   → ⟳ Session / ∗ Any 12 / one of the 12 roots   (writes bag.key)
//   kind 'scale' → the whole of SCALE_TYPES, grouped            (writes scaleCat + scaleName)
//   kind 'one'   → single-select chips     kind 'multi' → toggle chips (never empty)
//   `when(bag)`  → hide an option that cannot apply to the current choice
const SCALE_OPT = { k: 'scale', lbl: 'SCALE', kind: 'scale', def: { cat: 'Diatonic', name: 'Major' } };
const DIR_OPT   = { k: 'dir', lbl: 'DIRECTION', kind: 'one', vals: [['updown', '↕ Up & down'], ['up', '↑ Up only']], def: 'updown' };

// Broken pairs are cut by SCALE POSITION, not by semitones — "3rds" means skip one scale tone,
// which is exactly why the same chip gives you m3s and M3s in a major scale. That naming only
// stays honest while the skip is SMALLER than one octave of the scale. A pentatonic has five
// tones per octave, so skipping five lands on the same degree an octave up: "broken 6ths" would
// come out as the scale played twice in octaves with not one 6th in it. So each scale offers
// only the intervals it can actually voice — 3rds–5ths on a pentatonic, up to 6ths on the
// six-tone blues scales, all five on anything with seven.
const tonesPerOctave = bag => (SCALE_TYPES[bag.scaleCat]?.[bag.scaleName] || SCALE_TYPES.Diatonic.Major).length;
const brokenIvs = bag => [3, 4, 5, 6, 7].filter(n => BROKEN_SKIP[n] < tonesPerOctave(bag));
// The stored interval outlives the scale it was chosen under, so it is clamped once, in bagOf,
// where the lit chip, the pair count and the notes that sound all read the same number.
const brokenIv = bag => Math.max(3, Math.min(+bag.interval || 3, brokenIvs(bag).slice(-1)[0] || 3));

const WORKOUTS = [
  {
    id: 'chords', icon: '🎸', name: 'Chord Trainer', engine: 'flash',
    blurb: 'A grip is flashed and you have until the bar turns to find it. Open chords train the shapes you strum; the three-string triads train the same harmony as a movable shape you can put anywhere.',
    opts: [
      { k: 'key', lbl: 'KEY', kind: 'key', any: true, def: 'any' },
      { k: 'keyType', lbl: 'KEY TYPE', kind: 'one', vals: Object.keys(KEY_PATTERNS).map(k => [k, k]), def: 'Major', when: b => b.key !== 'any' },
      { k: 'position', lbl: 'POSITION', kind: 'one', vals: positionChips, def: 'open' },
      { k: 'quals', lbl: 'QUALITY', kind: 'multi', vals: QUAL_CHIPS, def: ['Major', 'Minor'], when: b => b.position !== 'open' },
    ],
    summary: b => `${b.position === 'open' ? 'open grips' : b.position === 'all' ? 'triads · all sets' : `triads · ${setLabel(+b.position)}`} · ${keyWord(b)}`,
  },
  {
    id: 'march', icon: '🔺', name: 'Triad March', engine: 'run',
    blurb: 'The same triads as the flash drill, but in ORDER — so instead of finding one grip you hear how the inversions stack, how far the hand really moves between two chords, and why the shape changes shape when it crosses the B string.',
    opts: [
      { k: 'key', lbl: 'KEY', kind: 'key', def: 'session' },
      { k: 'marchType', lbl: 'MARCH', kind: 'one', vals: MARCH_TYPES.map(t => [t.id, `${t.icon || ''} ${t.name}`.trim()]), def: MARCH_TYPES[0].id },
      { k: 'keyType', lbl: 'KEY TYPE', kind: 'one', vals: Object.keys(KEY_PATTERNS).map(k => [k, k]), def: 'Major', when: b => b.marchType === 'path' },
      { k: 'prog', lbl: 'PROGRESSION', kind: 'one', vals: MARCH_PROGS.map((pr, i) => [String(i), pr.name]), def: '0', when: b => b.marchType === 'path' },
      // No QUALITY chip for the written march: it is DIATONIC, so every quality in the
      // key is already in it. Offering "Major" there would be a lie about what plays.
      { k: 'quality', lbl: 'QUALITY', kind: 'one', vals: QUAL_CHIPS, def: 'Major', when: b => b.marchType !== 'path' && b.marchType !== 'mine' },
      // 'across' parks the hand in ONE zone and lets the chord climb by string set — the zone
      // is the whole variable, so it gets its own row instead of being frozen at the 5th fret.
      { k: 'anchor', lbl: 'HAND ZONE', kind: 'one', vals: [['0', 'Nut'], ['5', '5th fr'], ['9', '9th fr'], ['12', '12th fr']], def: '5', when: b => b.marchType === 'across' },
      { k: 'setIdx', lbl: 'STRING SET', kind: 'one', vals: setChips, def: '0', when: b => b.marchType !== 'across' },
      // 'path' is voice-led by nearest grip in one direction only; the others can turn around.
      { k: 'dir', lbl: 'DIRECTION', kind: 'one', def: 'up', when: b => b.marchType !== 'path',
        vals: b => (b.marchType === 'across' ? [['up', '↑ Low → high'], ['down', '↓ High → low']]
          : [['up', '↑ Ascend'], ['down', '↓ Descend'], ['updown', '↕ Up & down']]) },
    ],
    summary: b => `${MARCH_TYPES.find(t => t.id === b.marchType)?.name || 'march'} · ${keyWord(b)} · ${b.marchType === 'across' ? 'all sets' : setLabel(+b.setIdx)}`,
    note: b => MARCH_TYPES.find(t => t.id === b.marchType)?.sub,
  },
  {
    id: 'scales', icon: '🎼', name: 'Scales', engine: 'run',
    blurb: 'One position of one scale, up and back down. Your own fingering is the default — it is the shape the runs and the broken pairs are cut from, so practising it is practising all three. CAGED gives you the five shapes guitarists talk to each other in; n-per-string gives you the even, legato fingering that runs.',
    opts: [
      { k: 'key', lbl: 'KEY', kind: 'key', def: 'session' },
      SCALE_OPT,
      // Kevin's fingering goes FIRST and is therefore the default, like the march's My March.
      // The generated shapes stay, because CAGED and 4-per-string teach things one written
      // box cannot — five positions, and a stretch fingering he has not written.
      { k: 'shape', lbl: 'SHAPE', kind: 'one', vals: [['mine', '🎸 MINE'], ['caged', '⬚ CAGED'], ['3nps', '3 / STRING'], ['4nps', '4 / STRING']], def: 'mine' },
      DIR_OPT,
    ],
    note: b => ({ mine: 'Your own hand-fingered scale, moved into this key — one position, repeated', caged: 'The five CAGED shapes — the positions everything else is described from', '3nps': 'Three notes on every string — smooth legato runs', '4nps': 'Four notes per string — wide stretch runs up the neck' })[b.shape],
    summary: b => `${keyWord(b)} ${b.scaleName} · ${b.shape === 'mine' ? (srcMark('scales', b) ? '🎸 my fingering' : '⚙ CAGED · no seed') : (SHAPE_WORD[b.shape] || b.shape)}`,
  },
  {
    id: 'runs', icon: '🪜', name: 'Note Runs', engine: 'run',
    blurb: 'Sequences: play your scale in overlapping cells. 3-note = 1-2-3, 2-3-4, 3-4-5… Every note gets played as the first, the middle and the last of a cell, which is how a position stops being a ladder you climb and becomes somewhere you can start from any degree. It runs strictly in time — the cells are marked by the strip\'s bar lines, not by pauses.',
    opts: [
      { k: 'key', lbl: 'KEY', kind: 'key', def: 'session' },
      SCALE_OPT,
      { k: 'n', lbl: 'RUN LENGTH', kind: 'one', vals: [['3', '3 notes'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7']], def: '3' },
      DIR_OPT,
    ],
    summary: b => `${keyWord(b)} ${b.scaleName} · ${srcMark('runs', b)}${b.n}-note cells`,
  },
  {
    id: 'broken', icon: '🎶', name: 'Broken Scales', engine: 'run',
    blurb: 'Pairs instead of steps: broken 3rds play 1-3, 2-4, 3-5… Widening the interval widens your ear and your hand — 3rds sound like harmony, 6ths and 7ths start to sound like a melody leaping over itself.',
    opts: [
      { k: 'key', lbl: 'KEY', kind: 'key', def: 'session' },
      SCALE_OPT,
      // Only the intervals this scale can express — see brokenIvs. A chip for an interval that
      // would come out as the octave is the same lie the diatonic march avoids at QUALITY.
      { k: 'interval', lbl: 'INTERVAL', kind: 'one', vals: b => brokenIvs(b).map(n => [String(n), ORD(n) + 's']), def: '3' },
    ],
    // The clamp itself: a 7th chosen under a major scale is an OCTAVE under a pentatonic, so the
    // bag gets the widest interval this scale can still play. The raw record keeps the 7th.
    fix: b => { b.interval = String(brokenIv(b)); },
    // Widening the interval must yield FEWER pairs — every pair costs one more note off the
    // top of the scale. Pairing the seed makes that true by construction (14 pairs in 3rds,
    // 10 in 7ths, out of the same 16 notes); the count is worth showing because it is the
    // one number that tells you the drill got wider rather than merely different. And when the
    // scale is too small for the wider chips, say why they are missing — the tone count IS the
    // reason, and it is the thing worth learning off this card.
    note: b => { const sc = sourceFor('broken', b).scale, sk = BROKEN_SKIP[brokenIv(b)] || 2, tpo = tonesPerOctave(b);
                 const n = Math.max(0, ((sc?.notes || []).length) - sk);
                 return [n ? `${n} pairs out of ${sc.notes.length} scale tones` : '',
                         tpo < 7 ? `${tpo} tones per octave — a skip of ${tpo} IS the octave, so the pairs stop at ${ORD(tpo)}s` : '']
                        .filter(Boolean).join(' · ') || null; },
    summary: b => `${keyWord(b)} ${b.scaleName} · ${srcMark('broken', b)}broken ${ORD(+b.interval || 3)}s`,
  },
];
const WORKOUT_OF = id => WORKOUTS.find(w => w.id === id);
function keyWord(b) {
  if (b.key === 'any') return 'all 12 roots';
  if (b.key === 'session') return 'session key';
  return `${b.key}${b.keyType && b.keyType !== 'Major' ? ' ' + b.keyType : ''}`;
}
// The ramp is an option like any other, not a save-time extra: sitting in one workout
// while the tempo creeps up is the whole reason the pro layer exists.
const RAMP_DEFAULTS = { rampOn: false, rampFrom: 60, rampTo: 90, rampStep: 5 };
function optDefaults(w) {
  const o = { ...RAMP_DEFAULTS };
  w.opts.forEach(sp => { if (sp.kind === 'scale') { o.scaleCat = sp.def.cat; o.scaleName = sp.def.name; } else o[sp.k] = sp.def; });
  return o;
}
// `fix` is a workout's chance to pull a STORED option back into range before anyone reads it —
// an option that was legal under one scale can be impossible under another, and a bag is read
// by the chips, the card sub-line and the plan alike, which must never disagree. The raw record
// keeps the wider choice, so it comes back the moment you return to a scale that can play it.
const bagOf = (w, raw) => { const bag = { ...optDefaults(w), ...(raw || {}) }; w.fix?.(bag); return bag; };
// `vals` may be a function so a row can follow the tuning (string sets) or the rest of the
// bag (the march's DIRECTION reads differently for a ladder than for a climb across the neck).
const valsOf = (sp, bag) => (typeof sp.vals === 'function' ? sp.vals(bag) : sp.vals) || [];

// ── saved customs ────────────────────────────────────────────────────────────
function loadCustoms(seed) { try { return (JSON.parse(localStorage.getItem('rn-workouts') || '[]') || []).map(c => migrateCustom(c, seed)); } catch (e) { return []; } }
function saveCustoms(ws) { try { localStorage.setItem('rn-workouts', JSON.stringify(ws.slice(-40))); } catch (e) { /* full */ } }
// A saved workout is Kevin's work. When a preset it was built against disappears we SHOW it
// and say what happened rather than deleting it behind his back or — worse — silently running
// something else under its old name. v1 records had kind 'flash' | 'triad' | 'run', and no key
// or scale of their own: every run read the pedal-global root/scale, so `seed` carries those
// last-known globals in as the migrated defaults rather than dumping everything into C major.
function migrateCustom(c, seed = {}) {
  if (!c || typeof c !== 'object') return { id: 'wo-bad-' + Math.random().toString(36).slice(2), v: 2, retired: true, icon: '⚠', name: 'Unreadable workout', sub: 'saved data could not be read' };
  // An already-retired record keeps the explanation it was retired WITH — re-templating it
  // every mount would overwrite "String Skip was removed" with a useless "null no longer exists".
  if (c.v === 2) return WORKOUT_OF(c.workout) ? c
    : { ...c, retired: true, sub: (c.retired && c.sub) ? c.sub : `⚠ retired — “${c.workout || 'unknown'}” is no longer part of this pedal` };
  const ramp = c.ramp ? { rampOn: true, rampFrom: c.ramp.from, rampTo: c.ramp.to, rampStep: c.ramp.step } : {};
  const base = { id: c.id, v: 2, icon: c.icon, name: c.name, ramp: null };
  const cfg = c.cfg || {};
  base._up = true;                          // tells the caller to write the upgraded record back
  if (c.kind === 'flash') return { ...base, workout: 'chords', cfg: { key: 'any', position: 'open', pool: cfg.pool, ...ramp }, sub: `${(cfg.pool || []).length} open chords` };
  if (c.kind === 'triad') return { ...base, workout: 'chords', cfg: { key: 'any', position: String(cfg.set ?? 0), quals: cfg.quals || ['Major', 'Minor'], ...ramp }, sub: `triads · ${setLabel(cfg.set ?? 0)}` };
  if (c.kind === 'run') {
    const was = { key: seed.key || 'session', scaleCat: seed.scaleCat || 'Diatonic', scaleName: seed.scaleName || 'Major' };
    const where = `${was.key === 'session' ? 'session key' : was.key} ${was.scaleName}`;
    if (cfg.run === 'caged') return { ...base, workout: 'scales', cfg: { ...was, shape: 'caged', ...ramp }, sub: `${where} · CAGED` };
    if (cfg.run === '3nps') return { ...base, workout: 'scales', cfg: { ...was, shape: '3nps', ...ramp }, sub: `${where} · 3 per string` };
    if (cfg.run === 'broken3') return { ...base, workout: 'broken', cfg: { ...was, interval: '3', ...ramp }, sub: `${where} · broken 3rds` };
    if (cfg.run === 'broken4') return { ...base, workout: 'broken', cfg: { ...was, interval: '4', ...ramp }, sub: `${where} · broken 4ths` };
    // 'skip' — the String Skip preset was removed. Keep the card, dim it, explain it.
    return { ...base, retired: true, retiredFrom: 'String Skip', workout: null, cfg: { ...was, shape: 'caged', ...ramp }, sub: '⚠ retired — String Skip was removed' };
  }
  return { ...base, retired: true, workout: null, cfg: {}, sub: '⚠ retired — unknown workout type' };
}

export function buildWorkoutsContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  if (!s.bars) s.bars = 2;                 // bars each flashed item stays up
  if (!s.adv) s.adv = 'auto';              // 'auto' (beat-synced) | 'listen' (mic)
  if (!s.opt) s.opt = {};                  // per-workout option bags — persisted by saveState
  if (s.open === undefined) s.open = null; // null = the card grid; otherwise a workout/custom id
  if (s.building == null) s.building = false;
  // v1 kept ONE root and ONE scale shared by every run workout. Carry them in as the seed for
  // the per-workout bags — and for migrating saved customs, which had no key of their own — so
  // an upgrade doesn't quietly drop everything back into C major.
  const legacySeed = { key: s.runRoot || null, scaleName: s.runScale || null };
  if (legacySeed.scaleName) legacySeed.scaleCat = SCALE_TYPES.Pentatonic[legacySeed.scaleName] ? 'Pentatonic' : 'Diatonic';
  if (s.runRoot || s.runScale) {
    ['scales', 'runs', 'broken'].forEach(id => {
      const bag = (s.opt[id] = s.opt[id] || {});
      if (legacySeed.key && bag.key == null) bag.key = legacySeed.key;
      if (legacySeed.scaleName && bag.scaleName == null) { bag.scaleCat = legacySeed.scaleCat; bag.scaleName = legacySeed.scaleName; }
    });
    delete s.runRoot; delete s.runScale;
  }

  const alive = () => !!document.getElementById(`body-${p.id}`);

  // ── the neck's dot colours ───────────────────────────────────────────
  // Everything this pedal draws in its own body reads the kit tokens straight out of
  // CSS. The FRETBOARD cannot: it paints dots as SVG fill/stroke ATTRIBUTES, and an
  // attribute has no cascade to look a variable up in. So resolve the four tokens once
  // — set each on a throwaway node inside the pedal and read back what the browser
  // computed — and hand the neck real colours. The pedal still names no colour of its
  // own, so the dots follow the card's accent exactly like the chrome does.
  // root vs tone stays a two-token contrast (loud accent vs quiet accent), because
  // "which dot is the root" is information, not decoration.
  let neck = null;
  function neckSkin() {
    if (neck) return neck;
    const host = el.querySelector('.rk');
    if (!host) return null;              // nothing rendered yet — let the neck keep its own defaults
    const probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    const read = tok => { probe.style.color = `var(${tok})`; return getComputedStyle(probe).color; };
    neck = { root: read('--rk-accent'), tone: read('--rk-dim'), rootStroke: read('--rk-hot'), toneStroke: read('--rk-line') };
    probe.remove();
    return neck;
  }

  let active = null;      // { openId, w, bag, engine, cur, nxt, beat, bpm, timer, planStop, … }
  let customs = loadCustoms(legacySeed);
  // Migration is a ONE-WAY upgrade and has to be written back immediately: the legacy globals
  // it rebuilds a v1 run from are deleted above, so re-deriving on the next mount would silently
  // reset the workout to C major. Upgrade once, persist, never interpret the old shape again.
  if (customs.some(c => c._up)) { customs.forEach(c => { delete c._up; }); saveCustoms(customs); }
  let notice = null;      // one-line explanation shown at the top (empty plan, retired custom…)

  const beatsPerBar = () => metroClock.ts || 4;
  const beatsPerItem = () => s.bars * beatsPerBar();

  // ── resolving what's open ────────────────────────────────────────────
  // An id is either a preset workout or a saved custom. A custom's options ARE its saved
  // cfg — editing one edits the saved workout, which is what direct manipulation should do.
  function entryOf(id) {
    if (!id) return null;
    const w = WORKOUT_OF(id);
    if (w) return { id, w, raw: (s.opt[id] = s.opt[id] || {}), name: w.name, icon: w.icon, custom: null };
    const c = customs.find(x => x.id === id);
    if (!c) return null;
    const cw = WORKOUT_OF(c.workout);
    if (!cw || c.retired) return { id, w: null, raw: c.cfg || {}, name: c.name, icon: c.icon || '⚠', custom: c };
    return { id, w: cw, raw: (c.cfg = c.cfg || {}), name: c.name, icon: c.icon || cw.icon, custom: c };
  }
  const openEntry = () => entryOf(s.open);
  const bagFor = ent => bagOf(ent.w, ent.raw);
  const commit = ent => { if (ent.custom) saveCustoms(customs); };

  // rootFor / sourceFor live at module scope because the CARD summaries need them too —
  // a card that can't say which source it will run on is the thing this pass set out to fix.
  const rootOf = rootFor;
  const scaleIntervals = bag => SCALE_TYPES[bag.scaleCat]?.[bag.scaleName] || SCALE_TYPES.Diatonic.Major;

  // ── the step strip ───────────────────────────────────────────────────
  // A workout you can only hear is a peephole: you see the chord under your fingers
  // and nothing either side of it, so the moment you fall off you cannot rejoin. The
  // shared strip (src/ui/step-strip.js) lays the WHOLE thing out — every chord you're
  // about to be flashed, every note of the run — with bar lines and a playhead, so a
  // stumble is recoverable: you can see where you are, what's coming, and tap back in.
  // Built ONCE per plan (a rebuild mid-drill loses the scroll and flickers), then only
  // repainted per step. It stays on screen after ⏹ so you can read back what you played.
  const SID = 'wo-' + p.id;
  const TID = 'wotc-' + p.id;
  // The strip's gold "now" / blue "next" / bar lines are ITS language, shared across every
  // pedal that draws one — only these three values are ours. They are handed to the build
  // and to every repaint from the same object, because a repaint with a different skin
  // flips every idle chip's border the first time the playhead moves.
  const SKIN = { accent: 'var(--rk-accent)', dim: 'var(--rk-ink-mute)', line: 'var(--rk-edge-soft)' };
  const FLASH_PAGE = 16;              // chords pre-rolled ahead of you, so the strip has look-ahead
  let strip = null;                   // { kind, steps, sections, tsig, playIdx, selIdx, names, title, done }

  const stripByBar = () => (active?.bpm || metroClock.bpm || 90) > 140;   // fast runs move a bar at a time, not a jitter per note

  function stripInner() {
    if (!strip) return '';
    const names = strip.names;        // flash workouts name their own chips; runs let the strip print note names
    return stepStripHTML(SID, {
      steps: strip.steps, sections: strip.sections, tsig: strip.tsig,
      playIdx: strip.playIdx, selIdx: strip.selIdx, ...SKIN,
      label: names ? ((st, i) => names[i] || '·') : undefined,
    });
  }
  function stripBlock() {
    if (!strip?.steps?.length) return '';
    const hint = strip.done ? 'finished · tap a chip to look back'
      : strip.kind === 'flash' ? 'tap a chip to jump'
      : s.adv === 'listen' ? 'tap a note to pick up from there'
      : 'the whole run, laid out';
    return `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:8px;padding:6px 7px">
      <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📜 ${esc(strip.title || 'STEP STRIP')} · ${hint}</div>
      <div id="wostrip-${p.id}">${stripInner()}</div></div>`;
  }
  function wireStrip() {
    if (!strip?.steps?.length) return;
    wireStepStrip(SID, { onPick: pickStep });
    followStrip(SID, strip.playIdx || 0, { byBar: stripByBar() });
  }
  // the SEQUENCE changed (new box, next page of chords) — rebuild the chips once.
  function syncStrip() {
    const host = document.getElementById(`wostrip-${p.id}`);
    if (!host) return;
    host.innerHTML = stripInner();
    wireStrip();
  }
  // same chips, new playhead — never rebuild here
  function paintStrip(i) {
    if (!strip) return;
    strip.playIdx = i;
    paintStripAt(SID, { playIdx: i, selIdx: strip.selIdx, ...SKIN });
    followStrip(SID, i, { byBar: stripByBar() });
  }
  function pickStep(i) {
    if (!strip) return;
    if (active?.engine === 'flash' && active.queue?.length) {          // jump the flash queue
      active.qi = Math.max(0, Math.min(i, active.queue.length - 1));
      active.cur = active.queue[active.qi];
      active.nxt = active.queue[active.qi + 1] || active.nextPage?.[0] || null;
      active.beat = 0; flashGate.reset();
      showItem(); refreshStatus(); paintStrip(active.qi);
      return;
    }
    if (active?.engine === 'run' && s.adv === 'listen' && active.plan) {   // 🎤 runs wait on you, so seeking is free
      active.li = Math.max(0, Math.min(i, active.plan.steps.length - 1));
      runListenShow(); refreshStatus();
      return;
    }
    // clock-driven run, or a finished strip: mark the chip (where you fell off) and let the playhead run on
    strip.selIdx = i;
    paintStripAt(SID, { playIdx: strip.playIdx, selIdx: i, ...SKIN });
  }
  // one chip per flashed chord, named
  function flashStrip() {
    const q = active?.queue || [];
    return {
      kind: 'flash', tsig: beatsPerBar(), sections: [], playIdx: active?.qi || 0, selIdx: null,
      title: `${active?.icon || ''} ${active?.name || 'workout'}`.trim(),
      names: q.map(it => it.label),
      steps: q.map(it => ({ notes: (it.positions || []).map(x => ({ si: x.si, fret: x.fret })), dur: beatsPerItem() })),
    };
  }
  // a run plan → chips. Drill steps carry their dur in SECONDS; the strip counts BEATS.
  function runStrip(plan, bpm) {
    const beat = 60 / (bpm || metroClock.bpm || 90);
    const steps = planToStripSteps(plan.steps).map(st => ({ ...st, dur: Math.max(0.125, +(((st.dur || beat) / beat).toFixed(3))) }));
    // a box run is ascend + descend (2P−1 steps over P positions) — flag the turnaround
    const P = (plan.positions || []).length;
    const sections = (P > 1 && steps.length === P * 2 - 1) ? [{ at: 0, name: 'up' }, { at: P - 1, name: 'top' }] : [];
    return { kind: 'run', steps, sections, tsig: beatsPerBar(), playIdx: 0, selIdx: null, title: plan.label || active?.name || 'run' };
  }

  // ── CHORD TRAINER: one flashed grip ──────────────────────────────────
  // Open grips and 3-string triads are the same lesson at two scales, which is why they are
  // one workout now: a C is a C whether you strum six strings of it or grab three of them at
  // the 8th fret. The KEY option is what makes it practice rather than flashcards — drilling
  // "any of the 12" is recall, drilling "the six chords of A major" is repertoire.
  function genFlashItem(bag) {
    const keyRoot = bag.key === 'any' ? null : rootOf(bag);
    const pat = KEY_PATTERNS[bag.keyType] || KEY_PATTERNS.Major;

    if (bag.position === 'open') {
      let nm, root, quality;
      if (!keyRoot) {                                  // all 12 roots — the classic open-chord pool
        nm = pick(bag.pool?.length ? bag.pool : CHORD_POOL);
        ({ root, quality } = parseChordName(nm));
      } else {
        // diatonic to the key. The vii° is dropped: a diminished triad has no open grip
        // worth drilling and it is not a chord you call for by name at a campfire.
        const chs = (getKeyChords(keyRoot, bag.keyType) || []).filter(c => c.quality !== 'Dim');
        const c = pick(chs);
        if (!c) return null;
        root = c.root; quality = c.quality; nm = `${c.numeral} · ${root}${QSUF[quality] ?? ''}`;
      }
      const notes = getChordNotes(root, chordIntervalsFor(quality));
      const grip = pickGrip(root, notes, quality, 'open', 0);
      if (!grip?.positions) return null;
      // Say "open grip" only when it IS one. Most keys have no true open shape for every
      // diatonic chord, so pickGrip hands back a barre — pretending otherwise would teach
      // the wrong hand. Name the fret instead and let the diagram do the rest.
      const mf = grip.minFret || 0;
      const hasOpen = grip.positions.some(x => x.fret === 0);
      return { label: nm, sub: hasOpen ? 'open grip' : `${mf}fr grip`, root, notes, positions: grip.positions };
    }

    const sets = stringSets();
    if (!sets.length) return null;
    const si = bag.position === 'all' ? Math.floor(Math.random() * sets.length) : Math.min(Math.max(0, +bag.position || 0), sets.length - 1);
    const set = sets[si];
    const quals = (bag.quals && bag.quals.length) ? bag.quals : ['Major'];
    let rootPc, quality;
    if (keyRoot) {
      const deg = pick([0, 1, 2, 3, 4, 5]);            // degrees I–vi; the vii° is a special case, not a drill
      rootPc = (NOTES.indexOf(keyRoot) + pat.intervals[deg]) % 12;
      quality = pat.qualities[deg];
      if (!quals.includes(quality)) quality = pick(quals);
    } else {
      rootPc = Math.floor(Math.random() * 12);
      quality = pick(quals);
    }
    const grips = findTriadsOnSet(rootPc, quality, set.idxs).filter(g => g.min <= 12);
    if (!grips.length) return null;
    const g = pick(grips.slice(0, 5));                 // a recall drill stays in the low positions
    const positions = assignFingers(g.frets.map((f, k) => {
      const sj = set.idxs[k], n = getNoteAtFret(customTuning[sj].note, customTuning[sj].octave, f);
      return { si: sj, fret: f, note: n.note, octave: n.octave };
    }));
    const root = NOTES[rootPc];
    return { label: `${root}${QSUF[quality] ?? ''}`, sub: `${INV_NAME[g.rot]} · ${g.min}fr · ${set.label}`, root, notes: positions.map(x => x.note), positions };
  }

  function showItem() {
    if (!active?.cur) return;
    const { cur, nxt } = active;
    setChordHighlight(cur.root, [...new Set(cur.notes)], `${cur.label} · ${cur.sub}`, cur.positions, neckSkin(), null, null, false);
    if (nxt) setGhostHighlight(nxt.positions.map(x => ({ si: x.si, fret: x.fret, note: x.note })));
    else clearGhostHighlight();
    // big now/next banner above the neck — now in the dot color, next in the ghost color
    setNowBanner({ now: { text: `${cur.label} · ${cur.sub}`, color: neckSkin()?.root }, next: nxt ? { text: nxt.label } : null });
    updateOverlays();
    // soft roll so the ear gets the target too
    [...cur.positions].sort((a, b) => (a.octave * 12 + NOTES.indexOf(a.note)) - (b.octave * 12 + NOTES.indexOf(b.note)))
      .forEach((x, i) => setTimeout(() => { if (active) playNote(x.note, x.octave, { dur: 0.5, gain: 0.14 }); }, i * 40));
  }

  // Flash items are rolled a PAGE at a time so the strip can show what's coming —
  // same randomness, just decided a little earlier.
  function fillFlashQueue(n = FLASH_PAGE) {
    const out = [];
    for (let k = 0; k < n * 4 && out.length < n; k++) { const it = genFlashItem(active.bag); if (it) out.push(it); }
    return out;
  }
  // an option changed mid-run: re-roll everything AFTER the chord you're holding, and
  // repaint the strip HERE rather than trusting every caller to remember a render().
  function regenFlashAhead() {
    if (!active || active.engine !== 'flash' || !active.queue?.length) return;
    active.queue = active.queue.slice(0, active.qi + 1).concat(fillFlashQueue());
    active.nextPage = null;
    active.nxt = active.queue[active.qi + 1] || null;
    strip = flashStrip();
    syncStrip();
  }

  function advanceFlash() {
    if (!active) return;
    if (!active.queue?.length || active.qi + 1 >= active.queue.length) {   // turn the page
      active.queue = active.nextPage?.length ? active.nextPage : fillFlashQueue();
      active.nextPage = null;
      active.qi = 0;
      if (!active.queue.length) { stopWorkout(); return; }
      strip = flashStrip(); syncStrip();     // a rebuild once every page is fine — never per item
    } else active.qi++;
    if (active.qi + 2 >= active.queue.length && !active.nextPage) active.nextPage = fillFlashQueue();
    active.cur = active.queue[active.qi];
    active.nxt = active.queue[active.qi + 1] || active.nextPage?.[0] || null;
    active.itemCount++;
    active.beat = 0;
    flashGate.reset();                       // heard chips clear; a ringing note can count for the new grip
    if (active.ramp && active.itemCount % 2 === 0 && active.bpm < active.ramp.to) {
      active.bpm = Math.min(active.ramp.to, active.bpm + active.ramp.step);
      restartFlashTimer();
    }
    showItem(); refreshStatus(); paintStrip(active.qi);
  }

  function restartFlashTimer() {
    if (active?.timer) clearInterval(active.timer);
    if (!active) return;
    active.timer = setInterval(() => {
      if (!alive()) { stopWorkout(); return; }
      if (!active) return;
      active.beat++;
      // bars → beats through the CLOCK's time signature, so 3/4 counts in threes and the
      // beat pips agree with the strip's bar lines instead of both assuming 4.
      if (s.adv === 'auto' && active.beat >= beatsPerItem()) advanceFlash();
      else refreshStatus();
    }, 60000 / (active.bpm || metroClock.bpm || 90));
  }

  // 🎤 listen (core/listen.js does the attack gating): flash workouts advance
  // when every note of the grip is heard; run workouts step note-by-note through
  // the pattern as each pitch lands. Two gates, each hooked once per pedal
  // instance — isActive keeps only the running kind awake.
  const listening = () => !!active && s.adv === 'listen' && alive();
  const flashGate = expectNotes({
    owner: p, key: 'woFlash',
    want: () => active?.cur?.notes || [],
    isActive: () => listening() && active.engine === 'flash' && !!active.cur,
    onProgress: () => refreshStatus(),
    onComplete: () => setTimeout(() => { if (active) advanceFlash(); }, 350),
  });
  const runGate = createListener({
    owner: p, key: 'woRun',
    isActive: () => listening() && active.engine === 'run' && !!active.plan,
    onAttack: note => {
      const st = active.plan.steps[active.li];
      if (!st?.play?.length || !st.play.some(q => q.note === note)) return;
      playNote(note, st.play[0]?.octave ?? 3, { dur: 0.3, gain: 0.12 });
      // A GRIP step (a triad march sounds three notes at once) is not played until every voice
      // of it is: advancing on one note would let you pass a triad by fretting only its root.
      // Single-note steps — every scale pattern — advance the moment the pitch lands.
      const want = new Set(st.play.map(q => q.note));
      if (want.size > 1) {
        (active.stepHeard = active.stepHeard || new Set()).add(note);
        if (active.stepHeard.size < want.size) { refreshStatus(); return; }
      }
      active.stepHeard = null;
      active.li++;
      if (active.li >= active.plan.steps.length) {
        active.itemCount++;
        setTimeout(() => { if (active) startRunListen((active.boxIdx || 0) + 1); }, 400);
      } else runListenShow();
      refreshStatus();
    },
  });

  // ── run workouts (patterns via playPlan) ─────────────────────────────
  // How many positions this scale actually HAS. The old code cycled `boxIdx % 5` and
  // buildScaleBox clamped, so a 3-box scale replayed its last box twice and a 7-box
  // scale never showed boxes 6 and 7. Ask, then cycle the real count.
  function boxCount(w, bag, root, ints) {
    // Only the n-per-string shapes have their own box list. 'mine' never reaches here with a
    // usable seed, and when it falls back it falls back to CAGED — so it counts CAGED boxes.
    if (w.id === 'scales' && (bag.shape === '3nps' || bag.shape === '4nps')) return (buildNpsBoxes(root, ints, bag.shape === '4nps' ? 4 : 3) || []).length || 1;
    return (findScaleBoxes(root, ints, { scaleCat: bag.scaleCat, scaleName: bag.scaleName }) || []).length || 1;
  }
  // n-per-string positions as a plan. Quarter notes and a dimly-lit whole box, exactly like
  // buildScaleBox — switching SHAPE should change the fingering, not secretly double the
  // note density or change what the neck shows.
  function npsPlan(root, ints, nps, bi, bpm, downToo, bag) {
    const boxes = buildNpsBoxes(root, ints, nps);
    if (!boxes?.length) return buildScaleBox(root, ints, { bpm, boxIndex: bi, scaleCat: bag.scaleCat, scaleName: bag.scaleName, name: bag.scaleName, downToo });
    const box = boxes[bi % boxes.length];
    const dur = 60 / bpm;
    const asc = [...box.positions];
    const seq = downToo ? asc.concat([...asc].reverse().slice(1)) : asc;
    return {
      root, notes: [...new Set(asc.map(q => q.note))],
      label: `${root} ${bag.scaleName} · ${nps} per string`,
      positions: asc,
      steps: seq.map(q => ({ focus: [{ si: q.si, fret: q.fret }], play: [{ note: q.note, octave: q.octave }], dur })),
    };
  }
  // ── the written march, transposed ─────────────────────────────────────────
  // Nothing here generates notes. The piece is loaded as written and moved as a
  // whole; a march is wider than an octave, so when a key pushes the top rungs off
  // the neck they wrap an octave down and become the bottom rungs — the same
  // complete ladder, entered further along. Every grip survives in all 12 keys.
  function myMarchPlan(bag, bpm) {
    const idx = Math.max(0, +bag.setIdx || 0);
    const want = MY_MARCH_PIECES[idx];
    if (!want) return null;
    const piece = readPieces().find(p => (p.name || '').trim().toLowerCase() === want.toLowerCase());
    if (!piece || !(piece.steps || []).length) return null;

    const root = rootOf(bag);
    const t = transposeToKey(piece.steps, 'C', root);
    if (t.mode === 'overflow') return null;          // will not fit — let the engine answer
    const steps = bag.dir === 'down' ? [...t.steps].reverse() : t.steps;

    const moved = t.mode === 'rotate' ? ` · ${t.wrapped} rung${t.wrapped === 1 ? '' : 's'} wrapped an octave`
                : t.mode === 'octave' ? ' · placed an octave over'
                : '';
    const plan = stepsToPlan(steps, { bpm, root, label: `${root} triad march · ${setLabel(idx)}${moved}` });

    const frets = steps.flatMap(st => (st.notes || []).map(n => n.fret)).filter(f => f >= 0);
    const spans = steps.filter(st => (st.notes || []).length)
                       .map(st => { const f = st.notes.map(n => n.fret); return Math.max(...f) - Math.min(...f); });
    plan.march = {
      grips: steps.filter(st => (st.notes || []).length).length,
      setLabel: setLabel(idx),
      span: frets.length ? Math.max(...frets) - Math.min(...frets) : 0,
      handSpan: spans.length ? Math.max(...spans) : 0,
    };
    return plan;
  }

  // ── the seed scale, walked ────────────────────────────────────────────────
  // Nothing here generates a note either. seedScale hands back Kevin's own fingering in the
  // key asked for, ascending; a RUN is that list cut into overlapping cells and a BROKEN
  // pattern is it paired a fixed number of SCALE steps apart. Both derivations live in
  // core/authored.js, so the workout and the TAB page's library agree by construction.
  //
  // ONE STEP PER BEAT throughout: notesToSteps gives every note dur 1 and stepsToPlan turns
  // that into 60/bpm. No group gap. The gap is a real musical idea — it lets the ear parse
  // the cells — but it makes the run limp, and a run you cannot put a click behind is a run
  // whose tempo you can never raise. The grouping is in the strip's bar lines instead.
  function seedPlan(id, bag, src, bpm) {
    const asc = src.scale?.notes || [];
    // Guard the TUNING, not the music: a seed written on six strings has nowhere to go on a
    // four-string bass, and stepsToPlan would read a note off a string that isn't there.
    if (asc.length < 2 || asc.some(q => !q || !customTuning[q.si] || q.fret < 0)) return null;
    const root = rootOf(bag);

    let seq, what = '';
    if (id === 'runs') {
      const n = Math.max(3, Math.min(7, +bag.n || 3));
      const up = deriveRun(asc, n);
      if (up.length < n) return null;                       // the seed is shorter than one cell
      const cells = [];
      for (let i = 0; i + n <= up.length; i += n) cells.push(up.slice(i, i + n));
      // Coming down, the cells mirror: …5-6-7 | 6-5-4 | 5-4-3… The top cell is NOT replayed
      // backwards — that sounds the turn note twice in a row and reads as a stumble.
      const down = cells.slice(0, -1).reverse().flatMap(g => [...g].reverse());
      seq = bag.dir === 'up' ? up : up.concat(down);
      what = `${n}-note cells`;
    } else if (id === 'broken') {
      const iv = Math.max(3, Math.min(7, +bag.interval || 3));
      seq = deriveBroken(asc, BROKEN_SKIP[iv] || 2);        // interval NUMBER → scale STEPS
      if (seq.length < 4) return null;                      // one pair is a fragment, not an exercise
      what = `broken ${ORD(iv)}s`;
    } else {
      // Straight up and back down, turning at the top without sounding it twice — the same
      // 2P−1 shape buildScaleBox makes, so the strip finds its up / top sections either way.
      seq = bag.dir === 'up' ? asc : asc.concat(asc.slice(0, -1).reverse());
    }

    const positions = asc.map(q => {
      const s = customTuning[q.si], g = getNoteAtFret(s.note, s.octave, q.fret);
      return { si: q.si, fret: q.fret, note: g.note, octave: g.octave };
    });
    const minF = Math.min(...positions.map(x => x.fret));
    const label = [`${root} ${bag.scaleName}`, what, '🎸 mine', minF <= 0 ? 'open position' : `pos. ${minF}fr`].filter(Boolean).join(' · ');
    const plan = stepsToPlan(notesToSteps(seq), { bpm, root, label });
    // stepsToPlan collects one position per PLAYED note, so a run would list the same fret a
    // dozen times. The neck wants the shape once, dim-lit behind the moving focus.
    plan.positions = positions;
    plan.notes = [...new Set(positions.map(x => x.note))];
    plan.source = { kind: 'seed', line: src.line };
    return plan;
  }

  function buildRunPlan(boxIdx) {
    const w = active.w, bag = active.bag, bpm = active.bpm || metroClock.bpm || 90;
    const root = rootOf(bag);

    if (w.id === 'march') {
      const t = MARCH_TYPES.find(x => x.id === bag.marchType) || MARCH_TYPES[0];
      active.nBoxes = 1;                     // a march is one ordered pattern; it repeats, it doesn't climb

      // The hand-written march wins by default. The engine's ladder walks ONE chord's
      // inversions; this walks EVERY diatonic triad of the key up one string set, one
      // voice moving at a time — a different exercise, and the one actually practised.
      // It is not regenerated, only transposed: the fingering is the author's.
      if (t.id === 'mine') {
        const plan = myMarchPlan(bag, bpm);
        if (plan) return plan;
        // no piece written for this string set yet — fall through to the engine rather
        // than starting a workout that plays nothing
      }
      // No label override: the engine's own headline is the teaching payload — it prints the
      // progression, the key it has been transposed into, and the FRET TOTAL the voice leading
      // costs, which is the number the whole exercise exists to make visible.
      return buildTriadMarch(root, bag.quality, {
        type: t.id, bpm, dir: bag.dir || 'up',
        setIdx: Math.max(0, +bag.setIdx || 0),
        anchor: Math.max(0, +bag.anchor || 0),
        progression: Math.max(0, +bag.prog || 0),     // an index into TRIAD_MARCH_PROGRESSIONS
        keyType: bag.keyType || 'Major',
        // One beat per grip, matching the hand-written march, which is the pace every
        // run in this pedal is measured against. BARS is left to the FLASH drill, where
        // it means something specific — how long you get to FIND a chord. Letting it also
        // stretch a march made the two march types move at four times different speeds
        // while claiming to be the same exercise.
        beatsPerChord: 1,
      });
    }

    // Kevin's own fingering is the default source for all three scale workouts, exactly as
    // the written march is the default for the march: his material first, the engine as the
    // answer when he has not authored something that fits. seedPlan can still decline —
    // a 7-note cell out of a 6-note seed — in which case the engine takes it from here.
    const src = sourceFor(w.id, bag);
    if (src.kind === 'seed') {
      const mine = seedPlan(w.id, bag, src, bpm);
      if (mine) { active.nBoxes = 1; return mine; }   // one written shape: it repeats, it doesn't climb
    }

    const ints = scaleIntervals(bag);
    const n = boxCount(w, bag, root, ints);
    const bi = ((boxIdx % n) + n) % n;
    active.nBoxes = n;
    const downToo = bag.dir !== 'up';
    // scaleCat AND scaleName travel together, always. findScaleBoxes branches on the CATEGORY
    // by name to hand back canonical mode / blues shapes — lie about it and modes silently
    // fall through to a generic sliding window and you learn the wrong shapes.
    const common = { bpm, boxIndex: bi, scaleCat: bag.scaleCat, scaleName: bag.scaleName, name: bag.scaleName, downToo };

    let plan;
    if (w.id === 'scales') {
      // 'mine' only reaches here when the seed could not answer, and CAGED is the honest
      // stand-in for it — a real hand position, not a stretch fingering he never asked for.
      plan = (bag.shape === '3nps' || bag.shape === '4nps')
        ? npsPlan(root, ints, bag.shape === '4nps' ? 4 : 3, bi, bpm, downToo, bag)
        : buildScaleBox(root, ints, { ...common, label: `${root} ${bag.scaleName}` });
    } else if (w.id === 'runs') {
      // groupGap 0 — ONE STEP PER BEAT, like every other run. The engine's default puts a
      // beat-and-a-half breath after each cell so the ear parses the groups, which is a
      // real idea but it makes the run limp: three notes, pause, three notes, pause. You
      // cannot practise against a click that way, and the whole point of these is that
      // they run at a tempo you can raise. The grouping is visible in the strip's bar
      // lines instead, where it costs no time.
      plan = buildScaleSequence(root, ints, Math.max(3, Math.min(7, +bag.n || 3)), { ...common, groupGap: 0 });
    } else {
      const iv = Math.max(3, Math.min(7, +bag.interval || 3));   // interval NUMBER; the engine counts scale STEPS
      plan = buildBrokenInterval(root, ints, iv - 1, { ...common, label: `${root} ${bag.scaleName} · broken ${ORD(iv)}s` });
    }
    // The builders already name their own position ("pos. 7fr"); what they can't say is which
    // of how many you are on, and that is the thing you're tracking as the cycles go by.
    // Where a builder reports the real count, believe it over ours — it may have fallen back.
    if (plan && typeof plan.boxCount === 'number') active.nBoxes = plan.boxCount;
    const total = active.nBoxes, idx = (typeof plan?.boxIndex === 'number' ? plan.boxIndex : bi);
    if (plan && total > 1) plan.label = `${plan.label} · box ${idx + 1}/${total}`;
    // Say so even when the fallback was the LAST thing that happened: asking for the seed and
    // silently getting a generated box is the exact confusion this line exists to prevent.
    if (plan) plan.source = { kind: 'engine', line: src.kind === 'seed' ? '⚙ generated — your seed scale is too short for this run' : src.line };
    return plan;
  }

  // A plan with zero steps used to look like a running workout that played nothing and
  // could not be stopped. Say what happened instead.
  function emptyPlan() {
    const bag = active?.bag || {};
    notice = active?.w?.id === 'broken'
      ? `Broken ${ORD(+bag.interval || 3)}s produced no notes in ${bag.scaleName || 'that scale'} — the interval is wider than the position has scale tones. Try a narrower interval or a 7-note scale.`
      : 'That combination produced no notes on the neck — try another key, scale or position.';
    stopWorkout();
  }

  // 🎤 listen-mode runs: no clock — the pattern waits on each note until it hears you
  function startRunListen(boxIdx) {
    if (!active) return;
    const plan = buildRunPlan(boxIdx);
    if (!plan?.steps?.length) { emptyPlan(); return; }
    active.plan = plan; active.li = 0; active.boxIdx = boxIdx;
    // A march sounds three notes per step, a scale run one — say which the mic is waiting for.
    const isGrip = (plan.steps[0]?.play?.length || 1) > 1;
    active.cur = { label: plan.label || active.name, sub: isGrip ? '🎤 play every note of the grip to advance' : '🎤 play each lit note to advance' };
    strip = runStrip(plan, active.bpm || metroClock.bpm || 90);
    syncStrip();
    runGate.rearm();
    runListenShow();
    refreshStatus();
  }
  function runListenShow() {
    const plan = active?.plan;
    if (!plan) return;
    active.stepHeard = null;                 // a new step: the tally of heard voices starts over
    const st = plan.steps[active.li], nx = plan.steps[(active.li + 1) % plan.steps.length];
    setChordHighlight(plan.root, plan.notes, `${plan.label} · ${active.li + 1}/${plan.steps.length}`, plan.positions, neckSkin(), st.focus, null, plan.focusOnly);
    if (nx?.focus?.length) setGhostHighlight(nx.focus.map((f, k) => ({ si: f.si, fret: f.fret, note: (nx.play[k] || nx.play[0] || {}).note || '' })));
    else clearGhostHighlight();
    setNowBanner({ now: { text: st.play.map(q => q.note).join('·'), color: neckSkin()?.root }, next: nx?.play?.length ? { text: nx.play.map(q => q.note).join('·') } : null });
    updateOverlays();
    paintStrip(active.li);
  }
  function startRunCycle(boxIdx) {
    if (!active) return;
    if (s.adv === 'listen') { startRunListen(boxIdx); return; }
    const plan = buildRunPlan(boxIdx);
    if (!plan?.steps?.length) { emptyPlan(); return; }
    active.boxIdx = boxIdx;
    active.plan = plan;
    active.cur = { label: plan.label || active.name, sub: '' };
    strip = runStrip(plan, active.bpm || metroClock.bpm || 90);   // build ONCE, here — the whole position laid out
    syncStrip();
    refreshStatus();
    active.planStop = playPlan(plan, {
      loop: true, isAlive: alive, gain: 0.2,
      onStep: i => {
        const st = plan.steps?.[i], nx = plan.steps?.[i + 1] || plan.steps?.[0];
        paintStrip(i);                       // move the playhead first, so a rest step still tracks
        if (!st?.play?.length) return;
        setNowBanner({ now: { text: st.play.map(q => q.note).join('·'), color: neckSkin()?.root }, next: nx?.play?.length ? { text: nx.play.map(q => q.note).join('·') } : null });
        updateOverlays();
      },
      onCycle: () => {
        if (!active) return;
        active.itemCount++;
        if (active.ramp && active.bpm < active.ramp.to) active.bpm = Math.min(active.ramp.to, active.bpm + active.ramp.step);
        // walk to the next position each pass — that is what turns "a scale shape" into
        // "the scale". A march repeats in place (nBoxes 1) because repetition IS the march.
        if ((active.nBoxes || 1) > 1 || active.ramp) {
          if (active.planStop) active.planStop();
          setTimeout(() => { if (active) startRunCycle((active.boxIdx || 0) + 1); }, 350);
        }
        refreshStatus();
      },
    });
  }

  // ── start / stop ─────────────────────────────────────────────────────
  function startWorkout(id) {
    const ent = entryOf(id);
    if (!ent?.w) return;
    const bag = bagFor(ent);
    stopWorkout();
    notice = null;
    metroClock.stopOthers?.(p.id);
    flashGate.reset();
    const ramp = bag.rampOn ? { from: +bag.rampFrom || 60, to: +bag.rampTo || 90, step: Math.max(1, +bag.rampStep || 5) } : null;
    active = {
      openId: id, w: ent.w, bag, name: ent.name, icon: ent.icon, engine: ent.w.engine,
      cur: null, nxt: null, beat: 0, itemCount: 0, bpm: ramp ? ramp.from : (metroClock.bpm || 90), ramp,
      timer: null, planStop: null, plan: null, heard: flashGate.heard, startedAt: Date.now(),
      queue: [], qi: 0, nextPage: null, boxIdx: 0, nBoxes: 1, li: 0,
    };
    strip = null;
    if (active.engine === 'flash') {
      active.queue = fillFlashQueue();
      active.qi = 0;
      active.cur = active.queue[0] || null;
      active.nxt = active.queue[1] || null;
      if (!active.cur) { active = null; notice = 'No grips found for those options — try another key or string set.'; render(); return; }
      strip = flashStrip();                  // set before render() so the first paint already has the chips
      showItem();
      restartFlashTimer();
    } else {
      startRunCycle(0);
    }
    render();
  }
  function stopWorkout() {
    if (!active) return;
    if (active.timer) clearInterval(active.timer);
    if (active.planStop) active.planStop();
    active = null;
    if (strip) strip.done = true;            // the strip stays up so you can read back what you just played
    setNowBanner(null);
    clearChordHighlight(); clearGhostHighlight(); updateOverlays();
    if (alive()) render();
  }
  p._woStop = stopWorkout;

  // An option changed while its own workout is running: take the right refresh path so the
  // strip never advertises chords that will never be played.
  function applyLiveChange(ent) {
    if (!active || active.openId !== ent.id) return;
    active.bag = bagFor(ent);
    if (active.engine === 'flash') regenFlashAhead();
    else { active.planStop?.(); active.planStop = null; startRunCycle(active.boxIdx || 0); }
  }

  // ── render ───────────────────────────────────────────────────────────
  const chip = (cls, data, lab, on, extra = '') => `<button class="${cls} mono" ${data} style="min-height:calc(28px*var(--ui));background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:5px;color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};font-size:calc(10px*var(--ui));padding:4px 7px;cursor:pointer;${extra}">${lab}</button>`;
  const lbl = t => `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin:4px 0 1px">${t}</div>`;
  const row = inner => `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap">${inner}</div>`;
  // Deleting a saved workout throws away Kevin's own setup, so the button has to stop
  // looking like the ones beside it. --rk-bad is the app's one "this went wrong" colour;
  // borrowing it here is what keeps the warning out of the pedal's accent.
  const DANGER = 'flex:1;color:var(--rk-bad);border-color:color-mix(in srgb, var(--rk-bad) 42%, transparent)';

  function refreshStatus() {
    const st = document.getElementById(`wost-${p.id}`);
    if (!st || !active) return;
    const per = beatsPerItem();
    const mins = Math.floor((Date.now() - active.startedAt) / 60000), secs = Math.floor((Date.now() - active.startedAt) / 1000) % 60;
    let h = `<div class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));letter-spacing:1.5px">${active.icon} ${esc(active.name.toUpperCase())} · ${active.bpm} BPM · ${mins}:${String(secs).padStart(2, '0')}</div>`;
    h += `<div class="mono" style="color:var(--rk-accent);font-size:calc(19px*var(--ui));font-weight:800;line-height:1.2">${esc(active.cur?.label || '…')}</div>`;
    if (active.cur?.sub) h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${esc(active.cur.sub)}</div>`;
    if (active.engine === 'flash') {
      if (s.adv === 'auto') {
        h += `<div style="display:flex;gap:3px;margin-top:5px">`;
        for (let b = 0; b < per; b++) h += `<div style="flex:1;height:5px;border-radius:2px;background:${b < active.beat ? 'var(--rk-accent)' : 'var(--rk-panel)'}"></div>`;
        h += `</div>`;
      } else {
        const want = [...new Set(active.cur?.notes || [])];
        h += `<div style="display:flex;gap:4px;margin-top:5px;justify-content:center">` + want.map(n => `<span class="mono" style="font-size:calc(10px*var(--ui));padding:2px 7px;border-radius:4px;border:1px solid ${active.heard.has(n) ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};background:${active.heard.has(n) ? 'var(--rk-soft2)' : 'transparent'};color:${active.heard.has(n) ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'}">${n}${active.heard.has(n) ? ' ✓' : ''}</span>`).join('') + `</div>`;
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;margin-top:3px">🎤 play every note to advance</div>`;
      }
      if (active.nxt) h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-top:4px">next: ${esc(active.nxt.label)}</div>`;
    }
    if (active.engine === 'run' && s.adv === 'listen' && active.plan) {
      // note-by-note progress through the pattern
      const n = active.plan.steps.length, i = active.li;
      const heard = active.stepHeard;
      const target = active.plan.steps[i]?.play?.map(q => `${q.note}${heard?.has(q.note) ? '✓' : ''}`).join(' · ') || '—';
      h += `<div style="display:flex;align-items:center;gap:6px;margin-top:5px">
        <span class="mono" style="font-size:calc(13px*var(--ui));font-weight:800;color:var(--rk-accent);border:1px solid var(--rk-line);border-radius:6px;padding:2px 10px">${target}</span>
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">note ${i + 1}/${n}</span></div>`;
      h += `<div style="background:var(--rk-panel);border-radius:3px;height:5px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${Math.round((i / n) * 100)}%;background:var(--rk-accent)"></div></div>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;margin-top:3px">🎤 play the lit note — silence between repeats${audio.connected ? '' : ' · MIC NOT CONNECTED'}</div>`;
    }
    // The march measures itself: how many grips, how wide the hand has to open, and how far
    // the loop jumps to start over. (The total travel is already in the engine's own headline —
    // that number IS the lesson: I–V–vi–IV costs the same 9 frets in every key.)
    const m = active.plan?.march;
    if (m) h += `<div class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));margin-top:3px">${m.grips} grips · ${m.setLabel} · span ${m.span}fr${m.loopTravel ? ` · ${m.loopTravel} frets back to the top` : ''}</div>`;
    // WHOSE fingering is under your hands. A run out of Kevin's seed and a run out of a
    // generated box look identical on the neck and on the strip, and they are not the same
    // exercise — so the status block names the source for as long as the workout is running.
    const psrc = active.plan?.source;
    if (psrc) h += `<div class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));margin-top:3px">${esc(psrc.line)}</div>`;
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-top:3px">${active.itemCount} ${active.engine === 'flash' ? 'chords' : 'cycles'}${active.ramp ? ` · ramp → ${active.ramp.to}` : ''}</div>`;
    st.innerHTML = h;
  }

  function card(ent) {
    const dim = ent.retired ? 'opacity:.55;border-style:dashed;' : '';
    const running = active?.openId === ent.id;
    return `<button class="wo-card" data-open="${ent.id}" style="min-height:calc(28px*var(--ui));display:flex;flex-direction:column;align-items:flex-start;gap:1px;background:${running ? 'var(--rk-soft)' : 'var(--rk-panel2)'};border:1px solid ${running ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:8px;padding:8px 9px;cursor:pointer;text-align:left;${dim}">
      <span style="font-size:calc(13px*var(--ui))">${ent.icon} <span class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:700">${esc(ent.name)}</span></span>
      <span class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui))">${esc(ent.sub)}</span></button>`;
  }

  // ── the shared practice controls (BARS · ADVANCE · tempo) ────────────
  // These are settings about HOW you practise, not about what the workout is, so they stay
  // pedal-wide and appear in both views — the coach tour finds them on the grid, and you can
  // still reach them without leaving a running workout.
  function sharedControls() {
    let h = row(
      `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">BARS</span>` +
      [1, 2, 4].map(b => chip('wo-bars', `data-b="${b}"`, b, s.bars === b)).join('') +
      `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-left:6px">ADVANCE</span>` +
      chip('wo-adv', `data-v="auto"`, '⏱ Auto', s.adv === 'auto') +
      chip('wo-adv', `data-v="listen"`, '🎤 Listen', s.adv === 'listen')
    );
    h += `<div class="rk">${masterTempoBlock(TID, { min: 30, max: 280, compact: true })}</div>`;
    return h;
  }

  function optionRows(w, bag) {
    let h = '';
    w.opts.forEach(sp => {
      if (sp.when && !sp.when(bag)) return;
      if (sp.kind === 'key') {
        const vals = [['session', '⟳ Session']].concat(sp.any ? [['any', '∗ Any 12']] : []).concat(NOTES.map(n => [n, n]));
        h += lbl(sp.lbl) + row(vals.map(([v, l]) => chip('wo-opt', `data-k="key" data-v="${v}"`, l, bag.key === v, v.length <= 2 ? 'padding:3px 5px;min-width:18px' : '')).join(''));
        return;
      }
      if (sp.kind === 'scale') {
        // every group of SCALE_TYPES, grouped the way the Workshop groups them — pentatonic,
        // blues, diatonic, modes, symmetric. The CATEGORY is stored, not just the name.
        h += lbl(sp.lbl);
        Object.entries(SCALE_TYPES).forEach(([cat, items]) => {
          h += `<div class="mono" style="color:color-mix(in srgb, var(--rk-ink-mute) 72%, transparent);font-size:calc(8px*var(--ui));margin:3px 0 1px">${cat}</div>`;
          h += row(Object.keys(items).map(nm => chip('wo-opt', `data-k="scale" data-v="${cat}|${nm}"`, nm, bag.scaleCat === cat && bag.scaleName === nm)).join(''));
        });
        return;
      }
      if (sp.kind === 'multi') {
        const cur = bag[sp.k] || [];
        h += lbl(sp.lbl) + row(valsOf(sp, bag).map(([v, l]) => chip('wo-opt', `data-k="${sp.k}" data-multi="1" data-v="${v}"`, l, cur.includes(v))).join(''));
        return;
      }
      h += lbl(sp.lbl) + row(valsOf(sp, bag).map(([v, l]) => chip('wo-opt', `data-k="${sp.k}" data-v="${v}"`, l, String(bag[sp.k]) === String(v))).join(''));
    });
    const note = w.note?.(bag);
    if (note) h += `<div class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));text-align:center;margin-top:3px">${esc(note)}</div>`;
    // Before you press START: which fingering this key + scale will actually run on. The
    // march says it with its 🎸 My March chip; the scale workouts have no such chip to read,
    // so they say it in a line. (The march is excluded — it already answers for itself.)
    if (w.engine === 'run' && w.id !== 'march') {
      const src = sourceFor(w.id, bag);
      h += `<div class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));text-align:center;margin-top:4px">${esc(src.line)}</div>`;
      if (src.warn) h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;line-height:1.5">${esc(src.warn)}</div>`;
    }
    return h;
  }

  function rampRow(bag) {
    let h = lbl('TEMPO RAMP · pro');
    let inner = chip('wo-ramp', '', bag.rampOn ? 'On' : 'Off', !!bag.rampOn);
    if (bag.rampOn) {
      const num = (id, v, w2) => `<input id="${id}-${p.id}" type="number" value="${v}" style="width:${w2}px;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:4px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:3px;text-align:center"/>`;
      inner += num('worfrom', bag.rampFrom, 34) + `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">→</span>` + num('worto', bag.rampTo, 34) + `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">+</span>` + num('worstep', bag.rampStep, 26);
    }
    return h + row(inner);
  }

  function panelView(ent) {
    const w = ent.w, bag = bagFor(ent);
    const running = active?.openId === ent.id;
    let h = `<button id="woback-${p.id}" class="mono" style="min-height:calc(28px*var(--ui));align-self:flex-start;background:transparent;border:none;color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));padding:0;cursor:pointer">‹ all workouts</button>`;
    h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(12px*var(--ui));font-weight:800">${ent.icon} ${esc(ent.name.toUpperCase())}</div>`;
    if (w.blurb) h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(9.5px*var(--ui));line-height:1.5">${esc(w.blurb)}</div>`;
    h += optionRows(w, bag);
    h += rampRow(bag);
    h += `<div style="height:1px;background:var(--rk-edge-soft);margin:3px 0"></div>`;
    h += sharedControls();
    h += `<button id="wostart-${p.id}" class="mono" style="min-height:calc(28px*var(--ui));background:var(--rk-soft2);border:1px solid var(--rk-line);border-radius:7px;color:var(--rk-accent);font-size:calc(11px*var(--ui));font-weight:800;padding:9px;cursor:pointer;letter-spacing:1px">${running ? '↻ RESTART' : '▶ START'} ${esc(ent.name.toUpperCase())}</button>`;
    // save / manage
    if (ent.custom) {
      h += `<div style="display:flex;gap:4px">${chip('wo-del', `data-id="${ent.id}"`, '🗑 Delete this workout', false, DANGER)}</div>`;
      h += `<div class="mono" style="color:color-mix(in srgb, var(--rk-ink-mute) 72%, transparent);font-size:calc(8px*var(--ui));text-align:center">edits to a saved workout are kept as you make them</div>`;
    } else {
      h += `<div style="display:flex;gap:4px;align-items:center">
        <input id="woname-${p.id}" placeholder="Name this setup…" style="flex:1;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:5px 7px;outline:none"/>
        ${chip('wo-save', '', '💾 Save', false, 'padding:6px 9px')}</div>`;
      h += `<div class="mono" style="color:color-mix(in srgb, var(--rk-ink-mute) 72%, transparent);font-size:calc(8px*var(--ui));text-align:center">saving pins these exact options to 🔧 MY WORKOUTS</div>`;
    }
    return h;
  }

  function gridView() {
    let h = sharedControls();
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin-top:2px">WORKOUTS · tap to set up</div>`;
    h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">` + WORKOUTS.map(w => {
      const bag = bagOf(w, s.opt[w.id]);
      return card({ id: w.id, icon: w.icon, name: w.name, sub: w.summary(bag) });
    }).join('') + `</div>`;

    // The tier chip is the kit's own badge, not a yellow of ours — the finish channel says
    // "this is a pro feature" in white light everywhere in the app, and a gold pill here
    // would read as a seventh pedal family.
    h += `<div style="display:flex;align-items:center;gap:6px;margin-top:2px"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px">🔧 MY WORKOUTS</span><span class="tier-badge mono">PRO</span><button id="wonew-${p.id}" class="mono" style="min-height:calc(28px*var(--ui));margin-left:auto;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));padding:3px 8px;cursor:pointer">${s.building ? '✕ Close' : '＋ New'}</button></div>`;
    if (s.building) {
      h += `<div style="background:var(--rk-panel);border:1px dashed var(--rk-edge-soft);border-radius:8px;padding:8px">
        <div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.6">Open any workout above, set the key / scale / position you want, then press <b style="color:var(--rk-dim)">💾 Save</b> in that panel. It becomes a one-tap card down here — with its own tempo ramp if you set one.</div></div>`;
    }
    if (customs.length) {
      h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">` + customs.map(c => card({ id: c.id, icon: c.icon || '🔧', name: c.name, sub: c.sub || '', retired: c.retired })).join('') + `</div>`;
      h += `<div class="mono" style="color:color-mix(in srgb, var(--rk-ink-mute) 72%, transparent);font-size:calc(8px*var(--ui));text-align:center">tap to open · right-click to delete</div>`;
    }
    return h;
  }

  // A retired custom gets a page of its own rather than a dead card: what it was, why it
  // stopped working, and the two honest choices.
  function retiredView(c) {
    let h = `<button id="woback-${p.id}" class="mono" style="min-height:calc(28px*var(--ui));align-self:flex-start;background:transparent;border:none;color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));padding:0;cursor:pointer">‹ all workouts</button>`;
    h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(12px*var(--ui));font-weight:800">⚠ ${esc(c.name)}</div>`;
    h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.6">This saved workout ran <b>${esc(c.retiredFrom || 'a workout')}</b>, which is no longer part of the pedal. Nothing was deleted — it just has no engine to run on any more. Convert it to a 🎼 Scales run in the same key, or remove it.</div>`;
    h += `<div style="display:flex;gap:4px">${chip('wo-convert', `data-id="${c.id}"`, '🎼 Convert to Scales', false, 'flex:1')}${chip('wo-del', `data-id="${c.id}"`, '🗑 Remove', false, DANGER)}</div>`;
    return h;
  }

  function render() {
    clearSeedCache();                        // one seed lookup per repaint, never one per card
    const ent = openEntry();
    if (s.open && !ent) s.open = null;       // a custom was deleted out from under us
    // class="rk" is the whole point: the card publishes this pedal's accent and the kit
    // derives ink, panels, edges and washes from it, so every control below inherits one
    // colour instead of naming its own. The 7px gap is this pedal's, not the kit's default.
    let h = `<div class="rk" style="gap:7px">`;

    if (notice) h += `<div class="mono" style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:7px;padding:7px 9px;color:var(--rk-ink);font-size:calc(9.5px*var(--ui));line-height:1.5">${esc(notice)} <button id="wonot-${p.id}" style="min-height:calc(28px*var(--ui));background:none;border:none;color:var(--rk-ink-dim);cursor:pointer;font-size:calc(10px*var(--ui))">✕</button></div>`;
    // the running block lives above BOTH views, so leaving a panel never hides the workout
    if (active) h += `<div id="wost-${p.id}" style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:8px;padding:9px 11px;min-height:74px"></div>`;
    h += stripBlock();                       // under the status block, and it outlives the run
    // The one colour in this file that is NOT the pedal's: --rk-stop is the app's shared
    // "this halts something" signal, so it must look the same in every pedal rather than
    // take on each one's accent. It was three hand-mixed reds until now, which is exactly
    // how a signal that has to be recognised without reading it drifts apart pedal by pedal.
    if (active) h += `<button id="wostop-${p.id}" class="mono" style="min-height:calc(28px*var(--ui));background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);border-radius:6px;color:var(--rk-stop);font-size:calc(10px*var(--ui));font-weight:700;padding:7px;cursor:pointer">⏹ STOP WORKOUT</button>`;

    h += ent ? (ent.w ? panelView(ent) : retiredView(ent.custom)) : gridView();
    h += `</div>`;
    el.innerHTML = h;
    wire();
    wireStrip();
    wireMasterTempo(TID, {
      // Follow the master clock LIVE. `mirror` also fires once on wire, so bail when nothing
      // actually moved — otherwise every re-render would restart the running plan.
      mirror: v => {
        if (!active || active.ramp || active.bpm === v) return;
        active.bpm = v;
        if (active.engine === 'flash') restartFlashTimer();
        else if (s.adv !== 'listen') { active.planStop?.(); active.planStop = null; startRunCycle(active.boxIdx || 0); }
        refreshStatus();
      },
    });
    refreshStatus();
  }

  function wire() {
    el.querySelectorAll('.wo-card').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); s.open = b.dataset.open; notice = null; render(); });
      b.addEventListener('contextmenu', e => {
        const id = b.dataset.open;
        if (!customs.some(c => c.id === id)) return;
        e.preventDefault(); e.stopPropagation();
        customs = customs.filter(c => c.id !== id);
        saveCustoms(customs); if (s.open === id) s.open = null; render();
      });
    });
    document.getElementById(`wonot-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); notice = null; render(); });
    document.getElementById(`woback-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); s.open = null; render(); });
    document.getElementById(`wostop-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); stopWorkout(); });
    document.getElementById(`wostart-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); startWorkout(s.open); });
    document.getElementById(`wonew-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); s.building = !s.building; render(); });

    el.querySelectorAll('.wo-bars').forEach(b => b.addEventListener('click', () => {
      s.bars = +b.dataset.b;
      if (active?.engine === 'flash') { strip = flashStrip(); }
      render();
    }));
    el.querySelectorAll('.wo-adv').forEach(b => b.addEventListener('click', async () => {
      s.adv = b.dataset.v;
      if (s.adv === 'listen' && !audio.connected) { try { await audio.connect(); } catch (e) { /* declined — the status card still explains */ } }
      if (active) { const id = active.openId; stopWorkout(); startWorkout(id); }   // restart in the new mode
      else render();
    }));

    // ── the one option handler ──
    const ent = openEntry();
    if (ent?.w) {
      el.querySelectorAll('.wo-opt').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const k = b.dataset.k, v = b.dataset.v;
        if (k === 'scale') { const [cat, nm] = v.split('|'); ent.raw.scaleCat = cat; ent.raw.scaleName = nm; }
        else if (b.dataset.multi) {
          const cur = [...(bagFor(ent)[k] || [])];
          const at = cur.indexOf(v);
          if (at >= 0) cur.splice(at, 1); else cur.push(v);
          ent.raw[k] = cur.length ? cur : [v];          // never let the last quality be switched off
        } else ent.raw[k] = v;
        commit(ent); applyLiveChange(ent); render();
      }));
      el.querySelector('.wo-ramp')?.addEventListener('click', e => {
        e.stopPropagation();
        ent.raw.rampOn = !bagFor(ent).rampOn;
        commit(ent); render();
      });
      [['worfrom', 'rampFrom', 30, 280], ['worto', 'rampTo', 30, 280], ['worstep', 'rampStep', 1, 40]].forEach(([id, key, lo, hi]) =>
        document.getElementById(`${id}-${p.id}`)?.addEventListener('change', e2 => {
          const v = parseInt(e2.target.value, 10);
          if (!isNaN(v)) { ent.raw[key] = Math.max(lo, Math.min(hi, v)); commit(ent); }
        }));
      el.querySelector('.wo-save')?.addEventListener('click', e => {
        e.stopPropagation();
        const bag = bagFor(ent);
        const nameEl = document.getElementById(`woname-${p.id}`);
        const c = {
          id: 'wo' + Date.now(), v: 2, workout: ent.w.id, icon: ent.w.icon,
          name: (nameEl?.value || '').trim() || `${ent.w.name} · ${ent.w.summary(bag)}`,
          sub: ent.w.summary(bag), cfg: { ...bag },
        };
        customs.push(c); saveCustoms(customs);
        s.open = c.id; render();
      });
    }
    el.querySelectorAll('.wo-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.id;
      if (active?.openId === id) stopWorkout();
      customs = customs.filter(c => c.id !== id);
      saveCustoms(customs); s.open = null; render();
    }));
    el.querySelectorAll('.wo-convert').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const c = customs.find(x => x.id === b.dataset.id);
      if (!c) return;
      c.workout = 'scales'; c.retired = false; c.icon = '🎼';
      c.cfg = { ...bagOf(WORKOUT_OF('scales'), c.cfg) };
      c.sub = WORKOUT_OF('scales').summary(c.cfg);
      saveCustoms(customs); notice = `“${c.name}” now runs as a 🎼 Scales workout.`; render();
    }));
  }

  render();
}
