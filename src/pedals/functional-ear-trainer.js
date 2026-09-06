// ════════════════════════════════════════════════════════════════════
//  Functional Ear Trainer — the merge of Ear Trainer + Note Quiz.
//  One pedal, two groups: EAR (recognise sound → name) and THEORY
//  (know the fretboard + how chords function). Ported natively so the
//  fretboard-answer + overlay paths are wired correctly (the originals
//  referenced updateOverlays/lastClickedNote/getNoteAtFret/onFretboardClick
//  as bare globals and silently threw on those paths).
// ════════════════════════════════════════════════════════════════════
import { NOTES, KEY_PATTERNS, intervalLabel, getKeyChords, CHORD_TYPES, SCALE_TYPES, getChordNotes } from '../core/music-theory.js';
import { customTuning, getNoteAtFret, getInst } from '../core/tuning.js';
import { audio, playClickedNote } from '../core/audio.js';
import { updateOverlays, setLastClickedNote } from '../ui/fretboard.js';
import { setFretboardClickHandler } from '../main.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { FIFTHS, pcColor, pcTextOn } from '../core/colors.js';
import { CHORD_FAMILIES, buildChord, slashVoicingSpec } from '../harmony/chord-vocabulary.js';
import { setChordHighlight, clearChordHighlight } from '../core/state.js';
import { bus } from '../core/mixer.js';

// ── Static data ──────────────────────────────────────────────────────
const INTERVALS_EASY = [[0,'Unison'],[3,'m3'],[4,'M3'],[5,'P4'],[7,'P5'],[12,'Octave']];
const INTERVALS_MED  = [[0,'Unison'],[1,'m2'],[2,'M2'],[3,'m3'],[4,'M3'],[5,'P4'],[7,'P5'],[8,'m6'],[9,'M6'],[12,'Octave']];
const INTERVALS_HARD = [[0,'Unison'],[1,'m2'],[2,'M2'],[3,'m3'],[4,'M3'],[5,'P4'],[6,'TT'],[7,'P5'],[8,'m6'],[9,'M6'],[10,'m7'],[11,'M7'],[12,'Octave']];
const CHORD_TYPES_EAR = [
  { name:'Major', intervals:[0,4,7] }, { name:'Minor', intervals:[0,3,7] },
  { name:'Dim', intervals:[0,3,6] }, { name:'Aug', intervals:[0,4,8] },
  { name:'Maj7', intervals:[0,4,7,11] }, { name:'Min7', intervals:[0,3,7,10] }, { name:'Dom7', intervals:[0,4,7,10] },
];
const KEY_SIG_DATA = [
  {key:'C',type:'Major',sharps:0,flats:0},{key:'G',type:'Major',sharps:1,flats:0},{key:'D',type:'Major',sharps:2,flats:0},
  {key:'A',type:'Major',sharps:3,flats:0},{key:'E',type:'Major',sharps:4,flats:0},{key:'B',type:'Major',sharps:5,flats:0},
  {key:'F#',type:'Major',sharps:6,flats:0},{key:'F',type:'Major',sharps:0,flats:1},{key:'Bb',type:'Major',sharps:0,flats:2},
  {key:'Eb',type:'Major',sharps:0,flats:3},{key:'Ab',type:'Major',sharps:0,flats:4},{key:'Db',type:'Major',sharps:0,flats:5},
  {key:'A',type:'Minor',sharps:0,flats:0},{key:'E',type:'Minor',sharps:1,flats:0},{key:'B',type:'Minor',sharps:2,flats:0},
  {key:'D',type:'Minor',sharps:0,flats:1},{key:'G',type:'Minor',sharps:0,flats:2},{key:'C',type:'Minor',sharps:0,flats:3},
];
const NUMERALS_MAJ = ['I','ii','iii','IV','V','vi','vii°'];
const NUMERALS_MIN = ['i','ii°','III','iv','v','VI','VII'];
const DEGREE_NAMES = ['1st','2nd','3rd','4th','5th','6th','7th'];
const INTERVAL_NAMES = [[0,'Unison'],[1,'m2'],[2,'M2'],[3,'m3'],[4,'M3'],[5,'P4'],[6,'TT'],[7,'P5'],[8,'m6'],[9,'M6'],[10,'m7'],[11,'M7'],[12,'Octave']];

// A token name, not a colour: every ACCENT slot below resolves to whatever the
// card is wearing.
const ACCENT = 'var(--rk-accent)';
const THEORY_PANEL = {
  ear: {
    kicker: 'EAR', title: 'Ear training — connecting sound to name',
    what: `Recognise what you <b>hear</b>: single notes, the distance between two notes (<b>intervals</b>), chord qualities, and short melodies. Answer by <i>playing it</i> (mic on), clicking the fretboard, or tapping a button.`,
    why: `This is the skill that lets you play what's in your head, figure out songs by ear, and improvise with intention instead of guessing. Intervals are the atoms — once <b>P5</b> or <b>M3</b> has a sound to you, melodies stop being mysterious.`,
    lessonId: 'what-is-an-interval',
  },
  theory: {
    kicker: 'THEORY', title: 'Functional theory — knowing the map',
    what: `Fast recall of the map: <b>find/name</b> notes on the neck, <b>key signatures</b> (how many sharps/flats), <b>chord function</b> (what is the IV in G?), <b>scale degrees</b>, and <b>interval</b> naming — against the clock.`,
    why: `When the fretboard and the number system are automatic, you can transpose a song on the fly, comp from a chord chart, and target the right notes in a solo without stopping to think. Speed here frees your ears and hands for music.`,
    lessonId: 'scale-degree-names',
  },
};

const EAR_MODES = [
  ['note','Note Match'], ['interval','Interval ID'], ['intervalPlay','Interval Play'], ['chord','Chord ID'], ['melody','Melody Echo'],
];
const THEORY_MODES_R1 = [['find','🔊 Find'], ['name','📍 Name'], ['bassid','🎸 Bass ID']];
const THEORY_MODES_R2 = [['keysig','Key Sig'], ['chordfn','Chord Fn'], ['degree','Degrees'], ['ivlname','Intervals'], ['resolve','🎯 Resolve'], ['colour','🌈 Colour'], ['tension','🌡 Tension'], ['build','🎸 Build It']];

// These two reveal a full explanation, so they wait for the learner to tap NEXT
// instead of auto-advancing — reading the reveal IS the lesson.
const REVEAL_HOLD = ['tension', 'build'];

// 🎸 Build It targets. Small, high-mileage set: the shapes worth having in the hands.
const BUILD_TRIADS = [['Major','major triad'], ['Minor','minor triad'], ['Dim','diminished triad']];
const BUILD_WIDE = [
  { kind:'chord', type:'Maj7',     name:'major 7th' },
  { kind:'chord', type:'7 (Dom)',  name:'dominant 7th' },
  { kind:'chord', type:'Min7',     name:'minor 7th' },
  { kind:'scale', type:'Minor Pent.', name:'minor pentatonic' },
  { kind:'scale', type:'Major Pent.', name:'major pentatonic' },
];
// Fretboard overlay palette for the Build It reveal — the neck's language,
// deliberately not a token (core/colors.js owns the note spectrum itself).
const BUILD_COLORS = { root:'#66cc88', tone:'#1f4a30', rootStroke:'#a6f0c0', toneStroke:'#4a9a6a' };

