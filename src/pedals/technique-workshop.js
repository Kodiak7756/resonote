// ════════════════════════════════════════════════════════════════════
//  Technique Workshop — the 4→1 merge of Position Workout + Groove Lab +
//  Finger Trainer + Technique Builder. One pedal, four mode tabs, ONE
//  shared master-clock/key-bus/audio subscription layer (bound once per
//  instance, dispatched to the active tab) so nothing leaks on tab switch.
//
//  Build status: POSITIONS ported. GROOVE / FINGER / TECHNIQUE land in the
//  next passes (placeholder until then). Consolidation of the old four
//  pedals happens once all tabs are proven.
// ════════════════════════════════════════════════════════════════════
import { NOTES, SCALE_TYPES, toSharp } from '../core/music-theory.js';
import { currentInstrument, customTuning, getNoteAtFret, getInst } from '../core/tuning.js';
import { setChordHighlight, clearChordHighlight, setGhostHighlight, clearGhostHighlight, pedalBus, metroClock } from '../core/state.js';
import { audio } from '../core/audio.js';
import { updateOverlays } from '../ui/fretboard.js';
import { findScaleBoxes, getDisplayPositionsForBox, buildNpsBoxes, pickGrip } from '../core/voicings.js';
import { RHYTHM_PATTERNS } from './groove-lab.js';
import { FINGER_PATTERNS, getFingerInstrument } from './finger-trainer.js';
import { TECHNIQUE_EXERCISES } from './technique-builder.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

// ── Arpeggio catalogue + palettes (from position-workout.js) ─────────
const ARP_TYPES = {
  'Triads': { 'Major':[0,4,7],'Minor':[0,3,7],'Dim':[0,3,6],'Aug':[0,4,8],'Sus2':[0,2,7],'Sus4':[0,5,7] },
  '7ths':   { 'Maj7':[0,4,7,11],'Dom7':[0,4,7,10],'Min7':[0,3,7,10],'Dim7':[0,3,6,9],'m7♭5':[0,3,6,10],'mMaj7':[0,3,7,11] },
  'Other':  { '6':[0,4,7,9],'Min6':[0,3,7,9],'Aug7':[0,4,8,10] },
};
const RUNNER_COLORS = {
  scales: { root:'#22ccaa', tone:'#18887a', rootStroke:'#44eedd', toneStroke:'#2aaa99' },
  arps:   { root:'#cc66aa', tone:'#884477', rootStroke:'#ee88cc', toneStroke:'#aa5588' },
};

const TAB_META = {
  positions: { label: 'POSITIONS', accent: '#22ccaa', blurb: 'Walk a scale or arpeggio box note-by-note so the shape lives under your fingers anywhere on the neck. Lock one position or cycle them all.' },
  groove:    { label: 'GROOVE',    accent: '#bb66dd', blurb: 'Loop a strum or picking pattern over a chord so your picking hand locks to the beat. Pick one chord, a beat per step, or a random change each bar.' },
  finger:    { label: 'FINGER',    accent: '#dd9944', blurb: 'Cycle a fingerpicking roll — the picking-hand finger (p·i·m·a) is named for every note. Travis, classical and named-song patterns.' },
  technique: { label: 'TECHNIQUE', accent: '#ff7744', blurb: 'Drill the expressive moves that make a guitar sing: hammer-ons, pull-offs, slides, bends and vibrato — slow and in time, then faster.' },
};
const INITIAL_TAB = { runner: 'positions', rhythm: 'groove', finger: 'finger', technique: 'technique', workshop: 'positions' };

const THEORY = {
  positions: {
    kicker: 'PRACTICE', title: 'Positions — the scale shape under your fingers',
    what: `Walk a <b>scale</b> or <b>arpeggio</b> box note-by-note, in time, so the shape lives under your fingers anywhere on the neck. Lock to one CAGED position or cycle them all; choose ascending, descending, or up-and-down.`,
    why: `Soloing freely means knowing the shape in every position, not just one box. Drill it slow against the click, then nudge the tempo up. <b>🎤 Listen</b> mode listens back and only advances when you play the right note in tune — honest, hands-on reps.`,
    lessonId: 'pentatonic-boxes',
  },
  groove:    { kicker: 'RHYTHM', title: 'Groove — locking your picking hand to the beat', what: `Loop a strum or picking pattern over a chord so your picking hand locks to the pulse.`, why: `Rhythm is the foundation — a clean groove at a slow tempo beats a sloppy fast one.`, lessonId: 'reading-rhythm' },
  finger:    { kicker: 'TECHNIQUE', title: 'Fingerstyle — independent picking-hand rolls', what: `Cycle a fingerpicking roll, with the picking-hand finger named for every note.`, why: `Travis picking and classical rolls build the right-hand independence that frees your playing.`, lessonId: 'fingerstyle-basics' },
  technique: { kicker: 'TECHNIQUE', title: 'Articulation — the expressive moves', what: `Drill hammer-ons, pull-offs, slides, bends and vibrato — the moves that make a guitar sing.`, why: `Clean articulation in time is what separates notes-on-a-page from phrasing.`, lessonId: 'expressive-technique' },
};

