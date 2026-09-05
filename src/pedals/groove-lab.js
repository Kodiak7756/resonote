import { NOTES, toSharp } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, getInst } from '../core/tuning.js';
import { metroClock, pedalBus, setChordHighlight, clearChordHighlight } from '../core/state.js';
import { customTuning } from '../core/tuning.js';
import { makeKnob } from '../ui/pedal-system.js';
import { bus } from '../core/mixer.js';

export const RHYTHM_PATTERNS = {
  'Guitar Strum': {
    'All Down':     { beats: 4, steps: ['D', 'D', 'D', 'D'],                                                                         sub: 'quarter',  desc: 'Quarter note downstrokes' },
    'Down-Up':      { beats: 4, steps: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'],                                                    sub: '8th',      desc: 'Alternating 8th note strums' },
    'Folk':         { beats: 4, steps: ['D', '·', 'D', 'U', '·', 'U', 'D', 'U'],                                                    sub: '8th',      desc: 'Classic folk strum D_DU_UDU' },
    'Pop Rock':     { beats: 4, steps: ['D', '·', '·', 'D', '·', 'U', '·', 'U'],                                                    sub: '8th',      desc: 'Syncopated pop pattern' },
    'Funk Mute':    { beats: 4, steps: ['D', 'x', 'U', 'x', 'D', 'x', 'U', 'x'],                                                    sub: '8th',      desc: 'Funk with muted ghost strums' },
    'Reggae':       { beats: 4, steps: ['·', 'U', '·', 'U', '·', 'U', '·', 'U'],                                                    sub: '8th',      desc: 'Offbeat upstroke reggae skank' },
    'Country Train':{ beats: 4, steps: ['D', '·', 'D', 'U', 'D', '·', 'D', 'U'],                                                    sub: '8th',      desc: 'Boom-chick country rhythm' },
    'Ballad 6/8':   { beats: 6, steps: ['D', '·', '·', 'D', '·', '·'],                                                              sub: 'quarter',  desc: '6/8 time feel' },
    '16th Funk':    { beats: 4, steps: ['D', 'x', 'U', 'x', '·', 'x', 'U', '·', 'D', 'x', 'U', 'x', '·', 'x', 'U', '·'],         sub: '16th',     desc: 'Full 16th note funk pattern' },
  },
  'Picking': {
    'Alternating':  { beats: 4, steps: ['↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑'],                                                  sub: '8th',      desc: 'Alternate picking 8ths' },
    'Gallop':       { beats: 4, steps: ['↓', '↓', '↑', '↓', '↓', '↑', '↓', '↓', '↑', '↓', '↓', '↑'],                             sub: 'triplet',  desc: 'Triplet gallop pattern' },
    'Tremolo':      { beats: 4, steps: ['↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑'],       sub: '16th',     desc: '16th note tremolo picking' },
    'Swing 8ths':   { beats: 4, steps: ['↓', '·', '↑', '↓', '·', '↑', '↓', '·', '↑', '↓', '·', '↑'],                             sub: 'triplet',  desc: 'Swing feel' },
    'Economy 3s':   { beats: 4, steps: ['↓', '↓', '↓', '↑', '↑', '↑', '↓', '↓', '↓', '↑', '↑', '↑'],                             sub: 'triplet',  desc: 'Economy picking in groups of 3' },
  },
  'Rhythm Feel': {
    'Accent 1&3':    { beats: 4, steps: ['A', '·', 'A', '·'],                                                                        sub: 'quarter',  desc: 'Accent beats 1 and 3' },
    'Backbeat 2&4':  { beats: 4, steps: ['·', 'A', '·', 'A'],                                                                        sub: 'quarter',  desc: 'Accent beats 2 and 4' },
    'Bo Diddley':    { beats: 4, steps: ['A', '·', '·', 'A', 'A', '·', 'A', '·'],                                                   sub: '8th',      desc: 'Classic Bo Diddley rhythm' },
    'Clave 3-2':     { beats: 4, steps: ['A', '·', '·', 'A', '·', '·', 'A', '·', '·', '·', 'A', '·', 'A', '·', '·', '·'],        sub: '16th',     desc: 'Son clave 3-2 pattern' },
    'Shuffle':       { beats: 4, steps: ['A', '·', 'g', 'A', '·', 'g', 'A', '·', 'g', 'A', '·', 'g'],                              sub: 'triplet',  desc: 'Shuffle feel with ghost notes' },
    'Rest Practice': { beats: 4, steps: ['A', '·', '·', '·', 'A', '·', '·', '·'],                                                   sub: '8th',      desc: 'Play-rest pattern for internal pulse' },
  },
};

export function buildRhythmContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let cat = s.rhythmCat || 'Guitar Strum';
  let patName = s.rhythmPat || 'All Down';
  let stepIdx = 0;
  let editStep = null;
  let chordMode = s.rhyChordMode || 'uniform'; // uniform, per-step, random
  let uniformChord = s.rhyUniform || 'Am';
  let stepChords = s.rhyStepChords || null; // array parallel to steps, each null or chord string
  let lastClockConfig = metroClock.getConfigSignature();

  if (p._rhythmIntv) { clearInterval(p._rhythmIntv); p._rhythmIntv = null; }
  if (p._rhythmPlaying) { p._rhythmPlaying = false; }
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._rhythmPlaying) stopRhythm(); });

  const COMMON_CHORDS = ['C', 'Am', 'G', 'Em', 'D', 'Dm', 'A', 'E', 'F', 'Fm', 'Bm', 'B', 'A7', 'D7', 'E7', 'G7', 'Am7', 'Dm7', 'Cmaj7', 'X'];

  pedalBus.on(ev => {
    if (!ev.root || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    uniformChord = ev.root;
    render();
  });

  function getPat() {
    return RHYTHM_PATTERNS[cat]?.[patName] || RHYTHM_PATTERNS['Guitar Strum']['All Down'];
  }

  function ensureStepChords() {
    const pat = getPat();
    if (!stepChords || stepChords.length !== pat.steps.length) {
      stepChords = new Array(pat.steps.length).fill(null);
    }
  }

  function getChordForStep(si) {
    if (chordMode === 'uniform') return uniformChord;
    ensureStepChords();
    // Walk backward to find last assigned chord
    for (let i = si; i >= 0; i--) { if (stepChords[i]) return stepChords[i]; }
    // Wrap around
    for (let i = stepChords.length - 1; i > si; i--) { if (stepChords[i]) return stepChords[i]; }
    return uniformChord;
  }

  function parseChord(ch) {
    if (!ch || ch === 'X') return { root: 'X', notes: ['X'], label: 'Mute' };
    let rn = ch.length > 1 && (ch[1] === '#' || ch[1] === 'b') ? ch.slice(0, 2) : ch[0];
    const qual = ch.slice(rn.length) || '';
    rn = toSharp(rn);
    const formulas = {
      '':     [0, 4, 7],
      'm':    [0, 3, 7],
      '7':    [0, 4, 7, 10],
      'm7':   [0, 3, 7, 10],
      'maj7': [0, 4, 7, 11],
      'dim':  [0, 3, 6],
      'aug':  [0, 4, 8],
    };
    const f2 = formulas[qual.toLowerCase()] || formulas[''];
    return { root: rn, notes: f2.map(i => NOTES[(NOTES.indexOf(rn) + i) % 12]), label: ch };
  }

  // Everything handed to setChordHighlight below is the NECK's palette (root vs
  // tone, fill vs stroke, plus the greyed-out 'muted' set). Shared language with
  // every other pedal that lights the fretboard, so it stays literal.
  function highlightForStep(si) {
    if (currentInstrument === 'piano') return;
    const pat = getPat();
    const st = pat.steps[si];
    const ch = getChordForStep(si);
    const parsed = parseChord(ch);
    const isStrum = st === 'D' || st === 'U' || st === 'A';
    const isMute = st === 'x' || st === 'g';
    if (parsed.root === 'X' || (isMute && chordMode === 'uniform')) {
      const positions = customTuning.map((s2, i) => ({ si: i, fret: 0, note: 'X' }));
      setChordHighlight('X', ['X'], 'Muted — ' + st, positions,
        { root: '#555', tone: '#333', rootStroke: '#666', toneStroke: '#444' });
    } else if (isStrum || isMute) {
      setChordHighlight(parsed.root, parsed.notes,
        parsed.label + ' — ' + (isStrum ? (st === 'D' ? 'Down' : st === 'U' ? 'Up' : 'Accent') : 'Mute'),
        null,
        { root: '#bb66dd', tone: '#773399', rootStroke: '#dd88ff', toneStroke: '#9955cc' });
    } else if (st === '·') {
      // rest — dim the chord
      setChordHighlight(parsed.root, parsed.notes, parsed.label + ' — rest', null,
        { root: 'rgba(187,102,221,.3)', tone: 'rgba(119,51,153,.2)', rootStroke: 'rgba(187,102,221,.3)', toneStroke: 'rgba(119,51,153,.2)' });
    } else {
      // Picking: highlight chord context
      setChordHighlight(parsed.root, parsed.notes, parsed.label + ' — ' + st, null,
        { root: '#bb66dd', tone: '#773399', rootStroke: '#dd88ff', toneStroke: '#9955cc' });
    }
  }

  function tickRhythm(type) {
    try {
      if (!p._rCtx) p._rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = p._rCtx;
      const o = c.createOscillator();
      const g = c.createGain();
      if (type === 'D' || type === '↓' || type === 'A') {
        o.type = 'square'; o.frequency.value = 200; g.gain.value = 0.35;
      } else if (type === 'U' || type === '↑') {
        o.type = 'square'; o.frequency.value = 260; g.gain.value = 0.25;
      } else if (type === 'x') {
        o.type = 'sawtooth'; o.frequency.value = 80; g.gain.value = 0.15;
      } else if (type === 'g') {
        o.type = 'triangle'; o.frequency.value = 150; g.gain.value = 0.08;
      } else return;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
      o.connect(g);
      g.connect(bus(c, 'notes'));
      o.start();
      o.stop(c.currentTime + 0.06);
    } catch (e) {}
  }

  function startRhythm() {
    metroClock.stopOthers(p.id);                 // master transport: stop any other playing pedal
    const pat = getPat();
    p._rhythmPlaying = true;
    stepIdx = 0;
    editStep = null;
    if (chordMode === 'random') randomizeStepChords();
    metroClock.playing = true;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    tickRhythm(pat.steps[0]);
    highlightForStep(0);
    render();
    const tickInterval = 60000 / (metroClock.bpm || 120) / (pat.steps.length / pat.beats);
    p._rhythmIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % pat.steps.length;
      const st = pat.steps[stepIdx];
      const stepsPerBeat = pat.steps.length / Math.max(1, pat.beats);
      const beatIdx = Math.floor(stepIdx / stepsPerBeat) % Math.max(1, metroClock.ts || pat.beats || 4);
      if (stepIdx % stepsPerBeat === 0) {
        metroClock.playing = true;
        metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
      }
      if (st !== '·') tickRhythm(st);
      highlightForStep(stepIdx);
      updateRhythmDisplay();
    }, tickInterval);
  }

  function stopRhythm() {
    p._rhythmPlaying = false;
    clearInterval(p._rhythmIntv);
    p._rhythmIntv = null;
    stepIdx = 0;
    editStep = null;
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight();
    render();
  }

  function randomizeStepChords() {
    const pat = getPat();
    const stepsPerBeat = pat.steps.length / pat.beats;
    ensureStepChords();
    const pool = ['C', 'Am', 'G', 'Em', 'D', 'Dm', 'A', 'E', 'F', 'Bm'];
    for (let b = 0; b < pat.beats; b++) {
      const bi = b * stepsPerBeat;
      stepChords[bi] = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  function updateRhythmDisplay() {
    const cells = document.querySelectorAll(`#body-${p.id} .rhythm-step`);
    cells.forEach((c, i) => {
      const isCur = p._rhythmPlaying && i === stepIdx;
      // The same two values render() builds the cells with, so the grid does not
      // change appearance the first time the transport repaints it.
      c.style.background = isCur ? 'var(--rk-soft2)' : 'var(--rk-soft)';
      c.style.borderColor = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
    });
  }

  function render() {
    const pat = getPat();
    ensureStepChords();
    const useBpm = metroClock.bpm || 120;
    const accent = 'var(--rk-accent)';
    const stepsPerBeat = pat.steps.length / pat.beats;
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:4px">`;

    // Category tabs
    h += `<div style="display:flex;gap:2px">`;
    Object.keys(RHYTHM_PATTERNS).forEach(c => {
      h += `<button class="chord-btn rhy-cat" data-rc="${c}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${cat === c ? `background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}` : ''}">${c}</button>`;
    });
    h += `</div>`;

    // Pattern selector
    const pats = RHYTHM_PATTERNS[cat] || {};
    h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
    Object.keys(pats).forEach(pn => {
      h += `<button class="chord-btn rhy-pat" data-rp="${pn}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 4px;${patName === pn ? `background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}` : ''}">${pn}</button>`;
    });
    h += `</div>`;

    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${pat.desc}</div>`;

    // Chord mode
    h += `<div style="display:flex;gap:2px;align-items:center">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">CHORDS</span>`;
    [['uniform', 'Same'], ['per-step', 'Per Beat'], ['random', '🎲']].forEach(([m, label]) => {
      h += `<button class="chord-btn rhy-cm" data-cm="${m}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${chordMode === m ? `background:var(--rk-soft);border-color:var(--rk-line);color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // Uniform chord selector
    if (chordMode === 'uniform') {
      h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
      COMMON_CHORDS.forEach(ch => {
        h += `<button class="chord-btn rhy-uc" data-uc="${ch}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 3px;${uniformChord === ch ? `background:var(--rk-soft);border-color:var(--rk-line);color:${accent}` : ''}">${ch}</button>`;
      });
      h += `</div>`;
    }

    // Pattern grid with per-step chord labels
    h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:5px;overflow-x:auto">`;

    // Beat numbers
    h += `<div style="display:flex;gap:1px;margin-bottom:2px">`;
    for (let b = 0; b < pat.beats; b++) {
      h += `<div style="flex:${stepsPerBeat};text-align:center"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${b + 1}</span></div>`;
    }
    h += `</div>`;

    // Step cells (action row)
    h += `<div style="display:flex;gap:1px">`;
    pat.steps.forEach((st, si) => {
      const isCur = p._rhythmPlaying && si === stepIdx;
      const isDownbeat = si % stepsPerBeat === 0;
      // Down strokes are the accent, ups a quieter tint of it, an accented hit
      // is the lamp at full; mutes and ghosts drop to micro-label ink. The glyph
      // already names the stroke, so colour only carries WEIGHT here.
      const colors = { 'D': 'var(--rk-accent)', 'U': 'var(--rk-dim)', '↓': 'var(--rk-accent)', '↑': 'var(--rk-dim)', 'A': 'var(--rk-hot)', 'x': 'var(--rk-ink-mute)', 'g': 'var(--rk-ink-mute)', '·': 'transparent' };
      const bg = isCur ? 'var(--rk-soft2)' : st !== '·' ? 'var(--rk-soft)' : 'var(--rk-panel)';
      const bc = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
      const textColor = colors[st] || 'var(--rk-ink-mute)';
      h += `<div class="rhythm-step" style="flex:1;min-width:16px;height:22px;background:${bg};border:1px solid ${bc};${isDownbeat ? 'border-left-width:2px;' : ''}border-radius:2px;display:flex;align-items:center;justify-content:center;transition:all .08s">`;
      h += `<span class="mono" style="color:${textColor};font-size:calc(${st === '·' ? 8 : 10}px*var(--ui));font-weight:700">${st}</span>`;
      h += `</div>`;
    });
    h += `</div>`;

    // Chord row (under each step)
    if (chordMode === 'per-step' || chordMode === 'random') {
      h += `<div style="display:flex;gap:1px;margin-top:1px">`;
      pat.steps.forEach((st, si) => {
        const ch = stepChords[si];
        const isEdit = editStep === si;
        const isDownbeat = si % stepsPerBeat === 0;
        const bg = isEdit ? 'var(--rk-soft2)' : ch ? 'var(--rk-soft)' : 'var(--rk-panel)';
        const col = ch ? 'var(--rk-accent)' : 'var(--rk-ink-mute)';
        h += `<div class="rhy-step-ch" data-rsi="${si}" style="flex:1;min-width:16px;height:18px;background:${bg};border:1px solid ${isEdit ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};${isDownbeat ? 'border-left-width:2px;' : ''}border-radius:2px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .08s">`;
        h += `<span class="mono" style="color:${col};font-size:calc(8px*var(--ui));font-weight:${ch ? 700 : 400}">${ch || ''}</span>`;
        h += `</div>`;
      });
      h += `</div>`;
    }

    // Legend
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;justify-content:center">`;
    const legendItems = cat === 'Picking'
      ? [['↓', 'Down'], ['↑', 'Up'], ['·', 'Rest']]
      : cat === 'Rhythm Feel'
        ? [['A', 'Accent'], ['g', 'Ghost'], ['·', 'Rest']]
        : [['D', 'Down'], ['U', 'Up'], ['x', 'Mute'], ['·', 'Rest']];
    legendItems.forEach(([sym, label]) => {
      h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))"><span style="color:${accent}">${sym}</span> ${label}</span>`;
    });
    h += `</div></div>`;

    // Per-step chord picker (when editStep is set)
    if (editStep !== null && (chordMode === 'per-step' || chordMode === 'random')) {
      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:5px;padding:5px">`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-bottom:3px">Step ${editStep + 1} chord:</div>`;
      h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
      COMMON_CHORDS.forEach(ch => {
        const isCur = stepChords[editStep] === ch;
        h += `<button class="chord-btn rhy-pick" data-rpc="${ch}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 3px;${isCur ? `background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}` : ''}">${ch}</button>`;
      });
      h += `</div>`;
      h += `<div style="display:flex;gap:3px;margin-top:3px">`;
      h += `<button class="chord-btn rhy-pick-clear" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:var(--rk-ink-mute);flex:1">Clear (inherit)</button>`;
      h += `<button class="chord-btn rhy-pick-done" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));flex:1">Done</button>`;
      h += `</div></div>`;
    }

    // Tempo + Play
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">TEMPO</span>`;
    h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(11px*var(--ui));font-weight:700">${useBpm}</span>`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${pat.sub}</span>`;
    h += `</div>`;

    // While it reads STOP this is the halt control, so it takes the app-wide stop
    // red — one colour for "this ends it", found by reflex rather than by reading.
    // The 'A' accent glyph in the grid above keeps --rk-hot: that one means LOUD.
    const pc = p._rhythmPlaying ? 'var(--rk-stop-soft)' : 'var(--rk-soft)';
    const pb = p._rhythmPlaying ? 'var(--rk-stop-edge)' : 'var(--rk-line)';
    const pt = p._rhythmPlaying ? 'var(--rk-stop)'      : 'var(--rk-accent)';
    h += `<button class="rhy-play mono" style="min-height:calc(28px*var(--ui));background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:6px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${p._rhythmPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;
    el.innerHTML = h;

    // Wire events
    el.querySelectorAll('.rhy-cat').forEach(b => b.onclick = e => {
      e.stopPropagation();
      cat = b.dataset.rc;
      patName = Object.keys(RHYTHM_PATTERNS[cat] || {})[0] || 'All Down';
      stepChords = null;
      editStep = null;
      if (p._rhythmPlaying) { stopRhythm(); startRhythm(); } else render();
    });
    el.querySelectorAll('.rhy-pat').forEach(b => b.onclick = e => {
      e.stopPropagation();
      patName = b.dataset.rp;
      stepChords = null;
      editStep = null;
      if (p._rhythmPlaying) { stopRhythm(); startRhythm(); } else render();
    });
    el.querySelectorAll('.rhy-cm').forEach(b => b.onclick = e => {
      e.stopPropagation();
      chordMode = b.dataset.cm;
      editStep = null;
      if (chordMode === 'random') { stepChords = null; ensureStepChords(); randomizeStepChords(); }
      render();
    });
    el.querySelectorAll('.rhy-uc').forEach(b => b.onclick = e => {
      e.stopPropagation();
      uniformChord = b.dataset.uc;
      render();
    });
    el.querySelectorAll('.rhy-step-ch').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const si = parseInt(b.dataset.rsi);
      editStep = editStep === si ? null : si;
      render();
    });
    el.querySelectorAll('.rhy-pick').forEach(b => b.onclick = e => {
      e.stopPropagation();
      if (editStep !== null) { ensureStepChords(); stepChords[editStep] = b.dataset.rpc; render(); }
    });
    const clearPickBtn = el.querySelector('.rhy-pick-clear');
    if (clearPickBtn) clearPickBtn.onclick = e => {
      e.stopPropagation();
      if (editStep !== null) { ensureStepChords(); stepChords[editStep] = null; render(); }
    };
    const donePickBtn = el.querySelector('.rhy-pick-done');
    if (donePickBtn) donePickBtn.onclick = e => { e.stopPropagation(); editStep = null; render(); };
    el.querySelector('.rhy-play').onclick = e => {
      e.stopPropagation();
      if (p._rhythmPlaying) stopRhythm(); else startRhythm();
    };

    Object.assign(s, { rhythmCat: cat, rhythmPat: patName, rhyChordMode: chordMode, rhyUniform: uniformChord, rhyStepChords: stepChords });
  }

  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._rhythmPlaying) { stopRhythm(); startRhythm(); }
    else render();
  });

  render();

  if (p.settings && p.settings._autoStart) {
    delete p.settings._autoStart;
    if (!p._rhythmPlaying) startRhythm();
  }
}
