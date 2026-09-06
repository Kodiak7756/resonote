// ─── Rhythm Game ─────────────────────────────────────────────────────
// Rhythm reading is the part of notation that guitarists skip, because TAB
// tells you where and never when. Reading a dotted quarter is not knowing it
// is "one and a half beats" — it is your hand landing on the & of two without
// counting. That only becomes physical when the eye, the ear and the hand are
// all asked for the same instant, and then TOLD how far apart they were.
//
// So: real notation scrolls toward a hit line, the click and the figure sound
// on the audio clock, and every tap is measured against the nearest written
// onset in milliseconds. Timing stops being a feeling and becomes a number you
// can watch shrink — and the mean offset tells you which way you lean.
//
// The lane is proportional notation: a beat is always the same number of
// pixels, whatever is written in it. Engraved music spaces by eye; a scrolling
// hit line has to space by time, or the notes would arrive at the wrong speed.
import { metroClock } from '../core/state.js';
import { createPulse, clickSound, audioCtx } from '../core/pulse.js';
import { bus } from '../core/mixer.js';
import { audio } from '../core/audio.js';
import { read, write, KEYS } from '../core/store.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';

// Best accuracy per pattern — registered in store.js like every other key;
// re-exported so the judging tests can read the same store the pedal writes.
export const BEST_KEY = KEYS.rhythmBest;

// ── the judging windows ──────────────────────────────────────────────
// 40 ms is roughly where two sounds fuse into one for the ear; 90 ms is what a
// listener hears as "together" in a band; 150 ms is unmistakably off but still
// the same note. Past that, the tap belongs to nothing.
export const WINDOWS_MS = { perfect: 40, good: 90, late: 150 };

// The one "now" colour of the app — the step strip's gold chip, the neck's gold
// chord dot — so the note under the hit line reads as the same idea everywhere.
const NOW_GOLD = '#ffce6a';

// ── the patterns ─────────────────────────────────────────────────────
// dur is in QUARTER-NOTE beats whatever the time signature (1 = ♩, .5 = ♪,
// .25 = ♬, 1.5 = ♩., triplet eighth = 1/3). `tie` ties INTO the next cell, so
// that cell is drawn but has no onset. `count` is what a teacher would say
// out loud — brackets mark a beat you count but don't play.
const T = 1 / 3;
export const LEVELS = [
  'Quarters', 'Quarters & rests', 'Eighths', 'Dots & ties',
  'Sixteenths', 'Triplets', 'Syncopation', '3/4 & 6/8',
];
const N = (dur, extra) => ({ dur, ...(extra || {}) });
const R = dur => ({ dur, rest: true });
export const PATTERNS = [
  // L1 — the beat itself
  { id: 'four-floor',  level: 0, name: 'Four on the floor', tsig: [4, 4], bpmHint: 90,  count: '1 2 3 4',
    cells: [N(1), N(1), N(1), N(1)] },
  { id: 'half-qq',     level: 0, name: 'Half, two quarters', tsig: [4, 4], bpmHint: 90,  count: '1 (2) 3 4',
    cells: [N(2), N(1), N(1)] },
  { id: 'whole-half',  level: 0, name: 'Whole note, then halves', tsig: [4, 4], bpmHint: 90, count: '1 (2 3 4) | 1 (2) 3 (4)',
    cells: [N(4), N(2), N(2)] },
  // L2 — a rest is a note you don't play
  { id: 'rest-on-2',   level: 1, name: 'Rest on two', tsig: [4, 4], bpmHint: 90,  count: '1 (2) 3 4',
    cells: [N(1), R(1), N(1), N(1)] },
  { id: 'backbeat',    level: 1, name: 'Backbeat (2 and 4)', tsig: [4, 4], bpmHint: 96, count: '(1) 2 (3) 4',
    cells: [R(1), N(1), R(1), N(1)] },
  { id: 'rest-on-4',   level: 1, name: 'Rest on four', tsig: [4, 4], bpmHint: 90,  count: '1 2 3 (4)',
    cells: [N(1), N(1), N(1), R(1)] },
  // L3 — eighths
  { id: 'eighths',     level: 2, name: 'Straight eighths', tsig: [4, 4], bpmHint: 80, count: '1 & 2 & 3 & 4 &',
    cells: [N(.5), N(.5), N(.5), N(.5), N(.5), N(.5), N(.5), N(.5)] },
  { id: 'q-ee',        level: 2, name: 'Quarter, two eighths', tsig: [4, 4], bpmHint: 84, count: '1 2 & 3 4 &',
    cells: [N(1), N(.5), N(.5), N(1), N(.5), N(.5)] },
  { id: 'ee-q',        level: 2, name: 'Two eighths, quarter', tsig: [4, 4], bpmHint: 84, count: '1 & 2 3 & 4',
    cells: [N(.5), N(.5), N(1), N(.5), N(.5), N(1)] },
  // L4 — dots and ties: the same sound written two ways
  { id: 'dotted-q',    level: 3, name: 'Dotted quarter, eighth', tsig: [4, 4], bpmHint: 80, count: '1 (2) & 3 (4) &',
    cells: [N(1.5), N(.5), N(1.5), N(.5)] },
  { id: 'charleston',  level: 3, name: 'Charleston', tsig: [4, 4], bpmHint: 96, count: '1 (2) & (3 4)',
    cells: [N(1.5), N(.5, { tie: true }), N(2)] },
  { id: 'tie-over',    level: 3, name: 'Tied over the bar line', tsig: [4, 4], bpmHint: 84, count: '1 2 3 4 | (1) 2 3 4',
    cells: [N(1), N(1), N(1), N(1, { tie: true }), N(1), N(1), N(1), N(1)] },
  // L5 — sixteenths
  { id: 'sixteenths',  level: 4, name: 'Sixteenths on 1 and 3', tsig: [4, 4], bpmHint: 72, count: '1 e & a 2 3 e & a 4',
    cells: [N(.25), N(.25), N(.25), N(.25), N(1), N(.25), N(.25), N(.25), N(.25), N(1)] },
  { id: 'gallop',      level: 4, name: 'Gallop', tsig: [4, 4], bpmHint: 76, count: '1 & a 2 & a 3 & a 4 & a',
    cells: [N(.5), N(.25), N(.25), N(.5), N(.25), N(.25), N(.5), N(.25), N(.25), N(.5), N(.25), N(.25)] },
  { id: 'rev-gallop',  level: 4, name: 'Reverse gallop', tsig: [4, 4], bpmHint: 76, count: '1 e & 2 e & 3 e & 4 e &',
    cells: [N(.25), N(.25), N(.5), N(.25), N(.25), N(.5), N(.25), N(.25), N(.5), N(.25), N(.25), N(.5)] },
  { id: 'dotted-8th',  level: 4, name: 'Dotted eighth, sixteenth', tsig: [4, 4], bpmHint: 72, count: '1 a 2 a 3 a 4 a',
    cells: [N(.75), N(.25), N(.75), N(.25), N(.75), N(.25), N(.75), N(.25)] },
  { id: 'funk-cell',   level: 4, name: 'Sixteenth, eighth, sixteenth', tsig: [4, 4], bpmHint: 72, count: '1 e a 2 3 e a 4',
    cells: [N(.25), N(.5), N(.25), N(1), N(.25), N(.5), N(.25), N(1)] },
  // L6 — triplets
  { id: 'triplets',    level: 5, name: 'Eighth-note triplets', tsig: [4, 4], bpmHint: 76, count: '1 trip let 2 3 trip let 4',
    cells: [N(T), N(T), N(T), N(1), N(T), N(T), N(T), N(1)] },
  { id: 'shuffle',     level: 5, name: 'Shuffle', tsig: [4, 4], bpmHint: 84, count: '1 (trip) let 2 (trip) let …',
    cells: [N(2 * T), N(T), N(2 * T), N(T), N(2 * T), N(T), N(2 * T), N(T)] },
  { id: 'trip-hole',   level: 5, name: 'Triplet with a hole', tsig: [4, 4], bpmHint: 76, count: '1 (trip) let 2 3 (trip) let 4',
    cells: [N(T), R(T), N(T), N(1), N(T), R(T), N(T), N(1)] },
  // L7 — syncopation: the accent moves off the beat
  { id: 'and-of-two',  level: 6, name: 'And-of-two', tsig: [4, 4], bpmHint: 90, count: '1 (2) & 3 4',
    cells: [N(1), R(.5), N(.5), N(1), N(1)] },
  { id: 'off-beats',   level: 6, name: 'Off-beat eighths (the ands)', tsig: [4, 4], bpmHint: 84, count: '(1) & (2) & (3) & (4) &',
    cells: [R(.5), N(.5), R(.5), N(.5), R(.5), N(.5), R(.5), N(.5)] },
  { id: 'tresillo',    level: 6, name: 'Tresillo (3 + 3 + 2)', tsig: [4, 4], bpmHint: 96, count: '1 (2) & (3) 4',
    cells: [N(1.5), N(1.5), N(1)] },
  { id: 'son-clave',   level: 6, name: 'Son clave (3–2)', tsig: [4, 4], bpmHint: 96, count: '1 (2) & (3) 4 | (1) 2 3 (4)',
    cells: [N(1.5), N(1.5), N(1, { tie: true }), N(1), N(1), N(1), R(1)] },
  // L8 — three and six
  { id: 'waltz',       level: 7, name: 'Waltz', tsig: [3, 4], bpmHint: 100, count: '1 2 3',
    cells: [N(1), N(1), N(1)] },
  { id: 'waltz-8ths',  level: 7, name: 'Waltz with eighths', tsig: [3, 4], bpmHint: 96, count: '1 2 & 3',
    cells: [N(1), N(.5), N(.5), N(1)] },
  { id: 'jig',         level: 7, name: '6/8 jig', tsig: [6, 8], bpmHint: 180, count: '1 2 3 4 5 6',
    cells: [N(.5), N(.5), N(.5), N(.5), N(.5), N(.5)] },
  { id: 'six-pulse',   level: 7, name: '6/8 dotted-quarter pulse', tsig: [6, 8], bpmHint: 168, count: '1 (2 3) 4 (5 6)',
    cells: [N(1.5), N(1.5)] },
  { id: 'humpty',      level: 7, name: '6/8 quarter–eighth', tsig: [6, 8], bpmHint: 168, count: '1 (2) 3 4 (5) 6',
    cells: [N(1), N(.5), N(1), N(.5)] },
];

