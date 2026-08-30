import { metroClock } from '../core/state.js';
import { encodeMidi, downloadMidi, midiFilename, PPQ } from '../core/midi-writer.js';
import { NOTES } from '../core/music-theory.js';
import { GENRES, GENRE_NAMES, genreChords, compOf } from '../core/genres.js';
import { playChordNotes } from '../core/synth.js';
import { setChordHighlight, clearChordHighlight } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { bus } from '../core/mixer.js';

// ── REAPER Bridge: drum-note maps for MIDI export ────────────────────
// GM = General MIDI (MT Power Drum Kit, SSD5, most kits).
// Sitala = the Clean 808 kit's chromatic pad layout (kick on C2/36).
const DRUM_MIDI_MAPS = {
  'GM':     { kick: 36, snare: 38, hatClosed: 42, hatOpen: 46, ride: 51, tom: 45, clap: 39 },
  'Sitala': { kick: 36, snare: 37, hatClosed: 38, hatOpen: 39, ride: 40, tom: 42, clap: 47 },
};

// ── Drum synthesis kit ───────────────────────────────────────────────
const DRUM_KITS = {
  kick(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + .12);
    g.gain.setValueAtTime(.8, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .3);
    o.connect(g); g.connect(bus(ctx, 'drums')); o.start(t); o.stop(t + .3);
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .02, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * .3;
    n.buffer = nb;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(.5, t); ng.gain.exponentialRampToValueAtTime(.001, t + .02);
    n.connect(ng); ng.connect(bus(ctx, 'drums')); n.start(t); n.stop(t + .02);
  },
  snare(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .15, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 2000;
    ng.gain.setValueAtTime(.6, t); ng.gain.exponentialRampToValueAtTime(.001, t + .15);
    n.connect(bf); bf.connect(ng); ng.connect(bus(ctx, 'drums')); n.start(t); n.stop(t + .15);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 200;
    og.gain.setValueAtTime(.3, t); og.gain.exponentialRampToValueAtTime(.001, t + .08);
    o.connect(og); og.connect(bus(ctx, 'drums')); o.start(t); o.stop(t + .08);
  },
  hatClosed(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .04, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 6000;
    ng.gain.setValueAtTime(.3, t); ng.gain.exponentialRampToValueAtTime(.001, t + .04);
    n.connect(bf); bf.connect(ng); ng.connect(bus(ctx, 'drums')); n.start(t); n.stop(t + .04);
  },
  hatOpen(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'highpass'; bf.frequency.value = 6000;
    ng.gain.setValueAtTime(.25, t); ng.gain.exponentialRampToValueAtTime(.001, t + .2);
    n.connect(bf); bf.connect(ng); ng.connect(bus(ctx, 'drums')); n.start(t); n.stop(t + .2);
  },
  ride(ctx, t) {
    const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .4, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
    bf.type = 'bandpass'; bf.frequency.value = 10000; bf.Q.value = 2;
    ng.gain.setValueAtTime(.15, t); ng.gain.exponentialRampToValueAtTime(.001, t + .4);
    n.connect(bf); bf.connect(ng); ng.connect(bus(ctx, 'drums')); n.start(t); n.stop(t + .4);
  },
  tom(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(80, t + .15);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .2);
    o.connect(g); g.connect(bus(ctx, 'drums')); o.start(t); o.stop(t + .2);
  },
  clap(ctx, t) {
    for (let i = 0; i < 3; i++) {
      const n = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * .02, ctx.sampleRate), nd = nb.getChannelData(0);
      for (let j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
      n.buffer = nb;
      const ng = ctx.createGain(), bf = ctx.createBiquadFilter();
      bf.type = 'bandpass'; bf.frequency.value = 1500;
      ng.gain.setValueAtTime(.3, t + i * .015);
      ng.gain.exponentialRampToValueAtTime(.001, t + i * .015 + .04);
      n.connect(bf); bf.connect(ng); ng.connect(bus(ctx, 'drums'));
      n.start(t + i * .015); n.stop(t + i * .015 + .04);
    }
  }
};

