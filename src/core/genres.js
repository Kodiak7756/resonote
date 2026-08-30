// ─── Genres: a groove + a mode + a chord move ─────────────────────────────────
// A style is not a mystery. Name those three things and it is reproducible in any
// key, which is the difference between "play something reggae" (impossible on
// demand) and "one drop, Aeolian, i–♭VII" (a task). These are the generic idioms
// every player learns — the shared vocabulary, not anybody's particular song.
//
// The drum grooves are the 🥁 Beat Maker's own preset names, so there is one kit
// and one sequencer; this file only says which groove belongs with which harmony.
//   prog entries: [scaleDegree, quality, bars]
import { NOTES, SCALE_TYPES, toSharp } from './music-theory.js';

export const FORCED = { dom7:[0,4,7,10], min7:[0,3,7,10], maj7:[0,4,7,11], maj:[0,4,7], min:[0,3,7] };
const SUFFIX = { dom7:'7', min7:'m7', maj7:'maj7', maj:'', min:'m' };

// ── Comp patterns: WHERE in the bar the chord is actually struck ──────────────
// One chord at the top of the bar is not what a rhythm player does, and on some
// styles it is flatly wrong — reggae's whole identity is that the chord lands on
// the OFF-beat and never on the beat. 16 slots per bar; slot 0 is beat 1, the
// beats are 0/4/8/12 and the "ands" are 2/6/10/14. `accent` slots are struck
// harder, which is most of what makes a pattern feel like its genre.
export const COMPS = {
  Blues:     { hits:[0,4,7,8,12,15],           accent:[0,8],     feel:'Quarters with a push into 3 and into the next bar.' },
  Rock:      { hits:[0,2,4,6,8,10,12,14],      accent:[0,8],     feel:'Straight eighths — the engine underneath everything.' },
  Reggae:    { hits:[2,6,10,14],               accent:[6,14],    feel:'The skank: every AND, never the beat. Beat 1 is left empty on purpose.' },
  Funk:      { hits:[0,3,6,10,14],             accent:[0],       feel:'Sixteenth stabs, short and dry. The gaps are the groove.' },
  Jazz:      { hits:[4,12],                    accent:[4,12],    feel:'Comping on 2 and 4 — you stay out of the way of the melody.' },
  Pop:       { hits:[0,6,8,14],                accent:[0,8],     feel:'Down on 1 and 3 with a push before each — the acoustic-strum shape.' },
  Latin:     { hits:[0,3,6,8,11,14],           accent:[0,8],     feel:'Montuno-ish: syncopated against the beat, driving forward.' },
  'Hip Hop': { hits:[0,10],                    accent:[0],       feel:'Two hits a bar. Almost all space — the drums do the talking.' },
  EDM:       { hits:[0,4,8,12],                accent:[0],       feel:'Four on the floor with the chords, same as the kick.' },
  Swancore:  { hits:[0,2,3,6,8,10,11,14],      accent:[0,8],     feel:'Busy sixteenth shells with holes punched in them — mute what you do not strike.' },
  // Psychedelic comping is sparse on purpose: the chord is a DRONE to play over,
  // not a part. Strike it and leave it — the space is where the effects live.
  'Psych Drone': { hits:[0],                   accent:[0],       feel:'Strike once and let it ring the whole bar. Everything interesting happens over the top of it, not in it.' },
  'Psych Swirl': { hits:[0,6,8,14],            accent:[0,8],     feel:'Down on 1 and 3 with a push before each — enough motion to rock, enough space to swirl.' },
  'Raga Rock':   { hits:[0,10],                accent:[0],       feel:'Two hits a bar over a droning root. Resist filling the gap; the drone is the point.' },
};
export const compOf = name => COMPS[name] || { hits:[0], accent:[0], feel:'One hit per bar.' };

