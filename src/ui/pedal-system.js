import { pedalBus, metroClock } from '../core/state.js';

// ── Pedal drag / resize / z-order system ────────────────────────────

let topZ = 20;

// Pedals live on a fixed viewport layer, so they can be parked anywhere on
// screen — including over the fretboard, which is the point: a reference you
// can read without looking away from the neck. Only guard against dragging a
// pedal so far out that its header (the grab handle) is unreachable.
function clampToViewport(x, y, el) {
  const w = el.offsetWidth || 200, vw = window.innerWidth, vh = window.innerHeight;
  return [
    Math.max(40 - w, Math.min(x, vw - 60)),
    Math.max(0, Math.min(y, vh - 34)),
  ];
}

// ── Master-link chips ────────────────────────────────────────────────
// Which masters each pedal TYPE can opt into following (the Circle of Fifths
// owns Key and the Metronome owns Tempo, so they get no chip themselves).
export const LINK_PROFILE = {
  chords:{key:1}, scales:{key:1}, arpeggios:{key:1},
  progression:{key:1,tempo:1}, runner:{key:1,tempo:1}, rhythm:{key:1,tempo:1}, finger:{key:1,tempo:1},
  beatmaker:{tempo:1}, technique:{tempo:1}, looper:{tempo:1}, tab:{key:1,tempo:1}, practice:{tempo:1},
  notequiz:{key:1}, ear:{key:1}, chordlab:{key:1}, melody:{key:1}, theory:{key:1}, songdir:{key:1},
  workshop:{key:1,tempo:1}
};

function linkChipHTML(kind, type) {
  const bus = kind === 'key' ? pedalBus : metroClock;
  const on = bus.isLinked(type);
  const icon = kind === 'key' ? '🔑' : '⏱';
  const label = kind === 'key' ? 'Key' : 'Tempo';
  // Linked chips wear the HOST pedal's accent, not a colour of their own — a
  // link is a property of this pedal, so it should look like this pedal.
  return `<button class="link-chip${on ? ' is-linked' : ''}" data-link="${kind}" title="${on ? 'Following master ' + label + ' — click to unlink' : 'Click to link to master ' + label}">${icon}</button>`;
}
function linksHTML(type) {
  const pr = LINK_PROFILE[type]; if (!pr) return '';
  return (pr.key ? linkChipHTML('key', type) : '') + (pr.tempo ? linkChipHTML('tempo', type) : '');
}
function wireLinks(el, type) {
  const span = el.querySelector('.pedal-links'); if (!span) return;
  span.innerHTML = linksHTML(type);
  span.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const kind = b.dataset.link, bus = kind === 'key' ? pedalBus : metroClock;
    if (bus.isLinked(type)) bus.unlinkPedal(type); else bus.linkPedal(type);
    wireLinks(el, type);
  }));
}

export function bringToFront(el) {
  topZ++;
  el.style.zIndex = topZ;
}

export function makeDraggable(el, onMove) {
  const header = el.querySelector('.pedal-header');
  if (!header) return;

  header.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (el.classList.contains('locked')) return;
    e.preventDefault();
    bringToFront(el);

    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;

    function onMouseMove(e) {
      const [x, y] = clampToViewport(e.clientX - startX, e.clientY - startY, el);
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
      if (onMove) onMove(x, y);
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  // Touch support
  header.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (el.classList.contains('locked')) return;
    bringToFront(el);
    const t = e.touches[0];
    const startX = t.clientX - el.offsetLeft;
    const startY = t.clientY - el.offsetTop;

    function onTouchMove(e) {
      const t = e.touches[0];
      const [x, y] = clampToViewport(t.clientX - startX, t.clientY - startY, el);
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
      if (onMove) onMove(x, y);
    }
    function onTouchEnd() {
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    }
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
  }, { passive: true });
}

