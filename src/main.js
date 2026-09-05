import { audio } from './core/audio.js';
import { setCurrentInstrument, setCustomTuning, applyTuning, currentInstrument, customTuning, INSTRUMENTS } from './core/tuning.js';
import { loadState, saveState, setShowIntervals, setShowNoteMap, chordHighlight, pedalBus, metroClock, fretboardView } from './core/state.js';
import { boardHistory, restoreBoard, snapshotBoardNow, inventory, read as storeRead, write as storeWrite, KEYS } from './core/store.js';
import { restoreMissing } from './core/kevin-library.js';
import { buildInstrumentView, buildTuningBar, updateOverlays, setCurrentTheme, currentTheme, INST_DEFAULT_THEME, setLastClickedNote, fretX, geo, pianoGeo, PIANO_BLACK, PIANO_BLACK_POS, PIANO_WHITE } from './ui/fretboard.js';
import { renderHeader, renderInstrumentBar, renderInstrumentDisplay, renderCatalog, renderHelp, loadoutDone } from './ui/header.js';
import { createPedalElement, bringToFront, LINK_PROFILE } from './ui/pedal-system.js';
import { buildPositionBar, isDefining, addShapeFret } from './ui/position-bar.js';
import { buildContent, CATALOG } from './pedals/index.js';
import { renderVocalsDisplay } from './pedals/vocals.js';
import { startCoach } from './ui/coach.js';
import { initRemote } from './core/remote.js';

// ── Drill routing: send a Theory-Path drill to the pedal that fits its TYPE ──
// (NOTES is imported lower in this file; imports are hoisted so it's available here.)
function scaleFromNotes(prog, root) {
  const noteSet = [...new Set(prog.map(c => c.root).filter(Boolean))];
  const ri = NOTES.indexOf(root);
  const cands = [
    ['Diatonic', 'Major', [0,2,4,5,7,9,11]], ['Diatonic', 'Nat. Minor', [0,2,3,5,7,8,10]],
    ['Modes', 'Mixolydian', [0,2,4,5,7,9,10]], ['Modes', 'Dorian', [0,2,3,5,7,9,10]],
    ['Pentatonic', 'Major Pent.', [0,2,4,7,9]], ['Pentatonic', 'Minor Pent.', [0,3,5,7,10]],
  ];
  for (const [cat, name, iv] of cands) {
    const set = new Set(iv.map(i => NOTES[(ri + i + 12) % 12]));
    if (noteSet.length && noteSet.every(n => set.has(n))) return { cat, name };
  }
  return { cat: 'Diatonic', name: 'Major' };
}
function progressionGrid(d) {
  const bpb = Math.max(1, metroClock.ts || 4), cells = [];
  d.progression.forEach(c => { cells.push({ root: c.root, quality: c.quality, numeral: c.numeral || '' }); for (let i = 1; i < Math.max(1, c.beats || 2); i++) cells.push(null); });
  while (cells.length % bpb !== 0) cells.push(null);
  return { progMode: 'custom', gridBars: Math.max(1, cells.length / bpb), customGrid: cells, root: d.progression[0]?.root || 'C', _autoStart: true };
}
function chordLabel(c) {
  if (!c) return 'C';
  const q = c.quality || 'Major';
  const suf = q === 'Major' ? '' : q === 'Minor' ? 'm' : q === 'Dim' ? 'dim' : q === 'Aug' ? 'aug'
    : /Maj7/.test(q) ? 'maj7' : /Min7|m7/.test(q) ? 'm7' : /7/.test(q) ? '7' : '';
  return c.root + suf;
}
// Pick the scale a note/solo drill should display, reading the lesson's own words first.
function deriveScale(d, root) {
  const sig = ((d.title || '') + ' ' + (d.focus || '') + ' ' + (d.voicing || '')).toLowerCase();
  if (/blue note|blues/.test(sig))     return { cat: 'Blues', name: /major/.test(sig) ? 'Blues Major' : 'Blues Minor' };
  if (/pentatonic|\bpent\b/.test(sig)) return { cat: 'Pentatonic', name: (/major/.test(sig) && !/minor/.test(sig)) ? 'Major Pent.' : 'Minor Pent.' };
  if (/dorian/.test(sig))              return { cat: 'Modes', name: 'Dorian' };
  if (/mixolydian/.test(sig))          return { cat: 'Modes', name: 'Mixolydian' };
  if (/phrygian/.test(sig))            return { cat: 'Modes', name: 'Phrygian' };
  if (/lydian/.test(sig))              return { cat: 'Modes', name: 'Lydian' };
  if (/locrian/.test(sig))             return { cat: 'Modes', name: 'Locrian' };
  if (/harmonic minor/.test(sig))      return { cat: 'Diatonic', name: 'Harm. Minor' };
  if (/melodic minor/.test(sig))       return { cat: 'Diatonic', name: 'Mel. Minor' };
  if (/\bminor\b|aeolian/.test(sig))   return { cat: 'Diatonic', name: 'Nat. Minor' };
  return scaleFromNotes(d.progression || [], root);
}
function routeDrill(d) {
  const sig = ((d.voicing || '') + ' ' + (d.pattern || '') + ' ' + (d.focus || '') + ' ' + (d.title || '')).toLowerCase();
  const prog = Array.isArray(d.progression) ? d.progression : [];
  const root = prog[0]?.root || 'C';
  // Alphabet / musical-alphabet climb → Technique Workshop · Positions tab, as a
  // FIXED base drill: A natural minor single-string climb at 120 BPM. (Transposing
  // a drill to the Circle-of-Fifths key is a later, per-drill opt-in — not the default.)
  if (/alphabet/.test(sig)) {
    return { type: 'workshop', bpm: 120, settings: { ws_tab: 'positions', _autoStartTab: 'positions', mode: 'scales', root: 'A', scaleCat: 'Diatonic', scaleName: 'Nat. Minor', direction: 'cycle', advanceMode: 'auto', pathMode: 'string', startOnRoot: true, _autoStart: true } };
  }
  // fingerstyle / Travis → Technique Workshop · Finger tab (the picking-hand drill)
  if (/fingerstyle|p-?i-?m-?a|travis|rolling arpegg|boom-chick/.test(sig)) {
    return { type: 'workshop', settings: { ws_tab: 'finger', fingerInst: 'guitar', fChordMode: 'chord', fChordRoot: chordLabel(prog[0]), _autoStart: true } };
  }
  // scale run / pentatonic box / solo → Technique Workshop · Positions tab (auto-climbs the scale at tempo)
  if (/scale run|scale ascending|box \d|pentatonic|\bsolo\b|up-and-down|five boxes|blue note|phrasing/.test(sig)) {
    let sc = deriveScale(d, root);
    if (sc.name === 'Major' && prog[0]?.quality === 'Minor') sc = { cat: 'Pentatonic', name: 'Minor Pent.' };
    return { type: 'workshop', settings: { ws_tab: 'positions', mode: 'scales', root, scaleCat: sc.cat, scaleName: sc.name, direction: 'cycle', advanceMode: 'auto', _autoStart: true } };
  }
  // single-note / interval foundation → Scale & Arpeggio Explorer (show the scale)
  if (/single note|one note|single-note|two-note|interval|half[- ]step|whole[- ]step|chromatic|scale degree|one string|octave/.test(sig)) {
    const sc = deriveScale(d, root);
    return { type: 'scales', settings: { saMode: 'scales', root, scaleCat: sc.cat, scaleName: sc.name, saView: 'positions' } };
  }
  // default: a chord progression → Progression Studio (plays the changes)
  return { type: 'progression', settings: progressionGrid(d) };
}

// ── App state ────────────────────────────────────────────────────────
// First-run board: the five Basic reference/utility pedals + the Theory Path (the
// learning front door). Laid out without overlaps; everything else is one click
// away in + PEDALS. Bump BOARD_V when this default changes — saved boards from an
// older default reset to the new layout once.
// BOARD_V 3 (2026-08-01): the page structure changed under saved boards several
// times in one day (the TAB page moved above the neck, the pedal layer moved to
// the viewport). A board saved across those carries coordinates for a layout that
// no longer exists, which is what "the pedals open blank and incorrect" looks
// like. Bumping this discards such a board ONCE and rebuilds the default below.
const BOARD_V = 3;
// Bumped when the pedal layer's coordinate space changes (see restoreState).
const LAYER_V = 1;
// Whether the SAVED board was actually adopted. A board discarded by the BOARD_V
// gate leaves the literal coordinates above in place, and those are written for
// the old inside-the-board space — so it has to be treated as a first run and
// given the tidy pass, or the app opens on a scrambled layout.
let boardAdopted = false;

// THE default board, by name, in one place: hear yourself, keep time, see the key,
// look up a chord or a scale, and the Theory Path as the learning front door.
// Every route back to a known-good state (first run, a discarded board, ↺ RESET)
// builds from exactly this — so "what you get when you open Resonote" has one
// definition instead of three.
const DEFAULT_BOARD = () => ([
  { id:'audio-1',  type:'audio',     x:10,  y:10,  w:240, h:340 },
  { id:'metro-1',  type:'metronome', x:10,  y:360, w:250, h:460 },
  { id:'c5-1',     type:'circle5',   x:270, y:10,  w:300, h:460 },
  { id:'chords-1', type:'chords',    x:270, y:480, w:290, h:480 },
  { id:'scales-1', type:'scales',    x:580, y:10,  w:300, h:540 },
  { id:'theory-1', type:'theory',    x:900, y:10,  w:470, h:690 },
]);
let pedals = DEFAULT_BOARD();

const START_KEY = { root:'C', keyType:'Major' };

function getLearningDefaults(type) {
  const base = { root: START_KEY.root };
  const defaults = {
    circle5:     { selKey:0, selMinor:false },
    chords:      { ...base, keyMode:START_KEY.keyType, chordType:'Major', chordCat:'Triads' },
    scales:      { ...base, scaleCat:'Diatonic', scaleName:'Major' },
    arpeggios:   { ...base, arpCat:'Triads', arpName:'Major' },
    progression: { ...base, keyType:START_KEY.keyType },
    runner:      { ...base, scaleCat:'Diatonic', scaleName:'Major', arpCat:'Triads', arpName:'Major' },
    finger:      { fingerRoot:START_KEY.root, fChordRoot:START_KEY.root },
    practice:    { root:START_KEY.root },
    songdir:     { addKey:START_KEY.root },
  };
  return defaults[type] || {};
}

function normalizePedalToStartKey(p, force = false) {
  const defaults = getLearningDefaults(p.type);
  if (!Object.keys(defaults).length) return p;
  const settings = p.settings || {};
  p.settings = force ? { ...settings, ...defaults } : { ...defaults, ...settings };
  return p;
}

function normalizePedalsToStartKey(force = false) {
  pedals = pedals.map(p => normalizePedalToStartKey(p, force));
}

