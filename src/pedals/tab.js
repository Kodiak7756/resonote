// ─── Tab Practice Pedal ───────────────────────────────────────────────────────
//
// Imports ASCII guitar tab text, renders a scrolling tab strip, and drives the
// main fretboard with:
//   • Current column  → solid blue dots  (setChordHighlight)
//   • Next column     → ghost/dashed dots (setGhostHighlight)
//
// Watch mode  : auto-advances columns at the chosen BPM.
// Practice mode: manual advance (► button or spacebar while pedal is focused).

import { NOTES } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import {
  setChordHighlight, clearChordHighlight,
  setGhostHighlight, clearGhostHighlight,
} from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';

// ─── Tab colours ──────────────────────────────────────────────────────────────

const TAB_COLORS = {
  root:       '#44aaff',
  tone:       '#44aaff',
  rootStroke: '#88ccff',
  toneStroke: '#88ccff',
};
const GHOST_COLORS = {
  stroke: 'rgba(68,170,255,0.55)',
  fill:   'rgba(68,170,255,0.07)',
};

// ─── Timer registry (survives re-renders without dangling intervals) ──────────

const _timers = {};

// ─── ASCII tab parser ─────────────────────────────────────────────────────────
//
// Parses multi-system ASCII tab text into an array of "columns":
//   { charPos, sysIdx, globalIdx, notes: { [stringIdx]: fretNumber }, width }
//
// String indices are 0-based top-to-bottom matching the tab text, which maps
// directly to customTuning indices (high e = 0, low E = ns-1).

