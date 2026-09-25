// ── 🥁 DRUMS — the kit as an instrument ───────────────────────────────
// A five-piece kit drawn from the throne — the view you have sitting at it —
// so the hi-hat is under your left hand, the ride and floor tom under your
// right, the bass drum in front of you with its pedal nearest. Every piece is
// a thing you can hit: click it, tap it (multi-touch on the Surface: two
// fingers, two drums), or play it from the keyboard.
//
// It is also how beats get WRITTEN. The 🥁 Backing Track pedal is the
// sequencer; this is its pad. Three modes, shared with the pedal's own bar:
//   Jam    the kit just plays
//   ● Rec  what you play lands in the beat, on the nearest sixteenth, while it loops
//   ✎ Step pick a step, and every piece you hit toggles on that step
// Neither side needs the other: the kit is a kit without the pedal, and the
// pedal is a sequencer without the kit. core/drums.js is the line between.
//
// Mounted like 🎤 Vocals: fretboard.js hides the neck and calls
// renderDrumKit() on every switch to the kit, destroyDrumKit() on the way out.

import { DRUM_PIECES, PIECE, playDrum, drumBus, drumEdit, setDrumEdit, activeMaker, touchMaker, heardTime } from '../core/drums.js';
import { audioCtx } from '../core/pulse.js';
import { metroClock } from '../core/state.js';
import { getInst } from '../core/tuning.js';

const W = 1000, H = 470;
const STEPS = 16;