// ── Restore saved state ───────────────────────────────────────────────
// Pedals that were merged into others. Migrate saved boards on load so BOTH the
// card chrome (CATALOG.find by p.type) and the body resolve — not just the body.
const LEGACY_MIGRATE = {
  arpeggios: { type: 'scales',   set: { saMode: 'arps' } },
  notequiz:  { type: 'ear',      set: { fetGroup: 'theory' } },
  runner:    { type: 'workshop', set: { ws_tab: 'positions' } },
  rhythm:    { type: 'workshop', set: { ws_tab: 'groove' } },
  finger:    { type: 'workshop', set: { ws_tab: 'finger' } },
  technique: { type: 'workshop', set: { ws_tab: 'technique' } },
  // the Great Reorg merges (2026): each retired pedal opens its new home view
  tuner:      { type: 'audio',     set: { aview: 'tuner' } },
  melody:     { type: 'ear',       set: { fetGroup: 'ear' } },
  voicinglab: { type: 'workshop',  set: { ws_tab: 'voicings' } },
  // The Sketchpad became the Practice Manager's 📖 Songbook. BOTH old types land
  // DIRECTLY on 'practice' — this table is a single lookup with no loop, so pointing
  // songdir at 'sketchpad' would leave a saved Song Directory card on a type that no
  // longer exists: a grey card with an empty body you can only close with ✕.
  // Nothing is lost in the hop: every sketch lives in localStorage, not in the card.
  songdir:    { type: 'practice',  set: { pmView: 'library', smode: 'library' } },
  sketchpad:  { type: 'practice',  set: { pmView: 'library' } },
};
const WORKSHOP_TAB_OF = { runner: 'positions', rhythm: 'groove', finger: 'finger', technique: 'technique' };
function migrateLegacyPedal(p) {
  const m = LEGACY_MIGRATE[p.type];
  if (!m) return p;
  p.settings = p.settings || {};
  Object.entries(m.set).forEach(([k, v]) => { if (p.settings[k] === undefined) p.settings[k] = v; });
  p.type = m.type;
  return p;
}

function restoreState() {
  const state = loadState();
  if (!state) return;
  // Boards saved under an older default layout reset ONCE to the new default
  // (pedal-internal progress lives in its own storage and is untouched).
  if (state.pedals?.length && state.display?.boardV === BOARD_V) {
    boardAdopted = true;
    pedals = state.pedals.map(p => migrateLegacyPedal({ ...p, settings: p.settings || {} }));
    // A pedal is addressed by its id (#pedal-<id> and #body-<id>). Two entries
    // sharing an id would mount one card between them, leaving the second saved
    // but invisible — so any repeat gets its own id on the way in.
    const seenIds = new Set();
    pedals.forEach(p => {
      if (!p.id || seenIds.has(p.id)) p.id = p.type + '-' + (Date.now() + seenIds.size);
      seenIds.add(p.id);
    });
    // Pedals used to be positioned inside the board (which sat below the neck);
    // they now live on a viewport layer where y is measured from the top of the
    // screen. Shift saved boards down by the old board offset ONCE so an
    // existing arrangement keeps the shape its owner gave it.
    if (state.display.layerV !== LAYER_V) {
      const off = document.getElementById('board-area')?.offsetTop || 0;
      if (off) pedals.forEach(p => { p.y = (p.y || 0) + off; });
    }
  }
  if (state.display) {
    const d = state.display;
    if (d.currentInstrument && INSTRUMENTS[d.currentInstrument]) {
      setCurrentInstrument(d.currentInstrument);
      setCurrentTheme(INST_DEFAULT_THEME[d.currentInstrument] || 'gibson');
    }
    if (d.showIntervals !== undefined) setShowIntervals(d.showIntervals);
    if (d.showNoteMap   !== undefined) setShowNoteMap(d.showNoteMap);
    if (d.customTuning && d.customTuning.length) {
      setCustomTuning(d.customTuning);
    } else if (INSTRUMENTS[d.currentInstrument]?.strings?.length) {
      applyTuning(INSTRUMENTS[d.currentInstrument].strings);
    }
    if (d.currentTheme)                setCurrentTheme(d.currentTheme);
    // Come back INTO focus mode rather than out of it: the board is already
    // docked, so re-entering makes the screen honest (button lit, neck given the
    // room) and leaves 🎯 as the one press that restores everything.
    if (d.focusMode) { focusMode = true; focusPrev = Array.isArray(d.focusPrev) ? d.focusPrev : null; }
    // Restore the SCALE only — the cards were saved at their already-scaled size,
    // so re-applying the ratio here would compound it on every launch until a
    // pedal was wider than the screen.
    if (d.uiScale) setDensity(d.uiScale, { skipCards: true, quiet: true });
    if (d.learnSettings && typeof d.learnSettings === 'object') learnSettings = d.learnSettings;
  }
}

// ── Persist state ─────────────────────────────────────────────────────
function save() {
  saveState(pedals, {
    boardV: BOARD_V,
    layerV: LAYER_V,
    currentInstrument,
    showIntervals:  false,
    showNoteMap:    false,
    customTuning:   customTuning.length ? customTuning.map(s => ({ note: s.note, octave: s.octave })) : null,
    // the look the player actually chose (load-out / STYLE combo) outranks the
    // instrument's default wood — otherwise the choice dies on the next launch
    currentTheme:   currentTheme || INST_DEFAULT_THEME[currentInstrument],
    // Focus mode minimizes every pedal, and minimizing is saved. So without
    // ALSO saving the mode, a reload came back with the whole board docked, the
    // 🎯 button unlit and nothing on screen explaining why — a state you could
    // only escape by opening eight pedals one at a time. The mode and the board
    // it interrupted travel together or not at all.
    focusMode,
    focusPrev,
    uiScale,
    learnSettings,
  });
}
window.addEventListener('beforeunload', save);

// ── Add a pedal ────────────────────────────────────────────────────────
// Pedals spawn ON the board (below the neck) and never on top of each other:
// scan the board area left-to-right, top-to-bottom for the first gap that fits.
// The first y a pedal may occupy. The dock rail is position:fixed at the neck's
// bottom edge — the SAME y the board starts at — so it floats over the top of the
// board. Without counting it, ⌗ TIDY laid every pedal's header underneath the
// rail, and the header is the only handle you can move, lock or close a pedal by:
// tidying made the board unusable. Worse, tidy is also what CREATES the rail (it
// docks the overflow), so both halves of the trap sprang at once.
function boardTop() {
  const base = document.getElementById('board-area')?.offsetTop || 340;
  // BOTH fixed strips above the board have to be counted: the FOCUS bar (always
  // there) and the dock rail (only once something is docked).
  // NOT offsetParent — these are position:fixed, and a fixed element's
  // offsetParent is always null, so that test reported "hidden" every single time
  // and the height never counted. Ask whether it is displayed and has content,
  // which is what "is it taking up space" actually means here.
  const h = el => (el && getComputedStyle(el).display !== 'none') ? el.getBoundingClientRect().height : 0;
  const dock = document.getElementById('pedal-dock');
  // A rail along the bottom takes nothing off the top.
  const railH = dock && dock.children.length && !dock.classList.contains('dock-bottom') ? h(dock) : 0;
  return Math.round(base + h(document.getElementById('focus-bar')) + railH);
}
// Because the layer is pinned to the screen, a pedal's HEADER must always stay
// on screen — that's the handle you move, lock and close it by. maxY enforces
// that; a tall pedal may run past the bottom, and resizing or the zoom control
// is the answer to fitting more in at once.
function freeSlot(w, h, against = pedals) {
  const top = boardTop(), pad = 12;
  const maxX = Math.max(pad, window.innerWidth - w - pad);
  const maxY = Math.max(top + pad, window.innerHeight - 120);
  const hits = (x, y) => against.some(q => x < q.x + (q.w || 280) + pad && x + w + pad > q.x
                                        && y < q.y + (q.h || 400) + pad && y + h + pad > q.y);
  for (let y = top + pad; y <= maxY; y += 24)
    for (let x = pad; x <= maxX; x += 24)
      if (!hits(x, y)) return { x, y };
  const n = against.length;                       // full — cascade, still reachable
  return { x: pad + (n % 6) * 26, y: Math.min(maxY, top + pad + (n % 6) * 26) };
}

