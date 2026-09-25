// ── The drum kit: one set of pieces, one voice per piece ─────────────
// Two things play drums in Resonote: the 🥁 DRUMS instrument (the kit you hit)
// and the 🥁 Backing Track pedal (the 16-step sequencer that loops a beat). They
// used to be one thing — the pedal carried its own kit — and they have to stay
// one thing now there are two of them: the snare you tap on the kit IS the snare
// row in the grid, the same colour, the same sound, the same MIDI note. So the
// pieces, their voices and their MIDI maps live here, and both sides import them.
//
// This file also carries the thin line between the two. The kit knows nothing
// about grids and the pedal knows nothing about SVG; the kit asks "who is the
// beat?" (activeMaker) and hands it a hit, the pedal announces what it just
// played (drumBus 'seq') and the kit lights those pieces. Either side works alone.

import { audioCtx } from './pulse.js';
import { bus } from './mixer.js';

// ── The pieces ───────────────────────────────────────────────────────
// Order is the grid's row order, top to bottom: the four rows the pedal always
// had first (so a beat you knew still reads the same), then the cymbals, then
// the toms high to low, and the one electronic sound last.
//
// LANE INK. These are consumed as hex STRINGS — `${color}88` builds a painted
// cell's alpha in the pedal, and the kit fills its glow with them — so they
// cannot become var() without a code change. The seven the pedal already had are
// kept exactly; the new ones sit in families you can read at a glance: the toms
// are one mauve stepping from light (high) to dark (low) the way their pitch
// does, and the two crashes are cymbal brass, bright and dark.
export const DRUM_PIECES = [
  { key: 'kick',      label: 'Kick',    name: 'Bass drum',        color: '#9977ee', keys: ['k', 'b'] },
  { key: 'snare',     label: 'Snare',   name: 'Snare',            color: '#bb88ff', keys: ['s'] },
  { key: 'hatClosed', label: 'HH',      name: 'Hi-hat (closed)',  color: '#8899cc', keys: ['h'] },
  { key: 'hatOpen',   label: 'Open',    name: 'Hi-hat (open)',    color: '#7799bb', keys: ['o'] },
  { key: 'ride',      label: 'Ride',    name: 'Ride cymbal',      color: '#66aaaa', keys: ['r'] },
  { key: 'crash1',    label: 'Crash 1', name: 'Crash cymbal 1',   color: '#d0bc80', keys: ['c'] },
  { key: 'crash2',    label: 'Crash 2', name: 'Crash cymbal 2',   color: '#b39a5e', keys: ['v'] },
  { key: 'tom1',      label: 'Tom 1',   name: 'Rack tom 1 (high)', color: '#cd98bb', keys: ['1'] },
  { key: 'tom2',      label: 'Tom 2',   name: 'Rack tom 2 (mid)', color: '#aa7799', keys: ['2'] },
  { key: 'floor',     label: 'Floor',   name: 'Floor tom',        color: '#8f6283', keys: ['3'] },
  { key: 'clap',      label: 'Clap',    name: 'Clap (sample pad)', color: '#cc8888', keys: ['p'] },
];
export const PIECE = Object.fromEntries(DRUM_PIECES.map(p => [p.key, p]));

// Boards saved before the kit had three toms carry a single 'tom' row. Its voice
// and its GM note (45, Low Tom) were the middle rack tom's, so that is where it
// lands — the beat sounds the same, and nothing a player wrote is dropped.
export const LEGACY_KEYS = { tom: 'tom2' };

// ── MIDI maps for the REAPER export ──────────────────────────────────
// GM = General MIDI (MT Power Drum Kit, SSD5, most sampled kits): the two rack
// toms on Hi-Mid 48 and Low 45, the floor on High Floor 43, the crashes on the
// two GM crash notes.
// Sitala = the Clean 808 kit's chromatic pads (kick on C2/36). An 808 has one
// cymbal and three toms, so both crashes share the cymbal pad (40, where the
// ride already was) and the toms take the 808's high/mid/low tom pads.
export const DRUM_MIDI_MAPS = {
  GM:     { kick: 36, snare: 38, hatClosed: 42, hatOpen: 46, ride: 51, crash1: 49, crash2: 57, tom1: 48, tom2: 45, floor: 43, clap: 39 },
  Sitala: { kick: 36, snare: 37, hatClosed: 38, hatOpen: 39, ride: 40, crash1: 40, crash2: 40, tom1: 43, tom2: 42, floor: 41, clap: 47 },
};

