import { showIntervals, showNoteMap, liveAudioEnabled, fretboardView, setShowIntervals, setShowNoteMap, setLiveAudioEnabled, setFretboardView, clearChordHighlight } from '../core/state.js';
import { currentInstrument, setCurrentInstrument, INSTRUMENTS, customTuning, applyTuning, TUNING_PRESETS } from '../core/tuning.js';
import { audio } from '../core/audio.js';
import { buildInstrumentView, buildTuningBar, updateOverlays, setLastClickedNote } from './fretboard.js';

// ── Render header ────────────────────────────────────────────────────
export function renderHeader({ onSave, onCatalog, onHelp, onModeSwitch }) {
  const el = document.getElementById('header');
  if (!el) return;
  el.innerHTML = `
    <div class="header-logo">
      <span style="font-size:22px">🎵</span>
      <div>
        <div class="header-logo-title">RESONOTE</div>
        <div class="mono header-logo-sub">MUSIC THEORY &amp; PRAXIS</div>
      </div>
    </div>
    <div class="header-actions">
      <button id="btn-mode-practice" class="mono btn active-green" style="font-size:10px;letter-spacing:1px">PRACTICE</button>
      <button id="btn-mode-studio"   class="mono btn"              style="font-size:10px;letter-spacing:1px">STUDIO</button>
      <span class="header-divider"></span>
      <button id="btn-help"    class="mono btn" style="font-size:13px;font-weight:700">?</button>
      <button id="btn-save"    class="mono btn"><span style="font-size:12px">💾</span> SAVE</button>
      <button id="btn-catalog" class="mono btn"><span style="font-size:14px">+</span> PEDALS</button>
    </div>`;

  document.getElementById('btn-save')   ?.addEventListener('click', onSave);
  document.getElementById('btn-catalog')?.addEventListener('click', onCatalog);
  document.getElementById('btn-help')   ?.addEventListener('click', onHelp);
  document.getElementById('btn-mode-practice')?.addEventListener('click', () => onModeSwitch('practice'));
  document.getElementById('btn-mode-studio')  ?.addEventListener('click', () => onModeSwitch('studio'));
}

// ── Render instrument bar ────────────────────────────────────────────
export function renderInstrumentBar(onInstrumentChange) {
  const el = document.getElementById('instrument-bar');
  if (!el) return;

  const instruments = [
    { id:'guitar6',  label:'GUITAR'   },
    { id:'guitar8',  label:'8-STR'    },
    { id:'bass4',    label:'BASS'     },
    { id:'banjo5',   label:'BANJO'    },
    { id:'mandolin', label:'MANDOLIN' },
    { id:'piano',    label:'PIANO'    },
    { id:'vocals',   label:'🎤 VOCALS' }
  ];

  const displayBtns = [
    { id:'btn-intervals', label:'♮ NOTES' },
    { id:'btn-notemap',   label:'🗺 MAP'   },
    { id:'btn-live',      label:'🎤 LIVE'  },
    { id:'btn-clear-display', label:'✕ CLEAR' }
  ];
  const FB_VIEWS = [['standard','● Standard'],['function','🎨 Function'],['tension','🌡 Tension'],['chordtone','🎯 Chord Tones'],['interval','📏 Intervals'],['voice','🪢 Voice Leading']];

  let html = `<span class="mono" style="color:#555;font-size:9px;letter-spacing:1px;margin-right:6px">INSTRUMENT</span>`;
  instruments.forEach(inst => {
    const active = currentInstrument === inst.id;
    html += `<button class="inst-btn mono ${active ? 'active' : ''}" data-inst="${inst.id}">${inst.label}</button>`;
  });

  html += `<span style="width:1px;height:18px;background:#333;margin:0 6px"></span>`;
  html += `<span class="mono" style="color:#555;font-size:9px;letter-spacing:1px;margin-right:4px">DISPLAY</span>`;
  html += `<select id="fb-view" class="mono" title="Fretboard view — how theory is drawn on the neck" style="background:#11181a;border:1px solid #3a4a48;color:#9fdcd0;border-radius:6px;padding:4px 6px;font-size:10px;cursor:pointer;outline:none">`;
  FB_VIEWS.forEach(([v, l]) => html += `<option value="${v}" ${fretboardView === v ? 'selected' : ''}>${l}</option>`);
  html += `</select>`;
  displayBtns.forEach(b => {
    html += `<button id="${b.id}" class="mono btn" style="font-size:10px">${b.label}</button>`;
  });

  el.innerHTML = html;

  // Instrument switching
  el.querySelectorAll('.inst-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.inst;
      setCurrentInstrument(id);
      el.querySelectorAll('.inst-btn').forEach(b => b.classList.toggle('active', b.dataset.inst === id));
      // Reset to instrument default tuning
      const inst = INSTRUMENTS[id];
      if (inst.strings?.length) applyTuning(inst.strings);
      buildInstrumentView();
      buildTuningBar();
      updateOverlays();
      if (onInstrumentChange) onInstrumentChange(id);
    });
  });

  // Display buttons
  document.getElementById('btn-intervals')?.addEventListener('click', () => {
    setShowIntervals(!showIntervals);
    updateIntervalBtn();
    updateOverlays();
  });
  document.getElementById('fb-view')?.addEventListener('change', e => {
    setFretboardView(e.target.value);
    window.dispatchEvent(new CustomEvent('resonote:fbview', { detail: { view: e.target.value } }));
    updateOverlays();
  });
  document.getElementById('btn-notemap')?.addEventListener('click', () => {
    setShowNoteMap(!showNoteMap);
    updateNoteMapBtn();
    updateOverlays();
  });
  document.getElementById('btn-live')?.addEventListener('click', () => {
    setLiveAudioEnabled(!liveAudioEnabled);
    if (liveAudioEnabled && !audio.connected) audio.connect(audio.selectedDeviceId);
    updateLiveBtn();
  });
  document.getElementById('btn-clear-display')?.addEventListener('click', () => {
    clearChordHighlight();
    setLastClickedNote(null);
    updateOverlays();
  });
}

