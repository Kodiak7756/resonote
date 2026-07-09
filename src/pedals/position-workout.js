import { NOTES, CHORD_TYPES, SCALE_TYPES, intervalLabel, getChordNotes, getScaleNotes, CANONICAL_MAJOR_TEMPLATE_BOXES, CANONICAL_MINOR_PENT_TEMPLATE_BOXES, CANONICAL_MAJOR_PENT_TEMPLATE_BOXES } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, customTuning, getInst, getNoteAtFret, isStandardMajorPatternContext } from '../core/tuning.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus, metroClock } from '../core/state.js';
import { playClickedNote, audio } from '../core/audio.js';
import { makeKnob } from '../ui/pedal-system.js';
import { updateOverlays, pianoGeo } from '../ui/fretboard.js';
import { findScaleBoxes, getDisplayPositionsForBox } from '../core/voicings.js';

// ── Arpeggio type catalogue ──────────────────────────────────────────
const ARP_TYPES = {
  'Triads': {
    'Major': [0, 4, 7], 'Minor': [0, 3, 7], 'Dim': [0, 3, 6], 'Aug': [0, 4, 8],
    'Sus2':  [0, 2, 7], 'Sus4': [0, 5, 7],
  },
  '7ths': {
    'Maj7':  [0, 4, 7, 11], 'Dom7': [0, 4, 7, 10], 'Min7': [0, 3, 7, 10],
    'Dim7':  [0, 3, 6, 9],  'm7♭5': [0, 3, 6, 10], 'mMaj7': [0, 3, 7, 11],
  },
  'Other': {
    '6': [0, 4, 7, 9], 'Min6': [0, 3, 7, 9], 'Aug7': [0, 4, 8, 10],
  },
};

// ── Fretboard highlight colour palettes ──────────────────────────────
const RUNNER_COLORS = {
  scales: { root: '#22ccaa', tone: '#18887a', rootStroke: '#44eedd', toneStroke: '#2aaa99' },
  arps:   { root: '#cc66aa', tone: '#884477', rootStroke: '#ee88cc', toneStroke: '#aa5588' },
};

