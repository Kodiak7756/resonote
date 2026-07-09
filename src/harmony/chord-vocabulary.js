// ── Chord-Family curriculum data ─────────────────────────────────────
// This is the pedagogy layer the original resonote lacked. Every chord the
// Chord-Family Lab teaches is grouped into a family with: the "plain" chord it
// colours (for A/B reveal), its defining COLOUR TONE, a tension weight (0–1
// drives the tension meter), a plain-English WHY, and where it RESOLVES.
//
// Chord intervals themselves live in core/music-theory.js (CHORD_TYPES); here
// we reference them by {cat, type} so the two stay in sync.
import { NOTES, CHORD_TYPES, getChordNotes } from '../core/music-theory.js';

// Clean display suffix per chord type → e.g. chordName('C','7♭9') = "C7♭9".
const SUFFIX = {
  'Major': '', 'Minor': 'm', 'Dim': '°', 'Aug': '+', 'Sus2': 'sus2', 'Sus4': 'sus4',
  'Maj7': 'maj7', '7 (Dom)': '7', 'Min7': 'm7', 'Dim7': '°7', 'm7♭5': 'ø7', 'Aug7': '7♯5', 'mMaj7': 'mMaj7',
  'Add9': 'add9', '9': '9', 'Min9': 'm9', 'Maj9': 'maj9', '6': '6', 'Min6': 'm6',
  '6/9': '6/9', '11': '11', 'Min11': 'm11', '13': '13', 'Maj13': 'maj13',
  '7♭5': '7♭5', '7♯5': '7♯5', '7♭9': '7♭9', '7♯9': '7♯9', '7♯11': '7♯11', '7♭13': '7♭13'
};

export function chordName(root, type) {
  return root + (SUFFIX[type] ?? type);
}

export function transposeRoot(root, semis) {
  return NOTES[((NOTES.indexOf(root) + semis) % 12 + 12) % 12];
}

// Resolve a {cat, type} reference to a concrete chord on a given root.
export function buildChord(root, cat, type) {
  const intervals = CHORD_TYPES[cat]?.[type] || [0, 4, 7];
  return { root, cat, type, name: chordName(root, type), notes: getChordNotes(root, intervals), intervals };
}

