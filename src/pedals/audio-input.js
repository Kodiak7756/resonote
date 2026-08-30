import { audio } from '../core/audio.js';
import { makeKnob } from '../ui/pedal-system.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

// Tuner view (merged from the former Chromatic Tuner pedal — one Input pedal now
// covers connect/gain/gate AND tuning, since the tuner is useless without the input).
const TUNER_THEORY = {
  kicker: 'PITCH', title: 'Tuning — cents & equal temperament',
  what: `The tuner listens to your string, names the nearest note, and shows how far off you are in <b>cents</b> (a cent is 1/100 of a semitone). The needle says which way to turn the peg: left of centre = <b>♭ flat</b> (tune up), right = <b>♯ sharp</b> (tune down). The green light means you're within 5¢ — dead in tune.`,
  why: `Guitars use <b>equal temperament</b> — the octave split into 12 equal steps — so every key sounds equally (and very slightly) tempered, and you can play in any key without re-tuning. In-tune strings are the foundation of everything: chords ring, intervals lock, and your ear learns true pitch. Tune before every session.`,
  lessonId: 'tuning-basics',
};

const AUDIO_THEORY = {
  kicker: 'SIGNAL', title: 'Direct input — gain & noise gate',
  what: `Plug your guitar straight in (a <b>DI</b> signal — no amp needed). <b>Gain</b> sets how hot the signal is: enough to detect cleanly, not so much it clips. The <b>noise gate</b> mutes everything below a threshold so hum and stray string noise don't trigger false notes.`,
  why: `A clean, well-gated signal is what lets the Tuner, Ear Trainer and every play-along drill hear you accurately. Set gain so the level meter peaks around <b>70–80%</b> when you dig in, and raise the gate until background hiss stops registering on the meter.`,
  lessonId: 'audio-setup',
};

// kit.css ships two judgement colours — --rk-ok and --rk-bad — both picked OFF the
// note wheel (odd multiples of 15°, so 15° from every fifth, at ≤46% saturation
// against the spectrum's 78%) precisely so a verdict can never be misread as a
// pitch. A tuner and a level meter need a third: "close, but not there yet".
// Declared here on the pedal's own root, to the same rules — 45° is dead centre
// between G (30°) and D (60°), the furthest a 30°-spaced wheel allows.
const JUDGE_TOKENS = '--rk-warn:hsl(45,44%,62%)';

