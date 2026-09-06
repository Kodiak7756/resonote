import { showIntervals, showNoteMap, fretboardView, setShowIntervals, setShowNoteMap, setFretboardView, clearChordHighlight, loadState } from '../core/state.js';
import { setBoardRenderH, persistBoardRenderH } from './fretboard.js';
import { currentInstrument, setCurrentInstrument, INSTRUMENTS, customTuning, applyTuning, TUNING_PRESETS, HEX_LAYOUTS, hexLayout, setHexLayout } from '../core/tuning.js';
import { buildInstrumentView, buildTuningBar, updateOverlays, setLastClickedNote, FRETBOARD_THEMES, currentTheme, setCurrentTheme, INST_DEFAULT_THEME, mapScope, setMapScope } from './fretboard.js';
import { CATALOG } from '../pedals/index.js';
import { TOURS, coachDone } from './coach.js';
import { NOTES } from '../core/music-theory.js';
import { pcColor } from '../core/colors.js';
import { getLook, saveLook, clearLook, hasLook, lookFromTheme, restain, INLAY_SHAPES } from '../core/looks.js';
import { BUSES, BUS_LABEL, BUS_HINT, getMix, setLevel, setMute, onMix, anyMuted, allSilent } from '../core/mixer.js';

// 🎯 Focus lives in the INSTRUMENT BAR now, next to the neck controls it acts on —
// but the app's one focus handler still arrives through renderHeader, which runs
// first. Stashing it here means the instrument bar can wire the button whether or
// not it is handed its own onFocus.
let focusHandler = null;

// ── Render header ────────────────────────────────────────────────────
export function renderHeader({ onSave, onCatalog, onHelp, onModeSwitch, onFocus }) {
  if (onFocus) focusHandler = onFocus;
  const el = document.getElementById('header');
  if (!el) return;
  el.innerHTML = `
    <div class="header-logo">
      <span style="font-size:calc(22px*var(--ui))">🎵</span>
      <div>
        <div class="header-logo-title">RESONOTE</div>
        <div class="mono header-logo-sub">MUSIC THEORY &amp; PRAXIS</div>
      </div>
    </div>
    <div class="header-actions">
      <button id="btn-mode-practice" class="mono btn active-green" style="font-size:calc(10px*var(--ui));letter-spacing:1px">PRACTICE</button>
      <button id="btn-mode-learn"    class="mono btn" title="The Theory Path as a page you can actually read — the neck stays up top" style="font-size:calc(10px*var(--ui));letter-spacing:1px">LEARN</button>
      <button id="btn-mode-tab"      class="mono btn"              style="font-size:calc(10px*var(--ui));letter-spacing:1px">TAB</button>
      <button id="btn-mode-studio"   class="mono btn"              style="font-size:calc(10px*var(--ui));letter-spacing:1px">STUDIO</button>
      <span class="header-divider"></span>
      <button id="btn-mix"     class="mono btn" title="Mix — balance the app against your own playing" style="font-size:calc(13px*var(--ui))">🔊</button>
      <button id="btn-help"    class="mono btn" style="font-size:calc(13px*var(--ui));font-weight:700">?</button>
      <button id="btn-save"    class="mono btn"><span style="font-size:calc(12px*var(--ui))">💾</span> SAVE</button>
      <button id="btn-catalog" class="mono btn"><span style="font-size:calc(14px*var(--ui))">+</span> PEDALS</button>
    </div>`;

  wireMixButton();
  document.getElementById('btn-save')   ?.addEventListener('click', onSave);
  document.getElementById('btn-catalog')?.addEventListener('click', onCatalog);
  document.getElementById('btn-help')   ?.addEventListener('click', onHelp);
  document.getElementById('btn-mode-practice')?.addEventListener('click', () => onModeSwitch('practice'));
  document.getElementById('btn-mode-learn')   ?.addEventListener('click', () => onModeSwitch('learn'));
  document.getElementById('btn-mode-tab')     ?.addEventListener('click', () => onModeSwitch('tab'));
  document.getElementById('btn-mode-studio')  ?.addEventListener('click', () => onModeSwitch('studio'));
}

// ── The mix ──────────────────────────────────────────────────────────
// One panel, reachable from every mode, because you reach for it MID-DRILL —
// hunting for a pedal with a metronome running is exactly when you give up and
// just turn the laptop down instead.
//
// The presets matter more than the faders. "Play along" (notes off, click and
// drums up) is the setting that turns a drill from something you follow into
// something you play, and nobody finds that by dragging three sliders.
const MIX_PRESETS = [
  { id: 'all',  label: 'Everything', hint: 'App plays the part with you',
    set: { notes: [0.85, false], click: [1, false], drums: [0.85, false] } },
  { id: 'play', label: 'Play along', hint: 'Notes off — you play the part, click & band keep time',
    set: { notes: [0.85, true], click: [1, false], drums: [0.85, false] } },
  { id: 'band', label: 'Just the band', hint: 'Backing only, no click, no notes',
    set: { notes: [0.85, true], click: [1, true], drums: [0.9, false] } },
  { id: 'quiet', label: 'Silent', hint: 'Everything down — the neck still lights up',
    set: { notes: [0.85, true], click: [1, true], drums: [0.85, true] } },
];

const pct = v => Math.round(v * 100);

function mixRowHTML(name, label, hint, m) {
  const b = m[name], on = !b.mute;
  return `<div class="mix-row" data-bus="${name}" style="display:flex;align-items:center;gap:8px;padding:5px 0">
    <button class="mono mix-mute" data-bus="${name}" title="${on ? 'Mute' : 'Unmute'} ${label}"
      style="flex:0 0 auto;width:26px;height:24px;padding:0;font-size:calc(11px*var(--ui));cursor:pointer;border-radius:4px;
      border:1px solid ${on ? '#4a4030' : '#8a3a3a'};background:${on ? 'rgba(255,193,77,.10)' : 'rgba(200,60,60,.18)'};
      color:${on ? '#ffc14d' : '#ff8a8a'}">${on ? '🔊' : '🔇'}</button>
    <div style="flex:0 0 46px">
      <div class="mono mix-lab" style="font-size:calc(9.5px*var(--ui));font-weight:700;color:${on ? '#e8dcc0' : '#7a6534'};letter-spacing:.5px">${label}</div>
    </div>
    <input class="rk-slider mix-fader" data-bus="${name}" type="range" min="0" max="100" value="${pct(b.level)}"
      title="${hint}" style="flex:1 1 auto;--rk-fill:${pct(b.level)}%;${on ? '' : 'opacity:.4'}">
    <span class="mono mix-val" data-bus="${name}" style="flex:0 0 26px;text-align:right;font-size:calc(9px*var(--ui));color:#7a6534">${pct(b.level)}</span>
  </div>`;
}

function mixPanelHTML() {
  const m = getMix();
  // class="rk" because the faders are kit components (.rk-slider) and the kit's
  // tokens are declared on .rk, not :root. This panel hangs off the app top bar,
  // outside every pedal card, so without the scope --rk-accent never resolves and
  // the track fill, thumb and glow all compute away to nothing. Landing on the
  // kit's neutral steel fallback is the point — the mix belongs to the app, not
  // to whichever pedal happens to be loudest.
  // display:block overrides .rk's flex column: these rows already carry their own
  // padding and hairline dividers, and the kit's 12px gap would double every one.
  return `<div id="mix-panel" class="rk" style="display:block;position:absolute;top:100%;right:0;margin-top:6px;z-index:400;width:290px;
    background:#15120a;border:1px solid #4a4030;border-radius:8px;padding:11px 12px;box-shadow:0 10px 30px rgba(0,0,0,.6)">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px">
      <span class="mono" style="font-size:calc(9.5px*var(--ui));letter-spacing:1.5px;color:#ffc14d;font-weight:700">MIX</span>
      <span class="mono" style="font-size:calc(8px*var(--ui));color:#7a6534">hear yourself over the app</span>
    </div>
    ${mixRowHTML('master', 'MASTER', 'Everything the app plays', m)}
    <div style="height:1px;background:#332a18;margin:4px 0 2px"></div>
    ${BUSES.map(b => mixRowHTML(b, BUS_LABEL[b].toUpperCase(), BUS_HINT[b], m)).join('')}
    <div style="height:1px;background:#332a18;margin:7px 0"></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${MIX_PRESETS.map(p => `<button class="mono mix-preset btn" data-preset="${p.id}" title="${p.hint}"
        style="font-size:calc(8.5px*var(--ui));padding:4px 7px">${p.label}</button>`).join('')}
    </div>
    <div class="mono" style="font-size:calc(8px*var(--ui));color:#6a5a3a;margin-top:8px;line-height:1.45">
      Your guitar through the amp modeler is <b style="color:#8a7a4a">never</b> muted by this — only the app is.
    </div>
  </div>`;
}

function paintMixButton() {
  const btn = document.getElementById('btn-mix');
  if (!btn) return;
  const silent = allSilent(), partial = !silent && anyMuted();
  btn.textContent = silent ? '🔇' : '🔊';
  btn.style.borderColor = silent ? '#8a3a3a' : partial ? '#8a7a3a' : '';
  btn.style.color       = silent ? '#ff8a8a' : partial ? '#ffc14d' : '';
  btn.title = silent ? 'The app is muted — click to open the mix'
            : partial ? 'Mix — something is muted' : 'Mix — balance the app against your own playing';
}

