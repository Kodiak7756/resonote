// ── 🎤 Strum check — did every string of the chord actually ring? ─────
// The tuner hears ONE note. A chord is six at once, and the thing a learner
// needs to know is not "what chord was that" (they know — it's the one on the
// screen) but "which string didn't make it": the B string a finger is leaning
// on, the high E the palm is muting, the low E that rang in a D chord.
//
// So this never tries to recognise a chord. It knows exactly which pitch each
// string SHOULD make, and asks a much easier question of each one: is that
// pitch in the spectrum, and is it more than the other strings' overtones can
// explain?
//
// The overtone part is the whole difficulty. In an open E chord the low E's
// 2nd harmonic IS the D string's note, its 3rd IS the open B, its 4th IS the
// high E. Look for "is there energy at 330 Hz" and the high E always rings,
// muted or not. So the whole strum is explained at once:
//   · every string's partials (fundamental + harmonics) are listed, and
//     partials too close to tell apart are measured together
//   · all strings share one overtone envelope (same pick spot, same pickup)
//     fitted to the strum, with one loudness per string
//   · a string's evidence is how much worse that explanation gets without it
// A string that rang leaves energy nothing else accounts for; a muted one
// doesn't. A string whose note is ALSO a lower string's overtone ("masked":
// the D, B and high E of an open E chord) is the hard case: its evidence is
// thinner, so it has its own bars and is the least certain verdict.
//
// Pipeline (all of it dependency-free and testable offline):
//   createStitcher     — rebuilds a continuous signal from the input's
//                        AnalyserNode snapshots (audio.js owns the node; this
//                        only ever reads it)
//   createStrumDetector— waits for an attack, then collects a short window
//   analyseStrum       — the per-string judgement on that window
//   strumTip           — one plain sentence about what to fix
//   startStrumCheck    — the live wiring on top of `audio`
import { NOTES } from './music-theory.js';
import { fft, hann } from './audio-analysis.js';
import { audio } from './audio.js';

export const STRUM_OPTS = {
  // Analysis starts this long after the attack: past the pick click, and late
  // enough that a normal strum has reached every string.
  delayMs: 45,
  // ~0.34 s of signal → ~3 Hz resolution, which is what separates a low E's
  // overtones from the A string's when they sit a semitone apart.
  windowSec: 0.34,
  hopSec: 0.005,
  // A hop this many times louder than the last ~120 ms is a new strum.
  attackRatio: 4,
  // Partials are listed up to here; above it a pickup is rolling off and
  // the partials of six strings crowd into one smear.
  fMax: 3500,
  // How far a string may be out of tune and still be "that note".
  tolCents: 32,
  // Two partials closer than this cannot be told apart.
  collideCents: 45,
  // String stiffness (inharmonicity B) to allow for when listing partials.
  // 0 = plain k·f0: the ±tolCents band already covers a guitar string's
  // stretch up to about its 15th partial, and widening ranges further merged
  // partials that should stay apart (it tested worse even on stiff strings).
  maxStiffness: 0,
  // A partial has to clear the local noise floor by this factor to count.
  floorK: 3,
  // A string counts as heard when the whole-strum fit gets this much worse
  // without it (summed squared log-misfit) AND its level, in dB against the
  // typical string of this strum, clears the bar. Should-be-silent strings
  // must clear higher bars: telling someone a string rang when it didn't is
  // the worse mistake.
  needErr: 4,         missDb: -19,
  extraErr: 10,       extraDb: -13,
  extraMaskedErr: 12, extraMaskedDb: -6,
  // A masked string is called missing only when its evidence is under
  // maskedErr AND either putting it back at a normal level makes the fit
  // worse by more than maskedAbsent, or it is quieter than maskedDb.
  // (Set with the offline harness: ~2-3% false "didn't ring" per masked
  // string, and ~55-75% of really-missing masked strings caught.)
  maskedErr: 5,       maskedAbsent: 1,  maskedDb: -14,
  // "A normal level" for that test: within ±levelSpan dB of the clear strings.
  levelSpan: 8,
};

