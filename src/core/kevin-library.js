// ─── The written library, on disk ─────────────────────────────────────
// These are Kevin's own exercises, and they very nearly did not survive.
// They lived ONLY in browser localStorage, and the in-app preview browser turns
// out not to persist its storage across a server restart — so one restart wiped
// thirteen hand-written pieces with no copy anywhere. They were rebuilt from
// note data captured earlier in the session; the two marches that had never been
// printed were regenerated from a rule proven exact against the two that had.
//
// So they live HERE now: in the repo, in git, on disk. A file cannot be cleared
// by a browser. Anything written from today lands in localStorage as before —
// which is why the Songbook has an ⬇ Export / ⬆ Import pair, and why this file
// exists to seed a library that comes up empty.
//
// THE SEED. `Base Scale - Cmaj` is the important one: two octaves of C major in
// 8th position, no open strings. Ten of the original thirteen pieces derived
// from it byte-identically (broken 3rds…7ths, 3/4/5-note runs), so it is not one
// exercise among many — it is the fingering every scale exercise is generated
// out of. Lose it and you lose all ten.
//
// THE MARCHES walk every diatonic triad of the key through every inversion up
// ONE string set, moving a single voice per step: the voice holding the current
// triad's 5th rises one scale step, and that makes the next chord (Em's B → C is
// C major; C's G → A is A minor). The rule reproduces the two printed marches,
// GBe and EAD, note for note, and the two rebuilt sets are generated from it.
// (Their first rebuild cycled the voices middle → bottom → top instead, which
// only works while the 5th starts in the middle voice — 16 of DGB's 25 steps and
// 18 of ADG's 27 were not chords. Open A·D·G is not a chord either, so ADG starts
// on B·D·G, the lowest triad on those strings the rule can run from.)

// "lowFret,midFret,hiFret" per step, against the string set named in `set`
// (si 0 = highest string, so [2,1,0] is G·B·e low→high).
const M = {
  gbe: { set: [2, 1, 0], verbatim: true, grips:
    '0,0,0 0,1,0 2,1,0 2,1,1 2,3,1 4,3,1 4,3,3 4,5,3 5,5,3 5,5,5 5,6,5 7,6,5 7,6,7 7,8,7 9,8,7 9,8,8 9,10,8 10,10,8 10,10,10 10,12,10 12,12,10 12,12,12 12,13,12' },
  dgb: { set: [3, 2, 1], verbatim: false, grips:
    '0,0,0 2,0,0 2,0,1 2,2,1 3,2,1 3,2,3 3,4,3 5,4,3 5,4,5 5,5,5 7,5,5 7,5,6 7,7,6 9,7,6 9,7,8 9,9,8 10,9,8 10,9,10 10,10,10 12,10,10 12,10,12 12,12,12 14,12,12 14,12,13 14,14,13' },
  adg: { set: [4, 3, 2], verbatim: false, grips:
    '2,0,0 2,2,0 3,2,0 3,2,2 3,3,2 5,3,2 5,3,4 5,5,4 7,5,4 7,5,5 7,7,5 8,7,5 8,7,7 8,9,7 10,9,7 10,9,9 10,10,9 12,10,9 12,10,10 12,12,10 14,12,10 14,12,12 14,14,12 15,14,12 15,14,14 15,15,14' },
  ead: { set: [5, 4, 3], verbatim: true, grips:
    '1,0,0 1,2,0 3,2,0 3,2,2 3,3,2 5,3,2 5,3,3 5,5,3 7,5,3 7,5,5 7,7,5 8,7,5 8,7,7 8,8,7 10,8,7 10,8,9 10,10,9 12,10,9 12,10,10 12,12,10 13,12,10 13,12,12 13,14,12 15,14,12 15,14,14 15,15,14' },
};

// The seed scale, ascending: "si:fret".
const SEED =
  '5:8 5:10 4:7 4:8 4:10 3:7 3:9 3:10 2:7 2:9 2:10 1:8 1:10 0:7 0:8 0:10';

const marchSteps = m => m.grips.trim().split(/\s+/).map(g => {
  const f = g.split(',').map(Number);
  return { notes: m.set.map((si, i) => ({ si, fret: f[i] })), dur: 1 };
});
const scaleSteps = s => s.trim().split(/\s+/).map(t => {
  const [si, fret] = t.split(':').map(Number);
  return { notes: [{ si, fret }], dur: 1 };
});

const SET_NAME = { gbe: 'GBe', dgb: 'DGB', adg: 'ADG', ead: 'EAD' };
const piece = (id, name, steps, about) =>
  ({ id, libId: id, name, steps, sections: [], about, tsig: 4, bpm: 100 });

// Rebuilt fresh each call so a caller that edits one cannot poison the source.
export function kevinLibrary() {
  const out = Object.keys(M).map(k => piece(
    'kv-march-' + k,
    'Triad March ' + SET_NAME[k],
    marchSteps(M[k]),
    `Every diatonic triad of C major through every inversion up ${SET_NAME[k].split('').join('-')}, one voice moving per step. ` +
    'Move one voice at a time and every chord in the key appears in every inversion.'
  ));
  out.push(piece('kv-base-scale', 'Base Scale - Cmaj', scaleSteps(SEED),
    'Two octaves of C major in 8th position, no open strings. Every note run and broken-interval exercise is built from this fingering — re-finger it and they all follow.'));
  return out;
}

// Put back anything missing, and never touch a piece that is already there —
// a restore that overwrites your current work is just a different way to lose it.
export function restoreMissing(current = []) {
  const have = new Set(current.map(p => p.id));
  const add = kevinLibrary().filter(p => !have.has(p.id));
  return { library: [...current, ...add], added: add.map(p => p.name) };
}

// The DGB and ADG marches exactly as they first shipped (mostly not chords — see
// above). restoreMissing never replaces a piece that is already there, so a saved
// library still holds these. Swap in the corrected steps only where a stored march
// is still that stock copy, note for note and with no sections added; one you have
// edited is your work, and it stays exactly as it is.
const STALE = {
  dgb: '0,0,0 0,2,0 2,2,0 2,2,1 2,4,1 3,4,1 3,4,3 3,5,3 5,5,3 5,5,5 5,7,5 7,7,5 7,7,6 7,9,6 9,9,6 9,9,8 9,10,8 10,10,8 10,10,10 10,12,10 12,12,10 12,12,12 12,14,12 14,14,12 14,14,13',
  adg: '0,0,0 0,2,0 2,2,0 2,2,2 2,3,2 3,3,2 3,3,4 3,5,4 5,5,4 5,5,5 5,7,5 7,7,5 7,7,7 7,9,7 8,9,7 8,9,9 8,10,9 10,10,9 10,10,10 10,12,10 12,12,10 12,12,12 12,14,12 14,14,12 14,14,14 14,15,14 15,15,14',
};
export function replaceStaleMarches(current = []) {
  const replaced = [];
  const library = current.map(p => {
    const k = Object.keys(STALE).find(key => p && p.id === 'kv-march-' + key);
    if (!k || (p.sections || []).length) return p;
    if (JSON.stringify(p.steps) !== JSON.stringify(marchSteps({ set: M[k].set, grips: STALE[k] }))) return p;
    replaced.push(p.name);
    return { ...p, steps: marchSteps(M[k]) };
  });
  return { library, replaced };
}
