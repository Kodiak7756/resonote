// ── Theory Path progress (localStorage) ──────────────────────────────
// Tracks where the learner is, what they've completed, and per-lesson mastery.
// Lessons are keyed by id, so finished lessons stay finished when the course is reordered.
// Placement is kept as the LESSON it starts you on (placedLessonId); placedLevel is read off
// that lesson's current level, so a renumbered course never moves anyone's starting point.
import { CURRICULUM } from './curriculum-data.js';

const KEY = 'resonote-theory-progress';

function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function write(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

let _levels = null;
function levelOf(id) {
  if (!_levels) { _levels = new Map(); CURRICULUM.units.forEach(u => (u.lessons || []).forEach(l => _levels.set(l.id, l.level))); }
  return _levels.get(id) ?? null;
}
// Before placement remembered a lesson, it stored only a level on the original numbering: the
// level of the hardest placement question answered right, and the path started at the lesson
// with that level. Those levels, and the lesson each one started you on.
const V1_PLACEMENT = [
  [1, 'musical-alphabet'], [3, 'sharps-flats-enharmonics'], [5, 'open-strings'], [8, 'major-vs-minor-third'],
  [10, 'the-tritone'], [12, 'building-and-naming-intervals'], [15, 'nashville-number-system'], [18, 'hearing-relative-major-minor'],
  [23, 'triad-inversions'], [30, 'darker-sevenths'], [37, 'suspensions-resolve'], [44, 'relative-vs-parallel'], [52, 'add9-and-six-nine'],
];
function placedLessonFromV1(level) {
  let id = null;
  for (const [lv, lid] of V1_PLACEMENT) if (level >= lv) id = lid;
  return id;
}

// schemaVersion stays 1 (the fields below are only added), so an older build still reads the file.
export function getProgress() {
  const p = read();
  if (!p || p.schemaVersion !== 1) return { schemaVersion: 1, placedLevel: null, placedLessonId: null, currentLessonId: null, lessons: {} };
  if (!p.lessons) p.lessons = {};
  if (p.placedLevel != null && !p.placedLessonId) p.placedLessonId = placedLessonFromV1(+p.placedLevel);
  if (p.placedLessonId) p.placedLevel = levelOf(p.placedLessonId) ?? p.placedLevel;
  return p;
}
export function saveProgress(p) { write(p); }

function rec(p, id) {
  return p.lessons[id] || (p.lessons[id] = { attempts: 0, correct: 0, completed: false, mastery: 0, lastSeen: 0 });
}

export function recordAttempt(id, correct) {
  const p = getProgress(); const L = rec(p, id);
  L.attempts++; if (correct) { L.correct++; L.completed = true; }
  L.mastery = L.attempts ? L.correct / L.attempts : 0;
  L.lastSeen = Date.now(); p.currentLessonId = id;
  saveProgress(p); return p;
}
export function markComplete(id) {
  const p = getProgress(); const L = rec(p, id);
  L.completed = true; L.lastSeen = Date.now();
  saveProgress(p); return p;
}
export function setCurrent(id) { const p = getProgress(); p.currentLessonId = id; saveProgress(p); return p; }
// level: where placement put you; lessonId: the lesson that level starts on (kept, so the start
// survives a renumbering of the course).
export function setPlaced(level, lessonId) {
  const p = getProgress();
  p.placedLessonId = lessonId || null;
  p.placedLevel = (lessonId && levelOf(lessonId)) || level;
  saveProgress(p); return p;
}
export function isComplete(p, id) { return !!p.lessons[id]?.completed; }

// First not-yet-done lesson at/after the placed level (else the first undone). Placement is a
// theory quiz, so it never skips a lesson marked `basics` (the hands-on guitar shapes: octave
// shapes, first chords, power chords, Box 1, barre chords…) — those come up first if not done.
export function recommendNext(p, lessonsSortedByLevel) {
  const from = p.placedLevel || 0;
  const undone = lessonsSortedByLevel.filter(l => !isComplete(p, l.id));
  if (!undone.length) return lessonsSortedByLevel[lessonsSortedByLevel.length - 1] || null;
  return undone.find(l => l.basics || l.level >= from) || undone[0];
}
