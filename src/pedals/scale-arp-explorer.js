// ════════════════════════════════════════════════════════════════════
//  Scale & Arpeggio Explorer — the merge of Scale Explorer + Arpeggios.
//  One pedal, a SCALES / ARPS mode toggle. Each mode reuses its original
//  file's proven CAGED box engine (exported from scale-explorer.js /
//  arpeggios.js); this file is just the unified, Option-A front-end with
//  a smart Theory panel.
// ════════════════════════════════════════════════════════════════════
import { NOTES, SCALE_TYPES, getScaleNotes, getChordNotes, intervalLabel } from '../core/music-theory.js';
import { showIntervals, setChordHighlight, clearChordHighlight, setConceptInfo, pedalBus, keyTypeToScale, keyTypeToArpeggio, normalizeKeyType } from '../core/state.js';

// ── Objective facts for the concept strip under the fretboard ────────────────
// Defining tones per scale — stated as theory facts, not impressions.
const SCALE_CHARACTER = {
  'Major': 'half steps fall at 3–4 and 7–8 — the reference scale', 'Ionian': 'identical to the major scale',
  'Nat. Minor': 'defining tones: ♭3 · ♭6 · ♭7', 'Aeolian': 'identical to natural minor — ♭3 · ♭6 · ♭7',
  'Harm. Minor': 'natural minor with a raised 7 — leaves an augmented 2nd (3 semitones) between ♭6 and 7',
  'Mel. Minor': 'minor ♭3 with major 6 and 7 — the classical form descends as natural minor',
  'Dorian': 'minor with a natural 6 — the ♮6 is the defining tone',
  'Phrygian': 'minor with a ♭2 — the half step directly above the root defines it',
  'Lydian': 'major with a ♯4', 'Mixolydian': 'major with a ♭7',
  'Locrian': 'minor with ♭2 AND ♭5 — its tonic triad is diminished, so it never rests',
  'Major Pent.': 'the major scale minus its half-step tones (no 4, no 7)',
  'Minor Pent.': 'natural minor minus the 2 and ♭6 — no half steps at all',
  'Blues Minor': 'minor pentatonic plus the ♭5 blue note', 'Blues Major': 'major pentatonic plus the ♭3 blue note',
  'Whole Tone': 'six equal whole steps — perfectly symmetrical, no leading tone',
  'Dim (W-H)': 'alternating whole–half steps — repeats every 3 frets', 'Dim (H-W)': 'alternating half–whole steps — repeats every 3 frets',
};
// Same-notes relationships, computed from the root (offset in semitones + template).
const SCALE_RELATIVE = {
  'Major':      r => `relative minor: ${NOTES[(NOTES.indexOf(r) + 9) % 12]} natural minor — same seven notes`,
  'Ionian':     r => `relative minor: ${NOTES[(NOTES.indexOf(r) + 9) % 12]} natural minor — same seven notes`,
  'Nat. Minor': r => `relative major: ${NOTES[(NOTES.indexOf(r) + 3) % 12]} major — same seven notes`,
  'Aeolian':    r => `relative major: ${NOTES[(NOTES.indexOf(r) + 3) % 12]} major — same seven notes`,
  'Dorian':     r => `same notes as ${NOTES[(NOTES.indexOf(r) + 10) % 12]} major (2nd mode)`,
  'Phrygian':   r => `same notes as ${NOTES[(NOTES.indexOf(r) + 8) % 12]} major (3rd mode)`,
  'Lydian':     r => `same notes as ${NOTES[(NOTES.indexOf(r) + 7) % 12]} major (4th mode)`,
  'Mixolydian': r => `same notes as ${NOTES[(NOTES.indexOf(r) + 5) % 12]} major (5th mode)`,
  'Locrian':    r => `same notes as ${NOTES[(NOTES.indexOf(r) + 1) % 12]} major (7th mode)`,
  'Major Pent.': r => `same five notes as ${NOTES[(NOTES.indexOf(r) + 9) % 12]} minor pentatonic`,
  'Minor Pent.': r => `same five notes as ${NOTES[(NOTES.indexOf(r) + 3) % 12]} major pentatonic`,
  'Blues Minor': r => `same notes as ${NOTES[(NOTES.indexOf(r) + 3) % 12]} major blues`,
  'Blues Major': r => `same notes as ${NOTES[(NOTES.indexOf(r) + 9) % 12]} minor blues`,
};
const STEP_NAME = { 1: 'H', 2: 'W', 3: 'm3', 4: 'M3' };
import { updateOverlays } from '../ui/fretboard.js';
import { findScaleBoxes as findScaleBoxesScale, renderScaleBoxDiagram, getDisplayPositionsForBox as getDispScale, SCALE_COLORS } from './scale-explorer.js';
import { findScaleBoxes as findScaleBoxesArp, renderArpBoxDiagram, getDisplayPositionsForBox as getDispArp, ARP_TYPES, ARP_COLORS } from './arpeggios.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const THEORY = {
  scales: {
    kicker: 'SCALES', title: 'Scales — the palette you solo from',
    what: `A <b>scale</b> is the set of notes a key is built from — the palette every melody and solo draws on. The <b>position boxes</b> are that same scale shown as hand-shapes up the neck (the CAGED system), so you can find it anywhere, not just in one spot.`,
    why: `Knowing a scale in five positions is what lets you solo across the whole neck instead of getting stuck in one box. The <b>root</b> notes (bright) are home base — landing on them resolves a phrase. Switch to <b>ALL NOTES</b> to see the whole shape, or tap a position card to isolate one playable box.`,
    lessonId: 'minor-pentatonic-box-1',
  },
  arps: {
    kicker: 'ARPEGGIOS', title: 'Arpeggios — the chord, one note at a time',
    what: `An <b>arpeggio</b> is a chord played one note at a time — just its <b>chord tones</b> (1·3·5, plus the 7th for seventh chords). Same five-position CAGED logic as scales, but only the notes that <i>are</i> the chord.`,
    why: `Soloing with arpeggio tones lands you on the strongest notes over each chord — the ones that spell the harmony — so your lines sound intentional, never random. Chord-tone targeting is the backbone of melodic and jazz soloing: play the arpeggio of whatever chord is sounding and you can't hit a wrong note.`,
    lessonId: 'targeting-chord-tones',
  },
};