// ── Render instrument display container ──────────────────────────────
export function renderInstrumentDisplay() {
  const el = document.getElementById('instrument-display');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-outer">
      <div id="tuning-bar" style="display:flex;align-items:center;gap:8px;padding:0 8px 4px">
        <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px">TUNING</span>
        <select id="tuning-preset" class="tuning-combo"></select>
        <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px;margin-left:8px">STYLE</span>
        <select id="fb-theme" class="tuning-combo"></select>
      </div>
      <div id="position-bar" style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:2px 8px 6px"></div>
      <div id="fb-rel" style="position:relative">
        <svg id="fb-svg" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg"></svg>
        <div id="tuning-ov" style="position:absolute;top:0;left:0;height:100%;pointer-events:none;z-index:10"></div>
      </div>
      <div id="note-readout" style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:16px;min-height:28px;padding:0 8px">
        <span class="mono" style="color:#333;font-size:11px">Play a note to see it on the fretboard...</span>
      </div>
    </div>
    <div id="vocals-display" style="display:none"></div>`;
}

// ── Display button state sync ─────────────────────────────────────────
export function updateIntervalBtn() {
  const btn = document.getElementById('btn-intervals');
  if (!btn) return;
  btn.textContent = showIntervals ? '⟡ INTERVALS' : '♮ NOTES';
  btn.style.background  = showIntervals ? 'rgba(180,120,255,.25)' : 'rgba(180,120,255,.1)';
  btn.style.borderColor = showIntervals ? '#b478ff' : '#9966cc';
  btn.style.color       = showIntervals ? '#d4a8ff' : '#b478ff';
}

export function updateNoteMapBtn() {
  const btn = document.getElementById('btn-notemap');
  if (!btn) return;
  btn.style.background  = showNoteMap ? 'rgba(100,180,100,.2)' : 'rgba(255,255,255,.04)';
  btn.style.borderColor = showNoteMap ? '#66aa66' : '#444';
  btn.style.color       = showNoteMap ? '#88cc88' : '#888';
}

export function updateLiveBtn() {
  const btn = document.getElementById('btn-live');
  if (!btn) return;
  btn.style.background  = liveAudioEnabled ? 'rgba(255,68,102,.2)' : 'rgba(255,255,255,.04)';
  btn.style.borderColor = liveAudioEnabled ? '#ff4466' : '#444';
  btn.style.color       = liveAudioEnabled ? '#ff6688' : '#888';
}

// ── Catalog drawer ────────────────────────────────────────────────────
function darkenHex(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, (n>>16) - amt);
  const g = Math.max(0, ((n>>8)&0xff) - amt);
  const b = Math.max(0, (n&0xff) - amt);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function catalogSection(label, color, items) {
  let h = `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px">
    <span class="mono" style="color:${color};font-size:9px;font-weight:700;letter-spacing:1px">${label}</span>
    <div style="flex:1;height:1px;background:${color}33"></div>
  </div>`;
  items.forEach(item => {
    const bg   = item.color  || '#1a1a1a';
    const acc  = item.accent || '#444';
    const dark = darkenHex(bg, 15);
    h += `
      <div class="catalog-item" data-type="${item.type}"
           style="background:linear-gradient(135deg,${bg},${dark});border:1px solid ${acc}33;border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all .2s">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:16px">${item.icon}</span>
          <span class="mono" style="color:${acc};font-size:11px;font-weight:700">${item.title}</span>
        </div>
        <div style="color:#888;font-size:9px;line-height:1.4;margin-bottom:6px">${item.desc}</div>
        <div style="display:flex;justify-content:flex-end">
          <button class="catalog-add-btn" data-type="${item.type}"
                  style="background:${acc}22;border:1px solid ${acc}44;color:${acc};border-radius:6px;padding:2px 8px;font-size:8px;font-weight:700;letter-spacing:1px;font-family:'JetBrains Mono',monospace;cursor:pointer">+ ADD</button>
        </div>
      </div>`;
  });
  return h;
}

export function renderCatalog(catalog, onAdd) {
  const el = document.getElementById('catalog-drawer');
  if (!el) return;

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="mono" style="color:#aaa;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Pedal Shop</span>
      <button id="btn-close-catalog" style="background:none;border:none;color:#666;cursor:pointer;font-size:18px">✕</button>
    </div>`;

  // studioOnly pedals (Amp/Looper/Vocals) live in the Studio workspace, not the main shop.
  const shop = catalog.filter(c => !c.studioOnly);
  html += catalogSection('REFERENCE &amp; THEORY', '#888',     shop.filter(c => c.tier === 'free'));
  html += catalogSection('GUIDED PRACTICE',         '#ef9f27', shop.filter(c => c.tier === 'pro'));
  html += catalogSection('STUDIO',                  '#9977ee', shop.filter(c => c.tier === 'studio'));

  el.innerHTML = html;

  document.getElementById('btn-close-catalog')?.addEventListener('click', () => {
    el.classList.remove('open');
  });

  el.querySelectorAll('.catalog-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (onAdd) onAdd(btn.dataset.type);
    });
  });
}

