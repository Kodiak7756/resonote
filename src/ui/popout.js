// Pop-out windows: any pedal (or the neck) can leave the board and open in a
// window of its own, which the player can park anywhere — a second monitor
// today, a spot in the room later.
//
// A popped-out window is the same app opened with `?popout=<pedal id>` (or
// `?popout=neck`). It loads the saved board, mounts ONLY that one pedal, and
// follows the main window through core/sync.js. Its card in the main window is
// switched off — the pedal runs in exactly one place — and comes back when the
// pop-out closes.
//
// The mic stays in the main window: the Input pedal never pops out, and other
// windows see what the mic hears through sync's `audio` messages.
//
// HEADSET WINDOWS (VR.md). The same view can also open in the headset's
// browser, from the hub at /vr. A headset window is a COPY: the PC keeps its
// card on the board, running, and the copy follows the PC through the LAN relay
// in core/sync.js. The headset has no saved board of its own (its browser is
// another machine), so the copy asks the PC's main window for the pedal — and
// keeps asking until the PC answers. While a copy is open it is the say-so for
// that pedal's own settings: they come back here and are saved, and the PC's
// card picks them up when the copy closes. Both sides send a heartbeat, so a
// headset window that vanishes without a goodbye (headset asleep, browser
// killed) is noticed within seconds, and so is a PC that has gone quiet.

import { post, onSyncMessage, requestState, onPcLink, BEAT_MS, GONE_MS } from '../core/sync.js';
import { pedalBus, metroClock } from '../core/state.js';
import { audio } from '../core/audio.js';

// ── Which window is this? ────────────────────────────────────────────
//   ?popout=<id>           a pop-out on the PC (⧉ on a card); the card steps aside
//   /vr        or ?vr      the headset hub: the PC's board as windows to open
//   /vr/<ref>  or ?vr=<ref> a headset window: one pedal (or the neck), a copy
// <ref> is a pedal's type when the board holds only one of that type (short
// enough to type into a headset), else its id. The headset links need the dev
// server — its socket is the relay — so a production build never takes them.
const query = new URLSearchParams(location.search);
const vrPath = /\/vr(?:\/([^/]+))?\/?$/.exec(location.pathname);
const VR = !!import.meta.hot && (!!vrPath || query.has('vr'));
const VR_REF = VR ? (() => { try { return decodeURIComponent(vrPath?.[1] || query.get('vr') || ''); } catch (e) { return ''; } })() : '';
export const VR_HUB = VR && !VR_REF;
export const REMOTE = VR && !!VR_REF;
export const POPOUT = REMOTE ? VR_REF : query.get('popout');
export const NECK = 'neck';
export const canPopOut = type => type !== 'audio';

const popped = new Map();        // main window: pedal id → its Window (null if found after a reload)
const viewers = new Map();       // main window: headset window id → { id: pedal id (or 'neck'), at }
const dirty = new Set();         // main window: pedals a headset copy has changed the settings of
let deps = null;                 // { pedals(), buildContent, save, onChange, catalog }

const placeholderHTML = id => `
  <div class="mono popout-note" style="padding:14px;font-size:calc(11px*var(--ui));color:var(--rk-ink-dim);line-height:1.6">
    This pedal is open in its own window.
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button class="rk-btn" data-popout-show="${id}">Show the window</button>
      <button class="rk-btn" data-popout-back="${id}">Bring it back here</button>
    </div>
  </div>`;

function popupUrl(id) {
  return `${location.origin}${location.pathname}?popout=${encodeURIComponent(id)}`;
}
function features(w, h) {
  return `popup=yes,width=${Math.round(w)},height=${Math.round(h)}`;
}

