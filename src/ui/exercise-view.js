// ─── The exercise view, once ──────────────────────────────────────────────────
// One pedal was presenting a running exercise two different ways. The 📖 Songbook
// showed you a piece properly — its name, a ▶ NOW / NEXT → readout of what is under
// your fingers this second and what is coming, the tempo, and the whole timeline —
// while the 🎓 Theory tab of the SAME pedal showed a drill as a tempo box and a bare
// strip. Same act (a sequence is looping, follow it), two layouts, so the tabs read
// as two products stacked behind one row of buttons.
//
// This is that Songbook view lifted out. It is deliberately a LAYOUT and nothing
// more: it owns the frame and the three controls that are genuinely the same in
// both places (the back door, the title, the tempo), and takes everything that
// legitimately differs — how a step is named, what the strip contains, what the
// transport does — as markup from the caller.
//
//     [← back] [title]  ·  [▶ NOW / NEXT →]  ·  [tempo]  ·  [timeline]
//
// The back control sits LEFT of the title because that is where a door belongs:
// you read left-to-right, so "out of here" comes before "what this is".
//
// It composes the other two shared UI pieces rather than reimplementing them —
// tempo-control.js for the BPM block, and whatever step-strip.js markup the caller
// hands over. Those two plus this one are the whole vocabulary of a running exercise.
import { masterTempoBlock, wireMasterTempo } from './tempo-control.js';

// Derived ids, exported so a caller can refresh one region without re-rendering the
// view around it — mid-loop, a full re-render throws away the strip's scroll offset.
export const nowNextId = id => `xv-nn-${id}`;
export const tempoId   = id => `xv-tc-${id}`;

// ── NOW / NEXT ────────────────────────────────────────────────────────
// NOW is lit, NEXT is banked down: same card, one step apart on the accent ladder,
// so which one you are reading is obvious without spending a second hue on it. The
// caller supplies both as plain {title, sub} — the Songbook names a step by the
// chord it spells, a drill names it by its notes, and neither needs to know that.
const card = (lab, d, acc, big) => `<div style="flex:1;min-width:0;background:var(--rk-panel);border:1px solid ${acc};border-radius:6px;padding:6px 9px">
  <div class="mono" style="color:${acc};font-size:calc(7px*var(--ui));letter-spacing:1.5px">${lab}</div>
  <div class="mono" style="color:${big ? 'var(--rk-ink)' : 'var(--rk-ink-dim)'};font-size:calc(${big ? 17 : 14}px*var(--ui));font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(d && d.title) || '—'}</div>
  <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(d && d.sub) || '&nbsp;'}</div></div>`;

export const nowNextHTML = (now, next) =>
  card('▶ NOW', now, 'var(--rk-accent)', true) + card('NEXT →', next, 'var(--rk-edge-soft)', false);

// Repaint just the readout. Called once per step from whatever already drives the
// playhead — never from a clock of its own, or the two would drift apart.
export function paintNowNext(id, now, next) {
  const n = document.getElementById(nowNextId(id));
  if (n) n.innerHTML = nowNextHTML(now, next);
}

// The timeline's own box. Default is the Songbook's horizontal chip rail; the
// Songbook overrides it for the 🧩 Breakdown, which stacks instead of scrolling.
export const STRIP_BOX = `display:flex;flex-direction:row;gap:4px;overflow-x:auto;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:7px;min-height:46px;align-items:center`;

/**
 * @param {string} id  unique per mounted view (both derived ids hang off it)
 * @param {object} o
 *   back        {label, title?}          ← the door out, drawn first
 *   title       {text} | {input:{value, placeholder}}
 *   titleAside  html placed right of the title (📋 Import tab, …)
 *   now, next   {title, sub}
 *   tempo       masterTempoBlock opts, or null to omit the block entirely
 *   metaLeft / metaRight   html for the small row under the tempo
 *   stripLabel  the rk-label above the timeline (default 'TIMELINE')
 *   stripAside  html right of that label (view switches)
 *   stripHostId id for the timeline's container, so the caller can refresh it in place
 *   stripStyle  override for STRIP_BOX
 *   strip       the step-strip markup itself
 *   teach       a compact theory card, under the timeline
 *   foot        transport and anything below it
 */