// ── Tidy layout ────────────────────────────────────────────────────────
// The pedal layer is pinned to the screen, so a good opening arrangement is one
// where everything is whole and readable at a glance rather than stacked. Lay
// the pedals out as one row across the board, each capped to the height that
// actually fits under the neck; anything that can't fit the row is minimized to
// its header and docked along the bottom, still one click from full size.
const MIN_PEDAL_W = 200, MIN_BAND = 260;
// The opening arrangement, as an ordered row with RELATIVE widths so it keeps
// its proportions on any monitor: the Theory Path sits centre stage between the
// Circle and the Explorer, as wide as the Circle and Chord Directory together.
// `stack` parks a second pedal minimized above the first, sharing its column.
const ROW_PLAN = [
  { type: 'metronome', weight: 1,    stack: 'audio' },
  { type: 'circle5',   weight: 1.15 },
  { type: 'theory',    weight: 2.3  },
  { type: 'scales',    weight: 1.15 },
];
const STACK_H = 40;
// A window that hasn't been laid out yet reports 0×0. Every geometry decision
// here is viewport-relative and gets SAVED, so acting on a degenerate size
// would permanently scramble a board — always check before measuring.
const viewportReady = () => window.innerWidth > 400 && window.innerHeight > 320;
let pageMode = 'practice';
function layoutPedals(retry = 0) {
  if (!pedals.length) return;
  if (!viewportReady()) {
    if (retry < 20) requestAnimationFrame(() => layoutPedals(retry + 1));
    return;
  }
  const pad = 12, DOCK_H = 44, DOCK_W = 260;
  const vw = window.innerWidth, vh = window.innerHeight;
  // ⌗ TIDY arranges everything to FIT the screen, so there is nothing below the
  // fold left to be panned to. Anything else would tidy the board out of sight.
  boardPan = 0;

  // A locked pedal was parked deliberately — tidying must not move it. Only the
  // free ones get arranged, and the row plan re-weights around any that are held.
  const free = pedals.filter(p => !p.locked);
  if (!free.length) return;

  // TAB and STUDIO own the screen below the neck (a tab lane, a track list), so
  // there the pedals collapse to the dock — present and one click from full size,
  // without sitting on top of the thing being read.
  if (pageMode !== 'practice') {
    // Dock everything, and touch NOTHING else. This used to rewrite every pedal to
    // 260px wide and park it along the bottom - a leftover from when docking meant
    // "collapse to a title bar down there". Under the dock rail a minimized card is
    // hidden and its x/y/w/h are the promise that it comes back where you left it;
    // rewriting them on every visit to TAB broke that promise silently.
    free.forEach(p => { p.minimized = true; });
    applyLayoutToDom(); save();
    return;
  }

  // Preferred arrangement when the board still holds the core kit; otherwise
  // fall back to packing whatever is there by its own width.
  const byType = t => free.find(p => p.type === t);
  const plan = ROW_PLAN.filter(r => byType(r.type));
  const planned = plan.length >= 2;   // a preference: weights renormalise over whoever is free

  const fits = [], docked = [];
  let x = pad;
  if (planned) {
    const stacked = plan.map(r => r.stack && byType(r.stack)).filter(Boolean);   // free-set lookup
    const total = plan.reduce((a, r) => a + r.weight, 0);
    const avail = vw - pad * (plan.length + 1);
    plan.forEach(r => fits.push({ p: byType(r.type), w: Math.max(MIN_PEDAL_W, Math.floor(avail * r.weight / total)), stack: r.stack && byType(r.stack) }));
    free.forEach(p => {
      if (fits.some(f => f.p === p) || stacked.includes(p)) return;
      docked.push(p);
    });
  } else {
    free.forEach(p => {
      const w = Math.max(MIN_PEDAL_W, Math.min(p.w || 280, vw - pad * 2));
      if (x + w + pad <= vw) { fits.push({ p, w }); x += w + pad; }
      else docked.push(p);
    });
  }

  // Reserve the dock strip's height BEFORE sizing the row, so the two never meet
  const perDockRow = Math.max(1, Math.floor((vw - pad) / (DOCK_W + pad)));
  const dockRows = Math.ceil(docked.length / perDockRow);
  const dockH = dockRows ? dockRows * DOCK_H + pad : 0;

  let top = boardTop();
  let band = vh - top - pad * 2 - dockH;
  // If the neck leaves too little room, let the pedals cover its lower part —
  // maximising usable space is the whole reason they float.
  if (band < MIN_BAND) {
    top = Math.max(pad, vh - MIN_BAND - pad * 2 - dockH);
    band = vh - top - pad * 2 - dockH;
  }

  // spread any leftover width evenly so the row reads as a deliberate rank
  const used = fits.reduce((a, f) => a + f.w + pad, pad);
  const extra = planned ? 0 : Math.max(0, Math.floor((vw - used) / Math.max(1, fits.length)));
  x = pad;
  fits.forEach(({ p, w, stack }) => {
    p.x = x; p.w = w + extra;
    p.minimized = false;
    // a stacked companion rides minimized on top, sharing this column's width
    if (stack) {
      stack.minimized = true; stack.x = x; stack.y = top; stack.w = p.w;
      p.y = top + STACK_H;
      p.h = Math.max(180, Math.min(p.h || 400, band - STACK_H));
    } else {
      p.y = top;
      p.h = Math.max(180, Math.min(p.h || 400, band));
    }
    x += p.w + pad;
  });
  // docked overflow: tidy rows of headers along the bottom, one click from full size
  docked.forEach((p, i) => {
    p.minimized = true;
    p.w = DOCK_W;
    p.x = pad + (i % perDockRow) * (DOCK_W + pad);
    p.y = vh - dockH + pad + Math.floor(i / perDockRow) * DOCK_H;
  });
  applyLayoutToDom();
  save();
}
// One pedal, one card — reconcile the layer against the array in BOTH directions.
// This matters because every duplicate guard in the app keys off `pedals`:
//  · a card with no object is invisible to those guards, so the load-out sees a
//    type "missing", helpfully adds it, and now you can see two;
//  · an object with no card is a pedal you own but cannot reach — the shop says
//    ON BOARD and nothing appears.
// Nothing here ever walked DOM → state before (the Studio has always pruned its
// own container this way; the main layer never did), so either state was permanent.
function reconcileCards() {
  const container = document.getElementById('pedals-container');
  if (!container) return;
  [...container.children].forEach(el => {
    if (!el.id?.startsWith('pedal-')) return;
    if (!pedals.some(p => 'pedal-' + p.id === el.id)) el.remove();
  });
  pedals.forEach(p => { if (!document.getElementById('pedal-' + p.id)) mountPedal(p); });
}

// ── Panning the pedal area ────────────────────────────────────────────
// The pedal layer is pinned to the viewport, so a card taller than the screen
// runs off the bottom — taking its resize corner, the only thing that can make
// it smaller again, permanently out of reach. SIZE going to 1.8× makes that a
// couple of drags away rather than a freak accident, so the board has to be
// reachable below the fold.
//
// The obvious fix — turn #pedals-container into an overflow:auto box — is the
// wrong one twice over. The layer is pointer-events:none so the neck underneath
// stays playable, and a scrollbar on a click-through element can never be
// grabbed. Worse, native scroll splits the coordinate space: the drag code in
// pedal-system.js measures a grab as `e.clientY - el.offsetTop` (offsetTop is
// content-space, clientY is viewport-space) and then clamps the result against
// window.innerHeight. Mix the two and a dragged pedal stops dead partway down
// the screen while the cursor keeps travelling — exactly the bug we are here
// to avoid.
//
// So the board PANS rather than scrolls. p.y stays the one true position, in
// viewport pixels, and the pan is subtracted at the single point where a card's
// `top` is written. Content space and viewport space therefore remain the SAME
// space at every pan offset, every clientX/clientY sum in pedal-system.js keeps
// meaning what it always meant, and the saved board records where you put a
// pedal rather than where you happened to be looking when you saved.
let boardPan = 0;
const PAN_PAD = 16;

// How far past the bottom of the screen the OPEN cards reach. A docked pedal is
// hidden on the rail — it needs no reaching and must not deepen the board.
function panRange() {
  const bottom = pedals.reduce((m, p) => p.minimized ? m : Math.max(m, (p.y || 0) + (p.h || 400)), 0);
  return Math.max(0, Math.round(bottom + PAN_PAD - window.innerHeight));
}

function setBoardPan(v) {
  boardPan = Math.max(0, Math.min(Math.round(v) || 0, panRange()));
  pedals.forEach(p => {
    const el = document.getElementById('pedal-' + p.id);
    if (el) el.style.top = ((p.y || 0) - boardPan) + 'px';
  });
  renderPanRail();
}

// The rail is the only thing on screen that says "there is more board below it",
// and it is the one part of this layer that must accept a click — which is why
// it is its own fixed element rather than a scrollbar on the click-through
// layer. It sits under the catalog drawer (200) and the help overlay (500) so
// neither ends up with a stripe down its edge.
function panRail() {
  let r = document.getElementById('pedal-pan-rail');
  if (!r) {
    r = document.createElement('div');
    r.id = 'pedal-pan-rail';
    r.title = 'The board runs past the bottom of the screen — drag, click or scroll to reach it';
    r.innerHTML = '<div id="pedal-pan-thumb"></div>';
    (document.getElementById('app') || document.body).appendChild(r);
    wirePanRail(r);
  }
  return r;
}

function renderPanRail() {
  const r = panRail(), thumb = r.firstElementChild;
  const range = panRange();
  if (!range) { r.style.display = 'none'; return; }
  r.style.display = 'block';                        // measure only once it is drawn
  const railH = r.clientHeight || window.innerHeight, vh = window.innerHeight;
  // Thumb length is the honest "how much of the board am I looking at" fraction.
  const th = Math.max(30, Math.round(railH * (vh / (vh + range))));
  thumb.style.height = th + 'px';
  thumb.style.top = Math.round((railH - th) * (boardPan / range)) + 'px';
}

function wirePanRail(r) {
  const thumb = r.firstElementChild;
  let grab = null;
  thumb.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    grab = { y: e.clientY, pan: boardPan, railH: r.clientHeight, th: thumb.offsetHeight };
    thumb.setPointerCapture(e.pointerId);
  });
  thumb.addEventListener('pointermove', e => {
    if (!grab) return;
    const travel = Math.max(1, grab.railH - grab.th);
    setBoardPan(grab.pan + (e.clientY - grab.y) * panRange() / travel);
  });
  ['pointerup', 'pointercancel'].forEach(ev => thumb.addEventListener(ev, () => { grab = null; }));
  // Clicking the empty track jumps a screenful, the way any scrollbar does.
  r.addEventListener('pointerdown', e => {
    if (e.target !== r) return;
    const up = e.clientY < thumb.getBoundingClientRect().top;
    setBoardPan(boardPan + (up ? -1 : 1) * window.innerHeight * 0.8);
  });
}

// The board is the LAST thing a wheel gesture reaches. A pedal's own body, an
// open drawer and the page itself each get first refusal, so panning can never
// steal a scroll that belonged to whatever is under the cursor.
function wheelConsumer(target, dy) {
  for (let el = target; el instanceof Element; el = el.parentElement) {
    const ov = getComputedStyle(el).overflowY;
    if (ov !== 'auto' && ov !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 2) continue;
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 2) return true;
  }
  const doc = document.scrollingElement;
  if (doc && (dy < 0 ? doc.scrollTop > 0 : doc.scrollTop + doc.clientHeight < doc.scrollHeight - 2)) return true;
  return false;
}
window.addEventListener('wheel', e => {
  if (document.getElementById('help-overlay')?.classList.contains('open')) return;
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
  if (!dy || !panRange() || wheelConsumer(e.target, dy)) return;
  e.preventDefault();
  setBoardPan(boardPan + dy);
}, { passive: false });

function applyLayoutToDom() {
  reconcileCards();
  pedals.forEach(p => {
    const el = document.getElementById('pedal-' + p.id);
    if (!el) return;
    el.style.left = p.x + 'px';
    el.style.top = (p.y - boardPan) + 'px';
    el.style.width = p.w + 'px';
    // A minimized card must collapse to its header — an inline height would
    // keep the full box reserved and overlap whatever sits below it.
    el.style.height = p.minimized ? '' : (p.h ? p.h + 'px' : '');
    el.classList.toggle('minimized', !!p.minimized);
    // …and then leave the board entirely. A minimized card used to stay parked
    // at its own x/y, so nine minimized pedals were still nine bars across the
    // neck. It lives on the dock rail now; x/y/w/h are left untouched so
    // reopening puts it back exactly where and how big it was.
    el.style.display = p.minimized ? 'none' : '';
  });
  renderDock();
  // Only NOW is the rail's height known — it appears with the first docked pedal
  // and vanishes with the last — so this is the one moment boardTop() can be
  // trusted. Any card whose header ended up under the rail is unreachable: the
  // header is the handle you move, lock and close it by. Pull it clear.
  rescueUnderRail();
  // Closing, docking or shrinking a pedal can leave the board shallower than the
  // pan you were holding — re-clamp so you are never parked below the last card.
  setBoardPan(boardPan);
}

// Deliberately not called during a drag: applyLayoutToDom does not run then, so
// this can never fight you for the pedal you are holding.
function rescueUnderRail() {
  const top = boardTop();
  let moved = false;
  pedals.forEach(p => {
    if (p.minimized || (p.y || 0) >= top) return;
    p.y = top; moved = true;
    const el = document.getElementById('pedal-' + p.id);
    if (el) el.style.top = (p.y - boardPan) + 'px';
  });
  return moved;
}