// ── Main window ──────────────────────────────────────────────────────
function switchOff(id) {
  const p = deps.pedals().find(x => x.id === id);
  if (p && typeof p._teardown === 'function') { try { p._teardown(); } catch (e) {} }
  const body = document.getElementById('body-' + id);
  if (!body) return;
  // A pedal's loops keep running while #body-<id> exists, so the body itself
  // goes — not just its contents — and a stand-in takes its place.
  const stand = document.createElement('div');
  stand.className = 'pedal-body';
  stand.id = 'popped-' + id;
  stand.innerHTML = placeholderHTML(id);
  body.replaceWith(stand);
  stand.querySelector('[data-popout-show]')?.addEventListener('click', e => { e.stopPropagation(); focusWindow(id); });
  stand.querySelector('[data-popout-back]')?.addEventListener('click', e => { e.stopPropagation(); closePopOut(id); });
  document.getElementById('pedal-' + id)?.classList.add('is-popped');
}

function switchOn(id) {
  const stand = document.getElementById('popped-' + id);
  document.getElementById('pedal-' + id)?.classList.remove('is-popped');
  if (!stand) return;
  const body = document.createElement('div');
  body.className = 'pedal-body';
  body.id = 'body-' + id;
  stand.replaceWith(body);
  const p = deps.pedals().find(x => x.id === id);
  if (p) deps.buildContent(p);
}

function markPopped(id, win) {
  if (popped.has(id)) { if (win) popped.set(id, win); return; }
  popped.set(id, win || null);
  if (id !== NECK) switchOff(id);
  deps.onChange?.();
}

function markBack(id) {
  if (!popped.has(id)) return;
  popped.delete(id);
  if (id !== NECK) switchOn(id);
  deps.onChange?.();
}

function focusWindow(id) {
  const w = popped.get(id);
  if (w && !w.closed) { try { w.focus(); return; } catch (e) {} }
  post('popout-focus', { id });
}

export function closePopOut(id) {
  const w = popped.get(id);
  if (w && !w.closed) { try { w.close(); } catch (e) {} }
  post('popout-close', { id });
}

export const isPopped = id => popped.has(id);

export function popOut(id) {
  if (popped.has(id)) { focusWindow(id); return; }
  const p = id === NECK ? null : deps.pedals().find(x => x.id === id);
  if (id !== NECK && (!p || !canPopOut(p.type))) return;
  deps.save();                         // the pop-out boots from the saved board
  const neckEl = document.getElementById('instrument-display');
  const w = id === NECK ? Math.max(900, neckEl?.offsetWidth || 1200) : Math.max(260, p.w || 320);
  const h = id === NECK ? Math.max(260, (neckEl?.offsetHeight || 300) + 20) : Math.max(240, p.h || 480);
  const win = window.open(popupUrl(id), 'resonote-' + id, features(w, h));
  if (!win) {
    alert('The window was blocked. Allow pop-ups for Resonote and try again.');
    return;
  }
  markPopped(id, win);
}

export function initPopoutMain(d) {
  deps = d;
  onSyncMessage(m => {
    if (m.kind === 'popout-settings') {
      const p = deps.pedals().find(x => x.id === m.id);
      // A new object, not a merge: if the card is still running here (a headset
      // copy), its next render must not write its older values over these.
      if (p && m.settings) { p.settings = m.settings; if (m.vr) dirty.add(p.id); deps.save(); }
    } else if (m.vr) {
      // A headset window never steps a card aside. (Headset windows exist only
      // on the dev server's relay, so a production build carries none of this.)
      if (import.meta.hot) onHeadset(m);
    } else if (m.kind === 'popout-here') {
      markPopped(m.id, null);
    } else if (m.kind === 'popout-gone') {
      markBack(m.id);
    }
  });
  // A pop-out that is closed without saying goodbye (crash, killed tab).
  setInterval(() => {
    popped.forEach((w, id) => { if (w && w.closed) markBack(id); });
    // …and a headset window that has stopped sending its heartbeat.
    const now = Date.now();
    viewers.forEach((v, win) => { if (now - v.at > GONE_MS) dropViewer(win); });
  }, 1000);
  // After a reload of the main window, any pop-outs still open re-announce.
  post('main-hello');
}

