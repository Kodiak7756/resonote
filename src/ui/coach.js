// ── Pedal Coach ──────────────────────────────────────────────────────
// Interactive walkthroughs that run ON the live pedal: a floating coach bar
// gives one instruction at a time while a halo ring highlights the real
// control. Clicking the highlighted control advances the tour (Next always
// works too). Launched from the "?" Reference via the 'resonote:coach' event;
// completion is remembered in localStorage ('rn-coach-done').
//
// Tour step shape: { target: '#arm-$ID' | '#body-$ID .cls', text, advance: 'click'|'next' }
// '$ID' is replaced with the live pedal's id at runtime. Targets are re-resolved
// continuously, so pedals that rebuild their innerHTML never strand the halo.
//
// A target that no longer matches anything fails SILENTLY — the halo just never
// appears — which is worse than no tour for a friend on day one. So every target
// below is a class or id the pedal actually renders TODAY, and each tour walks the
// pedal from its home view in the order its views actually appear: a step that
// clicks into a sub-view must not be followed by a target that only exists in the
// view it just left. Re-audit these whenever a pedal is restructured.

const ACC = '#5ad1c0';                 // coach teal — distinct from the pedals' ambers
const DONE_KEY = 'rn-coach-done';

export const TOURS = {
  // No 'sketchpad' tour: the pedal is gone and its UI is the Practice Manager's
  // 📖 Songbook. Its old step targets were sketchpad-derived ids that no longer
  // resolve, so the tour could only have failed silently. The Songbook deserves its
  // own steps inside the practice tour — worth writing, not worth faking.
  progression: { title: 'Progression Studio', steps: [
    { target: '#body-$ID .fn-btn', advance: 'click', text: 'These are the key’s chords by <b>FUNCTION</b>. Tap one to <b>arm</b> it.' },
    { target: '#body-$ID .grid-cell', advance: 'click', text: 'Now <b>paint</b>: tap bars in the grid to place the armed chord. Right-click a cell to clear it.' },
    { target: '#body-$ID .color-chip', advance: 'next', text: '<b>COLOR</b> chips are borrowed &amp; secondary chords — same arm-and-paint flow, spicier sounds.' },
    { target: '#body-$ID .prog-play', advance: 'click', text: '<b>▶</b> plays the grid — each chord lights its real grip on the neck as it sounds.' },
    { target: '#body-$ID .prog-drill', advance: 'next', text: '<b>DRILL</b> loops your progression as practice — the same engine the Theory Path uses.' },
    { target: '#body-$ID .prog-export-midi', advance: 'next', text: '<b>⇄ Export</b> writes the progression as a MIDI file for REAPER — see the 🌉 REAPER Bridge pedal for the full round trip.' },
  ]},
  workshop: { title: 'Technique Workshop', steps: [
    { target: '#body-$ID .ws-tab', advance: 'next', text: 'Five tools in one — these tabs switch between Positions, Groove, Finger, Technique and Voicings.' },
    { target: '#body-$ID .ws-tab[data-tab="voicings"]', advance: 'click', text: 'Tap <b>🧵 VOICINGS</b> — the string-set voicing lab lives here.' },
    { target: '#ws-body-$ID', advance: 'next', text: 'Each tab keeps its own controls in this body — set what to practice and ▶ run it; drills follow the session KEY and TEMPO.' },
    { target: '#body-$ID .rk-theory-head', advance: 'next', text: 'The <b>💡 THEORY</b> panel under each tab says what you’re drilling and why — <b>Learn the theory →</b> opens the matching lesson on the LEARN page, so theory and reps stay connected.' },
  ]},
  // Reading happens on the LEARN page; the pedal is the launcher + progress card.
  // The 📖 click in step 3 switches to that page, and the page MINIMISES the pedal
  // cards (display:none) — so the last two steps point at #body-learn, the page
  // mount, not at the pedal; a #body-$ID target there would halo nothing.
  theory: { title: 'Theory Path', steps: [
    { target: '#body-$ID .tp-find', advance: 'next', text: '<b>🎯 Find My Level</b> asks a few quick questions and places you on the path. Nothing is locked — the whole course stays open.' },
    { target: '#body-$ID .tp-lesson.rec, #body-$ID .tp-lesson', advance: 'click', text: 'Each unit lists its lessons, easiest first. <b>▶</b> marks the one recommended next — tap a lesson to open it.' },
    { target: '#body-$ID .tp-readpage', advance: 'click', text: 'The pedal is a compact launcher. <b>📖 Open as page</b> puts the lesson on the LEARN page, where it has room to read.' },
    { target: '#body-learn .tp-demo', advance: 'click', text: '<b>▶ Hear &amp; see it</b> plays the idea on the neck above — every teach card lights the real notes, so you hear what you just read.' },
    { target: '#body-learn .tp-ex', advance: 'next', text: 'Then the <b>EXERCISE</b>: identify by ear, build the notes, or play it on your guitar. Right or wrong, it explains why — finish them all and the lesson ticks off on the path.' },
  ]},
  practice: { title: 'Practice Manager', steps: [
    { target: '#body-$ID .pm-view[data-pv="session"]', advance: 'next', text: 'Three views: <b>Session</b> builds a timed practice, <b>🎓 Theory</b> loops curriculum drills, <b>📋 Library</b> stores saved routines.' },
    { target: '#body-$ID .pm-view[data-pv="theory"]', advance: 'click', text: 'Open <b>🎓 Theory</b>.' },
    { target: '#body-$ID .th-unit', advance: 'click', text: 'Every Theory Path unit is here — tap one to open its drills.' },
    { target: '#body-$ID .th-play', advance: 'click', text: '<b>▶</b> loops that lesson’s drill on the neck — the − / + TEMPO buttons re-time it live.' },
    { target: '#body-$ID .pm-view[data-pv="session"]', advance: 'next', text: 'Back in <b>Session</b> view you can build timed practice blocks and track streaks — 💾 saves a session for reuse.' },
  ]},
  // Order matters here: BARS / ADVANCE / ＋ New live on the grid, and tapping a card
  // swaps the grid for that workout's options panel — so the grid-only controls come
  // first and the card tap comes last, landing on the panel's ▶ START.
  workouts: { title: 'Workouts', steps: [
    { target: '#body-$ID .wo-bars[data-b="4"]', advance: 'next', text: '<b>BARS</b> sets how long each item stays on the neck before the next one lands. These controls follow you into every workout.' },
    { target: '#body-$ID .wo-adv[data-v="listen"]', advance: 'next', text: '<b>ADVANCE</b>: <b>⏱ Auto</b> moves on the bar; <b>🎤 Listen</b> waits until your mic hears every note of the grip before showing the next one.' },
    { target: '#wonew-$ID', advance: 'next', text: '<b>＋ New</b> (PRO) builds your own workout — choose the chord pool or string set, bars per item, and an optional tempo ramp.' },
    { target: '#body-$ID .wo-card', advance: 'click', text: 'Tap any workout card to open it — try <b>🎲 Open Chords</b>: a random grip lights the neck and changes on the bar.' },
    { target: '#wostart-$ID', advance: 'click', text: 'Each workout has its own options — KEY keeps it in the session key or opens all 12 roots. <b>▶ START</b> runs it; ⏹ stops it from either view.' },
  ]},
  improvlab: { title: 'Improv Lab', steps: [
    { target: '#body-$ID .il-mode[data-m="call"]', advance: 'next', text: 'Two modes: <b>🗣️ Call &amp; Response</b> teaches the conversation of music; <b>🎸 Jam</b> lets you solo over a backing track.' },
    { target: '#body-$ID .il-key', advance: 'next', text: 'Set the <b>KEY</b> and <b>FEEL</b> (the scale). Everything transposes — practice the same idea in every key.' },
    { target: '#body-$ID .il-level', advance: 'next', text: 'The ladder: <b>① Echo</b> play the call back · <b>② Answer</b> copy a model reply · <b>③ Create</b> improvise your own resolving answer.' },
    { target: '#body-$ID #il-play', advance: 'click', text: 'Press <b>▶ Play the call</b> — a short phrase plays and asks a question. Then it\'s your turn to answer it.' },
    { target: '#body-$ID .il-mode[data-m="jam"]', advance: 'next', text: 'Switch to <b>🎸 Jam</b> for backing-track soloing — the neck shows the scale, the current chord\'s arpeggio, and the 3rd to target through the changes.' },
  ]},
  ear: { title: 'Functional Ear Trainer', steps: [
    { target: '#body-$ID .fet-group[data-g="ear"]', advance: 'next', text: 'Two groups: <b>🎧 EAR</b> trains listening, <b>🧠 THEORY</b> trains recall. Each has its own modes.' },
    { target: '#body-$ID .fet-group[data-g="theory"]', advance: 'click', text: 'Switch to <b>🧠 THEORY</b>.' },
    { target: '#body-$ID .fet-qmode[data-qm="bassid"]', advance: 'click', text: 'Pick a mode — <b>🎸 Bass ID</b> plays a triad with one of its own notes in the bass; you name which member is lowest.' },
    { target: '#body-$ID .fet-qstartround', advance: 'click', text: '<b>▶ START ROUND</b> — rounds are timed; answer with the chips that appear.' },
    { target: '#body-$ID .fet-qtheory', advance: 'next', text: 'Answer with these chips — streaks and best scores are kept per mode. That’s the loop; ✕ ends a round any time.' },
  ]},
};

