// ── Theory Path ──────────────────────────────────────────────────────
// A guided, basics→advanced music-theory course inside the app. Every lesson
// = a short Teach card (shown + played on the fretboard, with a "why it sounds
// like that" ear-tip) and a practical, scored exercise (identify by ear, build
// a scale/chord, or play it on the guitar). Opens with a "Find My Level"
// placement; the whole path stays visible and open.
import { NOTES, CHORD_TYPES, SCALE_TYPES, getChordNotes, getScaleNotes, toSharp } from '../core/music-theory.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { setChordHighlight, clearChordHighlight, metroClock, fretboardView, setFretboardView } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';
import { stepStripHTML, wireStepStrip, followStrip, paintStripAt, planToStripSteps } from '../ui/step-strip.js';

// Lessons whose concept IS chord MOTION → present them in the Voice-Leading "flow" view (held
// common tones + per-voice motion arrows), so the idea is on the fretboard the moment you open it.
// Leaving one of these (into a non-flow lesson) restores the neutral Standard view.
const FLOW_LESSONS = new Set([
  // Voice Leading unit
  'common-tones', 'nearest-note', 'inversions-stay-close', 'sus-carryover', 'contrary-motion', 'walking-bass',
  // Function & cadences
  'diatonic-triads-of-a-key', 'authentic-cadence', 'plagal-and-half', 'deceptive-cadence', 'minor-cadences', 'minor-diatonic-chords', 'dominant-7-and-the-pull',
  // Changes & songs (real progressions)
  'smooth-changes-anchor-fingers', 'i-iv-v', 'i-v-vi-iv-pop', 'ii-v-i-changes-songs', 'fifties-and-transposing', 'twelve-bar-blues', 'full-song-playthrough'
]);
// Set the fretboard view the way the header dropdown does (keeps the dropdown + listeners in sync).
function applyFbView(fbv) {
  setFretboardView(fbv);
  const sel = document.getElementById('fb-view'); if (sel) sel.value = fbv;
  window.dispatchEvent(new CustomEvent('resonote:fbview', { detail: { view: fbv } }));
}

// ── DYNAMIC PRACTICE — the transfer stage of every drill lesson ──────────────
// The structure you just learned (the numerals) is the invariant; key, tempo and
// LAYER are the variables. Layers mirror how real practice builds: strum the
// changes → split bass from chord → fingerpick the grip → walk the bass between
// chords. Change one variable and run it again — that's the transfer.
const DP_LAYERS = [
  { n: 1, name: 'Chords',          tip: 'Strum each chord and say its number aloud — own the structure first.' },
  { n: 2, name: 'Bass → chord',    tip: 'Thumb plays the root alone, then the chord lands on top — two jobs, split.' },
  { n: 3, name: 'Fingerpick roll', tip: 'Roll every grip low→high→low, one voice at a time (P-I-M-A and back).' },
  { n: 4, name: 'Bass walk',       tip: 'After each chord, walk a half-step into the NEXT bass — connect the changes.' },
];
// The run strip's gold "now", blue "next" and bar lines are ITS language — every pedal
// that draws one speaks it, so it stays the strip's. These three are the only values the
// pedal supplies, and they go to the initial build and to every repaint from this one
// object: repaint with a different skin and every idle chip's border flips the first
// time the playhead moves.
const DP_SKIN = { accent: 'var(--rk-accent)', dim: 'var(--rk-ink-mute)', line: 'var(--rk-edge-soft)' };
const DP_LAYER_NAMES = DP_LAYERS.map(l => l.name);
// A short chip / section name out of a plan label: keep the numeral + chord, drop the
// position suffix ("· open", "· 5fr"), the layer name and any explanatory tail.
function dpChordName(raw) {
  let s = String(raw || '');
  DP_LAYER_NAMES.forEach(n => { s = s.split(' · ' + n)[0]; });
  s = s.split('→')[0].split('—')[0];
  return s.split('·').map(x => x.trim()).filter(x => x && !/^(open|\d+fr)$/i.test(x)).join(' ').trim();
}
// A drill may START on a non-tonic chord (ii–V–I starts on the ii) — read the first chord's
// NUMERAL to know how far above the key tonic it sits, so "key of C" means C even when the
// first sounded chord is Dm7.
const ROMAN_OFFSET = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
function progKeyOffset(prog) {
  const raw = String(prog?.[0]?.numeral || '');
  const flat = /^[♭b]/.test(raw.trim());
  const core = raw.replace(/[^iIvV]/g, '').toUpperCase();
  const off = ROMAN_OFFSET[core];
  if (off == null) return 0;
  return ((off - (flat ? 1 : 0)) % 12 + 12) % 12;
}
function progKeyRoot(prog) {
  const first = toSharp(prog?.[0]?.root || 'C');
  return NOTES[((NOTES.indexOf(first) - progKeyOffset(prog)) % 12 + 12) % 12];
}
// Same drill, any key: shift every chord root by the same interval. Builders read
// the data root, so the whole plan (chords, scale, contrast…) transposes with it.
function transposeDrill(drill, targetRoot) {
  const prog = drill.progression || [];
  if (!prog.length || !targetRoot) return drill;
  const shift = ((NOTES.indexOf(toSharp(targetRoot)) - NOTES.indexOf(toSharp(prog[0].root))) % 12 + 12) % 12;
  if (!shift) return drill;
  return { ...drill, progression: prog.map(c => ({ ...c, root: NOTES[(NOTES.indexOf(toSharp(c.root)) + shift) % 12] })) };
}
// Re-render a chords plan through a practice LAYER (2–4). Layer 1 (and non-chord
// plans) pass through untouched.
function layerPlan(plan, layer, bpm) {
  if (!plan || plan.type !== 'chords' || layer <= 1) return plan;
  const spb = 60 / bpm, steps = [], positions = [], seen = new Set();
  const lyName = (DP_LAYERS[layer - 1] || DP_LAYERS[0]).name;
  const midiOf = q => q.octave * 12 + NOTES.indexOf(q.note);
  const F = arr => arr.map(q => ({ si: q.si, fret: q.fret }));
  const P = arr => arr.map(q => ({ note: q.note, octave: q.octave }));
  plan.chords.forEach((c, i) => {
    const ps = [...(c.positions || [])].filter(q => q.fret >= 0).sort((a, b) => midiOf(a) - midiOf(b));
    if (!ps.length) return;
    ps.forEach(q => { const k = q.si + ':' + q.fret; if (!seen.has(k)) { seen.add(k); positions.push(q); } });
    const bass = ps[0], lab = `${c.label} · ${lyName}`;
    if (layer === 2) {
      steps.push({ focus: F([bass]), play: P([bass]), dur: spb * 0.9, label: lab });
      steps.push({ focus: F(ps), play: P(ps), dur: spb * 0.9, gap: spb, label: lab });
    } else if (layer === 3) {
      const roll = ps.concat([...ps].reverse().slice(1));
      roll.forEach(q => steps.push({ focus: F([q]), play: P([q]), dur: spb * 0.45, gap: spb * 0.5, label: lab }));
    } else {
      steps.push({ focus: F([bass]), play: P([bass]), dur: spb * 0.9, label: lab });
      steps.push({ focus: F(ps), play: P(ps), dur: spb * 0.9, gap: spb, label: lab });
      const next = plan.chords[(i + 1) % plan.chords.length];
      const nps = [...(next.positions || [])].filter(q => q.fret >= 0).sort((a, b) => midiOf(a) - midiOf(b));
      if (nps.length) {
        const nb = nps[0], af = nb.fret > 0 ? nb.fret - 1 : 1;
        const an = getNoteAtFret(customTuning[nb.si].note, customTuning[nb.si].octave, af);
        const ap = { si: nb.si, fret: af, note: an.note, octave: an.octave };
        const k = ap.si + ':' + ap.fret; if (!seen.has(k)) { seen.add(k); positions.push(ap); }
        steps.push({ focus: F([ap]), play: P([ap]), dur: spb * 0.9, gap: spb, label: lab + ' → walking into ' + (next.label || '').split('·')[0].trim() });
      }
    }
  });
  return { root: plan.chords[0] ? plan.chords[0].root : null, notes: [...new Set(positions.map(q => q.note))], label: plan.label, positions, steps };
}
import { audio } from '../core/audio.js';
import { playChordNotes, playNote } from '../core/synth.js';
import { demoToPlan, drillToPlan, playPlan, SEQ_COLORS } from '../curriculum/drill-runner.js';
import { CURRICULUM } from '../curriculum/curriculum-data.js';
import { getProgress, recordAttempt, markComplete, setCurrent, setPlaced, isComplete, recommendNext } from '../curriculum/progress-store.js';

