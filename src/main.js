import { audio } from './core/audio.js';
import { setCurrentInstrument, setCustomTuning, applyTuning, currentInstrument, customTuning, INSTRUMENTS } from './core/tuning.js';
import { loadState, saveState, setShowIntervals, setShowNoteMap, chordHighlight, pedalBus, metroClock, fretboardView } from './core/state.js';
import { buildInstrumentView, buildTuningBar, updateOverlays, setCurrentTheme, INST_DEFAULT_THEME, setLastClickedNote, fretX, geo, pianoGeo, PIANO_BLACK, PIANO_BLACK_POS, PIANO_WHITE } from './ui/fretboard.js';
import { renderHeader, renderInstrumentBar, renderInstrumentDisplay, renderCatalog, renderHelp } from './ui/header.js';
import { createPedalElement, bringToFront, LINK_PROFILE } from './ui/pedal-system.js';
import { buildPositionBar, isDefining, addShapeFret } from './ui/position-bar.js';
import { buildContent, CATALOG } from './pedals/index.js';
import { renderVocalsDisplay } from './pedals/vocals.js';

// ── Drill routing: send a Theory-Path drill to the pedal that fits its TYPE ──
// (NOTES is imported lower in this file; imports are hoisted so it's available here.)
function scaleFromNotes(prog, root) {
  const noteSet = [...new Set(prog.map(c => c.root).filter(Boolean))];
  const ri = NOTES.indexOf(root);
  const cands = [
    ['Diatonic', 'Major', [0,2,4,5,7,9,11]], ['Diatonic', 'Nat. Minor', [0,2,3,5,7,8,10]],
    ['Modes', 'Mixolydian', [0,2,4,5,7,9,10]], ['Modes', 'Dorian', [0,2,3,5,7,9,10]],
    ['Pentatonic', 'Major Pent.', [0,2,4,7,9]], ['Pentatonic', 'Minor Pent.', [0,3,5,7,10]],
  ];
  for (const [cat, name, iv] of cands) {
    const set = new Set(iv.map(i => NOTES[(ri + i + 12) % 12]));
    if (noteSet.length && noteSet.every(n => set.has(n))) return { cat, name };
  }
  return { cat: 'Diatonic', name: 'Major' };
}
function progressionGrid(d) {
  const bpb = Math.max(1, metroClock.ts || 4), cells = [];
  d.progression.forEach(c => { cells.push({ root: c.root, quality: c.quality, numeral: c.numeral || '' }); for (let i = 1; i < Math.max(1, c.beats || 2); i++) cells.push(null); });
  while (cells.length % bpb !== 0) cells.push(null);
  return { progMode: 'custom', gridBars: Math.max(1, cells.length / bpb), customGrid: cells, root: d.progression[0]?.root || 'C', _autoStart: true };
}
function chordLabel(c) {
  if (!c) return 'C';
  const q = c.quality || 'Major';
  const suf = q === 'Major' ? '' : q === 'Minor' ? 'm' : q === 'Dim' ? 'dim' : q === 'Aug' ? 'aug'
    : /Maj7/.test(q) ? 'maj7' : /Min7|m7/.test(q) ? 'm7' : /7/.test(q) ? '7' : '';
  return c.root + suf;
}
// Pick the scale a note/solo drill should display, reading the lesson's own words first.
function deriveScale(d, root) {
  const sig = ((d.title || '') + ' ' + (d.focus || '') + ' ' + (d.voicing || '')).toLowerCase();
  if (/blue note|blues/.test(sig))     return { cat: 'Blues', name: /major/.test(sig) ? 'Blues Major' : 'Blues Minor' };
  if (/pentatonic|\bpent\b/.test(sig)) return { cat: 'Pentatonic', name: (/major/.test(sig) && !/minor/.test(sig)) ? 'Major Pent.' : 'Minor Pent.' };
  if (/dorian/.test(sig))              return { cat: 'Modes', name: 'Dorian' };
  if (/mixolydian/.test(sig))          return { cat: 'Modes', name: 'Mixolydian' };
  if (/phrygian/.test(sig))            return { cat: 'Modes', name: 'Phrygian' };
  if (/lydian/.test(sig))              return { cat: 'Modes', name: 'Lydian' };
  if (/locrian/.test(sig))             return { cat: 'Modes', name: 'Locrian' };
  if (/harmonic minor/.test(sig))      return { cat: 'Diatonic', name: 'Harm. Minor' };
  if (/melodic minor/.test(sig))       return { cat: 'Diatonic', name: 'Mel. Minor' };
  if (/\bminor\b|aeolian/.test(sig))   return { cat: 'Diatonic', name: 'Nat. Minor' };
  return scaleFromNotes(d.progression || [], root);
}
function routeDrill(d) {
  const sig = ((d.voicing || '') + ' ' + (d.pattern || '') + ' ' + (d.focus || '') + ' ' + (d.title || '')).toLowerCase();
  const prog = Array.isArray(d.progression) ? d.progression : [];
  const root = prog[0]?.root || 'C';
  // Alphabet / musical-alphabet climb → Technique Workshop · Positions tab, as a
  // FIXED base drill: A natural minor single-string climb at 120 BPM. (Transposing
  // a drill to the Circle-of-Fifths key is a later, per-drill opt-in — not the default.)
  if (/alphabet/.test(sig)) {
    return { type: 'workshop', bpm: 120, settings: { ws_tab: 'positions', _autoStartTab: 'positions', mode: 'scales', root: 'A', scaleCat: 'Diatonic', scaleName: 'Nat. Minor', direction: 'cycle', advanceMode: 'auto', pathMode: 'string', startOnRoot: true, _autoStart: true } };
  }
  // fingerstyle / Travis → Technique Workshop · Finger tab (the picking-hand drill)
  if (/fingerstyle|p-?i-?m-?a|travis|rolling arpegg|boom-chick/.test(sig)) {
    return { type: 'workshop', settings: { ws_tab: 'finger', fingerInst: 'guitar', fChordMode: 'chord', fChordRoot: chordLabel(prog[0]), _autoStart: true } };
  }
  // scale run / pentatonic box / solo → Technique Workshop · Positions tab (auto-climbs the scale at tempo)
  if (/scale run|scale ascending|box \d|pentatonic|\bsolo\b|up-and-down|five boxes|blue note|phrasing/.test(sig)) {
    let sc = deriveScale(d, root);
    if (sc.name === 'Major' && prog[0]?.quality === 'Minor') sc = { cat: 'Pentatonic', name: 'Minor Pent.' };
    return { type: 'workshop', settings: { ws_tab: 'positions', mode: 'scales', root, scaleCat: sc.cat, scaleName: sc.name, direction: 'cycle', advanceMode: 'auto', _autoStart: true } };
  }
  // single-note / interval foundation → Scale & Arpeggio Explorer (show the scale)
  if (/single note|one note|single-note|two-note|interval|half[- ]step|whole[- ]step|chromatic|scale degree|one string|octave/.test(sig)) {
    const sc = deriveScale(d, root);
    return { type: 'scales', settings: { saMode: 'scales', root, scaleCat: sc.cat, scaleName: sc.name, saView: 'positions' } };
  }
  // default: a chord progression → Progression Studio (plays the changes)
  return { type: 'progression', settings: progressionGrid(d) };
}

