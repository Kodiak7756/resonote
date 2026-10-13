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

import { post, onSyncMessage, requestState } from '../core/sync.js';

export const POPOUT = new URLSearchParams(location.search).get('popout');
export const NECK = 'neck';
export const canPopOut = type => type !== 'audio';

const popped = new Map();        // main window: pedal id → its Window (null if found after a reload)
let deps = null;                 // { pedals(), buildContent, save, onChange }

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
      if (p && m.settings) { p.settings = m.settings; deps.save(); }
    } else if (m.kind === 'popout-here') {
      markPopped(m.id, null);
    } else if (m.kind === 'popout-gone') {
      markBack(m.id);
    }
  });
  // A pop-out that is closed without saying goodbye (crash, killed tab).
  setInterval(() => {
    popped.forEach((w, id) => { if (w && w.closed) markBack(id); });
  }, 1000);
  // After a reload of the main window, any pop-outs still open re-announce.
  post('main-hello');
}

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