function paintMixPanel() {
  const el = document.getElementById('mix-panel');
  if (!el) return;
  const m = getMix();
  ['master', ...BUSES].forEach(name => {
    const b = m[name], on = !b.mute;
    const mute = el.querySelector(`.mix-mute[data-bus="${name}"]`);
    const fad  = el.querySelector(`.mix-fader[data-bus="${name}"]`);
    const val  = el.querySelector(`.mix-val[data-bus="${name}"]`);
    const lab  = el.querySelector(`.mix-row[data-bus="${name}"] .mix-lab`);
    if (mute) {
      mute.textContent = on ? '🔊' : '🔇';
      mute.style.borderColor = on ? '#4a4030' : '#8a3a3a';
      mute.style.background  = on ? 'rgba(255,193,77,.10)' : 'rgba(200,60,60,.18)';
      mute.style.color       = on ? '#ffc14d' : '#ff8a8a';
    }
    if (fad) { fad.value = pct(b.level); fad.style.setProperty('--rk-fill', pct(b.level) + '%'); fad.style.opacity = on ? '' : '.4'; }
    if (val) val.textContent = pct(b.level);
    if (lab) lab.style.color = on ? '#e8dcc0' : '#7a6534';
  });
}

export function closeMixPanel() {
  document.getElementById('mix-panel')?.remove();
  document.removeEventListener('click', mixOutside, true);
}
function mixOutside(e) {
  const p = document.getElementById('mix-panel');
  if (!p) return;
  if (p.contains(e.target) || e.target.closest?.('#btn-mix')) return;
  closeMixPanel();
}

function openMixPanel() {
  const btn = document.getElementById('btn-mix');
  const host = btn?.parentElement;
  if (!host) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.insertAdjacentHTML('beforeend', mixPanelHTML());
  const el = document.getElementById('mix-panel');
  el.addEventListener('click', e => e.stopPropagation());
  el.querySelectorAll('.mix-mute').forEach(b => b.addEventListener('click', () => setMute(b.dataset.bus)));
  el.querySelectorAll('.mix-fader').forEach(s => {
    // `input`, not `change` — a fader you have to release before you hear it is
    // useless for finding a balance against your own playing.
    s.addEventListener('input', () => setLevel(s.dataset.bus, +s.value / 100));
  });
  el.querySelectorAll('.mix-preset').forEach(b => b.addEventListener('click', () => {
    const p = MIX_PRESETS.find(x => x.id === b.dataset.preset);
    if (!p) return;
    if (getMix().master.mute) setMute('master', false);
    Object.entries(p.set).forEach(([bus, [lvl, mute]]) => { setLevel(bus, lvl); setMute(bus, mute); });
  }));
  setTimeout(() => document.addEventListener('click', mixOutside, true), 0);
}

function wireMixButton() {
  const btn = document.getElementById('btn-mix');
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (document.getElementById('mix-panel')) closeMixPanel(); else openMixPanel();
  });
  paintMixButton();
}

// One subscription for the life of the page: the panel and the button follow
// the mix no matter who moved it (a preset, a pedal, a keyboard shortcut).
onMix(() => { paintMixButton(); paintMixPanel(); });

// ── Render instrument bar ────────────────────────────────────────────
// Callers may pass (onInstrumentChange, onFocus) or a single options object —
// both shapes are accepted so the bar can't lose its focus button to a call-site
// mismatch. If neither supplies onFocus, the handler renderHeader was given is
// used, which is the same function main.js has always owned.
export function renderInstrumentBar(onInstrumentChange, onFocus) {
  const el = document.getElementById('instrument-bar');
  if (!el) return;

  const bag = [onInstrumentChange, onFocus].find(a => a && typeof a === 'object') || {};
  const instChange = typeof onInstrumentChange === 'function' ? onInstrumentChange : bag.onInstrumentChange;
  // The FOCUS button is drawn on the NECK (renderInstrumentDisplay), not in this
  // bar — but main.js hands the callback in here, so capture it into the module
  // handler the neck button reads. Without this the handler stayed null and the
  // button was inert: it rendered, it highlighted on hover, and it did nothing.
  const focusFn = (typeof onFocus === 'function' ? onFocus : bag.onFocus);
  if (focusFn) focusHandler = focusFn;

  const instruments = [
    { id:'guitar6',  label:'GUITAR'   },
    { id:'guitar8',  label:'8-STR'    },
    { id:'bass4',    label:'BASS'     },
    { id:'banjo5',   label:'BANJO'    },
    { id:'mandolin', label:'MANDOLIN' },
    { id:'piano',    label:'PIANO'    },
    { id:'lumatone', label:'LUMATONE' },
    { id:'vocals',   label:'🎤 VOCALS' }
  ];

  // Two views for now. The other renderers (function / tension / chord tones /
  // interval / voice leading) are all still live in fretboard.js — this list is
  // the shop window, not the stock room, and they go back in by adding a row.
  const FB_VIEWS = [['standard','● Standard'],['spectrum','🌈 Spectrum'],['intervals','⟡ Intervals']];
  // A board saved while one of the hidden views was selected would otherwise come
  // back in a mode the dropdown can't name and can't get you out of.
  const viewFellBack = !FB_VIEWS.some(([v]) => v === fretboardView);
  if (viewFellBack) setFretboardView('standard');

  let html = `<span class="mono" style="color:#555;font-size:calc(9px*var(--ui));letter-spacing:1px;margin-right:6px">INSTRUMENT</span>`;
  instruments.forEach(inst => {
    const active = currentInstrument === inst.id;
    html += `<button class="inst-btn mono ${active ? 'active' : ''}" data-inst="${inst.id}">${inst.label}</button>`;
  });

  // 🎯 FOCUS sits with the neck, not with SAVE and PEDALS — it is a thing you do
  // TO the board (dock everything, hand the room to the strings), so it belongs
  // beside the instrument it clears the stage for.

  html += `<span style="width:1px;height:18px;background:#333;margin:0 6px"></span>`;
  html += `<span class="mono" style="color:#555;font-size:calc(9px*var(--ui));letter-spacing:1px;margin-right:4px">DISPLAY</span>`;
  html += `<select id="fb-view" class="mono" title="Fretboard view — how theory is drawn on the neck" style="background:#11181a;border:1px solid #3a4a48;color:#9fdcd0;border-radius:6px;padding:4px 6px;font-size:calc(10px*var(--ui));cursor:pointer;outline:none">`;
  FB_VIEWS.forEach(([v, l]) => html += `<option value="${v}" ${fretboardView === v ? 'selected' : ''}>${l}</option>`);
  html += `</select>`;

  // ── 🗺 MAP — one control, two questions ────────────────────────────
  // Was two look-alike buttons (♮ NOTES and 🗺 MAP) that nobody could tell apart.
  // Now MAP is the whole idea, and the segments say what the map is: what it
  // CALLS each note (names or degrees) and how much of the neck it COVERS (the
  // session key, or every fret). Clicking the lit label turns the map off, so
  // "no map" is always one click away — ✕ CLEAR gets there too.
  const seg = (id, label, title) =>
    `<button id="${id}" class="mono btn" title="${title}" style="font-size:calc(9.5px*var(--ui));padding:5px 9px;letter-spacing:.5px">${label}</button>`;
  html += `<span class="mono" style="color:#555;font-size:calc(9px*var(--ui));letter-spacing:1px;margin-left:2px">🗺 MAP</span>`;
  html += `<span style="display:inline-flex;gap:2px">
    ${seg('btn-map-names',   '♮ NAMES',   'Label every mapped fret with its note name — click again to hide the map')}
    ${seg('btn-map-degrees', '⟡ DEGREES', 'Label every mapped fret with its degree in the session key (R ♭2 2 3 …) — click again to hide the map')}
  </span>`;
  html += `<span id="map-scope-seg" style="display:inline-flex;gap:2px">
    ${seg('btn-map-key', 'IN KEY',     'Map only the notes of the session key — the neck becomes that key')}
    ${seg('btn-map-all', 'WHOLE NECK', 'Map every note on the fretboard — the chromatic reference')}
  </span>`;
  html += `<button id="btn-clear-display" class="mono btn" title="Clear the neck — highlight, last-played note and the map" style="font-size:calc(10px*var(--ui))">✕ CLEAR</button>`;

  // ⚙ RIG — collapses the session (KEY/TEMPO), tuning and position rows behind one
  // button, so the default screen isn't four dense control bars. State persists.
  const rigOpen = (() => { try { return localStorage.getItem('rn-rig-open') === '1'; } catch (e) { return false; } })();
  html += `<span style="width:1px;height:18px;background:#333;margin:0 6px"></span>`;
  html += `<button id="btn-rig" class="mono btn" title="Your rig: session key & tempo, tuning, position tools" style="font-size:calc(10px*var(--ui));${rigOpen ? 'border-color:#8877dd;color:#bbaaee;background:rgba(136,119,221,.12)' : ''}">⚙ RIG</button>`;

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
      if (instChange) instChange(id);
    });
  });

  // The FOCUS button lives ON the neck now (renderInstrumentDisplay), not in this
  // bar — it belongs next to the thing it gives the room to.

  // ⚙ RIG toggle — show/hide the three setup rows together
  const applyRig = open => {
    ['session-bar', 'tuning-bar', 'position-bar'].forEach(id => {
      const n = document.getElementById(id); if (n) n.style.display = open ? '' : 'none';
    });
    const b = document.getElementById('btn-rig');
    if (b) { b.style.borderColor = open ? '#8877dd' : ''; b.style.color = open ? '#bbaaee' : ''; b.style.background = open ? 'rgba(136,119,221,.12)' : ''; }
  };
  applyRig(rigOpen);
  document.getElementById('btn-rig')?.addEventListener('click', () => {
    const open = document.getElementById('session-bar')?.style.display === 'none';
    applyRig(open);
    try { localStorage.setItem('rn-rig-open', open ? '1' : '0'); } catch (e) {}
  });

  document.getElementById('fb-view')?.addEventListener('change', e => {
    setFretboardView(e.target.value);
    window.dispatchEvent(new CustomEvent('resonote:fbview', { detail: { view: e.target.value } }));
    updateOverlays();
  });

  // The label segments are a three-state control worn as two buttons: names,
  // degrees, or — by pressing whichever one is already lit — nothing at all.
  // showIntervals is the app-wide "name notes by degree" switch (the Circle, the
  // Explorer and the chord readouts all read it), so it stays the single source
  // of truth rather than the map keeping a private copy that could disagree.
  const setMapMode = intervals => {
    const already = showNoteMap && showIntervals === intervals;
    setShowNoteMap(!already);
    setShowIntervals(!already && intervals);
    updateNoteMapBtn();
    updateOverlays();
  };
  document.getElementById('btn-map-names')  ?.addEventListener('click', () => setMapMode(false));
  document.getElementById('btn-map-degrees')?.addEventListener('click', () => setMapMode(true));

  // Reaching for a scope while the map is hidden plainly means "show me that" —
  // so it turns the map on rather than silently storing a preference.
  const setScope = s => {
    setMapScope(s);
    if (!showNoteMap) setShowNoteMap(true);
    updateNoteMapBtn();
    updateOverlays();
  };
  document.getElementById('btn-map-key')?.addEventListener('click', () => setScope('key'));
  document.getElementById('btn-map-all')?.addEventListener('click', () => setScope('all'));

  // ✕ CLEAR means an empty neck — the map is part of what's on it.
  document.getElementById('btn-clear-display')?.addEventListener('click', () => {
    clearChordHighlight();
    setLastClickedNote(null);
    setShowNoteMap(false);
    setShowIntervals(false);
    updateNoteMapBtn();
    updateOverlays();
  });

  // Paint the map control from live state, so a board restored with the map on
  // comes back with the right segments lit instead of a lie.
  updateNoteMapBtn();
  if (viewFellBack) {
    window.dispatchEvent(new CustomEvent('resonote:fbview', { detail: { view: 'standard' } }));
    updateOverlays();
  }
}