export function coachDone(type) {
  try { return !!(JSON.parse(localStorage.getItem(DONE_KEY) || '{}')[type]); } catch (e) { return false; }
}
function markDone(type) {
  try { const d = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); d[type] = true; localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (e) { /* private mode */ }
}

let active = null;   // { type, pedalId, idx, halo, bar, timer, clickFn, scrolled, advancing }

function ensureCss() {
  if (document.getElementById('coach-css')) return;
  const st = document.createElement('style');
  st.id = 'coach-css';
  st.textContent = `
    @keyframes coach-pulse { 0%,100% { box-shadow: 0 0 0 3px ${ACC}55, 0 0 18px ${ACC}66; } 50% { box-shadow: 0 0 0 6px ${ACC}33, 0 0 26px ${ACC}88; } }
    .coach-halo { position: fixed; border: 2px solid ${ACC}; border-radius: 9px; pointer-events: none; z-index: 99998; animation: coach-pulse 1.6s ease-in-out infinite; transition: top .18s, left .18s, width .18s, height .18s; }
    .coach-bar  { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 99999; max-width: 460px; width: calc(100% - 40px);
      background: #0d1917; border: 1px solid ${ACC}66; border-radius: 12px; padding: 11px 14px; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  `;
  document.head.appendChild(st);
}

