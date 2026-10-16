# Resonote in the headset (VR, phase A)

Each pedal — and the neck — as a window of its own in the Meta Quest 3's
browser, live with the PC. The guitar, the audio interface, MIDI and the mic
all stay on the PC, and the PC runs Resonote exactly as before; the headset
just gets more screens.

## Start it

**On the PC**

1. Double-click `START-RESONOTE.bat` (or `npm run dev`).
2. Open **http://localhost:5173** on the PC as usual. This window is the one
   that matters: it holds the mic and the board, and the headset follows it.
   **Keep it on screen, not minimised** — a hidden browser window has its
   timers slowed down, and the beat, the tempo and the "still here" heartbeat
   to the headset stall with them.
3. The terminal prints the headset's address under Vite's own:

   ```
   ➜  Quest:   https://192.168.50.99:5443/vr   ← open this in the headset
   ```

The first time, Windows may ask whether **Node.js** may communicate on your
networks: tick **Private networks** and allow it. (If it was refused once:
Windows Security → Firewall & network protection → Allow an app through
firewall → Node.js → tick Private.)

**In the headset**

1. Open the Quest browser and go to **`192.168.50.99:5443/vr`** (the address
   the terminal printed — typing it without `https://` is fine).
2. The first time it warns *"Your connection is not private"*: choose
   **Advanced → Proceed to 192.168.50.99**. That certificate is Resonote's
   own, made on your PC (in `dev-cert/`); the warning only means no public
   authority signed it. Accept it once — it may ask again after a browser
   restart, or if the PC's address changes (a new certificate is made then).
3. The hub lists the pedals on the PC's board, plus the neck. Press **Open as
   its own window** on each one you want and place the windows around you.
   Every window shows **Connected to PC** (green) or **Not connected to the
   PC** (red).
4. If a button opens a tab instead of a window, open a new browser window and
   type the short address shown under the pedal's name, e.g.
   `192.168.50.99:5443/vr/circle5`.
5. In a pedal window: **A− / A+** change its size (remembered), **↻** reloads
   it from the PC, **Hub** goes back to the list.

## How it behaves

- **A headset window is a copy.** The PC keeps its own card on the board
  (marked 👓 VR while a copy is open). Key, tempo, hand position, what the neck
  shows and the note the mic hears follow the PC live; what you do in the
  headset — pick a key on the Circle of Fifths, push a chord to the Chord
  Directory, change the Metronome's tempo — goes back to the PC.
- **A pedal's own options** (which view it's on, its settings): while a copy is
  open in the headset, the copy's are the ones the PC saves, and the PC's card
  takes them on when the copy closes. Change those options in one place at a
  time — in the headset while it's open there.
- **The mic stays on the PC.** The guitar is plugged in there. A copy of
  **Input & Tuner** in the headset shows what the PC hears (tuner, levels,
  which input) and its buttons and knobs work the PC's input — Connect, the
  input list, gain and gate all happen on the PC. If the browser on the PC
  has never been allowed the mic, answer that question on the PC once.
- **Every pedal can be opened.** Under **More pedals** the hub lists the ones
  not on the PC's board yet; opening one puts it on the PC's board too.
- **Sound plays where you press play.** Start the Metronome in the headset and
  it clicks in the headset; start it on the PC (or from the Stream Deck) for
  the audio interface. The two Metronomes keep the same tempo either way.
- **The Stream Deck and F13–F24 drive the PC's window only**, as before.
- The PC's own flow is unchanged: **http://localhost:5173**, mic and all. Use
  `localhost` on the PC, not its network address — the mic doesn't work on a
  plain-http network address, and the headset only follows the localhost window.
- The headset link exists only while the dev server runs (`START-RESONOTE.bat`
  / `npm run dev`); the GitHub Pages build carries none of it.

## If it doesn't work

- **The page won't load in the headset:** is the headset on the same Wi-Fi as
  the PC? Was the firewall question answered with Private? Is it the address
  the terminal printed? (If the PC has several networks the terminal lists the
  others too.)
- **"Not connected to the PC":** is Resonote open on the PC at
  `localhost:5173`, and on screen? Headset windows reconnect by themselves —
  and a window opened before the PC was ready fills in as soon as it is.
- **"port 5443 is in use":** another Resonote dev server is still running.
- **A fresh certificate:** delete the `dev-cert/` folder and restart.
- **Not on your home network?** While the dev server runs, anyone on the same
  network can open the https door, as with `--host`. To keep it shut, start
  with `RESONOTE_VR=off` set (`set RESONOTE_VR=off` in the window first, on
  Windows); everything on `localhost` works as usual.

## Under the hood

- `tools/vite-plugin-vr.js` — the relay (the dev server's HMR socket hands each
  sync message to every other window) and the https door on :5443 (a TLS socket
  piping bytes to the dev server, WebSockets included). Vite itself stays on
  localhost.
- `tools/dev-cert.js` — the self-signed certificate, made with Node's crypto.
- `src/core/sync.js` — BroadcastChannel + LAN relay, each message applied
  exactly once; the PC heartbeat.
- `src/ui/popout.js` — headset windows (and the PC's side of them);
  `src/ui/vr-hub.js` — the hub; `src/styles/vr.css` — the VR display mode.
