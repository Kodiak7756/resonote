// ─── Write It — a drill format for composing ──────────────────────────────────
// "Write 8 bars" is an OUTCOME, not a task, and nobody can execute an outcome —
// which is exactly why the blank page wins. This pedal turns it into a handful of
// small decisions: here is the sound, here is the chord move that proves it, here
// are five constraints, now fill in eight bars. Constraint-first is not a
// beginner's crutch; it is how the work is actually done.
//
// Everything below is DERIVED from the mode's interval set rather than authored,
// so it is right by construction and every mode gets the same quality of recipe:
// stack thirds inside the scale for each chord, and name the one note that
// distinguishes this mode from the plain major or minor it is a bend of.
import { NOTES, SCALE_TYPES, toSharp, intervalLabel } from '../core/music-theory.js';
import { read, write, KEYS } from '../core/store.js';
import { pickGrip, TRIAD_QUALITIES } from '../core/voicings.js';
import { setChordHighlight, clearChordHighlight, clearGhostHighlight, metroClock } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { playPlan } from '../curriculum/drill-runner.js';
import { playNote } from '../core/synth.js';
import { setFretboardClickHandler } from '../main.js';
import { customTuning, getNoteAtFret } from '../core/tuning.js';
import { pcColor } from '../core/colors.js';
import { GENRES, GENRE_NAMES, genreChords } from '../core/genres.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

// Fretboard overlay ink — the ONE place this file is still allowed a literal.
// These four are drawn into the shared fretboard SVG, which lives outside this
// pedal's card, so a kit token here would resolve against the page rather than
// against this pedal and the overlay would come out unpainted.
const NECK = { root: '#c0b4ff', tone: '#6f68a8', rootStroke: '#ded6ff', toneStroke: '#9a92bb' };

// Which scale degree makes each mode itself, and which chord exposes it. The
// characteristic note is the one that differs from the parent major (Ionian) or
// natural minor (Aeolian) — change it and the mode collapses into an ordinary key.
const MODE_INFO = {
  Ionian:     { char: 3, tell: 3, of: 'major',  blurb: 'plain major — the reference every other mode is heard against' },
  Dorian:     { char: 5, tell: 3, of: 'minor',  blurb: 'minor with a RAISED 6th' },
  Phrygian:   { char: 1, tell: 1, of: 'minor',  blurb: 'minor with a FLAT 2nd' },
  Lydian:     { char: 3, tell: 1, of: 'major',  blurb: 'major with a RAISED 4th' },
  Mixolydian: { char: 6, tell: 6, of: 'major',  blurb: 'major with a FLAT 7th' },
  Aeolian:    { char: 5, tell: 5, of: 'minor',  blurb: 'plain natural minor — the reference for the minor modes' },
  Locrian:    { char: 4, tell: 0, of: 'minor',  blurb: 'minor with a FLAT 5th — no stable home chord at all' },
};
const MODES = Object.keys(MODE_INFO);

const DEG_NAME = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

const nameAt = (rootPc, semis) => NOTES[(rootPc + semis) % 12];

// A mode's degrees must be named by WHERE THEY SIT IN THE SCALE, not by their
// semitone distance. F♯ Lydian's colour note is 6 semitones up, and a semitone
// lookup calls that a ♭5 — which is the Locrian note, the opposite feeling. It is
// the ♯4, because it is the FOURTH degree, raised. Compare each degree against the
// plain major scale and the accidental falls out.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ACCID = { '-2': '♭♭', '-1': '♭', '0': '', '1': '♯', '2': '♯♯' };
const degLabel = (ints, i) => (ACCID[String(ints[i] - MAJOR[i])] ?? '') + (i + 1);

