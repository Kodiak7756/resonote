import { NOTES, CHORD_TYPES, KEY_PATTERNS, getChordNotes, getKeyChords, intervalLabel } from '../core/music-theory.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus } from '../core/state.js';
import { findVoicings, renderMiniDiagram, getKeyPositionZones } from '../core/voicings.js';
import { updateOverlays, geo } from '../ui/fretboard.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { customTuning, getInst } from '../core/tuning.js';
import { audio } from '../core/audio.js';
import { pcColor, pcTextOn } from '../core/colors.js';
import { startStrumCheck, toMidi } from '../core/strum-check.js';

// ── 🎤 Check my strum ────────────────────────────────────────────────
// The shape on screen, as the strum check wants it: frets low → high, 'x' for
// a string that shouldn't sound. (customTuning lists strings high → low.)
function gripFrets(positions) {
  const ns = customTuning.length;
  return Array.from({ length: ns }, (_, i) => {
    const pos = positions.find(x => x.si === ns - 1 - i && x.fret >= 0);
    return pos ? pos.fret : 'x';
  });
}
const tuningLowHigh = () => [...customTuning].reverse();

// What each verdict looks like. The mark is a SHAPE first (✓ ✕ ! ×) and a
// solid or dashed ring, so it reads with no colour at all; the app-wide
// right/wrong inks ride along. Never a note hue: those belong to the notes.
const SC_MARK = {
  rang:    { glyph: '✓', ink: 'var(--rk-ok)',  ring: 'solid',  word: 'rang' },
  missing: { glyph: '✕', ink: 'var(--rk-bad)', ring: 'dashed', word: "didn't ring" },
  extra:   { glyph: '!', ink: 'var(--rk-bad)', ring: 'solid',  word: "rang, but shouldn't" },
  muted:   { glyph: '×', ink: 'var(--rk-ink-faint)', ring: null, word: 'stays quiet' },
};
const DASH = { solid: '', dashed: ' stroke-dasharray="2.6 2"' };
const stringLabel = i => { const s = customTuning[customTuning.length - 1 - i]; return s?.label || s?.note || ''; };

// The chord box for the strum check: every note wears its own spectrum colour
// with its letter on it; the verdict sits above its string as a mark.
function strumDiagramSVG(frets, res) {
  const ns = frets.length, sp = 22, left = 22, top = 40, fh = 22;
  const fretted = frets.filter(f => f !== 'x' && f > 0);
  const minF = fretted.length ? Math.min(...fretted) : 1, maxF = fretted.length ? Math.max(...fretted) : 1;
  const start = maxF <= 4 ? 1 : minF, rows = Math.max(4, maxF - start + 1);
  const w = left * 2 + (ns - 1) * sp, h = top + rows * fh + 22;
  const tun = tuningLowHigh();
  const noteAt = (i, f) => NOTES[(((toMidi(tun[i]) + f) % 12) + 12) % 12];
  let s = `<svg class="sc-diagram" data-frets="${frets.join(',')}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Strum check for this chord shape">`;
  if (start === 1) s += `<rect x="${left - 2}" y="${top - 3}" width="${(ns - 1) * sp + 4}" height="4" rx="1" fill="var(--rk-ink-dim)"/>`;
  else s += `<text x="${left - 8}" y="${top + fh / 2 + 3}" text-anchor="end" font-size="9" fill="var(--rk-ink-mute)" font-family="'JetBrains Mono',monospace">${start}fr</text>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="${left}" y1="${top + r * fh}" x2="${left + (ns - 1) * sp}" y2="${top + r * fh}" stroke="var(--rk-edge)" stroke-width="${r === 0 ? 1.4 : 0.8}"/>`;
  for (let i = 0; i < ns; i++) s += `<line x1="${left + i * sp}" y1="${top}" x2="${left + i * sp}" y2="${top + rows * fh}" stroke="var(--rk-ink-faint)" stroke-width="${1.6 - i * 0.18}"/>`;
  frets.forEach((f, i) => {
    const x = left + i * sp, st = res?.strings[i]?.status || (f === 'x' ? 'muted' : null);
    const gone = st === 'missing';
    if (f !== 'x') {
      const n = noteAt(i, f), cy = f === 0 ? top - 11 : top + (f - start) * fh + fh / 2, r = f === 0 ? 7 : 8.5;
      s += `<g opacity="${gone ? 0.38 : 1}"><circle cx="${x}" cy="${cy}" r="${r}" fill="${pcColor(n, 70, 46)}" stroke="${gone ? 'var(--rk-bad)' : 'rgba(0,0,0,.45)'}" stroke-width="${gone ? 1.4 : 1}"${gone ? DASH.dashed : ''}/>`;
      s += `<text x="${x}" y="${cy + 3}" text-anchor="middle" font-size="${n.length > 1 ? 7 : 8.5}" font-weight="800" font-family="'JetBrains Mono',monospace" fill="${pcTextOn(n)}">${n}</text></g>`;
    }
    if (st && SC_MARK[st]) {
      const m = SC_MARK[st], my = 11;
      s += `<g class="sc-mark" data-string="${i}" data-status="${st}"><title>${(res?.strings[i]?.name || stringLabel(i))} string: ${m.word}</title>`;
      if (m.ring) s += `<circle cx="${x}" cy="${my}" r="8" fill="var(--rk-panel)" stroke="${m.ink}" stroke-width="1.4"${DASH[m.ring]}/>`;
      s += `<text x="${x}" y="${my + 4}" text-anchor="middle" font-size="${m.ring ? 10 : 11}" font-weight="800" fill="${m.ink}">${m.glyph}</text></g>`;
    }
    s += `<text x="${x}" y="${h - 6}" text-anchor="middle" font-size="9" fill="var(--rk-ink-mute)" font-family="'JetBrains Mono',monospace">${stringLabel(i)}</text>`;
  });
  return s + '</svg>';
}