// ── Render instrument display container ──────────────────────────────
export function renderInstrumentDisplay() {
  const el = document.getElementById('instrument-display');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-outer">
      <div id="tuning-bar" style="display:flex;align-items:center;gap:8px;padding:0 8px 4px">
        <span id="tuning-label" class="mono" style="color:#555;font-size:calc(8px*var(--ui));letter-spacing:1px">TUNING</span>
        <select id="tuning-preset" class="tuning-combo"></select>
        <span class="mono" style="color:#555;font-size:calc(8px*var(--ui));letter-spacing:1px;margin-left:8px">STYLE</span>
        <select id="fb-theme" class="tuning-combo"></select>
      </div>
      <div id="position-bar" style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:2px 8px 6px"></div>
      <div id="fb-rel" style="position:relative">
        <svg id="fb-svg" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg"></svg>
        <div id="tuning-ov" style="position:absolute;top:0;left:0;height:100%;pointer-events:none;z-index:10"></div>
      </div>
    </div>
    <!-- readout lives OUTSIDE .fb-outer so taller instruments can never clip this line -->
    <div id="note-readout" style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:16px;min-height:28px;padding:0 8px">
      <span class="mono" style="color:#333;font-size:calc(11px*var(--ui))">Play a note to see it on the fretboard...</span>
    </div>
    <!-- concept facts strip: the objective theory of what's on the neck (set via setConceptInfo) -->
    <div id="concept-info" style="display:none;margin-top:1px;padding:0 8px;align-items:baseline;justify-content:center;flex-wrap:wrap;gap:12px"></div>
    <!-- draggable boundary between the board and the pedalboard: drag to resize, double-click for full width -->
    <div id="fb-splitter" title="Drag to resize the fretboard · double-click for full width" style="height:14px;display:flex;align-items:center;justify-content:center;cursor:ns-resize;user-select:none;touch-action:none">
      <div id="fb-splitter-grip" style="width:72px;height:4px;border-radius:2px;background:#2c2c2c;transition:background .15s"></div>
    </div>
    <div id="vocals-display" style="display:none"></div>`;

  // apply the ⚙ RIG collapsed state to the freshly-rendered setup rows
  try {
    if (localStorage.getItem('rn-rig-open') !== '1') ['session-bar', 'tuning-bar', 'position-bar'].forEach(id => {
      const n = document.getElementById(id); if (n) n.style.display = 'none';
    });
  } catch (e) {}

  // ── Splitter wiring: live-resizes the board (pure CSS), persists on release ──
  const sp = document.getElementById('fb-splitter');
  const grip = document.getElementById('fb-splitter-grip');
  if (sp) {
    sp.addEventListener('mouseenter', () => { if (grip) grip.style.background = '#5a5a5a'; });
    sp.addEventListener('mouseleave', () => { if (grip) grip.style.background = '#2c2c2c'; });
    sp.addEventListener('pointerdown', e => {
      e.preventDefault();
      const svg = document.getElementById('fb-svg');
      if (!svg) return;
      const startH = svg.getBoundingClientRect().height, startY = e.clientY;
      const move = ev => setBoardRenderH(Math.min(1400, Math.max(140, startH + (ev.clientY - startY))));
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); persistBoardRenderH(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    sp.addEventListener('dblclick', () => { setBoardRenderH(0); persistBoardRenderH(); });
  }
}

// ── Display button state sync ─────────────────────────────────────────
// Keeps the name (position-bar.js switches the map on for a box and calls this)
// but now paints the whole 🗺 MAP group: which label mode is showing, and how
// much of the neck it covers. The map's green is inherited from the old MAP
// button so the control keeps the identity you already learned.
export function updateNoteMapBtn() {
  const lit = (btn, on) => {
    if (!btn) return;
    btn.style.background  = on ? 'rgba(100,180,100,.2)' : 'rgba(255,255,255,.04)';
    btn.style.borderColor = on ? '#66aa66' : '#444';
    btn.style.color       = on ? '#88cc88' : '#888';
  };
  const $ = id => document.getElementById(id);
  lit($('btn-map-names'),   showNoteMap && !showIntervals);
  lit($('btn-map-degrees'), showNoteMap &&  showIntervals);
  lit($('btn-map-key'),     showNoteMap && mapScope === 'key');
  lit($('btn-map-all'),     showNoteMap && mapScope === 'all');
  // Scope says nothing while there's no map — dimmed, not hidden, so the control
  // doesn't reflow every time the map goes on and off.
  const sc = $('map-scope-seg');
  if (sc) sc.style.opacity = showNoteMap ? '1' : '.45';
}

// ── Catalog drawer ────────────────────────────────────────────────────
function darkenHex(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, (n>>16) - amt);
  const g = Math.max(0, ((n>>8)&0xff) - amt);
  const b = Math.max(0, (n&0xff) - amt);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function catalogSection(label, color, items, countOf) {
  let h = `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px">
    <span class="mono" style="color:${color};font-size:calc(9px*var(--ui));font-weight:700;letter-spacing:1px">${label}</span>
    <div style="flex:1;height:1px;background:${color}33"></div>
  </div>`;
  items.forEach(item => {
    const bg   = item.color  || '#1a1a1a';
    const acc  = item.accent || '#444';
    const dark = darkenHex(bg, 15);
    // A pedal already on the board says so. A minimized or docked pedal is easy
    // to miss, and a shop that offers "+ ADD" for something you already own is
    // how you end up with two Metronomes without meaning to. Deliberate
    // duplicates stay possible — they're a real use (two Workouts, two keys) —
    // but they now cost a second, explicit click.
    const n = countOf ? countOf(item.type) : 0;
    const btn = (cls, txt, style) => `<button class="${cls}" data-type="${item.type}"
                  style="border-radius:6px;padding:2px 8px;font-size:calc(8px*var(--ui));font-weight:700;letter-spacing:1px;font-family:'JetBrains Mono',monospace;cursor:pointer;${style}">${txt}</button>`;
    const actions = n
      ? btn('catalog-show-btn', '◎ SHOW', `background:${acc}22;border:1px solid ${acc}44;color:${acc}`)
        + (n > 1 ? btn('catalog-drop-btn', '− EXTRA', 'background:none;border:1px solid #5a3a3a;color:#c98f8f') : '')
        + btn('catalog-add-btn', '+ ANOTHER', 'background:none;border:1px solid #3a3a3a;color:#777')
      : btn('catalog-add-btn', '+ ADD', `background:${acc}22;border:1px solid ${acc}44;color:${acc}`);
    // display:block because .catalog-item in pedals.css is still the old one-line
    // flex row. This card is a stack — title, description, then the action row —
    // and laid out as a row inside a 280px drawer the three blocks collapse into
    // slivers and shove + ANOTHER past the edge, where it can't be clicked at all.
    h += `
      <div class="catalog-item" data-type="${item.type}"
           style="display:block;background:linear-gradient(135deg,${bg},${dark});border:1px solid ${n ? acc + '77' : acc + '33'};border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all .2s">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:calc(16px*var(--ui))">${item.icon}</span>
          <span class="mono" style="color:${acc};font-size:calc(11px*var(--ui));font-weight:700">${item.title}</span>
        </div>
        <div style="color:#888;font-size:calc(9px*var(--ui));line-height:1.4;margin-bottom:6px">${item.desc}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <span class="mono" style="color:${n ? '#7ec98f' : 'transparent'};font-size:calc(8px*var(--ui));font-weight:700;letter-spacing:.5px">${n ? '● ON BOARD' + (n > 1 ? ' ×' + n : '') : ''}</span>
          <span style="display:flex;gap:5px">${actions}</span>
        </div>
      </div>`;
  });
  return h;
}

export function renderCatalog(catalog, onAdd, opts = {}) {
  const el = document.getElementById('catalog-drawer');
  if (!el) return;
  const { countOf, onShow, onDropExtra } = opts;

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="mono" style="color:#aaa;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:2px;text-transform:uppercase">Pedal Shop</span>
      <button id="btn-close-catalog" style="background:none;border:none;color:#666;cursor:pointer;font-size:calc(18px*var(--ui))">✕</button>
    </div>`;

  // studioOnly pedals (Amp/Looper/Vocals) live in the Studio workspace, not the main shop.
  const shop = catalog.filter(c => !c.studioOnly);
  html += catalogSection('REFERENCE &amp; THEORY', '#888',     shop.filter(c => c.tier === 'free'),   countOf);
  html += catalogSection('GUIDED PRACTICE',         '#ef9f27', shop.filter(c => c.tier === 'pro'),    countOf);
  html += catalogSection('STUDIO',                  '#9977ee', shop.filter(c => c.tier === 'studio'), countOf);

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
  el.querySelectorAll('.catalog-show-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (onShow) onShow(btn.dataset.type);
    });
  });
  // − EXTRA closes the newest copy of a doubled-up pedal, so the one you set up
  // and placed is the one that survives.
  el.querySelectorAll('.catalog-drop-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (onDropExtra) onDropExtra(btn.dataset.type);
    });
  });
  // Tapping the card itself does the safe thing: reveal what you own, add what
  // you don't. The buttons stay for people who read them.
  el.querySelectorAll('.catalog-item').forEach(card => {
    card.addEventListener('click', () => {
      const t = card.dataset.type;
      if (countOf && countOf(t) && onShow) onShow(t); else if (onAdd) onAdd(t);
    });
  });
}

