# Resonote — Learning-Design Principles

Companion to `TEACHING-PLAN.md`. That doc decides **what** ships; this one decides
**how it teaches**. These are build rules, not philosophy — none of the reasoning
below appears in UI copy. It lives in mechanics only (see §6).

## 0. Priority order (decided)

1. **Function-colour** — teach it, reinforce it, enforce consistency
2. **Predict-before-reveal** — tension meter first, then mic scoring
3. **Generation mode** — place the shape before it's shown
4. **Ladder gates on days, not peaks**
5. *Later:* scaffold fade (opt-in + configurable) and metronome dropout — §5

---

## 1a. DECIDED + SHIPPED — the note spectrum is the code

Kevin's call (2026-06-23): the code is **one 12-hue note spectrum, ordered in
fifths**, used everywhere. This supersedes the red/green accessibility problem in
§1 — the axis is no longer tonic-vs-subdominant, and the **note letter always
rides with the hue**, which is the redundant channel §1 asked for.

- **One module:** `src/core/colors.js` — `FIFTHS`, `PC_HUE` (C=0°, G=30° … F=330°),
  `pcColor(note,s,l)`, `pcTextOn(note)`. No local palettes anywhere.
- **Permanent legend** (§1's reinforcement channel): 12 chips above the neck,
  fifths order, always visible. Built in `fretboard.js updateOverlays` (`#pc-legend`).
- **Neck view `🌈 Spectrum`**: every dot wears its note's hue. Needs no key root.
- **Circle of Fifths pedal**: major ring = each key's hue; relative minors share
  the hue a shade darker. The TAB page's mini-circle uses the same module.
- **Retrieval, not exposure** (§1's fluency requirement): Ear Trainer THEORY →
  `🌈 Colour` — a note sounds, the answers are **12 blank swatches**; the reveal
  pairs the swatch with its letter. The colour IS the response modality.

Why fifths-ordered: neighbouring keys are neighbouring hues, so one key's notes
form a colour family and distant keys read as distant colour. Function-colour
(§1, degree-relative) still exists as the `🎨 Function` view — the two are
different questions ("which note" vs "which role"), and they never share a surface.

## 1. Function-colour is a code, not decoration

tonic = red · subdominant = green · dominant = blue

An arbitrary mapping becomes perception only if it is **(a)** taught explicitly
once, **(b)** reinforced by retrieval, and **(c)** never contradicted. Miss any
one of the three and it stays wallpaper.

**Consistency is a hard requirement, not a UX upgrade.** Currently #4 in the
TEACHING-PLAN "Top UX upgrades" list — promote it. If dominant is blue in
Chord-Family Lab and anything else in Progression Studio, the result isn't a
weaker association, it's *none*: a code that contradicts itself never gets
committed to. **No pedal ships until it conforms.** One palette module, imported
everywhere; no local colour constants.

**Teach it once, in ~20 seconds, on first run.** Not a tour. Three chords in the
current key, each one played, each lighting its colour, each labelled with the
functional name already specified in the plan (home / away / tension). Hear →
see → name. That's the whole introduction.

**Keep a permanent legend.** Small, always-visible key in the shared fretboard
header or session bar. This is the reinforcement channel and it costs almost
nothing.

**Reinforce by retrieval, not exposure.** Functional Ear Trainer already tests
function — let it sometimes take the answer *as a colour*. Making the colour the
response modality is what converts an arbitrary code into a fluent one. Passive
exposure alone is slow and unreliable.

**Cap the vocabulary at 3 (+1).** Three functions, plus at most one for
borrowed/outside. Arbitrary-code capacity is small; a fourth and fifth colour
degrade the first three.

**Accessibility — red/green is the wrong pair.** Red-green deficiency affects
roughly 8% of males, and tonic-vs-subdominant is exactly that axis. The code must
carry a **redundant channel** — shape, fill pattern, or position — so it survives
without hue, plus an alternate palette in settings. Far cheaper to fix now than
after the colour is in twelve pedals.

## 2. Predict before reveal

Ask for the learner's judgement *before* showing ground truth. This trains the
accuracy of their internal readout, which is what eventually lets them practise
without the app.

- **Tension meter:** the user drags it where they think the chord sits, then the
  real value reveals. One interaction.
- **Mic scoring:** "Was that clean?" (yes/no) → *then* the score.

Cheap to build, and it's the mechanic that most directly produces independence.

## 3. Generation beats presentation

Recognition encodes poorly; construction encodes well — deciding *what the thing
is* is what does the work.

In Scale & Arpeggio Explorer and Technique Workshop, add a mode where the user
**taps the shape onto the fretboard from memory** before the answer appears.
Same content, materially better retention.

Corollary: **never shuffle fretboard layout.** Spatial position is part of the
encoding.

## 4. Spacing over intensity

Skill consolidates over weeks, not sessions. SRS already assumes this; extend it
to the woodshed ladder:

- Gate the BPM climb on **consistency across days**, not one good rep.
- Surface **days-at-level**, not peak score. Peak score rewards the wrong thing.

## 5. Deferred — scaffold fade & metronome dropout

Not in this pass. Recorded so the design is settled when it is.

**Fade hints, pulse references.** The distinction matters:

| Type | Examples | Treatment |
|---|---|---|
| **Hint** — supplies an answer the learner should own | function colour, note names, shape overlays | **Fade** as accuracy rises; restore if it falls |
| **Reference** — supplies an external standard, not an answer | metronome, tuner pitch, backing track | **Never fade.** Make it *intermittent* to measure drift |

A fading metronome is wrong — the click isn't a hint, it's the reference. The
right mechanic is **dropout**: click for 2 bars, silent for 2, then it returns and
you hear how far you drifted. Also the classic 2-and-4-only variant. That's a
measurement, and it deserves to be its own practice feature rather than a
scaffold setting.

**All fade behaviour is opt-in and configurable** — off by default, with per-type
control (colour / names / overlays) and a rate. Never adjust difficulty on the
user without their say-so.

## 6. Non-negotiables

- **No jargon in the UI.** Not one term from the learning literature. Explicit
  framing of a motor skill can actively interfere with acquiring it — keeping
  this invisible is pedagogy, not just taste.
- **`whyPanel` / the "?" chip is the only surface** where any of this may appear,
  one layer down and opt-in, as a single plain-language line.
- **The app should aim to become unnecessary, skill by skill.** Any feature that
  permanently substitutes for a skill the learner came here to build is a defect,
  not a convenience.
