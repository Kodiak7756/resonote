import { NOTES } from './music-theory.js';
import { getInst } from './tuning.js';
import { audioCtx } from './pulse.js';
import { bus } from './mixer.js';

// ── Pitch detection utilities ────────────────────────────────────────
// minRms is the quietest signal worth analysing. It used to be hard-coded at
// 0.008 (≈ −42 dBFS), which is ABOVE where a conservatively-set guitar DI often
// sits — so the tuner could be deaf no matter where the player put the gate knob.
// The caller passes it in now, derived from that knob.
export function autoCorrelate(buf, sr, minRms = 0.008) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < minRms) return -1;

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
  // GAIN is now a real trim in dB, not a 0..unity attenuator: 50 = unity, 100 =
  // +20 dB, 0 = −20 dB. A DI can be 20 dB quieter than a mic, and the old knob
  // could only ever make it quieter.
  inputGain: 50, noiseGate: 15,
  detected: null, rms: 0, error: null,
  // What the input is ACTUALLY doing — so the pedal can stop guessing. dbfs is
  // measured after the gain trim (what the tuner hears), rawDbfs before it (what
  // the device is sending). Those two disagreeing is the whole diagnosis.
  dbfs: -Infinity, rawDbfs: -Infinity, peakHold: -Infinity, devicePeak: -Infinity,
  silent: false, neverHeard: false, diag: null,
  _ctx: null, _analyser: null, _rawAnalyser: null, _gainNode: null, _stream: null, _anim: null,
  _track: null, _silentSince: 0, _lastEmit: 0, _frame: 0, _everHeard: false, _connectedAt: 0,
  listeners: [],
  on(fn)   { this.listeners.push(fn); },
  emit()   { this.listeners.forEach(fn => fn(this)); },
  // The analysis loop runs at frame rate; the UI does not need to. Rebuilding the
  // pedal's DOM (a <select>, two knobs) 60×/s was making the controls fight the
  // player for the mouse.
  emitThrottled(now) {
    if (now - this._lastEmit < 66) return;
    this._lastEmit = now;
    this.emit();
  },
  gainFactor(v = this.inputGain) { return Math.pow(10, (v - 50) / 50); },
  gainDb(v = this.inputGain)     { return Math.round((v - 50) * 0.4 * 10) / 10; },
  gateDb()                       { return -60 + (this.noiseGate / 100) * 50; },

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
  // user actually SEE and pick their interface before committing to connect.
  async primeLabels() {
    this.error = null; this.emit();
    // No mediaDevices at all means an INSECURE context: the app was opened over
    // plain http on a LAN address (http://192.168.x.x:5173), which is exactly what
    // sharing a dev server invites. Browsers hide the mic there, and the raw
    // TypeError that follows says nothing a friend can act on. Say the real thing.
    if (!navigator.mediaDevices) {
      this.error = 'The mic only works on localhost or over https. Open http://localhost:5173 on this machine, or host the app with https.';
      this.emit(); return false;
    }
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
    clearInterval(this._anim);
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._stream = null; this._ctx = null; this._analyser = null; this._rawAnalyser = null;
    this._track = null; this._silentSince = 0; this._everHeard = false; this._connectedAt = 0;
    this.connected = false; this.detected = null; this.rms = 0;
    this.dbfs = -Infinity; this.rawDbfs = -Infinity; this.peakHold = -Infinity; this.devicePeak = -Infinity;
    this.silent = false; this.neverHeard = false; this.diag = null;
    this.emit();
  },

  async connect(did) {
    this.disconnect();
    this.connecting = true; this.error = null; this.emit();
    // No mediaDevices at all means an INSECURE context: the app was opened over
    // plain http on a LAN address (http://192.168.x.x:5173), which is exactly what
    // sharing a dev server invites. Browsers hide the mic there, and the raw
    // TypeError that follows says nothing a friend can act on. Say the real thing.
    if (!navigator.mediaDevices) {
      this.error = 'The mic only works on localhost or over https. Open http://localhost:5173 on this machine, or host the app with https.';
      this.connecting = false; this.emit(); return false;
    }

    // Chrome captures MONO by default, which on a 2-input interface means input 1
    // only — a guitar in input 2 is then completely inaudible to the app. `ideal`
    // asks for both channels without ever failing on a device that has one.
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
                   channelCount: { ideal: 2 } };
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
      // A context built after an `await` can come up SUSPENDED, and a suspended
      // context feeds the analyser nothing but zeros forever — a connected input
      // that reads dead silence no matter what you do to the knobs.
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }

      const src = ctx.createMediaStreamSource(s);
      const gn  = ctx.createGain();
      gn.gain.value = this.gainFactor();
      this._gainNode = gn;
      // Two taps: one on the raw device, one after the trim. If raw is silent the
      // problem is upstream of this app; if raw is alive and post-gain is not, the
      // trim is the problem. Without both you cannot tell those apart.
      const anRaw = ctx.createAnalyser(); anRaw.fftSize = 2048;
      const an    = ctx.createAnalyser(); an.fftSize = 4096;
      src.connect(anRaw);
      src.connect(gn); gn.connect(an);
      this._analyser = an; this._rawAnalyser = anRaw;

      const track = s.getAudioTracks()[0] || null;
      this._track = track;
      // Another app taking the interface (REAPER on ASIO, say) mutes the track
      // rather than ending it — the stream stays "live" and carries silence.
      if (track) {
        track.addEventListener?.('mute',   () => this.emit());
        track.addEventListener?.('unmute', () => this.emit());
        track.addEventListener?.('ended',  () => { this.error = 'The input device stopped sending audio (unplugged, or another app took it over). Hit Connect again.'; this.disconnect(); });
      }

      this.connected = true; this.connecting = false;
      this._connectedAt = performance.now();
      this.selectedDeviceId = actualId;
      this.emit();

      const buf    = new Float32Array(an.fftSize);
      const rawBuf = new Float32Array(anRaw.fftSize);
      const self   = this;
      const toDb   = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);
      // A timer, not requestAnimationFrame: rAF stops whenever the page isn't being
      // painted, so the meter and the tuner would freeze the moment you clicked over
      // to your DAW — and then lie about the level when you came back.
      const loop = () => {
        const now = performance.now();
        an.getFloatTimeDomainData(buf);
        anRaw.getFloatTimeDomainData(rawBuf);

        // Peak, not just RMS: a plucked string is mostly decay, and RMS over 85ms
        // under-reads the attack that a player is watching for.
        let peak = 0, sum = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; sum += buf[i] * buf[i]; }
        const rv = Math.sqrt(sum / buf.length);
        let rawPeak = 0;
        for (let i = 0; i < rawBuf.length; i++) { const a = Math.abs(rawBuf[i]); if (a > rawPeak) rawPeak = a; }

        self.dbfs    = toDb(peak);
        self.rawDbfs = toDb(rawPeak);
        self.peakHold = Math.max(self.peakHold === -Infinity ? -Infinity : self.peakHold - 0.25, self.dbfs);
        // Meter in dB, floor −60: a −50 dBFS DI used to render a 2px sliver on a
        // linear scale and look exactly like nothing at all.
        self.rms = Math.max(0, Math.min(1, (self.dbfs + 60) / 60));

        // "No signal" is a diagnosis, not a level — and it is NOT the same as exact
        // digital zero. An unplugged interface input, a guitar in jack 2 while the
        // browser captures jack 1, or LINE where INST was needed all send a −80 dB
        // noise floor: numerically alive, musically dead. Anything under −75 dBFS is
        // nothing. Held for a beat so a gap between notes can't trip it.
        if (self.rawDbfs < -75) {
          if (!self._silentSince) self._silentSince = now;
        } else { self._silentSince = 0; self._everHeard = true; }
        self.silent = !!self._silentSince && now - self._silentSince > 1200;
        // Never heard ANYTHING since connecting is a stronger statement than "quiet
        // right now", and it's the one that means "your setup isn't hooked up".
        self.neverHeard = !self._everHeard && now - self._connectedAt > 2500;
        if (self.rawDbfs > self.devicePeak) self.devicePeak = self.rawDbfs;

        const gate = self.gateDb();
        if (self.dbfs > gate) {
          // The correlation is O(n²); at 4096 samples every frame it would eat the
          // frame budget and make the whole meter feel dead. 2048 samples resolves
          // a low E fine, and 20 Hz is plenty of refresh for a tuner needle.
          if (++self._frame % 3 === 0) {
            const freq  = autoCorrelate(buf.subarray(0, 2048), ctx.sampleRate,
                                        Math.max(0.0005, Math.pow(10, gate / 20)));
            const range = getInst().freqRange;
            if (freq > range[0] && freq < range[1]) self.detected = freqToNote(freq);
          }
        } else {
          self.detected = null;
        }

        self.diag = {
          ctxState:   ctx.state,
          sampleRate: ctx.sampleRate,
          // The TRACK's channel count, not the source node's: a
          // MediaStreamAudioSourceNode's channelCount is an inert mixing attribute
          // that reads 2 for everything, so the old row printed "2 ch" for every
          // device on earth. A diagnostic that invents numbers is worse than none.
          channels:   track?.getSettings?.().channelCount ?? null,
          devicePeak: self.devicePeak,
          trackMuted: track ? track.muted : null,
          trackReady: track ? track.readyState : null,
          label:      track?.label || '',
          settings:   track?.getSettings?.() || {},
          dbfs: self.dbfs, rawDbfs: self.rawDbfs, gainDb: self.gainDb(), gateDb: gate,
        };

        self.emitThrottled(now);
      };
      this._anim = setInterval(loop, 16);
      loop();
    } catch(e) {
      this.connecting = false;
      this.error = e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Click the 🎤 / lock icon in your browser’s address bar, allow access, then click Connect again.'
        : e.name === 'NotFoundError'
        ? 'No audio input found. Make sure your interface or mic is plugged in and selected, then hit ⟳ Refresh.'
        : 'Could not connect to the input: ' + (e.message || e.name);
      this.emit();
    }
  },

  setGain(v)   { this.inputGain  = v; if (this._gainNode) this._gainNode.gain.value = this.gainFactor(); this.emit(); },
  setGate(v)   { this.noiseGate  = v; this.emit(); },
  setDevice(id){ this.selectedDeviceId = id; if (this.connected) this.connect(id); else this.emit(); },

  // Why a connected input can still be silent, most likely first. Every line is
  // read off the live stream — nothing here is a guess.
  silentAdvice() {
    const d = this.diag;
    if (!d) return [];
    if (d.ctxState !== 'running')
      return [`The browser's audio engine is <b>${d.ctxState}</b> — click anywhere on the page, then hit Connect again.`];
    if (d.trackMuted)
      return ['Windows has this input <b>muted for the browser</b>, which usually means another program has taken exclusive control of it.',
              'Close <b>REAPER</b> (or any DAW/ASIO app) — or in the interface\'s control panel turn OFF exclusive mode — then hit Connect again.',
              'Also check Windows → Sound → Recording → your interface → Properties → <b>Levels</b> is not muted.'];
    return [
      'Check the guitar is in the input you selected — <b>input 1</b> on the interface, not 2.',
      'Turn the interface\'s own <b>gain knob</b> up until its halo lights green as you play.',
      'On a Scarlett, the input needs to be set to <b>INST</b> for a guitar (LINE is far quieter).',
      'Windows → Settings → Privacy → Microphone: make sure your browser is allowed.',
      'Close any DAW (REAPER) that might be holding the interface, then hit Connect again.',
    ];
  }
};

// ── Simple note playback (click/preview) ─────────────────────────────
// Shares the app's one AudioContext. This used to open a NEW context on every
// click — browsers cap you at a handful, so clicking around the neck went
// silent after half a dozen notes and stayed that way until reload.
export function playClickedNote(note, octave) {
  try {
    const ctx = audioCtx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (NOTES.indexOf(note) - 9) / 12 + (octave - 4));
    g.gain.value = 0.25;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(bus(ctx, 'notes'));
    o.start(); o.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// Kick off device enumeration immediately
audio.enumerate();

// Refresh the device list when hardware is plugged in/out (e.g. the Focusrite).
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (!audio.connected) audio.enumerate();
});