// ── Voices ───────────────────────────────────────────────────────────
// Synthesised, not sampled: no files to fetch, works offline, and renders the
// same inside an OfflineAudioContext for ⬆ Upload Beat as Track. Every voice is
// written against an exact start time `t`, never currentTime, so the sequencer
// can schedule it ahead and it still lands on the grid.

// One noise buffer per context, read from a random offset each hit. Building a
// fresh random buffer per hit (what the pedal did) costs an allocation every
// sixteenth and makes no audible difference.
const perCtx = new WeakMap();
function ctxState(ctx) {
  let st = perCtx.get(ctx);
  if (!st) { st = { noise: null, openHat: null, out: null }; perCtx.set(ctx, st); }
  return st;
}
function noiseSrc(ctx, t, dur) {
  const st = ctxState(ctx);
  if (!st.noise) {
    const len = Math.floor(ctx.sampleRate * 2);
    st.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = st.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = st.noise;
  const off = Math.random() * Math.max(0, st.noise.duration - dur - 0.1);
  src.start(t, off, dur + 0.05);
  return src;
}

// Exponential attack/decay. Ramps from a hair above zero because an exponential
// ramp cannot start or end AT zero.
function env(ctx, t, peak, decay, attack = 0.001) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function filter(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  if (q != null) f.Q.value = q;
  return f;
}

// Six square waves at the 808's inharmonic ratios. Filtered high, they are the
// metal in every cymbal here; plain noise alone sounds like static, not bronze.
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
function metal(ctx, t, dur, base) {
  const sum = ctx.createGain();
  sum.gain.value = 1 / METAL_RATIOS.length;
  METAL_RATIOS.forEach(r => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(sum);
    o.start(t); o.stop(t + dur + 0.05);
  });
  return sum;
}

// Chain nodes left to right and land on `out`.
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); }

// A tuned drum: a sine that drops onto its note, one quieter overtone (a
// drumhead is not a pure sine), and the stick's click.
function tomVoice(f0, decay, peak) {
  return (ctx, t, v, out) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 1.55, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + decay);
    const g = env(ctx, t, peak * v, decay, 0.002);
    chain(o, g, out); o.start(t); o.stop(t + decay + 0.05);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 2.5, t);
    o2.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.05);
    const g2 = env(ctx, t, peak * 0.2 * v, decay * 0.35);
    chain(o2, g2, out); o2.start(t); o2.stop(t + decay);

    chain(noiseSrc(ctx, t, 0.03), filter(ctx, 'bandpass', f0 * 8, 0.9), env(ctx, t, 0.22 * v, 0.025), out);
  };
}

function crashVoice(bright) {
  return (ctx, t, v, out) => {
    const decay = bright ? 1.7 : 2.3;
    // the wash: wide noise with the lows cut, a bite where the stick lands
    const pk = filter(ctx, 'peaking', bright ? 8200 : 6200);
    pk.gain.value = 5; pk.Q.value = 0.7;
    chain(noiseSrc(ctx, t, decay + 0.1), filter(ctx, 'highpass', bright ? 4200 : 3000), pk, env(ctx, t, 0.26 * v, decay, 0.003), out);
    // the shimmer: metal partials, gone a little before the wash
    chain(metal(ctx, t, decay, bright ? 52 : 43), filter(ctx, 'highpass', 5200), env(ctx, t, 0.14 * v, decay * 0.75, 0.003), out);
    // the splash of the first instant
    chain(noiseSrc(ctx, t, 0.14), filter(ctx, 'highpass', 1800), env(ctx, t, 0.2 * v, 0.1), out);
  };
}

// A closed hat shuts a ringing open one — the foot comes down on it. Only a hat
// that STARTED before this one is choked: the sequencer schedules ahead, so a
// live tap can arrive while a later open hat is already queued, and that one
// has not happened yet.
function chokeOpenHat(ctx, t) {
  const st = ctxState(ctx), oh = st.openHat;
  if (!oh || oh.t >= t) return;
  try { oh.node.gain.setTargetAtTime(0, t, 0.012); } catch (e) {}
  st.openHat = null;
}

