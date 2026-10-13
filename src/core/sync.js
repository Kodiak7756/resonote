// Window sync: keeps a popped-out pedal (or the popped-out neck) in step with
// the main window. One BroadcastChannel, same origin, same browser — every
// Resonote window on this PC hears every other one.
//
// What travels:
//   key       pedalBus.setKey / clear            (master key + chord push)
//   links     pedalBus / metroClock link chips
//   tempo     metroClock.set                     (bpm, metre, pattern)
//   beat      metroClock.setBeat                 (the running pulse)
//   position  positionBus                        (hand-position window / shape)
//   display   what the neck is showing           (highlights, view, instrument)
//   audio     the mic's detected note            (MAIN → others only)
//   fbclick   a click on the neck                (to pedals listening for one)
//
// The buses stay the single source of truth (CONTRACTS.md): this module only
// wraps their methods so a change made in one window is replayed in the others.
// `applying` marks a replay, so a replayed change is never sent back out.
//
// The transport is the only part that knows about BroadcastChannel; a later
// LAN relay (the headset) can replace `post` / the message handler without
// touching anything else.

import { pedalBus, metroClock, positionBus, positionIsolation,
         chordHighlight, ghostHighlight, conceptInfo, nowBanner,
         fretboardView, showIntervals, showNoteMap,
         setChordHighlight, clearChordHighlight, setGhostHighlight, clearGhostHighlight,
         setConceptInfo, setNowBanner, setFretboardView, setShowIntervals, setShowNoteMap } from './state.js';
import { audio } from './audio.js';
import { currentInstrument, customTuning, hexLayout,
         setCurrentInstrument, setCustomTuning, setHexLayout } from './tuning.js';
import { updateOverlays, setOverlayHook, buildInstrumentView, currentTheme, setCurrentTheme,
         lastClickedNote, setLastClickedNote } from '../ui/fretboard.js';

const CHANNEL = 'resonote-sync';
const WINDOW_ID = Math.random().toString(36).slice(2, 10);

let chan = null;
let role = 'main';            // 'main' | 'pedal' | 'neck'
let applying = false;         // true while replaying another window's change
let lastDisplaySig = '';
let instSig = '';
const handlers = [];          // extra message handlers (window lifecycle lives in popout.js)

const plain = v => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch (e) { return null; } };

export function post(kind, data = {}) {
  if (!chan) return;
  try { chan.postMessage({ kind, from: WINDOW_ID, ...plain(data) }); } catch (e) {}
}
export function onSyncMessage(fn) { handlers.push(fn); }
export const isMainWindow = () => role === 'main';

function replay(fn) {
  applying = true;
  try { fn(); } catch (e) { console.warn('sync replay failed', e); }
  finally { applying = false; }
}

// ── Snapshots ────────────────────────────────────────────────────────
const tempoOf = () => ({
  bpm: metroClock.bpm, ts: metroClock.ts, unit: metroClock.unit, pattern: metroClock.pattern,
  subdiv: metroClock.subdiv, playing: metroClock.playing, masterSource: metroClock.masterSource,
});
const keyOf = () => ({
  root: pedalBus.root, keyType: pedalBus.session?.rawKeyType || pedalBus.keyType,
  meta: { ...pedalBus.session, root: undefined, keyType: undefined, rawKeyType: undefined, generation: undefined },
});
const instOf = () => ({ currentInstrument, customTuning, hexLayout, currentTheme });
function displayOf() {
  return {
    chordHighlight, ghostHighlight, conceptInfo, nowBanner,
    fretboardView, showIntervals, showNoteMap, lastClickedNote,
    inst: instOf(),
  };
}
export function fullState() {
  return {
    key: pedalBus.root ? keyOf() : null,
    links: { key: pedalBus.links, tempo: metroClock.links },
    tempo: tempoOf(),
    position: positionIsolation,
    display: displayOf(),
  };
}

// ── Apply another window's state ─────────────────────────────────────
function applyKey(k) {
  if (!k || !k.root) { pedalBus.clear(); return; }
  pedalBus.setKey(k.root, k.keyType, k.meta || {});
}
function applyLinks(l) {
  if (!l) return;
  if (l.key)   { pedalBus.links   = { ...l.key };   pedalBus._notifyLinks(); }
  if (l.tempo) { metroClock.links = { ...l.tempo }; metroClock._notifyLinks(); }
}
function applyTempo(t) {
  if (!t) return;
  if (t.subdiv !== undefined) metroClock.subdiv = t.subdiv;
  if (t.playing !== undefined) metroClock.playing = t.playing;
  if (t.masterSource !== undefined) metroClock.masterSource = t.masterSource;
  metroClock.set(t.bpm, t.ts, t.unit, t.pattern);
}
function applyDisplay(d) {
  if (!d) return;
  const c = d.chordHighlight;
  if (c && c.active) setChordHighlight(c.rootNote, c.chordNotes, c.label, c.positions, c.colors, c.focusPos, c.trail, c.focusOnly);
  else clearChordHighlight();
  const g = d.ghostHighlight;
  if (g && g.active) setGhostHighlight(g.positions, g.colors); else clearGhostHighlight();
  setConceptInfo(d.conceptInfo);
  setNowBanner(d.nowBanner);
  if (d.fretboardView) setFretboardView(d.fretboardView);
  setShowIntervals(!!d.showIntervals);
  setShowNoteMap(!!d.showNoteMap);
  setLastClickedNote(d.lastClickedNote || null);
  // Only the popped-out neck follows the instrument: the main window owns that
  // choice (its instrument bar), and a pedal window has no neck to redraw.
  if (role === 'neck' && d.inst) {
    const s = JSON.stringify(d.inst);
    if (s !== instSig) {
      instSig = s;
      setCurrentInstrument(d.inst.currentInstrument);
      if (d.inst.customTuning?.length) setCustomTuning(d.inst.customTuning);
      if (d.inst.hexLayout) setHexLayout(d.inst.hexLayout);
      if (d.inst.currentTheme) setCurrentTheme(d.inst.currentTheme);
      buildInstrumentView();
    }
  }
  lastDisplaySig = JSON.stringify(displayOf());
  updateOverlays();
}
export function applyFullState(s) {
  if (!s) return;
  replay(() => {
    applyLinks(s.links);
    if (s.tempo) applyTempo(s.tempo);
    if (s.position) positionBus.update(s.position);
    if (s.key) applyKey(s.key);
    if (s.display) applyDisplay(s.display);
  });
}

