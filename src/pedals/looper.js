export function buildLooperContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  if (!p._loopTracks) p._loopTracks = [];
  const tracks = p._loopTracks;
  let recording = false, playing = false;
  let recStream = null, recorder = null, recChunks = [];

  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      recStream = stream;
      recorder = new MediaRecorder(stream);
      recChunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recChunks, { type: 'audio/webm' });
        const url  = URL.createObjectURL(blob);
        tracks.push({ url, blob, muted: false, solo: false, name: `Track ${tracks.length + 1}` });
        recStream.getTracks().forEach(t => t.stop());
        recStream = null;
        recording = false;
        render();
      };
      recorder.start();
      recording = true;
      render();
    }).catch(() => { recording = false; render(); });
  }

  function stopRecording() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  function playAll() {
    if (!tracks.length) return;
    playing = true;
    render();
    const soloExists = tracks.some(t => t.solo);
    tracks.forEach(t => {
      if (t.muted || (soloExists && !t.solo)) return;
      const a = new Audio(t.url);
      t._audio = a;
      a.play();
      a.onended = () => { if (playing) { a.currentTime = 0; a.play(); } };
    });
  }

  function stopAll() {
    playing = false;
    tracks.forEach(t => {
      if (t._audio) { t._audio.pause(); t._audio.currentTime = 0; t._audio = null; }
    });
    render();
  }

  function removeTrack(idx) {
    if (tracks[idx]?._audio) { tracks[idx]._audio.pause(); tracks[idx]._audio = null; }
    if (tracks[idx]?.url) URL.revokeObjectURL(tracks[idx].url);
    tracks.splice(idx, 1);
    render();
  }

  function render() {
    const accent = 'var(--rk-accent)';
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:6px">`;

    if (tracks.length) {
      h += `<div style="display:flex;flex-direction:column;gap:3px">`;
      tracks.forEach((t, i) => {
        const bg  = t.muted ? 'var(--rk-panel)' : 'var(--rk-soft)';
        const col = t.muted ? 'var(--rk-ink-mute)' : accent;
        h += `<div style="display:flex;align-items:center;gap:4px;background:${bg};border:1px solid var(--rk-edge-soft);border-radius:5px;padding:4px 6px">`;
        h += `<span class="mono" style="color:${col};font-size:calc(10px*var(--ui));font-weight:700;flex:1">${t.name}</span>`;
        h += `<button class="chord-btn loop-mute" data-li="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 5px;${t.muted ? 'color:var(--rk-bad)' : 'color:var(--rk-ink-mute)'}">M</button>`;
        h += `<button class="chord-btn loop-solo" data-li="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 5px;${t.solo ? 'color:var(--rk-accent);border-color:var(--rk-line)' : 'color:var(--rk-ink-mute)'}">S</button>`;
        h += `<button class="chord-btn loop-del"  data-li="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));padding:1px 5px;color:var(--rk-bad)">✕</button>`;
        h += `</div>`;
      });
      h += `</div>`;
    } else {
      h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:12px">No tracks yet. Hit record to start.</div>`;
    }

    // Armed and rolling is this pedal's lamp turned up (--rk-hot), not a red
    // one: a saturated red at hue 0 is what C looks like on the neck. The lamp
    // only reports that the pedal is live — the buttons that END the take are a
    // different job and wear the stop red instead, below.
    if (recording) {
      h += `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;background:var(--rk-soft);border:1px solid var(--rk-line);border-radius:6px">`;
      h += `<div style="width:10px;height:10px;border-radius:50%;background:var(--rk-hot);box-shadow:0 0 10px var(--rk-glow)"></div>`;
      h += `<span class="mono" style="color:var(--rk-hot);font-size:calc(11px*var(--ui));font-weight:700">RECORDING...</span>`;
      h += `</div>`;
    }

    // Both halves of the transport are toggles, and each one is a stop button only
    // in its second state. So the red arrives with the ■ and leaves with it — a
    // looper has two things running at once and you must be able to see, without
    // reading, which of them the button in front of you is about to end.
    h += `<div style="display:flex;gap:4px">`;
    if (!recording) {
      h += `<button class="loop-rec mono" style="min-height:calc(28px*var(--ui));background:var(--rk-soft);border:1px solid var(--rk-line);color:var(--rk-accent);border-radius:8px;padding:7px;cursor:pointer;font-size:calc(10px*var(--ui));font-weight:700;flex:1">● REC</button>`;
    } else {
      h += `<button class="loop-stoprec mono" style="min-height:calc(28px*var(--ui));background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);color:var(--rk-stop);border-radius:8px;padding:7px;cursor:pointer;font-size:calc(10px*var(--ui));font-weight:700;flex:1">■ STOP REC</button>`;
    }
    if (!playing) {
      h += `<button class="loop-play mono" style="min-height:calc(28px*var(--ui));background:var(--rk-soft);border:1px solid var(--rk-line);color:${accent};border-radius:8px;padding:7px;cursor:pointer;font-size:calc(10px*var(--ui));font-weight:700;flex:1">▶ PLAY</button>`;
    } else {
      h += `<button class="loop-stop mono" style="min-height:calc(28px*var(--ui));background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);color:var(--rk-stop);border-radius:8px;padding:7px;cursor:pointer;font-size:calc(10px*var(--ui));font-weight:700;flex:1">■ STOP</button>`;
    }
    h += `</div>`;
    h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));text-align:center">${tracks.length} track${tracks.length !== 1 ? 's' : ''} · Mute (M) Solo (S) per track · Loops on playback</div>`;
    h += `</div>`;
    el.innerHTML = h;

    el.querySelector('.loop-rec')    ?.addEventListener('click', e => { e.stopPropagation(); startRecording(); });
    el.querySelector('.loop-stoprec')?.addEventListener('click', e => { e.stopPropagation(); stopRecording(); });
    el.querySelector('.loop-play')   ?.addEventListener('click', e => { e.stopPropagation(); playAll(); });
    el.querySelector('.loop-stop')   ?.addEventListener('click', e => { e.stopPropagation(); stopAll(); });
    el.querySelectorAll('.loop-mute').forEach(b => b.onclick = e => { e.stopPropagation(); const i = parseInt(b.dataset.li); tracks[i].muted = !tracks[i].muted; render(); });
    el.querySelectorAll('.loop-solo').forEach(b => b.onclick = e => { e.stopPropagation(); const i = parseInt(b.dataset.li); tracks[i].solo  = !tracks[i].solo;  render(); });
    el.querySelectorAll('.loop-del') .forEach(b => b.onclick = e => { e.stopPropagation(); removeTrack(parseInt(b.dataset.li)); });
  }

  render();
}
