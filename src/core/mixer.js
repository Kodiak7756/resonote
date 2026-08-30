// ── The mix bus ───────────────────────────────────────────────────────
// Until now every sound in Resonote went straight to the speakers: ~30
// `connect(ctx.destination)` calls across fourteen AudioContexts, each with a
// level baked into the call site (0.16 here, 0.3 there). So there was no way
// to turn the app down — and the thing a practising player needs most is to
// hear THEMSELVES over the app.
//
// Three buses, because the useful settings are not "louder / quieter" but
// BALANCES:
//   notes   the app playing pitches at you — the first thing to go once you
//           know the part, or you end up following instead of playing
//   click   the metronome and count-ins — usually the last thing to go
//   drums   beats and backing tracks — the band you're playing along with
// …under one master, so ⌫ one control still kills everything.
//
// Deliberately NOT on a bus: the amp modeler's input monitoring. That is
// Kevin's own guitar coming back at him, and muting the app must never mute
// the player.
//
// A bus is not one node. You cannot connect across AudioContexts, and this app
// has fourteen of them, so a bus is one NUMBER with a GainNode per context,
// all kept in step.

const KEY = 'rn-mix';
export const BUSES = ['notes', 'click', 'drums'];
export const BUS_LABEL = { notes: 'Notes', click: 'Click', drums: 'Drums' };
export const BUS_HINT = {
  notes: 'The app playing pitches — drills, workouts, chords, playback',
  click: 'Metronome and count-ins',
  drums: 'Beats and backing tracks',
};

const DEFAULTS = {
  master: { level: 0.85, mute: false },
  notes:  { level: 0.85, mute: false },
  click:  { level: 1,    mute: false },
  drums:  { level: 0.85, mute: false },
};

const mix = JSON.parse(JSON.stringify(DEFAULTS));
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) for (const k of Object.keys(mix)) {
    if (!saved[k]) continue;
    if (typeof saved[k].level === 'number') mix[k].level = Math.max(0, Math.min(1, saved[k].level));
    mix[k].mute = !!saved[k].mute;
  }
} catch (e) { /* corrupt store — the defaults are fine */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mix)); } catch (e) {} };

// ── the numbers ───────────────────────────────────────────────────────
export const getMix = () => JSON.parse(JSON.stringify(mix));
export const busOf = name => mix[name] || mix.master;

// Perceived loudness is not linear in amplitude: halving the gain does not
// sound half as loud. Squaring the fader position gives a taper that feels
// even under the finger, which is what every real fader does.
const taper = v => v * v;

export function effGain(name) {
  const m = mix.master, b = mix[name] || m;
  if (m.mute || b.mute) return 0;
  return taper(m.level) * (b === m ? 1 : taper(b.level));
}

// ── the nodes ─────────────────────────────────────────────────────────
// One GainNode per (context, bus), cached on the context itself. Contexts are
// long-lived and few, so a WeakMap keeps this from ever needing a sweep.
const perCtx = new WeakMap();
const live = [];        // {ctx, name, node} — every node we have to keep in step

export function bus(ctx, name = 'notes') {
  if (!ctx) return null;
  if (!mix[name]) name = 'notes';
  let m = perCtx.get(ctx);
  if (!m) { m = {}; perCtx.set(ctx, m); }
  if (!m[name]) {
    const g = ctx.createGain();
    g.gain.value = effGain(name);
    g.connect(ctx.destination);
    m[name] = g;
    live.push({ ctx, name, node: g });
  }
  return m[name];
}

// Ramp rather than jump: a gain that steps discontinuously clicks, and a click
// on every slider pixel is worse than no slider at all.
function applyOne(entry) {
  try {
    const t = entry.ctx.currentTime, g = entry.node.gain, v = effGain(entry.name);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + 0.025);
  } catch (e) { /* a closed context — drop it below */ }
}

const subs = [];
export function onMix(fn) { if (typeof fn === 'function') subs.push(fn); return () => {
  const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1);
}; }

function apply() {
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i].ctx.state === 'closed') { live.splice(i, 1); continue; }
    applyOne(live[i]);
  }
  save();
  const snap = getMix();
  subs.forEach(fn => { try { fn(snap); } catch (e) {} });
}

export function setLevel(name, v) {
  const b = mix[name]; if (!b) return;
  b.level = Math.max(0, Math.min(1, Number(v) || 0));
  if (b.level > 0 && b.mute) b.mute = false;   // moving a muted fader un-mutes it
  apply();
}

export function setMute(name, on) {
  const b = mix[name]; if (!b) return;
  b.mute = on === undefined ? !b.mute : !!on;
  apply();
}

export function toggleMute(name) { setMute(name); }

export function resetMix() {
  for (const k of Object.keys(DEFAULTS)) { mix[k].level = DEFAULTS[k].level; mix[k].mute = DEFAULTS[k].mute; }
  apply();
}

// Anything silent right now? Used by the header button to show its state at a
// glance — a muted app that you have forgotten about is a bug report waiting
// to happen.
export const anyMuted = () => mix.master.mute || BUSES.some(b => mix[b].mute);
export const allSilent = () => mix.master.mute || mix.master.level === 0;