// ── The dock ──────────────────────────────────────────────────────────
// One rail, directly under the neck, holding every minimized pedal as a chip.
// Its top is measured from the neck rather than hard-coded: the fretboard is
// resizable (the splitter) and instrument-dependent, so a fixed offset would
// float the rail over the board on a bass and leave a gap on an 8-string.
// Chip labels come from the catalog, but a title with an & or a quote in it would
// break out of the attribute it is written into.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function positionDock() {
  const dock = document.getElementById('pedal-dock');
  const neck = document.getElementById('instrument-display');
  if (!dock) return;
  const top = neck && neck.offsetParent !== null ? Math.round(neck.getBoundingClientRect().bottom) : 0;
  // The strips hang off the neck's bottom edge — but on a page that SCROLLS (the
  // LEARN page was the first) the neck leaves the top of the viewport, that edge
  // goes negative, and clamping to zero parked both strips over the wordmark.
  // They may follow the neck down, never above the header: below whichever of the
  // two is lower. Re-measured on scroll, because that is when this changes.
  const head = document.getElementById('header');
  const headBottom = head ? Math.round(head.getBoundingClientRect().bottom) : 0;
  // On LEARN the neck is sticky. It pins under the header if the header itself
  // stays on screen, otherwise at the very top - and the header's height moves
  // with the density slider, so this is measured every time, never hard-coded.
  if (pageMode === 'learn' && head) {
    const pos = getComputedStyle(head).position;
    const stays = pos === 'sticky' || pos === 'fixed';
    document.documentElement.style.setProperty('--learn-neck-top', (stays ? Math.max(0, headBottom) : 0) + 'px');
  }
  // FOCUS sits in its own strip directly ABOVE the dock rail: it is the control
  // that fills that rail, so it belongs at the head of it rather than out on the
  // neck. The strip is measured, not assumed — the density slider scales its type,
  // so its height changes and a hard-coded offset would drift.
  const bar = document.getElementById('focus-bar');
  // TAB and STUDIO do not lead with the neck: on STUDIO it is hidden outright, so
  // "the neck's bottom edge" collapsed to just under the header and the rail
  // landed on the studio's own top controls; on TAB the page sits above the neck
  // and the rail ended up somewhere it could not be seen. Pedals are secondary on
  // those pages but still needed (pull in a chord, a beat), so the rail becomes a
  // fixed bar along the BOTTOM there - a stable place that is never over anything
  // the page puts at the top. PRACTICE keeps it under the neck, where the eye is.
  // LEARN joins them: a lesson is a reading page, but the metronome, tuner and
  // circle are worth a click away while you read, and the Practice Manager is
  // how an exercise you like becomes part of a routine.
  const bottomMode = pageMode === 'tab' || pageMode === 'studio' || pageMode === 'learn';
  dock.classList.toggle('dock-bottom', bottomMode);
  // The SIZE control is also pinned to the bottom edge; when the rail is down
  // there it rides up above it instead of sitting on the chips.
  const zoom = document.getElementById('board-zoom-ctrl');
  if (zoom) zoom.style.bottom = bottomMode && dock.children.length ? (Math.round(dock.getBoundingClientRect().height) + 8) + 'px' : '';
  if (bottomMode) {
    dock.style.top = '';
    if (bar) bar.style.top = '';
    return;
  }
  let y = Math.max(0, headBottom, top);
  if (bar) {
    bar.style.top = y + 'px';
    y += Math.round(bar.getBoundingClientRect().height);
  }
  dock.style.top = y + 'px';
}
// How tall the bottom rail is, for anything that must stay clear of it.
function bottomRailH() {
  const dock = document.getElementById('pedal-dock');
  if (!dock || !dock.classList.contains('dock-bottom') || !dock.children.length) return 0;
  return Math.round(dock.getBoundingClientRect().height);
}

function renderDock() {
  const dock = document.getElementById('pedal-dock');
  if (!dock) return;
  // Ordered by where the pedal sits on the board, not by when it was minimized,
  // so the rail keeps the spatial memory you built arranging them.
  const mins = pedals.filter(p => p.minimized).sort((a, b) => (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0));
  if (!mins.length) { dock.innerHTML = ''; positionDock(); return; }
  dock.innerHTML = `<span class="dock-label">docked</span>` + mins.map(p => {
    const c = CATALOG.find(x => x.type === p.type) || {};
    const accent = c.accent || '#8fa8b4';
    // A docked pedal can still be RUNNING — a metronome does not stop because
    // you put it away. The pip says so.
    const live = p._pulse?.playing || p._running || p._active ? '<span class="dock-live"></span>' : '';
    return `<button class="dock-chip" data-dock="${p.id}" title="${esc(c.title || p.type)} — click to reopen"
      style="--chip-accent:${accent};--chip-edge:color-mix(in srgb, ${accent} 34%, #232329);
             --chip-bg:color-mix(in srgb, ${accent} 9%, #131317);
             --chip-ink:color-mix(in srgb, ${accent} 30%, #d7d7dd)">
      <span class="dock-icon">${c.icon || '🎛'}</span><span class="dock-name">${esc(c.title || p.type)}</span>${live}</button>`;
  }).join('');
  // An escape hatch that does not go through focus mode. If every pedal is docked
  // — however you got there — there must be one press that gives the board back.
  // Without it, a board can end up fully docked with no memory of its arrangement
  // and the only way out is opening pedals one at a time.
  if (mins.length === pedals.length && pedals.length > 1) {
    dock.insertAdjacentHTML('beforeend',
      `<button class="dock-chip" data-dock-all="1" title="Open every docked pedal"
        style="--chip-accent:#ffce6a;--chip-edge:#4a412a;--chip-bg:rgba(255,206,106,.10);--chip-ink:#ffce6a">
        <span class="dock-icon">↥</span><span class="dock-name">Open all</span></button>`);
  }
  dock.querySelectorAll('.dock-chip').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (b.dataset.dockAll) { undockAll(); return; }
    undock(b.dataset.dock);
  }));
  positionDock();
}

// Open everything, and drop out of focus mode while doing it — asking for the
// whole board back is the same request as "stop focusing".
function undockAll() {
  pedals.forEach(p => { p.minimized = false; });
  if (focusMode) { focusMode = false; focusPrev = null; paintFocusChrome(); }
  boardPan = 0;        // asking for the whole board back means the top of it
  applyLayoutToDom();
  save();
}

function undock(id) {
  const p = pedals.find(x => x.id === id);
  if (!p) return;
  p.minimized = false;
  // A chip puts a card back at the position it was docked from, which may be
  // above wherever you had panned to — so come back to the top and see it land.
  boardPan = 0;
  // On TAB and STUDIO the card floats over the page, and the rail is along the
  // bottom: keep the card's header inside the window and above the rail, so it can
  // always be grabbed. Its practice-page position is left alone in the saved state.
  if (pageMode === 'tab' || pageMode === 'studio' || pageMode === 'learn') {
    const head = document.getElementById('header');
    const minY = (head ? Math.round(head.getBoundingClientRect().bottom) : 0) + 12;
    const maxY = window.innerHeight - bottomRailH() - 60;
    p.y = Math.max(minY, Math.min(p.y || minY, maxY));
    p.x = Math.max(12, Math.min(p.x || 12, window.innerWidth - (p.w || 280) - 12));
  }
  const el = document.getElementById('pedal-' + p.id);
  if (el) { el.classList.remove('minimized'); el.style.display = ''; }
  applyLayoutToDom();
  raise(p.id);
  save();
}

// ── Focus mode ────────────────────────────────────────────────────────
// Not a new layout — the layout the app can already make, in one press.
// Everything docks, the neck takes the room, and you open the single pedal the
// exercise needs. Leaving focus mode puts back exactly the board you had, which
// is the whole reason the minimized state keeps its geometry.
let focusMode = false, focusPrev = null;
// The chrome only — separated so a RESTORED focus session can light the button
// and dim the board without re-running the minimize pass over a board that is
// already docked (which would overwrite focusPrev with all-minimized and lose
// the arrangement being held for you).
function paintFocusChrome() {
  document.body.classList.toggle('focus-mode', focusMode);
  const btn = document.getElementById('btn-focus');
  if (btn) { btn.classList.toggle('is-on', focusMode); btn.title = focusMode ? 'Leave focus mode — put the board back' : 'Focus mode — dock everything, give the neck the room'; }
}
function setFocusMode(on) {
  focusMode = !!on;
  paintFocusChrome();
  if (focusMode) {
    focusPrev = pedals.map(p => ({ id: p.id, minimized: !!p.minimized }));
    pedals.forEach(p => { p.minimized = true; });
  } else if (focusPrev) {
    const was = new Map(focusPrev.map(x => [x.id, x.minimized]));
    // Only restore pedals that existed when focus started. Anything opened
    // DURING focus mode was opened deliberately — closing it again on exit
    // would throw away the thing you just went looking for.
    pedals.forEach(p => { if (was.has(p.id)) p.minimized = was.get(p.id); });
    focusPrev = null;
  }
  boardPan = 0;      // entering or leaving focus is a fresh look at the board
  applyLayoutToDom();
  save();
}
// A shorter window makes the board deeper (and a taller one shallower), so the
// rail and the pan both have to be re-measured against the new screen.
window.addEventListener('resize', () => { positionDock(); setBoardPan(boardPan); });
// Capture phase on the document, not a plain window listener: scroll events do
// not bubble, and the thing that scrolls here is #app (overflow:auto), not the
// window — a window listener would never fire and the strips would sit on the
// wordmark the moment a lesson scrolled.
document.addEventListener('scroll', positionDock, { capture: true, passive: true });

function addPedal(type) {
  const entry   = CATALOG.find(c => c.type === type);
  // Two pedals added in the same millisecond must not share an id — the id is
  // what addresses the card AND its body (#pedal-x / #body-x).
  let id = type + '-' + Date.now();
  while (pedals.some(p => p.id === id)) id = type + '-' + (Date.now() + Math.floor(Math.random() * 1000) + 1);
  const w = entry?.w || 280, h = entry?.h || 400;
  const p = {
    id, type, w, h,
    ...freeSlot(w, h),
    settings: getLearningDefaults(type)
  };
  pedals.push(p);
  mountPedal(p);
  save();
  renderSessionBar();
  refreshCatalog();
  document.getElementById('catalog-drawer')?.classList.remove('open');
}

