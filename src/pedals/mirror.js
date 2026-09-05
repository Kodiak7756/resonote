// ─── Mirror — the same notes, drawn on another instrument ─────────────────────
// Everything the app sounds or lights is already broadcast: chordHighlight (what
// is on the neck right now), the 'resonote:played' event (what just sounded) and
// audio.detected (what YOU just played). The Mirror only listens to that and
// draws its own small view — a piano keyboard, a second neck in another tuning,
// or a staff — so one idea can be read two ways at once. Seeing a guitar shape
// land on piano keys is what turns "the C-shape" into "C E G".
//
// It is deliberately read-only: it never calls setChordHighlight or touches the
// shared fretboard. One board, one owner.
import { NOTES, toSharp } from '../core/music-theory.js';
import { chordHighlight } from '../core/state.js';
import { INSTRUMENTS, TUNING_PRESETS, customTuning, getNoteAtFret } from '../core/tuning.js';
import { audio } from '../core/audio.js';
import { pcColor, pcTextOn } from '../core/colors.js';

const DECAY = 420;          // ms a sounded note stays lit when HOLD is off
const POLL  = 120;          // chordHighlight has no change event, so watch it

const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11];
const BLACK_SEMI = [1, 3, 6, 8, 10];
// Black-key centres in white-key widths from the left edge of the group's C. The
// outer blacks of each group lean outward (C#/D# away from D, F#/A# away from G)
// exactly as they do on a real keyboard, which is what makes the shape readable.
const BLACK_CENTER = [0.92, 2.08, 3.92, 5.0, 6.08];

// Staff pitches are written an octave above sounding — the guitar convention the
// TAB page uses, so a low E sits under the staff instead of under a pile of ledgers.
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const BOTTOM_DIA = 4 * 7 + LETTER.E;
const staffPos = pt => (pt.octave + 1) * 7 + LETTER[pt.note[0]] - BOTTOM_DIA;

const FRET_INST = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].renderer === 'fretboard');

// {si,fret} on the MAIN board → the pitch it actually sounds, so the Mirror can
// show which register the guitar is playing in, not just the pitch class.
function posPitches(positions) {
  const out = [];
  (positions || []).forEach(q => {
    const st = customTuning[q.si];
    if (!st || q.fret == null) return;
    const n = getNoteAtFret(st.note, st.octave, q.fret);
    if (!out.some(o => o.note === n.note && o.octave === n.octave)) out.push(n);
  });
  return out;
}

// Pitch classes with no register of their own — stack them upward from the root in
// the guitar's middle octave so a chord lands inside the staff.
function stackPcs(pcs, root) {
  const rootPc = NOTES.indexOf(toSharp(root || pcs[0] || 'C'));
  if (rootPc < 0) return [];
  return pcs.map(n => {
    const semi = ((NOTES.indexOf(n) - rootPc) % 12 + 12) % 12;
    return { note: n, octave: 3 + Math.floor((rootPc + semi) / 12) };
  });
}

