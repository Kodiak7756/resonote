// ════════════════════════════════════════════════════════════════════
//  Functional Ear Trainer — the merge of Ear Trainer + Note Quiz.
//  One pedal, two groups: EAR (recognise sound → name) and THEORY
//  (know the fretboard + how chords function). Ported natively so the
//  fretboard-answer + overlay paths are wired correctly (the originals
//  referenced updateOverlays/lastClickedNote/getNoteAtFret/onFretboardClick
//  as bare globals and silently threw on those paths).
// ════════════════════════════════════════════════════════════════════
import { NOTES, KEY_PATTERNS, intervalLabel, getKeyChords } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { audio, playClickedNote } from '../core/audio.js';
import { updateOverlays, setLastClickedNote } from '../ui/fretboard.js';
import { setFretboardClickHandler } from '../main.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

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

const ACCENT = '#ee6688';
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
const THEORY_MODES_R1 = [['find','🔊 Find'], ['name','📍 Name']];
const THEORY_MODES_R2 = [['keysig','Key Sig'], ['chordfn','Chord Fn'], ['degree','Degrees'], ['ivlname','Intervals']];

function playTone(freq, dur, type, vol) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.value = vol || 0.3;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.5));
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (dur || 0.5));
  } catch (e) {}
}
const noteToFreq = (note, oct) => 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (oct - 4));
const pick = a => a[Math.floor(Math.random() * a.length)];

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
  let running = false, timeLeft = 0, timerIntv = null;
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

  function nextTheoryQuestion() {
    answered = false; feedback = '';
    if (quizMode === 'find' || quizMode === 'name') {
      const [fMin, fMax] = fretRange(), si = pick(stringRange()), fret = fMin + Math.floor(Math.random() * (fMax - fMin + 1));
      const { note, octave } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
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
    (correct ? win : lose)();
    render();
    setTimeout(() => { if (running) nextTheoryQuestion(); }, 1000);
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
    setFretboardClickHandler(info => { if (running && question && quizMode === 'find') checkFindAnswer(info); });
    nextTheoryQuestion();
    timerIntv = setInterval(() => { timeLeft--; if (timeLeft <= 0) { endRound(); return; } render(); }, 1000);
  }
  function endRound() {
    running = false; clearInterval(timerIntv); timerIntv = null;
    setFretboardClickHandler(null); setLastClickedNote(null); updateOverlays();
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
    const fb = c => c === 'correct' ? '#00ff88' : '#ff4466';
    let h = `<div class="rk rk-fet" style="--rk-accent:${ACCENT}">`;

    // Group toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn fet-group${group === 'ear' ? ' is-active' : ''}" data-g="ear" style="flex:1;font-size:10px;padding:7px 0">🎧 EAR</button>
      <button class="rk-seg-btn fet-group${group === 'theory' ? ' is-active' : ''}" data-g="theory" style="flex:1;font-size:10px;padding:7px 0">🧠 THEORY</button>
    </div>`;

    h += `<div style="font-size:9.5px;line-height:1.45;color:#c8c8c8;background:${ACCENT}1e;border-left:2px solid ${ACCENT};padding:6px 8px;border-radius:4px">${group === 'ear'
      ? 'Recognise what you <b>hear</b> — single notes, intervals, chord qualities and short melodies. Answer by playing, clicking the fretboard, or tapping.'
      : 'Fast recall against the clock — <b>find/name</b> notes on the neck, key signatures, chord function, scale degrees and intervals.'}</div>`;

    if (group === 'ear') {
      // mode + difficulty
      h += `<div class="rk-section"><div class="rk-label">MODE</div><div class="rk-seg" style="gap:3px">`;
      EAR_MODES.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-earmode${earMode === m ? ' is-active' : ''}" data-em="${m}" style="flex:1;min-width:48px;font-size:7.5px;padding:5px 2px">${label}</button>`);
      h += `</div><div class="rk-seg" style="gap:3px;margin-top:5px">`;
      [['easy','Easy'],['medium','Medium'],['hard','Hard']].forEach(([d, label]) => h += `<button class="rk-seg-btn fet-eardiff${earDiff === d ? ' is-active' : ''}" data-ed="${d}" style="font-size:8px;padding:4px 10px">${label}</button>`);
      h += `</div></div>`;
      // score
      const pct = (score.correct + score.wrong) ? Math.round(score.correct / (score.correct + score.wrong) * 100) : 0;
      h += `<div style="display:flex;align-items:center;justify-content:center;gap:12px"><span class="mono" style="color:#66cc88;font-size:11px;font-weight:700">${score.correct}/${score.correct + score.wrong}</span><span class="mono" style="color:#888;font-size:8px">${pct}%</span><span class="mono" style="color:#dd8844;font-size:9px;font-weight:700">🔥${score.streak}</span>${score.best ? `<span class="mono" style="color:#555;font-size:8px">best ${score.best}</span>` : ''}</div>`;
      // question card
      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:10px;text-align:center;min-height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">`;
      if (!question) h += `<div class="mono" style="color:#888;font-size:10px">Press START to begin</div>`;
      else if (earMode === 'note') { h += `<div class="mono" style="color:#aaa;font-size:8px">What note is this?</div><div class="mono" style="color:${ACCENT};font-size:9px">Play it or click the fretboard</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ It was ' + question.note}</div>`; h += replayBtn(); }
      else if (earMode === 'interval') { h += `<div class="mono" style="color:#aaa;font-size:8px">Name this interval</div><div class="mono" style="color:${ACCENT};font-size:11px">Starting from ${question.note1}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.name : '✗ It was ' + question.name}</div>`; h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">` + earIntervalSet().map(([semi, name]) => `<button class="rk-chip fet-earivl" data-semi="${semi}" style="font-size:8px;padding:3px 7px">${name}</button>`).join('') + `</div>` + replayBtn(); }
      else if (earMode === 'intervalPlay') { h += `<div class="mono" style="color:#aaa;font-size:8px">Play the second note</div><div class="mono" style="color:${ACCENT};font-size:11px">First: <b style="color:#ffbb66">${question.note1}</b> · ${question.name}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note2 : '✗ It was ' + question.note2}</div>`; h += replayBtn(); }
      else if (earMode === 'chord') { h += `<div class="mono" style="color:#aaa;font-size:8px">What type of chord?</div><div class="mono" style="color:${ACCENT};font-size:11px">Root: ${question.root}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.chordType.name : '✗ It was ' + question.chordType.name}</div>`; const chSet = earDiff === 'easy' ? CHORD_TYPES_EAR.slice(0, 4) : CHORD_TYPES_EAR; h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">` + chSet.map(ct => `<button class="rk-chip fet-earch" data-ct="${ct.name}" style="font-size:8px;padding:3px 7px">${ct.name}</button>`).join('') + `</div>` + replayBtn(); }
      else if (earMode === 'melody') { const len = question.notes.length; h += `<div class="mono" style="color:#aaa;font-size:8px">Play back the melody (${melodyIdx}/${len})</div><div style="display:flex;gap:4px;justify-content:center">` + question.notes.map((n, i) => { const done = i < melodyIdx, cur = i === melodyIdx && !answered, col = done ? '#00ff88' : cur ? '#ffd060' : '#333'; return `<div style="width:20px;height:20px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center">${done ? `<span class="mono" style="color:#111;font-size:7px;font-weight:700">${n.note}</span>` : ''}</div>`; }).join('') + `</div>`; if (answered && feedback === 'wrong') h += `<div class="mono" style="color:#ff4466;font-size:10px;font-weight:700">✗ ${question.notes.map(n => n.note).join(' → ')}</div>`; else if (answered) h += `<div class="mono" style="color:#00ff88;font-size:14px;font-weight:900">✓ Perfect!</div>`; h += replayBtn(); }
      h += `</div>`;
      h += `<button class="rk-btn fet-earstart" style="width:100%">${question ? 'NEXT' : '▶ START'}</button>`;

    } else {
      // THEORY
      const isFret = quizMode === 'find' || quizMode === 'name';
      const bestKey = `${quizMode}-${zone}-${timeLimit}`, bestScore = bestScores[bestKey] || 0;
      h += `<div class="rk-section"><div class="rk-label">DRILL</div><div class="rk-seg" style="gap:3px">`;
      THEORY_MODES_R1.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-qmode${quizMode === m ? ' is-active' : ''}" data-qm="${m}" style="flex:1;font-size:8px;padding:5px 2px">${label}</button>`);
      h += `</div><div class="rk-seg" style="gap:3px;margin-top:4px">`;
      THEORY_MODES_R2.forEach(([m, label]) => h += `<button class="rk-seg-btn fet-qmode${quizMode === m ? ' is-active' : ''}" data-qm="${m}" style="flex:1;font-size:7.5px;padding:5px 2px">${label}</button>`);
      h += `</div></div>`;
      if (isFret) {
        h += `<div class="rk-seg" style="align-items:center;gap:3px"><span class="rk-label">ZONE</span>`;
        [['all','Full'],['open','0-4'],['mid','5-9'],['upper','10+']].forEach(([z, label]) => h += `<button class="rk-seg-btn fet-zone${zone === z ? ' is-active' : ''}" data-nz="${z}" style="flex:1;font-size:7px;padding:4px 2px">${label}</button>`);
        h += `</div>`;
      }
      h += `<div class="rk-seg" style="align-items:center;gap:3px"><span class="rk-label">TIME</span>`;
      [30, 60, 90].forEach(t => h += `<button class="rk-seg-btn fet-time${timeLimit === t ? ' is-active' : ''}" data-nt="${t}" style="font-size:8px;padding:4px 9px">${t}s</button>`);
      if (bestScore > 0) h += `<span class="mono" style="color:#dd8844;font-size:9px;margin-left:auto">★ ${bestScore}</span>`;
      h += `</div>`;

      if (running) {
        const pct = (timeLeft / timeLimit) * 100, barColor = timeLeft <= 5 ? '#ff4466' : timeLeft <= 10 ? '#ffaa00' : ACCENT;
        h += `<div style="background:#222;border-radius:4px;height:5px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${barColor};transition:width 1s linear"></div></div>`;
        h += `<div style="display:flex;align-items:center;justify-content:center;gap:10px"><span class="mono" style="color:${ACCENT};font-size:18px;font-weight:900">${score.correct}</span>${score.wrong ? `<span class="mono" style="color:#ff6666;font-size:11px">${score.wrong}✗</span>` : ''}<span class="mono" style="color:#dd8844;font-size:9px;font-weight:700">🔥${score.streak}</span><span class="mono" style="color:${barColor};font-size:13px;font-weight:900">${timeLeft}s</span></div>`;
        h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:9px;text-align:center;min-height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px">`;
        if (!question) h += `<div class="mono" style="color:#555">Loading…</div>`;
        else if (quizMode === 'find') { h += `<div class="mono" style="color:#aaa;font-size:8px">Play or click this note:</div><div class="mono" style="color:${ACCENT};font-size:26px;font-weight:900">${question.note}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:13px;font-weight:700">${feedback === 'correct' ? '✓' : '✗ str ' + (question.si + 1) + ' fret ' + question.fret}</div>`; h += `<button class="rk-chip fet-qreplay" style="font-size:7px">🔊 Replay</button>`; }
        else if (quizMode === 'name') { h += `<div class="mono" style="color:#aaa;font-size:8px">What note is on str ${question.si + 1} fret ${question.fret}?</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ ' + question.note}</div>`; else h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center">` + NOTES.map(n => `<button class="rk-chip fet-qname" data-na="${n}" style="font-size:8px;min-width:26px;padding:2px 4px">${n}</button>`).join('') + `</div>`; }
        else { h += `<div class="mono" style="color:#ddd;font-size:10px;font-weight:600;line-height:1.4">${question.prompt}</div>`; if (answered) h += `<div class="mono" style="color:${fb(feedback)};font-size:16px;font-weight:900;margin:4px 0">${feedback === 'correct' ? '✓' : '✗'} ${question.answer}</div>`; else h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;margin-top:4px">${theoryOptions()}</div>`; }
        h += `</div>`;
        h += `<button class="rk-btn fet-qstop" style="width:100%;--rk-accent:#ff5a5a">■ END</button>`;
      } else {
        if (score.correct > 0 || score.wrong > 0) {
          const total = score.correct + score.wrong, pctS = total ? Math.round(score.correct / total * 100) : 0;
          h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:9px;padding:10px;text-align:center"><div class="mono" style="color:${ACCENT};font-size:26px;font-weight:900">${score.correct}</div><div class="mono" style="color:#888;font-size:9px">${score.correct}/${total} (${pctS}%)</div><div class="mono" style="color:#dd8844;font-size:9px;margin-top:3px">Best streak: ${score.best}</div>${score.correct >= bestScore && score.correct > 0 ? `<div class="mono" style="color:#ffaa00;font-size:10px;font-weight:700;margin-top:3px">★ NEW BEST!</div>` : ''}</div>`;
        }
        h += `<button class="rk-btn fet-qstartround" style="width:100%">▶ START ROUND</button>`;
      }
    }

    // Theory panel
    h += theoryPanelHTML('fet', THEORY_PANEL[group]);
    h += `</div>`;
    el.innerHTML = h;
    wire();
    Object.assign(s, { fetGroup: group, earMode, earDiff, quizMode, quizZone: zone, quizStrings: stringFocus, quizTime: timeLimit });
  }

  function replayBtn() { return `<button class="rk-chip fet-earreplay" style="font-size:8px">🔊 Replay</button>`; }

  function theoryOptions() {
    const q = question;
    if (quizMode === 'keysig' && q.answerVal !== undefined && typeof q.answerVal === 'number') return Array.from({ length: 7 }, (_, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="font-size:8px;min-width:24px;padding:2px 5px">${i}</button>`).join('');
    if (quizMode === 'chordfn' && q.nums) return q.nums.map((nm, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="font-size:8px;padding:2px 6px">${nm}</button>`).join('');
    if (quizMode === 'degree' && q.answerDeg !== undefined) return DEGREE_NAMES.map((dn, i) => `<button class="rk-chip fet-qtheory" data-ta="${i}" style="font-size:8px;padding:2px 6px">${dn}</button>`).join('');
    if (quizMode === 'ivlname' && q.semitones !== undefined && !q.startNote) return INTERVAL_NAMES.filter(x => x[0] > 0).map(([, nm]) => `<button class="rk-chip fet-qtheory" data-ta="${nm}" style="font-size:7px;padding:2px 5px">${nm}</button>`).join('');
    return NOTES.map(n => `<button class="rk-chip fet-qtheory" data-ta="${n}" style="font-size:8px;min-width:24px;padding:2px 4px">${n}</button>`).join('');
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
