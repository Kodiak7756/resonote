import { NOTES, KEY_PATTERNS, getKeyChords, getChordNotes, CHORD_TYPES, intervalLabel, toSharp } from '../core/music-theory.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { getSecondaryDominants, getBorrowedChords, getKeySeventhChords, catOfType, qualSuffix } from '../harmony/functional-harmony.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { pcColor, pcTextOn } from '../core/colors.js';

const CIRCLE_KEYS  = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'];
const CIRCLE_MINOR = ['Am','Em','Bm','F#m','C#m','G#m','Ebm','Bbm','Fm','Cm','Gm','Dm'];

// ── The two things in this file that are NOT chrome ───────────────────────────
// Everything else here wears kit tokens and follows the card's accent. These do
// not, and both refusals are deliberate.
//
// NECK is the fretboard's own ink. It is painted into the shared fretboard SVG,
// which sits OUTSIDE this pedal's card, so a kit token would resolve against the
// page rather than against this pedal and the overlay would come out unpainted.
// The three sets are the neck's language for what it is currently showing.
const NECK = {
  key:      { root:'#8877dd', tone:'#554488', rootStroke:'#aa99ee', toneStroke:'#7766bb' },
  scale:    { root:'#44bbcc', tone:'#2a7a8a', rootStroke:'#66ddee', toneStroke:'#3a9aaa' },
  arpeggio: { root:'#cc66aa', tone:'#884477', rootStroke:'#ee88cc', toneStroke:'#aa5588' },
};
// The trace wears the app's "sounding right now" gold — the same signal the step
// strip's playhead and the fretboard's chord dots speak. That is a cross-pedal
// language, so it must read identically in every pedal and cannot follow an accent.
const TRACE_GOLD = '#ffc830';
const traceGold  = a => `rgba(255,200,48,${a})`;

// Live trace: whatever the app PLAYS (drills, Sketchpad songs, imported tabs) is broadcast as
// 'resonote:played' — the circle lights each sounding note and draws the melody's path around
// the circle with a fading trail, so you SEE the tune's geometry (5ths hop to neighbours,
// steps zig-zag across, chords make shapes). One listener per pedal instance.
const _traceHandlers = {};

const CIRCLE_THEORY = {
  kicker: 'HARMONY', title: 'The Circle of Fifths — your map of keys',
  what: `Each step clockwise adds a sharp and moves up a <b>fifth</b>; counter-clockwise adds a flat. Neighbours on the circle share almost all their notes, so they sound closely related. The inner ring is each major key's <b>relative minor</b> — same notes, different home.`,
  why: `It's the master map for harmony: chords close together on the circle move smoothly, the chord a fifth away (the <b>V</b>) pulls strongly home, and you can <b>modulate</b> to a neighbour without a jolt. The Harmony view turns any key into its diatonic chords, secondary dominants and borrowed colours — tap one to light it on the neck and send it onward.`,
  lessonId: 'circle-of-fifths',
};