// ── notation maths ───────────────────────────────────────────────────
const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < EPS;
const isTriplet = d => !near(d * 4, Math.round(d * 4)) && near(d * 3, Math.round(d * 3));

// What a duration LOOKS like. Flags is also the beam count.
const SHAPES = [
  [4,     { hollow: true,  stem: false, flags: 0, dots: 0 }],
  [3,     { hollow: true,  stem: true,  flags: 0, dots: 1 }],
  [2,     { hollow: true,  stem: true,  flags: 0, dots: 0 }],
  [1.5,   { hollow: false, stem: true,  flags: 0, dots: 1 }],
  [1,     { hollow: false, stem: true,  flags: 0, dots: 0 }],
  [.75,   { hollow: false, stem: true,  flags: 1, dots: 1 }],
  [.5,    { hollow: false, stem: true,  flags: 1, dots: 0 }],
  [.375,  { hollow: false, stem: true,  flags: 2, dots: 1 }],
  [.25,   { hollow: false, stem: true,  flags: 2, dots: 0 }],
  [2 * T, { hollow: false, stem: true,  flags: 0, dots: 0, triplet: true }],
  [T,     { hollow: false, stem: true,  flags: 1, dots: 0, triplet: true }],
  [T / 2, { hollow: false, stem: true,  flags: 2, dots: 0, triplet: true }],
];
export function noteShape(dur) {
  const hit = SHAPES.find(([d]) => near(d, dur));
  return hit ? hit[1] : { hollow: false, stem: true, flags: 0, dots: 0 };
}