// ── Main window: headset windows ─────────────────────────────────────
// What the headset sees of the board: every pedal that can leave it (not the
// Input pedal — it holds the mic), in board order, with its short address.
function refOf(p, all) {
  return all.filter(x => x.type === p.type).length === 1 ? p.type : p.id;
}
function findByRef(ref) {
  const all = deps.pedals();
  return all.find(p => p.id === ref) || all.find(p => p.type === ref) || null;
}
function boardList() {
  const all = deps.pedals();
  return all.filter(p => canPopOut(p.type)).map(p => {
    const c = deps.catalog?.find(e => e.type === p.type) || {};
    return { id: p.id, type: p.type, ref: refOf(p, all), title: c.title || p.type, icon: c.icon || '', accent: c.accent || '',
             docked: !!p.minimized, here: viewerCount(p.id) };
  });
}
const viewerCount = id => [...viewers.values()].filter(v => v.id === id).length;
export const hasViewers = id => viewerCount(id) > 0;

function onHeadset(m) {
  switch (m.kind) {
    case 'vr-board?':
      post('vr-board', { to: m.from, board: boardList(), neckHere: viewerCount(NECK) });
      break;
    case 'vr-need-pedal': {
      const p = findByRef(m.ref);
      const c = p && deps.catalog?.find(e => e.type === p.type);
      post('vr-pedal', { to: m.from, ref: m.ref, found: !!(p && canPopOut(p.type)),
        pedal: p && canPopOut(p.type) ? { id: p.id, type: p.type, w: p.w, h: p.h, settings: p.settings || {} } : null,
        title: c?.title || '', icon: c?.icon || '' });
      break;
    }
    case 'vr-here':
      if (!viewers.has(m.from) || viewers.get(m.from).id !== m.id) { viewers.set(m.from, { id: m.id, at: Date.now() }); paintViewers(); }
      else viewers.get(m.from).at = Date.now();
      break;
    case 'vr-bye':
      dropViewer(m.from);
      break;
  }
}

function dropViewer(win) {
  const v = viewers.get(win);
  if (!v) return;
  viewers.delete(win);
  paintViewers();
  // The last headset copy has closed: the card here takes back over, showing
  // what was changed out there. (Once per closing, so a card isn't rebuilt —
  // and its listeners stacked — on every click made in the headset.)
  if (!hasViewers(v.id) && dirty.has(v.id)) {
    dirty.delete(v.id);
    const p = deps.pedals().find(x => x.id === v.id);
    if (p && !popped.has(p.id) && document.getElementById('body-' + p.id)) deps.buildContent(p);
  }
}

// A card with a copy open in the headset says so, quietly.
function paintViewers() {
  deps.pedals().forEach(p => document.getElementById('pedal-' + p.id)?.classList.toggle('in-vr', hasViewers(p.id)));
  document.getElementById('btn-neck-out')?.classList.toggle('in-vr', hasViewers(NECK));
}

// The PC took a pedal off its board: any headset copy of it says so.
export function pedalRemoved(id) { post('vr-gone', { id }); }

// ── Pop-out window ───────────────────────────────────────────────────
export function initPopoutWindow({ pedal, title }) {
  const id = POPOUT;
  document.body.classList.add('popout', id === NECK ? 'popout-neck' : 'popout-pedal');
  if (title) document.title = title + ' — Resonote';

  post('popout-here', { id });
  onSyncMessage(m => {
    if (m.kind === 'main-hello') { post('popout-here', { id }); requestState(); }
    else if (m.kind === 'popout-close' && m.id === id) window.close();
    else if (m.kind === 'popout-focus' && m.id === id) { try { window.focus(); } catch (e) {} }
  });

  // The pedal keeps its settings on itself; hand them back to the main window,
  // which owns the saved board, whenever they change and once more on close.
  let lastSig = '';
  const sendSettings = () => {
    if (!pedal) return;
    let sig = '';
    try { sig = JSON.stringify(pedal.settings || {}); } catch (e) { return; }
    if (sig === lastSig) return;
    lastSig = sig;
    post('popout-settings', { id, settings: pedal.settings || {} });
  };
  if (pedal) { try { lastSig = JSON.stringify(pedal.settings || {}); } catch (e) {} setInterval(sendSettings, 1500); }
  window.addEventListener('beforeunload', () => {
    sendSettings();
    if (pedal && typeof pedal._teardown === 'function') { try { pedal._teardown(); } catch (e) {} }
    post('popout-gone', { id });
  });
}

