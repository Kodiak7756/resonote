// ─── The step strip, once ─────────────────────────────────────────────────────
// A drill you can only hear is a peephole: you see the note under your finger and
// nothing either side of it, so when you fall off you cannot find your way back in.
// This is the Song Sketchpad's timeline lifted out so ANY sequence can be read the
// same way — the whole thing laid out, bar lines, section flags, a playhead, and
// look-ahead. Practise becomes reading instead of reacting.
//
// It works for drills and for sketches because those are the same object with one
// field renamed:
//     drill step   { focus: [{si,fret}], play: [{note,octave}], dur }
//     sketch step  { notes: [{si,fret}],                        dur }
import { NOTES } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { pcColor } from '../core/colors.js';

// drill plan → strip steps. The only difference is the field name.
export const planToStripSteps = planSteps =>
  (planSteps || []).map(st => ({ notes: st.focus || st.notes || [], dur: st.dur || 1, label: st.label }));

const DUR_LABEL = { 4: '4', 2: '2', 1: '1', 0.5: '½', 0.25: '¼', 1.5: '3', 0.75: '¾' };
const beatLabel = b => DUR_LABEL[b] || String(+(+b).toFixed(2));

const noteAt = (si, fret) => {
  const s = customTuning[si];
  if (!s) return '';
  return getNoteAtFret(s.note, s.octave, fret).note;
};
// Default chip text: what the step IS, as note names. A caller with a better
// namer (the Sketchpad knows chord names) passes its own `label`.
const defaultLabel = st => {
  const ns = st.notes || [];
  if (!ns.length) return '·';
  const uniq = [...new Set(ns.map(n => noteAt(n.si, n.fret)))];
  return uniq.join(' ');
};

// bar index at the START of each step, from cumulative beats vs beats-per-bar
const barOfStep = (steps, tsig) => {
  let cum = 0;
  return steps.map(st => { const b = Math.floor(cum / tsig); cum += (st.dur || 1); return b; });
};

// ── Two channels, kept separate ───────────────────────────────────────
// A strip of identically-coloured chips gives the eye nothing to track: you
// lose the playhead the moment you look at your hand, and every chip past the
// one you're on looks like every chip before it. So the chip says two things
// at once, on two independent channels:
//
//   the FRAME says WHERE  — past dimmed, now gold, next blue, the rest neutral,
//                           the same past/now/next language the fretboard already
//                           speaks (gold chord dots, blue dashed ghost dots)
//   the TEXT says WHAT    — every note letter in its own hue from the app's one
//                           colour code, so an A is the same colour here as on
//                           the 🌈 neck, in both circles, and in the colour quiz
//
// Two channels because they answer different questions. Colour the frame by
// note and you cannot find the playhead; colour the text by position and the
// notes all look alike again.
const NEXT_BLUE = '#5cc8ff';   // = THEME_GHOST's default — the neck's "next" colour

// past → now → next → selected → idle. Built once and shared by the initial
// render and the repaint, so the two can never drift apart.
function chipSkin(state, accent, line) {
  switch (state) {
    case 'now':  return { border: '#ffce6a', bg: 'rgba(255,206,106,0.30)', op: '1',
                          filter: 'none', shadow: '0 0 0 1px rgba(255,206,106,.30), 0 0 11px rgba(255,206,106,.28)' };
    case 'next': return { border: NEXT_BLUE, bg: 'rgba(92,200,255,0.10)', op: '1',
                          filter: 'none', shadow: '0 0 0 1px rgba(92,200,255,.16)' };
    case 'sel':  return { border: accent, bg: 'rgba(239,159,39,0.18)', op: '1', filter: 'none', shadow: 'none' };
    // Played chips stay READABLE, just recessed — greying them out entirely
    // would throw away the "where did I come from" half of the strip's job.
    case 'past': return { border: line, bg: '#161309', op: '0.44', filter: 'saturate(0.3)', shadow: 'none' };
    default:     return { border: line, bg: '#1a160c', op: '1', filter: 'none', shadow: 'none' };
  }
}

// `next` wraps to 0 on the last step: drills loop, so the step after the last
// one really is the first one, and that is precisely the join you fall off at.
function chipState(i, playIdx, selIdx, n) {
  if (i === playIdx) return 'now';
  if (playIdx != null && n > 1 && i === (playIdx + 1) % n) return 'next';
  if (i === selIdx) return 'sel';
  if (playIdx != null && i < playIdx) return 'past';
  return 'idle';
}

const applySkin = (el, skin) => {
  el.style.borderColor = skin.border;
  el.style.background  = skin.bg;
  el.style.opacity     = skin.op;
  el.style.filter      = skin.filter;
  el.style.boxShadow   = skin.shadow;
};