const TAB_LINE_RE = /^\s*([eEBbGgDdAa][b#]?|\d)\s*\|/;

export function parseAsciiTab(text) {
  const lines = text.split('\n');

  // Group consecutive tab lines into "systems"
  const rawSystems = [];
  let cur = [];
  for (const line of lines) {
    if (TAB_LINE_RE.test(line)) {
      cur.push(line);
    } else {
      if (cur.length >= 2) rawSystems.push(cur.slice());
      cur = [];
    }
  }
  if (cur.length >= 2) rawSystems.push(cur);
  if (!rawSystems.length) return null;

  const allColumns = [];
  const systems = rawSystems.map((sysLines, sysIdx) => {
    const startIdx = allColumns.length;
    const cols     = parseSystem(sysLines, sysIdx, startIdx);
    allColumns.push(...cols);
    return { lines: sysLines, startColIdx: startIdx, colCount: cols.length };
  });

  return { columns: allColumns, systems };
}

function parseSystem(lines, sysIdx, globalOffset) {
  // Strip each line to a { label, content } pair
  const strings = lines.map((line, si) => {
    const m = line.match(/^(\s*[eEBbGgDdAa][b#]?|\s*\d)\s*\|(.*)/);
    if (!m) return null;
    return { si, label: m[1].trim(), content: m[2] };
  }).filter(Boolean);

  if (strings.length < 2) return [];

  const ns     = strings.length;
  const maxLen = Math.max(...strings.map(s => s.content.length));
  const cols   = [];
  let i = 0;

  while (i < maxLen) {
    const notes = {};
    let hasNote = false;
    let width   = 1;

    for (let si = 0; si < ns; si++) {
      const ch = strings[si].content[i];
      if (ch === undefined || !/\d/.test(ch)) continue;
      let num = ch, j = i + 1;
      while (j < strings[si].content.length && /\d/.test(strings[si].content[j])) {
        num += strings[si].content[j++];
      }
      notes[si] = parseInt(num, 10);
      hasNote   = true;
      width     = Math.max(width, j - i);
    }

    if (hasNote) {
      cols.push({
        charPos:    i,
        sysIdx,
        globalIdx:  globalOffset + cols.length,
        notes,
        width,
        labels:     strings.map(s => s.label),
      });
      i += width;
    } else {
      i++;
    }
  }

  return cols;
}

// ─── Column → fretboard positions ─────────────────────────────────────────────

function columnToPositions(col) {
  if (!col || !customTuning.length) return [];
  const ns  = customTuning.length;
  const out = [];

  Object.entries(col.notes).forEach(([siStr, fret]) => {
    const si = parseInt(siStr, 10);
    if (si >= ns) return;
    const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    out.push({
      si, fret,
      note:   info.note,
      octave: info.octave,
      midi:   info.octave * 12 + NOTES.indexOf(info.note),
      isRoot: false,  // treat all tab notes identically
      deg:    0,
    });
  });

  return out.sort((a, b) => b.si - a.si || a.fret - b.fret);
}

// ─── Tab strip HTML renderer ──────────────────────────────────────────────────
//
// Renders every system as monospace rows with column-position spans.
// data-cur attribute marks the current column's first-string span for scrolling.

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTabStrip(systems, columns, curIdx) {
  if (!systems?.length) return '';
  let html = '';

  systems.forEach((sys, sysIdx) => {
    const { lines } = sys;

    const strings = lines.map(line => {
      const m = line.match(/^(\s*[eEBbGgDdAa][b#]?|\s*\d)\s*\|(.*)/);
      return m ? { label: m[1].trim(), content: m[2] } : null;
    }).filter(Boolean);

    if (!strings.length) return;

    // Build lookup: charPos → column for this system
    const colByPos = {};
    columns.filter(c => c.sysIdx === sysIdx).forEach(c => { colByPos[c.charPos] = c; });

    const maxLen = Math.max(...strings.map(s => s.content.length));

    // Section divider for multi-system tabs
    if (systems.length > 1) {
      html += `<div class="mono" style="color:#1e2a2a;font-size:7px;padding:6px 0 2px;letter-spacing:2px;user-select:none">── ${sysIdx + 1} ──</div>`;
    }

    html += `<div class="tab-system" data-sysidx="${sysIdx}" style="font-family:'JetBrains Mono',monospace;font-size:11px;white-space:pre;line-height:1.65">`;

    strings.forEach(({ label, content }, si) => {
      // Label prefix (e, B, G, D, A, E)
      let row = `<span style="color:#2a4040;user-select:none">${escHtml(label)}|</span>`;

      let i = 0;
      while (i < maxLen) {
        const col = colByPos[i];
        if (col) {
          const gIdx   = col.globalIdx;
          const fret   = col.notes[si];
          // Pad fret number to column width for alignment
          const chars  = fret !== undefined
            ? String(fret).padEnd(col.width, '-')
            : '-'.repeat(col.width);

          const isCur  = gIdx === curIdx;
          const isNext = gIdx === curIdx + 1;
          const isPast = gIdx < curIdx;

          let color = isPast  ? '#1a2020'
                    : isNext  ? '#2a5566'
                    :           '#1e3a3a';  // upcoming (not yet reached)
          let bg    = 'transparent';
          let extra = '';

          if (isCur) {
            color = '#44ddff';
            bg    = 'rgba(68,221,255,0.13)';
            // Only mark the very first string so we get one element to scroll to
            if (si === 0) extra = ' data-cur="1"';
          } else if (isNext && fret !== undefined) {
            color = '#3a8899';
          }

          row += `<span${extra} style="color:${color};background:${bg}">${escHtml(chars)}</span>`;
          i   += col.width;
        } else {
          const ch = i < content.length ? content[i] : '-';
          row += `<span style="color:#182424">${escHtml(ch)}</span>`;
          i++;
        }
      }

      html += `<div style="display:block">${row}</div>`;
    });

    html += `</div>`;
  });

  return html;
}

// ─── Note info card (NOW / NEXT) ──────────────────────────────────────────────

function renderColCard(col, label, accent, bg) {
  const dim = 'color:#111;font-size:10px;font-family:"JetBrains Mono",monospace';

  if (!col) {
    return `<div style="background:${bg};border:1px solid #0d1a1a;border-radius:5px;padding:6px 8px;min-height:44px">
      <div class="mono" style="color:${accent};font-size:7px;letter-spacing:1.5px;margin-bottom:3px">${label}</div>
      <div style="${dim}">—</div>
    </div>`;
  }

  const ns = customTuning.length;
  const noteItems = Object.entries(col.notes).map(([siStr, fret]) => {
    const si = parseInt(siStr, 10);
    if (si >= ns) return null;
    const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    return `<span class="mono" style="color:${accent};font-weight:700">${info.note}</span>` +
           `<span class="mono" style="color:#1e3a3a;font-size:7px">${fret}</span>`;
  }).filter(Boolean);

  return `<div style="background:${bg};border:1px solid #0d1a1a;border-radius:5px;padding:6px 8px">
    <div class="mono" style="color:${accent};font-size:7px;letter-spacing:1.5px;margin-bottom:3px">${label}</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:baseline">${noteItems.join('')}</div>
  </div>`;
}

// ─── Exported pedal builder ───────────────────────────────────────────────────

export function buildTabContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});

  // ── Persistent local state ──
  let rawText = s.rawText || '';
  let parsed  = rawText ? parseAsciiTab(rawText) : null;
  let columns = parsed?.columns || [];
  let systems = parsed?.systems || [];
  let curIdx  = typeof s.curIdx === 'number' ? Math.min(s.curIdx, columns.length - 1) : 0;
  let bpm     = s.bpm   || 80;
  let mode    = s.mode  || 'watch';   // 'watch' | 'practice'
  let playing = false;

  // ── Timer helpers ──
  function startTimer() {
    if (_timers[p.id]) clearInterval(_timers[p.id]);
    _timers[p.id] = setInterval(() => advance(false), Math.round(60000 / bpm));
  }
  function stopTimer() {
    if (_timers[p.id]) { clearInterval(_timers[p.id]); delete _timers[p.id]; }
  }

  // ── Column navigation ──
  function advance(manual = true) {
    if (!columns.length) return;
    if (curIdx >= columns.length - 1) {
      // Reached end
      if (!manual) { playing = false; stopTimer(); updatePlayBtn(); }
      return;
    }
    curIdx++;
    s.curIdx = curIdx;
    applyHighlight();
    refreshStrip();
  }

  function retreat() {
    if (!columns.length || curIdx <= 0) return;
    curIdx--;
    s.curIdx = curIdx;
    applyHighlight();
    refreshStrip();
  }

  function jumpTo(idx) {
    if (!columns.length) return;
    curIdx = Math.max(0, Math.min(columns.length - 1, idx));
    s.curIdx = curIdx;
    applyHighlight();
    refreshStrip();
  }

  // ── Fretboard highlight ──
  function applyHighlight() {
    if (!columns.length) {
      clearChordHighlight();
      clearGhostHighlight();
      updateOverlays();
      return;
    }

    const cur  = columns[curIdx];
    const next = columns[curIdx + 1];

    // Current column: solid blue dots
    const curPos  = columnToPositions(cur);
    const label   = `Tab col ${curIdx + 1}/${columns.length}`;
    setChordHighlight(null, curPos.map(p => p.note), label, curPos, TAB_COLORS);

    // Next column: ghost dots
    if (next) {
      setGhostHighlight(columnToPositions(next), GHOST_COLORS);
    } else {
      clearGhostHighlight();
    }

    updateOverlays();
  }

  // ── Tab strip refresh (no full re-render) ──
  function refreshStrip() {
    const strip = document.getElementById(`strip-${p.id}`);
    if (strip) {
      strip.innerHTML = renderTabStrip(systems, columns, curIdx);
      scrollStrip();
    }
    updateCounter();
    updateNowNext();
  }

  function scrollStrip() {
    // Small delay to let the DOM paint the new spans
    requestAnimationFrame(() => {
      const strip = document.getElementById(`strip-${p.id}`);
      if (!strip) return;
      const cur = strip.querySelector('[data-cur]');
      if (!cur) return;

      // Horizontal: keep current column roughly centred
      const sr = strip.getBoundingClientRect();
      const cr = cur.getBoundingClientRect();
      strip.scrollLeft += cr.left - sr.left - sr.width * 0.4;

      // Vertical: ensure current system is visible
      const sys = cur.closest('.tab-system');
      if (sys) {
        const sysr = sys.getBoundingClientRect();
        if (sysr.top < sr.top)    strip.scrollTop -= sr.top - sysr.top + 4;
        if (sysr.bottom > sr.bottom) strip.scrollTop += sysr.bottom - sr.bottom + 4;
      }
    });
  }

  function updateCounter() {
    const el = document.getElementById(`ctr-${p.id}`);
    if (el && columns.length) el.textContent = `${curIdx + 1} / ${columns.length}`;
  }

  function updateNowNext() {
    const nn = document.getElementById(`nownext-${p.id}`);
    if (!nn || !columns.length) return;
    nn.innerHTML =
      renderColCard(columns[curIdx],     'NOW',  '#44aaff', '#060f14') +
      renderColCard(columns[curIdx + 1], 'NEXT', '#2a6677', '#04090c');
  }

  function updatePlayBtn() {
    const btn = document.getElementById(`play-${p.id}`);
    if (btn) btn.textContent = playing ? '⏸ PAUSE' : '▶ PLAY';
  }

  // ── Play / pause ──
  function togglePlay() {
    if (!columns.length) return;
    playing = !playing;
    if (playing) startTimer(); else stopTimer();
    updatePlayBtn();
  }

  // ── Import ──
  function doImport(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = parseAsciiTab(trimmed);
    if (!result || !result.columns.length) {
      const err = document.getElementById(`err-${p.id}`);
      if (err) { err.textContent = '⚠ No tab columns found — check format'; err.style.display = 'block'; }
      return;
    }
    rawText = trimmed;
    parsed  = result;
    columns = result.columns;
    systems = result.systems;
    s.rawText = rawText;
    curIdx    = 0;
    s.curIdx  = 0;
    playing   = false;
    stopTimer();
    applyHighlight();
    render();
  }

  // ── Key handler (spacebar to advance in practice mode) ──
  function onKey(e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      advance(true);
    }
    if (e.code === 'ArrowRight') { e.preventDefault(); advance(true); }
    if (e.code === 'ArrowLeft')  { e.preventDefault(); retreat(); }
  }

  // ── Full render ──
  function render() {
    const hasTab = columns.length > 0;

    let h = `<div style="display:flex;flex-direction:column;gap:7px">`;

    // ── Import panel ──
    if (!hasTab) {
      h += `<div style="border:1px solid #0d1e1e;border-radius:6px;padding:8px">`;
      h += `<div class="mono" style="color:#2a4040;font-size:7px;letter-spacing:1.5px;margin-bottom:5px">PASTE ASCII TAB</div>`;
      h += `<textarea id="ta-${p.id}" rows="7"
          placeholder="e|---0---3---5---|\nB|---1---3---5---|\nG|---0---0---5---|\nD|---2---0---5---|\nA|---3-------5---|\nE|---0-------3---|"
          style="width:100%;background:#060f0f;color:#3a7070;border:1px solid #0d1e1e;border-radius:4px;
                 font-family:'JetBrains Mono',monospace;font-size:9px;padding:5px;resize:vertical;
                 box-sizing:border-box;outline:none;line-height:1.6"></textarea>`;
      h += `<div id="err-${p.id}" style="display:none;color:#ff5555;font-family:'JetBrains Mono',monospace;font-size:8px;padding:3px 0"></div>`;
      h += `<button id="import-${p.id}"
          style="margin-top:5px;width:100%;background:rgba(68,170,255,0.12);border:1px solid #1a4466;
                 border-radius:4px;color:#44aaff;font-family:'JetBrains Mono',monospace;font-size:9px;
                 padding:6px;cursor:pointer;letter-spacing:1px">↓ IMPORT TAB</button>`;
      h += `</div>`;

      h += `<div class="mono" style="color:#162020;font-size:8px;text-align:center;padding:4px">
        Supports standard 6-string, bass, or any instrument tab.<br>
        Multi-section tabs (multiple groups of lines) are supported.
      </div>`;
    } else {
      // ── Controls bar ──
      h += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">`;

      // BPM control
      h += `<div style="display:flex;align-items:center;gap:1px;background:#040c0c;border:1px solid #0d1e1e;border-radius:4px;padding:1px 4px">`;
      h += `<span class="mono" style="color:#2a4040;font-size:7px">BPM</span>`;
      h += `<button id="bdn-${p.id}" style="background:none;border:none;color:#2a5050;cursor:pointer;font-size:13px;padding:0 3px;line-height:1">−</button>`;
      h += `<span id="bpm-${p.id}" class="mono" style="color:#44aaff;font-size:10px;min-width:26px;text-align:center">${bpm}</span>`;
      h += `<button id="bup-${p.id}" style="background:none;border:none;color:#2a5050;cursor:pointer;font-size:13px;padding:0 3px;line-height:1">+</button>`;
      h += `</div>`;

      // Mode toggle
      const isWatch = mode === 'watch';
      h += `<button id="mode-${p.id}"
          style="background:${isWatch ? 'rgba(68,170,255,0.1)' : 'rgba(68,170,255,0.2)'};
                 border:1px solid ${isWatch ? '#1a4466' : '#44aaff'};border-radius:4px;
                 color:${isWatch ? '#3a7788' : '#44aaff'};font-family:'JetBrains Mono',monospace;
                 font-size:8px;padding:3px 7px;cursor:pointer;letter-spacing:1px">
          ${isWatch ? '👁 WATCH' : '🎸 PRACTICE'}</button>`;

      // Prev / Play / Next
      h += `<div style="display:flex;gap:3px;margin-left:auto">`;
      h += `<button id="prev-${p.id}" style="background:#040c0c;border:1px solid #0d1e1e;border-radius:3px;color:#2a5050;font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 7px;cursor:pointer">◄</button>`;
      if (isWatch) {
        h += `<button id="play-${p.id}" style="background:rgba(68,170,255,0.15);border:1px solid #1a5566;border-radius:3px;color:#44aaff;font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 8px;cursor:pointer">${playing ? '⏸ PAUSE' : '▶ PLAY'}</button>`;
      }
      h += `<button id="next-${p.id}" style="background:#040c0c;border:1px solid #0d1e1e;border-radius:3px;color:#2a5050;font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 7px;cursor:pointer">►</button>`;
      h += `</div>`;
      h += `</div>`;

      // Column counter + load-new link
      h += `<div style="display:flex;align-items:center;justify-content:space-between">`;
      h += `<span id="ctr-${p.id}" class="mono" style="color:#1a3a3a;font-size:8px">${curIdx + 1} / ${columns.length}</span>`;
      h += `<button id="new-${p.id}" style="background:none;border:none;color:#162020;font-family:'JetBrains Mono',monospace;font-size:7px;cursor:pointer;letter-spacing:1px;text-decoration:underline">load new tab</button>`;
      h += `</div>`;

      // ── Tab strip ──
      h += `<div id="strip-${p.id}"
          style="overflow:auto;background:#040c0c;border:1px solid #0d1e1e;border-radius:5px;
                 padding:7px 10px;max-height:160px;scroll-behavior:smooth">`;
      h += renderTabStrip(systems, columns, curIdx);
      h += `</div>`;

      // ── Now / Next cards ──
      h += `<div id="nownext-${p.id}" style="display:grid;grid-template-columns:1fr 1fr;gap:5px">`;
      h += renderColCard(columns[curIdx],     'NOW',  '#44aaff', '#060f14');
      h += renderColCard(columns[curIdx + 1], 'NEXT', '#2a6677', '#04090c');
      h += `</div>`;

      // Practice mode hint
      if (!isWatch) {
        h += `<div class="mono" style="color:#1a3a3a;font-size:8px;text-align:center;padding:1px">
          ► button · arrow keys · spacebar to advance</div>`;
      }

      // Progress bar
      const pct = columns.length > 1 ? (curIdx / (columns.length - 1)) * 100 : 0;
      h += `<div style="background:#040c0c;border:1px solid #0d1e1e;border-radius:3px;height:4px;cursor:pointer" id="prog-${p.id}">`;
      h += `<div style="background:#1a4466;width:${pct.toFixed(1)}%;height:100%;border-radius:3px;transition:width .1s"></div>`;
      h += `</div>`;
    }

    h += `</div>`;
    el.innerHTML = h;

    // ── Wire events ──
    if (!hasTab) {
      document.getElementById(`import-${p.id}`)?.addEventListener('click', () => {
        doImport(document.getElementById(`ta-${p.id}`)?.value || '');
      });
      // Allow Ctrl+Enter to import from textarea
      document.getElementById(`ta-${p.id}`)?.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doImport(e.target.value);
      });
    } else {
      document.getElementById(`new-${p.id}`)?.addEventListener('click', () => {
        stopTimer(); playing = false;
        columns = []; systems = []; rawText = ''; parsed = null;
        s.rawText = ''; s.curIdx = 0;
        clearChordHighlight(); clearGhostHighlight(); updateOverlays();
        render();
      });

      document.getElementById(`prev-${p.id}`)?.addEventListener('click', retreat);
      document.getElementById(`next-${p.id}`)?.addEventListener('click', () => advance(true));
      document.getElementById(`play-${p.id}`)?.addEventListener('click', togglePlay);

      document.getElementById(`mode-${p.id}`)?.addEventListener('click', () => {
        mode = mode === 'watch' ? 'practice' : 'watch';
        s.mode = mode;
        if (mode === 'practice') { stopTimer(); playing = false; }
        render();
        scrollStrip();
      });

      document.getElementById(`bdn-${p.id}`)?.addEventListener('click', () => {
        bpm = Math.max(20, bpm - 5); s.bpm = bpm;
        document.getElementById(`bpm-${p.id}`).textContent = bpm;
        if (playing) startTimer();
      });
      document.getElementById(`bup-${p.id}`)?.addEventListener('click', () => {
        bpm = Math.min(300, bpm + 5); s.bpm = bpm;
        document.getElementById(`bpm-${p.id}`).textContent = bpm;
        if (playing) startTimer();
      });

      // Click progress bar to jump
      document.getElementById(`prog-${p.id}`)?.addEventListener('click', e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct  = (e.clientX - rect.left) / rect.width;
        jumpTo(Math.round(pct * (columns.length - 1)));
      });

      // Spacebar / arrows — listen on the pedal body element
      el.setAttribute('tabindex', '0');
      el.removeEventListener('keydown', onKey);
      el.addEventListener('keydown', onKey);
    }

    // After paint: scroll and highlight
    requestAnimationFrame(() => {
      scrollStrip();
      if (columns.length) applyHighlight();
    });
  }

  render();
}
