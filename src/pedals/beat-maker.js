import { metroClock } from '../core/state.js';

// ── Drum synthesis kit ───────────────────────────────────────────────
const DRUM_KITS = {
  kick(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + .12);
    g.gain.setValueAtTime(.8, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .3);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .3);
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .02, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * .3;
    n.buffer = nb;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(.5, t); ng.gain.exponentialRampToValueAtTime(.001, t + .02);
    n.connect(ng); ng.connect(ctx.destination); n.start(t); n.stop(t + .02);
  },
  snare(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .15, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 2000;
    ng.gain.setValueAtTime(.6, t); ng.gain.exponentialRampToValueAtTime(.001, t + .15);
    n.connect(bf); bf.connect(ng); ng.connect(ctx.destination); n.start(t); n.stop(t + .15);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 200;
    og.gain.setValueAtTime(.3, t); og.gain.exponentialRampToValueAtTime(.001, t + .08);
    o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + .08);
  },
  hatClosed(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .04, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 6000;
    ng.gain.setValueAtTime(.3, t); ng.gain.exponentialRampToValueAtTime(.001, t + .04);
    n.connect(bf); bf.connect(ng); ng.connect(ctx.destination); n.start(t); n.stop(t + .04);
  },
  hatOpen(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 6000;
    ng.gain.setValueAtTime(.25, t); ng.gain.exponentialRampToValueAtTime(.001, t + .2);
    n.connect(bf); bf.connect(ng); ng.connect(ctx.destination); n.start(t); n.stop(t + .2);
  },
  ride(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .4, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'bandpass'; bf.frequency.value = 10000; bf.Q.value = 2;
    ng.gain.setValueAtTime(.15, t); ng.gain.exponentialRampToValueAtTime(.001, t + .4);
    n.connect(bf); bf.connect(ng); ng.connect(ctx.destination); n.start(t); n.stop(t + .4);
  },
  tom(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(80, t + .15);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .2);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .2);
  },
  clap(ctx, t) {
    for (let i = 0; i < 3; i++) {
      const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .02, ctx.sampleRate), nd = nb.getChannelData(0);
      for (let j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
      n.buffer = nb;
      const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
      bf.type = 'bandpass'; bf.frequency.value = 1500;
      ng.gain.setValueAtTime(.3, t + i * .015);
      ng.gain.exponentialRampToValueAtTime(.001, t + i * .015 + .04);
      n.connect(bf); bf.connect(ng); ng.connect(ctx.destination);
      n.start(t + i * .015); n.stop(t + i * .015 + .04);
    }
  }
};

// ── Row definitions ──────────────────────────────────────────────────
const DRUM_ROWS = [
  { key: 'kick',      label: 'Kick',  color: '#9977ee' },
  { key: 'snare',     label: 'Snare', color: '#bb88ff' },
  { key: 'hatClosed', label: 'CH',    color: '#8899cc' },
  { key: 'hatOpen',   label: 'OH',    color: '#7799bb' },
  { key: 'ride',      label: 'Ride',  color: '#66aaaa' },
  { key: 'tom',       label: 'Tom',   color: '#aa7799' },
  { key: 'clap',      label: 'Clap',  color: '#cc8888' }
];

// ── Beat presets ─────────────────────────────────────────────────────
const BEAT_PRESETS = {
  'Rock':    { kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] },
  'Pop':     { kick: [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
  'Funk':    { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,0,1], snare: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0] },
  'Hip Hop': { kick: [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] },
  'Jazz':    { ride: [1,0,1,0,0,1,1,0,1,0,1,0,0,1,1,0], kick: [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0], hatClosed: [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0] },
  'Latin':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], tom: [0,0,0,0,1,0,0,1,0,0,0,1,0,0,1,0] },
  'EDM':     { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1] },
  'Reggae':  { kick: [0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], ride: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] },
  'Blues':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], ride: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], hatClosed: [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1] }
};