function playTone(freq, dur, type, vol) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.value = vol || 0.3;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.5));
    o.connect(g); g.connect(bus(ctx, 'notes')); o.start(); o.stop(ctx.currentTime + (dur || 0.5));
  } catch (e) {}
}
const noteToFreq = (note, oct) => 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (oct - 4));
const pick = a => a[Math.floor(Math.random() * a.length)];

// A chord as a quick upward spread, the way a strum arrives. Intervals stay literal
// (9 = 14, 13 = 21) so an extension sounds in its own octave instead of collapsing
// into a 2nd or a 6th against the root — the whole reason it feels like tension.
function playSpread(root, intervals, oct, gap) {
  const base = noteToFreq(root, oct);
  intervals.forEach((iv, i) => setTimeout(() => playTone(base * Math.pow(2, iv / 12), 1.1, 'sine', 0.19), i * (gap || 80)));
}
// Slash members are authored bass-first: the bass note alone underneath, its triad
// stacked above. Voiced any other way they lose the sound their tension is rated on.
function slashVoicing(root, type) {
  const spec = slashVoicingSpec(type, root);
  if (!spec) return { root, intervals: [0, 4, 7], oct: 3 };
  const tri = spec.upperQual === 'min' ? [0, 3, 7] : spec.upperQual === 'dim' ? [0, 3, 6] : [0, 4, 7];
  return { root: spec.bass, intervals: [0, ...tri.map(t => 12 + spec.upperSemis + t)], oct: 2 };
}