// ── App state ────────────────────────────────────────────────────────
let pedals = [
  // Classic Resonote default…
  { id:'audio-1',    type:'audio',     x:10,   y:10,  w:230, h:300 },
  { id:'tuner-1',    type:'tuner',     x:10,   y:320, w:230, h:260 },
  { id:'metro-1',    type:'metronome', x:250,  y:10,  w:260, h:480 },
  { id:'c5-1',       type:'circle5',   x:480,  y:10,  w:300, h:460 },
  // …plus the two learning pedals we're actively building, open to the right.
  { id:'theory-1',   type:'theory',    x:800,  y:10,  w:470, h:690 },
  { id:'chordlab-1', type:'chordlab',  x:1290, y:10,  w:440, h:660 }
];

const START_KEY = { root:'C', keyType:'Major' };

function getLearningDefaults(type) {
  const base = { root: START_KEY.root };
  const defaults = {
    circle5:     { selKey:0, selMinor:false },
    chords:      { ...base, keyMode:START_KEY.keyType, chordType:'Major', chordCat:'Triads' },
    scales:      { ...base, scaleCat:'Diatonic', scaleName:'Major' },
    arpeggios:   { ...base, arpCat:'Triads', arpName:'Major' },
    progression: { ...base, keyType:START_KEY.keyType },
    runner:      { ...base, scaleCat:'Diatonic', scaleName:'Major', arpCat:'Triads', arpName:'Major' },
    finger:      { fingerRoot:START_KEY.root, fChordRoot:START_KEY.root },
    practice:    { root:START_KEY.root },
    songdir:     { addKey:START_KEY.root },
  };
  return defaults[type] || {};
}