// ════════════════════════════════════════════════════════════════════
//  POSITIONS tab (ported from position-workout.js)
// ════════════════════════════════════════════════════════════════════
function createPositionsTab(p, refresh) {
  const s = p.settings;
  let mode        = s.mode        || 'scales';
  let root        = s.root        || 'A';
  let scaleName   = s.scaleName   || 'Minor Pent.';
  let scaleCat    = s.scaleCat    || 'Pentatonic';
  let arpName     = s.arpName      || 'Minor';
  let arpCat      = s.arpCat       || 'Triads';
  let direction   = s.direction    || 'asc';
  let advanceMode = s.advanceMode  || 'auto';
  let barsPerPos  = s.barsPerPos   || 2;
  let lockedPos   = s.lockedPos !== undefined ? s.lockedPos : null;
  let startOnRoot = s.startOnRoot || false;   // begin the climb on the key's ROOT, not the box's lowest note
  let fingering   = s.fingering   || 'caged'; // caged = CAGED shapes · 3nps · 4nps (notes-per-string runs, scales only)
  let patternSeq  = s.patternSeq  || 'straight'; // straight · broken3 (3rds) · broken4 (4ths) · skip (string-skip)
  const brokenPairs = (arr, skip) => { const out = []; for (let i = 0; i + skip < arr.length; i++) { out.push(arr[i]); out.push(arr[i + skip]); } return out.length ? out : arr; };
  // String-skip: play the box low→high but skip every other string (low E·D·B, then A·G·e) —
  // trains the picking hand to leap a string. Each scale note still played once.
  const stringSkip = (notes) => {
    const byStr = {};
    notes.forEach(n => { (byStr[n.si] = byStr[n.si] || []).push(n); });
    const strs = Object.keys(byStr).map(Number).sort((a, b) => b - a); // low→high
    const order = [...strs.filter((_, i) => i % 2 === 0), ...strs.filter((_, i) => i % 2 === 1)];
    const out = order.flatMap(si => byStr[si]);
    return out.length ? out : notes;
  };

  let posIdx = 0, beat = 0, rCtx = null;
  let posSequence = [], noteIdx = 0, posNotes = [];
  let listenFeedback = '';
  let lastClockConfig = metroClock.getConfigSignature();
  const alive = () => !!document.getElementById(`body-${p.id}`);

  function getIntervals() {
    if (mode === 'scales') return SCALE_TYPES[scaleCat]?.[scaleName] || [0, 3, 5, 7, 10];
    return ARP_TYPES[arpCat]?.[arpName] || [0, 3, 7];
  }
  const getLabel = () => mode === 'scales' ? `${root} ${scaleName}` : `${root} ${arpName} Arp`;

  // The set of "shapes" to drill: CAGED boxes, or notes-per-string runs (scales only).
  function getSequenceBoxes() {
    const intervals = getIntervals();
    if (mode === 'scales' && fingering === '3nps') return buildNpsBoxes(root, intervals, 3) || [];
    if (mode === 'scales' && fingering === '4nps') return buildNpsBoxes(root, intervals, 4) || [];
    // Only pass scale opts in scale mode — in arp mode the stale scaleCat/scaleName would
    // make voicings.js fill an arpeggio window with mode/blues notes (it trusts opts over intervals).
    return findScaleBoxes(root, intervals, mode === 'scales' ? { scaleCat, scaleName } : {});
  }
  const boxDisplayPositions = box => getDisplayPositionsForBox(box, root);

  function buildPositionSequence() {
    const boxes = getSequenceBoxes();
    if (!boxes.length) return [];
    if (lockedPos !== null && lockedPos < boxes.length) return [{ ...boxes[lockedPos], idx: lockedPos }];
    return boxes.map((b, i) => ({ ...b, idx: i }));
  }
  function getPreviewBox(boxes) {
    if (!boxes.length) return null;
    if (lockedPos !== null && lockedPos < boxes.length) return { ...boxes[lockedPos], idx: lockedPos };
    return { ...boxes[0], idx: 0 };
  }
  function applyRunnerPreview(boxOverride, focusNote, nextNote, trailNote) {
    const intervals = getIntervals();
    const allNotes  = intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
    const colors    = RUNNER_COLORS[mode === 'scales' ? 'scales' : 'arps'];
    const boxes     = getSequenceBoxes();
    const box       = boxOverride || getPreviewBox(boxes);
    if (!box) { clearGhostHighlight(); clearChordHighlight(); updateOverlays(); return; }
    const label = focusNote
      ? `${getLabel()} — ${box.label} (${noteIdx + 1}/${posNotes.length || box.positions.length})`
      : `${getLabel()} — ${box.label}`;
    // ghost the NEXT note ahead, trail the PREVIOUS one — read-ahead + motion
    if (nextNote) setGhostHighlight([{ si: nextNote.si, fret: nextNote.fret, note: nextNote.note }], { stroke: 'rgba(255,205,90,0.55)', fill: 'rgba(255,205,90,0.07)' });
    else clearGhostHighlight();
    const trail = trailNote ? [{ si: trailNote.si, fret: trailNote.fret }] : null;
    setChordHighlight(root, allNotes, label, boxDisplayPositions(box), colors, focusNote || null, trail);
    updateOverlays();
  }
  function getPositionNotes() {
    if (!posSequence.length || posIdx >= posSequence.length) return [];
    const box = posSequence[posIdx];
    if (!box.positions) return [];
    let asc = [...box.positions].filter(pp => pp.fret >= 0).sort((a, b) => b.si - a.si || a.fret - b.fret);
    if (startOnRoot) {   // rotate so the climb begins on the root
      const ri = asc.findIndex(pp => pp.note === root);
      if (ri > 0) asc = [...asc.slice(ri), ...asc.slice(0, ri)];
    }
    // Sequence variations — play the scale tones in interval pairs (1-3-2-4… / 1-4-2-5…) or skipping strings.
    if (patternSeq === 'broken3') asc = brokenPairs(asc, 2);
    else if (patternSeq === 'broken4') asc = brokenPairs(asc, 3);
    else if (patternSeq === 'skip') asc = stringSkip(asc);
    if (direction === 'asc')  return asc;
    if (direction === 'desc') return [...asc].reverse();
    // cycle = up then down.
    const desc2 = [...asc].reverse().slice(1, -1);
    return [...asc, ...desc2];
  }
  const getSharedBeatType = beatIdx => metroClock.pattern?.[beatIdx % Math.max(1, metroClock.pattern.length)] || (beatIdx === 0 ? 'accent' : 'regular');
  function pulseSharedClock(beatIdx) { const idx = beatIdx % Math.max(1, metroClock.ts || 4); metroClock.playing = true; metroClock.setBeat(idx, getSharedBeatType(idx)); }
  function tick(accent, beatIdx = 0) {
    try {
      const beatType = getSharedBeatType(beatIdx);
      if (beatType === 'rest') return;
      if (!rCtx) rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = rCtx, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = beatType === 'alternate' ? 'square' : 'triangle';
      osc.frequency.value = beatType === 'alternate' ? 760 : accent || beatType === 'accent' ? 800 : beatType === 'ghost' ? 430 : 500;
      gain.gain.value = beatType === 'ghost' ? 0.06 : accent || beatType === 'accent' ? 0.2 : 0.1;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }
  function playGoodTone() {
    try {
      if (!rCtx) rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = rCtx, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 1200; gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  }
  function highlightPosition() {
    if (!posSequence.length || posIdx >= posSequence.length) return;
    const box = posSequence[posIdx];
    const running = (advanceMode === 'auto' || advanceMode === 'listen') && posNotes.length && noteIdx < posNotes.length;
    const focusNote = running ? posNotes[noteIdx] : null;
    const nextNote  = running && noteIdx + 1 < posNotes.length ? posNotes[noteIdx + 1] : null;
    const trailNote = running && noteIdx > 0 ? posNotes[noteIdx - 1] : null;
    applyRunnerPreview(box, focusNote, nextNote, trailNote);
  }
  function updateBeatDisplay() {
    document.querySelectorAll(`#body-${p.id} .runner-pos`).forEach(card => {
      const bi = parseInt(card.dataset.li);
      const isLocked = lockedPos === bi;
      const curBoxIdx = posSequence.length && posIdx < posSequence.length ? posSequence[posIdx].idx : -1;
      const isCur = p._running && bi === curBoxIdx;
      card.style.background  = isLocked ? 'rgba(34,204,170,.35)' : isCur ? 'rgba(34,204,170,.25)' : 'rgba(34,204,170,.06)';
      card.style.borderColor = isLocked ? '#44eedd' : isCur ? '#22ccaa' : 'rgba(34,204,170,.15)';
    });
  }
  function onAudioDetect() {
    if (!p._running || advanceMode !== 'listen' || !posNotes.length || !alive()) return;
    const det = audio.detected;
    if (!det || noteIdx >= posNotes.length) return;
    const target = posNotes[noteIdx];
    if (det.note === target.note && Math.abs(det.cents) < 30) {
      listenFeedback = 'correct'; noteIdx++; playGoodTone();
      if (noteIdx >= posNotes.length) {
        updateBeatDisplay();
        setTimeout(() => { listenFeedback = ''; posIdx++; if (posIdx >= posSequence.length) posIdx = 0; noteIdx = 0; posNotes = getPositionNotes(); highlightPosition(); updateBeatDisplay(); }, 600);
      } else { updateBeatDisplay(); setTimeout(() => { listenFeedback = ''; updateBeatDisplay(); }, 400); }
    }
  }
  function startRunning() {
    metroClock.stopOthers(p.id);
    posSequence = buildPositionSequence();
    if (!posSequence.length) { p._running = false; refresh(); return; }
    p._running = true;
    posIdx = 0; beat = 0; noteIdx = 0;
    posNotes = getPositionNotes();
    highlightPosition();
    if (advanceMode !== 'listen') { pulseSharedClock(0); tick(true, 0); }
    if (advanceMode === 'auto') noteIdx = 1;
    if (advanceMode === 'tap') beat = 1;
    refresh();
    const useBpm = metroClock.bpm || 100;
    if (advanceMode === 'auto') {
      p._runIntv = setInterval(() => {
        if (noteIdx >= posNotes.length) { noteIdx = 0; posIdx++; if (posIdx >= posSequence.length) posIdx = 0; posNotes = getPositionNotes(); }
        const beatIdx = noteIdx % Math.max(1, metroClock.ts || 4);
        pulseSharedClock(beatIdx); tick(noteIdx === 0, beatIdx); noteIdx++;
        highlightPosition(); updateBeatDisplay();
      }, 60000 / useBpm);
    } else if (advanceMode === 'tap') {
      p._runIntv = setInterval(() => {
        const beatsPerBar = Math.max(1, metroClock.ts || 4);
        const beatIdx = beat % beatsPerBar;
        pulseSharedClock(beatIdx); tick(beatIdx === 0, beatIdx); updateBeatDisplay();
        beat++; if (beat >= barsPerPos * beatsPerBar) beat = 0;
      }, 60000 / useBpm);
    }
  }
  function stopRunning() {
    p._running = false;
    clearInterval(p._runIntv); p._runIntv = null;
    beat = 0; posIdx = 0; noteIdx = 0; posNotes = []; listenFeedback = '';
    metroClock.playing = false; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearGhostHighlight(); clearChordHighlight(); updateOverlays();
    refresh();
  }
  function advanceManual() {
    if (!p._running) return;
    beat = 0; posIdx++; if (posIdx >= posSequence.length) posIdx = 0;
    noteIdx = 0; posNotes = getPositionNotes(); highlightPosition(); updateBeatDisplay();
  }
  function onClock(clock) {
    if (!metroClock.follows(p.type)) return;
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._running && advanceMode === 'auto') { stopRunning(); startRunning(); } else refresh();
  }
  function onKey(ev) {
    if (!ev.root || !pedalBus.follows(p.type)) return;
    root = ev.root;
    if (p._running) { stopRunning(); startRunning(); } else refresh();
  }

  function renderBody(bodyEl) {
    const intervals  = getIntervals();
    const boxes      = getSequenceBoxes();
    const useBpm     = metroClock.bpm || 100;
    const accent     = mode === 'scales' ? '#22ccaa' : '#cc66aa';
    const previewBox = getPreviewBox(boxes);
    const types   = mode === 'scales' ? SCALE_TYPES : ARP_TYPES;
    const curName = mode === 'scales' ? scaleName : arpName;
    const curCat  = mode === 'scales' ? scaleCat : arpCat;

    const A = accent;
    const lbl = t => `<div class="mono" style="color:#5a6a6a;font-size:8px;letter-spacing:1px;margin:2px 0 1px">${t}</div>`;
    const curNotes = intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);

    let h = `<div style="display:flex;flex-direction:column;gap:7px">`;

    // SCALES / ARPEGGIOS
    h += `<div style="display:flex;gap:4px">
      <button class="chord-btn run-mode" data-rm="scales" style="flex:1;font-size:9px;${mode === 'scales' ? 'background:rgba(34,204,170,.15);border-color:#22ccaa;color:#22ccaa' : ''}">🎼 SCALES</button>
      <button class="chord-btn run-mode" data-rm="arps" style="flex:1;font-size:9px;${mode === 'arps' ? 'background:rgba(204,102,170,.15);border-color:#cc66aa;color:#cc66aa' : ''}">🎶 ARPEGGIOS</button></div>`;

    // FINGERING — CAGED boxes vs notes-per-string runs (scales only; arpeggios always use CAGED)
    if (mode === 'scales') {
      const fingNote = { caged: 'The five CAGED shapes across the neck', '3nps': 'Three notes on every string — smooth legato runs', '4nps': 'Four notes per string — wide stretch runs up the neck' }[fingering];
      h += `<div>${lbl('FINGERING')}<div style="display:flex;gap:4px">`;
      [['caged', '⬚ CAGED'], ['3nps', '3 / STRING'], ['4nps', '4 / STRING']].forEach(([fm, label]) =>
        h += `<button class="chord-btn run-fing" data-fm="${fm}" style="flex:1;font-size:8px;${fingering === fm ? `background:rgba(34,204,170,.16);border-color:${A};color:${A}` : ''}">${label}</button>`);
      h += `</div><div class="mono" style="color:#566;font-size:7px;text-align:center;margin-top:2px">${fingNote}</div></div>`;
    }

    // ROOT
    h += `<div>${lbl('ROOT')}<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">`;
    NOTES.forEach(n => { const a = n === root; h += `<button class="chord-btn run-root" data-r="${n}" style="min-width:24px;font-size:8px;padding:3px 5px;${a ? `background:rgba(34,204,170,.2);border-color:${A};color:${A}` : ''}">${n}</button>`; });
    h += `</div></div>`;

    // TYPE — grouped by category for readability
    h += `<div>${lbl(mode === 'scales' ? 'SCALE TYPE' : 'ARPEGGIO TYPE')}`;
    Object.entries(types).forEach(([cat, items]) => {
      h += `<div class="mono" style="color:#3f5450;font-size:7px;letter-spacing:.5px;margin:3px 0 1px">${cat}</div><div style="display:flex;flex-wrap:wrap;gap:2px">`;
      Object.keys(items).forEach(name => { const a = name === curName && cat === curCat; h += `<button class="chord-btn run-type" data-tn="${name}" data-tc="${cat}" style="font-size:8px;padding:3px 6px;${a ? `background:rgba(34,204,170,.18);border-color:${A};color:${A};font-weight:700` : ''}">${name}</button>`; });
      h += `</div>`;
    });
    h += `<div class="mono" style="color:#7a8a8a;font-size:8px;text-align:center;margin-top:4px">${getLabel()}: <span style="color:${A};font-weight:700">${curNotes.join('  ')}</span></div></div>`;

    // DIRECTION
    h += `<div>${lbl('DIRECTION')}<div style="display:flex;gap:3px">`;
    [['asc', '↑ Up'], ['desc', '↓ Down'], ['cycle', '↕ Up & Down']].forEach(([d, label]) => h += `<button class="chord-btn run-dir" data-dir="${d}" style="flex:1;font-size:8px;${direction === d ? `background:rgba(34,204,170,.16);border-color:${A};color:${A}` : ''}">${label}</button>`);
    h += `</div></div>`;

    // SEQUENCE — straight vs broken intervals vs string-skip (classic technique drills)
    h += `<div>${lbl('SEQUENCE')}<div style="display:flex;flex-wrap:wrap;gap:3px">`;
    [['straight', 'Straight'], ['broken3', 'Broken 3rds'], ['broken4', 'Broken 4ths'], ['skip', 'String Skip']].forEach(([pp, label]) => h += `<button class="chord-btn run-pat" data-pat="${pp}" style="flex:1;min-width:62px;font-size:8px;${patternSeq === pp ? `background:rgba(34,204,170,.16);border-color:${A};color:${A}` : ''}">${label}</button>`);
    h += `</div></div>`;

    // POSITION — box / run selector (always shown; lock one shape or cycle ALL)
    {
      h += `<div>${lbl('POSITION')}`;
      if (boxes.length) {
        h += `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;align-items:center;background:rgba(34,204,170,.04);border:1px solid rgba(34,204,170,.1);border-radius:6px;padding:5px">`;
        h += `<button class="chord-btn run-lock-all" style="font-size:7px;padding:2px 6px;min-width:28px;${lockedPos === null ? `background:rgba(34,204,170,.2);border-color:${A};color:${A}` : 'border-color:#444;color:#666'}">ALL</button>`;
        boxes.forEach((box, bi) => {
          const isLocked = lockedPos === bi, isCurrent = p._running && posSequence.length && posSequence[posIdx]?.idx === bi;
          const bg = isLocked ? 'rgba(34,204,170,.35)' : isCurrent ? 'rgba(34,204,170,.25)' : 'rgba(34,204,170,.06)';
          const border = isLocked ? '#44eedd' : isCurrent ? '#22ccaa' : 'rgba(34,204,170,.15)';
          const color = isLocked || isCurrent ? '#44eedd' : '#22998a';
          h += `<button class="chord-btn runner-pos run-lock" data-li="${bi}" style="background:${bg};border:1.5px solid ${border};border-radius:4px;padding:3px 6px;min-width:28px;cursor:pointer"><span class="mono" style="color:${color};font-size:9px;font-weight:700">${isLocked ? '🔒 ' : ''}${box.label}</span></button>`;
        });
        h += `</div>`;
      } else h += `<div class="mono" style="color:#555;font-size:9px;text-align:center;padding:8px">No positions found</div>`;
      h += `</div>`;
    }
    h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap">`;
    if (advanceMode === 'tap') {
      h += `<div style="display:flex;align-items:center;gap:3px"><span class="mono" style="color:#888;font-size:7px">TEMPO</span><span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span></div>`;
      h += `<div style="display:flex;align-items:center;gap:3px"><span class="mono" style="color:#888;font-size:7px">BARS</span>`;
      [1, 2, 4].forEach(b => h += `<button class="chord-btn run-bars" data-bars="${b}" style="font-size:7px;min-width:20px;padding:2px 4px;${barsPerPos === b ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${b}</button>`);
      h += `</div>`;
    } else if (advanceMode === 'auto') {
      h += `<div style="display:flex;align-items:center;gap:3px"><span class="mono" style="color:#888;font-size:7px">NOTE TEMPO</span><span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span><span class="mono" style="color:#666;font-size:7px">BPM</span></div>`;
    }
    h += `<div style="display:flex;align-items:center;gap:3px"><span class="mono" style="color:#888;font-size:7px">ADVANCE</span>`;
    [['auto', 'Auto'], ['tap', 'Tap'], ['listen', '🎤 Listen']].forEach(([m, label]) => h += `<button class="chord-btn run-adv" data-adv="${m}" style="font-size:7px;padding:2px 5px;${advanceMode === m ? `background:rgba(34,204,170,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`);
    h += `</div></div>`;
    if (advanceMode === 'listen') h += `<div class="mono" style="color:#555;font-size:7px;text-align:center">Enable 🎤 LIVE audio to use Listen mode${listenFeedback === 'correct' ? ' · <span style="color:#00ff88">✓</span>' : ''}</div>`;
    h += `<div style="display:flex;gap:4px">`;
    h += `<button class="run-play mono" style="background:${p._running ? 'rgba(255,60,60,.2)' : 'rgba(34,204,170,.15)'};border:1px solid ${p._running ? '#ff4444' : '#22ccaa'};color:${p._running ? '#ff6666' : '#22ccaa'};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;flex:1">${p._running ? '■ STOP' : '▶ RUN'}</button>`;
    if (p._running && advanceMode === 'tap') h += `<button class="run-next mono" style="background:rgba(34,204,170,.15);border:1px solid #22ccaa;color:#22ccaa;border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px">NEXT ▸</button>`;
    h += `</div></div>`;
    bodyEl.innerHTML = h;

    bodyEl.querySelectorAll('.run-mode').forEach(b => b.onclick = e => { e.stopPropagation(); mode = b.dataset.rm; lockedPos = null; if (p._running) stopRunning(); refresh(); });
    bodyEl.querySelectorAll('.run-fing').forEach(b => b.onclick = e => { e.stopPropagation(); fingering = b.dataset.fm; lockedPos = null; if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-root').forEach(b => b.onclick = e => { e.stopPropagation(); root = b.dataset.r; if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-type').forEach(b => b.onclick = e => { e.stopPropagation(); if (mode === 'scales') { scaleName = b.dataset.tn; scaleCat = b.dataset.tc; } else { arpName = b.dataset.tn; arpCat = b.dataset.tc; } if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-dir').forEach(b => b.onclick = e => { e.stopPropagation(); direction = b.dataset.dir; if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-pat').forEach(b => b.onclick = e => { e.stopPropagation(); patternSeq = b.dataset.pat; if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-lock').forEach(b => b.onclick = e => { e.stopPropagation(); const li = parseInt(b.dataset.li); lockedPos = lockedPos === li ? null : li; if (p._running) { stopRunning(); startRunning(); } else { refresh(); const nb = getSequenceBoxes(); applyRunnerPreview(lockedPos !== null ? nb[lockedPos] : getPreviewBox(nb)); } });
    const lockAll = bodyEl.querySelector('.run-lock-all');
    if (lockAll) lockAll.onclick = e => { e.stopPropagation(); lockedPos = null; if (p._running) { stopRunning(); startRunning(); } else { refresh(); const nb = getSequenceBoxes(); applyRunnerPreview(getPreviewBox(nb)); } };
    bodyEl.querySelectorAll('.run-bars').forEach(b => b.onclick = e => { e.stopPropagation(); barsPerPos = parseInt(b.dataset.bars); if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    bodyEl.querySelectorAll('.run-adv').forEach(b => b.onclick = e => { e.stopPropagation(); advanceMode = b.dataset.adv; if (p._running) { stopRunning(); startRunning(); } else refresh(); });
    const playBtn = bodyEl.querySelector('.run-play');
    if (playBtn) playBtn.onclick = e => { e.stopPropagation(); if (p._running) stopRunning(); else startRunning(); };
    const nextBtn = bodyEl.querySelector('.run-next');
    if (nextBtn) nextBtn.onclick = e => { e.stopPropagation(); advanceManual(); };

    Object.assign(s, { mode, root, scaleName, scaleCat, arpName, arpCat, direction, advanceMode, barsPerPos, lockedPos, startOnRoot, fingering, patternSeq });
    if (p._running) updateBeatDisplay(); else applyRunnerPreview(previewBox);
  }

  return {
    renderBody, start: startRunning, stop: stopRunning,
    onAudio: onAudioDetect, onClock, onKey,
    isRunning: () => !!p._running,
    getAccent: () => mode === 'scales' ? '#22ccaa' : '#cc66aa',
  };
}

// ════════════════════════════════════════════════════════════════════
//  GROOVE tab (ported from groove-lab.js)
// ════════════════════════════════════════════════════════════════════
function createGrooveTab(p, refresh) {
  const s = p.settings;
  let cat = s.rhythmCat || 'Guitar Strum';
  let patName = s.rhythmPat || 'All Down';
  let stepIdx = 0, editStep = null;
  let chordMode = s.rhyChordMode || 'uniform';
  let uniformChord = s.rhyUniform || 'Am';
  let stepChords = s.rhyStepChords || null;
  let lastClockConfig = metroClock.getConfigSignature();
  const COMMON_CHORDS = ['C','Am','G','Em','D','Dm','A','E','F','Fm','Bm','B','A7','D7','E7','G7','Am7','Dm7','Cmaj7','X'];

  const getPat = () => RHYTHM_PATTERNS[cat]?.[patName] || RHYTHM_PATTERNS['Guitar Strum']['All Down'];
  function ensureStepChords() { const pat = getPat(); if (!stepChords || stepChords.length !== pat.steps.length) stepChords = new Array(pat.steps.length).fill(null); }
  function getChordForStep(si) {
    if (chordMode === 'uniform') return uniformChord;
    ensureStepChords();
    for (let i = si; i >= 0; i--) if (stepChords[i]) return stepChords[i];
    for (let i = stepChords.length - 1; i > si; i--) if (stepChords[i]) return stepChords[i];
    return uniformChord;
  }
  const GROOVE_QMAP = { '':'Major', 'm':'Minor', '7':'7 (Dom)', 'm7':'Min7', 'maj7':'Maj7', 'dim':'Dim', 'aug':'Aug' };
  function parseChord(ch) {
    if (!ch || ch === 'X') return { root: 'X', notes: ['X'], label: 'Mute', quality: null };
    let rn = ch.length > 1 && (ch[1] === '#' || ch[1] === 'b') ? ch.slice(0, 2) : ch[0];
    const qual = ch.slice(rn.length) || ''; rn = toSharp(rn);
    const formulas = { '':[0,4,7],'m':[0,3,7],'7':[0,4,7,10],'m7':[0,3,7,10],'maj7':[0,4,7,11],'dim':[0,3,6],'aug':[0,4,8] };
    const q = qual.toLowerCase(), f2 = formulas[q] || formulas[''];
    return { root: rn, notes: f2.map(i => NOTES[(NOTES.indexOf(rn) + i) % 12]), label: ch, quality: GROOVE_QMAP[q] || 'Major' };
  }
  function highlightForStep(si) {
    if (currentInstrument === 'piano') return;
    const pat = getPat(), st = pat.steps[si], parsed = parseChord(getChordForStep(si));
    const isStrum = st === 'D' || st === 'U' || st === 'A', isMute = st === 'x' || st === 'g';
    if (parsed.root === 'X' || (isMute && chordMode === 'uniform')) {
      const positions = customTuning.map((s2, i) => ({ si: i, fret: 0, note: 'X' }));
      setChordHighlight('X', ['X'], 'Muted — ' + st, positions, { root:'#555', tone:'#333', rootStroke:'#666', toneStroke:'#444' });
    } else {
      // show ONE fingered chord grip (not every note on the neck) so the strum target is clear
      const g = parsed.quality ? pickGrip(parsed.root, parsed.notes, parsed.quality, 'open') : null;
      const grip = g ? g.positions : null;
      const purple = { root:'#bb66dd', tone:'#773399', rootStroke:'#dd88ff', toneStroke:'#9955cc' };
      if (isStrum || isMute) {
        setChordHighlight(parsed.root, parsed.notes, parsed.label + ' — ' + (isStrum ? (st === 'D' ? 'Down' : st === 'U' ? 'Up' : 'Accent') : 'Mute'), grip, purple);
      } else if (st === '·') {
        setChordHighlight(parsed.root, parsed.notes, parsed.label + ' — rest', grip, { root:'rgba(187,102,221,.3)', tone:'rgba(119,51,153,.2)', rootStroke:'rgba(187,102,221,.3)', toneStroke:'rgba(119,51,153,.2)' });
      } else {
        setChordHighlight(parsed.root, parsed.notes, parsed.label + ' — ' + st, grip, purple);
      }
    }
    updateOverlays();
  }
  function tickRhythm(type) {
    try {
      if (!p._rCtx) p._rCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = p._rCtx, o = c.createOscillator(), g = c.createGain();
      if (type === 'D' || type === '↓' || type === 'A') { o.type='square'; o.frequency.value=200; g.gain.value=0.35; }
      else if (type === 'U' || type === '↑') { o.type='square'; o.frequency.value=260; g.gain.value=0.25; }
      else if (type === 'x') { o.type='sawtooth'; o.frequency.value=80; g.gain.value=0.15; }
      else if (type === 'g') { o.type='triangle'; o.frequency.value=150; g.gain.value=0.08; }
      else return;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.06);
    } catch (e) {}
  }
  function randomizeStepChords() {
    const pat = getPat(), stepsPerBeat = pat.steps.length / pat.beats; ensureStepChords();
    const pool = ['C','Am','G','Em','D','Dm','A','E','F','Bm'];
    for (let b = 0; b < pat.beats; b++) stepChords[b * stepsPerBeat] = pool[Math.floor(Math.random() * pool.length)];
  }
  function updateRhythmDisplay() {
    document.querySelectorAll(`#body-${p.id} .rhythm-step`).forEach((c, i) => {
      const isCur = p._rhythmPlaying && i === stepIdx;
      c.style.background = isCur ? 'rgba(187,102,221,.4)' : '';
      c.style.borderColor = isCur ? '#bb66dd' : 'rgba(187,102,221,.15)';
    });
  }
  function startRhythm() {
    metroClock.stopOthers(p.id);
    const pat = getPat();
    p._rhythmPlaying = true; stepIdx = 0; editStep = null;
    if (chordMode === 'random') randomizeStepChords();
    metroClock.playing = true; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    tickRhythm(pat.steps[0]); highlightForStep(0); refresh();
    const tickInterval = 60000 / (metroClock.bpm || 120) / (pat.steps.length / pat.beats);
    p._rhythmIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % pat.steps.length;
      const st = pat.steps[stepIdx], stepsPerBeat = pat.steps.length / Math.max(1, pat.beats);
      const beatIdx = Math.floor(stepIdx / stepsPerBeat) % Math.max(1, metroClock.ts || pat.beats || 4);
      if (stepIdx % stepsPerBeat === 0) { metroClock.playing = true; metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular')); }
      if (st !== '·') tickRhythm(st);
      highlightForStep(stepIdx); updateRhythmDisplay();
    }, tickInterval);
  }
  function stopRhythm() {
    p._rhythmPlaying = false; clearInterval(p._rhythmIntv); p._rhythmIntv = null;
    stepIdx = 0; editStep = null;
    metroClock.playing = false; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight(); updateOverlays(); refresh();
  }
  function onKey(ev) { if (!ev.root || !pedalBus.follows(p.type)) return; uniformChord = ev.root; refresh(); }
  function onClock(clock) {
    if (!metroClock.follows(p.type)) return;
    const nc = clock.getConfigSignature(); if (nc === lastClockConfig) return; lastClockConfig = nc;
    if (p._rhythmPlaying) { stopRhythm(); startRhythm(); } else refresh();
  }
  function renderBody(bodyEl) {
    const pat = getPat(); ensureStepChords();
    const useBpm = metroClock.bpm || 120, accent = '#bb66dd', stepsPerBeat = pat.steps.length / pat.beats;
    let h = `<div style="display:flex;flex-direction:column;gap:4px">`;
    h += `<div style="display:flex;gap:2px">`;
    Object.keys(RHYTHM_PATTERNS).forEach(c => h += `<button class="chord-btn rhy-cat" data-rc="${c}" style="flex:1;font-size:7px;${cat === c ? `background:rgba(187,102,221,.15);border-color:${accent};color:${accent}` : ''}">${c}</button>`);
    h += `</div>`;
    const pats = RHYTHM_PATTERNS[cat] || {};
    h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
    Object.keys(pats).forEach(pn => h += `<button class="chord-btn rhy-pat" data-rp="${pn}" style="font-size:6px;padding:2px 4px;${patName === pn ? `background:rgba(187,102,221,.15);border-color:${accent};color:${accent}` : ''}">${pn}</button>`);
    h += `</div>`;
    h += `<div class="mono" style="color:#888;font-size:7px;text-align:center">${pat.desc}</div>`;
    h += `<div style="display:flex;gap:2px;align-items:center"><span class="mono" style="color:#555;font-size:7px">CHORDS</span>`;
    [['uniform','Same'],['per-step','Per Beat'],['random','🎲']].forEach(([m, label]) => h += `<button class="chord-btn rhy-cm" data-cm="${m}" style="flex:1;font-size:7px;${chordMode === m ? `background:rgba(187,102,221,.12);border-color:${accent};color:${accent}` : ''}">${label}</button>`);
    h += `</div>`;
    if (chordMode === 'uniform') {
      h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
      COMMON_CHORDS.forEach(ch => h += `<button class="chord-btn rhy-uc" data-uc="${ch}" style="font-size:6px;padding:1px 3px;${uniformChord === ch ? `background:rgba(187,102,221,.12);border-color:${accent};color:${accent}` : ''}">${ch}</button>`);
      h += `</div>`;
    }
    h += `<div style="background:rgba(187,102,221,.04);border:1px solid rgba(187,102,221,.1);border-radius:6px;padding:5px;overflow-x:auto">`;
    h += `<div style="display:flex;gap:1px;margin-bottom:2px">`;
    for (let b = 0; b < pat.beats; b++) h += `<div style="flex:${stepsPerBeat};text-align:center"><span class="mono" style="color:#555;font-size:7px">${b + 1}</span></div>`;
    h += `</div><div style="display:flex;gap:1px">`;
    pat.steps.forEach((st, si) => {
      const isCur = p._rhythmPlaying && si === stepIdx, isDownbeat = si % stepsPerBeat === 0;
      const colors = { 'D':'#bb66dd','U':'#9944bb','↓':'#bb66dd','↑':'#9944bb','A':'#ff6688','x':'#666','g':'#555','·':'transparent' };
      const bg = isCur ? 'rgba(187,102,221,.4)' : st !== '·' ? 'rgba(187,102,221,.1)' : 'rgba(255,255,255,.02)';
      h += `<div class="rhythm-step" style="flex:1;min-width:16px;height:22px;background:${bg};border:1px solid ${isCur ? '#bb66dd' : 'rgba(187,102,221,.15)'};${isDownbeat ? 'border-left-width:2px;' : ''}border-radius:2px;display:flex;align-items:center;justify-content:center"><span class="mono" style="color:${colors[st] || '#444'};font-size:${st === '·' ? 7 : 9}px;font-weight:700">${st}</span></div>`;
    });
    h += `</div>`;
    if (chordMode === 'per-step' || chordMode === 'random') {
      h += `<div style="display:flex;gap:1px;margin-top:1px">`;
      pat.steps.forEach((st, si) => {
        const ch = stepChords[si], isEdit = editStep === si, isDownbeat = si % stepsPerBeat === 0;
        const bg = isEdit ? 'rgba(187,102,221,.25)' : ch ? 'rgba(187,102,221,.1)' : 'rgba(255,255,255,.02)';
        h += `<div class="rhy-step-ch" data-rsi="${si}" style="flex:1;min-width:16px;height:18px;background:${bg};border:1px solid ${isEdit ? '#bb66dd' : 'rgba(187,102,221,.08)'};${isDownbeat ? 'border-left-width:2px;' : ''}border-radius:2px;display:flex;align-items:center;justify-content:center;cursor:pointer"><span class="mono" style="color:${ch ? '#bb88dd' : '#444'};font-size:6px;font-weight:${ch ? 700 : 400}">${ch || ''}</span></div>`;
      });
      h += `</div>`;
    }
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;justify-content:center">`;
    const legendItems = cat === 'Picking' ? [['↓','Down'],['↑','Up'],['·','Rest']] : cat === 'Rhythm Feel' ? [['A','Accent'],['g','Ghost'],['·','Rest']] : [['D','Down'],['U','Up'],['x','Mute'],['·','Rest']];
    legendItems.forEach(([sym, label]) => h += `<span class="mono" style="color:#666;font-size:6px"><span style="color:${accent}">${sym}</span> ${label}</span>`);
    h += `</div></div>`;
    if (editStep !== null && (chordMode === 'per-step' || chordMode === 'random')) {
      h += `<div style="background:rgba(187,102,221,.06);border:1px solid rgba(187,102,221,.15);border-radius:5px;padding:5px"><div class="mono" style="color:#888;font-size:7px;margin-bottom:3px">Step ${editStep + 1} chord:</div><div style="display:flex;gap:2px;flex-wrap:wrap">`;
      COMMON_CHORDS.forEach(ch => h += `<button class="chord-btn rhy-pick" data-rpc="${ch}" style="font-size:6px;padding:1px 3px;${stepChords[editStep] === ch ? `background:rgba(187,102,221,.15);border-color:${accent};color:${accent}` : ''}">${ch}</button>`);
      h += `</div><div style="display:flex;gap:3px;margin-top:3px"><button class="chord-btn rhy-pick-clear" style="font-size:7px;color:#888;flex:1">Clear (inherit)</button><button class="chord-btn rhy-pick-done" style="font-size:7px;flex:1">Done</button></div></div>`;
    }
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><span class="mono" style="color:#888;font-size:7px">TEMPO</span><span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span><span class="mono" style="color:#666;font-size:7px">${pat.sub}</span></div>`;
    h += `<button class="rhy-play mono" style="background:${p._rhythmPlaying ? 'rgba(255,60,60,.2)' : 'rgba(187,102,221,.15)'};border:1px solid ${p._rhythmPlaying ? '#ff4444' : '#bb66dd'};color:${p._rhythmPlaying ? '#ff6666' : '#bb66dd'};border-radius:8px;padding:6px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">${p._rhythmPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;
    bodyEl.innerHTML = h;

    bodyEl.querySelectorAll('.rhy-cat').forEach(b => b.onclick = e => { e.stopPropagation(); cat = b.dataset.rc; patName = Object.keys(RHYTHM_PATTERNS[cat] || {})[0] || 'All Down'; stepChords = null; editStep = null; if (p._rhythmPlaying) { stopRhythm(); startRhythm(); } else refresh(); });
    bodyEl.querySelectorAll('.rhy-pat').forEach(b => b.onclick = e => { e.stopPropagation(); patName = b.dataset.rp; stepChords = null; editStep = null; if (p._rhythmPlaying) { stopRhythm(); startRhythm(); } else refresh(); });
    bodyEl.querySelectorAll('.rhy-cm').forEach(b => b.onclick = e => { e.stopPropagation(); chordMode = b.dataset.cm; editStep = null; if (chordMode === 'random') { stepChords = null; ensureStepChords(); randomizeStepChords(); } refresh(); });
    bodyEl.querySelectorAll('.rhy-uc').forEach(b => b.onclick = e => { e.stopPropagation(); uniformChord = b.dataset.uc; refresh(); });
    bodyEl.querySelectorAll('.rhy-step-ch').forEach(b => b.onclick = e => { e.stopPropagation(); const si = parseInt(b.dataset.rsi); editStep = editStep === si ? null : si; refresh(); });
    bodyEl.querySelectorAll('.rhy-pick').forEach(b => b.onclick = e => { e.stopPropagation(); if (editStep !== null) { ensureStepChords(); stepChords[editStep] = b.dataset.rpc; refresh(); } });
    const cpb = bodyEl.querySelector('.rhy-pick-clear'); if (cpb) cpb.onclick = e => { e.stopPropagation(); if (editStep !== null) { ensureStepChords(); stepChords[editStep] = null; refresh(); } };
    const dpb = bodyEl.querySelector('.rhy-pick-done'); if (dpb) dpb.onclick = e => { e.stopPropagation(); editStep = null; refresh(); };
    bodyEl.querySelector('.rhy-play').onclick = e => { e.stopPropagation(); if (p._rhythmPlaying) stopRhythm(); else startRhythm(); };
    Object.assign(s, { rhythmCat: cat, rhythmPat: patName, rhyChordMode: chordMode, rhyUniform: uniformChord, rhyStepChords: stepChords });
  }
  return { renderBody, start: startRhythm, stop: stopRhythm, onAudio() {}, onClock, onKey, isRunning: () => !!p._rhythmPlaying, getAccent: () => '#bb66dd' };
}