// ── Help overlay ──────────────────────────────────────────────────────
// ── Help / Reference ─────────────────────────────────────────────────
// Two tabs: GUIDE (how the whole app fits together) and PEDALS (every pedal's
// goal — pulled straight from the catalog — plus the fastest path to set it up).
const PEDAL_QUICKSTART = {
  theory:      ['Open a lesson (or hit ▶ Continue) — the teach card explains one concept.', 'Press “Hear & see it” — the drill plays on the fretboard exactly as you’ll practice it.', 'Answer the exercises, then loop 🏋 DYNAMIC PRACTICE in any key, tempo, and layer.'],
  chordlab:    ['Pick a family chip (Suspended, Slash…) and a member inside it.', 'A/B the “Plain vs Coloured” buttons to isolate the colour tone by ear.', 'Tap the voicing cards to light real grips; “Hear it resolve” plays the release. Facts appear under the fretboard.'],
  audio:       ['Click Connect and allow your mic or interface, then raise the gain until the meter responds.', 'Flip to the 🎯 TUNER view — play one string, center the needle, repeat per string.', 'Done — ear training and play-along exercises can now hear you.'],
  metronome:   ['Set BPM — or leave it linked to the session TEMPO.', 'Pick subdivision, accents, or ghost notes.', 'Press play; tempo-linked pedals stay in sync.'],
  circle5:     ['Tap a key on the wheel — its neighbours and relative minor light up.', 'Open Harmony view: diatonic / secondary-dominant / borrowed chips — tap to hear and light on the neck.', 'Leave 〰 trace on: anything the app plays draws its path around the wheel.'],
  chords:      ['CHORD mode: pick a root + quality to browse voicings.', 'KEY mode: see every diatonic chord of the session key.', 'Tap any voicing to light it on the fretboard.'],
  scales:      ['Pick a root and a scale (or switch to ARPS).', 'Positions view: tap a box card to isolate one position on the neck.', 'Read the facts strip under the neck: degrees, step pattern, character, related scales.'],
  progression: ['Set the key (or follow the session key).', 'Arm a chord and paint it into bars — Smart Next suggests what fits.', 'Play the loop, then send it to other pedals to practice.'],
  ear:         ['Pick a mode: sound training (notes/intervals/chords) or theory recall — including 🎯 Resolve: which chord tone does a tension pull to?', 'Press play to hear the question.', 'Answer on the fretboard or the option buttons — streaks track your accuracy.'],
  workshop:    ['Pick a tool tab: Positions, Groove, Finger, Technique, or 🧵 Voicings (string-set triads & voice leading).', 'Choose the pattern options (fingering, string set…) and a starting tempo.', 'Follow the gold note; nudge the BPM up only when it’s clean.'],
  practice:    ['🎓 Theory tab lists every drill in the curriculum — ▶ loops any of them at your tempo.', 'Session tab: build timed blocks (scales, chords, ear…) and press start.', 'Resize the pedal taller — the list grows with it.'],
  beatmaker:   ['Pick a genre — it loads that groove, mode, tempo and chord progression at once.', 'Choose “beats only” for the kit alone, or “+ chords” for a full backing track in any key.', 'Press play. Shape the groove in the 16-step grid; everything follows the session tempo.'],
  amp:         ['Connect your guitar (Input & Tuner pedal).', 'Pick an amp + cab, set gain and EQ.', 'Add reverb to taste and play.'],
  looper:      ['Connect audio input.', 'Record your first loop — its length sets the cycle.', 'Overdub layers on top; mute or clear per layer.'],
  reaper:      ['One-time REAPER setup: Actions → Show action list → New action → Load ReaScript → pick Resonote_Import.lua (in the repo’s reaper folder), and give it a shortcut.', 'OUT: hit ⇄ Export here, in Progression Studio, or in Backing Track — then run Resonote Import in REAPER to drop the newest .mid at the cursor.', 'IN: render or record in REAPER, choose the WAV here — get tempo, key & every note mapped on the fretboard.'],
  workouts:    ['Tap any workout card — random chords/triads flash on the neck and change every 1, 2 or 4 bars at the session tempo.', 'Switch ADVANCE to 🎤 Listen and it waits until it hears you play every note of the grip.', 'PRO: ＋ New builds your own — pick the chord pool or string set, add a tempo ramp, save it as a card.'],
  improvlab:   ['🗣️ Call & Response: pick a key + feel, press ▶ Play the call — the app plays a phrase that asks a question, then it\'s your turn. Start on ① Echo (play it back), climb to ③ Create (improvise a reply that resolves).', '🎸 Jam: choose a backing, set the key, ▶ Start jam — the neck lights the scale, the current chord\'s arpeggio (your safe notes), and the target 3rd to aim for through the changes.', 'Connect your guitar to play answers back and get feedback — or just listen and learn the grammar of responding.'],
};

