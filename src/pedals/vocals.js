// ── 🎤 VOCALS — the singer's fretboard ────────────────────────────────
// The voice is the third instrument surface, with the same standing as the neck
// and the keys: whatever a pedal lights (a chord, a scale, a drill step) lands
// here as something to aim at. A guitarist sees dots on strings; a singer has no
// strings, so the axis that replaces them is PITCH ITSELF — a vertical ladder of
// every note in the singing range, with the sung pitch drawn against it over
// time. That is the 🪜 LADDER view, and it is absolute: an A3 is a different rung
// from an A4, because a singer's whole problem is WHICH octave, not just which
// letter.
//
// The older ⭕ FOLDED view (ui/pitch-trace.js) survives as a second mode. It
// wraps every octave onto one, which makes it the better view for pure
// pitch-CLASS work — "sing the 3rd of this chord" — where the octave is your
// choice. Two axes for two questions, the same way the neck has 🌈 and ⟡.
//
// Everything here is drawn against a live pedalBus / chordHighlight /
// ghostHighlight read, so no pedal needs to know the voice view exists.
import { audio } from '../core/audio.js';
import { NOTES, toSharp, KEY_PATTERNS, SCALE_TYPES } from '../core/music-theory.js';
import { pcColor, pcTextOn } from '../core/colors.js';
import { pedalBus, chordHighlight, ghostHighlight, conceptInfo } from '../core/state.js';
import { INSTRUMENTS } from '../core/tuning.js';
import { read as storeRead, write as storeWrite, KEYS } from '../core/store.js';
import { createPitchTrace, LANE_MODES, LANE_MODE_LABELS } from '../ui/pitch-trace.js';

// Both registered in store.js KEYS:
//   vocalsView   { mode, seconds, fit, lanes, ball, trail, notation }
//   vocalRange   { low:{note,octave,midi}, high:{note,octave,midi}, at }
const VIEW_KEY  = KEYS.vocalsView;
const RANGE_KEY = KEYS.vocalRange;

const MODES = ['ladder', 'folded'];
const MODE_LABELS = { ladder: '🪜 Ladder', folded: '⭕ Folded' };
const SECONDS_CHOICES = [4, 8, 12, 16];
const DEFAULTS = { mode: 'ladder', seconds: 8, fit: false, lanes: 'key', ball: true, trail: true, notation: false };

// ±15¢ is what a listener hears as "on the note" — a sung pitch is never dead
// centre the way a fretted one is, so a tuner's ±5 would call every singer flat.
// Past ±40 the ear stops hearing "that note, a bit off" and starts hearing the
// neighbour; that is where it stops being drift and becomes wrong.
const IN_TUNE_CENTS = 15;
const OFF_CENTS     = 40;
const GHOST_BLUE    = '#5cc8ff';           // the neck's "next" colour — semantic, shared with the step strip
const PLAYED_HOLD_S = 1.2;                 // how long a 'resonote:played' note stays lit as "now"
const HOLD_STABLE_S = 0.5;                 // a note held this long counts as sung, not slid through
const FIT_PAD       = 3;                   // semitones of air either side of a fitted range