// ════════════════════════════════════════════════════════════════════
//  FINGER tab (ported from finger-trainer.js)
// ════════════════════════════════════════════════════════════════════
function createFingerTab(p, refresh) {
  const s = p.settings;
  const fi = getFingerInstrument();
  let instMode = FINGER_PATTERNS[s.fingerInst] ? s.fingerInst : fi;
  let patName = s.fingerPat || Object.keys(FINGER_PATTERNS[instMode].patterns)[0];
  let stepIdx = 0;
  let root = s.fingerRoot || 'C';
  let fChordRoot = s.fChordRoot || 'Am';
  let fChordMode = s.fChordMode || 'chord';
  let lastClockConfig = metroClock.getConfigSignature();

  const getPat = () => { const ip = FINGER_PATTERNS[instMode]; return ip?.patterns?.[patName] || Object.values(ip?.patterns || {})[0] || { steps: [], desc: '' }; };
  function parseChordName(ch) {
    if (!ch) return null;
    let rn = ch.length > 1 && (ch[1] === '#' || ch[1] === 'b') ? ch.slice(0, 2) : ch[0];
    const qual = ch.slice(rn.length) || ''; rn = toSharp(rn);
    const formulas = { '':[0,4,7],'m':[0,3,7],'7':[0,4,7,10],'m7':[0,3,7,10],'maj7':[0,4,7,11],'dim':[0,3,6],'aug':[0,4,8] };
    const f2 = formulas[qual.toLowerCase()] || formulas[''];
    return { root: rn, notes: f2.map(i => NOTES[(NOTES.indexOf(rn) + i) % 12]), qual };
  }
  function getChordPositions() {
    if (fChordMode === 'open' || instMode === 'piano') return null;
    const ch = parseChordName(fChordRoot); if (!ch) return null;
    const positions = [];
    customTuning.forEach((str, si) => { for (let f = 0; f <= 7; f++) { const { note } = getNoteAtFret(str.note, str.octave, f); if (ch.notes.includes(note)) { positions.push({ si, fret: f, note }); break; } } });
    return { root: ch.root, notes: ch.notes, positions, label: fChordRoot };
  }
  function getStepNoteInfo(step) {
    const ri = NOTES.indexOf(root);
    if (instMode === 'piano') {
      const scaleIntervals = [0,2,4,5,7,9,11], deg = step.d % 12;
      const semi = deg < scaleIntervals.length ? scaleIntervals[deg] : deg, note = NOTES[(ri + semi) % 12];
      return { note, finger: step.f, label: `${step.f}`, desc: `${note} (finger ${step.f})` };
    }
    const si = step.s;
    if (si >= customTuning.length) return { note: '?', finger: step.f, si: 0, fret: 0, label: step.f, desc: '' };
    const chPos = getChordPositions();
    if (chPos && chPos.positions.length) { const sp = chPos.positions.find(pp => pp.si === si); if (sp) return { note: sp.note, finger: step.f, si, fret: sp.fret, label: step.f, desc: `${sp.note} str ${si + 1} fret ${sp.fret} (${step.f})` }; }
    const note = customTuning[si].note;
    return { note, finger: step.f, si, fret: 0, label: step.f, desc: `${note} str ${si + 1} (${step.f})` };
  }
  function highlightStep() {
    const pat = getPat(); if (!pat.steps.length || stepIdx >= pat.steps.length) return;
    const step = pat.steps[stepIdx], info = getStepNoteInfo(step);
    const colors = { root:'#dd9944', tone:'#664411', rootStroke:'#ffbb66', toneStroke:'#886633' };
    if (instMode !== 'piano') {
      const si = step.s < customTuning.length ? step.s : 0, chPos = getChordPositions();
      if (chPos && chPos.positions.length) {
        const sp = chPos.positions.find(pp => pp.si === si);
        const fret = sp ? sp.fret : 0, fretNote = sp ? sp.note : customTuning[si]?.note;
        setChordHighlight(chPos.root, chPos.notes, `${chPos.label} — ${info.finger}: str ${si + 1} fret ${fret}`, chPos.positions, colors, { si, fret, note: fretNote, finger: info.finger });
      } else {
        const allNotes = customTuning.map(s2 => s2.note), positions = customTuning.map((s2, i) => ({ si: i, fret: 0, note: s2.note }));
        setChordHighlight(root, allNotes, `${patName} — ${info.finger}: str ${si + 1}`, positions, colors, { si, fret: 0, note: customTuning[si]?.note || 'E', finger: info.finger });
      }
    } else {
      const ri2 = NOTES.indexOf(root), scaleIntervals = [0,2,4,5,7,9,11];
      const scaleNotes = scaleIntervals.map(i => NOTES[(ri2 + i) % 12]), deg = step.d % 12;
      const targetNote = deg < scaleIntervals.length ? NOTES[(ri2 + scaleIntervals[deg]) % 12] : NOTES[(ri2 + deg) % 12];
      setChordHighlight(root, scaleNotes, `${patName} — finger ${step.f}: ${targetNote}`, null, colors);
    }
    updateOverlays();
  }
  function tickFinger(accent) {
    try {
      if (!p._fCtx) p._fCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = p._fCtx, pat = getPat();
      if (pat.steps.length && stepIdx < pat.steps.length) {
        const info = getStepNoteInfo(pat.steps[stepIdx]);
        if (info.note && info.note !== '?') {
          const oct = instMode === 'piano' ? 4 : (info.si !== undefined && info.si < customTuning.length ? customTuning[info.si].octave + Math.floor((NOTES.indexOf(customTuning[info.si].note) + (info.fret || 0)) / 12) : 3);
          const freq = 440 * Math.pow(2, (NOTES.indexOf(info.note) - 9) / 12 + (oct - 4));
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'triangle'; o.frequency.value = freq; g.gain.value = accent ? 0.25 : 0.18;
          g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
          o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.25); return;
        }
      }
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = accent ? 700 : 500; g.gain.value = accent ? 0.2 : 0.12;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.05);
    } catch (e) {}
  }
  function updateFingerDisplay() {
    const pat = getPat();
    document.querySelectorAll(`#body-${p.id} .finger-step`).forEach((c, i) => {
      const isCur = p._fingerPlaying && i === stepIdx;
      c.style.background = isCur ? 'rgba(221,153,68,.4)' : '';
      c.style.borderColor = isCur ? '#dd9944' : 'rgba(221,153,68,.15)';
    });
    const fi2 = document.getElementById(`finger-ind-${p.id}`);
    if (fi2 && p._fingerPlaying && stepIdx < pat.steps.length) {
      const info = getStepNoteInfo(pat.steps[stepIdx]);
      fi2.innerHTML = `<span class="mono" style="color:#ffbb66;font-size:18px;font-weight:900">${info.finger}</span><span class="mono" style="color:#888;font-size:9px">${info.desc}</span>`;
    }
  }
  function startFinger() {
    metroClock.stopOthers(p.id);
    const pat = getPat(); if (!pat.steps.length) { p._fingerPlaying = false; refresh(); return; }
    p._fingerPlaying = true; stepIdx = 0; highlightStep();
    metroClock.playing = true; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    tickFinger(true); refresh();
    const useBpm = metroClock.bpm || 100;
    p._fingerIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % pat.steps.length;
      const beatIdx = stepIdx % Math.max(1, metroClock.ts || 4);
      metroClock.playing = true; metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
      tickFinger(beatIdx === 0); highlightStep(); updateFingerDisplay();
    }, 60000 / useBpm);
  }
  function stopFinger() {
    p._fingerPlaying = false; clearInterval(p._fingerIntv); p._fingerIntv = null; stepIdx = 0;
    metroClock.playing = false; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight(); updateOverlays(); refresh();
  }
  function onKey(ev) { if (!ev.root || !pedalBus.follows(p.type)) return; root = ev.root; refresh(); }
  function onClock(clock) {
    if (!metroClock.follows(p.type)) return;
    const nc = clock.getConfigSignature(); if (nc === lastClockConfig) return; lastClockConfig = nc;
    if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh();
  }
  function renderBody(bodyEl) {
    const pat = getPat(), useBpm = metroClock.bpm || 100, ipData = FINGER_PATTERNS[instMode];
    let h = `<div style="display:flex;flex-direction:column;gap:6px">`;
    h += `<div style="display:flex;gap:3px">`;
    Object.entries(FINGER_PATTERNS).forEach(([k, v]) => h += `<button class="chord-btn fin-inst" data-fi="${k}" style="flex:1;font-size:7px;${instMode === k ? 'background:rgba(221,153,68,.15);border-color:#dd9944;color:#dd9944' : ''}">${v.label}</button>`);
    h += `</div><div style="display:flex;flex-wrap:wrap;gap:3px">`;
    Object.keys(ipData.patterns).forEach(pn => h += `<button class="chord-btn fin-pat" data-fp="${pn}" style="font-size:7px;padding:2px 5px;${patName === pn ? 'background:rgba(221,153,68,.15);border-color:#dd9944;color:#dd9944' : ''}">${pn}</button>`);
    h += `</div><div class="mono" style="color:#888;font-size:8px;text-align:center">${pat.desc}</div>`;
    if (instMode !== 'piano') {
      h += `<div style="background:rgba(221,153,68,.04);border:1px solid rgba(221,153,68,.08);border-radius:5px;padding:5px"><div class="mono" style="color:#888;font-size:7px;margin-bottom:3px">CHORD SHAPE</div><div style="display:flex;gap:2px;margin-bottom:3px">`;
      [['chord','Chord'],['open','Open'],['random','🎲 Random']].forEach(([m, label]) => h += `<button class="chord-btn fin-cm" data-fcm="${m}" style="flex:1;font-size:7px;${fChordMode === m ? 'background:rgba(221,153,68,.12);border-color:#dd9944;color:#dd9944' : ''}">${label}</button>`);
      h += `</div>`;
      if (fChordMode === 'chord') {
        const commonChords = ['C','Am','G','Em','D','Dm','A','Am','E','Em','F','Fm','B','Bm','A7','D7','E7','G7','Am7','Dm7','Em7','Cmaj7','Fmaj7'];
        h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
        commonChords.forEach(ch => h += `<button class="chord-btn fin-chord" data-fch="${ch}" style="font-size:6px;padding:1px 4px;${fChordRoot === ch ? 'background:rgba(221,153,68,.12);border-color:#dd9944;color:#dd9944' : ''}">${ch}</button>`);
        h += `</div>`;
      }
      h += `</div>`;
    }
    if (instMode === 'piano') {
      h += `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">`;
      NOTES.forEach(n => h += `<button class="chord-btn fin-root" data-r="${n}" style="font-size:7px;min-width:22px;padding:2px 4px;${root === n ? 'background:rgba(221,153,68,.15);border-color:#dd9944;color:#dd9944' : ''}">${n}</button>`);
      h += `</div>`;
    }
    h += `<div id="finger-ind-${p.id}" style="display:flex;align-items:center;justify-content:center;gap:8px;min-height:28px">`;
    if (p._fingerPlaying && stepIdx < pat.steps.length) { const info = getStepNoteInfo(pat.steps[stepIdx]); h += `<span class="mono" style="color:#ffbb66;font-size:18px;font-weight:900">${info.finger}</span><span class="mono" style="color:#888;font-size:9px">${info.desc}</span>`; }
    h += `</div>`;
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;background:rgba(221,153,68,.04);border:1px solid rgba(221,153,68,.1);border-radius:6px;padding:6px">`;
    pat.steps.forEach((st, si) => {
      const isCur = p._fingerPlaying && si === stepIdx, info = getStepNoteInfo(st);
      h += `<div class="finger-step" style="background:${isCur ? 'rgba(221,153,68,.4)' : 'rgba(221,153,68,.08)'};border:1.5px solid ${isCur ? '#dd9944' : 'rgba(221,153,68,.15)'};border-radius:4px;padding:3px 5px;text-align:center;min-width:30px"><div class="mono" style="color:#ffbb66;font-size:12px;font-weight:800">${info.finger}</div>`;
      if (instMode !== 'piano') h += `<div class="mono" style="color:#aaa;font-size:7px;font-weight:600">${info.note || ''}</div><div class="mono" style="color:#555;font-size:6px">s${st.s + 1}${info.fret ? ' f' + info.fret : ''}</div>`;
      else h += `<div class="mono" style="color:#aaa;font-size:7px">${info.note}</div>`;
      h += `</div>`;
    });
    h += `</div>`;
    h += `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">`;
    const legend = instMode === 'guitar' ? [['p','Thumb'],['i','Index'],['m','Middle'],['a','Ring']] : instMode === 'banjo' ? [['T','Thumb'],['I','Index'],['M','Middle']] : [['1','Thumb'],['2','Index'],['3','Middle'],['4','Ring'],['5','Pinky']];
    legend.forEach(([f, label]) => h += `<span class="mono" style="color:#666;font-size:7px"><span style="color:#dd9944;font-weight:700">${f}</span> ${label}</span>`);
    h += `</div>`;
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><span class="mono" style="color:#888;font-size:7px">NOTE TEMPO</span><span class="mono" style="color:#dd8844;font-size:12px;font-weight:700">${useBpm}</span><span class="mono" style="color:#666;font-size:7px">BPM</span></div>`;
    h += `<button class="fin-play mono" style="background:${p._fingerPlaying ? 'rgba(255,60,60,.2)' : 'rgba(221,153,68,.15)'};border:1px solid ${p._fingerPlaying ? '#ff4444' : '#dd9944'};color:${p._fingerPlaying ? '#ff6666' : '#dd9944'};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">${p._fingerPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;
    bodyEl.innerHTML = h;

    bodyEl.querySelectorAll('.fin-inst').forEach(b => b.onclick = e => { e.stopPropagation(); instMode = b.dataset.fi; patName = Object.keys(FINGER_PATTERNS[instMode].patterns)[0]; if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh(); });
    bodyEl.querySelectorAll('.fin-pat').forEach(b => b.onclick = e => { e.stopPropagation(); patName = b.dataset.fp; if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh(); });
    bodyEl.querySelectorAll('.fin-root').forEach(b => b.onclick = e => { e.stopPropagation(); root = b.dataset.r; if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh(); });
    bodyEl.querySelectorAll('.fin-cm').forEach(b => b.onclick = e => { e.stopPropagation(); fChordMode = b.dataset.fcm; if (fChordMode === 'random') { const rch = ['C','Am','G','Em','D','Dm','A','E','F','Bm','A7','E7']; fChordRoot = rch[Math.floor(Math.random() * rch.length)]; } if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh(); });
    bodyEl.querySelectorAll('.fin-chord').forEach(b => b.onclick = e => { e.stopPropagation(); fChordRoot = b.dataset.fch; if (p._fingerPlaying) { stopFinger(); startFinger(); } else refresh(); });
    bodyEl.querySelector('.fin-play').onclick = e => { e.stopPropagation(); if (p._fingerPlaying) stopFinger(); else startFinger(); };
    Object.assign(s, { fingerInst: instMode, fingerPat: patName, fingerRoot: root, fChordRoot, fChordMode });
  }
  return { renderBody, start: startFinger, stop: stopFinger, onAudio() {}, onClock, onKey, isRunning: () => !!p._fingerPlaying, getAccent: () => '#dd9944' };
}

