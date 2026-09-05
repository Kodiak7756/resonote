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
// ONE string set, moving a single voice per step in the order middle → bottom →
// top. That cycle is what makes each step a real chord and each move a real
// voice-leading, and it is the rule the two rebuilt sets were generated from.

// "lowFret,midFret,hiFret" per step, against the string set named in `set`
// (si 0 = highest string, so [2,1,0] is G·B·e low→high).
const M = {
  gbe: { set: [2, 1, 0], verbatim: true, grips:
    '0,0,0 0,1,0 2,1,0 2,1,1 2,3,1 4,3,1 4,3,3 4,5,3 5,5,3 5,5,5 5,6,5 7,6,5 7,6,7 7,8,7 9,8,7 9,8,8 9,10,8 10,10,8 10,10,10 10,12,10 12,12,10 12,12,12 12,13,12' },
  dgb: { set: [3, 2, 1], verbatim: false, grips:
    '0,0,0 0,2,0 2,2,0 2,2,1 2,4,1 3,4,1 3,4,3 3,5,3 5,5,3 5,5,5 5,7,5 7,7,5 7,7,6 7,9,6 9,9,6 9,9,8 9,10,8 10,10,8 10,10,10 10,12,10 12,12,10 12,12,12 12,14,12 14,14,12 14,14,13' },
  adg: { set: [4, 3, 2], verbatim: false, grips:
    '0,0,0 0,2,0 2,2,0 2,2,2 2,3,2 3,3,2 3,3,4 3,5,4 5,5,4 5,5,5 5,7,5 7,7,5 7,7,7 7,9,7 8,9,7 8,9,9 8,10,9 10,10,9 10,10,10 10,12,10 12,12,10 12,12,12 12,14,12 14,14,12 14,14,14 14,15,14 15,15,14' },
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
