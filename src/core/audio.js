import { NOTES } from './music-theory.js';
import { getInst } from './tuning.js';

// ── Pitch detection utilities ────────────────────────────────────────
export function autoCorrelate(buf, sr) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return -1;

  let r1 = 0, r2 = buf.length - 1;
  const th = 0.2;
  for (let i = 0; i < buf.length / 2; i++) { if (Math.abs(buf[i]) < th) { r1 = i; break; } }
  for (let i = buf.length - 1; i >= buf.length / 2; i--) { if (Math.abs(buf[i]) < th) { r2 = i; break; } }

  const tr  = buf.slice(r1, r2);
  const len = tr.length;
  const co  = new Float32Array(len);
  for (let l = 0; l < len; l++) {
    let s = 0;
    for (let i = 0; i < len - l; i++) s += tr[i] * tr[i + l];
    co[l] = s;
  }

  let d = 0;
  while (co[d] > co[d + 1] && d < len) d++;

  let mv = -1, mp = -1;
  for (let i = d; i < len; i++) { if (co[i] > mv) { mv = co[i]; mp = i; } }
  if (mp <= 0) return -1;

  const y1 = co[mp - 1] || 0, y2 = co[mp], y3 = co[mp + 1] || 0;
  const sh = (y3 - y1) / (2 * (2 * y2 - y1 - y3));
  return sr / (mp + (isNaN(sh) ? 0 : sh));
}

export function freqToNote(f) {
  if (f <= 0) return null;
  const nn = 12 * Math.log2(f / 440);
  const rn = Math.round(nn);
  const c  = Math.round((nn - rn) * 100);
  const mi = rn + 69;
  return { note: NOTES[((mi % 12) + 12) % 12], octave: Math.floor(mi / 12) - 1, cents: c, freq: f };
}

// ── Audio input object ───────────────────────────────────────────────
export const audio = {
  connected: false, connecting: false,
  devices: [], selectedDeviceId: '',
  inputGain: 80, noiseGate: 15,
  detected: null, rms: 0, error: null,
  _ctx: null, _analyser: null, _gainNode: null, _stream: null, _anim: null,
  listeners: [],
  on(fn)   { this.listeners.push(fn); },
  emit()   { this.listeners.forEach(fn => fn(this)); },

  async enumerate() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      this.devices = d.filter(x => x.kind === 'audioinput');
      if (!this.selectedDeviceId && this.devices.length)
        this.selectedDeviceId = this.devices[0].deviceId;
      this.emit();
    } catch(e) {}
  },

  // Grant permission with a temporary stream so device LABELS become visible
  // (browsers hide them until access is granted), then release it. This lets the
  // user actually SEE and pick their Focusrite before committing to connect.
  async primeLabels() {
    this.error = null; this.emit();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const d = await navigator.mediaDevices.enumerateDevices();
      this.devices = d.filter(x => x.kind === 'audioinput');
      s.getTracks().forEach(t => t.stop());
      // Prefer an interface that looks like a guitar/audio interface over the built-in mic.
      const iface = this.devices.find(x => /focusrite|scarlett|usb|interface|audio|line/i.test(x.label));
      if (iface && (!this.selectedDeviceId || !this.devices.some(x => x.deviceId === this.selectedDeviceId)))
        this.selectedDeviceId = iface.deviceId;
      this.emit();
      return true;
    } catch (e) {
      this.error = e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Click the 🎤 / lock icon in your browser’s address bar, allow access, then try again.'
        : 'Could not list audio devices: ' + (e.message || e.name);
      this.emit();
      return false;
    }
  },

  disconnect() {
    cancelAnimationFrame(this._anim);
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._stream = null; this._ctx = null; this._analyser = null;
    this.connected = false; this.detected = null; this.rms = 0;
    this.emit();
  },

  async connect(did) {
    this.disconnect();
    this.connecting = true; this.error = null; this.emit();
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    try {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: did ? { ...base, deviceId: { exact: did } } : base });
      } catch (err) {
        // The exact device is gone/renamed (e.g. Focusrite re-enumerated) — fall back to the default input.
        if (did && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
          s = await navigator.mediaDevices.getUserMedia({ audio: base });
          did = '';
        } else throw err;
      }
      this._stream = s;
      const d = await navigator.mediaDevices.enumerateDevices();
      this.devices = d.filter(x => x.kind === 'audioinput');
      // Record which device we actually got (the track knows), so the UI shows the truth.
      const actualId = s.getAudioTracks()[0]?.getSettings?.().deviceId || did || this.devices[0]?.deviceId || '';

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._ctx = ctx;
      const src = ctx.createMediaStreamSource(s);
      const gn  = ctx.createGain();
      gn.gain.value = this.inputGain / 100;
      this._gainNode = gn;
      const an = ctx.createAnalyser();
      an.fftSize = 4096; an.smoothingTimeConstant = 0.8;
      src.connect(gn); gn.connect(an);
      this._analyser = an;

      this.connected = true; this.connecting = false;
      this.selectedDeviceId = actualId;
      this.emit();

      const buf = new Float32Array(an.fftSize);
      const self = this;
      (function loop() {
        an.getFloatTimeDomainData(buf);
        let rv = 0;
        for (let i = 0; i < buf.length; i++) rv += buf[i] * buf[i];
        rv = Math.sqrt(rv / buf.length);
        const db   = 20 * Math.log10(Math.max(rv, 0.00001));
        const gate = -60 + (self.noiseGate / 100) * 50;
        self.rms = Math.min(1, rv * 8);
        if (db > gate) {
          const freq  = autoCorrelate(buf, ctx.sampleRate);
          const range = getInst().freqRange;
          if (freq > range[0] && freq < range[1]) self.detected = freqToNote(freq);
        } else {
          self.detected = null;
        }
        self.emit();
        self._anim = requestAnimationFrame(loop);
      })();
    } catch(e) {
      this.connecting = false;
      this.error = e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Click the 🎤 / lock icon in your browser’s address bar, allow access, then click Connect again.'
        : e.name === 'NotFoundError'
        ? 'No audio input found. Make sure your Focusrite is plugged in and selected, then hit ⟳ Refresh.'
        : 'Could not connect to the input: ' + (e.message || e.name);
      this.emit();
    }
  },

  setGain(v)   { this.inputGain  = v; if (this._gainNode) this._gainNode.gain.value = v / 100; this.emit(); },
  setGate(v)   { this.noiseGate  = v; this.emit(); },
  setDevice(id){ this.selectedDeviceId = id; if (this.connected) this.connect(id); else this.emit(); }
};

// ── Simple note playback (click/preview) ─────────────────────────────
export function playClickedNote(note, octave) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (octave - 4));
    g.gain.value = 0.25;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// Kick off device enumeration immediately
audio.enumerate();

// Refresh the device list when hardware is plugged in/out (e.g. the Focusrite).
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (!audio.connected) audio.enumerate();
});