// ── Finishes ─────────────────────────────────────────────────────────
// The shell wrap, lit as a cylinder: dark at both edges, the highlight a
// little left of centre where the stage light catches it.
export const DRUM_FINISHES = {
  wine:     { name: 'Wine Red',       ramp: ['#33070f', '#6e1424', '#b13a50', '#7a1729', '#2a060d'] },
  midnight: { name: 'Midnight Blue',  ramp: ['#080e22', '#172650', '#3c5c9e', '#1b2b58', '#070b1a'] },
  maple:    { name: 'Natural Maple',  ramp: ['#4e3015', '#94652f', '#d6a869', '#9c6b37', '#402710'] },
  black:    { name: 'Piano Black',    ramp: ['#050506', '#18181c', '#4a4a55', '#1b1b20', '#040405'] },
  silver:   { name: 'Silver Sparkle', ramp: ['#2e3137', '#737a86', '#d2d7df', '#7d8490', '#25282d'], sparkle: true },
};
const FINISH_KEY = 'rn-drum-finish', SIZE_KEY = 'rn-drum-size';
const SIZES = { S: 220, M: 320, L: 440 };
const readPref = (k, fallback, ok) => { try { const v = localStorage.getItem(k); return ok(v) ? v : fallback; } catch (e) { return fallback; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
export const drumFinish = () => readPref(FINISH_KEY, 'wine', v => !!DRUM_FINISHES[v]);
export function setDrumFinish(id) {
  if (!DRUM_FINISHES[id]) return;
  writePref(FINISH_KEY, id);
  if (live) paintStage();
}

// ── Geometry (viewBox 1000 × 470) ────────────────────────────────────
const G = {
  kick:   { cx: 500, cy: 292, r: 116 },
  tom1:   { cx: 422, cy: 160, rx: 64,  ry: 36, depth: 44, rot: -9 },
  tom2:   { cx: 578, cy: 160, rx: 70,  ry: 39, depth: 48, rot: 9 },
  snare:  { cx: 292, cy: 290, rx: 92,  ry: 38, depth: 36 },
  floor:  { cx: 714, cy: 296, rx: 102, ry: 42, depth: 86 },
  hat:    { cx: 146, cy: 212, rx: 84,  ry: 22 },
  crash1: { cx: 236, cy: 84,  rx: 112, ry: 26, rot: -8 },
  crash2: { cx: 756, cy: 74,  rx: 112, ry: 26, rot: 8 },
  ride:   { cx: 872, cy: 190, rx: 112, ry: 29, rot: 5 },
  clap:   { x: 866, y: 350, w: 74, h: 42 },
};

const f1 = n => Math.round(n * 10) / 10;
const rad = d => d * Math.PI / 180;

// Chrome as flat strokes: a gradient on a perfectly vertical <line> has a
// zero-width bounding box and silently draws nothing.
function pole(x1, y1, x2, y2, w = 4) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#23262c" stroke-width="${w + 2}" stroke-linecap="round"/>`
       + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#aeb7c1" stroke-width="${w}" stroke-linecap="round"/>`
       + `<line x1="${x1 - w * 0.22}" y1="${y1}" x2="${x2 - w * 0.22}" y2="${y2}" stroke="rgba(255,255,255,.55)" stroke-width="${Math.max(0.8, w * 0.28)}" stroke-linecap="round"/>`;
}
function tripod(x, y, spread = 40) {
  return pole(x, y, x - spread, 450, 3) + pole(x, y, x + spread, 450, 3) + pole(x, y, x + 3, 457, 3)
       + [x - spread, x + spread, x + 3].map((fx, i) => `<circle cx="${fx}" cy="${i === 2 ? 457 : 450}" r="3.4" fill="#15161a"/>`).join('');
}

// A drum seen from the throne: the batter head as an ellipse, the shell
// dropping away beneath it, chrome lugs following the curve of the shell.
function drumShape(d, shellFill) {
  const { cx, cy, rx, ry, depth } = d, bot = cy + depth;
  const side = `M${cx - rx},${cy} L${cx - rx},${bot} A${rx},${ry} 0 0 0 ${cx + rx},${bot} L${cx + rx},${cy} Z`;
  let h = `<path d="${side}" fill="${shellFill}"/>`;
  h += `<path d="${side}" fill="url(#dk-shade)"/>`;
  h += `<path d="M${cx - rx},${bot} A${rx},${ry} 0 0 0 ${cx + rx},${bot}" fill="none" stroke="#9aa3ad" stroke-width="3"/>`;
  [-64, -30, 0, 30, 64].forEach(a => {
    const x = cx + rx * Math.sin(rad(a)), y0 = cy + ry * Math.cos(rad(a)) + depth * 0.2, hh = depth * 0.46;
    h += `<rect x="${f1(x - 2.6)}" y="${f1(y0)}" width="5.2" height="${f1(hh)}" rx="2.4" fill="#c9d0d8" stroke="rgba(0,0,0,.45)" stroke-width=".6"/>`;
  });
  h += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#dk-head)" stroke="#c3cad2" stroke-width="3.4"/>`;
  h += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>`;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    h += `<circle cx="${f1(cx + rx * Math.sin(a))}" cy="${f1(cy + ry * Math.cos(a))}" r="2.1" fill="#eef1f4" stroke="rgba(0,0,0,.45)" stroke-width=".5"/>`;
  }
  return h;
}
const headEllipse = (d, cls, extra = '') => `<ellipse class="${cls}" cx="${d.cx}" cy="${d.cy}" rx="${d.rx + 4}" ry="${d.ry + 3}" ${extra}/>`;

// A cymbal: bronze, lathe rings, the bell, and a sheen where the light lands.
function cymbalShape(d, grad, bell = 0.14) {
  const { cx, cy, rx, ry } = d;
  let h = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${grad})" stroke="rgba(60,38,8,.6)" stroke-width="1"/>`;
  [0.3, 0.45, 0.6, 0.75, 0.9].forEach(k => {
    h += `<ellipse cx="${cx}" cy="${cy}" rx="${f1(rx * k)}" ry="${f1(ry * k)}" fill="none" stroke="rgba(80,50,10,.24)" stroke-width=".8"/>`;
  });
  h += `<ellipse cx="${f1(cx - rx * 0.28)}" cy="${f1(cy - ry * 0.34)}" rx="${f1(rx * 0.42)}" ry="${f1(ry * 0.26)}" fill="rgba(255,248,225,.2)"/>`;
  h += `<ellipse cx="${cx}" cy="${cy - 1}" rx="${f1(rx * bell)}" ry="${f1(ry * bell * 1.25)}" fill="url(#dk-bell)" stroke="rgba(60,38,8,.55)" stroke-width=".8"/>`;
  h += `<rect x="${cx - 2}" y="${cy - 8}" width="4" height="6" rx="1" fill="#2a2a2e"/>`;
  return h;
}

// Every hittable thing is one group: the drawing (.dk-body, the part that
// moves), a glow that flashes in the piece's lane colour when it sounds, and a
// ring that stays lit while ✎ Step mode's cursor sits on a step that has it.
function piece(key, body, glow, ring, transform = '', cls = '') {
  const pc = PIECE[key];
  return `<g class="dk-piece${cls ? ' ' + cls : ''}" data-piece="${key}" role="button" aria-label="${pc.name} (${pc.keys[0].toUpperCase()})" ${transform ? `transform="${transform}"` : ''} style="--dk-c:${pc.color}">
    <g class="dk-body">${body}</g>${glow}${ring}</g>`;
}

// `withKey` false for a name that covers two keys (the hi-hat's pills carry H and O).
function label(x, y, text, key, withKey = true) {
  const pc = PIECE[key];
  const w = text.length * 7.3 + 16, badge = drumEdit.keys && withKey ? 19 : 0, x0 = f1(x - (w + badge) / 2);
  let h = `<g class="dk-label" data-for="${key}">`;
  h += `<rect x="${x0}" y="${y - 9.5}" width="${f1(w + badge)}" height="19" rx="9.5" fill="rgba(8,8,12,.7)" stroke="${pc.color}66" stroke-width="1"/>`;
  h += `<text x="${f1(x0 + w / 2)}" y="${y + 3.7}" text-anchor="middle" class="dk-lt">${text}</text>`;
  if (badge) {
    h += `<rect x="${f1(x0 + w - 3)}" y="${y - 7.5}" width="17" height="15" rx="4" fill="${pc.color}"/>`;
    h += `<text x="${f1(x0 + w + 5.5)}" y="${y + 3.6}" text-anchor="middle" class="dk-kt">${pc.keys[0].toUpperCase()}</text>`;
  }
  return h + `</g>`;
}

// The hi-hat's two sounds as two buttons you can see: closed is the cymbal
// itself or its pill, open is the pill beside it. (The cymbal lifts when it
// opens — which is exactly what the foot does on a real one.)
function pill(x, y, text, key) {
  const pc = PIECE[key];
  const w = text.length * 7 + 16, badge = drumEdit.keys ? 18 : 0, x0 = f1(x - (w + badge) / 2), tw = f1(w + badge);
  let body = `<rect x="${x0}" y="${y - 11}" width="${tw}" height="22" rx="11" fill="rgba(14,14,20,.85)" stroke="${pc.color}" stroke-width="1.2"/>`;
  body += `<text x="${f1(x0 + w / 2)}" y="${y + 3.8}" text-anchor="middle" class="dk-lt" style="fill:${pc.color}">${text}</text>`;
  if (badge) body += `<rect x="${f1(x0 + w - 3)}" y="${y - 7.5}" width="16" height="15" rx="4" fill="${pc.color}"/><text x="${f1(x0 + w + 5)}" y="${y + 3.6}" text-anchor="middle" class="dk-kt">${pc.keys[0].toUpperCase()}</text>`;
  const outline = pad => `x="${f1(x0 - pad)}" y="${y - 11 - pad}" width="${f1(tw + pad * 2)}" height="${22 + pad * 2}" rx="${11 + pad}"`;
  return piece(key, body, `<rect class="dk-glow" ${outline(3)}/>`, `<rect class="dk-ring" ${outline(4)}/>`, '', 'dk-pill');
}

function kitSVG() {
  const fin = DRUM_FINISHES[drumFinish()];
  const stops = fin.ramp.map((c, i) => `<stop offset="${Math.round(i / (fin.ramp.length - 1) * 100)}%" stop-color="${c}"/>`).join('');
  let h = `<defs>
    <linearGradient id="dk-shell" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
    <linearGradient id="dk-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="dk-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3a3f46"/><stop offset="30%" stop-color="#9aa3ad"/><stop offset="45%" stop-color="#eef1f5"/><stop offset="70%" stop-color="#8b939e"/><stop offset="100%" stop-color="#30353b"/></linearGradient>
    <radialGradient id="dk-head" cx="42%" cy="32%" r="75%"><stop offset="0%" stop-color="#fffdf8"/><stop offset="55%" stop-color="#eee8dc"/><stop offset="100%" stop-color="#cfc7b6"/></radialGradient>
    <radialGradient id="dk-bronze" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#f7e4a6"/><stop offset="28%" stop-color="#e3bd5d"/><stop offset="68%" stop-color="#c7963a"/><stop offset="100%" stop-color="#8f6420"/></radialGradient>
    <radialGradient id="dk-bronze-dark" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#e2c884"/><stop offset="30%" stop-color="#b88a3a"/><stop offset="70%" stop-color="#8d6526"/><stop offset="100%" stop-color="#5c3f14"/></radialGradient>
    <radialGradient id="dk-bell" cx="45%" cy="35%" r="70%"><stop offset="0%" stop-color="#fff2c4"/><stop offset="100%" stop-color="#c29445"/></radialGradient>
    <radialGradient id="dk-stage" cx="50%" cy="18%" r="85%"><stop offset="0%" stop-color="#231f2c"/><stop offset="60%" stop-color="#121016"/><stop offset="100%" stop-color="#0a090c"/></radialGradient>
    <radialGradient id="dk-rug" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#4a1c22" stop-opacity=".55"/><stop offset="70%" stop-color="#2a1216" stop-opacity=".35"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>
    <filter id="dk-blur" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="dk-soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    ${fin.sparkle ? `<pattern id="dk-spark" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="3" cy="4" r=".8" fill="#fff" opacity=".55"/><circle cx="10" cy="9" r=".6" fill="#fff" opacity=".4"/><circle cx="6" cy="12" r=".5" fill="#fff" opacity=".35"/></pattern>` : ''}
  </defs>`;
  const shell = 'url(#dk-shell)', sparkle = !!fin.sparkle;

  // the room
  h += `<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#dk-stage)"/>`;
  h += `<ellipse cx="500" cy="438" rx="470" ry="34" fill="url(#dk-rug)"/>`;
  // shadows on the floor, under everything that stands on it
  h += `<g filter="url(#dk-soft)" fill="rgba(0,0,0,.55)">
    <ellipse cx="500" cy="446" rx="150" ry="12"/><ellipse cx="292" cy="452" rx="60" ry="7"/>
    <ellipse cx="714" cy="452" rx="120" ry="9"/><ellipse cx="146" cy="452" rx="50" ry="6"/>
    <ellipse cx="258" cy="452" rx="45" ry="6"/><ellipse cx="780" cy="452" rx="45" ry="6"/><ellipse cx="914" cy="452" rx="45" ry="6"/></g>`;

  // stands behind the drums: crash 1, crash 2, ride
  h += pole(236, 92, 226, 432, 4) + tripod(226, 432, 38);
  h += pole(756, 82, 780, 432, 4) + tripod(780, 432, 38);
  h += pole(872, 198, 914, 432, 4) + tripod(914, 432, 38);

  // ── kick (and its pedal) ──
  {
    const { cx, cy, r } = G.kick;
    let b = pole(410, 350, 370, 450, 4) + pole(590, 350, 630, 450, 4);
    b += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${shell}" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/>`;
    if (sparkle) b += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#dk-spark)"/>`;
    b += `<circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="none" stroke="#c3cad2" stroke-width="2.2"/>`;
    b += `<circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="url(#dk-head)"/>`;
    for (let k = 0; k < 10; k++) {
      const a = k * 36 + 18, x = cx + (r - 3) * Math.cos(rad(a)), y = cy + (r - 3) * Math.sin(rad(a));
      b += `<rect x="${f1(x - 3)}" y="${f1(y - 7)}" width="6" height="14" rx="1.5" fill="#d3d9e0" stroke="rgba(0,0,0,.5)" stroke-width=".6" transform="rotate(${a + 90} ${f1(x)} ${f1(y)})"/>`;
    }
    b += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="17" font-weight="700" letter-spacing="6" fill="rgba(40,28,18,.28)">RESONOTE</text>`;
    b += `<circle cx="${cx}" cy="${cy + 46}" r="18" fill="rgba(0,0,0,.05)" stroke="rgba(0,0,0,.13)" stroke-width="1"/>`;
    // the pedal: posts, footboard, and the beater resting on the head
    b += pole(474, 440, 474, 396, 2.5) + pole(526, 440, 526, 396, 2.5) + pole(474, 398, 526, 398, 2.5);
    b += `<polygon points="484,458 516,458 512,410 488,410" fill="#2b2e35" stroke="#8d96a1" stroke-width="1.2"/>`;
    b += `<rect x="468" y="438" width="64" height="9" rx="3" fill="#1c1e23" stroke="#6d7680" stroke-width="1"/>`;
    b += `<g class="dk-beater" style="transform-box:view-box;transform-origin:500px 440px">${pole(500, 440, 500, 346, 2.6)}<circle cx="500" cy="340" r="10" fill="#ece6da" stroke="#8a8378" stroke-width="1.2"/></g>`;
    h += piece('kick', b, `<circle class="dk-glow" cx="${cx}" cy="${cy}" r="${r - 6}"/>`, `<circle class="dk-ring" cx="${cx}" cy="${cy}" r="${r + 5}"/>`);
  }

  // tom mount: a post off the top of the kick, an arm out to each tom
  h += pole(500, 180, 500, 148, 5) + pole(500, 152, 456, 176, 3.5) + pole(500, 152, 544, 176, 3.5);

  // ── rack toms ──
  ['tom1', 'tom2'].forEach(k => {
    const d = G[k];
    let b = drumShape(d, shell);
    if (sparkle) b += `<path d="M${d.cx - d.rx},${d.cy} L${d.cx - d.rx},${d.cy + d.depth} A${d.rx},${d.ry} 0 0 0 ${d.cx + d.rx},${d.cy + d.depth} L${d.cx + d.rx},${d.cy} Z" fill="url(#dk-spark)"/>`;
    h += piece(k, b, headEllipse(d, 'dk-glow'), headEllipse(d, 'dk-ring'), `rotate(${d.rot} ${d.cx} ${d.cy + 20})`);
  });

  // ── snare: steel shell, on its basket stand ──
  {
    const d = G.snare;
    let b = pole(d.cx, d.cy + d.ry + d.depth, d.cx, 440, 4) + pole(d.cx, 430, d.cx - 44, 452, 3) + pole(d.cx, 430, d.cx + 44, 452, 3);
    b += drumShape(d, 'url(#dk-steel)');
    // the throw-off: the lever that lifts the wires
    b += `<rect x="${d.cx + d.rx - 16}" y="${d.cy + d.ry + 4}" width="10" height="16" rx="2" fill="#dfe4ea" stroke="rgba(0,0,0,.5)" stroke-width=".6"/>`;
    h += piece('snare', b, headEllipse(d, 'dk-glow'), headEllipse(d, 'dk-ring'));
  }

  // ── floor tom, on its legs ──
  {
    const d = G.floor;
    let b = pole(d.cx - d.rx + 10, d.cy + 34, d.cx - d.rx - 12, 452, 3.5) + pole(d.cx + d.rx - 10, d.cy + 34, d.cx + d.rx + 12, 452, 3.5);
    b += drumShape(d, shell);
    if (sparkle) b += `<path d="M${d.cx - d.rx},${d.cy} L${d.cx - d.rx},${d.cy + d.depth} A${d.rx},${d.ry} 0 0 0 ${d.cx + d.rx},${d.cy + d.depth} L${d.cx + d.rx},${d.cy} Z" fill="url(#dk-spark)"/>`;
    b += `<rect x="${d.cx - d.rx + 4}" y="${d.cy + 30}" width="12" height="9" rx="2" fill="#c9d0d8"/><rect x="${d.cx + d.rx - 16}" y="${d.cy + 30}" width="12" height="9" rx="2" fill="#c9d0d8"/>`;
    h += piece('floor', b, headEllipse(d, 'dk-glow'), headEllipse(d, 'dk-ring'));
  }

  // ── hi-hat: stand, pedal, and the pair of cymbals ──
  {
    const d = G.hat;
    h += pole(d.cx, d.cy + 10, d.cx, 432, 5) + tripod(d.cx, 424, 40);
    h += `<polygon points="${d.cx - 13},458 ${d.cx + 13},458 ${d.cx + 10},424 ${d.cx - 10},424" fill="#2b2e35" stroke="#8d96a1" stroke-width="1.2"/>`;
    let b = `<ellipse cx="${d.cx}" cy="${d.cy + 8}" rx="${d.rx}" ry="${d.ry}" fill="url(#dk-bronze-dark)" stroke="rgba(60,38,8,.6)" stroke-width="1"/>`;
    b += `<g class="dk-hat-top">${cymbalShape(d, 'dk-bronze', 0.16)}${pole(d.cx, d.cy - 26, d.cx, d.cy - 2, 2)}<rect x="${d.cx - 5}" y="${d.cy - 13}" width="10" height="9" rx="2" fill="#c9d0d8" stroke="rgba(0,0,0,.5)" stroke-width=".6"/></g>`;
    h += piece('hatClosed', b,
      `<ellipse class="dk-glow" cx="${d.cx}" cy="${d.cy + 3}" rx="${d.rx + 4}" ry="${d.ry + 7}"/>`,
      `<ellipse class="dk-ring" cx="${d.cx}" cy="${d.cy + 3}" rx="${d.rx + 7}" ry="${d.ry + 9}"/>`);
    h += pill(d.cx - 46, d.cy + 48, 'CLOSED', 'hatClosed');
    h += pill(d.cx + 46, d.cy + 48, 'OPEN', 'hatOpen');
  }

  // ── clap: a sample pad clamped to the ride stand, the hybrid-kit way ──
  {
    const c = G.clap;
    let b = `<rect x="${c.x - 6}" y="${c.y + c.h / 2 - 4}" width="12" height="8" rx="2" fill="#aeb7c1"/>`;
    b += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="9" fill="#17181d" stroke="#3b3e47" stroke-width="1.4"/>`;
    b += `<rect x="${c.x + 6}" y="${c.y + 6}" width="${c.w - 12}" height="${c.h - 12}" rx="6" fill="#26282f"/>`;
    b += `<rect class="dk-led" x="${c.x + 8}" y="${c.y + 3}" width="${c.w - 16}" height="2.4" rx="1.2" fill="${PIECE.clap.color}" opacity=".55"/>`;
    b += `<text x="${c.x + c.w / 2}" y="${c.y + c.h / 2 + 4}" text-anchor="middle" class="dk-lt" style="fill:#8e8e9a">PAD</text>`;
    h += piece('clap', b,
      `<rect class="dk-glow" x="${c.x - 3}" y="${c.y - 3}" width="${c.w + 6}" height="${c.h + 6}" rx="11"/>`,
      `<rect class="dk-ring" x="${c.x - 5}" y="${c.y - 5}" width="${c.w + 10}" height="${c.h + 10}" rx="12"/>`);
  }

  // ── cymbals on top of everything ──
  [['crash1', 'dk-bronze', 0.13], ['crash2', 'dk-bronze-dark', 0.13], ['ride', 'dk-bronze', 0.19]].forEach(([k, grad, bell]) => {
    const d = G[k];
    h += piece(k, cymbalShape(d, grad, bell),
      `<ellipse class="dk-glow" cx="${d.cx}" cy="${d.cy}" rx="${d.rx + 5}" ry="${d.ry + 6}"/>`,
      `<ellipse class="dk-ring" cx="${d.cx}" cy="${d.cy}" rx="${d.rx + 8}" ry="${d.ry + 8}"/>`,
      `rotate(${d.rot} ${d.cx} ${d.cy})`);
  });

  // ── names (and keys) — drawn last, and never in the way of a hit ──
  h += `<g class="dk-labels">`;
  h += label(236, 130, 'CRASH 1', 'crash1');
  h += label(756, 120, 'CRASH 2', 'crash2');
  h += label(872, 240, 'RIDE', 'ride');
  h += label(146, 178, 'HI-HAT', 'hatClosed', false);
  h += label(416, 230, 'TOM 1', 'tom1');
  h += label(586, 234, 'TOM 2', 'tom2');
  h += label(292, 356, 'SNARE', 'snare');
  h += label(714, 382, 'FLOOR TOM', 'floor');
  h += label(500, 254, 'KICK', 'kick');
  h += label(902, 408, 'CLAP', 'clap');
  h += `</g>`;
  return h;
}

// ── Live state ───────────────────────────────────────────────────────
let live = null;   // { el, off: [], ... } while the kit is on screen

const kitVisible = () => {
  const el = document.getElementById('drums-display');
  return !!(live && el && el.offsetParent !== null && getInst()?.renderer === 'drums');
};

// Keyboard: physical keys (e.code), so Shift doesn't turn "1" into "!".
const KEYMAP = {};
DRUM_PIECES.forEach(pc => pc.keys.forEach(k => { KEYMAP[k] = pc.key; }));
function keyOf(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^(Digit|Numpad)[0-9]$/.test(c)) return c.slice(-1);
  return null;
}

