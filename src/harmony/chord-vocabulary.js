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
  'Major': '', 'Minor': 'm', 'Dim': '°', 'Aug': '+', 'Sus2': 'sus2', 'Sus4': 'sus4', '5': '5',
  'Maj7': 'maj7', '7 (Dom)': '7', 'Min7': 'm7', 'Dim7': '°7', 'm7♭5': 'ø7', 'Aug7': '7♯5', 'mMaj7': 'mMaj7',
  'Add9': 'add9', '9': '9', 'Min9': 'm9', 'Maj9': 'maj9', '6': '6', 'Min6': 'm6',
  '6/9': '6/9', '11': '11', 'Min11': 'm11', '13': '13', 'Maj13': 'maj13',
  '7♭5': '7♭5', '7♯5': '7♯5', '7♭9': '7♭9', '7♯9': '7♯9', '7♯11': '7♯11', '7♭13': '7♭13'
};

// ── Slash / over-bass chords ─────────────────────────────────────────
// cat 'Slash' lives HERE (not in CHORD_TYPES) so the rest of the app's chord pickers don't
// inherit it. TWO families:
//   INVERSIONS  (bassInt set)  — the chord is the root's own triad with a CHORD TONE in the
//                                bass (C/E, C/G). The bass-line / voice-leading family.
//   UPPER STRUCTURES (upperInt) — a triad stacked over a FOREIGN bass; the degree it's built
//                                on decides the harvest ('V/R' = G/C = 5·7·9, the maj9 colour).
const SLASH = {
  // GROUP A — bass stays on the ROOT, each diatonic triad of its major key stacks above
  'I/R':    { intervals: [0, 4, 7],        upperInt: 0  },                // C/C  — home base
  'ii/R':   { intervals: [0, 2, 5, 9],     upperInt: 2,  minor: true },   // Dm/C → 9·11·13 (the ii-over-tonic pedal)
  'iii/R':  { intervals: [0, 4, 7, 11],    upperInt: 4,  minor: true },   // Em/C → 3·5·7  (= maj7!)
  'IV/R':   { intervals: [0, 5, 9],        upperInt: 5  },                // F/C  → 1·4·6  (“amen” sus colour)
  'V/R':    { intervals: [0, 7, 11, 14],   upperInt: 7  },                // G/C  → 5·7·9  (maj9)
  'vi/R':   { intervals: [0, 4, 9],        upperInt: 9,  minor: true },   // Am/C → 1·3·6  (= C6!)
  'vii°/R': { intervals: [0, 11, 14, 17],  upperInt: 11, dim: true },     // B°/C → 7·9·11 (leading-tone shimmer)
  // GROUP B — the root's own triad holds still, the BASS walks the scale under it
  'I/2':    { intervals: [0, 2, 4, 7],     bassInt: 2  },                 // C/D — a dressed-up 9sus dominant
  'I/3':    { intervals: [0, 4, 7],        bassInt: 4  },                 // C/E — 1st inversion, 3rd in the bass
  'I/4':    { intervals: [0, 4, 5, 7],     bassInt: 5  },                 // C/F — lands as Fmaj9
  'I/5':    { intervals: [0, 4, 7],        bassInt: 7  },                 // C/G — 2nd inversion, cadential 6-4
  'I/6':    { intervals: [0, 4, 7, 9],     bassInt: 9  },                 // C/A — the same notes as Am7
  'I/7':    { intervals: [0, 4, 7, 11],    bassInt: 11 },                 // C/B — the walkdown passing chord
  // GROUP C — borrowed colours (non-diatonic upper structures)
  'II/R':   { intervals: [0, 14, 18, 21],  upperInt: 2  },                // D/C  → 9·♯11·13 (Lydian float)
  '♭VII/R': { intervals: [0, 10, 14, 17],  upperInt: 10, flat: true },    // B♭/C → ♭7·9·11 (gospel 9sus)
  '♭III/R': { intervals: [0, 3, 7, 10],    upperInt: 3,  flat: true },    // E♭/C → ♭3·5·♭7 (= m7 in disguise!)
  '♭VI/R':  { intervals: [0, 3, 8],        upperInt: 8,  flat: true },    // A♭/C → ♭6·1·♭3 (epic-trailer lift)
};
const FLATNAME = { 'A#': 'B♭', 'C#': 'D♭', 'D#': 'E♭', 'F#': 'G♭', 'G#': 'A♭' };