// ── WAV buffer helper ────────────────────────────────────────────────
function bufferToWaveBlob(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numOfChan * 2 + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);
  function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  let offset = 0;
  writeString(offset, 'RIFF'); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString(offset, 'WAVE'); offset += 4;
  writeString(offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numOfChan * 2, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString(offset, 'data'); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i] || 0));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample | 0, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ── Main builder ─────────────────────────────────────────────────────
export function buildBeatMakerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  const steps = 16;
  let grid = s.bmGrid || {};
  let presetName = s.bmPreset || '';
  let curStep = -1;
  let lastClockConfig = metroClock.getConfigSignature();

  // Clean up any previous interval
  if (p._bmIntv) { clearInterval(p._bmIntv); p._bmIntv = null; }
  if (p._bmPlaying) p._bmPlaying = false;
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._bmPlaying) stopBeat(); });

  // Ensure every row has a full array
  DRUM_ROWS.forEach(r => { if (!grid[r.key]) grid[r.key] = new Array(steps).fill(0); });

  // ── Load a preset ──
  function loadPreset(name) {
    const pr = BEAT_PRESETS[name];
    if (!pr) return;
    DRUM_ROWS.forEach(r => { grid[r.key] = pr[r.key] ? [...pr[r.key]] : new Array(steps).fill(0); });
    presetName = name;
  }

  // ── Play one step ──
  function playStep(stepIdx) {
    if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = p._bmCtx, t = ctx.currentTime;
    DRUM_ROWS.forEach(r => {
      if (grid[r.key] && grid[r.key][stepIdx]) {
        if (DRUM_KITS[r.key]) DRUM_KITS[r.key](ctx, t);
      }
    });
  }

  // ── Start / stop ──
  function startBeat() {
    metroClock.stopOthers(p.id);
    p._bmPlaying = true; curStep = -1;
    const useBpm = metroClock.bpm || 120;
    const stepMs = 60000 / useBpm / 4; // 16th notes
    playStep(0); curStep = 0; metroClock.playing = true; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent'); render();
    p._bmIntv = setInterval(() => {
      curStep = (curStep + 1) % steps;
      const beatIdx = Math.floor(curStep / 4) % Math.max(1, metroClock.ts || 4);
      if (curStep % 4 === 0) { metroClock.playing = true; metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular')); }
      playStep(curStep);
      updateStepDisplay();
    }, stepMs);
  }

  function stopBeat() {
    p._bmPlaying = false;
    clearInterval(p._bmIntv); p._bmIntv = null;
    curStep = -1;
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    render();
  }

  // ── Live step indicator (no full re-render) ──
  function updateStepDisplay() {
    const cells = el.querySelectorAll('.bm-cell');
    cells.forEach(c => {
      const isCur = p._bmPlaying && parseInt(c.dataset.si) === curStep;
      c.style.boxShadow = isCur ? 'inset 0 0 0 2px #fff4' : 'none';
    });
    el.querySelectorAll('.bm-dot').forEach((d, i) => {
      d.style.background = i === curStep ? '#9977ee' : '#2a2a2a';
    });
  }

  // ── Render beat to offline context → WAV blob ──
  async function uploadBeatAsTrack() {
    try {
      const bars = Math.max(1, parseInt(s.bmTrackBars || 1) || 1);
      const bpm = metroClock.bpm || 120;
      const ts  = metroClock.ts || 4;
      const secPerBeat = 60 / bpm;
      const stepDur    = secPerBeat / 4;
      const barDur     = secPerBeat * ts;
      const totalDur   = barDur * bars;
      const tail       = 1.2;
      const sampleRate = 44100;
      const offline = new OfflineAudioContext(2, Math.ceil((totalDur + tail) * sampleRate), sampleRate);

      DRUM_ROWS.forEach(r => {
        const row = grid[r.key] || [];
        for (let bar = 0; bar < bars; bar++) {
          const barOffset = bar * barDur;
          for (let i = 0; i < steps; i++) {
            if (row[i] && DRUM_KITS[r.key]) {
              DRUM_KITS[r.key](offline, barOffset + i * stepDur);
            }
          }
        }
      });

      const rendered = await offline.startRendering();
      const blob = bufferToWaveBlob(rendered);
      const url  = URL.createObjectURL(blob);

      // Dispatch to studio module if available (studio-mode.js listens for this)
      const event = new CustomEvent('resonote:beattrack', {
        detail: {
          url, blob,
          name: (presetName || 'Custom Beat') + ' ' + bars + ' bar' + (bars > 1 ? 's' : ''),
          duration: totalDur, bars
        }
      });
      window.dispatchEvent(event);

      // User feedback
      const msg = document.createElement('div');
      msg.className = 'mono';
      msg.textContent = 'Beat rendered (' + bars + ' bar' + (bars > 1 ? 's' : '') + ') — sent to Studio';
      msg.style.cssText = 'color:#9977ee;font-size:8px;text-align:center;margin-top:4px';
      el.appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
    } catch (err) {
      console.error(err);
      const msg = document.createElement('div');
      msg.className = 'mono';
      msg.textContent = 'Could not render beat: ' + err.message;
      msg.style.cssText = 'color:#ff4444;font-size:8px;text-align:center;margin-top:4px';
      el.appendChild(msg);
      setTimeout(() => msg.remove(), 3000);
    }
  }

  // ── Full render ──────────────────────────────────────────────────────
  function render() {
    const useBpm = metroClock.bpm || 120;
    const accent = '#9977ee';

    let h = `<div style="display:flex;flex-direction:column;gap:5px">`;

    // Preset buttons
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    Object.keys(BEAT_PRESETS).forEach(name => {
      const active = presetName === name;
      h += `<button class="chord-btn bm-preset" data-bp="${name}" style="font-size:7px;padding:2px 5px;${active ? `background:rgba(153,119,238,.15);border-color:${accent};color:${accent}` : ''}">${name}</button>`;
    });
    h += `</div>`;

    // Step indicator dots
    h += `<div style="display:flex;gap:1px;justify-content:flex-end;padding:0 2px 0 34px">`;
    for (let i = 0; i < steps; i++) {
      h += `<div class="bm-dot" style="flex:1;height:3px;border-radius:1px;background:${i === curStep ? accent : '#2a2a2a'}"></div>`;
    }
    h += `</div>`;

    // Grid
    h += `<div style="background:rgba(153,119,238,.03);border:1px solid rgba(153,119,238,.08);border-radius:6px;padding:4px;overflow-x:auto">`;
    DRUM_ROWS.forEach(r => {
      h += `<div style="display:flex;gap:1px;margin-bottom:1px;align-items:center">`;
      h += `<span class="mono" style="color:${r.color};font-size:7px;font-weight:700;min-width:30px;text-align:right;padding-right:4px">${r.label}</span>`;
      for (let i = 0; i < steps; i++) {
        const on         = grid[r.key] && grid[r.key][i];
        const isDownbeat = i % 4 === 0;
        const isCur      = p._bmPlaying && i === curStep;
        const bg         = on ? `${r.color}${isCur ? 'cc' : '88'}` : isCur ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)';
        const border     = isDownbeat ? 'border-left:1.5px solid rgba(153,119,238,.15);' : '';
        const shadow     = isCur ? 'box-shadow:inset 0 0 0 2px #fff4;' : '';
        h += `<div class="bm-cell" data-rk="${r.key}" data-si="${i}" style="flex:1;min-width:14px;height:16px;background:${bg};border-radius:2px;cursor:pointer;transition:background .08s;${border}${shadow}"></div>`;
      }
      h += `</div>`;
    });
    h += `</div>`;

    // Tap preview buttons
    h += `<div style="display:flex;gap:2px">`;
    DRUM_ROWS.forEach(r => {
      h += `<button class="chord-btn bm-tap" data-tk="${r.key}" style="flex:1;font-size:6px;padding:2px 1px;color:${r.color};border-color:${r.color}33">${r.label}</button>`;
    });
    h += `</div>`;

    // Tempo display + Clear
    h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center">`;
    h += `<span class="mono" style="color:#888;font-size:7px">TEMPO</span>`;
    h += `<span class="mono" style="color:#dd8844;font-size:12px;font-weight:700">${useBpm}</span>`;
    h += `<button class="chord-btn bm-clear" style="font-size:7px;margin-left:auto;color:#ff6666;border-color:#ff444433">Clear</button>`;
    h += `</div>`;

    // Track length selector
    h += `<div style="display:flex;gap:6px;align-items:center">`;
    h += `<label class="mono" style="color:#888;font-size:7px;white-space:nowrap">TRACK LEN</label>`;
    h += `<select class="bm-track-bars" style="flex:1;background:#111;border:1px solid rgba(153,119,238,.2);color:#ddd;border-radius:6px;padding:5px 6px;font-size:8px">`;
    [1, 2, 4].forEach(v => { h += `<option value="${v}" ${(s.bmTrackBars || 1) === v ? 'selected' : ''}>${v} bar${v > 1 ? 's' : ''}</option>`; });
    h += `</select></div>`;

    // Upload to studio
    h += `<button class="chord-btn bm-upload-track" style="width:100%;font-size:8px;padding:6px 8px;color:#9977ee;border-color:#9977ee55;background:rgba(153,119,238,.08)">⬆ Upload Beat as Track</button>`;

    // Play / Stop
    const pc = p._bmPlaying ? 'rgba(255,60,60,.2)'      : 'rgba(153,119,238,.15)';
    const pb = p._bmPlaying ? '#ff4444'                  : accent;
    const pt = p._bmPlaying ? '#ff6666'                  : accent;
    h += `<button class="bm-play mono" style="background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">${p._bmPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;

    el.innerHTML = h;

    // ── Wire events ──────────────────────────────────────────────────

    // Grid cells — toggle + instant preview
    el.querySelectorAll('.bm-cell').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      const rk = c.dataset.rk, si = parseInt(c.dataset.si);
      if (grid[rk]) grid[rk][si] = grid[rk][si] ? 0 : 1;
      presetName = '';
      if (grid[rk][si] && DRUM_KITS[rk]) {
        if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
        DRUM_KITS[rk](p._bmCtx, p._bmCtx.currentTime);
      }
      saveGrid();
      render();
    }));

    // Tap preview
    el.querySelectorAll('.bm-tap').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
      const fn = DRUM_KITS[b.dataset.tk];
      if (fn) fn(p._bmCtx, p._bmCtx.currentTime);
    }));

    // Presets
    el.querySelectorAll('.bm-preset').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      loadPreset(b.dataset.bp);
      if (p._bmPlaying) { stopBeat(); startBeat(); } else render();
    }));

    // Clear
    el.querySelector('.bm-clear')?.addEventListener('click', e => {
      e.stopPropagation();
      DRUM_ROWS.forEach(r => { grid[r.key] = new Array(steps).fill(0); });
      presetName = '';
      saveGrid();
      render();
    });

    // Track length
    el.querySelector('.bm-track-bars')?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmTrackBars = parseInt(e.target.value) || 1;
    });

    // Upload to studio
    el.querySelector('.bm-upload-track')?.addEventListener('click', async e => {
      e.stopPropagation();
      await uploadBeatAsTrack();
    });

    // Play / Stop
    el.querySelector('.bm-play')?.addEventListener('click', e => {
      e.stopPropagation();
      if (p._bmPlaying) stopBeat(); else startBeat();
    });
  }

  // ── Persist grid to settings ──
  function saveGrid() {
    s.bmGrid    = grid;
    s.bmPreset  = presetName;
    s.bmTrackBars = s.bmTrackBars || 1;
  }

  // ── React to metroClock BPM changes ──
  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._bmPlaying) { stopBeat(); startBeat(); }
    else render();
  });

  render();
}