export const CHORD_FAMILIES = [
  {
    id: 'suspended', label: 'Suspended', icon: '🌬️', accent: '#54c7ec',
    blurb: 'Neither major nor minor — the 3rd is swapped for a neighbour that leans, then falls home.',
    base: { cat: 'Triads', type: 'Major' },
    members: [
      { cat: 'Triads', type: 'Sus4', name: 'sus4', colorDeg: 5, tension: 0.45,
        why: 'The 4th sits a half-step above the 3rd and aches to drop onto it — the classic “hang, then release.” Think the intro to “Pinball Wizard.”',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the 4th falls to the 3rd → same-root major' } },
      { cat: 'Triads', type: 'Sus2', name: 'sus2', colorDeg: 2, tension: 0.38,
        why: 'Open and airy — the 2nd hasn’t committed to becoming a major 3rd. Great for jangly, ambiguous color (lots of folk/indie).',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the 2nd rises to the 3rd → same-root major' } },
    ]
  },
  {
    id: 'added', label: 'Added-tone', icon: '✨', accent: '#7ad17a',
    blurb: 'A plain triad plus one extra colour note — still consonant, but richer and more personal.',
    base: { cat: 'Triads', type: 'Major' },
    members: [
      { cat: 'Extended', type: 'Add9', name: 'add9', colorDeg: 2, tension: 0.25,
        why: 'Major with a bright 9th stacked on top — modern and shimmering, with no 7th to muddy it.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'settles to plain major' } },
      { cat: 'Extended', type: '6', name: '6', colorDeg: 9, tension: 0.2,
        why: 'Add a 6th for a warm, vintage, fully-resolved sweetness — a lovely alternative to a final major chord.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'relaxes to plain major' } },
      { cat: 'Extended', type: '6/9', name: '6/9', colorDeg: 2, tension: 0.26,
        why: '6th and 9th together — lush, open, and famously one of the prettiest ways to end a song.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'relaxes to plain major' } },
    ]
  },
  {
    id: 'dom-ext', label: 'Dominant extensions', icon: '🎷', accent: '#e0a14a',
    blurb: 'Stack a 9, 11, or 13 on a dominant 7 — the lush, soulful colours of funk, soul and jazz.',
    base: { cat: '7ths', type: '7 (Dom)' },
    members: [
      { cat: 'Extended', type: '9', name: '9', colorDeg: 2, tension: 0.5,
        why: 'Dom7 plus a 9th — instant funk/soul richness while keeping the bluesy pull of the ♭7.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I (the V→I pull)' } },
      { cat: 'Extended', type: '11', name: '11', colorDeg: 5, tension: 0.55,
        why: 'The 11th suspends the dominant — gospel and soul lean on this hazy, half-resolved tension.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I' } },
      { cat: 'Extended', type: '13', name: '13', colorDeg: 9, tension: 0.5,
        why: 'The full, sophisticated dominant — about every colour the V chord can hold before it resolves.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I' } },
    ]
  },
  {
    id: 'altered', label: 'Altered dominants', icon: '⚡', accent: '#e0556b',
    blurb: 'A dominant 7 with a bent 5th or 9th — maximum pull. The “secret sauce” beyond the 7th-chord ceiling.',
    base: { cat: '7ths', type: '7 (Dom)' },
    members: [
      { cat: 'Altered', type: '7♭9', name: '7♭9', colorDeg: 1, tension: 0.85,
        why: 'A ♭9 over a dominant screams to resolve — flamenco fire and jazz darkness. (A diminished 7 hides inside it.)',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I — a huge release' } },
      { cat: 'Altered', type: '7♯9', name: '7♯9', colorDeg: 3, tension: 0.8,
        why: 'The “Hendrix chord.” A major 3rd and a ♯9 (a ♭3 in disguise) grind together — gritty, bluesy, funky.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I' } },
      { cat: 'Altered', type: '7♯5', name: '7♯5', colorDeg: 8, tension: 0.8,
        why: 'Raise the 5th and the chord lifts into whole-tone suspense — unstable, cinematic, reaching upward.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I' } },
      { cat: 'Altered', type: '7♭5', name: '7♭5', colorDeg: 6, tension: 0.78,
        why: 'A ♭5 makes the chord ambiguous — it can resolve normally OR substitute for the dominant a tritone away.',
        resolveTo: { rootInt: 5, cat: '7ths', type: 'Maj7', motion: 'down a 5th to I' } },
    ]
  },
  {
    id: 'augmented', label: 'Augmented', icon: '🔺', accent: '#c77ad1',
    blurb: 'Stack two major 3rds and the 5th sharpens — a restless, dreamlike chord that wants to climb.',
    base: { cat: 'Triads', type: 'Major' },
    members: [
      { cat: 'Triads', type: 'Aug', name: 'aug', colorDeg: 8, tension: 0.7,
        why: 'The raised 5th refuses to sit still — use it to push I toward IV, or to spice a dominant. Perfectly symmetrical: one shape names three chords.',
        resolveTo: { rootInt: 5, cat: 'Triads', type: 'Major', motion: 'the ♯5 rises — up a 4th to a bright major' } },
    ]
  },
  {
    id: 'diminished', label: 'Diminished', icon: '🕸️', accent: '#6f8be0',
    blurb: 'Stacked minor 3rds — pure, symmetrical tension that leans hard toward a resolution a half-step up.',
    base: { cat: 'Triads', type: 'Minor' },
    members: [
      { cat: 'Triads', type: 'Dim', name: 'dim', colorDeg: 6, tension: 0.72,
        why: 'The ♭5 makes a minor chord unstable — it’s the vii° that pulls up a half-step into the tonic.',
        resolveTo: { rootInt: 1, cat: 'Triads', type: 'Major', motion: 'up a half-step to I' } },
      { cat: '7ths', type: 'Dim7', name: 'dim7', colorDeg: 6, tension: 0.82,
        why: 'Four notes evenly spaced — every note is a leading tone. One grip repeats every 3 frets and can resolve almost anywhere.',
        resolveTo: { rootInt: 1, cat: '7ths', type: 'Maj7', motion: 'up a half-step to I' } },
      { cat: '7ths', type: 'm7♭5', name: 'm7♭5', colorDeg: 6, tension: 0.58,
        why: 'The “half-diminished” — the ii of a minor key. It sets up the V that carries you home.',
        resolveTo: { rootInt: 5, cat: '7ths', type: '7 (Dom)', motion: 'to V7 (the ii–V move)' } },
    ]
  },
];

export function getFamily(id) {
  return CHORD_FAMILIES.find(f => f.id === id) || CHORD_FAMILIES[0];
}
