import { audio } from '../core/audio.js';
import { makeKnob } from '../ui/pedal-system.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const AUDIO_THEORY = {
  kicker: 'SIGNAL', title: 'Direct input — gain & noise gate',
  what: `Plug your guitar straight in (a <b>DI</b> signal — no amp needed). <b>Gain</b> sets how hot the signal is: enough to detect cleanly, not so much it clips. The <b>noise gate</b> mutes everything below a threshold so hum and stray string noise don't trigger false notes.`,
  why: `A clean, well-gated signal is what lets the Tuner, Ear Trainer and every play-along drill hear you accurately. Set gain so the level meter peaks around <b>70–80%</b> when you dig in, and raise the gate until background hiss stops registering on the meter.`,
  lessonId: 'audio-setup',
};

export function buildAudioContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  el.innerHTML = `
    <div class="rk rk-audio" style="--rk-accent:#00cc88">
      <div class="rk-section">
        <div class="rk-label">INPUT DEVICE</div>
        <div style="display:flex;gap:6px">
          <select id="dev-${p.id}" style="flex:1;min-width:0"></select>
          <button id="find-${p.id}" class="mono" title="Allow mic access & list your devices by name" style="border-radius:8px;padding:0 10px;cursor:pointer;font-size:13px;background:rgba(255,255,255,.06);border:1px solid #555;color:#ccc">⟳</button>
        </div>
        <div id="hint-${p.id}" class="mono" style="font-size:9px;color:#888;margin-top:5px;line-height:1.4"></div>
      </div>
      <button id="conn-${p.id}" class="mono" style="border-radius:8px;padding:8px 16px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%"></button>
      <div id="err-${p.id}" class="mono" style="display:none;font-size:10px;line-height:1.45;padding:7px 9px;border-radius:7px;background:rgba(255,80,90,.1);border:1px solid rgba(255,80,90,.4);color:#ff9098"></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="mono" style="color:#666;font-size:9px;width:30px">LVL</span>
        <div style="flex:1;height:9px;background:#161616;border-radius:5px;overflow:hidden;border:1px solid #2a2a2a">
          <div id="lvl-${p.id}" style="height:100%;width:0%;border-radius:5px;transition:width .05s"></div>
        </div>
      </div>
      <div style="display:flex;gap:20px;justify-content:center">
        <div id="kg-${p.id}"></div>
        <div id="kgt-${p.id}"></div>
      </div>
      <div id="st-${p.id}" class="mono" style="text-align:center;padding:4px 0;color:#444;font-size:11px">Connect your guitar</div>
      ${theoryPanelHTML('audio', AUDIO_THEORY)}
    </div>`;

  wireTheoryPanel(el);

  const upd = () => {
    const sel = document.getElementById(`dev-${p.id}`);
    if (sel && sel !== document.activeElement) {
      sel.innerHTML = audio.devices.length === 0 ? '<option>No devices</option>' : '';
      audio.devices.forEach(d => {
        sel.innerHTML += `<option value="${d.deviceId}"${d.deviceId === audio.selectedDeviceId ? ' selected' : ''}>${d.label || ('Input ' + d.deviceId.slice(0,8) + '...')}</option>`;
      });
    }
    const btn = document.getElementById(`conn-${p.id}`);
    if (btn) {
      btn.style.background = audio.connected ? 'rgba(0,255,136,.15)' : audio.connecting ? 'rgba(255,170,0,.15)' : 'rgba(255,255,255,.06)';
      btn.style.border     = `1px solid ${audio.connected ? '#00ff88' : audio.connecting ? '#ffaa00' : '#555'}`;
      btn.style.color      = audio.connected ? '#00ff88' : audio.connecting ? '#ffaa00' : '#ccc';
      btn.textContent      = audio.connected ? '⚡ CONNECTED' : audio.connecting ? 'CONNECTING...' : '🔌 CONNECT INPUT';
    }
    const hasLabels = audio.devices.some(d => d.label);
    const hint = document.getElementById(`hint-${p.id}`);
    if (hint) {
      hint.innerHTML = audio.connected
        ? `✓ Live on <b style="color:#bbb">${(audio.devices.find(d => d.deviceId === audio.selectedDeviceId)?.label) || 'input'}</b>. Wrong one? Pick your Focusrite above — it switches instantly.`
        : !hasLabels
          ? `Tap <b style="color:#bbb">⟳</b> to allow mic access — your devices will then show by name so you can pick the <b style="color:#bbb">Focusrite</b>.`
          : `Pick your <b style="color:#bbb">Focusrite</b> from the list, then hit Connect.`;
    }
    const err = document.getElementById(`err-${p.id}`);
    if (err) {
      err.style.display = audio.error ? 'block' : 'none';
      if (audio.error) err.textContent = '⚠ ' + audio.error;
    }
    const lv = document.getElementById(`lvl-${p.id}`);
    if (lv) {
      lv.style.width      = `${audio.rms * 100}%`;
      lv.style.background = audio.rms > 0.8 ? 'linear-gradient(90deg,#00ff88,#ff4466)' : 'linear-gradient(90deg,#00ff88,#00ccff)';
    }
    makeKnob(`kg-${p.id}`,  audio.inputGain, 0, 100, 'Gain', '#00ff88', v => audio.setGain(v));
    makeKnob(`kgt-${p.id}`, audio.noiseGate, 0, 100, 'Gate', '#ffaa00', v => audio.setGate(v));
    const st = document.getElementById(`st-${p.id}`);
    if (st) {
      st.style.color = audio.detected ? '#00ccff' : '#444';
      st.textContent = audio.connected
        ? (audio.detected ? `${audio.detected.note}${audio.detected.octave} · ${audio.detected.freq.toFixed(1)} Hz` : 'Listening...')
        : 'Connect your guitar';
    }
  };

  audio.on(upd);
  upd();

  document.getElementById(`dev-${p.id}`).onchange = e => audio.setDevice(e.target.value);
  document.getElementById(`conn-${p.id}`).onclick = () =>
    audio.connected ? audio.disconnect() : audio.connect(audio.selectedDeviceId);
  document.getElementById(`find-${p.id}`).onclick = () => audio.primeLabels();
}
