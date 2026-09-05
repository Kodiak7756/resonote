import { NOTES, toSharp } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, customTuning, getInst } from '../core/tuning.js';
import { metroClock, pedalBus, setChordHighlight, clearChordHighlight } from '../core/state.js';
import { getNoteAtFret } from '../core/tuning.js';
import { makeKnob } from '../ui/pedal-system.js';
import { bus } from '../core/mixer.js';

// Guitar/banjo: p=thumb, i=index, m=middle, a=ring. String assignments.
// Piano: 1-5 fingering on scale degrees.
export const FINGER_PATTERNS = {
  guitar: {
    label: 'Guitar (p-i-m-a)',
    patterns: {
      'Travis Basic':    { steps: [{ s: 5, f: 'p' }, { s: 2, f: 'i' }, { s: 4, f: 'p' }, { s: 1, f: 'm' }, { s: 5, f: 'p' }, { s: 2, f: 'i' }, { s: 4, f: 'p' }, { s: 1, f: 'm' }], desc: 'Alternating bass with melody — foundation of fingerstyle' },
      'Travis Adv':      { steps: [{ s: 5, f: 'p' }, { s: 2, f: 'i' }, { s: 3, f: 'm' }, { s: 4, f: 'p' }, { s: 1, f: 'a' }, { s: 2, f: 'i' }, { s: 3, f: 'm' }, { s: 1, f: 'a' }], desc: 'Advanced Travis — bass walks while fingers alternate' },
      'Classical Arp':   { steps: [{ s: 5, f: 'p' }, { s: 3, f: 'i' }, { s: 2, f: 'm' }, { s: 1, f: 'a' }], desc: 'Standard classical arpeggio p-i-m-a' },
      'Reverse Arp':     { steps: [{ s: 1, f: 'a' }, { s: 2, f: 'm' }, { s: 3, f: 'i' }, { s: 5, f: 'p' }], desc: 'Descending arpeggio a-m-i-p' },
      'Pinch Roll':      { steps: [{ s: 5, f: 'p' }, { s: 1, f: 'a' }, { s: 3, f: 'i' }, { s: 2, f: 'm' }, { s: 5, f: 'p' }, { s: 1, f: 'a' }, { s: 2, f: 'm' }, { s: 3, f: 'i' }], desc: 'Pinch bass+treble then roll inner strings' },
      'Dust in Wind':    { steps: [{ s: 5, f: 'p' }, { s: 3, f: 'i' }, { s: 1, f: 'a' }, { s: 2, f: 'm' }, { s: 3, f: 'i' }, { s: 1, f: 'a' }], desc: 'The iconic Kansas picking pattern' },
      'Landslide':       { steps: [{ s: 4, f: 'p' }, { s: 2, f: 'i' }, { s: 1, f: 'm' }, { s: 2, f: 'i' }, { s: 4, f: 'p' }, { s: 2, f: 'i' }, { s: 1, f: 'm' }, { s: 2, f: 'i' }], desc: 'Fleetwood Mac style rolling pattern' },
      'House of Rising': { steps: [{ s: 5, f: 'p' }, { s: 3, f: 'i' }, { s: 2, f: 'm' }, { s: 1, f: 'a' }, { s: 2, f: 'm' }, { s: 3, f: 'i' }], desc: 'Classic folk arpeggio, ascending and descending' },
    },
  },
  banjo: {
    label: 'Banjo (T-I-M)',
    patterns: {
      'Forward Roll':  { steps: [{ s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 1, f: 'I' }], desc: 'Basic forward roll T-I-M' },
      'Backward Roll': { steps: [{ s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }], desc: 'Backward roll M-I-T' },
      'Alternating':   { steps: [{ s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }], desc: 'Alternating thumb roll' },
      'Foggy Mtn':     { steps: [{ s: 1, f: 'I' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 0, f: 'M' }], desc: 'Foggy Mountain Breakdown roll' },
      'Lick Roll':     { steps: [{ s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 2, f: 'T' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }], desc: 'Melodic lick roll with thumb anchor' },
      'Inside-Out':    { steps: [{ s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }, { s: 0, f: 'M' }, { s: 1, f: 'I' }, { s: 2, f: 'T' }], desc: 'Inside-out pinch roll' },
    },
  },
  piano: {
    label: 'Piano (1-2-3-4-5)',
    patterns: {
      '5-Note Asc':   { steps: [{ d: 0, f: '1' }, { d: 1, f: '2' }, { d: 2, f: '3' }, { d: 3, f: '4' }, { d: 4, f: '5' }], desc: 'Five-finger ascending scale pattern' },
      '5-Note Desc':  { steps: [{ d: 4, f: '5' }, { d: 3, f: '4' }, { d: 2, f: '3' }, { d: 1, f: '2' }, { d: 0, f: '1' }], desc: 'Five-finger descending pattern' },
      '5-Note Cycle': { steps: [{ d: 0, f: '1' }, { d: 1, f: '2' }, { d: 2, f: '3' }, { d: 3, f: '4' }, { d: 4, f: '5' }, { d: 3, f: '4' }, { d: 2, f: '3' }, { d: 1, f: '2' }], desc: 'Up and back five-finger exercise' },
      'Alberti Bass': { steps: [{ d: 0, f: '1' }, { d: 4, f: '5' }, { d: 2, f: '3' }, { d: 4, f: '5' }], desc: 'Classic Alberti bass pattern 1-5-3-5' },
      'Triad Arp':    { steps: [{ d: 0, f: '1' }, { d: 2, f: '2' }, { d: 4, f: '3' }, { d: 7, f: '5' }], desc: 'Triad arpeggio with octave 1-2-3-5' },
      'Hanon 1':      { steps: [{ d: 0, f: '1' }, { d: 1, f: '2' }, { d: 2, f: '3' }, { d: 3, f: '4' }, { d: 4, f: '5' }, { d: 3, f: '4' }, { d: 2, f: '3' }, { d: 1, f: '2' }], desc: 'Hanon exercise #1 pattern' },
      'Thumb Cross':  { steps: [{ d: 0, f: '1' }, { d: 1, f: '2' }, { d: 2, f: '3' }, { d: 3, f: '1' }, { d: 4, f: '2' }, { d: 5, f: '3' }, { d: 6, f: '4' }, { d: 7, f: '5' }], desc: 'Scale with thumb crossover' },
      'Broken 3rds':  { steps: [{ d: 0, f: '1' }, { d: 2, f: '3' }, { d: 1, f: '2' }, { d: 3, f: '4' }, { d: 2, f: '3' }, { d: 4, f: '5' }, { d: 3, f: '4' }, { d: 5, f: '5' }], desc: 'Broken thirds interval exercise' },
    },
  },
};

