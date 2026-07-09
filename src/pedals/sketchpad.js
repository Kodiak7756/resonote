// ─── Song Sketchpad ───────────────────────────────────────────────────────────
// Click-to-compose. Arm "Tap to add", then tap the fretboard to drop notes (Notes
// mode) or stack a chord (Chord mode) onto a timeline. Set each step's length,
// play it back on the neck, and it saves with your board (💾). The output is a
// normal playable plan, so every fretboard visual rides along for free.
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { setChordHighlight, clearChordHighlight, clearGhostHighlight, pedalBus } from '../core/state.js';
import { NOTES } from '../core/music-theory.js';
import { updateOverlays } from '../ui/fretboard.js';
import { playPlan } from '../curriculum/drill-runner.js';
import { setFretboardClickHandler } from '../main.js';
import { parseAsciiTab } from './tab.js';

const COL  = { root: '#ef9f27', tone: '#ef9f27', rootStroke: '#ffc14d', toneStroke: '#ffc14d' };
// duration in beats (4/4): whole..sixteenth
const DURS = [ { b: 4, l: '4' }, { b: 2, l: '2' }, { b: 1, l: '1' }, { b: 0.5, l: '½' }, { b: 0.25, l: '¼' } ];
const DURNAME = { 4: 'whole', 2: 'half', 1: 'quarter', 0.5: 'eighth', 0.25: 'sixteenth' };
const beatLabel = b => (DURS.find(d => d.b === b) || { l: String(b) }).l;
const _stop = {};   // per-pedal playback stop fns (survive re-render)

// ── Concept engine: name what's on the neck (chord / note / interval + Nashville number) ──
const NASH = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
const IVLNAME = { 0: 'unison', 1: 'min 2nd', 2: 'maj 2nd', 3: 'min 3rd', 4: 'maj 3rd', 5: '4th', 6: 'tritone', 7: '5th', 8: 'min 6th', 9: 'maj 6th', 10: 'min 7th', 11: 'maj 7th' };
// quality suffix → pitch-class interval set, simplest shapes FIRST (identification priority)
const QUALS = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['°', [0, 3, 6]], ['+', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['maj7', [0, 4, 7, 11]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]],
  ['m7♭5', [0, 3, 6, 10]], ['°7', [0, 3, 6, 9]], ['mMaj7', [0, 3, 7, 11]],
  ['add9', [0, 2, 4, 7]], ['6/9', [0, 2, 4, 7, 9]], ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]],
  ['7♭9', [0, 1, 4, 7, 10]], ['7♯9', [0, 3, 4, 7, 10]],
];
const _setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function identifyChord(pcNames) {
  const uniq = [...new Set(pcNames.map(n => NOTES.indexOf(n)))];
  for (const rootPc of uniq) {
    const ivs = [...new Set(uniq.map(p => ((p - rootPc) % 12 + 12) % 12))].sort((a, b) => a - b);
    for (const [suf, base] of QUALS) if (_setEq(ivs, [...base].sort((a, b) => a - b))) return { root: NOTES[rootPc], suf, name: NOTES[rootPc] + suf };
  }
  return null;
}
// Strict identifier for ARPEGGIOS: only triads & 7ths (sus/add9/9 overlap scales, so they'd
// mislabel melodic passages). Used to extract chord-tone runs from a single-note sequence.
const ARP_QUALS = QUALS.filter(([suf]) => ['', 'm', '°', '+', '6', 'm6', 'maj7', '7', 'm7', 'm7♭5', '°7', 'mMaj7'].includes(suf));
function identifyArp(pcNames) {
  const uniq = [...new Set(pcNames.map(n => NOTES.indexOf(n)))];
  for (const rootPc of uniq) {
    const ivs = [...new Set(uniq.map(p => ((p - rootPc) % 12 + 12) % 12))].sort((a, b) => a - b);
    for (const [suf, base] of ARP_QUALS) if (_setEq(ivs, [...base].sort((a, b) => a - b))) return { root: NOTES[rootPc], suf, name: NOTES[rootPc] + suf };
  }
  return null;
}
// "C" / "Cm" / "Cmaj7" → "C major" / "C minor" / "C maj7" for the breakdown labels
function fullName(root, suf) { return root + ({ '': ' major', 'm': ' minor', '°': ' diminished', '+': ' augmented' }[suf] ?? (' ' + suf)); }
function degOf(note) { const k = pedalBus && pedalBus.masterKey && pedalBus.masterKey.root; if (!k) return null; return NASH[((NOTES.indexOf(note) - NOTES.indexOf(k)) % 12 + 12) % 12]; }
// pitch-class names → { title, sub } describing the CONCEPT (chord name / note / interval + degree)
function describeConcept(pcs) {
  const u = [...new Set(pcs)];
  if (!u.length) return { title: 'rest', sub: '' };
  if (u.length === 1) { const d = degOf(u[0]); return { title: u[0], sub: d ? ('the ' + d) : 'note' }; }
  if (u.length === 2) { const s = ((NOTES.indexOf(u[1]) - NOTES.indexOf(u[0])) % 12 + 12) % 12; return { title: u.join('–'), sub: IVLNAME[s] || 'dyad' }; }
  const ch = identifyChord(u);
  if (ch) { const d = degOf(ch.root); return { title: ch.name, sub: u.join(' ') + (d ? ('  ·  the ' + d + ' chord') : '') }; }
  return { title: u.join('·'), sub: u.length + ' notes' };
}

