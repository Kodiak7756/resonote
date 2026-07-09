// ════════════════════════════════════════════════════════════════════
//  Scale & Arpeggio Explorer — the merge of Scale Explorer + Arpeggios.
//  One pedal, a SCALES / ARPS mode toggle. Each mode reuses its original
//  file's proven CAGED box engine (exported from scale-explorer.js /
//  arpeggios.js); this file is just the unified, Option-A front-end with
//  a smart Theory panel.
// ════════════════════════════════════════════════════════════════════
import { NOTES, SCALE_TYPES, getScaleNotes, getChordNotes, intervalLabel } from '../core/music-theory.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus, keyTypeToScale, keyTypeToArpeggio, normalizeKeyType } from '../core/state.js';
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
    mode: 'arps', accent: '#cc66aa', label: 'Arpeggio', noteLabel: 'arpeggio tones',
    TYPES: ARP_TYPES, COLORS: ARP_COLORS,
    findBoxes: findScaleBoxesArp, renderBox: renderArpBoxDiagram, getDisp: getDispArp,
    notesOf: (root, iv) => getChordNotes(root, iv),
    optsFor: (cat, name) => ({ arpCat: cat, arpName: name }),
    keyMap: keyTypeToArpeggio,
  };
  return {
    mode: 'scales', accent: '#44bbcc', label: 'Scale', noteLabel: 'scale notes',
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

    // Pedal chrome keeps ONE stable identity (cyan); only the fretboard + box
    // diagrams + note swatches stay mode-coloured (cfg.COLORS) so a scale vs an
    // arpeggio reads differently on the neck — the one place colour earns its keep.
    let h = `<div class="rk rk-scalearp" style="--rk-accent:#44bbcc">`;

    // Mode toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn sa-mode${mode === 'scales' ? ' is-active' : ''}" data-m="scales" style="flex:1;font-size:10px;padding:7px 0">◆ SCALES</button>
      <button class="rk-seg-btn sa-mode${mode === 'arps' ? ' is-active' : ''}" data-m="arps" style="flex:1;font-size:10px;padding:7px 0">◈ ARPEGGIOS</button>
    </div>`;

    // Top blurb for the active mode (Chord-Family-Lab style)
    h += `<div style="font-size:9.5px;line-height:1.45;color:#c8c8c8;background:color-mix(in srgb,var(--rk-accent) 12%,transparent);border-left:2px solid var(--rk-accent);padding:6px 8px;border-radius:4px">${mode === 'arps'
      ? 'An <b>arpeggio</b> is a chord played one note at a time — just the chord tones. Solo with these to land on the strongest notes over each chord.'
      : 'A <b>scale</b> is the note palette your melodies and solos draw from. The cards show it as five hand-shapes up the neck — tap one to light it up.'}</div>`;

    // Root selector
    h += `<div class="rk-section"><div class="rk-label">ROOT</div><div class="rk-seg" style="gap:3px">`;
    NOTES.forEach(n => {
      h += `<button class="rk-seg-btn sa-root${n === root ? ' is-active' : ''}" data-root="${n}" style="min-width:26px;padding:5px 0">${n}</button>`;
    });
    h += `</div></div>`;

    // Type categories
    h += `<div class="rk-section"><div class="rk-label">${mode === 'arps' ? 'ARPEGGIO TYPE' : 'SCALE TYPE'}</div>`;
    Object.entries(cfg.TYPES).forEach(([c, types]) => {
      h += `<div class="rk-label" style="margin-top:5px;color:#4a4a4a">${c}</div><div class="rk-seg" style="gap:3px">`;
      Object.keys(types).forEach(nm => {
        const act = name === nm && cat === c;
        h += `<button class="rk-seg-btn sa-type${act ? ' is-active' : ''}" data-n="${nm}" data-c="${c}" style="font-size:8.5px;padding:5px 8px">${nm}</button>`;
      });
      h += `</div>`;
    });
    h += `</div>`;

    // Info bar
    h += `<div class="rk-section"><div style="background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:8px;padding:7px 9px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap">
      <span class="mono" style="color:var(--rk-accent);font-size:12px;font-weight:800">${root} ${name}${mode === 'arps' ? ' arp' : ''}</span>
      <span class="mono" style="color:#444;font-size:9px">│</span>`;
    notes.forEach((n, i) => {
      h += `<span class="mono" style="color:${i === 0 ? cfg.COLORS.root : cfg.COLORS.tone};font-size:10px;font-weight:${i === 0 ? 800 : 600}">${showIntervals ? intervalLabel(root, n) : n}</span>`;
    });
    h += `</div></div>`;

    // View toggle
    h += `<div class="rk-seg" style="gap:5px">
      <button class="rk-seg-btn sa-view${view === 'positions' ? ' is-active' : ''}" data-v="positions" style="flex:1;font-size:9px;padding:6px 0">⬚ POSITIONS</button>
      <button class="rk-seg-btn sa-view${view === 'all' ? ' is-active' : ''}" data-v="all" style="flex:1;font-size:9px;padding:6px 0">◈ ALL NOTES</button>
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
          h += `<div class="mono" style="color:#888;font-size:8px;text-align:center">${b.label}${b.lo !== undefined ? ` · Frets ${b.lo}–${b.hi}` : ''} · ${b.totalNotes} notes</div>`;
        }
      } else {
        h += `<div class="mono" style="color:#555;font-size:9px;text-align:center;padding:12px 0">No positions found</div>`;
      }
    } else {
      h += `<div class="mono" style="color:#667;font-size:9px;text-align:center;padding:2px 0">All ${root} ${name} ${cfg.noteLabel} on the fretboard</div>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;padding:2px 0">`;
      notes.forEach((n, i) => {
        const isR = i === 0;
        h += `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:50%;background:${isR ? cfg.COLORS.root : cfg.COLORS.tone}"></span><span class="mono" style="color:#888;font-size:7px">${isR ? 'R' : (showIntervals ? intervalLabel(root, n) : i + 1)}=${n}</span></span>`;
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