export function exerciseViewHTML(id, o = {}) {
  const t = o.title || {};
  const titleHTML = t.input
    ? `<input id="xv-title-${id}" value="${String(t.input.value == null ? '' : t.input.value).replace(/"/g, '&quot;')}" placeholder="${t.input.placeholder || ''}"
        style="flex:1;min-width:0;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:5px 7px;outline:none;box-sizing:border-box"/>`
    // A read-only title still has to LINE UP with an editable one — same padding, same
    // box, an invisible border. Otherwise the two tabs' head rows sit at different heights.
    : `<span class="mono" style="flex:1;min-width:0;border:1px solid transparent;padding:5px 7px;color:var(--rk-ink);font-size:calc(11px*var(--ui));font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.text || ''}</span>`;

  let h = `<div data-xv="${id}" style="display:flex;flex-direction:column;gap:7px;min-height:0">`;

  h += `<div style="display:flex;gap:5px;align-items:center">`;
  if (o.back) h += `<button id="xv-back-${id}" class="rk-chip" title="${o.back.title || ''}" style="font-size:calc(9px*var(--ui));padding:5px 9px;white-space:nowrap">${o.back.label || '← Back'}</button>`;
  h += titleHTML;
  h += o.titleAside || '';
  h += `</div>`;

  h += `<div id="${nowNextId(id)}" style="display:flex;gap:5px">${nowNextHTML(o.now, o.next)}</div>`;

  // The shared master control, so an exercise loops at the tempo the rest of the app is
  // counting — and moving it here moves it everywhere.
  if (o.tempo) h += `<div>${masterTempoBlock(tempoId(id), o.tempo)}</div>`;

  if (o.metaLeft || o.metaRight) {
    h += `<div style="display:flex;align-items:center;gap:5px">${o.metaLeft || ''}`;
    if (o.metaRight) h += `<span style="margin-left:auto;display:flex;align-items:center;gap:5px">${o.metaRight}</span>`;
    h += `</div>`;
  }

  h += `<div style="display:flex;align-items:center;gap:6px">`;
  h += `<span class="rk-label">${o.stripLabel || 'TIMELINE'}</span>`;
  if (o.stripAside) h += `<div style="margin-left:auto;display:flex;gap:3px">${o.stripAside}</div>`;
  h += `</div>`;
  h += `<div${o.stripHostId ? ` id="${o.stripHostId}"` : ''} style="${o.stripStyle || STRIP_BOX}">${o.strip || ''}</div>`;

  if (o.teach) h += o.teach;
  if (o.foot)  h += o.foot;
  h += `</div>`;
  return h;
}

/**
 * Wire the three controls the view owns. Everything the caller passed as markup
 * (titleAside, stripAside, foot) the caller wires itself — this function must not
 * reach into it, or two modules end up owning one button.
 *
 * `tempo` is the wireMasterTempo options bag ({mirror, onPlay}); pass nothing when
 * the view was built without a tempo block.
 */
export function wireExerciseView(id, h = {}) {
  document.getElementById(`xv-back-${id}`)?.addEventListener('click', e => { e.stopPropagation(); h.onBack?.(); });
  document.getElementById(`xv-title-${id}`)?.addEventListener('input', e => h.onTitle?.(e.target.value));
  // The title box swallows clicks: the pedal shell reads a stray one as a drag-and-raise,
  // which would deselect the field the moment you tried to type in it.
  document.getElementById(`xv-title-${id}`)?.addEventListener('click', e => e.stopPropagation());
  if (h.tempo) wireMasterTempo(tempoId(id), h.tempo);
}
