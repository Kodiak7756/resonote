# Resonote

A visual guitar-theory app. Plug in, and the neck shows you what you're playing — with lessons, drills, a metronome, backing tracks and a songbook built around the fretboard.

## Run it

You need **Node 18 or newer** (https://nodejs.org).

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**. On Windows you can double-click `START-RESONOTE.bat` instead — it installs on first run and starts the server.

## Things to know

- **The mic only works on `localhost` or `https`.** If you open the app over a plain `http://192.168…` address, the tuner and listen-to-advance features won't be able to hear you. Use `localhost` on the same machine, or host it over https.
- **Your data lives in your browser.** Everything you write — pieces, board layout, settings — is stored in the browser's local storage for `localhost:5173`. Clearing site data clears it. **Export your Songbook** (Practice Manager → 📖 Songbook → ⬇ Export) before you clear anything or move machines, and ⬆ Import it on the other side.
- **Nothing is locked.** FREE / PRO / STUDIO on the pedals are just labels for now.
- Fonts load from Google Fonts; offline it falls back to system fonts and keeps working.

## Where things are

- **PRACTICE** — the pedalboard over the neck. Add pedals with **+ PEDALS**, dock them with the ▁ button, bring them back from the DOCKED rail. **FOCUS** docks everything and gives the neck the room.
- **LEARN** — the Theory Path as a readable page: lessons, demos on the neck, exercises, drills.
- **TAB** — write pieces beat by beat on tab, staff and the neck at once; they save to your Songbook.
- **STUDIO** — recording and the REAPER bridge.
- **Instruments** — the display above the pedals can be a guitar neck (any tuning), a piano, a **Lumatone** hex board (Wicki-Hayden or Bosanquet layout — the same interval is always the same step, so a shape learned in one key is the same shape in every key), or **Vocals** (a pitch ladder with a live trace of what you sing, target rungs for whatever a pedal lights, and a find-my-range tool).
- **Rhythm Game** (a FREE pedal) — real rhythm notation scrolls toward a hit line; tap Space, click the lane, or let the mic hear you, and every tap is judged to the millisecond against the click. Patterns run from quarter notes to syncopation, 3/4 and 6/8.

## Sharing

The simplest way to give this to someone is to host it: `npm run build` and put `dist/` on GitHub Pages, Netlify or Vercel. That gives them one https link, and the mic works.
