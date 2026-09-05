const AMP_PRESETS = {
  'Clean':       { gain:.1,  bass:50, mid:50, treble:55, presence:40, reverb:.2  },
  'Crunch':      { gain:.35, bass:55, mid:60, treble:55, presence:50, reverb:.15 },
  'Overdrive':   { gain:.55, bass:50, mid:65, treble:60, presence:55, reverb:.1  },
  'High Gain':   { gain:.8,  bass:60, mid:55, treble:65, presence:60, reverb:.08 },
  'Metal':       { gain:.95, bass:70, mid:45, treble:70, presence:65, reverb:.05 },
  'Jazz Clean':  { gain:.08, bass:40, mid:55, treble:45, presence:35, reverb:.35 },
  'Blues':       { gain:.3,  bass:55, mid:65, treble:50, presence:45, reverb:.25 },
  'Acoustic Sim':{ gain:.05, bass:45, mid:60, treble:65, presence:50, reverb:.3  }
};

export function buildAmpContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let gain     = s.ampGain     ?? 30;
  let bass     = s.ampBass     ?? 50;
  let mid      = s.ampMid      ?? 50;
  let treble   = s.ampTreble   ?? 55;
  let presence = s.ampPresence ?? 40;
  let reverb   = s.ampReverb   ?? 20;
  let presetName = s.ampPreset || 'Clean';
  let active     = s.ampActive || false;

  let ampCtx=null,ampInput=null,ampGain=null,ampDist=null;
  let ampBassF=null,ampMidF=null,ampTrebleF=null,ampPresF=null,ampOut=null;

  function buildChain() {
    if (!ampCtx) ampCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ampInput) try { ampInput.disconnect(); } catch(e) {}
    ampGain = ampCtx.createGain();
    ampGain.gain.value = gain / 100 * 2;
    ampDist = ampCtx.createWaveShaper();
    const curve = new Float32Array(256);
    const amt = gain / 100 * 50;
    for (let i = 0; i < 256; i++) {
      const x = i * 2 / 256 - 1;
      curve[i] = (Math.PI + amt) * x / (Math.PI + amt * Math.abs(x));
    }
    ampDist.curve = curve;
    ampDist.oversample = '4x';
    ampBassF   = ampCtx.createBiquadFilter(); ampBassF.type   = 'lowshelf';  ampBassF.frequency.value   = 200;  ampBassF.gain.value   = (bass   - 50) / 50 * 15;
    ampMidF    = ampCtx.createBiquadFilter(); ampMidF.type    = 'peaking';   ampMidF.frequency.value    = 800;  ampMidF.Q.value = 1;  ampMidF.gain.value    = (mid    - 50) / 50 * 12;
    ampTrebleF = ampCtx.createBiquadFilter(); ampTrebleF.type = 'highshelf'; ampTrebleF.frequency.value = 3000; ampTrebleF.gain.value = (treble - 50) / 50 * 15;
    ampPresF   = ampCtx.createBiquadFilter(); ampPresF.type   = 'highshelf'; ampPresF.frequency.value   = 5000; ampPresF.gain.value   = (presence - 50) / 50 * 10;
    const delay = ampCtx.createDelay(); delay.delayTime.value = 0.03;
    const fb = ampCtx.createGain(); fb.gain.value = reverb / 100 * 0.7;
    const rvMix = ampCtx.createGain(); rvMix.gain.value = reverb / 100 * 0.4;
    ampOut = ampCtx.createGain(); ampOut.gain.value = 0.6;
    ampGain.connect(ampDist); ampDist.connect(ampBassF); ampBassF.connect(ampMidF);
    ampMidF.connect(ampTrebleF); ampTrebleF.connect(ampPresF);
    ampPresF.connect(ampOut); ampPresF.connect(delay);
    delay.connect(fb); fb.connect(delay);
    delay.connect(rvMix); rvMix.connect(ampOut);
    ampOut.connect(ampCtx.destination);
  }

  function loadPreset(name) {
    const pr = AMP_PRESETS[name];
    if (!pr) return;
    gain     = Math.round(pr.gain * 100);
    bass     = pr.bass;
    mid      = pr.mid;
    treble   = pr.treble;
    presence = pr.presence;
    reverb   = Math.round(pr.reverb * 100);
    presetName = name;
    if (active) buildChain();
  }

  function render() {
    const accent = 'var(--rk-accent)';
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px">`;
    h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
    Object.keys(AMP_PRESETS).forEach(name => {
      const sel = presetName === name;
      h += `<button class="chord-btn amp-pr" data-ap="${name}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:2px 5px;${sel ? `background:var(--rk-soft);border-color:var(--rk-line);color:${accent}` : ''}">${name}</button>`;
    });
    h += `</div>`;

    const knobs = [
      ['GAIN', gain, 'ampGain'], ['BASS', bass, 'ampBass'], ['MID', mid, 'ampMid'],
      ['TREBLE', treble, 'ampTreble'], ['PRESENCE', presence, 'ampPres'], ['REVERB', reverb, 'ampRev']
    ];
    knobs.forEach(([label, val, cls]) => {
      // Gain used to ramp green→red, which is exactly the hue range the note
      // spectrum owns. It now ramps along this pedal's OWN lamp instead: cold
      // accent at zero, --rk-hot when it's driven hard. Same "this is getting
      // hot" reading, no argument with what green means on the neck.
      const barCol = cls === 'ampGain'
        ? `color-mix(in srgb, var(--rk-hot) ${val}%, var(--rk-accent))`
        : accent;
      h += `<div style="display:flex;align-items:center;gap:6px">`;
      h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));min-width:48px;text-align:right">${label}</span>`;
      h += `<div style="flex:1;height:6px;background:var(--rk-panel);border-radius:3px;position:relative;cursor:pointer" class="amp-slider" data-ak="${cls}">`;
      h += `<div style="width:${val}%;height:100%;background:${barCol};border-radius:3px"></div>`;
      h += `</div>`;
      h += `<span class="mono" style="color:${accent};font-size:calc(10px*var(--ui));font-weight:700;min-width:22px">${val}</span>`;
      h += `</div>`;
    });

    h += `<button class="amp-toggle mono" style="min-height:calc(28px*var(--ui));background:${active ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${active ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};color:${active ? 'var(--rk-hot)' : 'var(--rk-ink-mute)'};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${active ? '🔴 AMP ON' : '⚪ AMP OFF'}</button>`;
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">Connect Audio Input to route through amp</div>`;
    h += `</div>`;
    el.innerHTML = h;

    el.querySelectorAll('.amp-pr').forEach(b => b.onclick = e => { e.stopPropagation(); loadPreset(b.dataset.ap); render(); });

    el.querySelectorAll('.amp-slider').forEach(sl => {
      const setVal = e => {
        const rect = sl.getBoundingClientRect();
        const pct = Math.round(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)));
        const k = sl.dataset.ak;
        if (k === 'ampGain') gain = pct; else if (k === 'ampBass') bass = pct;
        else if (k === 'ampMid') mid = pct; else if (k === 'ampTreble') treble = pct;
        else if (k === 'ampPres') presence = pct; else if (k === 'ampRev') reverb = pct;
        presetName = 'Custom';
        if (active) buildChain();
        render();
      };
      sl.onmousedown = e => {
        e.stopPropagation(); setVal(e);
        const mv = e2 => setVal(e2);
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      };
    });

    el.querySelector('.amp-toggle').onclick = e => {
      e.stopPropagation(); active = !active;
      if (active) buildChain();
      render();
    };
    Object.assign(s, { ampGain: gain, ampBass: bass, ampMid: mid, ampTreble: treble, ampPresence: presence, ampReverb: reverb, ampPreset: presetName, ampActive: active });
  }

  render();
}