function modeConfig(mode) {
  if (mode === 'arps') return {
    mode: 'arps', label: 'Arpeggio', noteLabel: 'arpeggio tones',
    TYPES: ARP_TYPES, COLORS: ARP_COLORS,
    findBoxes: findScaleBoxesArp, renderBox: renderArpBoxDiagram, getDisp: getDispArp,
    notesOf: (root, iv) => getChordNotes(root, iv),
    optsFor: (cat, name) => ({ arpCat: cat, arpName: name }),
    keyMap: keyTypeToArpeggio,
  };
  return {
    mode: 'scales', label: 'Scale', noteLabel: 'scale notes',
    TYPES: SCALE_TYPES, COLORS: SCALE_COLORS,
    findBoxes: findScaleBoxesScale, renderBox: renderScaleBoxDiagram, getDisp: getDispScale,
    notesOf: (root, iv) => getScaleNotes(root, iv),
    optsFor: (cat, name) => ({ scaleCat: cat, scaleName: name }),
    keyMap: keyTypeToScale,
  };
}

export function buildScaleArpContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});

  let root      = s.root || 'C';
  let mode      = s.saMode || (p.type === 'arpeggios' ? 'arps' : 'scales');
  let scaleName = s.scaleName || 'Major';
  let scaleCat  = s.scaleCat  || 'Diatonic';
  let arpName   = s.arpName   || 'Major';
  let arpCat    = s.arpCat    || 'Triads';
  let view      = s.saView || 'positions';
  let selBox    = null;

  const cur = () => mode === 'arps'
    ? { name: arpName, cat: arpCat }
    : { name: scaleName, cat: scaleCat };

  function getIntervals(cfg) {
    const { name, cat } = cur();
    return cfg.TYPES[cat]?.[name] || (mode === 'arps' ? [0, 4, 7] : [0, 2, 4, 5, 7, 9, 11]);
  }

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) || !document.getElementById(`body-${p.id}`)) return;
    root = ev.root;
    if (ev.keyType) {
      const cfg = modeConfig(mode);
      const mapped = cfg.keyMap(ev.keyType);
      if (mode === 'arps') { arpCat = mapped.arpCat; arpName = mapped.arpName; }
      else { scaleCat = mapped.scaleCat; scaleName = mapped.scaleName; }
    }
    selBox = null;
    applyHighlight();
    render();
  });

  function render() {
    const cfg = modeConfig(mode);
    const { name, cat } = cur();
    const intervals = getIntervals(cfg);
    const notes = cfg.notesOf(root, intervals);

    // Pedal chrome keeps ONE stable identity and it is the CARD's, not a colour
    // named here; only the fretboard + box diagrams + note swatches stay
    // mode-coloured (cfg.COLORS) so a scale vs an arpeggio reads differently on the
    // neck — the one place colour earns its keep.
    let h = `<div class="rk rk-scalearp">`;

    // Mode toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn sa-mode${mode === 'scales' ? ' is-active' : ''}" data-m="scales" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:7px 0">◆ SCALES</button>
      <button class="rk-seg-btn sa-mode${mode === 'arps' ? ' is-active' : ''}" data-m="arps" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:7px 0">◈ ARPEGGIOS</button>
    </div>`;

    // Top blurb for the active mode (Chord-Family-Lab style)
    h += `<div style="font-size:calc(9.5px*var(--ui));line-height:1.45;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid var(--rk-accent);padding:6px 8px;border-radius:4px">${mode === 'arps'
      ? 'An <b>arpeggio</b> is a chord played one note at a time — just the chord tones. Solo with these to land on the strongest notes over each chord.'
      : 'A <b>scale</b> is the note palette your melodies and solos draw from. The cards show it as five hand-shapes up the neck — tap one to light it up.'}</div>`;

    // Root selector
    h += `<div class="rk-section"><div class="rk-label">ROOT</div><div class="rk-seg" style="gap:3px">`;
    NOTES.forEach(n => {
      h += `<button class="rk-seg-btn sa-root${n === root ? ' is-active' : ''}" data-root="${n}" style="min-height:calc(28px*var(--ui));min-width:26px;padding:5px 0">${n}</button>`;
    });
    h += `</div></div>`;

    // Type categories
    h += `<div class="rk-section"><div class="rk-label">${mode === 'arps' ? 'ARPEGGIO TYPE' : 'SCALE TYPE'}</div>`;
    Object.entries(cfg.TYPES).forEach(([c, types]) => {
      h += `<div class="rk-label" style="margin-top:5px;color:var(--rk-ink-mute)">${c}</div><div class="rk-seg" style="gap:3px">`;
      Object.keys(types).forEach(nm => {
        const act = name === nm && cat === c;
        h += `<button class="rk-seg-btn sa-type${act ? ' is-active' : ''}" data-n="${nm}" data-c="${c}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:5px 8px">${nm}</button>`;
      });
      h += `</div>`;
    });
    h += `</div>`;

    // Info bar
    h += `<div class="rk-section"><div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:8px;padding:7px 9px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap">
      <span class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:800">${root} ${name}${mode === 'arps' ? ' arp' : ''}</span>
      <span class="mono" style="color:var(--rk-edge);font-size:calc(9px*var(--ui))">│</span>`;
    notes.forEach((n, i) => {
      h += `<span class="mono" style="color:${i === 0 ? cfg.COLORS.root : cfg.COLORS.tone};font-size:calc(10px*var(--ui));font-weight:${i === 0 ? 800 : 600}">${showIntervals ? intervalLabel(root, n) : n}</span>`;
    });
    h += `</div></div>`;

    // View toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn sa-view${view === 'positions' ? ' is-active' : ''}" data-v="positions" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:6px 0">⬚ POSITIONS</button>
      <button class="rk-seg-btn sa-view${view === 'all' ? ' is-active' : ''}" data-v="all" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));padding:6px 0">◈ ALL NOTES</button>
    </div>`;

    if (view === 'positions') {
      const boxes = cfg.findBoxes(root, intervals, cfg.optsFor(cat, name));
      if (boxes.length) {
        h += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:230px;overflow-y:auto;padding:4px 0">`;
        boxes.forEach((box, bi) => {
          h += `<div class="sa-box-card" data-bi="${bi}" style="display:inline-block">${cfg.renderBox(box, root, selBox === bi)}</div>`;
        });
        h += `</div>`;
        if (selBox !== null && boxes[selBox]) {
          const b = boxes[selBox];
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${b.label}${b.lo !== undefined ? ` · Frets ${b.lo}–${b.hi}` : ''} · ${b.totalNotes} notes</div>`;
        }
      } else {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:12px 0">No positions found</div>`;
      }
    } else {
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));text-align:center;padding:2px 0">All ${root} ${name} ${cfg.noteLabel} on the fretboard</div>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;padding:2px 0">`;
      notes.forEach((n, i) => {
        const isR = i === 0;
        h += `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:50%;background:${isR ? cfg.COLORS.root : cfg.COLORS.tone}"></span><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${isR ? 'R' : (showIntervals ? intervalLabel(root, n) : i + 1)}=${n}</span></span>`;
      });
      h += `</div>`;
    }

    // Theory panel
    h += theoryPanelHTML('scalearp', THEORY[mode]);
    h += `</div>`;
    el.innerHTML = h;

    // Wire
    el.querySelectorAll('.sa-mode').forEach(b => b.onclick = e => {
      e.stopPropagation(); mode = b.dataset.m; selBox = null; applyHighlight(); render();
    });
    el.querySelectorAll('.sa-root').forEach(b => b.onclick = e => {
      e.stopPropagation();
      root = b.dataset.root; selBox = null;
      const c2 = modeConfig(mode);
      pedalBus.setKey(root, normalizeKeyType(name), { source: p.id, ...c2.optsFor(cat, name) });
      applyHighlight(); render();
    });
    el.querySelectorAll('.sa-type').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const nm = b.dataset.n, c = b.dataset.c;
      if (mode === 'arps') { arpName = nm; arpCat = c; } else { scaleName = nm; scaleCat = c; }
      selBox = null;
      const c2 = modeConfig(mode);
      pedalBus.setKey(root, normalizeKeyType(nm), { source: p.id, ...c2.optsFor(c, nm) });
      applyHighlight(); render();
    });
    el.querySelectorAll('.sa-view').forEach(b => b.onclick = e => {
      e.stopPropagation(); view = b.dataset.v; selBox = null; applyHighlight(); render();
    });
    el.querySelectorAll('.sa-box-card').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const bi = parseInt(b.dataset.bi);
      selBox = selBox === bi ? null : bi;
      applyHighlight(); render();
    });
    wireTheoryPanel(el);

    Object.assign(s, { root, saMode: mode, scaleName, scaleCat, arpName, arpCat, saView: view });
  }

  function applyHighlight() {
    const cfg = modeConfig(mode);
    const { name, cat } = cur();
    const intervals = getIntervals(cfg);
    const notes = cfg.notesOf(root, intervals);
    const suffix = mode === 'arps' ? ' Arpeggio' : '';
    // publish the objective facts to the strip under the fretboard
    const rows = [{ label: 'NOTES', value: notes.join(' · ') }];
    rows.push({ label: 'DEGREES', value: intervals.map(iv => intervalLabel(root, NOTES[(NOTES.indexOf(root) + iv) % 12])).join(' · ') });
    if (mode === 'arps') {
      rows.push({ label: 'STRUCTURE', value: `the chord tones of ${root} ${name}, played melodically` });
    } else {
      const gaps = intervals.map((iv, i) => (i + 1 < intervals.length ? intervals[i + 1] : 12) - iv);
      rows.push({ label: 'STEPS', value: gaps.map(g => STEP_NAME[g] || g + 'st').join('–') });
      if (SCALE_CHARACTER[name]) rows.push({ label: 'CHARACTER', value: SCALE_CHARACTER[name] });
      if (SCALE_RELATIVE[name]) rows.push({ label: 'RELATED', value: SCALE_RELATIVE[name](root) });
    }
    setConceptInfo({ title: `${root} ${name}${suffix}`, rows });
    if (view === 'positions' && selBox !== null) {
      const boxes = cfg.findBoxes(root, intervals, cfg.optsFor(cat, name));
      if (boxes[selBox]) {
        setChordHighlight(root, notes, `${root} ${name}${suffix} — ${boxes[selBox].label}`, cfg.getDisp(boxes[selBox], root), cfg.COLORS);
        updateOverlays();
        return;
      }
    }
    setChordHighlight(root, notes, `${root} ${name}${suffix}`, null, cfg.COLORS);
    updateOverlays();
  }

  render();
  applyHighlight();
}
