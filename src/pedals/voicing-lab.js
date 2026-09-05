// ─── Voicing Lab — string-set triad & voice-leading trainer ───────────────────
// "I want to practice voice leading, but on the G·B·E strings." Pick any 3-string
// set and a mode: ladder one chord's inversions up the neck, climb the key's
// diatonic triads, or play a voice-led progression — everything constrained to
// JUST those strings, so the relationships across each string set burn in.
import { NOTES, KEY_PATTERNS } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { setChordHighlight, clearChordHighlight, clearGhostHighlight, pedalBus, setFretboardView } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { playPlan } from '../curriculum/drill-runner.js';
import { assignFingers, findTriadsOnSet, TRIAD_QUALITIES } from '../core/voicings.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';

const TRIAD = TRIAD_QUALITIES;
const QSUF = { Major: '', Minor: 'm', Dim: '°', Aug: '+' };
const INV_NAME = ['root position', '1st inv (3rd low)', '2nd inv (5th low)'];
const PROGS = [
  { name: 'I–V–vi–IV (pop)',   degs: [0, 4, 5, 3] },
  { name: 'I–vi–IV–V (50s)',   degs: [0, 5, 3, 4] },
  { name: 'ii–V–I (jazz)',     degs: [1, 4, 0] },
  { name: 'I–IV–V–I (anthem)', degs: [0, 3, 4, 0] },
  { name: 'vi–IV–I–V',         degs: [5, 3, 0, 4] },
];
// Fretboard overlay palette — NOT chrome. These are the dot colours the neck
// renderer paints with, the same language every chord highlight speaks, so they
// stay literal while the panel around them wears the pedal's accent.
const COLORS = { root: '#6cc2a8', tone: '#2e6b58', rootStroke: '#9ae8cc', toneStroke: '#4a9a80' };
const _stop = {};

// The transport's two looks, in one place. Playing, the button reads ⏹ Stop and is
// therefore a halt control, so it drops the panel's accent for the app-wide stop
// red — stop should never be a colour you have to identify. Both render() and
// updatePlayBtn() paint from here, because the label flips without a re-render and
// a button that says Stop in the accent colour is a button you hesitate over.
const playBtnCSS = stopping =>
  `background:${stopping ? 'var(--rk-stop-soft)' : 'var(--rk-soft)'};` +
  `border:1px solid ${stopping ? 'var(--rk-stop-edge)' : 'var(--rk-line)'};border-radius:5px;` +
  `color:${stopping ? 'var(--rk-stop)' : 'var(--rk-accent)'};font-family:'JetBrains Mono',monospace;` +
  `font-size:calc(10px*var(--ui));min-height:calc(28px*var(--ui));padding:6px 12px;cursor:pointer`;