export function buildCircle5Content(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let selKey      = s.selKey !== undefined ? s.selKey : 0;
  let selMinor    = !!s.selMinor;
  let selChordIdx = null;
  let c5View      = s.c5View || 'chords';
  let harm7       = !!s.harm7;          // diatonic 7ths toggle in Harmony view
  let selHarm     = null;               // { kind:'dia'|'sec'|'bor', idx }
  let harmLists   = { dia: [], sec: [], bor: [] };
  let traceOn     = s.trace !== false;  // live melody trace (on by default)
  let traceGeom   = null;               // { cx, cy, outerR } from the last render
  let trail       = [];                 // recent circle indices the melody visited
  let traceTimer  = null;
  let lastTrace   = { t: 0, tag: null };   // when + which chord/phrase the last event belonged to

  // pitch class → position on the circle of fifths (multiplying by 7 walks the circle)
  const circleIdxOf = note => { const pc = NOTES.indexOf(toSharp(note)); return pc < 0 ? -1 : (pc * 7) % 12; };
  function drawTrace(detail) {
    const svg = document.getElementById(`c5trace-${p.id}`);
    if (!svg || !traceGeom) return;
    const { cx, cy, outerR } = traceGeom;
    const posOf = idx => { const a = (idx * 30 - 90) * Math.PI / 180; return [cx + outerR * Math.cos(a), cy + outerR * Math.sin(a)]; };
    const idxs = [...new Set((detail.pcs || []).map(circleIdxOf).filter(i => i >= 0))];
    if (!idxs.length) return;
    const lead = circleIdxOf(detail.root) >= 0 ? circleIdxOf(detail.root) : idxs[0];
    // Keep the trail INSIDE one chord/phrase — reset it at every boundary so lines never
    // connect unrelated material: a new chord, a new labelled section, or a pause in the music.
    const now = Date.now();
    const tag = String(detail.label || '').split(/[—·]/)[0].trim() || null;   // "G/C — …" and "G/C · …" share a tag
    if (idxs.length > 1 || now - lastTrace.t > 1600 || (tag && lastTrace.tag && tag !== lastTrace.tag)) trail = [];
    lastTrace = { t: now, tag: tag || lastTrace.tag };
    if (trail[trail.length - 1] !== lead) { trail.push(lead); if (trail.length > 8) trail.shift(); }
    let g = '';
    if (idxs.length > 1) {   // a chord — connect its tones into a shape
      for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
        const [x1, y1] = posOf(idxs[i]), [x2, y2] = posOf(idxs[j]);
        g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${traceGold('.30')}" stroke-width="1.5"/>`;
      }
    }
    for (let i = 1; i < trail.length; i++) {   // the melody's path, fading with age
      const [x1, y1] = posOf(trail[i - 1]), [x2, y2] = posOf(trail[i]);
      const op = 0.12 + 0.75 * (i / (trail.length - 1));
      g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${traceGold(op.toFixed(2))}" stroke-width="2"/>`;
    }
    idxs.forEach(ix => {   // pulse the sounding notes
      const [x, y] = posOf(ix);
      g += `<circle cx="${x}" cy="${y}" r="19" fill="none" stroke="${TRACE_GOLD}" stroke-width="2"><animate attributeName="r" values="19;27" dur="0.5s" fill="freeze"/><animate attributeName="opacity" values="0.8;0" dur="0.5s" fill="freeze"/></circle>`;
      g += `<circle cx="${x}" cy="${y}" r="18" fill="none" stroke="${TRACE_GOLD}" stroke-width="2.5" opacity="0.9"/>`;
    });
    svg.innerHTML = g;
    clearTimeout(traceTimer);
    traceTimer = setTimeout(() => { trail = []; const sv = document.getElementById(`c5trace-${p.id}`); if (sv) sv.innerHTML = ''; }, 4000);
  }
  if (_traceHandlers[p.id]) window.removeEventListener('resonote:played', _traceHandlers[p.id]);
  _traceHandlers[p.id] = ev => {
    if (!document.getElementById(`body-${p.id}`)) { window.removeEventListener('resonote:played', _traceHandlers[p.id]); delete _traceHandlers[p.id]; return; }
    if (traceOn) drawTrace(ev.detail || {});
  };
  window.addEventListener('resonote:played', _traceHandlers[p.id]);

  function findCircleIndex(root) {
    const sharp = toSharp(root || '');          // equate enharmonics: Eb ≡ D#, Bb ≡ A#, …
    return CIRCLE_KEYS.findIndex(k => toSharp(k) === sharp);
  }

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !document.getElementById(`body-${p.id}`)) return;
    const idx = findCircleIndex(ev.root);
    if (idx < 0) return;
    selKey = idx;
    selMinor = ev.keyType === 'Minor' || ev.keyType === 'Harm. Minor';
    selChordIdx = null;
    applyC5Highlight(false);
    render();
  });

  function getKeyInfo() {
    if (selKey === null) return null;
    const rawRoot  = selMinor ? CIRCLE_MINOR[selKey].replace('m', '') : CIRCLE_KEYS[selKey];
    const keyType  = selMinor ? 'Minor' : 'Major';
    // rawRoot keeps the circle's flat spelling (Eb, Bb…) for display; keyRoot is the
    // canonical sharp pitch every other pedal speaks (Eb → D#). toSharp equates them.
    return { keyRoot: toSharp(rawRoot), keyType, displayRoot: rawRoot };
  }

  function applyC5Highlight(broadcast = true) {
    if (selKey === null) { clearChordHighlight(); pedalBus.clear(); updateOverlays(); return; }
    const ki = getKeyInfo();
    if (broadcast) pedalBus.setKey(ki.keyRoot, ki.keyType, { source: p.id });
    const pat = KEY_PATTERNS[ki.keyType];
    if (!pat) { clearChordHighlight(); updateOverlays(); return; }
    const allNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(ki.keyRoot) + i) % 12]);
    const colors = NECK[c5View === 'scale' ? 'scale' : c5View === 'arpeggio' ? 'arpeggio' : 'key'];
    const label = c5View === 'scale'
      ? `${ki.keyRoot} ${ki.keyType} Scale`
      : `Key of ${ki.keyRoot} ${ki.keyType}`;
    setChordHighlight(ki.keyRoot, allNotes, label, null, colors);
    updateOverlays();
  }

  // Push a chord to the shared fretboard + (explicit gesture) the Chord Directory.
  function pushChord(ch) {
    const cat = catOfType(ch.type);
    const intervals = CHORD_TYPES[cat]?.[ch.type] || [0, 4, 7];
    const notes = getChordNotes(ch.root, intervals);
    setChordHighlight(ch.root, notes, ch.label || `${ch.numeral || ''} ${ch.root}${qualSuffix(ch.type)}`.trim(), null, NECK.key);
    updateOverlays();
    if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('chords', { mode: 'chord', root: ch.root, chordType: ch.type, chordCat: cat });
  }
  function addToProgression(ch) {
    const ki = getKeyInfo(); if (!ki || !pedalBus.rebuildPedal) return;
    pedalBus.rebuildPedal('progression', { root: ki.keyRoot, keyType: ki.keyType, progMode: 'custom',
      _appendChord: { root: ch.root, quality: ch.quality, numeral: ch.numeral } });
  }

  function render() {
    const pw   = el.parentElement?.clientWidth || 280;
    const size = Math.min(pw - 24, 280);
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 20, minorR = outerR - 28;
    const majS = 34, minS = 26;

    let h = `<div class="rk rk-circle" style="align-items:center;gap:8px">`;
    h += `<div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0">`;

    if (selKey !== null) {
      h += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:0">`;
      // the name in the middle stays NEUTRAL on purpose: it is a note name sitting
      // inside a ring of note colours, and tinting it would read as a 13th hue
      h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(20px*var(--ui));font-weight:800">${selMinor ? CIRCLE_MINOR[selKey] : CIRCLE_KEYS[selKey]}</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">${selMinor ? 'minor' : 'major'}</div></div>`;
    } else {
      h += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:0"><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">Select a key</div></div>`;
    }

    CIRCLE_KEYS.forEach((key, i) => {
      const ang = (i * 30 - 90) * Math.PI / 180;
      const bx = cx + outerR * Math.cos(ang) - majS / 2;
      const by = cy + outerR * Math.sin(ang) - majS / 2;
      // every key wears its note's spectrum colour (same code as the neck legend);
      // selection = full saturation, neighbours dimmer, the rest quiet but still hued
      const isSel  = selKey === i && !selMinor;
      const isNear = selKey !== null && !selMinor && (i === (selKey + 1) % 12 || i === (selKey + 11) % 12);
      const bg     = isSel ? pcColor(key, 85, 62)      : isNear ? pcColor(key, 55, 30)   : pcColor(key, 40, 20);
      const border = isSel ? `2px solid ${pcColor(key, 95, 80)}` : isNear ? `1px solid ${pcColor(key, 60, 45)}` : `1px solid ${pcColor(key, 45, 30)}`;
      // Spectrum foreground, not chrome — this text sits ON a note swatch, which is
      // the one surface the kit's contrast table does not cover. pcTextOn solves the
      // selected case; these two neutrals are the same solve for the dimmer swatches.
      const color  = isSel ? pcTextOn(key)             : isNear ? '#e8e8ee'              : 'rgba(235,235,240,.75)';
      h += `<button class="c5-major mono" data-ki="${i}" style="position:absolute;left:${bx}px;top:${by}px;width:${majS}px;height:${majS}px;border-radius:50%;background:${bg};border:${border};color:${color};font-size:calc(12px*var(--ui));font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2">${key}</button>`;
    });
    CIRCLE_MINOR.forEach((key, i) => {
      const ang = (i * 30 - 90) * Math.PI / 180;
      const bx = cx + minorR * Math.cos(ang) - minS / 2;
      const by = cy + minorR * Math.sin(ang) - minS / 2;
      // relative minors share their major's hue, a shade darker (same family)
      const mroot  = key.replace('m', '');
      const isSel  = selKey === i && selMinor;
      const isNear = selKey !== null && selMinor && (i === (selKey + 1) % 12 || i === (selKey + 11) % 12);
      const bg     = isSel ? pcColor(mroot, 70, 48)  : isNear ? pcColor(mroot, 45, 24)  : pcColor(mroot, 32, 16);
      const border = isSel ? `2px solid ${pcColor(mroot, 85, 68)}` : isNear ? `1px solid ${pcColor(mroot, 50, 38)}` : `1px solid ${pcColor(mroot, 38, 24)}`;
      const color  = isSel ? pcTextOn(mroot)         : isNear ? '#d8d8e0'              : 'rgba(220,220,228,.62)';   // spectrum foreground — see the major ring above
      h += `<button class="c5-minor mono" data-ki="${i}" style="position:absolute;left:${bx}px;top:${by}px;width:${minS}px;height:${minS}px;border-radius:50%;background:${bg};border:${border};color:${color};font-size:calc(10px*var(--ui));font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2">${key}</button>`;
    });

    if (selKey !== null) {
      h += `<svg style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;pointer-events:none;z-index:1" viewBox="0 0 ${size} ${size}">`;
      const prev = (selKey + 11) % 12, next = (selKey + 1) % 12;
      [prev, next].forEach(ki => {
        const a1 = (selKey * 30 - 90) * Math.PI / 180;
        const a2 = (ki * 30 - 90) * Math.PI / 180;
        const mr = (outerR + minorR) / 2;
        h += `<line x1="${cx + mr * Math.cos(a1)}" y1="${cy + mr * Math.sin(a1)}" x2="${cx + mr * Math.cos(a2)}" y2="${cy + mr * Math.sin(a2)}" stroke="var(--rk-line)" stroke-width="1.5"/>`;
      });
      const a1 = (selKey * 30 - 90) * Math.PI / 180;
      h += `<line x1="${cx + outerR * Math.cos(a1)}" y1="${cy + outerR * Math.sin(a1)}" x2="${cx + minorR * Math.cos(a1)}" y2="${cy + minorR * Math.sin(a1)}" stroke="var(--rk-edge-soft)" stroke-width="1"/>`;
      h += `</svg>`;
    }
    // live trace layer — whatever the app plays draws its path around the circle
    traceGeom = { cx, cy, outerR };
    h += `<svg id="c5trace-${p.id}" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;pointer-events:none;z-index:3" viewBox="0 0 ${size} ${size}"></svg>`;
    // Lit, this button wears the trace's own gold — a toggle that does not match the
    // thing it toggles is a lie. Unlit it is ordinary chrome like every other control.
    h += `<button id="c5tr-${p.id}" title="Trace played notes on the circle (melodies draw their path as they play)" style="min-height:calc(28px*var(--ui));position:absolute;top:0;left:0;z-index:4;background:${traceOn ? traceGold('.15') : 'var(--rk-panel2)'};border:1px solid ${traceOn ? TRACE_GOLD : 'var(--rk-edge-soft)'};color:${traceOn ? TRACE_GOLD : 'var(--rk-ink-mute)'};border-radius:5px;font-size:calc(10px*var(--ui));padding:2px 6px;cursor:pointer;font-family:'JetBrains Mono',monospace">〰 trace</button>`;
    h += `</div>`;

    if (selKey !== null) {
      const ki = getKeyInfo();
      const chords = getKeyChords(ki.keyRoot, ki.keyType);

      // Four tabs of ONE pedal, so one active style. They used to wear four different
      // colours borrowed from the fretboard overlay each one drives, which made the
      // tab row look like four products stapled together.
      const ON = 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)';
      h += `<div style="display:flex;gap:3px;width:100%">`;
      h += `<button class="chord-btn c5v" data-c5v="harmony"  style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${c5View==='harmony'  ? ON : ''}">🎹 Harmony</button>`;
      h += `<button class="chord-btn c5v" data-c5v="chords"   style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${c5View==='chords'   ? ON : ''}">🎵 Chords</button>`;
      h += `<button class="chord-btn c5v" data-c5v="scale"    style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${c5View==='scale'    ? ON : ''}">🎼 Scale</button>`;
      h += `<button class="chord-btn c5v" data-c5v="arpeggio" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${c5View==='arpeggio' ? ON : ''}">🎶 Arp</button>`;
      h += `</div>`;

      if (c5View === 'chords' && chords.length) {
        h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
        chords.forEach((ch, ci) => {
          const ql   = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ch.quality === 'Aug' ? '+' : ch.quality;
          const isSel = selChordIdx === ci;
          h += `<button class="c5-chord" data-ci="${ci}" style="min-height:calc(28px*var(--ui));background:${isSel ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${isSel ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};color:${isSel ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'};border-radius:5px;padding:4px 8px;cursor:pointer;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace;font-weight:600">`;
          h += `<span style="font-size:calc(8px*var(--ui));opacity:.6">${ch.numeral}</span> ${ch.root}${ql}`;
          h += `</button>`;
        });
        h += `</div>`;
      }

      if (c5View === 'scale') {
        const pat = KEY_PATTERNS[ki.keyType];
        if (pat) {
          const scaleNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(ki.keyRoot) + i) % 12]);
          h += `<div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;padding:4px 0">`;
          scaleNotes.forEach((n, i) => {
            const isR = i === 0;
            // root vs the rest, carried by weight of accent rather than by two hues
            h += `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:4px;padding:2px 6px">`;
            h += `<span style="width:8px;height:8px;border-radius:50%;background:${isR ? 'var(--rk-accent)' : 'var(--rk-dim)'}"></span>`;
            h += `<span class="mono" style="color:${isR ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'};font-size:calc(10px*var(--ui));font-weight:600">${showIntervals ? intervalLabel(ki.keyRoot, n) : n}</span>`;
            h += `</span>`;
          });
          h += `</div>`;
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${ki.keyRoot} ${ki.keyType} scale highlighted on fretboard</div>`;
        }
      }

      if (c5View === 'arpeggio') {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;margin-bottom:2px">Select a chord arpeggio</div>`;
        h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
        chords.forEach((ch, ci) => {
          const ql   = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ch.quality === 'Aug' ? '+' : ch.quality;
          const isSel = selChordIdx === ci;
          h += `<button class="c5-arp" data-ci="${ci}" style="min-height:calc(28px*var(--ui));background:${isSel ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${isSel ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};color:${isSel ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'};border-radius:5px;padding:4px 8px;cursor:pointer;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace;font-weight:600">`;
          h += `<span style="font-size:calc(8px*var(--ui));opacity:.6">${ch.numeral}</span> ${ch.root}${ql}`;
          h += `</button>`;
        });
        h += `</div>`;
      }

      if (c5View === 'harmony') {
        const dia = (harm7 ? getKeySeventhChords(ki.keyRoot, ki.keyType) : getKeyChords(ki.keyRoot, ki.keyType))
          .map(ch => ({ root: ch.root, type: ch.quality, quality: ch.quality, numeral: ch.numeral,
            why: `${ch.numeral} — the diatonic ${ch.root}${qualSuffix(ch.quality)} chord, built straight from the ${ki.keyRoot} ${ki.keyType} scale.` }));
        const sec = getSecondaryDominants(ki.keyRoot, ki.keyType).map(c => ({ root: c.root, type: c.quality, quality: c.quality, numeral: c.numeral, why: c.why }));
        const bor = getBorrowedChords(ki.keyRoot, ki.keyType).map(c => ({ root: c.root, type: c.quality, quality: c.quality, numeral: c.numeral, why: c.why }));
        harmLists = { dia, sec, bor };

        h += `<div style="display:flex;gap:4px;width:100%">`;
        h += `<button class="harm7" data-h7="0" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:3px;border-radius:4px;border:1px solid ${!harm7?'var(--rk-line)':'var(--rk-edge-soft)'};background:${!harm7?'var(--rk-soft)':'transparent'};color:${!harm7?'var(--rk-accent)':'var(--rk-ink-mute)'};cursor:pointer">Triads</button>`;
        h += `<button class="harm7" data-h7="1" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:3px;border-radius:4px;border:1px solid ${harm7?'var(--rk-line)':'var(--rk-edge-soft)'};background:${harm7?'var(--rk-soft)':'transparent'};color:${harm7?'var(--rk-accent)':'var(--rk-ink-mute)'};cursor:pointer">7ths</button>`;
        h += `</div>`;

        const rowLabel = t => `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;width:100%;margin-top:2px">${t}</div>`;
        const chip = (c, kind, i) => {
          const sel = selHarm && selHarm.kind === kind && selHarm.idx === i;
          return `<button class="harm-chip" data-hk="${kind}" data-hi="${i}" style="min-height:calc(28px*var(--ui));background:${sel?'var(--rk-soft2)':'var(--rk-panel2)'};border:1px solid ${sel?'var(--rk-line)':'var(--rk-edge-soft)'};color:${sel?'var(--rk-accent)':'var(--rk-ink-dim)'};border-radius:5px;padding:3px 6px;cursor:pointer;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace;font-weight:600"><span style="font-size:calc(8px*var(--ui));opacity:.7">${c.numeral}</span> ${c.root}${qualSuffix(c.type)}</button>`;
        };
        const row = (list, kind) => `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center;width:100%">${list.map((c, i) => chip(c, kind, i)).join('')}</div>`;

        h += rowLabel('IN KEY — diatonic');
        h += row(dia, 'dia');
        h += rowLabel('SECONDARY DOMINANTS — borrowed tension');
        h += row(sec, 'sec');
        h += rowLabel('BORROWED — modal interchange');
        h += row(bor, 'bor');

        if (selHarm && harmLists[selHarm.kind] && harmLists[selHarm.kind][selHarm.idx]) {
          const c = harmLists[selHarm.kind][selHarm.idx];
          h += `<div style="font-size:calc(9px*var(--ui));line-height:1.5;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid var(--rk-line);padding:5px 7px;border-radius:4px;width:100%;margin-top:2px">${c.numeral} · ${c.root}${qualSuffix(c.type)} — ${c.why}</div>`;
          h += `<button class="harm-addprog" style="min-height:calc(28px*var(--ui));width:100%;font-size:calc(10px*var(--ui));border:1px solid var(--rk-line);background:var(--rk-soft);color:var(--rk-accent);border-radius:5px;padding:5px;cursor:pointer;margin-top:2px">＋ Add to Progression Builder</button>`;
        } else {
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;margin-top:2px;line-height:1.4">Tap any chord to hear it, light it on the fretboard &amp; send it to the Chord Directory</div>`;
        }
      }

      const prev = CIRCLE_KEYS[(selKey + 11) % 12], next = CIRCLE_KEYS[(selKey + 1) % 12];
      const rel  = selMinor ? CIRCLE_KEYS[selKey] : CIRCLE_MINOR[selKey];
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;margin-top:2px">Related: <span style="color:var(--rk-dim)">${prev}</span> · <span style="color:var(--rk-dim)">${next}</span> · <span style="color:var(--rk-dim)">${rel}</span></div>`;
    }
    h += theoryPanelHTML('circle', CIRCLE_THEORY);
    h += `</div>`;
    el.innerHTML = h;
    wireTheoryPanel(el);

    el.querySelectorAll('.c5-major').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ki = parseInt(b.dataset.ki);
      if (selKey === ki && !selMinor) { selKey = null; selMinor = false; }
      else { selKey = ki; selMinor = false; }
      selChordIdx = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5-minor').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ki = parseInt(b.dataset.ki);
      if (selKey === ki && selMinor) { selKey = null; selMinor = false; }
      else { selKey = ki; selMinor = true; }
      selChordIdx = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5v').forEach(b => b.onclick = e => {
      e.stopPropagation(); c5View = b.dataset.c5v; selChordIdx = null; selHarm = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5-chord').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ci = parseInt(b.dataset.ci);
      selChordIdx = selChordIdx === ci ? null : ci;
      const ki = getKeyInfo(); if (!ki) return;
      const chords = getKeyChords(ki.keyRoot, ki.keyType);
      if (selChordIdx !== null && chords[selChordIdx]) {
        const ch = chords[selChordIdx];
        pushChord({ root: ch.root, type: ch.quality, quality: ch.quality, numeral: ch.numeral, label: `${ch.numeral} — ${ch.root}${qualSuffix(ch.quality)}` });
      } else { applyC5Highlight(); }
      render();
    });
    el.querySelectorAll('.c5-arp').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ci = parseInt(b.dataset.ci);
      selChordIdx = selChordIdx === ci ? null : ci;
      const ki = getKeyInfo(); if (!ki) return;
      const chords = getKeyChords(ki.keyRoot, ki.keyType);
      if (selChordIdx !== null && chords[selChordIdx]) {
        const ch = chords[selChordIdx];
        const formula = ({ Major:[0,4,7], Minor:[0,3,7], Dim:[0,3,6], Aug:[0,4,8] })[ch.quality] || [0,4,7];
        const notes = formula.map(i => NOTES[(NOTES.indexOf(ch.root) + i) % 12]);
        setChordHighlight(ch.root, notes, `${ch.root} ${ch.quality} Arpeggio`, null, NECK.arpeggio);
      } else { applyC5Highlight(); }
      updateOverlays(); render();
    });
    el.querySelectorAll('.harm7').forEach(b => b.onclick = e => { e.stopPropagation(); harm7 = b.dataset.h7 === '1'; render(); });
    el.querySelectorAll('.harm-chip').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const kind = b.dataset.hk, idx = parseInt(b.dataset.hi);
      selHarm = (selHarm && selHarm.kind === kind && selHarm.idx === idx) ? null : { kind, idx };
      if (selHarm && harmLists[kind] && harmLists[kind][idx]) pushChord(harmLists[kind][idx]);
      else applyC5Highlight(false);
      render();
    });
    el.querySelector('.harm-addprog')?.addEventListener('click', e => {
      e.stopPropagation();
      if (selHarm && harmLists[selHarm.kind] && harmLists[selHarm.kind][selHarm.idx]) addToProgression(harmLists[selHarm.kind][selHarm.idx]);
    });
    el.querySelector(`#c5tr-${p.id}`)?.addEventListener('click', e => {
      e.stopPropagation();
      traceOn = !traceOn; s.trace = traceOn; trail = [];
      const sv = document.getElementById(`c5trace-${p.id}`); if (sv) sv.innerHTML = '';
      render();
    });
    Object.assign(s, { selKey, selMinor, c5View, harm7, trace: traceOn });
  }

  render();
}
