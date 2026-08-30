import { NOTES, SCALE_TYPES } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, pedalBus, metroClock } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { CURRICULUM } from '../curriculum/curriculum-data.js';
import { drillToPlan, playPlan, SEQ_COLORS } from '../curriculum/drill-runner.js';
import { stepStripHTML, wireStepStrip, followStrip, paintStripAt, planToStripSteps } from '../ui/step-strip.js';
// A running drill and a running piece are the same act, so they get the same frame —
// see src/ui/exercise-view.js. The 📖 Songbook renders through this too.
import { exerciseViewHTML, wireExerciseView, paintNowNext } from '../ui/exercise-view.js';
// The app's ONE "what is this & why" card, already worn by ten pedals. A drill gets the
// short form of its lesson in it rather than a third theory presentation of its own.
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';
import { playNote, playChordNotes } from '../core/synth.js';
// The 📖 Songbook tab IS the former Song Sketchpad pedal, hosted. sketchpad.js is still
// its own module because the TAB page reads its song data — see the contract in its banner.
import { buildSketchpadContent, songToSteps } from './sketchpad.js';

const ARP_TYPES = {
  'Triads': { 'Major':[0,4,7],'Minor':[0,3,7],'Dim':[0,3,6],'Aug':[0,4,8],'Sus2':[0,2,7],'Sus4':[0,5,7] },
  '7ths':   { 'Maj7':[0,4,7,11],'Dom7':[0,4,7,10],'Min7':[0,3,7,10],'Dim7':[0,3,6,9],'m7♭5':[0,3,6,10],'mMaj7':[0,3,7,11] },
  'Other':  { '6':[0,4,7,9],'Min6':[0,3,7,9],'Aug7':[0,4,8,10] }
};

const PRACTICE_PRESETS = [
  { name:'Quick 15',     blocks:[{label:'Warm-up scales',   cat:'scales', mins:5, random:true},{label:'Chord changes',  cat:'chords',mins:5,random:true},{label:'Free play',cat:'free',mins:5}] },
  { name:'Technique 30', blocks:[{label:'Scales & modes',   cat:'scales', mins:10,random:true},{label:'Chord transitions',cat:'chords',mins:8,random:true},{label:'Arpeggios',cat:'arps',mins:7,random:true},{label:'Song practice',cat:'free',mins:5}] },
  { name:'Deep Focus 45',blocks:[{label:'Scale positions',  cat:'scales', mins:10,random:true},{label:'Chord voicings', cat:'chords',mins:10,random:true},{label:'Arpeggio patterns',cat:'arps',mins:10,random:true},{label:'Progression practice',cat:'chords',mins:10,random:true},{label:'Improvisation',cat:'free',mins:5}] }
];

function randomPracticeAssignment(cat) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rKey = pick(NOTES);
  if (cat === 'scales') {
    const [cn, scales] = pick(Object.entries(SCALE_TYPES));
    const sn = pick(Object.keys(scales));
    return { root:rKey, typeName:sn, typeCat:cn, label:`${rKey} ${sn}` };
  }
  if (cat === 'arps') {
    const [cn, arps] = pick(Object.entries(ARP_TYPES));
    const an = pick(Object.keys(arps));
    return { root:rKey, typeName:an, typeCat:cn, label:`${rKey} ${an} Arp` };
  }
  if (cat === 'chords') {
    const kt = pick(['Major','Minor']);
    return { root:rKey, typeName:kt, typeCat:'key', label:`Key of ${rKey} ${kt}` };
  }
  return { root:'C', typeName:'', typeCat:'', label:'' };
}

function applyBlockToFretboard(blk) {
  if (!blk || blk.cat === 'free') { clearChordHighlight(); updateOverlays(); return; }
  const r = blk.root || 'C', tn = blk.typeName || '', tc = blk.typeCat || '';

  if (blk.cat === 'scales' || blk.cat === 'arps') {
    if (pedalBus.rebuildPedal) {
      const settings = blk.cat === 'scales'
        ? { root:r, mode:'scales', scaleName:tn, scaleCat:tc, _autoStart:true }
        : { root:r, mode:'arps',   arpName:tn,   arpCat:tc,   _autoStart:true };
      pedalBus.rebuildPedal('runner', settings);
      return;
    }
  } else if (blk.cat === 'chords') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('progression', { root:r, keyType:tn||'Major', _autoStart:true });
      return;
    }
  } else if (blk.cat === 'rhythm') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('rhythm', { rhythmCat:tc, rhythmPat:tn, _autoStart:true });
    }
  } else if (blk.cat === 'finger') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('finger', { fingerInst:tc, fingerPat:tn, _autoStart:true });
    }
  }
}

function stopPracticePedals() {
  if (!pedalBus.rebuildPedal) return;
  // Signal each pedal type to stop via settings flag
  ['runner','progression','rhythm','finger'].forEach(type => {
    pedalBus.rebuildPedal(type, { _autoStart:false });
  });
}

