// Window sync: keeps a popped-out pedal (or the popped-out neck) in step with
// the main window. One BroadcastChannel, same origin, same browser — every
// Resonote window on this PC hears every other one. And, while the dev server
// runs, the LAN relay too — so a window in the headset hears them as well.
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
//   main-beat the PC's main window, still there  (every 4 s; headset windows watch for it)
//   popout-*, vr-*, rebuild-pedal                (window lifecycle: ui/popout.js)
//
// The buses stay the single source of truth (CONTRACTS.md): this module only
// wraps their methods so a change made in one window is replayed in the others.
// `applying` marks a replay, so a replayed change is never sent back out.
//
// The transport (post / receive, below) is the only part that knows how a
// message moves. Two ways out, one way in:
//   BroadcastChannel  every Resonote window in THIS browser (the PC's pop-outs)
//   LAN relay         the dev server's HMR socket; tools/vite-plugin-vr.js hands
//                     each message to every other connected window (the headset)
// A window on the PC hears its neighbours both ways, so each message carries
// its sender's id and a running number, and a number already seen from that
// sender is dropped: applied exactly once, whichever copy lands first. (Both
// ways keep a sender's order, so "highest number seen" is all it takes.)
//
// The main window on the PC stays the one source of truth for audio, as before:
// the mic note goes MAIN → others, never back.

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
// The PC is the machine the dev server runs on, and its windows are the ones
// opened on localhost (which is also the only plain-http address the mic
// accepts). A full copy of Resonote opened at another address — a laptop, or
// the headset's own browser at the root page — is not the PC.
export const ON_PC = /^(localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname);
// Heartbeats, both ways: the PC's main window and each headset window say
// "still here" this often, and the other side calls them gone after this much
// silence (a headset asleep, a browser killed, a PC window that stopped).
export const BEAT_MS = 4000;
export const GONE_MS = 12000;

let chan = null;
let lan = false;              // the LAN relay is in use (dev server, PC window or headset window)
let role = 'main';            // 'main' | 'pedal' | 'neck' | 'hub'
let remote = false;           // a headset window (opened from /vr)
let applying = false;         // true while replaying another window's change
let lastDisplaySig = '';
let instSig = '';
let seq = 0;                  // this window's running message number
const seen = new Map();       // sender id → highest message number already applied
const handlers = [];          // extra message handlers (window lifecycle lives in popout.js)

const plain = v => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch (e) { return null; } };

export function post(kind, data = {}) {
  if (!chan && !lan) return;
  // `pc` marks the PC's main window (the one a headset window waits to hear);
  // `vr` marks a headset window (which the PC never lets step a card aside).
  const m = { ...plain(data), kind, from: WINDOW_ID, seq: ++seq, role, pc: ON_PC && role === 'main', vr: remote };
  if (chan) { try { chan.postMessage(m); } catch (e) {} }
  if (import.meta.hot && lan) { try { import.meta.hot.send('resonote:sync', m); } catch (e) {} }
}
export function onSyncMessage(fn) { handlers.push(fn); }
export const isMainWindow = () => role === 'main';

function receive(m) {
  if (!m || m.from === WINDOW_ID) return;
  if (m.seq) {
    if (m.seq <= (seen.get(m.from) || 0)) return;      // the other copy already landed
    seen.set(m.from, m.seq);
  }
  if (m.pc) heardPc();
  if (m.to && m.to !== WINDOW_ID) return;               // an answer meant for another window
  onMessage(m);
}

// ── Is the PC there? (headset windows) ───────────────────────────────
// "Connected" means the PC's main window has been heard lately — not merely
// that the socket is open, which it can be while the PC's window is closed.
let pcUp = false, lastPc = 0;
const pcFns = [];
export function onPcLink(fn) { pcFns.push(fn); fn(pcUp); }
function setPc(v) { if (v !== pcUp) { pcUp = v; pcFns.forEach(fn => { try { fn(v); } catch (e) { console.warn(e); } }); } }
function heardPc() { lastPc = Date.now(); setPc(true); }

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
// Everything the Input & Tuner pedal shows, so a copy of it in another window
// (the headset) draws the same readings, device list and knob positions.
const audioState = () => ({
  detected: audio.detected, connected: audio.connected, connecting: !!audio.connecting,
  rms: audio.rms, dbfs: audio.dbfs, peakHold: audio.peakHold, devicePeak: audio.devicePeak,
  silent: !!audio.silent, neverHeard: !!audio.neverHeard, everHeard: !!audio._everHeard,
  error: audio.error, diag: audio.diag,
  devices: (audio.devices || []).map(d => ({ deviceId: d.deviceId, label: d.label, kind: d.kind })),
  selectedDeviceId: audio.selectedDeviceId, inputGain: audio.inputGain, noiseGate: audio.noiseGate,
});
const finite = v => (typeof v === 'number' && isFinite(v)) ? v : -Infinity;   // JSON turns -Infinity into null
function applyAudio(m) {
  if (!m) return;
  audio.detected = m.detected || null; audio.connected = !!m.connected; audio.connecting = !!m.connecting;
  audio.rms = m.rms || 0; audio.dbfs = finite(m.dbfs); audio.peakHold = finite(m.peakHold); audio.devicePeak = finite(m.devicePeak);
  audio.silent = !!m.silent; audio.neverHeard = !!m.neverHeard; audio._everHeard = !!m.everHeard;
  audio.error = m.error || null; audio.diag = m.diag || null;
  if (Array.isArray(m.devices)) audio.devices = m.devices;
  if (m.selectedDeviceId !== undefined) audio.selectedDeviceId = m.selectedDeviceId;
  if (m.inputGain !== undefined) audio.inputGain = m.inputGain;
  if (m.noiseGate !== undefined) audio.noiseGate = m.noiseGate;
  audio.emit();
}