// ── Reveal a pedal you already own ─────────────────────────────────────
// The Pedal Shop's ◎ SHOW: the pedal is on the board but minimized, docked along
// the bottom, or buried under another — so bring it back whole, in a free space,
// on top, and flash it so the eye finds it. (A locked pedal keeps its lock; being
// unfindable isn't what the lock is for, so it may still be brought into reach.)
function revealPedal(type) {
  const list = pedals.filter(p => p.type === type);
  if (!list.length) return;
  boardPan = 0;   // "show me this" is answered in viewport coordinates below
  const p = list[list.length - 1];
  const entry = CATALOG.find(c => c.type === type);
  if (p.minimized) {
    p.minimized = false;
    p.w = Math.max(p.w || 0, entry?.w || 280);
    p.h = entry?.h || p.h || 400;
  }
  if (viewportReady()) {
    const offscreen = p.y + 120 > window.innerHeight || p.x + 60 > window.innerWidth
                   || p.x + (p.w || 280) < 40 || p.y < 0;
    if (offscreen) {
      const slot = freeSlot(p.w || 280, p.h || 400, pedals.filter(q => q !== p));
      p.x = slot.x; p.y = slot.y;
    }
    // freeSlot only promises a reachable HEADER — a tall pedal may still run off
    // the bottom. The whole point here is to look at the thing, so pull the box
    // fully into view (over the neck if that's what it takes) and cap its height
    // to the screen.
    p.h = Math.min(p.h || 400, window.innerHeight - 24);
    if (p.y + p.h + 12 > window.innerHeight) p.y = Math.max(12, window.innerHeight - p.h - 12);
  }
  applyLayoutToDom();
  raise(p.id);
  flashPedal(p.id);
  save();
  refreshCatalog();
  document.getElementById('catalog-drawer')?.classList.remove('open');
}

// Bring a pedal's card to the front of the layer. Module scope, not init's — the
// routes inside init AND the shop's ◎ SHOW both need it.
function raise(id) {
  const card = document.getElementById('pedal-' + id);
  if (!card) return;
  try { bringToFront(card); } catch (e) {}
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function flashPedal(id) {
  const el = document.getElementById('pedal-' + id);
  if (!el) return;
  el.classList.remove('pedal-flash');
  void el.offsetWidth;                       // restart the animation
  el.classList.add('pedal-flash');
  setTimeout(() => el.classList.remove('pedal-flash'), 1500);
}

// − EXTRA: close the NEWEST copy of a doubled-up pedal. The older one is the one
// that was set up, moved and sized, so that's the one that stays. A pedal's loops
// hold themselves to `document.getElementById('body-'+p.id)`, so removing the
// card is all it takes to stop it.
function closeExtra(type) {
  const list = pedals.filter(p => p.type === type);
  if (list.length < 2) return;
  const p = list[list.length - 1];
  document.getElementById('pedal-' + p.id)?.remove();
  pedals = pedals.filter(q => q.id !== p.id);
  save();
  renderSessionBar();
  refreshCatalog();
}

// ↺ RESET — put the board back to the six it opens with. The only way out of a
// board you have accidentally emptied, buried or dragged off screen, and the
// answer to "I want it to start the same way every time".
function resetBoard() {
  pedals.forEach(p => document.getElementById('pedal-' + p.id)?.remove());
  pedals = DEFAULT_BOARD().map(p => normalizePedalToStartKey(p));
  pedals.forEach(p => mountPedal(p));
  layoutPedals();
  renderSessionBar();
  refreshCatalog();
  save();
}

// The shop shows what's on the board, so it has to be re-rendered whenever the
// board changes — adding, closing, or restoring.
function refreshCatalog() {
  renderCatalog(CATALOG, addPedal, {
    countOf: t => pedals.filter(p => p.type === t).length,
    onShow:  revealPedal,
    onDropExtra: closeExtra,
  });
}

// ── Mount a pedal to the DOM ──────────────────────────────────────────
function mountPedal(p) {
  const container = document.getElementById('pedals-container');
  if (!container) return;
  // One pedal, one card. Mounting is cheap to call twice by accident and a second
  // card would be a ghost: #body-<id> would resolve to the first, so the ghost
  // would render empty and never update.
  if (document.getElementById('pedal-' + p.id)) return;
  // The layer is pinned to the screen, so a pedal saved on a taller monitor (or
  // below a since-grown neck) must be pulled back into reach — its header is the
  // only way to move, lock or close it.
  if (viewportReady()) {
    p.y = Math.max(0, Math.min(p.y ?? 0, window.innerHeight - 56));
    p.x = Math.max(40 - (p.w || 280), Math.min(p.x ?? 0, window.innerWidth - 60));
  }

  const entry = CATALOG.find(c => c.type === p.type);
  const el    = createPedalElement(
    p, entry,
    (id) => { pedals = pedals.filter(x => x.id !== id); save(); renderSessionBar(); refreshCatalog(); },
    // Minimize now means DOCK. applyLayoutToDom hides the card and rebuilds the
    // rail, so the ▁ button and the dock chip are two ends of one mechanism
    // rather than two behaviours that have to be kept in step.
    (id, isMin) => { const pd = pedals.find(x => x.id === id); if (pd) pd.minimized = isMin; applyLayoutToDom(); save(); },
    // The drag reports where the card LANDED on screen. p.y is the un-panned
    // position, so the pan goes back in here — the one place it is added, mirroring
    // applyLayoutToDom as the one place it is taken off. Dragging is also how the
    // board changes depth, so the pan is re-clamped on the same beat: down past the
    // fold has to raise the rail, and hauling the last deep card back up leaves a pan
    // with nowhere to go — kept, it draws every card above the top of the screen,
    // where there is no header left to grab and no rail or wheel to bring them back.
    (id, x, y)  => { const pd = pedals.find(x => x.id === id); if (pd) { pd.x = x; pd.y = y + boardPan; } setBoardPan(boardPan); save(); },
    // Dragging the corner is exactly how a pedal grows past the bottom of the
    // screen, so the rail has to appear the moment it does — not on the next tidy.
    // Shrinking it back is the same move in reverse, which is why this re-clamps
    // rather than only repainting the rail: a bare renderPanRail would hide the rail
    // and leave the old pan holding the board above the screen.
    (id, w, h)  => { const pd = pedals.find(x => x.id === id); if (pd) { pd.w = w; pd.h = h; } setBoardPan(boardPan); save(); },
    (id, locked) => { const pd = pedals.find(x => x.id === id); if (pd) pd.locked = locked; save(); }
  );
  container.appendChild(el);
  // createPedalElement writes p.y straight into `top`; a card mounted while the
  // board is panned has to be put in the same frame as its neighbours.
  if (boardPan) el.style.top = (p.y - boardPan) + 'px';
  renderPanRail();                  // a new card can make the board deeper
  buildContent(p);
}

// ── Zoom control ───────────────────────────────────────────────────────
// (the transform-scale zoom is gone — see setDensity, which scales type instead)
function renderZoomControl() {
  const el = document.getElementById('board-zoom-ctrl');
  if (!el) return;
  el.innerHTML = `
    <span class="mono" title="How big everything reads — type and cards together. Slide it up until the board is legible from wherever you actually sit with the guitar." style="color:#666;font-size:calc(9px*var(--ui));letter-spacing:1px">SIZE</span>
    <input id="dens-slider" class="rk-slider" type="range" min="${DENSITY_MIN}" max="${DENSITY_MAX}" step="${DENSITY_STEP}"
      value="${uiScale}" title="Compact ⟷ readable at playing distance"
      style="--rk-accent:#ffce6a;--rk-glow:rgba(255,206,106,.42);width:120px;height:18px">
    <span id="dens-val" class="mono" style="color:#ffce6a;font-size:calc(9px*var(--ui));letter-spacing:.5px;min-width:36px;text-align:right"></span>
    <span style="width:1px;height:14px;background:#333;margin:0 2px"></span>
    <button id="tidy-btn" class="mono" title="Arrange the pedals across the board" style="background:none;border:none;color:#888;cursor:pointer;font-size:calc(9px*var(--ui));letter-spacing:1px">⌗ TIDY</button>
    <button id="reset-btn" class="mono" title="Back to the six pedals Resonote opens with — Input, Metronome, Circle of Fifths, Theory Path, Scale &amp; Arp Explorer, Chord Directory" style="background:none;border:none;color:#777;cursor:pointer;font-size:calc(9px*var(--ui));letter-spacing:1px">↺ RESET</button>`;

  const s = el.querySelector('#dens-slider');
  // Live on `input`, not on release: you pick a size by watching the board reach
  // it, not by guessing a number. Which is also why setDensity syncs this control
  // instead of re-rendering it — an innerHTML rebuild mid-drag would tear the
  // thumb out from under the mouse and the gesture would die on the first step.
  s?.addEventListener('pointerdown', () => { densBase = densSnapshot(); });
  s?.addEventListener('input', () => setDensity(+s.value, { quiet: true }));
  // One write to storage per gesture, not one per frame.
  ['pointerup', 'pointercancel', 'change'].forEach(ev =>
    s?.addEventListener(ev, () => { densBase = null; save(); }));
  syncDensityControl();

  document.getElementById('tidy-btn')?.addEventListener('click', () => layoutPedals());
  document.getElementById('reset-btn')?.addEventListener('click', resetBoard);
}

// ── Density ───────────────────────────────────────────────────────────
// Replaces the old transform-scale zoom, which magnified the whole pedal layer
// — empty space and all — so "bigger" meant "fewer pedals, same tiny labels
// blown up". This scales the TYPE, and grows each card to match, so a pedal
// stays as full of information as it was and simply becomes legible from
// across the room.
// It used to be four buttons — S / M / L / STAGE — which is a menu of somebody
// else's four opinions about how far away you sit. It is one number, so it is
// one slider: 0.8 (dense, desk distance) through 1.8 (readable across a room),
// in twentieths, so there is always a notch that is right rather than a nearest
// preset you settle for.
const DENSITY_MIN = 0.8, DENSITY_MAX = 1.8, DENSITY_STEP = 0.05;
let uiScale = 1;

// A live slider calls setDensity dozens of times in one drag. Chaining the
// step-to-step ratio would round every card forty times over and walk the
// arrangement a few pixels off its shape, so a drag remembers the geometry it
// started from and each frame scales from THAT. Null between gestures — a
// keyboard nudge on the slider is a single step and needs no baseline.
let densBase = null;
function densSnapshot() {
  return { scale: uiScale, geo: new Map(pedals.map(p => [p.id, { w: p.w, h: p.h, x: p.x, y: p.y }])) };
}

// The kit's slider paints its own filled portion from --rk-fill, so the readout
// and the track have to be told the value; neither reads it off the input.
function syncDensityControl() {
  const s = document.getElementById('dens-slider');
  if (!s) return;
  s.value = String(uiScale);
  s.style.setProperty('--rk-fill', Math.round((uiScale - DENSITY_MIN) / (DENSITY_MAX - DENSITY_MIN) * 100) + '%');
  const v = document.getElementById('dens-val');
  if (v) v.textContent = uiScale.toFixed(2) + '×';
}

function setDensity(next, opts = {}) {
  const from = uiScale || 1;
  const to = Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, Number(next) || 1));
  uiScale = to;
  document.documentElement.style.setProperty('--ui', String(to));
  // Grow the cards with their text. Scaling type alone would leave a 280px card
  // trying to hold 45%-larger labels, and every pedal would start wrapping and
  // clipping. The ratio is applied to the size the gesture STARTED from, so a
  // pedal you resized by hand keeps the proportion you gave it.
  if (!opts.skipCards && from !== to) {
    const base = densBase, k = to / (base ? base.scale : from);
    pedals.forEach(p => {
      const b = base?.geo.get(p.id) || p;
      p.w = Math.round(b.w * k);
      p.h = Math.round(b.h * k);
      // Keep the arrangement's shape, not just its origin — but not past the right
      // edge. There is no sideways pan the way there is a vertical one, so an x the
      // scaling pushes off screen takes the header with it, and the header is the
      // only handle for moving, docking or closing the pedal. Same rule the drag
      // clamps to, so a scaled pedal is never parked anywhere a drag could not.
      p.x = Math.max(40 - p.w, Math.min(Math.round(b.x * k), window.innerWidth - 60));
      p.y = Math.max(boardTop(), Math.round(b.y * k));
    });
    applyLayoutToDom();               // …which re-clamps the pan against the new depth
  }
  positionDock();
  syncDensityControl();
  if (!opts.quiet) save();
}