function hatVoice(open) {
  return (ctx, t, v, out) => {
    chokeOpenHat(ctx, t);
    const decay = open ? 0.42 : 0.055;
    const dest = open ? ctx.createGain() : out;
    chain(metal(ctx, t, decay, 40), filter(ctx, 'bandpass', 10000, 0.8), filter(ctx, 'highpass', 7000), env(ctx, t, (open ? 0.75 : 1.1) * v, decay), dest);
    chain(noiseSrc(ctx, t, decay + 0.02), filter(ctx, 'highpass', 8000), env(ctx, t, (open ? 0.3 : 0.42) * v, decay * 0.9), dest);
    if (open) { dest.connect(out); ctxState(ctx).openHat = { node: dest, t }; }
  };
}

const VOICES = {
  kick(ctx, t, v, out) {
    // the body: a thump that falls to a boom
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    chain(o, env(ctx, t, 0.82 * v, 0.42, 0.002), out);
    o.start(t); o.stop(t + 0.5);
    // the beater: a short bright click, so the kick still speaks on laptop speakers
    chain(noiseSrc(ctx, t, 0.02), filter(ctx, 'lowpass', 4200), env(ctx, t, 0.28 * v, 0.018), out);
  },
  snare(ctx, t, v, out) {
    // the shell: two tones that settle onto their pitch
    [[185, 0.36], [330, 0.2]].forEach(([f, a]) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 1.25, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      chain(o, env(ctx, t, a * v, 0.11), out);
      o.start(t); o.stop(t + 0.16);
    });
    // the wires: bright noise that outlasts the tone
    const pk = filter(ctx, 'peaking', 4200);
    pk.gain.value = 6; pk.Q.value = 0.8;
    chain(noiseSrc(ctx, t, 0.26), filter(ctx, 'highpass', 1400), pk, env(ctx, t, 0.4 * v, 0.2), out);
  },
  hatClosed: hatVoice(false),
  hatOpen:   hatVoice(true),
  ride(ctx, t, v, out) {
    const decay = 1.35;
    // the bow: a dry ping with a long, quiet metal wash under it
    chain(metal(ctx, t, decay, 58), filter(ctx, 'bandpass', 5200, 1), filter(ctx, 'highpass', 3000), env(ctx, t, 0.52 * v, decay), out);
    chain(noiseSrc(ctx, t, 0.7), filter(ctx, 'bandpass', 9000, 0.7), env(ctx, t, 0.14 * v, 0.6), out);
    chain(noiseSrc(ctx, t, 0.04), filter(ctx, 'highpass', 6000), env(ctx, t, 0.3 * v, 0.03), out);
    // a faint bell tone, which is what separates a ride from a crash
    [[740, 0.05], [1110, 0.035]].forEach(([f, a]) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      chain(o, env(ctx, t, a * v, 0.9), out);
      o.start(t); o.stop(t + 1);
    });
  },
  crash1: crashVoice(true),
  crash2: crashVoice(false),
  tom1:  tomVoice(190, 0.36, 0.66),
  tom2:  tomVoice(140, 0.44, 0.68),
  floor: tomVoice(95,  0.62, 0.7),
  clap(ctx, t, v, out) {
    // three hands a hair apart, then the room
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.012;
      chain(noiseSrc(ctx, at, 0.03), filter(ctx, 'bandpass', 1250, 1.2), env(ctx, at, 2 * v, 0.03), out);
    }
    chain(noiseSrc(ctx, t + 0.03, 0.2), filter(ctx, 'bandpass', 1100, 0.8), env(ctx, t + 0.03, 1.1 * v, 0.16), out);
  },
};

// The kit's own bus: every piece goes through one gentle compressor before the
// mixer's Drums fader, the way a real kit is glued on a drum bus. It is also
// the safety net — a kick, a crash and a hat landing on the same sixteenth sum
// well past full scale, and this keeps that from clipping at full volume.
export function drumOut(ctx) {
  const st = ctxState(ctx);
  if (!st.out) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -10; c.knee.value = 6; c.ratio.value = 4;
    c.attack.value = 0.003; c.release.value = 0.12;
    c.connect(bus(ctx, 'drums'));
    st.out = c;
  }
  return st.out;
}