// ── Wrap the buses so local changes go out ───────────────────────────
function wrap(obj, name, after) {
  const orig = obj[name].bind(obj);
  obj[name] = (...args) => { const r = orig(...args); if (!applying) after(...args); return r; };
}

function wireBuses() {
  wrap(pedalBus, 'setKey', () => post('key', { key: keyOf() }));
  wrap(pedalBus, 'clear',  () => post('key', { key: null }));
  const sendLinks = () => post('links', { links: { key: pedalBus.links, tempo: metroClock.links } });
  ['linkPedal', 'unlinkPedal'].forEach(n => { wrap(pedalBus, n, sendLinks); wrap(metroClock, n, sendLinks); });
  wrap(metroClock, 'set', () => post('tempo', { tempo: tempoOf() }));
  wrap(metroClock, 'setBeat', (i, type) => post('beat', { i, type, tempo: tempoOf() }));
  wrap(positionBus, '_emit', () => post('position', { position: positionIsolation }));

  // The neck: whenever any window redraws its overlays, publish what it shows if
  // that changed. Deduped by signature, so the mic's 60 Hz redraw sends nothing
  // unless something on the neck actually moved. Not gated on `applying`: a
  // pedal here may redraw the neck IN RESPONSE to a replayed key change, and
  // that redraw is news. A pure echo is caught by the signature instead, since
  // applyDisplay records what it applied.
  let queued = false;
  setOverlayHook(() => {
    if (queued) return;
    queued = true;
    // A timer, not requestAnimationFrame: the main window is often behind the
    // pop-outs or minimised, and rAF stops running in a hidden window.
    setTimeout(() => {
      queued = false;
      const d = displayOf(), sig = JSON.stringify(d);
      if (sig === lastDisplaySig) return;
      lastDisplaySig = sig;
      post('display', { display: d });
    }, 16);
  });

  // The mic lives in the main window only; the others see what it hears.
  if (role === 'main') {
    let last = 0, lastSig = '';
    audio.on(() => {
      const now = performance.now();
      const msg = { detected: audio.detected, connected: audio.connected, rms: audio.rms, dbfs: audio.dbfs };
      const sig = JSON.stringify([msg.detected, msg.connected]);
      if (sig === lastSig && now - last < 250) return;   // note unchanged → a slow level heartbeat
      last = now; lastSig = sig;
      post('audio', msg);
    });
  }
}

// ── Incoming ─────────────────────────────────────────────────────────
function onMessage(m) {
  if (!m || m.from === WINDOW_ID) return;
  switch (m.kind) {
    case 'key':      replay(() => applyKey(m.key)); break;
    case 'links':    replay(() => applyLinks(m.links)); break;
    case 'tempo':    replay(() => applyTempo(m.tempo)); break;
    case 'beat':     replay(() => {
                       if (m.tempo) {
                         if (m.tempo.playing !== undefined) metroClock.playing = m.tempo.playing;
                         if (m.tempo.masterSource !== undefined) metroClock.masterSource = m.tempo.masterSource;
                       }
                       metroClock.setBeat(m.i, m.type);
                     }); break;
    case 'position': replay(() => positionBus.update(m.position)); break;
    case 'display':  replay(() => applyDisplay(m.display)); break;
    case 'audio':
      if (role === 'main') break;
      audio.detected = m.detected; audio.connected = !!m.connected;
      audio.rms = m.rms || 0; audio.dbfs = m.dbfs ?? -Infinity;
      audio.emit();
      break;
    case 'need-state':
      if (role === 'main') post('state', { to: m.from, state: fullState() });
      break;
    case 'state':
      if (m.to === WINDOW_ID) applyFullState(m.state);
      break;
  }
  handlers.forEach(fn => { try { fn(m); } catch (e) { console.warn(e); } });
}

// Call once, AFTER the window has set its own start-up key (so that start-up
// value is never broadcast over the main window's real one).
export function initSync(r = 'main') {
  role = r;
  if (typeof BroadcastChannel === 'undefined') return false;
  chan = new BroadcastChannel(CHANNEL);
  chan.onmessage = e => onMessage(e.data);
  wireBuses();
  lastDisplaySig = JSON.stringify(displayOf());
  if (role !== 'main') post('need-state');
  return true;
}
export function requestState() { if (role !== 'main') post('need-state'); }
