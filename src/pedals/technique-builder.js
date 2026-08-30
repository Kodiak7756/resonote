import { NOTES } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, getInst, customTuning, getNoteAtFret } from '../core/tuning.js';
import { metroClock } from '../core/state.js';
import { makeKnob } from '../ui/pedal-system.js';
import { bus } from '../core/mixer.js';

// ─── Exercise data ────────────────────────────────────────────────────────────

export const TECHNIQUE_EXERCISES = {
  'Hammer-On': {
    symbol: 'H',
    desc: 'Fret a note then hammer finger down on higher fret without picking',
    exercises: [
      { name: 'Single H-O',   steps: [[5, 0, 'pick'], [5, 2, 'H']],                                                           desc: 'Open to 2nd fret' },
      { name: 'Chromatic H',  steps: [[5, 1, 'pick'], [5, 2, 'H'], [5, 3, 'H'], [5, 4, 'H']],                                 desc: 'Walk up frets 1-4' },
      { name: 'Pentatonic H', steps: [[5, 0, 'pick'], [5, 3, 'H'], [4, 0, 'pick'], [4, 2, 'H']],                              desc: 'Minor pentatonic hammers' },
      { name: 'Trill',        steps: [[5, 5, 'pick'], [5, 7, 'H'], [5, 5, 'P'], [5, 7, 'H'], [5, 5, 'P'], [5, 7, 'H']],      desc: 'Rapid hammer-pull trill' },
    ],
  },
  'Pull-Off': {
    symbol: 'P',
    desc: 'Fret two notes, pick the higher, pull finger off to sound the lower',
    exercises: [
      { name: 'Single P-O',  steps: [[5, 2, 'pick'], [5, 0, 'P']],                                                                              desc: '2nd fret to open' },
      { name: 'Chromatic P', steps: [[5, 4, 'pick'], [5, 3, 'P'], [5, 2, 'P'], [5, 1, 'P']],                                                    desc: 'Walk down frets 4-1' },
      { name: 'Legato Run',  steps: [[5, 5, 'pick'], [5, 7, 'H'], [5, 5, 'P'], [5, 3, 'P'], [5, 5, 'pick'], [5, 7, 'H']],                       desc: 'Combined H and P legato' },
      { name: 'Triple Pull', steps: [[4, 5, 'pick'], [4, 3, 'P'], [4, 0, 'P']],                                                                 desc: 'Three-note pull-off cascade' },
    ],
  },
  'Slide': {
    symbol: '/',
    desc: 'Pick a note then slide finger up or down to target fret',
    exercises: [
      { name: 'Slide Up',    steps: [[5, 3, 'pick'], [5, 5, '/']],                                                                        desc: 'Slide from 3rd to 5th fret' },
      { name: 'Slide Down',  steps: [[5, 7, 'pick'], [5, 5, '\\']],                                                                       desc: 'Slide from 7th to 5th fret' },
      { name: 'Octave Slide',steps: [[5, 5, 'pick'], [5, 12, '/']],                                                                       desc: 'Full octave slide up' },
      { name: 'Double Slide',steps: [[5, 3, 'pick'], [5, 5, '/'], [5, 7, '/'], [5, 5, '\\'], [5, 3, '\\']],                               desc: 'Up and back sliding' },
      { name: 'Cross String',steps: [[5, 5, 'pick'], [5, 7, '/'], [4, 5, 'pick'], [4, 7, '/']],                                           desc: 'Slide pattern across strings' },
    ],
  },
  'Bend': {
    symbol: 'b',
    desc: 'Push or pull string to raise pitch — half step, whole step, or more',
    exercises: [
      { name: 'Half Bend',    steps: [[2, 7, 'pick'], [2, 7, 'b½']],                   desc: 'Bend up half step (1 fret)' },
      { name: 'Whole Bend',   steps: [[2, 7, 'pick'], [2, 7, 'b1']],                   desc: 'Bend up whole step (2 frets)' },
      { name: 'Bend Release', steps: [[2, 7, 'pick'], [2, 7, 'b1'], [2, 7, 'r']],      desc: 'Bend up then release back' },
      { name: 'Pre-Bend',     steps: [[2, 7, 'pb'],   [2, 7, 'r']],                    desc: 'Bend before picking, then release' },
      { name: 'Bend Vibrato', steps: [[2, 7, 'pick'], [2, 7, 'b1'], [2, 7, '~']],      desc: 'Bend then add vibrato at top' },
    ],
  },
  'Vibrato': {
    symbol: '~',
    desc: 'Rapid subtle bending to add warmth and sustain to a note',
    exercises: [
      { name: 'Slow Vibrato', steps: [[2, 7, 'pick'], [2, 7, '~s']],                              desc: 'Wide, slow vibrato' },
      { name: 'Fast Vibrato', steps: [[2, 7, 'pick'], [2, 7, '~f']],                              desc: 'Tight, fast vibrato' },
      { name: 'BB King',      steps: [[1, 8, 'pick'], [1, 8, 'b½'], [1, 8, '~s']],               desc: 'Bend then add signature slow vibrato' },
      { name: 'String Walk',  steps: [[5, 5, 'pick'], [5, 5, '~f'], [4, 5, 'pick'], [4, 5, '~f'], [3, 5, 'pick'], [3, 5, '~f']], desc: 'Vibrato on each string' },
    ],
  },
};

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildTechniqueContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  let techCat      = s.techCat    || 'Hammer-On';
  let exName       = s.techEx     || 'Single H-O';
  let stepIdx      = 0;
  let stringOffset = s.techString || 0;
  let lastClockConfig = metroClock.getConfigSignature();

  if (p._techIntv)   { clearInterval(p._techIntv); p._techIntv = null; }
  if (p._techPlaying) p._techPlaying = false;
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._techPlaying) stopTech(); });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getEx() {
    const cat = TECHNIQUE_EXERCISES[techCat];
    return cat?.exercises?.find(e => e.name === exName) || cat?.exercises?.[0] || { steps: [], desc: '' };
  }

  function getAdjustedStep(step) {
    const si = Math.max(0, Math.min(customTuning.length - 1, step[0] + stringOffset));
    return [si, step[1], step[2]];
  }

  // ── Fretboard highlight ───────────────────────────────────────────────────

  function highlightTechStep() {
    const ex = getEx();
    if (!ex.steps.length || stepIdx >= ex.steps.length) return;

    const step   = getAdjustedStep(ex.steps[stepIdx]);
    const si     = step[0], fret = step[1], action = step[2];
    const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);

    const positions = [{ si, fret, note }];
    let label = `${note} str ${si + 1} fret ${fret}`;

    // Look ahead for a connected (legato) note
    if (stepIdx + 1 < ex.steps.length) {
      const next    = getAdjustedStep(ex.steps[stepIdx + 1]);
      const nAction = next[2];

      if (nAction !== 'pick') {
        const { note: nn } = getNoteAtFret(customTuning[next[0]].note, customTuning[next[0]].octave, next[1]);
        positions.push({ si: next[0], fret: next[1], note: nn });

        const symMap = {
          'H': '→H', 'P': '→P', '/': '→/', '\\': '→\\',
          'b½': '↑b½', 'b1': '↑b1', 'r': '↓rel', 'pb': 'pre-b',
          '~': '~', '~s': '~slow', '~f': '~fast',
        };
        label += ` ${symMap[nAction] || nAction} ${nn}`;
      }
    }

    const focusPos = { si, fret, note };
    const allNotes = [...new Set(positions.map(pp => pp.note))];

    setChordHighlight(
      note, allNotes, `${techCat}: ${label}`, positions,
      // Fretboard overlay palette — the neck's own language, not chrome.
      { root: '#ff7744', tone: '#cc5522', rootStroke: '#ffaa66', toneStroke: '#dd7744' },
      focusPos,
    );
  }

  // ── Audio playback ────────────────────────────────────────────────────────

  function playTechNote(step) {
    try {
      if (!p._tCtx) p._tCtx = new (window.AudioContext || window.webkitAudioContext)();

      const ctx    = p._tCtx, t = ctx.currentTime;
      const si     = step[0], fret = step[1], action = step[2];
      const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
      const oct    = customTuning[si].octave + Math.floor((NOTES.indexOf(customTuning[si].note) + fret) / 12);
      const freq   = 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (oct - 4));

      const o = ctx.createOscillator();
      const g = ctx.createGain();

      function connectAndPlay() {
        o.connect(g);
        g.connect(bus(ctx, 'notes'));
        o.start(t);
        o.stop(t + 0.5);
      }

      if (action === 'pick') {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      } else if (action === 'H') {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      } else if (action === 'P') {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      } else if (action === '/' || action === '\\') {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        // Glide frequency for slides
        if (stepIdx > 0) {
          const prev = getAdjustedStep(getEx().steps[stepIdx - 1]);
          const pn   = getNoteAtFret(customTuning[prev[0]].note, customTuning[prev[0]].octave, prev[1]);
          const poct = customTuning[prev[0]].octave + Math.floor((NOTES.indexOf(customTuning[prev[0]].note) + prev[1]) / 12);
          const pf   = 440 * Math.pow(2, (NOTES.indexOf(pn.note) - 9) / 12 + (poct - 4));
          o.frequency.setValueAtTime(pf, t);
          o.frequency.exponentialRampToValueAtTime(freq, t + 0.15);
          return connectAndPlay();
        }
      } else if (action.startsWith('b')) {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        const bendSemis  = action === 'b½' ? 1 : 2;
        const targetFreq = freq * Math.pow(2, bendSemis / 12);
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(targetFreq, t + 0.2);
        return connectAndPlay();
      } else if (action === 'r') {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      } else if (action === 'pb') {
        g.gain.setValueAtTime(0, t);
        return; // silent pre-bend
      } else if (action.startsWith('~')) {
        o.type = 'triangle';
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

        const rate  = action === '~f' ? 6 : 3;
        const depth = action === '~f' ? 3 : 6;
        const lfo   = ctx.createOscillator();
        const lg    = ctx.createGain();
        lfo.frequency.value = rate;
        lg.gain.value       = depth;
        lfo.connect(lg);
        lg.connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 0.5);
      } else {
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      }

      o.frequency.value = freq;
      connectAndPlay();
    } catch (e) {}
  }

  // ── Playback control ──────────────────────────────────────────────────────

  function startTech() {
    metroClock.stopOthers(p.id);
    const ex = getEx();
    if (!ex.steps.length) { p._techPlaying = false; render(); return; }

    p._techPlaying = true;
    stepIdx = 0;
    metroClock.playing = true;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    highlightTechStep();
    playTechNote(getAdjustedStep(ex.steps[0]));
    render();

    const useBpm = metroClock.bpm || 80;
    p._techIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % ex.steps.length;
      const beatIdx = stepIdx % Math.max(1, metroClock.ts || 4);
      metroClock.playing = true;
      metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
      highlightTechStep();
      playTechNote(getAdjustedStep(ex.steps[stepIdx]));
      updateTechDisplay();
    }, 60000 / useBpm);
  }

  function stopTech() {
    p._techPlaying = false;
    clearInterval(p._techIntv);
    p._techIntv = null;
    stepIdx = 0;
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight();
    render();
  }

  function updateTechDisplay() {
    const cells = document.querySelectorAll(`#body-${p.id} .tech-step`);
    cells.forEach((c, i) => {
      const isCur = p._techPlaying && i === stepIdx;
      // Same two values the build below uses. Repaint with anything else and
      // the strip's resting cells drift the moment playback starts.
      c.style.background   = isCur ? 'var(--rk-soft2)' : 'var(--rk-soft)';
      c.style.borderColor  = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const ex     = getEx();
    const accent = 'var(--rk-accent)';
    const useBpm = metroClock.bpm || 80;

    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:5px">`;

    // Category tabs
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    Object.keys(TECHNIQUE_EXERCISES).forEach(tc => {
      const sym = TECHNIQUE_EXERCISES[tc].symbol;
      h += `<button class="chord-btn tech-cat" data-tc="${tc}" style="flex:1;font-size:calc(7px*var(--ui));${techCat === tc ? `background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}` : ''}">${sym} ${tc}</button>`;
    });
    h += `</div>`;

    // Description
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));text-align:center">${TECHNIQUE_EXERCISES[techCat]?.desc || ''}</div>`;

    // Exercise selector
    const exs = TECHNIQUE_EXERCISES[techCat]?.exercises || [];
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    exs.forEach(e => {
      h += `<button class="chord-btn tech-ex" data-te="${e.name}" style="font-size:calc(7px*var(--ui));padding:2px 5px;${exName === e.name ? `background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}` : ''}">${e.name}</button>`;
    });
    h += `</div>`;

    h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));text-align:center">${ex.desc}</div>`;

    // String offset
    h += `<div style="display:flex;gap:2px;align-items:center;justify-content:center">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">START STRING</span>`;
    customTuning.forEach((_, i) => {
      h += `<button class="chord-btn tech-str" data-ts="${i}" style="font-size:calc(7px*var(--ui));min-width:18px;${stringOffset === i ? `background:var(--rk-soft);border-color:var(--rk-line);color:${accent}` : ''}">${i + 1}</button>`;
    });
    h += `</div>`;

    // Step display
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:6px">`;
    ex.steps.forEach((step, si) => {
      const adj    = getAdjustedStep(step);
      const { note } = getNoteAtFret(customTuning[adj[0]].note, customTuning[adj[0]].octave, adj[1]);
      const isCur  = p._techPlaying && si === stepIdx;
      const bg     = isCur ? 'var(--rk-soft2)' : 'var(--rk-soft)';
      const bc     = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
      const actionLabel = {
        pick: '♩', H: 'H', P: 'P', '/': '/', '\\': '\\',
        'b½': 'b½', b1: 'b1', r: 'rel', pb: 'pre', '~': '~', '~s': '~s', '~f': '~f',
      }[step[2]] || step[2];

      h += `<div class="tech-step" style="background:${bg};border:1.5px solid ${bc};border-radius:4px;padding:3px 5px;text-align:center;min-width:30px;transition:all .1s">`;
      h += `<div class="mono" style="color:${step[2] === 'pick' ? 'var(--rk-accent)' : 'var(--rk-dim)'};font-size:calc(11px*var(--ui));font-weight:800">${actionLabel}</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(7px*var(--ui));font-weight:600">${note}</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(6px*var(--ui))">s${adj[0] + 1} f${adj[1]}</div>`;
      h += `</div>`;
    });
    h += `</div>`;

    // Tempo display
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">TEMPO</span>`;
    h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(11px*var(--ui));font-weight:700">${useBpm}</span>`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">BPM</span>`;
    h += `</div>`;

    // Play/stop button. While it reads ■ STOP it is not the pedal reporting that
    // it is live — it is the control that halts the drill, so it leaves the pedal's
    // lamp behind and takes the app-wide stop red. Every transport stops in one
    // colour; hunting for the red thing has to work mid-exercise.
    const pc = p._techPlaying ? 'var(--rk-stop-soft)' : 'var(--rk-soft)';
    const pb = p._techPlaying ? 'var(--rk-stop-edge)' : 'var(--rk-line)';
    const pt = p._techPlaying ? 'var(--rk-stop)'      : accent;
    h += `<button class="tech-play mono" style="background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:6px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${p._techPlaying ? '■ STOP' : '▶ PLAY'}</button>`;

    h += `</div>`;
    el.innerHTML = h;

    // Wire up event handlers
    el.querySelectorAll('.tech-cat').forEach(b => b.onclick = e => {
      e.stopPropagation();
      techCat = b.dataset.tc;
      exName  = TECHNIQUE_EXERCISES[techCat]?.exercises?.[0]?.name || '';
      if (p._techPlaying) { stopTech(); startTech(); } else render();
    });
    el.querySelectorAll('.tech-ex').forEach(b => b.onclick = e => {
      e.stopPropagation();
      exName = b.dataset.te;
      if (p._techPlaying) { stopTech(); startTech(); } else render();
    });
    el.querySelectorAll('.tech-str').forEach(b => b.onclick = e => {
      e.stopPropagation();
      stringOffset = parseInt(b.dataset.ts);
      if (p._techPlaying) { stopTech(); startTech(); } else render();
    });
    el.querySelector('.tech-play').onclick = e => {
      e.stopPropagation();
      if (p._techPlaying) stopTech(); else startTech();
    };

    Object.assign(s, { techCat, techEx: exName, techString: stringOffset });
  }

  // Restart on tempo change
  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._techPlaying) { stopTech(); startTech(); }
    else render();
  });

  render();
}