// A pattern → everything the lane and the scheduler need, in beats.
//   beatUnit   the pulse you beam within and click on (♩ in x/4, ♩. in 6/8)
//   countUnit  the numbers under the line (♩ in x/4, ♪ in 6/8 — "1 2 3 4 5 6")
//   subdiv     pulse ticks per ♩: 4 puts sixteenths on ticks, 12 puts triplets
//              AND sixteenths on ticks, so every onset is sample-accurate
export function layoutPattern(pat) {
  const [num, den] = pat.tsig;
  const barBeats  = num * 4 / den;
  const beatUnit  = den === 8 ? 1.5 : 1;
  const countUnit = den === 8 ? .5 : 1;
  let pos = 0;
  const cells = pat.cells.map((c, i) => {
    const prev = pat.cells[i - 1];
    const tiedIn = !!(prev && prev.tie && !prev.rest && !c.rest);
    const cell = { i, onset: pos, dur: c.dur, rest: !!c.rest, tie: !!c.tie && !c.rest, tiedIn,
                   hasOnset: !c.rest && !tiedIn, shape: noteShape(c.dur),
                   beat: Math.floor(pos / beatUnit + EPS) };
    pos += c.dur;
    return cell;
  });
  const loopBeats = pos;
  const bars = Math.round(loopBeats / barBeats);
  const onsets = cells.filter(c => c.hasOnset).map(c => c.onset);
  const hasTriplets = cells.some(c => isTriplet(c.dur));
  const subdiv = hasTriplets ? 12 : 4;

  // Beams join flagged notes that share a beat — the beam IS the beat made
  // visible, which is why a group never crosses one. A rest breaks the group.
  const beams = [];
  let run = [];
  const flush = () => { if (run.length > 1) beams.push(run); run = []; };
  cells.forEach(c => {
    const beamable = !c.rest && c.shape.flags > 0;
    if (!beamable || (run.length && run[0].beat !== c.beat)) flush();
    if (beamable) run.push(c);
  });
  flush();

  // Triplet brackets: consecutive triplet cells inside one beat get one "3".
  const triplets = [];
  run = [];
  const flushT = () => { if (run.length) triplets.push(run); run = []; };
  cells.forEach(c => {
    const t = isTriplet(c.dur);
    if (!t || (run.length && run[0].beat !== c.beat)) flushT();
    if (t) run.push(c);
  });
  flushT();

  return { barBeats, beatUnit, countUnit, loopBeats, bars, cells, onsets, subdiv, beams, triplets, hasTriplets };
}

// ── judging ──────────────────────────────────────────────────────────
// Signed delta in ms (tap − onset): positive is late. null = not this onset.
export function judgeDelta(ms) {
  const a = Math.abs(ms);
  if (a <= WINDOWS_MS.perfect) return 'perfect';
  if (a <= WINDOWS_MS.good)    return 'good';
  if (a <= WINDOWS_MS.late)    return ms < 0 ? 'early' : 'late';
  return null;
}