// ── Headset window ───────────────────────────────────────────────────
// One pedal (or the neck), copied from the PC's board. There is nothing to
// show until the PC's main window answers, so the question repeats every two
// seconds until it does — and again whenever the PC's window reloads.
//   mount(def) → mounts the PC's pedal here and returns it (main.js owns mounting)
//   rebuild(p) → rebuilds it after the PC pushed new settings into it
export function initRemoteWindow({ mount, rebuild }) {
  const ref = POPOUT, neck = ref === NECK;
  document.body.classList.add('popout', 'vr-mode', 'vr-remote', neck ? 'popout-neck' : 'popout-pedal');
  document.title = (neck ? 'Neck' : 'Pedal') + ' — Resonote VR';
  const bar = remoteBar({ sizable: !neck, title: neck ? '🎸 Neck' : 'Pedal' });
  let pedal = null, id = neck ? NECK : null, gone = false, lastSig = '';
  let link = 'never';                            // 'never' heard the PC | 'up' | 'lost' (heard it, then silence)
  const sigOf = p => { try { return JSON.stringify(p.settings || {}); } catch (e) { return lastSig; } };

  const ask  = () => { if (!neck && (!pedal || gone)) post('vr-need-pedal', { ref }); };
  const here = () => { if (id) post('vr-here', { id }); };
  ask(); here();
  setInterval(ask, 2000);
  setInterval(here, BEAT_MS);

  onPcLink(up => {
    bar.setLink(up);
    if (up) {
      here(); ask();
      if (link === 'lost') requestState();       // back after a gap: catch up on what moved meanwhile
      link = 'up';
      if (neck || pedal) note(gone ? goneNote() : null);
    } else {
      if (link === 'up') link = 'lost';
      if (!pedal && !gone) note(waitingNote());
    }
  });

  onSyncMessage(m => {
    switch (m.kind) {
      case 'vr-pedal':                           // (sync hands over only the answers addressed here)
        if (m.ref !== ref) break;
        if (!m.found) { gone = true; note(goneNote()); break; }
        if (pedal && m.pedal.id !== id) { location.reload(); break; }   // the PC has a different one by that name now
        gone = false;
        if (pedal) { note(null); break; }        // still there — asked again after the PC reloaded
        id = m.pedal.id;
        pedal = mount(m.pedal);
        lastSig = sigOf(pedal);
        bar.setTitle(`${m.icon || ''} ${m.title || m.pedal.type}`.trim());
        document.title = `${m.title || m.pedal.type} — Resonote VR`;
        note(null);
        here();
        requestState();                          // replay the PC's key, tempo and neck into it, now it's listening
        break;
      case 'popout-rebuild':                     // the PC sent this pedal new settings (a drill, a chord push)
        if (!pedal || m.id !== id) break;
        pedal.settings = { ...(pedal.settings || {}), ...(m.settings || {}) };
        lastSig = sigOf(pedal);
        rebuild(pedal);
        break;
      case 'vr-gone':                            // the PC took it off its board
        if (neck || m.id !== id) break;
        gone = true; note(goneNote());
        break;
      case 'main-hello':                         // the PC's main window (re)loaded
        here(); requestState(); ask();
        break;
    }
  });

  // This copy's own settings go back to the PC, which saves them.
  const sendSettings = () => {
    if (!pedal || gone) return;
    const sig = sigOf(pedal);
    if (sig === lastSig) return;
    lastSig = sig;
    post('popout-settings', { id, settings: pedal.settings || {} });
  };
  setInterval(sendSettings, 1500);
  let said = false;
  const bye = () => {
    if (said) return;
    said = true;
    sendSettings();
    if (pedal && typeof pedal._teardown === 'function') { try { pedal._teardown(); } catch (e) {} }
    post('vr-bye');
  };
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
}