function normalizePedalToStartKey(p, force = false) {
  const defaults = getLearningDefaults(p.type);
  if (!Object.keys(defaults).length) return p;
  const settings = p.settings || {};
  p.settings = force ? { ...settings, ...defaults } : { ...defaults, ...settings };
  return p;
}

function normalizePedalsToStartKey(force = false) {
  pedals = pedals.map(p => normalizePedalToStartKey(p, force));
}

// ── Restore saved state ───────────────────────────────────────────────
// Pedals that were merged into others. Migrate saved boards on load so BOTH the
// card chrome (CATALOG.find by p.type) and the body resolve — not just the body.
const LEGACY_MIGRATE = {
  arpeggios: { type: 'scales',   set: { saMode: 'arps' } },
  notequiz:  { type: 'ear',      set: { fetGroup: 'theory' } },
  runner:    { type: 'workshop', set: { ws_tab: 'positions' } },
  rhythm:    { type: 'workshop', set: { ws_tab: 'groove' } },
  finger:    { type: 'workshop', set: { ws_tab: 'finger' } },
  technique: { type: 'workshop', set: { ws_tab: 'technique' } },
};
const WORKSHOP_TAB_OF = { runner: 'positions', rhythm: 'groove', finger: 'finger', technique: 'technique' };
function migrateLegacyPedal(p) {
  const m = LEGACY_MIGRATE[p.type];
  if (!m) return p;
  p.settings = p.settings || {};
  Object.entries(m.set).forEach(([k, v]) => { if (p.settings[k] === undefined) p.settings[k] = v; });
  p.type = m.type;
  return p;
}

function restoreState() {
  const state = loadState();
  if (!state) return;
  if (state.pedals?.length) pedals = state.pedals.map(p => migrateLegacyPedal({ ...p, settings: p.settings || {} }));
  if (state.display) {
    const d = state.display;
    if (d.currentInstrument && INSTRUMENTS[d.currentInstrument]) {
      setCurrentInstrument(d.currentInstrument);
      setCurrentTheme(INST_DEFAULT_THEME[d.currentInstrument] || 'gibson');
    }
    if (d.showIntervals !== undefined) setShowIntervals(d.showIntervals);
    if (d.showNoteMap   !== undefined) setShowNoteMap(d.showNoteMap);
    if (d.customTuning && d.customTuning.length) {
      setCustomTuning(d.customTuning);
    } else if (INSTRUMENTS[d.currentInstrument]?.strings?.length) {
      applyTuning(INSTRUMENTS[d.currentInstrument].strings);
    }
    if (d.currentTheme)                setCurrentTheme(d.currentTheme);
  }
}

// ── Persist state ─────────────────────────────────────────────────────
function save() {
  saveState(pedals, {
    currentInstrument,
    showIntervals:  false,
    showNoteMap:    false,
    customTuning:   customTuning.length ? customTuning.map(s => ({ note: s.note, octave: s.octave })) : null,
    currentTheme:   INST_DEFAULT_THEME[currentInstrument]
  });
}
window.addEventListener('beforeunload', save);

// ── Add a pedal ────────────────────────────────────────────────────────
function addPedal(type) {
  const entry   = CATALOG.find(c => c.type === type);
  const id      = type + '-' + Date.now();
  const existing = pedals.filter(p => p.type === type).length;
  const p = {
    id, type,
    x: 20 + existing * 20,
    y: 20 + existing * 20,
    w: entry?.w || 280,
    h: entry?.h || 400,
    settings: getLearningDefaults(type)
  };
  pedals.push(p);
  mountPedal(p);
  save();
  renderSessionBar();
  document.getElementById('catalog-drawer')?.classList.remove('open');
}