// ════════════════════════════════════════════════════════════════════
//  TECHNIQUE tab (ported from technique-builder.js — with the latent
//  setChordHighlight/clearChordHighlight import fix + updateOverlays so
//  the legato highlight actually paints).
// ════════════════════════════════════════════════════════════════════
function createTechniqueTab(p, refresh) {
  const s = p.settings;
  let techCat = s.techCat || 'Hammer-On';
  let exName = s.techEx || 'Single H-O';
  let stepIdx = 0;
  let stringOffset = s.techString || 0;
  let lastClockConfig = metroClock.getConfigSignature();

  const getEx = () => { const cat = TECHNIQUE_EXERCISES[techCat]; return cat?.exercises?.find(e => e.name === exName) || cat?.exercises?.[0] || { steps: [], desc: '' }; };
  function getAdjustedStep(step) { const si = Math.max(0, Math.min(customTuning.length - 1, step[0] + stringOffset)); return [si, step[1], step[2]]; }
  function highlightTechStep() {
    const ex = getEx(); if (!ex.steps.length || stepIdx >= ex.steps.length) return;
    const step = getAdjustedStep(ex.steps[stepIdx]), si = step[0], fret = step[1];
    const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    const positions = [{ si, fret, note }];
    let label = `${note} str ${si + 1} fret ${fret}`;
    if (stepIdx + 1 < ex.steps.length) {
      const next = getAdjustedStep(ex.steps[stepIdx + 1]), nAction = next[2];
      if (nAction !== 'pick') {
        const { note: nn } = getNoteAtFret(customTuning[next[0]].note, customTuning[next[0]].octave, next[1]);
        positions.push({ si: next[0], fret: next[1], note: nn });
        const symMap = { 'H':'→H','P':'→P','/':'→/','\\':'→\\','b½':'↑b½','b1':'↑b1','r':'↓rel','pb':'pre-b','~':'~','~s':'~slow','~f':'~fast' };
        label += ` ${symMap[nAction] || nAction} ${nn}`;
      }
    }
    const allNotes = [...new Set(positions.map(pp => pp.note))];
    setChordHighlight(note, allNotes, `${techCat}: ${label}`, positions, { root:'#ff7744', tone:'#cc5522', rootStroke:'#ffaa66', toneStroke:'#dd7744' }, { si, fret, note });
    updateOverlays();
  }
  function playTechNote(step) {
    try {
      if (!p._tCtx) p._tCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = p._tCtx, t = ctx.currentTime, si = step[0], fret = step[1], action = step[2];
      const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
      const oct = customTuning[si].octave + Math.floor((NOTES.indexOf(customTuning[si].note) + fret) / 12);
      const freq = 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (oct - 4));
      const o = ctx.createOscillator(), g = ctx.createGain();
      const connectAndPlay = () => { o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.5); };
      if (action === 'pick') { o.type='triangle'; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); }
      else if (action === 'H') { o.type='triangle'; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); }
      else if (action === 'P') { o.type='triangle'; g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); }
      else if (action === '/' || action === '\\') {
        o.type='triangle'; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        if (stepIdx > 0) {
          const prev = getAdjustedStep(getEx().steps[stepIdx - 1]);
          const pn = getNoteAtFret(customTuning[prev[0]].note, customTuning[prev[0]].octave, prev[1]);
          const poct = customTuning[prev[0]].octave + Math.floor((NOTES.indexOf(customTuning[prev[0]].note) + prev[1]) / 12);
          const pf = 440 * Math.pow(2, (NOTES.indexOf(pn.note) - 9) / 12 + (poct - 4));
          o.frequency.setValueAtTime(pf, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.15); return connectAndPlay();
        }
      } else if (action.startsWith('b')) {
        o.type='triangle'; g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        const targetFreq = freq * Math.pow(2, (action === 'b½' ? 1 : 2) / 12);
        o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(targetFreq, t + 0.2); return connectAndPlay();
      } else if (action === 'r') { o.type='triangle'; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); }
      else if (action === 'pb') { g.gain.setValueAtTime(0, t); return; }
      else if (action.startsWith('~')) {
        o.type='triangle'; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = action === '~f' ? 6 : 3; lg.gain.value = action === '~f' ? 3 : 6;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 0.5);
      } else { g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); }
      o.frequency.value = freq; connectAndPlay();
    } catch (e) {}
  }
  function updateTechDisplay() {
    document.querySelectorAll(`#body-${p.id} .tech-step`).forEach((c, i) => {
      const isCur = p._techPlaying && i === stepIdx;
      c.style.background = isCur ? 'rgba(255,119,68,.4)' : '';
      c.style.borderColor = isCur ? '#ff7744' : 'rgba(255,119,68,.12)';
    });
  }
  function startTech() {
    metroClock.stopOthers(p.id);
    const ex = getEx(); if (!ex.steps.length) { p._techPlaying = false; refresh(); return; }
    p._techPlaying = true; stepIdx = 0;
    metroClock.playing = true; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    highlightTechStep(); playTechNote(getAdjustedStep(ex.steps[0])); refresh();
    const useBpm = metroClock.bpm || 80;
    p._techIntv = setInterval(() => {
      stepIdx = (stepIdx + 1) % ex.steps.length;
      const beatIdx = stepIdx % Math.max(1, metroClock.ts || 4);
      metroClock.playing = true; metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular'));
      highlightTechStep(); playTechNote(getAdjustedStep(ex.steps[stepIdx])); updateTechDisplay();
    }, 60000 / useBpm);
  }
  function stopTech() {
    p._techPlaying = false; clearInterval(p._techIntv); p._techIntv = null; stepIdx = 0;
    metroClock.playing = false; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    clearChordHighlight(); updateOverlays(); refresh();
  }
  function onClock(clock) {
    if (!metroClock.follows(p.type)) return;
    const nc = clock.getConfigSignature(); if (nc === lastClockConfig) return; lastClockConfig = nc;
    if (p._techPlaying) { stopTech(); startTech(); } else refresh();
  }
  function renderBody(bodyEl) {
    const ex = getEx(), accent = '#ff7744', useBpm = metroClock.bpm || 80;
    let h = `<div style="display:flex;flex-direction:column;gap:5px">`;
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    Object.keys(TECHNIQUE_EXERCISES).forEach(tc => h += `<button class="chord-btn tech-cat" data-tc="${tc}" style="flex:1;font-size:7px;${techCat === tc ? `background:rgba(255,119,68,.15);border-color:${accent};color:${accent}` : ''}">${TECHNIQUE_EXERCISES[tc].symbol} ${tc}</button>`);
    h += `</div><div class="mono" style="color:#888;font-size:7px;text-align:center">${TECHNIQUE_EXERCISES[techCat]?.desc || ''}</div>`;
    const exs = TECHNIQUE_EXERCISES[techCat]?.exercises || [];
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    exs.forEach(e => h += `<button class="chord-btn tech-ex" data-te="${e.name}" style="font-size:7px;padding:2px 5px;${exName === e.name ? `background:rgba(255,119,68,.15);border-color:${accent};color:${accent}` : ''}">${e.name}</button>`);
    h += `</div><div class="mono" style="color:#999;font-size:8px;text-align:center">${ex.desc}</div>`;
    h += `<div style="display:flex;gap:2px;align-items:center;justify-content:center"><span class="mono" style="color:#555;font-size:7px">START STRING</span>`;
    customTuning.forEach((_, i) => h += `<button class="chord-btn tech-str" data-ts="${i}" style="font-size:7px;min-width:18px;${stringOffset === i ? `background:rgba(255,119,68,.12);border-color:${accent};color:${accent}` : ''}">${i + 1}</button>`);
    h += `</div>`;
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;background:rgba(255,119,68,.04);border:1px solid rgba(255,119,68,.1);border-radius:6px;padding:6px">`;
    ex.steps.forEach((step, si) => {
      const adj = getAdjustedStep(step), { note } = getNoteAtFret(customTuning[adj[0]].note, customTuning[adj[0]].octave, adj[1]);
      const isCur = p._techPlaying && si === stepIdx;
      const actionLabel = { pick:'♩', H:'H', P:'P', '/':'/', '\\':'\\', 'b½':'b½', b1:'b1', r:'rel', pb:'pre', '~':'~', '~s':'~s', '~f':'~f' }[step[2]] || step[2];
      h += `<div class="tech-step" style="background:${isCur ? 'rgba(255,119,68,.4)' : 'rgba(255,119,68,.08)'};border:1.5px solid ${isCur ? '#ff7744' : 'rgba(255,119,68,.12)'};border-radius:4px;padding:3px 5px;text-align:center;min-width:30px"><div class="mono" style="color:${step[2] === 'pick' ? '#ffbb66' : '#ff9966'};font-size:11px;font-weight:800">${actionLabel}</div><div class="mono" style="color:#aaa;font-size:7px;font-weight:600">${note}</div><div class="mono" style="color:#555;font-size:6px">s${adj[0] + 1} f${adj[1]}</div></div>`;
    });
    h += `</div>`;
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><span class="mono" style="color:#888;font-size:7px">TEMPO</span><span class="mono" style="color:#dd8844;font-size:11px;font-weight:700">${useBpm}</span><span class="mono" style="color:#666;font-size:7px">BPM</span></div>`;
    h += `<button class="tech-play mono" style="background:${p._techPlaying ? 'rgba(255,60,60,.2)' : 'rgba(255,119,68,.15)'};border:1px solid ${p._techPlaying ? '#ff4444' : accent};color:${p._techPlaying ? '#ff6666' : accent};border-radius:8px;padding:6px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">${p._techPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('.tech-cat').forEach(b => b.onclick = e => { e.stopPropagation(); techCat = b.dataset.tc; exName = TECHNIQUE_EXERCISES[techCat]?.exercises?.[0]?.name || ''; if (p._techPlaying) { stopTech(); startTech(); } else refresh(); });
    bodyEl.querySelectorAll('.tech-ex').forEach(b => b.onclick = e => { e.stopPropagation(); exName = b.dataset.te; if (p._techPlaying) { stopTech(); startTech(); } else refresh(); });
    bodyEl.querySelectorAll('.tech-str').forEach(b => b.onclick = e => { e.stopPropagation(); stringOffset = parseInt(b.dataset.ts); if (p._techPlaying) { stopTech(); startTech(); } else refresh(); });
    bodyEl.querySelector('.tech-play').onclick = e => { e.stopPropagation(); if (p._techPlaying) stopTech(); else startTech(); };
    Object.assign(s, { techCat, techEx: exName, techString: stringOffset });
  }
  return { renderBody, start: startTech, stop: stopTech, onAudio() {}, onClock, onKey() {}, isRunning: () => !!p._techPlaying, getAccent: () => '#ff7744' };
}

