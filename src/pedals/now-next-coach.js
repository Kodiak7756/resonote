// ─── Now & Next — the chord to play now, the one coming, and a count to the change ──
// A window to look UP at while playing: the chord under your hands, big, with
// its grip; the next chord, smaller, with its grip; the beats of the bar; and
// 3 · 2 · 1 in the last beats before the change. Built to float above the
// guitar in the headset as well as to sit on the board.
//
// It only shows. The record it shows lives in core/now-next.js and is fed by
// whichever pedal is playing chords in time (Backing Track with chords, the
// Workouts Chord Trainer, an Improv Lab jam, Progression Studio). This pedal
// has nothing to set up, never touches the key or the tempo, and works the
// same in any window: the PC's main window holds the record, every other
// window is sent it.
//
// Sized from its own box (container units in styles/now-next.css), not from
// --ui alone: make the window bigger and everything in it grows, which is what
// reading it from arm's length in the headset needs.
import { onNowNext, getNowNext, askNowNext } from '../core/now-next.js';
import { pcColor, pcTextOn } from '../core/colors.js';

const FROM = { beatmaker: 'Backing Track', workouts: 'Workouts', improvlab: 'Improv Lab', progression: 'Progression Studio' };
const COUNT_FROM = 3;          // the countdown shows in the last three beats before a change
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function buildNowNextContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;
  if (p._nnOff) p._nnOff();
  el.innerHTML = `<div class="nn"><div class="nn-in"></div></div>`;
  const box = el.querySelector('.nn-in');
  const alive = () => el.isConnected && box.isConnected;
  let sig = null, lastNow = null;

  function paint(s) {
    if (!alive()) { off(); return; }
    const root = box.parentElement;
    if (!s?.now) {
      if (sig !== 'empty') { sig = 'empty'; lastNow = null; box.innerHTML = emptyHTML(); }
      root.dataset.state = 'empty';
      root.dataset.count = '0';
      return;
    }
    // The chords are drawn once per change; the beat only moves the count and the pips.
    const s2 = JSON.stringify([s.source, s.bpm, s.now, s.next, s.beatsPerBar, s.beatsLeft == null]);
    if (s2 !== sig) {
      sig = s2;
      box.innerHTML = playingHTML(s);
      if (lastNow && lastNow !== s.now.name) {          // the change: NEXT just became NOW
        const now = box.querySelector('.nn-now');
        now?.classList.add('nn-flip');
      }
      lastNow = s.now.name;
    }
    root.dataset.state = 'on';
    const counting = s.next && s.beatsLeft != null && s.beatsLeft <= COUNT_FROM;
    root.dataset.count = counting ? String(s.beatsLeft) : '0';
    const count = box.querySelector('.nn-count b');
    if (count) count.textContent = counting ? String(s.beatsLeft) : '';
    const inTxt = box.querySelector('.nn-when');
    if (inTxt) inTxt.textContent = whenText(s, counting);
    box.querySelectorAll('.nn-beats i').forEach((b, i) => b.classList.toggle('on', i === s.beat));
  }

  const off = onNowNext(paint);
  p._nnOff = off;
  p._teardown = () => off();
  paint(getNowNext());
  askNowNext();                 // a pop-out or headset window: ask the PC what is playing
}

function whenText(s, counting) {
  if (!s.next) return '';
  if (s.beatsLeft == null) return 'once you play it';
  if (counting) return 'change in';
  const bars = s.beatsLeft % s.beatsPerBar === 0 && s.beatsLeft > s.beatsPerBar ? s.beatsLeft / s.beatsPerBar : 0;
  return bars ? `in ${bars} bars` : `in ${s.beatsLeft} beats`;
}

function emptyHTML() {
  return `<div class="nn-empty">
    <b>Nothing playing yet</b>
    <p>Start the <span>Backing Track</span> with chords, or the <span>Chord Trainer</span> in Workouts, and the chords show up here.</p>
    <p class="nn-also">An Improv Lab jam or Progression Studio shows here too.</p>
  </div>`;
}

// A chord's name with its root letter in the root's colour (the letter always
// rides with the hue — colours come from core/colors.js only).
function nameHTML(c, cls) {
  const suffix = c.name.slice(c.root.length);
  return `<div class="nn-name ${cls}" style="--len:${Math.max(2, c.name.length)}"><b style="color:${pcColor(c.root, 85, 68)}">${esc(c.root)}</b>${esc(suffix)}</div>`;
}
function subHTML(c) {
  const bits = [c.numeral, c.hint].filter(Boolean).map(esc);
  return bits.length ? `<div class="nn-sub">${bits.join(' · ')}</div>` : '';
}