export function makeResizable(el, onResize) {
  const handle = el.querySelector('.pedal-resize');
  if (!handle) return;

  handle.addEventListener('mousedown', e => {
    if (el.classList.contains('locked')) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = el.offsetWidth, startH = el.offsetHeight;

    function onMouseMove(e) {
      const w = Math.max(160, startW + (e.clientX - startX));
      const h = Math.max(60,  startH + (e.clientY - startY));
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
      if (onResize) onResize(w, h);
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// ── Pedal card builder ────────────────────────────────────────────────
export function createPedalElement(p, catalogEntry, onClose, onMinimize, onMove, onResize, onLock) {
  const el = document.createElement('div');
  el.className = 'pedal-card';
  el.id = `pedal-${p.id}`;

  const color  = catalogEntry?.color  || '#141414';
  const accent = catalogEntry?.accent || '#8fa8b4';
  const tier   = catalogEntry?.tier   || 'free';

  // Only geometry goes inline. The paint — chassis, border, the tier's edge
  // highlights — lives in kit.css, because an inline style beats a class and
  // the .tier-* finish has to be able to win.
  el.style.cssText = [
    `left:${p.x}px`, `top:${p.y}px`, `width:${p.w}px`,
    p.h ? `height:${p.h}px` : '',
    `z-index:${topZ++}`,
  ].filter(Boolean).join(';') + ';';

  // The one hand-off the whole colour system hangs on: this pedal's accent and
  // chassis, published as variables on the card. Everything inside — kit
  // components, the header, whatever a pedal draws — reads down from here, so
  // a pedal never has to name its own colour and two tabs cannot drift apart.
  el.style.setProperty('--rk-pedal-accent', accent);
  el.style.setProperty('--rk-accent',       accent);
  el.style.setProperty('--rk-chassis',      color);
  el.style.setProperty('--hover-accent',    accent);
  el.classList.add(`tier-${tier}`);
  if (p.minimized) el.classList.add('minimized');

  el.innerHTML = `
    <div class="pedal-header">
      <span class="pedal-title">
        <span style="font-size:calc(14px*var(--ui))">${catalogEntry?.icon || ''}</span>
        ${catalogEntry?.title || p.type.toUpperCase()}
      </span>
      <div class="pedal-controls">
        <span class="pedal-links" style="display:inline-flex;gap:3px;margin-right:5px"></span>
        ${catalogEntry?.tier === 'pro'   ? '<span class="tier-badge">PRO</span>' : ''}
        ${catalogEntry?.tier === 'studio'? '<span class="tier-badge">STUDIO</span>' : ''}
        <button class="pedal-btn lock-btn" title="${p.locked ? 'Unlock to move & resize' : 'Lock in place'}">${p.locked ? '🔒' : '🔓'}</button>
        <button class="pedal-btn minimize-btn" title="Minimize">▁</button>
        <button class="pedal-btn close-btn" title="Close">✕</button>
      </div>
    </div>
    <div class="pedal-body" id="body-${p.id}"></div>
    <div class="pedal-resize">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M9 1L1 9M9 5L5 9M9 8L8 9" style="stroke:var(--rk-accent)" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
      </svg>
    </div>
    <div style="position:absolute;top:10px;left:-1px;width:6px;height:6px;border-radius:50%;background:var(--rk-accent);box-shadow:0 0 8px var(--rk-accent)"></div>
  `;

  el.addEventListener('mousedown', () => bringToFront(el));

  el.querySelector('.close-btn').addEventListener('click', e => {
    e.stopPropagation();
    el.remove();
    if (onClose) onClose(p.id);
  });

  el.querySelector('.minimize-btn').addEventListener('click', e => {
    e.stopPropagation();
    const isMin = el.classList.toggle('minimized');
    // Drop the inline height while collapsed so the card really shrinks to its
    // header, and put the player's own size back when it reopens.
    el.style.height = isMin ? '' : (p.h ? p.h + 'px' : '');
    if (onMinimize) onMinimize(p.id, isMin);
  });

  // 🔒 Lock: park a pedal where you want it and it stops being draggable, so
  // reaching for a control never nudges the layout you settled on.
  const applyLock = () => {
    el.classList.toggle('locked', !!p.locked);
    const b = el.querySelector('.lock-btn');
    if (b) { b.textContent = p.locked ? '🔒' : '🔓'; b.title = p.locked ? 'Unlock to move & resize' : 'Lock in place'; }
  };
  applyLock();
  el.querySelector('.lock-btn').addEventListener('click', e => {
    e.stopPropagation();
    p.locked = !p.locked;
    applyLock();
    if (onLock) onLock(p.id, p.locked);
  });

  // Master-link chips: render now, and refresh when any link state changes
  // (e.g. a future "Re-link all" on the session bar).
  wireLinks(el, p.type);
  const refreshLinks = () => { if (document.body.contains(el)) wireLinks(el, p.type); };
  pedalBus.onLinks(refreshLinks);
  metroClock.onLinks(refreshLinks);

  makeDraggable(el, onMove ? (x, y) => onMove(p.id, x, y) : null);
  makeResizable(el, onResize ? (w, h) => onResize(p.id, w, h) : null);

  return el;
}

// ── Knob widget ───────────────────────────────────────────────────────
export function makeKnob(cid, val, min, max, label, color, onChange) {
  const el = document.getElementById(cid);
  if (!el) return;
  const ang = ((val - min) / (max - min)) * 270 - 135;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <div class="knob-dial" style="width:52px;height:52px;border-radius:50%;background:conic-gradient(from 200deg,#222,#444,#222);border:2px solid #555;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;position:relative">
        <div style="position:absolute;top:50%;left:50%;width:2px;height:20px;background:${color};border-radius:1px;transform-origin:top center;transform:translate(-50%,0) rotate(${ang}deg);box-shadow:0 0 6px ${color}88"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:#111;border:1px solid #333"></div>
      </div>
      <span class="mono" style="color:#999;font-size:calc(9px*var(--ui));text-transform:uppercase;letter-spacing:1px">${label}</span>
      <span class="mono" style="color:${color};font-size:calc(11px*var(--ui));font-weight:700">${val}</span>
    </div>`;
  const dial = el.querySelector('.knob-dial');
  dial.addEventListener('mousedown', e => {
    e.stopPropagation();
    let active = true, sY = e.clientY, sV = val;
    const mv = ev => {
      if (!active) return;
      onChange(Math.round(Math.min(max, Math.max(min, sV + ((sY - ev.clientY) / 150) * (max - min)))));
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', function u() {
      active = false;
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', u);
    });
  });
}
