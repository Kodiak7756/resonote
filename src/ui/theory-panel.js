// ════════════════════════════════════════════════════════════════════
//  Smart Theory panel — the Chord-Family-Lab "what is this & why" idea,
//  reusable in every pedal. It opens by default while you're learning and
//  remembers when you collapse it (per panel id). "Learn the theory →"
//  fires a resonote:open-lesson event the app wires to Theory Path.
// ════════════════════════════════════════════════════════════════════
const PREF_KEY = 'rk-theory-prefs';

function prefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}
function setPref(id, open) {
  const p = prefs(); p[id] = open ? 1 : 0;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}

// Open by default (the "smart" part: teach first; stays closed once dismissed).
export function isTheoryOpen(id) {
  const p = prefs();
  return p[id] === undefined ? true : !!p[id];
}

/**
 * Render the panel markup.
 * @param {string} id   stable id for remembering open/closed (e.g. pedal type)
 * @param {object} c    content: { kicker?, title, what, why?, lessonId?, lessonLabel? }
 */
export function theoryPanelHTML(id, c) {
  if (!c || !c.title) return '';
  const open = isTheoryOpen(id);
  const link = c.lessonId
    ? `<button class="rk-theory-link" data-lesson="${c.lessonId}">${c.lessonLabel || 'Learn the theory'} →</button>`
    : '';
  return `
    <div class="rk-theory ${open ? 'is-open' : ''}" data-theory="${id}">
      <div class="rk-theory-head" data-theory-toggle="${id}">
        <span class="rk-theory-bulb">💡</span>
        <span class="rk-theory-kicker">${c.kicker || 'THEORY'}</span>
        <span class="rk-theory-title">${c.title}</span>
        <span class="rk-theory-chev">▶</span>
      </div>
      <div class="rk-theory-body"><div><div class="rk-theory-inner">
        <div class="rk-theory-what">${c.what || ''}</div>
        ${c.why ? `<div class="rk-theory-why">${c.why}</div>` : ''}
        ${link}
      </div></div></div>
    </div>`;
}

/**
 * Wire toggling + the "learn the theory" link inside `root`.
 * Toggling flips a class only (no re-render) so it stays smooth, and the
 * choice is persisted so the panel respects "open when learning, collapse
 * when comfortable".
 */
export function wireTheoryPanel(root) {
  if (!root) return;
  root.querySelectorAll('[data-theory-toggle]').forEach(head => {
    head.addEventListener('click', e => {
      e.stopPropagation();
      const id = head.getAttribute('data-theory-toggle');
      const panel = root.querySelector(`.rk-theory[data-theory="${id}"]`);
      if (!panel) return;
      const open = !panel.classList.contains('is-open');
      panel.classList.toggle('is-open', open);
      setPref(id, open);
    });
  });
  root.querySelectorAll('.rk-theory-link[data-lesson]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const lessonId = btn.getAttribute('data-lesson');
      window.dispatchEvent(new CustomEvent('resonote:open-lesson', { detail: { lessonId } }));
    });
  });
}
