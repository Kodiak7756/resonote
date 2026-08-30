// ── Looks: the player's own instrument finishes ───────────────────────
// The eight built-in fretboard themes are fixed presets. A LOOK is a saved set
// of overrides on top of one of them — wood, string metal, fret wire, inlay
// shape and inlay material — kept PER INSTRUMENT, because a banjo and an
// 8-string shouldn't have to share a finish.
//
// Piano keys get their own colour mode instead of wood: the note spectrum (the
// app's one colour code), a palette the player picks note by note, or plain key
// surfaces. Stored the same way so one customizer drives every instrument.
import { NOTES } from './music-theory.js';
import { pcColor } from './colors.js';

const KEY = 'rn-looks';

// Every field a look may override on a theme. Anything absent falls through to
// the base preset, so a look stays valid when a preset is later improved.
export const LOOK_FIELDS = ['wood', 'stringColor', 'fretWire', 'nut', 'inlay', 'inlayFill', 'border', 'bg'];
export const INLAY_SHAPES = ['dot', 'smalldot', 'trapezoid', 'bird', 'shark', 'moon', 'none'];
export const PIANO_MODES = ['spectrum', 'custom', 'plain'];

function readAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function writeAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* private mode */ } }

// A look is stored per instrument id: { base, fields…, piano:{mode, keyColors} }
export function getLook(instrument) { return readAll()[instrument] || null; }
export function saveLook(instrument, look) { const all = readAll(); all[instrument] = look; writeAll(all); }
export function clearLook(instrument) { const all = readAll(); delete all[instrument]; writeAll(all); }
export function hasLook(instrument) { return !!getLook(instrument); }

// Apply a saved look over a base theme object — the fretboard renderer asks for
// this instead of reading FRETBOARD_THEMES directly.
export function applyLook(theme, instrument) {
  const look = getLook(instrument);
  if (!look) return theme;
  const out = { ...theme };
  LOOK_FIELDS.forEach(f => { if (look[f] !== undefined && look[f] !== null) out[f] = look[f]; });
  return out;
}

// Piano key colour for one pitch class, honouring the instrument's chosen mode.
// 'plain' returns null so the renderer keeps its own ivory/ebony styling.
export function pianoKeyColor(instrument, note, isBlack) {
  const look = getLook(instrument);
  const mode = look?.piano?.mode || 'spectrum';
  if (mode === 'plain') return null;
  if (mode === 'custom') {
    const c = look?.piano?.keyColors?.[NOTES.indexOf(note)];
    return c || null;
  }
  // spectrum: the app-wide note code, darkened for the black keys so the
  // keyboard still reads as a keyboard at a glance
  return isBlack ? pcColor(note, 62, 32) : pcColor(note, 70, 62);
}

// A fresh look seeded from a preset, so the editor always starts somewhere real.
export function lookFromTheme(theme, instrument) {
  const prev = getLook(instrument);
  return {
    base: prev?.base || 'gibson',
    wood: [...(prev?.wood || theme.wood)],
    stringColor: [...(prev?.stringColor || theme.stringColor)],
    fretWire: [...(prev?.fretWire || theme.fretWire)],
    nut: [...(prev?.nut || theme.nut)],
    inlay: prev?.inlay || theme.inlay,
    inlayFill: [...(prev?.inlayFill || theme.inlayFill)],
    border: prev?.border || theme.border,
    bg: prev?.bg || theme.bg,
    piano: prev?.piano || { mode: 'spectrum', keyColors: NOTES.map(n => pcColor(n, 70, 62)) },
  };
}

// Shift a whole colour ramp by a hue/lightness nudge — lets one slider restain
// the wood without asking the player to pick six shades by hand.
export function restain(ramp, hueShift, lightShift) {
  return ramp.map(hex => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = Math.min(100, Math.max(0, (max + min) / 2 / 255 * 100 + lightShift));
    const s = d ? d / (255 - Math.abs(max + min - 255)) * 100 : 0;
    return `hsl(${Math.round((h + hueShift + 360) % 360)},${Math.round(Math.min(100, s))}%,${Math.round(l)}%)`;
  });
}
