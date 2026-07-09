import { pedalBus, metroClock } from '../core/state.js';

// ── Pedal drag / resize / z-order system ────────────────────────────

let topZ = 20;

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
  return `<button class="link-chip" data-link="${kind}" title="${on ? 'Following master ' + label + ' — click to unlink' : 'Click to link to master ' + label}" style="background:${on ? 'rgba(90,209,192,.2)' : 'rgba(255,255,255,.04)'};border:1px solid ${on ? '#5ad1c0' : '#444'};color:${on ? '#5ad1c0' : '#888'};border-radius:4px;padding:0 4px;height:16px;font-size:9px;cursor:pointer;line-height:14px;opacity:${on ? 1 : .65}">${icon}</button>`;
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
    e.preventDefault();
    bringToFront(el);

    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;

    function onMouseMove(e) {
      const x = Math.max(0, e.clientX - startX);
      const y = Math.max(0, e.clientY - startY);
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
    bringToFront(el);
    const t = e.touches[0];
    const startX = t.clientX - el.offsetLeft;
    const startY = t.clientY - el.offsetTop;

    function onTouchMove(e) {
      const t = e.touches[0];
      const x = Math.max(0, t.clientX - startX);
      const y = Math.max(0, t.clientY - startY);
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

// ── Colour helpers ───────────────────────────────────────────────────
function darken(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, (n>>16) - amt);
  const g = Math.max(0, ((n>>8)&0xff) - amt);
  const b = Math.max(0, (n&0xff) - amt);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ── Pedal card builder ────────────────────────────────────────────────
export function createPedalElement(p, catalogEntry, onClose, onMinimize, onMove, onResize) {
  const el = document.createElement('div');
  el.className = 'pedal-card';
  el.id = `pedal-${p.id}`;

  const color  = catalogEntry?.color  || '#141414';
  const accent = catalogEntry?.accent || '#3a3a3a';

  el.style.cssText = [
    `left:${p.x}px`, `top:${p.y}px`, `width:${p.w}px`,
    p.h ? `height:${p.h}px` : '',
    `z-index:${topZ++}`,
    `background:linear-gradient(145deg,${color},${darken(color,30)})`,
    `border:2px solid ${accent}`,
    `box-shadow:0 6px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08),0 0 15px ${accent}33`
  ].filter(Boolean).join(';') + ';';

  el.style.setProperty('--hover-accent', accent);
  if (p.minimized) el.classList.add('minimized');

  el.innerHTML = `
    <div class="pedal-header" style="border-bottom:1px solid ${accent}44">
      <span class="pedal-title" style="color:${accent}">
        <span style="font-size:14px">${catalogEntry?.icon || ''}</span>
        ${catalogEntry?.title || p.type.toUpperCase()}
      </span>
      <div class="pedal-controls">
        <span class="pedal-links" style="display:inline-flex;gap:3px;margin-right:5px"></span>
        ${catalogEntry?.tier === 'pro'   ? '<span class="pro-badge">PRO</span>' : ''}
        ${catalogEntry?.tier === 'studio'? '<span class="pro-badge" style="background:rgba(100,150,255,.12);border-color:rgba(100,150,255,.25);color:#6699ff">STUDIO</span>' : ''}
        <button class="pedal-btn minimize-btn" title="Minimize">▁</button>
        <button class="pedal-btn close-btn" title="Close">✕</button>
      </div>
    </div>
    <div class="pedal-body" id="body-${p.id}"></div>
    <div class="pedal-resize">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M9 1L1 9M9 5L5 9M9 8L8 9" stroke="${accent}" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
      </svg>
    </div>
    <div style="position:absolute;top:10px;left:-1px;width:6px;height:6px;border-radius:50%;background:${accent};box-shadow:0 0 8px ${accent}"></div>
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
    if (onMinimize) onMinimize(p.id, isMin);
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
      <span class="mono" style="color:#999;font-size:9px;text-transform:uppercase;letter-spacing:1px">${label}</span>
      <span class="mono" style="color:${color};font-size:11px;font-weight:700">${val}</span>
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
