# Resonote — Teaching Consolidation & Connected-Learning Plan

From the `resonote-teaching-consolidation` review (7 agents). The goal: every
pedal either *is* theory or *demonstrates* a Theory Path concept; fewer, clearer
pedals; the Chord-Family-Lab "hear→see→play→resolve + why" loop as the house style;
a function-colour (tonic=red / subdominant=green / dominant=blue) + tendency-arrow
"why" layer shared by lessons and pedals.

> **See also `LEARNING-DESIGN.md`** — how the teaching works (function-colour as a
> taught code, predict-before-reveal, generation, spacing). It promotes
> "consistent function-colouring" from UX upgrade #4 to a hard build requirement.

## Lean pedal set — 23 → 12, in 5 categories

- **LEARN:** Theory Path ★, Chord-Family Lab ★
- **HARMONY:** Circle of Fifths, Chord Directory, Progression Studio
- **FRETBOARD:** Scale & Arpeggio Explorer
- **PRACTICE:** Functional Ear Trainer, Technique Workshop, Practice Manager, Beat Maker
- **INPUT:** Tuner ★ (includes Audio Input), Metronome

(★ = starter board, shown on first run; the rest reveal on demand.)

## OLD → NEW mapping

| Current | Verdict |
|---|---|
| theory, chordlab, circle5, metronome | KEEP |
| chords (Chord Directory) | KEEP + enhance (hear→see→play loop; degrees, colour tone, function-in-key) |
| beatmaker | KEEP (stripped to a backing track) |
| practice | KEEP (refactor: pass params via bus, add Theory-Path checkpoints) |
| scales + arpeggios | MERGE → **Scale & Arpeggio Explorer** (teaches arpeggio = chord tones from the scale) |
| progression + songdir | MERGE → **Progression Studio** (Custom / Library / Analyze, Roman-numeral labels, voice-leading) |
| ear + notequiz | MERGE → **Functional Ear Trainer** (identify the I/IV/V, not just abstract labels) |
| runner + finger + technique + rhythm | MERGE → **Technique Workshop** (Positions / Patterns / Articulation / Groove, each rep tagged with its theory) |
| audio | MERGE → **Tuner** |
| tab, amp, looper, vocals | CUT (notation/tone/jamming — out of scope; punt to a future Studio Mode) |

## Theory each kept pedal must surface
Degrees over letters; function-colour for "why"; tension meter for the felt
explanation; tendency arrows for resolution. Chord Directory shows formula in
degrees + colour tone + function-in-current-key. Circle shows Roman + functional
name (home/away/tension) + motion arrows. Scale&Arp links scale↔arpeggio. Ear
Trainer tests function. Technique Workshop tags each rep with interval/function.

## Connected teaching (Theory Path ⇄ pedals) — reuse existing hooks

**Lesson → pedal (LAUNCH & DEMONSTRATE).** Add one optional `teach.launch`
field to a lesson: `{ pedal, seed:{…p.settings}, links:{key,tempo,position}, cta }`.
One ~15-line `launchFromLesson()` in main.js: mount/focus the pedal (addPedal +
bringToFront), `pedalBus.rebuildPedal(pedal, seed)`, drive the buses
(`setKey`/`metroClock.set`/`positionBus.set`) exactly like the Circle does, and
(per the auto-link decision) link it so the concept lights on the shared fretboard
+ the session bar animates ("driving N pedals"). Each Teach card shows ONE primed
"▶ Practice this" button — no menus. Example deep-links: U5 "Why V pulls to I" →
Chord-Family Lab on G7→Cmaj7 (tritone red, tension meter drops to green); U3
"Nashville Numbers" → Progression Studio I–IV–V–I, re-fire setKey so numerals stay
while chords transpose; U7 "Dorian" → Scale Explorer D Dorian, raised-6th highlighted.

**Pedal → lesson (REVERSE).** A `PEDAL_LESSON_MAP` (pedal + current state → lesson
id). A "?" chip in the pedal header (next to 🔑/⏱) calls `openLesson(id)`
(addPedal('theory') + `rebuildPedal('theory',{view:'lesson',curId})` + setCurrent) —
state-aware (Lab on altered-dominants → the altered-dominant lesson). Plus a shared
`whyPanel(lessonId)` footer pulling `teach.summary` + `teach.earTip` from the
curriculum (authored once, never drifts).

## Top UX upgrades
1. Curated 3-pedal default board (Theory Path + Chord-Family Lab + Tuner), rest in drawer.
2. Progressive unlock — a pedal auto-mounts the first time a lesson launches it (board as a progress map).
3. "What should I do today?" view over `recommendNext()` + SRS weak items → one tap.
4. Consistent function-colouring everywhere (one palette + tendency arrows).
5. Nashville/Roman labels as a global toggle (default ON), driven off the master key.
6. Animated session bar as visible "proof of connection."

## Build phases
0. **Consolidation** (cut/merge to ~12).
1. **Launch mechanism** (`teach.launch` + `launchFromLesson` + one "Practice this" CTA) — the spine.
2. **Reverse link** (`PEDAL_LESSON_MAP` + "?" chip + `whyPanel`).
3. **Friendly-app shell** (curated board, progressive unlock, Today view, function colour, Nashville toggle).
4. **Curriculum gap-fills** (Borrowed-Chords Lab family, Minor-key function, Rhythm-as-theory, Functional-ear drills).

## Open decisions (for the user)
Auto-link on launch vs pre-seed+prompt · consolidation aggressiveness · first-run
board (curated+unlock vs placement-driven) · single instance per pedal type.
