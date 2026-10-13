import { toSharp, intervalLabel, KEY_PATTERNS, SCALE_TYPES } from './music-theory.js';
import { INSTRUMENTS } from './tuning.js';
import { saveBoard, loadBoard, snapshotBoardNow } from './store.js';

// ── Display toggles ──────────────────────────────────────────────────
export let showIntervals    = false;
export let showNoteMap      = false;
export let liveAudioEnabled = false;
// Fretboard view mode: how the highlighted notes are drawn / interacted with.
//   standard · function (degree colours) · tension (heatmap) · chordtone (spotlight) · interval (click-to-measure)
export let fretboardView    = 'standard';

export function setShowIntervals(v)    { showIntervals    = v; }
export function setShowNoteMap(v)      { showNoteMap      = v; }
export function setLiveAudioEnabled(v) { liveAudioEnabled = v; }
export function setFretboardView(v)    { fretboardView    = v; }

export function displayLabel(note, rootNote) {
  if (showIntervals && rootNote) return intervalLabel(rootNote, note);
  return note;
}

// ── Cross-pedal bus (master KEY) ─────────────────────────────────────
// The Circle of Fifths edits the master key via setKey(); pedals are followers.
// Linking is OPT-IN: a pedal only accepts broadcasts once its type is linked.
export const pedalBus = {
  root: null,
  keyType: null,
  source: null,
  generation: 0,                       // ++ on every setKey (stale-broadcast guard)
  session: { root: null, keyType: null },
  // The authoritative master key the session bar mirrors.
  masterKey: { root: null, keyType: null, source: null },
  // Per-pedal-TYPE link mode. OPT-IN: absent ⇒ NOT following. 'linked' ⇒ follows.
  links: {},                           // { [type]: 'linked' }
  listeners: [],
  linkListeners: [],
  rebuildPedal: null,                  // set by main.js: (type, settings?) => void

  // Should a pedal of this type accept master-key broadcasts? Opt-in only.
  follows(type)     { return this.links[type] === 'linked'; },
  isLinked(type)    { return this.links[type] === 'linked'; },
  linkPedal(type)   { this.links[type] = 'linked'; this._notifyLinks(); },
  unlinkPedal(type) { delete this.links[type];     this._notifyLinks(); },
  followerCount(activeTypes) { return (activeTypes || []).filter(t => this.follows(t)).length; },
  onLinks(fn)       { this.linkListeners.push(fn); },
  _notifyLinks()    { this.linkListeners.forEach(fn => fn(this.links)); },

  setKey(root, keyType, meta = {}) {
    this.root    = toSharp(root);
    this.keyType = normalizeKeyType(keyType);
    this.source  = meta.source || null;
    this.generation++;
    this.masterKey = { root: this.root, keyType: this.keyType, source: this.source };
    this.session = {
      ...this.session,
      ...meta,
      root: this.root,
      keyType: this.keyType,
      rawKeyType: keyType,
      generation: this.generation,
      pushChord: meta.pushChord || null
    };
    this.listeners.forEach(fn => fn(this.session));
  },
  on(fn)   { this.listeners.push(fn); },
  clear()  {
    this.root = null; this.keyType = null; this.source = null;
    this.session = { root: null, keyType: null };
    this.listeners.forEach(fn => fn(this.session));
  }
};

// ── Key types ────────────────────────────────────────────────────────
// A key type is a key or mode the app has a scale for: Major, Minor, Harm. Minor,
// Mel. Minor, the modes (Dorian, Phrygian, Lydian, Mixolydian, Locrian) and the
// symmetric scales. Names are matched WHOLE — the full name first, then word by
// word — so a mode keeps its own name instead of collapsing into Major, and
// 'Dominant' no longer reads as minor because it happens to contain "min".
// Pentatonic and blues scales live in the key they come from. Anything that is
// not a key at all (a chord quality like '7 (Dom)') falls back to Major rather
// than reaching the session bar as one.
const KEY_TYPE_ALIASES = {
  'ionian': 'Major', 'aeolian': 'Minor', 'nat. minor': 'Minor', 'natural minor': 'Minor',
  'harmonic minor': 'Harm. Minor', 'melodic minor': 'Mel. Minor',
  'major pent.': 'Major', 'blues major': 'Major', 'minor pent.': 'Minor', 'blues minor': 'Minor',
};
const MODE_WORDS = {
  ionian: 'Major', dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian',
  mixolydian: 'Mixolydian', aeolian: 'Minor', locrian: 'Locrian',
};
const KEY_TYPE_NAMES = [...Object.keys(KEY_PATTERNS), ...Object.values(SCALE_TYPES).flatMap(t => Object.keys(t))];

