// ── 🎤 "did you actually play that?" — the shared mic gate ────────────
// Every drill that waits on your hands (the TAB page's listen mode, Workouts'
// flash grips and pattern runs, the Improv Lab's call & response) needs the same
// judgement call, and it is all about ATTACKS, not pitches:
//   · silence re-arms the gate — a note left ringing must not keep scoring
//   · a new pitch class re-arms it — a legato run credits every note in it
//   · a note more than `cents` off is a different note, so it doesn't count
//   · one credit per attack — otherwise a held note scores 60 times a second
// audio.on() has no unsubscribe, so a listener never truly goes away: stop()
// only puts it to sleep, and the owner hook keeps a pedal rebuild from stacking
// a second live copy on top of the first.
import { audio } from './audio.js';

// One tolerance for the whole app — the hand-copied gates had drifted apart.
export const CENTS_TOLERANCE = 40;

// Hook the mic ONCE PER OWNER: the flag lives on the owner (a pedal's p object,
// or a page's module state) and the hook always calls the NEWEST handler, so a
// rebuild replaces its listener instead of adding one, and two instances of the
// same pedal each hear independently.
function hook(owner, key, handler) {
  if (!owner) { audio.on(handler); return; }
  owner['_' + key] = handler;
  if (!owner['_' + key + 'Hooked']) { owner['_' + key + 'Hooked'] = true; audio.on(() => owner['_' + key]?.()); }
}

// onAttack(note, detected) fires once per attack that clears the gate;
// onSilence() fires on every silent frame (callers debounce it themselves).
export function createListener({ owner = null, key = 'listen', cents = CENTS_TOLERANCE,
                                isActive = () => true, onAttack, onSilence } = {}) {
  let armed = true, lastHeard = null, dead = false;

  const handler = () => {
    if (dead || !isActive()) return;
    const det = audio.detected;
    if (!det) { armed = true; lastHeard = null; onSilence?.(); return; }
    if (det.note !== lastHeard) { armed = true; lastHeard = det.note; }
    if (!armed || Math.abs(det.cents ?? 0) > cents) return;
    armed = false;
    onAttack?.(det.note, det);
  };
  hook(owner, key, handler);

  return {
    stop() { dead = true; if (owner && owner['_' + key] === handler) owner['_' + key] = null; },
    // for a caller that moves the goalposts itself (new step, new box): let a
    // note that is still ringing count for what comes next
    rearm() { armed = true; lastHeard = null; },
  };
}

// "play all of these" — chords, grips, a tab step. `want` is a list of pitch-class
// names, or a function returning the current one; an empty list is a rest and can
// never complete. onProgress fires per newly-heard note, then onComplete once the
// whole list is in.
export function expectNotes({ want = [], cents, owner, key, isActive, onProgress, onComplete } = {}) {
  const heard = new Set();
  let target = want;
  const list = () => [...new Set(typeof target === 'function' ? target() : target)];

  const gate = createListener({
    owner, key, cents, isActive,
    onAttack: note => {
      const w = list();
      if (!w.length || !w.includes(note) || heard.has(note)) return;
      heard.add(note);
      onProgress?.(note, heard, w);
      if (heard.size >= w.length) onComplete?.(heard, w);
    },
  });

  return {
    heard,                                   // stable Set — safe to hold a reference to
    stop: gate.stop,
    rearm: gate.rearm,
    // next step / next grip: same subscription, clean slate, gate re-armed
    reset(nextWant) { if (nextWant !== undefined) target = nextWant; heard.clear(); gate.rearm(); },
  };
}
