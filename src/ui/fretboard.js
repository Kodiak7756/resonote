import { NOTES, intervalLabel, DEGREE_COLORS } from '../core/music-theory.js';
import { customTuning, getInst, getNoteAtFret, TUNING_PRESETS, applyTuning, getTuningOptions, currentInstrument } from '../core/tuning.js';
import { showIntervals, showNoteMap, chordHighlight, ghostHighlight, positionIsolation, fretboardView } from '../core/state.js';

// Tension weight (0 restful … 1 max tension) per interval — drives the heatmap view.
const TENSION_W = [0,.95,.55,.35,.30,.40,1,.10,.55,.35,.55,.85];
const CHORD_TONE_DEGS = [0,3,4,7,10,11];   // R · 3 · 5 · 7 (the harmonic skeleton)
import { audio } from '../core/audio.js';

// ── Fret geometry ────────────────────────────────────────────────────
const scaleLen = 1600;
export const fretX = [0];
for (let i = 1; i <= 24; i++) fretX.push(scaleLen * (1 - Math.pow(2, -i / 12)));

const SINGLE_DOTS = [3,5,7,9,15,17,19,21];
const DOUBLE_DOTS = [12,24];

export function geo() {
  const inst = getInst(), nf = inst.frets || 24;
  const ns = inst.renderer === 'keyboard' ? 6 : customTuning.length;
  const tw = fretX[nf] + 12, lw = 50, nx = lw;
  const sh = 110 + 36 * ns, bt = 44, bb = sh - 50, bh = bb - bt, ss = bh / (ns + 1);
  return {
    nf, ns, tw, lw, nx, sh, bt, bb, bh, ss, inst,
    sy: si => bt + ss * (si + 1),
    sw: tw + 70,
    fm: f => f === 0 ? nx - 10 : (nx + fretX[f-1] + nx + fretX[f]) / 2
  };
}

// ── Fretboard themes ─────────────────────────────────────────────────
export const FRETBOARD_THEMES = {
  gibson:   {name:'Gibson',   wood:['#2e180c','#3a2010','#30190d','#3c2212','#2f180c','#281408'],grain:'rgba(0,0,0,0.06)',   border:'#1a0e06',bg:'#110a04',fretWire:['#e8e0d0','#c8c0b0','#b0a898','#c8c0b0','#a09888'],nut:['#f5f0e0','#ede5d0','#e0d8c0'],inlay:'trapezoid',inlayFill:['#e8e4dc','#d8d0c4','#c0b8aa'],inlayStroke:'rgba(0,0,0,0.2)',  stringColor:['#d4ccc0','#b8952e'],gauge:1.0},
  fender:   {name:'Fender',   wood:['#c8a878','#bfa070','#b49868','#bda070','#b29666','#c4a474'],grain:'rgba(80,50,10,0.06)',border:'#6a4828',bg:'#3a2818',fretWire:['#e8e0d0','#c8c0b0','#b0a898','#c8c0b0','#a09888'],nut:['#f5f0e0','#ede5d0','#e0d8c0'],inlay:'dot',     inlayFill:['#111','#1a1a1a','#0e0e0e'],           inlayStroke:'rgba(0,0,0,0.4)',  stringColor:['#d4ccc0','#b8952e'],gauge:0.9},
  prs:      {name:'PRS',      wood:['#1e0e04','#281406','#201006','#2a1608','#1e0e04','#180a02'],grain:'rgba(0,0,0,0.04)',   border:'#120804',bg:'#0a0402',fretWire:['#ddd8cc','#c4beb2','#aaa498','#c4beb2','#9a948a'],nut:['#e8e4d8','#ddd8cc','#d0ccc0'],inlay:'bird',    inlayFill:['#e0dcd4','#d0c8bc','#bab2a6'],        inlayStroke:'rgba(255,255,255,0.08)',stringColor:['#d4ccc0','#b8952e'],gauge:1.0},
  ibanez:   {name:'Ibanez',   wood:['#121010','#1a1614','#141210','#1c1816','#161412','#100e0c'],grain:'rgba(0,0,0,0.03)',   border:'#0a0a0a',bg:'#060606',fretWire:['#c8c8c8','#b0b0b0','#989898','#b0b0b0','#888888'],nut:['#2a2a2a','#222','#1a1a1a'],             inlay:'shark',   inlayFill:['#e0dcd4','#cec8bc','#b8b0a4'],        inlayStroke:'rgba(255,255,255,0.08)',stringColor:['#c0c0c0','#a08828'],gauge:1.1},
  martin:   {name:'Martin',   wood:['#a08058','#987850','#906e48','#987850','#8e6c46','#9c7c54'],grain:'rgba(100,70,20,0.05)',border:'#5a3a1e',bg:'#3a2414',fretWire:['#e8e0d0','#c8c0b0','#b0a898','#c8c0b0','#a09888'],nut:['#f8f4ec','#f0ece0','#e8e0d4'],inlay:'dot',     inlayFill:['#e8e4dc','#ddd8cc','#c8c0b4'],        inlayStroke:'rgba(0,0,0,0.15)', stringColor:['#c8b898','#a08020'],gauge:1.0},
  banjo:    {name:'Banjo',    wood:['#b89870','#b09068','#a88860','#ae8e68','#a6865e','#b4946c'],grain:'rgba(100,70,15,0.05)',border:'#6a4828',bg:'#3a2818',fretWire:['#e8e0d0','#c8c0b0','#b0a898','#c8c0b0','#a09888'],nut:['#f8f4ec','#f0ece0','#e8e0d4'],inlay:'dot',     inlayFill:['#e8e4dc','#ddd8cc','#c8c0b4'],        inlayStroke:'rgba(0,0,0,0.15)', stringColor:['#d0c8b8','#b09030'],gauge:0.85},
  mandolin: {name:'Mandolin', wood:['#161008','#1e140a','#181008','#20160c','#181008','#120c06'],grain:'rgba(0,0,0,0.05)',   border:'#0e0804',bg:'#080402',fretWire:['#d0c8b8','#b8b0a0','#a09888','#b8b0a0','#908880'],nut:['#e8e4d8','#ddd8cc','#d0ccc0'],inlay:'smalldot',inlayFill:['#e0dcd4','#cec8bc','#b8b0a4'],        inlayStroke:'rgba(0,0,0,0.18)', stringColor:['#d4ccc0','#b8952e'],gauge:0.8},
  moon:     {name:'Moon Phase',wood:['#18181e','#1e1e26','#1a1a22','#202028','#1c1c24','#16161c'],grain:'rgba(100,100,140,0.03)',border:'#0e0e14',bg:'#08080c',fretWire:['#c0c0d0','#a8a8b8','#9090a0','#a8a8b8','#8888a0'],nut:['#dddde8','#ccccdd','#bbbbd0'],inlay:'moon',    inlayFill:['#e8e8f0','#d0d0dd','#b8b8c8'],        inlayStroke:'rgba(200,200,240,0.1)',stringColor:['#c0c0cc','#9090a0'],gauge:1.0}
};

// High-contrast "next note" (ghost) colour per fretboard theme — picked to pop against
// each wood/background instead of blending in, and to stay distinct from the gold "now" note.
export const THEME_GHOST = {
  gibson:'#5cc8ff', fender:'#3b6dff', prs:'#46e0c0', ibanez:'#6cf06a',
  martin:'#3cc6ff', banjo:'#3b6dff', mandolin:'#5cd8ff', moon:'#d6a6ff'
};

