import { NOTES, toSharp, CHORD_TYPES, KEY_PATTERNS, SCALE_TYPES, INTERVAL_LABELS, intervalLabel, getChordNotes, getKeyChords, getScaleNotes } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, customTuning, getInst } from '../core/tuning.js';
import { showIntervals, pedalBus, metroClock } from '../core/state.js';
import { audio, playClickedNote } from '../core/audio.js';
import { makeKnob } from '../ui/pedal-system.js';

// ─── Local data ───────────────────────────────────────────────────────────────

const KEY_SIG_DATA = [
  { key: 'C',  type: 'Major', sharps: 0, flats: 0 },
  { key: 'G',  type: 'Major', sharps: 1, flats: 0 },
  { key: 'D',  type: 'Major', sharps: 2, flats: 0 },
  { key: 'A',  type: 'Major', sharps: 3, flats: 0 },
  { key: 'E',  type: 'Major', sharps: 4, flats: 0 },
  { key: 'B',  type: 'Major', sharps: 5, flats: 0 },
  { key: 'F#', type: 'Major', sharps: 6, flats: 0 },
  { key: 'F',  type: 'Major', sharps: 0, flats: 1 },
  { key: 'Bb', type: 'Major', sharps: 0, flats: 2 },
  { key: 'Eb', type: 'Major', sharps: 0, flats: 3 },
  { key: 'Ab', type: 'Major', sharps: 0, flats: 4 },
  { key: 'Db', type: 'Major', sharps: 0, flats: 5 },
  { key: 'A',  type: 'Minor', sharps: 0, flats: 0 },
  { key: 'E',  type: 'Minor', sharps: 1, flats: 0 },
  { key: 'B',  type: 'Minor', sharps: 2, flats: 0 },
  { key: 'D',  type: 'Minor', sharps: 0, flats: 1 },
  { key: 'G',  type: 'Minor', sharps: 0, flats: 2 },
  { key: 'C',  type: 'Minor', sharps: 0, flats: 3 },
];