// ── pitch arithmetic ──────────────────────────────────────────────────
// MIDI numbers because they are the only representation where "how far apart are
// two sung notes" is a subtraction. C4 = 60.
const midiOf  = (note, octave) => NOTES.indexOf(toSharp(note)) + (octave + 1) * 12;
const nameOf  = m => `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const pcOf    = m => NOTES[((m % 12) + 12) % 12];
const isNatural = pc => pc.length === 1;                     // no ♯ = a white key
const pcAlpha = (note, s, l, a) => `hsla${pcColor(note, s, l).slice(3, -1)},${a})`;

// The ladder's full extent is the instrument's own declared range, so the view and
// the catalog entry can never disagree about what a voice covers.
const VR = INSTRUMENTS.vocals.vocalRange;
const LADDER_LO = midiOf(VR.low.note, VR.low.octave);     // C2 = 36
const LADDER_HI = midiOf(VR.high.note, VR.high.octave);   // C6 = 84

// "A2 – E5 · about 2 octaves 7 semitones" — the plain-language size of a range,
// which is the number singers actually quote about themselves.
export function describeRange(r) {
  if (!r || typeof r.low?.midi !== 'number' || typeof r.high?.midi !== 'number') return '';
  const d = r.high.midi - r.low.midi;
  const oct = Math.floor(d / 12), semi = d % 12;
  const parts = [];
  if (oct)  parts.push(`${oct} octave${oct === 1 ? '' : 's'}`);
  if (semi) parts.push(`${semi} semitone${semi === 1 ? '' : 's'}`);
  return `${nameOf(r.low.midi)} – ${nameOf(r.high.midi)} · about ${parts.join(' ') || 'nothing'}`;
}

// ── persistence ───────────────────────────────────────────────────────
function loadView() {
  const v = storeRead(VIEW_KEY, null);
  const out = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
  if (!MODES.includes(out.mode)) out.mode = DEFAULTS.mode;
  if (!LANE_MODES.includes(out.lanes)) out.lanes = DEFAULTS.lanes;
  if (!SECONDS_CHOICES.includes(out.seconds)) out.seconds = DEFAULTS.seconds;
  out.fit = !!out.fit;
  return out;
}
const saveView = v => storeWrite(VIEW_KEY, v);

function loadRange() {
  const r = storeRead(RANGE_KEY, null);
  if (!r || typeof r.low?.midi !== 'number' || typeof r.high?.midi !== 'number') return null;
  // whole semitones only: a fractional midi would put pcOf() off the note table
  // inside the draw loop, and a range is a pair of notes, not a pair of frequencies
  const lo = Math.round(r.low.midi), hi = Math.round(r.high.midi);
  if (hi <= lo) return null;
  return { ...r, low: { ...r.low, midi: lo }, high: { ...r.high, midi: hi } };
}
const saveRange   = r => storeWrite(RANGE_KEY, r);
const forgetRange = () => storeWrite(RANGE_KEY, null);

// ── kit tokens on a canvas ────────────────────────────────────────────
// A canvas has no cascade, and color-mix() is not a colour a 2D context will
// parse. So the tokens are read the way the browser resolves them for text: a
// probe span is coloured `var(--rk-x)` and its COMPUTED colour is read back.
// The ladder therefore recolours with the kit like any DOM does, instead of
// carrying a private palette that drifts from it.
//
// Chrome reports a mixed colour as `color(srgb r g b)` (0..1 floats) and a plain
// one as `rgb(r, g, b)`; both are folded to one 0..255 triplet here so the alpha
// variants are built from numbers, never from string surgery on a format guess.
const TOKENS = ['ink', 'ink-dim', 'ink-mute', 'ink-faint', 'line', 'edge-soft', 'accent', 'ok', 'bad', 'panel'];
const FALLBACK_RGB = [160, 160, 170];
function parseRgb(s) {
  let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s || '');
  if (m) return [+m[1], +m[2], +m[3]];
  m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s || '');
  if (m) return [m[1], m[2], m[3]].map(v => Math.round(+v * 255));
  return null;
}
function tokenReader(host) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const cache = {};
  let ui = 1;
  const refresh = () => {
    for (const k of TOKENS) {
      probe.style.color = `var(--rk-${k})`;
      cache[k] = parseRgb(getComputedStyle(probe).color) || FALLBACK_RGB;
    }
    ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
  };
  refresh();
  const rgb = k => cache[k] || FALLBACK_RGB;
  return {
    refresh,
    get ui() { return ui; },
    get:   k => `rgb(${rgb(k).join(',')})`,
    alpha: (k, a) => `rgba(${rgb(k).join(',')},${a})`,
  };
}

// ── listener hygiene ──────────────────────────────────────────────────
// audio.on() and pedalBus.on() push onto a public array and offer no off(). The
// instrument bar re-enters this view on every switch, so a subscribe with no
// unsubscribe would stack one dead closure per switch. Splicing the array is the
// honest inverse of what on() does.
const off = (bus, fn) => { const i = bus.listeners.indexOf(fn); if (i >= 0) bus.listeners.splice(i, 1); };

// ── the ladder ────────────────────────────────────────────────────────
function createLadder(mount, view, hooks) {
  const uid = `vl${Date.now().toString(36)}`;
  mount.innerHTML = `
    <div style="position:relative;border-radius:10px;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);overflow:hidden">
      <canvas id="${uid}-c" style="display:block;width:100%;height:380px"></canvas>
      <div style="position:absolute;top:6px;right:10px;display:flex;align-items:baseline;gap:8px;pointer-events:none" class="mono">
        <span id="${uid}-note" style="font-size:calc(26px*var(--ui));font-weight:900;color:var(--rk-ink-faint);line-height:1">—</span>
        <span id="${uid}-cents" style="font-size:calc(11px*var(--ui));font-weight:700;color:var(--rk-ink-faint)">—¢</span>
      </div>
      <div id="${uid}-cap" class="mono" style="position:absolute;top:8px;left:calc(54px*var(--ui));font-size:calc(9px*var(--ui));letter-spacing:.6px;color:var(--rk-ink-mute);pointer-events:none"></div>
      <div id="${uid}-hint" class="mono" style="display:none;position:absolute;left:0;right:0;bottom:calc(30px*var(--ui));align-items:center;justify-content:center;gap:8px;font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">
        <span>Nothing is listening yet — connect an input and sing.</span>
        <button id="${uid}-connect" class="mono" style="background:var(--rk-panel2);border:1px dashed var(--rk-line);border-radius:6px;color:var(--rk-accent);font-size:calc(9px*var(--ui));font-weight:700;min-height:calc(28px*var(--ui));padding:4px 10px;cursor:pointer">🎤 Connect</button>
      </div>
    </div>`;

  const canvas  = mount.querySelector(`#${uid}-c`);
  const noteEl  = mount.querySelector(`#${uid}-note`);
  const centsEl = mount.querySelector(`#${uid}-cents`);
  const capEl   = mount.querySelector(`#${uid}-cap`);
  const hintEl  = mount.querySelector(`#${uid}-hint`);
  const ctx     = canvas.getContext('2d');
  const tk      = tokenReader(mount);

  mount.querySelector(`#${uid}-connect`)?.addEventListener('click', async () => {
    try { await audio.connect(audio.selectedDeviceId); } catch (e) { /* declined — the hint stays */ }
  });

  let destroyed = false, raf = 0, frames = 0, cssW = 0, cssH = 0, dpr = 0;
  let history = [];                 // [{ t, midi (float), note, octave, cents }]
  let lastDet = null;               // identity of the last audio.detected we sampled
  let keyPcs = null;                // Set of in-key pitch classes, or null = no key set
  let sigKey = '';
  let played = null;                // { pcs, until } from 'resonote:played'
  let range  = loadRange();
  let finder = null;                // { step:'low'|'high', cand, low, holdMidi, holdSince }

  // ── geometry ─────────────────────────────────────────────────────
  const gutter = () => Math.round(46 * tk.ui);
  const PAD = { r: 10, t: 10, b: 18 };
  const NOW_FRAC = 0.84;
  // fit = zoom the ladder to the singer's own range; otherwise the whole C2..C6.
  const span = () => {
    if (view.fit && range) return { lo: Math.max(LADDER_LO, range.low.midi - FIT_PAD), hi: Math.min(LADDER_HI, range.high.midi + FIT_PAD) };
    return { lo: LADDER_LO, hi: LADDER_HI };
  };
  let vis = span();
  const plotH   = () => Math.max(1, cssH - PAD.t - PAD.b);
  const semiPx  = () => plotH() / (vis.hi - vis.lo + 1);
  const yOf     = m => PAD.t + (vis.hi + 0.5 - m) * semiPx();
  const nowX    = () => gutter() + (cssW - gutter() - PAD.r) * NOW_FRAC;
  const pxPerS  = () => Math.max(1, (nowX() - gutter()) / view.seconds);
  const xOf     = (t, now) => nowX() - (now - t) * pxPerS();
  const right   = () => cssW - PAD.r;

  // ── key colouring ────────────────────────────────────────────────
  function keyIntervals(keyType) {
    if (KEY_PATTERNS[keyType]) return KEY_PATTERNS[keyType].intervals;
    for (const cat of Object.values(SCALE_TYPES)) if (cat[keyType]) return cat[keyType];
    return KEY_PATTERNS.Major.intervals;
  }
  function readKey() {
    const mk = pedalBus.masterKey || {};
    const root = toSharp(mk.root || pedalBus.root || '');
    const keyType = mk.keyType || pedalBus.keyType || 'Major';
    const ks = `${root}|${keyType}`;
    if (ks === sigKey) return;
    sigKey = ks;
    if (!NOTES.includes(root)) { keyPcs = null; return; }
    const ri = NOTES.indexOf(root);
    keyPcs = new Set(keyIntervals(keyType).map(i => NOTES[(ri + i) % 12]));
  }
  const inKey = pc => !keyPcs || keyPcs.has(pc);

  // ── sampling ─────────────────────────────────────────────────────
  // Both the audio emitter and the frame loop feed this; identity on the detected
  // object keeps one reading from landing twice.
  function sample(t) {
    const det = audio.detected;
    if (!det || det === lastDet) { if (!det) lastDet = null; return; }
    if (!NOTES.includes(det.note)) return;
    lastDet = det;
    const m = midiOf(det.note, det.octave) + (det.cents || 0) / 100;
    history.push({ t, midi: m, note: det.note, octave: det.octave, cents: det.cents || 0 });
    if (finder) feedFinder(t, m);
  }
  function prune(t) {
    const cut = t - view.seconds - 1;
    while (history.length && history[0].t < cut) history.shift();
  }

  // ── range finder ─────────────────────────────────────────────────
  // A note only counts once it has been HELD: a voice sliding up to its top note
  // passes through every pitch on the way, and an octave-error blip from the
  // detector lasts a frame. Half a second of the same rung is a sung note.
  function feedFinder(t, m) {
    const r = Math.round(m);
    if (finder.holdMidi !== r) { finder.holdMidi = r; finder.holdSince = t; return; }
    if (t - finder.holdSince < HOLD_STABLE_S) return;
    if (finder.step === 'low')  finder.cand = finder.cand == null ? r : Math.min(finder.cand, r);
    else                        finder.cand = finder.cand == null ? r : Math.max(finder.cand, r);
  }

  const tuneColor = c => Math.abs(c) <= IN_TUNE_CENTS ? tk.get('ok') : Math.abs(c) <= OFF_CENTS ? tk.get('ink-dim') : tk.get('bad');

  // ── drawing ──────────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, d = window.devicePixelRatio || 1;
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w; cssH = h; dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
  }
  const font = (px, weight = 700) => `${weight} ${Math.max(6, Math.round(px * tk.ui))}px 'JetBrains Mono',monospace`;

  function draw(now) {
    resize();
    vis = span();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    drawOctaves();
    drawRange();
    drawRungs();
    drawTargets(now);
    drawTrail(now);
    drawTimeAxis(now);
    drawHead(now);
  }

  // Octave bands alternate so the eye can count octaves without reading a label,
  // the way a fretboard's inlays let you count frets without looking at numbers.
  function drawOctaves() {
    const g = gutter(), r = right();
    for (let c = Math.floor(vis.lo / 12) * 12; c <= vis.hi; c += 12) {
      const top = yOf(Math.min(vis.hi, c + 11) + 0.5), bot = yOf(Math.max(vis.lo, c) - 0.5);
      if ((c / 12) % 2 === 0) { ctx.fillStyle = tk.alpha('ink', 0.035); ctx.fillRect(g, top, r - g, bot - top); }
    }
  }

  // The singer's own range as a wash. A target rung outside it is drawn dim
  // (see drawTargets) — still there, still true, just not for this voice.
  function drawRange() {
    const g = gutter(), r = right();
    const paint = (lo, hi, a) => {
      const top = yOf(hi + 0.5), bot = yOf(lo - 0.5);
      ctx.fillStyle = tk.alpha('ok', a); ctx.fillRect(g, top, r - g, bot - top);
      ctx.strokeStyle = tk.alpha('ok', a * 5); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(g, top + .5); ctx.lineTo(r, top + .5); ctx.moveTo(g, bot + .5); ctx.lineTo(r, bot + .5); ctx.stroke();
      ctx.setLineDash([]);
    };
    if (range && !finder) paint(range.low.midi, range.high.midi, 0.06);
    // While finding, the running candidate is the only thing worth seeing.
    if (finder) {
      const lo = finder.step === 'high' ? finder.low : finder.cand;
      const hi = finder.step === 'high' ? finder.cand : finder.low;
      if (lo != null) paint(lo, hi != null ? hi : lo, 0.1);
    }
  }

  // The gutter is a vertical keyboard — naturals light, sharps recessed — because
  // it reads at any density, and the note letter rides on each key in the app's
  // one colour code wherever there is room for it. When the rungs are tight, F
  // and B drop their letters: they are the two naturals with no sharp under them
  // (E–F and B–C are the half steps), so they are the ones that collide.
  function drawRungs() {
    const g = gutter(), r = right(), sp = semiPx();
    const labelAll = sp >= 11 * tk.ui, labelNat = sp >= 5.5 * tk.ui, tight = sp < 9 * tk.ui;
    ctx.textBaseline = 'middle';
    for (let m = vis.lo; m <= vis.hi; m++) {
      const y = yOf(m), pc = pcOf(m), nat = isNatural(pc), isC = pc === 'C', ik = inKey(pc);
      // key block
      ctx.fillStyle = nat ? (ik ? pcAlpha(pc, 45, 60, 0.22) : tk.alpha('ink', 0.10)) : tk.alpha('panel', 0.9);
      ctx.fillRect(2, y - sp / 2 + .5, g - 6, sp - 1);
      // rung across the plot
      ctx.strokeStyle = isC ? tk.alpha('ink', 0.32) : nat ? tk.alpha('ink', 0.13) : tk.alpha('ink', 0.05);
      ctx.lineWidth = isC ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(g, y + .5); ctx.lineTo(r, y + .5); ctx.stroke();
      // letter
      const show = isC || labelAll || (labelNat && nat && !(tight && (pc === 'F' || pc === 'B')));
      if (!show) continue;
      ctx.font = font(isC ? 9 : 8);
      ctx.textAlign = 'left';
      ctx.fillStyle = ik ? pcColor(pc, 74, nat ? 42 : 66) : tk.get('ink-faint');
      ctx.fillText(isC ? nameOf(m) : pc, 6, y);
    }
  }

  // Targets are the neck's dots, transposed: one rung per octave of each lit pitch
  // class, root heaviest, in the note's own hue. A pedal that fires
  // 'resonote:played' names the note sounding RIGHT NOW, so that one goes hot for
  // a moment on top of the standing chord.
  function drawTargets(now) {
    const g = gutter(), r = right();
    if (played && now > played.until) played = null;
    const hot = new Set(played ? played.pcs : []);
    const lit = chordHighlight.active ? (chordHighlight.chordNotes || []).map(toSharp).filter(p => NOTES.includes(p)) : [];
    const root = chordHighlight.active ? toSharp(chordHighlight.rootNote || '') : '';
    const ghost = ghostHighlight.active ? [...new Set((ghostHighlight.positions || []).map(p => p && p.note).map(n => n && toSharp(n)).filter(n => NOTES.includes(n)))] : [];

    const rung = (pc, m, { color, width, alpha, dashed, label, chipText, chipFill }) => {
      const y = yOf(m);
      const outside = range && (m < range.low.midi || m > range.high.midi);
      ctx.globalAlpha = outside ? alpha * 0.35 : alpha;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(g, y + .5); ctx.lineTo(r, y + .5); ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        // chip at the right edge — the letter rides with the colour, always
        const w = Math.round(18 * tk.ui), h = Math.min(Math.round(13 * tk.ui), Math.max(8, semiPx() - 1));
        ctx.fillStyle = chipFill; ctx.fillRect(r - w, y - h / 2, w, h);
        ctx.font = font(8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = chipText; ctx.fillText(pc, r - w / 2, y + .5);
      }
      ctx.globalAlpha = 1;
    };

    for (const pc of lit) {
      const isRoot = pc === root, isHot = hot.has(pc);
      const i0 = NOTES.indexOf(pc);
      for (let m = vis.lo; m <= vis.hi; m++) {
        if (((m % 12) + 12) % 12 !== i0) continue;
        rung(pc, m, {
          color: pcColor(pc, 78, isHot ? 66 : 58), width: isHot ? 3 : isRoot ? 2.2 : 1.4,
          alpha: isHot ? 1 : isRoot ? 0.9 : 0.6, dashed: false,
          label: isRoot || isHot, chipFill: pcColor(pc, 78, 58), chipText: pcTextOn(pc),
        });
      }
    }
    for (const pc of ghost) {
      if (lit.includes(pc)) continue;                  // already a solid rung; don't fight it
      const i0 = NOTES.indexOf(pc);
      for (let m = vis.lo; m <= vis.hi; m++) {
        if (((m % 12) + 12) % 12 !== i0) continue;
        rung(pc, m, { color: GHOST_BLUE, width: 1.4, alpha: 0.7, dashed: true, label: true, chipFill: 'rgba(92,200,255,0.18)', chipText: GHOST_BLUE });
      }
    }

    if (capEl) {
      const parts = [];
      if (keyPcs) { const mk = pedalBus.masterKey || {}; parts.push(`${toSharp(mk.root || pedalBus.root)} ${mk.keyType || pedalBus.keyType || ''}`.trim()); }
      const what = played?.label || (chordHighlight.active && chordHighlight.label) || conceptInfo?.title || '';
      if (what && what !== parts[0]) parts.push(what);         // "C Major · C Major" says nothing twice
      const txt = parts.join('  ·  ');
      if (capEl.textContent !== txt) capEl.textContent = txt;
    }
  }

  // The sung line. Colour is the accuracy channel — green is on the rung, neutral
  // is drifting, the judgement pink is past the point where it is a different
  // note. The pitch itself is the line's HEIGHT against the rungs, so a flat note
  // is visibly under its rung without any colour at all.
  function drawTrail(now) {
    if (history.length < 2) return;
    const g = gutter();
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1], b = history[i];
      if (b.t - a.t > 0.25) continue;                          // a silence: don't bridge it
      if (Math.abs(b.midi - a.midi) > 7) continue;             // an octave flip from the detector, not a leap
      const age = (now - b.t) / view.seconds;
      if (age > 1) continue;
      const x0 = xOf(a.t, now), x1 = xOf(b.t, now);
      if (x1 < g) continue;
      ctx.globalAlpha = Math.max(0.08, 0.9 * (1 - age));
      ctx.strokeStyle = tuneColor(b.cents);
      ctx.beginPath(); ctx.moveTo(Math.max(g, x0), yOf(a.midi)); ctx.lineTo(x1, yOf(b.midi)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawTimeAxis(now) {
    const g = gutter(), nx = nowX(), y = cssH - PAD.b + 4;
    ctx.strokeStyle = tk.alpha('ink', 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(nx + .5, PAD.t - 4); ctx.lineTo(nx + .5, cssH - PAD.b + 4); ctx.stroke();
    ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = tk.get('ink-faint');
    // whole-second ticks that scroll with the trace, so a held note reads as "3 s long"
    const first = Math.floor(now - view.seconds);
    for (let s = first; s <= now; s++) {
      const x = xOf(s, now);
      if (x < g) continue;
      ctx.fillRect(x, y, 1, 3);
      const ago = Math.round(now - s);
      if (ago % 2 === 0) ctx.fillText(ago === 0 ? 'now' : `−${ago}s`, x, y + 5);
    }
  }

  // The ball at the now-line: the note's own hue for identity, an accuracy ring,
  // and a tick from the ball to the nearest rung with the cents written out, so
  // "how far off" is a distance you can see AND a number you can say.
  function drawHead(now) {
    const last = history[history.length - 1];
    const live = last && now - last.t < 0.25;
    if (!live) {
      noteEl.textContent = '—'; noteEl.style.color = 'var(--rk-ink-faint)'; noteEl.style.textShadow = 'none';
      centsEl.textContent = '—¢'; centsEl.style.color = 'var(--rk-ink-faint)';
      return;
    }
    const nx = nowX(), y = yOf(last.midi), ry = yOf(Math.round(last.midi));
    const core = pcColor(last.note, 80, 62), ring = tuneColor(last.cents);
    const inTune = Math.abs(last.cents) <= IN_TUNE_CENTS;

    if (!inTune) {
      ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(nx + .5, y); ctx.lineTo(nx + .5, ry); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ring; ctx.fillRect(nx - 5, ry, 11, 1.5);                 // the rung you are aiming at
    }
    ctx.beginPath(); ctx.arc(nx, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = ring; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(nx, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = core; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = ring; ctx.stroke();

    ctx.font = font(10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ring;
    ctx.fillText(`${last.cents > 0 ? '+' : ''}${last.cents}¢`, nx + 16, y);

    noteEl.textContent = `${last.note}${last.octave}`;
    noteEl.style.color = core; noteEl.style.textShadow = `0 0 22px ${core}55`;
    centsEl.textContent = `${last.cents > 0 ? '+' : ''}${last.cents}¢`;
    centsEl.style.color = ring;
  }

  // ── signals ──────────────────────────────────────────────────────
  const onAudio = () => { if (!destroyed) sample(performance.now() / 1000); };
  const onKey   = () => { if (!destroyed) { sigKey = ''; readKey(); } };
  const onPlayed = ev => {
    if (destroyed) return;
    const pcs = ((ev.detail || {}).pcs || []).map(toSharp).filter(p => NOTES.includes(p));
    if (pcs.length) played = { pcs, label: ev.detail.label || '', until: performance.now() / 1000 + PLAYED_HOLD_S };
  };
  audio.on(onAudio);
  pedalBus.on(onKey);
  window.addEventListener('resonote:played', onPlayed);

  function frame() {
    if (destroyed) return;
    if (!document.body.contains(mount)) { destroy(); return; }
    raf = requestAnimationFrame(frame);
    // Hidden (another instrument is up): idle, and forget the trail so coming back
    // doesn't paint something sung minutes ago.
    if (!mount.getClientRects().length) { if (history.length) { history = []; lastDet = null; } return; }
    if (++frames % 120 === 0) tk.refresh();            // density slider / theme, every ~2 s
    const now = performance.now() / 1000;
    readKey();
    sample(now);
    prune(now);
    draw(now);
    if (finder) hooks.onFinder?.(finder);
    const want = !audio.connected && !audio.connecting;
    const disp = want ? 'flex' : 'none';
    if (hintEl.style.display !== disp) hintEl.style.display = disp;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    off(audio, onAudio);
    off(pedalBus, onKey);
    window.removeEventListener('resonote:played', onPlayed);
    try { hooks.onDestroy?.(); } catch (e) {}
  }

  readKey();
  raf = requestAnimationFrame(frame);

  return {
    destroy,
    setOption(k, v) { view[k] = v; },
    // ── range finder API, driven by the bar ──
    startFinder()  { finder = { step: 'low', cand: null, low: null, holdMidi: null, holdSince: 0 }; },
    cancelFinder() { finder = null; },
    finder: () => finder,
    // Lock the current step. Low first, then high; the second lock saves.
    lockFinder() {
      if (!finder || finder.cand == null) return null;
      if (finder.step === 'low') { finder = { step: 'high', cand: null, low: finder.cand, holdMidi: null, holdSince: 0 }; return 'high'; }
      let lo = finder.low, hi = finder.cand;
      if (hi < lo) [lo, hi] = [hi, lo];                       // sang them the other way round — still a range
      if (hi === lo) hi = lo + 1;
      range = { low: { note: pcOf(lo), octave: Math.floor(lo / 12) - 1, midi: lo },
                high: { note: pcOf(hi), octave: Math.floor(hi / 12) - 1, midi: hi }, at: Date.now() };
      saveRange(range);
      finder = null;
      return 'done';
    },
    clearRange() { range = null; forgetRange(); },
    getRange: () => range,
    candidateName: () => finder && finder.cand != null ? nameOf(finder.cand) : null,
  };
}

// ── the display ───────────────────────────────────────────────────────
let _live = null;      // { destroy, ... } — one view at a time; a re-render replaces it

const BTN = (on) => `background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};` +
  `color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};border-radius:5px;font-family:'JetBrains Mono',monospace;` +
  `font-size:calc(10px*var(--ui));font-weight:700;letter-spacing:.5px;min-height:calc(28px*var(--ui));padding:4px 9px;cursor:pointer`;
const SEL = `background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:5px;` +
  `font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;min-height:calc(28px*var(--ui));padding:4px 6px;cursor:pointer;outline:none`;
const RULE = `<span style="width:1px;height:16px;background:var(--rk-edge-soft)"></span>`;

export function renderVocalsDisplay() {
  const el = document.getElementById('vocals-display');
  if (!el) return null;

  // Idempotent: fretboard.js calls this on EVERY switch to vocals, so the previous
  // view goes down first — one rAF loop, one set of listeners, always.
  destroyVocalsDisplay();

  const view = loadView();
  const folded = view.mode === 'folded';

  // .rk carries the kit tokens. The voice bar sits in the header, not in a pedal
  // card, so there is no accent to inherit and it lands on :root's neutral steel —
  // which is right: the instrument surface belongs to no one pedal. flex-direction
  // is pinned because .rk otherwise stacks its children.
  el.innerHTML = `
    <div id="voc-bar" class="rk" style="display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px;padding:0 2px 2px">
      <span class="mono" style="font-size:calc(9px*var(--ui));letter-spacing:1.2px;color:var(--rk-ink-mute)">🎤 VOICE</span>
      <div style="display:flex;gap:4px">
        ${MODES.map(m => `<button class="voc-mode" data-mode="${m}" style="${BTN(view.mode === m)}">${MODE_LABELS[m]}</button>`).join('')}
      </div>
      ${RULE}
      <select id="voc-seconds" class="mono" style="${SEL}">
        ${SECONDS_CHOICES.map(s => `<option value="${s}" ${s === view.seconds ? 'selected' : ''}>${s}s window</option>`).join('')}
      </select>
      ${folded ? `
      ${RULE}
      <div style="display:flex;gap:4px">
        ${LANE_MODES.map(m => `<button class="voc-lane-btn" data-lanes="${m}" style="${BTN(view.lanes === m)}">${LANE_MODE_LABELS[m]}</button>`).join('')}
      </div>
      ${RULE}
      <div style="display:flex;gap:4px">
        <button class="voc-toggle" data-opt="ball"     style="${BTN(view.ball)}">● Ball</button>
        <button class="voc-toggle" data-opt="trail"    style="${BTN(view.trail)}">∿ Trail</button>
        <button class="voc-toggle" data-opt="notation" style="${BTN(view.notation)}">𝄞 Notation</button>
      </div>` : `
      ${RULE}
      <div id="voc-range" style="display:flex;align-items:center;gap:6px"></div>`}
      <span class="mono" id="voc-legend" style="margin-left:auto;font-size:calc(8px*var(--ui));color:var(--rk-ink-mute);letter-spacing:.4px">
        ${folded ? 'lanes = notes of the key · ghosted band = what to sing · ring green when you\'re on it'
                 : 'coloured rungs = what the pedal is teaching · dashed blue = next · green line = on the note (±15¢)'}
      </span>
    </div>
    <!-- .rk again, because the kit tokens live on .rk, not :root, and the canvas reads them from here -->
    <div id="voc-stage" class="rk" style="display:block;width:100%"></div>`;

  const stage = document.getElementById('voc-stage');

  el.querySelectorAll('.voc-mode').forEach(b => b.addEventListener('click', () => {
    if (view.mode === b.dataset.mode) return;
    view.mode = b.dataset.mode; saveView(view);
    renderVocalsDisplay();                                     // the bar's controls differ per mode
  }));

  document.getElementById('voc-seconds')?.addEventListener('change', e => {
    view.seconds = parseInt(e.target.value, 10) || DEFAULTS.seconds;
    saveView(view);
    _live?.setOption('seconds', view.seconds);
  });

  if (folded) {
    const built = createPitchTrace(stage, {
      lanes: view.lanes, ball: view.ball, trail: view.trail, notation: view.notation,
      seconds: view.seconds, height: 230,
      onDestroy: () => { if (_live === built) _live = null; },
    });
    _live = built;
    el.querySelectorAll('.voc-lane-btn').forEach(b => b.addEventListener('click', () => {
      view.lanes = b.dataset.lanes; saveView(view);
      _live?.setLanes(view.lanes);
      el.querySelectorAll('.voc-lane-btn').forEach(x => { x.style.cssText = BTN(x.dataset.lanes === view.lanes); });
      _live?.render();
    }));
    el.querySelectorAll('.voc-toggle').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.opt;
      view[k] = !view[k]; saveView(view);
      _live?.setOption(k, view[k]);
      b.style.cssText = BTN(view[k]);
      _live?.render();
    }));
    return _live;
  }

  // ── ladder + range finder ─────────────────────────────────────────
  const rangeBox = document.getElementById('voc-range');
  let finderStep = null;           // mirrors the ladder's finder so the bar only rerenders on a change
  let finderCand = null;

  const ladder = createLadder(stage, view, {
    onDestroy: () => { if (_live === ladder) _live = null; },
    // Called every frame while finding; the bar text is the running candidate.
    onFinder: f => {
      const cand = ladder.candidateName();
      if (f.step === finderStep && cand === finderCand) return;
      finderStep = f.step; finderCand = cand;
      paintRange();
    },
  });
  _live = ladder;

  function paintRange() {
    if (!rangeBox) return;
    const f = ladder.finder(), r = ladder.getRange();
    if (f) {
      const which = f.step === 'low' ? 'LOWEST' : 'HIGHEST';
      const cand = ladder.candidateName();
      rangeBox.innerHTML = `
        <span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-dim)">Sing your <b style="color:var(--rk-accent)">${which}</b> comfortable note and hold it${f.step === 'high' ? ` (low: ${nameOf(f.low)})` : ''}
          · so far: <b style="color:${cand ? 'var(--rk-ok)' : 'var(--rk-ink-faint)'}">${cand || '—'}</b></span>
        <button id="voc-rf-lock" style="${BTN(true)}" ${cand ? '' : 'disabled'}>✓ That's it</button>
        <button id="voc-rf-cancel" style="${BTN(false)}">✕</button>`;
      document.getElementById('voc-rf-lock')?.addEventListener('click', () => { ladder.lockFinder(); finderStep = null; finderCand = null; paintRange(); });
      document.getElementById('voc-rf-cancel')?.addEventListener('click', () => { ladder.cancelFinder(); finderStep = null; paintRange(); });
      return;
    }
    rangeBox.innerHTML = r
      ? `<span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ok)">${describeRange(r)}</span>
         <button id="voc-rf-fit" style="${BTN(view.fit)}" title="Zoom the ladder to your range">⤢ Fit</button>
         <button id="voc-rf-start" style="${BTN(false)}" title="Sing it again">🎯 Redo</button>
         <button id="voc-rf-clear" style="${BTN(false)}" title="Forget my range">✕</button>`
      : `<button id="voc-rf-start" style="${BTN(false)}">🎯 Find my range</button>`;
    document.getElementById('voc-rf-start')?.addEventListener('click', () => {
      if (!audio.connected) { audio.connect(audio.selectedDeviceId).catch(() => {}); }
      ladder.startFinder(); paintRange();
    });
    document.getElementById('voc-rf-fit')?.addEventListener('click', () => {
      view.fit = !view.fit; saveView(view); ladder.setOption('fit', view.fit); paintRange();
    });
    document.getElementById('voc-rf-clear')?.addEventListener('click', () => { ladder.clearRange(); paintRange(); });
  }
  paintRange();

  return _live;
}

export function destroyVocalsDisplay() {
  if (_live) { try { _live.destroy(); } catch (e) {} _live = null; }
  // Take the controls down with the view. A hidden bar that survives can still be
  // clicked (a stray tap, a coach tour), and its handlers would rebuild a ladder
  // under an instrument that isn't the voice.
  const el = document.getElementById('vocals-display');
  if (el) el.innerHTML = '';
}
