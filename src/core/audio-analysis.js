// ── Audio analysis engine (REAPER → Resonote direction) ─────────────
// Analyzes a rendered/recorded audio file: tempo, key, and a monophonic
// note line. Pure JS port of the numpy pipeline that was validated
// against Kevin's Stand-by-Me guitar take (autocorrelation pitch
// tracking + spectral-flux tempo + Krumhansl chroma key estimate).
// Chunked with awaits so the UI stays responsive; no dependencies.

import { NOTES } from './music-theory.js';

// ── minimal iterative radix-2 complex FFT ────────────────────────────
const _twiddles = new Map();
function fft(re, im, invert = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const key = len * (invert ? -1 : 1);
    let tw = _twiddles.get(key);
    if (!tw) {
      tw = { c: new Float64Array(len / 2), s: new Float64Array(len / 2) };
      const ang = (2 * Math.PI / len) * (invert ? 1 : -1);
      for (let k = 0; k < len / 2; k++) { tw.c[k] = Math.cos(ang * k); tw.s[k] = Math.sin(ang * k); }
      _twiddles.set(key, tw);
    }
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * tw.c[k] - im[i + k + len / 2] * tw.s[k];
        const vi = re[i + k + len / 2] * tw.s[k] + im[i + k + len / 2] * tw.c[k];
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

const KRUMHANSL_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return num / (Math.sqrt(da * db) || 1);
}

export function midiName(m) { return NOTES[m % 12] + (Math.floor(m / 12) - 1); }

// decode any audio file the browser understands → mono Float64Array
export async function decodeToMono(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const n = buf.length, ch = buf.numberOfChannels;
    const mono = new Float64Array(n);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
    }
    return { samples: mono, sr: buf.sampleRate, duration: buf.duration };
  } finally {
    ctx.close?.();
  }
}

const yieldNow = () => new Promise(r => setTimeout(r, 0));