export function normalizeKeyType(keyType) {
  const k = String(keyType || '').trim().toLowerCase();
  if (!k) return 'Major';
  if (KEY_TYPE_ALIASES[k]) return KEY_TYPE_ALIASES[k];
  const named = KEY_TYPE_NAMES.find(n => n.toLowerCase() === k);
  if (named) return named;
  const words = k.split(/[^a-z0-9]+/).filter(Boolean);
  const mode = words.find(w => MODE_WORDS[w]);
  if (mode) return MODE_WORDS[mode];
  const has = w => words.includes(w);
  if (has('minor') || has('min') || has('m')) {
    if (has('harm') || has('harmonic')) return 'Harm. Minor';
    if (has('mel') || has('melodic'))   return 'Mel. Minor';
    return 'Minor';
  }
  return 'Major';
}

export function keyTypeToScale(keyType) {
  const kt = normalizeKeyType(keyType);
  const scaleName = kt === 'Minor' ? 'Nat. Minor' : kt;
  for (const [scaleCat, types] of Object.entries(SCALE_TYPES)) if (types[scaleName]) return { scaleCat, scaleName };
  return { scaleCat: 'Diatonic', scaleName: 'Major' };
}

// The scale a key type spells, as semitones above its root (E Phrygian → 0 1 3 5 7 8 10).
export function keyTypeIntervals(keyType) {
  const kt = normalizeKeyType(keyType);
  if (KEY_PATTERNS[kt]) return KEY_PATTERNS[kt].intervals;
  const { scaleCat, scaleName } = keyTypeToScale(kt);
  return SCALE_TYPES[scaleCat][scaleName];
}

// The key's home chord as an arpeggio — its tonic triad, read off the key's own
// scale: Dorian and Phrygian are minor, Lydian and Mixolydian major, Locrian diminished.
export function keyTypeToArpeggio(keyType) {
  const iv = keyTypeIntervals(keyType), has = s => iv.includes(s);
  const minor = has(3) && !has(4);
  const arpName = has(7) ? (minor ? 'Minor' : 'Major')
    : minor ? (has(6) ? 'Dim' : 'Minor') : (has(8) ? 'Aug' : 'Major');
  return { arpCat: 'Triads', arpName };
}