export function renderHelp(tab = 'guide') {
  const el = document.getElementById('help-overlay');
  if (!el) return;
  if (tab === 'loadout') { renderLoadout(el); return; }   // the first-run kit picker — its own screen, not a tab
  const tabBtn = (id, label, on) => `<button class="help-tab" data-tab="${id}" style="flex:1;padding:8px;border-radius:8px;border:1px solid ${on ? '#8877dd' : '#333'};background:${on ? 'rgba(136,119,221,.15)' : 'rgba(255,255,255,.03)'};color:${on ? '#bbaaee' : '#888'};font-family:'JetBrains Mono',monospace;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;cursor:pointer">${label}</button>`;
  const card = (title, body) => `<div style="background:rgba(255,255,255,.04);border:1px solid #333;border-radius:10px;padding:14px"><div class="mono" style="color:#ccc;font-size:calc(11px*var(--ui));font-weight:700;margin-bottom:8px;letter-spacing:1px">${title}</div><div style="color:#999;font-size:calc(12px*var(--ui));line-height:1.7">${body}</div></div>`;
  const hl = t => `<span style="color:#ccc;font-weight:700">${t}</span>`;

  let body = '';
  if (tab === 'guide') {
    body += `<div style="color:#bbb;font-size:calc(13px*var(--ui));line-height:1.8;margin-bottom:16px">Resonote teaches guitar theory ON the instrument: every concept is shown on the fretboard, named in plain terms, and turned into a loopable practice. The layout has two halves — the <b style="color:#ddd">board</b> (fretboard + its readouts) on top, and your <b style="color:#ddd">pedalboard</b> of tools below.</div>`;
    body += `<div style="display:flex;flex-direction:column;gap:12px">`;
    body += card('QUICK START', `1 · Open the ${hl('Theory Path')} pedal and press ${hl('▶ Continue')} — it picks your next lesson.<br>2 · In any lesson, ${hl('Hear & see it')} plays the concept on the neck; the ${hl('facts strip')} under the fretboard states its theory.<br>3 · Finish with ${hl('🏋 Dynamic Practice')}: same structure, your choice of key, tempo, and layer.`);
    body += card('THE BOARD', `${hl('Instruments')} — guitar, 8-string, bass, banjo, mandolin, piano, the ⬡ Lumatone hex board (one shape, every key), or 🎤 vocals; tuning and wood style are per-instrument.<br>${hl('Resize')} — drag the slim handle between the board and the pedalboard (double-click = full width). Your size is remembered.<br>${hl('Readout + facts strip')} — under the neck: what's playing now, then its objective theory (notes · degrees · structure · resolution).`);
    body += card('DISPLAY &amp; THE MAP', `${hl('● Standard')} — plain dots · ${hl('🌈 Spectrum')} — every note wears its own colour (fifths-ordered, matching the legend and both circles) · ${hl('⟡ Intervals')} — every note wears its FUNCTION in the session key: gold is home, amber and terracotta are the 3rds, rose and wine the 7ths, sage/teal/olive the colour tones, slate and plum the notes that pull hardest. Change the key and the whole neck recolours.<br>${hl('🗺 MAP')} labels the neck itself. ${hl('♮ NAMES')} writes note names, ${hl('⟡ DEGREES')} writes each note's degree in the session key (R ♭2 2 3 …) — press the lit one again to hide the map. ${hl('IN KEY')} shows only the notes of the session key, so the neck becomes a map of that key; ${hl('WHOLE NECK')} shows all twelve as a chromatic reference. The tonic is drawn brightest. ${hl('✕ CLEAR')} empties the neck.<br>${hl('🎯 FOCUS')} (by the instruments) docks everything and hands the room to the strings.`);
    body += card('SESSION BUSES', `The top bar's ${hl('KEY')} and ${hl('TEMPO')} drive every linked pedal at once — change the key and the Circle, Explorer, drills and labs follow. ${hl('⟲ Re-link all')} reattaches any pedal you detached.`);
    body += card('PEDALS', `${hl('Drag')} by the header · ${hl('resize')} from the corner · ${hl('▁ minimize')} · add more from ${hl('+ PEDALS')}. Each pedal's goal and fast setup lives in the ${hl('PEDALS')} tab of this help. ${hl('💾 SAVE')} stores your whole board and every pedal's settings.`);
    body += card('THE LEARNING LOOP', `${hl('Theory Path')} teaches a concept → its exercises make you build and hear it → ${hl('Dynamic Practice')} transfers it to any key/tempo/layer → the ${hl('Practice Manager')} loops any drill for daily reps. The ${hl('Circle of Fifths')} traces whatever plays, and the Practice Manager's ${hl('📖 Songbook')} turns real tabs and your own ideas into the same kind of guided practice.`);
    body += `</div>`;
  } else {
    body += `<div style="color:#999;font-size:calc(12px*var(--ui));line-height:1.7;margin-bottom:12px">Every pedal, its goal, and the fastest way to get it working. Add any of them from ${hl('+ PEDALS')}.</div>`;
    body += `<div style="display:flex;flex-direction:column;gap:10px">`;
    CATALOG.forEach(pd => {
      const steps = PEDAL_QUICKSTART[pd.type];
      const tierBadge = pd.tier && pd.tier !== 'free' ? ` <span class="mono" style="font-size:calc(8px*var(--ui));color:#ffc832;border:1px solid rgba(255,200,50,.3);border-radius:4px;padding:0 4px;vertical-align:2px">${pd.tier.toUpperCase()}</span>` : '';
      let inner = `<div style="color:#999;font-size:calc(11.5px*var(--ui));line-height:1.6;margin-bottom:${steps ? 7 : 0}px"><span class="mono" style="color:#777;font-size:calc(8px*var(--ui));letter-spacing:1px">GOAL </span>${pd.desc}</div>`;
      if (steps) inner += `<div style="color:#aaa;font-size:calc(11.5px*var(--ui));line-height:1.75">` + steps.map((s, i) => `<div style="display:flex;gap:7px"><span class="mono" style="color:${pd.accent};font-weight:800">${i + 1}</span><span>${s}</span></div>`).join('') + `</div>`;
      if (TOURS[pd.type]) {
        const done = coachDone(pd.type);
        inner += `<button class="help-coach mono" data-type="${pd.type}" style="margin-top:8px;background:${done ? 'rgba(90,209,192,.06)' : 'rgba(90,209,192,.14)'};border:1px solid ${done ? '#5ad1c055' : '#5ad1c0'};border-radius:7px;color:#5ad1c0;font-size:calc(10px*var(--ui));font-weight:700;padding:6px 12px;cursor:pointer;letter-spacing:.5px">${done ? '✓ Walked through — replay' : '▶ Walk me through it'}</button>`;
      }
      body += `<div style="background:rgba(255,255,255,.03);border:1px solid #2c2c2c;border-left:3px solid ${pd.accent};border-radius:8px;padding:11px 13px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px"><span style="font-size:calc(14px*var(--ui))">${pd.icon}</span><span class="mono" style="color:#ddd;font-size:calc(12px*var(--ui));font-weight:800;letter-spacing:.5px">${pd.title}</span>${tierBadge}</div>${inner}</div>`;
    });
    body += `</div>`;
  }

  el.innerHTML = `
    <div style="max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="color:#eee;font-size:calc(20px*var(--ui));font-weight:700;letter-spacing:1px">Resonote Reference</div>
          <div class="mono" style="color:#666;font-size:calc(10px*var(--ui));letter-spacing:2px;margin-top:2px">MUSIC THEORY & PRAXIS v2.0</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button id="btn-loadout" class="mono btn" title="Pick your load-out again — instrument, look, tuning &amp; starting pedals" style="font-size:calc(9px*var(--ui));padding:6px 9px">🎒 LOAD-OUT</button>
          <button id="btn-close-help" class="btn" style="width:32px;height:32px;padding:0;font-size:calc(16px*var(--ui))">✕</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:16px">${tabBtn('guide', '📖 GUIDE', tab === 'guide')}${tabBtn('pedals', '🎛 PEDALS', tab === 'pedals')}</div>
      ${body}
    </div>`;

  document.getElementById('btn-close-help')?.addEventListener('click', () => el.classList.remove('open'));
  document.getElementById('btn-loadout')?.addEventListener('click', e => { e.stopPropagation(); loadout = null; renderHelp('loadout'); });
  el.querySelectorAll('.help-tab').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); renderHelp(b.dataset.tab); }));
  el.querySelectorAll('.help-coach').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    el.classList.remove('open');
    window.dispatchEvent(new CustomEvent('resonote:coach', { detail: { type: b.dataset.type } }));
  }));
  el.onclick = e => { if (e.target === el) el.classList.remove('open'); };
}

// ── Load-out — the first screen a brand-new player sees ───────────────
// Pick the instrument, the look of the neck, a tuning, and which pedals start on
// the board: a kit chosen before the first note. Every pick lands on the live
// board the moment it's tapped (same calls the instrument/tuning bars make), so
// ▶ Start playing only has to hand the pedal list to main.js and get out of the
// way. Three exits — ▶ Start, "skip this", ✕ (which drops you in the guide) —
// all stamp the flag so this never reappears uninvited; 🎒 LOAD-OUT re-runs it.
const LOADOUT_FLAG = 'rn-loadout-done';
export function loadoutDone() { try { return localStorage.getItem(LOADOUT_FLAG) === '1'; } catch (e) { return false; } }
function markLoadoutDone() { try { localStorage.setItem(LOADOUT_FLAG, '1'); } catch (e) {} }

// Starter kit: enough to hear yourself, keep time, look a chord or scale up, and
// start the guided path — the five that answer a beginner's first questions.
// Matches the default board (see `pedals` in main.js) so that on a first run what
// is ticked is exactly what you get — the picker can't promise five and hand you six.
const LOADOUT_STARTERS = ['audio', 'metronome', 'circle5', 'chords', 'scales', 'theory'];

const LOADOUT_INSTRUMENTS = [
  { id:'guitar6',  icon:'🎸', label:'Guitar',   note:'6 strings' },
  { id:'guitar8',  icon:'🎸', label:'8-String', note:'extended range' },
  { id:'bass4',    icon:'🎸', label:'Bass',     note:'4 strings, low' },
  { id:'banjo5',   icon:'🪕', label:'Banjo',    note:'5 strings' },
  { id:'mandolin', icon:'🪕', label:'Mandolin', note:'4 courses' },
  { id:'piano',    icon:'🎹', label:'Piano',    note:'keys' },
  { id:'lumatone', icon:'⬡',  label:'Lumatone', note:'hex keys, one shape every key' },
  { id:'vocals',   icon:'🎤', label:'Vocals',   note:'your voice' }
];

const LOADOUT_STEPS = ['inst', 'look', 'tuning', 'pedals'];

// Picks for the open screen. Null between runs so a deliberate re-run starts from
// whatever the board is set to now rather than a stale session.
let loadout = null;

// The instrument bar's own tap path, minus the bar re-render (just move its highlight).
function loadoutSetInstrument(id) {
  setCurrentInstrument(id);
  const inst = INSTRUMENTS[id];
  if (inst.strings?.length) applyTuning(inst.strings);
  document.querySelectorAll('#instrument-bar .inst-btn').forEach(b => b.classList.toggle('active', b.dataset.inst === id));
  buildInstrumentView();
  buildTuningBar();
  updateOverlays();
}

