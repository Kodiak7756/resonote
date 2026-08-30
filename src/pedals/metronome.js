import { metroClock, normalizeMetroPattern } from '../core/state.js';
import { createPulse, clickSound, audioCtx, scheduleVisual } from '../core/pulse.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { scaleRowHTML } from '../ui/tempo-control.js';

// The five beat sounds, loudest to silent. They used to be five saturated hues —
// which read as five unrelated things, and a red at hue 0 is exactly what C looks
// like on the neck. What actually separates them is WEIGHT, so they now ride one
// ladder of the pedal's own accent: the lamp at full for an accent, the accent for
// a regular beat, a quieter tint for the alternate voice, ink for a ghost, and the
// muted micro-label ink for a rest. The letter on the dot names the type.
const BEAT_TYPES = {
  accent:    { label:'ACC', short:'A', color:'var(--rk-hot)',      bg:'var(--rk-soft2)', freq:1050, gain:.5,  wave:'sine'     },
  regular:   { label:'REG', short:'R', color:'var(--rk-accent)',   bg:'var(--rk-soft)',  freq:720,  gain:.3,  wave:'sine'     },
  alternate: { label:'ALT', short:'T', color:'var(--rk-dim)',      bg:'var(--rk-soft)',  freq:840,  gain:.24, wave:'square'   },
  ghost:     { label:'GHO', short:'G', color:'var(--rk-ink-dim)',  bg:'var(--rk-panel2)',freq:500,  gain:.12, wave:'triangle' },
  rest:      { label:'RST', short:'-', color:'var(--rk-ink-mute)', bg:'var(--rk-panel)', freq:0,    gain:0,   wave:'sine'     },
};

const DENOMS = [2, 4, 8, 16];

// [beats, unit, label]  – two rows: simple then compound
const TS_PRESETS = [
  [2,4,'2/4'], [3,4,'3/4'], [4,4,'4/4'], [5,4,'5/4'], [6,4,'6/4'],
  [6,8,'6/8'], [7,8,'7/8'], [9,8,'9/8'], [12,8,'12/8'], [7,4,'7/4'],
];

// How long the click runs before stopping itself. 0 = ∞ (until you stop it).
// Two lists because the useful round numbers differ: 8 is a normal set of bars,
// 8 beats is two bars of 4 — barely a set.
const LENGTH_PRESETS = {
  bars:  [0, 1, 2, 4, 8, 12, 16, 32],
  beats: [0, 4, 8, 12, 16, 24, 32, 64],
};

// Classical tempo term shown beside the BPM — a small teaching touch.
const TEMPO_TERMS = [
  [40,'Grave'], [60,'Largo'], [72,'Adagio'], [100,'Andante'], [120,'Moderato'],
  [156,'Allegro'], [176,'Vivace'], [200,'Presto'], [9999,'Prestissimo'],
];
const tempoTerm = bpm => (TEMPO_TERMS.find(([max]) => bpm <= max) || [, 'Prestissimo'])[1];

// Smart Theory panel content (Chord-Family-Lab style "what is this & why").
const METRO_THEORY = {
  kicker: 'RHYTHM',
  title: 'Tempo, time signature & subdivision',
  what: `The metronome is your <b>master clock</b>. <b>Tempo</b> (BPM) sets how fast the beats come; the <b>time signature</b> groups them into bars — 4/4 is four beats per bar, and the count resets on beat 1. <b>Subdivisions</b> split each beat into smaller, even pulses: eighths, triplets, sixteenths.`,
  why: `A steady pulse is what makes rhythm feel intentional instead of rushed. Practise slow and clean, then nudge the tempo up a few BPM at a time — that's the <b>Speed Trainer</b> — to build speed without sloppiness. Accenting beat 1 trains you to feel the bar so you never lose your place in a song.`,
  lessonId: 'harmonic-rhythm-and-the-click',
  lessonLabel: 'Open the rhythm lessons',
};

