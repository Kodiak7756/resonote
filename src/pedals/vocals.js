import { audio } from '../core/audio.js';
import { NOTES } from '../core/music-theory.js';

const CHROMATIC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const LOW_OCTAVE  = 2;
const HIGH_OCTAVE = 6;
const TOTAL_NOTES = (HIGH_OCTAVE - LOW_OCTAVE + 1) * 12;

function noteToIndex(note, octave) {
  const ni = CHROMATIC.indexOf(note);
  if (ni < 0) return -1;
  return (octave - LOW_OCTAVE) * 12 + ni;
}

export function renderVocalsDisplay() {
  const el = document.getElementById('vocals-display');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:0 4px">
      <span class="mono vocals-range-label">C${LOW_OCTAVE}</span>
      <div class="vocals-pitch-bar" style="flex:1">
        <div id="voc-bar-bg"></div>
        <div id="voc-needle" class="vocals-pitch-needle" style="display:none;left:50%"></div>
      </div>
      <span class="mono vocals-range-label">C${HIGH_OCTAVE}</span>
    </div>
    <div style="display:flex;justify-content:center;align-items:baseline;gap:12px">
      <span id="voc-note" class="mono" style="font-size:36px;font-weight:900;color:#333;line-height:1">—</span>
      <div style="display:flex;flex-direction:column;gap:2px">
        <span id="voc-freq" class="mono" style="color:#555;font-size:10px">— Hz</span>
        <span id="voc-cents" class="mono" style="color:#555;font-size:10px;font-weight:700">—¢</span>
      </div>
    </div>
    <div id="voc-range-bar" style="display:flex;gap:2px;align-items:flex-end;padding:0 4px;height:24px"></div>`;

  buildRangeBar();

  function buildRangeBar() {
    const bar = document.getElementById('voc-range-bar');
    if (!bar) return;
    bar.innerHTML = '';
    for (let i = 0; i < TOTAL_NOTES; i++) {
      const div = document.createElement('div');
      div.id = `voc-cell-${i}`;
      div.style.cssText = `flex:1;height:${i % 12 === 0 ? '16px' : '8px'};background:#1a1a2a;border-radius:1px;transition:background .05s`;
      bar.appendChild(div);
    }
  }

  const upd = () => {
    const det = audio.detected;
    const inTune = det && Math.abs(det.cents) < 10;
    const cc = !det ? '#555' : inTune ? '#aa88ff' : Math.abs(det.cents) < 25 ? '#dd8844' : '#ff4466';

    const noteEl  = document.getElementById('voc-note');
    const freqEl  = document.getElementById('voc-freq');
    const centsEl = document.getElementById('voc-cents');
    const needle  = document.getElementById('voc-needle');

    if (noteEl) {
      noteEl.textContent  = det ? det.note : '—';
      noteEl.style.color  = det ? cc : '#333';
      noteEl.style.textShadow = det ? `0 0 30px ${cc}66` : 'none';
    }
    if (freqEl)  freqEl.textContent  = det ? `${det.freq.toFixed(1)} Hz` : '— Hz';
    if (centsEl) {
      const c = det?.cents || 0;
      centsEl.textContent = det ? `${c > 0 ? '+' : ''}${c}¢` : '—¢';
      centsEl.style.color = cc;
    }

    if (needle) {
      if (det) {
        const idx = noteToIndex(det.note, det.octave);
        if (idx >= 0) {
          needle.style.display = 'block';
          needle.style.left    = `${(idx / (TOTAL_NOTES - 1)) * 100}%`;
          needle.style.background   = cc;
          needle.style.boxShadow    = `0 0 10px ${cc}88`;
        }
      } else {
        needle.style.display = 'none';
      }
    }

    for (let i = 0; i < TOTAL_NOTES; i++) {
      const cell = document.getElementById(`voc-cell-${i}`);
      if (!cell) continue;
      if (det && noteToIndex(det.note, det.octave) === i) {
        cell.style.background = cc;
        cell.style.height = '24px';
      } else {
        cell.style.background = i % 12 === 0 ? '#2a2a3a' : '#1a1a2a';
        cell.style.height = i % 12 === 0 ? '16px' : '8px';
      }
    }
  };

  audio.on(upd);
  upd();
}
