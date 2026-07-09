import { metroClock, normalizeMetroPattern } from '../core/state.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const BEAT_TYPES = {
  accent:    { label:'ACC', short:'A', color:'#ff4466', bg:'rgba(255,68,102,.22)',   freq:1050, gain:.5,  wave:'sine'     },
  regular:   { label:'REG', short:'R', color:'#dd8844', bg:'rgba(221,136,68,.20)',   freq:720,  gain:.3,  wave:'sine'     },
  alternate: { label:'ALT', short:'T', color:'#44bbcc', bg:'rgba(68,187,204,.18)',   freq:840,  gain:.24, wave:'square'   },
  ghost:     { label:'GHO', short:'G', color:'#aa77dd', bg:'rgba(170,119,221,.20)',  freq:500,  gain:.12, wave:'triangle' },
  rest:      { label:'RST', short:'-', color:'#666',    bg:'rgba(255,255,255,.04)',  freq:0,    gain:0,   wave:'sine'     },
};

const DENOMS = [2, 4, 8, 16];

// [beats, unit, label]  – two rows: simple then compound
const TS_PRESETS = [
  [2,4,'2/4'], [3,4,'3/4'], [4,4,'4/4'], [5,4,'5/4'], [6,4,'6/4'],
  [6,8,'6/8'], [7,8,'7/8'], [9,8,'9/8'], [12,8,'12/8'], [7,4,'7/4'],
];

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
  let playing     = false, beat = 0, intv = null, mCtx = null;
  let subdiv      = s.subdiv || 'quarter';
  let pattern     = normalizeMetroPattern(s.pattern || legacyPattern(s, ts), ts);
  let speedTrainer = s.speedTrainer || { enabled:false, increment:2, everyBars:4, targetBpm:200 };
  let subTick = 0, barCount = 0;
  let editingBpm  = false;
  let savePresetMode = false;
  let presets     = Array.isArray(s.presets) ? s.presets : new Array(5).fill(null);
  let lastClockConfig = metroClock.getConfigSignature();
  let activeDotPicker = null;   // beat-index whose type picker is open, or null

  // Master transport: register the metronome's stop path under its instance id.
  metroClock.registerTransport(p.id, () => {
    if (!playing) return;
    clearInterval(intv); intv = null;
    playing = false; beat = 0; subTick = 0; barCount = 0;
    metroClock.playing = false;
    metroClock.setBeat(0, pattern[0]);
    if (document.getElementById(`body-${p.id}`)) render();
  });

  syncClock();

  // ── Helpers ──────────────────────────────────────────────────────────
  function clampBpm(v)   { return Math.max(20,  Math.min(300, Math.round(Number(v) || 120))); }
  function clampBeats(v) { return Math.max(1,   Math.min(32,  Math.round(Number(v) || 4)));   }

  function legacyPattern(settings, beats) {
    const rests = Array.isArray(settings.rests) ? settings.rests : [];
    return Array.from({ length:beats }, (_, i) => rests[i] ? 'rest' : (i === 0 ? 'accent' : 'regular'));
  }

  function syncClock() {
    pattern = normalizeMetroPattern(pattern, ts);
    metroClock.subdiv = subdiv;
    metroClock.set(bpm, ts, unit, pattern);
    lastClockConfig = metroClock.getConfigSignature();
    Object.assign(s, { bpm, ts, unit, subdiv, pattern, speedTrainer, presets });
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
    syncClock();
    if (playing) startM(); else render();
  }

  // ── Audio ────────────────────────────────────────────────────────────
  function tickSound(type) {
    try {
      const def = BEAT_TYPES[type] || BEAT_TYPES.regular;
      if (type === 'rest' || !def.freq) return;
      if (!mCtx) mCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = mCtx, o = c.createOscillator(), g = c.createGain();
      o.type = def.wave; o.frequency.value = def.freq;
      g.gain.value = def.gain;
      const dur = type === 'ghost' ? 0.04 : 0.08;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
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

  function updateTempo(v, restart = true) {
    bpm = clampBpm(v);
    syncClock();
    if (playing && restart) startM(); else render();
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
        style="background:${lit ? def.bg : 'rgba(255,255,255,.03)'};
          border-color:${lit ? def.color : '#3a3a3a'};color:${def.color};
          ${on && type !== 'rest' ? `box-shadow:0 0 14px ${def.color}77` : ''}">${def.short}</button>`;
    }
    // subdivision sub-ticks
    if (subdiv !== 'quarter' && playing) {
      const subs = getSubdivsPerBeat();
      out += `<span style="display:inline-flex;gap:4px;margin-left:8px;align-items:center">`;
      for (let i = 0; i < subs; i++)
        out += `<i style="display:block;width:6px;height:6px;border-radius:50%;background:${subTick===i?'var(--rk-accent)':'#2a2a2a'}"></i>`;
      out += `</span>`;
    }
    return out;
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
          background:${current===type ? def.bg : 'rgba(255,255,255,.04)'};
          border:1.5px solid ${current===type ? def.color : '#383838'};
          color:${current===type ? def.color : '#999'};border-radius:7px;padding:5px 9px;
          cursor:pointer;font-size:8.5px;font-weight:800">
        <span style="width:13px;height:13px;border-radius:50%;
          background:${def.bg};border:1px solid ${def.color};color:${def.color};
          display:inline-flex;align-items:center;justify-content:center;
          font-size:7px">${def.short}</span>${def.label}
      </button>`
    ).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;
        background:rgba(0,0,0,.3);border:1px solid #2e2e2e;border-radius:9px;padding:8px">
      <div class="mono" style="color:#5a5a5a;font-size:7.5px;text-align:center;letter-spacing:1.4px">${label.toUpperCase()} · CHOOSE SOUND</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:center">${btns}</div>
    </div>`;
  }

  function renderBeatOnly() {
    const dotsEl  = el.querySelector(`#metro-dots-${p.id}`);
    const pickerEl = el.querySelector(`#metro-picker-${p.id}`);
    if (!dotsEl) { render(); return; }
    dotsEl.innerHTML  = renderBeatDotsHTML();
    if (pickerEl) pickerEl.innerHTML = renderDotPickerHTML();
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
        <span style="font-size:13px;line-height:1">${icon}</span>
        <span style="display:flex;gap:3px">
          ${Array.from({length:Number(count)},(_,i)=>`<i style="display:block;width:4px;height:4px;border-radius:50%;background:${i===0?'var(--rk-accent)':'#555'}"></i>`).join('')}
        </span>
      </button>`
    ).join('');

    // BPM display — big number, click to edit
    const bpmDisplay = editingBpm
      ? `<input id="bpm-edit-${p.id}" class="rk-edit mono" type="number" min="20" max="300" value="${bpm}">`
      : `<span class="bpm-click mono" title="Click to type a tempo">${bpm}</span>`;

    const fill = ((bpm - 20) / 280 * 100).toFixed(1);

    el.innerHTML = `
      <div class="rk rk-metro">

        <!-- Tempo readout + transport -->
        <div class="rk-readoutrow">
          <button id="mt-${p.id}" class="rk-play${playing ? ' is-playing' : ''}" title="${playing ? 'Stop' : 'Start'}">${playing ? '◼' : '▶'}</button>
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
          <div class="rk-scale"><span>20</span><span>120</span><span>300</span></div>
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

        <!-- Speed trainer -->
        <div class="rk-section">
          <div class="rk-label">PRACTICE</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="spd-toggle rk-chip${speedTrainer.enabled ? ' is-active' : ''}">SPEED TRAINER · +${speedTrainer.increment}</button>
            <span class="mono" style="color:#5a5a5a;font-size:8px;flex:1;line-height:1.4">
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
          <div style="width:1px;height:18px;background:#2a2a2a;margin:0 2px"></div>
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

    // Speed trainer
    el.querySelector('.spd-toggle')?.addEventListener('click', e => {
      e.stopPropagation(); speedTrainer.enabled = !speedTrainer.enabled; syncClock(); render();
    });

    // Start / Stop — single render, no double fire
    document.getElementById(`mt-${p.id}`)?.addEventListener('click', e => {
      e.stopPropagation();
      if (playing) {
        metroClock.stopOthers(p.id);          // master STOP: halt every other pedal clock too
        clearInterval(intv); intv = null;
        playing = false; beat = 0; subTick = 0; barCount = 0;
        metroClock.playing     = false;
        // keep masterSource = 'metronome' even when stopped — a stopped master is still master
        metroClock.setBeat(0, pattern[0]);   // triggers clock listener → renderBeatOnly
        render();                             // full re-render to flip button to START
      } else {
        metroClock.stopOthers(p.id);          // master START: stop any other playing pedal first
        playing = true; barCount = 0;
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
      render();   // full rebuild for new config
    } else if (!playing) {
      // Config unchanged; show beat position driven by an external pedal
      beat = clock.playing ? clock.beat : 0;
      renderBeatOnly();
    }
  });

  // ── Playback engine ───────────────────────────────────────────────────
  const startM = () => {
    clearInterval(intv); intv = null;
    let b = 0; subTick = 0;
    const subs     = getSubdivsPerBeat();
    const interval = 60000 / bpm / subs;

    beat = 1;
    metroClock.playing = true;
    metroClock.setBeat(0, pattern[0]);   // emit without playing sound (see below)
    tickSound(getTickType(0, false));     // beat-0 click
    render();                             // ← single render; button shows STOP, dots highlight beat 1

    intv = setInterval(() => {
      subTick = (subTick + 1) % subs;
      if (subTick === 0) {
        b = (b + 1) % ts;
        beat = b + 1;
        const type = getTickType(b, false);
        tickSound(type);
        metroClock.setBeat(b, type);
        if (b === 0) {
          barCount++;
          if (speedTrainer.enabled && barCount % speedTrainer.everyBars === 0 && bpm < speedTrainer.targetBpm) {
            bpm = Math.min(bpm + speedTrainer.increment, speedTrainer.targetBpm);
            syncClock();
            startM();   // restart with new tempo (returns early after re-setup)
            return;
          }
        }
      } else {
        tickSound('ghost');
      }
      renderBeatOnly();   // fast partial update during playback
    }, interval);
  };

  render();
}