// ── Mode switch ────────────────────────────────────────────────────────
// ── Remote command router ────────────────────────────────────────────────────
// One vocabulary, one implementation. A Stream Deck key, an F13-F24 press and a
// console CustomEvent all land here. Everything goes through the seams the app
// already uses — the resonote:* bus, the mode buttons, need-pedal — so a remote
// press is indistinguishable from a click.
const $q = sel => document.querySelector(sel);
const metroLive = () => !!$q('[id^="mt-"].rk-play')?.classList.contains('is-playing');
const tabLive   = () => /Stop/.test($q('#tabp-play')?.textContent || '');

function applyCommand(cmd, args = {}) {
  const n = Number(args.by ?? args.v);
  switch (cmd) {
    // Transport keys are CONTEXT-AWARE: one physical key, the right control for
    // whichever page is showing. Studio first, then TAB, then the pedalboard.
    case 'play':
      if (pageMode === 'studio') { $q('#stu-play')?.click(); break; }
      if (pageMode === 'tab')    { $q('#tabp-play')?.click(); break; }
      return applyCommand(metroLive() ? 'metro/stop' : 'metro/start');
    case 'metro/toggle':
      if (pageMode === 'studio') { $q('#stu-click')?.click(); break; }
      return applyCommand(metroLive() ? 'metro/stop' : 'metro/start');
    case 'metro/start':
      // need-pedal only REVEALS when the pedal already exists, so ask twice:
      // the first call adds it, the second brings it forward.
      window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail:{ type:'metronome' }}));
      window.dispatchEvent(new CustomEvent('resonote:metro', { detail:{ action:'start' }}));
      break;
    case 'metro/stop':
      window.dispatchEvent(new CustomEvent('resonote:metro', { detail:{ action:'stop' }}));
      break;

    case 'bpm/up': case 'bpm/down': {
      const step = Math.abs(n) || 4;
      const bpm  = Math.max(20, Math.min(300, metroClock.bpm + (cmd === 'bpm/up' ? step : -step)));
      metroClock.set(bpm, metroClock.ts);
      window.dispatchEvent(new CustomEvent('resonote:metro', { detail:{ action:'bpm', bpm }}));
      break;
    }
    case 'bpm/set':
      if (n) {
        metroClock.set(n, metroClock.ts);
        window.dispatchEvent(new CustomEvent('resonote:metro', { detail:{ action:'bpm', bpm:n }}));
      }
      break;

    case 'panic':
      metroClock.stopAll?.();
      window.dispatchEvent(new CustomEvent('resonote:metro', { detail:{ action:'stop' }}));
      window.dispatchEvent(new CustomEvent('resonote:beat',  { detail:{ action:'stop' }}));
      if (tabLive()) $q('#tabp-play')?.click();               // TAB page isn't in the registry
      document.querySelectorAll('[id^="wostop-"]').forEach(b => b.click());   // nor Workouts
      if (/Stop jam/.test($q('#il-jam')?.textContent || '')) $q('#il-jam').click();  // nor Improv Lab
      break;

    case 'loop':
      if (pageMode === 'studio') { $q('#stu-loop')?.click(); break; }
      $q('#tabp-loop')?.click(); break;
    case 'loop/a':     $q('#tabp-ra')?.click();    break;
    case 'loop/b':     $q('#tabp-rb')?.click();    break;
    case 'loop/whole': $q('#tabp-whole')?.click(); break;

    case 'beat/toggle': case 'beat/start': case 'beat/stop': {
      const action = cmd === 'beat/stop' ? 'stop' : cmd === 'beat/start' ? 'start' : 'toggle';
      window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail:{ type:'beatmaker' }}));
      window.dispatchEvent(new CustomEvent('resonote:beat', { detail:{ action }}));
      break;
    }

    case 'page/practice': case 'page/tab': case 'page/studio':
      document.getElementById('btn-mode-' + cmd.slice(5))?.click(); break;
    case 'page/next': {
      const order = ['practice','tab','studio'];
      return applyCommand('page/' + order[(order.indexOf(pageMode) + 1) % order.length]);
    }
    case 'fbview/next': {
      const s = $q('#fb-view'); if (!s) break;
      s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
      s.dispatchEvent(new Event('change'));
      break;
    }
    case 'focus': $q('#btn-focus')?.click(); break;

    // ── Studio transport ──────────────────────────────────────────────────
    case 'studio/record': $q('#stu-rec')?.click();        break;
    // Studio has no pause — stop IS the pause; the playhead keeps its position.
    case 'studio/pause':  $q('#stu-stop')?.click();       break;
    // Return to the top of the arrangement. Studio's ⏮ only nudges back a bar,
    // so this calls a jump-to-zero added to the studio module.
    case 'studio/reset':
      import('./studio/studio-mode.js').then(m => m.studioToStart?.());
      break;
    // Empty the virtual instrument you play notes into — RECORD's partner.
    case 'studio/clear': $q('#stu-midi-clear')?.click(); break;

    // ── Takes that outlive a reload ───────────────────────────────────────
    // Until these existed the Studio threw away every recording on refresh.
    case 'studio/mark':
      import('./studio/studio-mode.js').then(m => m.studioMark?.(args.name));
      break;
    case 'studio/keep':
      import('./studio/studio-mode.js').then(m => m.keepStudioTake?.());
      break;
    case 'studio/restore':
      import('./studio/studio-mode.js').then(m => m.restoreStudioTake?.(args.id));
      break;

    // Back to the six pedals Resonote opens with.
    case 'board/reset': $q('#reset-btn')?.click(); break;
    // The app autosaves continuously, so a SAVE key is only worth a slot if it
    // makes a RESTORE POINT — that's what snapshotBoardNow is for.
    case 'board/save':  snapshotBoardNow(); break;

    default:
      if (cmd?.startsWith('pedal/')) {
        const type = cmd.slice(6);
        if (!CATALOG.some(c => c.type === type)) return;
        window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail:{ type, reveal:true }}));
        window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail:{ type, reveal:true }}));
      }
  }
}

// What a Stream Deck key could read back and paint on itself. GET /deck/state.
function readRemoteState() {
  return {
    bpm:   metroClock.bpm,
    key:   [pedalBus.masterKey?.root, pedalBus.masterKey?.keyType].filter(Boolean).join(' '),
    page:  pageMode,
    click: metroLive(),
    tab:   tabLive(),
  };
}

function switchMode(mode) {
  const practiceEls = document.querySelectorAll('.practice-el, #instrument-bar, #instrument-display, #board-area');
  const boardOnly   = document.getElementById('board-area');
  const studioEl    = document.getElementById('studio-mode');
  const tabEl       = document.getElementById('tab-mode');
  const learnEl     = document.getElementById('learn-mode');
  const btnP = document.getElementById('btn-mode-practice');
  const btnL = document.getElementById('btn-mode-learn');
  const btnT = document.getElementById('btn-mode-tab');
  const btnS = document.getElementById('btn-mode-studio');
  const setActive = btn => { [btnP, btnL, btnT, btnS].forEach(b => b?.classList.remove('active-green')); btn?.classList.add('active-green'); };
  if (learnEl && mode !== 'learn') { learnEl.style.display = 'none'; }
  // A body class the stylesheet can hang page-specific rules off. The LEARN page
  // uses it to drop the FOCUS strip and the dock rail: positioned correctly they
  // sit on the lesson text as it scrolls, and neither means anything on a page
  // with no board. TAB and STUDIO keep them - they still work with pedals.
  document.body.classList.toggle('page-learn', mode === 'learn');
  document.body.classList.toggle('page-noboard', mode === 'tab' || mode === 'studio' || mode === 'learn');

  if (mode === 'learn') {
    // The lesson page: neck on top, the board out of the way, the Theory Path
    // rendered full-width below in a reading column. Same renderer as the pedal,
    // mounted on a derived handle — one Theory Path, one progress record.
    practiceEls.forEach(el => el.style.display = '');
    if (boardOnly) boardOnly.style.display = 'none';
    if (studioEl) studioEl.style.display = 'none';
    if (tabEl) tabEl.style.display = 'none';
    if (learnEl) learnEl.style.display = 'flex';
    setActive(btnL);
    mountLearn();
  } else if (mode === 'studio') {
    practiceEls.forEach(el => el.style.display = 'none');
    if (tabEl) tabEl.style.display = 'none';
    if (studioEl) studioEl.style.display = 'flex';
    setActive(btnS);
    import('./studio/studio-mode.js').then(m => m.initStudio());
  } else if (mode === 'tab') {
    // The TAB page keeps the instrument visible below its lanes (tab ⇄ fretboard
    // sync is the point) — only the pedal board makes way. The page's own 🎸 button
    // can collapse the instrument; this reset is what that toggle re-applies over.
    practiceEls.forEach(el => el.style.display = '');
    if (boardOnly) boardOnly.style.display = 'none';
    if (studioEl) studioEl.style.display = 'none';
    if (tabEl) tabEl.style.display = 'block';
    setActive(btnT);
    import('./tabpage/tab-mode.js').then(m => m.initTabMode());
  } else {
    practiceEls.forEach(el => el.style.display = '');
    if (studioEl) studioEl.style.display = 'none';
    if (tabEl) tabEl.style.display = 'none';
    setActive(btnP);
  }
  // Leaving PRACTICE remembers which pedals were open; coming back puts exactly
  // that set back, at exactly the size and place each had. This used to run ⌗ TIDY
  // on every landing, which re-derived every width from the row plan - so a trip
  // to TAB and back quietly resized your board, and no arrangement could ever be
  // kept. The other pages dock everything (their own content owns the screen) and
  // never touch geometry; TIDY is now only ever something you press.
  const from = pageMode;
  pageMode = mode === 'studio' ? 'studio' : mode === 'tab' ? 'tab' : mode === 'learn' ? 'learn' : 'practice';
  if (from === 'practice' && pageMode !== 'practice' && !focusMode) {
    pagePrev = pedals.map(p => ({ id: p.id, minimized: !!p.minimized }));
  }
  if (pageMode === 'practice') {
    if (pagePrev && !focusMode) {
      const was = new Map(pagePrev.map(x => [x.id, x.minimized]));
      pedals.forEach(p => { if (was.has(p.id)) p.minimized = was.get(p.id); });
      pagePrev = null;
    }
    applyLayoutToDom(); save();
  } else {
    layoutPedals();          // on TAB / STUDIO / LEARN this only docks - see the non-practice branch
  }
}
let pagePrev = null;         // which pedals were open when PRACTICE was last left