function loadoutSetTheme(key) {
  setCurrentTheme(key);
  buildInstrumentView();
  updateOverlays();
  const sel = document.getElementById('fb-theme');
  if (sel) sel.value = key;   // keep the STYLE combo in ⚙ RIG showing the same look
}

function loadoutSetTuning(name) {
  const p = (TUNING_PRESETS[currentInstrument] || []).find(x => x.name === name);
  if (!p) return;
  applyTuning(p.strings);
  buildInstrumentView();
  buildTuningBar();
  updateOverlays();
}

// The hex board's tuning is its LAYOUT — same tap path, different state.
function loadoutSetLayout(id) {
  setHexLayout(id);
  buildInstrumentView();
  buildTuningBar();
  updateOverlays();
}

// ── Look customizer ──────────────────────────────────────────────────
// A LOOK is a set of overrides on the chosen preset, saved PER INSTRUMENT
// (core/looks.js). Every edit writes straight through to the live board, because
// a finish is the one thing you can only judge by looking at it.
const WOOD_STOCK = [
  { name: 'Rosewood',  ramp: ['#3a2418','#46301f','#3e2a1b','#4a3422','#3c2618','#321f14'] },
  { name: 'Ebony',     ramp: ['#151515','#1d1d1d','#181818','#212121','#1a1a1a','#121212'] },
  { name: 'Maple',     ramp: ['#c8a878','#bfa070','#b49868','#bda070','#b29666','#c4a474'] },
  { name: 'Pau Ferro', ramp: ['#6a4a30','#7a583a','#705032','#82603e','#6e4c30','#5c3e28'] },
  { name: 'Wenge',     ramp: ['#2c2016','#38291c','#312418','#3f2f20','#2e2118','#241a12'] },
  { name: 'Koa',       ramp: ['#8a5a2c','#9c6a34','#93602e','#a8763c','#8f5e30','#7a4c24'] },
];
const STRING_STOCK = [
  { name: 'Nickel', pair: ['#eef0f4','#b9c0c9'] },
  { name: 'Steel',  pair: ['#f6f8fb','#cdd4dc'] },
  { name: 'Bronze', pair: ['#e6cfa2','#b8952e'] },
  { name: 'Black',  pair: ['#4a4a52','#33333a'] },
  { name: 'Gold',   pair: ['#f2dd9a','#c9a227'] },
  { name: 'Cobalt', pair: ['#dfe7f5','#8fa4c4'] },
];
const WIRE_STOCK = [
  { name: 'Nickel', ramp: ['#e8e0d0','#c8c0b0','#b0a898','#c8c0b0','#a09888'] },
  { name: 'Steel',  ramp: ['#f0f2f5','#d2d6dc','#b6bcc4','#d2d6dc','#a8aeb6'] },
  { name: 'Gold',   ramp: ['#f6e6a8','#dcc470','#c0a850','#dcc470','#a89040'] },
];
const INLAY_STOCK = [
  { name: 'Pearl',   ramp: ['#e8e4dc','#d8d0c4','#c0b8aa'] },
  { name: 'Abalone', ramp: ['#bfe6de','#7fc4c8','#4f92a8'] },
  { name: 'Black',   ramp: ['#2a2a2a','#1e1e1e','#141414'] },
  { name: 'Gold',    ramp: ['#f2dd9a','#d8bd62','#b2952f'] },
];
const INLAY_LABEL = { dot: 'Dots', smalldot: 'Small dots', trapezoid: 'Blocks', bird: 'Birds', shark: 'Sharktooth', moon: 'Moons', none: 'None' };

let lookDraft = null;   // the look being edited; null when the editor is closed

function applyDraft() {
  if (!lookDraft) return;
  saveLook(currentInstrument, lookDraft);
  buildInstrumentView();
  updateOverlays();
}
function swatchRow(items, activeTest, cls, render) {
  return '<div style="display:flex;gap:6px;flex-wrap:wrap">' + items.map((it, i) => {
    const on = activeTest(it, i);
    return `<button class="${cls}" data-i="${i}" data-on="${on ? 1 : 0}" title="${it.name}"
      style="border:1px solid ${on ? '#8877dd' : '#3a3a3a'};background:${on ? 'rgba(136,119,221,.14)' : 'rgba(255,255,255,.02)'};border-radius:8px;padding:5px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px">
      ${render(it)}<span class="mono" style="color:${on ? '#bbaaee' : '#8a8a8a'};font-size:calc(8px*var(--ui))">${it.name}</span></button>`;
  }).join('') + '</div>';
}
// <input type="color"> only speaks #rrggbb, and a stored colour may be hsl()
function toHex(c) {
  if (typeof c === 'string' && c[0] === '#' && c.length === 7) return c;
  const probe = document.createElement('span');
  probe.style.color = c || '#888888';
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/\d+/g);
  probe.remove();
  if (!m) return '#888888';
  return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
}
function lookEditorHTML() {
  const d = lookDraft;
  const lab = t => `<div class="mono" style="color:#777;font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin:9px 0 4px">${t}</div>`;
  const instName = INSTRUMENTS[currentInstrument]?.name || currentInstrument;
  let h = `<div id="look-editor" style="background:rgba(136,119,221,.05);border:1px solid #4a3f7a;border-radius:10px;padding:11px 13px;margin-top:9px">
    <div style="display:flex;align-items:center;gap:8px">
      <span class="mono" style="color:#bbaaee;font-size:calc(10px*var(--ui));font-weight:800;letter-spacing:1px">✏️ CUSTOM FINISH</span>
      <span class="mono" style="color:#666;font-size:calc(9px*var(--ui))">${instName} only</span>
      <span style="flex:1"></span>
      <button id="look-reset" class="mono" style="background:none;border:1px solid #444;border-radius:6px;color:#999;font-size:calc(9px*var(--ui));padding:3px 8px;cursor:pointer">Reset</button>
      <button id="look-close" class="mono" style="background:none;border:none;color:#777;font-size:calc(13px*var(--ui));cursor:pointer">✕</button>
    </div>`;

  if (currentInstrument === 'vocals') {
    return h + `<div style="color:#999;font-size:calc(11.5px*var(--ui));line-height:1.6;margin-top:8px">The voice view carries its own controls on the display itself — 🪜 Ladder (the pitch ladder with a live trace, seconds visible, and 🎯 Find my range) or ⭕ Folded (one octave with the ball, trail and notation toggles). Choose 🎤 VOCALS as your instrument and they sit just above the trace.</div></div>`;
  }

  if (currentInstrument === 'lumatone') {
    return h + `<div style="color:#999;font-size:calc(11.5px*var(--ui));line-height:1.6;margin-top:8px">The hex board is coloured by the DISPLAY mode in the top bar — neutral keys, the 🌈 note spectrum, or the ⟡ interval ladder against the session key — so there is no finish to pick here. Its layout lives in the TUNING row under ⚙ RIG.</div></div>`;
  }

  if (currentInstrument === 'piano') {
    const mode = d.piano?.mode || 'spectrum';
    h += lab('KEY COLOURS');
    h += '<div style="display:flex;gap:5px">' + [['spectrum', 'Note spectrum'], ['custom', 'Pick each note'], ['plain', 'Plain keys']]
      .map(([v, l]) => `<button class="look-pmode" data-v="${v}" style="flex:1;border:1px solid ${mode === v ? '#8877dd' : '#3a3a3a'};background:${mode === v ? 'rgba(136,119,221,.14)' : 'rgba(255,255,255,.02)'};color:${mode === v ? '#bbaaee' : '#999'};border-radius:7px;padding:6px 4px;font-family:inherit;font-size:calc(10px*var(--ui));cursor:pointer">${l}</button>`).join('') + '</div>';
    if (mode === 'custom') {
      h += lab('EACH NOTE');
      h += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px">' + NOTES.map((n, i) =>
        `<label style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">
          <input class="look-pkey" data-i="${i}" type="color" value="${toHex(d.piano?.keyColors?.[i] || pcColor(n, 70, 62))}" style="width:100%;height:22px;border:1px solid #3a3a3a;border-radius:5px;background:none;cursor:pointer;padding:0">
          <span class="mono" style="color:#888;font-size:calc(8px*var(--ui))">${n}</span></label>`).join('') + '</div>';
    } else if (mode === 'spectrum') {
      h += `<div class="mono" style="color:#666;font-size:calc(9px*var(--ui));margin-top:6px;line-height:1.5">Each key wears its note's own colour from the app's spectrum — the same code as the neck's 🌈 view, the legend and the circles.</div>`;
    }
    return h + '</div>';
  }

  h += lab('FRETBOARD WOOD');
  h += swatchRow(WOOD_STOCK, it => (d.wood || []).join() === it.ramp.join(), 'look-wood',
    it => `<span style="display:block;width:34px;height:16px;border-radius:3px;background:linear-gradient(180deg,${it.ramp[0]},${it.ramp[3]})"></span>`);
  h += `<div style="display:flex;align-items:center;gap:7px;margin-top:6px">
    <span class="mono" style="color:#777;font-size:calc(8px*var(--ui))">STAIN</span>
    <input id="look-hue" type="range" min="-40" max="40" value="0" style="flex:1;accent-color:#8877dd">
    <span class="mono" style="color:#777;font-size:calc(8px*var(--ui))">LIGHT</span>
    <input id="look-light" type="range" min="-18" max="18" value="0" style="flex:1;accent-color:#8877dd"></div>`;

  h += lab('STRINGS');
  h += swatchRow(STRING_STOCK, it => (d.stringColor || []).join() === it.pair.join(), 'look-string',
    it => `<span style="display:block;width:34px;height:16px;border-radius:3px;background:#1a1a1a;position:relative">
      <span style="position:absolute;left:2px;right:2px;top:5px;height:1.5px;background:${it.pair[0]}"></span>
      <span style="position:absolute;left:2px;right:2px;top:10px;height:2.5px;background:${it.pair[1]}"></span></span>`);

  h += lab('FRET WIRE');
  h += swatchRow(WIRE_STOCK, it => (d.fretWire || []).join() === it.ramp.join(), 'look-wire',
    it => `<span style="display:block;width:34px;height:16px;border-radius:3px;background:linear-gradient(90deg,${it.ramp[0]},${it.ramp[2]})"></span>`);

  h += lab('INLAY SHAPE');
  h += '<div style="display:flex;gap:5px;flex-wrap:wrap">' + INLAY_SHAPES.map(sh =>
    `<button class="look-inlay" data-v="${sh}" style="border:1px solid ${d.inlay === sh ? '#8877dd' : '#3a3a3a'};background:${d.inlay === sh ? 'rgba(136,119,221,.14)' : 'rgba(255,255,255,.02)'};color:${d.inlay === sh ? '#bbaaee' : '#999'};border-radius:7px;padding:5px 9px;font-family:inherit;font-size:calc(9.5px*var(--ui));cursor:pointer">${INLAY_LABEL[sh] || sh}</button>`).join('') + '</div>';

  h += lab('INLAY MATERIAL');
  h += swatchRow(INLAY_STOCK, it => (d.inlayFill || []).join() === it.ramp.join(), 'look-inlayfill',
    it => `<span style="display:block;width:34px;height:16px;border-radius:3px;background:linear-gradient(135deg,${it.ramp[0]},${it.ramp[2]})"></span>`);

  h += `<div class="mono" style="color:#666;font-size:calc(9px*var(--ui));margin-top:9px;line-height:1.5">Changes land on the neck as you pick them, and stay with the ${instName}.</div>`;
  return h + '</div>';
}
function wireLookEditor(el) {
  const rerender = () => renderHelp('loadout');
  el.querySelector('#look-close')?.addEventListener('click', () => { lookDraft = null; rerender(); });
  el.querySelector('#look-reset')?.addEventListener('click', () => {
    clearLook(currentInstrument);
    lookDraft = lookFromTheme(FRETBOARD_THEMES[currentTheme] || FRETBOARD_THEMES.gibson, currentInstrument);
    buildInstrumentView(); updateOverlays(); rerender();
  });
  const set = (k, v) => { lookDraft[k] = v; applyDraft(); rerender(); };
  el.querySelectorAll('.look-wood').forEach(b => b.addEventListener('click', () => set('wood', [...WOOD_STOCK[+b.dataset.i].ramp])));
  el.querySelectorAll('.look-string').forEach(b => b.addEventListener('click', () => set('stringColor', [...STRING_STOCK[+b.dataset.i].pair])));
  el.querySelectorAll('.look-wire').forEach(b => b.addEventListener('click', () => set('fretWire', [...WIRE_STOCK[+b.dataset.i].ramp])));
  el.querySelectorAll('.look-inlayfill').forEach(b => b.addEventListener('click', () => set('inlayFill', [...INLAY_STOCK[+b.dataset.i].ramp])));
  el.querySelectorAll('.look-inlay').forEach(b => b.addEventListener('click', () => set('inlay', b.dataset.v)));
  // The stain sliders restain the CURRENT wood live. The base ramp is captured
  // once per drag, or repeated moves would compound into mud.
  let baseWood = null;
  const stain = () => {
    if (!baseWood) baseWood = [...(lookDraft.wood || [])];
    const hue = +(el.querySelector('#look-hue')?.value || 0);
    const light = +(el.querySelector('#look-light')?.value || 0);
    lookDraft.wood = restain(baseWood, hue, light);
    applyDraft();
  };
  ['#look-hue', '#look-light'].forEach(sel => {
    const n = el.querySelector(sel);
    if (!n) return;
    n.addEventListener('input', stain);
    n.addEventListener('change', () => { baseWood = null; rerender(); });
  });
  el.querySelectorAll('.look-pmode').forEach(b => b.addEventListener('click', () => {
    lookDraft.piano = { ...(lookDraft.piano || {}), mode: b.dataset.v };
    if (!lookDraft.piano.keyColors) lookDraft.piano.keyColors = NOTES.map(n => pcColor(n, 70, 62));
    applyDraft(); rerender();
  }));
  el.querySelectorAll('.look-pkey').forEach(inp => inp.addEventListener('input', () => {
    const cols = [...(lookDraft.piano?.keyColors || NOTES.map(n => pcColor(n, 70, 62)))];
    cols[+inp.dataset.i] = inp.value;
    lookDraft.piano = { ...(lookDraft.piano || {}), keyColors: cols };
    applyDraft();
  }));
}

