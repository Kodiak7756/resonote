import { NOTES, toSharp, CHORD_TYPES, KEY_PATTERNS, SCALE_TYPES, intervalLabel, getChordNotes, getKeyChords, getScaleNotes } from '../core/music-theory.js';
import { INSTRUMENTS, currentInstrument, customTuning, getInst, getNoteAtFret } from '../core/tuning.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus, metroClock } from '../core/state.js';
import { playClickedNote } from '../core/audio.js';
import { updateOverlays } from '../ui/fretboard.js';
import { findVoicings, renderMiniDiagram, getKeyPositionZones, assignFingers, pickGrip } from '../core/voicings.js';
import { catOfType, qualSuffix, getKeySeventhChords, getBorrowedChords, getSecondaryDominants } from '../harmony/functional-harmony.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { encodeMidi, downloadMidi, midiFilename, stringFretToMidi, PPQ } from '../core/midi-writer.js';
import { bus } from '../core/mixer.js';

// ── Progression presets (degrees into the diatonic 7) ────────────────
export const PROG_PRESETS = [
  { name: 'I-IV-V-I',       degrees: [0, 3, 4, 0] },
  { name: 'I-V-vi-IV',      degrees: [0, 4, 5, 3] },
  { name: 'ii-V-I',         degrees: [1, 4, 0] },
  { name: 'I-vi-IV-V',      degrees: [0, 5, 3, 4] },
  { name: 'I-IV-vi-V',      degrees: [0, 3, 5, 4] },
  { name: '12-Bar Blues',   degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4] },
  { name: 'vi-IV-I-V',      degrees: [5, 3, 0, 4] },
  { name: 'I-III-IV-iv',    degrees: [0, 2, 3, 3] },
  { name: 'I-V-vi-III-IV',  degrees: [0, 4, 5, 2, 3] },
];

// Fretboard overlay palette — the neck's language, not the panel's. Chrome in
// this file inherits the card's accent; these four stay literal so a chord lit
// from the Progression Studio looks the same as one lit from anywhere else.
export const PROG_COLORS = {
  root:        '#ef9f27',
  tone:        '#a06a10',
  rootStroke:  '#ffc044',
  toneStroke:  '#cc8822',
};

const KEY_TYPES = ['Major', 'Minor', 'Dorian', 'Harm. Minor'].filter(k => KEY_PATTERNS[k]);

// Quality switch — re-skins the seven function buttons in place.
const QUALITY_MODES = ['TRIAD', '7th', 'SUS', 'ADD9', '9·11·13', 'ALT'];
function subOptionsFor(mode) {
  if (mode === 'SUS')     return [['Sus2', 'sus2'], ['Sus4', 'sus4']];
  if (mode === 'ALT')     return [['7♭9', '♭9'], ['7♯9', '♯9'], ['7♭5', '♭5'], ['7♯5', '♯5'], ['7♯11', '♯11'], ['7♭13', '♭13']];
  if (mode === '9·11·13') return [['9', '9'], ['11', '11'], ['13', '13']];
  return [];
}
// Map a degree's base triad quality + the active mode to a CHORD_TYPES type name.
function resolveQuality(base, mode, subAlt, isDom) {
  switch (mode) {
    case 'SUS':     return subAlt === 'Sus2' ? 'Sus2' : 'Sus4';
    case '7th':     return isDom ? '7 (Dom)' : ({ Major: 'Maj7', Minor: 'Min7', Dim: 'm7♭5', Aug: 'Aug7' }[base] || 'Maj7');
    case 'ADD9':    return isDom ? '9'        : ({ Major: 'Add9', Minor: 'Min9', Dim: 'm7♭5', Aug: 'Add9' }[base] || 'Add9');
    case '9·11·13': return isDom ? (subAlt || '13') : ({ Major: 'Maj9', Minor: 'Min9', Dim: 'm7♭5', Aug: 'Maj9' }[base] || 'Maj9');
    case 'ALT':     return subAlt || '7♯9';
    default:        return base; // TRIAD
  }
}

// Nicer display suffixes for the extended/altered types qualSuffix doesn't cover.
const EXT_SUFFIX = {
  Add9: 'add9', '9': '9', Min9: 'm9', Maj9: 'maj9', '6': '6', Min6: 'm6',
  '11': '11', Min11: 'm11', '13': '13', Maj13: 'maj13',
  '7♭5': '7♭5', '7♯5': '7♯5', '7♭9': '7♭9', '7♯9': '7♯9', '7♯11': '7♯11', '7♭13': '7♭13',
};
const sfx = q => EXT_SUFFIX[q] ?? qualSuffix(q);

// Roman numerals by semitone above the key root (for out-of-key labels).
const ROMAN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];
// Likely next-degree successors (degree index 0..6) — drives Smart Next ranking.
const DEG_NEXT = { 0: [3, 4, 5, 1], 1: [4, 6, 3], 2: [5, 3], 3: [4, 1, 0, 6], 4: [0, 5, 3], 5: [1, 3, 4], 6: [0, 2] };

const PROG_THEORY = {
  kicker: 'HARMONY',
  title: 'Thinking in numbers: function, not letters',
  what: `Every chord has a <b>job</b> in the key. The seven buttons are the diatonic functions: <b>I</b> is home, <b>IV</b> and <b>V</b> are the pillars that pull you away and back, <b>vi</b> is the relative-minor shadow, <b>ii</b> sets up <b>V</b>. Because they're numbered by function, the same I–IV–V works in <i>every</i> key — only the root changes. Tap a number to arm it, then tap a bar to drop it.`,
  why: `Some moves feel inevitable because of <b>voice-leading</b> — shared and half-step notes pull one chord into the next. That's what the <b>Fits here</b> list ranks: the chords most likely to sound right at the selected slot, each with a one-line reason. The <b>Color</b> drawer adds spice — <b>borrowed</b> chords (minor <b>iv</b>, <b>♭VII</b>) steal a mood from the parallel minor, and <b>secondary dominants</b> (<b>V7/V</b>) briefly point at a chord to make its arrival feel earned. Flip the <b>quality</b> switch to hear those functions as 7ths, sus, add9, tall 9·11·13 voicings, or altered dominants.`,
  lessonId: 'three-functions',
};

