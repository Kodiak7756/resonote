// ── Pitch trace — a scrolling pitch-over-time surface ────────────────
// The third instrument axis. The fretboard is pitch-across-strings, the piano is
// pitch-across-keys; this is pitch-across-TIME, which is the only way a sung note
// can be read at all (a voice has no frets, so the interesting information is the
// approach, the drift and the vibrato, not a single dot).
//
// It is a full participant in the app's highlight system, not a standalone tuner:
// the same chordHighlight / ghostHighlight / 'resonote:played' signals that light
// the neck lay down the translucent target path here, so every drill, lesson,
// scale and song already drives it with no per-pedal wiring.
//
// The vertical axis is OCTAVE-FOLDED semitones above the session key root, because
// every theory signal in this app is a pitch CLASS (chordNotes, pcs, scale notes
// carry no octave). Folding keeps the target and the voice on one shared axis, and
// the root is drawn at BOTH ends so the octave seam stays readable.
//
// Reused by the vocals instrument display and mountable into any element.
import { audio } from '../core/audio.js';
import { NOTES, KEY_PATTERNS, SCALE_TYPES, toSharp } from '../core/music-theory.js';
import { pcColor } from '../core/colors.js';
import { pedalBus, chordHighlight, ghostHighlight, conceptInfo } from '../core/state.js';

export const LANE_MODES = ['key', 'chromatic', 'melody'];
export const LANE_MODE_LABELS = { key: 'Key', chromatic: 'Chromatic', melody: 'Melody' };

// Cents window that counts as "on the note". Wider than a tuner's ±5 because a
// sung note is never dead centre — ±15 is the band a listener hears as in tune.
const IN_TUNE_CENTS = 15;
const NEAR_CENTS    = 40;

const TINT_IN   = '#5ddc9a';
const TINT_NEAR = '#f0a83c';
const TINT_OFF  = '#e2575f';

// Plot spans one octave with a little headroom past each root lane, so a root sung
// 40¢ flat still draws BELOW its lane instead of clipping off the bottom edge.
const LO = -0.7, HI = 12.7;

const PAD = { l: 38, r: 10, t: 12, b: 12 };
const NOW_FRAC = 0.68;          // the "now" line sits here; the future/target zone is to its right

// pcColor with an alpha channel — the colour code still owns the hue, we only fade it.
const pcAlpha = (note, s, l, a) => `hsla${pcColor(note, s, l).slice(3, -1)},${a})`;

let _seq = 0;

// ── notation (concert-pitch treble clef) ─────────────────────────────
// Same letter-step arithmetic as the TAB page's staff, minus the guitar's
// written-an-octave-up convention — a voice is notated where it sounds.
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const S_GAP = 9, S_HALF = S_GAP / 2;
const BOTTOM_DIA = 4 * 7 + LETTER.E;                          // E4 = bottom staff line
const staffPos = (note, octave) => octave * 7 + LETTER[note[0]] - BOTTOM_DIA;
// Headroom sized for a treble-clef singing range of roughly A2 up to C6 — the
// ledger stack below the staff is what a low male voice actually needs. Lower than
// that wants a bass clef, which this strip deliberately doesn't do.
const S_TOP = 28, S_BOTTOM = S_TOP + 4 * S_GAP, S_H = S_BOTTOM + 66;
const staffY = pos => S_BOTTOM - pos * S_HALF;

function ledger(x, pos) {
  let h = '';
  for (let q = 10; q <= pos; q += 2) h += `<line x1="${x-7}" y1="${staffY(q)}" x2="${x+7}" y2="${staffY(q)}" stroke="#4a4a5e" stroke-width="1"/>`;
  for (let q = -2; q >= pos; q -= 2) h += `<line x1="${x-7}" y1="${staffY(q)}" x2="${x+7}" y2="${staffY(q)}" stroke="#4a4a5e" stroke-width="1"/>`;
  return h;
}