// ── Row definitions ──────────────────────────────────────────────────
// LANE INK, and the one thing in this pedal the kit cannot yet express. Seven
// simultaneous rows need seven telling-apart colours, and the token set has no
// categorical ladder — the accent washes are one hue by design. These are also
// consumed as hex STRINGS (`${r.color}88` builds the painted-cell alpha below),
// so they cannot become var() without a code change, not just a substitution.
// Left literal on purpose; flagged for a --rk-lane-1…7 value ladder off the accent.
const DRUM_ROWS = [
  { key: 'kick',      label: 'Kick',  color: '#9977ee' },
  { key: 'snare',     label: 'Snare', color: '#bb88ff' },
  { key: 'hatClosed', label: 'CH',    color: '#8899cc' },
  { key: 'hatOpen',   label: 'OH',    color: '#7799bb' },
  { key: 'ride',      label: 'Ride',  color: '#66aaaa' },
  { key: 'tom',       label: 'Tom',   color: '#aa7799' },
  { key: 'clap',      label: 'Clap',  color: '#cc8888' }
];

// Fretboard overlay ink. Painted into the shared fretboard SVG, which lives
// OUTSIDE this pedal's card — a kit token would resolve against the page instead
// of against this pedal and the chord would come out unpainted.
const NECK = { root: '#9977ee', tone: '#5a4a8a', rootStroke: '#c0b4ff', toneStroke: '#8a7cc0' };

// ── Beat presets ─────────────────────────────────────────────────────
const BEAT_PRESETS = {
  'Rock':    { kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] },
  'Pop':     { kick: [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
  'Funk':    { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,0,1], snare: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0], hatClosed: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0] },
  'Hip Hop': { kick: [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] },
  'Jazz':    { ride: [1,0,1,0,0,1,1,0,1,0,1,0,0,1,1,0], kick: [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0], hatClosed: [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0] },
  'Latin':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], hatClosed: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], tom: [0,0,0,0,1,0,0,1,0,0,0,1,0,0,1,0] },
  'EDM':     { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1] },
  'Reggae':  { kick: [0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0], hatClosed: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], ride: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] },
  'Blues':   { kick: [1,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], ride: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], hatClosed: [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1] },
  // Tom-led and loose, with the backbeat left half-open — psychedelia's drummer is
  // playing the ROOM, not the click. None of the nine above gave that.
  'Psych':   { kick: [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], tom: [0,0,1,0,0,0,0,1,1,0,1,0,0,0,1,1], ride: [1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1], hatOpen: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1] }
};

// ── WAV buffer helper ────────────────────────────────────────────────
function bufferToWaveBlob(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numOfChan * 2 + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);
  function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  let offset = 0;
  writeString(offset, 'RIFF'); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString(offset, 'WAVE'); offset += 4;
  writeString(offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numOfChan * 2, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString(offset, 'data'); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i] || 0));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample | 0, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ── Main builder ─────────────────────────────────────────────────────