// In every window but the PC's main one, the mic's controls become a remote:
// the guitar is plugged into the PC, so Connect, the input list, gain and gate
// are sent there and done there, and the readings come back through applyAudio.
// The knobs move here at once so dragging one feels like dragging it.
function remoteMic() {
  const cmd = (op, arg) => post('audio-cmd', { op, arg });
  audio.connect     = async id => { audio.connecting = true; audio.emit(); cmd('connect', id ?? null); return true; };
  audio.disconnect  = () => cmd('disconnect');
  audio.setDevice   = id => { audio.selectedDeviceId = id; audio.emit(); cmd('setDevice', id); };
  audio.setGain     = v => { audio.inputGain = v; audio.emit(); cmd('setGain', v); };
  audio.setGate     = v => { audio.noiseGate = v; audio.emit(); cmd('setGate', v); };
  audio.primeLabels = async () => { cmd('primeLabels'); return true; };
  audio.enumerate   = async () => { cmd('enumerate'); };
}
function runMicCommand(m) {
  const a = m.arg;
  switch (m.op) {
    case 'connect':     audio.connect(a || audio.selectedDeviceId); break;
    case 'disconnect':  audio.disconnect(); break;
    case 'setDevice':   audio.setDevice(a); break;
    case 'setGain':     if (typeof a === 'number') audio.setGain(a); break;
    case 'setGate':     if (typeof a === 'number') audio.setGate(a); break;
    case 'primeLabels': audio.primeLabels(); break;
    case 'enumerate':   audio.enumerate(); break;
  }
}

export function fullState() {
  return {
    audio: audioState(),
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
  const was = metroClock.bpm;
  metroClock.set(t.bpm, t.ts, t.unit, t.pattern);
  // The Metronome IS the master tempo's pedal, and a tempo change from another
  // window is as deliberate as a deck press — so it is told the same way the
  // deck and the TAB page tell it (it retunes even when unlinked). Otherwise a
  // copy of the Metronome in the headset, or the PC's own card, would go on
  // showing — and clicking at — the old tempo. (Still inside the replay, so the
  // retune is not sent back out.)
  if (metroClock.bpm !== was) window.dispatchEvent(new CustomEvent('resonote:metro', { detail: { action: 'bpm', bpm: metroClock.bpm } }));
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
    if (s.display && role !== 'hub') applyDisplay(s.display);   // the hub has no neck to draw
  });
  if (s.audio && role !== 'main') applyAudio(s.audio);
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
      const msg = audioState();
      const sig = JSON.stringify([msg.detected, msg.connected, msg.connecting, msg.error, msg.silent, msg.neverHeard,
        msg.everHeard, msg.selectedDeviceId, msg.inputGain, msg.noiseGate, msg.devices.length, msg.devices[0]?.label]);
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
    case 'display':  if (role !== 'hub') replay(() => applyDisplay(m.display)); break;
    case 'audio':
      if (role === 'main') break;
      applyAudio(m);
      break;
    case 'audio-cmd':
      if (role === 'main') runMicCommand(m);
      break;
    case 'need-state':
      if (role === 'main') post('state', { to: m.from, state: fullState() });
      break;
    case 'vr-hello':                     // a headset window just opened: answer straight away
      if (import.meta.hot && role === 'main') post('main-beat');
      break;
    case 'state':
      if (m.to === WINDOW_ID) applyFullState(m.state);
      break;
  }
  handlers.forEach(fn => { try { fn(m); } catch (e) { console.warn(e); } });
}

// Call once, AFTER the window has set its own start-up key (so that start-up
// value is never broadcast over the main window's real one).
// `opts.remote` marks a headset window (one opened from /vr).
export function initSync(r = 'main', opts = {}) {
  role = r;
  remote = !!opts.remote;
  // A headset window talks over the LAN only. On the headset a BroadcastChannel
  // would also reach a full copy of Resonote opened there, which isn't the PC.
  if (!remote && typeof BroadcastChannel !== 'undefined') {
    chan = new BroadcastChannel(CHANNEL);
    chan.onmessage = e => receive(e.data);
  }
  // The LAN relay exists only while the dev server runs (a production build has
  // no import.meta.hot, so none of this is in it). The PC's own windows and the
  // headset's join it; a copy of Resonote on any other machine keeps to itself,
  // so the headset can never take that copy's board for the PC's.
  if (import.meta.hot && (remote || ON_PC)) {
    lan = true;
    import.meta.hot.on('resonote:sync', receive);
    import.meta.hot.on('vite:ws:disconnect', () => setPc(false));
    if (role === 'main') setInterval(() => post('main-beat'), BEAT_MS);
    else setInterval(() => { if (pcUp && Date.now() - lastPc > GONE_MS) setPc(false); }, 1000);
  }
  if (!chan && !lan) return false;
  if (role !== 'main') remoteMic();
  if (role !== 'hub') wireBuses();
  lastDisplaySig = JSON.stringify(displayOf());
  if (import.meta.hot && remote) post('vr-hello');
  if (role !== 'main') post('need-state');
  return true;
}
export function requestState() { if (role !== 'main') post('need-state'); }