// ── names ────────────────────────────────────────────────────────────
const NOTE_RE = /^([A-G](?:#|b)?)(-?\d)$/;
const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

export function toMidi(t) {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const m = NOTE_RE.exec(t.trim());
    if (!m) return NaN;
    return NOTES.indexOf(FLAT[m[1]] || m[1]) + 12 * (Number(m[2]) + 1);
  }
  if (t && t.note != null) return NOTES.indexOf(FLAT[t.note] || t.note) + 12 * (Number(t.octave) + 1);
  return NaN;
}
const midiNote   = m => NOTES[((m % 12) + 12) % 12];
const midiOctave = m => Math.floor(m / 12) - 1;
const midiHz     = m => 440 * Math.pow(2, (m - 69) / 12);

// "low E", "A", "D", "G", "B", "high E" — what a teacher calls the strings.
// A letter that appears twice (both E's, drop-D's two D's) gets low/high.
export function stringNames(tuningMidi) {
  const pcs = tuningMidi.map(midiNote);
  return tuningMidi.map((m, i) => {
    const same = pcs.map((p, j) => (p === pcs[i] ? j : -1)).filter(j => j >= 0);
    if (same.length < 2) return pcs[i];
    if (i === same[0]) return 'low ' + pcs[i];
    if (i === same[same.length - 1]) return 'high ' + pcs[i];
    return 'middle ' + pcs[i];
  });
}

// frets: low→high per string, a number or 'x' (also -1 / null) for muted.
// tuning: low→high, MIDI numbers, 'E2' strings or {note, octave}.
export function planStrum(frets, tuning) {
  const tm = tuning.map(toMidi);
  const names = stringNames(tm);
  const strings = tm.map((open, i) => {
    const f = frets[i];
    const muted = f == null || f === 'x' || f === 'X' || f < 0;
    const midi = muted ? null : open + Number(f);
    return {
      string: i, name: names[i], open, fret: muted ? 'x' : Number(f), expected: !muted,
      midi, note: muted ? null : midiNote(midi), octave: muted ? null : midiOctave(midi),
    };
  });
  return { strings, tuning: tm };
}

// ── spectrum helpers ─────────────────────────────────────────────────
const _hann = new Map();
function hannOf(n) { let w = _hann.get(n); if (!w) { w = hann(n); _hann.set(n, w); } return w; }

export function windowLen(sr, sec = STRUM_OPTS.windowSec) {
  return Math.pow(2, Math.round(Math.log2(sec * sr)));
}

// Magnitude spectrum of samples[start, start+n), Hann-windowed and zero-padded
// ×2 so a peak can be found between bins. Scaled to sinusoid amplitude.
function spectrum(samples, start, n, sr) {
  const w = hannOf(n), m = n * 2;
  const re = new Float64Array(m), im = new Float64Array(m);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[start + i] || 0;
  mean /= n;
  let wsum = 0;
  for (let i = 0; i < n; i++) { re[i] = ((samples[start + i] || 0) - mean) * w[i]; wsum += w[i]; }
  fft(re, im);
  const half = m / 2, mag = new Float64Array(half + 1), k = 2 / wsum;
  for (let b = 0; b <= half; b++) mag[b] = Math.hypot(re[b], im[b]) * k;
  const s = { mag, sr, binHz: sr / m, resHz: sr / n, n };
  s.floor = floorCurve(s);
  return s;
}

// Local noise floor: a low percentile of each third-octave band, so the peaks
// in it don't drag it up. Interpolated in log-frequency between band centres.
function floorCurve(s) {
  const pts = [];
  for (let fc = 40; fc < Math.min(8000, s.sr * 0.45); fc *= Math.pow(2, 1 / 12)) {
    const lo = Math.max(1, Math.floor(fc / Math.pow(2, 1 / 6) / s.binHz));
    const hi = Math.min(s.mag.length - 1, Math.ceil(fc * Math.pow(2, 1 / 6) / s.binHz));
    const band = Array.from(s.mag.subarray(lo, hi + 1)).sort((a, b) => a - b);
    pts.push([Math.log2(fc), band[Math.floor(band.length * 0.3)] || 1e-12]);
  }
  return f => {
    const lf = Math.log2(f);
    if (lf <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (lf <= pts[i][0]) {
        const t = (lf - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return Math.exp(Math.log(pts[i - 1][1]) * (1 - t) + Math.log(pts[i][1]) * t);
      }
    }
    return pts[pts.length - 1][1];
  };
}

// Biggest peak within ±tol cents of f (never narrower than ±0.75 of a bin).
function peakAt(s, f, tolCents) {
  const span = Math.max(f * (Math.pow(2, tolCents / 1200) - 1), s.resHz * 0.75);
  const lo = Math.max(1, Math.floor((f - span) / s.binHz));
  const hi = Math.min(s.mag.length - 2, Math.ceil((f + span) / s.binHz));
  let best = lo;
  for (let b = lo; b <= hi; b++) if (s.mag[b] > s.mag[best]) best = b;
  const a = Math.log(s.mag[best - 1] + 1e-15), c = Math.log(s.mag[best] + 1e-15), d = Math.log(s.mag[best + 1] + 1e-15);
  const den = a - 2 * c + d;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - d) / den)) : 0;
  return { amp: Math.exp(c - 0.25 * (a - d) * off), freq: (best + off) * s.binHz };
}

