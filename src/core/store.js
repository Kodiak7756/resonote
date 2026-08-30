// ─── The store ────────────────────────────────────────────────────────
// Every piece of saved state in Resonote lives in localStorage under its own
// key, written from wherever happened to need it. Fifteen keys, three different
// conventions, no single place that knows what exists. That has cost real data
// twice now:
//
//   • write-it.js appended to the FRONT of the piece library and kept the first
//     60, while sketchpad.js and tab-mode.js appended to the BACK and kept the
//     last 100 — opposite ends of an oppositely ordered list. Past 60 pieces a
//     single Keep would have deleted the newest ones.
//   • the board was overwritten by an autosave that fired between a restore and
//     a reload, and there was no earlier copy to go back to.
//
// Neither was a hard bug. Both were the absence of one place that knows the
// rules. This is that place.
//
// The important guarantee is not "one API" — it is that DESTRUCTIVE WRITES LEAVE
// A TRAIL. You cannot prevent a program from writing the wrong thing. You can
// make sure the right thing is still there afterwards.

// ── the registry ──────────────────────────────────────────────────────
// One list of every key the app owns. A key that isn't here is a key nobody
// knows about, which is how the truncation bug lived as long as it did.
export const KEYS = {
  board:     'resonote-state',        // pedals, positions, per-pedal settings
  seen:      'resonote-seen',         // first-run flag
  pieces:    'rn-sketch-lib',         // everything written on the TAB page — the crown jewels
  songs:     'resonote-songs',        // imported text songs
  practice:  'resonote-practice-lib', // saved session plans + songdir-era progressions
  workouts:  'rn-workouts',           // custom workouts
  mix:       'rn-mix',                // the output mixer
  looks:     'rn-looks',              // fretboard finish
  seed:      'rn-seed-scale',         // which written piece is the base scale
  loadout:   'rn-loadout-done',
  takes:     'rn-takes',              // index of kept Studio takes; the AUDIO is in IndexedDB
  history:   'rn-history',            // this module's own rolling backups
};

// Caps live HERE, once, next to the key they protect — not at each call site.
// `keep: 'last'` means newest is appended; that is the convention, and every
// writer now follows it whether it knows the rule or not.
const CAPS = {
  [KEYS.pieces]:   { max: 200, keep: 'last' },
  [KEYS.practice]: { max: 200, keep: 'last' },
  [KEYS.songs]:    { max: 200, keep: 'last' },
  [KEYS.workouts]: { max: 100, keep: 'last' },
  [KEYS.takes]:    { max: 60,  keep: 'last' },
};

const MAX_SNAPSHOTS = 12;
const MIN_SNAP_GAP  = 90 * 1000;   // don't snapshot on every pedal drag

// ── primitives ────────────────────────────────────────────────────────
export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }   // corrupt value: hand back the fallback, never throw
}

export function write(key, value) {
  try {
    let v = value;
    const cap = CAPS[key];
    if (cap && Array.isArray(v) && v.length > cap.max) {
      v = cap.keep === 'last' ? v.slice(-cap.max) : v.slice(0, cap.max);
    }
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch (e) {
    // Out of quota. Drop the oldest backups and try once more — a backup is worth
    // less than the thing being backed up.
    try {
      const h = read(KEYS.history, []);
      if (h.length) { localStorage.setItem(KEYS.history, JSON.stringify(h.slice(-2))); localStorage.setItem(key, JSON.stringify(value)); return true; }
    } catch (e2) {}
    return false;
  }
}

// Append to a capped list without the caller having to know which end is which.
export function append(key, item) {
  const list = read(key, []);
  if (!Array.isArray(list)) return false;
  list.push(item);
  return write(key, list);
}

// ── the board, with a trail ───────────────────────────────────────────
// A snapshot is pushed when the board's SHAPE changes — a pedal added, removed,
// or migrated to another type — and otherwise at most once a minute and a half.
// Shape change is the signal that matters: moving a card is not destructive,
// losing one is.
const shapeOf = st => (st?.pedals || []).map(p => p.type).sort().join(',');

// Trimming the ring by age alone loses the wrong ones. After a board is gutted,
// twenty minutes of ordinary dragging pushes twelve near-identical snapshots in
// and quietly evicts the last copy that still had every pedal — the only one
// worth keeping. So evict DUPLICATE SHAPES first, oldest duplicate first, and
// only fall back to plain age when every snapshot is already distinct. The ring
// then remembers one of each board you have actually had, not the last twelve
// times you nudged a card.
function trimHistory(hist) {
  if (hist.length <= MAX_SNAPSHOTS) return hist;
  const out = hist.slice();
  while (out.length > MAX_SNAPSHOTS) {
    const seen = new Map();               // shape → indices, oldest first
    out.forEach((h, i) => { const k = h.shape || ''; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(i); });
    let victim = -1;
    for (const idxs of seen.values()) if (idxs.length > 1) { victim = idxs[0]; break; }
    out.splice(victim >= 0 ? victim : 0, 1);
  }
  return out;
}

export function loadBoard() { return read(KEYS.board, null); }

export function saveBoard(state) {
  const prev = loadBoard();
  if (prev) {
    const hist = read(KEYS.history, []);
    const last = hist[hist.length - 1];
    const shapeChanged = shapeOf(prev) !== shapeOf(state);
    const stale = !last || (Date.now() - (last.at || 0)) > MIN_SNAP_GAP;
    if (shapeChanged || stale) {
      hist.push({ at: Date.now(), shape: shapeOf(prev), n: (prev.pedals || []).length, state: prev });
      write(KEYS.history, trimHistory(hist));
    }
  }
  return write(KEYS.board, state);
}

// What can be gone back to, newest last. Exposed so a human at the console — or
// a future ↺ control — can see the trail without knowing the storage layout.
export function boardHistory() {
  return read(KEYS.history, []).map((h, i) => ({
    i, at: new Date(h.at || 0).toLocaleString(), pedals: h.n, types: h.shape,
  }));
}

// Roll the board back. Snapshots the CURRENT board first, so undoing an undo is
// also possible — a restore that destroys what it replaced is just another way
// to lose work.
export function restoreBoard(i) {
  const hist = read(KEYS.history, []);
  const idx = i == null ? hist.length - 1 : i;
  const snap = hist[idx];
  if (!snap || !snap.state) return false;
  const cur = loadBoard();
  if (cur) { hist.push({ at: Date.now(), shape: shapeOf(cur), n: (cur.pedals || []).length, state: cur }); write(KEYS.history, trimHistory(hist)); }
  return write(KEYS.board, snap.state);
}

// A reset is the most destructive thing the app can do to a board, so it takes a
// snapshot on the way out rather than on the way back.
export function snapshotBoardNow(reason = 'manual') {
  const cur = loadBoard();
  if (!cur) return false;
  const hist = read(KEYS.history, []);
  hist.push({ at: Date.now(), shape: shapeOf(cur), n: (cur.pedals || []).length, reason, state: cur });
  return write(KEYS.history, trimHistory(hist));
}

// ── a look at everything ──────────────────────────────────────────────
// One call that answers "what does this app have of mine, and how big is it".
export function inventory() {
  const out = [];
  for (const [name, key] of Object.entries(KEYS)) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    const v = raw === null ? null : read(key, null);
    out.push({ name, key, bytes: raw ? raw.length : 0, items: Array.isArray(v) ? v.length : (v ? 1 : 0) });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}
