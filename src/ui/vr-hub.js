// The headset hub — what the headset's browser opens at https://<PC>:5443/vr.
//
// A list of the pedals on the PC's board right now (asked of the PC's main
// window over the LAN relay, and asked again every few seconds so it keeps up
// with the board), plus the neck. Each opens as a window of its own in the
// headset: a live copy that leaves the PC's card where it is (ui/popout.js).
//
// Built for a controller ray or a finger at arm's length: big rows, big
// buttons, nothing behind a hover. If the headset's browser turns window.open
// into a tab, every row also shows its short address to open by hand.

import { initSync, post, onSyncMessage, onPcLink } from '../core/sync.js';
import { NECK, remoteUrl, followLive, linkHTML, paintLink } from './popout.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortUrl = ref => remoteUrl(ref).replace(/^https?:\/\//, '');

export function bootHub() {
  document.body.classList.add('vr-mode', 'vr-hub-page');
  document.title = 'Resonote VR';
  const root = document.createElement('div');
  root.id = 'vr-hub';
  root.innerHTML = `
    <header>
      <div class="vr-brand mono">RESONOTE <span>VR</span></div>
      ${linkHTML()}
    </header>
    <div class="vr-live mono"></div>
    <h1>Open a pedal as its own window</h1>
    <div id="vr-list"><div class="vr-empty">Asking the PC for its board…</div></div>
    <div id="vr-say" class="vr-say" hidden></div>
    <div class="vr-help">
      <p>Each window is a live copy of the pedal on the PC: the key, the tempo, the hand position,
      what the neck shows and the note the mic hears all follow the PC, and what you change here goes back to it.
      The PC keeps its own card on the board.</p>
      <p>If a button opens a tab instead of a window, open a new browser window and type the address shown under the pedal's name.</p>
      <p>Your guitar stays plugged into the PC. Input &amp; Tuner here shows what the PC hears, and its buttons and knobs work the PC's input.</p>
      <p>Opening one of the <b>More pedals</b> adds it to the PC's board too.</p>
    </div>`;
  document.body.appendChild(root);

  initSync('hub', { remote: true });
  followLive(root.querySelector('.vr-live'));

  const ask = () => post('vr-board?');
  ask();
  setInterval(ask, 4000);

  let lastSig = '';
  onSyncMessage(m => {
    if (m.kind === 'vr-board') {
      const sig = JSON.stringify([m.board, m.more, m.neckHere]);
      if (sig !== lastSig) { lastSig = sig; render(m.board || [], m.neckHere, m.more || []); }
    } else if (m.kind === 'main-hello') ask();
  });

  onPcLink(up => {
    paintLink(root.querySelector('.vr-link'), up);
    if (up) ask();
    else if (!lastSig) root.querySelector('#vr-list').innerHTML = `<div class="vr-empty">
      Waiting for the PC… Keep Resonote open on the PC at <span class="mono">http://localhost:5173</span>, on screen.</div>`;
  });

  // One delegated listener: the list re-renders whenever the board changes.
  root.querySelector('#vr-list').addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b) openWindow(b.dataset.open);
  });
}

function row({ ref, title, icon, accent, here, docked }) {
  return `
    <div class="vr-row"${accent ? ` style="--vr-acc:${esc(accent)}"` : ''}>
      <span class="vr-icon">${esc(icon)}</span>
      <div class="vr-meta">
        <div class="vr-name">${esc(title)}${docked ? ' <span class="vr-tag">docked on the PC</span>' : ''}${here ? ` <span class="vr-tag vr-tag-on">● open in the headset${here > 1 ? ' ×' + here : ''}</span>` : ''}</div>
        <div class="vr-url mono">${esc(shortUrl(ref))}</div>
      </div>
      <button class="vr-open" data-open="${esc(ref)}">Open as its own window</button>
    </div>`;
}

function render(board, neckHere, more = []) {
  const list = document.getElementById('vr-list');
  if (!list) return;
  list.innerHTML = board.map(row).join('')
    + row({ ref: NECK, title: 'Neck', icon: '🎸', accent: '#e0a14a', here: neckHere })
    + (more.length ? `<h2 class="vr-more">More pedals <span>— not on the PC's board yet; opening one adds it there</span></h2>` + more.map(row).join('') : '');
}

function openWindow(ref) {
  const url = remoteUrl(ref);
  // A named window: pressing the same button again brings that window back
  // instead of stacking a second copy.
  const w = window.open(url, 'resonote-vr-' + ref, 'popup=yes,width=1100,height=760');
  const say = document.getElementById('vr-say');
  if (!say) return;
  say.hidden = false;
  say.innerHTML = w
    ? `Opened <b>${esc(shortUrl(ref))}</b>. If it came up as a tab, you can pull it out into its own window, or open a new window at that address.`
    : `The browser didn't open a window. Open a new browser window and go to <b class="mono">${esc(shortUrl(ref))}</b>.`;
}