// Seven degrees, seven letter names, one each — the spelling that makes the mode
// readable (F♯ G♯ A♯ B♯ C♯ D♯ E♯, never a stray C natural in the middle of it).
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function spellScale(rootName, ints) {
  const rl = LETTERS.indexOf(rootName[0]);
  const rootPc = NOTES.indexOf(toSharp(rootName));
  return ints.map((semi, i) => {
    const letter = LETTERS[(rl + i) % 7];
    const want = (rootPc + semi) % 12;
    let d = ((want - LETTER_PC[letter] + 18) % 12) - 6;
    return letter + (ACCID[String(d)] ?? (d > 0 ? '♯'.repeat(d) : '♭'.repeat(-d)));
  });
}

// Stack thirds INSIDE the scale from a degree — the only honest way to name a
// mode's chords, because the scale decides the quality, not a lookup table.
function chordOn(rootPc, ints, deg, size = 3) {
  const semis = [];
  for (let k = 0; k < size; k++) {
    const d = (deg + 2 * k) % 7;
    const oct = Math.floor((deg + 2 * k) / 7);
    semis.push(ints[d] + 12 * oct);
  }
  const base = semis[0];
  const rel = semis.map(s => (s - base + 24) % 12);
  const triad = rel.slice(0, 3).join(',');
  let quality = Object.keys(TRIAD_QUALITIES).find(q => TRIAD_QUALITIES[q].join(',') === triad) || 'Major';
  let label = nameAt(rootPc, base);
  if (size === 4) {
    const seventh = rel[3];
    if (quality === 'Major' && seventh === 11) label += 'maj7';
    else if (quality === 'Major' && seventh === 10) label += '7';
    else if (quality === 'Minor' && seventh === 10) label += 'm7';
    else if (quality === 'Dim' && seventh === 10) label += 'm7♭5';
    else label += quality === 'Minor' ? 'm' : quality === 'Dim' ? '°' : '';
  } else {
    label += quality === 'Minor' ? 'm' : quality === 'Dim' ? '°' : '';
  }
  return { rootPc: (rootPc + base) % 12, root: nameAt(rootPc, base), quality,
           notes: semis.map(s => nameAt(rootPc, s)), label, deg };
}

function recipe(root, mode) {
  const ints = SCALE_TYPES.Modes[mode];
  const info = MODE_INFO[mode];
  const rootPc = NOTES.indexOf(toSharp(root));
  if (rootPc < 0 || !ints) return null;
  const scale = ints.map(s => nameAt(rootPc, s));
  const tonic = chordOn(rootPc, ints, 0, 4);          // a 7th on the tonic — more colour, more information
  const tell  = chordOn(rootPc, ints, info.tell, 3);
  const charNote = scale[info.char];
  const spell = spellScale(root, ints);
  return {
    ints, scale, spell, tonic, tell, charNote,
    charSpelled: spell[info.char],
    charLabel: degLabel(ints, info.char),
    charDegName: DEG_NAME[info.char],
    tellDegName: DEG_NAME[info.tell],
    degLabelAt: i => degLabel(ints, i),
    blurb: info.blurb,
  };
}

// ── the constraint card ───────────────────────────────────────────────────────
// Every rule is here for a reason and the reason is printed next to it — a rule
// you do not understand is one you will not keep using once the pedal is closed.
function dealCard(charIdx) {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return {
    // start on a chord tone that isn't the root; end on the colour note most of
    // the time, because that is the ending that keeps the mode audible
    start: pick([2, 4, 5]),
    end:   pick([charIdx, charIdx, 5, 1]),
    budget: pick([3, 4, 4, 5]),
    rhythm: pick([
      'One note per beat — and hold one whole bar somewhere.',
      'Two notes per beat, but leave bar 4 empty.',
      'Long, short-short. Repeat that cell all eight bars.',
    ]),
    shape: pick([
      'One leap of a 4th or wider. Everything else steps.',
      'Climb for four bars, fall for four.',
      'Say a two-bar idea, then answer it changed at the end.',
    ]),
  };
}

