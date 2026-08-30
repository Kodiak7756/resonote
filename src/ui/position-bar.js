// ── Fretboard hand-position bar ──────────────────────────────────────
// Controls the position-isolation "lens" over the all-notes view: a movable
// fret window, quick fret presets, key-aware scale-box (CAGED) positions, and
// a click-to-build custom shape. Dims (never hides) notes outside the window.
import { positionBus, positionIsolation, pedalBus, keyTypeToScale,
         setShowNoteMap, showNoteMap } from '../core/state.js';
import { KEY_PATTERNS } from '../core/music-theory.js';
import { findScaleBoxes } from '../core/voicings.js';
import { updateOverlays } from './fretboard.js';
import { updateNoteMapBtn } from './header.js';

const ACC = '#5ad1c0';
let activeBoxIdx = null;

// fretboard click dispatch (main.js) checks these while defining a custom shape
export function isDefining() { return !!positionIsolation.defining; }
export function addShapeFret(si, fret) { positionBus.addShapeFret(si, fret); }

const QUICK = [
  { label: 'Open', lo: 0, hi: 3 }, { label: '5', lo: 5, hi: 8 },
  { label: '7', lo: 7, hi: 10 }, { label: '9', lo: 9, hi: 12 }, { label: '12', lo: 12, hi: 15 }
];

function ensureNoteMap() { if (!showNoteMap) { setShowNoteMap(true); updateNoteMapBtn(); } }

function keyBoxes() {
  const root = pedalBus.root || 'C';
  const kt = pedalBus.keyType || 'Major';
  const pat = KEY_PATTERNS[kt] || KEY_PATTERNS['Major'];
  try { return findScaleBoxes(root, pat.intervals, keyTypeToScale(kt)) || []; } catch (e) { return []; }
}

export function buildPositionBar() {
  const el = document.getElementById('position-bar');
  if (!el) return;
  render(el);
  positionBus.on(() => { render(el); updateOverlays(); });
  // a key-box preset slides when the master key changes
  pedalBus.on(() => {
    if (activeBoxIdx != null && positionIsolation.active && positionIsolation.selectedPreset === 'box-' + activeBoxIdx) {
      const b = keyBoxes()[activeBoxIdx];
      if (b) positionBus.set(b.lo, b.hi, { selectedPreset: 'box-' + activeBoxIdx });
    } else { render(el); }
  });
}

function chip(label, on, attrs = '') {
  return `<button ${attrs} style="border:1px solid ${on ? ACC : '#3a3a3a'};color:${on ? ACC : '#9aacac'};background:${on ? ACC + '22' : 'rgba(255,255,255,.02)'};border-radius:5px;padding:3px 8px;cursor:pointer;font-size:calc(9px*var(--ui));font-family:'JetBrains Mono',monospace;font-weight:600">${label}</button>`;
}
function step(label, attrs) {
  return `<button ${attrs} style="border:1px solid #3a3a3a;color:#cdd;background:rgba(255,255,255,.03);border-radius:4px;padding:2px 7px;cursor:pointer;font-size:calc(11px*var(--ui));line-height:1">${label}</button>`;
}
const lbl = t => `<span class="mono" style="color:#5b6b6b;font-size:calc(8px*var(--ui));letter-spacing:1px;margin-left:6px">${t}</span>`;

function render(el) {
  const p = positionIsolation;
  let h = `<span class="mono" style="color:#5b6b6b;font-size:calc(8px*var(--ui));letter-spacing:1px">POSITION</span>`;
  h += chip('All notes', !p.active, 'data-act="all"');

  if (p.defining) {
    const n = (p.customShape || []).length;
    h += `<span style="color:${ACC};font-size:calc(10px*var(--ui));margin-left:6px">✏ Tap frets on the neck to build a shape — ${n} note${n === 1 ? '' : 's'}</span>`;
    h += chip('Clear', false, 'data-act="clearshape"');
    h += chip('Done', false, 'data-act="done"');
  } else {
    h += lbl('WINDOW');
    h += step('◂', 'data-act="slide-"');
    const showWin = p.active && p.selectedPreset !== 'custom';
    h += `<span class="mono" style="color:${showWin ? '#cdd' : '#556'};font-size:calc(10px*var(--ui));min-width:34px;text-align:center">${showWin ? p.loFret + '–' + p.hiFret : '— —'}</span>`;
    h += step('▸', 'data-act="slide+"');

    h += lbl('AT FRET');
    QUICK.forEach((q, i) => { h += chip(q.label, p.active && p.selectedPreset === 'quick-' + i, `data-quick="${i}"`); });

    h += lbl('KEY BOX');
    for (let i = 0; i < 5; i++) h += chip(String(i + 1), p.active && p.selectedPreset === 'box-' + i, `data-box="${i}"`);

    h += `<span style="margin-left:8px"></span>`;
    h += chip('✏ Define shape', p.selectedPreset === 'custom' && p.active, 'data-act="define"');
  }
  el.innerHTML = h;
  wire(el);
}

function slideWindow(d) {
  ensureNoteMap(); activeBoxIdx = null;
  const p = positionIsolation;
  let lo = p.active ? p.loFret : 5, hi = p.active ? p.hiFret : 8;
  const span = Math.max(2, hi - lo);
  lo = Math.max(0, Math.min(24 - span, lo + d)); hi = lo + span;
  positionBus.set(lo, hi, { selectedPreset: 'window' });
}

function wire(el) {
  el.querySelector('[data-act="all"]')?.addEventListener('click', () => { activeBoxIdx = null; positionBus.clear(); });
  el.querySelector('[data-act="define"]')?.addEventListener('click', () => { ensureNoteMap(); positionBus.setDefining(true); });
  el.querySelector('[data-act="done"]')?.addEventListener('click', () => positionBus.setDefining(false));
  el.querySelector('[data-act="clearshape"]')?.addEventListener('click', () => { activeBoxIdx = null; positionBus.update({ customShape: [], active: false, selectedPreset: null }); });
  el.querySelector('[data-act="slide-"]')?.addEventListener('click', () => slideWindow(-1));
  el.querySelector('[data-act="slide+"]')?.addEventListener('click', () => slideWindow(+1));
  el.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
    ensureNoteMap(); activeBoxIdx = null; const q = QUICK[+b.dataset.quick];
    positionBus.set(q.lo, q.hi, { selectedPreset: 'quick-' + b.dataset.quick });
  }));
  el.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => {
    ensureNoteMap(); const i = +b.dataset.box; const box = keyBoxes()[i];
    if (box) { activeBoxIdx = i; positionBus.set(box.lo, box.hi, { selectedPreset: 'box-' + i }); }
  }));
}
