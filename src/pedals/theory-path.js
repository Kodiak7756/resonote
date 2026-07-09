// ── Theory Path ──────────────────────────────────────────────────────
// A guided, basics→advanced music-theory course inside the app. Every lesson
// = a short Teach card (shown + played on the fretboard, with a "why it sounds
// like that" ear-tip) and a practical, scored exercise (identify by ear, build
// a scale/chord, or play it on the guitar). Opens with a "Find My Level"
// placement; the whole path stays visible and open.
import { NOTES, CHORD_TYPES, SCALE_TYPES, getChordNotes, getScaleNotes, toSharp } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, metroClock, fretboardView, setFretboardView } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';

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
  function stopSeq() { if (_seqStop) { _seqStop(); _seqStop = null; } }
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
    let h = `<div class="tp-wrap">`;
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
    let h = `<div class="tp-wrap">`;
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
      h += `<div class="tp-ex" style="border-color:rgba(122,209,122,.35)">
        <div class="tp-exhead" style="color:#7ad17a">🎸 PRACTICE DRILL</div>
        <div style="font-weight:700;color:#dfe7e7;margin-bottom:2px">${d.title || 'Drill'}</div>
        ${prog ? `<div class="mono" style="color:#9ab0b0;font-size:10px">${prog}</div>` : ''}
        <div class="mono" style="color:#7a8a8a;font-size:9px;margin-top:2px">${d.bpm || 90} BPM · ${d.timeSig || '4/4'}${d.voicing ? ' · ' + d.voicing : ''}</div>
        ${d.pattern ? `<div class="mono" style="color:#7a8a8a;font-size:9px">${d.pattern}</div>` : ''}
        ${d.focus ? `<div style="color:#9ab0b0;font-size:10px;margin-top:3px">🎯 ${d.focus}</div>` : ''}
        <button class="tp-demo" data-act="drillsee" style="margin-top:8px">▶ Hear &amp; see it on the fretboard ↑</button>
        <button class="tp-next" data-act="drillprog" style="margin-top:6px;background:rgba(122,209,122,.12);border-color:#7ad17a;color:#7ad17a">🎸 Practice this drill (loops in 🎓 Theory) →</button>
      </div>`;
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
  function openLesson(id) {
    stopSeq();
    curId = id; exIdx = 0; resetEx(); setCurrent(id); view = 'lesson'; persist();
    // The lesson presents its concept in the right view: chord-motion lessons → Voice-Leading flow.
    if (FLOW_LESSONS.has(id)) applyFbView('voice');
    else if (fretboardView === 'voice') applyFbView('standard');
    const L = lessonById(id); if (L?.drill) highlightDrill(L.drill); else if (L?.teach?.demo) highlightDemo(L.teach.demo);
    renderLesson(id);
  }

  // ── Placement ───────────────────────────────────────────────────────
  function startPlacement() {
    view = 'placement'; placeIdx = 0; placePassed = 0; placeMissStreak = 0; placeAnswered = false; placeDone = false; chosenIdx = -1;
    persist(); renderPlacement();
  }
  function renderPlacement() {
    const Q = CURRICULUM.placement || [];
    if (!Q.length) { view = 'path'; return renderPath(); }
    if (placeDone) {
      setPlaced(placePassed || 1);
      const recd = recommendNext(getProgress(), ALL);
      let h = `<div class="tp-wrap"><div class="tp-title">🎯 Your level</div>`;
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
    let h = `<div class="tp-wrap"><div class="tp-top"><button class="tp-mini" data-act="path">← Path</button><span class="tp-crumb">Find My Level · ${placeIdx + 1}/${Q.length}</span></div>`;
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

const STYLE = `<style>
.tp-wrap{display:flex;flex-direction:column;gap:8px;font-size:11px;color:#cfd6d6}
.tp-top{display:flex;align-items:center;gap:8px}
.tp-crumb{color:#7fb3aa;font-size:9px;letter-spacing:.5px}
.tp-mini{background:rgba(255,255,255,.04);border:1px solid #3a3a3a;color:#9aa;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:9px}
.tp-title{font-size:15px;font-weight:800;color:#eaffff}
.tp-card{background:rgba(90,209,192,.06);border:1px solid rgba(90,209,192,.25);border-radius:8px;padding:9px 10px}
.tp-sum{font-size:12px;line-height:1.5;color:#e3eded}
.tp-points{margin:6px 0 0;padding-left:16px;line-height:1.6;color:#b9c4c4}
.tp-points li{margin:2px 0}
.tp-tip{margin-top:7px;font-size:10px;line-height:1.5;color:#cfe9e4;background:rgba(90,209,192,.09);border-left:2px solid #5ad1c0;padding:5px 7px;border-radius:4px}
.tp-demo{background:rgba(90,209,192,.14);border:1px solid #5ad1c0;color:#5ad1c0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;margin-top:8px}
.tp-demo.sm{padding:4px 9px;font-size:10px;margin-top:0}
.tp-ex{background:rgba(0,0,0,.18);border:1px solid #333;border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:7px}
.tp-exhead{color:#8aa;font-size:8px;letter-spacing:1px}
.tp-q{font-size:12px;font-weight:600;color:#eaffff;line-height:1.45}
.tp-opts{display:flex;flex-direction:column;gap:5px}
.tp-opt{text-align:left;background:rgba(255,255,255,.03);border:1px solid #3a3a3a;color:#dde;border-radius:6px;padding:7px 9px;cursor:pointer;font-size:11px}
.tp-opt:hover{border-color:#5ad1c0}
.tp-opt.ok{border-color:#7ad17a;background:rgba(122,209,122,.14);color:#bdf0bd}
.tp-opt.no{border-color:#e0556b;background:rgba(224,85,107,.12);color:#f0b6c0}
.tp-earrow{display:flex;gap:6px;flex-wrap:wrap}
.tp-play{background:rgba(90,209,192,.1);border:1px solid #46897e;color:#7ddccb;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700}
.tp-notes{display:flex;flex-wrap:wrap;gap:4px}
.tp-note{min-width:26px;background:rgba(255,255,255,.03);border:1px solid #3a3a3a;color:#cdd;border-radius:5px;padding:5px 0;cursor:pointer;font-size:11px}
.tp-note.sel{border-color:#5ad1c0;background:rgba(90,209,192,.22);color:#eaffff;font-weight:700}
.tp-check{background:rgba(90,209,192,.16);border:1px solid #5ad1c0;color:#5ad1c0;border-radius:6px;padding:7px;cursor:pointer;font-weight:700}
.tp-target{font-size:12px;color:#dde}
.tp-listen{font-size:11px;color:#5ad1c0;background:rgba(90,209,192,.08);border-radius:5px;padding:6px 8px;text-align:center}
.tp-fb{font-size:10px;line-height:1.5;border-radius:6px;padding:7px 9px}
.tp-fb.ok{background:rgba(122,209,122,.12);color:#bdf0bd;border:1px solid rgba(122,209,122,.3)}
.tp-fb.no{background:rgba(224,85,107,.1);color:#f0b6c0;border:1px solid rgba(224,85,107,.3)}
.tp-next{background:#5ad1c0;border:none;color:#06302a;border-radius:6px;padding:8px;cursor:pointer;font-weight:800}
.tp-hero{background:linear-gradient(145deg,rgba(90,209,192,.12),rgba(90,209,192,.03));border:1px solid rgba(90,209,192,.3);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.tp-herorow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tp-find{background:#5ad1c0;border:none;color:#053;border-radius:7px;padding:7px 10px;cursor:pointer;font-weight:800}
.tp-level{font-size:10px;color:#7ddccb;font-weight:700}
.tp-level.dim{color:#789}
.tp-progbar{height:7px;border-radius:4px;background:#1a1a1a;overflow:hidden;border:1px solid #2a2a2a}
.tp-progfill{height:100%;background:linear-gradient(90deg,#3a8f7f,#5ad1c0);transition:width .3s}
.tp-progtxt{font-size:10px;color:#9fb0b0}
.tp-cont{background:#5ad1c0;border:none;color:#053;border-radius:7px;padding:8px;cursor:pointer;font-weight:800}
.tp-unit{border:1px solid #2c2c2c;border-radius:9px;padding:8px 9px;background:rgba(255,255,255,.015)}
.tp-uhead{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#dfeaea}
.tp-ucount{font-size:9px;color:#789;font-weight:600}
.tp-usum{font-size:9px;color:#889;margin:2px 0 6px}
.tp-lessons{display:flex;flex-direction:column;gap:4px}
.tp-lesson{display:flex;align-items:center;gap:8px;text-align:left;background:rgba(255,255,255,.025);border:1px solid #333;color:#cdd;border-radius:6px;padding:6px 8px;cursor:pointer}
.tp-lesson:hover{border-color:#5ad1c0}
.tp-lesson.done{opacity:.72}
.tp-lesson.rec{border-color:#5ad1c0;background:rgba(90,209,192,.1)}
.tp-li{width:14px;text-align:center;color:#5ad1c0}
.tp-lesson.done .tp-li{color:#7ad17a}
.tp-lt{flex:1;font-size:11px}
.tp-ll{font-size:8px;color:#678}
.tp-done{font-size:14px;font-weight:800;color:#7ad17a;text-align:center;padding:10px}
</style>`;