function playingHTML(s) {
  const from = FROM[s.source] || s.source || '';
  const n = s.now, x = s.next;
  const beats = s.beatsLeft == null
    ? `<div class="nn-beats nn-wait">It waits until it hears you play it</div>`
    : `<div class="nn-beats" style="--n:${s.beatsPerBar}">${Array.from({ length: s.beatsPerBar }, (_, i) => `<i class="${i === 0 ? 'one' : ''}">${i + 1}</i>`).join('')}</div>`;
  return `
    <div class="nn-top"><span>${esc(from)}</span><span>${s.bpm ? `${s.bpm} BPM` : ''}</span></div>
    <section class="nn-panel nn-now">
      <div class="nn-tag">NOW</div>
      ${nameHTML(n, 'nn-big')}
      ${subHTML(n)}
      <div class="nn-chart">${chartHTML(n)}</div>
    </section>
    <section class="nn-panel nn-next${x ? '' : ' nn-none'}">
      <div class="nn-tag">NEXT</div>
      ${x ? nameHTML(x, 'nn-small') : `<div class="nn-stay">Stay on ${esc(n.name)}</div>`}
      <div class="nn-when"></div>
      <div class="nn-count"><b></b></div>
      ${x ? `<div class="nn-chart">${chartHTML(x)}</div>` : ''}
    </section>
    ${beats}`;
}

// ── The grip as a chord chart ─────────────────────────────────────────
// Strings run top to bottom with the lowest on the left, the nut (or the
// starting fret) at the top. Above each string: ✕ not played, a ring for an
// open string. Every dot carries its note letter in that note's colour; the
// root has a white ring.
function chartHTML(c) {
  const g = c.grip;
  if (!g?.cells?.length) {
    return `<div class="nn-notes">${c.notes.map(nt => `<span style="background:${pcColor(nt, 72, 52)};color:${pcTextOn(nt)}">${esc(nt)}</span>`).join('')}</div>`;
  }
  const ns = g.ns;
  const fretted = g.cells.filter(q => q.fret > 0).map(q => q.fret);
  const lo = fretted.length ? Math.min(...fretted) : 1, hi = fretted.length ? Math.max(...fretted) : 1;
  const start = hi <= 4 ? 1 : lo;                       // open shapes stay at the nut
  const rows = Math.max(4, hi - start + 1);
  const SW = 22, FH = 26, L = 30, T = 30, R = 12, B = 8;
  const W = L + (ns - 1) * SW + R, H = T + rows * FH + B;
  const xOf = si => L + (ns - 1 - si) * SW;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" role="img" aria-label="${esc(c.name)} grip">`;
  // nut, or the fret the shape starts on
  if (start === 1) s += `<rect x="${L - 2}" y="${T - 4}" width="${(ns - 1) * SW + 4}" height="5" rx="1.5" fill="#f2f2f4"/>`;
  else s += `<text x="${L - 7}" y="${T + FH / 2 + 5}" text-anchor="end" class="nn-fr">${start}</text>`;
  for (let f = 0; f <= rows; f++) s += `<line x1="${L}" y1="${T + f * FH}" x2="${L + (ns - 1) * SW}" y2="${T + f * FH}" stroke="#8b8b94" stroke-width="${f === 0 && start > 1 ? 2 : 1.3}"/>`;
  for (let si = 0; si < ns; si++) s += `<line x1="${xOf(si)}" y1="${T}" x2="${xOf(si)}" y2="${T + rows * FH}" stroke="#c9c9d0" stroke-width="${1.1 + si * 0.25}"/>`;
  for (let si = 0; si < ns; si++) {
    const q = g.cells.find(z => z.si === si);
    const x = xOf(si);
    if (!q) { s += `<text x="${x}" y="${T - 10}" text-anchor="middle" class="nn-x">✕</text>`; continue; }
    const isRoot = q.note === c.root;
    if (q.fret === 0) {
      s += `<circle cx="${x}" cy="${T - 15}" r="9" fill="#141418" stroke="${pcColor(q.note, 80, 62)}" stroke-width="2.6"/>`;
      s += `<text x="${x}" y="${T - 11.2}" text-anchor="middle" class="nn-dot" fill="#f4f4f6">${esc(q.note)}</text>`;
      if (isRoot) s += `<circle cx="${x}" cy="${T - 15}" r="11.6" fill="none" stroke="#fff" stroke-width="1.4"/>`;
      continue;
    }
    const y = T + (q.fret - start) * FH + FH / 2;
    s += `<circle cx="${x}" cy="${y}" r="10" fill="${pcColor(q.note, 78, 58)}"${isRoot ? ' stroke="#fff" stroke-width="2.6"' : ''}/>`;
    s += `<text x="${x}" y="${y + 3.9}" text-anchor="middle" class="nn-dot" fill="${pcTextOn(q.note)}">${esc(q.note)}</text>`;
  }
  return s + '</svg>';
}