// The same verdicts on the main neck, in their own layer above the chord
// dots, so the neck's redraws (which own names/chord/note layers) leave them be.
// A full neck rebuild (resize, new instrument) drops the layer; the audio tick
// puts it back while a result is showing.
let neckRes = null, neckHooked = false;
function paintNeckMarks(res) {
  neckRes = res;
  if (!neckHooked) {
    neckHooked = true;
    audio.on(() => {
      const g = document.getElementById('strum-ov');
      if (neckRes && (!g || g !== g.parentNode.lastElementChild)) paintNeckMarks(neckRes);
    });
  }
  const svg = document.getElementById('fb-svg');
  let g = document.getElementById('strum-ov');
  if (!res || !svg || getInst().renderer !== 'fretboard' || res.strings.length !== customTuning.length) { if (g) g.innerHTML = ''; return; }
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'strum-ov';
    g.setAttribute('pointer-events', 'none');
  }
  if (g !== svg.lastElementChild) svg.appendChild(g);
  const G = geo(), ns = customTuning.length;
  let h = '';
  res.strings.forEach(s => {
    const m = SC_MARK[s.status];
    if (!m) return;
    const si = ns - 1 - s.string, y = G.sy(si);
    const cx = G.fm(s.expected ? s.fret : 0), open = !s.expected || s.fret === 0;
    // badge up and to the right: clear of the string names left of the nut
    const r = open ? 14 : 12.5, bx = cx + (open ? 12 : 11), by = y - (open ? 12 : 11);
    h += `<g class="sc-neck" data-string="${s.string}" data-status="${s.status}">`;
    if (m.ring && s.expected) h += `<circle cx="${cx}" cy="${y}" r="${r}" fill="none" stroke="${m.ink}" stroke-width="2.2"${DASH[m.ring]}/>`;
    if (!s.expected && s.status === 'muted') {
      // on the nut, right of the string names (which sit above the neck);
      // a plain light ink — the pedal's --rk-ink-* tokens don't reach the neck
      h += `<circle cx="${bx}" cy="${y}" r="6.4" fill="#15140d" stroke="rgba(235,235,235,.55)" stroke-width="1"/>`;
      h += `<text x="${bx}" y="${y + 3.5}" text-anchor="middle" font-size="10" font-weight="900" fill="rgba(235,235,235,.8)">${m.glyph}</text>`;
    } else {
      h += `<circle cx="${bx}" cy="${by}" r="6.4" fill="#15140d" stroke="${m.ink}" stroke-width="1.2"/>`;
      h += `<text x="${bx}" y="${by + 3}" text-anchor="middle" font-size="8.5" font-weight="900" fill="${m.ink}">${m.glyph}</text>`;
    }
    h += `</g>`;
  });
  g.innerHTML = h;
}

