// Remote control: ONE command vocabulary, three ways in --
//   (1) the Stream Deck HTTP bridge (dev server -> HMR socket -> here),
//   (2) F13-F24 on the keyboard,
//   (3) window CustomEvent('resonote:command') for the console / a future shell.
//
// None of them know anything about pedals. They hand {cmd, args} to main.js,
// which owns the only implementation.

const KEYMAP = {
  F13:'play',       F14:'metro/toggle', F15:'bpm/down',  F16:'bpm/up',
  F17:'panic',      F18:'loop',         F19:'loop/a',    F20:'loop/b',
  F21:'loop/whole', F22:'beat/toggle',  F23:'page/next', F24:'fbview/next',
};
const SHIFTMAP = {
  F13:'pedal/practice', F14:'pedal/workouts',
  F15:'pedal/improvlab', F16:'pedal/theory',
};

// Some hardware, KVMs and RDP paths send F13-F24 as Shift+F1..F12 instead of
// their own scan codes. Normalise both shapes before looking anything up.
function codeOf(e) {
  const m = /^F(\d{1,2})$/.exec(e.code || '');
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 13) return { key: e.code, shifted: e.shiftKey };
  if (e.shiftKey && n <= 12) return { key: 'F' + (n + 12), shifted: false };
  return null;
}

export function initRemote({ apply, state }) {
  // CAPTURE is required, not stylistic: tab-mode.js, metronome.js and
  // tempo-control.js call stopPropagation() on EVERY keydown, which would kill
  // a bubble-phase listener whenever one of those fields has focus.
  //
  // No text-input guard, deliberately -- F13-F24 are non-printing, so letting
  // them through while typing is safe and keeps the deck alive mid-edit.
  window.addEventListener('keydown', e => {
    if (e.repeat) return;                      // a stuck key must not machine-gun the transport
    const hit = codeOf(e); if (!hit) return;
    const cmd = hit.shifted ? SHIFTMAP[hit.key] : KEYMAP[hit.key];
    if (!cmd) return;
    e.preventDefault(); e.stopPropagation();
    apply(cmd, {});
  }, { capture: true });

  window.addEventListener('resonote:command', e => {
    const d = e.detail || {}; if (d.cmd) apply(d.cmd, d.args || {});
  });

  // The Stream Deck bridge rides the dev server's own socket -- no new port,
  // no new process. import.meta.hot is undefined in a production build, so
  // this whole block is dev-only.
  if (import.meta.hot) {
    import.meta.hot.on('resonote:deck', d => d?.cmd && apply(d.cmd, d.args || {}));
    const push = () => { try { import.meta.hot.send('resonote:deck-state', state()); } catch (_) {} };
    push();
    setInterval(push, 500);
  }
}
