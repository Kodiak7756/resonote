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
    const accent = '#44bbdd';
    let h = `<div style="display:flex;flex-direction:column;gap:6px">`;

    if (tracks.length) {
      h += `<div style="display:flex;flex-direction:column;gap:3px">`;
      tracks.forEach((t, i) => {
        const bg  = t.muted ? 'rgba(255,255,255,.02)' : 'rgba(68,187,221,.06)';
        const col = t.muted ? '#555' : accent;
        h += `<div style="display:flex;align-items:center;gap:4px;background:${bg};border:1px solid rgba(68,187,221,.1);border-radius:5px;padding:4px 6px">`;
        h += `<span class="mono" style="color:${col};font-size:9px;font-weight:700;flex:1">${t.name}</span>`;
        h += `<button class="chord-btn loop-mute" data-li="${i}" style="font-size:7px;padding:1px 5px;${t.muted ? 'color:#ff6666' : 'color:#888'}">M</button>`;
        h += `<button class="chord-btn loop-solo" data-li="${i}" style="font-size:7px;padding:1px 5px;${t.solo ? 'color:#ffaa00;border-color:#ffaa00' : 'color:#888'}">S</button>`;
        h += `<button class="chord-btn loop-del"  data-li="${i}" style="font-size:7px;padding:1px 5px;color:#ff4444">✕</button>`;
        h += `</div>`;
      });
      h += `</div>`;
    } else {
      h += `<div class="mono" style="color:#444;font-size:9px;text-align:center;padding:12px">No tracks yet. Hit record to start.</div>`;
    }

    if (recording) {
      h += `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;background:rgba(255,50,50,.08);border:1px solid rgba(255,50,50,.2);border-radius:6px">`;
      h += `<div style="width:10px;height:10px;border-radius:50%;background:#ff4444"></div>`;
      h += `<span class="mono" style="color:#ff6666;font-size:11px;font-weight:700">RECORDING...</span>`;
      h += `</div>`;
    }

    h += `<div style="display:flex;gap:4px">`;
    if (!recording) {
      h += `<button class="loop-rec mono" style="background:rgba(255,60,60,.15);border:1px solid #ff4444;color:#ff4444;border-radius:8px;padding:7px;cursor:pointer;font-size:10px;font-weight:700;flex:1">● REC</button>`;
    } else {
      h += `<button class="loop-stoprec mono" style="background:rgba(255,60,60,.25);border:1px solid #ff4444;color:#ff6666;border-radius:8px;padding:7px;cursor:pointer;font-size:10px;font-weight:700;flex:1">■ STOP REC</button>`;
    }
    if (!playing) {
      h += `<button class="loop-play mono" style="background:rgba(68,187,221,.15);border:1px solid ${accent};color:${accent};border-radius:8px;padding:7px;cursor:pointer;font-size:10px;font-weight:700;flex:1">▶ PLAY</button>`;
    } else {
      h += `<button class="loop-stop mono" style="background:rgba(68,187,221,.25);border:1px solid ${accent};color:${accent};border-radius:8px;padding:7px;cursor:pointer;font-size:10px;font-weight:700;flex:1">■ STOP</button>`;
    }
    h += `</div>`;
    h += `<div class="mono" style="color:#555;font-size:7px;text-align:center">${tracks.length} track${tracks.length !== 1 ? 's' : ''} · Mute (M) Solo (S) per track · Loops on playback</div>`;
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