// ── pedal ─────────────────────────────────────────────────────────────────────
export function buildWriteItContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  const s = p.settings || (p.settings = {});
  s.wRoot = s.wRoot || 'F#';
  s.wMode = s.wMode || 'Lydian';
  s.answer = s.answer || [];                 // [{si,fret,note,octave}]
  const alive = () => !!document.getElementById(`body-${p.id}`);

  const stopAll = () => {
    if (p._wVamp) { p._wVamp(); p._wVamp = null; window.dispatchEvent(new CustomEvent('resonote:beat', { detail: { action: 'stop' } })); }
    if (p._wMel) { p._wMel.forEach(t => clearTimeout(t)); p._wMel = null; }
  };
  // one owner for the neck click: claim it only while TAP is armed, hand it back
  // the moment it is not (the Sketchpad wants the same single slot)
  const disarm = () => { if (p._wArmed) { p._wArmed = false; setFretboardClickHandler(null); } };

  const card = () => (p._wCard || (p._wCard = dealCard(MODE_INFO[s.wMode].char)));

  function render() {
    const r = recipe(s.wRoot, s.wMode);
    if (!r) { el.innerHTML = '<div class="rk"><div class="mono" style="color:var(--rk-ink-mute)">unknown mode</div></div>'; return; }
    const c = card();
    // The vamp's home chord and the chord that moves are the same accent at two
    // weights — the difference is which one you are leaving, not two products.
    const chip = (txt, primary) => `<span class="mono" style="display:inline-block;padding:3px 7px;border-radius:5px;border:1px solid ${primary ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};background:${primary ? 'var(--rk-soft2)' : 'var(--rk-soft)'};color:${primary ? 'var(--rk-accent)' : 'var(--rk-dim)'};font-size:calc(10px*var(--ui));font-weight:700">${txt}</span>`;
    const btn = (id, lab, on, extra = '') => `<button id="${id}" class="mono" style="min-height:calc(28px*var(--ui));background:${on ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${on ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};border-radius:6px;color:${on ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'};font-size:calc(10px*var(--ui));padding:6px 11px;cursor:pointer;${extra}">${lab}</button>`;
    const gripOf = ch => {
      const g = pickGrip(ch.root, ch.notes, ch.quality, 'open', 0);
      if (!g) return '<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">no grip</span>';
      const per = {};
      (g.positions || g).forEach(q => { if (q.fret >= 0) per[q.si] = q.fret; });
      return `<span class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">` +
        [0, 1, 2, 3, 4, 5].map(si => per[si] === undefined ? '·' : per[si]).reverse().join(' ') + `</span>`;
    };

    el.innerHTML = `
    <div class="rk">
      <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <select id="wi-root-${p.id}" style="background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:4px">
          ${NOTES.map(n => `<option ${n === s.wRoot ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <select id="wi-mode-${p.id}" style="background:var(--rk-panel2);border:1px solid var(--rk-edge-soft);border-radius:5px;color:var(--rk-ink);font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));padding:4px">
          ${MODES.map(m => `<option ${m === s.wMode ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <span style="flex:1"></span>
        ${btn(`wi-neck-${p.id}`, '👁 Show the mode', false)}
      </div>

      <!-- the recipe, in one line you could repeat to someone -->
      <div style="background:var(--rk-panel);border:1px solid var(--rk-edge);border-radius:9px;padding:8px 10px;line-height:1.65">
        <div class="mono" style="color:var(--rk-ink);font-size:calc(11px*var(--ui));font-weight:700">${s.wRoot} ${s.wMode} — ${r.blurb}.</div>
        <div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui));margin-top:3px">
          The tell: your <b style="color:var(--rk-dim)">${r.tellDegName}</b> chord is
          <b style="color:var(--rk-dim)">${r.tell.quality === 'Major' ? 'MAJOR' : r.tell.quality === 'Minor' ? 'MINOR' : r.tell.quality.toUpperCase()}</b> (${r.tell.label}).
        </div>
        <div class="mono" style="color:var(--rk-ink-dim);font-size:calc(10px*var(--ui))">
          Colour note: <b style="color:${pcColor(r.charNote, 80, 70)}">${r.charSpelled}</b> — the <b style="color:var(--rk-dim)">${r.charLabel}</b>
          (${r.charDegName} degree${r.charSpelled !== r.charNote ? `, ${r.charNote} on the fretboard` : ''}).
          Land <i>on</i> it, don't pass through it.
        </div>
      </div>

      <!-- genre = a groove + a mode + a chord move. Pick one and all three land. -->
      <div class="rk-section">
        <div class="rk-label">BACKING <span class="rk-label-hint">a genre is a groove, a mode and a chord move</span></div>
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:5px">
          <button class="wi-gen" data-g="" style="min-height:calc(28px*var(--ui));padding:4px 8px;border-radius:5px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;background:${!s.wGenre ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${!s.wGenre ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};color:${!s.wGenre ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'}">just the mode</button>
          ${Object.keys(GENRES).map(g => `<button class="wi-gen" data-g="${g}" style="min-height:calc(28px*var(--ui));padding:4px 8px;border-radius:5px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;background:${s.wGenre === g ? 'var(--rk-soft2)' : 'var(--rk-panel2)'};border:1px solid ${s.wGenre === g ? 'var(--rk-line)' : 'var(--rk-edge-soft)'};color:${s.wGenre === g ? 'var(--rk-accent)' : 'var(--rk-ink-dim)'}">${g}</button>`).join('')}
        </div>
        ${s.wGenre ? `<div class="mono" style="color:var(--rk-ink-dim);font-size:calc(9px*var(--ui));line-height:1.55;margin-bottom:6px">${GENRES[s.wGenre].why}</div>` : ''}
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${vampChords(r).map((c, i) => `<div style="text-align:center">${chip(c.label + (c.bars > 1 ? ` ·${c.bars}` : ''), i === 0)}<div style="margin-top:3px">${gripOf(c)}</div></div>`).join('<span class="mono" style="color:var(--rk-ink-mute);align-self:center">→</span>')}
        </div>
        <!-- Once the label flips to ⏹ this is the halt control, and every halt in
             the app wears the same red — you reach for it mid-phrase with a guitar
             in your hands, so it has to be found without being read. -->
        <div style="display:flex;gap:6px;align-items:center;margin-top:7px">
          ${btn(`wi-vamp-${p.id}`, p._wVamp ? '⏹ Stop' : (s.wGenre ? '▶ Backing + drums' : '▶ Loop vamp'), !!p._wVamp,
                p._wVamp ? 'background:var(--rk-stop-soft);border-color:var(--rk-stop-edge);color:var(--rk-stop)' : '')}
          <span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">grips low→high · · = don't play${s.wGenre ? ' · drums come from the 🥁 Backing Track' : ''}</span>
        </div>
      </div>

      <!-- the constraints: five decisions instead of a blank page -->
      <div class="rk-section">
        <div style="display:flex;align-items:center">
          <div class="rk-label" style="flex:1">THE CARD</div>
          ${btn(`wi-deal-${p.id}`, '🎲 Re-deal', false, 'padding:4px 9px')}
        </div>
        <table class="mono" style="width:100%;font-size:calc(10px*var(--ui));color:var(--rk-ink-dim);border-collapse:collapse;line-height:1.6">
          <tr><td style="width:58px;color:var(--rk-ink-mute)">start on</td><td><b style="color:var(--rk-dim)">${r.spell[c.start]}</b> — the ${r.degLabelAt(c.start)}. Starting on the root announces the key and kills the float.</td></tr>
          <tr><td style="color:var(--rk-ink-mute)">end on</td><td><b style="color:var(--rk-dim)">${r.spell[c.end]}</b> — the ${r.degLabelAt(c.end)}. ${c.end === MODE_INFO[s.wMode].char ? 'That is the colour note: it leaves the phrase hanging open.' : 'Not the root — save that for when you actually want to land.'}</td></tr>
          <tr><td style="color:var(--rk-ink-mute)">use</td><td><b style="color:var(--rk-dim)">${c.budget} different pitches</b>, no more. Scarcity is what makes a melody memorable — and it stops you noodling.</td></tr>
          <tr><td style="color:var(--rk-ink-mute)">rhythm</td><td>${c.rhythm}</td></tr>
          <tr><td style="color:var(--rk-ink-mute)">shape</td><td>${c.shape}</td></tr>
        </table>
      </div>

      <!-- your answer -->
      <div class="rk-section">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <div class="rk-label" style="flex:1">YOUR ANSWER</div>
          ${btn(`wi-tap-${p.id}`, p._wArmed ? '✍️ Tapping' : '✍️ Tap the neck', !!p._wArmed)}
        </div>
        <!-- Degrees, not fret positions. You write a melody by thinking "3 up to
             ♯4", not "11th fret" — and this works whether or not you have the
             guitar in your hands. Tapping the neck adds to the same phrase. -->
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin:2px 0 4px">
          ${r.ints.map((_, i) => {
            const isChar = i === MODE_INFO[s.wMode].char;
            return `<button class="wi-deg" data-d="${i}" title="${r.spell[i]}"
              style="min-height:calc(28px*var(--ui));flex:1;min-width:34px;padding:5px 2px;border-radius:5px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:calc(10px*var(--ui));font-weight:700;
                     background:${isChar ? pcColor(r.scale[i], 55, 24) : 'var(--rk-panel2)'};
                     border:1px solid ${isChar ? pcColor(r.scale[i], 70, 55) : 'var(--rk-edge-soft)'};
                     color:${isChar ? pcColor(r.scale[i], 90, 80) : 'var(--rk-ink-dim)'}">${r.degLabelAt(i)}<br>
              <span style="font-size:calc(8px*var(--ui));opacity:.75">${r.spell[i]}</span></button>`;
          }).join('')}
        </div>
        <div id="wi-ans-${p.id}" style="display:flex;gap:3px;flex-wrap:wrap;min-height:22px;padding:5px 0"></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
          ${btn(`wi-hear-${p.id}`, '▶ Hear it with the vamp', false)}
          ${btn(`wi-undo-${p.id}`, '⌫', false, 'padding:6px 9px')}
          ${btn(`wi-clear-${p.id}`, 'clear', false, 'padding:6px 9px')}
          ${btn(`wi-save-${p.id}`, '💾 Keep it', false)}
        </div>
        <div id="wi-stat-${p.id}" class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-top:5px"></div>
      </div>
      ${theoryPanelHTML('writeit', {
        kicker: 'COMPOSE', title: 'Writing to a constraint',
        what: `A mode is a <b>colour note</b> plus the <b>chord move that exposes it</b>. Loop those two chords, then write a melody that leans on the colour note instead of avoiding it. The card gives you five decisions; make them and eight bars exist.`,
        why: `Blank-page paralysis is not a lack of ideas, it is a lack of <b>limits</b>. Constraint-first writing is how composers actually work: fewer choices, faster output, and a finished phrase you can judge. Change one rule and write it again — the rules you keep reaching for are your voice.`,
        lessonId: 'modes-intro',
      })}
    </div>`;

    wireTheoryPanel(el);
    renderAnswer();

    document.getElementById(`wi-root-${p.id}`).onchange = e => { s.wRoot = e.target.value; p._wCard = null; stopAll(); render(); };
    document.getElementById(`wi-mode-${p.id}`).onchange = e => { s.wMode = e.target.value; p._wCard = null; stopAll(); render(); };
    document.getElementById(`wi-deal-${p.id}`).onclick = () => { p._wCard = null; render(); };
    el.querySelectorAll('.wi-gen').forEach(b => b.onclick = () => {
      const g = b.dataset.g;
      stopAll();
      s.wGenre = g || null;
      // a genre carries its own mode and its own tempo — that IS the preset
      if (g) { s.wMode = GENRES[g].mode; metroClock.set(GENRES[g].bpm, metroClock.ts); }
      p._wCard = null;
      render();
    });
    document.getElementById(`wi-neck-${p.id}`).onclick = () => {
      const pos = [];
      setChordHighlight(s.wRoot, r.scale, `${s.wRoot} ${s.wMode}`, pos.length ? pos : null, NECK);
      updateOverlays();
    };
    document.getElementById(`wi-vamp-${p.id}`).onclick = () => {
      if (p._wVamp) { stopAll(); render(); return; }
      startVamp(r);
      render();
    };
    document.getElementById(`wi-tap-${p.id}`).onclick = () => {
      p._wArmed = !p._wArmed;
      setFretboardClickHandler(p._wArmed ? addNote : null);
      render();
    };
    el.querySelectorAll('.wi-deg').forEach(b => b.onclick = () => {
      const i = +b.dataset.d;
      const pos = playablePos(r.scale[i]);
      s.answer.push({ si: pos.si, fret: pos.fret, note: r.scale[i], disp: r.spell[i], octave: pos.octave, deg: i });
      playNote(r.scale[i], pos.octave, { dur: 0.4, gain: 0.18 });
      renderAnswer();
    });
    document.getElementById(`wi-undo-${p.id}`).onclick  = () => { s.answer.pop(); renderAnswer(); };
    document.getElementById(`wi-clear-${p.id}`).onclick = () => { s.answer = []; renderAnswer(); };
    document.getElementById(`wi-hear-${p.id}`).onclick  = () => { stopAll(); startVamp(r); playAnswer(); render(); };
    document.getElementById(`wi-save-${p.id}`).onclick  = () => saveAnswer(r);
  }

  // A degree needs somewhere to live on the neck before it can be saved as a step
  // or drawn in the roll — take the lowest comfortable position for that pitch.
  function playablePos(note) {
    for (let fret = 0; fret <= 15; fret++) {
      for (let si = customTuning.length - 1; si >= 0; si--) {
        const n = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
        if (toSharp(n.note) === toSharp(note)) return { si, fret, octave: n.octave };
      }
    }
    return { si: 0, fret: 0, octave: 3 };
  }

  function addNote(info) {
    if (!alive() || info.si === undefined || info.fret === undefined) { disarm(); return; }
    s.answer.push({ si: info.si, fret: info.fret, note: info.note, octave: info.octave || 3 });
    renderAnswer();
  }

  function renderAnswer() {
    const box = document.getElementById(`wi-ans-${p.id}`);
    if (!box) return;
    const r = recipe(s.wRoot, s.wMode);
    box.innerHTML = s.answer.length
      // show the SPELLED name (B♯, not C) — the spelling is half the lesson
      ? s.answer.map(n => `<span class="mono" style="padding:3px 6px;border-radius:5px;font-size:calc(10px*var(--ui));font-weight:700;background:${pcColor(n.note, 60, 26)};border:1px solid ${pcColor(n.note, 70, 52)};color:${pcColor(n.note, 90, 82)}">${n.disp || n.note}</span>`).join('')
      : `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(9px*var(--ui))">arm ✍️ and tap the neck — every note you tap lands here</span>`;
    // the only feedback that matters: are you keeping your own rules?
    const st = document.getElementById(`wi-stat-${p.id}`);
    if (st && r) {
      const c = card();
      const uniq = [...new Set(s.answer.map(n => toSharp(n.note)))];
      const outside = s.answer.filter(n => !r.scale.map(toSharp).includes(toSharp(n.note)));
      const first = s.answer[0], last = s.answer[s.answer.length - 1];
      const tick = ok => ok ? '<b style="color:var(--rk-ok)">✓</b>' : '<b style="color:var(--rk-bad)">✗</b>';
      st.innerHTML = s.answer.length ? [
        `${s.answer.length} notes`,
        `${tick(uniq.length <= c.budget)} ${uniq.length}/${c.budget} pitches`,
        `${tick(first && toSharp(first.note) === toSharp(r.scale[c.start]))} starts ${r.scale[c.start]}`,
        `${tick(last && toSharp(last.note) === toSharp(r.scale[c.end]))} ends ${r.scale[c.end]}`,
        outside.length ? `<b style="color:var(--rk-bad)">${outside.length} outside the mode</b>` : `${tick(true)} all in ${s.wMode}`,
      ].join(' · ') : '';
    }
  }

  // With no genre chosen this is the two-chord proof of the mode; with one, it is
  // that genre's actual progression, built in the key you picked.
  function vampChords(r) {
    if (!GENRES[s.wGenre]) return [{ ...r.tonic, bars: 4 }, { ...r.tell, bars: 4 }];
    return genreChords(s.wGenre, s.wRoot);       // one genre table, shared with 🥁
  }

  function startVamp(r) {
    const g = GENRES[s.wGenre];
    // With a genre chosen, the 🥁 Backing Track pedal owns the WHOLE thing — drums
    // and chords together, from the same genre table. This pedal only asks. With
    // no genre it plays its own two-chord proof of the mode, which is all it needs.
    if (g) {
      window.dispatchEvent(new CustomEvent('resonote:need-pedal', { detail: { type: 'beatmaker' } }));
      setTimeout(() => window.dispatchEvent(new CustomEvent('resonote:beat',
        { detail: { action: 'start', genre: s.wGenre, root: s.wRoot, full: true } })), 220);
      p._wVamp = () => {};                        // marks "playing" for the button label
      return;
    }
    const bar = (60 / (metroClock.bpm || 100)) * 4;
    p._wVamp = playPlan({ type: 'chords', chords: vampChords(r).map(c => ({
      root: c.root, notes: c.notes, label: c.label, dur: bar * c.bars,
    })) }, { loop: true, isAlive: alive, gain: 0.16 });
  }

  function playAnswer() {
    const bpm = metroClock.bpm || 100;
    const beat = 60 / bpm;
    p._wMel = s.answer.map((n, i) => setTimeout(() => {
      if (alive()) playNote(n.note, n.octave, { dur: beat * 0.9, gain: 0.2 });
    }, i * beat * 1000));
  }

  // Keeping it is the point — a phrase you wrote and can play back next week is
  // the difference between practising and having written something.
  function saveAnswer(r) {
    if (!s.answer.length) return;
    try {
      // Append and keep the LAST 100, matching sketchpad.js and tab-mode.js. This
      // used to unshift and keep the first 60 — the opposite end of an oppositely
      // ordered list — so once the library passed 60 entries a single Keep here
      // would silently delete the NEWEST pieces, which are the ones you just wrote.
      const lib = (() => { const v = read(KEYS.pieces, []); return Array.isArray(v) ? v : []; })();
      lib.push({
        name: `${s.wRoot} ${s.wMode} — written ${new Date().toISOString().slice(0, 10)}`,
        bpm: metroClock.bpm || 100, tsig: 4,
        about: `Written to a constraint card: start on ${r.scale[card().start]}, end on ${r.scale[card().end]}, ${card().budget} pitches. Colour note ${r.charNote} (${r.charLabel}). Vamp: ${r.tonic.label} → ${r.tell.label}.`,
        sections: [{ at: 0, name: s.wMode, note: `${r.blurb}. The ${r.tellDegName} chord is ${r.tell.quality}.` }],
        steps: s.answer.map(n => ({ notes: [{ si: n.si, fret: n.fret }], dur: 1 })),
      });
      write(KEYS.pieces, lib);
      const st = document.getElementById(`wi-stat-${p.id}`);
      if (st) st.innerHTML = `<b style="color:var(--rk-ok)">Kept.</b> It is in the Practice Manager's Songbook and the TAB page's song list.`;
    } catch (e) { /* storage full — the phrase is still on screen */ }
  }

  render();
}