// mountEl lets the Technique Workshop embed this UI as its 🧵 Voicings tab; standalone
// use (legacy saved boards) still targets the pedal body. Settings live under p.settings.vlab
// so they can never collide with the workshop's own keys.
export function buildVoicingLabContent(p, mountEl) {
  const el = mountEl || document.getElementById(`body-${p.id}`);
  if (!el) return;
  const ps = p.settings || (p.settings = {});
  const s = ps.vlab || (ps.vlab = {});
  if (s.setIdx == null) s.setIdx = 0;          // 0 = the top set (G·B·E on standard)
  if (!s.mode) s.mode = 'ladder';              // 'ladder' | 'diatonic' | 'prog'
  if (s.deg == null) s.deg = 0;
  if (s.progIdx == null) s.progIdx = 0;
  if (!s.bpm) s.bpm = 70;
  if (s.loop == null) s.loop = true;
  let playing = false;

  // alive = pedal exists AND this mount is still attached (when embedded as a workshop
  // tab, switching tabs detaches the mount — looping playback must stop then).
  const alive = () => !!document.getElementById(`body-${p.id}`) && document.body.contains(el);

  // ── string sets: every run of 3 adjacent strings (si 0 = highest) ──
  function stringSets() {
    const out = [];
    for (let i = 0; i + 2 < customTuning.length; i++) {
      const idxs = [i + 2, i + 1, i];          // low → high
      out.push({ idxs, label: idxs.map(si => customTuning[si].label || customTuning[si].note).join('·') });
    }
    return out;
  }
  const curSet = () => { const ss = stringSets(); return ss[Math.min(s.setIdx, ss.length - 1)]; };

  // ── key + diatonic triads (follows the session key) ──
  const keyInfo = () => ({ root: pedalBus.masterKey?.root || 'C', type: pedalBus.masterKey?.keyType || 'Major' });
  const keyPat = () => KEY_PATTERNS[keyInfo().type] || KEY_PATTERNS.Major;
  function diatonic(deg) {
    const k = keyInfo(), pat = keyPat();
    const rootPc = (NOTES.indexOf(k.root) + pat.intervals[deg]) % 12;
    const quality = pat.qualities[deg];
    return { rootPc, root: NOTES[rootPc], quality, numeral: pat.numerals[deg], name: NOTES[rootPc] + (QSUF[quality] ?? quality) };
  }

  // ── every compact grip of a triad on the chosen 3 strings ──
  // (engine lives in core/voicings.js so the Workouts pedal shares it)
  const gripsFor = findTriadsOnSet;
  const gripPositions = (grip, idxs) => assignFingers(grip.frets.map((f, k) => {
    const si = idxs[k], n = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
    return { si, fret: f, note: n.note, octave: n.octave };
  }));

  // ── the three practice modes → a chords plan ──
  function buildChords() {
    const set = curSet(), dur = (2 * 60) / s.bpm;
    const mk = (ch, grip, label) => ({ root: ch.root, notes: (TRIAD[ch.quality] || TRIAD.Major).map(iv => NOTES[(ch.rootPc + iv) % 12]), label, positions: gripPositions(grip, set.idxs), dur });

    if (s.mode === 'ladder') {                    // one chord, every inversion up the neck
      const ch = diatonic(s.deg);
      return gripsFor(ch.rootPc, ch.quality, set.idxs).map(g => mk(ch, g, `${ch.name} · ${INV_NAME[g.rot]} · ${g.min}fr`));
    }
    if (s.mode === 'diatonic') {                  // all 7 triads climbing the neck
      const out = []; let prevAvg = -1;
      for (let d = 0; d < 7; d++) {
        const ch = diatonic(d), gs = gripsFor(ch.rootPc, ch.quality, set.idxs);
        const g = gs.find(x => x.avg > prevAvg + 0.4) || gs[gs.length - 1];
        if (!g) continue; prevAvg = g.avg;
        out.push(mk(ch, g, `${ch.numeral} · ${ch.name} · ${g.min}fr`));
      }
      return out;
    }
    // 'prog' — voice-led: each chord takes the grip that moves LEAST from the previous one
    const prog = PROGS[Math.min(s.progIdx, PROGS.length - 1)];
    const out = []; let prev = null;
    prog.degs.forEach(d => {
      const ch = diatonic(d), gs = gripsFor(ch.rootPc, ch.quality, set.idxs);
      let g;
      if (!prev) g = gs.reduce((a, b) => Math.abs(b.avg - 5) < Math.abs(a.avg - 5) ? b : a, gs[0]);
      else g = gs.reduce((a, b) => {
        const cost = x => x.frets.reduce((t, f, k) => t + Math.abs(f - prev.frets[k]), 0);
        return cost(b) < cost(a) ? b : a;
      }, gs[0]);
      if (!g) return; prev = g;
      out.push(mk(ch, g, `${ch.numeral} · ${ch.name} · ${g.min}fr`));
    });
    return out;
  }

  // ── static preview: the whole ladder at once (see the relationships), or the first grip ──
  function preview() {
    const chords = buildChords();
    if (!chords.length) { clearChordHighlight(); clearGhostHighlight(); updateOverlays(); return; }
    const seen = new Set(), all = [];
    (s.mode === 'ladder' ? chords : chords.slice(0, 1)).forEach(c => c.positions.forEach(x => {
      const k = x.si + ':' + x.fret; if (!seen.has(k)) { seen.add(k); all.push(x); }
    }));
    const set = curSet(), k = keyInfo();
    setChordHighlight(chords[0].root, [...new Set(all.map(x => x.note))], `${set.label} strings · ${k.root} ${k.type}`, all, COLORS);
    clearGhostHighlight(); updateOverlays();
  }

  // ── transport ──
  function stopPlay() { if (_stop[p.id]) { _stop[p.id](); delete _stop[p.id]; } playing = false; updatePlayBtn(); preview(); }
  function togglePlay() {
    if (playing) { stopPlay(); return; }
    const chords = buildChords();
    if (!chords.length) return;
    if (s.mode === 'prog') {                       // voice-leading mode → present it in the flow view
      setFretboardView('voice');
      // The neck can draw more views than the DISPLAY dropdown currently lists, and a
      // <select> handed a value it has no <option> for goes blank (selectedIndex -1) —
      // an empty box that names nothing. So only write the view there if it's nameable;
      // otherwise leave the last named view showing and let the neck do the talking.
      const sel = document.getElementById('fb-view');
      if (sel && [...sel.options].some(o => o.value === 'voice')) sel.value = 'voice';
      window.dispatchEvent(new CustomEvent('resonote:fbview', { detail: { view: 'voice' } }));
    }
    playing = true; updatePlayBtn();
    _stop[p.id] = playPlan({ type: 'chords', label: 'Voicing Lab', chords }, { loop: !!s.loop, isAlive: alive, colors: COLORS });
  }
  function updatePlayBtn() {
    const b = document.getElementById(`vlplay-${p.id}`);
    if (!b) return;
    b.textContent = playing ? '⏹ Stop' : '▶ Play';
    b.style.cssText = playBtnCSS(playing);
  }

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !alive()) return;
    render(); preview();
  });

  // ── render ──
  function render() {
    const set = curSet(), k = keyInfo();
    const btn = (cls, data, label, on, extra = '') => `<button class="${cls}" ${data} style="min-height:calc(28px*var(--ui));background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:5px;color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-mute)'};font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:5px 8px;cursor:pointer;${extra}">${label}</button>`;

    // .rk is what makes the kit tokens exist inside this panel; when the Workshop
    // mounts this as its 🧵 tab the accent it reads is the Workshop's, so the tab
    // stops looking like a different product.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:7px">`;
    h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));text-align:center">in <b style="color:var(--rk-dim)">${k.root} ${k.type}</b> (session key) · shapes live only on <b style="color:var(--rk-dim)">${set.label}</b></div>`;

    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px">STRING SET</div>`;
    h += `<div style="display:flex;gap:4px;flex-wrap:wrap">` + stringSets().map((ss, i) => btn('vl-set', `data-i="${i}"`, ss.label, i === s.setIdx)).join('') + `</div>`;

    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1.5px">PRACTICE</div>`;
    h += `<div style="display:flex;gap:4px">`;
    h += btn('vl-mode', `data-m="ladder"`, '🪜 Inversions', s.mode === 'ladder', 'flex:1');
    h += btn('vl-mode', `data-m="diatonic"`, '🧗 Diatonic', s.mode === 'diatonic', 'flex:1');
    h += btn('vl-mode', `data-m="prog"`, '🪢 Voice-led', s.mode === 'prog', 'flex:1');
    h += `</div>`;

    if (s.mode === 'ladder') {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap">` + keyPat().numerals.map((n, d) => btn('vl-deg', `data-d="${d}"`, n, d === s.deg)).join('') + `</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.5">One chord, every home on these strings. Watch which note is on the BOTTOM each time — that's the inversion.</div>`;
    } else if (s.mode === 'diatonic') {
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.5">All seven chords of the key climbing the neck on one string set — nearest shape each time, like sliding one hand up.</div>`;
    } else {
      h += `<select id="vlprog-${p.id}" class="mono" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-accent);border-radius:5px;padding:5px;font-size:calc(10px*var(--ui));outline:none">`;
      PROGS.forEach((pr, i) => h += `<option value="${i}" ${i === s.progIdx ? 'selected' : ''}>${pr.name}</option>`);
      h += `</select>`;
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.5">Each chord takes the grip that moves LEAST from the last one — real voice leading on your chosen strings. Plays in the 🪢 Voice-Leading view so you see holds &amp; moves.</div>`;
    }

    h += `<div style="display:flex;gap:5px;align-items:center">`;
    h += `<button id="vlplay-${p.id}" style="${playBtnCSS(playing)}">${playing ? '⏹ Stop' : '▶ Play'}</button>`;
    h += btn('vl-loop', `id="vlloop-${p.id}"`, '🔁 Loop', !!s.loop);
    // tempo — the shared control, reading & writing the master clock. No accent
    // of its own: it inherits whichever pedal this panel is living in.
    h += `<div class="rk" style="margin-left:auto;flex:0 0 auto">${masterTempoBlock('vl-' + p.id, { min: 30, max: 280, compact: true })}</div>`;
    h += `</div>`;
    h += `</div>`;
    el.innerHTML = h;

    el.querySelectorAll('.vl-set').forEach(b => b.onclick = e => { e.stopPropagation(); stopPlay(); s.setIdx = +b.dataset.i; render(); preview(); });
    el.querySelectorAll('.vl-mode').forEach(b => b.onclick = e => { e.stopPropagation(); stopPlay(); s.mode = b.dataset.m; render(); preview(); });
    el.querySelectorAll('.vl-deg').forEach(b => b.onclick = e => { e.stopPropagation(); stopPlay(); s.deg = +b.dataset.d; render(); preview(); });
    document.getElementById(`vlprog-${p.id}`)?.addEventListener('change', e => { stopPlay(); s.progIdx = +e.target.value; preview(); });
    document.getElementById(`vlplay-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
    document.getElementById(`vlloop-${p.id}`)?.addEventListener('click', e => { e.stopPropagation(); s.loop = !s.loop; render(); });
    wireMasterTempo('vl-' + p.id, { mirror: v => { s.bpm = v; } });
  }

  render();
  preview();
}