// How to VOICE a slash type on a given root: which note is the bass, and which triad
// (semitones above the bass + quality) stacks on top. Bass-walk types flip the frame: the
// bass is root+bassInt, and the triad above is the root's own — (12−bassInt) above the bass.
export function slashVoicingSpec(type, root) {
  const sl = SLASH[type];
  if (!sl) return null;
  if (sl.bassInt != null) return { bass: transposeRoot(root, sl.bassInt), upperSemis: (12 - sl.bassInt) % 12, upperQual: 'maj' };
  return { bass: root, upperSemis: sl.upperInt, upperQual: sl.dim ? 'dim' : sl.minor ? 'min' : 'maj' };
}

export function chordName(root, type) {
  const sl = SLASH[type];
  if (sl) {
    if (sl.bassInt != null) { const b = transposeRoot(root, sl.bassInt); return root + '/' + b; }
    const up = transposeRoot(root, sl.upperInt);
    return (sl.flat ? (FLATNAME[up] || up) : up) + (sl.dim ? '°' : sl.minor ? 'm' : '') + '/' + root;
  }
  return root + (SUFFIX[type] ?? type);
}

export function transposeRoot(root, semis) {
  return NOTES[((NOTES.indexOf(root) + semis) % 12 + 12) % 12];
}

// Resolve a {cat, type} reference to a concrete chord on a given root.
export function buildChord(root, cat, type) {
  const intervals = (cat === 'Slash' ? SLASH[type]?.intervals : CHORD_TYPES[cat]?.[type]) || [0, 4, 7];
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
    id: 'slash', label: 'Slash / over-bass', icon: '🎼', accent: '#efb14a',
    blurb: 'Two views of one idea. Hold the BASS on the root and stack each diatonic triad above it — each one harvests a different colour. Then hold the TRIAD still and walk the bass under it — each bass note renames the same shape. Figured bass, reborn.',
    base: { cat: 'Triads', type: 'Major' },
    members: [
      { cat: 'Slash', type: 'I/R', name: 'I over · home', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 0, tension: 0.1,
        why: 'The root’s own triad over its own bass — your reference point. Everything else in this row keeps this exact bass and swaps only the triad on top.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'already home' } },
      { cat: 'Slash', type: 'ii/R', name: 'ii over · 9sus', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 2, tension: 0.42,
        why: 'The ii minor triad over the tonic bass harvests 9·11·13 — gospel and neo-soul’s favourite way to move the harmony without the bass ever leaving home.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the ii melts back onto home — bass never moved' } },
      { cat: 'Slash', type: 'iii/R', name: 'iii over · maj7', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 11, tension: 0.28,
        why: 'The iii minor triad harvests 3·5·7 — you just built a maj7 without fretting a “maj7 shape.” Discovery: every maj7 chord is a minor triad wearing a new bass.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the maj7 sheen melts back to plain major' } },
      { cat: 'Slash', type: 'IV/R', name: 'IV over · “amen”', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 5, tension: 0.45,
        why: 'The IV triad harvests 1·4·6 — the plagal “a-men” suspension in a single grip. Gospel and folk lean whole songs on this.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the 4th falls to the 3rd — the amen cadence' } },
      { cat: 'Slash', type: 'V/R', name: 'V over · maj9', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 2, tension: 0.3,
        why: 'The V triad over the tonic bass harvests 5·7·9 — over C, the notes G·B·D spell Cmaj9 with no 3rd. Functionally it is a dominant suspended over a tonic pedal: the 7 and 9 carry V-chord tension while the bass keeps the harmony anchored on I.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the 9 and 7 fall stepwise into the plain tonic triad' } },
      { cat: 'Slash', type: 'vi/R', name: 'vi over · 6th', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 9, tension: 0.25,
        why: 'The vi minor triad harvests 1·3·6 — the sweet vintage 6th chord. Discovery: Am/C and C6 are the same notes; the bass decides which name you hear.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the 6th tucks back into the plain triad' } },
      { cat: 'Slash', type: 'vii°/R', name: 'vii° over · shimmer', group: 'DIATONIC TRIADS OVER A {R} BASS', colorDeg: 11, tension: 0.68,
        why: 'The leading-tone diminished triad over the tonic harvests 7·9·11 — maximum shimmer-tension while standing on home. Gospel passing colour; hold it long and it begs to dissolve.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the cluster dissolves straight into the tonic' } },

      { cat: 'Slash', type: 'I/2', name: '/2 · dressed V', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 2, tension: 0.55,
        why: 'Your triad over the bass one step up (C/D) IS a 9sus dominant — the smoothest V-of-the-key-a-4th-down there is. Pop and R&B end phrases on this constantly.',
        resolveTo: { rootInt: 7, cat: 'Triads', type: 'Major', motion: 'it is a dressed-up V — release onto the chord a 5th below the bass' } },
      { cat: 'Slash', type: 'I/3', name: '/3 · 1st inversion', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 4, tension: 0.35,
        why: 'Same three notes — only the BASS moved to the 3rd. This is the walkdown workhorse: C → G/B → Am is a bass line walking C-B-A while the chords ring.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the bass settles home — root position' } },
      { cat: 'Slash', type: 'I/4', name: '/4 · lands maj9', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 5, tension: 0.4,
        why: 'Your triad over the bass a 4th up (C/F) rings as Fmaj9 — the IV chord wearing your notes. Discovery: this is G/C’s harvest formula seen from the OTHER side.',
        resolveTo: { rootInt: 5, cat: 'Triads', type: 'Major', motion: 'settles onto the plain IV — it was maj9 all along' } },
      { cat: 'Slash', type: 'I/5', name: '/5 · 2nd inversion', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 7, tension: 0.45,
        why: 'The 5th in the bass makes the chord lean forward — the classical cadential 6-4. It practically begs to collapse onto the chord built on that bass note.',
        resolveTo: { rootInt: 7, cat: 'Triads', type: 'Major', motion: 'the 6-4 lean: the chord collapses onto the V, then pulls home' } },
      { cat: 'Slash', type: 'I/6', name: '/6 · = m7', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 9, tension: 0.3,
        why: 'Your triad over the bass a 6th up (C/A) is the SAME four notes as Am7 — the relative minor was hiding inside your chord the whole time. The bass note names it.',
        resolveTo: { rootInt: 9, cat: 'Triads', type: 'Minor', motion: 'relax onto the bass’s own chord: the relative minor' } },
      { cat: 'Slash', type: 'I/7', name: '/7 · walkdown step', group: 'THE {R} TRIAD OVER A WALKING BASS', colorDeg: 11, tension: 0.6,
        why: 'The bass slips a half-step below the root (C/B) — the famous first step of the descent: C → C/B → Am. A passing chord that exists to keep the bass line moving.',
        resolveTo: { rootInt: 9, cat: 'Triads', type: 'Minor', motion: 'the walkdown completes: bass falls on to the vi' } },

      { cat: 'Slash', type: 'II/R', name: 'II(maj) · Lydian', group: 'BORROWED COLOURS', colorDeg: 6, tension: 0.5,
        why: 'The MAJOR triad one step up (not the diatonic minor!) harvests 9·♯11·13 — the floating, wide-eyed Lydian colour. One easy shape over a pedal bass = instant dreamy post-rock.',
        resolveTo: { rootInt: 0, cat: 'Triads', type: 'Major', motion: 'the ♯11 drifts down and the float lands on plain major' } },
      { cat: 'Slash', type: '♭VII/R', name: '♭VII · gospel', group: 'BORROWED COLOURS', colorDeg: 10, tension: 0.62,
        why: 'The triad a whole step below harvests ♭7·9·11 — the gospel/funk 9sus. It behaves like a dominant with the edges rounded off.',
        resolveTo: { rootInt: 5, cat: 'Triads', type: 'Major', motion: 'down a 5th, like a soft V→I' } },
      { cat: 'Slash', type: '♭III/R', name: '♭III · = m7', group: 'BORROWED COLOURS', colorDeg: 3, tension: 0.4,
        why: 'The major triad a minor 3rd up (E♭ over C) harvests ♭3·5·♭7 — the bass turns MINOR without you playing a minor shape. E♭/C and Cm7 are the same four notes.',
        resolveTo: { rootInt: 5, cat: 'Triads', type: 'Major', motion: 'behaves like a ii chord — down a 5th' } },
      { cat: 'Slash', type: '♭VI/R', name: '♭VI · epic', group: 'BORROWED COLOURS', colorDeg: 8, tension: 0.55,
        why: 'The major triad on the ♭6 (A♭ over C) — the huge “trailer lift” of rock and film scores. Hold the bass, drop the ♭VI on top, and the room gets bigger.',
        resolveTo: { rootInt: 10, cat: 'Triads', type: 'Major', motion: 'the first step of the epic ♭VI → ♭VII → I cadence' } },
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