// ── Main builder ─────────────────────────────────────────────────────
export function buildProgressionContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  let root         = s.root         || 'C';
  let keyType      = KEY_PATTERNS[s.keyType] ? s.keyType : 'Major';
  let barsPerChord = s.barsPerChord || 2;        // legacy (preset-payload shim only)
  let progName     = s.progName     || 'I-IV-V-I';
  let progMode     = 'custom';                    // unified — everything lives in customGrid now
  let positionZone = s.positionZone || 'Open Position';
  let gridBars     = s.gridBars     || 4;
  let pendingAppend = s._appendChord || null;
  if (s._appendChord) delete s._appendChord;

  let beatsPerBar = Math.max(1, Math.min(32, metroClock.ts || 4));

  const hadGrid = Array.isArray(s.customGrid) && s.customGrid.some(x => x);
  // Array of length gridBars * beatsPerBar — each entry null (sustain) or {root, quality, numeral}
  let customGrid = s.customGrid || null;

  // New picker state
  let qualityMode  = QUALITY_MODES.includes(s.qualityMode) ? s.qualityMode : 'TRIAD';
  let subAlt       = s.subAlt || null;
  let armedChord   = null;                         // {root,quality,numeral} brush, or null
  let selectedBeat = null;                         // grid index whose Smart-Next panel is open
  let numLabelMode = s.numLabelMode === 'NAMES' ? 'NAMES' : 'NUM';
  let showColor    = false;
  let showTier3    = false;

  let drillMode    = s.drillMode || false;
  let drillScore   = { changes: 0, onTime: 0 };
  let lastChangeTime = 0;

  // Clean up any existing timer from a previous build
  if (p._progIntv)    { clearInterval(p._progIntv); p._progIntv = null; }
  if (p._progPlaying) { p._progPlaying = false; }
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._progPlaying) stopPlaying(); });

  let step = 0, beat = 0, pCtx = null;
  let slavePulse = -1;
  let slaveBeats = 0;

  // ── Grid bookkeeping (kept verbatim) ─────────────────────────────────
  function syncBeatsPerBar() {
    const nextBeatsPerBar = Math.max(1, Math.min(32, metroClock.ts || 4));
    if (nextBeatsPerBar !== beatsPerBar) {
      beatsPerBar = nextBeatsPerBar;
      selectedBeat = null;
      beat = 0;
    }
    resizeCustomGrid();
  }

  function resizeCustomGrid() {
    if (customGrid && customGrid.length === gridBars * beatsPerBar) return;
    const oldGrid      = Array.isArray(customGrid) ? customGrid : [];
    const prevBeatsPerBar = Math.max(1, Math.round(oldGrid.length / Math.max(1, gridBars))) || 4;
    const resized      = new Array(gridBars * beatsPerBar).fill(null);
    for (let bar = 0; bar < gridBars; bar++) {
      for (let b = 0; b < Math.min(prevBeatsPerBar, beatsPerBar); b++) {
        const oldIdx = bar * prevBeatsPerBar + b;
        const newIdx = bar * beatsPerBar + b;
        if (oldIdx < oldGrid.length && newIdx < resized.length) resized[newIdx] = oldGrid[oldIdx];
      }
    }
    customGrid = resized;
  }
  resizeCustomGrid();
  let lastClockConfig = metroClock.getConfigSignature();

  // ── Cross-pedal root/key broadcasts (opt-in) ─────────────────────────
  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    root = ev.root;
    if (ev.keyType && KEY_PATTERNS[ev.keyType]) keyType = ev.keyType;
    positionZone = getActiveZone()?.label || getProgressionZones()[0]?.label || positionZone;
    render();
  });

  // ── Metronome sync + unified slave-mode stepping ─────────────────────
  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;

    const nextConfig = clock.getConfigSignature();
    if (metroClock.follows(p.type) && nextConfig !== lastClockConfig) {
      lastClockConfig = nextConfig;
      syncBeatsPerBar();
      if (p._progPlaying) { stopPlaying(); startPlaying(); }
      else render();
      return;
    }

    // Slave mode: metronome pedal owns the clock → advance one grid beat per pulse.
    if (clock.masterSource === 'metronome' && p._progPlaying) {
      if (p._progIntv) { clearInterval(p._progIntv); p._progIntv = null; }
      if (clock.pulse === slavePulse) return;
      slavePulse = clock.pulse;
      const totalBeats = Math.max(1, gridBars * beatsPerBar);
      slaveBeats = (slaveBeats + 1) % totalBeats;
      beat = slaveBeats;
      if (customGrid[beat]) {
        const ch = getGridChordAt(beat);
        if (ch) { highlightChord(ch); if (drillMode) drillScore.changes++; }
      }
      updateLiveDisplay();
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────
  function getPresetDegrees() {
    const pr = PROG_PRESETS.find(x => x.name === progName);
    return pr ? pr.degrees : [0, 3, 4, 0];
  }

  function seedCustomGridFromPreset() {
    const chords = getKeyChords(root, keyType);
    const degs = getPresetDegrees();
    gridBars = Math.max(4, degs.length);
    customGrid = new Array(gridBars * beatsPerBar).fill(null);
    degs.forEach((di, bar) => {
      if (di >= chords.length) return;
      const ch = chords[di];
      customGrid[bar * beatsPerBar] = { root: ch.root, quality: ch.quality, numeral: ch.numeral };
    });
    selectedBeat = null;
  }

  function appendChordToCustomGrid(ch) {
    if (!ch) return;
    resizeCustomGrid();
    let barIdx = -1;
    for (let bar = 0; bar < gridBars; bar++) {
      if (!customGrid[bar * beatsPerBar]) { barIdx = bar; break; }
    }
    if (barIdx < 0) {
      const old = customGrid;
      gridBars += 1;
      customGrid = new Array(gridBars * beatsPerBar).fill(null);
      old.forEach((item, i) => { customGrid[i] = item; });
      barIdx = gridBars - 1;
    }
    customGrid[barIdx * beatsPerBar] = { root: ch.root, quality: ch.quality, numeral: ch.numeral || '' };
    selectedBeat = null;
  }

  if (pendingAppend) { appendChordToCustomGrid(pendingAppend); pendingAppend = null; }
  // Legacy-payload shim / first run: nothing in the grid → seed the default preset so it isn't blank.
  if (!hadGrid && !customGrid.some(x => x)) seedCustomGridFromPreset();

  function getProgressionZones() {
    return getKeyPositionZones(root, keyType, getKeyChords(root, keyType))
      .zones.filter(z => z.chords && z.chords.length);
  }
  function getActiveZone() {
    const zones = getProgressionZones();
    return zones.find(z => z.label === positionZone) || zones[0] || null;
  }
  function applyZoneToChord(chInfo) {
    if (!chInfo) return null;
    const zone = getActiveZone();
    if (!zone) return chInfo;
    const match =
      zone.chords.find(zc => zc.numeral === chInfo.numeral) ||
      zone.chords.find(zc => zc.root === chInfo.root && zc.quality === chInfo.quality);
    return match ? { ...chInfo, positions: match.positions, zoneLabel: zone.label } : chInfo;
  }

  // ── Metronome click (standalone driver only) ─────────────────────────
  function tick(accent, beatIdx = 0) {
    if (metroClock.masterSource === 'metronome') return;
    try {
      const beatType = metroClock.pattern?.[beatIdx % Math.max(1, metroClock.pattern.length)] || (accent ? 'accent' : 'regular');
      if (beatType === 'rest') return;
      if (!pCtx) pCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = pCtx, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = beatType === 'ghost' ? 'triangle' : beatType === 'alternate' ? 'square' : 'sine';
      osc.frequency.value = beatType === 'alternate' ? 760 : accent || beatType === 'accent' ? 900 : beatType === 'ghost' ? 500 : 600;
      gain.gain.value = beatType === 'ghost' ? 0.07 : accent || beatType === 'accent' ? 0.3 : 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(gain); gain.connect(bus(ctx, 'notes'));
      osc.start(); osc.stop(ctx.currentTime + 0.06);
    } catch (e) {}
  }
  function getSharedBeatType(beatIdx) {
    return metroClock.pattern?.[beatIdx % Math.max(1, metroClock.pattern.length)] || (beatIdx === 0 ? 'accent' : 'regular');
  }
  function pulseSharedClock(beatIdx) {
    const idx = beatIdx % Math.max(1, beatsPerBar);
    metroClock.playing = true;
    metroClock.setBeat(idx, getSharedBeatType(idx));
  }

  // ── Chord highlighting (P0a: real note set for every quality) ────────
  function highlightChord(chInfo) {
    if (!chInfo) return;
    chInfo = applyZoneToChord(chInfo) || chInfo;
    const formula = CHORD_TYPES[catOfType(chInfo.quality)]?.[chInfo.quality] || [0, 4, 7];
    const notes   = getChordNotes(chInfo.root, formula);
    const zoneTxt = chInfo.zoneLabel ? ` · ${chInfo.zoneLabel}` : '';
    const label   = chInfo.numeral
      ? `${chInfo.numeral} — ${chInfo.root}${sfx(chInfo.quality)}${zoneTxt}`
      : `${chInfo.root}${sfx(chInfo.quality)}${zoneTxt}`;
    // Always show ONE fingered grip: the active zone's voicing (fingered), else an open grip.
    const grip = chInfo.positions ? assignFingers(chInfo.positions)
      : (pickGrip(chInfo.root, notes, chInfo.quality, 'open')?.positions || null);
    setChordHighlight(chInfo.root, notes, label, grip, PROG_COLORS);
    updateOverlays();
  }

  // Walk back to the active (sounding) chord at beat index bi.
  function getGridChordAt(bi) {
    for (let i = bi; i >= 0; i--) if (customGrid[i]) return customGrid[i];
    return null;
  }

  // ── REAPER Bridge: export the painted grid as MIDI ───────────────────
  function chordIntervalsFor(quality) {
    for (const group of Object.values(CHORD_TYPES)) if (group[quality]) return group[quality];
    return [0, 4, 7];
  }

  function exportProgressionMidi() {
    const style = s.midiStyle || 'guitar';
    const total = gridBars * beatsPerBar;
    const beatTick = PPQ * 4 / (metroClock.unit || 4);   // one grid beat, honoring /8 time sigs
    const spans = [];
    for (let i = 0; i < total; i++) {
      if (!customGrid[i]) continue;
      let end = total;
      for (let j = i + 1; j < total; j++) if (customGrid[j]) { end = j; break; }
      spans.push({ cell: customGrid[i], start: i, beats: end - i });
    }
    const msgEl = el.querySelector('.prog-export-msg');
    if (!spans.length) {
      if (msgEl) { msgEl.textContent = 'Nothing to export — paint chords into the bars first'; msgEl.style.color = 'var(--rk-bad)'; }
      return;
    }
    const notes = [];
    for (const sp of spans) {
      const chRoot = toSharp(sp.cell.root);
      const iv = chordIntervalsFor(sp.cell.quality);
      const startTick = sp.start * beatTick;
      const durTick = sp.beats * beatTick;
      const base = 48 + NOTES.indexOf(chRoot);           // chord root near C3 — guitar territory

      if (style === 'guitar') {
        const chNotes = getChordNotes(chRoot, iv);
        const grip = pickGrip(chRoot, chNotes, sp.cell.quality, 'open');
        if (grip?.positions?.length) {
          const sorted = [...grip.positions].sort((a, b) => b.si - a.si);  // low string first
          sorted.forEach((pos, k) => {
            const m = stringFretToMidi(pos.si, pos.fret, customTuning);
            if (m != null) notes.push({ tick: startTick + k * 12, note: m, vel: k === 0 ? 104 : 92, dur: Math.max(60, durTick - k * 12 - 12) });
          });
          continue;                                       // voiced — next chord
        }                                                 // no grip found → fall through to block
      }
      if (style === 'arp') {
        const tones = iv.map(x => base + x);
        const seq = tones.length > 2 ? [...tones, ...tones.slice(1, -1).reverse()] : tones;
        const eighth = beatTick / 2;
        const count = Math.floor(durTick / eighth);
        for (let k = 0; k < count; k++) {
          notes.push({ tick: startTick + k * eighth, note: seq[k % seq.length], vel: k % 2 ? 84 : 98, dur: eighth - 15 });
        }
        continue;
      }
      // block chords (also the guitar fallback): tones + a low root for body
      iv.forEach(x => notes.push({ tick: startTick, note: base + x, vel: 96, dur: durTick - 15 }));
      notes.push({ tick: startTick, note: base - 12, vel: 86, dur: durTick - 15 });
    }
    const bpm = metroClock.bpm || 120;
    const bytes = encodeMidi({
      bpm,
      timeSig: [beatsPerBar, metroClock.unit || 4],
      trackName: `Resonote ${root} ${keyType} — ${progName || 'progression'}`,
      notes,
      endTick: total * beatTick,
    });
    downloadMidi(bytes, midiFilename(`prog-${root}-${keyType}-${style}-${bpm}bpm`));
    if (msgEl) {
      msgEl.style.color = 'var(--rk-accent)';
      msgEl.textContent = `Exported ${spans.length} chords @ ${bpm} BPM (${beatsPerBar}/${metroClock.unit || 4}) — run Resonote Import in REAPER`;
      setTimeout(() => { if (msgEl.isConnected) msgEl.textContent = ''; }, 4000);
    }
  }

  // ── Picker helpers ───────────────────────────────────────────────────
  function diatonicDominantDegrees() {
    return getKeySeventhChords(root, keyType)
      .reduce((acc, c, i) => (c.quality === '7 (Dom)' ? [...acc, i] : acc), []);
  }
  function degreeOf(rootNote) {
    return getKeyChords(root, keyType).findIndex(c => c.root === rootNote);
  }
  function deriveNumeral(rootNote, quality) {
    const hit = getKeyChords(root, keyType).find(c => c.root === rootNote);
    if (hit && hit.quality === quality) return hit.numeral;
    const semi = (NOTES.indexOf(rootNote) - NOTES.indexOf(root) + 12) % 12;
    let rn = ROMAN[semi] || '?';
    if (/Min|^m7|m7♭5|Dim/.test(quality)) rn = rn.toLowerCase();
    if (/Dim|m7♭5/.test(quality)) rn += '°';
    return rn;
  }
  function writeBeat(bi, ch) {
    customGrid[bi] = ch
      ? { root: ch.root, quality: ch.quality, numeral: ch.numeral || deriveNumeral(ch.root, ch.quality) }
      : null;
  }
  function nextEmptyFrom(start) {
    for (let i = start; i < customGrid.length; i++) if (!customGrid[i]) return i;
    return null;
  }
  // Rank the seven diatonic chords for the slot at bi, with a one-line reason.
  function rankSmartNext(bi) {
    const dia = getKeyChords(root, keyType);
    let prevCh = null; for (let i = bi - 1; i >= 0; i--) if (customGrid[i]) { prevCh = customGrid[i]; break; }
    let nextCh = null; for (let i = bi + 1; i < customGrid.length; i++) if (customGrid[i]) { nextCh = customGrid[i]; break; }
    const prevDeg = prevCh ? degreeOf(prevCh.root) : -1;
    const nextDeg = nextCh ? degreeOf(nextCh.root) : -1;
    const succ = prevDeg >= 0 ? (DEG_NEXT[prevDeg] || []) : [0, 3, 4, 5];
    return dia.map((c, di) => {
      let score = 0, why = '';
      const pos = succ.indexOf(di);
      if (pos >= 0) { score += 30 - pos * 5; why = prevCh ? `a natural move after ${prevCh.numeral}` : 'a strong place to begin'; }
      if (nextDeg >= 0 && (DEG_NEXT[di] || []).includes(nextDeg)) { score += 15; why = why ? `${why}, and sets up ${nextCh.numeral}` : `leads into ${nextCh.numeral}`; }
      if (di === 0) { score += 6; if (!why) why = 'home — the resolution'; }
      if (di === 4) { score += 4; if (!why) why = 'the dominant — pulls back to I'; }
      if (!why) why = `${c.numeral} — diatonic in the key`;
      return { ...c, score, why };
    }).sort((a, b) => b.score - a.score);
  }
  function arm(ch) {
    const same = armedChord && armedChord.root === ch.root && armedChord.quality === ch.quality && armedChord.numeral === ch.numeral;
    armedChord = same ? null : { root: ch.root, quality: ch.quality, numeral: ch.numeral };
    selectedBeat = null;
    if (armedChord) highlightChord(armedChord);
    render();
  }

  // ── Playback (unified custom-grid engine) ────────────────────────────
  function startPlaying() {
    metroClock.stopOthers(p.id);
    if (metroClock.masterSource === 'metronome') metroClock.masterSource = 'progression';
    if (p._progPlaying) clearInterval(p._progIntv);
    p._progPlaying = true;
    beat = 0; step = 0; slaveBeats = 0;
    slavePulse = metroClock.pulse;
    drillScore = { changes: 0, onTime: 0 };
    lastChangeTime = Date.now();

    const ch0 = getGridChordAt(0);
    if (ch0) highlightChord(ch0);

    // Slave mode — chord advances arrive from metroClock.on
    if (metroClock.masterSource === 'metronome') { p._progIntv = null; render(); return; }

    // Standalone — drive our own clock
    const useBpm = metroClock.bpm || 100;
    pulseSharedClock(0); tick(true, 0);
    const totalBeats = gridBars * beatsPerBar;
    beat = 1; render();
    p._progIntv = setInterval(() => {
      if (beat >= totalBeats) beat = 0;
      const beatIdx = beat % beatsPerBar;
      pulseSharedClock(beatIdx);
      tick(beatIdx === 0, beatIdx);
      const ch = getGridChordAt(beat);
      if (ch && customGrid[beat]) { highlightChord(ch); if (drillMode) drillScore.changes++; }
      updateLiveDisplay();
      beat++;
    }, 60000 / useBpm);
  }

  function stopPlaying() {
    p._progPlaying = false;
    clearInterval(p._progIntv);
    p._progIntv = null;
    beat = 0; step = 0; slaveBeats = 0; slavePulse = -1;
    if (metroClock.masterSource !== 'metronome') {
      metroClock.playing = false;
      metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    }
    clearChordHighlight();
    updateOverlays();
    render();
  }

  // ── Live playhead update (no full re-render) ─────────────────────────
  function updateLiveDisplay() {
    const cells = document.querySelectorAll(`#body-${p.id} .grid-cell`);
    cells.forEach((cell, i) => {
      const isCur = p._progPlaying && i === beat;
      // The playhead is the pedal RUNNING, so it wears --rk-hot; the grid's own
      // selected/current borders are built in render() and left alone here.
      cell.style.outline       = isCur ? '2px solid var(--rk-hot)' : 'none';
      cell.style.outlineOffset = isCur ? '-2px' : '0';
    });
    const sounding = getGridChordAt(beat);
    const ro = document.querySelector(`#body-${p.id} .prog-readout-main`);
    const sub = document.querySelector(`#body-${p.id} .prog-readout-sub`);
    if (p._progPlaying && ro && sounding) {
      ro.textContent = `${sounding.numeral} — ${sounding.root}${sfx(sounding.quality)}`;
      if (sub) sub.textContent = `BAR ${Math.floor(beat / beatsPerBar) + 1} · BEAT ${(beat % beatsPerBar) + 1} · ${metroClock.bpm || 100} BPM · ${beatsPerBar}/${metroClock.unit || 4}`;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  function render() {
    syncBeatsPerBar();
    const dia       = getKeyChords(root, keyType);
    const sevenths  = getKeySeventhChords(root, keyType);
    const domDegs   = diatonicDominantDegrees();
    const useBpm    = metroClock.bpm || 100;
    const progZones = getProgressionZones();
    const activeZone = getActiveZone() || progZones[0] || null;
    const subs      = subOptionsFor(qualityMode);

    // readout text
    let roMain, roSub;
    if (armedChord) {
      roMain = `PLACING ${armedChord.numeral}`;
      roSub  = `${armedChord.root}${sfx(armedChord.quality)} — tap a bar to drop it · tap again to disarm`;
    } else if (selectedBeat !== null) {
      roMain = `BAR ${Math.floor(selectedBeat / beatsPerBar) + 1} · BEAT ${(selectedBeat % beatsPerBar) + 1} SELECTED`;
      roSub  = `pick from “Fits here” below, or arm a chord to paint`;
    } else {
      const c0 = getGridChordAt(0);
      roMain = c0 ? `${c0.numeral} — ${c0.root}${sfx(c0.quality)}` : '—';
      roSub  = `${useBpm} BPM · ${beatsPerBar}/${metroClock.unit || 4} · from metronome`;
    }

    // The accent arrives from the card; naming one here is what used to make
    // this pedal orange no matter what the catalog said.
    let h = `<div class="rk rk-prog">`;

    // Top blurb (Chord-Family-Lab style)
    h += `<div style="font-size:calc(9.5px*var(--ui));line-height:1.45;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid var(--rk-accent);padding:6px 8px;border-radius:4px">Build a progression by <b>function</b>: arm a chord from the FUNCTION row (or the COLOR drawer), then tap bars to drop it. Tap an empty slot and <b>✦ Fits here</b> ranks what sounds good there next.</div>`;

    // ── KEY & MODE header ──
    h += `<div class="rk-section">
      <div class="rk-label">KEY
        <span style="flex:1"></span>
        <button style="min-height:calc(28px*var(--ui))" class="rk-chip numlabel-toggle" title="Show numbers or letter names first">${numLabelMode === 'NUM' ? '♯ NUM' : 'A NAMES'}</button>
      </div>
      <div class="rk-seg" style="gap:3px">`;
    NOTES.forEach(n => {
      h += `<button class="rk-seg-btn prog-root${n === root ? ' is-active' : ''}" data-r="${n}" style="min-height:calc(28px*var(--ui));min-width:26px;padding:5px 0">${n}</button>`;
    });
    h += `</div><div class="rk-seg" style="margin-top:5px">`;
    KEY_TYPES.forEach(kt => {
      h += `<button class="rk-seg-btn prog-kt${kt === keyType ? ' is-active' : ''}" data-kt="${kt}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">${kt}</button>`;
    });
    h += `</div></div>`;

    // ── Readout + transport ──
    // The transport flips to ◼ while it runs, and at that moment it is the halt
    // control — so it takes the app's one stop red, like every other halt. It has
    // to be spelled out inline: .rk-play.is-playing paints from --rk-hot, which
    // .rk resolved from the card's accent further up the tree, so re-pointing the
    // accent on the button itself would never reach it. The pulse stays hot —
    // that is the pedal reporting it is live, which is a different message.
    const stopSkin = p._progPlaying
      ? 'background:var(--rk-stop-soft);border-color:var(--rk-stop-edge);color:var(--rk-stop)'
      : '';
    h += `<div class="rk-readoutrow">
      <button class="rk-play prog-play${p._progPlaying ? ' is-playing' : ''}" style="min-height:calc(28px*var(--ui));${stopSkin}" title="${p._progPlaying ? 'Stop' : 'Play the progression'}">${p._progPlaying ? '◼' : '▶'}</button>
      <div class="rk-readout">
        <div class="rk-readout-num prog-readout-main" style="font-size:calc(18px*var(--ui))">${roMain}</div>
        <div class="rk-readout-sub prog-readout-sub">${roSub}</div>
      </div>
      ${armedChord ? `<button class="rk-chip disarm-btn" style="min-height:calc(28px*var(--ui));align-self:center">DONE</button>` : ''}
    </div>`;

    // ── QUALITY switch ──
    h += `<div class="rk-section">
      <div class="rk-label">QUALITY</div>
      <div class="rk-seg">`;
    QUALITY_MODES.forEach(qm => {
      h += `<button class="rk-seg-btn qual-btn${qm === qualityMode ? ' is-active' : ''}" data-qm="${qm}" style="min-height:calc(28px*var(--ui));flex:1;min-width:34px;font-size:calc(10px*var(--ui));padding:5px 2px">${qm}</button>`;
    });
    h += `</div>`;
    if (subs.length) {
      h += `<div class="rk-seg" style="margin-top:4px">`;
      subs.forEach(([val, lab]) => {
        const on = subAlt === val || (!subAlt && val === subs[0][0]);
        h += `<button class="rk-seg-btn sub-pill${on ? ' is-active' : ''}" data-sub="${val}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:4px 8px">${lab}</button>`;
      });
      h += `</div>`;
    }
    h += `</div>`;

    // ── FUNCTION bar (centerpiece) ──
    h += `<div class="rk-section">
      <div class="rk-label">FUNCTION <span class="rk-label-hint">· tap to arm, then paint a bar</span></div>
      <div class="rk-seg" style="gap:4px">`;
    dia.forEach((c, i) => {
      const isDom = domDegs.includes(i);
      // 7th mode: use the key's own diatonic-7th template (handles mMaj7 i, AugMaj7 III+,
      // Dim7 vii° in harmonic minor) instead of the triad-base map, which loses key context.
      const q = qualityMode === '7th'
        ? (sevenths[i]?.quality || resolveQuality(c.quality, qualityMode, subAlt, isDom))
        : resolveQuality(c.quality, qualityMode, subAlt, isDom);
      const numLabel  = qualityMode === 'TRIAD' ? c.numeral : `${c.numeral}`;
      const nameLabel = `${c.root}${sfx(q)}`;
      const armed = armedChord && armedChord.root === c.root && armedChord.quality === q && armedChord.numeral === c.numeral;
      const primary   = numLabelMode === 'NUM' ? numLabel : nameLabel;
      const secondary = numLabelMode === 'NUM' ? nameLabel : numLabel;
      h += `<button class="rk-seg-btn fn-btn${armed ? ' is-active' : ''}" data-root="${c.root}" data-q="${q}" data-num="${c.numeral}" style="min-height:calc(28px*var(--ui));flex:1;min-width:40px;gap:1px;padding:6px 2px">
        <span style="font-size:calc(13px*var(--ui));font-weight:800;line-height:1">${primary}</span>
        <span style="font-size:calc(7.5px*var(--ui));opacity:.65;line-height:1">${secondary}</span>
      </button>`;
    });
    h += `</div>`;
    // COLOR drawer (borrowed + secondary dominants)
    h += `<button class="rk-chip color-toggle${showColor ? ' is-active' : ''}" style="min-height:calc(28px*var(--ui));align-self:flex-start;margin-top:5px">${showColor ? '▾' : '▸'} COLOR · borrowed & secondary</button>`;
    if (showColor) {
      const borrowed = getBorrowedChords(root, keyType);
      const secondary = getSecondaryDominants(root, keyType);
      const chipRow = (label, list) => {
        let r = `<div class="rk-label" style="margin-top:6px">${label}</div><div class="rk-seg" style="gap:4px">`;
        list.forEach(c => {
          const armed = armedChord && armedChord.root === c.root && armedChord.quality === c.quality && armedChord.numeral === c.numeral;
          r += `<button style="min-height:calc(28px*var(--ui))" class="rk-chip color-chip${armed ? ' is-active' : ''}" data-root="${c.root}" data-q="${c.quality}" data-num="${c.numeral}" title="${(c.why || '').replace(/"/g, '&quot;')}">${c.numeral} <span style="opacity:.6">${c.root}${sfx(c.quality)}</span></button>`;
        });
        return r + `</div>`;
      };
      h += `<div style="margin-top:2px">${chipRow('BORROWED', borrowed)}${chipRow('SECONDARY DOMINANTS', secondary)}</div>`;
    }
    h += `</div>`;

    // ── TIMELINE grid ──
    h += `<div class="rk-section">
      <div class="rk-label">TIMELINE
        <span style="flex:1"></span>
        <span class="rk-label-hint">tap = ${armedChord ? 'paint' : 'select'} · right-click = clear</span>
      </div>
      <div style="background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:8px;padding:6px;overflow-y:auto;max-height:190px">`;
    for (let bar = 0; bar < gridBars; bar++) {
      h += `<div style="display:flex;gap:3px;margin-bottom:3px;align-items:center">`;
      h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));min-width:14px;text-align:right">${bar + 1}</span>`;
      for (let b = 0; b < beatsPerBar; b++) {
        const bi     = bar * beatsPerBar + b;
        const ch     = customGrid[bi];
        const active = getGridChordAt(bi);
        const isCur  = p._progPlaying && bi === beat;
        const isSel  = selectedBeat === bi;
        const label  = ch ? `${numLabelMode === 'NUM' ? ch.numeral : ch.root + sfx(ch.quality)}` : '';
        const sustain = !ch && active ? '╌' : '·';
        const bg     = isSel ? 'var(--rk-soft2)' : isCur ? 'var(--rk-soft2)' : ch ? 'var(--rk-soft)' : 'var(--rk-panel)';
        const border = isSel ? 'var(--rk-accent)' : isCur ? 'var(--rk-accent)' : ch ? 'var(--rk-line)' : 'var(--rk-edge-soft)';
        const color  = ch ? 'var(--rk-accent)' : 'var(--rk-ink-mute)';
        h += `<div class="grid-cell" data-bi="${bi}" title="Bar ${bar + 1} beat ${b + 1}" style="flex:1;min-height:30px;background:${bg};border:1px solid ${border};border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .1s;${b === 0 ? 'border-left-width:2px;border-left-color:var(--rk-line)' : ''}">
          <span class="mono" style="color:${color};font-size:calc(${ch ? 10 : 9}px*var(--ui));font-weight:${ch ? 800 : 400};line-height:1">${label || sustain}</span>
          ${ch ? `<span class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));line-height:1">${numLabelMode === 'NUM' ? ch.root + sfx(ch.quality) : ch.numeral}</span>` : ''}
        </div>`;
      }
      h += `</div>`;
    }
    h += `</div>`;
    // length selector
    h += `<div class="rk-seg" style="margin-top:5px;align-items:center">
      <span class="rk-label" style="margin-right:2px">LENGTH</span>`;
    [4, 8, 12, 16].forEach(bl => {
      h += `<button class="rk-seg-btn prog-gl${gridBars === bl ? ' is-active' : ''}" data-gl="${bl}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:4px 8px">${bl}</button>`;
    });
    h += `<span class="rk-label-hint" style="margin-left:4px">bars</span></div>`;
    h += `</div>`;

    // ── SMART NEXT panel (only when a slot is selected) ──
    if (selectedBeat !== null) {
      const ranked = rankSmartNext(selectedBeat);
      h += `<div class="rk-section" style="background:var(--rk-soft);border:1px solid var(--rk-edge);border-radius:9px;padding:8px">
        <div class="rk-label">✦ FITS HERE <span class="rk-label-hint">bar ${Math.floor(selectedBeat / beatsPerBar) + 1} · beat ${(selectedBeat % beatsPerBar) + 1}</span></div>
        <div style="display:flex;flex-direction:column;gap:4px">`;
      ranked.slice(0, 5).forEach(c => {
        h += `<button class="smart-chip" data-root="${c.root}" data-q="${c.quality}" data-num="${c.numeral}" style="min-height:calc(28px*var(--ui));display:flex;align-items:center;gap:8px;background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:7px;padding:5px 8px;cursor:pointer;text-align:left;width:100%">
          <span class="mono" style="color:var(--rk-accent);font-size:calc(13px*var(--ui));font-weight:800;min-width:34px">${c.numeral}</span>
          <span class="mono" style="color:var(--rk-dim);font-size:calc(10px*var(--ui));min-width:30px">${c.root}${sfx(c.quality)}</span>
          <span style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));flex:1">${c.why}</span>
        </button>`;
      });
      h += `</div>`;
      // Tier 3 — color & extend
      h += `<button class="rk-chip tier3-toggle${showTier3 ? ' is-active' : ''}" style="min-height:calc(28px*var(--ui));margin-top:6px">${showTier3 ? '▾' : '▸'} COLOR & BEYOND · 7ths, borrowed, secondary</button>`;
      if (showTier3) {
        const add7 = sevenths;
        let r = `<div class="rk-label" style="margin-top:6px">DIATONIC 7THS</div><div class="rk-seg" style="gap:4px">`;
        add7.forEach(c => {
          r += `<button style="min-height:calc(28px*var(--ui))" class="smart-chip rk-chip" data-root="${c.root}" data-q="${c.quality}" data-num="${c.numeral}">${c.numeral} <span style="opacity:.6">${c.root}${sfx(c.quality)}</span></button>`;
        });
        r += `</div>`;
        const colorList = [...getBorrowedChords(root, keyType), ...getSecondaryDominants(root, keyType)];
        r += `<div class="rk-label" style="margin-top:6px">BORROWED & SECONDARY</div><div class="rk-seg" style="gap:4px">`;
        colorList.forEach(c => {
          r += `<button style="min-height:calc(28px*var(--ui))" class="smart-chip rk-chip" data-root="${c.root}" data-q="${c.quality}" data-num="${c.numeral}" title="${(c.why || '').replace(/"/g, '&quot;')}">${c.numeral} <span style="opacity:.6">${c.root}${sfx(c.quality)}</span></button>`;
        });
        r += `</div>`;
        h += r;
      }
      h += `<button class="rk-chip smart-clear" style="min-height:calc(28px*var(--ui));margin-top:6px;color:var(--rk-bad)">✕ clear this beat</button>`;
      h += `</div>`;
    }

    // ── PRESET templates ──
    h += `<div class="rk-section">
      <div class="rk-label">PRESET PROGRESSIONS <span class="rk-label-hint">tap to load into the timeline</span></div>
      <div class="rk-presets" style="flex-wrap:wrap">`;
    PROG_PRESETS.forEach(pr => {
      h += `<button class="rk-preset prog-pr" data-pr="${pr.name}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));min-width:auto;padding:0 8px">${pr.name}</button>`;
    });
    h += `</div></div>`;

    // ── NECK position + drill ──
    h += `<div class="rk-section">
      <div class="rk-label">NECK POSITION <span class="rk-label-hint">where on the neck the shapes light up</span></div>
      <select id="prog-zone-${p.id}" style="width:100%">`;
    progZones.forEach(z => {
      h += `<option value="${z.label}" ${z.label === positionZone ? 'selected' : ''}>${z.label} · frets ${z.lo}-${z.hi}</option>`;
    });
    h += `</select>`;
    if (activeZone) {
      h += `<div class="rk-seg" style="margin-top:5px;gap:4px">`;
      activeZone.chords.forEach(zc => {
        h += `<button style="min-height:calc(28px*var(--ui))" class="rk-chip prog-zone-chord" data-num="${zc.numeral || ''}" data-root="${zc.root}" data-quality="${zc.quality}" title="Preview this voicing on the fretboard">${zc.numeral} <span style="opacity:.6">${zc.root}${sfx(zc.quality)}</span></button>`;
      });
      h += `</div>`;
    }
    h += `<div style="display:flex;gap:6px;align-items:center;margin-top:6px">
        <button class="rk-chip prog-drill${drillMode ? ' is-active' : ''}" style="min-height:calc(28px*var(--ui));flex:1">🏋️ Transition Drill ${drillMode ? 'ON' : 'OFF'}</button>
        ${drillMode && p._progPlaying ? `<span class="mono" style="color:var(--rk-accent);font-size:calc(10px*var(--ui));font-weight:700">${drillScore.changes} changes</span>` : ''}
      </div>`;
    h += `</div>`;

    // ── REAPER Bridge: export the progression as MIDI ──
    h += `<div class="rk-section">
      <div class="rk-label">REAPER BRIDGE <span class="rk-label-hint">export this progression as a .mid file</span></div>
      <div style="display:flex;gap:4px;align-items:stretch">
        <select class="prog-midi-style" style="flex:1;background:var(--rk-panel);border:1px solid var(--rk-edge);color:var(--rk-ink);border-radius:6px;padding:4px;font-size:calc(10px*var(--ui))">
          <option value="guitar" ${(s.midiStyle || 'guitar') === 'guitar' ? 'selected' : ''}>Guitar voicings (strummed)</option>
          <option value="block" ${s.midiStyle === 'block' ? 'selected' : ''}>Block chords (piano)</option>
          <option value="arp" ${s.midiStyle === 'arp' ? 'selected' : ''}>Arpeggiated 8ths</option>
        </select>
        <button class="rk-chip prog-export-midi" title="Downloads a .mid — then run the Resonote Import action in REAPER" style="min-height:calc(28px*var(--ui));color:var(--rk-accent);border-color:var(--rk-line)">⇄ Export</button>
      </div>
      <div class="prog-export-msg mono" style="font-size:calc(8px*var(--ui));text-align:center;margin-top:3px;min-height:10px;color:var(--rk-accent)"></div>
    </div>`;

    // ── Theory panel ──
    h += theoryPanelHTML('progression', PROG_THEORY);

    h += `</div>`;
    el.innerHTML = h;

    // ── Wire events ──────────────────────────────────────────────────
    el.querySelector('.numlabel-toggle')?.addEventListener('click', e => { e.stopPropagation(); numLabelMode = numLabelMode === 'NUM' ? 'NAMES' : 'NUM'; render(); });

    el.querySelectorAll('.prog-root').forEach(b => b.onclick = e => {
      e.stopPropagation();
      root = b.dataset.r;
      pedalBus.setKey(root, keyType, { source: p.id });
      if (!getActiveZone() && getProgressionZones()[0]) positionZone = getProgressionZones()[0].label;
      if (p._progPlaying) { stopPlaying(); startPlaying(); } else render();
    });
    el.querySelectorAll('.prog-kt').forEach(b => b.onclick = e => {
      e.stopPropagation();
      keyType = b.dataset.kt;
      pedalBus.setKey(root, keyType, { source: p.id });
      if (!getActiveZone() && getProgressionZones()[0]) positionZone = getProgressionZones()[0].label;
      if (p._progPlaying) { stopPlaying(); startPlaying(); } else render();
    });

    el.querySelectorAll('.qual-btn').forEach(b => b.onclick = e => {
      e.stopPropagation();
      qualityMode = b.dataset.qm;
      const o = subOptionsFor(qualityMode);
      subAlt = o.length ? o[0][0] : null;
      // keep an armed chord's function but re-resolve its quality under the new mode
      armedChord = null;
      render();
    });
    el.querySelectorAll('.sub-pill').forEach(b => b.onclick = e => { e.stopPropagation(); subAlt = b.dataset.sub; armedChord = null; render(); });

    el.querySelectorAll('.fn-btn').forEach(b => b.onclick = e => {
      e.stopPropagation();
      arm({ root: b.dataset.root, quality: b.dataset.q, numeral: b.dataset.num });
    });
    el.querySelector('.color-toggle')?.addEventListener('click', e => { e.stopPropagation(); showColor = !showColor; render(); });
    el.querySelectorAll('.color-chip').forEach(b => b.onclick = e => {
      e.stopPropagation();
      arm({ root: b.dataset.root, quality: b.dataset.q, numeral: b.dataset.num });
    });
    el.querySelector('.disarm-btn')?.addEventListener('click', e => { e.stopPropagation(); armedChord = null; render(); });

    // Grid cells — paint (if armed) or select (Smart Next)
    el.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = e => {
        e.stopPropagation();
        const bi = parseInt(cell.dataset.bi);
        if (armedChord) {
          writeBeat(bi, armedChord);
          highlightChord(customGrid[bi]);
          render();
        } else {
          selectedBeat = selectedBeat === bi ? null : bi;
          highlightChord(getGridChordAt(bi));
          render();
        }
      };
      cell.oncontextmenu = e => {
        e.preventDefault(); e.stopPropagation();
        const bi = parseInt(cell.dataset.bi);
        writeBeat(bi, null); render();
        return false;
      };
    });

    // Smart Next + tier-3 chips — fill the selected slot, advance
    el.querySelectorAll('.smart-chip').forEach(b => b.onclick = e => {
      e.stopPropagation();
      if (selectedBeat === null) return;
      writeBeat(selectedBeat, { root: b.dataset.root, quality: b.dataset.q, numeral: b.dataset.num });
      highlightChord(customGrid[selectedBeat]);
      const nxt = nextEmptyFrom(selectedBeat + 1);
      selectedBeat = nxt;
      render();
    });
    el.querySelector('.tier3-toggle')?.addEventListener('click', e => { e.stopPropagation(); showTier3 = !showTier3; render(); });
    el.querySelector('.smart-clear')?.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedBeat !== null) { writeBeat(selectedBeat, null); render(); }
    });

    el.querySelectorAll('.prog-pr').forEach(b => b.onclick = e => {
      e.stopPropagation();
      progName = b.dataset.pr;
      seedCustomGridFromPreset();
      if (p._progPlaying) { stopPlaying(); startPlaying(); } else render();
    });

    el.querySelectorAll('.prog-gl').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const newLen = parseInt(b.dataset.gl);
      if (newLen !== gridBars) {
        const newGrid = new Array(newLen * beatsPerBar).fill(null);
        for (let bar = 0; bar < Math.min(gridBars, newLen); bar++) {
          for (let bt = 0; bt < beatsPerBar; bt++) {
            const idx = bar * beatsPerBar + bt;
            if (idx < customGrid.length && idx < newGrid.length) newGrid[idx] = customGrid[idx];
          }
        }
        customGrid = newGrid; gridBars = newLen; selectedBeat = null;
      }
      if (p._progPlaying) stopPlaying();
      render();
    });

    const zoneSel = el.querySelector(`#prog-zone-${p.id}`);
    if (zoneSel) zoneSel.onchange = e => {
      e.stopPropagation();
      positionZone = zoneSel.value; selectedBeat = null;
      if (p._progPlaying) { stopPlaying(); startPlaying(); } else render();
    };
    el.querySelectorAll('.prog-zone-chord').forEach(b => b.onclick = e => {
      e.stopPropagation();
      highlightChord({ root: b.dataset.root, quality: b.dataset.quality, numeral: b.dataset.num || '' });
    });

    el.querySelector('.prog-play')?.addEventListener('click', e => {
      e.stopPropagation();
      if (p._progPlaying) stopPlaying(); else startPlaying();
    });
    el.querySelector('.prog-drill')?.addEventListener('click', e => { e.stopPropagation(); drillMode = !drillMode; render(); });

    // REAPER Bridge export
    el.querySelector('.prog-midi-style')?.addEventListener('change', e => { e.stopPropagation(); s.midiStyle = e.target.value; });
    el.querySelector('.prog-export-midi')?.addEventListener('click', e => { e.stopPropagation(); exportProgressionMidi(); });

    wireTheoryPanel(el);

    // Persist
    Object.assign(s, {
      root, keyType, barsPerChord, progName, progMode, positionZone, gridBars, customGrid,
      drillMode, beatsPerBar, qualityMode, subAlt, numLabelMode,
    });

    if (p._progPlaying) updateLiveDisplay();
  }

  render();

  // Auto-start signal (Practice Manager / Song routes)
  if (p.settings._autoStart) {
    delete p.settings._autoStart;
    if (!p._progPlaying) startPlaying();
  }
}