// ── Shared metronome clock ───────────────────────────────────────────
export const metroClock = {
  bpm: 120,
  ts: 4,
  unit: 4,
  playing: false,
  beat: 0,
  beatIndex: 0,
  beatType: 'accent',
  subdiv: 'quarter',
  pattern: ['accent', 'regular', 'regular', 'regular'],
  // 'metronome' when the metronome pedal owns the clock;
  // 'progression' when the progression pedal is the sole driver; null otherwise.
  masterSource: null,
  // Monotonically-increasing pulse counter — incremented on every setBeat() call.
  // Listeners use this to detect a new beat regardless of time-signature wrap-around.
  pulse: 0,
  listeners: [],
  set(bpm, ts, unit = this.unit || 4, pattern = this.pattern) {
    this.bpm = Math.max(20, Math.min(300, Math.round(Number(bpm) || this.bpm || 120)));
    this.ts = Math.max(1, Math.min(32, Math.round(Number(ts) || this.ts || 4)));
    this.unit = [1, 2, 4, 8, 16, 32].includes(Number(unit)) ? Number(unit) : 4;
    this.pattern = normalizeMetroPattern(pattern, this.ts);
    this.beatIndex = Math.max(0, Math.min(this.ts - 1, this.beatIndex || 0));
    this.beat = this.beatIndex + 1;
    this.beatType = this.pattern[this.beatIndex] || 'regular';
    this.emit();
  },
  setBeat(beatIndex, beatType) {
    this.beatIndex = Math.max(0, Math.min(this.ts - 1, Number(beatIndex) || 0));
    this.beat = this.beatIndex + 1;
    this.beatType = beatType || this.pattern[this.beatIndex] || 'regular';
    this.pulse++;           // every real beat increments the pulse
    this.emit();
  },
  getConfigSignature() {
    return `${this.bpm}|${this.ts}|${this.unit}|${this.subdiv}|${this.pattern.join(',')}`;
  },
  emit()  { this.listeners.forEach(fn => fn(this)); },
  on(fn)  { this.listeners.push(fn); },

  // ── Master-tempo link model (opt-in, symmetric to pedalBus) ─────────
  links: {},
  linkListeners: [],
  follows(type)     { return this.links[type] === 'linked'; },
  isLinked(type)    { return this.links[type] === 'linked'; },
  linkPedal(type)   { this.links[type] = 'linked'; this._notifyLinks(); },
  unlinkPedal(type) { delete this.links[type];     this._notifyLinks(); },
  followerCount(activeTypes) { return (activeTypes || []).filter(t => this.follows(t)).length; },
  onLinks(fn)       { this.linkListeners.push(fn); },
  _notifyLinks()    { this.linkListeners.forEach(fn => fn(this.links)); },
  getTempo()        { return { bpm: this.bpm, ts: this.ts, unit: this.unit, pattern: this.pattern, subdiv: this.subdiv }; },

  // ── Master transport registry ───────────────────────────────────────
  // Every sound-producing pedal registers a stop fn under its instance id.
  // Starting ANY transport stops the others → one clock at a time.
  transports: {},                                  // { [pedalId]: stopFn }
  registerTransport(id, stopFn) { this.transports[id] = stopFn; },
  unregisterTransport(id)       { delete this.transports[id]; },
  stopOthers(exceptId) {
    Object.keys(this.transports).forEach(id => {
      if (id === exceptId) return;
      try { this.transports[id](); } catch (e) {}
    });
  },
  stopAll() {
    Object.keys(this.transports).forEach(id => { try { this.transports[id](); } catch (e) {} });
  },
};

export function normalizeMetroPattern(pattern, beats) {
  const allowed = new Set(['accent', 'regular', 'ghost', 'alternate', 'rest']);
  const next = Array.isArray(pattern) ? [...pattern] : [];
  const len = Math.max(1, Math.min(32, Math.round(Number(beats) || 4)));
  while (next.length < len) next.push(next.length === 0 ? 'accent' : 'regular');
  return next.slice(0, len).map((v, i) => allowed.has(v) ? v : (i === 0 ? 'accent' : 'regular'));
}

// ── Chord highlight state ────────────────────────────────────────────
export let chordHighlight = {
  active: false, rootNote: null, chordNotes: [], label: '',
  positions: null, colors: null, focusPos: null, trail: null, focusOnly: false
};

// `trail` (optional) = the previous step's focus position(s) {si,fret} — rendered as a
// fading gold dot behind the current focus so a moving sequence reads as motion.
// `focusOnly` (optional) = draw ONLY the active/playing note(s), no dim background dots or
// connecting path — used by the interval double-stop drills so they don't read as a cluster.
export function setChordHighlight(rootNote, chordNotes, label, positions, colors, focusPos, trail, focusOnly) {
  chordHighlight = {
    active: true, rootNote, chordNotes, label,
    positions: positions || null,
    colors:    colors    || null,
    focusPos:  focusPos  || null,
    trail:     trail      || null,
    focusOnly: !!focusOnly
  };
}

export function clearChordHighlight() {
  chordHighlight = {
    active: false, rootNote: null, chordNotes: [], label: '',
    positions: null, colors: null, focusPos: null, trail: null, focusOnly: false
  };
}

// ── Concept info (objective facts strip under the fretboard) ─────────
// Pedals set this alongside a highlight so the theory FACTS of what's on the neck —
// name, notes, degrees, structure, resolution — are reinforced right below the strings.
// { title, rows: [{ label, value }] } | null
export let conceptInfo = null;
export function setConceptInfo(info) { conceptInfo = info || null; }