export function buildPracticeContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let blocks      = s.blocks || PRACTICE_PRESETS[0].blocks.map(b => ({ ...b }));
  let presetName  = s.presetName || 'Quick 15';
  let pmView      = s.pmView || 'session';
  let activeBlock = -1, blockTime = 0, totalTime = 0, sessionActive = false, timerIntv = null;
  let editIdx     = null;

  let history = [];
  try { const raw = localStorage.getItem('resonote-practice-log'); if (raw) history = JSON.parse(raw); } catch(e) {}

  let practiceLib = [];
  try { const raw = localStorage.getItem('resonote-practice-lib'); if (raw) practiceLib = JSON.parse(raw); } catch(e) {}

  // ── Theory exercise library (curriculum drills looped on the fretboard) ──
  let theoryUnit    = s.theoryUnit ?? 0;     // which unit section is expanded
  let theoryBpm     = s.theoryBpm  || 80;
  let theoryPlaying = null;                    // { ui, li } of the looping exercise
  // OPENED is not the same as PLAYING, exactly as the Songbook's loaded piece is not the
  // same as a piece that is sounding. `theoryOpen` decides which of the tab's two faces you
  // see — the shelf of units, or one drill in the shared exercise view — and it survives a
  // ■ Stop so the drill you were on stays in front of you to look back over.
  let theoryOpen    = null;                    // { ui, li } of the drill on screen

  // ── The step strip: the WHOLE drill, laid out ─────────────────────────────
  // A looping drill you can only HEAR is a peephole — one gold dot at a time, and if you fall
  // off there is nothing either side of it to rejoin by. The strip prints every step of the
  // plan up front (note names, bar lines, section flags) and runs a playhead through it. Built
  // ONCE when a drill starts; the playhead is repainted in place per step, never re-rendered.
  const STRIP_ID  = 'pm-th-' + p.id;
  // ONE skin object, spread into the build AND into every repaint. The strip is drawn once
  // and then painted in place, so a build and a repaint that disagree about accent/dim/line
  // flip every chip's border on the first step. Tokens rather than a hex, so the strip wears
  // whatever accent the card hands down — the same one the Session and Songbook tabs wear.
  const STRIP_SKIN = { accent: 'var(--rk-accent)', dim: 'var(--rk-ink-mute)', line: 'var(--rk-edge-soft)' };
  let theoryPlan  = null;   // the plan currently laid out on the strip
  let theoryStrip = null;   // { steps, sections, title }
  let theoryStripI = 0;     // where the playhead sits (kept after the loop stops)
  let chordTimers = [];     // chord plans have no onStep, so the strip runs its own mirror clock
  const clearChordTimers = () => { chordTimers.forEach(t => clearTimeout(t)); chordTimers = []; };

  // A chord chip's text, dug out of the plan's long teaching label:
  //   'ii · Dm7 — bass D (root)' → 'ii Dm7'   ·   'C · open' → 'C'
  function shortChordName(lab) {
    const parts = String(lab || '').split('·').map(x => x.trim()).filter(Boolean);
    const num   = parts.find(x => /^[♭b#]?[ivxIVX]+\d?$/.test(x)) || '';
    const name  = (parts.find(x => /^[A-G][♭b#]?/.test(x)) || parts[0] || '?').split(/\s[—=-]\s/)[0].trim();
    const out   = (num && num !== name ? num + ' ' : '') + name;
    return out.length > 13 ? out.slice(0, 12) + '…' : out;
  }
  // Section flags wherever a step's teaching label changes — a contrast drill splits into
  // 'C Major (Ionian)' / 'C Minor (Aeolian)', the slash-chord drill into its seven flavors.
  // Dropped entirely if the labels churn, which would flag half the strip.
  function sectionsOf(steps) {
    const out = []; let last = null;
    steps.forEach((st, i) => {
      let n = (st.label || '').trim(); if (!n) return;
      if (n.length > 20) n = n.split(' · ')[0];
      if (n.length > 20) n = n.split(' — ')[0];
      if (n.length > 20) n = n.slice(0, 19) + '…';
      if (n !== last) { out.push({ at: i, name: n }); last = n; }
    });
    return out.length > 10 ? [] : out;
  }
  // plan → strip contents. Plan durations are in SECONDS, so divide by the beat to get the
  // beat counts the strip draws bar lines from.
  function stripFor(plan) {
    if (!plan) return null;
    const beat  = 60 / Math.max(20, theoryBpm || 80);
    const beats = d => Math.max(0.25, Math.round(((d || beat) / beat) * 4) / 4);
    if (plan.type === 'chords') {
      const steps = (plan.chords || []).map(c => ({
        notes: (c.positions || []).map(pp => ({ si: pp.si, fret: pp.fret })),
        dur:   beats(c.dur),
        label: shortChordName(c.label || c.root)
      }));
      return steps.length ? { steps, sections: [], title: plan.label || '' } : null;
    }
    const raw = planToStripSteps(plan.steps || []);
    if (!raw.length) return null;
    // Drop the per-step label — chips read best as note names, and several drills carry a whole
    // sentence of instruction there. Those labels become the section flags above instead.
    return { steps: raw.map(st => ({ notes: st.notes, dur: beats(st.dur) })), sections: sectionsOf(raw), title: plan.label || '' };
  }
  // ── What the ▶ NOW / NEXT → readout says about one step ───────────────────
  // The shared view draws the two cards; naming a step is the caller's job, because a
  // sketch step is a chord you spelled and a drill step is what the curriculum told you
  // to play. NEXT wraps to 0 the way the strip's own "next" chip does — a drill loops, so
  // the step after the last one really is the first, and that join is where you fall off.
  const sectionNameAt = i => {
    let n = '';
    (theoryStrip?.sections || []).forEach(x => { if (x.at <= i) n = x.name; });
    return n;
  };
  function theoryDesc(i) {
    const plan = theoryPlan;
    if (!plan || !theoryStrip || !theoryStrip.steps.length) return { title: '—', sub: '' };
    const n = theoryStrip.steps.length, k = ((i % n) + n) % n;
    if (plan.type === 'chords') {
      const c = (plan.chords || [])[k];
      if (!c) return { title: '—', sub: '' };
      // The chip had to be cropped to fit; the readout has room for the whole teaching label.
      return { title: shortChordName(c.label || c.root), sub: String(c.label || '') };
    }
    const st = (plan.steps || [])[k];
    if (!st) return { title: '—', sub: '' };
    const names = [...new Set((st.play || []).map(x => x.note))];
    return { title: names.length ? names.join(' ') : 'rest', sub: st.label || sectionNameAt(k) || plan.label || '' };
  }
  // Repainted from whatever ALREADY moves the playhead — never from a clock of its own.
  const refreshTheoryNowNext = () => paintNowNext(p.id, theoryDesc(theoryStripI), theoryDesc(theoryStripI + 1));

  const stripMarkup = () => stepStripHTML(STRIP_ID, {
    steps:    theoryStrip.steps,
    sections: theoryStrip.sections,
    tsig:     metroClock.ts || 4,
    playIdx:  theoryPlaying ? theoryStripI : null,
    selIdx:   theoryPlaying ? null : theoryStripI,
    ...STRIP_SKIN
  });
  function stripWire() {
    if (!theoryStrip || !theoryStrip.steps.length) return;
    wireStepStrip(STRIP_ID, { onPick: i => {
      theoryStripI = i;
      paintStripAt(STRIP_ID, theoryPlaying ? { playIdx: i, ...STRIP_SKIN } : { selIdx: i, ...STRIP_SKIN });
      followStrip(STRIP_ID, i, {});
      refreshTheoryNowNext();
      if (!theoryPlaying) previewStep(i);       // stopped → clicking a chip hears & shows that step
    } });
  }
  // Swap ONLY the strip's own node (used when the tempo restarts a drill) — a full render()
  // there would tear the tempo widget out from under the pointer.
  function refreshStripDOM() {
    const root = document.querySelector(`[data-strip="${STRIP_ID}"]`);
    if (!root || !theoryStrip || !theoryStrip.steps.length) return;
    root.outerHTML = stripMarkup();
    stripWire();
  }
  // Move the playhead WITHOUT rebuilding — a rebuild throws away the scroll position and
  // flickers every note. Above ~140 BPM the strip travels a bar at a time instead of jittering.
  //
  // This is the ONE place the playhead advances, for both plan kinds: a note plan calls it
  // from playPlan's onStep, a chord plan (which fires no onStep) from the mirror timers
  // below. So the NOW/NEXT readout hangs off it too — a second mirror of its own would
  // double-fire on chord drills and step the readout two chips at a time.
  function stripGoto(i) {
    theoryStripI = i;
    paintStripAt(STRIP_ID, { playIdx: i, ...STRIP_SKIN });
    followStrip(STRIP_ID, i, { byBar: (metroClock.bpm || theoryBpm) > 140 });
    refreshTheoryNowNext();
  }
  function followChords(plan) {
    clearChordTimers();
    let t = 0;
    (plan.chords || []).forEach((c, i) => {
      chordTimers.push(setTimeout(() => { if (document.getElementById(`body-${p.id}`)) stripGoto(i); }, t * 1000));
      t += c.dur || 1;
    });
  }
  // Nothing running: clicking a chip lights that step on the neck and sounds it, so the strip
  // is a map you can poke at rather than a read-only ticker.
  function previewStep(i) {
    const plan = theoryPlan; if (!plan) return;
    if (plan.type === 'chords') {
      const c = (plan.chords || [])[i]; if (!c) return;
      setChordHighlight(c.root, c.notes, c.label, c.positions, SEQ_COLORS);
      updateOverlays();
      playChordNotes(c.notes, { dur: 1.1, strum: 0.03, gain: 0.16 });
      return;
    }
    const st = (plan.steps || [])[i]; if (!st) return;
    setChordHighlight(plan.root, plan.notes, st.label || plan.label, plan.positions, plan.colors || SEQ_COLORS, st.focus, null, plan.focusOnly);
    updateOverlays();
    (st.play || []).forEach(pl => playNote(pl.note, pl.octave ?? 3, { dur: 0.9, gain: 0.2 }));
  }

  if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; }   // clear any orphan loop on rebuild
  function stopTheory() {
    if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; }
    clearChordTimers();
    theoryPlaying = null; clearChordHighlight(); updateOverlays();
    // theoryStrip is deliberately KEPT — the run stays on screen to look back over.
  }
  function theoryLessonAt(ui, li) { const u = CURRICULUM.units[ui]; if (!u) return null; return [...u.lessons].sort((a, b) => a.level - b.level)[li] || null; }
  function playTheory(ui, li) {
    if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; }
    clearChordTimers();
    const lesson = theoryLessonAt(ui, li); if (!lesson || !lesson.drill) return;
    metroClock.stopAll();
    const plan = drillToPlan(lesson.drill, theoryBpm);
    if (!plan) return;
    theoryPlaying = { ui, li }; theoryOpen = { ui, li };
    theoryPlan = plan; theoryStrip = stripFor(plan); theoryStripI = 0;   // lay the whole drill out, once
    const alive = () => !!document.getElementById(`body-${p.id}`);
    if (plan.type === 'chords') {
      // A chord plan has no onStep, so mirror its own timing — and re-arm on every loop.
      const stop = playPlan(plan, { loop: true, isAlive: alive, onCycle: () => followChords(plan) });
      followChords(plan);
      p._theoryStop = () => { stop(); clearChordTimers(); };
    } else {
      p._theoryStop = playPlan(plan, { loop: true, isAlive: alive, onStep: i => stripGoto(i) });
    }
  }
  // Closing the drill hands the neck back and returns to the shelf — the mirror image of
  // the Songbook's ← Library, which is the point of the whole exercise.
  // Show a drill's page without sounding a note. Anything already running is
  // stopped first: two drills on screen at once, one of them audible, is the kind
  // of state you cannot reason about with a guitar in your hands.
  function openTheory(ui, li) {
    const lesson = theoryLessonAt(ui, li);
    if (!lesson || !lesson.drill) return;
    if (theoryPlaying) stopTheory();
    theoryOpen = { ui, li };
    // Build the plan and lay the timeline out WITHOUT starting it — the same
    // stripFor() the run uses, so what you read before pressing ▶ is exactly what
    // will play. An empty strip here would make the page look broken until you
    // committed to the drill, which is the problem this is fixing.
    const plan = drillToPlan(lesson.drill, theoryBpm);
    theoryPlan = plan || null;
    theoryStrip = plan ? stripFor(plan) : null;
    theoryStripI = 0;
    render();
  }
  function closeTheory() { stopTheory(); theoryOpen = null; }

  // ── The compact teaching card ─────────────────────────────────────────────
  // "Some of the theory actually being taught, but LESS than the actual theory pedal."
  // Theory Path renders the lesson whole — summary, every point, a demo, the ear tip, then
  // the exercises. Here you are mid-drill with a hand on the neck, so it is one sentence of
  // what this is and one line of why you are playing it, and a door to the long version.
  //
  // This is src/ui/theory-panel.js, not a new card: ten pedals already wear it, it is
  // already collapsible, it already persists the choice, and its 'Learn the theory →' link
  // already opens the lesson. A third theory presentation inside the pedal whose whole
  // problem was having two presentations of one thing would be the same bug again.
  // One shared panel id, deliberately: it teaches you the first time you ever open a drill
  // and stays however you left it after that.
  const firstSentence = t => { const m = String(t || '').match(/^[^.!?]*[.!?]/); return (m ? m[0] : String(t || '')).trim(); };
  function drillTeachHTML(lesson) {
    if (!lesson) return '';
    const t = lesson.teach || {}, d = lesson.drill || {};
    const what = firstSentence(t.summary) || (t.points || [])[0] || '';
    if (!what) return '';
    return theoryPanelHTML('pm-drill', {
      kicker: 'THIS DRILL',
      title:  lesson.title,
      what,
      why:    d.focus ? `🎯 <b>What you're practising:</b> ${d.focus}` : '',
      lessonId: lesson.id,
      lessonLabel: 'Open the full lesson',
    });
  }

  // ── 📖 Songbook: the Song Sketchpad, hosted ───────────────────────────────
  // The sketch is NOT rebuilt per render. PM rewrites its whole body on every view
  // switch and once a SECOND during a live session; rebuilding the sketch at that
  // cadence would drop the selected step, the 🧩 Breakdown view and any half-typed
  // ASCII tab. So ONE host node is built the first time the tab is opened, then
  // DETACHED before each innerHTML write and put back after — removeChild preserves
  // the node, its listeners, its closures and the strip's scroll position.
  //
  // It is handed a DERIVED handle: its own id (so none of its 25 id-derived elements
  // can collide with PM's 'pm-' tempo block or 'pm-th-' strip) wrapped around PM's OWN
  // settings object. The two key sets are disjoint — PM owns blocks/presetName/pmView/
  // theory*, the sketch owns steps/bpm/name/sections/about/tsig/loop/smode/libId — and
  // sharing one object is what lets a migrated sketchpad card keep an unsaved piece.
  // Passing PM's own p instead would let the sketch render over PM's tab row, and its
  // isAlive() probe would then track a node that never disappears: audio forever.
  const SK_ID = p.id + '-lib';
  let skHost  = null;                     // the one persistent node; null until first opened

  if (p._skPedal) {                       // orphan from a previous build of this pedal
    if (p._skPedal._skTeardown) p._skPedal._skTeardown();
    p._skPedal = null;                    // its DOM node dies with the render below
  }
  function skPedal() {
    if (!p._skPedal) p._skPedal = { id: SK_ID, settings: s, libExtra: { html: songbookRowsHTML, wire: wireSongbookRows } };
    return p._skPedal;
  }
  function stopSketch() { if (p._skPedal && p._skPedal._skTeardown) p._skPedal._skTeardown(); }
  function detachSketch() { if (skHost && skHost.parentNode) skHost.parentNode.removeChild(skHost); }
  function mountSketch() {
    const slot = el.querySelector('.pm-sk-slot');
    if (!slot) return;
    if (skHost) {
      slot.appendChild(skHost);
      // Re-render on re-entry: the shared tempo painter self-prunes while the node is
      // out of the document and will not re-register on an already-wired one.
      if (p._skPedal && p._skPedal._skRemount) p._skPedal._skRemount();
      return;
    }
    skHost = document.createElement('div');
    skHost.id = 'body-' + SK_ID;          // what buildSketchpadContent renders into AND probes
    skHost.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto';
    slot.appendChild(skHost);             // must be in the document before the build
    buildSketchpadContent(skPedal());     // lazily, exactly once per Practice Manager mount
  }

  // ── PM's own saved rows, injected into the sketch's library list ──────────
  // 'resonote-practice-lib' holds two incompatible shapes: songdir-era chord
  // progressions ({title, artist, key, prog}) and timed session plans ({title,
  // blocks:[…]}). A plan has no representation as a sketch, so NOTHING is migrated and
  // nothing is moved — both shapes are read live and shown on the same shelf as the
  // sketches. A progression loads onto the timeline; a plan loads back into the Session
  // builder, which is more than it could do before (previously it only had a ✕).
  // These rows sit on the SAME shelf as the sketch rows, so they are built from the same
  // tokens the sketch uses — panel2 button on an edge-soft border, panel row, accent stripe.
  const SB_BTN = `background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:calc(7px*var(--ui));padding:3px 4px;cursor:pointer;`;
  const SB_ROW = `background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-left:3px solid var(--rk-accent);border-radius:5px;padding:6px 8px`;
  const sbEsc  = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function songbookRowsHTML() {
    const head = t => `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1.5px;margin-top:4px">${t}</div>`;
    const dstr = d => d ? ' · ' + new Date(d).toLocaleDateString() : '';
    // Partition so EVERY entry lands in exactly one list — an unreachable row is a lost row.
    const songs = [], plans = [];
    practiceLib.forEach((it, i) => (it && it.prog ? songs : plans).push({ it, i }));

    let x = head('MY PRACTICE PLANS');
    plans.forEach(({ it, i }) => {
      const bs = Array.isArray(it.blocks) ? it.blocks : [];
      const mins = bs.reduce((a, b) => a + (b.mins || 0), 0);
      x += `<div style="display:flex;align-items:center;gap:6px;${SB_ROW}">
        <span style="flex:1;min-width:0">
          <span class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🎯 ${sbEsc(it.title || 'Practice')}</span>
          <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${bs.length} block${bs.length === 1 ? '' : 's'} · ${mins} min${dstr(it.date)}</span></span>
        <button class="pm-plan-use" data-li="${i}" style="${SB_BTN}color:var(--rk-accent);border-color:var(--rk-line)">▶ Use</button>
        <button class="pm-lib-del"  data-li="${i}" style="${SB_BTN}color:var(--rk-stop);border-color:var(--rk-stop-edge)">✕</button></div>`;
    });
    if (!plans.length) x += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));padding:3px 2px">No saved plans yet.</div>`;
    x += `<button class="pm-save-session" style="${SB_BTN}width:100%;padding:5px;color:var(--rk-accent);border-color:var(--rk-line)">💾 Save the current session as a plan</button>`;

    if (songs.length) {
      x += head('MY SAVED SONGS');
      songs.forEach(({ it, i }) => {
        const n = String(it.prog).split(/\s+/).filter(Boolean).length;
        // Four launch buttons in four different hues was the old way of telling them apart.
        // The emoji already does that; the colour was only ever noise, and four saturated
        // hues inside one row is exactly what made this shelf look like a different product.
        x += `<div style="${SB_ROW}">
          <div style="display:flex;align-items:center;gap:5px">
            <span class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sbEsc(it.title || 'Untitled')}</span>
            ${it.key ? `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">${sbEsc(it.key)}</span>` : ''}
            <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">${n} chord${n === 1 ? '' : 's'}${dstr(it.date)}</span></div>
          ${it.artist ? `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui))">${sbEsc(it.artist)}</div>` : ''}
          <div class="mono" style="color:var(--rk-dim);font-size:calc(7px*var(--ui));margin-top:2px;word-spacing:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sbEsc(it.prog)}</div>
          <div style="display:flex;gap:3px;margin-top:4px">
            <button class="pm-song-load"   data-li="${i}" style="flex:1;${SB_BTN}color:var(--rk-accent);border-color:var(--rk-line)">▶ Timeline</button>
            <button class="pm-song-chords" data-li="${i}" style="flex:1;${SB_BTN}color:var(--rk-ink-dim)">🔁 Chords</button>
            <button class="pm-song-groove" data-li="${i}" style="flex:1;${SB_BTN}color:var(--rk-ink-dim)">🥁 Groove</button>
            <button class="pm-song-finger" data-li="${i}" style="flex:1;${SB_BTN}color:var(--rk-ink-dim)">🤚 Finger</button>
            <button class="pm-lib-del"     data-li="${i}" style="${SB_BTN}color:var(--rk-stop);border-color:var(--rk-stop-edge)">✕</button>
          </div></div>`;
      });
    }
    return x;
  }
  // `rerender` redraws the SHELF only. Calling PM's render() from here would rebuild the
  // sketch host underneath the click for no reason.
  function wireSongbookRows(host, rerender) {
    host.querySelectorAll('.pm-plan-use').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const it = practiceLib[parseInt(b.dataset.li)];
      const bs = it && Array.isArray(it.blocks) ? it.blocks : [];
      if (!bs.length) return;
      // A saved plan stores only {label, cat, mins}. Anything with a category but no
      // chosen key is rolled fresh at START — which is exactly what 🎲 random means.
      blocks = bs.map(b2 => ({ label: b2.label || 'Block', cat: b2.cat || 'free', mins: b2.mins || 5, random: !!b2.cat && b2.cat !== 'free' }));
      presetName = it.title || presetName; editIdx = null;
      stopSketch(); pmView = 'session'; render();
    }));
    host.querySelectorAll('.pm-song-load').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const it = practiceLib[parseInt(b.dataset.li)]; if (!it || !it.prog) return;
      // Chord symbols → one bar per chord, voiced with a real open-position grip.
      skPedal()._skLoad({ name: it.title || '', steps: songToSteps(it.prog), about: [it.artist, it.key].filter(Boolean).join(' · ') });
    }));
    host.querySelectorAll('.pm-song-chords').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); const item = practiceLib[parseInt(b.dataset.li)]; if (!item || !item.prog) return;
      loadProgIntoBuilder(item.prog);
    }));
    host.querySelectorAll('.pm-song-groove').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('rhythm', { rhyChordMode:'per-step', _autoStart:true });
    }));
    host.querySelectorAll('.pm-song-finger').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); const item = practiceLib[parseInt(b.dataset.li)]; if (!item) return;
      const fc = item.prog ? item.prog.split(/\s+/)[0] : 'Am';
      if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('finger', { fChordRoot:fc, fChordMode:'chord', _autoStart:true });
    }));
    host.querySelectorAll('.pm-lib-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      practiceLib.splice(parseInt(b.dataset.li), 1);
      try { localStorage.setItem('resonote-practice-lib', JSON.stringify(practiceLib)); } catch (e2) {}
      rerender();
    }));
    host.querySelector('.pm-save-session')?.addEventListener('click', e => {
      e.stopPropagation();
      const name = window.prompt('Name this practice:');
      if (!name) return;
      practiceLib.push({ title:name, prog:'', date:new Date().toISOString(), blocks:blocks.map(b2 => ({ label:b2.label, cat:b2.cat, mins:b2.mins })) });
      // Trim the in-memory copy too — writing a truncated array while keeping the long
      // one in hand would put every row's data-li index one behind the stored list.
      if (practiceLib.length > 50) practiceLib = practiceLib.slice(-50);
      try { localStorage.setItem('resonote-practice-lib', JSON.stringify(practiceLib)); } catch (e2) {}
      rerender();
    });
  }
  // Shared by the 🔁 Chords row button: a chord-symbol string → the Progression pedal's grid.
  function loadProgIntoBuilder(prog) {
    const chords2 = prog.split(/\s+/).filter(x => x);
    if (!chords2.length) return;
    const bars = Math.max(4, Math.ceil(chords2.length / 4) * 4);
    const grid = new Array(bars * 4).fill(null);
    const qMap = { '':'Major','m':'Minor','7':'Major','m7':'Minor','maj7':'Major','dim':'Dim','aug':'Aug' };
    chords2.forEach((ch, ci) => {
      if (ci < grid.length) {
        let rn = ch.length>1 && (ch[1]==='#'||ch[1]==='b') ? ch.slice(0,2) : ch[0];
        grid[ci * Math.floor(bars*4/chords2.length)] = { root: rn, quality: qMap[ch.slice(rn.length).toLowerCase()]||'Major', numeral:ch };
      }
    });
    if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('progression', { progMode:'custom', gridBars:bars, customGrid:grid, _autoStart:true });
  }

  function getStreak() {
    if (!history.length) return 0;
    let streak = 0;
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    let checkDate = new Date();
    const today = new Date().toDateString();
    if (sorted[0] && new Date(sorted[0].date).toDateString() === today) { streak = 1; checkDate.setDate(checkDate.getDate() - 1); }
    const start = sorted[0] && new Date(sorted[0].date).toDateString() === today ? 1 : 0;
    for (let i = start; i < sorted.length; i++) {
      if (new Date(sorted[i].date).toDateString() === checkDate.toDateString()) {
        streak++; checkDate.setDate(checkDate.getDate() - 1);
      } else break;
    }
    return streak;
  }

  // ── The session clock, held to the same liveness contract as every other loop ──
  // The ticker is not a private timer: it rewrites this pedal's whole body once a second,
  // and at each block boundary it rebuilds and re-starts OTHER pedals on the board. So it
  // gets both halves of the contract the theory loop and the sketch already have.
  //  · a probe, because closing the card is all main.js does to stop a pedal — a dead
  //    closure would keep painting a detached node and would log a phantom session.
  //  · a handle on `p`, because a rebuild (the 'Loop in Theory library' deep link rebuilds
  //    this pedal in place) makes a NEW closure over the SAME node while the old one is
  //    still ticking; a second later the loser overwrites the winner's fresh DOM and every
  //    handler attached to it. The probe cannot catch that one — the node is still there.
  if (p._pmTick) { clearInterval(p._pmTick); p._pmTick = null; }   // orphan clock from a previous build
  function stopTick() {
    if (!timerIntv) return;
    clearInterval(timerIntv);
    if (p._pmTick === timerIntv) p._pmTick = null;
    timerIntv = null;
  }

  function startSession() {
    stopTheory(); stopSketch();      // a session owns the neck; nothing else may still be looping on it
    sessionActive = true; activeBlock = 0; blockTime = 0; totalTime = 0; editIdx = null;
    blocks.forEach(b => {
      if (b.random && b.cat && b.cat !== 'free') {
        const a = randomPracticeAssignment(b.cat);
        b.root = a.root; b.typeName = a.typeName; b.typeCat = a.typeCat; b.assignment = a.label;
      } else if (b.cat !== 'free' && b.root && b.typeName) {
        if (b.cat === 'scales')      b.assignment = `${b.root} ${b.typeName}`;
        else if (b.cat === 'arps')   b.assignment = `${b.root} ${b.typeName} Arp`;
        else if (b.cat === 'chords') b.assignment = `Key of ${b.root} ${b.typeName}`;
      } else { b.assignment = ''; }
    });
    applyBlockToFretboard(blocks[0]);
    timerIntv = p._pmTick = setInterval(() => {
      if (!document.getElementById(`body-${p.id}`)) { stopTick(); return; }   // card closed → this clock is dead
      blockTime++; totalTime++;
      if (blockTime >= blocks[activeBlock].mins * 60) {
        if (activeBlock < blocks.length - 1) {
          activeBlock++; blockTime = 0;
          applyBlockToFretboard(blocks[activeBlock]);
        } else { finishSession(); return; }
      }
      render();
    }, 1000);
    render();
  }

  function finishSession() {
    stopTick();
    const entry = { date: new Date().toISOString(), duration: totalTime, blocks: blocks.map(b => b.assignment || b.label), preset: presetName };
    history.push(entry);
    try { localStorage.setItem('resonote-practice-log', JSON.stringify(history.slice(-100))); } catch(e) {}
    sessionActive = false; activeBlock = -1; blockTime = 0;
    stopPracticePedals(); clearChordHighlight(); updateOverlays(); render();
  }

  function stopSession() {
    if (totalTime > 30) {
      const entry = { date: new Date().toISOString(), duration: totalTime, blocks: blocks.slice(0, activeBlock + 1).map(b => b.assignment || b.label), preset: presetName, partial: true };
      history.push(entry);
      try { localStorage.setItem('resonote-practice-log', JSON.stringify(history.slice(-100))); } catch(e) {}
    }
    stopTick();
    sessionActive = false; activeBlock = -1; blockTime = 0; totalTime = 0;
    stopPracticePedals(); clearChordHighlight(); updateOverlays(); render();
  }

  function fmtTime(secs) {
    const m = Math.floor(secs / 60), ss = secs % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function render() {
    const streak    = getStreak();
    const totalMins = blocks.reduce((a, b) => a + b.mins, 0);
    const catIcons  = { scales:'🎼', chords:'🎵', arps:'🎶', rhythm:'🥁', finger:'🤚', ear:'👂', free:'🎸' };
    const catLabels = { scales:'Scale', chords:'Chords', arps:'Arpeggio', rhythm:'Rhythm', finger:'Finger', ear:'Ear', free:'Free Play' };
    const catLabels2 = { scales:'Scales', chords:'Chord changes', arps:'Arpeggios', rhythm:'Rhythm drills', finger:'Finger technique', ear:'Ear training', free:'Free play' };

    // class="rk" ONCE, at the root. Every token below is declared on .rk, and so is every
    // token the hosted Songbook uses — the sketch mounts inside this node, so one class here
    // is what makes all three tabs wear the card's accent instead of three of their own.
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px;height:100%;min-height:0">`;
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:2px 0">`;
    h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(20px*var(--ui));font-weight:900">${streak}</span>`;
    h += `<span class="mono" style="color:var(--rk-dim);font-size:calc(9px*var(--ui))">day${streak!==1?'s':''} streak</span>`;
    if (streak >= 7) h += `<span style="font-size:calc(14px*var(--ui))">🔥</span>`;
    h += `</div>`;

    if (!sessionActive) {
      h += `<div class="rk-seg" style="gap:3px;flex-wrap:nowrap">`;
      h += `<button class="rk-seg-btn pm-view${pmView==='session'?' is-active':''}" data-pv="session" style="flex:1;font-size:calc(8px*var(--ui))">Session</button>`;
      h += `<button class="rk-seg-btn pm-view${pmView==='theory'?' is-active':''}" data-pv="theory" style="flex:1;font-size:calc(8px*var(--ui))">🎓 Theory</button>`;
      // No longer a list of saved practices — it is the whole Song Sketchpad: your pieces,
      // the reference songs, the timeline, the 🧩 Breakdown, and your saved plans on the
      // same shelf. 'Songbook' is what that is.
      h += `<button class="rk-seg-btn pm-view${pmView==='library'?' is-active':''}" data-pv="library" style="flex:1;font-size:calc(8px*var(--ui))">📖 Songbook</button>`;
      h += `</div>`;
    }

    // ── 🎓 Theory, in two faces ───────────────────────────────────────────────
    // The shelf of units, and ONE drill open in the shared exercise view — exactly the
    // Songbook's library ↔ piece pair, because opening a drill and opening a piece are the
    // same move. Before this, the tab showed a tempo box and a bare strip stacked above the
    // shelf forever, so a running drill had no title, no NOW/NEXT, and nowhere to come back
    // from; the same pedal presented a running exercise two different ways.
    const thLesson = theoryOpen ? theoryLessonAt(theoryOpen.ui, theoryOpen.li) : null;
    if (pmView === 'theory' && !sessionActive && thLesson && theoryStrip && theoryStrip.steps.length) {
      const running = !!theoryPlaying;
      // Below the timeline is the drill's own business, so it rides in as the view's foot —
      // the same rk-btn transport the Songbook's ▶ Play wears, on the same accent.
      let foot = `<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">`;
      // One token, not three inline rules: .rk-btn.is-active draws its text, rim and
      // wash from --rk-accent, so re-pointing that single variable on the button
      // reddens the whole thing together while it is showing ⏹.
      foot += `<button class="th-toggle rk-btn is-active" style="font-size:calc(10px*var(--ui));padding:6px 12px;letter-spacing:.5px${running ? ';--rk-accent:var(--rk-stop);--rk-line:var(--rk-stop-edge)' : ''}">${running ? '⏹ Stop' : '▶ Play'}</button>`;
      foot += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));flex:1;min-width:0">Loops until you stop it — follow the gold chip, and tap any chip to hear that step.</span>`;
      foot += `</div>`;
      h += exerciseViewHTML(p.id, {
        back: { label: '← Drills', title: 'Back to the theory shelf' },
        // The drill's own name is the piece title here. The plan's label (what key, which
        // position) is detail, so it rides in the meta row beside the RUNNING lamp.
        title: { text: (thLesson.drill && thLesson.drill.title) || thLesson.title },
        now: theoryDesc(theoryStripI), next: theoryDesc(theoryStripI + 1),
        tempo: { min: 30, max: 280 },
        // RUNNING is the lamp turned up — the pedal's own accent, brighter. Not a second colour.
        metaLeft: `<span class="mono" style="color:${running ? 'var(--rk-hot)' : 'var(--rk-ink-mute)'};font-size:calc(7px*var(--ui));letter-spacing:1px;flex-shrink:0">${running ? '▶ RUNNING' : '■ LAST RUN'}</span>`
                + `<span class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${theoryStrip.title}</span>`,
        metaRight: `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${theoryStrip.steps.length} step${theoryStrip.steps.length === 1 ? '' : 's'}</span>`,
        strip: stripMarkup(),
        teach: drillTeachHTML(thLesson),
        foot,
      });

    } else if (pmView === 'theory' && !sessionActive) {
      h += `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));line-height:1.4;text-align:center;padding:1px 4px">Looping practice for every Theory Path drill — open one and follow the gold note up the neck.</div>`;
      // Units → drills (flex-shrink:0 keeps each unit its natural height so the list scrolls).
      // flex:1 instead of a fixed max-height → the list GROWS with the pedal when resized taller.
      h += `<div style="display:flex;flex-direction:column;gap:4px;flex:1;min-height:220px;overflow-y:auto;padding-right:2px">`;
      CURRICULUM.units.forEach((u, ui) => {
        const lessons = [...u.lessons].sort((a, b) => a.level - b.level);
        const drills  = lessons.filter(l => l.drill).length;
        const expanded = theoryUnit === ui;
        h += `<div style="border:1px solid var(--rk-edge-soft);border-radius:6px;overflow:hidden;flex-shrink:0">`;
        h += `<div class="th-unit" data-ui="${ui}" style="display:flex;align-items:center;gap:6px;padding:7px 9px;cursor:pointer;background:var(--rk-soft)">
          <span style="font-size:calc(12px*var(--ui))">${u.icon || '🎓'}</span>
          <span class="mono" style="color:var(--rk-accent);font-size:calc(11px*var(--ui));font-weight:700;flex:1">${u.title}</span>
          <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${drills} drill${drills!==1?'s':''}</span>
          <span class="mono" style="color:var(--rk-accent);font-size:calc(9px*var(--ui))">${expanded ? '▾' : '▸'}</span></div>`;
        if (expanded) {
          h += `<div style="padding:4px 6px;display:flex;flex-direction:column;gap:3px">`;
          lessons.forEach((l, li) => {
            if (!l.drill) return;
            const isPlaying = theoryPlaying && theoryPlaying.ui === ui && theoryPlaying.li === li;
            // The ROW opens the drill; ▶ starts it. Opening used to be a side effect
            // of pressing play, so the only way to find out what a drill taught was
            // to already be playing it — backwards for the one moment you are
            // choosing what to practise. Now you can read the teaching card, see the
            // whole run laid out, and then decide.
            h += `<div class="th-open" data-ui="${ui}" data-li="${li}" title="Open this drill — read it before you run it"
              style="background:${isPlaying?'var(--rk-soft2)':'var(--rk-panel2)'};border:1px solid ${isPlaying?'var(--rk-line)':'var(--rk-edge-soft)'};border-radius:5px;padding:5px 7px;display:flex;align-items:center;gap:6px;cursor:pointer">
              <div style="flex:1;min-width:0">
                <div class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));font-weight:600">${l.title}</div>
                <div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui));overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎯 ${l.drill.focus || l.drill.title}</div>
              </div>
              <button class="th-play mono" data-ui="${ui}" data-li="${li}" title="${isPlaying?'Stop':'Start this drill'}"
                style="background:${isPlaying?'var(--rk-stop-soft)':'var(--rk-soft)'};border:1px solid ${isPlaying?'var(--rk-stop-edge)':'var(--rk-line)'};color:${isPlaying?'var(--rk-stop)':'var(--rk-accent)'};border-radius:6px;padding:5px 11px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700">${isPlaying?'■':'▶'}</button>
            </div>`;
          });
          h += `</div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;

    } else if (pmView === 'library' && !sessionActive) {
      // Nothing is drawn here. mountSketch() drops the persistent sketch host into this
      // slot AFTER the innerHTML write below, and PM's own saved rows ride into the
      // sketch's library list through libExtra — one shelf, not two.
      h += `<div class="pm-sk-slot" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>`;

    } else if (!sessionActive) {
      h += `<div class="rk-seg" style="gap:3px">`;
      PRACTICE_PRESETS.forEach(pr => {
        h += `<button class="rk-seg-btn prac-pr${presetName === pr.name ? ' is-active' : ''}" data-pr="${pr.name}" style="font-size:calc(8px*var(--ui))">${pr.name}</button>`;
      });
      h += `</div>`;

      h += `<div style="display:flex;flex-direction:column;gap:3px">`;
      blocks.forEach((b, i) => {
        const icon   = catIcons[b.cat] || '';
        const isEdit = editIdx === i;
        const specific  = !b.random && b.root && b.typeName;
        const specLabel = specific
          ? (b.cat === 'scales' ? `${b.root} ${b.typeName}` : b.cat === 'arps' ? `${b.root} ${b.typeName}` : b.cat === 'chords' ? `${b.root} ${b.typeName}` : '')
          : '';
        h += `<div class="prac-block" data-bi="${i}" style="background:${isEdit?'var(--rk-soft2)':'var(--rk-soft)'};border:1px solid ${isEdit?'var(--rk-line)':'var(--rk-edge-soft)'};border-radius:5px;padding:5px 8px;cursor:pointer">`;
        h += `<div style="display:flex;align-items:center;gap:4px">`;
        h += `<span style="font-size:calc(10px*var(--ui))">${icon}</span>`;
        h += `<span class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));flex:1">${b.label}</span>`;
        // A chosen key/scale is the block's headline, a 🎲 is the absence of one — accent
        // against ink-mute says that without a second hue.
        if (specific) h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(8px*var(--ui))">${specLabel}</span>`;
        else if (b.cat !== 'free') h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">🎲 random</span>`;
        h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(10px*var(--ui));font-weight:700">${b.mins}m</span>`;
        h += `</div>`;
        if (isEdit) {
          h += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--rk-edge-soft)">`;
          h += `<div class="rk-seg" style="gap:3px;margin-bottom:4px;flex-wrap:nowrap">`;
          ['scales','chords','arps','rhythm','finger','ear','free'].forEach(cat => {
            h += `<button class="rk-chip edit-cat${b.cat===cat?' is-active':''}" data-cat="${cat}" style="flex:1;font-size:calc(7px*var(--ui));padding:4px 2px">${catLabels[cat]}</button>`;
          });
          h += `</div>`;
          h += `<div style="display:flex;gap:3px;align-items:center;margin-bottom:4px"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">MINS</span>`;
          [3,5,8,10,15].forEach(m => {
            h += `<button class="rk-chip edit-mins${b.mins===m?' is-active':''}" data-mins="${m}" style="font-size:calc(7px*var(--ui));min-width:22px;padding:4px 5px">${m}</button>`;
          });
          h += `</div>`;
          if (b.cat && b.cat !== 'free') {
            h += `<div style="display:flex;gap:3px;margin-bottom:4px">`;
            h += `<button class="rk-chip edit-rand${b.random?' is-active':''}" data-rand="1" style="flex:1;font-size:calc(7px*var(--ui));padding:4px 5px">🎲 Random</button>`;
            h += `<button class="rk-chip edit-rand${!b.random?' is-active':''}" data-rand="0" style="flex:1;font-size:calc(7px*var(--ui));padding:4px 5px">Choose</button>`;
            h += `</div>`;
            if (!b.random) {
              h += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:3px">`;
              NOTES.forEach(n => {
                h += `<button class="rk-chip edit-root${(b.root||'C')===n?' is-active':''}" data-r="${n}" style="font-size:calc(7px*var(--ui));min-width:22px;padding:2px 4px">${n}</button>`;
              });
              h += `</div>`;
              const types = b.cat === 'scales' ? SCALE_TYPES : b.cat === 'arps' ? ARP_TYPES : null;
              if (types) {
                h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
                Object.entries(types).forEach(([cat2, items]) => {
                  Object.keys(items).forEach(name => {
                    const act = b.typeName === name && b.typeCat === cat2;
                    h += `<button class="rk-chip edit-type${act?' is-active':''}" data-tn="${name}" data-tc="${cat2}" style="font-size:calc(6px*var(--ui));padding:2px 4px">${name}</button>`;
                  });
                });
                h += `</div>`;
              } else if (b.cat === 'chords') {
                h += `<div style="display:flex;gap:3px">`;
                ['Major','Minor','Dorian'].forEach(kt => {
                  h += `<button class="rk-chip edit-type${b.typeName===kt?' is-active':''}" data-tn="${kt}" data-tc="key" style="flex:1;font-size:calc(7px*var(--ui));padding:4px 5px">${kt}</button>`;
                });
                h += `</div>`;
              }
            }
          }
          h += `<div style="display:flex;gap:3px;margin-top:4px">`;
          if (i > 0)              h += `<button class="rk-chip edit-move" data-dir="-1" style="font-size:calc(8px*var(--ui));padding:2px 6px">▲</button>`;
          if (i < blocks.length - 1) h += `<button class="rk-chip edit-move" data-dir="1" style="font-size:calc(8px*var(--ui));padding:2px 6px">▼</button>`;
          h += `<button class="rk-chip edit-remove" style="font-size:calc(7px*var(--ui));color:var(--rk-stop);margin-left:auto">✕ Remove</button>`;
          h += `</div></div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;
      h += `<button class="rk-btn prac-add" style="font-size:calc(8px*var(--ui));width:100%;padding:6px 10px;color:var(--rk-accent);border-color:var(--rk-line)">+ Add block</button>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">Total: ${totalMins} min · Tap a block to customize</div>`;
      h += `<button class="prac-start rk-btn is-active mono" style="border-radius:8px;padding:8px 20px;font-size:calc(12px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">▶ START SESSION</button>`;

    } else {
      const blk = blocks[activeBlock];
      const blockSecs = blk.mins * 60;
      const remaining = blockSecs - blockTime;
      const pct = Math.min(100, (blockTime / blockSecs) * 100);
      h += `<div style="background:var(--rk-panel);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--rk-accent);border-radius:6px;transition:width 1s linear"></div></div>`;
      h += `<div style="text-align:center;padding:6px 0">`;
      h += `<div class="mono" style="color:var(--rk-accent);font-size:calc(8px*var(--ui));letter-spacing:1px">BLOCK ${activeBlock+1} OF ${blocks.length}</div>`;
      // The block you are ON is the lit one — --rk-hot, the same "this pedal is running"
      // brightness the transport and the ▶ RUNNING flag use.
      h += `<div class="mono" style="color:var(--rk-hot);font-size:calc(16px*var(--ui));font-weight:800;margin:4px 0">${blk.label}</div>`;
      if (blk.assignment) {
        h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin:2px 0">`;
        h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(13px*var(--ui));font-weight:700">${blk.assignment}</span>`;
        if (blk.random) h += `<button class="prac-reroll mono" style="background:var(--rk-soft);border:1px solid var(--rk-line);color:var(--rk-accent);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:calc(8px*var(--ui));font-weight:700">🎲</button>`;
        h += `</div>`;
      }
      h += `<div class="mono" style="color:var(--rk-accent);font-size:calc(28px*var(--ui));font-weight:900">${fmtTime(remaining)}</div>`;
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">Session: ${fmtTime(totalTime)}</div>`;
      h += `</div>`;
      h += `<div style="display:flex;flex-direction:column;gap:2px">`;
      blocks.forEach((b, i) => {
        const done = i < activeBlock, current = i === activeBlock;
        const bg    = done ? 'var(--rk-soft2)' : current ? 'var(--rk-soft)' : 'var(--rk-panel2)';
        const color = done ? 'var(--rk-dim)' : current ? 'var(--rk-hot)' : 'var(--rk-ink-mute)';
        h += `<div style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:${bg}">`;
        h += `<span class="mono" style="color:${color};font-size:calc(8px*var(--ui));font-weight:700">${done?'✓ ':''}${b.label}</span>`;
        if (b.assignment) h += `<span class="mono" style="color:${done?'var(--rk-dim)':current?'var(--rk-accent)':'var(--rk-ink-mute)'};font-size:calc(7px*var(--ui));margin-left:4px">${b.assignment}</span>`;
        h += `<span class="mono" style="color:${color};font-size:calc(8px*var(--ui));margin-left:auto">${b.mins}m</span>`;
        h += `</div>`;
      });
      h += `</div>`;
      h += `<button class="prac-stop mono" style="background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);color:var(--rk-stop);border-radius:8px;padding:6px 20px;cursor:pointer;font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:1px;width:100%">■ END SESSION</button>`;
    }

    if (history.length && !sessionActive && pmView === 'session') {
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px;text-transform:uppercase;margin-top:4px">Recent</div>`;
      history.slice(-3).reverse().forEach(entry => {
        const d = new Date(entry.date);
        const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
        const mins = Math.round(entry.duration / 60);
        h += `<div style="display:flex;align-items:center;gap:4px;padding:1px 0">`;
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui))">${dateStr}</span>`;
        h += `<span class="mono" style="color:var(--rk-ink-dim);font-size:calc(7px*var(--ui));flex:1">${entry.preset||''}${entry.partial?' · partial':''}</span>`;
        h += `<span class="mono" style="color:var(--rk-accent);font-size:calc(7px*var(--ui));font-weight:700">${mins}m</span>`;
        h += `</div>`;
      });
    }
    h += `</div>`;
    // Rescue the sketch BEFORE the wipe. Synchronous, so playPlan's isAlive() — which
    // only ever runs from a setTimeout callback — cannot observe the node being away.
    detachSketch();
    el.innerHTML = h;

    // Wire
    el.querySelectorAll('.prac-pr').forEach(b => b.onclick = e => {
      e.stopPropagation(); presetName = b.dataset.pr;
      const pr = PRACTICE_PRESETS.find(x => x.name === presetName);
      if (pr) blocks = pr.blocks.map(b2 => ({ ...b2 }));
      editIdx = null; render();
    });
    el.querySelectorAll('.prac-block').forEach(b => b.onclick = e => {
      // The editor's own chips live INSIDE the block row, so a click on one must not also
      // toggle the row shut. Any button will do as the test — the row itself is a div.
      if (e.target.closest('button')) return;
      e.stopPropagation(); const bi = parseInt(b.dataset.bi);
      editIdx = editIdx === bi ? null : bi; render();
    });
    el.querySelectorAll('.edit-cat').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      blocks[editIdx].cat = b.dataset.cat; blocks[editIdx].label = catLabels2[b.dataset.cat] || 'Block';
      if (b.dataset.cat === 'free') { blocks[editIdx].random = false; blocks[editIdx].root = ''; blocks[editIdx].typeName = ''; }
      else if (!blocks[editIdx].root) blocks[editIdx].random = true;
      render();
    });
    el.querySelectorAll('.edit-mins').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].mins = parseInt(b.dataset.mins); render(); });
    el.querySelectorAll('.edit-rand').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      const isRand = b.dataset.rand === '1';
      blocks[editIdx].random = isRand;
      if (!isRand && !blocks[editIdx].root) blocks[editIdx].root = 'C';
      render();
    });
    el.querySelectorAll('.edit-root').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].root = b.dataset.r; render(); });
    el.querySelectorAll('.edit-type').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].typeName = b.dataset.tn; blocks[editIdx].typeCat = b.dataset.tc; render(); });
    el.querySelectorAll('.edit-move').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      const dir = parseInt(b.dataset.dir), ni = editIdx + dir;
      if (ni >= 0 && ni < blocks.length) { const tmp = blocks[editIdx]; blocks[editIdx] = blocks[ni]; blocks[ni] = tmp; editIdx = ni; }
      render();
    });
    el.querySelector('.edit-remove')?.addEventListener('click', e => {
      e.stopPropagation(); if (editIdx !== null && blocks.length > 1) { blocks.splice(editIdx, 1); editIdx = null; render(); }
    });
    el.querySelector('.prac-add')?.addEventListener('click',  e => { e.stopPropagation(); blocks.push({ label:'Scales', cat:'scales', mins:5, random:true }); editIdx = blocks.length - 1; render(); });
    el.querySelector('.prac-start')?.addEventListener('click', e => { e.stopPropagation(); startSession(); });
    el.querySelector('.prac-stop') ?.addEventListener('click', e => { e.stopPropagation(); stopSession();  });
    el.querySelector('.prac-reroll')?.addEventListener('click', e => {
      e.stopPropagation();
      const blk2 = blocks[activeBlock];
      if (blk2 && blk2.random && blk2.cat && blk2.cat !== 'free') {
        const a = randomPracticeAssignment(blk2.cat);
        blk2.root = a.root; blk2.typeName = a.typeName; blk2.typeCat = a.typeCat; blk2.assignment = a.label;
        applyBlockToFretboard(blk2); render();
      }
    });
    // Leaving a view stops what that view started. Both drills and the sketch write
    // GLOBAL neck state, so silence is not enough — the fretboard has to be handed back
    // or their dots stay pinned over whatever pedal you look at next.
    el.querySelectorAll('.pm-view').forEach(b => b.onclick = e => {
      e.stopPropagation();
      if (pmView === 'theory'  && b.dataset.pv !== 'theory')  stopTheory();
      if (pmView === 'library' && b.dataset.pv !== 'library') stopSketch();
      pmView = b.dataset.pv; render();
    });

    // Theory library
    el.querySelectorAll('.th-unit').forEach(b => b.onclick = e => { e.stopPropagation(); const ui = parseInt(b.dataset.ui); theoryUnit = theoryUnit === ui ? -1 : ui; render(); });
    // Open WITHOUT playing — the whole point of the two-face tab. The ▶ inside the
    // row stops the event before it reaches here, so the two never fight.
    el.querySelectorAll('.th-open').forEach(b => b.onclick = e => {
      e.stopPropagation();
      openTheory(parseInt(b.dataset.ui), parseInt(b.dataset.li));
    });
    el.querySelectorAll('.th-play').forEach(b => b.onclick = e => {
      e.stopPropagation(); const ui = parseInt(b.dataset.ui), li = parseInt(b.dataset.li);
      if (theoryPlaying && theoryPlaying.ui === ui && theoryPlaying.li === li) stopTheory();
      else playTheory(ui, li);
      render();
    });
    // render() rebuilds the strip's markup, so re-wire it here. It is NEVER rebuilt per step —
    // paintStripAt/followStrip move the playhead in place.
    stripWire();
    if (theoryStrip && theoryStrip.steps.length && theoryPlaying)
      followStrip(STRIP_ID, theoryStripI, { byBar: (metroClock.bpm || theoryBpm) > 140 });
    // The exercise view owns the back door and the tempo block. Both are no-ops on the
    // shelf face, where neither element exists — wireMasterTempo declines a missing node,
    // so no painter is registered for a block that is not on screen.
    //
    // The tempo block paints itself, so no render() here — it would tear the widget
    // out from under the click. Only an actual change restarts a looping drill;
    // re-wiring on every render re-announces the master tempo, which is not a change.
    wireExerciseView(p.id, {
      onBack: () => { closeTheory(); render(); },
      tempo: { mirror: v => {
        if (v === theoryBpm) return;
        theoryBpm = v; s.theoryBpm = v;
        if (theoryPlaying) { playTheory(theoryPlaying.ui, theoryPlaying.li); refreshStripDOM(); }   // restart at the new tempo
      } },
    });
    el.querySelector('.th-toggle')?.addEventListener('click', e => {
      e.stopPropagation();
      if (theoryPlaying) stopTheory();
      else if (theoryOpen) playTheory(theoryOpen.ui, theoryOpen.li);
      render();
    });
    // The teaching card toggles by flipping a class, so it never triggers a render — which
    // is why it can sit inside a view that repaints its playhead sixteen times a bar.
    wireTheoryPanel(el);

    // The 📋 Library's old rows (.lib-load / .lib-groove / .lib-finger / .lib-del /
    // .pm-save-session) now live inside the sketch's library list — see songbookRowsHTML
    // and wireSongbookRows above. Nothing of theirs is queried from here any more.

    if (!sessionActive) Object.assign(s, { blocks: blocks.map(b => ({ label:b.label, cat:b.cat, mins:b.mins, random:!!b.random, root:b.root||'', typeName:b.typeName||'', typeCat:b.typeCat||'' })), presetName, pmView, theoryUnit, theoryBpm });

    // LAST, deliberately: the sketch host goes back in only after every el.querySelectorAll
    // above has run, so PM's wiring can never reach down into the sketch's own subtree.
    if (pmView === 'library' && !sessionActive) mountSketch();
  }

  render();

  // Deep-link from a Theory Path lesson → open the Theory library at that drill and loop it.
  if (s._theoryOpenLesson) {
    const lid = s._theoryOpenLesson; delete s._theoryOpenLesson;
    let found = null;
    CURRICULUM.units.forEach((u, ui) => [...u.lessons].sort((a, b) => a.level - b.level).forEach((l, li) => { if (l.id === lid) found = { ui, li }; }));
    if (found) { pmView = 'theory'; theoryUnit = found.ui; render(); playTheory(found.ui, found.li); render(); }
  }
}