// The nearest UNJUDGED onset inside the outer window, or null (an EXTRA).
// Nearest, not first: a late tap for beat 2 must not steal beat 3.
export function matchTap(tapTime, expected, windowS = WINDOWS_MS.late / 1000) {
  let best = null, bestD = Infinity;
  for (const e of expected) {
    if (e.judged) continue;
    const d = Math.abs(tapTime - e.time);
    if (d <= windowS && d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// Weighted, so a run of near-misses scores above a run of misses even though
// neither is "a hit" — the number has to move while you are still bad at it.
const SCORE = { perfect: 1, good: .7, early: .3, late: .3, miss: 0 };
export function summarize(log, extras = 0) {
  const counts = { perfect: 0, good: 0, early: 0, late: 0, miss: 0 };
  let score = 0, sum = 0, n = 0, streak = 0, best = 0;
  log.forEach(e => {
    counts[e.j] = (counts[e.j] || 0) + 1;
    score += SCORE[e.j] || 0;
    if (e.j !== 'miss') { sum += e.ms; n++; }
    if (e.j === 'perfect' || e.j === 'good') { streak++; best = Math.max(best, streak); } else streak = 0;
  });
  return {
    counts, extras, total: log.length,
    accuracy: log.length ? Math.round(100 * score / log.length) : 0,
    bestStreak: best,
    meanMs: n ? Math.round(sum / n) : 0,
    matched: n,
  };
}

// ── the pedal ────────────────────────────────────────────────────────
const JCOL = {
  perfect: 'var(--rk-ok)', good: 'var(--rk-accent)', early: 'var(--rk-hot)',
  late: 'var(--rk-hot)', miss: 'var(--rk-bad)', extra: 'var(--rk-ink-mute)',
};
const JWORD = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', miss: 'MISS', extra: 'EXTRA' };

// The mic reports level on a ~66 ms throttle, so an onset is seen up to one
// emission after it happened. Pulling every mic tap back by roughly half of
// that keeps the bias off the mean-offset number, which is the number the game
// is FOR. The remaining spread is real and belongs to the player.
const MIC_LAG_S = 0.035;
const MIC_JUMP_DB = 12;
const MIC_REFRACTORY_MS = 120;

// The woodblock: a triangle at ~1.2 kHz that drops a fifth in 30 ms and is gone
// in 80. Nothing like the click's sine, on purpose — you have to be able to
// tell "the figure" from "the beat" with your eyes shut.
function woodblock(ctx, time, dest, accent) {
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1200, time);
    o.frequency.exponentialRampToValueAtTime(800, time + 0.03);
    g.gain.setValueAtTime(accent ? .7 : .45, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    o.connect(g); g.connect(dest);
    o.start(time); o.stop(time + 0.09);
  } catch (e) { /* no audio device — the lane still scrolls */ }
}

const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function buildRhythmGameContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  const alive = () => !!document.getElementById(`body-${p.id}`);

  // A rebuild re-enters here with fresh closures; whatever the last build left
  // running would keep clicking with no button that can reach it.
  if (p._rgStop) { try { p._rgStop(); } catch (e) {} }
  metroClock.unregisterTransport(p.id);

  if (!PATTERNS.some(x => x.id === s.pat)) s.pat = PATTERNS[0].id;
  if (s.patAudible === undefined)   s.patAudible = true;
  if (s.clickAudible === undefined) s.clickAudible = true;
  if (s.mic === undefined)          s.mic = false;

  const pattern = () => PATTERNS.find(x => x.id === s.pat) || PATTERNS[0];

  // ── run state ────────────────────────────────────────────────────
  let running = false, lay = null, pulse = null, ac = null, patGain = null;
  let ref = { beat: 0, time: 0 };            // latest scheduled tick, pattern beats ↔ audio clock
  let expected = [];                         // scheduled onsets awaiting a tap
  let log = [], extras = 0, streak = 0, bestStreak = 0, loopsDone = 0;
  let taps = [];                             // marks on the lane, in pattern beats
  let raf = 0, keyHandler = null, flashTimer = null, results = null;
  let countLabel = '';                       // "1", "2"… during the count-in
  const groups = new Map();                  // loop index → <g>

  const secPerBeat = () => 60 / (pulse ? pulse.bpm : metroClock.bpm);
  const beatAt = time => ref.beat + (time - ref.time) / secPerBeat();
  const q = sel => el.querySelector(sel);

  // ── lane geometry ────────────────────────────────────────────────
  // Everything on the lane scales with the density slider so the notation
  // stays readable at every --ui, and the hit line stays 30 % in.
  const geo = () => {
    const u = uiScale();
    const lane = q('.rg-lane');
    const W = lane ? Math.max(200, lane.clientWidth) : 330;
    return { u, W, H: 128 * u, hitX: W * .3, ppb: 64 * u, lineY: 62 * u, stem: 30 * u, rx: 5.2 * u, ry: 3.8 * u };
  };

  // ── drawing one loop of the pattern ──────────────────────────────
  // x is in px from the loop's own origin; the loop <g> is translated so its
  // origin sits at hitX + (loopStart − nowBeat) · ppb every frame.
  function drawLoop(loopIdx, g) {
    const { u, ppb, lineY, stem, rx, ry, H } = g;
    const L = lay, out = [];
    const px = b => b * ppb;
    // beat grid + bar lines + numbers, behind the notes
    for (let b = 0; b <= L.loopBeats + EPS; b += L.countUnit) {
      const isBar = near(b % L.barBeats, 0) || near(b % L.barBeats, L.barBeats);
      const x = px(b);
      if (isBar) out.push(`<line x1="${x}" y1="${lineY - 40 * u}" x2="${x}" y2="${lineY + 30 * u}" stroke="var(--rk-line)" stroke-width="${isBar && (near(b, 0) || near(b, L.loopBeats)) ? 2 : 1.2}"/>`);
      else out.push(`<line x1="${x}" y1="${lineY - 26 * u}" x2="${x}" y2="${lineY + 18 * u}" stroke="var(--rk-edge-soft)" stroke-width="1"/>`);
      if (b < L.loopBeats - EPS) {
        const n = Math.round(((b % L.barBeats) / L.countUnit)) + 1;
        out.push(`<text x="${x}" y="${H - 8 * u}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="${9 * u}" fill="var(--rk-ink-mute)">${n}</text>`);
      }
    }
    // the staff line itself
    out.push(`<line x1="0" y1="${lineY}" x2="${px(L.loopBeats)}" y2="${lineY}" stroke="var(--rk-ink-dim)" stroke-width="${1.2 * u}"/>`);

    const beamed = new Set(); L.beams.forEach(b => b.forEach(c => beamed.add(c.i)));
    const top = lineY - stem;
    L.cells.forEach(c => {
      const x = px(c.onset), sh = c.shape;
      const onsetIdx = c.hasOnset ? L.onsets.indexOf(c.onset) : -1;
      let body = '';
      if (c.rest) body = restGlyph(c.dur, x, g);
      else {
        // head: a slightly tilted ellipse, filled or hollow by duration
        body += `<ellipse cx="${x}" cy="${lineY}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${x} ${lineY})" fill="${sh.hollow ? 'none' : 'currentColor'}" stroke="currentColor" stroke-width="${sh.hollow ? 1.6 * u : 0}"/>`;
        if (sh.stem) body += `<line x1="${x + rx - .5 * u}" y1="${lineY}" x2="${x + rx - .5 * u}" y2="${top}" stroke="currentColor" stroke-width="${1.4 * u}"/>`;
        for (let d = 0; d < sh.dots; d++) body += `<circle cx="${x + rx + 4 * u + d * 4 * u}" cy="${lineY - 3 * u}" r="${1.5 * u}" fill="currentColor"/>`;
        if (sh.flags && !beamed.has(c.i)) {
          for (let f = 0; f < sh.flags; f++) {
            const y0 = top + f * 6 * u, sx = x + rx - .5 * u;
            body += `<path d="M${sx},${y0} C${sx + 2 * u},${y0 + 6 * u} ${sx + 9 * u},${y0 + 7 * u} ${sx + 7 * u},${y0 + 16 * u} C${sx + 8 * u},${y0 + 9 * u} ${sx + 3 * u},${y0 + 8 * u} ${sx},${y0 + 5 * u} Z" fill="currentColor"/>`;
          }
        }
        if (c.tiedIn) {
          const prev = L.cells[c.i - 1], x1 = px(prev.onset) + rx, x2 = x - rx, y = lineY + 6 * u;
          body += `<path d="M${x1},${y} Q${(x1 + x2) / 2},${y + 11 * u} ${x2},${y}" fill="none" stroke="currentColor" stroke-width="${1.4 * u}"/>`;
        }
      }
      out.push(`<g data-cell="${c.i}" data-onset="${onsetIdx}" style="color:var(--rk-ink)">${body}</g>`);
    });

    // beams: one bar across the group; a second, shorter one over runs of
    // sixteenths; a lone sixteenth gets a stub pointing at its neighbour.
    L.beams.forEach(grp => {
      const xs = c => px(c.onset) + rx - .5 * u;
      const x1 = xs(grp[0]), x2 = xs(grp[grp.length - 1]);
      let body = `<rect x="${x1 - .7 * u}" y="${top}" width="${x2 - x1 + 1.4 * u}" height="${3.2 * u}" fill="currentColor"/>`;
      let i = 0;
      while (i < grp.length) {
        if (grp[i].shape.flags < 2) { i++; continue; }
        let j = i; while (j + 1 < grp.length && grp[j + 1].shape.flags >= 2) j++;
        if (j > i) body += `<rect x="${xs(grp[i]) - .7 * u}" y="${top + 5.5 * u}" width="${xs(grp[j]) - xs(grp[i]) + 1.4 * u}" height="${3.2 * u}" fill="currentColor"/>`;
        else {
          const stub = 8 * u, sx = xs(grp[i]);
          const left = i > 0;   // point at the note it subdivides with
          body += `<rect x="${left ? sx - stub : sx - .7 * u}" y="${top + 5.5 * u}" width="${stub + .7 * u}" height="${3.2 * u}" fill="currentColor"/>`;
        }
        i = j + 1;
      }
      out.push(`<g data-beam="${grp[0].i}" style="color:var(--rk-ink)">${body}</g>`);
    });
    L.triplets.forEach(grp => {
      const x1 = px(grp[0].onset), x2 = px(grp[grp.length - 1].onset) + rx;
      out.push(`<text x="${(x1 + x2) / 2}" y="${top - 5 * u}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-style="italic" font-size="${9 * u}" fill="var(--rk-ink-dim)">3</text>`);
    });
    const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gEl.dataset.loop = loopIdx;
    gEl.innerHTML = out.join('');
    return gEl;
  }

  // Rests as plain shapes on a one-line staff: a whole hangs, a half sits, a
  // quarter zigzags, an eighth is a hook with a dot, a sixteenth two dots.
  function restGlyph(dur, x, g) {
    const { u, lineY } = g;
    const dot = near(dur, 1.5) || near(dur, 3) || near(dur, .75)
      ? `<circle cx="${x + 9 * u}" cy="${lineY - 3 * u}" r="${1.5 * u}" fill="currentColor"/>` : '';
    if (dur >= 4 - EPS) return `<rect x="${x - 6 * u}" y="${lineY}" width="${12 * u}" height="${4 * u}" fill="currentColor"/>`;
    if (dur >= 2 - EPS) return `<rect x="${x - 6 * u}" y="${lineY - 4 * u}" width="${12 * u}" height="${4 * u}" fill="currentColor"/>` + dot;
    if (dur >= 1 - EPS) return `<path d="M${x - 3 * u},${lineY - 14 * u} l${6 * u},${7 * u} l${-5 * u},${6 * u} l${5 * u},${7 * u} q${-6 * u},${-3 * u} ${-4 * u},${4 * u}" fill="none" stroke="currentColor" stroke-width="${2 * u}" stroke-linejoin="round"/>` + dot;
    const hook = (y0) => `<circle cx="${x - 3 * u}" cy="${y0}" r="${1.8 * u}" fill="currentColor"/><path d="M${x - 2 * u},${y0 + 1.5 * u} q${3 * u},${2 * u} ${6 * u},${-2 * u}" fill="none" stroke="currentColor" stroke-width="${1.4 * u}"/>`;
    const tail = `<line x1="${x + 4 * u}" y1="${lineY - 8 * u}" x2="${x - 1 * u}" y2="${lineY + 8 * u}" stroke="currentColor" stroke-width="${1.4 * u}"/>`;
    if (dur >= .5 - EPS) return hook(lineY - 7 * u) + tail + dot;
    return hook(lineY - 9 * u) + hook(lineY - 3 * u) + tail;   // sixteenth (or a triplet eighth's rest)
  }

  // ── the frame loop ───────────────────────────────────────────────
  // The notation moves on requestAnimationFrame but its POSITION comes from
  // the audio clock, so what you see under the hit line is what you hear.
  function frame() {
    if (!running) return;
    if (!alive()) { stop(); return; }
    raf = requestAnimationFrame(frame);
    const svg = q('.rg-svg'); if (!svg) return;
    const g = geo();
    const now = ac.currentTime, nowBeat = beatAt(now);
    const L = lay;
    const firstVisible = Math.floor((nowBeat - g.hitX / g.ppb) / L.loopBeats);
    const lastVisible  = Math.floor((nowBeat + (g.W - g.hitX) / g.ppb) / L.loopBeats) + 1;
    const layer = svg.querySelector('.rg-loops');
    for (const [k, node] of groups) if (k < firstVisible || k > lastVisible) { node.remove(); groups.delete(k); }
    for (let k = Math.max(0, firstVisible); k <= lastVisible; k++) {
      let node = groups.get(k);
      if (!node) { node = drawLoop(k, g); layer.appendChild(node); groups.set(k, node); }
      node.setAttribute('transform', `translate(${g.hitX + (k * L.loopBeats - nowBeat) * g.ppb},0)`);
      // upcoming plain · the most recent onset gold · behind the line dimmed
      const loopPos = nowBeat - k * L.loopBeats;
      let nowCell = -1;
      L.cells.forEach(c => { if (c.hasOnset && c.onset <= loopPos + .02) nowCell = c.i; });
      node.querySelectorAll('g[data-cell]').forEach(cg => {
        const c = L.cells[+cg.dataset.cell];
        const past = c.onset + c.dur <= loopPos && c.i !== nowCell;
        const isNow = c.i === nowCell;
        const j = isNow || past ? judgmentOf(k, +cg.dataset.onset) : null;
        cg.style.color = isNow ? NOW_GOLD : (past && j ? JCOL[j] : 'var(--rk-ink)');
        cg.style.opacity = past ? .38 : 1;
      });
      node.querySelectorAll('g[data-beam]').forEach(bg => {
        const c = L.cells[+bg.dataset.beam];
        const past = c.onset < loopPos - .02;
        bg.style.opacity = past ? .38 : 1;
      });
    }
    // tap marks ride with the notation
    const tl = svg.querySelector('.rg-taps');
    const minBeat = nowBeat - g.hitX / g.ppb - 1;
    taps = taps.filter(t => t.beat > minBeat);
    tl.setAttribute('transform', `translate(${g.hitX - nowBeat * g.ppb},0)`);
    tl.innerHTML = taps.map(t => `<rect x="${t.beat * g.ppb - 1.5 * g.u}" y="${g.lineY + 10 * g.u}" width="${3 * g.u}" height="${8 * g.u}" rx="1" fill="${JCOL[t.j]}"/>`).join('');
    // count-in number and beat lamp
    const cl = q('.rg-count');
    if (cl) { cl.textContent = countLabel; cl.style.opacity = nowBeat < 0 ? 1 : 0; }
    // an onset nobody tapped
    for (const e of expected) {
      if (!e.judged && now > e.time + WINDOWS_MS.late / 1000) settle(e, 'miss', 0);
    }
    expected = expected.filter(e => !e.judged || now < e.time + 2);
  }

  const judgmentOf = (loop, onsetIdx) => {
    if (onsetIdx < 0) return null;
    const e = log.find(x => x.loop === loop && x.onset === onsetIdx);
    return e ? e.j : null;
  };

  // ── judging ──────────────────────────────────────────────────────
  function settle(e, j, ms) {
    e.judged = j;
    log.push({ loop: e.loop, onset: e.onset, j, ms });
    if (j === 'perfect' || j === 'good') { streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0;
    flash(j, ms);
    paintStats();
  }

  function tapIn(time) {
    if (!running) return;
    const e = matchTap(time, expected);
    if (e) {
      const ms = Math.round((time - e.time) * 1000);
      settle(e, judgeDelta(ms), ms);
      taps.push({ beat: beatAt(time), j: e.judged });
      return;
    }
    // taps during the count-in are the player finding the pulse, not errors
    if (beatAt(time) < -WINDOWS_MS.late / 1000 / secPerBeat()) return;
    extras++; streak = 0;
    taps.push({ beat: beatAt(time), j: 'extra' });
    flash('extra', null);
    paintStats();
  }

  function flash(j, ms) {
    const f = q('.rg-flash'); if (!f) return;
    const sign = ms == null ? '' : (ms > 0 ? `+${ms}` : `${ms}`);
    f.innerHTML = `<b>${JWORD[j]}</b>${ms == null || j === 'miss' ? '' : `<span> ${sign} ms</span>`}`;
    f.style.color = j === 'perfect' ? NOW_GOLD : JCOL[j];
    f.style.opacity = 1;
    f.style.transform = 'translate(-50%,0) scale(1.06)';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (f.isConnected) { f.style.opacity = 0; f.style.transform = 'translate(-50%,0) scale(1)'; } }, 420);
  }

  function paintStats() {
    const sm = summarize(log, extras);
    const set = (sel, v) => { const n = q(sel); if (n) n.textContent = v; };
    set('.rg-streak', streak);
    set('.rg-acc', `${sm.accuracy}%`);
    set('.rg-mean', sm.matched ? `${sm.meanMs > 0 ? '+' : ''}${sm.meanMs} ms` : '—');
    set('.rg-loopn', loopsDone);
  }

  // ── the mic as a drumstick ───────────────────────────────────────
  // Not pitch — ENERGY. A pick attack is a level jump of well over 12 dB in a
  // frame; a note ringing on, or the room, is not. One hook per pedal instance,
  // always calling the newest handler, so a rebuild cannot stack listeners.
  let prevDb = -Infinity, lastMicAt = 0;
  function micHandler() {
    if (!running || !s.mic || !audio.connected) { prevDb = audio.dbfs; return; }
    const db = audio.dbfs, floor = Math.max(audio.gateDb(), -55);
    const prev = Number.isFinite(prevDb) ? prevDb : -80;
    prevDb = db;
    if (!Number.isFinite(db) || db < floor || db - prev < MIC_JUMP_DB) return;
    const now = performance.now();
    if (now - lastMicAt < MIC_REFRACTORY_MS) return;
    lastMicAt = now;
    tapIn(ac.currentTime - MIC_LAG_S);
  }
  p._rgMic = micHandler;
  if (!p._rgMicHooked) { p._rgMicHooked = true; audio.on(() => p._rgMic?.()); }

  // ── transport ────────────────────────────────────────────────────
  function start() {
    if (running) return;
    metroClock.stopOthers(p.id);
    const pat = pattern();
    lay = layoutPattern(pat);
    ac = audioCtx();
    // The figure's own gain, so STOP can silence woodblocks already queued
    // inside the lookahead — the notes bus above it stays the listener's.
    patGain = ac.createGain(); patGain.gain.value = 1; patGain.connect(bus(ac, 'notes'));
    expected = []; log = []; extras = 0; streak = 0; bestStreak = 0; loopsDone = 0; taps = [];
    results = null; groups.clear(); countLabel = '';
    const S = lay.subdiv, countTicks = Math.round(lay.barBeats * S), loopTicks = Math.round(lay.loopBeats * S);
    const onsetTick = new Map(lay.onsets.map((b, i) => [Math.round(b * S), i]));
    const clickEvery = Math.round((lay.countUnit) * S);           // ♩ in x/4, ♪ in 6/8
    const barTicks = Math.round(lay.barBeats * S), beatTicks = Math.round(lay.beatUnit * S);

    // The pulse counts in quarters, but the master BPM is the COUNT unit — the
    // Metronome and Groove Lab both make one 6/8 eighth last 60/bpm, so the
    // quarter-rate has to halve in x/8 or 66 here would be 132 next door.
    pulse = createPulse({
      bpm: metroClock.bpm * lay.countUnit, subdiv: S, beatsPerBar: 0,
      onTick(t) {
        if (!running) return;
        if (!alive()) { stop(); return; }
        const i = t.index, pb = i / S - lay.barBeats;               // pattern beat of this tick
        if (t.time >= ref.time) ref = { beat: pb, time: t.time };
        const tickInBar = i % barTicks;
        if (tickInBar % clickEvery === 0 && s.clickAudible) {
          // 6/8 clicks every eighth, but only the two dotted-quarter pulses
          // carry weight — that is what makes it feel like two, not six.
          const onBeat = tickInBar % beatTicks === 0;
          const opts = tickInBar === 0 ? { accent: true } : (onBeat ? {} : { gain: .12, freq: 500 });
          clickSound(ac, t.time, { ...opts, dest: pulse.out });
        }
        if (i < countTicks) {                                        // the count-in
          if (tickInBar % clickEvery === 0) { const n = tickInBar / clickEvery + 1; t.visual(() => { countLabel = String(n); }); }
          return;
        }
        const k = i - countTicks, loop = Math.floor(k / loopTicks), tl = k % loopTicks;
        if (tl === 0 && loop > 0) t.visual(() => { loopsDone = loop; paintStats(); });
        const oi = onsetTick.get(tl);
        if (oi === undefined) return;
        if (s.patAudible) woodblock(ac, t.time, patGain, tl % barTicks === 0);
        expected.push({ time: t.time, loop, onset: oi, judged: null });
      },
    });
    running = true;
    keyHandler = e => {
      if (e.code === 'Escape') { stop(); return; }
      if (e.code !== 'Space' || e.repeat) return;
      const tg = e.target;
      if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
      e.preventDefault();
      tapIn(ac.currentTime);
    };
    document.addEventListener('keydown', keyHandler);
    if (s.mic && !audio.connected) audio.connect().catch(() => {});
    prevDb = -Infinity;
    ref = { beat: -lay.barBeats, time: ac.currentTime + 0.05 };
    pulse.start(ac.currentTime + 0.05);
    render();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (pulse) pulse.stop();
    if (patGain && ac) {
      const t = ac.currentTime, g = patGain.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.01);
      setTimeout(() => { try { patGain.disconnect(); } catch (e) {} }, 400);
    }
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(flashTimer);
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    // everything still waiting for a tap when you stop is unplayed, not missed
    expected = [];
    groups.clear();
    if (log.length) {
      results = summarize(log, extras);
      // the streak the player WATCHED reset on extra taps; summarize() only
      // sees the onset log, so the live count is the honest one to report
      results.bestStreak = bestStreak;
      results.log = log.slice();
      results.pattern = pattern();
      results.bpm = metroClock.bpm;
      results.loops = loopsDone;
      rememberBest(results);
    }
    if (alive()) render();
  }
  p._rgStop = stop;
  metroClock.registerTransport(p.id, stop);
  // Closing the card must silence it: main.js calls _teardown from the ✕ path,
  // so nothing keeps ticking off-screen and the mic hook goes inert.
  p._teardown = () => { stop(); metroClock.unregisterTransport(p.id); p._rgMic = null; };

  function rememberBest(r) {
    if (r.loops < 1 || r.accuracy <= 0) { r.isBest = false; return; }   // a full loop with at least one hit, or it doesn't count
    const best = read(BEST_KEY, {}) || {};
    const prev = best[r.pattern.id];
    if (prev && prev.acc >= r.accuracy) { r.isBest = false; return; }
    best[r.pattern.id] = { acc: r.accuracy, bpm: r.bpm, mean: r.meanMs, at: Date.now() };
    write(BEST_KEY, best);
    r.isBest = true;
  }

  // ── render ───────────────────────────────────────────────────────
  const chip = (cls, on, label, title) =>
    `<button class="rk-chip ${cls}${on ? ' is-active' : ''}" title="${title}" style="min-height:calc(28px*var(--ui))">${label}</button>`;

  function render() {
    if (!alive()) return;
    const pat = pattern();
    const idx = PATTERNS.indexOf(pat);
    const best = (read(BEST_KEY, {}) || {})[pat.id];
    const H = 128;
    let h = `<div style="display:flex;flex-direction:column;gap:8px">`;

    // pattern picker
    h += `<div style="display:flex;gap:5px;align-items:center">
      <button class="rk-chip rg-prev" title="Previous pattern" style="min-height:calc(28px*var(--ui))" ${running ? 'disabled' : ''}>◀</button>
      <select class="rg-pick mono" ${running ? 'disabled' : ''} style="flex:1;min-height:calc(28px*var(--ui));background:var(--rk-panel2);color:var(--rk-ink);border:1px solid var(--rk-edge-soft);border-radius:6px;font-size:calc(10px*var(--ui));padding:4px 6px">`;
    LEVELS.forEach((lv, li) => {
      h += `<optgroup label="L${li + 1} · ${lv}">`;
      PATTERNS.filter(x => x.level === li).forEach(x => {
        h += `<option value="${x.id}"${x.id === pat.id ? ' selected' : ''}>${esc(x.name)} · ${x.tsig[0]}/${x.tsig[1]}</option>`;
      });
      h += `</optgroup>`;
    });
    h += `</select>
      <button class="rk-chip rg-next" title="Next pattern" style="min-height:calc(28px*var(--ui))" ${running ? 'disabled' : ''}>▶</button>
    </div>`;
    h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span class="mono" style="color:var(--rk-ink-dim);font-size:calc(9px*var(--ui))">L${pat.level + 1} · count <b style="color:var(--rk-accent)">${esc(pat.count)}</b></span>
      <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${best ? `best ${best.acc}% @ ${best.bpm}` : `try ${pat.bpmHint} BPM`}</span>
    </div>`;

    // the lane
    h += `<div class="rg-lane" style="position:relative;height:calc(${H}px*var(--ui));background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:8px;overflow:hidden;cursor:pointer;user-select:none;touch-action:none" title="Tap here, or press Space, on every note">
      <svg class="rg-svg" width="100%" height="100%" style="display:block;position:absolute;inset:0">
        <line x1="0" y1="48.4%" x2="100%" y2="48.4%" stroke="var(--rk-edge)" stroke-width="1"/>
        <g class="rg-loops"></g>
        <g class="rg-taps"></g>
        <line class="rg-hit" x1="30%" y1="0" x2="30%" y2="100%" stroke="var(--rk-accent)" stroke-width="2" opacity=".85"/>
      </svg>
      <div class="rg-count mono" style="position:absolute;left:30%;top:6px;transform:translateX(-50%);font-size:calc(22px*var(--ui));font-weight:700;color:var(--rk-accent);opacity:0;pointer-events:none;transition:opacity .1s"></div>
      <div class="rg-flash mono" style="position:absolute;left:30%;top:8px;transform:translate(-50%,0);font-size:calc(12px*var(--ui));font-weight:700;letter-spacing:1px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .35s,transform .15s;text-shadow:0 0 8px var(--rk-panel)"></div>
      ${!running ? `<div class="mono" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));pointer-events:none;text-align:center;padding:0 14px"><div>${esc(pat.name)}<br><span style="font-size:calc(8px*var(--ui))">Space · click the lane · 🎤 — tap on every note</span></div></div>` : ''}
    </div>`;

    // live numbers
    const stat = (cls, label) => `<div style="flex:1;text-align:center"><div class="${cls} mono" style="color:var(--rk-ink);font-size:calc(13px*var(--ui));font-weight:700">—</div><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px">${label}</div></div>`;
    h += `<div style="display:flex;gap:4px;background:var(--rk-panel2);border-radius:6px;padding:5px 4px">${stat('rg-streak', 'STREAK')}${stat('rg-acc', 'ACCURACY')}${stat('rg-mean', 'MEAN')}${stat('rg-loopn', 'LOOPS')}</div>`;

    // tempo — the master clock, so the Metronome and this agree: BPM is the
    // count unit, which is the eighth in x/8 (hence the higher ceiling — a jig
    // at ♪ = 180 is only ♩. = 60).
    const inEighths = pat.tsig[1] === 8;
    h += masterTempoBlock(`rg-tempo-${p.id}`, inEighths
      ? { min: 40, max: 240, ticks: [40, 90, 140, 190, 240], sub: '♪' }
      : { min: 40, max: 200, ticks: [40, 80, 120, 160, 200], sub: '♩' });

    // options + transport
    h += `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
      ${chip('rg-opt-pat', s.patAudible, '🔊 FIGURE', 'Hear the pattern — mute it to wean off')}
      ${chip('rg-opt-click', s.clickAudible, '🔔 CLICK', 'Hear the beat')}
      ${chip('rg-opt-mic', s.mic, `🎤 MIC${s.mic && !audio.connected ? ' · off' : ''}`, 'Pick attacks count as taps')}
    </div>`;
    h += `<button class="rg-go mono" style="width:100%;min-height:calc(34px*var(--ui));border-radius:8px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;
      background:${running ? 'var(--rk-stop-soft)' : 'var(--rk-soft)'};border:1px solid ${running ? 'var(--rk-stop-edge)' : 'var(--rk-line)'};color:${running ? 'var(--rk-stop)' : 'var(--rk-accent)'}">${running ? '◼ STOP' : '▶ START · 1 bar count-in'}</button>`;

    if (results && !running) h += `<div class="rg-results">${resultsHTML(results)}</div>`;
    h += `</div>`;
    el.innerHTML = h;
    wire();
    // the card is sized for the lane; the results land below it, so bring them up
    if (results && !running) q('.rg-results')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (running) paintStats();
  }

  function resultsHTML(r) {
    const c = r.counts;
    const bin = 25, bins = [];
    for (let lo = -WINDOWS_MS.late; lo < WINDOWS_MS.late; lo += bin) bins.push({ lo, n: 0 });
    r.log.forEach(e => { if (e.j === 'miss') return; const b = bins.find(x => e.ms >= x.lo && e.ms < x.lo + bin) || bins[e.ms < 0 ? 0 : bins.length - 1]; b.n++; });
    const peak = Math.max(1, ...bins.map(b => b.n));
    const lean = r.matched ? (Math.abs(r.meanMs) <= 10 ? 'dead centre' : r.meanMs < 0 ? 'you lean EARLY — you are anticipating' : 'you lean LATE — you are reacting to the sound') : 'no taps matched';
    let h = `<div style="border:1px solid var(--rk-edge);border-radius:8px;padding:8px;background:var(--rk-panel2);display:flex;flex-direction:column;gap:7px">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:baseline"><span class="mono" style="color:var(--rk-accent);font-size:calc(9px*var(--ui));font-weight:700;letter-spacing:1.4px">RESULTS${r.isBest ? ' · NEW BEST' : ''}</span><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${esc(r.pattern.name)} @ ${r.bpm} · ${r.loops} loop${r.loops === 1 ? '' : 's'}</span></div>`;
    const big = (v, l) => `<div style="flex:1;text-align:center"><div class="mono" style="color:var(--rk-ink);font-size:calc(16px*var(--ui));font-weight:700">${v}</div><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px">${l}</div></div>`;
    h += `<div style="display:flex;gap:4px">${big(`${r.accuracy}%`, 'ACCURACY')}${big(r.bestStreak, 'BEST STREAK')}${big(r.matched ? `${r.meanMs > 0 ? '+' : ''}${r.meanMs}` : '—', 'MEAN MS')}</div>`;
    h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(9px*var(--ui));text-align:center">${lean}</div>`;
    // every onset, in order, coloured by its judgment — the shape of the run
    h += `<div style="display:flex;gap:1px;height:calc(12px*var(--ui))">${r.log.map(e => `<div title="${JWORD[e.j]}${e.j === 'miss' ? '' : ` ${e.ms > 0 ? '+' : ''}${e.ms} ms`}" style="flex:1;background:${JCOL[e.j]};border-radius:1px;opacity:${e.j === 'miss' ? .6 : 1}"></div>`).join('')}</div>`;
    // the histogram: where your taps land relative to the note
    h += `<div style="display:flex;align-items:flex-end;gap:1px;height:calc(30px*var(--ui));border-bottom:1px solid var(--rk-edge-soft)">${bins.map(b => {
      const centre = b.lo + bin / 2, col = JCOL[judgeDelta(centre)] || JCOL.late;
      return `<div title="${b.lo}…${b.lo + bin} ms: ${b.n}" style="flex:1;height:${Math.round(100 * b.n / peak)}%;background:${col};opacity:${b.n ? .9 : .18};border-radius:2px 2px 0 0;min-height:2px"></div>`;
    }).join('')}</div>`;
    h += `<div class="mono" style="display:flex;justify-content:space-between;color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))"><span>−150 early</span><span>0</span><span>late +150</span></div>`;
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
      <span style="color:${JCOL.perfect}">${c.perfect} perfect</span><span style="color:${JCOL.good}">${c.good} good</span><span style="color:${JCOL.late}">${c.early} early · ${c.late} late</span><span style="color:${JCOL.miss}">${c.miss} miss</span><span>${r.extras} extra</span></div>`;
    h += `<div style="display:flex;gap:5px"><button class="rk-btn rg-again" style="flex:1;min-height:calc(28px*var(--ui))">↺ AGAIN</button><button class="rk-btn rg-nextpat" style="flex:1;min-height:calc(28px*var(--ui))">NEXT PATTERN ▶</button></div>`;
    h += `</div>`;
    return h;
  }

  function wire() {
    const pick = q('.rg-pick');
    pick?.addEventListener('click', e => e.stopPropagation());
    pick?.addEventListener('change', e => { e.stopPropagation(); s.pat = pick.value; results = null; render(); });
    const step = d => { const i = PATTERNS.findIndex(x => x.id === s.pat); s.pat = PATTERNS[(i + d + PATTERNS.length) % PATTERNS.length].id; results = null; render(); };
    q('.rg-prev')?.addEventListener('click', e => { e.stopPropagation(); if (!running) step(-1); });
    q('.rg-next')?.addEventListener('click', e => { e.stopPropagation(); if (!running) step(1); });
    q('.rg-opt-pat')?.addEventListener('click', e => { e.stopPropagation(); s.patAudible = !s.patAudible; e.currentTarget.classList.toggle('is-active', s.patAudible); });
    q('.rg-opt-click')?.addEventListener('click', e => { e.stopPropagation(); s.clickAudible = !s.clickAudible; e.currentTarget.classList.toggle('is-active', s.clickAudible); });
    q('.rg-opt-mic')?.addEventListener('click', async e => {
      e.stopPropagation(); s.mic = !s.mic;
      if (s.mic && !audio.connected) { try { await audio.connect(); } catch (err) { /* declined — the chip shows "off" */ } }
      if (alive() && !running) render(); else e.currentTarget.classList.toggle('is-active', s.mic);
    });
    q('.rg-go')?.addEventListener('click', e => { e.stopPropagation(); if (running) stop(); else start(); });
    q('.rg-again')?.addEventListener('click', e => { e.stopPropagation(); start(); });
    q('.rg-nextpat')?.addEventListener('click', e => { e.stopPropagation(); step(1); });
    // the lane is a drum: pointerdown, not click, because click waits for the release
    const lane = q('.rg-lane');
    lane?.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      if (running) tapIn(ac.currentTime); else start();
    });
    lane?.addEventListener('click', e => e.stopPropagation());
    // Same scaling as start(): a mid-run master change must still mean the count unit.
    wireMasterTempo(`rg-tempo-${p.id}`, { mirror: v => { if (pulse && lay) pulse.setBpm(v * lay.countUnit); } });
  }

  render();
}