// Now/next banner shown ABOVE the neck during workouts/drills:
// { now: {text, color}, next: {text} } — next is tinted by the fretboard itself
// with the active theme's ghost color, so it always matches the ghost dots.
export let nowBanner = null;
export function setNowBanner(b) { nowBanner = b || null; }

// ── Ghost highlight (upcoming note preview — dimmed/outlined dots) ────
export let ghostHighlight = { active: false, positions: null, colors: null };

export function setGhostHighlight(positions, colors) {
  ghostHighlight = { active: true, positions: positions || [], colors: colors || null };
}

export function clearGhostHighlight() {
  ghostHighlight = { active: false, positions: null, colors: null };
}

// ── Fretboard position isolation (hand-position window + custom shape) ─
export let positionIsolation = {
  active: false,
  loFret: 0, hiFret: 4,
  loString: null, hiString: null,    // null ⇒ all strings
  dimOutside: true,
  selectedPreset: null,              // 'window' | 'quick-N' | 'box-N' | 'custom'
  customShape: null,                 // [{si,fret}] when click-defined
  defining: false                    // true while building a custom shape
};

export const positionBus = {
  listeners: [],
  on(fn) { this.listeners.push(fn); },
  _emit() { this.listeners.forEach(fn => fn(positionIsolation)); },
  set(loFret, hiFret, opts = {}) {
    const lo = Math.max(0, Math.min(loFret, hiFret));
    positionIsolation = { ...positionIsolation, active: true, loFret: lo,
      hiFret: Math.max(lo, hiFret), defining: false, customShape: null, ...opts };
    this._emit();
  },
  update(opts = {}) { positionIsolation = { ...positionIsolation, ...opts }; this._emit(); },
  setDefining(on) {
    positionIsolation = { ...positionIsolation, defining: !!on,
      customShape: on ? (positionIsolation.customShape || []) : positionIsolation.customShape };
    this._emit();
  },
  addShapeFret(si, fret) {
    const shape = (positionIsolation.customShape || []).slice();
    const i = shape.findIndex(p => p.si === si && p.fret === fret);
    if (i >= 0) shape.splice(i, 1); else shape.push({ si, fret });
    const frets = shape.map(p => p.fret);
    positionIsolation = { ...positionIsolation, active: shape.length > 0, customShape: shape,
      selectedPreset: 'custom', loString: null, hiString: null,
      loFret: frets.length ? Math.min(...frets) : 0, hiFret: frets.length ? Math.max(...frets) : 4 };
    this._emit();
  },
  clear() {
    positionIsolation = { ...positionIsolation, active: false, defining: false,
      selectedPreset: null, customShape: null, loString: null, hiString: null };
    this._emit();
  }
};

// ── Save / Load ──────────────────────────────────────────────────────
export function saveState(pedals, display) {
  try {
    const state = {
      pedals: pedals.map(p => ({
        id: p.id, type: p.type,
        x: Math.round(p.x), y: Math.round(p.y),
        w: p.w, h: p.h,
        minimized: !!p.minimized,
        _origH: p._origH,
        settings: p.settings || {}
      })),
      display
    };
    // Through the store, which snapshots the previous board whenever its SHAPE
    // changes — a pedal added, removed, or migrated to a type that no longer
    // exists. Autosave fires constantly (every drag, every resize), so an
    // autosave landing at the wrong moment used to be unrecoverable: it silently
    // replaced the only copy. Now it leaves the old one behind.
    saveBoard(state);
  } catch(e) {}
}

export function loadState() { return loadBoard(); }

// What can be rolled back to, and how. Reachable from the console as
// `resonote.history()` / `resonote.undoBoard()` — see the binding in main.js.
export { boardHistory, restoreBoard } from './store.js';

export function resetState() {
  // Snapshot BEFORE the wipe, not after. A reset is the single most destructive
  // thing the app can do to a board, and it is one mis-click away.
  try { snapshotBoardNow('reset'); } catch(e) {}
  try {
    localStorage.removeItem('resonote-state');
    localStorage.removeItem('resonote-seen');
  } catch(e) {}
  location.reload();
}