// ── the shared envelope ──────────────────────────────────────────────
// Every string in a strum is picked at about the same spot and heard through
// the same pickup, and both of those carve the same comb into each string's
// overtones — scaled by how much of the string is vibrating (a string fretted
// at f is 2^(-f/12) as long, so the same pick spot sits further along it).
// Partial k of a string with length factor lam = 2^(f/12):
//   |sin(π·k·beta·lam)| · |sin(π·k·p·lam)|^m · k^-gamma
//   beta = pick spot, p = pickup spot (m = 0: no pickup — a piezo or a mic),
//   gamma = how bright the pick and pickup are.
// Those few numbers are fitted to the whole strum, so a low string's 2nd
// harmonic is predicted from what the strum as a whole says about overtones,
// not from a guess.
const COMB_FLOOR = 0.12;
function templ(k, lam, th) {
  const c1 = Math.max(COMB_FLOOR, Math.abs(Math.sin(Math.PI * k * th.beta * lam)));
  const c2 = th.m ? Math.max(COMB_FLOOR, Math.abs(Math.sin(Math.PI * k * th.p * lam))) : 1;
  return c1 * c2 * Math.pow(k, -th.gamma);
}
const GRID = [];
for (let beta = 0.06; beta <= 0.4001; beta += 0.02) {
  for (const gamma of [0, 0.5, 1, 1.5, 2]) {
    GRID.push({ beta, p: 0, m: 0, gamma });
    for (let p = 0.04; p <= 0.3001; p += 0.02) GRID.push({ beta, p, m: 1, gamma });
  }
}

// Non-negative least squares by coordinate descent: a handful of unknowns
// (one loudness per string), so this converges in a few dozen sweeps.
// `zero` pins one voice at 0 — the "that string didn't ring" hypothesis.
function nnls(M, P, W, nv, zero = -1, box = null) {
  const A = new Float64Array(nv * nv), b = new Float64Array(nv), x = new Float64Array(nv);
  for (let c = 0; c < M.length; c++) {
    const row = M[c], w = W[c];
    for (let i = 0; i < nv; i++) {
      if (!row[i]) continue;
      b[i] += w * row[i] * P[c];
      for (let j = 0; j < nv; j++) A[i * nv + j] += w * row[i] * row[j];
    }
  }
  for (let sweep = 0; sweep < 80; sweep++) {
    let moved = 0;
    for (let i = 0; i < nv; i++) {
      const aii = A[i * nv + i];
      if (i === zero || aii <= 0) { x[i] = 0; continue; }
      let g = b[i];
      for (let j = 0; j < nv; j++) if (j !== i) g -= A[i * nv + j] * x[j];
      let nx = Math.max(0, g / aii);
      if (box && i === box.i) nx = Math.min(box.hi, Math.max(box.lo, nx));
      moved = Math.max(moved, Math.abs(nx - x[i]) / (Math.abs(nx) + 1e-30));
      x[i] = nx;
    }
    if (moved < 1e-6) break;
  }
  return x;
}
// …and with one voice held inside [lo, hi] — "that string rang at a normal level".
const nnlsBox = (M, P, W, nv, i, lo, hi) => nnls(M, P, W, nv, -1, { i, lo, hi });
// Misfit in log terms, so a quiet partial counts as much as a loud one.
function logErr(M, x, P, F2, Q) {
  let e = 0;
  for (let c = 0; c < M.length; c++) {
    let m = 0;
    for (let v = 0; v < x.length; v++) m += M[c][v] * x[v];
    const d = Math.log(m + F2[c]) - Math.log(P[c] + F2[c]);
    e += Q[c] * d * d;
  }
  return e;
}