export const hubUrl = () => `${location.origin}/vr`;
export const remoteUrl = ref => `${location.origin}/vr/${encodeURIComponent(ref)}`;

// What the PC is doing, in one line: master key, tempo, and the note the mic hears.
export function liveLine() {
  const k = pedalBus.masterKey?.root ? `${pedalBus.masterKey.root} ${pedalBus.masterKey.keyType}` : '—';
  const d = audio.detected;
  return `🔑 ${k} · ♩ ${metroClock.bpm}${d?.note ? ` · 🎤 ${d.note}${d.octave ?? ''}` : ''}`;
}
// Hidden until the PC has been heard: before that it would only show this
// window's own start-up defaults, as if they were the PC's.
export function followLive(el) {
  const paint = () => { const t = liveLine(); if (el.textContent !== t) el.textContent = t; };
  pedalBus.on(paint); metroClock.on(paint); audio.on(paint);
  el.style.visibility = 'hidden';
  onPcLink(up => { if (up) el.style.visibility = ''; });
  paint();
}

// The connection light, the same on the hub and in every headset window.
export const linkHTML = () => `<span class="vr-link" data-up="0"><i></i><b>Not connected to the PC</b></span>`;
export function paintLink(el, up) {
  if (!el) return;
  el.dataset.up = up ? '1' : '0';
  el.querySelector('b').textContent = up ? 'Connected to PC' : 'Not connected to the PC';
}

// The strip across the top of a headset window: is the PC there, what this
// is, what the PC is doing, then size / reload / back to the hub — each one a
// big target, nothing that only shows on hover.
const ZOOM_KEY = 'rn-vr-zoom', ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_DEFAULT = 1.6;
function setZoom(z) {
  z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(z) || ZOOM_DEFAULT)) * 10) / 10;
  document.documentElement.style.setProperty('--vr-zoom', String(z));
  try { localStorage.setItem(ZOOM_KEY, String(z)); } catch (e) {}
  return z;
}
function remoteBar({ sizable, title }) {
  let zoom = ZOOM_DEFAULT;
  try { zoom = Number(localStorage.getItem(ZOOM_KEY)) || ZOOM_DEFAULT; } catch (e) {}
  if (sizable) zoom = setZoom(zoom);
  const el = document.createElement('div');
  el.id = 'vr-bar';
  el.innerHTML = `
    ${linkHTML()}
    <span class="vr-title"></span>
    <span class="vr-live mono"></span>
    <span class="vr-tools">
      ${sizable ? `<button class="vr-btn" data-zoom="-1" title="Smaller">A−</button><button class="vr-btn" data-zoom="1" title="Bigger">A+</button>` : ''}
      <button class="vr-btn" data-reload title="Reload this window from the PC">↻</button>
      <a class="vr-btn" href="${hubUrl()}" title="Back to the list of pedals">Hub</a>
    </span>`;
  document.body.prepend(el);
  el.querySelector('.vr-title').textContent = title;
  el.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => { zoom = setZoom(zoom + 0.2 * Number(b.dataset.zoom)); }));
  el.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  followLive(el.querySelector('.vr-live'));
  return {
    setLink: up => paintLink(el.querySelector('.vr-link'), up),
    setTitle: t => { el.querySelector('.vr-title').textContent = t; },
  };
}

// A message over the window while there is no pedal to show (or it has gone).
function note(html) {
  let el = document.getElementById('vr-note');
  if (!html) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'vr-note'; document.body.appendChild(el); }
  el.innerHTML = html;
}
const waitingNote = () => `<b>Waiting for the PC…</b>
  <p>Keep Resonote open on the PC at <span class="mono">http://localhost:5173</span> — on screen, not minimised.
  This window fills in by itself as soon as the PC answers.</p>`;
const goneNote = () => `<b>This pedal isn't on the PC's board</b>
  <p>It may have been closed there. Go back to the <a href="${hubUrl()}">hub</a> to pick another, or close this window.</p>`;