// ── Mount a pedal to the DOM ──────────────────────────────────────────
function mountPedal(p) {
  const container = document.getElementById('pedals-container');
  if (!container) return;

  const entry = CATALOG.find(c => c.type === p.type);
  const el    = createPedalElement(
    p, entry,
    (id) => { pedals = pedals.filter(x => x.id !== id); save(); renderSessionBar(); },
    (id, isMin) => { const pd = pedals.find(x => x.id === id); if (pd) pd.minimized = isMin; save(); },
    (id, x, y)  => { const pd = pedals.find(x => x.id === id); if (pd) { pd.x = x; pd.y = y; } save(); },
    (id, w, h)  => { const pd = pedals.find(x => x.id === id); if (pd) { pd.w = w; pd.h = h; } save(); }
  );
  container.appendChild(el);
  buildContent(p);
}

// ── Zoom control ───────────────────────────────────────────────────────
let boardZoom = 1.0;
function renderZoomControl() {
  const el = document.getElementById('board-zoom-ctrl');
  if (!el) return;
  el.innerHTML = `
    <button id="zoom-out" class="mono" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px">−</button>
    <span class="mono" style="color:#666;font-size:10px;min-width:36px;text-align:center">${Math.round(boardZoom * 100)}%</span>
    <button id="zoom-in"  class="mono" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px">+</button>
    <button id="zoom-rst" class="mono" style="background:none;border:none;color:#555;cursor:pointer;font-size:9px;letter-spacing:1px">RESET</button>`;

  document.getElementById('zoom-out')?.addEventListener('click', () => setZoom(Math.max(0.4, boardZoom - 0.1)));
  document.getElementById('zoom-in') ?.addEventListener('click', () => setZoom(Math.min(2.0, boardZoom + 0.1)));
  document.getElementById('zoom-rst')?.addEventListener('click', () => setZoom(1.0));
}

function setZoom(z) {
  boardZoom = z;
  const pc = document.getElementById('pedals-container');
  if (pc) pc.style.transform = `scale(${z})`;
  renderZoomControl();
}

// ── Mode switch ────────────────────────────────────────────────────────
function switchMode(mode) {
  const practiceEls = document.querySelectorAll('.practice-el, #instrument-bar, #instrument-display, #board-area');
  const studioEl    = document.getElementById('studio-mode');
  const btnP = document.getElementById('btn-mode-practice');
  const btnS = document.getElementById('btn-mode-studio');

  if (mode === 'studio') {
    practiceEls.forEach(el => el.style.display = 'none');
    if (studioEl) studioEl.style.display = 'flex';
    btnP?.classList.remove('active-green'); btnS?.classList.add('active-green');
    import('./studio/studio-mode.js').then(m => m.initStudio());
  } else {
    practiceEls.forEach(el => el.style.display = '');
    if (studioEl) studioEl.style.display = 'none';
    btnP?.classList.add('active-green'); btnS?.classList.remove('active-green');
  }
}

// ── Fretboard click dispatch ───────────────────────────────────────────
import { playClickedNote } from './core/audio.js';
import { getNoteAtFret, getInst } from './core/tuning.js';
import { NOTES } from './core/music-theory.js';

let onFretboardClick = null;
export function setFretboardClickHandler(fn) { onFretboardClick = fn; }

// ── Interval Explorer (the 📏 fretboard view) ───────────────────────────
const ITV_NAMES = ['Unison','minor 2nd','Major 2nd','minor 3rd','Major 3rd','Perfect 4th','Tritone','Perfect 5th','minor 6th','Major 6th','minor 7th','Major 7th','Octave'];
let intervalPicks = [];
function renderIntervalPicks() {
  const ov = document.getElementById('note-ov'), rd = document.getElementById('note-readout');
  if (!ov) return;
  const g = geo();
  let h = '';
  intervalPicks.forEach(p => {
    if (p.si === undefined || p.fret === undefined) return;
    const y = g.sy(p.si), cx = g.fm(p.fret);
    h += `<g filter="url(#ngf)"><circle cx="${cx}" cy="${y}" r="12" fill="#ffd23f" stroke="#fff" stroke-width="2"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="9" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#241c00" style="pointer-events:none">${p.note}</text></g>`;
  });
  if (intervalPicks.length === 2 && intervalPicks.every(p => p.si !== undefined)) {
    const [a, b] = intervalPicks;
    h += `<line x1="${g.fm(a.fret)}" y1="${g.sy(a.si)}" x2="${g.fm(b.fret)}" y2="${g.sy(b.si)}" stroke="#ffd23f" stroke-width="2" stroke-dasharray="5,3" opacity=".7"/>`;
  }
  ov.innerHTML = h;
  if (rd) {
    if (intervalPicks.length === 2) {
      const [a, b] = intervalPicks;
      const m1 = NOTES.indexOf(a.note) + (a.octave || 3) * 12, m2 = NOTES.indexOf(b.note) + (b.octave || 3) * 12;
      const semis = Math.abs(m2 - m1);
      const nm = ITV_NAMES[Math.min(semis, 12)] || `${semis} semitones`;
      rd.innerHTML = `<span class="mono" style="color:#ffd23f;font-size:18px;font-weight:800">${a.note} → ${b.note}</span><span class="mono" style="color:#dfe;font-size:13px;margin:0 8px">${nm}</span><span class="mono" style="color:#789;font-size:11px">${semis} semitone${semis !== 1 ? 's' : ''}</span>`;
    } else {
      rd.innerHTML = `<span class="mono" style="color:#ffd23f;font-size:12px">📏 Interval Explorer</span><span class="mono" style="color:#789;font-size:11px;margin-left:8px">click two notes to measure the interval${intervalPicks.length ? ' · 1 picked' : ''}</span>`;
    }
  }
}