// ── Help overlay ──────────────────────────────────────────────────────
export function renderHelp() {
  const el = document.getElementById('help-overlay');
  if (!el) return;
  el.innerHTML = `
    <div style="max-width:540px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <div style="color:#eee;font-size:20px;font-weight:700;letter-spacing:1px">Welcome to Resonote</div>
          <div class="mono" style="color:#666;font-size:10px;letter-spacing:2px;margin-top:2px">MUSIC THEORY & PRAXIS v2.0</div>
        </div>
        <button id="btn-close-help" class="btn" style="width:32px;height:32px;padding:0;font-size:16px">✕</button>
      </div>
      <div style="color:#bbb;font-size:13px;line-height:1.8;margin-bottom:20px">
        Resonote is your interactive music theory companion. Explore chords, scales, arpeggios, and keys visually on the fretboard — or sing along with Vocals mode.
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:rgba(255,255,255,.04);border:1px solid #333;border-radius:10px;padding:14px">
          <div class="mono" style="color:#ccc;font-size:11px;font-weight:700;margin-bottom:8px;letter-spacing:1px">INSTRUMENTS</div>
          <div style="color:#999;font-size:12px;line-height:1.7">
            <div style="margin-bottom:4px"><span style="color:#00ccff;font-weight:700">GUITAR / 8-STR / BASS / BANJO / MANDOLIN / PIANO</span> — Switch instruments and tuning in the top bar</div>
            <div><span style="color:#aa88ff;font-weight:700">🎤 VOCALS</span> — Pitch detection and harmony analysis for singers, with vocal range visualization</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid #333;border-radius:10px;padding:14px">
          <div class="mono" style="color:#ccc;font-size:11px;font-weight:700;margin-bottom:8px;letter-spacing:1px">DISPLAY BAR</div>
          <div style="color:#999;font-size:12px;line-height:1.7">
            <div style="margin-bottom:4px"><span style="color:#b478ff;font-weight:700">♮ NOTES / ⟡ INTERVALS</span> — Toggle between note names and interval labels (R, ♭3, 5…)</div>
            <div style="margin-bottom:4px"><span style="color:#88cc88;font-weight:700">🗺 MAP</span> — Show all note names on every fret as a reference</div>
            <div><span style="color:#ff6688;font-weight:700">🎤 LIVE</span> — Passive audio detection — play a note and see it light up in real time</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid #333;border-radius:10px;padding:14px">
          <div class="mono" style="color:#ccc;font-size:11px;font-weight:700;margin-bottom:8px;letter-spacing:1px">PEDALS</div>
          <div style="color:#999;font-size:12px;line-height:1.7">
            Pedals are your tools. <span style="color:#ccc">Drag</span> by the header. <span style="color:#ccc">Resize</span> from the corner. <span style="color:#ccc">▁ Minimize</span> to collapse. Add more from <span style="color:#ccc">+ PEDALS</span>.
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-close-help')?.addEventListener('click', () => {
    el.classList.remove('open');
  });
}