export function buildMirrorContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  if (!s.view) s.view = 'piano';
  if (s.oct  == null) s.oct  = 3;
  if (s.span == null) s.span = 2;
  if (!s.inst) s.inst = 'guitar6';
  if (!s.tune) s.tune = 'DADGAD';          // a second neck only earns its keep when it differs
  if (s.mic  == null) s.mic  = false;
  if (s.hold == null) s.hold = false;

  const alive = () => !!document.getElementById(`body-${p.id}`);

  // transient "just sounded" slot — the app's played event or your own playing
  let flash = { pcs: [], pitches: [], root: null, label: '', t: 0 };
  let lastSig = null;

  // ── listen: what the app plays ──────────────────────────────────────
  if (p._mirPlayed) window.removeEventListener('resonote:played', p._mirPlayed);
  p._mirPlayed = ev => {
    if (!alive()) { window.removeEventListener('resonote:played', p._mirPlayed); p._mirPlayed = null; return; }
    const d = ev.detail || {};
    flash = {
      pcs: [...new Set((d.pcs || []).map(toSharp).filter(n => NOTES.includes(n)))],
      pitches: [], root: d.root ? toSharp(d.root) : null, label: d.label || '', t: Date.now()
    };
  };
  window.addEventListener('resonote:played', p._mirPlayed);

  // ── listen: what you play (idempotent hook; survives rebuilds) ──────
  let lastHeard = null;
  p._mirAudio = () => {
    if (!alive() || !s.mic) return;
    const det = audio.detected;
    if (!det) { lastHeard = null; return; }
    if (det.note === lastHeard) return;                 // one flash per new note
    lastHeard = det.note;
    if (Math.abs(det.cents ?? 0) > 45) return;
    flash = { pcs: [toSharp(det.note)], pitches: [{ note: toSharp(det.note), octave: det.octave }], root: null, label: 'you played', t: Date.now() };
  };
  if (!p._mirHooked) { p._mirHooked = true; audio.on(() => p._mirAudio && p._mirAudio()); }

  // ── what is lit, in three tiers ─────────────────────────────────────
  // sound = ringing now · echo = same note, another register · held = on the neck but silent
  function litView() {
    const now = Date.now();
    const held = new Set(), bright = new Set();
    const pitches = [];
    let root = null, label = '';
    const tr = flash.t && (s.hold || now - flash.t < DECAY) ? flash : null;
    const ch = chordHighlight;
    if (ch && ch.active) {
      root  = ch.rootNote ? toSharp(ch.rootNote) : null;
      label = ch.label || '';
      const pcs = [...new Set((ch.chordNotes || []).map(toSharp).filter(n => NOTES.includes(n)))];
      const focus = posPitches(ch.focusPos);
      // a drill's focus note is the sounding one; the rest of the shape is background
      if (focus.length || tr) pcs.forEach(n => held.add(n));
      else pcs.forEach(n => bright.add(n));
      focus.forEach(q => { bright.add(q.note); pitches.push(q); });
    }
    if (tr) {
      label = tr.label || label;
      root  = tr.root || root;
      tr.pcs.forEach(n => bright.add(n));
      tr.pitches.forEach(q => { bright.add(q.note); if (!pitches.some(o => o.note === q.note && o.octave === q.octave)) pitches.push(q); });
    }
    bright.forEach(n => held.delete(n));
    const exact = new Set(pitches.map(q => q.note));
    const stateOf = (note, oct) => {
      const n = toSharp(note);
      if (bright.has(n)) return !exact.has(n) || pitches.some(q => q.note === n && q.octave === oct) ? 'sound' : 'echo';
      return held.has(n) ? 'held' : 'off';
    };
    return { held, bright, pitches, root, label, stateOf };
  }

  const sigOf = v => [s.view, s.oct, s.span, s.inst, s.tune, v.label, v.root,
    [...v.bright].sort().join(''), [...v.held].sort().join(''),
    v.pitches.map(q => q.note + q.octave).sort().join('')].join('|');

  // ── PIANO ───────────────────────────────────────────────────────────
  function pianoSVG(v) {
    const kw = 26, kh = 84, bkw = 15, bkh = 52, pad = 8;
    const nw = s.span * 7 + 1;                       // the range closes on a top C
    const W = pad * 2 + nw * kw, H = kh + 24;
    // Only the LIT keys carry note colour; an unlit keyboard is enclosure, so it
    // wears the kit's ink/panel pair — white keys are the brightest surface the
    // pedal has, black keys the darkest.
    const fills = { off: 'var(--rk-ink)', held: n => pcColor(n, 52, 78), echo: n => pcColor(n, 62, 66), sound: n => pcColor(n, 88, 56) };
    const bFills = { off: 'var(--rk-panel)', held: n => pcColor(n, 40, 26), echo: n => pcColor(n, 56, 40), sound: n => pcColor(n, 88, 54) };
    // Colours go in `style`, not in fill=/stroke= — var() is not substituted in
    // SVG presentation attributes, only in real CSS declarations.
    let h = `<rect x="${pad - 3}" y="3" width="${nw * kw + 6}" height="${kh + 8}" rx="4" style="fill:var(--rk-panel);stroke:var(--rk-edge-soft)"/>`;
    for (let wi = 0; wi < nw; wi++) {
      const semi = WHITE_SEMI[wi % 7], oct = s.oct + Math.floor(wi / 7), n = NOTES[semi];
      const st = v.stateOf(n, oct), x = pad + wi * kw;
      h += `<rect class="mir-key" data-n="${n}" data-o="${oct}" data-st="${st}" x="${x}" y="7" width="${kw - 2}" height="${kh}" rx="3" stroke-width="${st === 'sound' ? 1.6 : 0.5}" style="fill:${st === 'off' ? fills.off : fills[st](n)};stroke:${st === 'sound' ? 'var(--rk-hot)' : 'var(--rk-edge)'}"/>`;
      const lab = semi === 0 ? `C${oct}` : (st === 'off' ? '' : n);
      if (lab) h += `<text x="${x + (kw - 2) / 2}" y="${kh - 4}" text-anchor="middle" font-size="12" font-family="'JetBrains Mono',monospace" font-weight="700" style="fill:${st === 'sound' ? pcTextOn(n) : 'var(--rk-panel)'}">${lab}</text>`;
      if (st !== 'off' && v.root === n) h += `<circle cx="${x + (kw - 2) / 2}" cy="17" r="2.6" opacity=".9" style="fill:var(--rk-ink)"/>`;
    }
    for (let g = 0; g < s.span; g++) {
      BLACK_SEMI.forEach((semi, bi) => {
        const oct = s.oct + g, n = NOTES[semi];
        const st = v.stateOf(n, oct), cx = pad + (g * 7 + BLACK_CENTER[bi]) * kw;
        h += `<rect class="mir-key" data-n="${n}" data-o="${oct}" data-st="${st}" x="${cx - bkw / 2}" y="7" width="${bkw}" height="${bkh}" rx="2" stroke-width="${st === 'sound' ? 1.4 : 0.5}" style="fill:${st === 'off' ? bFills.off : bFills[st](n)};stroke:${st === 'sound' ? 'var(--rk-hot)' : 'var(--rk-panel)'}"/>`;
        if (st !== 'off') h += `<text x="${cx}" y="${bkh - 5}" text-anchor="middle" font-size="9" font-family="'JetBrains Mono',monospace" font-weight="700" style="fill:${st === 'sound' ? pcTextOn(n) : 'var(--rk-ink)'}">${n[0]}♯</text>`;
        if (st !== 'off' && v.root === n) h += `<circle cx="${cx}" cy="16" r="2.4" opacity=".9" style="fill:var(--rk-ink)"/>`;
      });
    }
    return `<svg id="mir-svg-${p.id}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${h}</svg>`;
  }

  // ── NECK ────────────────────────────────────────────────────────────
  const neckStrings = () => (TUNING_PRESETS[s.inst] || []).find(t => t.name === s.tune)?.strings
    || (INSTRUMENTS[s.inst] || INSTRUMENTS.guitar6).strings;

  function neckSVG(v) {
    const inst = INSTRUMENTS[s.inst] || INSTRUMENTS.guitar6;
    const strs = neckStrings();
    const N = Math.min(15, inst.frets || 15);
    const nutX = 26, fw = 26, gap = 18, top = 15;
    const W = nutX + N * fw + 10, H = top * 2 + (strs.length - 1) * gap;
    const yOf = i => top + i * gap;
    const xOf = f => f === 0 ? 12 : nutX + (f - 0.5) * fw;
    let h = '';
    [3, 5, 7, 9, 12, 15].filter(f => f <= N).forEach(f => {
      const cx = xOf(f);
      if (f === 12) h += `<circle cx="${cx}" cy="${yOf(0) + gap * 0.8}" r="3" style="fill:var(--rk-edge-soft)"/><circle cx="${cx}" cy="${yOf(strs.length - 1) - gap * 0.8}" r="3" style="fill:var(--rk-edge-soft)"/>`;
      else h += `<circle cx="${cx}" cy="${H / 2}" r="3" style="fill:var(--rk-edge-soft)"/>`;
      h += `<text x="${cx}" y="${H - 2}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" style="fill:var(--rk-ink-mute)">${f}</text>`;
    });
    for (let f = 1; f <= N; f++) h += `<line x1="${nutX + f * fw}" y1="${yOf(0)}" x2="${nutX + f * fw}" y2="${yOf(strs.length - 1)}" stroke-width="1" style="stroke:var(--rk-edge-soft)"/>`;
    h += `<rect x="${nutX - 2.5}" y="${yOf(0) - 2}" width="3.5" height="${(strs.length - 1) * gap + 4}" rx="1" style="fill:var(--rk-ink-mute)"/>`;
    strs.forEach((st, i) => h += `<line x1="${nutX}" y1="${yOf(i)}" x2="${nutX + N * fw}" y2="${yOf(i)}" stroke-width="${0.7 + i * 0.18}" style="stroke:var(--rk-edge)"/>`);
    strs.forEach((str, i) => {
      for (let f = 0; f <= N; f++) {
        const n = getNoteAtFret(str.note, str.octave, f);
        const stt = v.stateOf(n.note, n.octave);
        if (stt === 'off') {
          if (f === 0) h += `<text x="${xOf(0)}" y="${yOf(i) + 3}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" style="fill:var(--rk-ink-mute)">${str.note}</text>`;
          continue;
        }
        const r = stt === 'held' ? 6 : 7.6;
        const fill = stt === 'sound' ? pcColor(n.note, 88, 56) : stt === 'echo' ? pcColor(n.note, 62, 44) : pcColor(n.note, 45, 24);
        h += `<circle class="mir-dot" data-n="${n.note}" data-o="${n.octave}" data-st="${stt}" cx="${xOf(f)}" cy="${yOf(i)}" r="${r}" stroke-width="${stt === 'sound' ? 1.5 : 1}" style="fill:${fill};stroke:${stt === 'sound' ? 'var(--rk-hot)' : v.root === n.note ? 'var(--rk-accent)' : 'none'}"/>`;
        h += `<text x="${xOf(f)}" y="${yOf(i) + 3}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" font-weight="700" style="fill:${stt === 'sound' ? pcTextOn(n.note) : 'var(--rk-ink)'}">${n.note}</text>`;
      }
    });
    return `<svg id="mir-svg-${p.id}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${h}</svg>`;
  }

  // ── STAFF ───────────────────────────────────────────────────────────
  function staffSVG(v) {
    const W = 300, H = 136, gap = 10, bottom = 92, headX = 150;
    const yAt = pos => bottom - pos * (gap / 2);
    let h = '';
    for (let k = 0; k < 5; k++) h += `<line x1="0" y1="${bottom - k * gap}" x2="${W}" y2="${bottom - k * gap}" stroke-width="1" style="stroke:var(--rk-edge)"/>`;
    h += `<text x="26" y="${bottom + 2}" text-anchor="middle" font-size="56" font-family="'Segoe UI Symbol','Noto Music','Apple Symbols',serif" style="fill:var(--rk-ink-mute)">𝄞</text>`;
    h += `<text x="26" y="${bottom + 20}" text-anchor="middle" font-size="11" font-family="'JetBrains Mono',monospace" style="fill:var(--rk-ink-mute)">8</text>`;
    // one vertical slice of what is sounding: exact pitches when we know them,
    // otherwise the chord stacked up from its root
    let pts = v.pitches.filter(q => v.bright.has(q.note));
    const missing = [...v.bright].filter(n => !pts.some(q => q.note === n));
    if (missing.length) pts = pts.concat(stackPcs(missing, v.root));
    if (!pts.length && v.held.size) pts = stackPcs([...v.held], v.root);
    pts = pts.sort((a, b) => staffPos(a) - staffPos(b));
    let prev = null, side = 0, accX = null, accPos = null;
    pts.forEach(q => {
      const pos = Math.max(-8, Math.min(16, staffPos(q))), y = yAt(pos);
      side = (prev !== null && pos - prev === 1) ? (side ? 0 : 1) : 0;      // seconds cannot share a column
      prev = pos;
      const hx = headX + side * 13;
      for (let k = 10; k <= pos; k += 2) h += `<line x1="${hx - 11}" y1="${yAt(k)}" x2="${hx + 11}" y2="${yAt(k)}" stroke-width="1" style="stroke:var(--rk-edge)"/>`;
      for (let k = -2; k >= pos; k -= 2) h += `<line x1="${hx - 11}" y1="${yAt(k)}" x2="${hx + 11}" y2="${yAt(k)}" stroke-width="1" style="stroke:var(--rk-edge)"/>`;
      if (q.note.length > 1) {
        accX = (accPos !== null && pos - accPos < 6) ? accX - 9 : hx - 14;   // stack tight accidentals leftwards
        accPos = pos;
        h += `<text x="${accX}" y="${y + 4}" text-anchor="middle" font-size="13" font-family="'JetBrains Mono',monospace" style="fill:${pcColor(q.note, 70, 66)}">♯</text>`;
      }
      const col = pcColor(q.note, 82, 60);
      h += `<ellipse class="mir-head" data-n="${q.note}" data-o="${q.octave}" cx="${hx}" cy="${y}" rx="6.2" ry="4.8" transform="rotate(-16 ${hx} ${y})" stroke-width="0.8" style="fill:${col};stroke:var(--rk-ink)"/>`;
      h += `<text x="${hx + 12}" y="${y + 4}" font-size="11" font-family="'JetBrains Mono',monospace" font-weight="700" style="fill:${col}">${q.note}${q.octave}</text>`;
    });
    return `<svg id="mir-svg-${p.id}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${h}</svg>`;
  }

  // ── paint (data only — no rewiring) ─────────────────────────────────
  function paint(force) {
    const host = document.getElementById(`mir-view-${p.id}`);
    if (!host) return;
    const v = litView();
    const sig = sigOf(v);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const svg = s.view === 'neck' ? neckSVG(v) : s.view === 'staff' ? staffSVG(v) : pianoSVG(v);
    const shown = [...v.bright].length ? [...v.bright] : [...v.held];
    const chips = shown.map(n => `<span class="mono" style="background:${pcColor(n, 70, 30)};border:1px solid ${pcColor(n, 70, 52)};border-radius:4px;color:${pcColor(n, 80, 74)};font-size:calc(10px*var(--ui));padding:1px 4px">${n}</span>`).join('');
    host.innerHTML = svg +
      `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:5px;min-height:14px">
        ${chips || `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">nothing sounding — play, or light something on the neck</span>`}
        ${v.label ? `<span class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));margin-left:auto">${v.label}</span>` : ''}
      </div>`;
  }

  const chip = (cls, data, lab, on, extra = '') => `<button class="${cls} mono" ${data} style="min-height:calc(28px*var(--ui));background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:5px;color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};font-size:calc(10px*var(--ui));padding:4px 7px;cursor:pointer;${extra}">${lab}</button>`;
  const selStyle = 'background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink);font-family:\'JetBrains Mono\',monospace;font-size:calc(10px*var(--ui));padding:3px 4px';

  function render() {
    // class="rk" is what puts this pedal inside the kit's token scope — the card
    // hands down --rk-pedal-accent, .rk derives every surface and ink from it.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px">`;
    h += `<div style="display:flex;gap:4px">`;
    h += chip('mir-view', 'data-v="piano"', '🎹 Piano', s.view === 'piano', 'flex:1;padding:5px 0');
    h += chip('mir-view', 'data-v="neck"',  '🎸 Neck',  s.view === 'neck',  'flex:1;padding:5px 0');
    h += chip('mir-view', 'data-v="staff"', '🎼 Staff', s.view === 'staff', 'flex:1;padding:5px 0');
    h += `</div>`;

    if (s.view === 'piano') {
      h += `<div style="display:flex;align-items:center;gap:4px">
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">RANGE</span>
        ${chip('mir-oct', 'data-d="-1"', '−', false, 'padding:4px 8px')}
        <span id="mir-range-${p.id}" class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));min-width:52px;text-align:center">C${s.oct}–C${s.oct + s.span}</span>
        ${chip('mir-oct', 'data-d="1"', '+', false, 'padding:4px 8px')}
        ${chip('mir-span', 'data-n="2"', '2 oct', s.span === 2, 'margin-left:4px')}
        ${chip('mir-span', 'data-n="3"', '3 oct', s.span === 3)}
      </div>`;
    } else if (s.view === 'neck') {
      const presets = TUNING_PRESETS[s.inst] || [];
      h += `<div style="display:flex;gap:4px">
        <select id="mir-inst-${p.id}" style="${selStyle};flex:1">${FRET_INST.map(k => `<option value="${k}" ${k === s.inst ? 'selected' : ''}>${INSTRUMENTS[k].name}</option>`).join('')}</select>
        <select id="mir-tune-${p.id}" style="${selStyle};width:96px">${presets.map(t => `<option value="${t.name}" ${t.name === s.tune ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
      </div>`;
    } else {
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">Written an octave above sounding, the way guitar always is — the clef carries the 8.</div>`;
    }

    h += `<div style="display:flex;align-items:center;gap:4px">
      ${chip('mir-mic', '', '🎤 Mic', s.mic)}
      ${chip('mir-hold', '', '🔒 Hold', s.hold)}
      <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-left:auto">${s.hold ? 'last notes stay lit' : 'notes fade fast'}</span>
    </div>`;
    h += `<div id="mir-view-${p.id}"></div>`;
    h += `</div>`;
    el.innerHTML = h;
    wire();
    paint(true);
  }

  function wire() {
    el.querySelectorAll('.mir-view').forEach(b => b.addEventListener('click', () => { s.view = b.dataset.v; render(); }));
    el.querySelectorAll('.mir-oct').forEach(b => b.addEventListener('click', () => {
      s.oct = Math.max(1, Math.min(6 - s.span, s.oct + (+b.dataset.d))); render();
    }));
    el.querySelectorAll('.mir-span').forEach(b => b.addEventListener('click', () => {
      s.span = +b.dataset.n; s.oct = Math.max(1, Math.min(6 - s.span, s.oct)); render();
    }));
    el.querySelector(`#mir-inst-${p.id}`)?.addEventListener('change', e => {
      s.inst = e.target.value;
      s.tune = (TUNING_PRESETS[s.inst] || [])[0]?.name || 'Standard';
      render();
    });
    el.querySelector(`#mir-tune-${p.id}`)?.addEventListener('change', e => { s.tune = e.target.value; render(); });
    el.querySelector('.mir-mic')?.addEventListener('click', async () => {
      s.mic = !s.mic; lastHeard = null; render();
      if (s.mic && !audio.connected) { try { await audio.connect(audio.selectedDeviceId); } catch (e) { /* declined — the toggle still reads on */ } }
    });
    el.querySelector('.mir-hold')?.addEventListener('click', () => { s.hold = !s.hold; render(); });
  }

  // chordHighlight has no change event, so watch it — cheap, and the same tick
  // expires a faded flash. One timer per pedal, cleared before it is restarted.
  if (p._mirPoll) clearInterval(p._mirPoll);
  p._mirPoll = setInterval(() => {
    if (!alive()) { clearInterval(p._mirPoll); p._mirPoll = null; return; }
    paint(false);
  }, POLL);

  render();
}