// Power in each cluster's band (everywhere its partials could be, plus the
// window's spread) — steadier than one peak when two strings' partials sit
// inside the same bin and beat against each other.
function clusterPowers(s, clusters, tolCents) {
  const tl = Math.pow(2, -tolCents / 1200), th = Math.pow(2, tolCents / 1200);
  return clusters.map(cl => {
    const b0 = Math.max(1, Math.floor((cl.fLo * tl - 1.5 * s.resHz) / s.binHz));
    const b1 = Math.min(s.mag.length - 1, Math.ceil((cl.fHi * th + 1.5 * s.resHz) / s.binHz));
    const fl = s.floor(cl.fLo);
    let e = 0;
    for (let b = b0; b <= b1; b++) e += s.mag[b] * s.mag[b];
    // a Hann window, zero-padded ×2, spreads a sinusoid of amplitude A over
    // bins whose squared magnitudes sum to 3·A²
    return { P: Math.max(0, e - (b1 - b0 + 1) * fl * fl) / 3, floor: fl };
  });
}

// ── the per-string judgement ─────────────────────────────────────────
// samples: a mono signal that starts at the strum attack (≥ delay + window long).
export function analyseStrum(samples, sr, frets, tuning, opts = {}) {
  const o = { ...STRUM_OPTS, ...opts };
  const plan = planStrum(frets, tuning);
  const n = windowLen(sr, o.windowSec);
  const delay = Math.round(o.delayMs / 1000 * sr);
  const spec = spectrum(samples, delay, n, sr);

  // Voices: one per distinct expected pitch (two strings in unison can't be
  // told apart, so they share a verdict), plus each muted string's open note —
  // the sound a "should be silent" string makes when it rings anyway. A muted
  // string whose open note is already in the chord can't be heard separately
  // and is left alone: it isn't changing what the chord sounds like.
  const voices = [];
  plan.strings.filter(s => s.expected).forEach(s => {
    const v = voices.find(x => x.midi === s.midi);
    if (v) v.strings.push(s.string);
    else voices.push({ midi: s.midi, kind: 'expected', strings: [s.string], lam: Math.pow(2, s.fret / 12) });
  });
  plan.strings.filter(s => !s.expected).forEach(s => {
    if (voices.some(x => x.midi === s.open)) return;
    voices.push({ midi: s.open, kind: 'extra', strings: [s.string], lam: 1 });
  });
  voices.sort((a, b) => a.midi - b.midi);
  const nv = voices.length;
  if (!voices.some(v => v.kind === 'expected')) {
    return { strings: plan.strings.map(s => ({ ...s, midi: s.open, note: midiNote(s.open), octave: midiOctave(s.open), status: 'muted', level: null, sure: false })),
             frets: plan.strings.map(s => s.fret), ok: false, heard: 0, want: 0, unclear: true, tuningCents: 0, fit: null, voices: [], tip: '' };
  }

  // A whole-guitar tuning offset (tuned to itself, a little flat) moves every
  // partial together. Find it from the strongest peaks near the expected
  // fundamentals and 2nd/3rd partials; the strings are judged around it.
  const devs = [];
  voices.filter(v => v.kind === 'expected').forEach(v => {
    for (let k = 1; k <= 3; k++) {
      const f = k * midiHz(v.midi);
      const p = peakAt(spec, f, 50);
      const snr = p.amp / spec.floor(f);
      if (snr > 6) devs.push({ c: 1200 * Math.log2(p.freq / f), w: Math.log(snr) });
    }
  });
  let offset = 0;
  if (devs.length >= 3) {
    devs.sort((a, b) => a.c - b.c);
    const tot = devs.reduce((t, d) => t + d.w, 0);
    let acc = 0;
    for (const d of devs) { acc += d.w; if (acc >= tot / 2) { offset = d.c; break; } }
    offset = Math.max(-40, Math.min(40, offset));
  }
  const tuneK = Math.pow(2, offset / 1200);

  // Every partial of every voice up to fMax — ALL of them, not the first few:
  // the low E's 14th partial sits on the D string's 7th, and leaving it out
  // hands the D string evidence it never earned.
  // A real string is a little stiff, so its partials run sharp of k·f0 —
  // by sqrt(1 + B·k²), B up to ~1.5e-4 on a guitar, and more on a shorter
  // (fretted) string — so a partial is a RANGE, narrow at the bottom and wider
  // up high. Partials whose ranges come closer than the analysis can separate
  // become one cluster, measured once and owned by all of them.
  const fTop = Math.min(o.fMax, sr * 0.45);
  const parts = [];
  voices.forEach((v, vi) => {
    v.parts = [];
    const f0 = midiHz(v.midi) * tuneK, B = o.maxStiffness * v.lam * v.lam;
    for (let k = 1; k * f0 <= fTop; k++) {
      const p = { v: vi, k, lo: k * f0, hi: k * f0 * Math.sqrt(1 + B * k * k), c: -1 };
      v.parts.push(p); parts.push(p);
    }
  });
  const gap = f => Math.max(f * (Math.pow(2, o.collideCents / 1200) - 1), 2 * spec.resHz);
  const clusters = [];
  parts.slice().sort((a, b) => a.lo - b.lo).forEach(p => {
    const last = clusters[clusters.length - 1];
    if (last && p.lo - last.fHi < gap(p.lo)) { last.members.push(p); last.fHi = Math.max(last.fHi, p.hi); }
    else clusters.push({ members: [p], fLo: p.lo, fHi: p.hi });
  });
  clusters.forEach((cl, ci) => {
    cl.members.forEach(p => { p.c = ci; });
    cl.kmin = Math.min(...cl.members.map(p => p.k));
  });
  const meas = clusterPowers(spec, clusters, o.tolCents);
  // a voice is "masked" when its fundamental is a lower voice's overtone
  voices.forEach(v => { v.masked = clusters[v.parts[0].c].members.some(p => voices[p.v].midi < v.midi); });

  const P = meas.map(m => m.P);
  const F2 = meas.map(m => Math.pow(o.floorK * m.floor, 2));
  const Q = clusters.map(c => 1 / (1 + 0.15 * (c.kmin - 1)));        // low partials count most
  const W = clusters.map((c, i) => Q[i] / Math.pow(P[i] + F2[i], 2)); // relative error
  const Ms = GRID.map(th => clusters.map(cl => {
    const row = new Float64Array(nv);
    cl.members.forEach(p => { const e = templ(p.k, voices[p.v].lam, th); row[p.v] += e * e; });
    return row;
  }));

  // Fit the envelope: every candidate shape, loudnesses solved for each,
  // keep whichever explains the spectrum best.
  let best = null;
  GRID.forEach((th, gi) => {
    const x = nnls(Ms[gi], P, W, nv);
    const err = logErr(Ms[gi], x, P, F2, Q);
    if (!best || err < best.err) best = { th, M: Ms[gi], x, err };
  });

  // A voice's evidence is how much worse the fit gets without it: a string
  // that rang leaves energy nothing else can account for. A masked voice gets
  // the envelope re-fitted without it too — "no D string, and a low E whose
  // 2nd harmonic is just loud" has to lose fairly, or it would always ring.
  voices.forEach((v, vi) => {
    if (v.masked) {
      let e = Infinity;
      Ms.forEach(M => { e = Math.min(e, logErr(M, nnls(M, P, W, nv, vi), P, F2, Q)); });
      v.evidence = e - best.err;
      v.errWithout = e;
    } else {
      v.evidence = logErr(best.M, nnls(best.M, P, W, nv, vi), P, F2, Q) - best.err;
    }
    let e = 0;
    v.parts.forEach(p => { const t = templ(p.k, v.lam, best.th); e += t * t; });
    v.S = Math.sqrt(best.x[vi] * e);
  });
  // Evidence of ABSENCE, for masked voices: hold the voice at a normal
  // strum level (±levelSpan dB around the clearly-heard strings) and see how
  // much worse that fits than leaving it out. A string that rang but was
  // swallowed by the fit costs nothing to put back; one that didn't ring does.
  const energy = (v, th) => { let e = 0; v.parts.forEach(p => { const t = templ(p.k, v.lam, th); e += t * t; }); return e; };
  const solid = voices.filter(v => v.kind === 'expected' && !v.masked && v.evidence > o.needErr).map(v => v.S).sort((a, b) => a - b);
  const sRef = solid.length ? solid[Math.floor(solid.length / 2)] : 0;
  voices.forEach((v, vi) => {
    v.absence = 0;
    if (!v.masked || !(sRef > 0)) return;
    let e1 = Infinity;
    GRID.forEach((th, gi) => {
      const E = energy(v, th);
      const lo = Math.pow(sRef * Math.pow(10, -o.levelSpan / 20), 2) / E, hi = Math.pow(sRef * Math.pow(10, o.levelSpan / 20), 2) / E;
      e1 = Math.min(e1, logErr(Ms[gi], nnlsBox(Ms[gi], P, W, nv, vi, lo, hi), P, F2, Q));
    });
    v.absence = e1 - v.errWithout;
  });

  // Loudness is judged against the typical string in this strum, not an
  // absolute level — a soft strum and a hard one should read the same.
  const exp = voices.filter(v => v.kind === 'expected');
  const sorted = exp.map(v => v.S).sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 2 / 3)));
  const ref = Math.max(top[Math.floor(top.length / 2)] || 0, (sorted[0] || 0) * 0.3, 1e-12);
  voices.forEach(v => {
    v.rel = 20 * Math.log10(Math.max(v.S, 1e-15) / ref);
    if (v.kind === 'expected') {
      v.heard = v.masked
        ? !(v.evidence < o.maskedErr && (v.absence > o.maskedAbsent || v.rel < o.maskedDb))
        : v.evidence > o.needErr && v.rel > o.missDb;
      v.status = v.heard ? 'rang' : 'missing';
    } else {
      v.heard = v.masked ? v.evidence > o.extraMaskedErr && v.rel > o.extraMaskedDb
                         : v.evidence > o.extraErr && v.rel > o.extraDb;
      v.status = v.heard ? 'extra' : 'muted';
    }
  });
  // No separate "buzzed" verdict: a buzzing or choked string has little pitch
  // left by the time the window opens, so it reads as "didn't ring", and that
  // tip (press right behind the fret / arch the finger) covers it.

  const strings = plan.strings.map(s => {
    const v = voices.find(x => x.strings.includes(s.string));
    const out = { string: s.string, name: s.name, fret: s.fret, expected: s.expected, open: s.open,
                  midi: s.expected ? s.midi : s.open, note: s.expected ? s.note : midiNote(s.open),
                  octave: s.expected ? s.octave : midiOctave(s.open) };
    if (!v) return { ...out, status: 'muted', level: null, sure: false };
    return { ...out, status: v.status, level: Math.round(v.rel * 10) / 10,
             // a verdict about a string whose note is another string's overtone
             // leans on the fitted envelope rather than on a peak of its own
             sure: !v.masked, unison: v.strings.length > 1 };
  });
  const heard = strings.filter(s => s.expected && s.status !== 'missing').length;
  const want = strings.filter(s => s.expected).length;
  const result = {
    strings, frets: plan.strings.map(s => s.fret),
    ok: strings.every(s => s.status === 'rang' || s.status === 'muted'),
    heard, want,
    // Next to nothing of the chord: a single note, a different chord, a knock.
    unclear: want >= 2 && heard < Math.min(2, want),
    tuningCents: Math.round(offset),
    // what the fit saw, for tuning and for anyone curious
    fit: { pick: +best.th.beta.toFixed(2), pickup: best.th.m ? +best.th.p.toFixed(2) : null, tilt: best.th.gamma },
    voices: voices.map(v => ({ midi: v.midi, kind: v.kind, masked: v.masked, status: v.status,
                               evidence: +v.evidence.toFixed(2), absence: +v.absence.toFixed(2), level: +v.rel.toFixed(1) })),
  };
  result.tip = strumTip(result);
  return result;
}