const norm = n => toSharp(n);
const pc = n => NOTES.indexOf(norm(n));

// The drill plan builders, demoToPlan/drillToPlan and the player now live in
// ../curriculum/drill-runner.js (shared with the Practice Manager Theory library).

export function buildTheoryContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});

  // Flatten lessons (with their unit) and sort by level.
  const ALL = [];
  CURRICULUM.units.forEach(u => (u.lessons || []).forEach(l => ALL.push({ ...l, _unit: u })));
  ALL.sort((a, b) => a.level - b.level);
  const lessonById = id => ALL.find(l => l.id === id);

  // ── View / exercise state ──────────────────────────────────────────
  let view  = s.view  || 'path';
  let curId = s.curId || null;
  let exIdx = 0, answered = false, lastCorrect = false, chosenIdx = -1;
  let buildSel = new Set();
  let placeIdx = 0, placePassed = 0, placeMissStreak = 0, placeAnswered = false, placeDone = false;
  const playWatch = { on: false, target: null };
  let dpTimers = [];   // step-strip follow timers for chord plans (see dpFollowChords); cleared by stopSeq

  function persist() { Object.assign(s, { view, curId }); }
  function resetEx() { answered = false; lastCorrect = false; chosenIdx = -1; buildSel = new Set(); playWatch.on = false; }

  // ── Audio listener for "play it" exercises (inert once pedal is gone) ─
  audio.on(() => {
    if (!document.getElementById(`body-${p.id}`)) return;
    if (!playWatch.on) return;
    const d = audio.detected;
    if (d && norm(d.note) === playWatch.target && Math.abs(d.cents) < 45) {
      playWatch.on = false;
      answered = true; lastCorrect = true;
      recordAttempt(curId, true);
      playNote(playWatch.target, 3, { gain: 0.12 });
      renderLesson(curId);
    }
  });

  // ── Demo → notes / playback / fretboard ─────────────────────────────
  function demoToNotes(d) {
    if (!d) return null;
    const root = norm(d.root);
    if (d.kind === 'chord') {
      const ints = CHORD_TYPES[d.chordCat]?.[d.chordType] || [0, 4, 7];
      const notes = getChordNotes(root, ints);
      return { root, notes, label: d.caption || `${root} ${d.chordType || ''}`.trim(), seq: [{ notes, chord: true, dur: 1.4 }] };
    }
    if (d.kind === 'scale') {
      const ints = SCALE_TYPES[d.scaleCat]?.[d.scaleName] || [0, 2, 4, 5, 7, 9, 11];
      const notes = getScaleNotes(root, ints);
      const seq = notes.concat([root]).map(n => ({ notes: [n], dur: 0.32 }));
      return { root, notes, label: d.caption || `${root} ${d.scaleName || 'scale'}`, seq };
    }
    if (d.kind === 'interval') {
      const hi = NOTES[(pc(root) + (((d.intervalSemitones || 0) % 12) + 12) % 12) % 12];
      const notes = [root, hi];
      return { root, notes, label: d.caption || `${root} + ${d.intervalSemitones}st`, seq: [{ notes: [root], dur: 0.5 }, { notes: [hi], dur: 0.5 }, { notes, chord: true, dur: 1.1 }] };
    }
    if (d.kind === 'note') {
      const n = norm(d.note || d.root);
      return { root: n, notes: [n], label: d.caption || n, seq: [{ notes: [n], dur: 0.9 }] };
    }
    if (d.kind === 'progression') {
      const chords = (d.progression || []).map(c => ({ root: norm(c.root), type: c.type, notes: getChordNotes(norm(c.root), CHORD_TYPES[c.cat]?.[c.type] || [0, 4, 7]) }));
      const notes = [...new Set(chords.flatMap(c => c.notes))];
      return { root, notes, label: d.caption || 'progression', chords };
    }
    return null;
  }
  function highlightDemo(d) {
    const dn = demoToNotes(d); if (!dn) return;
    setChordHighlight(dn.root, dn.notes, dn.label, null);
    updateOverlays();
  }
  function playSeq(seq) {
    let t = 0;
    seq.forEach(step => {
      setTimeout(() => playChordNotes(step.notes, { dur: step.dur || 0.6, bass: !!step.chord, strum: step.chord ? 0.03 : 0, gain: 0.16 }), t * 1000);
      t += step.gap || step.dur || 0.45;
    });
  }
  function playDemo(d) {
    const dn = demoToNotes(d); if (!dn) return;
    if (d.kind === 'progression') {
      let t = 0;
      dn.chords.forEach(c => {
        setTimeout(() => {
          if (!document.getElementById(`body-${p.id}`)) return;
          setChordHighlight(c.root, c.notes, `${c.root} ${c.type}`, null); updateOverlays();
          playChordNotes(c.notes, { dur: 1.0, strum: 0.03 });
        }, t * 1000);
        t += 1.15;
      });
    } else {
      const plan = demoToPlan(d);
      if (plan) { playPath(plan); return; }
      highlightDemo(d); playSeq(dn.seq);
    }
  }

  // ── Synced fretboard sequencer (drives the MAIN fretboard) ───────────
  // "Hear & see it" plays a plan ONCE on the main fretboard via the shared
  // drill-runner; the Practice Manager Theory library loops the same engine.
  let _seqStop = null;
  function stopSeq() { if (_seqStop) { _seqStop(); _seqStop = null; } dpClearTimers(); }
  function playPath(plan) {
    stopSeq();
    metroClock.stopAll();   // a running pedal (e.g. Workshop) also drives the fretboard — yield it to the preview
    _seqStop = playPlan(plan, { isAlive: () => !!document.getElementById(`body-${p.id}`) });
  }
  function previewDrill(drill) { playPath(drillToPlan(drill)); }
  // Static preview of the DRILL's first frame — so "Hear & see it" and the on-open highlight
  // show exactly what the practice drill plays (they were diverging from the teach demo).
  function highlightDrill(drill) {
    const plan = drillToPlan(drill);
    if (!plan) return;
    if (plan.type === 'chords' && plan.chords?.length) {
      const c = plan.chords[0];
      setChordHighlight(c.root, c.notes, plan.label, c.positions || null, SEQ_COLORS);
    } else {
      // focusOnly drills (interval double-stops) preview just their FIRST note, not the whole
      // cluster of positions — the rest light up as they play.
      const f0 = plan.focusOnly && plan.steps && plan.steps[0] ? plan.steps[0].focus : null;
      setChordHighlight(plan.root, plan.notes, plan.label, plan.positions || null, plan.colors || SEQ_COLORS, f0, null, plan.focusOnly);
    }
    updateOverlays();
  }

  function exTarget(ex) {
    if (ex.targetNote) return norm(ex.targetNote);
    return NOTES[(pc(ex.root) + (((ex.targetIntervalFromRoot || 0) % 12) + 12) % 12) % 12];
  }
  function buildTargetSet(ex) {
    return new Set((ex.targetIntervals || []).map(iv => NOTES[(pc(ex.root) + ((iv % 12) + 12) % 12) % 12]));
  }

  // ── Renderers ───────────────────────────────────────────────────────
  function render() {
    if (view === 'placement') return renderPlacement();
    if (view === 'lesson' && curId) return renderLesson(curId);
    return renderPath();
  }

  function renderPath() {
    stopSeq(); clearChordHighlight(); updateOverlays();
    const prog = getProgress();
    const total = ALL.length, done = ALL.filter(l => isComplete(prog, l.id)).length;
    const recd = recommendNext(prog, ALL);
    let h = `<div class="tp-wrap rk">`;
    h += `<div class="tp-hero">`;
    h += `<div class="tp-herorow"><button class="tp-find" data-act="placement">🎯 Find My Level</button>`;
    h += prog.placedLevel ? `<span class="tp-level">You're ~Level ${prog.placedLevel}</span>` : `<span class="tp-level dim">Not placed yet</span>`;
    h += `</div>`;
    h += `<div class="tp-progbar"><div class="tp-progfill" style="width:${total ? Math.round(done / total * 100) : 0}%"></div></div>`;
    h += `<div class="tp-progtxt">${done}/${total} lessons complete${recd ? ` · <b>Up next:</b> ${recd.title}` : ''}</div>`;
    if (recd) h += `<button class="tp-cont" data-lesson="${recd.id}">▶ Continue: ${recd.title}</button>`;
    h += `</div>`;
    CURRICULUM.units.forEach(u => {
      const ul = [...u.lessons].sort((a, b) => a.level - b.level);
      const ud = ul.filter(l => isComplete(prog, l.id)).length;
      h += `<div class="tp-unit"><div class="tp-uhead"><span>${u.icon} ${u.title}</span><span class="tp-ucount">${ud}/${ul.length}</span></div>`;
      h += `<div class="tp-usum">${u.summary || ''}</div><div class="tp-lessons">`;
      ul.forEach(l => {
        const c = isComplete(prog, l.id), isR = recd && recd.id === l.id;
        h += `<button class="tp-lesson ${c ? 'done' : ''} ${isR ? 'rec' : ''}" data-lesson="${l.id}"><span class="tp-li">${c ? '✓' : isR ? '▶' : '○'}</span><span class="tp-lt">${l.title}</span><span class="tp-ll">L${l.level}</span></button>`;
      });
      h += `</div></div>`;
    });
    h += `</div>`;
    el.innerHTML = STYLE + h;
    el.querySelectorAll('[data-lesson]').forEach(b => b.onclick = e => { e.stopPropagation(); openLesson(b.dataset.lesson); });
    el.querySelector('[data-act="placement"]')?.addEventListener('click', e => { e.stopPropagation(); startPlacement(); });
    // Returning from a lesson lands you back on THAT lesson in its unit, not
    // at the top of the path. curId survives the back action, so scroll to it.
    if (curId) {
      const btn = el.querySelector(`[data-lesson="${curId}"]`);
      if (btn) {
        const bodyRect = el.getBoundingClientRect(), btnRect = btn.getBoundingClientRect();
        el.scrollTop += (btnRect.top - bodyRect.top) - el.clientHeight / 2 + btnRect.height / 2;
        btn.classList.add('just-left');
      }
    }
  }

  function exerciseBody(ex) {
    let h = `<div class="tp-q">${ex.prompt}</div>`;
    if (ex.kind === 'mcq') {
      if (ex.audio) h += `<button class="tp-demo sm" data-act="exaudio">▶ Hear it</button>`;
      h += `<div class="tp-opts">`;
      ex.options.forEach((o, i) => { let c = 'tp-opt'; if (answered) { if (i === ex.answer) c += ' ok'; else if (i === chosenIdx) c += ' no'; } h += `<button class="${c}" data-opt="${i}" ${answered ? 'disabled' : ''}>${o}</button>`; });
      h += `</div>`;
    } else if (ex.kind === 'ear') {
      h += `<div class="tp-earrow">`;
      ex.earOptions.forEach((o, i) => h += `<button class="tp-play" data-ear="${i}">▶ ${o.label}</button>`);
      h += `</div><div class="tp-opts">`;
      ex.earOptions.forEach((o, i) => { let c = 'tp-opt'; if (answered) { if (i === ex.answer) c += ' ok'; else if (i === chosenIdx) c += ' no'; } h += `<button class="${c}" data-opt="${i}" ${answered ? 'disabled' : ''}>${o.label}</button>`; });
      h += `</div>`;
    } else if (ex.kind === 'build') {
      h += `<div class="tp-notes">`;
      NOTES.forEach(n => h += `<button class="tp-note ${buildSel.has(n) ? 'sel' : ''}" data-note="${n}" ${answered ? 'disabled' : ''}>${n}</button>`);
      h += `</div>`;
      if (!answered) h += `<button class="tp-check" data-act="checkbuild">Check my answer</button>`;
    } else if (ex.kind === 'play') {
      const t = exTarget(ex);
      h += `<div class="tp-target">Target note: <b>${t}</b></div>`;
      h += `<button class="tp-demo sm" data-act="heartarget" data-note="${t}">▶ Hear the target</button>`;
      if (!answered) {
        if (audio.connected) h += `<div class="tp-listen">🎧 Play <b>${t}</b> on your guitar…</div>`;
        else h += `<button class="tp-check" data-act="connect">🎛 Connect guitar input to play along</button>`;
        h += `<button class="tp-mini" data-act="skip">Skip for now</button>`;
      }
    }
    return h;
  }

  function renderLesson(id) {
    const L = lessonById(id);
    if (!L) { view = 'path'; return renderPath(); }
    const u = L._unit, ex = L.exercises[exIdx] || null;
    let h = `<div class="tp-wrap rk">`;
    h += `<div class="tp-top"><button class="tp-mini" data-act="path">← Path</button><span class="tp-crumb">${u.icon} ${u.title} · Level ${L.level}</span></div>`;
    h += `<div class="tp-title">${L.title}</div>`;
    h += `<div class="tp-card"><div class="tp-sum">${L.teach.summary}</div>`;
    h += `<ul class="tp-points">${(L.teach.points || []).map(pt => `<li>${pt}</li>`).join('')}</ul>`;
    if (L.drill || L.teach.demo) h += `<button class="tp-demo" data-act="demo">▶ Hear &amp; see it</button>`;
    if (L.teach.earTip) h += `<div class="tp-tip">👂 ${L.teach.earTip}</div>`;
    h += `</div>`;
    if (ex) {
      h += `<div class="tp-ex"><div class="tp-exhead">EXERCISE ${exIdx + 1} / ${L.exercises.length}</div>`;
      h += exerciseBody(ex);
      if (answered) {
        h += `<div class="tp-fb ${lastCorrect ? 'ok' : 'no'}">${lastCorrect ? '✓ ' : '✗ '}${ex.explain || ''}</div>`;
        const last = exIdx >= L.exercises.length - 1;
        h += `<button class="tp-next" data-act="next">${last ? 'Finish lesson ✓' : 'Next exercise →'}</button>`;
      }
      h += `</div>`;
    } else {
      h += `<div class="tp-done">Lesson complete! ✓</div><button class="tp-next" data-act="complete">Back to path →</button>`;
    }
    if (L.drill) {
      const d = L.drill;
      const prog = (d.progression || []).map(c => `${c.numeral ? c.numeral + ' ' : ''}${c.root}${c.quality === 'Major' ? '' : c.quality === 'Minor' ? 'm' : c.quality}`).join('  ·  ');
      h += `<div class="tp-ex" style="border-color:var(--rk-line)">
        <div class="tp-exhead" style="color:var(--rk-accent)">🎸 PRACTICE DRILL</div>
        <div style="font-weight:700;color:var(--rk-ink);margin-bottom:2px">${d.title || 'Drill'}</div>
        ${prog ? `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">${prog}</div>` : ''}
        <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui));margin-top:2px">${d.bpm || 90} BPM · ${d.timeSig || '4/4'}${d.voicing ? ' · ' + d.voicing : ''}</div>
        ${d.pattern ? `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">${d.pattern}</div>` : ''}
        ${d.focus ? `<div style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));margin-top:3px">🎯 ${d.focus}</div>` : ''}
        <button class="tp-demo" data-act="drillsee" style="margin-top:8px">▶ Hear &amp; see it on the fretboard ↑</button>
        <button class="tp-next" data-act="drillprog" style="margin-top:6px;background:var(--rk-soft2);border-color:var(--rk-line);color:var(--rk-accent)">🎸 Practice this drill (loops in 🎓 Theory) →</button>
      </div>`;

      // ── DYNAMIC PRACTICE — the transfer stage: same structure, YOUR key/tempo/layer ──
      const dprog = d.progression || [];
      if (dprog.length) {
        const basePlan = drillToPlan(d);
        const isChordDrill = !!(basePlan && basePlan.type === 'chords');
        const origKey = progKeyRoot(dprog);
        const dpKey = dp.key || origKey;
        const nums = dprog.map(c => c.numeral || toSharp(c.root)).join('–');
        // The transfer stage used to wear an amber of its own so it read as a second
        // product bolted onto the lesson. It is the same pedal, so it wears the same
        // accent — what marks it out is the lit border and the heavier wash, not a hue.
        const dpOn = 'border-color:var(--rk-line);color:var(--rk-accent);background:var(--rk-soft2)';
        h += `<div class="tp-ex" style="border-color:var(--rk-line)">
          <div class="tp-exhead" style="color:var(--rk-accent)">🏋 DYNAMIC PRACTICE — take it anywhere</div>
          <div style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));line-height:1.5;margin-bottom:6px">You're playing <b class="mono" style="color:var(--rk-dim)">${nums}</b> in <b class="mono" style="color:var(--rk-dim)">${dpKey}</b>${isChordDrill ? ` · <b style="color:var(--rk-dim)">${DP_LAYERS[dp.layer - 1].name}</b>` : ''}. The structure is the lesson — key, tempo &amp; layer are yours. Change ONE and run it again.</div>
          <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px;margin-bottom:3px">KEY</div>
          <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px">${NOTES.map(n => `<button class="tp-mini dp-key" data-k="${n}" style="min-width:22px;${n === dpKey ? dpOn : ''}">${n}</button>`).join('')}</div>`;
        if (isChordDrill) {
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px;margin-bottom:3px">LAYER — stack the skill</div>
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:3px">${DP_LAYERS.map(ly => `<button class="tp-mini dp-layer" data-l="${ly.n}" style="${ly.n === dp.layer ? dpOn : ''}">${ly.n}· ${ly.name}</button>`).join('')}</div>
          <div style="color:var(--rk-ink-dim);font-size:calc(9px*var(--ui));margin-bottom:6px">${DP_LAYERS[dp.layer - 1].tip}</div>`;
        }
        // Tempo is the shared master control — move it here and the whole app moves with it.
        // Once the loop is running this button IS the stop control, so it leaves the accent
        // behind for --rk-stop — the same red every transport in the app halts in. The rim is
        // declared in BOTH states because .tp-next sets `border:none`: give it only to the red
        // one and the button grows 2px the moment you press play.
        const dpStop = dp.playing;
        h += `<div style="display:flex;align-items:center;gap:10px">
          <button class="tp-next" data-act="dpplay" style="margin-top:0;background:${dpStop ? 'var(--rk-stop-soft)' : 'var(--rk-soft2)'};border:1px solid ${dpStop ? 'var(--rk-stop-edge)' : 'var(--rk-line)'};color:${dpStop ? 'var(--rk-stop)' : 'var(--rk-accent)'}">${dpStop ? '⏹ Stop' : '▶ Practice (loops)'}</button>
          <div class="rk" style="flex:1;min-width:0">${masterTempoBlock('tp-' + p.id, { min: 30, max: 280, compact: true })}</div>
        </div>`;
        // THE RUN — the whole loop laid out, so a stumble has somewhere to rejoin. Built before
        // you press play (read it first), followed while it runs, left up once it stops.
        dpSyncStrip(L);
        h += `<div style="min-width:0">
          <div class="mono" style="color:var(--rk-ink-mute);font-size:calc(7px*var(--ui));letter-spacing:1px;margin-bottom:3px">THE RUN · ${dpStrip.steps.length} step${dpStrip.steps.length === 1 ? '' : 's'} — ${dp.playing ? 'follow the playhead' : 'tap a step to hear it'}</div>
          ${stepStripHTML(dpStrip.id, { steps: dpStrip.steps, sections: dpStrip.sections, tsig: dpStrip.tsig, playIdx: dpStrip.playIdx, selIdx: dpStrip.selIdx, ...DP_SKIN, empty: 'This drill has no step-by-step run to lay out.' })}
        </div></div>`;
      }
    }
    h += `</div>`;
    el.innerHTML = STYLE + h;

    el.querySelector('[data-act="path"]')?.addEventListener('click', e => { e.stopPropagation(); view = 'path'; persist(); renderPath(); });
    el.querySelector('[data-act="demo"]')?.addEventListener('click', e => { e.stopPropagation(); if (L.drill) previewDrill(L.drill); else playDemo(L.teach.demo); });
    el.querySelector('[data-act="exaudio"]')?.addEventListener('click', e => { e.stopPropagation(); playDemo(ex.audio); });
    el.querySelectorAll('[data-ear]').forEach(b => b.onclick = e => { e.stopPropagation(); playDemo(ex.earOptions[+b.dataset.ear].audio); });
    el.querySelectorAll('[data-opt]').forEach(b => b.onclick = e => { e.stopPropagation(); answerChoice(ex, +b.dataset.opt); });
    el.querySelectorAll('[data-note]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleNote(ex, b.dataset.note); });
    el.querySelector('[data-act="checkbuild"]')?.addEventListener('click', e => { e.stopPropagation(); checkBuild(ex); });
    el.querySelector('[data-act="heartarget"]')?.addEventListener('click', e => { e.stopPropagation(); playNote(e.currentTarget.dataset.note, 3); });
    el.querySelector('[data-act="connect"]')?.addEventListener('click', e => { e.stopPropagation(); audio.connect(audio.selectedDeviceId); setTimeout(() => renderLesson(curId), 400); });
    el.querySelector('[data-act="skip"]')?.addEventListener('click', e => { e.stopPropagation(); nextExercise(L); });
    el.querySelector('[data-act="next"]')?.addEventListener('click', e => { e.stopPropagation(); nextExercise(L); });
    el.querySelector('[data-act="complete"]')?.addEventListener('click', e => { e.stopPropagation(); markComplete(curId); view = 'path'; persist(); renderPath(); });
    el.querySelector('[data-act="drillsee"]')?.addEventListener('click', e => { e.stopPropagation(); if (L.drill) previewDrill(L.drill); });
    el.querySelector('[data-act="drillprog"]')?.addEventListener('click', e => { e.stopPropagation(); stopSeq(); window.dispatchEvent(new CustomEvent('resonote:open-theory', { detail: { lessonId: id } })); });
    // Dynamic practice controls — changing a variable mid-play restarts with the new setting.
    el.querySelectorAll('.dp-key').forEach(b => b.onclick = e => { e.stopPropagation(); dp.key = b.dataset.k; dpRestart(L); });
    el.querySelectorAll('.dp-layer').forEach(b => b.onclick = e => { e.stopPropagation(); dp.layer = +b.dataset.l; dpRestart(L); });
    // Tempo rides the master clock; `mirror` keeps dp.bpm in step whether it changed here or elsewhere.
    wireMasterTempo('tp-' + p.id, { mirror: v => { dp.bpm = v; } });
    el.querySelector('[data-act="dpplay"]')?.addEventListener('click', e => { e.stopPropagation(); if (dp.playing) { dp.playing = false; stopSeq(); } else dpStart(L); renderLesson(curId); });
    // The run strip: click a chip to hear that step. A re-render rebuilds the strip and loses its
    // scroll, so put the playhead back where it was.
    wireStepStrip(dpStrip.id, { onPick: dpPick });
    if (dpStrip.playIdx != null) followStrip(dpStrip.id, dpStrip.playIdx, { byBar: dpByBar() });

    // arm the mic listener only for an unanswered play exercise
    if (ex && ex.kind === 'play' && !answered && audio.connected) { playWatch.on = true; playWatch.target = exTarget(ex); }
    else playWatch.on = false;
  }

  function answerChoice(ex, i) {
    if (answered) return;
    chosenIdx = i; lastCorrect = (i === ex.answer); answered = true;
    recordAttempt(curId, lastCorrect);
    renderLesson(curId);
  }
  function toggleNote(ex, n) {
    if (answered) return;
    if (buildSel.has(n)) buildSel.delete(n); else buildSel.add(n);
    setChordHighlight(norm(ex.root), [...buildSel], 'Building…', null); updateOverlays();
    renderLesson(curId);
  }
  function checkBuild(ex) {
    if (answered) return;
    const target = buildTargetSet(ex);
    lastCorrect = buildSel.size === target.size && [...buildSel].every(n => target.has(n));
    answered = true; recordAttempt(curId, lastCorrect);
    setChordHighlight(norm(ex.root), [...target], 'Answer', null); updateOverlays();
    renderLesson(curId);
  }
  function nextExercise(L) {
    if (exIdx < L.exercises.length - 1) { exIdx++; resetEx(); renderLesson(curId); }
    else { markComplete(curId); view = 'path'; persist(); renderPath(); }
  }
  // Dynamic-practice state for the open lesson (key/tempo/layer are the user's variables).
  const dp = { key: null, bpm: null, layer: 1, playing: false };

  // ── THE RUN — the dynamic-practice loop, laid out ────────────────────────────
  // A looping drill you can only hear is a peephole: you see the note under your
  // finger and nothing either side of it, so when you fall off there's nowhere to
  // rejoin. The shared step strip lays the WHOLE run out — chips, bar lines, a
  // playhead and look-ahead — and stays up after the loop stops so you can read
  // back what you just played.
  const dpStrip = { id: 'tps-' + p.id, sig: null, steps: [], sections: [], tsig: 4, playIdx: null, selIdx: null, plan: null };
  function dpClearTimers() { dpTimers.forEach(t => clearTimeout(t)); dpTimers = []; }
  function dpResetStrip() { Object.assign(dpStrip, { sig: null, steps: [], sections: [], playIdx: null, selIdx: null, plan: null }); }
  function dpByBar() { return (metroClock.bpm || dp.bpm || 90) > 140; }   // fast tempo → move a bar at a time, not a jitter per note
  function dpTsig(L) { const m = /(\d+)\s*\/\s*\d+/.exec((L && L.drill && L.drill.timeSig) || ''); return m ? +m[1] : 4; }
  // The exact plan the practice loop plays — built here too so the run can be READ before it starts.
  function dpPlanFor(L) {
    const bpm = dp.bpm || L.drill.bpm || 90;
    // dp.key is the KEY tonic; the first chord may sit above it (ii–V–I → first root = key + 2)
    const target = dp.key ? NOTES[(NOTES.indexOf(dp.key) + progKeyOffset(L.drill.progression)) % 12] : null;
    const base = drillToPlan(transposeDrill(L.drill, target), bpm);
    return { base, plan: layerPlan(base, dp.layer, bpm), bpm, layered: !!(base && base.type === 'chords' && dp.layer > 1) };
  }
  // Plans time themselves in SECONDS; the strip reads bar lines off BEATS. A step's slot is
  // its gap when it has one — that's what actually advances the run — snapped to sixteenths.
  const dpBeats = (secs, bpm) => Math.max(0.25, Math.round((secs || 0) * bpm / 60 * 4) / 4);
  function dpSetStrip(plan, bpm, layered, L, sig) {
    dpResetStrip();
    dpStrip.sig = sig; dpStrip.tsig = dpTsig(L); dpStrip.plan = plan;
    if (!plan) return;
    if (plan.type === 'chords') {
      // one chip per chord — the chip already NAMES the change, so no section flags on top of it
      dpStrip.steps = (plan.chords || []).map(c => ({
        notes: (c.positions || []).filter(q => q.fret >= 0).map(q => ({ si: q.si, fret: q.fret })),
        dur: dpBeats(c.dur, bpm),
        label: dpChordName(c.label) || toSharp(c.root || 'C'),
      }));
      return;
    }
    if (!plan.steps || !plan.steps.length) return;
    // labels dropped on purpose: the strip prints the note names, which is what you read a run for
    dpStrip.steps = planToStripSteps(plan.steps).map((st, i) => ({
      notes: st.notes, dur: dpBeats(plan.steps[i].gap || plan.steps[i].dur, bpm),
    }));
    if (layered) {   // a layered chord drill spends several chips per chord — flag where each chord starts
      let prev = null;
      plan.steps.forEach((st, i) => { const nm = dpChordName(st.label); if (nm && nm !== prev) { dpStrip.sections.push({ at: i, name: nm }); prev = nm; } });
    }
  }
  function dpSyncStrip(L) {
    const sig = `${curId}|${dp.key || ''}|${dp.layer}`;
    if (dpStrip.sig === sig) return;   // same run — keep the strip (and its playhead) exactly as it is
    const { plan, bpm, layered } = dpPlanFor(L);
    dpSetStrip(plan, bpm, layered, L, sig);
  }
  // Per-step: move the highlight and follow it. Never re-render the strip here — a rebuild
  // throws away the scroll position and flickers every note.
  function dpPaint(i) {
    if (!dpStrip.steps.length) return;
    dpStrip.playIdx = i;
    paintStripAt(dpStrip.id, { playIdx: i, selIdx: dpStrip.selIdx, ...DP_SKIN });
    followStrip(dpStrip.id, i, { byBar: dpByBar() });
  }
  // Chord plans light a whole grip per chord and report no steps — mirror their schedule so the
  // strip still follows. playPlan's onCycle re-arms it every loop, so it can't drift away.
  function dpFollowChords(plan) {
    dpClearTimers();
    let t = 0;
    (plan.chords || []).forEach((c, i) => {
      dpTimers.push(setTimeout(() => { if (dp.playing) dpPaint(i); }, t * 1000));
      t += c.dur || 1;
    });
  }
  // Clicking a chip marks it; with the loop stopped it also hears + sees that one step.
  function dpPick(i) {
    dpStrip.selIdx = i;
    paintStripAt(dpStrip.id, { playIdx: dpStrip.playIdx, selIdx: i, ...DP_SKIN });
    const plan = dpStrip.plan;
    if (!plan || dp.playing) return;
    if (plan.type === 'chords') {
      const c = (plan.chords || [])[i]; if (!c) return;
      setChordHighlight(c.root, c.notes, c.label, c.positions || null, SEQ_COLORS); updateOverlays();
      playChordNotes(c.notes, { dur: 1.0, strum: 0.03, gain: 0.16 });
    } else {
      const st = (plan.steps || [])[i]; if (!st) return;
      setChordHighlight(plan.root, plan.notes, st.label || plan.label, plan.positions, plan.colors || SEQ_COLORS, st.focus, null, plan.focusOnly);
      updateOverlays();
      (st.play || []).forEach(pl => playNote(pl.note, pl.octave ?? 3, { dur: (st.dur || 0.4) * 0.96, gain: 0.2 }));
    }
  }

  function dpStart(L) {
    if (!L || !L.drill) return;
    stopSeq(); metroClock.stopAll();
    const { plan, bpm, layered } = dpPlanFor(L);
    if (!plan) return;
    // Build the strip ONCE, here, from the plan about to run — then only repaint it per step.
    dpSetStrip(plan, bpm, layered, L, `${curId}|${dp.key || ''}|${dp.layer}`);
    dp.playing = true;
    const isChords = plan.type === 'chords';
    if (isChords) dpFollowChords(plan);
    _seqStop = playPlan(plan, {
      loop: true,
      isAlive: () => !!document.getElementById(`body-${p.id}`) && dp.playing,
      onStep: i => dpPaint(i),
      onCycle: () => { if (isChords) dpFollowChords(plan); },
    });
  }
  function dpRestart(L) {
    const was = dp.playing;
    if (was) { dp.playing = false; stopSeq(); dpStart(L); }
    renderLesson(curId);
  }

  function openLesson(id) {
    stopSeq();
    dp.key = null; dp.bpm = null; dp.layer = 1; dp.playing = false; dpResetStrip();
    curId = id; exIdx = 0; resetEx(); setCurrent(id); view = 'lesson'; persist();
    // The lesson presents its concept in the right view: chord-motion lessons → Voice-Leading flow.
    if (FLOW_LESSONS.has(id)) applyFbView('voice');
    else if (fretboardView === 'voice') applyFbView('standard');
    const L = lessonById(id); if (L?.drill) highlightDrill(L.drill); else if (L?.teach?.demo) highlightDemo(L.teach.demo);
    renderLesson(id);
    // Replacing the body's innerHTML keeps its scrollTop when the new content is
    // tall enough, so a lesson opened from far down the path would start
    // mid-page. Only reset on OPEN — re-renders during a lesson (answering an
    // exercise) must hold your place.
    el.scrollTop = 0;
  }

  // ── Placement ───────────────────────────────────────────────────────
  function startPlacement() {
    view = 'placement'; placeIdx = 0; placePassed = 0; placeMissStreak = 0; placeAnswered = false; placeDone = false; chosenIdx = -1;
    persist(); renderPlacement(); el.scrollTop = 0;
  }
  function renderPlacement() {
    const Q = CURRICULUM.placement || [];
    if (!Q.length) { view = 'path'; return renderPath(); }
    if (placeDone) {
      setPlaced(placePassed || 1);
      const recd = recommendNext(getProgress(), ALL);
      let h = `<div class="tp-wrap rk"><div class="tp-title">🎯 Your level</div>`;
      h += `<div class="tp-card"><div class="tp-sum">Nice — you placed around <b>Level ${placePassed || 1}</b>.</div>`;
      h += `<div class="tp-tip">Recommended start: <b>${recd ? recd.title : 'Foundations'}</b>. The whole path is open, so explore anywhere you like.</div></div>`;
      if (recd) h += `<button class="tp-cont" data-lesson="${recd.id}">▶ Start: ${recd.title}</button>`;
      h += `<button class="tp-mini" data-act="path">See the full path</button></div>`;
      el.innerHTML = STYLE + h;
      el.querySelector('[data-lesson]')?.addEventListener('click', e => { e.stopPropagation(); openLesson(e.currentTarget.dataset.lesson); });
      el.querySelector('[data-act="path"]')?.addEventListener('click', e => { e.stopPropagation(); view = 'path'; persist(); renderPath(); });
      return;
    }
    const q = Q[placeIdx];
    const opts = q.kind === 'ear' ? q.earOptions.map(o => o.label) : q.options;
    let h = `<div class="tp-wrap rk"><div class="tp-top"><button class="tp-mini" data-act="path">← Path</button><span class="tp-crumb">Find My Level · ${placeIdx + 1}/${Q.length}</span></div>`;
    h += `<div class="tp-progbar"><div class="tp-progfill" style="width:${Math.round(placeIdx / Q.length * 100)}%"></div></div>`;
    h += `<div class="tp-ex"><div class="tp-q">${q.prompt}</div>`;
    if (q.kind === 'ear') { h += `<div class="tp-earrow">`; q.earOptions.forEach((o, i) => h += `<button class="tp-play" data-ear="${i}">▶ ${o.label}</button>`); h += `</div>`; }
    else if (q.audio) h += `<button class="tp-demo sm" data-act="exaudio">▶ Hear it</button>`;
    h += `<div class="tp-opts">`;
    opts.forEach((o, i) => { let c = 'tp-opt'; if (placeAnswered) { if (i === q.answer) c += ' ok'; else if (i === chosenIdx) c += ' no'; } h += `<button class="${c}" data-opt="${i}" ${placeAnswered ? 'disabled' : ''}>${o}</button>`; });
    h += `</div>`;
    if (placeAnswered) h += `<div class="tp-fb ${lastCorrect ? 'ok' : 'no'}">${lastCorrect ? '✓ ' : '✗ '}${q.explain || ''}</div><button class="tp-next" data-act="placenext">${placeIdx >= Q.length - 1 ? 'See my level →' : 'Next →'}</button>`;
    h += `</div></div>`;
    el.innerHTML = STYLE + h;
    el.querySelector('[data-act="path"]')?.addEventListener('click', e => { e.stopPropagation(); view = 'path'; persist(); renderPath(); });
    el.querySelector('[data-act="exaudio"]')?.addEventListener('click', e => { e.stopPropagation(); playDemo(q.audio); });
    el.querySelectorAll('[data-ear]').forEach(b => b.onclick = e => { e.stopPropagation(); playDemo(q.earOptions[+b.dataset.ear].audio); });
    el.querySelectorAll('[data-opt]').forEach(b => b.onclick = e => { e.stopPropagation(); answerPlacement(q, +b.dataset.opt); });
    el.querySelector('[data-act="placenext"]')?.addEventListener('click', e => { e.stopPropagation(); placeNext(Q); });
  }
  function answerPlacement(q, i) {
    if (placeAnswered) return;
    chosenIdx = i; lastCorrect = (i === q.answer); placeAnswered = true;
    if (lastCorrect) { placePassed = Math.max(placePassed, q.level); placeMissStreak = 0; }
    else placeMissStreak++;
    renderPlacement();
  }
  function placeNext(Q) {
    if (placeIdx >= Q.length - 1 || (placeMissStreak >= 2 && placeIdx >= 2)) { placeDone = true; }
    else { placeIdx++; placeAnswered = false; chosenIdx = -1; }
    renderPlacement();
  }

  render();

  // External "Learn the theory →" jump from a pedal's smart Theory panel.
  if (s._openLesson !== undefined) {
    const lid = s._openLesson; delete s._openLesson;
    if (lid && lessonById(lid)) openLesson(lid); else { view = 'path'; persist(); render(); }
  }
}

// Every rule below reads the kit tokens the card hands down (which is why each view's
// root carries `rk` alongside `tp-wrap`). Nothing here names a colour, so re-pointing
// this pedal's accent in the CATALOG re-skins the path, the lesson and the placement
// quiz in one move — and the teach card can never drift away from the drill card.
// The two exceptions are deliberate and app-wide: --rk-ok / --rk-bad are the SAME
// green and rose in every drill in Resonote, because "you got that right" must not
// change meaning when you change pedals.
const STYLE = `<style>
.tp-wrap{display:flex;flex-direction:column;gap:8px;font-size:calc(11px*var(--ui));color:var(--rk-ink)}
.tp-top{display:flex;align-items:center;gap:8px}
.tp-crumb{color:var(--rk-dim);font-size:calc(9px*var(--ui));letter-spacing:.5px}
.tp-mini{background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:calc(9px*var(--ui))}
.tp-title{font-size:calc(15px*var(--ui));font-weight:800;color:var(--rk-ink)}
.tp-card{background:var(--rk-soft);border:1px solid var(--rk-edge);border-radius:8px;padding:9px 10px}
.tp-sum{font-size:calc(12px*var(--ui));line-height:1.5;color:var(--rk-ink)}
.tp-points{margin:6px 0 0;padding-left:16px;line-height:1.6;color:var(--rk-ink-dim)}
.tp-points li{margin:2px 0}
.tp-tip{margin-top:7px;font-size:calc(10px*var(--ui));line-height:1.5;color:var(--rk-ink);background:var(--rk-soft);border-left:2px solid var(--rk-accent);padding:5px 7px;border-radius:4px}
.tp-demo{background:var(--rk-soft2);border:1px solid var(--rk-line);color:var(--rk-accent);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;margin-top:8px}
.tp-demo.sm{padding:4px 9px;font-size:calc(10px*var(--ui));margin-top:0}
.tp-ex{background:var(--rk-panel);border:1px solid var(--rk-edge-soft);border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:7px}
.tp-exhead{color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));letter-spacing:1px}
.tp-q{font-size:calc(12px*var(--ui));font-weight:600;color:var(--rk-ink);line-height:1.45}
.tp-opts{display:flex;flex-direction:column;gap:5px}
.tp-opt{text-align:left;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:6px;padding:7px 9px;cursor:pointer;font-size:calc(11px*var(--ui))}
.tp-opt:hover{border-color:var(--rk-line)}
.tp-opt.ok{border-color:var(--rk-ok);background:color-mix(in srgb, var(--rk-ok) 14%, transparent);color:var(--rk-ok)}
.tp-opt.no{border-color:var(--rk-bad);background:color-mix(in srgb, var(--rk-bad) 12%, transparent);color:var(--rk-bad)}
.tp-earrow{display:flex;gap:6px;flex-wrap:wrap}
.tp-play{background:var(--rk-soft);border:1px solid var(--rk-line);color:var(--rk-accent);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700}
.tp-notes{display:flex;flex-wrap:wrap;gap:4px}
.tp-note{min-width:26px;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:5px;padding:5px 0;cursor:pointer;font-size:calc(11px*var(--ui))}
.tp-note.sel{border-color:var(--rk-line);background:var(--rk-soft2);color:var(--rk-accent);font-weight:700}
.tp-check{background:var(--rk-soft2);border:1px solid var(--rk-line);color:var(--rk-accent);border-radius:6px;padding:7px;cursor:pointer;font-weight:700}
.tp-target{font-size:calc(12px*var(--ui));color:var(--rk-ink)}
.tp-listen{font-size:calc(11px*var(--ui));color:var(--rk-accent);background:var(--rk-soft);border-radius:5px;padding:6px 8px;text-align:center}
.tp-fb{font-size:calc(10px*var(--ui));line-height:1.5;border-radius:6px;padding:7px 9px}
.tp-fb.ok{background:color-mix(in srgb, var(--rk-ok) 12%, transparent);color:var(--rk-ok);border:1px solid color-mix(in srgb, var(--rk-ok) 30%, transparent)}
.tp-fb.no{background:color-mix(in srgb, var(--rk-bad) 10%, transparent);color:var(--rk-bad);border:1px solid color-mix(in srgb, var(--rk-bad) 30%, transparent)}
.tp-next{background:var(--rk-accent);border:none;color:var(--rk-chassis);border-radius:6px;padding:8px;cursor:pointer;font-weight:800}
.tp-hero{background:linear-gradient(145deg,var(--rk-soft2),var(--rk-soft));border:1px solid var(--rk-edge);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.tp-herorow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tp-find{background:var(--rk-accent);border:none;color:var(--rk-chassis);border-radius:7px;padding:7px 10px;cursor:pointer;font-weight:800}
.tp-level{font-size:calc(10px*var(--ui));color:var(--rk-dim);font-weight:700}
.tp-level.dim{color:var(--rk-ink-mute)}
.tp-progbar{height:7px;border-radius:4px;background:var(--rk-panel);overflow:hidden;border:1px solid var(--rk-edge-soft)}
.tp-progfill{height:100%;background:linear-gradient(90deg,var(--rk-dim),var(--rk-accent));transition:width .3s}
.tp-progtxt{font-size:calc(10px*var(--ui));color:var(--rk-ink-dim)}
.tp-cont{background:var(--rk-accent);border:none;color:var(--rk-chassis);border-radius:7px;padding:8px;cursor:pointer;font-weight:800}
.tp-unit{border:1px solid var(--rk-edge-soft);border-radius:9px;padding:8px 9px;background:var(--rk-panel2)}
.tp-uhead{display:flex;justify-content:space-between;align-items:center;font-size:calc(12px*var(--ui));font-weight:700;color:var(--rk-ink)}
.tp-ucount{font-size:calc(9px*var(--ui));color:var(--rk-ink-mute);font-weight:600}
.tp-usum{font-size:calc(9px*var(--ui));color:var(--rk-ink-mute);margin:2px 0 6px}
.tp-lessons{display:flex;flex-direction:column;gap:4px}
.tp-lesson{display:flex;align-items:center;gap:8px;text-align:left;background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);color:var(--rk-ink-dim);border-radius:6px;padding:6px 8px;cursor:pointer}
.tp-lesson:hover{border-color:var(--rk-line)}
.tp-lesson.done{opacity:.72}
.tp-lesson.rec{border-color:var(--rk-line);background:var(--rk-soft)}
@keyframes tpJustLeft{0%{background:var(--rk-soft2)}100%{background:var(--rk-panel2)}}
.tp-lesson.just-left{animation:tpJustLeft 1.4s ease-out}
.tp-li{width:14px;text-align:center;color:var(--rk-accent)}
.tp-lesson.done .tp-li{color:var(--rk-ok)}
.tp-lt{flex:1;font-size:calc(11px*var(--ui))}
.tp-ll{font-size:calc(8px*var(--ui));color:var(--rk-ink-mute)}
.tp-done{font-size:calc(14px*var(--ui));font-weight:800;color:var(--rk-ok);text-align:center;padding:10px}
</style>`;
