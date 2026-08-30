// ─── The tempo control, once ──────────────────────────────────────────────────
// Eleven pedals had eleven different tempo widgets: ±1 steppers, ±5 chips, ±10
// chips, a bare number box, a readout with no control at all. Same idea, eleven
// looks, eleven clamps, two different opinions about what 120 BPM is called.
// This is the ⏱️ Metronome's interface extracted so every pedal wears it.
//
// It inherits `--rk-accent` from whatever pedal it is dropped into, so it takes
// on that pedal's colour without being told.
import { metroClock } from '../core/state.js';

// One tempo vocabulary. The Metronome and the TAB page had DIVERGENT copies —
// different breakpoints and different boundary rules, so 120 BPM read
// "Moderato" in one and "Allegro" in the other. These are the Metronome's,
// which are the more complete set (they carry Grave and Prestissimo).
const TEMPO_TERMS = [
  [40, 'Grave'], [60, 'Largo'], [72, 'Adagio'], [100, 'Andante'], [120, 'Moderato'],
  [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [9999, 'Prestissimo'],
];
export const tempoTerm = bpm => (TEMPO_TERMS.find(([max]) => bpm <= max) || [, 'Prestissimo'])[1];

const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0) || min));
const fillPct = (v, min, max) => (((v - min) / (max - min)) * 100).toFixed(1);

// ── A scale that points where it means ────────────────────────────────
// The old scale row was three numbers in a space-between flex, which spaces them
// EVENLY regardless of what they say. That is fine when the middle label happens
// to be the arithmetic mean, and a lie otherwise: the Metronome printed 20-120-300
// over a 20-300 track, putting 120 at the halfway mark when it belongs at 35.7% —
// about forty pixels from where the slider actually stops. A scale you cannot aim
// with is worse than no scale, because you trust it.
//
// So each label is placed at its own value. The second correction matters as much
// as the first: a range input's THUMB CENTRE does not travel the full width of the
// track. It starts half a thumb in and stops half a thumb short, so the usable
// span is (100% - thumbWidth) offset by half a thumb. Positioning by raw
// percentage would still miss at both ends — most visibly at the extremes, which
// are the two labels you can check by eye.
const THUMB = 18;   // must match .rk-slider::-webkit-slider-thumb in kit.css

export function scaleRowHTML(min, max, ticks) {
  const vals = (ticks && ticks.length ? ticks : [min, Math.round((min + max) / 2), max])
    .filter(v => v >= min && v <= max)
    .sort((a, b) => a - b);
  const span = Math.max(1, max - min);
  return `<div class="rk-scale rk-scale-v">${vals.map(v => {
    const f = (v - min) / span;
    // half a thumb, plus the fraction of the span the thumb can actually cover
    const left = `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f.toFixed(4)})`;
    return `<span class="rk-tick" style="left:${left}"><i></i>${v}</span>`;
  }).join('')}</div>`;
}

// `editing` is per-instance and lives on the DOM node, so two tempo blocks in one
// pedal body cannot fight over a shared closure flag.
export function tempoBlockHTML(id, opts = {}) {
  const { min = 20, max = 300, bpm = 120, play = false, playing = false,
          sub = '', compact = false } = opts;
  const v = clamp(bpm, min, max);
  // Showing ◼ this is a stop, and stop is a reflex — you hit it mid-phrase with a
  // guitar in your hands, so it wears the app-wide stop red rather than this
  // pedal's lamp. The kit hangs every part of .rk-play's running look (glyph, rim,
  // dome wash, pulse) off --rk-hot, so re-pointing that one token on the button
  // reddens all four together instead of four inline rules fighting a gradient.
  // Scoped to the button: whatever else the pedal lights stays its own colour.
  const btn = play
    ? `<button data-tc="play" class="rk-play${playing ? ' is-playing' : ''}" title="${playing ? 'Stop' : 'Start'}"${playing ? ' style="--rk-hot:var(--rk-stop)"' : ''}>${playing ? '◼' : '▶'}</button>`
    : '';
  // compact drops the slider AND the 38px display size — a pedal's inline control
  // row cannot carry a number that tall without dominating everything beside it.
  return `<div class="tc${compact ? ' tc-sm' : ''}" data-tc-root="${id}" data-min="${min}" data-max="${max}">
    <div class="rk-readoutrow">
      ${btn}
      <div class="rk-readout">
        <div class="rk-readout-num"><span data-tc="num" class="bpm-click mono" title="Click to type a tempo">${v}</span></div>
        <div class="rk-readout-sub">BPM · <b data-tc="term">${tempoTerm(v)}</b>${sub ? ` · ${sub}` : ''}</div>
      </div>
      <div class="rk-nudge">
        <button data-tc="up"   title="+1 BPM">+</button>
        <button data-tc="down" title="−1 BPM">−</button>
      </div>
    </div>
    ${compact ? '' : `<div class="rk-section" style="margin-top:6px">
      <input data-tc="slider" class="rk-slider" type="range" min="${min}" max="${max}" value="${v}" style="--rk-fill:${fillPct(v, min, max)}%">
      ${scaleRowHTML(min, max, opts.ticks)}
    </div>`}
  </div>`;
}