function dispatchFretboardClick(info) {
  // While defining a custom hand-shape, clicks build the shape instead of playing.
  if (isDefining() && info.si !== undefined && info.fret !== undefined) {
    addShapeFret(info.si, info.fret);
    return;
  }
  // Interval Explorer: clicks pick up to two notes and measure between them.
  if (fretboardView === 'interval' && info.si !== undefined && info.fret !== undefined) {
    playClickedNote(info.note, info.octave || 3);
    const i = intervalPicks.findIndex(p => p.si === info.si && p.fret === info.fret);
    if (i >= 0) intervalPicks.splice(i, 1);
    else { intervalPicks.push(info); if (intervalPicks.length > 2) intervalPicks.shift(); }
    renderIntervalPicks();
    return;
  }
  playClickedNote(info.note, info.octave || 3);
  setLastClickedNote(info);
  updateOverlays();
  if (onFretboardClick) onFretboardClick(info);
}

// Convert a mouse/touch event to SVG coordinate space using the element's
// own transform matrix — correct regardless of scale, max-height, or CSS layout.
function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function wireFretboardClick() {
  const svg = document.getElementById('fb-svg');
  if (!svg) return;
  svg.addEventListener('click', e => {
    const inst = getInst();
    const { x: mx, y: my } = svgPoint(svg, e.clientX, e.clientY);

    if (inst.renderer === 'keyboard') {
      const g = pianoGeo();

      // Black keys first (they sit on top of white keys)
      for (let o = g.startOct; o < g.startOct + g.octs; o++) {
        for (let bi = 0; bi < PIANO_BLACK_POS.length; bi++) {
          const wBase = (o - g.startOct) * 7;
          const kx = g.whiteX(wBase) + PIANO_BLACK_POS[bi] * g.kw - g.bkw / 2 + g.kw / 2;
          if (mx >= kx && mx <= kx + g.bkw && my >= 10 && my <= 10 + g.bkh) {
            dispatchFretboardClick({ note: NOTES[PIANO_BLACK[bi]], octave: o }); return;
          }
        }
      }
      // White keys
      let wi = 0;
      for (let o = g.startOct; o < g.startOct + g.octs; o++) {
        for (let wsi = 0; wsi < PIANO_WHITE.length; wsi++) {
          const kx = g.whiteX(wi);
          if (mx >= kx && mx <= kx + g.kw - 2 && my >= 10 && my <= 10 + g.kh) {
            dispatchFretboardClick({ note: NOTES[PIANO_WHITE[wsi]], octave: o }); return;
          }
          wi++;
        }
      }
    } else if (inst.renderer === 'fretboard') {
      const g = geo();

      // Find closest string — reject if further than half a string-gap away
      let closestSi = 0, closestDist = Infinity;
      customTuning.forEach((s, si) => {
        const dist = Math.abs(my - g.sy(si));
        if (dist < closestDist) { closestDist = dist; closestSi = si; }
      });
      if (closestDist > g.ss * 0.6) return;

      // Find clicked fret.
      // Fret f occupies the space between fret wire f-1 (left) and fret wire f (right).
      // Iterate from the highest fret down and take the first one whose left wire
      // is at or before the click — this places the exact wire position as the
      // boundary between adjacent frets, matching physical guitar playing position.
      let closestFret = 0; // open string default
      for (let f = g.nf; f >= 1; f--) {
        if (mx >= g.nx + fretX[f - 1]) { closestFret = f; break; }
      }

      const { note } = getNoteAtFret(customTuning[closestSi].note, customTuning[closestSi].octave, closestFret);
      const oct = customTuning[closestSi].octave + Math.floor((NOTES.indexOf(customTuning[closestSi].note) + closestFret) / 12);
      dispatchFretboardClick({ note, octave: oct, fret: closestFret, si: closestSi });
    }
  });
}