// ── Sequence analysis: break a RUN of single notes into chord-tone (arpeggio) vs scale/melody ──
function dgTag(note) { const d = degOf(note); return d ? (' · the ' + d) : ''; }
const _MAJ = [0, 2, 4, 5, 7, 9, 11], _MIN = [0, 2, 3, 5, 7, 8, 10];
function identifyScaleLabel(pcNames) {
  const idx = [...new Set(pcNames.map(n => NOTES.indexOf(n)))];
  const fits = (rp, iv) => { const set = new Set(iv.map(x => (rp + x) % 12)); return idx.every(p => set.has(p)); };
  const k = pedalBus && pedalBus.masterKey && pedalBus.masterKey.root;
  const minor = pedalBus && pedalBus.masterKey && pedalBus.masterKey.keyType === 'Minor';
  if (k) { const rp = NOTES.indexOf(k); if (minor && fits(rp, _MIN)) return k + ' minor'; if (fits(rp, _MAJ)) return k + ' major'; if (fits(rp, _MIN)) return k + ' minor'; }
  for (let rp = 0; rp < 12; rp++) if (fits(rp, _MAJ)) return NOTES[rp] + ' major';
  for (let rp = 0; rp < 12; rp++) if (fits(rp, _MIN)) return NOTES[rp] + ' minor';
  return null;
}
// longest ARPEGGIO (triad/7th) window starting at i within a single-note pitch-class sequence
function chordAt(seq, i) {
  const uset = new Set(); let best = null;
  for (let j = i; j < seq.length && j - i < 8; j++) {
    uset.add(seq[j]); const uniq = [...uset];
    if (uniq.length > 4) break;
    const ch = identifyArp(uniq);
    if (ch && uniq.length >= 3) best = { len: j - i + 1, chord: ch };
    else if (uniq.length >= 4 && !ch) break;
  }
  return best;
}
// segment a single-note run into arpeggio chunks + scale/melody chunks (from = step index of seq[0])
function segmentRun(seq, from) {
  const out = []; let i = 0;
  while (i < seq.length) {
    const arp = chordAt(seq, i);
    if (arp && arp.len >= 3) { out.push({ kind: 'arpeggio', label: fullName(arp.chord.root, arp.chord.suf) + ' arpeggio', from: from + i, to: from + i + arp.len - 1 }); i += arp.len; continue; }
    let j = i + 1;                                   // grow a melody chunk until the next arpeggio can start
    while (j < seq.length) { const a = chordAt(seq, j); if (a && a.len >= 3) break; j++; }
    const sub = seq.slice(i, j), uniq = [...new Set(sub)];
    if (uniq.length === 1) out.push({ kind: 'note', label: uniq[0] + dgTag(uniq[0]) + (sub.length > 1 ? ' (repeated)' : ''), from: from + i, to: from + j - 1 });
    else { const sc = identifyScaleLabel(uniq); out.push({ kind: uniq.length >= 6 ? 'scale' : 'melody', label: sc ? sc + (uniq.length >= 6 ? ' scale' : ' melody line') : 'melody line', from: from + i, to: from + j - 1 }); }
    i = j;
  }
  return out;
}