function renderLoadout(el) {
  // The ticks have to show the board you actually have. Seeded from a constant,
  // a re-run offered to add pedals you already own (and pretended not to know
  // about anything you'd added since) — which is how a board ends up doubled.
  // First run has no board yet, so it opens on the starter kit.
  const seed = loadoutDone() ? [...new Set((loadState()?.pedals || []).map(p => p.type))] : [];
  const s = loadout || (loadout = {
    tuning: null,
    pedals: new Set(seed.length ? seed : LOADOUT_STARTERS),
    // don't hide a ticked pedal behind "＋ show every pedal"
    more: seed.some(t => !LOADOUT_STARTERS.includes(t)),
    touched: new Set(),
  });
  const presets = TUNING_PRESETS[currentInstrument] || [];
  const shop     = CATALOG.filter(c => !c.studioOnly);
  const starters = shop.filter(c => LOADOUT_STARTERS.includes(c.type));
  const rest     = shop.filter(c => !LOADOUT_STARTERS.includes(c.type));
  // The tuning row highlights your pick, or the preset the neck already matches.
  const livePreset = presets.find(p => p.strings.length === customTuning.length &&
    p.strings.every((x, i) => x.note === customTuning[i].note && x.octave === customTuning[i].octave));
  const activeTuning = s.tuning || livePreset?.name || '';

  const step = (n, label, hint, inner) => `
    <div style="margin-bottom:18px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
        <span class="mono" style="color:#8877dd;font-size:calc(11px*var(--ui));font-weight:800">${n}</span>
        <span class="mono" style="color:#ddd;font-size:calc(11px*var(--ui));font-weight:800;letter-spacing:1.5px">${label}</span>
        <span style="color:#777;font-size:calc(10.5px*var(--ui))">${hint}</span>
      </div>
      ${inner}
    </div>`;
  const grid = (min, inner) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr));gap:8px">${inner}</div>`;
  const pick = (cls, attr, on, inner) => `<button class="${cls}" ${attr} data-on="${on ? 1 : 0}" style="display:block;width:100%;text-align:left;padding:9px 10px;border-radius:10px;cursor:pointer;font-family:inherit;transition:all .15s;border:1px solid ${on ? '#8877dd' : '#333'};background:${on ? 'rgba(136,119,221,.15)' : 'rgba(255,255,255,.03)'}">${inner}</button>`;

  let body = `<div style="color:#bbb;font-size:calc(13px*var(--ui));line-height:1.7;margin-bottom:14px">Set up your kit before the first note — instrument, the look of the neck, a tuning, and the pedals you want on your board. Nothing here is locked in; all of it changes later from the top bar and <b style="color:#ddd">+ PEDALS</b>.</div>`;

  // progress rail: one segment per step, filled once you've made that choice
  body += `<div id="loadout-rail" style="display:flex;align-items:center;gap:6px;margin-bottom:20px">
    ${LOADOUT_STEPS.map(k => `<div data-step="${k}" data-on="${s.touched.has(k) ? 1 : 0}" style="flex:1;height:4px;border-radius:2px;background:${s.touched.has(k) ? '#8877dd' : '#2a2a2a'}"></div>`).join('')}
    <span class="mono" style="color:#666;font-size:calc(9px*var(--ui));letter-spacing:1px;white-space:nowrap">${s.touched.size} OF 4</span>
  </div>`;

  body += step(1, 'INSTRUMENT', 'What are you playing?', grid(112, LOADOUT_INSTRUMENTS.map(i => {
    const on = currentInstrument === i.id;
    return pick('loadout-inst', `data-inst="${i.id}"`, on,
      `<div style="display:flex;align-items:center;gap:6px"><span style="font-size:calc(15px*var(--ui))">${i.icon}</span><span class="mono" style="color:${on ? '#bbaaee' : '#ccc'};font-size:calc(11px*var(--ui));font-weight:800">${i.label}</span></div>
       <div style="color:#777;font-size:calc(9.5px*var(--ui));margin-top:3px">${i.note}</div>`);
  }).join('')));

  // ✏️ Customize sits with the presets: a look IS a preset plus your edits, and
  // it is saved against this instrument only.
  const customOn = !!lookDraft || hasLook(currentInstrument);
  const customCard = pick('loadout-custom', '', customOn,
    `<div style="height:26px;border-radius:5px;border:1px dashed ${customOn ? '#8877dd' : '#4a4a4a'};display:flex;align-items:center;justify-content:center;background:rgba(136,119,221,.06)">
       <span style="font-size:calc(13px*var(--ui))">✏️</span></div>
     <div class="mono" style="color:${customOn ? '#bbaaee' : '#bbb'};font-size:calc(10px*var(--ui));font-weight:700;margin-top:5px">Customize</div>`);
  const lookPanel = lookDraft ? lookEditorHTML() : '';

  body += step(2, 'THE LOOK', 'Wood, strings and inlays.', grid(96, Object.entries(FRETBOARD_THEMES).map(([k, t]) => {
    const on = currentTheme === k;
    const strings = [0, 1, 2].map(n => `<div style="height:1px;background:${n === 2 ? t.stringColor[1] : t.stringColor[0]};opacity:.8"></div>`).join('');
    return pick('loadout-theme', `data-theme="${k}"`, on,
      `<div style="height:26px;border-radius:5px;border:1px solid ${t.border};background:linear-gradient(180deg,${t.wood[0]},${t.wood[3]});display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 0;overflow:hidden">${strings}</div>
       <div class="mono" style="color:${on ? '#bbaaee' : '#bbb'};font-size:calc(10px*var(--ui));font-weight:700;margin-top:5px">${t.name}</div>`);
  }).join('') + customCard) + lookPanel);

  const isHex = INSTRUMENTS[currentInstrument]?.renderer === 'hex';
  const tuningInner = isHex
    // a layout card names its three directions, because that IS the layout
    ? grid(150, Object.entries(HEX_LAYOUTS).map(([k, L]) => {
        const on = hexLayout === k;
        return pick('loadout-layout', `data-layout="${k}"`, on,
          `<span class="mono" style="color:${on ? '#bbaaee' : '#ccc'};font-size:calc(11px*var(--ui));font-weight:800">${L.name}</span>
           <div class="mono" style="color:#777;font-size:calc(9.5px*var(--ui));margin-top:3px">${L.note}</div>`);
      }).join(''))
    : presets.length
    ? grid(112, presets.map(p => {
        const on = activeTuning === p.name;
        return pick('loadout-tuning', `data-tuning="${p.name}"`, on,
          `<span class="mono" style="color:${on ? '#bbaaee' : '#ccc'};font-size:calc(11px*var(--ui));font-weight:800">${p.name}</span>
           <div class="mono" style="color:#777;font-size:calc(9.5px*var(--ui));margin-top:3px">${p.strings.slice().reverse().map(x => x.note).join(' ')}</div>`);
      }).join(''))
    : `<div style="color:#666;font-size:calc(11.5px*var(--ui))">No tuning to set for ${INSTRUMENTS[currentInstrument]?.name || 'this instrument'} — carry on.</div>`;
  body += step(3, isHex ? 'LAYOUT' : 'TUNING', isHex ? 'Which interval each direction means. Wicki-Hayden puts a fifth straight up-right.' : 'Standard is right if you’re not sure.', tuningInner);

  let pedalInner = grid(196, starters.map(loadoutPedalCard).join(''));
  pedalInner += `<button id="loadout-more" class="mono" style="margin-top:9px;background:rgba(255,255,255,.03);border:1px solid #333;border-radius:8px;color:#999;font-size:calc(10px*var(--ui));letter-spacing:.5px;padding:7px 12px;cursor:pointer">${s.more ? '− Hide the rest' : `＋ Show every pedal (${rest.length} more)`}</button>`;
  if (s.more) pedalInner += `<div style="margin-top:9px">${grid(196, rest.map(loadoutPedalCard).join(''))}</div>`;
  body += step(4, 'YOUR FIRST PEDALS', 'Tap to add or drop — these five cover the basics.', pedalInner);

  const n = s.pedals.size;
  el.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="color:#eee;font-size:calc(20px*var(--ui));font-weight:700;letter-spacing:1px">🎒 Pick your load-out</div>
          <div class="mono" style="color:#666;font-size:calc(10px*var(--ui));letter-spacing:2px;margin-top:2px">FOUR CHOICES AND YOU'RE PLAYING</div>
        </div>
        <button id="loadout-x" class="btn" title="Skip the load-out and read the guide instead" style="width:32px;height:32px;padding:0;font-size:calc(16px*var(--ui))">✕</button>
      </div>
      ${body}
      <!-- the way out rides along as you scroll the steps — never below the fold -->
      <div style="position:sticky;bottom:-20px;padding:12px 0 16px;background:rgba(9,9,9,.97);border-top:1px solid #262626">
        <div style="display:flex;align-items:center;gap:12px">
          <button id="loadout-start" class="mono" style="flex:1;padding:11px;border-radius:9px;border:1px solid #8877dd;background:rgba(136,119,221,.2);color:#d3c8ff;font-size:calc(12px*var(--ui));font-weight:800;letter-spacing:1.5px;cursor:pointer">▶ START PLAYING</button>
          <button id="loadout-skip" class="mono" style="background:none;border:none;color:#666;font-size:calc(10px*var(--ui));letter-spacing:1px;cursor:pointer;text-decoration:underline">skip this</button>
        </div>
        <div class="mono" style="color:#666;font-size:calc(9.5px*var(--ui));margin-top:8px;text-align:center">${n} pedal${n === 1 ? '' : 's'} going on your board</div>
      </div>
    </div>`;

  el.querySelectorAll('.loadout-inst').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.inst;
    // a look you haven't chosen yourself follows the instrument — pick banjo, get banjo wood
    if (!s.touched.has('look')) setCurrentTheme(INST_DEFAULT_THEME[id] || 'gibson');
    loadoutSetInstrument(id);
    s.tuning = null;
    s.touched.add('inst');
    renderHelp('loadout');
  }));
  el.querySelectorAll('.loadout-theme').forEach(b => b.addEventListener('click', () => {
    loadoutSetTheme(b.dataset.theme);
    s.touched.add('look');
    renderHelp('loadout');
  }));
  el.querySelector('.loadout-custom')?.addEventListener('click', () => {
    lookDraft = lookDraft ? null
      : lookFromTheme(FRETBOARD_THEMES[currentTheme] || FRETBOARD_THEMES.gibson, currentInstrument);
    if (lookDraft) { s.touched.add('look'); applyDraft(); }
    renderHelp('loadout');
  });
  if (lookDraft) wireLookEditor(el);
  el.querySelectorAll('.loadout-tuning').forEach(b => b.addEventListener('click', () => {
    loadoutSetTuning(b.dataset.tuning);
    s.tuning = b.dataset.tuning;
    s.touched.add('tuning');
    renderHelp('loadout');
  }));
  el.querySelectorAll('.loadout-layout').forEach(b => b.addEventListener('click', () => {
    loadoutSetLayout(b.dataset.layout);
    s.touched.add('tuning');
    renderHelp('loadout');
  }));
  el.querySelectorAll('.loadout-pedal').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.type;
    if (s.pedals.has(t)) s.pedals.delete(t); else s.pedals.add(t);
    s.touched.add('pedals');
    renderHelp('loadout');
  }));
  document.getElementById('loadout-more')?.addEventListener('click', () => { s.more = !s.more; renderHelp('loadout'); });

  // Every way out is honoured; only ▶ Start hands the pedal list over.
  const leave = close => { markLoadoutDone(); loadout = null; if (close) el.classList.remove('open'); renderHelp('guide'); };
  document.getElementById('loadout-start')?.addEventListener('click', () => {
    const chosen = [...s.pedals];
    leave(true);
    window.dispatchEvent(new CustomEvent('resonote:loadout', { detail: { pedals: chosen } }));
  });
  document.getElementById('loadout-skip')?.addEventListener('click', () => leave(true));
  document.getElementById('loadout-x')   ?.addEventListener('click', () => leave(false));
  el.onclick = e => { if (e.target === el) leave(true); };
}

function loadoutPedalCard(pd) {
  const on   = loadout.pedals.has(pd.type);
  const dark = darkenHex(pd.color || '#1a1a1a', 15);
  const tier = pd.tier && pd.tier !== 'free' ? ` <span class="mono" style="font-size:calc(7.5px*var(--ui));color:#ffc832;border:1px solid rgba(255,200,50,.3);border-radius:4px;padding:0 3px;vertical-align:1px">${pd.tier.toUpperCase()}</span>` : '';
  return `<button class="loadout-pedal" data-type="${pd.type}" data-on="${on ? 1 : 0}"
       style="display:block;width:100%;text-align:left;padding:10px;border-radius:10px;cursor:pointer;font-family:inherit;transition:all .15s;border:1px solid ${on ? pd.accent : '#2c2c2c'};background:linear-gradient(135deg,${pd.color},${dark});opacity:${on ? 1 : .5}">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:calc(14px*var(--ui))">${pd.icon}</span>
      <span class="mono" style="color:${pd.accent};font-size:calc(10.5px*var(--ui));font-weight:800;flex:1">${pd.title}${tier}</span>
      <span class="mono" style="color:${on ? pd.accent : '#666'};font-size:calc(12px*var(--ui));font-weight:800">${on ? '✓' : '＋'}</span>
    </div>
    <div style="color:#8c8c8c;font-size:calc(9.5px*var(--ui));line-height:1.45;margin-top:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${pd.desc}</div>
  </button>`;
}