// Play one piece. `time` is an audio-clock time (omit it for "now"); `dest`
// defaults to the kit's bus above, so the 🔊 Mix drums fader rules every hit.
// A dead or suspended audio device must never break the UI — it stays silent.
export function playDrum(key, { ctx, time, vel = 1, dest } = {}) {
  const k = LEGACY_KEYS[key] || key;
  const fn = VOICES[k];
  if (!fn) return;
  try {
    const c = ctx || audioCtx();
    const t = time == null ? c.currentTime + 0.003 : Math.max(time, c.currentTime);
    fn(c, t, Math.max(0.05, Math.min(1.2, vel)), dest || drumOut(c));
  } catch (e) { /* no audio — stay silent */ }
}

// Dynamics the grid doesn't store: a step on the beat is played a little harder
// than one on the "&", which is a little harder than the "e" and "a". Flat
// velocities are what make a programmed beat sound programmed.
export function stepVel(step) {
  const i = step % 16;
  return i % 4 === 0 ? 1 : i % 2 === 0 ? 0.88 : 0.76;
}

// ── When did the player MEAN that hit? ───────────────────────────────
// A tap arrives late twice over: the sound they were playing along to left the
// speakers after the audio clock scheduled it (output latency), and the tap
// reaches the page after the finger lands (input latency). getOutputTimestamp
// pairs "this audio frame is coming out of the speakers now" with a
// performance.now() time, so the event's own timestamp converts straight into
// the audio time the player was HEARING — which is the time to quantize.
export function heardTime(ctx, eventStamp) {
  try {
    const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
    if (ts && ts.performanceTime > 0 && eventStamp > 0) {
      return ts.contextTime + (eventStamp - ts.performanceTime) / 1000;
    }
  } catch (e) { /* older engine — estimate below */ }
  return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
}

// ── The line between the kit and the beat ────────────────────────────
//   'seq'    a Backing Track played {keys, step, id} — the kit lights them
//   'state'  a Backing Track changed (grid, transport, length) — redraw status
//   'edit'   the edit mode or step cursor moved — both sides redraw
//   'makers' a Backing Track came or went
const subs = {};
export const drumBus = {
  on(type, fn) {
    (subs[type] || (subs[type] = [])).push(fn);
    return () => { const a = subs[type] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  },
  emit(type, detail) {
    (subs[type] || []).slice().forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } });
  },
};

// Which Backing Track the kit writes into. Normally there is one; with two on
// the board, the one that is PLAYING is obviously the beat, then the one you
// last touched, then whichever is left.
const makers = new Map();
let lastTouched = null;
export function registerMaker(id, api) { makers.set(id, api); drumBus.emit('makers'); }
export function unregisterMaker(id) {
  if (!makers.delete(id)) return;
  if (lastTouched === id) lastTouched = null;
  drumBus.emit('makers');
}
export function touchMaker(id) { if (makers.has(id)) lastTouched = id; }
export function activeMaker() {
  // a card taken off the board without its ✕ (a load-out reset) leaves its
  // entry behind — drop it on the way past
  for (const [id, m] of makers) if (!m.alive()) makers.delete(id);
  for (const m of makers.values()) if (m.isPlaying()) return m;
  return (lastTouched && makers.get(lastTouched)) || makers.values().next().value || null;
}

// ── How the kit writes ───────────────────────────────────────────────
//   jam   the kit is just an instrument — nothing is written
//   rec   hits land in the beat on the nearest sixteenth while it loops
//   step  pick a step, then every piece you hit toggles on that step
// The mode is NOT remembered across a reload: waking up armed to record is how
// a beat gets written over by accident. The small preferences are.
const PREFS_KEY = 'rn-drum-edit';
export const drumEdit = { mode: 'jam', cursor: 0, advance: 0, click: true, keys: true };
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (saved) {
    if ([0, 1, 2, 4].includes(saved.advance)) drumEdit.advance = saved.advance;
    if (typeof saved.click === 'boolean') drumEdit.click = saved.click;
    if (typeof saved.keys === 'boolean') drumEdit.keys = saved.keys;
  }
} catch (e) { /* private mode — defaults are fine */ }
export function setDrumEdit(patch) {
  Object.assign(drumEdit, patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ advance: drumEdit.advance, click: drumEdit.click, keys: drumEdit.keys })); } catch (e) {}
  drumBus.emit('edit', drumEdit);
}