export function buildMetronomeContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let bpm         = clampBpm(s.bpm || 120);
  let ts          = clampBeats(s.ts || 4);
  let unit        = DENOMS.includes(Number(s.unit)) ? Number(s.unit) : 4;
  let playing     = false, beat = 0;
  let subdiv      = s.subdiv || 'quarter';
  let pattern     = normalizeMetroPattern(s.pattern || legacyPattern(s, ts), ts);
  let speedTrainer = s.speedTrainer || { enabled:false, increment:2, everyBars:4, targetBpm:200 };
  // The set length is one number read in either unit. lengthBars is still
  // written for anything that remembers the old bars-only setting.
  let lengthUnit  = s.lengthUnit === 'beats' ? 'beats' : 'bars';
  let lengthCount = clampLength(s.lengthCount != null ? s.lengthCount : s.lengthBars);
  let loopSet     = !!s.loopSet;
  let runDone = false, resting = false;          // set finished / sitting out the rest bar
  let subTick = 0;
  // Two tallies of the same run: barsCued/beatsCued are what the scheduler has
  // already committed to (it works ahead of the audio clock), barCount/
  // beatsPlayed are what you have actually heard. Decisions use the first pair
  // so nothing sounds that shouldn't; the display uses the second so the
  // numbers change when you hear them, not a quarter-second early.
  let barCount = 0, beatsPlayed = 0, barsCued = 0, beatsCued = 0;
  let editingBpm  = false;
  let savePresetMode = false;
  let presets     = Array.isArray(s.presets) ? s.presets : new Array(5).fill(null);
  let lastClockConfig = metroClock.getConfigSignature();
  let activeDotPicker = null;   // beat-index whose type picker is open, or null

  const alive = () => !!document.getElementById(`body-${p.id}`);

  // A rebuild re-enters this function with fresh closures, so anything left
  // running from the previous build would click on forever unowned.
  if (p._pulse) p._pulse.stop();
  if (p._restTimer) { clearTimeout(p._restTimer); p._restTimer = null; }
  if (p._endTimer)  { clearTimeout(p._endTimer);  p._endTimer  = null; }
  metroClock.unregisterTransport(p.id);

  // Master transport: register the metronome's stop path under its instance id.
  metroClock.registerTransport(p.id, () => {
    if (!playing && !resting) return;
    haltPlayback();
    if (alive()) render();
  });

  syncClock();

  // ── Helpers ──────────────────────────────────────────────────────────
  function clampBpm(v)   { return Math.max(20,  Math.min(300, Math.round(Number(v) || 120))); }
  function clampBeats(v) { return Math.max(1,   Math.min(32,  Math.round(Number(v) || 4)));   }
  function clampLength(v){ const n = Math.round(Number(v) || 0); return n < 1 ? 0 : Math.min(999, n); }

  // The engine clocks one beat per 60000/bpm ms whatever the denominator,
  // so a bar of rest is simply ts of those.
  const restBarMs = () => ts * 60000 / bpm;

  // The length limit lives in beats internally — that is the only unit the
  // engine counts in, and it lets a set stop mid-bar when you ask for beats.
  const limitBeats = () => lengthCount ? (lengthUnit === 'beats' ? lengthCount : lengthCount * ts) : 0;
  const barsEquiv  = () => limitBeats() / ts;
  const unitWord   = () => (lengthUnit === 'beats' ? 'beats' : 'bars');
  const unitOne    = () => (lengthUnit === 'beats' ? 'beat' : 'bar');
  const qty        = (n, one = unitOne()) => `${n} ${one}${n === 1 ? '' : 's'}`;

  function clearRest() {
    if (p._restTimer) { clearTimeout(p._restTimer); p._restTimer = null; }
    resting = false;
  }

  function resetTally() { barCount = 0; beatsPlayed = 0; barsCued = 0; beatsCued = 0; }

  // Shared clean stop: kill the click, park the beat display, hand the clock
  // back. Used by the STOP button, the master transport and the length limit.
  function haltPlayback() {
    if (p._pulse) p._pulse.stop();
    if (p._endTimer) { clearTimeout(p._endTimer); p._endTimer = null; }
    p._endAt = null;
    clearRest();
    playing = false; beat = 0; subTick = 0; runDone = false;
    resetTally();
    metroClock.playing = false;
    metroClock.setBeat(0, pattern[0]);   // triggers clock listener → renderBeatOnly
  }

  function legacyPattern(settings, beats) {
    const rests = Array.isArray(settings.rests) ? settings.rests : [];
    return Array.from({ length:beats }, (_, i) => rests[i] ? 'rest' : (i === 0 ? 'accent' : 'regular'));
  }

  function syncClock() {
    pattern = normalizeMetroPattern(pattern, ts);
    metroClock.subdiv = subdiv;
    metroClock.set(bpm, ts, unit, pattern);
    lastClockConfig = metroClock.getConfigSignature();
    // lengthBars keeps its old meaning (whole bars) for anything that reads it;
    // ceil so a 32-beat set in 6/8 never reads back as a shorter one.
    const lengthBars = lengthCount ? (lengthUnit === 'bars' ? lengthCount : Math.max(1, Math.ceil(lengthCount / ts))) : 0;
    Object.assign(s, { bpm, ts, unit, subdiv, pattern, speedTrainer, presets,
                       lengthCount, lengthUnit, lengthBars, loopSet });
  }

  function currentPresetState() {
    return { bpm, ts, unit, subdiv, pattern:[...pattern] };
  }

  function loadPreset(i) {
    const pr = presets[i];
    if (!pr) return;
    bpm    = clampBpm(pr.bpm);
    ts     = clampBeats(pr.ts);
    unit   = DENOMS.includes(Number(pr.unit)) ? Number(pr.unit) : 4;
    subdiv = pr.subdiv || 'quarter';
    pattern = normalizeMetroPattern(pr.pattern, ts);
    editingBpm = false; activeDotPicker = null;
    syncClock();
    if (playing) startM(); else render();
  }

  function savePreset(i) {
    presets[i] = currentPresetState();
    savePresetMode = false;
    syncClock(); render();
  }

  function resetMetro() {
    bpm = 120; ts = 4; unit = 4; subdiv = 'quarter';
    beat = 0; subTick = 0;
    pattern = normalizeMetroPattern(['accent','regular','regular','regular'], 4);
    editingBpm = false; activeDotPicker = null;
    lengthCount = 0; loopSet = false; runDone = false; clearRest();
    syncClock();
    if (playing) startM(); else render();
  }

  // ── Audio ────────────────────────────────────────────────────────────
  // `time` is the audio-clock instant this tick belongs to, `dest` the pulse's
  // own output so a STOP silences anything already queued.
  function tickSound(type, time, dest) {
    try {
      const def = BEAT_TYPES[type] || BEAT_TYPES.regular;
      if (type === 'rest' || !def.freq) return;
      clickSound(audioCtx(), time, {
        freq: def.freq, gain: def.gain, type: def.wave,
        dur: type === 'ghost' ? 0.04 : 0.08, dest,
      });
    } catch(e) {}
  }

  function getTickType(beatIdx, isSubdiv) {
    if (isSubdiv) return 'ghost';
    return pattern[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular');
  }

  function getSubdivsPerBeat() {
    if (subdiv === '8th')     return 2;
    if (subdiv === '16th')    return 4;
    if (subdiv === 'triplet') return 3;
    return 1;
  }

  // ── State mutations ───────────────────────────────────────────────────
  function setBeatType(i, type) {
    pattern[i] = type; activeDotPicker = null;
    syncClock(); renderBeatOnly();
  }

  function setLength(v) {
    lengthCount = clampLength(v);
    runDone = false; clearRest();   // touching the control ends the current set outright
    syncClock(); render();
  }

  // Switching units converts the count, so the set keeps the same musical
  // length and you watch 8 bars turn into 32 beats instead of into 8 beats.
  function setLengthUnit(next) {
    if (next !== 'beats' && next !== 'bars') return;
    if (next === lengthUnit) return;
    if (lengthCount) lengthCount = clampLength(next === 'beats' ? lengthCount * ts : Math.round(lengthCount / ts) || 1);
    lengthUnit = next;
    runDone = false; clearRest();
    syncClock(); render();
  }

  // The same length written both ways, from the live time signature — 32 beats
  // is 8 bars of 4/4 but 5.3 bars of 6/8.
  function lengthReadHTML() {
    if (!lengthCount) return '∞ · no limit';
    const beats = limitBeats(), bars = barsEquiv();
    const barTxt = Number.isInteger(bars) ? qty(bars, 'bar') : `${bars.toFixed(1)} bars`;
    const both = lengthUnit === 'beats'
      ? `<b style="color:var(--rk-dim)">${qty(beats, 'beat')}</b> · ${barTxt}`
      : `<b style="color:var(--rk-dim)">${qty(lengthCount, 'bar')}</b> · ${qty(beats, 'beat')}`;
    return `${both} <span style="opacity:.65">in ${ts}/${unit}</span>`;
  }

  // The set just went the distance. Stop down the same path as STOP, but keep
  // the tally on screen so you can see it did.
  function finishRun() {
    const endAt = p._endAt;               // audio time the set closed on
    haltPlayback();
    runDone = true;                       // the ✓ readout reads off lengthCount
    if (loopSet) {
      resting = true;
      const restSecs = restBarMs() / 1000;
      const nextAt = endAt ? endAt + restSecs : null;
      // Wake a little early and hand the pulse the exact audio time, so the
      // new set's downbeat lands one bar after the old one rather than one bar
      // plus however late the timer happened to be.
      p._restTimer = setTimeout(() => {
        p._restTimer = null;
        if (!resting || !alive()) return;
        resting = false; runDone = false;
        metroClock.stopOthers(p.id);
        playing = true; resetTally();
        metroClock.masterSource = 'metronome';
        startM(nextAt);
      }, Math.max(0, restSecs * 1000 - 60));
    }
    render();
  }

  function updateTempo(v, restart = true) {
    bpm = clampBpm(v);
    syncClock();
    if (playing && restart) startM();
    else {
      // "Don't restart" means keep the count where it is, not ignore the new
      // tempo — the pulse can be retuned without losing the beat.
      if (playing && p._pulse) p._pulse.setBpm(bpm);
      render();
    }
  }

  function updateTimeSignature(nextTs, nextUnit = unit) {
    ts   = clampBeats(nextTs);
    unit = DENOMS.includes(Number(nextUnit)) ? Number(nextUnit) : unit;
    beat = 0; subTick = 0; activeDotPicker = null;
    pattern = normalizeMetroPattern(pattern, ts);
    syncClock();
    if (playing) startM(); else render();
  }

  // ── Partial DOM update (dots only — used during playback) ─────────────
  function renderBeatDotsHTML() {
    let out = '';
    for (let i = 0; i < ts; i++) {
      const type = pattern[i] || 'regular';
      const def  = BEAT_TYPES[type] || BEAT_TYPES.regular;
      const on   = beat === i + 1;
      const open = activeDotPicker === i;
      const lit = on || open;
      out += `<button class="rk-beat metro-beat${on ? ' is-on' : ''}" data-bi="${i}"
        title="Beat ${i+1}: ${def.label} — tap to change its sound"
        style="background:${lit ? def.bg : 'var(--rk-panel2)'};
          border-color:${lit ? def.color : 'var(--rk-edge-soft)'};color:${def.color};
          ${on && type !== 'rest' ? 'box-shadow:0 0 14px var(--rk-glow)' : ''}">${def.short}</button>`;
    }
    // subdivision sub-ticks
    if (subdiv !== 'quarter' && playing) {
      const subs = getSubdivsPerBeat();
      out += `<span style="display:inline-flex;gap:4px;margin-left:8px;align-items:center">`;
      for (let i = 0; i < subs; i++)
        out += `<i style="display:block;width:6px;height:6px;border-radius:50%;background:${subTick===i?'var(--rk-accent)':'var(--rk-edge-soft)'}"></i>`;
      out += `</span>`;
    }
    return out;
  }

  // How far into the set we are — only means anything with a finite length,
  // and it counts in whichever unit you chose to set the length in.
  function renderProgressHTML() {
    if (!lengthCount) return '';
    const at = lengthUnit === 'beats'
      ? Math.min(Math.max(1, beatsPlayed), lengthCount)
      : Math.min(barCount + 1, lengthCount);
    const label = runDone
      ? `✓ ${qty(lengthCount)}${resting ? ' · rest bar' : ''}`
      : playing ? `${unitOne()} ${at} / ${lengthCount}`
                : `${qty(lengthCount)} ready`;
    // Beats heard, not bars, so the fill creeps beat by beat in both units.
    const done = runDone ? 1 : playing ? Math.max(0, beatsPlayed - 1) / Math.max(1, limitBeats()) : 0;
    const pct  = Math.max(0, Math.min(100, done * 100)).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:8px">
      <span class="mono len-prog-label" style="flex-shrink:0;font-size:calc(8px*var(--ui));font-weight:700;letter-spacing:1.2px;
        color:${runDone ? 'var(--rk-dim)' : playing ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'}">${label}</span>
      <span style="flex:1;height:3px;border-radius:2px;background:var(--rk-panel);overflow:hidden">
        <i class="len-prog-fill" style="display:block;height:100%;width:${pct}%;background:var(--rk-accent)"></i>
      </span>
    </div>`;
  }

  function renderDotPickerHTML() {
    if (activeDotPicker === null) return '';
    const i = activeDotPicker;
    const current = pattern[i] || 'regular';
    const label = `Beat ${i+1}`;
    const btns = Object.entries(BEAT_TYPES).map(([type, def]) =>
      `<button class="dot-pick mono" data-bi="${i}" data-type="${type}"
        title="${def.label}"
        style="display:flex;align-items:center;gap:5px;
          background:${current===type ? def.bg : 'var(--rk-panel2)'};
          border:1.5px solid ${current===type ? def.color : 'var(--rk-edge-soft)'};
          color:${current===type ? def.color : 'var(--rk-ink-dim)'};border-radius:7px;padding:5px 9px;
          cursor:pointer;font-size:calc(8.5px*var(--ui));font-weight:800">
        <span style="width:13px;height:13px;border-radius:50%;
          background:${def.bg};border:1px solid ${def.color};color:${def.color};
          display:inline-flex;align-items:center;justify-content:center;
          font-size:calc(7px*var(--ui))">${def.short}</span>${def.label}
      </button>`
    ).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;
        background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:9px;padding:8px">
      <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7.5px*var(--ui));text-align:center;letter-spacing:1.4px">${label.toUpperCase()} · CHOOSE SOUND</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:center">${btns}</div>
    </div>`;
  }

  function renderBeatOnly() {
    const dotsEl  = el.querySelector(`#metro-dots-${p.id}`);
    const pickerEl = el.querySelector(`#metro-picker-${p.id}`);
    const progEl  = el.querySelector(`#metro-prog-${p.id}`);
    if (!dotsEl) { render(); return; }
    dotsEl.innerHTML  = renderBeatDotsHTML();
    if (pickerEl) pickerEl.innerHTML = renderDotPickerHTML();
    if (progEl)   progEl.innerHTML   = renderProgressHTML();
    attachDotListeners();
  }

  function attachDotListeners() {
    el.querySelectorAll('.metro-beat').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const bi = parseInt(b.dataset.bi);
      activeDotPicker = activeDotPicker === bi ? null : bi;
      renderBeatOnly();
    });
    el.querySelectorAll('.dot-pick').forEach(b => b.onclick = e => {
      e.stopPropagation();
      setBeatType(parseInt(b.dataset.bi), b.dataset.type);
    });
  }

  // ── Full render ───────────────────────────────────────────────────────
  function render() {
    const presetRow = presets.map((pr, i) => {
      const saved = !!pr;
      const hot   = saved && pr.bpm===bpm && pr.ts===ts && pr.unit===unit && JSON.stringify(pr.pattern)===JSON.stringify(pattern);
      return `<button class="rk-preset metro-preset${hot ? ' is-hot' : ''}" data-pi="${i}"
        title="${savePresetMode ? 'Save current settings to this slot' : saved ? `Load ${pr.bpm} BPM ${pr.ts}/${pr.unit}` : 'Empty slot'}"
        style="${saved ? '' : 'opacity:.5'}">P${i+1}</button>`;
    }).join('');

    const tsPresets = TS_PRESETS.map(([pTs, pUnit, label]) => {
      const active = ts===pTs && unit===pUnit;
      return `<button class="rk-seg-btn tsb${active ? ' is-active' : ''}" data-ts="${pTs}" data-unit="${pUnit}"
        style="padding:6px 9px">${label}</button>`;
    }).join('');

    const subdivBtns = [
      ['quarter','♩','1','Quarter notes — one pulse per beat'],
      ['8th',    '♪','2','Eighth notes — two even pulses per beat'],
      ['triplet','3','3','Triplets — three even pulses per beat'],
      ['16th',   '♬','4','Sixteenth notes — four even pulses per beat'],
    ].map(([sv, icon, count, title]) =>
      `<button class="rk-seg-btn sub-btn${subdiv===sv ? ' is-active' : ''}" data-sv="${sv}" title="${title}" style="min-width:48px">
        <span style="font-size:calc(13px*var(--ui));line-height:1">${icon}</span>
        <span style="display:flex;gap:3px">
          ${Array.from({length:Number(count)},(_,i)=>`<i style="display:block;width:4px;height:4px;border-radius:50%;background:${i===0?'var(--rk-accent)':'var(--rk-edge-soft)'}"></i>`).join('')}
        </span>
      </button>`
    ).join('');

    const lenPresets = LENGTH_PRESETS[lengthUnit];
    const lenBtns = lenPresets.map(n => {
      const active = lengthCount === n;
      return `<button class="rk-seg-btn len-btn${active ? ' is-active' : ''}" data-len="${n}"
        title="${n ? `Stop after ${qty(n)}` : 'Keep going until you press stop'}"
        style="padding:6px 9px;min-width:32px">${n || '∞'}</button>`;
    }).join('');

    const lenUnitBtns = [['beats','BEATS','Count the set in beats'], ['bars','BARS','Count the set in bars']]
      .map(([u, label, title]) =>
        `<button class="rk-seg-btn len-unit${lengthUnit === u ? ' is-active' : ''}" data-lu="${u}"
          title="${title}" style="padding:6px 9px">${label}</button>`).join('');

    // Anything not on the preset row lives in the typed box.
    const customLen = lengthCount && !lenPresets.includes(lengthCount) ? lengthCount : '';

    const live = playing || resting;   // a rest bar is still "in the set"

    // BPM display — big number, click to edit
    const bpmDisplay = editingBpm
      ? `<input id="bpm-edit-${p.id}" class="rk-edit mono" type="number" min="20" max="300" value="${bpm}">`
      : `<span class="bpm-click mono" title="Click to type a tempo">${bpm}</span>`;

    const fill = ((bpm - 20) / 280 * 100).toFixed(1);

    el.innerHTML = `
      <div class="rk rk-metro">

        <!-- Tempo readout + transport -->
        <div class="rk-readoutrow">
          <!-- Showing ◼ this is the master STOP for the whole app, so it takes the
               stop red. The kit hangs every part of .rk-play's running look — glyph,
               rim, dome wash and pulse — off --rk-hot, so re-pointing that one token
               reddens all four together instead of four inline overrides fighting a
               radial-gradient. It is scoped to the button, so the accent-lamp beat
               dots beside it are untouched. -->
          <button id="mt-${p.id}" class="rk-play${live ? ' is-playing' : ''}" title="${live ? 'Stop' : 'Start'}"
                  style="${live ? '--rk-hot:var(--rk-stop)' : ''}">${live ? '◼' : '▶'}</button>
          <div class="rk-readout">
            <div class="rk-readout-num">${bpmDisplay}</div>
            <div class="rk-readout-sub">BPM · <b>${tempoTerm(bpm)}</b></div>
          </div>
          <div class="rk-nudge">
            <button class="bpm-step" data-d="1" title="+1 BPM">+</button>
            <button class="bpm-step" data-d="-1" title="−1 BPM">−</button>
          </div>
        </div>

        <!-- Tempo slider -->
        <div class="rk-section">
          <input id="bpm-slider-${p.id}" class="rk-slider" type="range" min="20" max="300" value="${bpm}" style="--rk-fill:${fill}%">
          <!-- 60 · 120 · 200 are the landmarks worth aiming at: a beat a second,
               the reference tempo everything is described against, and the top of
               Allegro. Placed by VALUE, so 120 sits where the thumb stops on 120. -->
          ${scaleRowHTML(20, 300, [20, 60, 120, 200, 300])}
        </div>

        <!-- Beat row -->
        <div class="rk-section">
          <div class="rk-label">BAR <span class="rk-label-hint">· tap a beat to shape its sound</span></div>
          <div id="metro-dots-${p.id}" class="rk-beats">${renderBeatDotsHTML()}</div>
          <div id="metro-picker-${p.id}">${renderDotPickerHTML()}</div>
        </div>

        <!-- Time signature -->
        <div class="rk-section">
          <div class="rk-label">TIME SIGNATURE</div>
          <div class="rk-seg">${tsPresets}</div>
        </div>

        <!-- Subdivision -->
        <div class="rk-section">
          <div class="rk-label">SUBDIVISION</div>
          <div class="rk-seg">${subdivBtns}</div>
        </div>

        <!-- Practice length — stop after N beats or bars, optionally loop the set -->
        <div class="rk-section">
          <div class="rk-label">LENGTH <span class="rk-label-hint">· stop after this many</span></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="rk-seg" style="gap:4px">${lenUnitBtns}</div>
            <span class="mono" id="metro-len-read-${p.id}"
              style="flex:1;min-width:120px;text-align:right;color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));line-height:1.4">${lengthReadHTML()}</span>
          </div>
          <div class="rk-seg">
            ${lenBtns}
            <input id="metro-len-input-${p.id}" class="len-input mono" type="number" min="1" max="999"
              value="${customLen}" placeholder="…" title="Type any number of ${unitWord()} (1–999)"
              style="width:48px;padding:6px 4px;text-align:center;font-size:calc(9.5px*var(--ui));font-weight:700;
                background:var(--rk-panel2);border:1.5px solid ${customLen ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};
                border-radius:7px;color:${customLen ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'};outline:none">
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="len-loop rk-chip${loopSet ? ' is-active' : ''}"
              title="Play the set again after one bar of rest"
              style="${lengthCount ? '' : 'opacity:.45'}">LOOP THE SET</button>
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));flex:1;line-height:1.4">
              ${!lengthCount
                ? 'runs until you press stop'
                : loopSet
                  ? `${qty(lengthCount)}, one bar of rest, then again`
                  : `stops itself after ${qty(lengthCount)}`}
            </span>
          </div>
          <div id="metro-prog-${p.id}">${renderProgressHTML()}</div>
        </div>

        <!-- Speed trainer -->
        <div class="rk-section">
          <div class="rk-label">PRACTICE</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="spd-toggle rk-chip${speedTrainer.enabled ? ' is-active' : ''}">SPEED TRAINER · +${speedTrainer.increment}</button>
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));flex:1;line-height:1.4">
              ${speedTrainer.enabled
                ? `+${speedTrainer.increment} BPM every ${speedTrainer.everyBars} bars → ${speedTrainer.targetBpm}`
                : 'auto-accelerate while you practise'}
            </span>
          </div>
        </div>

        <!-- Presets -->
        <div class="rk-presets">
          <button class="rk-chip metro-reset" title="Reset to 120 BPM 4/4">RESET</button>
          <button class="rk-chip metro-save-mode${savePresetMode ? ' is-active' : ''}" title="Toggle save-to-slot mode">${savePresetMode ? 'SAVING…' : 'SAVE'}</button>
          <div style="width:1px;height:18px;background:var(--rk-edge-soft);margin:0 2px"></div>
          ${presetRow}
        </div>

        ${theoryPanelHTML('metronome', METRO_THEORY)}

      </div>`;

    // Tempo slider — smooth drag, live readout, restart clock on release
    const slider = el.querySelector(`#bpm-slider-${p.id}`);
    if (slider) {
      slider.addEventListener('click', e => e.stopPropagation());
      slider.addEventListener('input', e => {
        e.stopPropagation();
        const v = clampBpm(e.target.value);
        e.target.style.setProperty('--rk-fill', ((v - 20) / 280 * 100).toFixed(1) + '%');
        if (!editingBpm) {
          const numEl = el.querySelector('.rk-readout-num .bpm-click');
          if (numEl) numEl.textContent = v;
          const subEl = el.querySelector('.rk-readout-sub b');
          if (subEl) subEl.textContent = tempoTerm(v);
        }
      });
      slider.addEventListener('change', e => { e.stopPropagation(); updateTempo(e.target.value); });
    }

    // Nudge ± 1 BPM
    el.querySelectorAll('.bpm-step').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); updateTempo(bpm + parseInt(b.dataset.d));
    }));

    // BPM click-to-type
    el.querySelector('.bpm-click')?.addEventListener('click', e => {
      e.stopPropagation(); editingBpm = true; render();
    });
    const bpmInput = el.querySelector(`#bpm-edit-${p.id}`);
    if (bpmInput) {
      bpmInput.focus(); bpmInput.select();
      bpmInput.addEventListener('click',  e => e.stopPropagation());
      bpmInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); editingBpm = false; updateTempo(e.target.value); }
        if (e.key === 'Escape') { e.preventDefault(); editingBpm = false; render(); }
      });
      bpmInput.addEventListener('blur', e => {
        if (editingBpm) { editingBpm = false; updateTempo(e.target.value, false); }
      });
    }

    // Smart Theory panel (collapse/expand + "learn the theory" link)
    wireTheoryPanel(el);

    // Dots + inline type picker
    attachDotListeners();

    // Preset bar
    el.querySelector('.metro-reset')?.addEventListener('click', e => { e.stopPropagation(); resetMetro(); });
    el.querySelector('.metro-save-mode')?.addEventListener('click', e => {
      e.stopPropagation(); savePresetMode = !savePresetMode; render();
    });
    el.querySelectorAll('.metro-preset').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(b.dataset.pi);
      if (savePresetMode) savePreset(idx); else loadPreset(idx);
    }));

    // TS presets
    el.querySelectorAll('.tsb').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const nextTs   = parseInt(b.dataset.ts);
      const nextUnit = parseInt(b.dataset.unit);
      // Build a fresh pattern of the right length
      pattern = normalizeMetroPattern(
        Array.from({ length:nextTs }, (_, i) => i === 0 ? 'accent' : 'regular'),
        nextTs
      );
      updateTimeSignature(nextTs, nextUnit);
    }));

    // Subdivision
    el.querySelectorAll('.sub-btn').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); subdiv = b.dataset.sv; syncClock();
      if (playing) startM(); else render();
    }));

    // Practice length
    el.querySelectorAll('.len-unit').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); setLengthUnit(b.dataset.lu);
    }));
    el.querySelectorAll('.len-btn').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); setLength(b.dataset.len);
    }));
    const lenInput = el.querySelector(`#metro-len-input-${p.id}`);
    if (lenInput) {
      lenInput.addEventListener('click',   e => e.stopPropagation());
      lenInput.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); setLength(e.target.value); }
      });
      lenInput.addEventListener('change',  e => { e.stopPropagation(); setLength(e.target.value); });
    }
    el.querySelector('.len-loop')?.addEventListener('click', e => {
      e.stopPropagation();
      loopSet = !loopSet;
      if (!loopSet) clearRest();   // switching it off mid-rest cancels the pending restart
      syncClock(); render();
    });

    // Speed trainer
    el.querySelector('.spd-toggle')?.addEventListener('click', e => {
      e.stopPropagation(); speedTrainer.enabled = !speedTrainer.enabled; syncClock(); render();
    });

    // Start / Stop — single render, no double fire
    document.getElementById(`mt-${p.id}`)?.addEventListener('click', e => {
      e.stopPropagation();
      if (playing || resting) {
        metroClock.stopOthers(p.id);          // master STOP: halt every other pedal clock too
        // keep masterSource = 'metronome' even when stopped — a stopped master is still master
        haltPlayback();                       // also drops a pending loop-the-set rest bar
        render();                             // full re-render to flip button to START
      } else {
        metroClock.stopOthers(p.id);          // master START: stop any other playing pedal first
        playing = true; runDone = false; resetTally();
        metroClock.masterSource = 'metronome';
        startM();                             // startM calls render() once internally
      }
    });
  }

  // ── External clock listener (react to other pedals changing the clock) ──
  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    const nextConfig = clock.getConfigSignature();
    if (metroClock.follows('metronome') && nextConfig !== lastClockConfig) {
      // Another pedal changed the config — sync our local state (only if linked)
      bpm    = clampBpm(clock.bpm);
      ts     = clampBeats(clock.ts);
      unit   = DENOMS.includes(Number(clock.unit)) ? Number(clock.unit) : 4;
      subdiv = clock.subdiv || 'quarter';
      pattern = normalizeMetroPattern(clock.pattern, ts);
      lastClockConfig = nextConfig;
      // Adopt the new config mid-flight rather than restarting the count.
      if (playing && p._pulse) {
        p._pulse.setBpm(bpm); p._pulse.setSubdiv(getSubdivsPerBeat()); p._pulse.setBeatsPerBar(ts);
      }
      render();   // full rebuild for new config
    } else if (!playing) {
      // Config unchanged; show beat position driven by an external pedal
      beat = clock.playing ? clock.beat : 0;
      renderBeatOnly();
    }
  });

  // ── Playback engine ───────────────────────────────────────────────────
  // The shared pulse hands us each tick shortly BEFORE it sounds, with the
  // exact audio-clock time it will sound at. The click is scheduled for that
  // time and the dots are hung off the same time, so the sound and the display
  // agree and neither one drifts the way a per-beat setInterval did.
  function handleTick(t) {
    if (!alive()) { haltPlayback(); return; }

    if (!t.isBeat) {
      // Ghosts inside the closing beat still sound (they always did); ones past
      // the closing instant do not.
      if (p._endTimer) return;
      tickSound('ghost', t.time, t.out);
      t.visual(() => { subTick = t.sub; renderBeatOnly(); });
      return;
    }

    // A finite set ends the moment the beat after its last one would sound —
    // decided before that beat is scheduled, so it never leaks out. It outranks
    // the speed trainer below: the set is over either way.
    const limit = limitBeats();
    if (limit && beatsCued >= limit) { endRun(t.time); return; }
    beatsCued++;

    const b = t.beatInBar, type = getTickType(b, false);
    tickSound(type, t.time, t.out);

    let bumped = false;
    if (b === 0 && t.index > 0) {
      barsCued++;
      if (speedTrainer.enabled && barsCued % speedTrainer.everyBars === 0 && bpm < speedTrainer.targetBpm) {
        bpm = Math.min(bpm + speedTrainer.increment, speedTrainer.targetBpm);
        syncClock();
        p._pulse.setBpm(bpm);   // retune in place — this downbeat keeps its slot
        bumped = true;
      }
    }

    t.visual(() => {
      if (!alive()) { haltPlayback(); return; }
      beat = b + 1; subTick = 0; beatsPlayed++;
      if (b === 0 && t.index > 0) barCount++;
      metroClock.setBeat(b, type);
      if (bumped) render();       // the trainer moved the tempo — redraw the readout
      else renderBeatOnly();      // fast partial update during playback
    });
  }

  // The set closes when that suppressed downbeat would have landed. Do NOT
  // stop the pulse here: its last click and the final beat's ghost notes are
  // already queued in the audio graph, and stopping mutes them. Every later
  // beat tick fails the same limit test and falls through here silently, so
  // nothing further sounds; the halt itself waits for the closing instant.
  function endRun(time) {
    if (p._endTimer) return;
    p._endAt = time;
    p._endTimer = scheduleVisual(time, () => {
      p._endTimer = null;
      if (!alive()) { haltPlayback(); return; }
      finishRun();
    });
  }

  // startM(atTime) — atTime pins the first click to an audio instant (the
  // loop-the-set restart); omitted, it starts now.
  const startM = (atTime) => {
    if (!p._pulse) p._pulse = createPulse({ bpm, subdiv:getSubdivsPerBeat(), beatsPerBar:ts, onTick:handleTick });
    if (p._endTimer) { clearTimeout(p._endTimer); p._endTimer = null; }
    p._endAt = null;
    const pl = p._pulse;
    pl.stop();
    pl.setBpm(bpm); pl.setSubdiv(getSubdivsPerBeat()); pl.setBeatsPerBar(ts);
    beat = 1; subTick = 0;
    metroClock.playing = true;
    pl.start(atTime);
    render();   // ← single render; button shows STOP, dots highlight beat 1
  };

  // ── Pages ask the metronome for a click; they don't grow their own ──────
  // The TAB reader used to carry a private setInterval + AudioContext click. It
  // now sends `resonote:metro` and this pedal answers — one click engine, one
  // tempo, one thing to improve. An explicit request adopts the asked-for tempo
  // even when the master link is OFF: the link governs ambient config drift,
  // whereas this IS the ask. (A second Metronome pedal answering too is harmless
  // — startM calls stopOthers, so only one ends up clicking.)
  if (p._metroReq) window.removeEventListener('resonote:metro', p._metroReq);
  p._metroReq = e => {
    if (!alive()) return;
    const d = e.detail || {};
    if (d.action === 'stop') { haltPlayback(); render(); return; }
    if (d.action === 'bpm')  { updateTempo(d.bpm, false); return; }   // retune in place, don't restart
    if (d.action !== 'start') return;
    if (d.bpm) bpm = clampBpm(d.bpm);
    if (d.ts)  { ts = clampBeats(d.ts); pattern = normalizeMetroPattern(pattern, ts); }
    syncClock();
    if (playing) { p._pulse?.setBpm(bpm); p._pulse?.setBeatsPerBar(ts); render(); return; }
    // startM() is not self-sufficient — every caller raises `playing` and clears the
    // tally first (see the mt- button above). Skip that and the click runs while the
    // pedal believes it is stopped, which also makes STOP a no-op.
    metroClock.stopOthers(p.id);
    playing = true; runDone = false; resetTally();
    metroClock.masterSource = 'metronome';
    startM();                                // renders once internally
  };
  window.addEventListener('resonote:metro', p._metroReq);

  render();
}