// ── Placeholder tab (until ported) ───────────────────────────────────
function createPlaceholderTab(label) {
  return {
    renderBody(bodyEl) {
      bodyEl.innerHTML = `<div class="mono" style="color:#666;font-size:10px;text-align:center;padding:28px 12px;line-height:1.7">🚧 <b style="color:#999">${label}</b><br><span style="font-size:8px;color:#555">Porting into the Workshop in the next build pass.<br>The standalone pedal still works in the meantime.</span></div>`;
    },
    start() {}, stop() {}, onAudio() {}, onClock() {}, onKey() {},
    isRunning: () => false, getAccent: () => null,
  };
}

// ════════════════════════════════════════════════════════════════════
//  Shell
// ════════════════════════════════════════════════════════════════════
export function buildWorkshopContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  let activeTab = s.ws_tab || INITIAL_TAB[p.type] || 'positions';
  if (!TAB_META[activeTab]) activeTab = 'positions';

  const tabs = {
    positions: createPositionsTab(p, () => render()),
    groove:    createGrooveTab(p, () => render()),
    finger:    createFingerTab(p, () => render()),
    technique: createTechniqueTab(p, () => render()),
  };

  // ONE dispatch object kept current each build; the once-bound subscriptions read it.
  p._wsDispatch = {
    onClock: c => tabs[activeTab].onClock?.(c),
    onKey:   e => tabs[activeTab].onKey?.(e),
    onAudio: () => tabs[activeTab].onAudio?.(),
    stop:    () => tabs[activeTab].stop?.(),
  };
  const alive = () => !!document.getElementById(`body-${p.id}`);
  if (!p._wsBound) {
    p._wsBound = true;
    metroClock.on(c => { if (alive()) p._wsDispatch.onClock(c); });
    pedalBus.on(e => { if (alive()) p._wsDispatch.onKey(e); });
    audio.on(() => { if (alive()) p._wsDispatch.onAudio(); });
  }
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => p._wsDispatch.stop());

  function switchTab(t) {
    if (t === activeTab) return;
    tabs[activeTab].stop?.();
    clearChordHighlight(); updateOverlays();
    activeTab = t; s.ws_tab = t;
    render();
  }

  function render() {
    const meta   = TAB_META[activeTab];
    const accent = tabs[activeTab].getAccent?.() || meta.accent;
    const useBpm = metroClock.bpm || 100;
    let h = `<div class="rk rk-workshop" style="--rk-accent:${accent}">`;
    h += `<div class="rk-seg" style="gap:4px">`;
    Object.entries(TAB_META).forEach(([k, m]) => {
      h += `<button class="rk-seg-btn ws-tab${k === activeTab ? ' is-active' : ''}" data-tab="${k}" style="flex:1;font-size:8.5px;padding:6px 2px">${m.label}</button>`;
    });
    h += `</div>`;
    h += `<div style="font-size:9.5px;line-height:1.45;color:#c8c8c8;background:${accent}1e;border-left:2px solid ${accent};padding:6px 8px;border-radius:4px">${meta.blurb}</div>`;
    h += `<div class="rk-readoutrow" style="gap:10px">
        <div class="rk-readout">
          <div class="rk-readout-num" style="font-size:15px">${meta.label}${tabs[activeTab].isRunning?.() ? ' <span style="color:#ff6666;font-size:9px">● LIVE</span>' : ''}</div>
          <div class="rk-readout-sub">${useBpm} BPM · from metronome</div>
        </div>
      </div>`;
    h += `<div id="ws-body-${p.id}"></div>`;
    h += theoryPanelHTML('workshop', THEORY[activeTab]);
    h += `</div>`;
    el.innerHTML = h;

    const bodyEl = el.querySelector(`#ws-body-${p.id}`);
    tabs[activeTab].renderBody(bodyEl);
    el.querySelectorAll('.ws-tab').forEach(b => b.onclick = e => { e.stopPropagation(); switchTab(b.dataset.tab); });
    wireTheoryPanel(el);
  }

  render();

  // Unified auto-start (Practice Manager / Song Directory deep-links, set in a later pass)
  if (s._autoStartTab) { if (TAB_META[s._autoStartTab]) { activeTab = s._autoStartTab; s.ws_tab = activeTab; } delete s._autoStartTab; render(); }
  if (s._autoStart) { delete s._autoStart; tabs[activeTab].start?.(); }
}