export function buildFunctionalEarContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});

  let group   = s.fetGroup || (p.type === 'notequiz' ? 'theory' : 'ear');
  // EAR state
  let earMode = s.earMode || 'note';
  let earDiff = s.earDiff || 'easy';
  let melodyIdx = 0;
  // THEORY state
  let quizMode = s.quizMode || 'find';
  let zone = s.quizZone || 'all';
  let stringFocus = s.quizStrings || 'all';
  let timeLimit = s.quizTime || 30;
  let buildSize = s.buildSize || 'triad';
  let running = false, timeLeft = 0, timerIntv = null;
  let litNeck = false;   // did WE light the neck? never clear another pedal's highlight
  // shared
  let question = null, answered = false, feedback = '';
  let score = { correct: 0, wrong: 0, streak: 0, best: 0 };
  let bestScores = {};
  try { const raw = localStorage.getItem('resonote-notequiz'); if (raw) bestScores = JSON.parse(raw); } catch (e) {}

  const alive = () => !!document.getElementById(`body-${p.id}`);

  // ── EAR engine ─────────────────────────────────────────────────────
  const earIntervalSet = () => earDiff === 'easy' ? INTERVALS_EASY : earDiff === 'medium' ? INTERVALS_MED : INTERVALS_HARD;
  const randOct = () => earDiff === 'easy' ? 3 : 2 + Math.floor(Math.random() * 2);

  function genEarQuestion() {
    answered = false; feedback = ''; melodyIdx = 0;
    const rn = pick(NOTES), oct = randOct();
    if (earMode === 'note') {
      question = { type: 'note', note: rn, octave: oct };
      setLastClickedNote(null); updateOverlays();
      setTimeout(() => playTone(noteToFreq(rn, oct), 0.6), 200);
    } else if (earMode === 'interval' || earMode === 'intervalPlay') {
      const set = earMode === 'intervalPlay' ? earIntervalSet().filter(x => x[0] > 0) : earIntervalSet();
      const ivl = pick(set);
      const note2 = NOTES[(NOTES.indexOf(rn) + ivl[0]) % 12];
      const oct2 = oct + Math.floor((NOTES.indexOf(rn) + ivl[0]) / 12);
      question = { type: earMode, note1: rn, oct1: oct, semitones: ivl[0], name: ivl[1], note2, oct2 };
      setLastClickedNote({ note: rn, octave: oct }); updateOverlays();
      setTimeout(() => { playTone(noteToFreq(rn, oct), 0.5); setTimeout(() => playTone(noteToFreq(note2, oct2), 0.5), 600); }, 200);
    } else if (earMode === 'chord') {
      const ct = pick(earDiff === 'easy' ? CHORD_TYPES_EAR.slice(0, 4) : CHORD_TYPES_EAR);
      question = { type: 'chord', root: rn, octave: oct, chordType: ct };
      setLastClickedNote(null); updateOverlays();
      setTimeout(() => ct.intervals.forEach((iv, i) => {
        const n2 = NOTES[(NOTES.indexOf(rn) + iv) % 12], o2 = oct + Math.floor((NOTES.indexOf(rn) + iv) / 12);
        setTimeout(() => playTone(noteToFreq(n2, o2), 0.8, 'sine', 0.2), i * 30);
      }), 200);
    } else if (earMode === 'melody') {
      const len = earDiff === 'easy' ? 3 : earDiff === 'medium' ? 4 : 5;
      const notes2 = []; let cn = rn;
      for (let i = 0; i < len; i++) { notes2.push({ note: cn, octave: oct }); const jump = pick([-2,-1,0,1,2,3,4,5]); cn = NOTES[((NOTES.indexOf(cn) + jump) % 12 + 12) % 12]; }
      question = { type: 'melody', notes: notes2, answered: [] };
      setLastClickedNote({ note: notes2[0].note, octave: notes2[0].octave }); updateOverlays();
      setTimeout(() => notes2.forEach((n, i) => setTimeout(() => playTone(noteToFreq(n.note, n.octave), 0.4), i * 500)), 200);
    }
    render();
  }
  const win = () => { score.correct++; score.streak++; score.best = Math.max(score.best, score.streak); feedback = 'correct'; };
  const lose = () => { score.wrong++; score.streak = 0; feedback = 'wrong'; };

  function answerEarNote(note) {
    if (answered || !question) return;
    if (earMode === 'note') { answered = true; (note === question.note ? win : lose)(); setTimeout(genEarQuestion, 1200); }
    else if (earMode === 'intervalPlay') { answered = true; (note === question.note2 ? win : lose)(); setTimeout(genEarQuestion, 1200); }
    else if (earMode === 'melody') {
      const exp = question.notes[melodyIdx];
      if (note === exp.note) {
        question.answered.push(note); melodyIdx++; feedback = 'correct';
        if (melodyIdx >= question.notes.length) { answered = true; win(); setTimeout(genEarQuestion, 1200); }
      } else { answered = true; lose(); setTimeout(genEarQuestion, 1200); }
    }
    render();
  }
  function answerEarInterval(semi) { if (answered || !question || question.type !== 'interval') return; answered = true; (semi === question.semitones ? win : lose)(); render(); setTimeout(genEarQuestion, 1200); }
  function answerEarChord(name) { if (answered || !question || question.type !== 'chord') return; answered = true; (name === question.chordType.name ? win : lose)(); render(); setTimeout(genEarQuestion, 1200); }

  function replayEar() {
    if (!question) return;
    if (question.type === 'note') playTone(noteToFreq(question.note, question.octave), 0.6);
    else if (question.type === 'interval' || question.type === 'intervalPlay') { playTone(noteToFreq(question.note1, question.oct1), 0.5); setTimeout(() => playTone(noteToFreq(question.note2, question.oct2), 0.5), 600); }
    else if (question.type === 'chord') question.chordType.intervals.forEach((iv, i) => { const n2 = NOTES[(NOTES.indexOf(question.root) + iv) % 12], o2 = question.octave + Math.floor((NOTES.indexOf(question.root) + iv) / 12); setTimeout(() => playTone(noteToFreq(n2, o2), 0.8, 'sine', 0.2), i * 30); });
    else if (question.type === 'melody') question.notes.forEach((n, i) => setTimeout(() => playTone(noteToFreq(n.note, n.octave), 0.4), i * 500));
  }

  // ── THEORY engine ──────────────────────────────────────────────────
  const fretRange = () => zone === 'open' ? [0, 4] : zone === 'mid' ? [5, 9] : zone === 'upper' ? [10, 15] : [0, Math.min(15, customTuning.length > 4 ? 15 : 12)];
  const stringRange = () => stringFocus === 'all' ? customTuning.map((_, i) => i) : [parseInt(stringFocus)];
  // Piano, Lumatone and vocals have no strings or frets: there the question is a
  // pitch, not a place, and the zone picker / "str N fret M" copy have nothing to
  // point at (customTuning is empty on those boards, so the old path also threw).
  const keyed = () => getInst().renderer !== 'fretboard';

  function nextTheoryQuestion() {
    answered = false; feedback = '';
    if (quizMode === 'find' || quizMode === 'name') {
      let note, octave, si, fret;
      if (keyed()) {
        // Octaves 3–4 sit inside every keyed board (piano C2–C5, both hex
        // layouts wider), so the lit key is always actually on screen.
        note = pick(NOTES); octave = pick([3, 4]);
      } else {
        const [fMin, fMax] = fretRange(); si = pick(stringRange()); fret = fMin + Math.floor(Math.random() * (fMax - fMin + 1));
        ({ note, octave } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret));
      }
      question = { mode: quizMode, note, octave, si, fret };
      if (quizMode === 'find') playClickedNote(note, octave);
      else { setLastClickedNote({ note, octave, si, fret }); updateOverlays(); }
    } else if (quizMode === 'keysig') {
      const ks = pick(KEY_SIG_DATA), askDir = Math.random() > 0.5, accCount = ks.sharps || ks.flats, accType = ks.sharps ? 'sharps' : 'flats';
      if (askDir) question = { mode: 'keysig', prompt: `How many sharps/flats in ${ks.key} ${ks.type}?`, answer: `${accCount} ${accCount === 0 ? '(none)' : accType}`, answerVal: accCount, ks };
      else if (accCount === 0) question = { mode: 'keysig', prompt: `Which major key has no sharps or flats?`, answer: `${ks.key} ${ks.type}`, answerVal: ks.key, ks };
      else question = { mode: 'keysig', prompt: `Which ${ks.type.toLowerCase()} key has ${accCount} ${accType}?`, answer: `${ks.key} ${ks.type}`, answerVal: ks.key, ks };
    } else if (quizMode === 'chordfn') {
      const isMajor = Math.random() > 0.4, kt = isMajor ? 'Major' : 'Minor', rootKey = pick(NOTES);
      const chords = getKeyChords(rootKey, kt), idx = Math.floor(Math.random() * chords.length), ch = chords[idx], nums = isMajor ? NUMERALS_MAJ : NUMERALS_MIN, askDir = Math.random() > 0.5;
      if (askDir) question = { mode: 'chordfn', prompt: `What is the ${nums[idx]} chord in ${rootKey} ${kt}?`, answer: ch.root + (ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ''), answerNote: ch.root, chords, idx };
      else { const ql = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : '+'; question = { mode: 'chordfn', prompt: `What is ${ch.root}${ql} in the key of ${rootKey} ${kt}?`, answer: nums[idx], answerIdx: idx, chords, nums }; }
    } else if (quizMode === 'degree') {
      const isMajor = Math.random() > 0.4, kt = isMajor ? 'Major' : 'Minor', rootKey = pick(NOTES), pat = KEY_PATTERNS[kt];
      const deg = Math.floor(Math.random() * 7), noteAtDeg = NOTES[(NOTES.indexOf(rootKey) + pat.intervals[deg]) % 12], askDir = Math.random() > 0.5;
      if (askDir) question = { mode: 'degree', prompt: `What is the ${DEGREE_NAMES[deg]} degree of ${rootKey} ${kt}?`, answer: noteAtDeg, rootKey, kt, deg };
      else question = { mode: 'degree', prompt: `What degree is ${noteAtDeg} in ${rootKey} ${kt}?`, answer: DEGREE_NAMES[deg], answerDeg: deg, rootKey, kt };
    } else if (quizMode === 'ivlname') {
      const n1 = pick(NOTES), ivl = pick(INTERVAL_NAMES.filter(x => x[0] > 0)), n2 = NOTES[(NOTES.indexOf(n1) + ivl[0]) % 12], askDir = Math.random() > 0.5;
      if (askDir) question = { mode: 'ivlname', prompt: `What interval is ${n1} to ${n2}?`, answer: ivl[1], semitones: ivl[0] };
      else question = { mode: 'ivlname', prompt: `Go a ${ivl[1]} up from ${n1}. What note?`, answer: n2, semitones: ivl[0], startNote: n1 };
    } else if (quizMode === 'resolve') {
      // (absorbed from the retired Melody Lab) a scale tension over a chord pulls to its
      // NEAREST chord tone — half steps pull hardest, downward wins ties.
      const rootKey = pick(NOTES);
      const chords = getKeyChords(rootKey, 'Major');
      const idx = pick([0, 1, 2, 3, 4, 5]);            // skip vii° — clean triads only
      const ch = chords[idx];
      const chordPcs = [0, ch.quality === 'Minor' ? 3 : 4, 7].map(iv => (NOTES.indexOf(ch.root) + iv) % 12);
      const scalePcs = KEY_PATTERNS.Major.intervals.map(iv => (NOTES.indexOf(rootKey) + iv) % 12);
      const tPc = pick(scalePcs.filter(pc2 => !chordPcs.includes(pc2)));
      let best = chordPcs[0], bd = 99;
      chordPcs.forEach(cp => {
        const up = ((cp - tPc) % 12 + 12) % 12, dn = ((tPc - cp) % 12 + 12) % 12, d = Math.min(up, dn);
        if (d < bd || (d === bd && dn < up)) { bd = d; best = cp; }
      });
      const ql = ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : '';
      question = { mode: 'resolve', prompt: `In ${rootKey} major, over ${ch.root}${ql} (the ${NUMERALS_MAJ[idx]}): the tension ${NOTES[tPc]} pulls to which chord tone?`, answer: NOTES[best], tones: chordPcs.map(pc2 => NOTES[pc2]) };
      setTimeout(() => {   // hear it: the chord, then the tension hanging over it
        chordPcs.forEach((pc2, i) => setTimeout(() => playTone(noteToFreq(NOTES[pc2], 3), 0.9, 'sine', 0.2), i * 30));
        setTimeout(() => playTone(noteToFreq(NOTES[tPc], 4), 0.7, 'sine', 0.28), 750);
      }, 200);
    } else if (quizMode === 'bassid') {
      // inversion hearing — the slash-chord ear skill: a triad rings in close position,
      // one of its own members sits alone in the bass. Which member is lowest?
      const rootN = pick(NOTES);
      const minor = Math.random() < 0.5;
      const iv = minor ? [0, 3, 7] : [0, 4, 7];
      const memberIdx = pick([0, 1, 2]);
      const names = ['Root', '3rd', '5th'];
      const base = noteToFreq(rootN, 3);
      const bassFreq = noteToFreq(rootN, 2) * Math.pow(2, iv[memberIdx] / 12);
      question = { mode: 'bassid', prompt: `A ${rootN}${minor ? 'm' : ''} triad rings with one of its own notes alone in the bass. Which member is lowest?`, answer: names[memberIdx], opts: names };
      setTimeout(() => {   // bass alone first, then the close triad lands above it
        playTone(bassFreq, 1.2, 'sine', 0.34);
        setTimeout(() => iv.forEach((x, i) => setTimeout(() => playTone(base * Math.pow(2, x / 12), 0.9, 'sine', 0.17), i * 30)), 500);
      }, 200);
    } else if (quizMode === 'colour') {
      // RETRIEVAL of the colour code: a note sounds, you answer with its COLOUR.
      // Making the colour the response modality is what turns the palette from
      // wallpaper into fluency — recall, not recognition.
      const n = pick(NOTES), oct = pick([3, 4]);
      question = { mode: 'colour', prompt: `Which colour is this note?`, answer: n, note: n, octave: oct, colourAnswer: true };
      setTimeout(() => playTone(noteToFreq(n, oct), 1.0, 'triangle', 0.3), 200);
    } else if (quizMode === 'tension') {
      // The guess is locked in while the true value is still hidden. That's the point:
      // it trains the accuracy of your own readout, which is what lets you practise
      // without the app. Family first, then member — otherwise the 17-member slash
      // family would own half the pool.
      const fam = pick(CHORD_FAMILIES), mem = pick(fam.members), root = pick(NOTES);
      const ch = buildChord(root, mem.cat, mem.type);
      const v = mem.cat === 'Slash' ? slashVoicing(root, mem.type) : { root, intervals: ch.intervals, oct: 3 };
      question = {
        mode: 'tension', prompt: `How much pull does this chord have?`,
        chord: ch, why: mem.why, family: `${fam.icon} ${fam.label}`, accent: fam.accent,
        truth: Math.round(mem.tension * 100), guess: 50, delta: 0, voicing: v,
      };
      setTimeout(() => playSpread(v.root, v.intervals, v.oct), 200);
    } else if (quizMode === 'build') {
      // Nothing is lit while they work — if the shape is already on the neck there is
      // nothing left to build, and it's the building that sticks.
      if (litNeck) { clearChordHighlight(); litNeck = false; }
      setLastClickedNote(null); updateOverlays();
      const root = pick(NOTES);
      let target, label, prompt;
      if (buildSize === 'triad') {
        const [type, name] = pick(BUILD_TRIADS);
        target = getChordNotes(root, CHORD_TYPES['Triads'][type]);
        label = `${root} ${name}`;
        prompt = `Place a ${root} ${name} — tap its notes on the neck`;
      } else {
        const t = pick(BUILD_WIDE);
        target = getChordNotes(root, t.kind === 'chord' ? CHORD_TYPES['7ths'][t.type] : SCALE_TYPES['Pentatonic'][t.type]);
        label = `${root} ${t.name}`;
        prompt = t.kind === 'chord'
          ? `Place a ${root} ${t.name} — tap its notes on the neck`
          : `Place the notes of ${root} ${t.name} — one position is enough`;
      }
      question = { mode: 'build', prompt, root, label, target: [...new Set(target)], taps: [] };
    }
    render();
  }

  function checkTheoryAnswer(ans) {
    if (answered || !question) return;
    answered = true;
    const q = question; let correct = false;
    if (q.mode === 'keysig') correct = (q.answerVal !== undefined) ? ('' + ans) === ('' + q.answerVal) : (ans === q.answerVal || ans === q.answer);
    else if (q.mode === 'chordfn') correct = q.answerNote ? ans === q.answerNote : (q.answerIdx !== undefined ? parseInt(ans) === q.answerIdx : ans === q.answer);
    else if (q.mode === 'degree') correct = (q.answerDeg !== undefined) ? parseInt(ans) === q.answerDeg : ans === q.answer;
    else if (q.mode === 'ivlname') correct = ans === q.answer;
    else if (q.mode === 'resolve') correct = ans === q.answer;
    else if (q.mode === 'bassid') correct = ans === q.answer;
    else if (q.mode === 'colour') correct = ans === q.answer;
    else if (q.mode === 'tension') { q.guess = parseInt(ans); q.delta = Math.abs(q.guess - q.truth); correct = q.delta <= 15; }
    else if (q.mode === 'build') {
      q.got    = q.target.filter(n => q.taps.includes(n));
      q.missed = q.target.filter(n => !q.taps.includes(n));
      q.extra  = q.taps.filter(n => !q.target.includes(n));
      correct = !q.missed.length && !q.extra.length;
      setLastClickedNote(null);   // now light it: seeing the real shape against your attempt is the teaching moment
      setChordHighlight(q.root, q.target, q.label, null, BUILD_COLORS); litNeck = true;
      updateOverlays();
    }
    (correct ? win : lose)();
    render();
    if (!REVEAL_HOLD.includes(q.mode)) setTimeout(() => { if (running) nextTheoryQuestion(); }, 1000);
  }
  function addBuildNote(note) {
    if (answered || !question || question.mode !== 'build') return;
    const i = question.taps.indexOf(note);   // tapping a note you already placed takes it back
    if (i >= 0) question.taps.splice(i, 1); else question.taps.push(note);
    render();
  }
  function checkFindAnswer(info) {
    if (answered || !question || question.mode !== 'find') return;
    answered = true;
    if (info.note === question.note) { win(); setLastClickedNote({ note: question.note, octave: question.octave, si: question.si, fret: question.fret }); updateOverlays(); }
    else lose();
    render();
    setTimeout(() => { if (running) nextTheoryQuestion(); }, 800);
  }
  function checkNameAnswer(note) {
    if (answered || !question || question.mode !== 'name') return;
    answered = true; (note === question.note ? win : lose)();
    render(); setTimeout(() => { if (running) nextTheoryQuestion(); }, 800);
  }

  function startRound() {
    score = { correct: 0, wrong: 0, streak: 0, best: 0 };
    timeLeft = timeLimit; running = true;
    setFretboardClickHandler(info => {
      if (!running || !question) return;
      if (quizMode === 'find') checkFindAnswer(info);
      else if (quizMode === 'build') addBuildNote(info.note);
    });
    nextTheoryQuestion();
    timerIntv = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) { endRound(); return; }
      // A live slider drag must survive the clock, so tension patches the timer in
      // place rather than rewriting the body out from under the learner's finger.
      if (quizMode === 'tension' && question && !answered) tickInPlace(); else render();
    }, 1000);
  }
  function tickInPlace() {
    const bar = el.querySelector('.fet-tbar'), secs = el.querySelector('.fet-tsecs');
    if (!bar && !secs) { render(); return; }
    // The same ladder render() paints the bar with, so patching in place can never
    // disagree with a full redraw: calm accent, warming, then the wrong-answer rose.
    const col = timeLeft <= 5 ? 'var(--rk-bad)' : timeLeft <= 10 ? 'var(--rk-hot)' : ACCENT;
    if (bar) { bar.style.width = (timeLeft / timeLimit) * 100 + '%'; bar.style.background = col; }
    if (secs) { secs.textContent = `${timeLeft}s`; secs.style.color = col; }
  }
  function endRound() {
    running = false; clearInterval(timerIntv); timerIntv = null;
    setFretboardClickHandler(null); setLastClickedNote(null);
    if (litNeck) { clearChordHighlight(); litNeck = false; }
    updateOverlays();
    const key = `${quizMode}-${zone}-${timeLimit}`;
    if (!bestScores[key] || score.correct > bestScores[key]) bestScores[key] = score.correct;
    try { localStorage.setItem('resonote-notequiz', JSON.stringify(bestScores)); } catch (e) {}
    render();
  }

  // ── Shared input: mic + fretboard ──────────────────────────────────
  audio.on(() => {
    if (!alive() || answered) return;
    const det = audio.detected; if (!det) return;
    if (group === 'ear') { if (question && (earMode === 'note' || earMode === 'intervalPlay' || earMode === 'melody')) answerEarNote(det.note); }
    else if (running && question && quizMode === 'find') checkFindAnswer({ note: det.note });
  });
  // EAR fretboard answers (THEORY uses its own handler set in startRound)
  function setEarFretboard() {
    setFretboardClickHandler(info => {
      if (group !== 'ear' || answered || !question) return;
      if (earMode === 'note' || earMode === 'intervalPlay' || earMode === 'melody') answerEarNote(info.note);
    });
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const fb = c => c === 'correct' ? 'var(--rk-ok)' : 'var(--rk-bad)';
    // No accent named here — the card supplies it, so EAR and THEORY (and every
    // drill inside them) cannot drift apart the way they used to.
    let h = `<div class="rk rk-fet">`;

    // Group toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn fet-group${group === 'ear' ? ' is-active' : ''}" data-g="ear" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:7px 0">🎧 EAR</button>
      <button class="rk-seg-btn fet-group${group === 'theory' ? ' is-active' : ''}" data-g="theory" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:7px 0">🧠 THEORY</button>
    </div>`;

    h += `<div style="font-size:calc(9.5px*var(--ui));line-height:1.45;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid ${ACCENT};padding:6px 8px;border-radius:4px">${group === 'ear'
      ? 'Recognise what you <b>hear</b> — single notes, intervals, chord qualities and short melodies. Answer by playing, clicking the fretboard, or tapping.'
      : 'Fast recall against the clock — <b>find/name</b> notes on the neck, key signatures, chord function, scale degrees and intervals.'}</div>`;

    if (group === 'ear') {
      // mode + difficulty
      h += `<div class="rk-section"><div class="rk-label">MODE</div><div class="rk-seg" style="gap:3px">`;
      EAR_MODES.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-earmode${earMode === m ? ' is-active' : ''}" data-em="${m}" style="min-height:calc(28px*var(--ui));flex:1;min-width:48px;font-size:calc(10px*var(--ui));padding:5px 2px">${label}</button>`);
      h += `</div><div class="rk-seg" style="gap:3px;margin-top:5px">`;
      [['easy','Easy'],['medium','Medium'],['hard','Hard']].forEach(([d, label]) => h += `<button class="rk-seg-btn fet-eardiff${earDiff === d ? ' is-active' : ''}" data-ed="${d}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:4px 10px">${label}</button>`);
      h += `</div></div>`;
      // score
      const pct = (score.correct + score.wrong) ? Math.round(score.correct / (score.correct + score.wrong) * 100) : 0;
      h += `<div style="display:flex;align-items:center;justify-content:center;gap:12px"><span class="mono" style="color:var(--rk-ok);font-size:calc(11px*var(--ui));font-weight:700">${score.correct}/${score.correct + score.wrong}</span><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${pct}%</span><span class="mono" style="color:var(--rk-dim);font-size:calc(9px*var(--ui));font-weight:700">🔥${score.streak}</span>${score.best ? `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">best ${score.best}</span>` : ''}</div>`;
      // question card
      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:10px;text-align:center;min-height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">`;
      if (!question) h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">Press START to begin</div>`;
      else if (earMode === 'note') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">What note is this?</div><div class="mono" style="color:${ACCENT};font-size:calc(9px*var(--ui))">Play it or click the fretboard</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ It was ' + question.note}</div>`; h += replayBtn(); }
      else if (earMode === 'interval') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">Name this interval</div><div class="mono" style="color:${ACCENT};font-size:calc(11px*var(--ui))">Starting from ${question.note1}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓ ' + question.name : '✗ It was ' + question.name}</div>`; h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">` + earIntervalSet().map(([semi, name]) => `<button class="rk-chip fet-earivl" data-semi="${semi}" style="min-height:calc(28px*var(--ui));font-size:calc(8px*var(--ui));padding:3px 7px">${name}</button>`).join('') + `</div>` + replayBtn(); }
      else if (earMode === 'intervalPlay') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">Play the second note</div><div class="mono" style="color:${ACCENT};font-size:calc(11px*var(--ui))">First: <b style="color:var(--rk-accent)">${question.note1}</b> · ${question.name}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓ ' + question.note2 : '✗ It was ' + question.note2}</div>`; h += replayBtn(); }
      else if (earMode === 'chord') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">What type of chord?</div><div class="mono" style="color:${ACCENT};font-size:calc(11px*var(--ui))">Root: ${question.root}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓ ' + question.chordType.name : '✗ It was ' + question.chordType.name}</div>`; const chSet = earDiff === 'easy' ? CHORD_TYPES_EAR.slice(0, 4) : CHORD_TYPES_EAR; h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">` + chSet.map(ct => `<button class="rk-chip fet-earch" data-ct="${ct.name}" style="min-height:calc(28px*var(--ui));font-size:calc(8px*var(--ui));padding:3px 7px">${ct.name}</button>`).join('') + `</div>` + replayBtn(); }
      else if (earMode === 'melody') { const len = question.notes.length; h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">Play back the melody (${melodyIdx}/${len})</div><div style="display:flex;gap:4px;justify-content:center">` + question.notes.map((n, i) => { const done = i < melodyIdx, cur = i === melodyIdx && !answered, col = done ? 'var(--rk-ok)' : cur ? 'var(--rk-hot)' : 'var(--rk-edge-soft)'; return `<div style="width:20px;height:20px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center">${done ? `<span class="mono" style="color:var(--rk-panel);font-size:calc(7px*var(--ui));font-weight:700">${n.note}</span>` : ''}</div>`; }).join('') + `</div>`; if (answered && feedback === 'wrong') h += `<div class="mono" style="color:var(--rk-bad);font-size:calc(10px*var(--ui));font-weight:700">✗ ${question.notes.map(n => n.note).join(' → ')}</div>`; else if (answered) h += `<div class="mono" style="color:var(--rk-ok);font-size:calc(14px*var(--ui));font-weight:900">✓ Perfect!</div>`; h += replayBtn(); }
      h += `</div>`;
      h += `<button class="rk-btn fet-earstart" style="min-height:calc(28px*var(--ui));width:100%">${question ? 'NEXT' : '▶ START'}</button>`;

    } else {
      // THEORY
      const isFret = (quizMode === 'find' || quizMode === 'name') && !keyed();   // zones are fret windows — meaningless on a keyed board
      const bestKey = `${quizMode}-${zone}-${timeLimit}`, bestScore = bestScores[bestKey] || 0;
      h += `<div class="rk-section"><div class="rk-label">DRILL</div><div class="rk-seg" style="gap:3px">`;
      THEORY_MODES_R1.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-qmode${quizMode === m ? ' is-active' : ''}" data-qm="${m}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:5px 2px">${label}</button>`);
      h += `</div><div class="rk-seg" style="gap:3px;margin-top:4px">`;
      // min-width so eight drills wrap onto a second line instead of squeezing to slivers
      THEORY_MODES_R2.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-qmode${quizMode === m ? ' is-active' : ''}" data-qm="${m}" style="min-height:calc(28px*var(--ui));flex:1;min-width:46px;font-size:calc(10px*var(--ui));padding:5px 2px">${label}</button>`);
      h += `</div></div>`;
      if (isFret) {
        h += `<div class="rk-seg" style="align-items:center;gap:3px"><span class="rk-label">ZONE</span>`;
        [['all','Full'],['open','0-4'],['mid','5-9'],['upper','10+']].forEach(([z, label]) => h += `<button class="rk-seg-btn fet-zone${zone === z ? ' is-active' : ''}" data-nz="${z}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:4px 2px">${label}</button>`);
        h += `</div>`;
      }
      if (quizMode === 'build') {
        h += `<div class="rk-seg" style="align-items:center;gap:3px"><span class="rk-label">SIZE</span>`;
        [['triad','Triad · 3'],['wide','7th / pent · 4-5']].forEach(([b, label]) => h += `<button class="rk-seg-btn fet-buildsize${buildSize === b ? ' is-active' : ''}" data-bs="${b}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:4px 2px">${label}</button>`);
        h += `</div>`;
      }
      h += `<div class="rk-seg" style="align-items:center;gap:3px"><span class="rk-label">TIME</span>`;
      [30, 60, 90].forEach(t => h += `<button class="rk-seg-btn fet-time${timeLimit === t ? ' is-active' : ''}" data-nt="${t}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:4px 9px">${t}s</button>`);
      if (bestScore > 0) h += `<span class="mono" style="color:var(--rk-dim);font-size:calc(9px*var(--ui));margin-left:auto">★ ${bestScore}</span>`;
      h += `</div>`;

      if (running) {
        const pct = (timeLeft / timeLimit) * 100, barColor = timeLeft <= 5 ? 'var(--rk-bad)' : timeLeft <= 10 ? 'var(--rk-hot)' : ACCENT;
        h += `<div style="background:var(--rk-panel);border-radius:4px;height:5px;overflow:hidden"><div class="fet-tbar" style="width:${pct}%;height:100%;background:${barColor};transition:width 1s linear"></div></div>`;
        h += `<div style="display:flex;align-items:center;justify-content:center;gap:10px"><span class="mono" style="color:${ACCENT};font-size:calc(18px*var(--ui));font-weight:900">${score.correct}</span>${score.wrong ? `<span class="mono" style="color:var(--rk-bad);font-size:calc(11px*var(--ui))">${score.wrong}✗</span>` : ''}<span class="mono" style="color:var(--rk-dim);font-size:calc(9px*var(--ui));font-weight:700">🔥${score.streak}</span><span class="mono fet-tsecs" style="color:${barColor};font-size:calc(13px*var(--ui));font-weight:900">${timeLeft}s</span></div>`;
        h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:9px;text-align:center;min-height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px">`;
        if (!question) h += `<div class="mono" style="color:var(--rk-ink-mute)">Loading…</div>`;
        else if (quizMode === 'find') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">Play or click this note:</div><div class="mono" style="color:${ACCENT};font-size:calc(26px*var(--ui));font-weight:900">${question.note}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(13px*var(--ui));font-weight:700">${feedback === 'correct' ? '✓' : keyed() ? '✗ it was ' + question.note + question.octave : '✗ str ' + (question.si + 1) + ' fret ' + question.fret}</div>`; h += `<button class="rk-chip fet-qreplay" style="min-height:calc(28px*var(--ui));font-size:calc(7px*var(--ui))">🔊 Replay</button>`; }
        else if (quizMode === 'name') { h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${keyed() ? 'What note is lit?' : `What note is on str ${question.si + 1} fret ${question.fret}?`}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ ' + question.note}</div>`; else h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center">` + NOTES.map(n => `<button class="rk-chip fet-qname" data-na="${n}" style="min-height:calc(28px*var(--ui));font-size:calc(8px*var(--ui));min-width:26px;padding:2px 4px">${n}</button>`).join('') + `</div>`; }
        else if (quizMode === 'colour') {
          h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:600;line-height:1.4">${question.prompt}</div>`;
          if (answered) {
            // reveal pairs the swatch WITH its letter — colour and name land together
            h += `<div style="display:flex;align-items:center;gap:7px;justify-content:center;margin:5px 0">
              <span style="width:30px;height:30px;border-radius:7px;background:${pcColor(question.answer, 78, 48)};border:1px solid ${pcColor(question.answer, 85, 68)};display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:calc(12px*var(--ui));font-weight:900;color:${pcTextOn(question.answer)}">${question.answer}</span>
              <span class="mono" style="color:${fb(feedback)};font-size:calc(15px*var(--ui));font-weight:900">${feedback === 'correct' ? '✓' : '✗'}</span></div>`;
          } else h += `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;margin-top:5px">${theoryOptions()}</div>`;
        }
        else if (quizMode === 'tension') {
          // The chord family's own saturated hue would fight the note code, so the
          // panel keeps the card's accent here too.
          const q = question, acc = ACCENT;
          h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${q.prompt}</div>`;
          h += `<div style="display:flex;align-items:center;gap:7px">
            <button class="rk-chip fet-treplay" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">🔊 Again</button>
            ${answered
              ? `<span class="mono" style="color:${acc};font-size:calc(13px*var(--ui));font-weight:800">${q.chord.name}</span><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${q.family}</span>`
              : `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">root ${q.chord.root}</span>`}</div>`;
          // the guess rides the track on its own; the truth marker only appears after the commit
          h += `<div style="width:100%;padding:0 3px;box-sizing:border-box">`;
          h += `<div style="position:relative;height:9px;border-radius:5px;background:linear-gradient(90deg,var(--rk-ok),var(--rk-dim),var(--rk-hot))">
            <span class="fet-tpin" style="position:absolute;left:${q.guess}%;top:-5px;width:3px;height:19px;border-radius:2px;background:var(--rk-ink);transform:translateX(-50%);box-shadow:0 0 5px rgba(0,0,0,.85)"></span>
            ${answered ? `<span style="position:absolute;left:${q.truth}%;top:-13px;transform:translateX(-50%);font-size:calc(11px*var(--ui));line-height:1;color:var(--rk-ink);text-shadow:0 0 4px rgba(0,0,0,.9)">▼</span>` : ''}</div>`;
          if (!answered) {
            h += `<input class="rk-slider fet-tslider" type="range" min="0" max="100" value="${q.guess}" style="--rk-fill:${q.guess}%">`;
            h += `<div class="rk-scale"><span>at rest</span><span class="mono fet-tval" style="color:${ACCENT};font-size:calc(10px*var(--ui));font-weight:700">${q.guess}</span><span>max pull</span></div>`;
          } else {
            h += `<div class="rk-scale" style="margin-top:6px;font-size:calc(8px*var(--ui))"><span>you said ${q.guess}</span><span style="color:${fb(feedback)};font-weight:700">${feedback === 'correct' ? '✓' : '✗'} off by ${q.delta}</span><span>it sits at ${q.truth}</span></div>`;
          }
          h += `</div>`;
          if (!answered) h += `<button class="rk-btn fet-tcommit" style="min-height:calc(28px*var(--ui));width:100%;padding:6px 0;font-size:calc(10px*var(--ui))">LOCK IT IN</button>`;
          else {
            h += `<div style="font-size:calc(10px*var(--ui));line-height:1.45;color:var(--rk-ink);text-align:left;background:var(--rk-soft);border-left:2px solid ${acc};padding:5px 7px;border-radius:4px">${q.why}</div>`;
            h += `<button class="rk-chip fet-qnext" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">NEXT →</button>`;
          }
        }
        else if (quizMode === 'build') {
          const q = question;
          h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:600;line-height:1.4">${q.prompt}</div>`;
          if (!answered) {
            h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui))">${q.taps.length}/${q.target.length} placed${q.taps.length ? ' · tap a chip to take it back' : ''}</div>`;
            // their answer builds up here, in the pedal — the neck stays dark
            h += `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;min-height:21px;align-items:center">`
              + (q.taps.map(n => `<button class="fet-buildchip" data-bn="${n}" title="take it back" style="min-height:calc(28px*var(--ui));min-width:24px;border-radius:6px;border:1px solid ${pcColor(n, 70, 62)};background:${pcColor(n, 74, 44)};color:${pcTextOn(n)};font-family:'JetBrains Mono',monospace;font-size:calc(9.5px*var(--ui));font-weight:800;padding:3px 6px;cursor:pointer">${n}</button>`).join('')
                 || `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">tap the neck</span>`)
              + `</div>`;
            h += `<button class="rk-btn fet-buildcheck" style="min-height:calc(28px*var(--ui));width:100%;padding:6px 0;font-size:calc(10px*var(--ui));${q.taps.length ? '' : 'opacity:.4'}">CHECK</button>`;
          } else {
            h += `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;align-items:center">`
              + q.target.map(n => { const got = q.got.includes(n); return `<span style="min-width:24px;border-radius:6px;border:1px solid ${got ? 'var(--rk-ok)' : 'var(--rk-bad)'};background:${pcColor(n, 74, 44)};color:${pcTextOn(n)};font-family:'JetBrains Mono',monospace;font-size:calc(9.5px*var(--ui));font-weight:800;padding:3px 6px;opacity:${got ? 1 : .55}">${n}${got ? ' ✓' : ' ✗'}</span>`; }).join('')
              + `</div>`;
            h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(10px*var(--ui));font-weight:700">${feedback === 'correct'
              ? '✓ ' + q.label + ' — all of it'
              : `✗ ${q.missed.length ? 'missed ' + q.missed.join(' · ') : ''}${q.missed.length && q.extra.length ? ' · ' : ''}${q.extra.length ? 'not in it: ' + q.extra.join(' · ') : ''}`}</div>`;
            h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${q.label} is lit on the neck</div>`;
            h += `<button class="rk-chip fet-qnext" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">NEXT →</button>`;
          }
        }
        else { h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:600;line-height:1.4">${question.prompt}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:calc(16px*var(--ui));font-weight:900;margin:4px 0">${feedback === 'correct' ? '✓' : '✗'} ${question.answer}</div>`; else h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;margin-top:4px">${theoryOptions()}</div>`; }
        h += `</div>`;
        // ■ END halts the round, so it takes the app's one stop red. Spelled out
        // rather than handed --rk-accent: .rk-btn paints itself from --rk-ink-dim
        // and --rk-panel2, which .rk already resolved from the card's accent
        // upstream, so re-pointing the accent on the button reaches nothing but
        // the hover rule — which is how this ended up a grey button that only
        // turned pink under the cursor.
        h += `<button class="rk-btn fet-qstop" style="min-height:calc(28px*var(--ui));width:100%;background:var(--rk-stop-soft);border-color:var(--rk-stop-edge);color:var(--rk-stop)">■ END</button>`;
      } else {
        if (score.correct > 0 || score.wrong > 0) {
          const total = score.correct + score.wrong, pctS = total ? Math.round(score.correct / total * 100) : 0;
          h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:10px;text-align:center"><div class="mono" style="color:${ACCENT};font-size:calc(26px*var(--ui));font-weight:900">${score.correct}</div><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">${score.correct}/${total} (${pctS}%)</div><div class="mono" style="color:var(--rk-dim);font-size:calc(9px*var(--ui));margin-top:3px">Best streak: ${score.best}</div>${score.correct >= bestScore && score.correct > 0 ? `<div class="mono" style="color:var(--rk-hot);font-size:calc(10px*var(--ui));font-weight:700;margin-top:3px">★ NEW BEST!</div>` : ''}</div>`;
        }
        h += `<button class="rk-btn fet-qstartround" style="min-height:calc(28px*var(--ui));width:100%">▶ START ROUND</button>`;
      }
    }

    // Theory panel
    h += theoryPanelHTML('fet', THEORY_PANEL[group]);
    h += `</div>`;
    el.innerHTML = h;
    wire();
    Object.assign(s, { fetGroup: group, earMode, earDiff, quizMode, quizZone: zone, quizStrings: stringFocus, quizTime: timeLimit, buildSize });
  }

  function replayBtn() { return `<button class="rk-chip fet-earreplay" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">🔊 Replay</button>`; }

  function theoryOptions() {
    const q = question;
    if (quizMode === 'keysig' && q.answerVal !== undefined && typeof q.answerVal === 'number') return Array.from({ length: 7 }, (_, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:24px;padding:2px 5px">${i}</button>`).join('');
    if (quizMode === 'chordfn' && q.nums) return q.nums.map((nm, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 6px">${nm}</button>`).join('');
    if (quizMode === 'degree' && q.answerDeg !== undefined) return DEGREE_NAMES.map((dn, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 6px">${dn}</button>`).join('');
    if (quizMode === 'ivlname' && q.semitones !== undefined && !q.startNote) return INTERVAL_NAMES.filter(x => x[0] > 0).map(([, nm]) => `<button class="rk-chip fet-qtheory" data-ta="${nm}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 5px">${nm}</button>`).join('');
    if (quizMode === 'resolve' && q.tones) return q.tones.map(t => `<button class="rk-chip fet-qtheory" data-ta="${t}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:26px;padding:2px 6px">${t}</button>`).join('');
    if (quizMode === 'bassid' && q.opts) return q.opts.map(t => `<button class="rk-chip fet-qtheory" data-ta="${t}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:34px;padding:2px 8px">${t}</button>`).join('');
    // colour mode: the swatches ARE the answers (no letters on them — that's the
    // point; the letter appears only in the reveal, which is the feedback)
    if (quizMode === 'colour') return FIFTHS.map(t => `<button class="fet-qtheory" data-ta="${t}" title="answer with the colour" style="width:26px;height:26px;border-radius:6px;border:1px solid ${pcColor(t, 70, 62)};background:${pcColor(t, 74, 44)};cursor:pointer;padding:0"></button>`).join('');
    return NOTES.map(n => `<button class="rk-chip fet-qtheory" data-ta="${n}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:24px;padding:2px 4px">${n}</button>`).join('');
  }

  function wire() {
    el.querySelectorAll('.fet-group').forEach(b => b.onclick = e => { e.stopPropagation(); if (running) endRound(); group = b.dataset.g; question = null; score = { correct: 0, wrong: 0, streak: 0, best: 0 }; render(); });
    // EAR
    el.querySelectorAll('.fet-earmode').forEach(b => b.onclick = e => { e.stopPropagation(); earMode = b.dataset.em; question = null; score = { correct: 0, wrong: 0, streak: 0, best: 0 }; render(); });
    el.querySelectorAll('.fet-eardiff').forEach(b => b.onclick = e => { e.stopPropagation(); earDiff = b.dataset.ed; question = null; score = { correct: 0, wrong: 0, streak: 0, best: 0 }; render(); });
    el.querySelectorAll('.fet-earivl').forEach(b => b.onclick = e => { e.stopPropagation(); answerEarInterval(parseInt(b.dataset.semi)); });
    el.querySelectorAll('.fet-earch').forEach(b => b.onclick = e => { e.stopPropagation(); answerEarChord(b.dataset.ct); });
    el.querySelector('.fet-earreplay') && (el.querySelector('.fet-earreplay').onclick = e => { e.stopPropagation(); replayEar(); });
    el.querySelector('.fet-earstart') && (el.querySelector('.fet-earstart').onclick = e => { e.stopPropagation(); setEarFretboard(); genEarQuestion(); });
    // THEORY
    el.querySelectorAll('.fet-qmode').forEach(b => b.onclick = e => { e.stopPropagation(); quizMode = b.dataset.qm; if (running) endRound(); render(); });
    el.querySelectorAll('.fet-zone').forEach(b => b.onclick = e => { e.stopPropagation(); zone = b.dataset.nz; render(); });
    el.querySelectorAll('.fet-time').forEach(b => b.onclick = e => { e.stopPropagation(); timeLimit = parseInt(b.dataset.nt); render(); });
    el.querySelectorAll('.fet-qname').forEach(b => b.onclick = e => { e.stopPropagation(); checkNameAnswer(b.dataset.na); });
    el.querySelectorAll('.fet-qtheory').forEach(b => b.onclick = e => { e.stopPropagation(); checkTheoryAnswer(b.dataset.ta); });
    el.querySelectorAll('.fet-buildsize').forEach(b => b.onclick = e => { e.stopPropagation(); buildSize = b.dataset.bs; render(); });
    el.querySelectorAll('.fet-buildchip').forEach(b => b.onclick = e => { e.stopPropagation(); addBuildNote(b.dataset.bn); });
    el.querySelector('.fet-buildcheck') && (el.querySelector('.fet-buildcheck').onclick = e => { e.stopPropagation(); if (question && question.taps.length) checkTheoryAnswer(question.taps.join(' ')); });
    el.querySelector('.fet-tcommit') && (el.querySelector('.fet-tcommit').onclick = e => { e.stopPropagation(); if (question) checkTheoryAnswer('' + question.guess); });
    el.querySelector('.fet-treplay') && (el.querySelector('.fet-treplay').onclick = e => { e.stopPropagation(); if (question && question.voicing) playSpread(question.voicing.root, question.voicing.intervals, question.voicing.oct); });
    el.querySelector('.fet-qnext') && (el.querySelector('.fet-qnext').onclick = e => { e.stopPropagation(); if (running) nextTheoryQuestion(); });
    const tsl = el.querySelector('.fet-tslider');
    if (tsl) {
      tsl.onclick = e => e.stopPropagation();
      tsl.oninput = e => {   // patch the readout in place: a re-render mid-drag would drop the thumb
        e.stopPropagation();
        if (!question) return;
        question.guess = parseInt(tsl.value);
        tsl.style.setProperty('--rk-fill', question.guess + '%');
        const pin = el.querySelector('.fet-tpin'), val = el.querySelector('.fet-tval');
        if (pin) pin.style.left = question.guess + '%';
        if (val) val.textContent = question.guess;
      };
    }
    el.querySelector('.fet-qstartround') && (el.querySelector('.fet-qstartround').onclick = e => { e.stopPropagation(); startRound(); });
    el.querySelector('.fet-qstop') && (el.querySelector('.fet-qstop').onclick = e => { e.stopPropagation(); endRound(); });
    el.querySelector('.fet-qreplay') && (el.querySelector('.fet-qreplay').onclick = e => { e.stopPropagation(); if (question) playClickedNote(question.note, question.octave); });
    wireTheoryPanel(el);
  }

  render();
  if (p.settings._autoStart) {
    delete p.settings._autoStart;
    if (group === 'ear') { setEarFretboard(); genEarQuestion(); } else startRound();
  }
}
