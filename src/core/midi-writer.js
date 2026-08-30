// ── Standard MIDI File writer (REAPER Bridge) ────────────────────────
// Pure encoder: no browser APIs except inside downloadMidi(), so the
// encoding path is unit-testable in Node. Type-0 SMF, PPQ 480, with
// tempo + time-signature meta so REAPER can adopt the project settings
// on import.
import { NOTES, toSharp } from './music-theory.js';

export const PPQ = 480;

// note name + octave → MIDI number (E2 = 40, A2 = 45, E4 = 64 …)
export function noteToMidi(note, octave) {
  return 12 * (octave + 1) + NOTES.indexOf(toSharp(note));
}

// fretboard position → MIDI number. `strings` is the tuning array from
// core/tuning.js (index 0 = highest string), each {note, octave}.
export function stringFretToMidi(si, fret, strings) {
  const s = strings[si];
  if (!s) return null;
  return noteToMidi(s.note, s.octave) + fret;
}

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}

// notes: [{tick, note, vel, dur}] — tick/dur in PPQ ticks, note 0-127.
// timeSig: [num, den] e.g. [4,4] or [6,8]. endTick (optional) pads the
// item so REAPER shows whole bars even after a trailing rest.
export function encodeMidi({ ppq = PPQ, bpm = 120, timeSig = [4, 4], trackName = 'Resonote', notes = [], endTick = 0 }) {
  const events = [];
  for (const n of notes) {
    if (n.note == null || n.note < 0 || n.note > 127) continue;
    const vel = Math.max(1, Math.min(127, Math.round(n.vel ?? 96)));
    const dur = Math.max(1, Math.round(n.dur ?? ppq));
    const tick = Math.max(0, Math.round(n.tick ?? 0));
    events.push({ tick, order: 1, bytes: [0x90, n.note, vel] });
    events.push({ tick: tick + dur, order: 0, bytes: [0x80, n.note, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  // track name
  const nameBytes = Array.from(new TextEncoder().encode(trackName)).slice(0, 60);
  track.push(...vlq(0), 0xff, 0x03, nameBytes.length, ...nameBytes);
  // tempo (µs per quarter)
  const usPerQ = Math.round(60000000 / Math.max(20, Math.min(400, bpm)));
  track.push(...vlq(0), 0xff, 0x51, 0x03, (usPerQ >> 16) & 0xff, (usPerQ >> 8) & 0xff, usPerQ & 0xff);
  // time signature
  const [num, den] = timeSig;
  const dd = Math.round(Math.log2(den || 4));
  track.push(...vlq(0), 0xff, 0x58, 0x04, num || 4, dd, 24, 8);

  let last = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - last), ...ev.bytes);
    last = ev.tick;
  }
  const end = Math.max(endTick, last);
  track.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,      // MThd, length 6
    0, 0,                                     // format 0
    0, 1,                                     // one track
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const trkHead = [0x4d, 0x54, 0x72, 0x6b,   // MTrk
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff];

  return new Uint8Array([...header, ...trkHead, ...track]);
}

// resonote_<kind>_<sortable timestamp>.mid — the REAPER import script
// (Resonote_Import.lua) sorts by this filename to find the newest export.
export function midiFilename(kind) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const safe = String(kind).replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `resonote_${safe}_${stamp}.mid`;
}

export function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