// ── The LEARN page ────────────────────────────────────────────────────
// Progress is the Theory Path PEDAL's settings object when one is on the board,
// so a lesson finished on the page is finished in the pedal and vice versa. With
// no pedal, the page keeps its own object and persists it with the display state.
let learnSettings = null;
function learnHandle() {
  const tp = pedals.find(x => x.type === 'theory');
  const settings = tp ? (tp.settings = tp.settings || {}) : (learnSettings = learnSettings || {});
  return { id: 'learn', type: 'theory', settings };
}
function mountLearn(lessonId) {
  const host = document.getElementById('learn-mode');
  if (!host) return;
  if (!document.getElementById('body-learn')) {
    host.innerHTML = `<div id="learn-col">
      <div id="learn-bar">
        <span class="learn-kicker">LEARN · THEORY PATH</span>
        <span class="learn-hint">Demos light the neck above · ▶ runs the drill · your progress is shared with the 🧭 pedal</span>
      </div>
      <div id="body-learn" class="rk rk-host"></div>
    </div>`;
  }
  const h = learnHandle();
  if (lessonId) { h.settings._openLesson = lessonId; h.settings.view = 'lesson'; }
  buildContent(h);
}

// ── Fretboard click dispatch ───────────────────────────────────────────
import { playClickedNote } from './core/audio.js';
import { getNoteAtFret, getInst } from './core/tuning.js';
import { NOTES } from './core/music-theory.js';

let onFretboardClick = null;
export function setFretboardClickHandler(fn) { onFretboardClick = fn; }

// ── Interval Explorer (the 📏 fretboard view) ───────────────────────────
const ITV_NAMES = ['Unison','minor 2nd','Major 2nd','minor 3rd','Major 3rd','Perfect 4th','Tritone','Perfect 5th','minor 6th','Major 6th','minor 7th','Major 7th','Octave'];
let intervalPicks = [];
function renderIntervalPicks() {
  const ov = document.getElementById('note-ov'), rd = document.getElementById('note-readout');
  if (!ov) return;
  const g = geo();
  let h = '';
  intervalPicks.forEach(p => {
    if (p.si === undefined || p.fret === undefined) return;
    const y = g.sy(p.si), cx = g.fm(p.fret);
    h += `<g filter="url(#ngf)"><circle cx="${cx}" cy="${y}" r="12" fill="#ffd23f" stroke="#fff" stroke-width="2"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="9" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#241c00" style="pointer-events:none">${p.note}</text></g>`;
  });
  if (intervalPicks.length === 2 && intervalPicks.every(p => p.si !== undefined)) {
    const [a, b] = intervalPicks;
    h += `<line x1="${g.fm(a.fret)}" y1="${g.sy(a.si)}" x2="${g.fm(b.fret)}" y2="${g.sy(b.si)}" stroke="#ffd23f" stroke-width="2" stroke-dasharray="5,3" opacity=".7"/>`;
  }
  ov.innerHTML = h;
  if (rd) {
    if (intervalPicks.length === 2) {
      const [a, b] = intervalPicks;
      const m1 = NOTES.indexOf(a.note) + (a.octave || 3) * 12, m2 = NOTES.indexOf(b.note) + (b.octave || 3) * 12;
      const semis = Math.abs(m2 - m1);
      const nm = ITV_NAMES[Math.min(semis, 12)] || `${semis} semitones`;
      rd.innerHTML = `<span class="mono" style="color:#ffd23f;font-size:18px;font-weight:800">${a.note} → ${b.note}</span><span class="mono" style="color:#dfe;font-size:13px;margin:0 8px">${nm}</span><span class="mono" style="color:#789;font-size:11px">${semis} semitone${semis !== 1 ? 's' : ''}</span>`;
    } else {
      rd.innerHTML = `<span class="mono" style="color:#ffd23f;font-size:12px">📏 Interval Explorer</span><span class="mono" style="color:#789;font-size:11px;margin-left:8px">click two notes to measure the interval${intervalPicks.length ? ' · 1 picked' : ''}</span>`;
    }
  }
}

function dispatchFretboardClick(info) {
  // While defining a custom hand-shape, clicks build the shape instead of playing.
  if (isDefining() && info.si !== undefined && info.fret !== undefined) {
    addShapeFret(info.si, info.fret);
    return;
  }
  // Interval Explorer: clicks pick up to two notes and measure between them.
  if (fretboardView === 'interval' && info.si !== undefined && info.fret !== undefined) {
    playClickedNote(info.note, info.octave || 3);
    const i = intervalPicks.findIndex(p => p.si === info.si && p.fret === info.fret);
    if (i >= 0) intervalPicks.splice(i, 1);
    else { intervalPicks.push(info); if (intervalPicks.length > 2) intervalPicks.shift(); }
    renderIntervalPicks();
    return;
  }
  playClickedNote(info.note, info.octave || 3);
  setLastClickedNote(info);
  updateOverlays();
  if (onFretboardClick) onFretboardClick(info);
}

// Convert a mouse/touch event to SVG coordinate space using the element's
// own transform matrix — correct regardless of scale, max-height, or CSS layout.
function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function wireFretboardClick() {
  const svg = document.getElementById('fb-svg');
  if (!svg) return;
  svg.addEventListener('click', e => {
    const inst = getInst();
    const { x: mx, y: my } = svgPoint(svg, e.clientX, e.clientY);

    if (inst.renderer === 'keyboard') {
      const g = pianoGeo();

      // Black keys first (they sit on top of white keys)
      for (let o = g.startOct; o < g.startOct + g.octs; o++) {
        for (let bi = 0; bi < PIANO_BLACK_POS.length; bi++) {
          const wBase = (o - g.startOct) * 7;
          const kx = g.whiteX(wBase) + PIANO_BLACK_POS[bi] * g.kw - g.bkw / 2 + g.kw / 2;
          if (mx >= kx && mx <= kx + g.bkw && my >= 10 && my <= 10 + g.bkh) {
            dispatchFretboardClick({ note: NOTES[PIANO_BLACK[bi]], octave: o }); return;
          }
        }
      }
      // White keys
      let wi = 0;
      for (let o = g.startOct; o < g.startOct + g.octs; o++) {
        for (let wsi = 0; wsi < PIANO_WHITE.length; wsi++) {
          const kx = g.whiteX(wi);
          if (mx >= kx && mx <= kx + g.kw - 2 && my >= 10 && my <= 10 + g.kh) {
            dispatchFretboardClick({ note: NOTES[PIANO_WHITE[wsi]], octave: o }); return;
          }
          wi++;
        }
      }
    } else if (inst.renderer === 'fretboard') {
      const g = geo();

      // Find closest string — reject if further than half a string-gap away
      let closestSi = 0, closestDist = Infinity;
      customTuning.forEach((s, si) => {
        const dist = Math.abs(my - g.sy(si));
        if (dist < closestDist) { closestDist = dist; closestSi = si; }
      });
      if (closestDist > g.ss * 0.6) return;

      // Find clicked fret.
      // Fret f occupies the space between fret wire f-1 (left) and fret wire f (right).
      // Iterate from the highest fret down and take the first one whose left wire
      // is at or before the click — this places the exact wire position as the
      // boundary between adjacent frets, matching physical guitar playing position.
      let closestFret = 0; // open string default
      for (let f = g.nf; f >= 1; f--) {
        if (mx >= g.nx + fretX[f - 1]) { closestFret = f; break; }
      }

      const { note } = getNoteAtFret(customTuning[closestSi].note, customTuning[closestSi].octave, closestFret);
      const oct = customTuning[closestSi].octave + Math.floor((NOTES.indexOf(customTuning[closestSi].note) + closestFret) / 12);
      dispatchFretboardClick({ note, octave: oct, fret: closestFret, si: closestSi });
    }
  });
}