// ── Motion ───────────────────────────────────────────────────────────
// Web Animations, not class toggles: a hit that lands while the last one is
// still ringing restarts cleanly instead of waiting for a reflow trick.
function pieceEls(key) {
  const svg = live?.svg;
  if (!svg) return [];
  return [...svg.querySelectorAll(`.dk-piece[data-piece="${key}"]`)];
}
const CYMBAL = { crash1: [4, 900], crash2: [4, 1100], ride: [1.6, 520], hatClosed: [0.8, 160] };
function animate(key, opts = {}) {
  if (!live) return;
  const els = pieceEls(key);
  if (key === 'hatOpen') els.push(...pieceEls('hatClosed').filter(e => !e.classList.contains('dk-pill')));
  els.forEach(g => {
    const glow = g.querySelector('.dk-glow'), body = g.querySelector('.dk-body');
    glow?.animate([{ opacity: opts.off ? 0.35 : 0.95 }, { opacity: 0 }], { duration: opts.off ? 220 : 420, easing: 'ease-out' });
    if (opts.off || !body) return;
    if (CYMBAL[key] && !g.classList.contains('dk-pill')) {
      const [a, ms] = CYMBAL[key];
      body.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${-a}deg)` }, { transform: `rotate(${a * 0.7}deg)` },
                    { transform: `rotate(${-a * 0.4}deg)` }, { transform: `rotate(${a * 0.2}deg)` }, { transform: 'rotate(0deg)' }],
                   { duration: ms, easing: 'ease-out' });
    } else if (key === 'hatOpen' && !g.classList.contains('dk-pill')) {
      // the foot lets go: the top cymbal lifts off the bottom one and rings
      const top = body.querySelector('.dk-hat-top');
      live.hatLift?.cancel();
      live.hatLift = top?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)', offset: 0.12 }, { transform: 'translateY(-8px)', offset: 0.75 }, { transform: 'translateY(0)' }],
                                  { duration: 460, easing: 'ease-out' });
    } else {
      body.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.972)' }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' });
    }
    if (key === 'kick') g.querySelector('.dk-beater')?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-16deg)', offset: 0.45 }, { transform: 'rotate(0deg)' }], { duration: 240, easing: 'ease-in-out' });
    if (key === 'hatClosed') live.hatLift?.cancel();   // the foot shuts it
  });
}

// ✎ Step: the pieces already on the cursor's step wear their ring.
function paintLit() {
  if (!live) return;
  const m = activeMaker(), stepMode = drumEdit.mode === 'step' && m;
  const i = stepMode ? Math.min(drumEdit.cursor, m.total() - 1) : -1;
  live.svg.querySelectorAll('.dk-piece').forEach(g => {
    g.classList.toggle('dk-on', !!stepMode && m.has(g.dataset.piece, i));
  });
}

// ── Hitting it ───────────────────────────────────────────────────────
function strike(key, ev) {
  const m = activeMaker(), mode = drumEdit.mode;
  if (mode === 'step' && m) {
    const at = Math.min(drumEdit.cursor, m.total() - 1);
    const on = m.toggleStep(key, at);
    if (on) { playDrum(key); animate(key); } else animate(key, { off: true });
    say(on ? `${PIECE[key].label} on step ${stepName(at)}` : `${PIECE[key].label} off step ${stepName(at)}`, on ? PIECE[key].color : null);
    // advancing after a hit makes typing a hat line one key per note
    if (on && drumEdit.advance) setDrumEdit({ cursor: (at + drumEdit.advance) % m.total() });
    else paintLit();
    return;
  }
  const erase = mode === 'rec' && ev?.shiftKey;
  if (!erase) { playDrum(key); animate(key); }
  if (mode !== 'rec') return;
  if (!m) return say('Add the 🥁 Backing Track pedal to record into');
  if (!m.isPlaying()) return say('Press ▶ Beat first — hits record while the loop plays');
  const r = m.recordHit(key, heardTime(audioCtx(), ev?.timeStamp), erase);
  if (r) say(`${erase ? 'Erased ' : ''}${PIECE[key].label} → ${stepName(r.step)}${m.bars() > 1 ? ` · bar ${r.bar + 1}` : ''}`, erase ? null : PIECE[key].color);
}

const stepName = i => { const j = i % STEPS; return `${Math.floor(j / 4) + 1}${['', 'e', '&', 'a'][j % 4]}`; };

function say(text, color) {
  const n = document.getElementById('dk-say');
  if (!n) return;
  n.textContent = text;
  n.style.color = color || 'var(--rk-ink-dim)';
  n.animate?.([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0.55 }], { duration: 1600, fill: 'forwards' });
}

// ── The bar above the kit ─────────────────────────────────────────────
const BTN = on => `background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};` +
  `color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};border-radius:5px;font-family:'JetBrains Mono',monospace;` +
  `font-size:calc(10px*var(--ui));font-weight:700;letter-spacing:.5px;min-height:calc(28px*var(--ui));padding:4px 9px;cursor:pointer`;
const SEL = `background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:5px;` +
  `font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;min-height:calc(28px*var(--ui));padding:4px 6px;cursor:pointer;outline:none`;
const RULE = `<span style="width:1px;height:16px;background:var(--rk-edge-soft)"></span>`;
const KEY_HINT = 'K kick · S snare · H / O hi-hat · 1 2 3 toms · C V crashes · R ride · P pad';

function barHTML() {
  const m = activeMaker(), mode = drumEdit.mode, playing = !!m?.isPlaying();
  const modeBtn = (id, label, title) => `<button class="dk-mode" data-m="${id}" title="${title}" style="${BTN(mode === id)}">${label}</button>`;
  const stopCss = 'background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);color:var(--rk-stop);border-radius:5px;font-family:\'JetBrains Mono\',monospace;font-size:calc(10px*var(--ui));font-weight:700;letter-spacing:.5px;min-height:calc(28px*var(--ui));padding:4px 9px;cursor:pointer';
  let h = `<span class="mono" style="font-size:calc(9px*var(--ui));letter-spacing:1.2px;color:var(--rk-ink-mute)">🥁 KIT</span>
    <div style="display:flex;gap:4px">
      ${modeBtn('jam', 'Jam', 'Just play — nothing is written')}
      ${modeBtn('rec', `<span style="color:${mode === 'rec' ? 'var(--rk-stop)' : 'inherit'}">●</span> Rec`, 'Record into the Backing Track: hits land on the nearest 16th while the beat loops')}
      ${modeBtn('step', '✎ Step', 'Step edit: pick a step, then hit pieces to toggle them on it')}
    </div>${RULE}`;
  if (m) {
    h += `<button id="dk-play" title="Start / stop the Backing Track's beat" style="${playing ? stopCss : BTN(false)}">${playing ? '■ Stop' : '▶ Beat'}</button>
      <span class="mono" title="Tempo — set it on the Metronome or the session TEMPO" style="font-size:calc(10px*var(--ui));color:var(--rk-ink-dim)">♩ ${m.bpm()}</span>
      <button id="dk-undo" title="Undo the last change to the beat (a recording pass is one step)" style="${BTN(false)};${m.canUndo() ? '' : 'opacity:.4'}" ${m.canUndo() ? '' : 'disabled'}>↶ Undo</button>
      <span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-faint)">→ Backing Track · ${m.bars()} bar${m.bars() > 1 ? 's' : ''}</span>`;
  } else {
    h += `<button id="dk-add" title="Put the Backing Track pedal on the board — it's the sequencer this kit records into" style="${BTN(false)}">＋ Backing Track</button>
      <span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-faint)">to record beats</span>`;
  }
  h += `<span style="margin-left:auto"></span>`;
  if (mode === 'rec') h += `<button id="dk-click" title="A quiet click on the beats while recording" style="${BTN(drumEdit.click)}">🔔 Click</button>`;
  h += `<button id="dk-keys" title="Show the keyboard key for each piece" style="${BTN(drumEdit.keys)}">⌨ Keys</button>
    <select id="dk-finish" title="Shell finish" style="${SEL}">${Object.entries(DRUM_FINISHES).map(([k, f]) => `<option value="${k}" ${k === drumFinish() ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
    <select id="dk-size" title="Kit size" style="${SEL}">${Object.keys(SIZES).map(k => `<option value="${k}" ${k === live.size ? 'selected' : ''}>${k === 'S' ? 'Small' : k === 'M' ? 'Medium' : 'Large'}</option>`).join('')}</select>`;
  return h;
}

// The line under the bar: what the mode means right now, and — while recording
// or step editing — a miniature of the beat, one bar wide, every piece a row.
function subHTML() {
  const m = activeMaker(), mode = drumEdit.mode;
  const sayBox = `<span id="dk-say" class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-dim);min-width:120px"></span>`;
  if (mode === 'jam') {
    return `<span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">Hit the drums${drumEdit.keys ? '' : ` — or use the keys: ${KEY_HINT}`}. <b style="color:var(--rk-ink-dim)">● Rec</b> writes what you play into the beat; <b style="color:var(--rk-ink-dim)">✎ Step</b> edits it one step at a time.</span>`;
  }
  if (!m) return `<span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">${mode === 'rec' ? 'Recording' : 'Step editing'} writes into the 🥁 Backing Track pedal — add it with <b style="color:var(--rk-ink-dim)">＋ Backing Track</b> above.</span>`;

  const total = m.total(), bars = m.bars();
  const cur = Math.min(drumEdit.cursor, total - 1);
  const bar = mode === 'step' ? Math.floor(cur / STEPS) : Math.min(live.stripBar, bars - 1);
  let strip = `<div class="dk-strip${mode === 'step' ? ' dk-edit' : ''}" title="${mode === 'step' ? 'Tap a column to edit that step' : 'The beat, as it records'}">`;
  for (let i = 0; i < STEPS; i++) {
    const si = bar * STEPS + i;
    strip += `<div class="dk-col${mode === 'step' && si === cur ? ' dk-cur' : ''}${i % 4 === 0 ? ' dk-beat' : ''}" data-si="${si}">`;
    DRUM_PIECES.forEach(pc => { strip += `<i style="${m.has(pc.key, si) ? `background:${pc.color}` : ''}"></i>`; });
    strip += `<b>${i % 4 === 0 ? i / 4 + 1 : ['', 'e', '&', 'a'][i % 4]}</b></div>`;
  }
  strip += `</div>`;

  if (mode === 'rec') {
    return `${strip}<div style="display:flex;flex-direction:column;gap:3px;min-width:0">
      <span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">${m.isPlaying()
        ? `<b style="color:var(--rk-stop)">●</b> Recording — hits snap to the nearest 16th. Every pass adds; Shift-hit erases.`
        : `Armed. Press <b style="color:var(--rk-ink-dim)">▶ Beat</b>, then play along — the loop keeps going, so take as many passes as you like.`}${bars > 1 ? ` Bar ${bar + 1} of ${bars}.` : ''}</span>${sayBox}</div>`;
  }
  const adv = [[0, 'stay'], [1, 'next 16th'], [2, 'next 8th'], [4, 'next beat']];
  return `<button id="dk-prev" title="Previous step (←)" style="${BTN(false)}">◀</button>${strip}<button id="dk-next" title="Next step (→)" style="${BTN(false)}">▶</button>
    <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
      <span class="mono" style="font-size:calc(9px*var(--ui));color:var(--rk-ink-mute)">Step <b style="color:var(--rk-accent)">${stepName(cur)}</b>${bars > 1 ? ` · bar ${bar + 1} of ${bars}` : ''} — hit a piece to add it here, hit it again to take it off. ← → move, Del clears.</span>
      <span style="display:flex;align-items:center;gap:6px">
        <span class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-faint)">AFTER A HIT</span>
        <select id="dk-adv" style="${SEL};min-height:calc(24px*var(--ui))">${adv.map(([v, l]) => `<option value="${v}" ${drumEdit.advance === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button id="dk-clearstep" title="Take everything off this step (Del)" style="${BTN(false)};min-height:calc(24px*var(--ui));padding:2px 7px">⌫ Clear step</button>
        ${sayBox}
      </span>
    </div>`;
}

function renderBar() {
  const bar = document.getElementById('dk-bar');
  if (!bar || !live) return;
  bar.innerHTML = barHTML();
  bar.querySelectorAll('.dk-mode').forEach(b => b.addEventListener('click', () => setDrumEdit({ mode: b.dataset.m })));
  document.getElementById('dk-play')?.addEventListener('click', () => {
    const m = activeMaker(); if (!m) return;
    touchMaker(m.id);
    m.isPlaying() ? m.stop() : m.start();
  });
  document.getElementById('dk-undo')?.addEventListener('click', () => activeMaker()?.undo());
  document.getElementById('dk-add')?.addEventListener('click', () => {
    // twice, the Stream Deck's way: the first puts it on the board, the second
    // brings it into view (a fresh pedal otherwise lands in the first free slot,
    // which is usually below the fold)
    const need = () => window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail: { type: 'beatmaker', reveal: true } }));
    need(); need();
  });
  document.getElementById('dk-click')?.addEventListener('click', () => setDrumEdit({ click: !drumEdit.click }));
  document.getElementById('dk-keys')?.addEventListener('click', () => { setDrumEdit({ keys: !drumEdit.keys }); paintStage(); });
  document.getElementById('dk-finish')?.addEventListener('change', e => setDrumFinish(e.target.value));
  document.getElementById('dk-size')?.addEventListener('change', e => {
    live.size = SIZES[e.target.value] ? e.target.value : 'M';
    writePref(SIZE_KEY, live.size);
    applySize();
  });
}

function renderSub() {
  const sub = document.getElementById('dk-sub');
  if (!sub || !live) return;
  sub.innerHTML = subHTML();
  const m = activeMaker();
  const move = d => { if (!m) return; const t = m.total(); setDrumEdit({ cursor: ((Math.min(drumEdit.cursor, t - 1) + d) % t + t) % t }); };
  document.getElementById('dk-prev')?.addEventListener('click', () => move(-1));
  document.getElementById('dk-next')?.addEventListener('click', () => move(1));
  document.getElementById('dk-adv')?.addEventListener('change', e => setDrumEdit({ advance: +e.target.value || 0 }));
  document.getElementById('dk-clearstep')?.addEventListener('click', () => m?.clearStep(Math.min(drumEdit.cursor, m.total() - 1)));
  if (drumEdit.mode === 'step') sub.querySelectorAll('.dk-col').forEach(c => c.addEventListener('click', () => setDrumEdit({ cursor: +c.dataset.si })));
  markPlayhead();
}

// The playhead in the strip moves with the beat without redrawing the strip.
function markPlayhead() {
  const m = activeMaker();
  const at = m?.isPlaying() ? m.playhead() : -1;
  document.querySelectorAll('#dk-sub .dk-col').forEach(c => c.classList.toggle('dk-play', +c.dataset.si === at));
}

function applySize() {
  const el = document.getElementById('drums-display');
  if (el) el.style.setProperty('--dk-h', (SIZES[live.size] || SIZES.M) + 'px');
}

function paintStage() {
  if (!live) return;
  live.svg.innerHTML = kitSVG();
  paintLit();
}

// ── Mount / unmount ───────────────────────────────────────────────────
export function renderDrumKit() {
  const el = document.getElementById('drums-display');
  if (!el) return;
  // idempotent: fretboard.js calls this on EVERY switch to the kit
  destroyDrumKit();

  // .rk carries the kit tokens. This bar sits over the instrument, not in a
  // pedal card, so it lands on :root's neutral steel like the 🎤 voice bar — the
  // instrument surface belongs to no one pedal. flex-direction is pinned because
  // .rk otherwise stacks its children.
  el.innerHTML = `
    <div id="dk-bar" class="rk" style="display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px;padding:0 2px 4px"></div>
    <div id="dk-sub" class="rk" style="display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px;padding:0 2px 6px;min-height:calc(20px*var(--ui))"></div>
    <div id="dk-stage"><svg id="dk-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Drum kit"></svg></div>`;

  live = {
    el, off: [], svg: el.querySelector('#dk-svg'),
    size: readPref(SIZE_KEY, 'M', v => !!SIZES[v]),
    stripBar: 0, hatLift: null,
  };
  applySize();
  paintStage();
  renderBar();
  renderSub();

  // pointerdown, not click: a click fires on RELEASE, which is a stick that
  // sounds when it leaves the drum. And every finger is its own pointer, so two
  // fingers on the Surface are a kick and a hat at once.
  live.svg.addEventListener('pointerdown', e => {
    const g = e.target.closest?.('.dk-piece');
    if (!g) return;
    e.preventDefault();
    strike(g.dataset.piece, e);
  });

  const onKey = e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = (t?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
    if (!kitVisible()) return;
    // the TAB page's keyboard is a note-entry keypad; overlays own the keys while open
    if (document.getElementById('tab-mode')?.style.display === 'block') return;
    if (document.getElementById('help-overlay')?.classList.contains('open')) return;
    if (drumEdit.mode === 'step') {
      const m = activeMaker();
      if (m && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const tt = m.total(), d = e.key === 'ArrowLeft' ? -1 : 1;
        setDrumEdit({ cursor: ((Math.min(drumEdit.cursor, tt - 1) + d) % tt + tt) % tt });
        return;
      }
      if (m && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); m.clearStep(Math.min(drumEdit.cursor, m.total() - 1)); return; }
    }
    const key = KEYMAP[keyOf(e)];
    if (!key) return;
    e.preventDefault();
    if (e.repeat) return;              // a held key is one hit, not a drum roll
    strike(key, e);
  };
  window.addEventListener('keydown', onKey);
  live.off.push(() => window.removeEventListener('keydown', onKey));

  // the beat, drawn on the kit as it plays
  live.off.push(drumBus.on('seq', d => {
    if (!live) return;
    (d.keys || []).forEach(k => animate(k));
    if (d.step == null) return;
    const m = activeMaker();
    // while recording, the strip follows the bar that is sounding
    if (drumEdit.mode === 'rec' && m && d.step >= 0) {
      const b = Math.floor(d.step / STEPS);
      if (b !== live.stripBar) { live.stripBar = b; renderSub(); return; }
    }
    markPlayhead();
  }));
  const redraw = () => { if (!live) return; renderBar(); renderSub(); paintLit(); };
  live.off.push(drumBus.on('state', redraw));
  live.off.push(drumBus.on('makers', redraw));
  live.off.push(drumBus.on('edit', redraw));
}

export function destroyDrumKit() {
  if (live) {
    live.off.forEach(off => { try { off(); } catch (e) {} });
    live.hatLift?.cancel();
    live = null;
  }
  // Take the controls down with the view: a hidden bar that survives can still
  // be clicked, and its handlers would write into a beat from a kit that isn't there.
  const el = document.getElementById('drums-display');
  if (el) el.innerHTML = '';
}