// ── one plain sentence, the way a teacher would say it ───────────────
export function strumTip(res) {
  const ss = res.strings;
  const the = s => `The ${s.name} string`;
  const played = ss.filter(s => s.expected);
  if (!played.length) return '';
  if (res.unclear) return `That didn't sound like this chord yet. Fret the shape shown and strum through every string with a dot.`;
  const fretted = s => s && s.expected && s.fret > 0;
  const lowest = played[0];
  const minFret = Math.min(...played.filter(fretted).map(s => s.fret));
  const barre = played.filter(s => fretted(s) && s.fret === minFret).length >= 3;
  // the finger fretting the next-thicker string lies across this one
  const leaner = s => { const t = ss[s.string - 1]; return fretted(t) ? t : null; };

  const missing = ss.filter(s => s.status === 'missing');
  const extra = ss.filter(s => s.status === 'extra');
  const more = n => (n > 1 ? ` (${n - 1} more string${n > 2 ? 's' : ''} didn't ring either.)` : '');

  if (missing.length) {
    const s = missing[0];
    let fix;
    if (s === lowest && s.fret === 0) fix = `Start your strum on the ${s.name} string.`;
    else if (s === lowest) fix = `Start your strum on it, and press it with your fingertip right behind the fret.`;
    else if (fretted(s) && barre && s.fret === minFret) fix = `Roll your first finger slightly onto its bony edge so it presses the ${s.name} string firmly.`;
    else if (fretted(s) && leaner(s)) fix = `Press it on your fingertip, right behind the fret, and arch the finger on the ${leaner(s).name} string so it doesn't touch it.`;
    else if (fretted(s)) fix = `Press it on your fingertip, right behind the fret.`;
    else if (leaner(s)) fix = `Arch the finger on the ${leaner(s).name} string so it doesn't touch it.`;
    else fix = `Arch your fingers so nothing rests on it${s.string === ss.length - 1 ? ', and keep your palm off it' : ''}.`;
    return `${the(s)} didn't ring. ${fix}${more(missing.length)}`;
  }
  if (extra.length) {
    const s = extra[0];
    if (s.string < lowest.string) return `${the(s)} rang, but it shouldn't. Start your strum on the ${lowest.name} string.`;
    return `${the(s)} rang, but it shouldn't. Let a fretting finger lightly touch it to keep it quiet.`;
  }
  return `Every string rang. Clean!`;
}