// ── Session bar (home-base strip mirroring master Key + Tempo) ────────
function renderSessionBar() {
  const el = document.getElementById('session-bar');
  if (!el) return;
  const mk = pedalBus.masterKey || {};
  const activeTypes = pedals.map(p => p.type);
  const keyN   = pedalBus.followerCount(activeTypes);
  const tempoN = metroClock.followerCount(activeTypes);
  const keyTxt = mk.root ? `${mk.root} ${mk.keyType}` : '—';
  const sig = `${keyTxt}|${keyN}|${metroClock.bpm}|${metroClock.ts}|${metroClock.unit}|${tempoN}`;
  if (el._sig === sig) return;
  el._sig = sig;
  el.innerHTML = `
    <div style="flex:1;min-width:190px;display:flex;align-items:center;gap:7px;background:rgba(136,119,221,.06);border:1px solid rgba(136,119,221,.25);border-radius:7px;padding:4px 9px">
      <span style="font-size:12px">🔑</span>
      <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px">KEY</span>
      <span class="mono" style="color:#bbaaee;font-size:12px;font-weight:700">${keyTxt}</span>
      <span class="mono" style="color:#777;font-size:8px;margin-left:auto">driving ${keyN}</span>
      <button data-relink="key" style="background:rgba(136,119,221,.12);border:1px solid #8877dd55;color:#aa99dd;border-radius:4px;padding:2px 7px;font-size:8px;cursor:pointer">⟲ Re-link all</button>
    </div>
    <div style="flex:1;min-width:190px;display:flex;align-items:center;gap:7px;background:rgba(221,136,68,.06);border:1px solid rgba(221,136,68,.25);border-radius:7px;padding:4px 9px">
      <span style="font-size:12px">⏱</span>
      <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px">TEMPO</span>
      <span class="mono" style="color:#e0a14a;font-size:12px;font-weight:700">♩=${metroClock.bpm} · ${metroClock.ts}/${metroClock.unit}</span>
      <span class="mono" style="color:#777;font-size:8px;margin-left:auto">driving ${tempoN}</span>
      <button data-relink="tempo" style="background:rgba(221,136,68,.12);border:1px solid #dd884455;color:#e0a14a;border-radius:4px;padding:2px 7px;font-size:8px;cursor:pointer">⟲ Re-link all</button>
    </div>`;
  el.querySelector('[data-relink="key"]')?.addEventListener('click', () => {
    activeTypes.forEach(t => { if (LINK_PROFILE[t]?.key) pedalBus.linkPedal(t); });
    if (pedalBus.masterKey.root) pedalBus.setKey(pedalBus.masterKey.root, pedalBus.masterKey.keyType, { source: 'session-bar' });
    renderSessionBar();
  });
  el.querySelector('[data-relink="tempo"]')?.addEventListener('click', () => {
    activeTypes.forEach(t => { if (LINK_PROFILE[t]?.tempo) metroClock.linkPedal(t); });
    renderSessionBar();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────
async function init() {
  restoreState();
  normalizePedalsToStartKey(true);
  pedalBus.setKey(START_KEY.root, START_KEY.keyType, { source:'app-init' });

  // 🎯 lives on the instrument bar now, next to the neck it gives the room to,
  // rather than in the header with the file/mode buttons.
  const onFocus = () => setFocusMode(!focusMode);
  // Wired ONCE: #btn-focus lives in index.html above the dock rail, so unlike the
  // pedal bar it is never re-rendered. Attaching it inside a render function would
  // stack a listener per instrument change and one click would toggle focus twice.
  document.getElementById('btn-focus')?.addEventListener('click', e => { e.stopPropagation(); onFocus(); });

  // Render shell UI
  renderHeader({
    onSave:    save,
    onCatalog: () => {
      refreshCatalog();                       // counts must be current when it opens
      document.getElementById('catalog-drawer')?.classList.toggle('open');
    },
    onHelp:    () => { renderHelp(); document.getElementById('help-overlay')?.classList.add('open'); },
    onModeSwitch: switchMode
  });
  renderInstrumentDisplay();
  // The bar's first argument has always been an optional onInstrumentChange hook.
  // 🎯 is handed over BOTH ways — as a property of that argument and as a second
  // one — because the button's new home and this call site landed in different
  // files, and either shape of parameter list finds it. The no-op keeps the first
  // argument callable, which is the one thing the bar already does with it.
  const instBarHook = () => {};
  instBarHook.onFocus = onFocus;
  renderInstrumentBar(instBarHook, onFocus);
  refreshCatalog();
  renderHelp();
  renderZoomControl();

  // Build instrument display
  buildInstrumentView();
  buildTuningBar(save);
  buildPositionBar();
  updateOverlays();

  // Wire fretboard click
  wireFretboardClick();

  // Register cross-pedal rebuild hook
  pedalBus.rebuildPedal = (type, settings) => {
    let pd = pedals.find(x => x.type === type);          // exact match first (a coexisting legacy instance still works)
    if (!pd) {
      // legacy deep-links → the merged pedal, opening the right tab/mode
      if (WORKSHOP_TAB_OF[type])      { pd = pedals.find(x => x.type === 'workshop'); if (pd) settings = { ...(settings || {}), _autoStartTab: WORKSHOP_TAB_OF[type] }; }
      else if (type === 'arpeggios')  { pd = pedals.find(x => x.type === 'scales');   if (pd) settings = { ...(settings || {}), saMode: 'arps' }; }
      else if (type === 'notequiz')   { pd = pedals.find(x => x.type === 'ear');      if (pd) settings = { ...(settings || {}), fetGroup: 'theory' }; }
    }
    if (!pd) return;
    if (settings) Object.assign(pd.settings || (pd.settings = {}), settings);
    buildContent(pd);
  };

  // "Learn the theory →" from any pedal's smart Theory panel → open Theory Path at that lesson.
  // "Open the lesson" lands on the LEARN page, not the pedal: the page is where a
  // lesson can be read. The pedal stays the compact launcher and progress card.
  window.addEventListener('resonote:open-lesson', e => {
    const lessonId = e.detail?.lessonId || null;
    switchMode('learn');
    mountLearn(lessonId);
    save();
  });

  // "Practice this drill" from a Theory Path lesson → open the pedal that fits the drill type.
  window.addEventListener('resonote:load-drill', e => {
    const d = e.detail?.drill; if (!d || !Array.isArray(d.progression)) return;
    const route = routeDrill(d);
    if (route.bpm) metroClock.set(route.bpm, Array.isArray(d.timeSig) ? d.timeSig[0] : (metroClock.ts || 4));
    let target = pedals.find(x => x.type === route.type);
    if (!target) { addPedal(route.type); target = pedals.find(x => x.type === route.type); }
    if (!target) return;
    target.settings = target.settings || {};
    Object.assign(target.settings, route.settings);
    buildContent(target);
    raise(target.id);
    save();
  });

  // Fretboard view switched → reset the Interval Explorer picks and refresh.
  window.addEventListener('resonote:fbview', e => {
    intervalPicks = [];
    if (e.detail?.view === 'interval') { metroClock.stopAll(); renderIntervalPicks(); }
    else updateOverlays();
  });

  // "Loop in Theory library" from a lesson → open the Practice Manager's Theory view at that drill.
  window.addEventListener('resonote:open-theory', e => {
    const lessonId = e.detail?.lessonId; if (!lessonId) return;
    let pm = pedals.find(x => x.type === 'practice');
    if (!pm) { addPedal('practice'); pm = pedals.find(x => x.type === 'practice'); }
    if (!pm) return;
    pm.settings = pm.settings || {};
    pm.settings._theoryOpenLesson = lessonId;
    buildContent(pm);
    raise(pm.id);
    save();
  });

  // 🎒 Load-out → ▶ Start playing: put the chosen starter pedals on the board.
  // (Instrument, look and tuning are already applied live by the picker itself.)
  // Picking a load-out is choosing a kit, so it also RESETS the arrangement —
  // the picked pedals get laid out fresh instead of landing on an old layout.
  window.addEventListener('resonote:loadout', e => {
    const types = e.detail?.pedals; if (!Array.isArray(types)) return;
    reconcileCards();   // the checks below trust `pedals`, so make the layer match it first
    // The kit you ticked IS the board: add what's missing, take off what you
    // unticked. (The ticks are seeded from the live board, so an untick is a
    // deliberate "not this one" — and every pedal's own progress lives in its own
    // storage, so nothing you've learned is lost by taking it off the board.)
    const want = new Set(types.filter(t => CATALOG.some(c => c.type === t)));
    if (!want.size) return;        // an empty kit is a mis-tap, not a request for a bare board
    pedals.filter(p => !want.has(p.type)).forEach(p => document.getElementById('pedal-' + p.id)?.remove());
    pedals = pedals.filter(p => want.has(p.type));
    want.forEach(t => { if (!pedals.some(x => x.type === t)) addPedal(t); });
    pedals.forEach(p => { const c = CATALOG.find(c2 => c2.type === p.type); if (c) { p.w = c.w; p.h = c.h; } });
    layoutPedals();
    save();
    renderSessionBar();
    refreshCatalog();
  });

  // A page delegating to a pedal (the TAB reader's click → the ⏱️ Metronome) needs
  // that pedal to exist. Put it on the board if it isn't, bring it forward if it is.
  window.addEventListener('resonote:need-pedal', e => {
    const type = e.detail?.type;
    if (!type || !CATALOG.some(c => c.type === type)) return;
    if (!pedals.some(p => p.type === type)) addPedal(type);
    else if (e.detail?.reveal) revealPedal(type);
  });

  // "?" Reference → ▶ Walk me through it: add the pedal if needed, run its coach on it.
  window.addEventListener('resonote:coach', e => {
    const type = e.detail?.type; if (!type) return;
    let pd = pedals.find(x => x.type === type);
    if (!pd) { addPedal(type); pd = pedals.find(x => x.type === type); }
    if (!pd) return;
    raise(pd.id);
    startCoach(type, pd.id);
  });

  // Stream Deck / F13-F24 / console — all three enter through one router.
  initRemote({ apply: applyCommand, state: readRemoteState });

  // "First run" means: no arrangement of your own is in play — either nothing was
  // saved, or what was saved belongs to an older board version and was discarded.
  const firstRun = !boardAdopted;

  // The written library is the one thing in this app that cannot be regenerated,
  // and it lived only in browser storage until a preview restart wiped it. Any
  // library that comes up without the founding pieces gets them back from disk —
  // once, behind a flag, so deliberately clearing them out stays possible.
  try {
    const seeded = localStorage.getItem('rn-lib-seeded');
    const lib = storeRead(KEYS.pieces, []);
    if (!seeded || !(Array.isArray(lib) && lib.length)) {
      const { library, added } = restoreMissing(Array.isArray(lib) ? lib : []);
      if (added.length) storeWrite(KEYS.pieces, library);   // through the store: one cap for every writer
      localStorage.setItem('rn-lib-seeded', '1');
    }
  } catch (e) { /* private mode — the pedals still work, the shelf is just empty */ }

  // Mount saved pedals — each one on its own. A pedal that throws in someone
  // else's browser (an audio device that is not there, a permission that is
  // refused) must not take the whole first run down with it: the card stays,
  // says what happened, and the other pedals mount normally.
  pedals.forEach(p => {
    try { mountPedal(p); }
    catch (e) {
      console.error('pedal failed to mount:', p.type, e);
      const body = document.getElementById('body-' + p.id);
      if (body) body.innerHTML = `<div class="mono" style="padding:14px;font-size:calc(11px*var(--ui));color:var(--rk-ink-dim);line-height:1.5">This pedal hit an error while opening.<br><span style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">${String(e && e.message || e).replace(/</g,'&lt;').slice(0,160)}</span><br>Close it and add it again from + PEDALS.</div>`;
    }
  });

  // First run gets the tidy arrangement rather than the raw default coordinates.
  if (firstRun) layoutPedals();
  // A RESTORED board never ran a layout, so a pedal saved as minimized would come
  // back visible and un-docked — the dock has to be built from saved state too,
  // not only as a side effect of arranging.
  else applyLayoutToDom();
  paintFocusChrome();     // a session that was left in focus mode says so

  // Session bar — mirror master Key + Tempo (cheap sig-guarded re-render)
  renderSessionBar();
  pedalBus.on(renderSessionBar);
  pedalBus.onLinks(renderSessionBar);
  metroClock.on(renderSessionBar);
  metroClock.onLinks(renderSessionBar);

  // Audio reactive overlays
  audio.on(() => {
    if (audio.detected) setLastClickedNote(null);
    updateOverlays();
  });

  // First visit → the 🎒 load-out picker (pick a kit before reading anything);
  // once that's been through, the reference guide still gets its one showing.
  if (!loadoutDone()) {
    renderHelp('loadout');
    document.getElementById('help-overlay')?.classList.add('open');
    localStorage.setItem('resonote-seen', '1');
  } else if (!localStorage.getItem('resonote-seen')) {
    document.getElementById('help-overlay')?.classList.add('open');
    localStorage.setItem('resonote-seen', '1');
  }
}

// A hand-hold on the store, from the browser console. Not a feature — a fire
// exit. If the board ever comes back wrong, `resonote.history()` lists what can
// be gone back to and `resonote.undoBoard()` takes the most recent one; both
// snapshot the current board first, so undoing an undo also works.
// `resonote.inventory()` says what the app is holding of yours and how big it is.
window.resonote = {
  history:   boardHistory,
  undoBoard: i => { const ok = restoreBoard(i); if (ok) location.reload(); return ok; },
  snapshot:  snapshotBoardNow,
  inventory,
};

init();