// wire it up. `get()` returns the current bpm, `set(v)` commits one.
// Dragging the slider only repaints THIS block; the commit happens on release,
// which is the contract the Metronome established and the reason a drag doesn't
// restart the click on every pixel.
export function wireTempoBlock(id, { get, set, onPlay } = {}) {
  const root = document.querySelector(`[data-tc-root="${id}"]`);
  if (!root || root._tcWired) return;
  root._tcWired = true;
  const min = +root.dataset.min, max = +root.dataset.max;
  const q = sel => root.querySelector(`[data-tc="${sel}"]`);
  const paint = v => {
    const num = q('num'), term = q('term'), sl = q('slider');
    if (num && num.tagName === 'SPAN') num.textContent = v;
    if (term) term.textContent = tempoTerm(v);
    if (sl) { sl.value = v; sl.style.setProperty('--rk-fill', fillPct(v, min, max) + '%'); }
  };
  const commit = v => { const c = clamp(v, min, max); set?.(c); paint(c); };

  // every handler stops propagation: the pedal shell treats a stray click as a
  // drag-and-raise
  root.addEventListener('click', e => e.stopPropagation());

  q('up')  ?.addEventListener('click', e => { e.stopPropagation(); commit((get?.() ?? min) + 1); });
  q('down')?.addEventListener('click', e => { e.stopPropagation(); commit((get?.() ?? min) - 1); });
  q('play')?.addEventListener('click', e => { e.stopPropagation(); onPlay?.(); });

  const sl = q('slider');
  sl?.addEventListener('input',  e => { e.stopPropagation(); paint(clamp(e.target.value, min, max)); });
  sl?.addEventListener('change', e => { e.stopPropagation(); commit(e.target.value); });

  // click the big number to type an exact tempo
  q('num')?.addEventListener('click', e => {
    e.stopPropagation();
    const span = q('num');
    if (!span || span.tagName !== 'SPAN') return;
    const input = document.createElement('input');
    input.type = 'number'; input.min = min; input.max = max; input.value = get?.() ?? min;
    input.className = 'rk-edit mono'; input.dataset.tc = 'num';
    span.replaceWith(input);
    input.focus(); input.select();
    const done = keep => {
      const v = keep ? clamp(input.value, min, max) : (get?.() ?? min);
      const back = document.createElement('span');
      back.className = 'bpm-click mono'; back.dataset.tc = 'num';
      back.title = 'Click to type a tempo'; back.textContent = v;
      input.replaceWith(back);
      root._tcWired = false; wireTempoBlock(id, { get, set, onPlay });   // rebind the fresh node
      if (keep) commit(v); else paint(v);
    };
    input.addEventListener('click', e2 => e2.stopPropagation());
    input.addEventListener('keydown', e2 => {
      e2.stopPropagation();
      if (e2.key === 'Enter')  { e2.preventDefault(); done(true); }
      if (e2.key === 'Escape') { e2.preventDefault(); done(false); }
    });
    input.addEventListener('blur', () => done(true));
  });

  return { paint };
}

// The common case: a pedal that simply follows the master clock. One call.
export function masterTempoBlock(id, opts = {}) {
  return tempoBlockHTML(id, { ...opts, bpm: metroClock.bpm });
}

// …and it goes both ways. A block wired to the master also REPAINTS when the
// master moves — set the tempo on the Metronome and every open pedal shows it,
// without each one growing its own listener. The listener is registered once and
// self-prunes when its node is gone, so re-rendering a pedal cannot leak them.
const painters = [];
let clockBound = false;
// `mirror(v)` lets a pedal keep its own bpm field in step without writing its own
// clock listener — it fires both when this block commits and when the master moves
// somewhere else, which is the whole of "and vice versa".
export function wireMasterTempo(id, opts = {}) {
  const { mirror, ...rest } = opts;
  const api = wireTempoBlock(id, {
    get: () => metroClock.bpm,
    set: v => { metroClock.set(v, metroClock.ts); mirror?.(v); },
    ...rest,
  });
  if (api) {
    mirror?.(metroClock.bpm);                       // adopt the master on open
    // One painter per id, replaced on re-render. Pushing blindly would grow the
    // array forever: a re-rendered pedal has a NEW node under the SAME id, so the
    // "is the node gone?" prune below never fires for the stale entries.
    const at = painters.findIndex(x => x.id === id);
    const entry = { id, paint: v => { mirror?.(v); api.paint(v); } };
    if (at >= 0) painters[at] = entry; else painters.push(entry);
    if (!clockBound) {
      clockBound = true;
      metroClock.on(() => {
        for (let i = painters.length - 1; i >= 0; i--) {
          if (!document.querySelector(`[data-tc-root="${painters[i].id}"]`)) painters.splice(i, 1);
          else painters[i].paint(metroClock.bpm);
        }
      });
    }
  }
  return api;
}