// ── Session bar (home-base strip mirroring master Key + Tempo) ────────
function renderSessionBar() {
  const el = document.getElementById('session-bar');
  if (!el) return;
  const mk = pedalBus.masterKey || {};
  const activeTypes = pedals.map(p => p.type);
  const keyN   = pedalBus.followerCount(activeTypes);
  const tempoN = metroClock.followerCount(activeTypes);
  const keyTxt = mk.root ? `${mk.root} ${mk.keyType}` : '—';
  const sig = `${keyTxt}|${keyN}|${metroClock.bpm}|${metroClock.ts}|${metroClock.unit}|${tempoN}`;
  if (el._sig === sig) return;
  el._sig = sig;
  el.innerHTML = `
    <div style="flex:1;min-width:190px;display:flex;align-items:center;gap:7px;background:rgba(136,119,221,.06);border:1px solid rgba(136,119,221,.25);border-radius:7px;padding:4px 9px">
      <span style="font-size:12px">🔑</span>
      <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px">KEY</span>
      <span class="mono" style="color:#bbaaee;font-size:12px;font-weight:700">${keyTxt}</span>
      <span class="mono" style="color:#777;font-size:8px;margin-left:auto">driving ${keyN}</span>
      <button data-relink="key" style="background:rgba(136,119,221,.12);border:1px solid #8877dd55;color:#aa99dd;border-radius:4px;padding:2px 7px;font-size:8px;cursor:pointer">⟲ Re-link all</button>
    </div>
    <div style="flex:1;min-width:190px;display:flex;align-items:center;gap:7px;background:rgba(221,136,68,.06);border:1px solid rgba(221,136,68,.25);border-radius:7px;padding:4px 9px">
      <span style="font-size:12px">⏱</span>
      <span class="mono" style="color:#555;font-size:8px;letter-spacing:1px">TEMPO</span>
      <span class="mono" style="color:#e0a14a;font-size:12px;font-weight:700">♩=${metroClock.bpm} · ${metroClock.ts}/${metroClock.unit}</span>
      <span class="mono" style="color:#777;font-size:8px;margin-left:auto">driving ${tempoN}</span>
      <button data-relink="tempo" style="background:rgba(221,136,68,.12);border:1px solid #dd884455;color:#e0a14a;border-radius:4px;padding:2px 7px;font-size:8px;cursor:pointer">⟲ Re-link all</button>
    </div>`;
  el.querySelector('[data-relink="key"]')?.addEventListener('click', () => {
    activeTypes.forEach(t => { if (LINK_PROFILE[t]?.key) pedalBus.linkPedal(t); });
    if (pedalBus.masterKey.root) pedalBus.setKey(pedalBus.masterKey.root, pedalBus.masterKey.keyType, { source: 'session-bar' });
    renderSessionBar();
  });
  el.querySelector('[data-relink="tempo"]')?.addEventListener('click', () => {
    activeTypes.forEach(t => { if (LINK_PROFILE[t]?.tempo) metroClock.linkPedal(t); });
    renderSessionBar();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────
async function init() {
  restoreState();
  normalizePedalsToStartKey(true);
  pedalBus.setKey(START_KEY.root, START_KEY.keyType, { source:'app-init' });

  // Render shell UI
  renderHeader({
    onSave:    save,
    onCatalog: () => document.getElementById('catalog-drawer')?.classList.toggle('open'),
    onHelp:    () => { renderHelp(); document.getElementById('help-overlay')?.classList.add('open'); },
    onModeSwitch: switchMode
  });
  renderInstrumentDisplay();
  renderInstrumentBar();
  renderCatalog(CATALOG, addPedal);
  renderHelp();
  renderZoomControl();

  // Build instrument display
  buildInstrumentView();
  buildTuningBar(save);
  buildPositionBar();
  updateOverlays();

  // Wire fretboard click
  wireFretboardClick();

  // Register cross-pedal rebuild hook
  pedalBus.rebuildPedal = (type, settings) => {
    let pd = pedals.find(x => x.type === type);          // exact match first (a coexisting legacy instance still works)
    if (!pd) {
      // legacy deep-links → the merged pedal, opening the right tab/mode
      if (WORKSHOP_TAB_OF[type])      { pd = pedals.find(x => x.type === 'workshop'); if (pd) settings = { ...(settings || {}), _autoStartTab: WORKSHOP_TAB_OF[type] }; }
      else if (type === 'arpeggios')  { pd = pedals.find(x => x.type === 'scales');   if (pd) settings = { ...(settings || {}), saMode: 'arps' }; }
      else if (type === 'notequiz')   { pd = pedals.find(x => x.type === 'ear');      if (pd) settings = { ...(settings || {}), fetGroup: 'theory' }; }
    }
    if (!pd) return;
    if (settings) Object.assign(pd.settings || (pd.settings = {}), settings);
    buildContent(pd);
  };

  const raise = (id) => { const card = document.getElementById('pedal-' + id); if (card) { try { bringToFront(card); } catch (e) {} card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };

  // "Learn the theory →" from any pedal's smart Theory panel → open Theory Path at that lesson.
  window.addEventListener('resonote:open-lesson', e => {
    const lessonId = e.detail?.lessonId || null;
    let tp = pedals.find(x => x.type === 'theory');
    if (!tp) { addPedal('theory'); tp = pedals.find(x => x.type === 'theory'); }
    if (!tp) return;
    tp.settings = tp.settings || {};
    tp.settings._openLesson = lessonId;
    buildContent(tp);
    raise(tp.id);
    save();
  });

  // "Practice this drill" from a Theory Path lesson → open the pedal that fits the drill type.
  window.addEventListener('resonote:load-drill', e => {
    const d = e.detail?.drill; if (!d || !Array.isArray(d.progression)) return;
    const route = routeDrill(d);
    if (route.bpm) metroClock.set(route.bpm, Array.isArray(d.timeSig) ? d.timeSig[0] : (metroClock.ts || 4));
    let target = pedals.find(x => x.type === route.type);
    if (!target) { addPedal(route.type); target = pedals.find(x => x.type === route.type); }
    if (!target) return;
    target.settings = target.settings || {};
    Object.assign(target.settings, route.settings);
    buildContent(target);
    raise(target.id);
    save();
  });

  // Fretboard view switched → reset the Interval Explorer picks and refresh.
  window.addEventListener('resonote:fbview', e => {
    intervalPicks = [];
    if (e.detail?.view === 'interval') { metroClock.stopAll(); renderIntervalPicks(); }
    else updateOverlays();
  });

  // "Loop in Theory library" from a lesson → open the Practice Manager's Theory view at that drill.
  window.addEventListener('resonote:open-theory', e => {
    const lessonId = e.detail?.lessonId; if (!lessonId) return;
    let pm = pedals.find(x => x.type === 'practice');
    if (!pm) { addPedal('practice'); pm = pedals.find(x => x.type === 'practice'); }
    if (!pm) return;
    pm.settings = pm.settings || {};
    pm.settings._theoryOpenLesson = lessonId;
    buildContent(pm);
    raise(pm.id);
    save();
  });

  // Mount saved pedals
  pedals.forEach(p => mountPedal(p));

  // Session bar — mirror master Key + Tempo (cheap sig-guarded re-render)
  renderSessionBar();
  pedalBus.on(renderSessionBar);
  pedalBus.onLinks(renderSessionBar);
  metroClock.on(renderSessionBar);
  metroClock.onLinks(renderSessionBar);

  // Audio reactive overlays
  audio.on(() => {
    if (audio.detected) setLastClickedNote(null);
    updateOverlays();
  });

  // Show help on first visit
  if (!localStorage.getItem('resonote-seen')) {
    document.getElementById('help-overlay')?.classList.add('open');
    localStorage.setItem('resonote-seen', '1');
  }
}

init();
