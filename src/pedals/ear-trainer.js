import { NOTES, CHORD_TYPES, INTERVAL_LABELS, intervalLabel, getChordNotes } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, getInst } from '../core/tuning.js';
import { metroClock } from '../core/state.js';
import { audio, playClickedNote } from '../core/audio.js';
import { makeKnob } from '../ui/pedal-system.js';

// ─── Tone utilities ───────────────────────────────────────────────────────────

function playTone(freq, dur, type, vol) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o   = ctx.createOscillator();
    const g   = ctx.createGain();
    o.type           = type || 'sine';
    o.frequency.value = freq;
    g.gain.value      = vol || 0.3;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.5));
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (dur || 0.5));
  } catch (e) {}
}

function noteToFreq(note, oct) {
  return 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (oct - 4));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildEarContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  let mode       = s.earMode || 'note';       // note | interval | intervalPlay | chord | melody
  let difficulty = s.earDiff || 'easy';       // easy | medium | hard
  let score      = { correct: 0, total: 0, streak: 0, best: 0 };
  let question   = null, answered = false, feedback = '', melodyIdx = 0;

  // ── Interval sets by difficulty ───────────────────────────────────────────

  const INTERVALS_EASY = [
    [0, 'Unison'], [3, 'm3'], [4, 'M3'], [5, 'P4'], [7, 'P5'], [12, 'Octave'],
  ];
  const INTERVALS_MED = [
    [0, 'Unison'], [1, 'm2'], [2, 'M2'], [3, 'm3'], [4, 'M3'],
    [5, 'P4'], [7, 'P5'], [8, 'm6'], [9, 'M6'], [12, 'Octave'],
  ];
  const INTERVALS_HARD = [
    [0, 'Unison'], [1, 'm2'], [2, 'M2'], [3, 'm3'], [4, 'M3'],
    [5, 'P4'], [6, 'TT'], [7, 'P5'], [8, 'm6'], [9, 'M6'],
    [10, 'm7'], [11, 'M7'], [12, 'Octave'],
  ];

  const CHORD_TYPES_EAR = [
    { name: 'Major',  intervals: [0, 4, 7] },
    { name: 'Minor',  intervals: [0, 3, 7] },
    { name: 'Dim',    intervals: [0, 3, 6] },
    { name: 'Aug',    intervals: [0, 4, 8] },
    { name: 'Maj7',   intervals: [0, 4, 7, 11] },
    { name: 'Min7',   intervals: [0, 3, 7, 10] },
    { name: 'Dom7',   intervals: [0, 4, 7, 10] },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getIntervalSet() {
    return difficulty === 'easy' ? INTERVALS_EASY
         : difficulty === 'medium' ? INTERVALS_MED
         : INTERVALS_HARD;
  }

  const pick    = a => a[Math.floor(Math.random() * a.length)];
  const randOct = () => difficulty === 'easy' ? 3 : 2 + Math.floor(Math.random() * 2);

  // ── Question generator ────────────────────────────────────────────────────

  function generateQuestion() {
    answered  = false;
    feedback  = '';
    melodyIdx = 0;

    const rn  = pick(NOTES);
    const oct = randOct();

    if (mode === 'note') {
      question = { type: 'note', note: rn, octave: oct };
      lastClickedNote = null;
      updateOverlays();
      setTimeout(() => playTone(noteToFreq(rn, oct), 0.6), 200);

    } else if (mode === 'interval') {
      const ivl   = pick(getIntervalSet());
      const note2 = NOTES[(NOTES.indexOf(rn) + ivl[0]) % 12];
      const oct2  = oct + Math.floor((NOTES.indexOf(rn) + ivl[0]) / 12);
      question = { type: 'interval', note1: rn, oct1: oct, semitones: ivl[0], name: ivl[1], note2 };
      lastClickedNote = { note: rn, octave: oct };
      updateOverlays();
      setTimeout(() => {
        playTone(noteToFreq(rn, oct), 0.5);
        setTimeout(() => playTone(noteToFreq(note2, oct2), 0.5), 600);
      }, 200);

    } else if (mode === 'intervalPlay') {
      const ivl   = pick(getIntervalSet().filter(x => x[0] > 0));
      const note2 = NOTES[(NOTES.indexOf(rn) + ivl[0]) % 12];
      const oct2  = oct + Math.floor((NOTES.indexOf(rn) + ivl[0]) / 12);
      question = { type: 'intervalPlay', note1: rn, oct1: oct, semitones: ivl[0], name: ivl[1], note2, oct2 };
      lastClickedNote = { note: rn, octave: oct };
      updateOverlays();
      setTimeout(() => {
        playTone(noteToFreq(rn, oct), 0.5);
        setTimeout(() => playTone(noteToFreq(note2, oct2), 0.5), 600);
      }, 200);

    } else if (mode === 'chord') {
      const ct = pick(difficulty === 'easy' ? CHORD_TYPES_EAR.slice(0, 4) : CHORD_TYPES_EAR);
      question = { type: 'chord', root: rn, octave: oct, chordType: ct };
      lastClickedNote = null;
      updateOverlays();
      setTimeout(() => {
        ct.intervals.forEach((iv, i) => {
          const n2 = NOTES[(NOTES.indexOf(rn) + iv) % 12];
          const o2 = oct + Math.floor((NOTES.indexOf(rn) + iv) / 12);
          setTimeout(() => playTone(noteToFreq(n2, o2), 0.8, 'sine', 0.2), i * 30);
        });
      }, 200);

    } else if (mode === 'melody') {
      const len    = difficulty === 'easy' ? 3 : difficulty === 'medium' ? 4 : 5;
      const notes2 = [];
      let cn = rn, co = oct;

      for (let i = 0; i < len; i++) {
        notes2.push({ note: cn, octave: co });
        const jump = pick([-2, -1, 0, 1, 2, 3, 4, 5]);
        cn = NOTES[((NOTES.indexOf(cn) + jump) % 12 + 12) % 12];
        co = oct;
      }

      question = { type: 'melody', notes: notes2, answered: [] };
      lastClickedNote = { note: notes2[0].note, octave: notes2[0].octave };
      updateOverlays();
      setTimeout(() => {
        notes2.forEach((n, i) => {
          setTimeout(() => playTone(noteToFreq(n.note, n.octave), 0.4), i * 500);
        });
      }, 200);
    }

    render();
  }

  // ── Answer checkers ───────────────────────────────────────────────────────

  function checkAnswer(note) {
    if (answered || !question) return;

    if (mode === 'note') {
      const correct = note === question.note;
      answered = true;
      score.total++;
      if (correct) {
        score.correct++;
        score.streak++;
        score.best = Math.max(score.best, score.streak);
        feedback = 'correct';
      } else {
        score.streak = 0;
        feedback = 'wrong';
      }
      setTimeout(() => generateQuestion(), 1200);

    } else if (mode === 'intervalPlay') {
      const correct = note === question.note2;
      answered = true;
      score.total++;
      if (correct) {
        score.correct++;
        score.streak++;
        score.best = Math.max(score.best, score.streak);
        feedback = 'correct';
      } else {
        score.streak = 0;
        feedback = 'wrong';
      }
      setTimeout(() => generateQuestion(), 1200);

    } else if (mode === 'melody') {
      const expected = question.notes[melodyIdx];
      if (note === expected.note) {
        question.answered.push(note);
        melodyIdx++;
        feedback = 'correct';
        if (melodyIdx >= question.notes.length) {
          answered = true;
          score.total++;
          score.correct++;
          score.streak++;
          score.best = Math.max(score.best, score.streak);
          setTimeout(() => generateQuestion(), 1200);
        }
      } else {
        feedback = 'wrong';
        answered = true;
        score.total++;
        score.streak = 0;
        setTimeout(() => generateQuestion(), 1200);
      }
    }

    render();
  }

  function checkInterval(semitones) {
    if (answered || !question || question.type !== 'interval') return;
    answered = true;
    score.total++;
    if (semitones === question.semitones) {
      score.correct++;
      score.streak++;
      score.best = Math.max(score.best, score.streak);
      feedback = 'correct';
    } else {
      score.streak = 0;
      feedback = 'wrong';
    }
    render();
    setTimeout(() => generateQuestion(), 1200);
  }

  function checkChord(name) {
    if (answered || !question || question.type !== 'chord') return;
    answered = true;
    score.total++;
    if (name === question.chordType.name) {
      score.correct++;
      score.streak++;
      score.best = Math.max(score.best, score.streak);
      feedback = 'correct';
    } else {
      score.streak = 0;
      feedback = 'wrong';
    }
    render();
    setTimeout(() => generateQuestion(), 1200);
  }

  // ── Input listeners ───────────────────────────────────────────────────────

  function onAudioForEar() {
    if (!question || answered) return;
    if (!document.getElementById(`body-${p.id}`)) return;
    const det = audio.detected;
    if (!det) return;
    if (mode === 'note' || mode === 'intervalPlay' || mode === 'melody') {
      checkAnswer(det.note);
    }
  }
  audio.on(onAudioForEar);

  function onFBClick(info) {
    if (!question || answered) return;
    if (!document.getElementById(`body-${p.id}`)) return;
    if (mode === 'note' || mode === 'intervalPlay' || mode === 'melody') {
      checkAnswer(info.note);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const accent = '#ee6688';
    const pct    = score.total ? Math.round(score.correct / score.total * 100) : 0;

    let h = `<div style="display:flex;flex-direction:column;gap:6px">`;

    // Mode selector
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    [
      ['note',         'Note Match'],
      ['interval',     'Interval ID'],
      ['intervalPlay', 'Interval Play'],
      ['chord',        'Chord ID'],
      ['melody',       'Melody Echo'],
    ].forEach(([m, label]) => {
      h += `<button class="chord-btn ear-mode" data-em="${m}" style="flex:1;font-size:7px;min-width:50px;${mode === m ? `background:rgba(238,102,136,.15);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // Difficulty
    h += `<div style="display:flex;gap:3px;justify-content:center">`;
    [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].forEach(([d, label]) => {
      h += `<button class="chord-btn ear-diff" data-ed="${d}" style="font-size:7px;${difficulty === d ? `background:rgba(238,102,136,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // Score bar
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:12px">`;
    h += `<span class="mono" style="color:#66aa55;font-size:10px;font-weight:700">${score.correct}/${score.total}</span>`;
    h += `<span class="mono" style="color:#888;font-size:8px">${pct}%</span>`;
    h += `<span class="mono" style="color:#dd8844;font-size:9px;font-weight:700">streak: ${score.streak}</span>`;
    if (score.best > 0) h += `<span class="mono" style="color:#555;font-size:8px">best: ${score.best}</span>`;
    h += `</div>`;

    // Question card
    h += `<div style="background:rgba(238,102,136,.04);border:1px solid rgba(238,102,136,.12);border-radius:8px;padding:10px;text-align:center;min-height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">`;

    if (!question) {
      h += `<div class="mono" style="color:#888;font-size:10px">Press START to begin</div>`;

    } else if (mode === 'note') {
      h += `<div class="mono" style="color:#aaa;font-size:8px">What note is this?</div>`;
      h += `<div class="mono" style="color:#ee6688;font-size:10px">Play it on your instrument or click the fretboard</div>`;
      if (answered) {
        const col = feedback === 'correct' ? '#00ff88' : '#ff4466';
        h += `<div class="mono" style="color:${col};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note : '✗ It was ' + question.note}</div>`;
      }
      h += `<button class="ear-replay mono" style="background:rgba(238,102,136,.1);border:1px solid rgba(238,102,136,.25);color:${accent};border-radius:5px;padding:3px 10px;cursor:pointer;font-size:8px">🔊 Replay</button>`;

    } else if (mode === 'interval') {
      h += `<div class="mono" style="color:#aaa;font-size:8px">Name this interval</div>`;
      h += `<div class="mono" style="color:#ee6688;font-size:11px">Starting from ${question.note1}</div>`;
      if (answered) {
        const col = feedback === 'correct' ? '#00ff88' : '#ff4466';
        h += `<div class="mono" style="color:${col};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.name : '✗ It was ' + question.name}</div>`;
      }
      h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
      getIntervalSet().forEach(([semi, name]) => {
        h += `<button class="chord-btn ear-ivl" data-semi="${semi}" style="font-size:8px;padding:3px 6px;min-width:30px">${name}</button>`;
      });
      h += `</div>`;
      h += `<button class="ear-replay mono" style="background:rgba(238,102,136,.1);border:1px solid rgba(238,102,136,.25);color:${accent};border-radius:5px;padding:3px 10px;cursor:pointer;font-size:8px">🔊 Replay</button>`;

    } else if (mode === 'intervalPlay') {
      h += `<div class="mono" style="color:#aaa;font-size:8px">Play the second note</div>`;
      h += `<div class="mono" style="color:#ee6688;font-size:11px">First note: <span style="color:#ffbb66;font-weight:700">${question.note1}</span> — Interval: <span style="font-weight:700">${question.name}</span></div>`;
      if (answered) {
        const col = feedback === 'correct' ? '#00ff88' : '#ff4466';
        h += `<div class="mono" style="color:${col};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.note2 : '✗ It was ' + question.note2}</div>`;
      }
      h += `<button class="ear-replay mono" style="background:rgba(238,102,136,.1);border:1px solid rgba(238,102,136,.25);color:${accent};border-radius:5px;padding:3px 10px;cursor:pointer;font-size:8px">🔊 Replay</button>`;

    } else if (mode === 'chord') {
      h += `<div class="mono" style="color:#aaa;font-size:8px">What type of chord?</div>`;
      h += `<div class="mono" style="color:#ee6688;font-size:11px">Root: ${question.root}</div>`;
      if (answered) {
        const col = feedback === 'correct' ? '#00ff88' : '#ff4466';
        h += `<div class="mono" style="color:${col};font-size:16px;font-weight:900">${feedback === 'correct' ? '✓ ' + question.chordType.name : '✗ It was ' + question.chordType.name}</div>`;
      }
      h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
      const chSet = difficulty === 'easy' ? CHORD_TYPES_EAR.slice(0, 4) : CHORD_TYPES_EAR;
      chSet.forEach(ct => {
        h += `<button class="chord-btn ear-chtype" data-ct="${ct.name}" style="font-size:8px;padding:3px 6px">${ct.name}</button>`;
      });
      h += `</div>`;
      h += `<button class="ear-replay mono" style="background:rgba(238,102,136,.1);border:1px solid rgba(238,102,136,.25);color:${accent};border-radius:5px;padding:3px 10px;cursor:pointer;font-size:8px">🔊 Replay</button>`;

    } else if (mode === 'melody') {
      const len = question.notes.length;
      h += `<div class="mono" style="color:#aaa;font-size:8px">Play back the melody (${melodyIdx}/${len})</div>`;
      h += `<div style="display:flex;gap:4px;justify-content:center">`;
      question.notes.forEach((n, i) => {
        const done = i < melodyIdx;
        const cur  = i === melodyIdx && !answered;
        const col  = done ? '#00ff88' : cur ? '#ffd060' : '#333';
        h += `<div style="width:20px;height:20px;border-radius:50%;background:${col};border:1px solid ${done ? '#00ff8844' : cur ? '#ffd06044' : '#444'};display:flex;align-items:center;justify-content:center">`;
        if (done) h += `<span class="mono" style="color:#111;font-size:7px;font-weight:700">${n.note}</span>`;
        h += `</div>`;
      });
      h += `</div>`;

      if (answered && feedback === 'wrong') {
        h += `<div class="mono" style="color:#ff4466;font-size:10px;font-weight:700">✗ Expected: ${question.notes.map(n => n.note).join(' → ')}</div>`;
      } else if (answered && feedback === 'correct') {
        h += `<div class="mono" style="color:#00ff88;font-size:14px;font-weight:900">✓ Perfect!</div>`;
      }
      h += `<button class="ear-replay mono" style="background:rgba(238,102,136,.1);border:1px solid rgba(238,102,136,.25);color:${accent};border-radius:5px;padding:3px 10px;cursor:pointer;font-size:8px">🔊 Replay</button>`;
    }

    h += `</div>`;

    // Input hint
    h += `<div class="mono" style="color:#555;font-size:7px;text-align:center">Answer by: playing your instrument · clicking the fretboard/keyboard${mode === 'interval' || mode === 'chord' ? ' · tapping buttons above' : ''}</div>`;

    // Start / Next button
    h += `<button class="ear-start mono" style="background:rgba(238,102,136,.15);border:1px solid ${accent};color:${accent};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">${question ? 'NEXT' : '▶ START'}</button>`;

    h += `</div>`;
    el.innerHTML = h;

    // Wire up event handlers
    el.querySelectorAll('.ear-mode').forEach(b => b.onclick = e => {
      e.stopPropagation();
      mode     = b.dataset.em;
      question = null;
      score    = { correct: 0, total: 0, streak: 0, best: 0 };
      render();
    });
    el.querySelectorAll('.ear-diff').forEach(b => b.onclick = e => {
      e.stopPropagation();
      difficulty = b.dataset.ed;
      question   = null;
      score      = { correct: 0, total: 0, streak: 0, best: 0 };
      render();
    });
    el.querySelectorAll('.ear-ivl').forEach(b => b.onclick = e => {
      e.stopPropagation();
      checkInterval(parseInt(b.dataset.semi));
    });
    el.querySelectorAll('.ear-chtype').forEach(b => b.onclick = e => {
      e.stopPropagation();
      checkChord(b.dataset.ct);
    });

    const replayBtn = el.querySelector('.ear-replay');
    if (replayBtn) replayBtn.onclick = e => {
      e.stopPropagation();
      if (!question) return;

      if (mode === 'note') {
        playTone(noteToFreq(question.note, question.octave), 0.6);
      } else if (mode === 'interval' || mode === 'intervalPlay') {
        const n2 = NOTES[(NOTES.indexOf(question.note1) + question.semitones) % 12];
        const o2 = question.oct1 + Math.floor((NOTES.indexOf(question.note1) + question.semitones) / 12);
        playTone(noteToFreq(question.note1, question.oct1), 0.5);
        setTimeout(() => playTone(noteToFreq(n2, o2), 0.5), 600);
      } else if (mode === 'chord') {
        question.chordType.intervals.forEach((iv, i) => {
          const n2 = NOTES[(NOTES.indexOf(question.root) + iv) % 12];
          const o2 = question.octave + Math.floor((NOTES.indexOf(question.root) + iv) / 12);
          setTimeout(() => playTone(noteToFreq(n2, o2), 0.8, 'sine', 0.2), i * 30);
        });
      } else if (mode === 'melody') {
        question.notes.forEach((n, i) => {
          setTimeout(() => playTone(noteToFreq(n.note, n.octave), 0.4), i * 500);
        });
      }
    };

    el.querySelector('.ear-start').onclick = e => {
      e.stopPropagation();
      onFretboardClick = onFBClick;
      generateQuestion();
    };

    Object.assign(s, { earMode: mode, earDiff: difficulty });
  }

  render();

  // Handle auto-start from Practice Manager
  if (p.settings && p.settings._autoStart) {
    delete p.settings._autoStart;
    onFretboardClick = onFBClick;
    generateQuestion();
  }
}