// ── attack → window ──────────────────────────────────────────────────
// Feed it the input in any chunk size. It watches short hops of energy; a hop
// that jumps well above the last ~120 ms starts a capture, and once
// delay + window samples are in, `analyse(segment)` runs on them.
export function createStrumDetector({ sampleRate, analyse, onAttack, onResult,
                                      floorRms = () => 0.002, opts = {} }) {
  const o = { ...STRUM_OPTS, ...opts };
  const hop = Math.max(64, Math.round(o.hopSec * sampleRate));
  const need = Math.round(o.delayMs / 1000 * sampleRate) + windowLen(sampleRate, o.windowSec);
  const hist = new Float64Array(Math.max(8, Math.round(0.12 * sampleRate / hop)));
  const hb = new Float32Array(hop);
  let hi = 0, filled = 0, hf = 0, cap = null, cf = 0;

  function onHop() {
    let e = 0;
    for (let i = 0; i < hop; i++) e += hb[i] * hb[i];
    e /= hop;
    if (!cap && filled >= 4) {
      let bg = 0;
      for (let i = 0; i < filled; i++) bg += hist[i];
      bg /= filled;
      const fl = floorRms();
      if (e > o.attackRatio * bg + 1e-12 && e > fl * fl) {
        cap = new Float32Array(need);
        cap.set(hb);
        cf = hop;
        onAttack?.();
      }
    }
    hist[hi] = e; hi = (hi + 1) % hist.length; if (filled < hist.length) filled++;
  }

  return {
    feed(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const x = chunk[i];
        if (cap) {
          cap[cf++] = x;
          if (cf >= need) { const seg = cap; cap = null; onResult?.(analyse(seg)); }
        }
        hb[hf++] = x;
        if (hf === hop) { onHop(); hf = 0; }
      }
    },
    // a gap in the input (tab in the background, device switch) breaks a capture
    reset() { cap = null; cf = 0; hf = 0; filled = 0; hi = 0; },
    get capturing() { return !!cap; },
  };
}