export const INST_DEFAULT_THEME = {
  guitar6:'gibson', guitar8:'ibanez', bass4:'fender',
  banjo5:'banjo', mandolin:'mandolin', piano:'gibson', vocals:'moon'
};

export let currentTheme = INST_DEFAULT_THEME[currentInstrument] || 'gibson';
export function setCurrentTheme(t) { currentTheme = t; }
export function getTheme() { return FRETBOARD_THEMES[currentTheme] || FRETBOARD_THEMES.gibson; }

// ── Inlay renderer ───────────────────────────────────────────────────
function drawInlays(g) {
  const t = getTheme(), cx_fn = g.fm, cy = g.bt + g.bh / 2, bh = g.bh;
  let h = '';
  const ifill = t.inlayFill[0], istroke = t.inlayStroke;
  const sdFill = t.inlayFill[1] || '#b0a898';

  SINGLE_DOTS.filter(f => f <= g.nf).forEach(f => {
    h += `<circle cx="${cx_fn(f)}" cy="${g.bb+14}" r="3" fill="${sdFill}" opacity="0.7"/>`;
  });
  DOUBLE_DOTS.filter(f => f <= g.nf).forEach(f => {
    h += `<circle cx="${cx_fn(f)-6}" cy="${g.bb+14}" r="3" fill="${sdFill}" opacity="0.7"/>`;
    h += `<circle cx="${cx_fn(f)+6}" cy="${g.bb+14}" r="3" fill="${sdFill}" opacity="0.7"/>`;
  });

  if (t.inlay === 'dot' || t.inlay === 'smalldot') {
    const r = t.inlay === 'smalldot' ? 4 : 6, r2 = t.inlay === 'smalldot' ? 3.5 : 5.5;
    SINGLE_DOTS.filter(f => f <= g.nf).forEach(f => {
      h += `<circle cx="${cx_fn(f)}" cy="${cy}" r="${r}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
    });
    DOUBLE_DOTS.filter(f => f <= g.nf).forEach(f => {
      h += `<circle cx="${cx_fn(f)}" cy="${g.bt+bh*.3}" r="${r2}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
      h += `<circle cx="${cx_fn(f)}" cy="${g.bt+bh*.7}" r="${r2}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
    });
  } else if (t.inlay === 'trapezoid') {
    const TRAP_FRETS = [1,3,5,7,9,15,17,19,21];
    TRAP_FRETS.filter(f => f <= g.nf).forEach(f => {
      const x = cx_fn(f), fw = (fretX[f] - fretX[f-1]) * 0.35, th = bh * 0.2, sk = 3;
      h += `<polygon points="${x-fw+sk},${cy-th} ${x+fw+sk},${cy-th} ${x+fw-sk},${cy+th} ${x-fw-sk},${cy+th}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
    });
    [12,24].filter(f => f <= g.nf).forEach(f => {
      const x = cx_fn(f), fw = (fretX[f] - fretX[f-1]) * 0.35, th = bh * 0.12, sk = 2;
      h += `<polygon points="${x-fw+sk},${cy-bh*0.28-th} ${x+fw+sk},${cy-bh*0.28-th} ${x+fw-sk},${cy-bh*0.28+th} ${x-fw-sk},${cy-bh*0.28+th}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
      h += `<polygon points="${x-fw+sk},${cy+bh*0.28-th} ${x+fw+sk},${cy+bh*0.28-th} ${x+fw-sk},${cy+bh*0.28+th} ${x-fw-sk},${cy+bh*0.28+th}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5"/>`;
    });
  } else if (t.inlay === 'bird') {
    // PRS-style birds — progressive sizes
    const mkBird = (pts) => (cx, cy, s, flip) => {
      const fx = flip ? -1 : 1;
      return `<g transform="translate(${cx},${cy}) scale(${s*fx},${s})"><path d="${pts}" fill="${ifill}" stroke="${istroke}" stroke-width="0.4"/></g>`;
    };
    const drawBirdSm = mkBird('M3,0C2.5,-0.8 2,-1 1,-0.5C0,-0.2 -1,0.5 -2,1.5C-3.5,3 -5.5,5 -8,6C-6,4.5 -4.5,3 -3,1C-2,0 -1,-0.5 0,-0.8C-1,-1.5 -2.5,-3 -4,-4.5L-2.5,-3.5C-1,-2.5 0,-1.5 1,-1C2,-0.8 2.5,-0.3 3,0Z M-1,0.3L-3.5,3L-5,4.5L-3,3.8L-2,2.5L-4.5,5.5L-3,5L-1,0.3Z');
    const drawBirdMd = mkBird('M4,0.5C3.5,-0.5 2.5,-1 1.5,-0.5C0.5,0 -0.5,1 -2,2.5C-4,4.5 -6.5,7 -10,8.5C-7.5,6.5 -5.5,4.5 -3.5,2C-2,0.5 -0.5,-0.5 0.5,-1C-0.5,-2 -2,-3.5 -4,-5.5C-6,-7.5 -8.5,-9 -10.5,-9.5C-8,-8.5 -5.5,-7.5 -3.5,-5.5C-1.5,-3.5 0,-2 1,-1C2.5,-0.5 3.5,0 4,0.5Z M-0.5,0.8L-4,4.5L-6,7L-4,6L-2,3.5L-5.5,8L-3.5,7L-0.5,0.8Z');
    const drawBirdLg = mkBird('M5,0.5C4,-1 3,-1.5 1.5,-1C0.5,-0.5 -1,1 -3,3C-5,5.5 -8,8.5 -12,10C-9,8 -6.5,5.5 -4.5,3C-3,1 -1,-0.5 0.5,-1.2L0,-2C-1.5,-3.5 -3.5,-5.5 -6,-8C-8,-10 -11,-12 -14,-13C-11,-11.5 -8.5,-9.5 -6.5,-7.5C-4.5,-5.5 -2.5,-3.5 -1,-2C0.5,-1 2,-0.5 3.5,0C4.5,0.3 5,0.5 5,0.5Z M0,0.5L-4,4.5L-7,7.5L-5,7L-2.5,4L-7,10L-4.5,9L0,0.5Z');
    const drawBirdXl = mkBird('M6,0C5,-1.5 3.5,-2 2,-1.5C0.5,-0.8 -1.5,1 -4,3.5C-6.5,6 -10,9.5 -14,11.5C-11,9.5 -8,7 -5.5,4C-3.5,1.5 -1.5,-0.5 0,-1.5L-0.5,-2.5C-2,-4 -4.5,-7 -7.5,-10C-10,-12.5 -13,-14.5 -16,-15.5C-13.5,-14 -10.5,-11.5 -8,-9C-5.5,-6.5 -3,-4 -1,-2.5C1,-1 3,-0.3 5,0C5.5,0 6,0 6,0Z M-0.5,1L-5,5.5L-8.5,9L-6,8L-3.5,5L-8.5,11.5L-6,10.5L-0.5,1Z');
    const birdFrets = [
      {f:1,s:0.55,fn:drawBirdSm},{f:3,s:0.7,fn:drawBirdSm},{f:5,s:0.75,fn:drawBirdMd},
      {f:7,s:0.85,fn:drawBirdMd},{f:9,s:0.9,fn:drawBirdLg},{f:15,s:0.8,fn:drawBirdLg},
      {f:17,s:0.9,fn:drawBirdLg},{f:19,s:0.75,fn:drawBirdLg},{f:21,s:0.95,fn:drawBirdXl}
    ];
    birdFrets.forEach(({f, s: sc, fn}) => {
      if (f > g.nf) return;
      h += fn(cx_fn(f), cy, sc * (bh / 80), f % 2 === 0);
    });
    if (12 <= g.nf) {
      const x = cx_fn(12);
      h += drawBirdMd(x, g.bt+bh*0.3, 0.65*(bh/80), false);
      h += drawBirdMd(x, g.bt+bh*0.7, 0.65*(bh/80), true);
    }
    if (24 <= g.nf) {
      const x = cx_fn(24);
      h += drawBirdLg(x, g.bt+bh*0.3, 0.6*(bh/80), false);
      h += drawBirdLg(x, g.bt+bh*0.7, 0.6*(bh/80), true);
    }
  } else if (t.inlay === 'moon') {
    const MOON_FRETS = [3,5,7,9,15,17,19,21];
    const phases = ['waxCres','firstQ','waxGib','full','wanGib','lastQ','wanCres','new'];
    MOON_FRETS.filter(f => f <= g.nf).forEach((f, pi) => {
      const x = cx_fn(f), r = bh * 0.14, phase = phases[pi % phases.length];
      h += `<circle cx="${x}" cy="${cy}" r="${r}" fill="#1a1a24" stroke="${istroke}" stroke-width="0.5"/>`;
      if (phase === 'full')   h += `<circle cx="${x}" cy="${cy}" r="${r-.5}" fill="${ifill}" opacity="0.9"/>`;
      else if (phase === 'new') h += '';
      else if (phase === 'firstQ') h += `<path d="M${x},${cy-r}A${r},${r} 0 0,1 ${x},${cy+r}L${x},${cy-r}Z" fill="${ifill}" opacity="0.85"/>`;
      else if (phase === 'lastQ')  h += `<path d="M${x},${cy-r}A${r},${r} 0 0,0 ${x},${cy+r}L${x},${cy-r}Z" fill="${ifill}" opacity="0.85"/>`;
      else if (phase === 'waxCres') h += `<path d="M${x},${cy-r}A${r},${r} 0 0,1 ${x},${cy+r}A${r*.5},${r} 0 0,0 ${x},${cy-r}Z" fill="${ifill}" opacity="0.8"/>`;
      else if (phase === 'waxGib')  h += `<path d="M${x},${cy-r}A${r},${r} 0 0,1 ${x},${cy+r}A${r*.5},${r} 0 0,1 ${x},${cy-r}Z" fill="${ifill}" opacity="0.88"/>`;
      else if (phase === 'wanGib')  h += `<path d="M${x},${cy-r}A${r},${r} 0 0,0 ${x},${cy+r}A${r*.5},${r} 0 0,0 ${x},${cy-r}Z" fill="${ifill}" opacity="0.88"/>`;
      else if (phase === 'wanCres') h += `<path d="M${x},${cy-r}A${r},${r} 0 0,0 ${x},${cy+r}A${r*.5},${r} 0 0,1 ${x},${cy-r}Z" fill="${ifill}" opacity="0.8"/>`;
      if (phase !== 'new') {
        h += `<circle cx="${x-r*.3}" cy="${cy-r*.2}" r="${r*.12}" fill="rgba(0,0,0,0.08)"/>`;
        h += `<circle cx="${x+r*.2}" cy="${cy+r*.25}" r="${r*.08}" fill="rgba(0,0,0,0.06)"/>`;
      }
    });
    if (12 <= g.nf) {
      const x = cx_fn(12), r = bh * 0.1;
      h += `<circle cx="${x}" cy="${g.bt+bh*0.3}" r="${r}" fill="#1a1a24" stroke="${istroke}" stroke-width="0.5"/>`;
      h += `<circle cx="${x}" cy="${g.bt+bh*0.3}" r="${r-.5}" fill="${ifill}" opacity="0.9"/>`;
      h += `<circle cx="${x}" cy="${g.bt+bh*0.7}" r="${r}" fill="#1a1a24" stroke="rgba(200,200,230,0.12)" stroke-width="0.5"/>`;
    }
  } else if (t.inlay === 'shark') {
    SINGLE_DOTS.filter(f => f <= g.nf).forEach(f => {
      const lF = g.nx + fretX[f-1] + 2, rF = g.nx + fretX[f] - 2;
      h += `<polygon points="${lF},${g.bb-3} ${rF},${g.bb-3} ${rF},${g.bt+3}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5" opacity="0.85"/>`;
    });
    DOUBLE_DOTS.filter(f => f <= g.nf).forEach(f => {
      const lF = g.nx + fretX[f-1] + 2, rF = g.nx + fretX[f] - 2;
      h += `<polygon points="${lF},${cy-2} ${rF},${cy-2} ${rF},${g.bt+3}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5" opacity="0.85"/>`;
      h += `<polygon points="${lF},${cy+2} ${rF},${cy+2} ${rF},${g.bb-3}" fill="${ifill}" stroke="${istroke}" stroke-width="0.5" opacity="0.85"/>`;
    });
  }
  return h;
}

// ── Build fretboard SVG ──────────────────────────────────────────────
export function buildFretboardSVG() {
  const g = geo(), svg = document.getElementById('fb-svg'), t = getTheme();
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${g.sw} ${g.sh}`);

  const wStops = t.wood.map((c,i)    => `<stop offset="${(i/(t.wood.length-1)*100).toFixed(0)}%" stop-color="${c}"/>`).join('');
  const fStops = t.fretWire.map((c,i) => `<stop offset="${(i/(t.fretWire.length-1)*100).toFixed(0)}%" stop-color="${c}"/>`).join('');
  const nStops = t.nut.map((c,i)     => `<stop offset="${(i/(t.nut.length-1)*100).toFixed(0)}%" stop-color="${c}"/>`).join('');

  let h = `<defs>
    <linearGradient id="fg"   x1="0" y1="0" x2="0" y2="1">${wStops}</linearGradient>
    <linearGradient id="fw"   x1="0" y1="0" x2="0" y2="1">${fStops}</linearGradient>
    <linearGradient id="nutg" x1="0" y1="0" x2="1" y2="0">${nStops}</linearGradient>
    <filter id="sg"  x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="0.5"/></filter>
    <filter id="ngf" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="cgf" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

  h += `<rect x="${g.nx-2}" y="${g.bt-4}" width="${g.tw+16}" height="${g.bh+8}" rx="4" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>`;
  h += `<rect x="${g.nx}" y="${g.bt}" width="${g.tw+10}" height="${g.bh}" rx="2" fill="url(#fg)"/>`;
  for (let i = 0; i < 12; i++)
    h += `<line x1="${g.nx}" y1="${g.bt+(g.bh/12)*i+2}" x2="${g.nx+g.tw+10}" y2="${g.bt+(g.bh/12)*i+2+Math.random()*4}" stroke="${t.grain}" stroke-width="0.5"/>`;

  h += drawInlays(g);
  h += `<rect x="${g.nx-1}" y="${g.bt-1}" width="6" height="${g.bh+2}" rx="1" fill="url(#nutg)" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`;

  for (let f = 1; f <= g.nf; f++) {
    const x = g.nx + fretX[f];
    h += `<line x1="${x+1}" y1="${g.bt}" x2="${x+1}" y2="${g.bb}" stroke="rgba(0,0,0,0.4)" stroke-width="3"/>`;
    h += `<line x1="${x}"   y1="${g.bt-1}" x2="${x}"   y2="${g.bb+1}" stroke="url(#fw)" stroke-width="2.5" stroke-linecap="round"/>`;
    h += `<line x1="${x-.5}" y1="${g.bt}" x2="${x-.5}" y2="${g.bb}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
  }
  for (let f = 1; f <= g.nf; f++)
    h += `<text x="${g.fm(f)}" y="${g.bt-8}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" fill="#555" font-weight="600">${f}</text>`;

  const gm = t.gauge;
  customTuning.forEach((str, si) => {
    const y = g.sy(si), th = (0.6 + si * (g.ns <= 4 ? 0.8 : g.ns <= 6 ? 0.45 : 0.35)) * gm;
    const w = si >= (g.inst.woundFrom || 99);
    h += `<line x1="${g.nx-12}" y1="${y+1}" x2="${g.nx+g.tw+10}" y2="${y+1}" stroke="rgba(0,0,0,0.3)" stroke-width="${th+1}"/>`;
    h += `<line x1="${g.nx-12}" y1="${y}"   x2="${g.nx+g.tw+10}" y2="${y}"   stroke="${w ? t.stringColor[1] : t.stringColor[0]}" stroke-width="${th}" filter="url(#sg)"/>`;
    if (w) {
      for (let wi = 0; wi < Math.floor(g.tw / 3); wi++)
        h += `<line x1="${g.nx+wi*3}" y1="${y-th/2}" x2="${g.nx+wi*3+1}" y2="${y+th/2}" stroke="rgba(160,130,40,0.12)" stroke-width="0.3"/>`;
    }
  });
  h += `<g id="names-ov"></g><g id="chord-ov"></g><g id="note-ov"></g>`;
  svg.innerHTML = h;
}

// ── Piano keyboard renderer ──────────────────────────────────────────
export const PIANO_WHITE     = [0,2,4,5,7,9,11];
export const PIANO_BLACK     = [1,3,6,8,10];
export const PIANO_BLACK_POS = [0.6,1.6,3.6,4.6,5.6];

export function pianoGeo() {
  const inst = getInst(), octs = inst.octaves || 4, startOct = inst.startOctave || 2;
  const numWhite = octs * 7 + 1;
  const kw = 38, kh = 120, bkw = 24, bkh = 75;
  const pad = 30, sw = pad * 2 + numWhite * kw, sh = kh + 60;
  return {
    octs, startOct, numWhite, kw, kh, bkw, bkh, pad, sw, sh,
    whiteX(i) { return pad + i * kw; },
    noteToWhiteIdx(note, oct) {
      const semi = NOTES.indexOf(note), wIdx = PIANO_WHITE.indexOf(semi);
      if (wIdx === -1) return -1;
      return (oct - startOct) * 7 + wIdx;
    },
    allKeys() {
      const keys = [];
      for (let o = startOct; o < startOct + octs; o++)
        for (let s = 0; s < 12; s++)
          keys.push({ note: NOTES[s], octave: o, isBlack: PIANO_BLACK.includes(s) });
      keys.push({ note: 'C', octave: startOct + octs, isBlack: false });
      return keys;
    }
  };
}

export function buildKeyboardSVG() {
  const g = pianoGeo(), svg = document.getElementById('fb-svg');
  const rel = document.getElementById('fb-rel');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${g.sw} ${g.sh}`);

  let h = `<defs>
    <filter id="ngf" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="cgf" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
  h += `<rect x="${g.pad-2}" y="8" width="${g.numWhite*g.kw+4}" height="${g.kh+4}" rx="4" fill="#1a1a1a" stroke="#333" stroke-width="1"/>`;

  let wi = 0;
  for (let o = g.startOct; o < g.startOct + g.octs; o++) {
    PIANO_WHITE.forEach(semi => {
      const x = g.whiteX(wi);
      h += `<rect x="${x}" y="10" width="${g.kw-2}" height="${g.kh}" rx="3" fill="#f5f0e8" stroke="#999" stroke-width="0.5"/>`;
      if (semi === 0) h += `<text x="${x+g.kw/2-1}" y="${g.kh+4}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" fill="#666" font-weight="600">C${o}</text>`;
      wi++;
    });
  }
  const fx = g.whiteX(wi);
  h += `<rect x="${fx}" y="10" width="${g.kw-2}" height="${g.kh}" rx="3" fill="#f5f0e8" stroke="#999" stroke-width="0.5"/>`;
  h += `<text x="${fx+g.kw/2-1}" y="${g.kh+4}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" fill="#666" font-weight="600">C${g.startOct+g.octs}</text>`;

  for (let o = g.startOct; o < g.startOct + g.octs; o++) {
    PIANO_BLACK_POS.forEach((pos, bi) => {
      const wBase = (o - g.startOct) * 7;
      const x = g.whiteX(wBase) + pos * g.kw - g.bkw / 2 + g.kw / 2;
      h += `<rect x="${x}" y="10" width="${g.bkw}" height="${g.bkh}" rx="2" fill="#222" stroke="#111" stroke-width="0.5"/>`;
      h += `<rect x="${x+2}" y="${g.bkh}" width="${g.bkw-4}" height="4" rx="1" fill="#444"/>`;
    });
  }
  h += `<g id="names-ov"></g><g id="chord-ov"></g><g id="note-ov"></g>`;
  svg.innerHTML = h;
}

// ── buildInstrumentView — dispatch to correct renderer ───────────────
export function buildInstrumentView() {
  const inst = getInst();
  const tuningBar = document.getElementById('tuning-bar');
  const tuningOv  = document.getElementById('tuning-ov');
  const instDisp  = document.getElementById('instrument-display');

  // Show/hide fretboard vs vocals display
  const fbOuter = instDisp?.querySelector('.fb-outer');
  const vocDisp = document.getElementById('vocals-display');

  if (inst.renderer === 'vocals') {
    if (fbOuter) fbOuter.style.display = 'none';
    if (vocDisp) vocDisp.style.display = '';
    if (tuningBar) tuningBar.style.display = 'none';
    if (tuningOv)  tuningOv.style.display  = 'none';
  } else {
    if (fbOuter) fbOuter.style.display = '';
    if (vocDisp) vocDisp.style.display = 'none';
    if (inst.renderer === 'keyboard') {
      if (tuningBar) tuningBar.style.display = 'none';
      if (tuningOv)  tuningOv.style.display  = 'none';
      buildKeyboardSVG();
    } else {
      if (tuningBar) tuningBar.style.display = '';
      if (tuningOv)  tuningOv.style.display  = '';
      buildFretboardSVG();
    }
  }
}

// ── Tuning bar ───────────────────────────────────────────────────────
export function buildTuningBar(saveStateFn) {
  const ov = document.getElementById('tuning-ov');
  const ps = document.getElementById('tuning-preset');
  if (!ov) return;

  const g       = geo();
  const presets = TUNING_PRESETS[currentInstrument] || [];
  const opts    = getTuningOptions();

  if (ps) {
    let ap = '';
    presets.forEach(p => {
      if (p.strings.length === customTuning.length &&
          p.strings.every((s, i) => s.note === customTuning[i].note && s.octave === customTuning[i].octave))
        ap = p.name;
    });
    let ph = `<option value="" ${ap ? '' : ' selected'} disabled>Presets</option>`;
    presets.forEach(p => { ph += `<option value="${p.name}" ${p.name === ap ? 'selected' : ''}>${p.name}</option>`; });
    ps.innerHTML = ph;
    ps.onchange = e => {
      const p = presets.find(x => x.name === e.target.value);
      if (p) applyTuning(p.strings);
    };
  }

  ov.style.width = (g.lw / g.sw) * 100 + '%';
  let h = '';
  customTuning.forEach((str, si) => {
    const yp = (g.sy(si) / g.sh) * 100;
    const cv = str.note + str.octave;
    const fs = g.ns > 6 ? 8 : 9;
    h += `<div style="position:absolute;top:${yp}%;left:0;right:0;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;pointer-events:all">`;
    h += `<select class="tuning-combo" data-si="${si}" style="background:#181818ee;color:#aa8855;border:1px solid #33333388;border-radius:3px;padding:1px 0;font-size:${fs}px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;width:${g.ns>6?38:44}px;text-align:center;appearance:none;-webkit-appearance:none;outline:none">`;
    opts.forEach(no => {
      const v = no.note + no.octave;
      h += `<option value="${v}" ${v === cv ? 'selected' : ''}>${no.note}${no.octave}</option>`;
    });
    h += `</select></div>`;
  });
  ov.innerHTML = h;

  ov.querySelectorAll('.tuning-combo').forEach(sel => {
    sel.onchange = e => {
      const si   = parseInt(e.target.dataset.si);
      const v    = e.target.value;
      const oct  = parseInt(v.slice(-1));
      const note = v.slice(0, -1);
      customTuning[si] = { note, octave: oct, label: si === 0 && note === 'E' && oct >= 4 ? 'e' : note };
      buildInstrumentView();
      buildTuningBar(saveStateFn);
      updateOverlays();
    };
  });

  const ts = document.getElementById('fb-theme');
  if (ts) {
    let th = '';
    Object.entries(FRETBOARD_THEMES).forEach(([k, v]) => {
      th += `<option value="${k}" ${k === currentTheme ? 'selected' : ''}>${v.name}</option>`;
    });
    ts.innerHTML = th;
    ts.onchange = e => {
      currentTheme = e.target.value;
      buildInstrumentView();
      updateOverlays();
      if (saveStateFn) saveStateFn();
    };
  }
}

// ── Overlay rendering ────────────────────────────────────────────────
export let lastClickedNote = null;
export function setLastClickedNote(n) { lastClickedNote = n; }

function _displayLabel(note, rootNote, disp) {
  if (showIntervals && rootNote) return intervalLabel(rootNote, note);
  return disp || note;   // disp = caller's preferred spelling (e.g. E♭ for a minor 3rd over C)
}

function updateKeyboardOverlays() {
  const g = pianoGeo();
  function keyPos(note, octave) {
    const semi   = NOTES.indexOf(note);
    const isBlack = PIANO_BLACK.includes(semi);
    if (!isBlack) {
      const wi = g.noteToWhiteIdx(note, octave);
      if (wi < 0 || wi > g.numWhite) return null;
      return { x: g.whiteX(wi) + g.kw / 2 - 1, y: g.kh - 18, w: g.kw - 4, isBlack: false };
    } else {
      const bi = PIANO_BLACK.indexOf(semi);
      if (bi < 0) return null;
      const wBase = (octave - g.startOct) * 7;
      const x = g.whiteX(wBase) + PIANO_BLACK_POS[bi] * g.kw - g.bkw / 2 + g.kw / 2;
      return { x: x + g.bkw / 2, y: g.bkh - 14, w: g.bkw - 2, isBlack: true };
    }
  }

  const nov = document.getElementById('names-ov');
  if (nov) {
    let nh = '';
    if (showNoteMap) {
      g.allKeys().forEach(k => {
        const kp = keyPos(k.note, k.octave);
        if (!kp) return;
        const fill = k.isBlack ? 'rgba(200,200,200,.7)' : 'rgba(80,80,80,.7)';
        nh += `<text x="${kp.x}" y="${kp.y+12}" text-anchor="middle" font-size="${k.isBlack?7:8}" font-family="'JetBrains Mono',monospace" font-weight="600" fill="${fill}" style="pointer-events:none">${k.note}</text>`;
      });
    }
    nov.innerHTML = nh;
  }

  const cov = document.getElementById('chord-ov');
  if (cov) {
    let ch = '';
    if (chordHighlight.active) {
      const { rootNote: rn, chordNotes: cn, positions: pos, colors } = chordHighlight;
      const rc = colors?.root || '#8877dd', tc = colors?.tone || '#554488';
      const rs2 = colors?.rootStroke || '#aa99ee', ts2 = colors?.toneStroke || '#7766bb';
      const targets = pos?.length ? pos : [];
      const list = targets.length ? targets : g.allKeys().filter(k => cn.includes(k.note));
      list.forEach(p => {
        const kp = keyPos(p.note, p.octave || p.oct || g.startOct);
        if (!kp) return;
        const isRoot = p.note === rn, fill = isRoot ? rc : tc, stroke = isRoot ? rs2 : ts2;
        const dl = _displayLabel(p.note, rn);
        if (kp.isBlack) {
          ch += `<rect x="${kp.x-g.bkw/2+1}" y="10" width="${g.bkw-2}" height="${g.bkh}" rx="2" fill="${fill}" opacity=".8" stroke="${stroke}" stroke-width="1.5"/>`;
          ch += `<text x="${kp.x}" y="${kp.y}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff" style="pointer-events:none">${dl}</text>`;
        } else {
          ch += `<rect x="${kp.x-g.kw/2+2}" y="10" width="${g.kw-4}" height="${g.kh}" rx="3" fill="${fill}" opacity=".55" stroke="${stroke}" stroke-width="1.5"/>`;
          ch += `<text x="${kp.x}" y="${kp.y}" text-anchor="middle" font-size="10" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff" style="pointer-events:none">${dl}</text>`;
        }
      });
    }
    cov.innerHTML = ch;
  }
}

// ── Position isolation helpers (hand-position window / custom shape) ──
function posDim(fret, si) {
  const p = positionIsolation;
  if (!p || !p.active) return 1;
  if (p.customShape && p.customShape.length)
    return p.customShape.some(c => c.si === si && c.fret === fret) ? 1 : 0.13;
  const inFret = fret >= p.loFret && fret <= p.hiFret;
  const inStr  = p.loString == null ? true
    : (si >= p.loString && (p.hiString == null || si <= p.hiString));
  return (inFret && inStr) ? 1 : 0.13;
}
function inShape(fret, si) {
  const p = positionIsolation;
  return !!(p && p.active && p.customShape && p.customShape.some(c => c.si === si && c.fret === fret));
}

export function updateOverlays() {
  if (getInst().renderer === 'keyboard') return updateKeyboardOverlays();

  const nov = document.getElementById('names-ov');
  if (nov) {
    let nh = '';
    if (showNoteMap) {
      const g = geo();
      const pi = positionIsolation;
      // Position window frame (fret-range windows only, not custom shapes)
      if (pi.active && !(pi.customShape && pi.customShape.length)) {
        const lo = pi.loFret, hi = Math.min(pi.hiFret, g.nf);
        const x1 = lo <= 0 ? g.nx - 16 : g.nx + fretX[lo - 1];
        const x2 = g.nx + fretX[hi];
        nh += `<rect x="${x1}" y="${g.bt-4}" width="${Math.max(10, x2-x1)}" height="${g.bh+8}" rx="6" fill="rgba(90,209,192,.05)" stroke="rgba(90,209,192,.5)" stroke-width="1.5"/>`;
      }
      customTuning.forEach((s, si) => {
        const y = g.sy(si);
        for (let f = 0; f <= g.nf; f++) {
          const { note } = getNoteAtFret(s.note, s.octave, f);
          const cx = g.fm(f), isOpen = f === 0;
          const r = isOpen ? 7 : 5.5, ty = isOpen ? 2.5 : 2, fs = isOpen ? 7 : 5.5;
          const dim = posDim(f, si), shp = inShape(f, si);
          // Declutter: when a chord/scale is highlighted, fade the full note-name
          // map to a faint reference so the highlighted shape reads clearly.
          const mapDim = chordHighlight.active && !shp ? dim * 0.25 : dim;
          nh += `<g opacity="${mapDim}">`;
          if (shp) nh += `<circle cx="${cx}" cy="${y}" r="${r+3}" fill="none" stroke="#5ad1c0" stroke-width="2"/>`;
          nh += `<circle cx="${cx}" cy="${y}" r="${r}" fill="${shp?'rgba(90,209,192,.25)':'rgba(60,60,60,.6)'}" stroke="${shp?'#5ad1c0':'rgba(100,100,100,.3)'}" stroke-width=".5"/><text x="${cx}" y="${y+ty}" text-anchor="middle" font-size="${fs}" font-family="'JetBrains Mono',monospace" font-weight="600" fill="${shp?'#dff':'rgba(180,180,180,.7)'}" style="pointer-events:none">${note}</text></g>`;
        }
      });
    }
    nov.innerHTML = nh;
  }

  const cov = document.getElementById('chord-ov');
  if (cov) {
    let ch = '';
    if (chordHighlight.active) {
      const g = geo();
      const { rootNote: rn, chordNotes: cn, positions: pos, colors, focusPos: fp } = chordHighlight;
      const rc = colors?.root || '#8877dd', tc = colors?.tone || '#554488';
      const rs2 = colors?.rootStroke || '#aa99ee', ts2 = colors?.toneStroke || '#7766bb';
      // Fretboard view modes: recolour each dot by function / tension / chord-tone.
      const viewOn = fretboardView !== 'standard' && fretboardView !== 'interval' && !!rn;
      const degOf  = note => ((NOTES.indexOf(note) - NOTES.indexOf(rn)) % 12 + 12) % 12;
      const degCol = note => {
        if (!viewOn) return null;
        const d = degOf(note);
        if (fretboardView === 'function')  return DEGREE_COLORS[d];
        if (fretboardView === 'tension')   { const t = TENSION_W[d]; return `rgb(${Math.round(70+t*185)},${Math.round(205-t*155)},${Math.round(120-t*70)})`; }
        if (fretboardView === 'chordtone') return CHORD_TONE_DEGS.includes(d) ? DEGREE_COLORS[d] : '#2c3836';
        return null;
      };
      const degTxt = note => {
        if (!viewOn) return null;
        if (fretboardView === 'chordtone') return CHORD_TONE_DEGS.includes(degOf(note)) ? '#15140d' : 'rgba(220,235,235,.4)';
        return '#15140d';
      };
      if (pos) {
        // focusPos may be a single {si,fret} or an ARRAY of them (a synced
        // sequence lights one/several notes gold while the rest stay dim).
        const focusList = Array.isArray(fp) ? fp : (fp ? [fp] : []);
        const hasFocus = focusList.length > 0;
        const trail = Array.isArray(chordHighlight.trail) ? chordHighlight.trail : [];
        // small fretting-finger badge for chord-grip dots (open strings & scale runs carry no finger)
        const fbadge = (cx, y, p, isOpen) => (p.finger > 0 && p.fret > 0)
          ? `<g><circle cx="${cx+(isOpen?8:7)}" cy="${y-(isOpen?9:8)}" r="4.6" fill="#15140d" stroke="#ffcf5a" stroke-width="0.8"/><text x="${cx+(isOpen?8:7)}" y="${y-(isOpen?9:8)+2.3}" text-anchor="middle" font-size="6.5" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#ffcf5a" style="pointer-events:none">${p.finger}</text></g>`
          : '';
        pos.forEach(p => {
          if (p.fret < 0) return;
          const y = g.sy(p.si), cx = g.fm(p.fret), isRoot = p.note === rn, isOpen = p.fret === 0;
          const dl = _displayLabel(p.note, rn, p.disp), isFocus = focusList.some(f => f.si === p.si && f.fret === p.fret);
          const isTrail = !isFocus && hasFocus && trail.some(tp => tp.si === p.si && tp.fret === p.fret);
          // focusOnly drills draw ONLY what's currently sounding (+ its fading trail) — skip the
          // dim background dots so the small interval shapes don't read as a cluster.
          if (chordHighlight.focusOnly && !isFocus && !isTrail) return;
          if (isFocus) {
            ch += `<g filter="url(#cgf)">`;
            // expanding "ping" ring fires as the note lands — a visual beat pulse
            ch += `<circle cx="${cx}" cy="${y}" r="${isOpen?13:11}" fill="none" stroke="#ffd060" stroke-width="2"><animate attributeName="r" values="${isOpen?13:11};${isOpen?24:21}" dur="0.5s" begin="0s" repeatCount="1" fill="freeze"/><animate attributeName="opacity" values="0.55;0" dur="0.5s" begin="0s" repeatCount="1" fill="freeze"/></circle>`;
            // the gold note pops as it arrives, then settles
            ch += `<circle cx="${cx}" cy="${y}" r="${isOpen?13:11}" fill="#ffc830" opacity=".97" stroke="#ffdd55" stroke-width="2.5"><animate attributeName="r" values="${isOpen?16.5:14.5};${isOpen?13:11}" dur="0.18s" begin="0s" repeatCount="1" fill="freeze"/></circle>`;
            ch += `<text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="${isOpen?11:10}" font-family="'JetBrains Mono',monospace" font-weight="900" fill="#1a1000" style="pointer-events:none">${dl}</text>`;
            if (!Array.isArray(fp) && fp.finger) {
              ch += `<rect x="${cx-8}" y="${y-22}" width="16" height="12" rx="3" fill="#ffc830" opacity=".9"/>`;
              ch += `<text x="${cx}" y="${y-13}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" font-weight="900" fill="#1a1000" style="pointer-events:none">${fp.finger}</text>`;
            }
            ch += `</g>`;
            ch += `<line x1="${g.nx-10}" y1="${y}" x2="${g.tw+60}" y2="${y}" stroke="#ffc830" stroke-width="2" opacity=".15"/>`;
          } else if (isTrail) {
            // fading gold breadcrumb — where the line just came from, so motion reads at a glance
            ch += `<g><circle cx="${cx}" cy="${y}" r="${isOpen?10:8}" fill="#ffc830" stroke="#ffdd55" stroke-width="1"><animate attributeName="opacity" values="0.4;0.16" dur="0.45s" begin="0s" repeatCount="1" fill="freeze"/></circle><text x="${cx}" y="${y+2.5}" text-anchor="middle" font-size="${isOpen?7:5.5}" font-family="'JetBrains Mono',monospace" font-weight="700" fill="rgba(40,25,0,.7)" style="pointer-events:none">${dl}</text></g>`;
          } else if (hasFocus) {
            ch += `<g><circle cx="${cx}" cy="${y}" r="${isOpen?8:6}" fill="${isRoot?rc:tc}" opacity=".3" stroke="${isRoot?rs2:ts2}" stroke-width="1"/><text x="${cx}" y="${y+2.5}" text-anchor="middle" font-size="${isOpen?7:5.5}" font-family="'JetBrains Mono',monospace" font-weight="600" fill="rgba(255,255,255,.4)" style="pointer-events:none">${dl}</text></g>`;
          } else if (isRoot) {
            ch += `<g filter="url(#cgf)"><circle cx="${cx}" cy="${y}" r="${isOpen?12:10}" fill="${degCol(p.note)||rc}" opacity=".95" stroke="${rs2}" stroke-width="2"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="${isOpen?10:9}" font-family="'JetBrains Mono',monospace" font-weight="800" fill="${degTxt(p.note)||'#fff'}" style="pointer-events:none">${dl}</text></g>` + fbadge(cx, y, p, isOpen);
          } else {
            ch += `<g filter="url(#cgf)"><circle cx="${cx}" cy="${y}" r="${isOpen?10:8}" fill="${degCol(p.note)||tc}" opacity=".85" stroke="${ts2}" stroke-width="1.5"/><text x="${cx}" y="${y+3}" text-anchor="middle" font-size="${isOpen?9:7}" font-family="'JetBrains Mono',monospace" font-weight="700" fill="${degTxt(p.note)||'#fff'}" style="pointer-events:none">${dl}</text></g>` + fbadge(cx, y, p, isOpen);
          }
        });
        // Connect dots in PLAY order (the order positions were given), so the dashed path
        // matches the sequence the drill actually plays — not a re-sort by string. Skip the
        // path entirely for a single-note MAP (e.g. "every A on the neck"): those dots aren't a
        // melodic line, so a connecting path would imply a shape/order that isn't real.
        const played = pos.filter(p => p.fret >= 0);
        const oneNoteMap = played.length > 1 && played.every(p => p.note === played[0].note);
        if (played.length > 1 && !oneNoteMap && !chordHighlight.focusOnly) {
          for (let i = 0; i < played.length - 1; i++) {
            const a = played[i], b = played[i+1];
            ch += `<line x1="${g.fm(a.fret)}" y1="${g.sy(a.si)}" x2="${g.fm(b.fret)}" y2="${g.sy(b.si)}" stroke="rgba(136,119,221,.2)" stroke-width="1.5" stroke-dasharray="3,3"/>`;
          }
        }
      } else {
        customTuning.forEach((s, si) => {
          const y = g.sy(si);
          for (let f = 0; f <= g.nf; f++) {
            const { note } = getNoteAtFret(s.note, s.octave, f);
            if (!cn.includes(note)) continue;
            const isRoot = note === rn, cx = g.fm(f), isOpen = f === 0, dl = _displayLabel(note, rn);
            if (isRoot) {
              ch += `<g filter="url(#cgf)"><circle cx="${cx}" cy="${y}" r="${isOpen?11:9}" fill="${degCol(note)||rc}" opacity=".9" stroke="${rs2}" stroke-width="1.5"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="${isOpen?10:8}" font-family="'JetBrains Mono',monospace" font-weight="800" fill="${degTxt(note)||'#fff'}" style="pointer-events:none">${dl}</text></g>`;
            } else {
              const top2 = isOpen ? .75 : .5, tfill = isOpen ? .85 : .6;
              ch += `<g><circle cx="${cx}" cy="${y}" r="${isOpen?9:7}" fill="${degCol(note)||tc}" opacity="${viewOn?0.92:top2}" stroke="${isOpen?ts2:'none'}" stroke-width="1"/><text x="${cx}" y="${y+(isOpen?3:2.5)}" text-anchor="middle" font-size="${isOpen?8:6}" font-family="'JetBrains Mono',monospace" font-weight="700" fill="${degTxt(note)||'rgba(255,255,255,'+tfill+')'}" style="pointer-events:none">${dl}</text></g>`;
            }
          }
        });
      }
    }
    // Ghost dots — upcoming note/chord preview (dashed outline, no fill).
    // In the Voice-Leading view a chord→chord move ALSO draws per-voice "FLOW" arrows: each string
    // is a voice, so we show what STAYS (an anchor ring on common tones) and what MOVES (an arrow +
    // the semitone distance). The transitions microscope — chords as a few voices each barely moving.
    if (ghostHighlight.active && ghostHighlight.positions?.length) {
      const gg = geo();
      // Per-theme "next note" colour so the upcoming dots contrast each wood instead of blending.
      const gcol = THEME_GHOST[currentTheme] || ghostHighlight.colors?.stroke || '#5cc8ff';
      const flow = fretboardView === 'voice' && chordHighlight.active && !chordHighlight.focusOnly && Array.isArray(chordHighlight.positions);
      const curOn = si => flow ? chordHighlight.positions.find(c => c.si === si && c.fret >= 0) : null;
      let ghost = '';
      ghostHighlight.positions.forEach(p => {
        if (p.fret < 0) return;
        const y = gg.sy(p.si), cx = gg.fm(p.fret), isOpen = p.fret === 0, r = isOpen ? 10 : 8.5;
        const c = curOn(p.si);
        if (flow && c && c.fret === p.fret) {
          // HELD — common tone, this voice doesn't move. Anchor ring, skip the ghost dot.
          ghost += `<circle cx="${cx}" cy="${y}" r="${r+3.5}" fill="none" stroke="${gcol}" stroke-width="1.6" stroke-dasharray="1.5,2.5" opacity="0.85"/>`;
          ghost += `<text x="${cx}" y="${y-r-5}" text-anchor="middle" font-size="6.5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="${gcol}" opacity="0.9" style="pointer-events:none">hold</text>`;
          return;
        }
        ghost += `<g>`;
        // dark halo behind so the bright dashed ring reads on light AND dark woods
        ghost += `<circle cx="${cx}" cy="${y}" r="${r+1.5}" fill="rgba(8,6,4,0.55)"/>`;
        ghost += `<circle cx="${cx}" cy="${y}" r="${r}" fill="none" stroke="${gcol}" stroke-width="2.2" stroke-dasharray="4,3"/>`;
        ghost += `<text x="${cx}" y="${y+3}" text-anchor="middle" font-size="${isOpen?8:6.5}" font-family="'JetBrains Mono',monospace" font-weight="800" fill="${gcol}" style="pointer-events:none">${p.note}</text>`;
        ghost += `</g>`;
        // FLOW arrow: current voice on this string → its target, labelled with the move in semitones.
        if (flow && c && c.fret !== p.fret) {
          const x1 = gg.fm(c.fret), dir = cx > x1 ? 1 : -1, delta = p.fret - c.fret;
          const start = x1 + dir * (r + 2), end = cx - dir * (r + 3);
          ghost += `<line x1="${start}" y1="${y}" x2="${end}" y2="${y}" stroke="${gcol}" stroke-width="2" opacity="0.9" style="pointer-events:none"/>`;
          ghost += `<path d="M ${end} ${y} l ${-dir*5.5} -4 l 0 8 z" fill="${gcol}" style="pointer-events:none"/>`;
          ghost += `<text x="${(x1+cx)/2}" y="${y-r-2}" text-anchor="middle" font-size="7.5" font-family="'JetBrains Mono',monospace" font-weight="800" fill="${gcol}" style="pointer-events:none">${delta>0?'+':''}${delta}</text>`;
        }
      });
      // Prepend ghosts so solid chord dots render on top
      ch = ghost + ch;
    }

    cov.innerHTML = ch;
  }

  const ov = document.getElementById('note-ov');
  const rd = document.getElementById('note-readout');
  if (!ov) return;
  // Interval Explorer owns the note layer (main.js renderIntervalPicks) — don't clobber it.
  if (fretboardView === 'interval') return;
  const det = audio.detected, g = geo();

  if (!det && lastClickedNote) {
    let ch2 = '';
    const cn = lastClickedNote, arn = chordHighlight.active ? chordHighlight.rootNote : null;
    const dl = _displayLabel(cn.note, arn);
    if (cn.si !== undefined && cn.fret !== undefined) {
      const y = g.sy(cn.si), cx = g.fm(cn.fret), isOpen = cn.fret === 0;
      ch2 += `<g filter="url(#ngf)"><circle cx="${cx}" cy="${y}" r="${isOpen?12:10}" fill="#44aaff" opacity=".9" stroke="#88ccff" stroke-width="2"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="${isOpen?10:9}" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#fff" style="pointer-events:none">${dl}</text></g>`;
    } else {
      customTuning.forEach((s, si) => {
        const y = g.sy(si);
        for (let f = 0; f <= g.nf; f++) {
          const { note } = getNoteAtFret(s.note, s.octave, f);
          if (note !== cn.note) continue;
          const cx = g.fm(f), isOpen = f === 0;
          ch2 += `<g><circle cx="${cx}" cy="${y}" r="${isOpen?10:8}" fill="#44aaff" opacity=".5" stroke="#88ccff" stroke-width="1"/><text x="${cx}" y="${y+3}" text-anchor="middle" font-size="${isOpen?9:7}" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff" style="pointer-events:none">${dl}</text></g>`;
        }
      });
    }
    ov.innerHTML = ch2;
    if (rd) {
      const rdLabel = showIntervals && chordHighlight.active?.rootNote
        ? intervalLabel(chordHighlight.rootNote, cn.note) + ' (' + cn.note + ')'
        : cn.note + (cn.octave || '');
      rd.innerHTML = `<span class="mono" style="color:#44aaff;font-size:20px;font-weight:900">${rdLabel}</span>`;
      if (chordHighlight.active) {
        const inCtx = chordHighlight.chordNotes.includes(cn.note);
        const ivl   = intervalLabel(chordHighlight.rootNote, cn.note);
        rd.innerHTML += `<span class="mono" style="color:#333;font-size:12px;margin:0 4px">│</span><span class="mono" style="color:${inCtx?'#00ff88':'#ff4466'};font-size:11px;font-weight:700">${ivl} ${inCtx?'✓':'✗'}</span>`;
      }
    }
    return;
  }

  if (!det) {
    ov.innerHTML = '';
    if (rd) {
      if (!chordHighlight.active)
        rd.innerHTML = `<span class="mono" style="color:#333;font-size:11px">Play a note to see it on the fretboard...</span>`;
      else
        rd.innerHTML = `<span class="mono" style="color:#8877dd;font-size:14px;font-weight:700">${chordHighlight.label}</span><span class="mono" style="color:#555;font-size:10px;margin-left:8px">${chordHighlight.chordNotes.join(' · ')}</span>`;
    }
    return;
  }

  const sn = det.note, so = det.octave, ek = new Set();
  customTuning.forEach((s, si) => {
    for (let f = 0; f <= g.nf; f++) {
      const { note, octave } = getNoteAtFret(s.note, s.octave, f);
      if (note === sn && octave === so) ek.add(`${si}-${f}`);
    }
  });
  const arn = chordHighlight.active ? chordHighlight.rootNote : null;
  let h = '';
  customTuning.forEach((s, si) => {
    const y = g.sy(si);
    for (let f = 0; f <= g.nf; f++) {
      const { note } = getNoteAtFret(s.note, s.octave, f);
      if (note !== sn) continue;
      const ex = ek.has(`${si}-${f}`), op = f === 0, cx = g.fm(f), dl = _displayLabel(note, arn);
      if (op && ex)
        h += `<g filter="url(#ngf)"><circle cx="${cx}" cy="${y}" r="13" fill="none" stroke="#ff4466" stroke-width="2" opacity=".6"><animate attributeName="r" values="13;16;13" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="${cx}" cy="${y}" r="11" fill="#ff4466" stroke="#ffaabb" stroke-width="1.5"><animate attributeName="opacity" values="1;.75;1" dur="1s" repeatCount="indefinite"/></circle><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="10" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#fff" style="pointer-events:none">${dl}</text></g>`;
      else if (op)
        h += `<g><circle cx="${cx}" cy="${y}" r="10" fill="#ff6b35" opacity=".8" stroke="#ff9966" stroke-width="1"/><text x="${cx}" y="${y+3.5}" text-anchor="middle" font-size="9" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#fff" style="pointer-events:none">${dl}</text></g>`;
      else if (ex)
        h += `<g filter="url(#ngf)"><circle cx="${cx}" cy="${y}" r="9" fill="#ff4466" opacity=".85" stroke="#ff8899" stroke-width="1"><animate attributeName="opacity" values=".85;.6;.85" dur="1.2s" repeatCount="indefinite"/></circle><text x="${cx}" y="${y+3}" text-anchor="middle" font-size="8" font-family="'JetBrains Mono',monospace" font-weight="800" fill="#fff" style="pointer-events:none">${dl}</text></g>`;
      else
        h += `<g><circle cx="${cx}" cy="${y}" r="6" fill="#0099cc" opacity=".35"/><text x="${cx}" y="${y+2.5}" text-anchor="middle" font-size="5.5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="rgba(255,255,255,0.5)" style="pointer-events:none">${dl}</text></g>`;
    }
  });
  ov.innerHTML = h;

  if (rd) {
    const cc = Math.abs(det.cents) < 5 ? '#00ff88' : Math.abs(det.cents) < 15 ? '#ffaa00' : '#ff4466';
    const detLabel = showIntervals && arn ? intervalLabel(arn, det.note) + ' (' + det.note + det.octave + ')' : det.note + det.octave;
    let rdh = `<span class="mono" style="color:#ff4466;font-size:24px;font-weight:900;text-shadow:0 0 20px rgba(255,68,102,0.5)">${detLabel}</span>`;
    rdh += `<span class="mono" style="color:#555;font-size:11px">${det.freq.toFixed(1)} Hz</span>`;
    rdh += `<span class="mono" style="color:${cc};font-size:11px;font-weight:700">${det.cents > 0 ? '+' : ''}${det.cents}¢</span>`;
    if (chordHighlight.active) {
      const inContext = chordHighlight.chordNotes.includes(det.note);
      const ivl = intervalLabel(chordHighlight.rootNote, det.note);
      rdh += `<span class="mono" style="color:#333;font-size:12px;margin:0 4px">│</span>`;
      rdh += `<span class="mono" style="color:${inContext?'#00ff88':'#ff4466'};font-size:11px;font-weight:700">${ivl}</span>`;
      rdh += `<span class="mono" style="color:#555;font-size:9px;margin-left:4px">${inContext?'✓':'✗'} ${chordHighlight.label}</span>`;
    }
    rd.innerHTML = rdh;
  }
}