// ── Main builder ─────────────────────────────────────────────────────
export function buildRunnerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  let mode        = s.mode        || 'scales';
  let root        = s.root        || 'A';
  let scaleName   = s.scaleName   || 'Minor Pent.';
  let scaleCat    = s.scaleCat    || 'Pentatonic';
  let arpName     = s.arpName     || 'Minor';
  let arpCat      = s.arpCat      || 'Triads';
  let direction   = s.direction   || 'asc';
  let advanceMode = s.advanceMode || 'auto';
  let barsPerPos  = s.barsPerPos  || 2;
  // null = cycle all positions, number = locked to one position index
  let lockedPos   = s.lockedPos !== undefined ? s.lockedPos : null;

  // Clean up any existing timer from previous build
  if (p._runIntv)  { clearInterval(p._runIntv); p._runIntv = null; }
  if (p._running)  { p._running = false; }
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._running) stopRunning(); });

  let posIdx = 0, beat = 0, rCtx = null;
  let posSequence = [], noteIdx = 0, posNotes = [];
  let listenFeedback = '';
  let lastClockConfig = metroClock.getConfigSignature();

  // Listen for cross-pedal root broadcasts
  pedalBus.on(ev => {
    if (!ev.root || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    root = ev.root;
    if (p._running) { stopRunning(); startRunning(); } else render();
  });

  // ── Type / interval helpers ──────────────────────────────────────────

  function getIntervals() {
    if (mode === 'scales') {
      const cat = SCALE_TYPES[scaleCat];
      return cat?.[scaleName] || [0, 3, 5, 7, 10];
    }
    const cat = ARP_TYPES[arpCat];
    return cat?.[arpName] || [0, 3, 7];
  }

  function getLabel() {
    return mode === 'scales' ? `${root} ${scaleName}` : `${root} ${arpName} Arp`;
  }

  // ── Position sequence builders ───────────────────────────────────────

  function buildPositionSequence() {
    const intervals = getIntervals();
    const boxes = findScaleBoxes(root, intervals, { scaleCat, scaleName });
    if (!boxes.length) return [];
    if (lockedPos !== null && lockedPos < boxes.length) {
      return [{ ...boxes[lockedPos], idx: lockedPos }];
    }
    // Always cycle positions in fret order; direction controls note order within each
    return boxes.map((b, i) => ({ ...b, idx: i }));
  }

  function getPreviewBox(boxes) {
    if (!boxes.length) return null;
    if (lockedPos !== null && lockedPos < boxes.length) {
      return { ...boxes[lockedPos], idx: lockedPos };
    }
    return { ...boxes[0], idx: 0 };
  }

  // ── Fretboard preview ────────────────────────────────────────────────

  function applyRunnerPreview(boxOverride, focusNote) {
    const intervals = getIntervals();
    const allNotes  = intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
    const colors    = RUNNER_COLORS[mode === 'scales' ? 'scales' : 'arps'];
    const boxes     = findScaleBoxes(root, intervals, { scaleCat, scaleName });
    const box       = boxOverride || getPreviewBox(boxes);
    if (!box) { clearChordHighlight(); updateOverlays(); return; }
    const label = focusNote
      ? `${getLabel()} — ${box.label} Preview (${noteIdx + 1}/${posNotes.length || box.positions.length})`
      : `${getLabel()} — ${box.label} Preview`;
    setChordHighlight(root, allNotes, label, getDisplayPositionsForBox(box, root), colors, focusNote || null);
    updateOverlays();
  }

  // ── Note sequence within a box ───────────────────────────────────────

  function getPositionNotes() {
    if (!posSequence.length || posIdx >= posSequence.length) return [];
    const box = posSequence[posIdx];
    if (!box.positions) return [];
    // Ascending: bass string (low index) → treble string (high index)
    const asc = [...box.positions]
      .filter(pp => pp.fret >= 0)
      .sort((a, b) => b.si - a.si || a.fret - b.fret);
    if (direction === 'asc')  return asc;
    if (direction === 'desc') return [...asc].reverse();
    // Cycle: ascending then descending (skip endpoints to avoid double notes)
    const desc2 = [...asc].reverse().slice(1, -1);
    return [...asc, ...desc2];
  }

  // ── Metronome ticks ──────────────────────────────────────────────────

  function getSharedBeatType(beatIdx) {
    return metroClock.pattern?.[beatIdx % Math.max(1, metroClock.pattern.length)] || (beatIdx === 0 ? 'accent' : 'regular');
  }

  function pulseSharedClock(beatIdx) {
    const idx = beatIdx % Math.max(1, metroClock.ts || 4);
    metroClock.playing = true;
    metroClock.setBeat(idx, getSharedBeatType(idx));
  }

  function tick(accent, beatIdx = 0) {
    try {
      const beatType = getSharedBeatType(beatIdx);
      if (beatType === 'rest') return;
      if (!rCtx) rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx  = rCtx;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = beatType === 'alternate' ? 'square' : beatType === 'ghost' ? 'triangle' : 'triangle';
      osc.frequency.value = beatType === 'alternate' ? 760 : accent || beatType === 'accent' ? 800 : beatType === 'ghost' ? 430 : 500;
      gain.gain.value = beatType === 'ghost' ? 0.06 : accent || beatType === 'accent' ? 0.2 : 0.1;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }

  function playGoodTone() {
    try {
      if (!rCtx) rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx  = rCtx;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1200;
      gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  }

  // ── Highlight current position on the fretboard ──────────────────────

  function highlightPosition() {
    if (!posSequence.length || posIdx >= posSequence.length) return;
    const box = posSequence[posIdx];
    const focusNote = (advanceMode === 'auto' || advanceMode === 'listen') && posNotes.length && noteIdx < posNotes.length
      ? posNotes[noteIdx]
      : null;
    applyRunnerPreview(box, focusNote);
  }

  // ── Beat/position card display update (no full re-render) ────────────

  function updateBeatDisplay() {
    const cards = document.querySelectorAll(`#body-${p.id} .runner-pos`);
    cards.forEach(card => {
      const bi        = parseInt(card.dataset.li);
      const isLocked  = lockedPos === bi;
      const curBoxIdx = posSequence.length && posIdx < posSequence.length ? posSequence[posIdx].idx : -1;
      const isCur     = p._running && bi === curBoxIdx;
      card.style.background  = isLocked ? 'rgba(34,204,170,.35)' : isCur ? 'rgba(34,204,170,.25)' : 'rgba(34,204,170,.06)';
      card.style.borderColor = isLocked ? '#44eedd'              : isCur ? '#22ccaa'               : 'rgba(34,204,170,.15)';
    });
  }

  // ── Live audio detection (Listen mode) ───────────────────────────────

  function onAudioDetect() {
    if (!p._running || advanceMode !== 'listen' || !posNotes.length) return;
    if (!document.getElementById(`body-${p.id}`)) return;
    const det = audio.detected;
    if (!det) return;
    if (noteIdx >= posNotes.length) return;
    const target = posNotes[noteIdx];
    if (det.note === target.note && Math.abs(det.cents) < 30) {
      listenFeedback = 'correct';
      noteIdx++;
      playGoodTone();
      if (noteIdx >= posNotes.length) {
        updateBeatDisplay();
        setTimeout(() => {
          listenFeedback = '';
          posIdx++;
          if (posIdx >= posSequence.length) posIdx = 0;
          noteIdx  = 0;
          posNotes = getPositionNotes();
          highlightPosition();
          updateBeatDisplay();
        }, 600);
      } else {
        updateBeatDisplay();
        setTimeout(() => { listenFeedback = ''; updateBeatDisplay(); }, 400);
      }
    }
  }
  audio.on(onAudioDetect);

  // ── Playback control ─────────────────────────────────────────────────

  function startRunning() {
    metroClock.stopOthers(p.id);          // master transport: stop any other playing pedal
    posSequence = buildPositionSequence();
    if (!posSequence.length) { p._running = false; render(); return; }
    p._running = true;
    posIdx = 0; beat = 0; noteIdx = 0;
    posNotes = getPositionNotes();
    highlightPosition();
    if (advanceMode !== 'listen') {
      pulseSharedClock(0);
      tick(true, 0);
    }
    if (advanceMode === 'auto') noteIdx = 1;
    if (advanceMode === 'tap') beat = 1;
    render();

    const useBpm = metroClock.bpm || 100;

    if (advanceMode === 'auto') {
      // Note-by-note: each beat advances to the next note in the position
      p._runIntv = setInterval(() => {
        if (noteIdx >= posNotes.length) {
          noteIdx = 0;
          posIdx++;
          if (posIdx >= posSequence.length) posIdx = 0;
          posNotes = getPositionNotes();
        }
        const beatIdx = noteIdx % Math.max(1, metroClock.ts || 4);
        pulseSharedClock(beatIdx);
        tick(noteIdx === 0, beatIdx);
        noteIdx++;
        highlightPosition();
        updateBeatDisplay();
      }, 60000 / useBpm);

    } else if (advanceMode === 'tap') {
      p._runIntv = setInterval(() => {
        const beatsPerBar = Math.max(1, metroClock.ts || 4);
        const beatIdx = beat % beatsPerBar;
        pulseSharedClock(beatIdx);
        tick(beatIdx === 0, beatIdx);
        updateBeatDisplay();
        beat++;
        if (beat >= barsPerPos * beatsPerBar) beat = 0;
      }, 60000 / useBpm);
    }
    // Listen mode has no interval — advances via onAudioDetect
  }

  function stopRunning() {
    p._running = false;
    clearInterval(p._runIntv);
    p._runIntv     = null;
    beat           = 0;
    posIdx         = 0;
    noteIdx        = 0;
    posNotes       = [];
    listenFeedback = '';
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight();
    updateOverlays();
    render();
  }

  function advanceManual() {
    if (!p._running) return;
    beat = 0;
    posIdx++;
    if (posIdx >= posSequence.length) posIdx = 0;
    noteIdx  = 0;
    posNotes = getPositionNotes();
    highlightPosition();
    updateBeatDisplay();
  }

  // ── Re-sync when metronome BPM changes in auto mode ──────────────────
  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._running && advanceMode === 'auto') { stopRunning(); startRunning(); }
    else render();
  });

  // ── Render ───────────────────────────────────────────────────────────

  function render() {
    const intervals  = getIntervals();
    const boxes      = findScaleBoxes(root, intervals, { scaleCat, scaleName });
    const useBpm     = metroClock.bpm || 100;
    const accent     = mode === 'scales' ? '#22ccaa' : '#cc66aa';
    const previewBox = getPreviewBox(boxes);

    const types   = mode === 'scales' ? SCALE_TYPES : ARP_TYPES;
    const curName = mode === 'scales' ? scaleName   : arpName;
    const curCat  = mode === 'scales' ? scaleCat    : arpCat;

    let h = `<div style="display:flex;flex-direction:column;gap:6px">`;

    // ── Mode toggle ──
    h += `<div style="display:flex;gap:4px;justify-content:center">`;
    h += `<button class="chord-btn run-mode${mode === 'scales' ? ' active' : ''}" data-rm="scales" style="flex:1;font-size:9px;${mode === 'scales' ? 'background:rgba(34,204,170,.15);border-color:#22ccaa;color:#22ccaa' : ''}">🎼 SCALES</button>`;
    h += `<button class="chord-btn run-mode${mode === 'arps'   ? ' active' : ''}" data-rm="arps"   style="flex:1;font-size:9px;${mode === 'arps'   ? 'background:rgba(204,102,170,.15);border-color:#cc66aa;color:#cc66aa' : ''}">🎶 ARPEGGIOS</button>`;
    h += `</div>`;

    // ── Root note selector ──
    h += `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">`;
    NOTES.forEach(n => {
      const active = n === root;
      h += `<button class="chord-btn run-root${active ? ' active' : ''}" data-r="${n}" style="min-width:26px;font-size:8px;padding:3px 5px;${active ? `background:rgba(34,204,170,.2);border-color:${accent};color:${accent}` : ''}">${n}</button>`;
    });
    h += `</div>`;

    // ── Scale / arpeggio type selector ──
    h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
    Object.entries(types).forEach(([cat, items]) => {
      Object.keys(items).forEach(name => {
        const active = name === curName && cat === curCat;
        h += `<button class="chord-btn run-type" data-tn="${name}" data-tc="${cat}" style="font-size:7px;padding:2px 5px;${active ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${name}</button>`;
      });
    });
    h += `</div>`;

    // ── Direction selector ──
    h += `<div style="display:flex;gap:3px;justify-content:center">`;
    [['asc', '↑ Low→High'], ['desc', '↓ High→Low'], ['cycle', '↕ Cycle']].forEach(([d, label]) => {
      h += `<button class="chord-btn run-dir" data-dir="${d}" style="flex:1;font-size:8px;${direction === d ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div>`;

    // ── Position buttons — click to lock, ALL to unlock ──
    if (boxes.length) {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;align-items:center;background:rgba(34,204,170,.04);border:1px solid rgba(34,204,170,.1);border-radius:6px;padding:5px">`;
      h += `<button class="chord-btn run-lock-all" style="font-size:7px;padding:2px 6px;min-width:28px;${lockedPos === null ? `background:rgba(34,204,170,.2);border-color:${accent};color:${accent}` : 'border-color:#444;color:#666'}">ALL</button>`;
      boxes.forEach((box, bi) => {
        const isLocked  = lockedPos === bi;
        const isCurrent = p._running && posSequence.length && posSequence[posIdx]?.idx === bi;
        const bg     = isLocked ? 'rgba(34,204,170,.35)' : isCurrent ? 'rgba(34,204,170,.25)' : 'rgba(34,204,170,.06)';
        const border = isLocked ? '#44eedd'              : isCurrent ? '#22ccaa'               : 'rgba(34,204,170,.15)';
        const color  = isLocked ? '#44eedd'              : isCurrent ? '#44eedd'               : '#22998a';
        const lock   = isLocked ? '🔒 ' : '';
        h += `<button class="chord-btn runner-pos run-lock" data-li="${bi}" style="background:${bg};border:1.5px solid ${border};border-radius:4px;padding:3px 6px;text-align:center;min-width:28px;cursor:pointer;transition:all .15s">`;
        h += `<span class="mono" style="color:${color};font-size:9px;font-weight:700">${lock}${box.label}</span></button>`;
      });
      h += `</div>`;
    } else {
      h += `<div class="mono" style="color:#555;font-size:9px;text-align:center;padding:8px">No positions found</div>`;
    }

    h += `<div class="mono" style="color:#666;font-size:8px;text-align:center">Preview appears on the fretboard${previewBox ? ` — ${previewBox.label}` : ''}</div>`;

    // ── Tempo / bars / advance controls ──
    h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap">`;
    if (advanceMode === 'tap') {
      h += `<div style="display:flex;align-items:center;gap:3px">`;
      h += `<span class="mono" style="color:#888;font-size:7px">TEMPO</span>`;
      h += `<span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span>`;
      h += `</div>`;
      h += `<div style="display:flex;align-items:center;gap:3px">`;
      h += `<span class="mono" style="color:#888;font-size:7px">BARS</span>`;
      [1, 2, 4].forEach(b => {
        h += `<button class="chord-btn run-bars" data-bars="${b}" style="font-size:7px;min-width:20px;padding:2px 4px;${barsPerPos === b ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${b}</button>`;
      });
      h += `</div>`;
    } else if (advanceMode === 'auto') {
      h += `<div style="display:flex;align-items:center;gap:3px">`;
      h += `<span class="mono" style="color:#888;font-size:7px">NOTE TEMPO</span>`;
      h += `<span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span>`;
      h += `<span class="mono" style="color:#666;font-size:7px">BPM</span>`;
      h += `</div>`;
    }
    h += `<div style="display:flex;align-items:center;gap:3px">`;
    h += `<span class="mono" style="color:#888;font-size:7px">ADVANCE</span>`;
    [['auto', 'Auto'], ['tap', 'Tap'], ['listen', '🎤 Listen']].forEach(([m, label]) => {
      h += `<button class="chord-btn run-adv" data-adv="${m}" style="font-size:7px;padding:2px 5px;${advanceMode === m ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`;
    });
    h += `</div></div>`;

    if (advanceMode === 'listen') {
      h += `<div class="mono" style="color:#555;font-size:7px;text-align:center">Enable 🎤 LIVE audio to use Listen mode</div>`;
    }

    // ── Run / Stop + Next buttons ──
    h += `<div style="display:flex;gap:4px">`;
    const playColor  = p._running ? 'rgba(255,60,60,.2)'    : 'rgba(34,204,170,.15)';
    const playBorder = p._running ? '#ff4444'               : '#22ccaa';
    const playText   = p._running ? '#ff6666'               : '#22ccaa';
    h += `<button class="run-play mono" style="background:${playColor};border:1px solid ${playBorder};color:${playText};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;flex:1">${p._running ? '■ STOP' : '▶ RUN'}</button>`;
    if (p._running && advanceMode === 'tap') {
      h += `<button class="run-next mono" style="background:rgba(34,204,170,.15);border:1px solid #22ccaa;color:#22ccaa;border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px">NEXT ▸</button>`;
    }
    h += `</div>`;
    h += `</div>`;

    el.innerHTML = h;

    // ── Wire events ──────────────────────────────────────────────────

    el.querySelectorAll('.run-mode').forEach(b => b.onclick = e => {
      e.stopPropagation();
      mode = b.dataset.rm;
      if (p._running) stopRunning();
      render();
    });

    el.querySelectorAll('.run-root').forEach(b => b.onclick = e => {
      e.stopPropagation();
      root = b.dataset.r;
      if (p._running) { stopRunning(); startRunning(); } else render();
    });

    el.querySelectorAll('.run-type').forEach(b => b.onclick = e => {
      e.stopPropagation();
      if (mode === 'scales') { scaleName = b.dataset.tn; scaleCat = b.dataset.tc; }
      else                   { arpName   = b.dataset.tn; arpCat   = b.dataset.tc; }
      if (p._running) { stopRunning(); startRunning(); } else render();
    });

    el.querySelectorAll('.run-dir').forEach(b => b.onclick = e => {
      e.stopPropagation();
      direction = b.dataset.dir;
      if (p._running) { stopRunning(); startRunning(); } else render();
    });

    el.querySelectorAll('.run-lock').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const li = parseInt(b.dataset.li);
      lockedPos = lockedPos === li ? null : li;
      if (p._running) { stopRunning(); startRunning(); }
      else {
        render();
        const nextBoxes = findScaleBoxes(root, getIntervals(), { scaleCat, scaleName });
        applyRunnerPreview(lockedPos !== null ? nextBoxes[lockedPos] : getPreviewBox(nextBoxes));
      }
    });

    const lockAllBtn = el.querySelector('.run-lock-all');
    if (lockAllBtn) lockAllBtn.onclick = e => {
      e.stopPropagation();
      lockedPos = null;
      if (p._running) { stopRunning(); startRunning(); }
      else {
        render();
        const nextBoxes = findScaleBoxes(root, getIntervals(), { scaleCat, scaleName });
        applyRunnerPreview(getPreviewBox(nextBoxes));
      }
    };

    el.querySelectorAll('.run-bars').forEach(b => b.onclick = e => {
      e.stopPropagation();
      barsPerPos = parseInt(b.dataset.bars);
      if (p._running) { stopRunning(); startRunning(); } else render();
    });

    el.querySelectorAll('.run-adv').forEach(b => b.onclick = e => {
      e.stopPropagation();
      advanceMode = b.dataset.adv;
      if (p._running) { stopRunning(); startRunning(); } else render();
    });

    const playBtn = el.querySelector('.run-play');
    if (playBtn) playBtn.onclick = e => {
      e.stopPropagation();
      if (p._running) stopRunning(); else startRunning();
    };

    const nextBtn = el.querySelector('.run-next');
    if (nextBtn) nextBtn.onclick = e => { e.stopPropagation(); advanceManual(); };

    // Persist settings (no saveState)
    Object.assign(s, {
      mode, root, scaleName, scaleCat, arpName, arpCat,
      direction, advanceMode, barsPerPos, lockedPos,
    });

    if (p._running) updateBeatDisplay();
    else applyRunnerPreview(previewBox);
  }

  render();

  // Handle auto-start signal from Practice Manager
  if (p.settings._autoStart) {
    delete p.settings._autoStart;
    if (!p._running) startRunning();
  }
}