// ── AnalyserNode snapshots → one continuous signal ───────────────────
// getFloatTimeDomainData hands back the latest fftSize samples, whenever it is
// asked. Polled faster than the buffer turns over, consecutive snapshots
// overlap; the overlap is found by exact sample match (they are copies of the
// same samples), with the audio clock as the tie-breaker — and as the only
// guide through digital silence, where every shift matches.
export function createStitcher() {
  let prev = null, prevT = 0;
  const same = (a, b, s) => {
    const n = a.length - s;
    for (let j = 0; j < 12; j++) { const i = Math.floor((j + 0.5) * n / 12); if (a[s + i] !== b[i]) return false; }
    for (let i = 0; i < n; i++) if (a[s + i] !== b[i]) return false;
    return true;
  };
  return {
    reset() { prev = null; },
    // → { samples, gap }  (samples: what's new since the last call)
    pull(buf, t, sr) {
      const n = buf.length;
      if (!prev || prev.length !== n) { prev = Float32Array.from(buf); prevT = t; return { samples: new Float32Array(0), gap: true }; }
      const want = Math.round((t - prevT) * sr);
      let quiet = true;
      for (let i = 0; i < n; i += 7) if (buf[i] !== 0 || prev[i] !== 0) { quiet = false; break; }
      let s = -1;
      if (quiet) s = Math.max(0, Math.min(n, Math.round(want / 128) * 128));
      else {
        for (let c = 0; c < n; c++) {
          if (s >= 0 && Math.abs(c - want) > Math.abs(s - want)) break;
          if (same(prev, buf, c)) s = c;
        }
      }
      prevT = t;
      if (s < 0) { prev.set(buf); return { samples: Float32Array.from(buf), gap: true }; }
      const out = buf.slice(n - s);
      prev.set(buf);
      return { samples: out, gap: false };
    },
  };
}