export const GENRES = {
  Blues:     { groove:'Blues',   mode:'Mixolydian', bpm:90,
               prog:[[0,'dom7',4],[3,'dom7',2],[0,'dom7',2],[4,'dom7',1],[3,'dom7',1],[0,'dom7',1],[4,'dom7',1]],
               why:'Every chord is a dominant 7 — including the I. That belongs to no single scale, and it is exactly what makes blues sound like blues.' },
  Rock:      { groove:'Rock',    mode:'Mixolydian', bpm:120, prog:[[0,'maj',2],[6,'maj',1],[3,'maj',1]],
               why:'The ♭VII is the Mixolydian note turned into a chord — major, but not sweet.' },
  Reggae:    { groove:'Reggae',  mode:'Aeolian',    bpm:75,  prog:[[0,'min',2],[6,'maj',2]],
               why:'The kick leaves beat 1 alone — that is the one drop. Put your chord on the AND, never on the beat.' },
  Funk:      { groove:'Funk',    mode:'Dorian',     bpm:100, prog:[[0,'min7',4]],
               why:'One chord, all groove. Dorian\'s natural 6 is what stops a minor vamp turning dark.' },
  Jazz:      { groove:'Jazz',    mode:'Ionian',     bpm:130, prog:[[1,'min7',1],[4,'dom7',1],[0,'maj7',2]],
               why:'ii–V–I is the sentence the whole language is built from. Listen for the 3rd of each chord sliding a semitone into the next.' },
  Pop:       { groove:'Pop',     mode:'Ionian',     bpm:110, prog:[[0,'maj',1],[4,'maj',1],[5,'min',1],[3,'maj',1]],
               why:'I–V–vi–IV — four chords, most of the charts. The vi is what keeps it from sounding like a hymn.' },
  Latin:     { groove:'Latin',   mode:'Aeolian',    bpm:110, prog:[[0,'min',1],[6,'maj',1],[5,'maj',1],[4,'maj',1]],
               why:'The Andalusian descent, i–♭VII–♭VI–V. That last chord is MAJOR where the scale says minor — borrowed, and it is the whole flavour.' },
  'Hip Hop': { groove:'Hip Hop', mode:'Dorian',     bpm:85,  prog:[[0,'min7',2],[3,'dom7',2]],
               why:'A two-chord loop with space in it. The drums carry the movement, so you leave room.' },
  EDM:       { groove:'EDM',     mode:'Aeolian',    bpm:128, prog:[[0,'min',1],[5,'maj',1],[2,'maj',1],[6,'maj',1]],
               why:'i–♭VI–♭III–♭VII — the minor loop that never resolves, which is why it can run forever.' },
  Swancore:  { groove:'Rock',    mode:'Lydian',     bpm:150, prog:[[0,'maj7',2],[1,'maj',2]],
               why:'1maj7 to a MAJOR 2. Bright, unresolved, and it never touches the natural 4.' },

  // ── Psychedelic ───────────────────────────────────────────────────────────
  // Psychedelia is modal, not functional: instead of chords pulling you somewhere,
  // one sound is held open and the MODE supplies all the colour. That is why these
  // three have so few chords — the harmony is not where the movement lives.
  'Psych Drone': { groove:'Psych', mode:'Mixolydian', bpm:95, prog:[[0,'dom7',4]],
               why:'ONE chord for the whole loop. With nothing changing underneath, the mode IS the harmony — every note you choose is the entire story. The ♭7 is what stops it sounding like a major key sitting still.' },
  'Psych Swirl': { groove:'Psych', mode:'Dorian',     bpm:110, prog:[[0,'min7',2],[3,'maj',2]],
               why:'The minor-with-a-bright-4 seesaw: i7 rocking to a MAJOR IV and back, forever. It never resolves because there is nothing to resolve to — that suspension is the whole feeling.' },
  'Raga Rock':   { groove:'Psych', mode:'Phrygian',   bpm:85, prog:[[0,'min',3],[1,'maj',1]],
               why:'A held minor root with the ♭2 leaning on it. That semitone above the root is the entire eastern colour — three bars of drone earn the one bar where it lands.' },
};
export const GENRE_NAMES = Object.keys(GENRES);

// A genre chord is allowed to leave the scale — blues makes every chord dominant,
// the Andalusian V is major where the mode says minor. Forcing the quality is the
// honest way to say "this idiom borrows" instead of pretending it is diatonic.
export function genreChords(genreName, root) {
  const g = GENRES[genreName];
  if (!g) return [];
  const ints = SCALE_TYPES.Modes[g.mode];
  const rootPc = NOTES.indexOf(toSharp(root));
  if (!ints || rootPc < 0) return [];
  return g.prog.map(([deg, q, bars]) => {
    const semis = FORCED[q] || [0, 4, 7];
    const rpc = (rootPc + ints[deg]) % 12;
    return {
      root: NOTES[rpc],
      notes: semis.map(s => NOTES[(rpc + s) % 12]),
      quality: (q === 'min' || q === 'min7') ? 'Minor' : 'Major',
      label: NOTES[rpc] + SUFFIX[q],
      bars,
    };
  });
}
