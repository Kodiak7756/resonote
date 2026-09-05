// ── REAPER Bridge pedal ──────────────────────────────────────────────
// Two-way bridge between Resonote and REAPER:
//   OUT: quick MIDI exports (the Progression Studio & Backing Track pedals
//        also carry their own ⇄ Export buttons).
//   IN:  drop a REAPER render/recording → tempo, key & note breakdown
//        mapped onto a fretboard — practice-analysis as a teaching tool.
import { NOTES, getKeyChords, CHORD_TYPES } from '../core/music-theory.js';
import { customTuning } from '../core/tuning.js';
import { pedalBus, metroClock } from '../core/state.js';
import { encodeMidi, downloadMidi, midiFilename, stringFretToMidi, PPQ } from '../core/midi-writer.js';
import { decodeToMono, analyzeAudio, midiName } from '../core/audio-analysis.js';

// Markup reads the accent straight off the card. The canvas cannot — see
// resolveAccent() — so this is the token name, not a colour.
const ACC = 'var(--rk-accent)';

export function buildReaperBridgeContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let analysis = s.lastAnalysis || null;    // persisted per-pedal
  let analyzing = false;
  let fileName = s.lastFileName || '';

  // ── quick smoke-test export: I–IV–V–I in the master key ────────────
  function exportQuickTest() {
    const root = pedalBus.root || 'C';
    const keyType = pedalBus.keyType || 'Major';
    const chords = getKeyChords(root, keyType);
    const degrees = [0, 3, 4, 0];
    const triads = CHORD_TYPES['Triads'];
    const notes = [];
    degrees.forEach((deg, bar) => {
      const ch = chords[deg];
      if (!ch) return;
      const iv = triads[ch.quality] || triads.Major;
      const base = 48 + NOTES.indexOf(ch.root);
      iv.forEach(x => notes.push({ tick: bar * 4 * PPQ, note: base + x, vel: 96, dur: 4 * PPQ - 20 }));
      notes.push({ tick: bar * 4 * PPQ, note: base - 12, vel: 86, dur: 4 * PPQ - 20 });
    });
    const bpm = metroClock.bpm || 120;
    const bytes = encodeMidi({ bpm, timeSig: [4, 4], trackName: `Resonote bridge test — ${root} ${keyType}`, notes, endTick: 16 * PPQ });
    downloadMidi(bytes, midiFilename(`bridgetest-${root}-${keyType}-${bpm}bpm`));
    flash(`Exported I–IV–V–I in ${root} ${keyType} @ ${bpm} BPM — run Resonote Import in REAPER`);
  }

  function flash(text, color = ACC) {
    const m = el.querySelector('.rb-msg');
    if (!m) return;
    m.style.color = color;
    m.textContent = text;
    setTimeout(() => { if (m.isConnected && m.textContent === text) m.textContent = ''; }, 5000);
  }

  // ── analysis ────────────────────────────────────────────────────────
  async function analyzeArrayBuffer(ab, name) {
    if (analyzing) return;
    analyzing = true;
    fileName = name;
    render();
    try {
      const { samples, sr, duration } = await decodeToMono(ab);
      const res = await analyzeAudio(samples, sr, (frac, label) => {
        const bar = el.querySelector('.rb-progress-fill');
        const lab = el.querySelector('.rb-progress-label');
        if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
        if (lab) lab.textContent = `analyzing ${label}… ${Math.round(frac * 100)}%`;
      });
      res.duration = +duration.toFixed(2);
      analysis = res;
      // persist unless the note list is huge (keeps saved boards light)
      if (res.events.length <= 2000) { s.lastAnalysis = res; s.lastFileName = name; }
    } catch (err) {
      console.error('[reaper-bridge] analysis failed', err);
      analysis = { error: String(err?.message || err) };
    }
    analyzing = false;
    render();
  }

  async function analyzeFile(file) {
    const ab = await file.arrayBuffer();
    await analyzeArrayBuffer(ab, file.name);
  }

  // dev/test hook: window.__bridgeAnalyzeUrl('/test.wav')
  window.__bridgeAnalyzeUrl = async (url) => {
    const ab = await (await fetch(url)).arrayBuffer();
    await analyzeArrayBuffer(ab, url.split('/').pop());
    return analysis;
  };

  // ── render helpers ─────────────────────────────────────────────────
  function pcBarsHTML() {
    if (!analysis?.pcHist) return '';
    const max = Math.max(...analysis.pcHist, 0.0001);
    const rootPc = analysis.keys?.[0] ? NOTES.indexOf(analysis.keys[0].root) : -1;
    let h = `<div style="display:flex;gap:2px;align-items:flex-end;height:44px;margin-top:4px">`;
    for (let i = 0; i < 12; i++) {
      const v = analysis.pcHist[i];
      const hh = Math.max(2, Math.round((v / max) * 36));
      const isRoot = i === rootPc;
      h += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="width:100%;height:${hh}px;background:${isRoot ? ACC : 'var(--rk-dim)'};border-radius:2px 2px 0 0"></div>
        <span class="mono" style="font-size:calc(8px*var(--ui));color:${isRoot ? ACC : 'var(--rk-ink-mute)'}">${NOTES[i]}</span>
      </div>`;
    }
    return h + `</div>`;
  }

  function fretboardHTML() {
    if (!analysis?.pcHist) return '';
    const rootPc = analysis.keys?.[0] ? NOTES.indexOf(analysis.keys[0].root) : -1;
    const strings = customTuning;
    const fw = 300, fh = 14 * strings.length + 16, fretW = fw / 13.5;
    let svg = `<svg viewBox="0 0 ${fw} ${fh}" style="width:100%;margin-top:4px">`;
    for (let f = 0; f <= 12; f++) {
      const x = 14 + f * fretW;
      svg += `<line x1="${x}" y1="8" x2="${x}" y2="${fh - 8}" stroke="${f === 0 ? 'var(--rk-ink-mute)' : 'var(--rk-edge)'}" stroke-width="${f === 0 ? 2 : 1}"/>`;
      if ([3, 5, 7, 9, 12].includes(f)) svg += `<text x="${x - fretW / 2}" y="${fh - 1}" fill="var(--rk-ink-mute)" font-size="6" text-anchor="middle">${f}</text>`;
    }
    strings.forEach((st, si) => {
      const y = 14 + si * 14;
      svg += `<line x1="14" y1="${y}" x2="${fw - 4}" y2="${y}" stroke="var(--rk-edge)" stroke-width="1"/>`;
      for (let f = 0; f <= 12; f++) {
        const m = stringFretToMidi(si, f, strings);
        if (m == null) continue;
        const pc = m % 12;
        const wgt = analysis.pcHist[pc];
        if (wgt < 0.02) continue;
        const x = 14 + f * fretW - (f === 0 ? 7 : fretW / 2);
        const isRoot = pc === rootPc;
        const r = isRoot ? 4.4 : 3.4;
        svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${isRoot ? ACC : 'var(--rk-dim)'}" opacity="${Math.min(1, 0.35 + wgt * 3)}"/>`;
        if (isRoot) svg += `<text x="${x}" y="${y + 2}" fill="var(--rk-panel)" font-size="5.5" font-weight="700" text-anchor="middle">${NOTES[pc]}</text>`;
      }
    });
    return svg + `</svg>`;
  }

  // A canvas takes colour strings, not custom properties. Ask the browser what
  // the token currently paints as by reading it off a real element inside the
  // card — that way the piano roll follows the catalog accent like everything
  // else instead of hardcoding a second copy of it.
  function resolveAccent() {
    const host = el.querySelector('.rk') || el;
    const probe = document.createElement('span');
    probe.style.cssText = 'display:none;color:var(--rk-accent)';
    host.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }

  function drawTimeline() {
    const cv = el.querySelector('.rb-roll');
    if (!cv || !analysis?.events?.length) return;
    const ctx = cv.getContext('2d');
    const W = cv.width = cv.clientWidth * 2;
    const H = cv.height = 120;
    ctx.clearRect(0, 0, W, H);
    const dur = analysis.duration || Math.max(...analysis.events.map(e => e.t + e.dur));
    const lo = analysis.range.lo - 2, hi = analysis.range.hi + 2;
    const y = m => H - ((m - lo) / (hi - lo)) * (H - 12) - 6;
    const rootPc = analysis.keys?.[0] ? NOTES.indexOf(analysis.keys[0].root) : -1;
    // One colour, two weights: the root of the key sits at full strength and
    // everything else is the same accent held back, so the key jumps out.
    ctx.fillStyle = resolveAccent();
    for (const e of analysis.events) {
      const isRoot = e.midi % 12 === rootPc;
      ctx.globalAlpha = isRoot ? 1 : 0.55;
      ctx.fillRect((e.t / dur) * W, y(e.midi) - 2.5, Math.max(2, (e.dur / dur) * W - 1), 5);
    }
    ctx.globalAlpha = 1;
  }

  // ── render ──────────────────────────────────────────────────────────
  function render() {
    // .rk is what puts the kit tokens in scope — the .rk-section / .rk-label
    // furniture below was already asking for them.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px">`;

    // OUT
    h += `<div class="rk-section">
      <div class="rk-label">RESONOTE → REAPER <span class="rk-label-hint">exports land in Downloads</span></div>
      <div class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-dim);line-height:1.5">Progression Studio & Backing Track each have a <b style="color:var(--rk-dim)">⇄ Export</b> button. In REAPER, run the <b style="color:var(--rk-dim)">Resonote Import</b> action (Actions list) to drop the newest export at the cursor.</div>
      <button class="chord-btn rb-quicktest" style="min-height:calc(28px*var(--ui));width:100%;margin-top:5px;font-size:calc(10px*var(--ui));padding:6px;color:${ACC};border-color:var(--rk-line);background:var(--rk-soft)">⇄ Quick test: export I–IV–V–I in ${pedalBus.root || 'C'} ${pedalBus.keyType || 'Major'}</button>
      <div class="rb-msg mono" style="font-size:calc(8px*var(--ui));text-align:center;min-height:10px;margin-top:3px"></div>
    </div>`;

    // IN
    h += `<div class="rk-section">
      <div class="rk-label">REAPER → RESONOTE <span class="rk-label-hint">analyze a render or recording</span></div>
      <label class="chord-btn" style="display:block;text-align:center;font-size:calc(10px*var(--ui));padding:8px;cursor:pointer;color:${ACC};border-color:var(--rk-line);background:var(--rk-soft)">
        ${analyzing ? '⏳ analyzing…' : '📂 Choose a WAV / MP3 (drag from REAPER render)'}
        <input type="file" class="rb-file" accept="audio/*,.wav,.mp3,.flac,.ogg" style="display:none">
      </label>`;

    if (analyzing) {
      h += `<div style="background:var(--rk-panel);border-radius:4px;height:6px;margin-top:6px;overflow:hidden">
        <div class="rb-progress-fill" style="height:100%;width:0%;background:${ACC};transition:width .2s"></div>
      </div>
      <div class="rb-progress-label mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-dim);text-align:center;margin-top:2px">analyzing…</div>`;
    }

    if (analysis && !analyzing) {
      if (analysis.error) {
        h += `<div class="mono" style="color:var(--rk-bad);font-size:calc(8px*var(--ui));margin-top:5px">Could not analyze: ${analysis.error}</div>`;
      } else {
        const k0 = analysis.keys[0], k1 = analysis.keys[1];
        h += `<div class="mono" style="font-size:calc(10px*var(--ui));color:var(--rk-ink-dim);margin-top:5px">${fileName || 'file'} · ${analysis.duration}s · ${analysis.events.length} notes${analysis.range ? ` · ${midiName(analysis.range.lo)}–${midiName(analysis.range.hi)}` : ''}</div>`;
        h += `<div style="display:flex;gap:4px;margin-top:5px">
          <div style="flex:1;background:var(--rk-soft);border:1px solid var(--rk-edge);border-radius:6px;padding:5px;text-align:center">
            <div class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-mute)">KEY (best guesses)</div>
            <div class="mono" style="font-size:calc(11px*var(--ui));font-weight:700;color:${ACC}">${k0.root} ${k0.mode}</div>
            <div class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-dim)">${k1 ? `or ${k1.root} ${k1.mode}` : ''}</div>
          </div>
          <div style="flex:1;background:var(--rk-soft);border:1px solid var(--rk-edge);border-radius:6px;padding:5px;text-align:center">
            <div class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-mute)">TEMPO (feel-dependent)</div>
            <div class="mono" style="font-size:calc(11px*var(--ui));font-weight:700;color:${ACC}">~${analysis.bpm}</div>
            <div class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-dim)">or ${analysis.bpmAlts[0]} / ${analysis.bpmAlts[1]}</div>
          </div>
        </div>`;
        h += `<div class="rk-label" style="margin-top:6px">NOTES USED <span class="rk-label-hint">time on each pitch class</span></div>`;
        h += pcBarsHTML();
        h += `<div class="rk-label" style="margin-top:6px">NOTE TIMELINE</div>`;
        h += `<canvas class="rb-roll" style="width:100%;height:60px;background:var(--rk-panel);border-radius:6px;margin-top:2px"></canvas>`;
        h += `<div class="rk-label" style="margin-top:6px">ON THE FRETBOARD <span class="rk-label-hint">where those notes live</span></div>`;
        h += fretboardHTML();
        h += `<button class="chord-btn rb-setkey" style="min-height:calc(28px*var(--ui));width:100%;margin-top:6px;font-size:calc(10px*var(--ui));padding:5px;color:${ACC};border-color:var(--rk-line)">🔑 Set master key to ${k0.root} ${k0.mode} (drives linked pedals)</button>`;
      }
    }
    h += `</div></div>`;
    el.innerHTML = h;

    // wiring
    el.querySelector('.rb-quicktest')?.addEventListener('click', e => { e.stopPropagation(); exportQuickTest(); });
    el.querySelector('.rb-file')?.addEventListener('change', e => {
      e.stopPropagation();
      const f = e.target.files?.[0];
      if (f) analyzeFile(f);
    });
    el.querySelector('.rb-setkey')?.addEventListener('click', e => {
      e.stopPropagation();
      const k0 = analysis?.keys?.[0];
      if (!k0) return;
      pedalBus.setKey(k0.root, k0.mode === 'Minor' ? 'Minor' : 'Major', { source: p.id });
      flash(`Master key set to ${k0.root} ${k0.mode}`);
    });
    drawTimeline();
  }

  // re-render the quick-test label when the master key changes
  pedalBus.on(ev => {
    if (!ev.root || !document.getElementById(`body-${p.id}`)) return;
    const btn = el.querySelector('.rb-quicktest');
    if (btn && !analyzing) btn.textContent = `⇄ Quick test: export I–IV–V–I in ${pedalBus.root || 'C'} ${pedalBus.keyType || 'Major'}`;
  });

  render();
}
