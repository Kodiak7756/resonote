// ── Shared pulse engine ──────────────────────────────────────────────
// One click/tick clock for the whole app. Every pedal used to run its own
// setInterval(60000/bpm), and a JS timer is never on time — each callback
// lands a few ms late and the error ACCUMULATES, so a click drifts audibly
// against playback within a dozen bars. The fix is the standard web-audio
// lookahead pattern: a coarse timer wakes up often enough to schedule the
// ticks that fall inside the next window, each with an exact
// AudioContext.currentTime value. The clock that plays the sound is then the
// same clock that times it, so there is nothing left to drift.
//
// Callers get the tick's audio time and use it two ways: pass it straight to
// an oscillator/buffer start (sample-accurate sound), and hang the on-screen
// update off `tick.visual(fn)` so the dot lights when the sound arrives
// rather than when the scheduler happened to run.

import { bus } from './mixer.js';

let _ctx = null;

// One AudioContext for the app. Browsers cap how many you may open, and each
// one has its own currentTime — sharing it is what lets two pedals line up.
export function audioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// Run fn when the audio clock reaches `time`. Returns a timeout id so the
// caller can cancel it. Pulses hand this out as tick.visual() and cancel it
// for you on stop(); use it directly only for one-off events (a set ending,
// a count-in hand-off) that must survive the pulse being stopped.
export function scheduleVisual(time, fn) {
  return setTimeout(fn, Math.max(0, (time - audioCtx().currentTime) * 1000));
}

// The metronome's click voice, kept here so every other clicking thing in the
// app can borrow it instead of hand-rolling a fourth version of it.
const CLICK_VOICES = {
  accent:  { freq: 1050, gain: 0.5, type: 'sine', dur: 0.08 },
  regular: { freq: 720,  gain: 0.3, type: 'sine', dur: 0.08 },
};

export function clickSound(ctx, time, opts = {}) {
  const base = opts.accent ? CLICK_VOICES.accent : CLICK_VOICES.regular;
  const freq = opts.freq ?? base.freq;
  const gain = opts.gain ?? base.gain;
  if (!freq || !gain) return;                 // a rest — silent by design
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || base.type;
    o.frequency.value = freq;
    const dur = opts.dur || base.dur;
    // Envelope written at `time`, not currentTime, or the click lands wherever
    // the scheduler happened to be when it was created.
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g); g.connect(opts.dest || bus(ctx, 'click'));
    o.start(time); o.stop(time + dur);
  } catch (e) { /* no audio device — stay silent, never break the UI */ }
}

// createPulse({ bpm, subdiv, beatsPerBar, onTick, lookahead, scheduleAhead })
//   subdiv       ticks per beat (1 = quarters, 2 = eighths, 3 = triplets…)
//   beatsPerBar  0 = don't group; otherwise tick.beatInBar/tick.bar wrap on it
//   lookahead    how often the scheduler wakes, in seconds
//   scheduleAhead how far ahead of the audio clock it schedules, in seconds
// onTick(tick) fires at SCHEDULE time — up to scheduleAhead before the tick is
// heard — with { index, time, beat, sub, isBeat, bar, beatInBar, out, visual }.
export function createPulse({ bpm = 120, subdiv = 1, beatsPerBar = 0, onTick = null,
                              lookahead = 0.1, scheduleAhead = 0.25 } = {}) {
  let ac = null, out = null;
  let playing = false, timer = null, nextTime = 0, runId = 0;
  let index = 0, beat = 0, sub = 0, bar = 0, beatInBar = 0;
  let visuals = [];

  // The AudioContext is built on the first start(), not on construction — a
  // pedal sitting idle in the rack has no business opening an audio device.
  function ensure() {
    if (!ac) {
      ac = audioCtx();
      out = ac.createGain();
      out.gain.value = 1;
      // Through the click bus, not straight to the speakers. `out.gain` stays
      // the pulse's OWN control (stop() ramps it to kill queued ticks); the bus
      // above it is the listener's.
      out.connect(bus(ac, 'click'));
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  const tickSecs = () => 60 / Math.max(1, bpm) / Math.max(1, subdiv);

  function advance() {
    index++;
    if (++sub >= Math.max(1, subdiv)) {
      sub = 0; beat++; beatInBar++;
      if (beatsPerBar > 0 && beatInBar >= beatsPerBar) { beatInBar = 0; bar++; }
    }
  }

  function emit(time) {
    const t = {
      index, time, beat, sub, bar, beatInBar,
      isBeat: sub === 0,
      out,
      visual(fn) {
        const id = setTimeout(() => {
          const k = visuals.indexOf(id);
          if (k >= 0) visuals.splice(k, 1);   // only the still-pending ones need cancelling
          fn();
        }, Math.max(0, (time - ac.currentTime) * 1000));
        visuals.push(id);
        return id;
      },
    };
    advance();                       // before onTick, so a handler that calls
                                     // stop() can't be undone by a stale bump
    try { if (onTick) onTick(t); } catch (e) { /* a bad handler must not kill the clock */ }
  }

  function schedule() {
    const c = ensure();
    while (playing && nextTime < c.currentTime + scheduleAhead) {
      const time = nextTime, run = runId;
      emit(time);
      // Spacing is read AFTER the handler, so a tick that retunes the tempo
      // (the speed trainer) has the very next tick land on the new one. If the
      // handler stopped or restarted us, nextTime belongs to that new run.
      if (!playing || runId !== run) break;
      nextTime = time + tickSecs();
    }
  }

  // start(atTime) — atTime pins the first tick to an audio time (for handing
  // off from a count-in); omitted, it starts a hair in the future so the first
  // click has room to be built.
  function start(atTime) {
    stop();
    const c = ensure();
    playing = true; runId++;
    const g = out.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(1, c.currentTime);
    nextTime = atTime == null ? c.currentTime + 0.02 : Math.max(Number(atTime) || 0, c.currentTime);
    schedule();
    timer = setInterval(schedule, Math.max(10, lookahead * 1000));
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    visuals.forEach(clearTimeout); visuals = [];
    // Ticks already inside the lookahead window are in WebAudio's queue and
    // cannot be un-scheduled, so mute the bus instead — STOP has to be silent
    // the instant it is pressed, not scheduleAhead later.
    if (ac && out) {
      const t = ac.currentTime, g = out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.005);   // ramp, or the cut itself clicks
    }
    playing = false;
    index = 0; beat = 0; sub = 0; bar = 0; beatInBar = 0; nextTime = 0;
  }

  return {
    start, stop,
    setBpm(n)         { bpm = Math.max(1, Number(n) || bpm); },
    setSubdiv(n)      { subdiv = Math.max(1, Math.round(Number(n) || 1)); },
    setBeatsPerBar(n) { beatsPerBar = Math.max(0, Math.round(Number(n) || 0)); },
    get playing()     { return playing; },
    get tick()        { return index; },
    get beat()        { return beat; },
    get bar()         { return bar; },
    get bpm()         { return bpm; },
    get out()         { ensure(); return out; },   // connect your own voices here
  };
}