export function buildSketchpadContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  if (!Array.isArray(s.steps)) s.steps = [];
  if (!s.bpm) s.bpm = 90;
  if (typeof s.name !== 'string') s.name = '';

  let armed = false;
  let mode  = 'note';          // 'note' = each tap is a new step · 'chord' = taps stack into one step
  let dur   = 1;               // active duration (beats) for new notes
  let sel   = s.steps.length ? s.steps.length - 1 : null;
  let playing = false;
  let importing = false;       // tab-import panel open?
  let playIdx = null;          // step currently sounding during playback (for the NOW/NEXT readout)
  let stripView = 'steps';     // 'steps' = editable chips · 'breakdown' = chord/arpeggio/melody analysis

  const alive = () => !!document.getElementById(`body-${p.id}`);
  const posOf = (si, fret) => { const i = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret); return { si, fret, note: i.note, octave: i.octave }; };
  const stepPositions = st => (st.notes || []).map(n => posOf(n.si, n.fret));
  const stepPcs = st => stepPositions(st).map(x => x.note);
  // the step the readout should describe: the one playing, else the selected, else the last
  const focusIdx = () => playIdx != null ? playIdx : (sel != null ? sel : s.steps.length - 1);
  function nowNextHtml() {
    const i = focusIdx();
    const cur = describeConcept(stepPcs(s.steps[i] || { notes: [] }));
    const nxt = describeConcept(stepPcs(s.steps[i + 1] || { notes: [] }));
    const card = (lab, d, acc, big) => `<div style="flex:1;min-width:0;background:#0c0a05;border:1px solid ${acc};border-radius:6px;padding:6px 9px">
      <div class="mono" style="color:${acc};font-size:7px;letter-spacing:1.5px">${lab}</div>
      <div class="mono" style="color:${big ? '#ffce6a' : '#bfa05a'};font-size:${big ? 17 : 14}px;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.title}</div>
      <div class="mono" style="color:#8a7038;font-size:8px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.sub || '&nbsp;'}</div></div>`;
    return card('▶ NOW', cur, '#ef9f27', true) + card('NEXT →', nxt, '#6a5630', false);
  }
  function refreshNowNext() { const n = document.getElementById(`nn-${p.id}`); if (n) n.innerHTML = nowNextHtml(); }

  // ── tap a fret → drop a note ──
  function addNote(info) {
    if (!alive()) { setFretboardClickHandler(null); return; }
    if (info.si === undefined || info.fret === undefined) return;   // fretboard taps only (not piano)
    const pos = { si: info.si, fret: info.fret };
    if (mode === 'chord') {
      if (sel == null || !s.steps[sel]) { s.steps.push({ notes: [], dur }); sel = s.steps.length - 1; }
      const st = s.steps[sel];
      const j = st.notes.findIndex(n => n.si === pos.si && n.fret === pos.fret);
      if (j >= 0) st.notes.splice(j, 1); else st.notes.push(pos);   // tap again to remove
    } else {
      s.steps.push({ notes: [pos], dur });
      sel = s.steps.length - 1;
    }
    refreshStrip(); refreshNowNext(); preview();
  }

  // ── show the selected/last step on the neck while composing ──
  function preview() {
    const st = sel != null ? s.steps[sel] : s.steps[s.steps.length - 1];
    if (!st || !st.notes || !st.notes.length) { clearChordHighlight(); clearGhostHighlight(); updateOverlays(); return; }
    const ps = stepPositions(st);
    setChordHighlight(null, ps.map(x => x.note), `step ${(sel != null ? sel : s.steps.length - 1) + 1}`, ps, COL);
    clearGhostHighlight(); updateOverlays();
  }

  // ── steps → a playable plan (rests = empty steps) ──
  function buildPlan() {
    const spb = 60 / s.bpm, positions = [], seen = new Set();
    const steps = s.steps.map(st => {
      const ps = stepPositions(st);
      ps.forEach(x => { const k = x.si + ':' + x.fret; if (!seen.has(k)) { seen.add(k); positions.push(x); } });
      const t = spb * (st.dur || 1);
      return { focus: ps.map(x => ({ si: x.si, fret: x.fret })), play: ps.map(x => ({ note: x.note, octave: x.octave })), dur: t * 0.95, gap: t };
    });
    // focusOnly: during playback show only the note(s) sounding NOW + the next one ghosted ahead
    // (a teleprompter), not the whole song as a dim cluster.
    return { root: null, notes: [...new Set(positions.map(x => x.note))], label: s.name || 'My sketch', positions, colors: COL, steps, focusOnly: true };
  }

  // ── import a whole ASCII tab → one step per column ──
  function importTab(text) {
    const res = parseAsciiTab((text || '').trim());
    if (!res || !res.columns.length) {
      const e = document.getElementById(`ierr-${p.id}`); if (e) { e.textContent = '⚠ No tab columns found — check the format (e|--0--2--…|).'; e.style.display = 'block'; }
      return;
    }
    s.steps = res.columns.map(col => ({ notes: Object.entries(col.notes).map(([si, fret]) => ({ si: +si, fret })), dur: 1 }));
    sel = 0; importing = false; stripView = 'breakdown';   // show the tab broken down right away
    render(); preview();
  }

  // ── play / stop ──
  function stopPlay() { if (_stop[p.id]) { _stop[p.id](); delete _stop[p.id]; } playing = false; playIdx = null; refreshStrip(); refreshNowNext(); preview(); updatePlayBtn(); }
  function togglePlay() {
    if (playing) { stopPlay(); return; }
    const plan = buildPlan();
    if (!plan.steps.some(st => st.play.length)) return;
    playing = true; updatePlayBtn();
    _stop[p.id] = playPlan(plan, { loop: !!s.loop, isAlive: alive, gain: 0.22, onStep: i => {
      playIdx = i; refreshStrip(); refreshNowNext();
      const chip = el.querySelector(`#strip-${p.id} .sk-chip[data-i="${i}"]`);
      if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
    } });
    if (!s.loop) {
      const total = plan.steps.reduce((a, st) => a + (st.gap || 0), 0) * 1000 + 450;
      setTimeout(() => { if (alive() && playing && !s.loop) { stopPlay(); } }, total);
    }
  }
  function updatePlayBtn() { const b = document.getElementById(`play-${p.id}`); if (b) b.textContent = playing ? '⏹ Stop' : '▶ Play'; }

  // ── timeline strip (just the chips) ──
  function refreshStrip() {
    const strip = document.getElementById(`strip-${p.id}`);
    if (strip) {
      strip.style.flexDirection = stripView === 'breakdown' ? 'column' : 'row';
      strip.innerHTML = stripView === 'breakdown' ? breakdownHtml() : stripHtml();
      if (stripView === 'breakdown') wireSegs(); else wireChips();
    }
    const cnt = document.getElementById(`cnt-${p.id}`);
    if (cnt) cnt.textContent = `${s.steps.length} step${s.steps.length === 1 ? '' : 's'}`;
  }
  function stripHtml() {
    if (!s.steps.length) return `<div class="mono" style="color:#5a4a2a;font-size:9px;text-align:center;padding:16px 8px;line-height:1.5">Arm <b style="color:#ef9f27">Tap to add</b>, then tap the neck<br>to drop notes — or <b style="color:#ef9f27">📋 Import tab</b>.</div>`;
    return s.steps.map((st, i) => {
      const title = describeConcept(stepPcs(st)).title;
      const isSel = i === sel, isPlay = i === playIdx, isRest = !(st.notes && st.notes.length);
      const bd = isPlay ? '#ffce6a' : isSel ? '#ef9f27' : '#3a3018';
      const bg = isPlay ? 'rgba(255,206,106,0.30)' : isSel ? 'rgba(239,159,39,0.18)' : '#1a160c';
      return `<button class="sk-chip" data-i="${i}" title="${DURNAME[st.dur] || st.dur} note · tap to select"
        style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;
        background:${bg};border:1px solid ${bd};border-radius:5px;padding:5px 8px;min-width:32px">
        <span class="mono" style="color:${isRest ? '#5a4a2a' : '#ffc14d'};font-size:11px;font-weight:700;white-space:nowrap">${title}</span>
        <span class="mono" style="color:#7a6534;font-size:8px">${beatLabel(st.dur || 1)}</span></button>`;
    }).join('');
  }
  function wireChips() {
    el.querySelectorAll(`#strip-${p.id} .sk-chip`).forEach(b => b.addEventListener('click', () => {
      sel = parseInt(b.dataset.i, 10); refreshStrip(); refreshNowNext(); preview();
    }));
  }

  // ── Breakdown: segment the whole sequence into chords / arpeggios / scale & melody lines ──
  function analyzeBreakdown() {
    const segs = []; let run = null;                 // run = { from, pcs:[] } of consecutive SINGLE-note steps
    const flush = () => { if (run) { segmentRun(run.pcs, run.from).forEach(x => segs.push(x)); run = null; } };
    s.steps.forEach((st, i) => {
      const pcs = [...new Set(stepPcs(st))];
      if (pcs.length === 0) { flush(); segs.push({ from: i, to: i, kind: 'rest', label: 'rest' }); return; }
      if (pcs.length >= 3) {                          // simultaneous notes = a chord
        flush(); const ch = identifyChord(pcs);
        segs.push({ from: i, to: i, kind: 'chord', label: (ch ? fullName(ch.root, ch.suf) : pcs.join(' ')) + ' chord' + (ch && degOf(ch.root) ? ('  ·  the ' + degOf(ch.root)) : '') });
        return;
      }
      if (pcs.length === 2) { flush(); const d = describeConcept(pcs); segs.push({ from: i, to: i, kind: 'dyad', label: d.title + ' · ' + d.sub }); return; }
      if (!run) run = { from: i, pcs: [] };           // single notes accumulate into a melodic run
      run.pcs.push(pcs[0]);
    });
    flush();
    return segs;
  }
  const KIND_ICON = { chord: '🎹', arpeggio: '🎶', scale: '🪜', melody: '〰️', dyad: '⑂', note: '•', rest: '·' };
  const KIND_COL  = { chord: '#ef9f27', arpeggio: '#e0b24a', scale: '#bcd06a', melody: '#7fbfe0', dyad: '#c08fd0', note: '#9a7f44', rest: '#5a4a2a' };
  function breakdownHtml() {
    if (!s.steps.length) return `<div class="mono" style="color:#5a4a2a;font-size:9px;text-align:center;padding:16px;line-height:1.5">Import a tab or tap notes — its breakdown<br>(chords · arpeggios · melody lines) shows here.</div>`;
    return analyzeBreakdown().map(sg => {
      const col = KIND_COL[sg.kind] || '#9a7f44';
      const isPlay = playIdx != null && sg.from <= playIdx && playIdx <= sg.to;
      const span = sg.from === sg.to ? `${sg.from + 1}` : `${sg.from + 1}–${sg.to + 1}`;
      return `<button class="sk-seg" data-from="${sg.from}" data-to="${sg.to}"
        style="display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;text-align:left;cursor:pointer;
        background:${isPlay ? 'rgba(255,206,106,0.20)' : '#120f08'};border:1px solid ${isPlay ? '#ffce6a' : '#2a2210'};border-left:3px solid ${col};border-radius:5px;padding:6px 8px">
        <span style="font-size:11px;width:16px;text-align:center">${KIND_ICON[sg.kind] || '•'}</span>
        <span class="mono" style="color:#ffce6a;font-size:11px;font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sg.label}</span>
        <span class="mono" style="color:#6a5630;font-size:8px;white-space:nowrap">▸ ${span}</span></button>`;
    }).join('');
  }
  function previewRange(from, to) {
    const ps = [], seen = new Set();
    for (let i = from; i <= to; i++) stepPositions(s.steps[i] || { notes: [] }).forEach(x => { const k = x.si + ':' + x.fret; if (!seen.has(k)) { seen.add(k); ps.push(x); } });
    if (!ps.length) { clearChordHighlight(); clearGhostHighlight(); updateOverlays(); return; }
    setChordHighlight(null, ps.map(x => x.note), 'segment', ps, COL); clearGhostHighlight(); updateOverlays();
  }
  function wireSegs() {
    el.querySelectorAll(`#strip-${p.id} .sk-seg`).forEach(b => b.addEventListener('click', () => {
      const from = +b.dataset.from, to = +b.dataset.to;
      sel = from; previewRange(from, to); refreshNowNext();
    }));
  }

  // ── full render ──
  function render() {
    // tab-import panel
    if (importing) {
      el.innerHTML = `<div style="display:flex;flex-direction:column;gap:7px">
        <div class="mono" style="color:#9a7f44;font-size:9px;letter-spacing:1px">PASTE ASCII TAB</div>
        <textarea id="ta-${p.id}" rows="9" placeholder="e|--0--2--3--5--|&#10;B|--1-----------|&#10;G|--0--------5--|&#10;D|--2--------5--|&#10;A|--3--------5--|&#10;E|--0--------3--|"
          style="width:100%;background:#0c0a05;color:#ffc14d;border:1px solid #2a2210;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:10px;padding:6px;resize:vertical;box-sizing:border-box;outline:none;line-height:1.6"></textarea>
        <div id="ierr-${p.id}" style="display:none;color:#ff6655;font-family:'JetBrains Mono',monospace;font-size:8px"></div>
        <div style="display:flex;gap:5px">
          <button id="iload-${p.id}" style="flex:1;background:rgba(239,159,39,0.18);border:1px solid #ef9f27;border-radius:5px;color:#ffc14d;font-family:'JetBrains Mono',monospace;font-size:10px;padding:7px;cursor:pointer;letter-spacing:.5px">↓ Load tab</button>
          <button id="icancel-${p.id}" style="background:#1a160c;border:1px solid #3a3018;border-radius:5px;color:#9a7f44;font-family:'JetBrains Mono',monospace;font-size:9px;padding:7px 12px;cursor:pointer">Cancel</button>
        </div>
        <div class="mono" style="color:#5a4a2a;font-size:7px;line-height:1.5">Each tab column becomes a step (quarter-note by default — tweak lengths after). Plain tab doesn't encode rhythm, so timing is a starting point, not exact.</div>
      </div>`;
      document.getElementById(`iload-${p.id}`)?.addEventListener('click', () => importTab(document.getElementById(`ta-${p.id}`)?.value || ''));
      document.getElementById(`icancel-${p.id}`)?.addEventListener('click', () => { importing = false; render(); });
      return;
    }

    const btn = (id, label, on, extra = '') => `<button id="${id}-${p.id}" style="background:${on ? 'rgba(239,159,39,0.2)' : '#1a160c'};border:1px solid ${on ? '#ef9f27' : '#3a3018'};border-radius:5px;color:${on ? '#ffc14d' : '#9a7f44'};font-family:'JetBrains Mono',monospace;font-size:9px;padding:5px 8px;cursor:pointer;letter-spacing:.5px;${extra}">${label}</button>`;

    let h = `<div style="display:flex;flex-direction:column;gap:7px">`;

    // name
    h += `<div style="display:flex;gap:5px">`;
    h += `<input id="name-${p.id}" value="${s.name.replace(/"/g, '&quot;')}" placeholder="Name your sketch…"
      style="flex:1;background:#0c0a05;border:1px solid #2a2210;border-radius:5px;color:#ffc14d;font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 7px;outline:none;box-sizing:border-box"/>`;
    h += `<button id="imp-${p.id}" title="Import an ASCII tab" style="background:#1a160c;border:1px solid #3a3018;border-radius:5px;color:#9a7f44;font-family:'JetBrains Mono',monospace;font-size:9px;padding:5px 9px;cursor:pointer;white-space:nowrap">📋 Import tab</button>`;
    h += `</div>`;

    // NOW / NEXT concept readout — what's on the neck right now and what's coming
    h += `<div id="nn-${p.id}" style="display:flex;gap:5px">${nowNextHtml()}</div>`;

    // arm + mode
    h += `<div style="display:flex;gap:5px;align-items:center">`;
    h += btn('arm', armed ? '● Tap to add (on)' : '○ Tap to add', armed, 'flex:1');
    h += btn('mode', mode === 'note' ? '♪ Notes' : '⊞ Chord', mode === 'chord');
    h += `</div>`;
    if (armed) h += `<div class="mono" style="color:#7a6534;font-size:8px;text-align:center">tap the neck → ${mode === 'chord' ? 'notes stack into the current step (tap again to remove); “＋ Step” starts a new one' : 'each tap adds a note'}</div>`;

    // duration row
    h += `<div style="display:flex;align-items:center;gap:4px">`;
    h += `<span class="mono" style="color:#5a4a2a;font-size:8px">LENGTH</span>`;
    DURS.forEach(d => {
      const on = d.b === dur;
      h += `<button class="sk-dur" data-b="${d.b}" title="${DURNAME[d.b]}" style="background:${on ? 'rgba(239,159,39,0.2)' : '#1a160c'};border:1px solid ${on ? '#ef9f27' : '#3a3018'};border-radius:4px;color:${on ? '#ffc14d' : '#9a7f44'};font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;cursor:pointer;min-width:24px">${d.l}</button>`;
    });
    h += `<span class="mono" style="color:#4a3c20;font-size:7px;margin-left:2px">beats</span>`;
    h += `</div>`;

    // bpm
    h += `<div style="display:flex;align-items:center;gap:5px">`;
    h += `<span class="mono" style="color:#5a4a2a;font-size:8px">BPM</span>`;
    h += `<button id="bdn-${p.id}" style="background:#1a160c;border:1px solid #3a3018;border-radius:4px;color:#9a7f44;cursor:pointer;font-size:12px;padding:1px 7px;line-height:1.2">−</button>`;
    h += `<span id="bpm-${p.id}" class="mono" style="color:#ffc14d;font-size:11px;min-width:30px;text-align:center">${s.bpm}</span>`;
    h += `<button id="bup-${p.id}" style="background:#1a160c;border:1px solid #3a3018;border-radius:4px;color:#9a7f44;cursor:pointer;font-size:12px;padding:1px 7px;line-height:1.2">+</button>`;
    h += `<span id="cnt-${p.id}" class="mono" style="color:#5a4a2a;font-size:8px;margin-left:auto">${s.steps.length} step${s.steps.length === 1 ? '' : 's'}</span>`;
    h += `</div>`;

    // timeline / breakdown
    h += `<div style="display:flex;align-items:center;gap:6px">`;
    h += `<span class="mono" style="color:#4a3c20;font-size:7px;letter-spacing:1.5px">${stripView === 'breakdown' ? 'BREAKDOWN' : 'TIMELINE'}</span>`;
    const vbtn = (id, lab, on) => `<button id="${id}-${p.id}" style="background:${on ? 'rgba(239,159,39,0.2)' : '#1a160c'};border:1px solid ${on ? '#ef9f27' : '#3a3018'};border-radius:4px;color:${on ? '#ffc14d' : '#9a7f44'};font-family:'JetBrains Mono',monospace;font-size:8px;padding:3px 7px;cursor:pointer">${lab}</button>`;
    h += `<div style="margin-left:auto;display:flex;gap:3px">${vbtn('vsteps', 'Steps', stripView === 'steps')}${vbtn('vbreak', '🧩 Breakdown', stripView === 'breakdown')}</div>`;
    h += `</div>`;
    const stripStyle = stripView === 'breakdown'
      ? `display:flex;flex-direction:column;gap:4px;overflow-y:auto;background:#0c0a05;border:1px solid #2a2210;border-radius:6px;padding:7px;max-height:152px`
      : `display:flex;flex-direction:row;gap:4px;overflow-x:auto;background:#0c0a05;border:1px solid #2a2210;border-radius:6px;padding:7px;min-height:46px;align-items:center`;
    h += `<div id="strip-${p.id}" style="${stripStyle}">${stripView === 'breakdown' ? breakdownHtml() : stripHtml()}</div>`;

    // transport
    h += `<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">`;
    h += `<button id="play-${p.id}" style="background:rgba(239,159,39,0.18);border:1px solid #ef9f27;border-radius:5px;color:#ffc14d;font-family:'JetBrains Mono',monospace;font-size:10px;padding:6px 12px;cursor:pointer;letter-spacing:.5px">${playing ? '⏹ Stop' : '▶ Play'}</button>`;
    h += btn('loop', s.loop ? '🔁 Loop' : '🔁 Loop', !!s.loop);
    h += btn('step', '＋ Step', false);
    h += `<div style="display:flex;gap:5px;margin-left:auto">`;
    h += btn('del', '🗑', false);
    h += btn('clr', 'Clear', false);
    h += `</div></div>`;

    h += `<div class="mono" style="color:#3a3018;font-size:7px;text-align:center">Saved with your board — hit 💾 SAVE up top to keep it.</div>`;
    h += `</div>`;
    el.innerHTML = h;

    // wire
    if (stripView === 'breakdown') wireSegs(); else wireChips();
    if (armed) setFretboardClickHandler(addNote);
    document.getElementById(`vsteps-${p.id}`)?.addEventListener('click', () => { stripView = 'steps'; render(); });
    document.getElementById(`vbreak-${p.id}`)?.addEventListener('click', () => { stripView = 'breakdown'; render(); });

    document.getElementById(`name-${p.id}`)?.addEventListener('input', e => { s.name = e.target.value; });
    document.getElementById(`imp-${p.id}`)?.addEventListener('click', () => { stopPlay(); importing = true; render(); });
    document.getElementById(`arm-${p.id}`)?.addEventListener('click', () => {
      armed = !armed;
      setFretboardClickHandler(armed ? addNote : null);
      render(); if (armed) preview();
    });
    document.getElementById(`mode-${p.id}`)?.addEventListener('click', () => { mode = mode === 'note' ? 'chord' : 'note'; render(); });
    el.querySelectorAll('.sk-dur').forEach(b => b.addEventListener('click', () => {
      dur = parseFloat(b.dataset.b);
      if (sel != null && s.steps[sel]) s.steps[sel].dur = dur;   // also retime the selected step
      render();
    }));
    document.getElementById(`bdn-${p.id}`)?.addEventListener('click', () => { s.bpm = Math.max(30, s.bpm - 5); document.getElementById(`bpm-${p.id}`).textContent = s.bpm; });
    document.getElementById(`bup-${p.id}`)?.addEventListener('click', () => { s.bpm = Math.min(280, s.bpm + 5); document.getElementById(`bpm-${p.id}`).textContent = s.bpm; });
    document.getElementById(`play-${p.id}`)?.addEventListener('click', togglePlay);
    document.getElementById(`loop-${p.id}`)?.addEventListener('click', () => { s.loop = !s.loop; render(); });
    document.getElementById(`step-${p.id}`)?.addEventListener('click', () => { s.steps.push({ notes: [], dur }); sel = s.steps.length - 1; refreshStrip(); refreshNowNext(); preview(); });
    document.getElementById(`del-${p.id}`)?.addEventListener('click', () => {
      if (sel == null || !s.steps.length) return;
      s.steps.splice(sel, 1); sel = s.steps.length ? Math.min(sel, s.steps.length - 1) : null;
      refreshStrip(); refreshNowNext(); preview();
    });
    document.getElementById(`clr-${p.id}`)?.addEventListener('click', () => {
      stopPlay(); s.steps = []; sel = null; refreshStrip(); refreshNowNext();
      clearChordHighlight(); clearGhostHighlight(); updateOverlays();
    });
  }

  render();
  if (s.steps.length) preview();
}
