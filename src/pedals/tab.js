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
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';

// ─── Tab colours ──────────────────────────────────────────────────────────────
//
// BOARD colours, not pedal chrome. These are handed to setChordHighlight /
// setGhostHighlight, which paint the MAIN fretboard — a surface outside this
// pedal's card that cannot inherit --rk-accent and that takes plain colour
// strings, not CSS. Blue-for-next is the app's shared board language, so it
// stays literal. Everything the pedal draws inside its own card is tokenised.

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
      html += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));padding:6px 0 2px;letter-spacing:2px;user-select:none">── ${sysIdx + 1} ──</div>`;
    }

    html += `<div class="tab-system" data-sysidx="${sysIdx}" style="font-family:'JetBrains Mono',monospace;font-size:calc(11px*var(--ui));white-space:pre;line-height:1.65">`;

    strings.forEach(({ label, content }, si) => {
      // Label prefix (e, B, G, D, A, E)
      let row = `<span style="color:var(--rk-ink-mute);user-select:none">${escHtml(label)}|</span>`;

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

          // Played / coming / gone, told in VALUE off one accent rather than in
          // three unrelated hues: the playhead is the brightest thing on the strip.
          let color = isPast  ? 'var(--rk-edge)'
                    : isNext  ? 'var(--rk-dim)'
                    :           'var(--rk-ink-mute)';  // upcoming (not yet reached)
          let bg    = 'transparent';
          let extra = '';

          if (isCur) {
            color = 'var(--rk-hot)';
            bg    = 'var(--rk-soft2)';
            // Only mark the very first string so we get one element to scroll to
            if (si === 0) extra = ' data-cur="1"';
          } else if (isNext && fret !== undefined) {
            color = 'var(--rk-accent)';
          }

          row += `<span${extra} style="color:${color};background:${bg}">${escHtml(chars)}</span>`;
          i   += col.width;
        } else {
          const ch = i < content.length ? content[i] : '-';
          row += `<span style="color:var(--rk-edge-soft)">${escHtml(ch)}</span>`;
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
  const dim = 'color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));font-family:"JetBrains Mono",monospace';

  if (!col) {
    return `<div style="background:${bg};border:1px solid var(--rk-edge-soft);border-radius:5px;padding:6px 8px;min-height:44px">
      <div class="mono" style="color:${accent};font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin-bottom:3px">${label}</div>
      <div style="${dim}">—</div>
    </div>`;
  }

  const ns = customTuning.length;
  const noteItems = Object.entries(col.notes).map(([siStr, fret]) => {
    const si = parseInt(siStr, 10);
    if (si >= ns) return null;
    const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    return `<span class="mono" style="color:${accent};font-weight:700">${info.note}</span>` +
           `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${fret}</span>`;
  }).filter(Boolean);

  return `<div style="background:${bg};border:1px solid var(--rk-edge-soft);border-radius:5px;padding:6px 8px">
    <div class="mono" style="color:${accent};font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin-bottom:3px">${label}</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:baseline">${noteItems.join('')}</div>
  </div>`;
}

// ─── Transport skin ───────────────────────────────────────────────────────────
//
// While the watch pass is running this button is the only thing that halts it, so
// in that state it drops the pedal accent for the app-wide stop red. Stop is a
// control you hit mid-phrase with both hands on the guitar — that only works as a
// reflex if it is the same red in every pedal. The strip's playhead keeps --rk-hot:
// that one only reports the tab is live, which is a different claim.
//
// Both render() and updatePlayBtn() paint from here, because the label flips
// without a re-render — otherwise the first press leaves a halt control wearing
// the accent, which is the one thing the red is supposed to prevent.

const playBtnCSS = halting =>
  `background:${halting ? 'var(--rk-stop-soft)' : 'var(--rk-soft2)'};` +
  `border:1px solid ${halting ? 'var(--rk-stop-edge)' : 'var(--rk-line)'};border-radius:3px;` +
  `color:${halting ? 'var(--rk-stop)' : 'var(--rk-accent)'};font-family:'JetBrains Mono',monospace;` +
  `font-size:calc(10px*var(--ui));min-height:calc(28px*var(--ui));padding:3px 8px;cursor:pointer`;

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
      renderColCard(columns[curIdx],     'NOW',  'var(--rk-accent)', 'var(--rk-panel2)') +
      renderColCard(columns[curIdx + 1], 'NEXT', 'var(--rk-dim)',    'var(--rk-panel)');
  }

  function updatePlayBtn() {
    const btn = document.getElementById(`play-${p.id}`);
    if (!btn) return;
    btn.textContent = playing ? '⏸ PAUSE' : '▶ PLAY';
    btn.style.cssText = playBtnCSS(playing);
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

    // class="rk" is the token scope — the card hands down --rk-pedal-accent and
    // every surface, ink and edge below is derived from it.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:7px">`;

    // ── Import panel ──
    if (!hasTab) {
      h += `<div style="border:1px solid var(--rk-edge-soft);border-radius:6px;padding:8px">`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px;margin-bottom:5px">PASTE ASCII TAB</div>`;
      h += `<textarea id="ta-${p.id}" rows="7"
          placeholder="e|---0---3---5---|\nB|---1---3---5---|\nG|---0---0---5---|\nD|---2---0---5---|\nA|---3-------5---|\nE|---0-------3---|"
          style="width:100%;background:var(--rk-panel);color:var(--rk-ink);border:1px solid var(--rk-edge-soft);border-radius:4px;
                 font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:5px;resize:vertical;
                 box-sizing:border-box;outline:none;line-height:1.6"></textarea>`;
      h += `<div id="err-${p.id}" style="display:none;color:var(--rk-bad);font-family:'JetBrains Mono',monospace;font-size:calc(8px*var(--ui));padding:3px 0"></div>`;
      h += `<button id="import-${p.id}"
          style="min-height:calc(28px*var(--ui));margin-top:5px;width:100%;background:var(--rk-soft);border:1px solid var(--rk-line);
                 border-radius:4px;color:var(--rk-accent);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));
                 padding:6px;cursor:pointer;letter-spacing:1px">↓ IMPORT TAB</button>`;
      h += `</div>`;

      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;padding:4px">
        Supports standard 6-string, bass, or any instrument tab.<br>
        Multi-section tabs (multiple groups of lines) are supported.
      </div>`;
    } else {
      // ── Controls bar ──
      h += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">`;

      // Tempo — the shared master control (watch mode reads this clock)
      h += `<div class="rk" style="min-width:132px">`;
      h += masterTempoBlock(`tab-${p.id}`, { min: 30, max: 280, compact: true });
      h += `</div>`;

      // Mode toggle
      const isWatch = mode === 'watch';
      h += `<button id="mode-${p.id}"
          style="min-height:calc(28px*var(--ui));background:${isWatch ? 'var(--rk-soft)' : 'var(--rk-soft2)'};
                 border:1px solid ${isWatch ? 'var(--rk-edge)' : 'var(--rk-line)'};border-radius:4px;
                 color:${isWatch ? 'var(--rk-ink-dim)' : 'var(--rk-accent)'};font-family:'JetBrains Mono',monospace;
                 font-size:calc(10px*var(--ui));padding:3px 7px;cursor:pointer;letter-spacing:1px">
          ${isWatch ? '👁 WATCH' : '🎸 PRACTICE'}</button>`;

      // Prev / Play / Next
      h += `<div style="display:flex;gap:3px;margin-left:auto">`;
      h += `<button id="prev-${p.id}" style="min-height:calc(28px*var(--ui));background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:3px;color:var(--rk-ink-mute);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:3px 7px;cursor:pointer">◄</button>`;
      if (isWatch) {
        h += `<button id="play-${p.id}" style="${playBtnCSS(playing)}">${playing ? '⏸ PAUSE' : '▶ PLAY'}</button>`;
      }
      h += `<button id="next-${p.id}" style="min-height:calc(28px*var(--ui));background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:3px;color:var(--rk-ink-mute);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:3px 7px;cursor:pointer">►</button>`;
      h += `</div>`;
      h += `</div>`;

      // Column counter + load-new link
      h += `<div style="display:flex;align-items:center;justify-content:space-between">`;
      h += `<span id="ctr-${p.id}" class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui))">${curIdx + 1} / ${columns.length}</span>`;
      h += `<button id="new-${p.id}" style="min-height:calc(28px*var(--ui));background:none;border:none;color:var(--rk-ink-mute);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));cursor:pointer;letter-spacing:1px;text-decoration:underline">load new tab</button>`;
      h += `</div>`;

      // ── Tab strip ──
      h += `<div id="strip-${p.id}"
          style="overflow:auto;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:5px;
                 padding:7px 10px;max-height:160px;scroll-behavior:smooth">`;
      h += renderTabStrip(systems, columns, curIdx);
      h += `</div>`;

      // ── Now / Next cards ──
      // Same skin the refreshStrip path passes to renderColCard — if these two ever
      // disagree the cards flip colour on the first advance.
      h += `<div id="nownext-${p.id}" style="display:grid;grid-template-columns:1fr 1fr;gap:5px">`;
      h += renderColCard(columns[curIdx],     'NOW',  'var(--rk-accent)', 'var(--rk-panel2)');
      h += renderColCard(columns[curIdx + 1], 'NEXT', 'var(--rk-dim)',    'var(--rk-panel)');
      h += `</div>`;

      // Practice mode hint
      if (!isWatch) {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center;padding:1px">
          ► button · arrow keys · spacebar to advance</div>`;
      }

      // Progress bar
      const pct = columns.length > 1 ? (curIdx / (columns.length - 1)) * 100 : 0;
      h += `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:3px;height:4px;cursor:pointer" id="prog-${p.id}">`;
      h += `<div style="background:var(--rk-accent);width:${pct.toFixed(1)}%;height:100%;border-radius:3px;transition:width .1s"></div>`;
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

      // Tempo follows the master clock in both directions: nudging here moves the
      // clock, and moving it anywhere else re-times a running watch pass.
      wireMasterTempo(`tab-${p.id}`, {
        mirror: v => {
          bpm = v; s.bpm = v;
          if (playing) startTimer();
        },
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
