// ── Theory Path progress (localStorage) ──────────────────────────────
// Tracks where the learner is, what they've completed, and per-lesson mastery.
const KEY = 'resonote-theory-progress';

function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function write(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

export function getProgress() {
  const p = read();
  if (p && p.schemaVersion === 1) return p;
  return { schemaVersion: 1, placedLevel: null, currentLessonId: null, lessons: {} };
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
export function setPlaced(level) { const p = getProgress(); p.placedLevel = level; saveProgress(p); return p; }
export function isComplete(p, id) { return !!p.lessons[id]?.completed; }

// First not-yet-done lesson at/after the placed level (else the first undone).
export function recommendNext(p, lessonsSortedByLevel) {
  const from = p.placedLevel || 0;
  const undone = lessonsSortedByLevel.filter(l => !isComplete(p, l.id));
  if (!undone.length) return lessonsSortedByLevel[lessonsSortedByLevel.length - 1] || null;
  return undone.find(l => l.level >= from) || undone[0];
}