// ── live: listen on the connected guitar input ───────────────────────
// Reads audio._analyser (the post-gain tap) and nothing else — it never
// touches the audio graph, the gain or the gate. onState gets 'listening' |
// 'checking' | 'offline'; onResult gets what analyseStrum returns.
export function startStrumCheck({ frets, tuning, onResult, onState, isAlive = () => true, opts = {} } = {}) {
  let cur = { frets, tuning }, dead = false, state = '';
  const stitch = createStitcher();
  let det = null, an = null, buf = null, sr = 0;
  const setState = s => { if (s !== state) { state = s; onState?.(s); } };

  const poll = () => {
    if (dead) return;
    if (!isAlive()) { api.stop(); return; }
    const a = audio._analyser, ctx = audio._ctx;
    if (!audio.connected || !a || !ctx) { an = null; det = null; stitch.reset(); setState('offline'); return; }
    if (a !== an) {
      an = a; sr = ctx.sampleRate; buf = new Float32Array(a.fftSize); stitch.reset();
      det = createStrumDetector({
        sampleRate: sr, opts,
        floorRms: () => Math.max(0.0005, Math.pow(10, audio.gateDb() / 20) * 0.5),
        analyse: seg => analyseStrum(seg, sr, cur.frets, cur.tuning, opts),
        onAttack: () => setState('checking'),
        onResult: r => { setState('listening'); onResult?.(r); },
      });
    }
    if (!det.capturing) setState('listening');
    a.getFloatTimeDomainData(buf);
    const { samples, gap } = stitch.pull(buf, ctx.currentTime, sr);
    if (gap) det.reset();
    if (samples.length) det.feed(samples);
  };
  const timer = setInterval(poll, 15);
  poll();

  const api = {
    stop() { if (dead) return; dead = true; clearInterval(timer); },
    setVoicing(f, t) { cur = { frets: f, tuning: t || cur.tuning }; det?.reset(); },
    get state() { return state; },
  };
  return api;
}