const CD_BLURB = {
  chord: `Pick any chord and see <b>every playable shape</b> for it on the neck. Tap a shape to light it up on the fretboard — the labels show each note's <b>degree</b> (R · 3 · 5 · 7) so you learn what you're fretting, not just where.`,
  key:   `Pick a key and get the <b>chords that belong to it</b> (its diatonic family) with their Nashville numbers. Browse them by neck <b>position</b> so you can comp a whole song without leaving one area of the fretboard.`,
};
const CD_THEORY = {
  kicker: 'HARMONY', title: 'Chords & keys on the neck',
  what: `A <b>chord</b> is three or more notes stacked in thirds (Root · 3rd · 5th, plus a 7th and beyond). A <b>key</b> is the family of seven chords built from one scale — the <b>I ii iii IV V vi vii°</b> you'll see in nearly every song. Each diagram is one playable <b>voicing</b> (shape) of the same chord.`,
  why: `Knowing several voicings of a chord lets you keep your hand in one place as the harmony moves, and voice-lead smoothly between chords. Thinking in <b>numbers</b> (the key's I–vi) instead of letters means a progression you learn in C instantly transposes to every other key.`,
  lessonId: 'three-functions',
};

export function buildChordContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let mode         = s.mode      || 'chord';
  let root         = s.root      || 'C';
  let chordType    = s.chordType || 'Major';
  let chordCat     = s.chordCat  || 'Triads';
  let keyMode      = s.keyMode   || 'Major';
  let selKeyChord  = null;
  let view         = s.view    || 'positions';
  let selVoicing   = null, voicings = [];
  let keyView      = s.keyView || 'positions';
  let selKeyZone   = null, selZoneChord = null, selKeyVoicing = null, keyPositionData = null;

  // 🎤 Check my strum — on for this pedal until switched off (not saved: it
  // listens to the input, so it starts each session off). A rebuild keeps it.
  p._strumCheck?.stop(); p._strumCheck = null;
  let strumRes = null, strumState = '', strumKey = '';

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    root = ev.root;
    if (ev.keyType && KEY_PATTERNS[ev.keyType]) keyMode = ev.keyType;
    if (ev.keyType && KEY_PATTERNS[ev.keyType]) mode = 'key';
    if (mode === 'chord') computeVoicings();
    keyPositionData = null; selKeyChord = null; selKeyZone = null; selZoneChord = null; selKeyVoicing = null;
    applyHighlight(); render();
  });

  function computeVoicings() {
    const intervals = CHORD_TYPES[chordCat]?.[chordType] || [0,4,7];
    const notes = getChordNotes(root, intervals);
    voicings = findVoicings(root, notes, chordType);
    selVoicing = voicings.length > 0 ? 0 : null;
  }
  computeVoicings();

  function applyHighlight() {
    if (mode === 'chord') {
      const intervals = CHORD_TYPES[chordCat]?.[chordType] || [0,4,7];
      const notes = getChordNotes(root, intervals);
      if (view === 'positions' && selVoicing !== null && voicings[selVoicing]) {
        setChordHighlight(root, notes, `${root} ${chordType}`, voicings[selVoicing].positions);
      } else {
        setChordHighlight(root, notes, `${root} ${chordType}`, null);
      }
    } else if (mode === 'key') {
      if (keyView === 'positions') {
        if (selKeyZone !== null && keyPositionData?.zones[selKeyZone]) {
          const zone = keyPositionData.zones[selKeyZone];
          if (selZoneChord !== null && zone.chords[selZoneChord]) {
            const zc = zone.chords[selZoneChord];
            setChordHighlight(zc.root, zc.notes, `${zc.numeral} — ${zc.root} ${zc.quality} (${zone.label})`, zc.positions);
          } else {
            const allPos = [];
            zone.chords.forEach(zc => { zc.positions.forEach(pos => { if (pos.fret >= 0) allPos.push({ ...pos, _root: zc.root }); }); });
            const allNotes = [...new Set(zone.chords.flatMap(zc => zc.notes))];
            setChordHighlight(root, allNotes, `${zone.label} — Key of ${root} ${keyMode}`, allPos);
          }
        } else {
          const pat = KEY_PATTERNS[keyMode]; if (!pat) { clearChordHighlight(); return; }
          const allKeyNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
          setChordHighlight(root, allKeyNotes, `Key of ${root} ${keyMode}`, null);
        }
      } else if (keyView === 'chords') {
        if (selKeyChord !== null) {
          const chords = getKeyChords(root, keyMode);
          if (chords[selKeyChord]) {
            const ch = chords[selKeyChord];
            const chVoicings = findVoicings(ch.root, ch.notes, ch.quality);
            if (selKeyVoicing !== null && chVoicings[selKeyVoicing]) {
              setChordHighlight(ch.root, ch.notes, `${ch.numeral} — ${ch.root} ${ch.quality}`, chVoicings[selKeyVoicing].positions);
            } else {
              setChordHighlight(ch.root, ch.notes, `${ch.numeral} — ${ch.root} ${ch.quality}`, null);
            }
          }
        } else {
          const pat = KEY_PATTERNS[keyMode]; if (!pat) { clearChordHighlight(); return; }
          const allKeyNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
          setChordHighlight(root, allKeyNotes, `Key of ${root} ${keyMode}`, null);
        }
      } else {
        const pat = KEY_PATTERNS[keyMode]; if (!pat) { clearChordHighlight(); return; }
        const allKeyNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(root) + i) % 12]);
        setChordHighlight(root, allKeyNotes, `Key of ${root} ${keyMode}`, null);
      }
    } else { clearChordHighlight(); }
    updateOverlays();
    syncStrum();
  }

  function getSelectedProgressionChord() {
    if (mode !== 'key') return null;
    if (selKeyZone !== null && selZoneChord !== null && keyPositionData?.zones[selKeyZone]?.chords[selZoneChord]) {
      const zc = keyPositionData.zones[selKeyZone].chords[selZoneChord];
      return { root: zc.root, quality: zc.quality, numeral: zc.numeral };
    }
    if (selKeyChord !== null) {
      const chords = getKeyChords(root, keyMode);
      if (chords[selKeyChord]) {
        const ch = chords[selKeyChord];
        return { root: ch.root, quality: ch.quality, numeral: ch.numeral };
      }
    }
    return null;
  }

  // The one shape the pedal is showing right now, if it is showing one.
  function currentGrip() {
    if (getInst().renderer !== 'fretboard') return null;
    let pos = null, name = '';
    if (mode === 'chord') {
      if (view === 'positions' && selVoicing !== null && voicings[selVoicing]) { pos = voicings[selVoicing].positions; name = `${root} ${chordType}`; }
    } else if (keyView === 'positions') {
      const zc = selKeyZone !== null && selZoneChord !== null ? keyPositionData?.zones[selKeyZone]?.chords[selZoneChord] : null;
      if (zc) { pos = zc.positions; name = `${zc.root} ${zc.quality}`; }
    } else if (keyView === 'chords' && selKeyChord !== null && selKeyVoicing !== null) {
      const ch = getKeyChords(root, keyMode)[selKeyChord];
      const v = ch && findVoicings(ch.root, ch.notes, ch.quality)[selKeyVoicing];
      if (v) { pos = v.positions; name = `${ch.root} ${ch.quality}`; }
    }
    if (!pos) return null;
    const frets = gripFrets(pos);
    if (!frets.some(f => f !== 'x')) return null;
    const tuning = tuningLowHigh();
    return { frets, tuning, name, key: frets.join(',') + '|' + tuning.map(t => t.note + t.octave).join(',') };
  }

  // Start, retarget or stop the listener to match the toggle and the shape.
  function syncStrum() {
    const g = p._strumOn ? currentGrip() : null;
    if (!g) {
      p._strumCheck?.stop(); p._strumCheck = null;
      strumKey = ''; strumRes = null; strumState = '';
      paintNeckMarks(null);
      return;
    }
    const changed = g.key !== strumKey;
    if (changed) { strumKey = g.key; strumRes = null; paintNeckMarks(null); }
    if (!p._strumCheck) {
      p._strumCheck = startStrumCheck({
        frets: g.frets, tuning: g.tuning,
        isAlive: () => el.isConnected,
        onState: st => { strumState = st; paintStrum(); },
        onResult: r => { strumRes = r; paintNeckMarks(r); paintStrum(); },
      });
    } else if (changed) p._strumCheck.setVoicing(g.frets, g.tuning);
  }

  function paintStrum() {
    const box = el.querySelector(`#sc-${p.id}`);
    if (!box) return;
    if (!p._strumOn) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const g = currentGrip();
    let h;
    if (!g) h = `<div class="sc-line">Pick one of the shapes above, then strum it.</div>`;
    else if (!audio.connected) h = `<div class="sc-line">Connect your guitar first: open 🎛️ Input &amp; Tuner, pick your interface and hit Connect.</div>`;
    else {
      const busy = strumState === 'checking';
      h = `<div class="sc-line"><span class="sc-dot${busy ? ' is-busy' : ''}"></span>${busy ? 'Listening to that strum…' : strumRes ? `Strum ${g.name} again any time.` : `Strum ${g.name} once and let it ring.`}</div>`;
      h += `<div class="sc-board">${strumDiagramSVG(g.frets, strumRes)}</div>`;
      if (strumRes?.tip) h += `<div class="sc-tip${strumRes.ok ? ' is-ok' : ''}">${strumRes.tip.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
      const keys = ['rang', 'missing'].concat(g.frets.includes('x') ? ['extra', 'muted'] : []);
      h += `<div class="sc-legend">${keys.map(k => `<span><b style="color:${SC_MARK[k].ink}">${SC_MARK[k].glyph}</b> ${SC_MARK[k].word}</span>`).join('')}</div>`;
    }
    box.innerHTML = h;
  }

  function render() {
    const intervals = CHORD_TYPES[chordCat]?.[chordType] || [0,4,7];
    const notes = getChordNotes(root, intervals);
    // No accent of its own — the card hands one down from the catalog.
    let h = `<div class="rk rk-chorddir" style="gap:8px">`;

    h += `<div class="rk-seg" style="gap:5px">`;
    h += `<button class="rk-seg-btn ${mode==='chord'?'is-active':''}" data-mode="chord" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:6px 0">🎵 CHORD</button>`;
    h += `<button class="rk-seg-btn ${mode==='key'?'is-active':''}" data-mode="key" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:6px 0">🔑 KEY</button>`;
    h += `</div>`;
    h += `<div style="font-size:calc(10px*var(--ui));line-height:1.5;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid var(--rk-accent);padding:7px 9px;border-radius:4px">${CD_BLURB[mode]}</div>`;

    h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
    NOTES.forEach(n => { h += `<button class="chord-btn root-btn ${n===root?'active':''}" data-root="${n}" style="min-height:calc(28px*var(--ui));min-width:28px;font-size:calc(10px*var(--ui))">${n}</button>`; });
    h += `</div>`;

    if (mode === 'chord') {
      Object.entries(CHORD_TYPES).forEach(([cat, types]) => {
        h += `<div><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-bottom:3px;text-transform:uppercase">${cat}</div><div style="display:flex;flex-wrap:wrap;gap:3px">`;
        Object.keys(types).forEach(t => {
          h += `<button class="chord-btn type-btn ${chordType===t&&chordCat===cat?'active':''}" data-type="${t}" data-cat="${cat}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">${t}</button>`;
        });
        h += `</div></div>`;
      });

      h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:6px;padding:6px 8px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap">`;
      h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:800">${root} ${chordType}</span><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">│</span>`;
      notes.forEach((n, i) => { h += `<span class="mono" style="color:${i===0?'var(--rk-accent)':'var(--rk-dim)'};font-size:calc(10px*var(--ui));font-weight:700">${n}</span>`; });
      h += `</div>`;

      h += `<div style="display:flex;gap:4px">`;
      h += `<button class="chord-btn ${view==='positions'?'active':''}" data-view="positions" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">⬚ POSITIONS</button>`;
      h += `<button class="chord-btn ${view==='all'?'active':''}" data-view="all" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">◈ ALL NOTES</button>`;
      h += `</div>`;

      if (view === 'positions' && voicings.length > 0) {
        h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:180px;overflow-y:auto;padding:4px 0">`;
        voicings.forEach((v, vi) => {
          h += `<div class="voicing-card" data-vi="${vi}" style="display:inline-block">${renderMiniDiagram(v, root, selVoicing === vi, true, intervalLabel)}</div>`;
        });
        h += `</div>`;
        if (selVoicing !== null && voicings[selVoicing]) {
          const v = voicings[selVoicing];
          const played   = v.positions.filter(x => x.fret >= 0);
          const fretted  = played.filter(x => x.fret > 0);
          const lo = fretted.length ? Math.min(...fretted.map(x => x.fret)) : 0;
          const hi = fretted.length ? Math.max(...fretted.map(x => x.fret)) : 0;
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">Frets ${lo||'open'}–${hi||'open'} · ${played.length} strings</div>`;
        }
      } else if (view === 'positions') {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:12px 0">No standard voicings found for this chord in current tuning</div>`;
      }

    } else {
      // KEY mode
      h += `<div><div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-bottom:3px">SCALE TYPE</div><div style="display:flex;flex-wrap:wrap;gap:3px">`;
      Object.keys(KEY_PATTERNS).forEach(k => {
        h += `<button class="chord-btn key-type-btn ${keyMode===k?'active':''}" data-km="${k}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui))">${k}</button>`;
      });
      h += `</div></div>`;

      const chords = getKeyChords(root, keyMode);
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));letter-spacing:1px;margin-top:2px">CHORDS IN ${root} ${keyMode.toUpperCase()}</div>`;
      h += `<div style="display:grid;grid-template-columns:repeat(${chords.length},1fr);gap:3px">`;
      chords.forEach((ch, i) => {
        const act = selKeyChord === i;
        const ql  = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ch.quality === 'Aug' ? '+' : ch.quality;
        // The key's chords are the control the eye lands on first, so they wear
        // the pedal's own accent (rk-chip) — the old violet .active read as a
        // note colour, and violet means nothing in the key of C. The root name
        // gets its own ink rather than opacity, which at this size just made it
        // unreadable.
        h += `<button class="rk-chip key-chord-btn${act?' is-active':''}" data-kci="${i}" style="min-height:calc(28px*var(--ui));padding:4px 3px;letter-spacing:0"><div style="font-size:calc(10px*var(--ui));font-weight:700">${ch.numeral}</div><div style="font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">${ch.root}${ql}</div></button>`;
      });
      h += `</div>`;

      h += `<div style="display:flex;gap:4px">`;
      h += `<button class="chord-btn ${keyView==='positions'?'active':''}" data-kv="positions" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">⬚ POSITIONS</button>`;
      h += `<button class="chord-btn ${keyView==='chords'?'active':''}" data-kv="chords" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">🎵 VOICINGS</button>`;
      h += `<button class="chord-btn ${keyView==='all'?'active':''}" data-kv="all" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui))">◈ ALL</button>`;
      h += `</div>`;

      if (keyView === 'positions') {
        if (!keyPositionData || keyPositionData._root !== root || keyPositionData._km !== keyMode) {
          keyPositionData = getKeyPositionZones(root, keyMode, chords);
          keyPositionData._root = root; keyPositionData._km = keyMode;
        }
        const zones = keyPositionData.zones;
        h += `<div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;padding:2px 0">`;
        zones.forEach((zone, zi) => {
          if (!zone.chords.length) return;
          const zAct = selKeyZone === zi;
          h += `<div class="key-zone" data-kz="${zi}" style="border:1px solid ${zAct?'var(--rk-accent)':'var(--rk-edge-soft)'};border-radius:8px;padding:6px 8px;background:${zAct?'var(--rk-soft)':'var(--rk-panel)'};cursor:pointer">`;
          h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">`;
          h += `<span class="mono" style="color:${zAct?'var(--rk-accent)':'var(--rk-ink-mute)'};font-size:calc(10px*var(--ui));font-weight:700">${zone.label}</span>`;
          h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">Frets ${zone.lo}–${zone.hi}</span>`;
          h += `</div><div style="display:flex;flex-wrap:wrap;gap:3px">`;
          zone.chords.forEach((zc, zci) => {
            const act2 = zAct && selZoneChord === zci;
            h += `<button class="zone-chord-btn" data-kz="${zi}" data-zci="${zci}" style="min-height:calc(28px*var(--ui));background:${act2?'var(--rk-soft2)':'var(--rk-panel2)'};border:1px solid ${act2?'var(--rk-accent)':'var(--rk-edge-soft)'};color:${act2?'var(--rk-accent)':'var(--rk-ink-dim)'};border-radius:4px;padding:2px 6px;cursor:pointer;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace;font-weight:600">`;
            h += `${zc.numeral} <span style="opacity:.6;font-size:calc(8px*var(--ui))">${zc.name||''}</span></button>`;
          });
          h += `</div>`;
          if (zAct) {
            h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;justify-content:center">`;
            zone.chords.forEach((zc, zci) => {
              h += `<div class="zone-voicing-card" data-kz="${zi}" data-zci="${zci}" style="display:inline-block;opacity:${selZoneChord===zci||selZoneChord===null?1:.4}">${renderMiniDiagram(zc, zc.root, selZoneChord === zci, true, intervalLabel)}</div>`;
            });
            h += `</div>`;
          }
          h += `</div>`;
        });
        h += `</div>`;

      } else if (keyView === 'chords') {
        if (selKeyChord !== null && chords[selKeyChord]) {
          const ch = chords[selKeyChord];
          const chVoicings = findVoicings(ch.root, ch.notes, ch.quality);
          h += `<div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:6px;padding:5px 8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center">`;
          h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(11px*var(--ui));font-weight:800">${ch.numeral} — ${ch.root} ${ch.quality}</span>`;
          ch.notes.forEach((n, i) => { h += `<span class="mono" style="color:${i===0?'var(--rk-accent)':'var(--rk-dim)'};font-size:calc(10px*var(--ui));font-weight:700">${n}</span>`; });
          h += `</div>`;
          if (chVoicings.length > 0) {
            h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:180px;overflow-y:auto;padding:4px 0">`;
            chVoicings.forEach((v, vi) => {
              h += `<div class="key-voicing-card" data-kvi="${vi}" style="display:inline-block">${renderMiniDiagram(v, ch.root, selKeyVoicing === vi, true, intervalLabel)}</div>`;
            });
            h += `</div>`;
          } else {
            h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:8px 0">No voicings found</div>`;
          }
        } else {
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:12px 0">Select a chord above to see voicings</div>`;
        }
      } else {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:8px 0">All notes of ${root} ${keyMode} shown on fretboard</div>`;
      }
    }
    if (getInst().renderer === 'fretboard') {
      h += `<button class="rk-chip sc-toggle${p._strumOn ? ' is-active' : ''}" aria-pressed="${!!p._strumOn}" title="Listens to your guitar and shows which strings of this shape rang">🎤 Check my strum</button>`;
      h += `<div class="sc-box" id="sc-${p.id}" hidden></div>`;
    }
    h += theoryPanelHTML('chorddir', CD_THEORY);
    h += `</div>`;
    el.innerHTML = h;
    wireTheoryPanel(el);
    paintStrum();

    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = e => { e.stopPropagation(); mode = b.dataset.mode; selKeyChord = null; selKeyZone = null; selZoneChord = null; selKeyVoicing = null; if (mode === 'chord') computeVoicings(); applyHighlight(); render(); });
    el.querySelectorAll('.root-btn').forEach(b => b.onclick = e => { e.stopPropagation(); root = b.dataset.root; selKeyChord = null; selKeyZone = null; selZoneChord = null; selKeyVoicing = null; keyPositionData = null; if (mode === 'chord') computeVoicings(); pedalBus.setKey(root, mode === 'key' ? keyMode : chordType, { source: p.id }); applyHighlight(); render(); });
    el.querySelectorAll('.type-btn').forEach(b => b.onclick = e => { e.stopPropagation(); chordType = b.dataset.type; chordCat = b.dataset.cat; computeVoicings(); applyHighlight(); render(); });
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = e => { e.stopPropagation(); view = b.dataset.view; applyHighlight(); render(); });
    el.querySelectorAll('.voicing-card').forEach(b => b.onclick = e => { e.stopPropagation(); const vi = parseInt(b.dataset.vi); selVoicing = selVoicing === vi ? null : vi; applyHighlight(); render(); });
    el.querySelectorAll('.key-type-btn').forEach(b => b.onclick = e => { e.stopPropagation(); keyMode = b.dataset.km; selKeyChord = null; selKeyZone = null; selZoneChord = null; selKeyVoicing = null; keyPositionData = null; pedalBus.setKey(root, keyMode, { source: p.id }); applyHighlight(); render(); });
    el.querySelectorAll('[data-kv]').forEach(b => b.onclick = e => { e.stopPropagation(); keyView = b.dataset.kv; selKeyZone = null; selZoneChord = null; selKeyVoicing = null; applyHighlight(); render(); });
    el.querySelectorAll('.key-chord-btn').forEach(b => b.onclick = e => { e.stopPropagation(); const i = parseInt(b.dataset.kci); selKeyChord = selKeyChord === i ? null : i; selKeyVoicing = null; applyHighlight(); render(); });
    el.querySelectorAll('.key-zone').forEach(b => {
      if (!b.dataset.kz) return;
      b.onclick = e => { if (e.target.closest('.zone-chord-btn') || e.target.closest('.zone-voicing-card')) return; e.stopPropagation(); const zi = parseInt(b.dataset.kz); selKeyZone = selKeyZone === zi ? null : zi; selZoneChord = null; applyHighlight(); render(); };
    });
    el.querySelectorAll('.zone-chord-btn').forEach(b => b.onclick = e => { e.stopPropagation(); const zi = parseInt(b.dataset.kz), zci = parseInt(b.dataset.zci); selKeyZone = zi; selZoneChord = selZoneChord === zci ? null : zci; applyHighlight(); render(); });
    el.querySelectorAll('.zone-voicing-card').forEach(b => b.onclick = e => { e.stopPropagation(); const zi = parseInt(b.dataset.kz), zci = parseInt(b.dataset.zci); selKeyZone = zi; selZoneChord = selZoneChord === zci ? null : zci; applyHighlight(); render(); });
    el.querySelectorAll('.key-voicing-card').forEach(b => b.onclick = e => { e.stopPropagation(); const vi = parseInt(b.dataset.kvi); selKeyVoicing = selKeyVoicing === vi ? null : vi; applyHighlight(); render(); });
    const scBtn = el.querySelector('.sc-toggle');
    if (scBtn) scBtn.onclick = e => {
      e.stopPropagation();
      p._strumOn = !p._strumOn;
      scBtn.classList.toggle('is-active', p._strumOn);
      scBtn.setAttribute('aria-pressed', String(p._strumOn));
      syncStrum(); paintStrum();
    };
    const sendProg = el.querySelector('.send-prog');
    if (sendProg) sendProg.onclick = e => {
      e.stopPropagation();
      const ch = getSelectedProgressionChord();
      if (!ch || !pedalBus.rebuildPedal) return;
      pedalBus.rebuildPedal('progression', { root, keyType: keyMode, progMode: 'custom', _appendChord: ch });
    };

    Object.assign(s, { mode, root, chordType, chordCat, keyMode, view, keyView });
  }

  render(); applyHighlight();
}