const resolveSel = () => active ? active.tour.steps[active.idx].target.replace(/\$ID/g, active.pedalId) : null;

function renderBar() {
  const { tour, idx } = active;
  const st = tour.steps[idx];
  const last = idx === tour.steps.length - 1;
  active.bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="mono" style="color:${ACC};font-size:calc(9px*var(--ui));font-weight:800;letter-spacing:1.5px">🎓 ${tour.title.toUpperCase()}</span>
      <span class="mono" style="color:#5a7a74;font-size:calc(9px*var(--ui))">${idx + 1} / ${tour.steps.length}</span>
      <button class="coach-quit" style="margin-left:auto;background:none;border:none;color:#5a7a74;cursor:pointer;font-size:calc(13px*var(--ui));padding:0 2px">✕</button>
    </div>
    <div style="color:#cfe4df;font-size:calc(12px*var(--ui));line-height:1.55">${st.text}</div>
    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">
      ${st.advance === 'click' ? `<span class="mono" style="color:#5a7a74;font-size:calc(9px*var(--ui));align-self:center;margin-right:auto">click the highlighted control…</span>` : ''}
      <button class="coach-next" style="background:${ACC}22;border:1px solid ${ACC};border-radius:7px;color:${ACC};font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;padding:5px 14px;cursor:pointer">${last ? 'Done ✓' : 'Next →'}</button>
    </div>`;
  active.bar.querySelector('.coach-quit').onclick = e => { e.stopPropagation(); stopCoach(); };
  active.bar.querySelector('.coach-next').onclick = e => { e.stopPropagation(); advance(); };
}

function track() {
  if (!active) return;
  const el2 = document.querySelector(resolveSel());
  if (el2) {
    if (!active.scrolled) { active.scrolled = true; try { el2.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    const r = el2.getBoundingClientRect();
    Object.assign(active.halo.style, { display: 'block', top: (r.top - 5) + 'px', left: (r.left - 5) + 'px', width: (r.width + 6) + 'px', height: (r.height + 6) + 'px' });
  } else {
    active.halo.style.display = 'none';
  }
}

function advance() {
  if (!active || active.advancing) return;
  active.advancing = true;
  setTimeout(() => {
    if (!active) return;
    active.advancing = false;
    active.idx++;
    active.scrolled = false;
    if (active.idx >= active.tour.steps.length) { markDone(active.type); stopCoach(); return; }
    renderBar(); track();
  }, active.tour.steps[active.idx].advance === 'click' ? 450 : 0);   // let the control's own action land first
}

export function stopCoach() {
  if (!active) return;
  clearInterval(active.timer);
  document.removeEventListener('click', active.clickFn, true);
  active.halo.remove(); active.bar.remove();
  active = null;
}

export function startCoach(type, pedalId) {
  const tour = TOURS[type];
  if (!tour) return;
  stopCoach();
  ensureCss();
  const halo = document.createElement('div'); halo.className = 'coach-halo'; halo.style.display = 'none';
  const bar = document.createElement('div'); bar.className = 'coach-bar';
  document.body.appendChild(halo); document.body.appendChild(bar);
  const clickFn = e => {
    if (!active || active.tour.steps[active.idx].advance !== 'click') return;
    if (e.target.closest && e.target.closest(resolveSel())) advance();
  };
  document.addEventListener('click', clickFn, true);
  active = { type, tour, pedalId, idx: 0, halo, bar, clickFn, scrolled: false, advancing: false, timer: setInterval(track, 250) };
  renderBar(); track();
}
