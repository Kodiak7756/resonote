// ── 🎤 VOCALS — the third instrument surface ──────────────────────────
// Not a tuner strip. The voice gets the same standing here that the fretboard and
// the piano get: the app's highlight signals drive it, so any drill, lesson, scale
// or song that lights the neck also lays down a ghosted path for the singer to
// chase — the "transparent one to follow".
//
// The pitch reading itself lives in ui/pitch-trace.js; this file is the instrument
// display's chrome: lane mode, the ball / trail / notation toggles, and persistence.
import { createPitchTrace, LANE_MODES, LANE_MODE_LABELS } from '../ui/pitch-trace.js';

const LS_KEY = 'rn-vocals-view';
const DEFAULTS = { lanes: 'key', ball: true, trail: true, notation: false, seconds: 6 };
const SECONDS_CHOICES = [4, 6, 10, 16];

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const out = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
    if (!LANE_MODES.includes(out.lanes)) out.lanes = DEFAULTS.lanes;
    if (!SECONDS_CHOICES.includes(out.seconds)) out.seconds = DEFAULTS.seconds;
    return out;
  } catch (e) { return { ...DEFAULTS }; }
}
function saveView(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) {} }

let _trace = null;          // one live trace at a time — a re-render replaces it

const BTN = (on) => `background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};` +
  `color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};border-radius:5px;font-family:'JetBrains Mono',monospace;` +
  `font-size:calc(10px*var(--ui));font-weight:700;letter-spacing:.5px;min-height:calc(28px*var(--ui));padding:4px 9px;cursor:pointer`;

export function renderVocalsDisplay() {
  const el = document.getElementById('vocals-display');
  if (!el) return null;

  // Idempotent: switching instruments away and back (or any repeat call) tears the
  // previous trace down first, so only one rAF loop and one event listener exist.
  if (_trace) { try { _trace.destroy(); } catch (e) {} _trace = null; }

  const view = loadView();

  // .rk carries the kit tokens. The voice bar lives in the header, not in a
  // pedal card, so there is no accent to inherit — it lands on :root's neutral
  // steel, which is the point: the instrument surface belongs to no one pedal.
  // flex-direction is pinned because .rk otherwise stacks its children.
  el.innerHTML = `
    <div id="voc-bar" class="rk" style="display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px;padding:0 2px 2px">
      <span class="mono" style="font-size:calc(9px*var(--ui));letter-spacing:1.2px;color:var(--rk-ink-mute)">🎤 VOICE</span>
      <div id="voc-lanes" style="display:flex;gap:4px">
        ${LANE_MODES.map(m => `<button class="voc-lane-btn" id="voc-lane-${m}" data-lanes="${m}" style="${BTN(view.lanes === m)}">${LANE_MODE_LABELS[m]}</button>`).join('')}
      </div>
      <span style="width:1px;height:16px;background:var(--rk-edge-soft)"></span>
      <div id="voc-toggles" style="display:flex;gap:4px">
        <button class="voc-toggle" id="voc-t-ball"     data-opt="ball"     style="${BTN(view.ball)}">● Ball</button>
        <button class="voc-toggle" id="voc-t-trail"    data-opt="trail"    style="${BTN(view.trail)}">∿ Trail</button>
        <button class="voc-toggle" id="voc-t-notation" data-opt="notation" style="${BTN(view.notation)}">𝄞 Notation</button>
      </div>
      <span style="width:1px;height:16px;background:var(--rk-edge-soft)"></span>
      <select id="voc-seconds" class="mono" style="background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:5px;font-size:calc(10px*var(--ui));font-weight:700;padding:4px 6px;cursor:pointer;outline:none">
        ${SECONDS_CHOICES.map(s => `<option value="${s}" ${s === view.seconds ? 'selected' : ''}>${s}s window</option>`).join('')}
      </select>
      <span class="mono" id="voc-legend" style="margin-left:auto;font-size:calc(8px*var(--ui));color:var(--rk-ink-mute);letter-spacing:.4px">
        lanes = notes of the key · ghosted band = what to sing · ring green when you're on it
      </span>
    </div>
    <div id="voc-trace" style="width:100%"></div>`;

  const mount = document.getElementById('voc-trace');
  const built = createPitchTrace(mount, {
    lanes: view.lanes, ball: view.ball, trail: view.trail,
    notation: view.notation, seconds: view.seconds, height: 230,
    onDestroy: () => { if (_trace === built) _trace = null; }   // lets the observer remount
  });
  _trace = built;

  el.querySelectorAll('.voc-lane-btn').forEach(b => {
    b.addEventListener('click', () => {
      view.lanes = b.dataset.lanes;
      saveView(view);
      _trace?.setLanes(view.lanes);
      el.querySelectorAll('.voc-lane-btn').forEach(x => { x.style.cssText = BTN(x.dataset.lanes === view.lanes); });
      _trace?.render();
    });
  });

  el.querySelectorAll('.voc-toggle').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.opt;
      view[k] = !view[k];
      saveView(view);
      _trace?.setOption(k, view[k]);
      b.style.cssText = BTN(view[k]);
      _trace?.render();
    });
  });

  document.getElementById('voc-seconds')?.addEventListener('change', e => {
    view.seconds = parseInt(e.target.value, 10) || DEFAULTS.seconds;
    saveView(view);
    _trace?.setOption('seconds', view.seconds);
  });

  return _trace;
}

export function destroyVocalsDisplay() {
  if (_trace) { try { _trace.destroy(); } catch (e) {} _trace = null; }
}

// ── Self-mounting ─────────────────────────────────────────────────────
// main.js imports renderVocalsDisplay but nothing calls it — the vocals branch of
// buildInstrumentView() only un-hides #vocals-display. Rather than reach into other
// modules, watch that element's own visibility: buildInstrumentView() toggles its
// inline `display`, so a style-attribute observer is the exact signal for "the user
// switched to vocals". Guarded so an explicit call from elsewhere stays harmless.
function mountWhenVisible(el) {
  const check = () => {
    const shown = el.style.display !== 'none' && el.getClientRects().length > 0;
    if (shown && !_trace) renderVocalsDisplay();
  };
  new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  check();
}

function waitForDisplay() {
  const found = document.getElementById('vocals-display');
  if (found) { mountWhenVisible(found); return; }
  // #vocals-display is created by renderHeader() well after this module is imported.
  const mo = new MutationObserver(() => {
    const el = document.getElementById('vocals-display');
    if (el) { mo.disconnect(); mountWhenVisible(el); }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForDisplay, { once: true });
  else waitForDisplay();
}
