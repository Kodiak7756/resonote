# Resonote — Architecture Contracts (home-base / conductor)

The load-bearing truth for the "home base" overhaul. Three buses in
`src/core/state.js` are the single source of truth; pedals are dumb followers
that opt in. **Decisions** (chosen with the user):

- **Linking is OPT-IN.** A pedal does NOT follow a master until the user links
  it. `bus.follows(type)` returns true only when `links[type] === 'linked'`.
- **The Circle of Fifths is the one editor of the master Key.** A pedal changing
  its own root locally is a temporary *override*, not a redefinition of the
  master (one-click "reset to master" re-syncs it).
- **Spelling:** keep the existing sharp normalization (`toSharp`) everywhere for
  now; proper key-signature spelling is a later polish.
- **DI feedback:** single-note confirmation for v1 (reliable on a direct input).

---

## pedalBus — master KEY (`state.js`)

```
pedalBus.root, .keyType, .source        // current master key
pedalBus.masterKey {root,keyType,source}// what the session bar mirrors
pedalBus.generation                     // ++ each setKey (stale-broadcast guard)
pedalBus.links {}                       // { [type]: 'linked' }  — opt-in
pedalBus.setKey(root, keyType, meta)     // Circle of Fifths calls this; meta.pushChord optional
pedalBus.on(fn)                          // followers subscribe; fn(session)
pedalBus.follows(type)                   // true only if linked  ← Wave 2 adds this to each follower's guard
pedalBus.linkPedal(type) / unlinkPedal(type) / isLinked(type)
pedalBus.followerCount(activeTypes)      // "driving N pedals" badge
pedalBus.onLinks(fn)                     // session bar / chips re-render on link change
pedalBus.rebuildPedal(type, settings)    // main.js hook; Circle of Fifths chord-push uses it
```

Follower opt-in (Wave 2 — one line per pedal):
```js
pedalBus.on(ev => {
  if (!ev.root || ev.source === p.id || !pedalBus.follows(p.type) ||
      !document.getElementById(`body-${p.id}`)) return;
  /* existing accept code, unchanged */
});
```
Chord push (Wave 2): the C5 calls `setKey(keyRoot, keyType, {source, pushChord:{root,quality,numeral}})`
and/or `rebuildPedal('chords', {mode:'chord', root, chordType})`. Pedals that read
`ev.pushChord` react; others ignore it.

## metroClock — master TEMPO (`state.js`)

```
metroClock.bpm, .ts, .unit, .pattern, .beatIndex, .pulse, .masterSource
metroClock.set(bpm,ts,unit,pattern) / setBeat(i,type) / on(fn) / emit()
metroClock.links {} ; follows(type) ; linkPedal/unlinkPedal/isLinked ; followerCount ; getTempo()
```
Wave 2: keep `masterSource='metronome'` even when stopped (a stopped master is
still the master); tempo followers gate their `metroClock.on` with `metroClock.follows(p.type)`;
add count-in (`countIn`/`armed`) for looper/beat-maker downbeat-locked record.

## positionBus / positionIsolation — fretboard HAND POSITIONS (`state.js`)  ✅ Wave 1

```
positionIsolation { active, loFret, hiFret, loString, hiString, dimOutside,
                    selectedPreset, customShape:[{si,fret}], defining }
positionBus.set(loFret, hiFret, opts)    // window presets (fret/key-box)
positionBus.update(opts) / clear()
positionBus.setDefining(on)              // custom-shape build mode
positionBus.addShapeFret(si, fret)       // toggle a fret into the custom shape
positionBus.on(fn)                        // position bar + fretboard re-render
```
`fretboard.js` imports `positionIsolation` and multiplies each "all notes" dot's
opacity by `posDim(fret, si)` (1 inside the window / shape, ~0.13 outside) — it
**dims, never hides**, so the all-notes practice view stays intact. Presets reuse
`KEY_POSITION_ZONES` (numbered) and `findScaleBoxes()` (key-aware CAGED boxes that
shift with the master key). Custom shapes come from fretboard clicks while
`defining` is on.

---

## Build status
- **Wave 1 (done):** bus foundation (pedalBus/metroClock link API + masterKey +
  generation; positionBus); fretboard position isolation + `src/ui/position-bar.js`.
- **Wave 2 (next):** Circle of Fifths master harmony-hub (key + diatonic chords +
  secondary dominants + modulation + chord-push); Metronome master tempo;
  per-pedal 🔗 link chips; pinned session bar; add `follows()` guard to the 12
  followers. See the workflow output / `_homebase.md` + `_roadmap.md` for the
  full per-pedal roadmap.
```