export function buildBeatMakerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  // Backing-track state: a genre carries its own groove, mode, tempo and chords.
  // BEATS ONLY plays the kit alone; FULL BACKING adds the chord loop over it, so
  // one pedal covers "give me a beat" and "give me something to play over".
  if (s.bmRoot === undefined) s.bmRoot = 'A';
  if (s.bmGenre === undefined) s.bmGenre = '';
  if (s.bmFull === undefined) s.bmFull = false;
  // Drums are their own switch, so the pedal covers three real uses: time only
  // (beats), a full backing track, and changes-without-drums — which is what you
  // want when you're listening to voice leading rather than playing in the pocket.
  // A separate flag rather than a tri-state enum: saved boards already hold
  // bmFull, and this keeps every one of them valid with no migration.
  if (s.bmDrums === undefined) s.bmDrums = true;
  const steps = 16;
  let grid = s.bmGrid || {};
  let presetName = s.bmPreset || '';
  let curStep = -1;
  let lastClockConfig = metroClock.getConfigSignature();

  // Clean up any previous interval
  if (p._bmIntv) { clearInterval(p._bmIntv); p._bmIntv = null; }
  if (p._bmPlaying) p._bmPlaying = false;
  metroClock.unregisterTransport(p.id);
  metroClock.registerTransport(p.id, () => { if (p._bmPlaying) stopBeat(); });

  // Ensure every row has a full array
  DRUM_ROWS.forEach(r => { if (!grid[r.key]) grid[r.key] = new Array(steps).fill(0); });

  // ── Load a preset ──
  function loadPreset(name) {
    const pr = BEAT_PRESETS[name];
    if (!pr) return;
    DRUM_ROWS.forEach(r => { grid[r.key] = pr[r.key] ? [...pr[r.key]] : new Array(steps).fill(0); });
    presetName = name;
  }

  // ── Play one step ──
  function playStep(stepIdx) {
    if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = p._bmCtx, t = ctx.currentTime;
    if (s.bmDrums !== false) DRUM_ROWS.forEach(r => {
      if (grid[r.key] && grid[r.key][stepIdx]) {
        if (DRUM_KITS[r.key]) DRUM_KITS[r.key](ctx, t);
      }
    });
    // the chord is struck on the genre's comp slots, on this same tick
    if (s.bmFull && chordBars.length) {
      const comp = compOf(s.bmGenre);
      if (comp.hits.includes(stepIdx)) {
        const c = nowChord();
        if (c) playChordNotes(c.notes, {
          dur: comp.accent.includes(stepIdx) ? 0.34 : 0.2,
          strum: 0.012,
          gain: comp.accent.includes(stepIdx) ? 0.15 : 0.095,
        });
      }
    }
  }

  // ── Chords (FULL BACKING) ──
  // ONE clock. The chords hang off the drum sequencer's own 16th tick rather than
  // running a second timer, so they cannot drift against the kit no matter what
  // the tempo does. The progression is flattened to one entry PER BAR, which is
  // what makes "bar 3 of 12" answerable — and being able to answer that is how
  // you get back in after a mistake.
  let chordBars = [];     // one chord object per bar of the progression
  let compBar = 0;        // which bar of the progression we are in
  function buildChordBars() {
    chordBars = [];
    if (!s.bmGenre) return;
    genreChords(s.bmGenre, s.bmRoot).forEach(c => {
      for (let b = 0; b < (c.bars || 1); b++) chordBars.push({ ...c, barInChord: b, spanBars: c.bars || 1 });
    });
  }
  const nowChord  = () => chordBars[compBar % (chordBars.length || 1)] || null;
  const nextChord = () => {
    if (!chordBars.length) return null;
    for (let k = 1; k <= chordBars.length; k++) {
      const c = chordBars[(compBar + k) % chordBars.length];
      if (c.label !== nowChord()?.label) return c;
    }
    return null;
  };
  function lightChord() {
    const c = nowChord();
    if (!c || !s.bmFull) return;
    setChordHighlight(c.root, c.notes, c.label, null, NECK);
    updateOverlays();
  }
  function stopChords() {
    compBar = 0;
    if (s.bmFull) { clearChordHighlight(); updateOverlays(); }
  }

  // ── Start / stop ──
  function startBeat() {
    metroClock.stopOthers(p.id);
    p._bmPlaying = true; curStep = -1;
    const useBpm = metroClock.bpm || 120;
    const stepMs = 60000 / useBpm / 4; // 16th notes
    buildChordBars(); compBar = 0; lightChord();
    playStep(0); curStep = 0; metroClock.playing = true; metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    render();
    p._bmIntv = setInterval(() => {
      curStep = (curStep + 1) % steps;
      // a wrap to slot 0 is a new BAR — move the progression on and relight
      if (curStep === 0 && chordBars.length) {
        compBar = (compBar + 1) % chordBars.length;
        lightChord();
      }
      const beatIdx = Math.floor(curStep / 4) % Math.max(1, metroClock.ts || 4);
      if (curStep % 4 === 0) { metroClock.playing = true; metroClock.setBeat(beatIdx, metroClock.pattern?.[beatIdx] || (beatIdx === 0 ? 'accent' : 'regular')); }
      playStep(curStep);
      updateStepDisplay();
    }, stepMs);
  }

  function stopBeat() {
    p._bmPlaying = false;
    stopChords();
    clearInterval(p._bmIntv); p._bmIntv = null;
    curStep = -1;
    metroClock.playing = false;
    metroClock.setBeat(0, metroClock.pattern?.[0] || 'accent');
    render();
  }

  // ── Live step indicator (no full re-render) ──
  function updateStepDisplay() {
    const cells = el.querySelectorAll('.bm-cell');
    cells.forEach(c => {
      // the playhead is the pedal's own lamp, so it reads as "this one is sounding"
      // rather than as an eighth drum lane
      const isCur = p._bmPlaying && parseInt(c.dataset.si) === curStep;
      c.style.boxShadow = isCur ? 'inset 0 0 0 2px var(--rk-hot)' : 'none';
    });
    el.querySelectorAll('.bm-dot').forEach((d, i) => {
      d.style.background = i === curStep ? 'var(--rk-accent)' : 'var(--rk-panel2)';
    });
    // the chord chart follows the same tick — this is the part you read when you
    // have lost your place, so it updates every step, not every bar
    const nowEl = document.getElementById(`bm-now-${p.id}`);
    if (nowEl && chordBars.length) {
      const c = nowChord(), nx = nextChord();
      const beat = Math.floor(curStep / 4) + 1;
      // NOW is the readout, NEXT is the same accent held quiet — one colour, two
      // weights, so "where am I" and "what's coming" cannot be confused for each other
      nowEl.innerHTML = `<span style="color:var(--rk-ink-mute)">NOW</span>`
        + `<b style="color:var(--rk-accent);font-size:calc(14px*var(--ui))">${c ? c.label : '—'}</b>`
        + `<span style="color:var(--rk-ink-dim)">bar <b style="color:var(--rk-ink)">${compBar + 1}</b> of ${chordBars.length}`
        + `${p._bmPlaying ? ` · beat <b style="color:var(--rk-ink)">${beat}</b>` : ''}</span>`
        + `<span style="flex:1"></span>`
        + `<span style="color:var(--rk-ink-mute)">NEXT</span><b style="color:var(--rk-dim)">${nx ? nx.label : '↻'}</b>`;
    }
    el.querySelectorAll('.bm-bar').forEach(b => {
      // must stay identical to the resting values render() builds, or the lane
      // flips appearance on the first tick
      const on = p._bmPlaying && +b.dataset.b === compBar;
      b.style.borderColor = on ? 'var(--rk-line)' : 'var(--rk-edge-soft)';
      b.style.background  = on ? 'var(--rk-soft2)' : 'var(--rk-panel)';
      const sp = b.querySelector('span');
      if (sp) sp.style.color = on ? 'var(--rk-accent)' : 'var(--rk-ink-dim)';
    });
    el.querySelectorAll('.bm-comp').forEach(d => {
      const i = +d.dataset.i;
      const comp = compOf(s.bmGenre);
      const hit = comp.hits.includes(i), acc = comp.accent.includes(i);
      const cur = p._bmPlaying && i === curStep;
      d.style.background = cur ? 'var(--rk-hot)' : acc ? 'var(--rk-accent)' : hit ? 'var(--rk-dim)' : 'var(--rk-panel)';
    });
  }

  // ── Render beat to offline context → WAV blob ──
  async function uploadBeatAsTrack() {
    try {
      const bars = Math.max(1, parseInt(s.bmTrackBars || 1) || 1);
      const bpm = metroClock.bpm || 120;
      const ts  = metroClock.ts || 4;
      const secPerBeat = 60 / bpm;
      const stepDur    = secPerBeat / 4;
      const barDur     = secPerBeat * ts;
      const totalDur   = barDur * bars;
      const tail       = 1.2;
      const sampleRate = 44100;
      const offline = new OfflineAudioContext(2, Math.ceil((totalDur + tail) * sampleRate), sampleRate);

      DRUM_ROWS.forEach(r => {
        const row = grid[r.key] || [];
        for (let bar = 0; bar < bars; bar++) {
          const barOffset = bar * barDur;
          for (let i = 0; i < steps; i++) {
            if (row[i] && DRUM_KITS[r.key]) {
              DRUM_KITS[r.key](offline, barOffset + i * stepDur);
            }
          }
        }
      });

      const rendered = await offline.startRendering();
      const blob = bufferToWaveBlob(rendered);
      const url  = URL.createObjectURL(blob);

      // Dispatch to studio module if available (studio-mode.js listens for this)
      const event = new CustomEvent('resonote:beattrack', {
        detail: {
          url, blob,
          name: (presetName || 'Custom Beat') + ' ' + bars + ' bar' + (bars > 1 ? 's' : ''),
          duration: totalDur, bars
        }
      });
      window.dispatchEvent(event);

      // User feedback
      const msg = document.createElement('div');
      msg.className = 'mono';
      msg.textContent = 'Beat rendered (' + bars + ' bar' + (bars > 1 ? 's' : '') + ') — sent to Studio';
      // toasts hang off the pedal BODY, outside the .rk wrapper, so they can only use
      // the two tokens that live further up: --rk-accent (the card) and --rk-bad (:root)
      msg.style.cssText = 'color:var(--rk-accent);font-size:calc(8px*var(--ui));text-align:center;margin-top:4px';
      el.appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
    } catch (err) {
      console.error(err);
      const msg = document.createElement('div');
      msg.className = 'mono';
      msg.textContent = 'Could not render beat: ' + err.message;
      msg.style.cssText = 'color:var(--rk-bad);font-size:calc(8px*var(--ui));text-align:center;margin-top:4px';
      el.appendChild(msg);
      setTimeout(() => msg.remove(), 3000);
    }
  }

  // ── REAPER Bridge: export the grid as a .mid file ───────────────────
  function exportBeatMidi() {
    const bars = Math.max(1, parseInt(s.bmTrackBars || 1) || 1);
    const bpm = metroClock.bpm || 120;
    const map = DRUM_MIDI_MAPS[s.bmMidiMap] || DRUM_MIDI_MAPS.GM;
    const stepTicks = PPQ / 4;                 // 16 steps = one 4/4 bar of 16ths
    const notes = [];
    for (let bar = 0; bar < bars; bar++) {
      DRUM_ROWS.forEach(r => {
        const row = grid[r.key] || [];
        for (let i = 0; i < steps; i++) {
          if (!row[i] || map[r.key] == null) continue;
          notes.push({
            tick: (bar * steps + i) * stepTicks,
            note: map[r.key],
            vel: i % 4 === 0 ? 110 : 88,       // accent the downbeats
            dur: stepTicks / 2,
          });
        }
      });
    }
    if (!notes.length) return flashMsg('Nothing to export — paint some steps first', 'var(--rk-bad)');
    const bytes = encodeMidi({
      bpm, timeSig: [4, 4],
      trackName: `Resonote beat ${presetName || 'custom'}`,
      notes, endTick: bars * steps * stepTicks,
    });
    downloadMidi(bytes, midiFilename(`beat-${presetName || 'custom'}-${bpm}bpm`));
    flashMsg(`MIDI exported (${bars} bar${bars > 1 ? 's' : ''} @ ${bpm} BPM, ${s.bmMidiMap || 'GM'} map) — run Resonote Import in REAPER`, 'var(--rk-accent)');
  }

  function flashMsg(text, color) {
    const msg = document.createElement('div');
    msg.className = 'mono';
    msg.textContent = text;
    msg.style.cssText = `color:${color};font-size:calc(8px*var(--ui));text-align:center;margin-top:4px`;
    el.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  }

  // ── Full render ──────────────────────────────────────────────────────
  function render() {
    const useBpm = metroClock.bpm || 120;
    // One active style for every toggle in this pedal. The genre row used to be amber
    // while the mode row beside it was violet, which is how one pedal ends up looking
    // like two.
    const ON = 'background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)';

    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:5px">`;

    // ── BACKING: genre → groove + mode + chords, in your key ──
    const g = GENRES[s.bmGenre];
    const chords = s.bmGenre ? genreChords(s.bmGenre, s.bmRoot) : [];
    h += `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge);border-radius:8px;padding:6px 7px">`;
    h += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
        <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1.5px;flex:1">BACKING TRACK</span>
        <button id="bm-mode-beats-${p.id}" class="chord-btn" title="Drums only — time to play against" style="font-size:calc(7px*var(--ui));padding:2px 5px;${!s.bmFull ? ON : ''}">beats</button>
        <button id="bm-mode-full-${p.id}" class="chord-btn" title="Drums and chords — a full backing track" style="font-size:calc(7px*var(--ui));padding:2px 5px;${s.bmFull && s.bmDrums !== false ? ON : ''}">+ chords</button>
        <button id="bm-mode-chords-${p.id}" class="chord-btn" title="Chords only — the changes with no drums" style="font-size:calc(7px*var(--ui));padding:2px 5px;${s.bmFull && s.bmDrums === false ? ON : ''}">chords</button>
      </div>`;
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:4px">`;
    h += `<button class="chord-btn bm-genre" data-g="" style="font-size:calc(7px*var(--ui));padding:2px 5px;${!s.bmGenre ? ON : ''}">none</button>`;
    GENRE_NAMES.forEach(n => {
      h += `<button class="chord-btn bm-genre" data-g="${n}" style="font-size:calc(7px*var(--ui));padding:2px 5px;${s.bmGenre === n ? ON : ''}">${n}</button>`;
    });
    h += `</div>`;
    if (g) {
      h += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">KEY</span>
          <select id="bm-root-${p.id}" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:4px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(9px*var(--ui));padding:2px">
            ${NOTES.map(n => `<option ${n === s.bmRoot ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <span class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui))">${g.mode} · ${g.bpm} BPM</span>
          <span class="mono" style="color:var(--rk-dim);font-size:calc(8px*var(--ui));flex:1;text-align:right">${chords.map(c => c.label + (c.bars > 1 ? `·${c.bars}` : '')).join('  ')}</span>
        </div>
        <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7.5px*var(--ui));line-height:1.5;margin-top:4px">${g.why}</div>`;
      // ── where you are, so you can get back in ──
      // A chord chart you can only hear is useless the moment you lose your place.
      // NOW / bar n of m / NEXT answers "where am I" at a glance, and the lane
      // below draws the whole loop plus the comp hits, so the strum is something
      // you can see coming instead of guess at.
      if (s.bmFull) {
        const comp = compOf(s.bmGenre);
        const bars = [];
        chords.forEach(c => { for (let b = 0; b < (c.bars || 1); b++) bars.push(c.label); });
        h += `<div id="bm-now-${p.id}" class="mono" style="display:flex;align-items:baseline;gap:6px;margin-top:6px;font-size:calc(8px*var(--ui));color:var(--rk-ink-mute)"></div>`;
        h += `<div id="bm-lane-${p.id}" style="display:flex;gap:2px;margin-top:3px">
            ${bars.map((lab, i) => `<div class="bm-bar" data-b="${i}" style="flex:1;min-width:0;text-align:center;padding:3px 1px;border-radius:4px;border:1px solid var(--rk-edge-soft);background:var(--rk-panel);overflow:hidden">
                 <span class="mono" style="font-size:calc(8px*var(--ui));color:var(--rk-ink-dim)">${lab}</span></div>`).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:3px;margin-top:4px">
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));width:32px">STRUM</span>
            <div style="flex:1;display:flex;gap:1px">
              ${Array.from({ length: 16 }, (_, i) => {
                const hit = comp.hits.includes(i), acc = comp.accent.includes(i);
                return `<div class="bm-comp" data-i="${i}" style="flex:1;height:9px;border-radius:2px;background:${acc ? 'var(--rk-accent)' : hit ? 'var(--rk-dim)' : 'var(--rk-panel)'}"></div>`;
              }).join('')}
            </div>
          </div>
          <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7.5px*var(--ui));line-height:1.45;margin-top:3px">${comp.feel}</div>`;
      }
    }
    h += `</div>`;

    // Preset buttons
    h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
    Object.keys(BEAT_PRESETS).forEach(name => {
      const active = presetName === name;
      h += `<button class="chord-btn bm-preset" data-bp="${name}" style="font-size:calc(7px*var(--ui));padding:2px 5px;${active ? ON : ''}">${name}</button>`;
    });
    h += `</div>`;

    // Step indicator dots
    h += `<div style="display:flex;gap:1px;justify-content:flex-end;padding:0 2px 0 34px">`;
    for (let i = 0; i < steps; i++) {
      h += `<div class="bm-dot" style="flex:1;height:3px;border-radius:1px;background:${i === curStep ? 'var(--rk-accent)' : 'var(--rk-panel2)'}"></div>`;
    }
    h += `</div>`;

    // Grid
    h += `<div style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:4px;overflow-x:auto">`;
    DRUM_ROWS.forEach(r => {
      h += `<div style="display:flex;gap:1px;margin-bottom:1px;align-items:center">`;
      h += `<span class="mono" style="color:${r.color};font-size:calc(7px*var(--ui));font-weight:700;min-width:30px;text-align:right;padding-right:4px">${r.label}</span>`;
      for (let i = 0; i < steps; i++) {
        const on         = grid[r.key] && grid[r.key][i];
        const isDownbeat = i % 4 === 0;
        const isCur      = p._bmPlaying && i === curStep;
        // a painted cell keeps its lane's ink; an empty one is ordinary chrome
        const bg         = on ? `${r.color}${isCur ? 'cc' : '88'}` : isCur ? 'var(--rk-soft)' : 'var(--rk-panel2)';
        const border     = isDownbeat ? 'border-left:1.5px solid var(--rk-edge-soft);' : '';
        const shadow     = isCur ? 'box-shadow:inset 0 0 0 2px var(--rk-hot);' : '';
        h += `<div class="bm-cell" data-rk="${r.key}" data-si="${i}" style="flex:1;min-width:14px;height:16px;background:${bg};border-radius:2px;cursor:pointer;transition:background .08s;${border}${shadow}"></div>`;
      }
      h += `</div>`;
    });
    h += `</div>`;

    // Tap preview buttons
    h += `<div style="display:flex;gap:2px">`;
    DRUM_ROWS.forEach(r => {
      h += `<button class="chord-btn bm-tap" data-tk="${r.key}" style="flex:1;font-size:calc(6px*var(--ui));padding:2px 1px;color:${r.color};border-color:${r.color}33">${r.label}</button>`;
    });
    h += `</div>`;

    // Tempo display + Clear
    h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center">`;
    h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">TEMPO</span>`;
    h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(12px*var(--ui));font-weight:700">${useBpm}</span>`;
    h += `<button class="chord-btn bm-clear" style="font-size:calc(7px*var(--ui));margin-left:auto;color:var(--rk-bad);border-color:var(--rk-edge-soft)">Clear</button>`;
    h += `</div>`;

    // Track length selector
    h += `<div style="display:flex;gap:6px;align-items:center">`;
    h += `<label class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));white-space:nowrap">TRACK LEN</label>`;
    h += `<select class="bm-track-bars" style="flex:1;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:6px;padding:5px 6px;font-size:calc(8px*var(--ui))">`;
    [1, 2, 4].forEach(v => { h += `<option value="${v}" ${(s.bmTrackBars || 1) === v ? 'selected' : ''}>${v} bar${v > 1 ? 's' : ''}</option>`; });
    h += `</select></div>`;

    // Upload to studio
    h += `<button class="chord-btn bm-upload-track" style="width:100%;font-size:calc(8px*var(--ui));padding:6px 8px;color:var(--rk-accent);border-color:var(--rk-line);background:var(--rk-soft)">⬆ Upload Beat as Track</button>`;

    // REAPER Bridge: MIDI export (drum map + button)
    h += `<div style="display:flex;gap:4px;align-items:stretch">`;
    h += `<select class="bm-midi-map" title="Drum note map for the export" style="width:74px;background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:6px;padding:4px;font-size:calc(8px*var(--ui))">`;
    Object.keys(DRUM_MIDI_MAPS).forEach(m => { h += `<option value="${m}" ${(s.bmMidiMap || 'GM') === m ? 'selected' : ''}>${m}</option>`; });
    h += `</select>`;
    h += `<button class="chord-btn bm-export-midi" style="flex:1;font-size:calc(8px*var(--ui));padding:6px 8px;color:var(--rk-accent);border-color:var(--rk-line);background:var(--rk-soft)">⇄ Export MIDI for REAPER</button>`;
    h += `</div>`;

    // Play / Stop. The moment this reads STOP it is the halt control, and every
    // halt in the app wears the same red — you reach for it mid-groove with both
    // hands on the guitar, so it has to be found without being read. That is a
    // different job from the playhead, the lit cells and the strum lane, which
    // stay on --rk-hot: those only report that the pedal is running, and running
    // is not stopping.
    const pc = p._bmPlaying ? 'var(--rk-stop-soft)' : 'var(--rk-soft)';
    const pb = p._bmPlaying ? 'var(--rk-stop-edge)' : 'var(--rk-line)';
    const pt = p._bmPlaying ? 'var(--rk-stop)'      : 'var(--rk-accent)';
    h += `<button class="bm-play mono" style="background:${pc};border:1px solid ${pb};color:${pt};border-radius:8px;padding:7px 16px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">${p._bmPlaying ? '■ STOP' : '▶ PLAY'}</button>`;
    h += `</div>`;

    el.innerHTML = h;

    // ── Wire events ──────────────────────────────────────────────────

    // Grid cells — toggle + instant preview
    el.querySelectorAll('.bm-cell').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      const rk = c.dataset.rk, si = parseInt(c.dataset.si);
      if (grid[rk]) grid[rk][si] = grid[rk][si] ? 0 : 1;
      presetName = '';
      if (grid[rk][si] && DRUM_KITS[rk]) {
        if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
        DRUM_KITS[rk](p._bmCtx, p._bmCtx.currentTime);
      }
      saveGrid();
      render();
    }));

    // Tap preview
    el.querySelectorAll('.bm-tap').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      if (!p._bmCtx) p._bmCtx = new (window.AudioContext || window.webkitAudioContext)();
      const fn = DRUM_KITS[b.dataset.tk];
      if (fn) fn(p._bmCtx, p._bmCtx.currentTime);
    }));

    // Presets
    el.querySelectorAll('.bm-preset').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      loadPreset(b.dataset.bp);
      if (p._bmPlaying) { stopBeat(); startBeat(); } else render();
    }));

    // ── Backing-track controls ──
    // Picking a genre IS the preset: it loads that groove, moves the tempo, and
    // sets the chords. One choice, three things, which is what a genre is.
    el.querySelectorAll('.bm-genre').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const name = b.dataset.g;
      s.bmGenre = name || '';
      if (name) {
        loadPreset(GENRES[name].groove);
        metroClock.set(GENRES[name].bpm, metroClock.ts);
      }
      if (p._bmPlaying) { stopBeat(); startBeat(); } else render();
    }));
    [['bm-mode-beats-', false, true], ['bm-mode-full-', true, true], ['bm-mode-chords-', true, false]]
      .forEach(([id, full, drums]) => {
      document.getElementById(id + p.id)?.addEventListener('click', e => {
        e.stopPropagation();
        s.bmFull = full; s.bmDrums = drums;
        if (p._bmPlaying) { if (full) startChords(); else stopChords(); }
        render();
      });
    });
    document.getElementById(`bm-root-${p.id}`)?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmRoot = e.target.value;
      if (p._bmPlaying && s.bmFull) startChords();
      render();
    });

    // Clear
    el.querySelector('.bm-clear')?.addEventListener('click', e => {
      e.stopPropagation();
      DRUM_ROWS.forEach(r => { grid[r.key] = new Array(steps).fill(0); });
      presetName = '';
      saveGrid();
      render();
    });

    // Track length
    el.querySelector('.bm-track-bars')?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmTrackBars = parseInt(e.target.value) || 1;
    });

    // Upload to studio
    el.querySelector('.bm-upload-track')?.addEventListener('click', async e => {
      e.stopPropagation();
      await uploadBeatAsTrack();
    });

    // REAPER Bridge: MIDI export
    el.querySelector('.bm-midi-map')?.addEventListener('change', e => {
      e.stopPropagation();
      s.bmMidiMap = e.target.value;
    });
    el.querySelector('.bm-export-midi')?.addEventListener('click', e => {
      e.stopPropagation();
      exportBeatMidi();
    });

    // Play / Stop
    el.querySelector('.bm-play')?.addEventListener('click', e => {
      e.stopPropagation();
      if (p._bmPlaying) stopBeat(); else startBeat();
    });
  }

  // ── Persist grid to settings ──
  function saveGrid() {
    s.bmGrid    = grid;
    s.bmPreset  = presetName;
    s.bmTrackBars = s.bmTrackBars || 1;
  }

  // ── React to metroClock BPM changes ──
  // ── Other pedals can ask for a groove ────────────────────────────────
  // Same contract as the ⏱️ Metronome's `resonote:metro`: a pedal that needs a
  // backing beat asks for one instead of growing its own drum machine. The Write
  // It pedal uses this so a genre choice starts the matching groove here — one
  // kit, one sequencer, one place to improve it.
  if (p._bmReq) window.removeEventListener('resonote:beat', p._bmReq);
  p._bmReq = e => {
    if (!document.getElementById(`body-${p.id}`)) return;
    const d = e.detail || {};
    if (d.action === 'stop') { if (p._bmPlaying) stopBeat(); return; }
    if (d.action === 'toggle') { p._bmPlaying ? stopBeat() : startBeat(); return; }
    if (d.action !== 'start') return;
    // a caller can ask for a whole genre (groove + key + chords), not just a groove
    if (d.genre && GENRES[d.genre]) {
      s.bmGenre = d.genre;
      if (d.root) s.bmRoot = d.root;
      if (d.full !== undefined) s.bmFull = !!d.full;
      loadPreset(GENRES[d.genre].groove);
    } else if (d.groove && BEAT_PRESETS[d.groove]) loadPreset(d.groove);
    if (p._bmPlaying) { stopBeat(); startBeat(); }   // adopt the new groove mid-flight
    else startBeat();                                 // startBeat renders once internally
  };
  window.addEventListener('resonote:beat', p._bmReq);

  metroClock.on(clock => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!metroClock.follows(p.type)) return;     // opt-in: only follow tempo when linked
    const nextConfig = clock.getConfigSignature();
    if (nextConfig === lastClockConfig) return;
    lastClockConfig = nextConfig;
    if (p._bmPlaying) { stopBeat(); startBeat(); }
    else render();
  });

  render();
}