const NUMERALS_MAJ  = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const NUMERALS_MIN  = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
const DEGREE_NAMES  = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
const INTERVAL_NAMES = [
  [0, 'Unison'], [1, 'm2'],  [2, 'M2'],  [3, 'm3'],
  [4, 'M3'],     [5, 'P4'],  [6, 'TT'],  [7, 'P5'],
  [8, 'm6'],     [9, 'M6'],  [10, 'm7'], [11, 'M7'],
  [12, 'Octave'],
];

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildNoteQuizContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  let quizMode    = s.quizMode    || 'find';
  let zone        = s.quizZone    || 'all';
  let stringFocus = s.quizStrings || 'all';
  let timeLimit   = s.quizTime    || 30;

  let running = false, timeLeft = 0, timerIntv = null;
  let question = null, answered = false, feedback = '';
  let score = { correct: 0, wrong: 0, streak: 0, best: 0 };
  let bestScores = {};

  try {
    const raw = localStorage.getItem('resonote-notequiz');
    if (raw) bestScores = JSON.parse(raw);
  } catch (e) {}

  const pick = a => a[Math.floor(Math.random() * a.length)];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getFretRange() {
    if (zone === 'open')  return [0, 4];
    if (zone === 'mid')   return [5, 9];
    if (zone === 'upper') return [10, 15];
    return [0, Math.min(15, customTuning.length > 4 ? 15 : 12)];
  }

  function getStringRange() {
    if (stringFocus === 'all') return customTuning.map((_, i) => i);
    return [parseInt(stringFocus)];
  }

  // ── Question generators ───────────────────────────────────────────────────

  function nextQuestion() {
    answered = false;
    feedback = '';
    if      (quizMode === 'find')     generateFindQ();
    else if (quizMode === 'name')     generateNameQ();
    else if (quizMode === 'keysig')   generateKeySigQ();
    else if (quizMode === 'chordfn')  generateChordFnQ();
    else if (quizMode === 'degree')   generateDegreeQ();
    else if (quizMode === 'ivlname')  generateIvlNameQ();
    render();
  }

  function generateFindQ() {
    const [fMin, fMax] = getFretRange();
    const strings = getStringRange();
    const si   = pick(strings);
    const fret = fMin + Math.floor(Math.random() * (fMax - fMin + 1));
    const { note, octave } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    question = { mode: 'find', note, octave, si, fret };
    playClickedNote(note, octave);
  }

  function generateNameQ() {
    const [fMin, fMax] = getFretRange();
    const strings = getStringRange();
    const si   = pick(strings);
    const fret = fMin + Math.floor(Math.random() * (fMax - fMin + 1));
    const { note, octave } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    question = { mode: 'name', note, octave, si, fret };
    lastClickedNote = { note, octave, si, fret };
    updateOverlays();
  }

  function generateKeySigQ() {
    const ks = pick(KEY_SIG_DATA);
    const askDir = Math.random() > 0.5; // true = "how many sharps/flats in X?"

    if (askDir) {
      const accCount = ks.sharps || ks.flats;
      const accType  = ks.sharps ? 'sharps' : 'flats';
      question = {
        mode: 'keysig',
        prompt: `How many sharps/flats in ${ks.key} ${ks.type}?`,
        answer: `${accCount} ${accCount === 0 ? '(none)' : accType}`,
        answerVal: accCount,
        answerType: ks.sharps ? '#' : 'b',
        ks,
      };
    } else {
      const accCount = ks.sharps || ks.flats;
      const accType  = ks.sharps ? 'sharps' : 'flats';
      if (accCount === 0) {
        question = {
          mode: 'keysig',
          prompt: `Which major key has no sharps or flats?`,
          answer: `${ks.key} ${ks.type}`,
          answerVal: ks.key,
          ks,
        };
      } else {
        question = {
          mode: 'keysig',
          prompt: `Which ${ks.type.toLowerCase()} key has ${accCount} ${accType}?`,
          answer: `${ks.key} ${ks.type}`,
          answerVal: ks.key,
          ks,
        };
      }
    }
  }

  function generateChordFnQ() {
    const isMajor = Math.random() > 0.4;
    const kt      = isMajor ? 'Major' : 'Minor';
    const rootKey = pick(NOTES);
    const pat     = KEY_PATTERNS[kt];
    if (!pat) return;

    const chords  = getKeyChords(rootKey, kt);
    const idx     = Math.floor(Math.random() * chords.length);
    const ch      = chords[idx];
    const nums    = isMajor ? NUMERALS_MAJ : NUMERALS_MIN;
    const askDir  = Math.random() > 0.5;

    if (askDir) {
      // "What is the IV chord in G Major?"
      question = {
        mode: 'chordfn',
        prompt: `What is the ${nums[idx]} chord in ${rootKey} ${kt}?`,
        answer: ch.root + (ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ''),
        answerNote: ch.root,
        chords,
        idx,
      };
    } else {
      // "What function is Dm in C Major?"
      const ql = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : '+';
      question = {
        mode: 'chordfn',
        prompt: `What is ${ch.root}${ql} in the key of ${rootKey} ${kt}?`,
        answer: nums[idx],
        answerIdx: idx,
        chords,
        nums,
      };
    }
  }

  function generateDegreeQ() {
    const isMajor = Math.random() > 0.4;
    const kt      = isMajor ? 'Major' : 'Minor';
    const rootKey = pick(NOTES);
    const pat     = KEY_PATTERNS[kt];
    if (!pat) return;

    const deg       = Math.floor(Math.random() * 7);
    const noteAtDeg = NOTES[(NOTES.indexOf(rootKey) + pat.intervals[deg]) % 12];
    const askDir    = Math.random() > 0.5;

    if (askDir) {
      question = {
        mode: 'degree',
        prompt: `What is the ${DEGREE_NAMES[deg]} degree of ${rootKey} ${kt}?`,
        answer: noteAtDeg,
        rootKey, kt, deg,
      };
    } else {
      question = {
        mode: 'degree',
        prompt: `What degree is ${noteAtDeg} in ${rootKey} ${kt}?`,
        answer: DEGREE_NAMES[deg],
        answerDeg: deg,
        rootKey, kt, noteAtDeg,
      };
    }
  }

  function generateIvlNameQ() {
    const n1  = pick(NOTES);
    const ivl = pick(INTERVAL_NAMES.filter(x => x[0] > 0));
    const n2  = NOTES[(NOTES.indexOf(n1) + ivl[0]) % 12];
    const askDir = Math.random() > 0.5;

    if (askDir) {
      question = { mode: 'ivlname', prompt: `What interval is ${n1} to ${n2}?`,           answer: ivl[1], semitones: ivl[0] };
    } else {
      question = { mode: 'ivlname', prompt: `Go a ${ivl[1]} up from ${n1}. What note?`,   answer: n2,     semitones: ivl[0], startNote: n1 };
    }
  }

  // ── Answer checkers ───────────────────────────────────────────────────────

  function checkTheoryAnswer(ans) {
    if (answered || !question) return;
    answered = true;
    score[0]++;

    const q = question;
    let correct = false;

    if (q.mode === 'keysig') {
      if (q.answerVal !== undefined) correct = ('' + ans) === ('' + q.answerVal);
      else correct = ans === q.answerVal || ans === q.answer;
    } else if (q.mode === 'chordfn') {
      if (q.answerNote)              correct = ans === q.answerNote;
      else if (q.answerIdx !== undefined) correct = parseInt(ans) === q.answerIdx;
      else                           correct = ans === q.answer;
    } else if (q.mode === 'degree') {
      if (q.answerDeg !== undefined) correct = parseInt(ans) === q.answerDeg;
      else                           correct = ans === q.answer;
    } else if (q.mode === 'ivlname') {
      correct = ans === q.answer;
    }

    if (correct) {
      score.correct++;
      score.streak++;
      score.best = Math.max(score.best, score.streak);
      feedback = 'correct';
    } else {
      score.wrong++;
      score.streak = 0;
      feedback = 'wrong';
    }

    render();
    setTimeout(() => { if (running) nextQuestion(); }, 1000);
  }

  function checkFindAnswer(info) {
    if (answered || !question || question.mode !== 'find') return;

    if (info.note === question.note) {
      answered = true;
      feedback = 'correct';
      score.correct++;
      score.streak++;
      score.best = Math.max(score.best, score.streak);
      lastClickedNote = { note: question.note, octave: question.octave, si: question.si, fret: question.fret };
      updateOverlays();
      setTimeout(() => { if (running) nextQuestion(); }, 800);
    } else {
      answered = true;
      feedback = 'wrong';
      score.wrong++;
      score.streak = 0;
      setTimeout(() => { if (running) nextQuestion(); }, 800);
    }

    render();
  }

  function checkNameAnswer(note) {
    if (answered || !question || question.mode !== 'name') return;
    answered = true;

    if (note === question.note) {
      feedback = 'correct';
      score.correct++;
      score.streak++;
      score.best = Math.max(score.best, score.streak);
    } else {
      feedback = 'wrong';
      score.wrong++;
      score.streak = 0;
    }

    render();
    setTimeout(() => { if (running) nextQuestion(); }, 800);
  }

  // ── Round control ─────────────────────────────────────────────────────────

  function startRound() {
    score    = { correct: 0, wrong: 0, streak: 0, best: 0 };
    timeLeft = timeLimit;
    running  = true;

    onFretboardClick = (info) => {
      if (!running || !question) return;
      if (quizMode === 'find') checkFindAnswer(info);
    };

    nextQuestion();
    timerIntv = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) { endRound(); return; }
      render();
    }, 1000);
  }

  function endRound() {
    running = false;
    clearInterval(timerIntv);
    timerIntv = null;
    onFretboardClick = null;
    lastClickedNote  = null;
    updateOverlays();

    const key = `${quizMode}-${zone}-${timeLimit}`;
    if (!bestScores[key] || score.correct > bestScores[key]) {
      bestScores[key] = score.correct;
    }

    try { localStorage.setItem('resonote-notequiz', JSON.stringify(bestScores)); } catch (e) {}
    render();
  }

  // ── Audio input handler ───────────────────────────────────────────────────

  function onAudioForQuiz() {
    if (!running || !question || answered) return;
    if (!document.getElementById(`body-${p.id}`)) return;
    const det = audio.detected;
    if (!det) return;
    if (quizMode === 'find') checkFindAnswer({ note: det.note });
  }

  audio.on(onAudioForQuiz);

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const accent   = '#44ddaa';
    const isTheory = ['keysig', 'chordfn', 'degree', 'ivlname'].includes(quizMode);
    const bestKey  = `${quizMode}-${zone}-${timeLimit}`;
    const bestScore = bestScores[bestKey] || 0;

    let h = `<div style="display:flex;flex-direction:column;gap:5px">`;

    // Mode tabs — row 1
    h += `<div style="display:flex;gap:2px">`;
    [['find', '🔊 Find'], ['name', '📍 Name']].forEach(([m, label]) => {
      h += `<button class="chord-btn nq-mode" data-nm="${m}" style="flex:1;font-size:7px;${quizMode === m ? `background:rgba(68,221,170,.15);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // Mode tabs — row 2
    h += `<div style="display:flex;gap:2px">`;
    [['keysig', 'Key Sig'], ['chordfn', 'Chord Fn'], ['degree', 'Degrees'], ['ivlname', 'Intervals']].forEach(([m, label]) => {
      h += `<button class="chord-btn nq-mode" data-nm="${m}" style="flex:1;font-size:7px;${quizMode === m ? `background:rgba(68,221,170,.15);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // Fretboard options (find/name only)
    if (!isTheory) {
      h += `<div style="display:flex;gap:2px;align-items:center">`;
      h += `<span class="mono" style="color:#555;font-size:7px">ZONE</span>`;
      [['all', 'Full'], ['open', '0-4'], ['mid', '5-9'], ['upper', '10+']].forEach(([z, label]) => {
        h += `<button class="chord-btn nq-zone" data-nz="${z}" style="flex:1;font-size:6px;${zone === z ? `background:rgba(68,221,170,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
      });
      h += `</div>`;

      h += `<div style="display:flex;gap:2px;align-items:center">`;
      h += `<span class="mono" style="color:#555;font-size:7px">STR</span>`;
      h += `<button class="chord-btn nq-str" data-ns="all" style="font-size:6px;${stringFocus === 'all' ? `background:rgba(68,221,170,.12);border-color:${accent};color:${accent}` : ''}">All</button>`;
      customTuning.forEach((_, i) => {
        h += `<button class="chord-btn nq-str" data-ns="${i}" style="font-size:6px;min-width:16px;${stringFocus === '' + i ? `background:rgba(68,221,170,.12);border-color:${accent};color:${accent}` : ''}">${i + 1}</button>`;
      });
      h += `</div>`;
    }

    // Time selector
    h += `<div style="display:flex;gap:2px;align-items:center">`;
    h += `<span class="mono" style="color:#555;font-size:7px">TIME</span>`;
    [30, 60, 90].forEach(t => {
      h += `<button class="chord-btn nq-time" data-nt="${t}" style="font-size:7px;${timeLimit === t ? `background:rgba(68,221,170,.12);border-color:${accent};color:${accent}` : ''}">${t}s</button>`;
    });
    if (bestScore > 0) h += `<span class="mono" style="color:#dd8844;font-size:8px;margin-left:auto">★ ${bestScore}</span>`;
    h += `</div>`;

    if (running) {
      const pct      = (timeLeft / timeLimit) * 100;
      const barColor = timeLeft <= 5 ? '#ff4466' : timeLeft <= 10 ? '#ffaa00' : accent;

      h += `<div style="background:#222;border-radius:4px;height:5px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;transition:width 1s linear"></div></div>`;

      h += `<div style="display:flex;align-items:center;justify-content:center;gap:10px">`;
      h += `<span class="mono" style="color:#44ddaa;font-size:18px;font-weight:900">${score.correct}</span>`;
      if (score.wrong > 0) h += `<span class="mono" style="color:#ff6666;font-size:11px">${score.wrong}✗</span>`;
      h += `<span class="mono" style="color:#dd8844;font-size:9px;font-weight:700">🔥${score.streak}</span>`;
      h += `<span class="mono" style="color:${barColor};font-size:13px;font-weight:900">${timeLeft}s</span>`;
      h += `</div>`;

      // Question card
      h += `<div style="background:rgba(68,221,170,.06);border:1px solid rgba(68,221,170,.15);border-radius:8px;padding:8px;text-align:center;min-height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">`;

      if (!question) {
        h += `<div class="mono" style="color:#555">Loading...</div>`;
      } else if (quizMode === 'find') {
        h += `<div class="mono" style="color:#aaa;font-size:8px">Play or click this note:</div>`;
        h += `<div class="mono" style="color:#44ddaa;font-size:26px;font-weight:900">${question.note}</div>`;
        if (answered) {
          h += `<div class="mono" style="color:${feedback === 'correct' ? '#00ff88' : '#ff4466'};font-size:13px;font-weight:700">${feedback === 'correct' ? '✓' : '✗ str ' + (question.si + 1) + ' fret ' + question.fret}</div>`;
        }
        h += `<button class="nq-replay mono" style="background:rgba(68,221,170,.1);border:1px solid rgba(68,221,170,.2);color:${accent};border-radius:4px;padding:2px 8px;cursor:pointer;font-size:7px">🔊 Replay</button>`;
      } else if (quizMode === 'name') {
        h += `<div class="mono" style="color:#aaa;font-size:8px">What note is on str ${question.si + 1} fret ${question.fret}?</div>`;
        if (answered) {
          h += `<div class="mono" style="color:${feedback === 'correct' ? '#00ff88' : '#ff4466'};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ ' + question.note}</div>`;
        } else {
          h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center">`;
          NOTES.forEach(n => {
            h += `<button class="chord-btn nq-answer" data-na="${n}" style="font-size:8px;min-width:26px;padding:2px 4px;font-weight:700">${n}</button>`;
          });
          h += `</div>`;
        }
      } else if (isTheory) {
        h += `<div class="mono" style="color:#ddd;font-size:10px;font-weight:600;line-height:1.4">${question.prompt}</div>`;

        if (answered) {
          h += `<div class="mono" style="color:${feedback === 'correct' ? '#00ff88' : '#ff4466'};font-size:16px;font-weight:900;margin:4px 0">${feedback === 'correct' ? '✓' : '✗'} ${question.answer}</div>`;
        } else {
          h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;margin-top:4px">`;

          if (quizMode === 'keysig' && question.answerVal !== undefined) {
            for (let i = 0; i <= 6; i++) {
              h += `<button class="chord-btn nq-theory" data-ta="${i}" style="font-size:8px;min-width:24px;padding:2px 5px">${i}</button>`;
            }
          } else if (quizMode === 'keysig') {
            NOTES.forEach(n => {
              h += `<button class="chord-btn nq-theory" data-ta="${n}" style="font-size:8px;min-width:24px;padding:2px 4px">${n}</button>`;
            });
          } else if (quizMode === 'chordfn' && question.answerNote) {
            NOTES.forEach(n => {
              h += `<button class="chord-btn nq-theory" data-ta="${n}" style="font-size:8px;min-width:24px;padding:2px 4px">${n}</button>`;
            });
          } else if (quizMode === 'chordfn' && question.nums) {
            question.nums.forEach((nm, i) => {
              h += `<button class="chord-btn nq-theory" data-ta="${i}" style="font-size:8px;padding:2px 5px">${nm}</button>`;
            });
          } else if (quizMode === 'degree' && question.answerDeg !== undefined) {
            DEGREE_NAMES.forEach((dn, i) => {
              h += `<button class="chord-btn nq-theory" data-ta="${i}" style="font-size:8px;padding:2px 5px">${dn}</button>`;
            });
          } else if (quizMode === 'degree') {
            NOTES.forEach(n => {
              h += `<button class="chord-btn nq-theory" data-ta="${n}" style="font-size:8px;min-width:24px;padding:2px 4px">${n}</button>`;
            });
          } else if (quizMode === 'ivlname' && question.semitones !== undefined && !question.startNote) {
            INTERVAL_NAMES.filter(x => x[0] > 0).forEach(([, nm]) => {
              h += `<button class="chord-btn nq-theory" data-ta="${nm}" style="font-size:7px;padding:2px 4px">${nm}</button>`;
            });
          } else {
            NOTES.forEach(n => {
              h += `<button class="chord-btn nq-theory" data-ta="${n}" style="font-size:8px;min-width:24px;padding:2px 4px">${n}</button>`;
            });
          }

          h += `</div>`;
        }
      }

      h += `</div>`;
      h += `<button class="nq-stop mono" style="background:rgba(255,60,60,.15);border:1px solid #ff4444;color:#ff6666;border-radius:8px;padding:5px 16px;cursor:pointer;font-size:10px;font-weight:700;width:100%">■ END</button>`;

    } else {
      if (score.correct > 0 || score.wrong > 0) {
        const total    = score.correct + score.wrong;
        const pctScore = total ? Math.round(score.correct / total * 100) : 0;

        h += `<div style="background:rgba(68,221,170,.06);border:1px solid rgba(68,221,170,.15);border-radius:8px;padding:10px;text-align:center">`;
        h += `<div class="mono" style="color:#44ddaa;font-size:26px;font-weight:900">${score.correct}</div>`;
        h += `<div class="mono" style="color:#888;font-size:9px">${score.correct}/${total} (${pctScore}%)</div>`;
        h += `<div class="mono" style="color:#dd8844;font-size:9px;margin-top:3px">Best streak: ${score.best}</div>`;
        if (score.correct >= bestScore && score.correct > 0) {
          h += `<div class="mono" style="color:#ffaa00;font-size:10px;font-weight:700;margin-top:3px">★ NEW BEST!</div>`;
        }
        h += `</div>`;
      }

      h += `<button class="nq-start mono" style="background:rgba(68,221,170,.15);border:1px solid ${accent};color:${accent};border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:1px;width:100%">▶ START ROUND</button>`;
    }

    h += `</div>`;
    el.innerHTML = h;

    // Wire up event handlers
    el.querySelectorAll('.nq-mode').forEach(b => b.onclick = e => {
      e.stopPropagation();
      quizMode = b.dataset.nm;
      if (running) endRound();
      render();
    });
    el.querySelectorAll('.nq-zone').forEach(b => b.onclick = e => {
      e.stopPropagation();
      zone = b.dataset.nz;
      render();
    });
    el.querySelectorAll('.nq-str').forEach(b => b.onclick = e => {
      e.stopPropagation();
      stringFocus = b.dataset.ns;
      render();
    });
    el.querySelectorAll('.nq-time').forEach(b => b.onclick = e => {
      e.stopPropagation();
      timeLimit = parseInt(b.dataset.nt);
      render();
    });
    el.querySelectorAll('.nq-answer').forEach(b => b.onclick = e => {
      e.stopPropagation();
      checkNameAnswer(b.dataset.na);
    });
    el.querySelectorAll('.nq-theory').forEach(b => b.onclick = e => {
      e.stopPropagation();
      checkTheoryAnswer(b.dataset.ta);
    });

    const startBtn = el.querySelector('.nq-start');
    if (startBtn) startBtn.onclick = e => { e.stopPropagation(); startRound(); };

    const stopBtn = el.querySelector('.nq-stop');
    if (stopBtn) stopBtn.onclick = e => { e.stopPropagation(); endRound(); };

    const replayBtn = el.querySelector('.nq-replay');
    if (replayBtn) replayBtn.onclick = e => {
      e.stopPropagation();
      if (question) playClickedNote(question.note, question.octave);
    };

    Object.assign(s, { quizMode, quizZone: zone, quizStrings: stringFocus, quizTime: timeLimit });
  }

  render();
}