export function buildAudioContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  let view = s.aview || 'input';   // 'input' | 'tuner'

  function render() {
    // INPUT and TUNER are two views of ONE pedal, so the tab only says which is
    // active — it does not repaint the enclosure. Both wear the card's accent.
    const tabBtn = (v, label) => `<button class="ai-view mono" data-v="${v}" style="flex:1;padding:5px;border-radius:6px;border:1px solid ${view === v ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};background:${view === v ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};color:${view === v ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};font-size:calc(9px*var(--ui));font-weight:700;letter-spacing:1px;cursor:pointer">${label}</button>`;
    const tabs = `<div style="display:flex;gap:5px;margin-bottom:8px">${tabBtn('input', '🎛 INPUT')}${tabBtn('tuner', '🎯 TUNER')}</div>`;

    if (view === 'tuner') {
      el.innerHTML = `
    <div class="rk rk-tuner" style="${JUDGE_TOKENS}">
      ${tabs}
      <div id="tw-${p.id}" class="rk-chip" style="display:none;color:var(--rk-bad);border-color:var(--rk-bad);align-self:center">⚠ Connect audio input first</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:11px;padding:8px 0">
        <div id="tn-${p.id}" class="mono" style="font-size:calc(46px*var(--ui));font-weight:900;color:var(--rk-edge);line-height:1">—</div>
        <div style="width:100%;max-width:220px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">♭ flat</span>
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">in&nbsp;tune</span>
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">sharp ♯</span>
          </div>
          <div style="width:100%;height:10px;background:var(--rk-panel);border-radius:5px;position:relative;border:1px solid var(--rk-edge-soft)">
            <div style="position:absolute;top:-2px;left:50%;width:2px;height:14px;background:var(--rk-ink-mute);transform:translateX(-50%);z-index:2"></div>
            <div id="ti-${p.id}" style="position:absolute;top:-3px;width:7px;height:16px;border-radius:3px;left:50%;transform:translateX(-50%);transition:left .1s;display:none"></div>
          </div>
        </div>
        <div style="display:flex;gap:18px;align-items:center">
          <span id="th-${p.id}" class="mono" style="color:var(--rk-ink-dim);font-size:calc(11px*var(--ui))">— Hz</span>
          <div id="tl-${p.id}" style="width:16px;height:16px;border-radius:50%;background:var(--rk-panel);border:2px solid var(--rk-edge)"></div>
          <span id="tc-${p.id}" class="mono" style="color:var(--rk-ink-dim);font-size:calc(11px*var(--ui));font-weight:700">—¢</span>
        </div>
      </div>
      ${theoryPanelHTML('tuner', TUNER_THEORY)}
    </div>`;
    } else {
      el.innerHTML = `
    <div class="rk rk-audio" style="${JUDGE_TOKENS}">
      ${tabs}
      <div class="rk-section">
        <div class="rk-label">INPUT DEVICE</div>
        <div style="display:flex;gap:6px">
          <select id="dev-${p.id}" style="flex:1;min-width:0"></select>
          <button id="find-${p.id}" class="mono" title="Allow mic access & list your devices by name" style="border-radius:8px;padding:0 10px;cursor:pointer;font-size:calc(13px*var(--ui));background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink)">⟳</button>
        </div>
        <div id="hint-${p.id}" class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-dim);margin-top:5px;line-height:1.4"></div>
      </div>
      <button id="conn-${p.id}" class="mono" style="border-radius:8px;padding:8px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%"></button>
      <div id="err-${p.id}" class="mono" style="display:none;font-size:calc(10px*var(--ui));line-height:1.45;padding:7px 9px;border-radius:7px;background:color-mix(in srgb, var(--rk-bad) 12%, transparent);border:1px solid color-mix(in srgb, var(--rk-bad) 45%, transparent);color:var(--rk-bad)"></div>
      <div id="sil-${p.id}" style="display:none;font-size:calc(10px*var(--ui));line-height:1.55;padding:8px 10px;border-radius:7px;background:color-mix(in srgb, var(--rk-bad) 8%, transparent);border:1px solid color-mix(in srgb, var(--rk-bad) 38%, transparent);color:var(--rk-ink)"></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui));width:30px">LVL</span>
        <div style="flex:1;height:9px;background:var(--rk-panel);border-radius:5px;border:1px solid var(--rk-edge-soft);position:relative;overflow:hidden">
          <div id="lvl-${p.id}" style="height:100%;width:0%;border-radius:5px;transition:width .05s"></div>
          <!-- −12 dBFS: aim the loudest strum just under this -->
          <div style="position:absolute;top:0;bottom:0;left:80%;width:1px;background:var(--rk-edge)"></div>
          <div id="pk-${p.id}" style="display:none;position:absolute;top:0;bottom:0;width:2px;background:var(--rk-ink)"></div>
        </div>
        <span id="db-${p.id}" class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui));width:56px;text-align:right">— dB</span>
      </div>
      <div style="display:flex;gap:20px;justify-content:center">
        <div id="kg-${p.id}"></div>
        <div id="kgt-${p.id}"></div>
      </div>
      <div id="units-${p.id}" class="mono" style="text-align:center;color:var(--rk-ink-dim);font-size:calc(9px*var(--ui))"></div>
      <div id="diag-${p.id}" class="mono" style="display:none;font-size:calc(9px*var(--ui));color:var(--rk-ink-mute);line-height:1.6;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:7px;padding:6px 8px"></div>
      <div id="st-${p.id}" class="mono" style="text-align:center;padding:4px 0;color:var(--rk-ink-mute);font-size:calc(11px*var(--ui))">Connect your guitar</div>
      ${theoryPanelHTML('audio', AUDIO_THEORY)}
    </div>`;
    }

    wireTheoryPanel(el);
    el.querySelectorAll('.ai-view').forEach(b => b.onclick = e => { e.stopPropagation(); view = b.dataset.v; s.aview = view; render(); upd(); });
    if (view === 'input') {
      document.getElementById(`dev-${p.id}`).onchange = e => audio.setDevice(e.target.value);
      document.getElementById(`conn-${p.id}`).onclick = () =>
        audio.connected ? audio.disconnect() : audio.connect(audio.selectedDeviceId);
      document.getElementById(`find-${p.id}`).onclick = () => audio.primeLabels();
    }
  }

  // ── tuner needle updater (no-ops when the input view is mounted) ──
  const updTuner = () => {
    const det = audio.detected, cn = audio.connected;
    const w = document.getElementById(`tw-${p.id}`);
    if (w) {
      // A needle that never moves is the same picture whether the input is dead or
      // you simply haven't played yet — so say which it is.
      const bad = !cn || audio.silent || audio.neverHeard;
      w.style.display = bad ? 'block' : 'none';
      if (bad) w.textContent = cn ? '⚠ Connected, but no signal — see 🎛 INPUT' : '⚠ Connect audio input first';
    }
    const c  = det?.cents || 0;
    // ZONE COLOURS ARE NOT CHROME. Flat/in-tune/sharp is a reading off an
    // instrument, and it has to mean the same thing on every pedal in every
    // family — if "sharp" were the enclosure's accent the tuner would be useless.
    // But "not the accent" does not mean "any green": in-tune used to be #00ff88,
    // hue 152 at full saturation, and B lives at 150° in the note code — so on a
    // screen where the detected LETTER sits next to the LED and the fretboard draws
    // B below it, "you're in tune" and "this is B" were the same green, with the
    // chrome shouting louder than the lesson. The judgement register says the same
    // green-amber-red at saturations no note is allowed to reach.
    const zone = Math.abs(c) < 5 ? 'var(--rk-ok)' : Math.abs(c) < 15 ? 'var(--rk-warn)' : 'var(--rk-bad)';
    // the halo is the same verdict at low alpha — color-mix because you cannot
    // staple a hex alpha pair onto a var()
    const halo = pct => `color-mix(in srgb, ${zone} ${pct}, transparent)`;
    const cc   = det ? zone : 'var(--rk-ink-mute)';
    const n = document.getElementById(`tn-${p.id}`);
    if (n) {
      n.textContent      = det ? det.note : '—';
      n.style.color      = det ? zone : 'var(--rk-edge)';
      n.style.textShadow = det ? `0 0 25px ${halo('33%')}` : 'none';
    }
    const ind = document.getElementById(`ti-${p.id}`);
    if (ind) {
      ind.style.display    = det ? 'block' : 'none';
      ind.style.left       = `${50 + c / 2}%`;
      ind.style.background  = zone;
      ind.style.boxShadow   = `0 0 8px ${halo('53%')}`;
    }
    const hz = document.getElementById(`th-${p.id}`);
    if (hz) hz.textContent = det ? `${det.freq.toFixed(1)} Hz` : '— Hz';
    const ct = document.getElementById(`tc-${p.id}`);
    if (ct) { ct.textContent = det ? `${c > 0 ? '+' : ''}${c}¢` : '—¢'; ct.style.color = cc; }
    const led = document.getElementById(`tl-${p.id}`);
    const it  = det && Math.abs(c) < 5;
    if (led) {
      led.style.background  = it ? 'var(--rk-ok)' : 'var(--rk-panel)';
      led.style.borderColor = it ? 'var(--rk-ok)' : 'var(--rk-edge)';
      led.style.boxShadow   = it ? '0 0 20px color-mix(in srgb, var(--rk-ok) 60%, transparent)' : 'none';
    }
  };

  // ── input view updater (no-ops when the tuner view is mounted) ──
  const updInput = () => {
    const sel = document.getElementById(`dev-${p.id}`);
    if (sel && sel !== document.activeElement) {
      sel.innerHTML = audio.devices.length === 0 ? '<option>No devices</option>' : '';
      audio.devices.forEach(d => {
        sel.innerHTML += `<option value="${d.deviceId}"${d.deviceId === audio.selectedDeviceId ? ' selected' : ''}>${d.label || ('Input ' + d.deviceId.slice(0,8) + '...')}</option>`;
      });
    }
    const btn = document.getElementById(`conn-${p.id}`);
    if (btn) {
      // Connected = this pedal is live, which the kit expresses as --rk-hot: the
      // pedal's own lamp turned up, the same way .rk-play.is-playing does it.
      btn.style.background = audio.connected ? 'var(--rk-soft2)' : audio.connecting ? 'var(--rk-soft)' : 'var(--rk-panel2)';
      btn.style.border     = `1px solid ${audio.connected ? 'var(--rk-hot)' : audio.connecting ? 'var(--rk-line)' : 'var(--rk-edge-soft)'}`;
      btn.style.color      = audio.connected ? 'var(--rk-hot)' : audio.connecting ? 'var(--rk-dim)' : 'var(--rk-ink)';
      btn.textContent      = audio.connected ? '⚡ CONNECTED' : audio.connecting ? 'CONNECTING...' : '🔌 CONNECT INPUT';
    }
    const hasLabels = audio.devices.some(d => d.label);
    const hint = document.getElementById(`hint-${p.id}`);
    if (hint) {
      // The track's own label is the truth — the <select> can be showing a device
      // the browser quietly declined to give us.
      const on = audio.diag?.label || audio.devices.find(d => d.deviceId === audio.selectedDeviceId)?.label || 'input';
      // "Live" has to mean a sample actually arrived. Saying it because getUserMedia
      // returned is how you spend an hour turning knobs on a dead input.
      hint.innerHTML = audio.connected
        ? (audio.silent || audio.neverHeard
            ? `⚠ Open on <b style="color:var(--rk-ink)">${on}</b> — but nothing is coming through it. Wrong input? Pick another above; it switches instantly.`
            : !audio._everHeard
              ? `Open on <b style="color:var(--rk-ink)">${on}</b> — waiting for signal. Play something.`
              : `✓ Live on <b style="color:var(--rk-ink)">${on}</b>. Wrong one? Pick your Focusrite above — it switches instantly.`)
        : !hasLabels
          ? `Tap <b style="color:var(--rk-ink)">⟳</b> to allow mic access — your devices will then show by name so you can pick the <b style="color:var(--rk-ink)">Focusrite</b>.`
          : `Pick your <b style="color:var(--rk-ink)">Focusrite</b> from the list, then hit Connect.`;
    }
    const err = document.getElementById(`err-${p.id}`);
    if (err) {
      err.style.display = audio.error ? 'block' : 'none';
      if (audio.error) err.textContent = '⚠ ' + audio.error;
    }
    const lv = document.getElementById(`lvl-${p.id}`);
    if (lv) {
      lv.style.width      = `${audio.rms * 100}%`;
      // Meter zones are a reading, not chrome — healthy green, clipping red, the
      // same on every input in the world. Same judgement register as the tuner's
      // needle, for the same reason: the old ramp ran #00ff88 → #00ccff, hues 152
      // and 192, which is B and a near-F# at a saturation no note here may use.
      lv.style.background = audio.rms > 0.8
        ? 'linear-gradient(90deg,var(--rk-ok),var(--rk-bad))'
        : 'linear-gradient(90deg,var(--rk-ok),var(--rk-warn))';
    }
    // A number, not just a bar. "−52 dB" and "no signal at all" look identical on a
    // bar, and they are completely different problems.
    const dbEl = document.getElementById(`db-${p.id}`);
    if (dbEl) {
      const live = audio.connected && audio.dbfs > -Infinity;
      dbEl.textContent = !audio.connected ? '— dB' : live ? `${audio.dbfs.toFixed(0)} dB` : 'silent';
      dbEl.style.color = !audio.connected ? 'var(--rk-ink-mute)' : !live ? 'var(--rk-warn)' : audio.dbfs > -3 ? 'var(--rk-bad)' : 'var(--rk-ok)';
    }
    const pk = document.getElementById(`pk-${p.id}`);
    if (pk) {
      const hold = audio.peakHold;
      const show = audio.connected && hold > -60;
      pk.style.display = show ? 'block' : 'none';
      if (show) pk.style.left = `${Math.min(100, Math.max(0, (hold + 60) / 60 * 100))}%`;
    }
    // Only rebuild a knob when its value actually changed — this used to run on
    // every animation frame, which meant grabbing a knob that was being replaced
    // 60 times a second underneath the cursor.
    if (document.getElementById(`kg-${p.id}`)) {
      if (p._kGain !== audio.inputGain || !document.querySelector(`#kg-${p.id} .knob-dial`)) {
        p._kGain = audio.inputGain;
        // Gain is the pedal's headline control, Gate the quiet one behind it —
        // one accent, two values, instead of two unrelated saturated hues.
        makeKnob(`kg-${p.id}`,  audio.inputGain, 0, 100, 'Gain', 'var(--rk-accent)', v => audio.setGain(v));
      }
      if (p._kGate !== audio.noiseGate || !document.querySelector(`#kgt-${p.id} .knob-dial`)) {
        p._kGate = audio.noiseGate;
        makeKnob(`kgt-${p.id}`, audio.noiseGate, 0, 100, 'Gate', 'var(--rk-dim)', v => audio.setGate(v));
      }
    }
    // The knobs are in dB — say so, so the numbers mean something.
    const units = document.getElementById(`units-${p.id}`);
    if (units) units.innerHTML = `trim <b style="color:var(--rk-accent)">${audio.gainDb() >= 0 ? '+' : ''}${audio.gainDb().toFixed(1)} dB</b>`
      + ` · gate opens at <b style="color:var(--rk-dim)">${audio.gateDb().toFixed(0)} dB</b>`;

    // Silence gets diagnosed, not hidden behind a healthy-looking "✓ Live".
    const sil = document.getElementById(`sil-${p.id}`);
    if (sil) {
      // Reaches a noise-floor-only input too, not just a numerically dead one.
      const show = audio.connected && (audio.silent || audio.neverHeard);
      sil.style.display = show ? 'block' : 'none';
      if (show) sil.innerHTML = `<b>Connected, but no signal is reaching the app${
        audio.devicePeak > -Infinity && audio.devicePeak < -75 ? ` — the loudest thing this input has sent is ${audio.devicePeak.toFixed(0)} dB, which is just the noise floor` : ''}.</b><br>`
        + audio.silentAdvice().map(a => `• ${a}`).join('<br>');
    }
    const diag = document.getElementById(`diag-${p.id}`);
    if (diag) {
      const d = audio.diag;
      diag.style.display = audio.connected && d ? 'block' : 'none';
      if (audio.connected && d) {
        const raw = d.rawDbfs > -Infinity ? `${d.rawDbfs.toFixed(0)} dB` : 'silent';
        // The peak SINCE CONNECT is the number that settles the argument: a device
        // whose loudest moment is −85 dB has never had a guitar in it.
        const pk = d.devicePeak > -Infinity ? `, peak ${d.devicePeak.toFixed(0)}` : '';
        diag.innerHTML =
          `device <b style="color:var(--rk-ink)">${raw}${pk}</b> → after trim <b style="color:var(--rk-ink)">${d.dbfs > -Infinity ? d.dbfs.toFixed(0) + ' dB' : 'silent'}</b>`
        + (d.channels ? ` · ${d.channels} ch` : '')
        + ` · ${(d.sampleRate / 1000).toFixed(1)} kHz`
        + ` · engine <b style="color:${d.ctxState === 'running' ? 'var(--rk-ok)' : 'var(--rk-bad)'}">${d.ctxState}</b>`
        + (d.trackMuted ? ` · <b style="color:var(--rk-bad)">muted by the system</b>` : '');
      }
    }
    const st = document.getElementById(`st-${p.id}`);
    if (st) {
      // "Under the gate" is only honest advice if the input has actually been heard —
      // otherwise it sends you to the knobs for a problem the knobs can't touch.
      const dead  = audio.silent || audio.neverHeard;
      const quiet = audio.connected && !dead && audio._everHeard && audio.dbfs <= audio.gateDb();
      st.style.color = audio.detected ? 'var(--rk-hot)' : quiet ? 'var(--rk-bad)' : 'var(--rk-ink-mute)';
      st.textContent = !audio.connected ? 'Connect your guitar'
        : audio.detected ? `${audio.detected.note}${audio.detected.octave} · ${audio.detected.freq.toFixed(1)} Hz`
        : dead           ? 'No signal reaching the app'
        : quiet          ? 'Hearing you, but under the gate — turn Gate down or Gain up'
        : 'Listening...';
    }
  };

  const upd = () => { updInput(); updTuner(); };
  audio.on(upd);
  render();
  upd();
}