export function getFingerInstrument() {
  if (currentInstrument === 'piano') return 'piano';
  if (currentInstrument === 'banjo5') return 'banjo';
  return 'guitar';
}

export function buildFingerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  const fi = getFingerInstrument();
  let instMode = s.fingerInst || fi;
  if (!FINGER_PATTERNS[instMode]) instMode = fi;

  let patName = s.fingerPat || Object.keys(FINGER_PATTERNS[instMode].patterns)[0];
  let stepIdx = 0;
  let root = s.fingerRoot || 'C';
  let fChordRoot = s.fChordRoot || 'Am';
  let fChordMode = s.fChordMode || 'chord'; // chord, open, random
  let lastClockConfig = metroClock.getConfigSignature();

  if (p._fingerIntv) { clearInterval(p._fingerIntv); p._fingerIntv = null; }
  if (p._fingerPlaying) { p._fingerPlaying = false; }
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._fingerPlaying) stopFinger(); });

  pedalBus.on(ev => {
    if (!ev.root || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    root = ev.root;
    render();
  });

  function getPat() {
    const ip = FINGER_PATTERNS[instMode];
    return ip?.patterns?.[patName] || Object.values(ip?.patterns || {})[0] || { steps: [], desc: '' };
  }

  function getStepNoteInfo(step) {
    const ri = NOTES.indexOf(root);
    if (instMode === 'piano') {
      const scaleIntervals = [0, 2, 4, 5, 7, 9, 11];
      const deg = step.d % 12;
      const semi = deg < scaleIntervals.length ? scaleIntervals[deg] : deg;
      const note = NOTES[(ri + semi) % 12];
      return { note, finger: step.f, label: `${step.f}`, desc: `${note} (finger ${step.f})` };
    } else {
      const si = step.s;
      if (si >= customTuning.length) return { note: '?', finger: step.f, si: 0, fret: 0, label: step.f, desc: '' };
      const chPos = getChordPositions();
      if (chPos && chPos.positions.length) {
        const sp = chPos.positions.find(pp => pp.si === si);
        if (sp) return { note: sp.note, finger: step.f, si, fret: sp.fret, label: step.f, desc: `${sp.note} str ${si + 1} fret ${sp.fret} (${step.f})` };
      }
      const note = customTuning[si].note;
      return { note, finger: step.f, si, fret: 0, label: step.f, desc: `${note} str ${si + 1} (${step.f})` };
    }
  }

  function getChordLabel() {
    if (fChordMode === 'open') return 'Open strings';
    return fChordRoot;
  }

  function parseChordName(ch) {
    if (!ch) return null;
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
    return { root: rn, notes: f2.map(i => NOTES[(NOTES.indexOf(rn) + i) % 12]), qual };
  }

  // Find the lowest fret on each string that produces a chord tone, forming a playable voicing
  function getChordPositions() {
    if (fChordMode === 'open' || instMode === 'piano') return null;
    const ch = parseChordName(fChordRoot);
    if (!ch) return null;
    const positions = [];
    customTuning.forEach((str, si) => {
      for (let f = 0; f <= 7; f++) {
        const { note } = getNoteAtFret(str.note, str.octave, f);
        if (ch.notes.includes(note)) {
          positions.push({ si, fret: f, note });
          break;
        }
      }
    });
    return { root: ch.root, notes: ch.notes, positions, label: fChordRoot };
  }

  // The four-colour objects handed to setChordHighlight below are the NECK's
  // language — root vs chord tone, fill vs stroke — shared with every other
  // pedal that lights the fretboard. They are deliberately not tokens: the
  // panel wears this pedal's accent, the neck keeps saying the same thing.
  function highlightStep() {
    const pat = getPat();
    if (!pat.steps.length || stepIdx >= pat.steps.length) return;
    const step = pat.steps[stepIdx];
    const info = getStepNoteInfo(step);
    if (instMode !== 'piano') {
      const si = step.s < customTuning.length ? step.s : 0;
      const chPos = getChordPositions();
      if (chPos && chPos.positions.length) {
        const stringPos = chPos.positions.find(pp => pp.si === si);
        const fret = stringPos ? stringPos.fret : 0;
        const fretNote = stringPos ? stringPos.note : customTuning[si]?.note;
        const focusPos = { si, fret, note: fretNote, finger: info.finger };
        setChordHighlight(
          chPos.root, chPos.notes,
          `${chPos.label} \u2014 ${info.finger}: str ${si + 1} fret ${fret}`,
          chPos.positions,
          // Fretboard overlay palette (see the note at the top of highlightStep)
          { root: '#dd9944', tone: '#664411', rootStroke: '#ffbb66', toneStroke: '#886633' },
          focusPos
        );
      } else {
        const allNotes = customTuning.map(s2 => s2.note);
        const positions = customTuning.map((s2, i) => ({ si: i, fret: 0, note: s2.note }));
        const focusPos = { si, fret: 0, note: customTuning[si]?.note || 'E', finger: info.finger };
        setChordHighlight(
          root, allNotes,
          `${patName} \u2014 ${info.finger}: str ${si + 1}`,
          positions,
          // Fretboard overlay palette (see the note at the top of highlightStep)
          { root: '#dd9944', tone: '#664411', rootStroke: '#ffbb66', toneStroke: '#886633' },
          focusPos
        );
      }
    } else {
      const ri2 = NOTES.indexOf(root);
      const scaleIntervals = [0, 2, 4, 5, 7, 9, 11];
      const scaleNotes = scaleIntervals.map(i => NOTES[(ri2 + i) % 12]);
      const deg = step.d % 12;
      const targetNote = deg < scaleIntervals.length
        ? NOTES[(ri2 + scaleIntervals[deg]) % 12]
        : NOTES[(ri2 + deg) % 12];
      setChordHighlight(
        root, scaleNotes,
        `${patName} \u2014 finger ${step.f}: ${targetNote}`,
        null,
        // Fretboard overlay palette (see the note at the top of highlightStep)
        { root: '#dd9944', tone: '#664411', rootStroke: '#ffbb66', toneStroke: '#886633' }
      );
    }
  }

  function tickFinger(accent) {
    try {
      if (!p._fCtx) p._fCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = p._fCtx;
      const pat = getPat();
      if (pat.steps.length && stepIdx < pat.steps.length) {
        const info = getStepNoteInfo(pat.steps[stepIdx]);
        if (info.note && info.note !== '?') {
          const oct = instMode === 'piano'
            ? 4
            : (info.si !== undefined && info.si < customTuning.length
                ? customTuning[info.si].octave + Math.floor((NOTES.indexOf(customTuning[info.si].note) + (info.fret || 0)) / 12)
                : 3);
          const freq = 440 * Math.pow(2, (NOTES.indexOf(info.note) - 9) / 12 + (oct - 4));
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'triangle';
          o.frequency.value = freq;
          g.gain.value = accent ? 0.25 : 0.18;
          g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
          o.connect(g);
          g.connect(bus(c, 'notes'));
          o.start();
          o.stop(c.currentTime + 0.25);
          return;
        }
      }
      // Fallback: generic tick
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = accent ? 700 : 500;
      g.gain.value = accent ? 0.2 : 0.12;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
      o.connect(g);
      g.connect(bus(c, 'click'));
      o.start();
      o.stop(c.currentTime + 0.05);
    } catch (e) {}
  }

  function startFinger() {
    metroClock.stopOthers(p.id);
    const pat = getPat();
    if (!pat.steps.length) { p._fingerPlaying = false; render(); return; }
    p._fingerPlaying = true;
    stepIdx = 0;
    highlightStep();
    metroClock.playing = true;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    tickFinger(true);
    render();
    const useBpm = metroClock.bpm || 100;
    p._fingerIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % pat.steps.length;
      const beatIdx = stepIdx % Math.max(1, metroClock.ts || 4);
      metroClock.playing = true;
      metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
      tickFinger(beatIdx === 0);
      highlightStep();
      updateFingerDisplay();
    }, 60000 / useBpm);
  }

  function stopFinger() {
    p._fingerPlaying = false;
    clearInterval(p._fingerIntv);
    p._fingerIntv = null;
    stepIdx = 0;
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight();
    render();
  }

  function updateFingerDisplay() {
    const pat = getPat();
    const cells = document.querySelectorAll(`#body-${p.id} .finger-step`);
    cells.forEach((c, i) => {
      const isCur = p._fingerPlaying && i === stepIdx;
      // Identical to the values render() builds the cells with — repaint with
      // anything else and the resting cells change the first time you hit play.
      c.style.background = isCur ? 'var(--rk-soft2)' : 'var(--rk-soft)';
      c.style.borderColor = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
    });
    const fi2 = document.getElementById(`finger-ind-${p.id}`);
    if (fi2 && p._fingerPlaying && stepIdx < pat.steps.length) {
      const info = getStepNoteInfo(pat.steps[stepIdx]);
      fi2.innerHTML = `<span class="mono" style="color:var(--rk-accent);font-size:calc(18px*var(--ui));font-weight:900">${info.finger}</span>`
        + `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">${info.desc}</span>`;
    }
  }

  function render() {
    const pat = getPat();
    const useBpm = metroClock.bpm || 100;
    const ipData = FINGER_PATTERNS[instMode];
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px">`;

    // Instrument mode tabs
    h += `<div style="display:flex;gap:3px">`;
    Object.entries(FINGER_PATTERNS).forEach(([k, v]) => {
      h += `<button class="chord-btn fin-inst" data-fi="${k}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${instMode === k ? 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)' : ''}">${v.label}</button>`;
    });
    h += `</div>`;

    // Pattern selector
    h += `<div style="display:flex;flex-wrap:wrap;gap:3px">`;
    Object.keys(ipData.patterns).forEach(pn => {
      h += `<button class="chord-btn fin-pat" data-fp="${pn}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 5px;${patName === pn ? 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)' : ''}">${pn}</button>`;
    });
    h += `</div>`;

    // Description
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${pat.desc}</div>`;

    // Chord context (for guitar/banjo)
    if (instMode !== 'piano') {
      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:5px;padding:5px">`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-bottom:3px">CHORD SHAPE</div>`;
      h += `<div style="display:flex;gap:2px;margin-bottom:3px">`;
      [['chord', 'Chord'], ['open', 'Open'], ['random', '🎲 Random']].forEach(([m, label]) => {
        h += `<button class="chord-btn fin-cm" data-fcm="${m}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${fChordMode === m ? 'background:var(--rk-soft);border-color:var(--rk-line);color:var(--rk-accent)' : ''}">${label}</button>`;
      });
      h += `</div>`;
      if (fChordMode === 'chord') {
        const commonChords = ['C', 'Am', 'G', 'Em', 'D', 'Dm', 'A', 'Am', 'E', 'Em', 'F', 'Fm', 'B', 'Bm', 'A7', 'D7', 'E7', 'G7', 'Am7', 'Dm7', 'Em7', 'Cmaj7', 'Fmaj7'];
        h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
        commonChords.forEach(ch => {
          h += `<button class="chord-btn fin-chord" data-fch="${ch}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 4px;${fChordRoot === ch ? 'background:var(--rk-soft);border-color:var(--rk-line);color:var(--rk-accent)' : ''}">${ch}</button>`;
        });
        h += `</div>`;
      }
      h += `</div>`;
    }

    // Root selector (for piano scale reference)
    if (instMode === 'piano') {
      h += `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">`;
      NOTES.forEach(n => {
        h += `<button class="chord-btn fin-root" data-r="${n}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:22px;padding:2px 4px;${root === n ? 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)' : ''}">${n}</button>`;
      });
      h += `</div>`;
    }

    // Finger indicator (large, current)
    h += `<div id="finger-ind-${p.id}" style="display:flex;align-items:center;justify-content:center;gap:8px;min-height:28px">`;
    if (p._fingerPlaying && stepIdx < pat.steps.length) {
      const info = getStepNoteInfo(pat.steps[stepIdx]);
      h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(18px*var(--ui));font-weight:900">${info.finger}</span>`
        + `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">${info.desc}</span>`;
    }
    h += `</div>`;

    // Pattern grid
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:6px">`;
    pat.steps.forEach((st, si) => {
      const isCur = p._fingerPlaying && si === stepIdx;
      const info = getStepNoteInfo(st);
      const bg = isCur ? 'var(--rk-soft2)' : 'var(--rk-soft)';
      const bc = isCur ? 'var(--rk-accent)' : 'var(--rk-edge-soft)';
      h += `<div class="finger-step" style="background:${bg};border:1.5px solid ${bc};border-radius:4px;padding:3px 5px;text-align:center;min-width:30px;transition:all .1s">`;
      h += `<div class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:800">${info.finger}</div>`;
      if (instMode !== 'piano') {
        h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));font-weight:600">${info.note || ''}</div>`;
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">s${st.s + 1}${info.fret ? ' f' + info.fret : ''}</div>`;
      } else {
        h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${info.note}</div>`;
      }
      h += `</div>`;
    });
    h += `</div>`;

    // Finger legend
    h += `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">`;
    if (instMode === 'guitar') {
      [['p', 'Thumb'], ['i', 'Index'], ['m', 'Middle'], ['a', 'Ring']].forEach(([f, label]) => {
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))"><span style="color:var(--rk-accent);font-weight:700">${f}</span> ${label}</span>`;
      });
    } else if (instMode === 'banjo') {
      [['T', 'Thumb'], ['I', 'Index'], ['M', 'Middle']].forEach(([f, label]) => {
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))"><span style="color:var(--rk-accent);font-weight:700">${f}</span> ${label}</span>`;
      });
    } else {
      [['1', 'Thumb'], ['2', 'Index'], ['3', 'Middle'], ['4', 'Ring'], ['5', 'Pinky']].forEach(([f, label]) => {
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))"><span style="color:var(--rk-accent);font-weight:700">${f}</span> ${label}</span>`;
      });
    }
    h += `</div>`;

    // Tempo
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">NOTE TEMPO</span>`;
    h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:700">${useBpm}</span>`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">BPM</span>`;
    h += `</div>`;

    // Play/Stop. One button, two jobs — and the moment it is showing STOP it stops
    // being this pedal's control and becomes the app's, so it drops the accent for
    // --rk-stop. Stop is a reflex you reach for mid-phrase without reading it, which
    // only works if it is the same red in every pedal. (Hue 345, so it still isn't C.)
    const pc = p._fingerPlaying ? 'var(--rk-stop-soft)' : 'var(--rk-soft)';
    const pb = p._fingerPlaying ? 'var(--rk-stop-edge)' : 'var(--rk-line)';
    const pt = p._fingerPlaying ? 'var(--rk-stop)' : 'var(--rk-accent)';
    h += `<button class="fin-play mono" style="min-height:calc(28px*var(--ui));background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${p._fingerPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;
    el.innerHTML = h;

    // Wire events
    el.querySelectorAll('.fin-inst').forEach(b => b.onclick = e => {
      e.stopPropagation();
      instMode = b.dataset.fi;
      patName = Object.keys(FINGER_PATTERNS[instMode].patterns)[0];
      if (p._fingerPlaying) { stopFinger(); startFinger(); } else render();
    });
    el.querySelectorAll('.fin-pat').forEach(b => b.onclick = e => {
      e.stopPropagation();
      patName = b.dataset.fp;
      if (p._fingerPlaying) { stopFinger(); startFinger(); } else render();
    });
    el.querySelectorAll('.fin-root').forEach(b => b.onclick = e => {
      e.stopPropagation();
      root = b.dataset.r;
      if (p._fingerPlaying) { stopFinger(); startFinger(); } else render();
    });
    el.querySelectorAll('.fin-cm').forEach(b => b.onclick = e => {
      e.stopPropagation();
      fChordMode = b.dataset.fcm;
      if (fChordMode === 'random') {
        const rch = ['C', 'Am', 'G', 'Em', 'D', 'Dm', 'A', 'E', 'F', 'Bm', 'A7', 'E7'];
        fChordRoot = rch[Math.floor(Math.random() * rch.length)];
      }
      if (p._fingerPlaying) { stopFinger(); startFinger(); } else render();
    });
    el.querySelectorAll('.fin-chord').forEach(b => b.onclick = e => {
      e.stopPropagation();
      fChordRoot = b.dataset.fch;
      if (p._fingerPlaying) { stopFinger(); startFinger(); } else render();
    });
    el.querySelector('.fin-play').onclick = e => {
      e.stopPropagation();
      if (p._fingerPlaying) stopFinger(); else startFinger();
    };

    Object.assign(s, { fingerInst: instMode, fingerPat: patName, fingerRoot: root, fChordRoot, fChordMode });
  }

  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._fingerPlaying) { stopFinger(); startFinger(); }
    else render();
  });

  render();

  if (p.settings && p.settings._autoStart) {
    delete p.settings._autoStart;
    if (!p._fingerPlaying) startFinger();
  }
}