// Tint the chip text note-by-note. A token is coloured by its note letter
// ("Dm7" takes D's hue, "ii" has no note so it stays dim) — the letter itself
// always rides along, which is the redundant channel for colour-blind reading.
const NOTE_TOKEN = /^([A-G][#b♯♭]?)/;
function tintToken(tok, dim) {
  const m = NOTE_TOKEN.exec(tok);
  if (!m) return `<span style="color:${dim}">${tok}</span>`;
  const root = m[1].replace('♯', '#').replace('♭', 'b');
  const c = pcColor(root, 82, 64);
  const rest = tok.slice(m[1].length);
  return `<span style="color:${c}">${m[1]}</span>`
       + (rest ? `<span style="color:${c};opacity:.7">${rest}</span>` : '');
}
const tintLabel = (text, dim) =>
  String(text).split(/(\s+)/).map(t => (/\S/.test(t) ? tintToken(t, dim) : t)).join('');

export function stepStripHTML(id, opts = {}) {
  const { steps = [], sections = [], tsig = 4, playIdx = null, selIdx = null,
          label = defaultLabel, accent = '#ef9f27', dim = '#7a6534', line = '#3a3018',
          empty = '' } = opts;
  if (!steps.length) return `<div data-strip="${id}" class="mono" style="color:${dim};font-size:calc(9px*var(--ui));text-align:center;padding:14px 8px;line-height:1.5">${empty}</div>`;
  const bars = barOfStep(steps, tsig);
  const secAt = {}; (sections || []).forEach(x => { if (x.at < steps.length) secAt[x.at] = x.name; });
  const body = steps.map((st, i) => {
    const isRest = !(st.notes && st.notes.length);
    const sk = chipSkin(chipState(i, playIdx, selIdx, steps.length), accent, line);
    let pre = '';
    if (secAt[i] !== undefined) pre += `<div class="ss-sec mono" data-at="${i}" title="section"
      style="flex:0 0 auto;border:1px dashed ${accent};border-radius:4px;color:${accent};font-size:calc(8px*var(--ui));padding:3px 6px;cursor:pointer;white-space:nowrap">§ ${secAt[i]}</div>`;
    if (i === 0 || bars[i] > bars[i - 1]) pre += `<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:1px;padding:0 1px" title="bar ${bars[i] + 1}">
      <span class="mono" style="color:${dim};font-size:calc(7px*var(--ui))">${bars[i] + 1}</span><div style="width:1px;height:24px;background:${line}"></div></div>`;
    const text = st.label || label(st, i);
    return pre + `<button class="ss-chip" data-i="${i}" data-bar="${bars[i]}" title="${beatLabel(st.dur || 1)} beat${(st.dur || 1) === 1 ? '' : 's'}"
      style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;
      background:${sk.bg};border:1px solid ${sk.border};border-radius:5px;padding:5px 8px;min-width:32px;
      opacity:${sk.op};filter:${sk.filter};box-shadow:${sk.shadow};transition:opacity .12s linear,box-shadow .12s linear">
      <span class="mono" style="font-size:calc(11px*var(--ui));font-weight:700;white-space:nowrap">${isRest ? `<span style="color:${dim}">${text}</span>` : tintLabel(text, dim)}</span>
      <span class="mono" style="color:${dim};font-size:calc(8px*var(--ui))">${beatLabel(st.dur || 1)}</span></button>`;
  }).join('');
  return `<div data-strip="${id}" style="display:flex;flex-direction:row;gap:3px;align-items:center;overflow-x:auto;overflow-y:hidden">${body}</div>`;
}

export function wireStepStrip(id, { onPick } = {}) {
  const root = document.querySelector(`[data-strip="${id}"]`);
  if (!root) return;
  root.querySelectorAll('.ss-chip').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); onPick?.(+b.dataset.i);
  }));
  root.querySelectorAll('.ss-sec').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); onPick?.(+b.dataset.at);
  }));
}

// Keep the playing step in view. Two modes, because they fail differently:
// per-step following jitters once the tempo is up, and per-bar following loses you
// on a slow drill. Above ~140 BPM the strip moves a bar at a time.
export function followStrip(id, i, { byBar = false } = {}) {
  const root = document.querySelector(`[data-strip="${id}"]`);
  if (!root) return;
  const chip = root.querySelector(`.ss-chip[data-i="${i}"]`);
  if (!chip) return;
  let target = chip;
  if (byBar) {                       // scroll to the first chip of this chip's bar
    const bar = chip.dataset.bar;
    target = root.querySelector(`.ss-chip[data-bar="${bar}"]`) || chip;
  }
  // the playhead rides ~40% in, the same rule the TAB page uses
  const want = target.offsetLeft - root.clientWidth * 0.4;
  if (Math.abs(root.scrollLeft - want) > 24) root.scrollLeft = Math.max(0, want);
}

// Repaint just the highlight without rebuilding the strip — a rebuild mid-drill
// throws away the scroll position and makes the strip flicker every note.
export function paintStripAt(id, { playIdx = null, selIdx = null, accent = '#ef9f27', line = '#3a3018', dim = '#7a6534' } = {}) {
  const root = document.querySelector(`[data-strip="${id}"]`);
  if (!root) return;
  const chips = root.querySelectorAll('.ss-chip');
  chips.forEach(b => applySkin(b, chipSkin(chipState(+b.dataset.i, playIdx, selIdx, chips.length), accent, line)));
}
