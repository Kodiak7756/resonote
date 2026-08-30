# Resonote ⇄ REAPER — Using Them Together

Resonote writes and explains the music; REAPER records and produces it. The bridge
is two one-way streets:

```
Resonote (browser)                              REAPER 7.x
┌───────────────────────┐                      ┌───────────────────────┐
│ Progression Studio ───┼── ⇄ Export .mid ──▶  │ Resonote Import       │
│ Beat Maker ───────────┼── ⇄ Export .mid ──▶  │ (one action = item    │
│ REAPER Bridge pedal ──┼── quick test ─────▶  │  at the edit cursor)  │
│         ▲             │                      │                       │
│  Analyze audio  ◀─────┼──── render WAV ◀─────┤ File → Render         │
│  (tempo · key · notes │                      │                       │
│   on the fretboard)   │                      │                       │
└───────────────────────┘                      └───────────────────────┘
```

## One-time setup (REAPER side)

The import script lives in this repo at `reaper/Resonote_Import.lua` and is
installed at `%APPDATA%\REAPER\Scripts\Resonote\Resonote_Import.lua`.

1. REAPER → **Actions → Show action list**.
2. **New action → Load ReaScript…** → pick `Resonote_Import.lua`.
3. Select it and **assign a shortcut** (suggested: `Ctrl+Alt+I`).

That's it — one keystroke now means "bring in whatever I just exported."
If the file ever goes missing, copy it back from `reaper/` in this repo.

## Resonote → REAPER (composing out)

### A progression (Progression Studio)
1. Paint chords into the bars as usual.
2. **REAPER BRIDGE** section → pick a style:
   - **Guitar voicings (strummed)** — the app's real fretboard grips, strummed
     low-to-high. Put a guitar VSTi or amp-sim'd sampler on the track.
   - **Block chords (piano)** — plain stacked triads/7ths near C3.
   - **Arpeggiated 8ths** — up-down eighth-note arps.
3. **⇄ Export** → a `.mid` lands in **Downloads**.
4. In REAPER: select the destination track (no selection = new track), place the
   edit cursor, press **Ctrl+Alt+I**. The item appears at the cursor.

The file embeds **tempo and time signature** (6/8 etc. included) — REAPER offers
to adopt them on import.

### A beat (Beat Maker)
1. Paint the groove (or start from a genre preset).
2. Pick the **drum map**: **GM** for MT Power Drum Kit / SSD5 (kick 36, snare 38,
   hats 42/46), **Sitala** for the Clean 808 pad layout.
3. **⇄ Export MIDI for REAPER** → import with the same keystroke. Downbeats are
   accented (velocity 110 vs 88).

### Quick sanity check (REAPER Bridge pedal)
The 🌉 pedal's **⇄ Quick test** exports I–IV–V–I in the current master key —
use it any time to confirm the pipeline end-to-end.

## REAPER → Resonote (analysis in)

1. Render or record in REAPER (a raw take from `D:\Guitar\Media` works too).
2. 🌉 REAPER Bridge → **📂 Choose a WAV / MP3**.
3. You get: **tempo** (with half/double alternates — pick the one that matches
   the feel), top **key** candidates, duration-weighted **notes used** bars, a
   **note timeline**, and every detected pitch mapped **onto the fretboard**
   with the root emphasized.
4. **🔑 Set master key** pushes the detected key to every linked pedal — the
   Scale Explorer, Circle, and drills all snap to what you actually played.

**The practice loop this enables:** record an improv over a backing track →
render → analyze → see which notes you actually leaned on vs. the scale you
*thought* you were playing.

### Analysis limits (objective)
- Note tracking is **monophonic** — single-note lines transcribe well; strummed
  chords still yield a solid key/tempo but a rough note line.
- Tempo of free (no-click) takes is an estimate; alternates cover half/double time.
- Files longer than ~3 minutes work but take tens of seconds.

## File conventions

| Thing | Convention |
|---|---|
| Export name | `resonote_<kind>_<YYYYMMDD_HHMMSS>.mid` |
| Folders the import action searches | `Downloads`, `D:\Guitar\ResonoteBridge`, `…\outbox` |
| Which file imports | The **newest timestamp** across all folders |
| MIDI format | Type-0 SMF, PPQ 480, tempo + time-sig meta embedded |

## Troubleshooting

- **"No resonote_*.mid files found"** — export something first, or check the
  browser actually saved to Downloads.
- **Item landed on the wrong track** — select the target track before running
  the action; with nothing selected it creates a new track.
- **Wrong tempo after import** — REAPER's import prompt controls whether the
  file's embedded tempo is adopted (Preferences → Media → MIDI to change the default).
- **Wrong drum sounds** — the map must match the sampler: GM for MT Power/SSD5,
  Sitala for the 808 kit's chromatic pads.

## Engine verification

`src/core/audio-analysis.js` reproduces the validated Python reference exactly
on `public/bridge-test-take.wav`: **84.0 BPM, F# Major .71 / A# Minor .70,
58 events, E2–A5**. Byte-level encoder test: `node tools/test-midi-writer.mjs`.