// Full analysis. onProgress(frac 0..1, label) keeps the pedal UI honest.
export async function analyzeAudio(samples, sr, onProgress = () => {}) {
  const N = samples.length;

  // ── pass B: STFT 2048/512 → chroma + spectral flux (tempo) ─────────
  const win = 2048, hop = 512;
  const w = hann(win);
  const frames = Math.max(0, Math.floor((N - win) / hop));
  const chroma = new Float64Array(12);
  const flux = new Float64Array(frames);
  let prevMag = null;
  const binFreq = sr / win;
  const pcOfBin = new Int8Array(win / 2 + 1).fill(-1);
  for (let b = 1; b <= win / 2; b++) {
    const f = b * binFreq;
    if (f > 70 && f < 2200) pcOfBin[b] = ((Math.round(12 * Math.log2(f / 440)) + 9) % 12 + 12) % 12;
  }
  {
    const re = new Float64Array(win), im = new Float64Array(win);
    for (let fi = 0; fi < frames; fi++) {
      const off = fi * hop;
      for (let i = 0; i < win; i++) { re[i] = samples[off + i] * w[i]; im[i] = 0; }
      fft(re, im);
      const mag = new Float64Array(win / 2 + 1);
      for (let b = 0; b <= win / 2; b++) mag[b] = Math.hypot(re[b], im[b]);
      let fl = 0;
      for (let b = 0; b <= win / 2; b++) {
        if (prevMag) { const d = mag[b] - prevMag[b]; if (d > 0) fl += d; }
        const pc = pcOfBin[b];
        if (pc >= 0) chroma[pc] += mag[b];
      }
      flux[fi] = fl;
      prevMag = mag;
      if (fi % 80 === 0) { onProgress(0.45 * (fi / frames), 'spectrum'); await yieldNow(); }
    }
  }

  // tempo from flux autocorrelation (55–180 BPM, half/double reported)
  const fps = sr / hop;
  const med = [...flux].sort((a, b) => a - b)[Math.floor(frames / 2)] || 0;
  const fl2 = flux.map(v => Math.max(0, v - med));
  const lagLo = Math.round((60 * fps) / 180), lagHi = Math.round((60 * fps) / 55);
  let bestLag = lagLo, bestVal = -1;
  for (let lag = lagLo; lag <= Math.min(lagHi, frames - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += fl2[i] * fl2[i + lag];
    if (s > bestVal) { bestVal = s; bestLag = lag; }
  }
  const bpm = (60 * fps) / bestLag;

  // key candidates from normalized chroma
  let csum = 0;
  for (let i = 0; i < 12; i++) csum += chroma[i];
  const chromaN = [...chroma].map(v => v / (csum || 1));
  const keys = [];
  for (const [mode, prof] of [['Major', KRUMHANSL_MAJ], ['Minor', KRUMHANSL_MIN]]) {
    for (let t = 0; t < 12; t++) {
      const rolled = prof.map((_, i) => prof[((i - t) % 12 + 12) % 12]);
      keys.push({ root: NOTES[t], mode, score: corr(chromaN, rolled) });
    }
  }
  keys.sort((a, b) => b.score - a.score);
  onProgress(0.5, 'key');
  await yieldNow();

  // ── pass A: monophonic pitch track (autocorr via 8192 FFT) ─────────
  const pwin = 4096, phop = 1024, fftN = 8192;
  const pw = hann(pwin);
  const pframes = Math.max(0, Math.floor((N - pwin) / phop));
  const lmin = Math.max(2, Math.floor(sr / 900)), lmax = Math.min(fftN / 2 - 1, Math.ceil(sr / 70));
  const track = new Array(pframes).fill(null);
  {
    const re = new Float64Array(fftN), im = new Float64Array(fftN);
    for (let fi = 0; fi < pframes; fi++) {
      const off = fi * phop;
      let rms = 0, mean = 0;
      for (let i = 0; i < pwin; i++) mean += samples[off + i];
      mean /= pwin;
      for (let i = 0; i < pwin; i++) { const v = samples[off + i] - mean; rms += v * v; }
      rms = Math.sqrt(rms / pwin);
      if (rms < 0.01) { if (fi % 60 === 0) { onProgress(0.5 + 0.45 * (fi / pframes), 'pitch'); await yieldNow(); } continue; }
      re.fill(0); im.fill(0);
      for (let i = 0; i < pwin; i++) re[i] = (samples[off + i] - mean) * pw[i];
      fft(re, im);
      for (let i = 0; i < fftN; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
      fft(re, im, true);                                  // → autocorrelation in re[]
      const r0 = re[0] || 1e-12;
      let bl = lmin, bv = -Infinity;
      for (let l = lmin; l <= lmax; l++) if (re[l] > bv) { bv = re[l]; bl = l; }
      const clarity = bv / r0;
      if (clarity > 0.55) {
        const midi = Math.round(69 + 12 * Math.log2(sr / bl / 440));
        if (midi >= 36 && midi <= 90) track[fi] = midi;
      }
      if (fi % 60 === 0) { onProgress(0.5 + 0.45 * (fi / pframes), 'pitch'); await yieldNow(); }
    }
  }

  // segment the track into note events (≥ 70 ms)
  const events = [];
  let cur = null, t0 = 0;
  for (let i = 0; i <= pframes; i++) {
    const m = i < pframes ? track[i] : null;
    const t = (i * phop) / sr;
    if (m !== cur) {
      if (cur !== null && t - t0 >= 0.07) events.push({ midi: cur, t: +t0.toFixed(3), dur: +(t - t0).toFixed(3) });
      cur = m; t0 = t;
    }
  }

  // duration-weighted pitch-class histogram from the note line
  const pcHist = new Float64Array(12);
  let pcSum = 0;
  for (const e of events) { pcHist[e.midi % 12] += e.dur; pcSum += e.dur; }
  const pcNorm = [...pcHist].map(v => v / (pcSum || 1));

  onProgress(1, 'done');
  return {
    bpm: +bpm.toFixed(1),
    bpmAlts: [+(bpm / 2).toFixed(1), +(bpm * 2).toFixed(1)],
    keys: keys.slice(0, 4).map(k => ({ ...k, score: +k.score.toFixed(2) })),
    chroma: chromaN.map(v => +v.toFixed(4)),
    pcHist: pcNorm.map(v => +v.toFixed(4)),
    events,
    range: events.length
      ? { lo: Math.min(...events.map(e => e.midi)), hi: Math.max(...events.map(e => e.midi)) }
      : null,
  };
}