function head(x, note, octave, { fill, stroke, opacity = 1, dashed = false }) {
  const pos = staffPos(note, octave), y = staffY(pos);
  let h = ledger(x, pos);
  h += `<g opacity="${opacity}">`;
  if (note.length > 1) h += `<text x="${x-11}" y="${y+3.6}" text-anchor="middle" fill="${stroke}" font-size="11" font-family="'JetBrains Mono',monospace">♯</text>`;
  h += `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.3" transform="rotate(-16 ${x} ${y})" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dashed ? ' stroke-dasharray="2 1.6"' : ''}/>`;
  h += `</g>`;
  return h;
}

export function createPitchTrace(mountEl, opts = {}) {
  if (!mountEl) return null;

  const uid = `pt${++_seq}`;
  const o = {
    lanes: 'key', ball: true, trail: true, notation: false,
    seconds: 6, live: true, height: 210, readout: true, connect: true,
    onDestroy: null,
    ...opts
  };
  if (!LANE_MODES.includes(o.lanes)) o.lanes = 'key';

  // ── DOM ────────────────────────────────────────────────────────────
  mountEl.innerHTML = `
    <div class="pt-root" id="${uid}-root" style="position:relative;display:flex;flex-direction:column;gap:6px">
      <div class="pt-stage" style="position:relative;border-radius:10px;background:linear-gradient(180deg,#111118,#0b0b12);border:1px solid #23233a;overflow:hidden">
        <canvas class="pt-canvas" id="${uid}-canvas" style="display:block;width:100%;height:${o.height}px"></canvas>
        <div class="pt-readout" id="${uid}-readout" style="position:absolute;top:6px;right:10px;display:flex;align-items:baseline;gap:8px;pointer-events:none;font-family:'JetBrains Mono',monospace">
          <span class="pt-note" id="${uid}-note" style="font-size:calc(26px*var(--ui));font-weight:900;color:#33334a;line-height:1">—</span>
          <span class="pt-cents" id="${uid}-cents" style="font-size:calc(11px*var(--ui));font-weight:700;color:#4a4a60">—¢</span>
        </div>
        <div class="pt-caption" id="${uid}-caption" style="position:absolute;top:8px;left:44px;font-family:'JetBrains Mono',monospace;font-size:calc(9px*var(--ui));letter-spacing:.6px;color:#5a5a78;pointer-events:none"></div>
      </div>
      <svg class="pt-staff" id="${uid}-staff" viewBox="0 0 600 ${S_H}"
           style="display:${o.notation ? 'block' : 'none'};width:100%;height:${S_H}px;border-radius:10px;background:#0e0e15;border:1px solid #23233a"></svg>
      <div class="pt-hint" id="${uid}-hint" style="display:none;align-items:center;justify-content:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:calc(9px*var(--ui));color:#6b6b88">
        <span class="pt-hint-text">Nothing is listening yet — connect an input and sing.</span>
        <button class="pt-connect" id="${uid}-connect" style="background:#16141f;border:1px dashed #34305a;border-radius:6px;color:#9b93c4;font-family:'JetBrains Mono',monospace;font-size:calc(9px*var(--ui));padding:4px 9px;cursor:pointer">🎤 Connect</button>
      </div>
    </div>`;

  const canvas   = mountEl.querySelector(`#${uid}-canvas`);
  const noteEl   = mountEl.querySelector(`#${uid}-note`);
  const centsEl  = mountEl.querySelector(`#${uid}-cents`);
  const capEl    = mountEl.querySelector(`#${uid}-caption`);
  const staffEl  = mountEl.querySelector(`#${uid}-staff`);
  const hintEl   = mountEl.querySelector(`#${uid}-hint`);
  const ctx      = canvas.getContext('2d');

  mountEl.querySelector(`#${uid}-connect`)?.addEventListener('click', async () => {
    try { await audio.connect(audio.selectedDeviceId); } catch (e) { /* declined — the hint stays up */ }
  });

  if (!o.readout) mountEl.querySelector(`#${uid}-readout`).style.display = 'none';

  // ── state ──────────────────────────────────────────────────────────
  let destroyed = false, raf = 0, cssW = 0, cssH = 0, dpr = 0;
  let key = { root: 'C', keyType: 'Major' };
  let laneSet = [];                 // [{ semis, note, degree, inScale }]
  let history = [];                 // [{ t, semis, note, octave, cents, brk }]
  let lastSemis = null;
  let nowTarget = null;             // { t0, t1|null, pcs, label }
  let pastTargets = [];             // finished now-targets, still scrolling out
  let nextTarget = null;            // { pcs, label } — drawn in the future zone
  let manualTarget = null;          // setTarget() override; null ⇒ follow the app
  let lastPlayedAt = -99;           // seconds; 'resonote:played' outranks chordHighlight briefly
  let sigChord = '', sigGhost = '', sigKey = '', sigMelody = '', staffSig = '';

  // ── key / lanes ────────────────────────────────────────────────────
  function readKey() {
    const mk = pedalBus.masterKey || {};
    const root = toSharp(mk.root || pedalBus.root || 'C');
    const keyType = mk.keyType || pedalBus.keyType || 'Major';
    return { root: NOTES.includes(root) ? root : 'C', keyType };
  }

  function keyIntervals(keyType) {
    if (KEY_PATTERNS[keyType]) return KEY_PATTERNS[keyType].intervals;
    for (const cat of Object.values(SCALE_TYPES)) if (cat[keyType]) return cat[keyType];
    return KEY_PATTERNS.Major.intervals;
  }

  const semisOf = pc => ((NOTES.indexOf(toSharp(pc)) - NOTES.indexOf(key.root)) + 144) % 12;

  function buildLanes() {
    const iv = keyIntervals(key.keyType);
    const rows = [];
    const push = (semis, inScale) => {
      const note = NOTES[(NOTES.indexOf(key.root) + (semis % 12) + 12) % 12];
      const deg  = iv.indexOf(semis % 12);
      rows.push({ semis, note, inScale, degree: deg >= 0 ? String(deg + 1) : '' });
    };
    if (o.lanes === 'chromatic') {
      for (let s = 0; s <= 12; s++) push(s, iv.includes(s % 12));
    } else if (o.lanes === 'melody') {
      const live = melodyPcs();
      const seen = new Set();
      live.forEach(pc => { const s = semisOf(pc); if (!seen.has(s)) { seen.add(s); push(s, iv.includes(s)); } });
      rows.sort((a, b) => a.semis - b.semis);
    } else {
      iv.forEach(s => push(s, true));
      push(12, true);                                  // the octave root closes the ladder
    }
    laneSet = rows;
  }

  // Everything the app is currently lighting, in one set — the 'melody' lane source.
  function melodyPcs() {
    const out = [];
    const add = pc => { const s = toSharp(pc); if (s && NOTES.includes(s) && !out.includes(s)) out.push(s); };
    (manualTarget || []).forEach(add);
    (nowTarget?.pcs  || []).forEach(add);
    (nextTarget?.pcs || []).forEach(add);
    if (chordHighlight.active) (chordHighlight.chordNotes || []).forEach(add);
    return out;
  }

  // ── target sourcing ────────────────────────────────────────────────
  function retireNow(t) {
    if (!nowTarget) return;
    nowTarget.t1 = t;
    pastTargets.push(nowTarget);
    nowTarget = null;
  }

  function setNow(pcs, label) {
    const clean = (pcs || []).map(toSharp).filter(p => NOTES.includes(p));
    if (!clean.length) return;
    const t = performance.now() / 1000;
    retireNow(t);
    nowTarget = { t0: t, t1: null, pcs: clean, label: label || '' };
  }

  const onPlayed = ev => {
    if (destroyed) return;
    const d = ev.detail || {};
    const pcs = (d.pcs || []).slice();
    if (!pcs.length) return;
    lastPlayedAt = performance.now() / 1000;
    setNow(pcs, d.label || d.root || '');
  };
  window.addEventListener('resonote:played', onPlayed);

  // Ghost positions carry a `note` in every producer that sets them; positions with
  // no note (raw voicings) contribute nothing here, which is correct — a fret with
  // no name can't become a lane.
  const ghostPcs = () => (ghostHighlight.positions || []).map(p => p && p.note).filter(Boolean);

  function pollSignals(now) {
    const k = readKey();
    const ks = `${k.root}|${k.keyType}`;
    if (ks !== sigKey) { sigKey = ks; key = k; lastSemis = null; history = []; buildLanes(); }

    if (manualTarget) {
      const ms = manualTarget.join(',');
      if (!nowTarget || nowTarget.pcs.join(',') !== ms) setNow(manualTarget, 'target');
      nextTarget = null;
    } else {
      // chordHighlight is the standing "what is lit"; a fresh 'resonote:played' is a
      // finer-grained event from the same drill, so it owns the target briefly.
      const cs = chordHighlight.active ? `${chordHighlight.label}|${(chordHighlight.chordNotes || []).join(',')}` : '';
      if (cs !== sigChord) {
        sigChord = cs;
        if (cs && now - lastPlayedAt > 0.35) setNow(chordHighlight.chordNotes, chordHighlight.label);
      }
      const gp = (ghostHighlight.active ? ghostPcs() : []).map(toSharp).filter(n => NOTES.includes(n));
      const gs = gp.join(',');
      if (gs !== sigGhost) { sigGhost = gs; nextTarget = gp.length ? { pcs: gp, label: 'next' } : null; }
      // A drill that ends broadcasts nothing — nothing says "stop". Retire a target the
      // app has stopped reasserting so the lane doesn't stay lit after the sound stopped.
      if (nowTarget && !chordHighlight.active && now - Math.max(nowTarget.t0, lastPlayedAt) > 2.5) retireNow(now);
    }

    // Melody lanes come and go with the material, so they need rebuilding — but only
    // when the material actually changed, not on every frame.
    if (o.lanes === 'melody') {
      const ms = melodyPcs().join(',');
      if (ms !== sigMelody) { sigMelody = ms; buildLanes(); }
    }
    if (capEl) {
      const parts = [`${key.root} ${key.keyType}`];
      if (nowTarget?.label) parts.push(nowTarget.label);
      else if (conceptInfo?.title) parts.push(conceptInfo.title);
      const txt = parts.join('  ·  ');
      if (capEl.textContent !== txt) capEl.textContent = txt;
    }
  }

  // ── sampling ───────────────────────────────────────────────────────
  // Read audio.detected directly rather than audio.on() — that listener list has no
  // remove, so subscribing per mount would leak one closure on every instrument switch.
  function sample(t) {
    const det = o.live ? audio.detected : null;
    if (!det || !NOTES.includes(det.note)) { lastSemis = null; return null; }
    const raw = semisOf(det.note) + (det.cents || 0) / 100;
    // Pick the octave-equivalent nearest the previous sample so the trail stays
    // continuous through the seam instead of snapping an octave every wobble.
    let s = raw, brk = false;
    if (lastSemis !== null) {
      s = [raw - 12, raw, raw + 12].reduce((a, b) => Math.abs(b - lastSemis) < Math.abs(a - lastSemis) ? b : a);
    }
    if (s < LO) { s += 12; brk = true; }
    if (s > HI) { s -= 12; brk = true; }
    lastSemis = s;
    const smp = { t, semis: s, note: det.note, octave: det.octave, cents: det.cents || 0, brk };
    history.push(smp);
    return smp;
  }

  function prune(t) {
    const cut = t - o.seconds - 1;
    while (history.length && history[0].t < cut) history.shift();
    pastTargets = pastTargets.filter(g => g.t1 > cut);
  }

  // ── drawing ────────────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const d = window.devicePixelRatio || 1;
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w; cssH = h; dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
  }

  const yOf = s => PAD.t + (1 - (s - LO) / (HI - LO)) * Math.max(1, cssH - PAD.t - PAD.b);
  const nowX = () => PAD.l + (cssW - PAD.l - PAD.r) * NOW_FRAC;
  const pxPerSec = () => Math.max(1, (nowX() - PAD.l) / o.seconds);
  const xOf = (t, now) => nowX() - (now - t) * pxPerSec();

  function draw(now) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const nx = nowX(), right = cssW - PAD.r;

    // future zone — where the thing to follow lives before you have to sing it
    ctx.fillStyle = 'rgba(255,255,255,.018)';
    ctx.fillRect(nx, 0, right - nx, cssH);

    drawLanes(nx, right);
    drawTargets(now, nx, right);
    if (o.trail) drawTrail(now);
    if (o.ball) drawBall(now, nx);

    ctx.strokeStyle = 'rgba(200,200,230,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(nx + .5, PAD.t - 6); ctx.lineTo(nx + .5, cssH - PAD.b + 6); ctx.stroke();
  }

  function drawLanes(nx, right) {
    ctx.font = "700 9px 'JetBrains Mono',monospace";
    ctx.textBaseline = 'middle';
    laneSet.forEach(ln => {
      const y = yOf(ln.semis);
      const isRoot = ln.semis % 12 === 0;
      ctx.strokeStyle = ln.inScale
        ? pcColor(ln.note, isRoot ? 80 : 55, isRoot ? 52 : 30)
        : 'rgba(120,120,150,.13)';
      ctx.lineWidth = isRoot ? 1.6 : 1;
      ctx.setLineDash(ln.inScale ? [] : [3, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, y + .5); ctx.lineTo(right, y + .5); ctx.stroke();
      ctx.setLineDash([]);
      // the letter always rides with the hue — that's the app's colour code
      ctx.fillStyle = ln.inScale ? pcColor(ln.note, 74, isRoot ? 68 : 56) : '#5c5c74';
      ctx.textAlign = 'left';
      ctx.fillText(ln.note, 4, y);
      if (ln.degree) {
        ctx.fillStyle = 'rgba(150,150,180,.42)';
        ctx.font = "700 7px 'JetBrains Mono',monospace";
        ctx.fillText(ln.degree, 25, y);
        ctx.font = "700 9px 'JetBrains Mono',monospace";
      }
    });
  }

  // The requested "transparent one to follow": a ghosted band on the target's lane,
  // entering from the right, sliding through the now-line as you sing it.
  function drawTargets(now, nx, right) {
    const band = Math.max(6, (cssH - PAD.t - PAD.b) / (HI - LO) * 0.82);

    const paint = (pcs, x0, x1, alpha, dashed) => {
      if (x1 <= x0) return;
      pcs.forEach(pc => {
        const s = semisOf(pc);
        [s, s === 0 ? 12 : null].forEach(sv => {
          if (sv === null) return;
          const y = yOf(sv) - band / 2;
          ctx.fillStyle = pcAlpha(pc, 70, 55, alpha);
          ctx.fillRect(x0, y, x1 - x0, band);
          if (dashed) {
            ctx.strokeStyle = pcAlpha(pc, 70, 62, alpha + .22);
            ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
            ctx.strokeRect(x0 + .5, y + .5, x1 - x0 - 1, band - 1);
            ctx.setLineDash([]);
          }
        });
      });
    };

    pastTargets.forEach(g => paint(g.pcs, Math.max(PAD.l, xOf(g.t0, now)), Math.min(nx, xOf(g.t1, now)), .13, false));
    if (nowTarget) paint(nowTarget.pcs, Math.max(PAD.l, xOf(nowTarget.t0, now)), nx, .19, false);
    if (nextTarget) paint(nextTarget.pcs, nx, right, .11, true);
  }

  function drawTrail(now) {
    if (history.length < 2) return;
    const oldest = now - o.seconds;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1], b = history[i];
      if (b.brk || b.t - a.t > 0.25) continue;            // don't bridge a seam wrap or a silence
      const age = (now - b.t) / o.seconds;
      if (age > 1) continue;
      const alpha = Math.max(0, 0.75 * (1 - age));
      ctx.strokeStyle = pcAlpha(b.note, 72, 60, alpha);
      ctx.beginPath();
      ctx.moveTo(xOf(Math.max(a.t, oldest), now), yOf(a.semis));
      ctx.lineTo(xOf(b.t, now), yOf(b.semis));
      ctx.stroke();
    }
  }

  function tintFor(cents) {
    const c = Math.abs(cents);
    return c <= IN_TUNE_CENTS ? TINT_IN : c <= NEAR_CENTS ? TINT_NEAR : TINT_OFF;
  }

  function drawBall(now, nx) {
    const last = history[history.length - 1];
    const live = last && now - last.t < 0.2;
    if (!live) {
      if (noteEl)  { noteEl.textContent = '—'; noteEl.style.color = '#33334a'; noteEl.style.textShadow = 'none'; }
      if (centsEl) { centsEl.textContent = '—¢'; centsEl.style.color = '#4a4a60'; }
      return;
    }
    const y = yOf(last.semis);
    // Core = the note's own hue (identity, per the one colour code); the ring is the
    // separate accuracy channel — green on the note, amber off it. Two questions,
    // two channels, so neither reading contradicts the other.
    const tint = tintFor(last.cents);
    const core = pcColor(last.note, 80, 62);

    ctx.beginPath(); ctx.arc(nx, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;

    ctx.beginPath(); ctx.arc(nx, y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = core; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = tint; ctx.stroke();

    if (noteEl) {
      noteEl.textContent = `${last.note}${last.octave}`;
      noteEl.style.color = core;
      noteEl.style.textShadow = `0 0 22px ${core}55`;
    }
    if (centsEl) {
      centsEl.textContent = `${last.cents > 0 ? '+' : ''}${last.cents}¢`;
      centsEl.style.color = tint;
    }
  }

  // ── notation strip ─────────────────────────────────────────────────
  // Pitch classes have no octave, so a target head is stacked ascending from the key
  // root in the octave the singer is actually in — the shape then reads where it sounds.
  function voiceTargets(pcs, base) {
    const rootIdx = NOTES.indexOf(key.root);
    return pcs.map(pc => {
      const s = semisOf(pc);
      return { note: toSharp(pc), octave: base + Math.floor((rootIdx + s) / 12), s };
    }).sort((a, b) => a.s - b.s);
  }

  function drawStaff() {
    if (!o.notation || !staffEl) return;
    // 1 viewBox unit = 1 css px, so heads stay round instead of stretching with the pane.
    const W = Math.max(240, Math.round(staffEl.clientWidth || cssW || 600));
    const det = o.live ? audio.detected : null;
    const pcs = manualTarget || nowTarget?.pcs || [];
    const nextPcs = nextTarget?.pcs || [];
    const sig = `${W}|${pcs.join(',')}|${nextPcs.join(',')}|${det ? det.note + det.octave + (Math.abs(det.cents) <= IN_TUNE_CENTS) : ''}|${key.root}`;
    if (sig === staffSig) return;
    staffSig = sig;
    staffEl.setAttribute('viewBox', `0 0 ${W} ${S_H}`);

    // Same now-line as the canvas above, so the sung head sits under the ball.
    const nx = PAD.l + (W - PAD.l - PAD.r) * NOW_FRAC;
    const base = det?.octave ?? 4;

    let h = '';
    for (let k = 0; k < 5; k++) h += `<line x1="0" y1="${S_TOP + k*S_GAP}" x2="${W}" y2="${S_TOP + k*S_GAP}" stroke="#33334a" stroke-width="1"/>`;
    h += `<text x="17" y="${S_BOTTOM + 4}" text-anchor="middle" font-size="46" fill="#55557a" font-family="'Segoe UI Symbol','Noto Music','Apple Symbols',serif">𝄞</text>`;
    h += `<line x1="${nx}" y1="${S_TOP - 8}" x2="${nx}" y2="${S_BOTTOM + 12}" stroke="rgba(200,200,230,.2)" stroke-width="1"/>`;

    // Target sits in the ball's own column: you read "am I on that head?" directly.
    voiceTargets(pcs, base).forEach((p, i) =>
      { h += head(nx + (i % 2) * 9, p.note, p.octave, { fill: 'none', stroke: '#9a92c4', opacity: .5, dashed: true }); });
    // What's coming, further right — the same future zone as the canvas.
    voiceTargets(nextPcs, base).forEach((p, i) =>
      { h += head(nx + 46 + (i % 2) * 9, p.note, p.octave, { fill: 'none', stroke: '#7d769e', opacity: .32, dashed: true }); });

    if (det && NOTES.includes(det.note)) {
      const c = pcColor(det.note, 80, 62);
      h += head(nx - 16, det.note, det.octave, { fill: c, stroke: tintFor(det.cents || 0) });
      h += `<text x="${nx - 16}" y="${S_H - 8}" text-anchor="middle" font-size="10" font-weight="700" fill="${c}" font-family="'JetBrains Mono',monospace">${det.note}${det.octave}</text>`;
    }
    staffEl.innerHTML = h;
  }

  // ── loop ───────────────────────────────────────────────────────────
  function frame() {
    if (destroyed) return;
    // Convention: a mount that has left the document takes its loop with it.
    if (!document.body.contains(mountEl)) { destroy(); return; }
    raf = requestAnimationFrame(frame);
    // Still in the DOM but hidden (another instrument is showing) — idle, and drop the
    // history so coming back doesn't paint a stale trail from minutes ago.
    if (!mountEl.getClientRects().length) { if (history.length) { history = []; lastSemis = null; } return; }

    const now = performance.now() / 1000;
    pollSignals(now);
    sample(now);
    prune(now);
    draw(now);
    drawStaff();

    if (hintEl) {
      const want = o.live && !audio.connected && !audio.connecting;
      const disp = want ? 'flex' : 'none';
      if (hintEl.style.display !== disp) hintEl.style.display = disp;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resonote:played', onPlayed);
    // Self-destruction (the mount left the document) has to reach the owner, or it
    // keeps holding a dead handle and never remounts.
    try { o.onDestroy?.(); } catch (e) {}
  }

  buildLanes();
  raf = requestAnimationFrame(frame);

  return {
    id: uid,
    destroy,
    setLanes(m) { if (LANE_MODES.includes(m)) { o.lanes = m; sigMelody = ''; buildLanes(); } },
    setMode(m)  { this.setLanes(m); },
    setOption(k, v) {
      if (!(k in o)) return;
      o[k] = v;
      if (k === 'notation' && staffEl) { staffEl.style.display = v ? 'block' : 'none'; staffSig = ''; }
      if (k === 'height') canvas.style.height = `${v}px`;
      if (k === 'live' && !v) { history = []; lastSemis = null; }
    },
    getOption(k) { return o[k]; },
    // Manual override for surfaces that want to drive the target themselves
    // (pass null to hand the target back to the app's highlight signals).
    setTarget(notes) {
      manualTarget = Array.isArray(notes) && notes.length ? notes.map(toSharp).filter(n => NOTES.includes(n)) : null;
      // Clearing the override has to forget the cached signatures, or the app's own
      // target isn't re-read until the next chord change and the override lingers.
      if (!manualTarget) { nowTarget = null; sigChord = ''; sigGhost = ''; }
      sigMelody = ''; staffSig = '';
      if (o.lanes === 'melody') buildLanes();
    },
    // A caller asking to render wants the CURRENT state drawn, not a repaint of
    // whatever the last frame happened to see — so this reads the app's signals
    // itself. That also makes the module drivable without an animation frame.
    render() {
      if (destroyed) return;
      sigMelody = ''; staffSig = ''; buildLanes();
      if (!mountEl.getClientRects().length) return;
      const now = performance.now() / 1000;
      pollSignals(now); sample(now); prune(now);
      draw(now); drawStaff();
    },
    getState() { return { lanes: o.lanes, key: { ...key }, target: nowTarget?.pcs || null, next: nextTarget?.pcs || null, samples: history.length }; }
  };
}
