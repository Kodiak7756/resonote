import { metroClock } from '../core/state.js';
import { NOTES, CHORD_TYPES, toSharp } from '../core/music-theory.js';
import { getNoteAtFret, customTuning, getInst } from '../core/tuning.js';
import { buildContent, CATALOG } from '../pedals/index.js';
import { masterTempoBlock, wireMasterTempo } from '../ui/tempo-control.js';
import { bus } from '../core/mixer.js';
import { KEYS, read, write } from '../core/store.js';

// ── State ────────────────────────────────────────────────────────────
let studioView = 'production';
let studioTracks = [];
let studioSelectedClip = null;
let studioPlaying = false, studioRecording = false, studioRecTarget = null;
let studioPlaybackAudios = [], studioPlaybackTimers = [];
let studioBeatEnabled = true, studioClickEnabled = false, studioLoopEnabled = true;
let studioPlayhead = 0, studioStartTime = 0, studioAnimFrame = null;
let studioClickIntv = null, studioClickCtx = null, studioClickBeat = 0;
let studioMidiInputArmed = true, studioMidiStep = 0, studioMidiNoteLength = 1, studioMidiBars = 1;
let studioMidiCtx = null;
let studioNotationNoteLength = 4, studioNotationKey = 'C', studioNotationAccidentalMode = 'auto';
let studioNotationDotted = false, studioNotationSelectedId = null;
let studioChordRoot = 'C', studioChordFamily = 'Triads', studioChordType = 'Major';
let studioChordInstrument = 'piano', studioChordOctave = 3, studioChordInversion = 0;
let studioClipDragState = null;
let studioPedals = [];
let stuZoom = 100;

// ── Takes: the only part of the Studio that outlives a reload ────────────
// Until this existed, every recording died with the tab: studioTracks reseeds
// to [] on load and audio lives in blob: URLs that the process owns.
let studioMarkers = [];          // [{at: SECONDS, name}] — hand-dropped, kept ascending
let studioLastKeepSig = null;    // fingerprint of the arrangement at the last ⤓ KEEP
let studioMsgTimer = null, studioToastTimer = null;
const MAX_TAKES = 60;            // matches CAPS[KEYS.takes]; trimmed here so blob pruning agrees

const STUDIO_PX_PER_SEC = 60;
const STUDIO_TOTAL_BARS = 32;

// The Studio is the Record family's room, so its chrome is painted in that
// family's enclosure colour — the Looper's accent, hue 255° at 44% saturation.
// What it replaced was #9977ee = hsl(257, 78%, 70%): the note spectrum's exact
// saturation, 13° off D♯, so the transport was reading as a PITCH while sitting
// directly above a fretboard drawing real ones at hsl(h, 78%, 58%).
const STUDIO_ACCENT = '#a99ad8';

// ── Helpers ──────────────────────────────────────────────────────────
function getStudioBarWidth() { return (60/(metroClock.bpm||120))*(metroClock.ts||4)*STUDIO_PX_PER_SEC; }
function getStudioTotalWidth() { return STUDIO_TOTAL_BARS * getStudioBarWidth(); }
function noteOctToMidi(note, octave) { return (octave+1)*12 + NOTES.indexOf(note); }
function midiToNoteOct(midi) { const m=Math.max(0,Math.round(midi)); return {note:NOTES[((m%12)+12)%12], octave:Math.floor(m/12)-1, midi:m}; }
function midiFreq(midi) { return 440*Math.pow(2,(midi-69)/12); }

// ── Clip helpers ─────────────────────────────────────────────────────
function getClipBaseDuration(clip) { return Math.max(clip&&((clip.sourceDuration!==undefined)?clip.sourceDuration:clip.duration)||0,0); }
function getClipTrimStart(clip) { return Math.max(0,clip&&clip.trimStart||0); }
function getClipTrimEnd(clip) { return Math.max(0,clip&&clip.trimEnd||0); }
function getEffectiveClipDuration(clip) { return Math.max(0.05, getClipBaseDuration(clip)-getClipTrimStart(clip)-getClipTrimEnd(clip)); }
function normalizeClipTiming(clip) {
  if (!clip) return clip;
  if (clip.type==='midi') { syncStudioMidiClip(clip); return clip; }
  const base = (clip.sourceDuration!==undefined)?clip.sourceDuration:(clip.duration||0);
  clip.sourceDuration = Math.max(base||0,0);
  clip.trimStart = Math.max(0,clip.trimStart||0);
  clip.trimEnd = Math.max(0,clip.trimEnd||0);
  const maxTrim = Math.max(0,clip.sourceDuration-0.05);
  if (clip.trimStart>maxTrim) clip.trimStart=maxTrim;
  if (clip.trimEnd>clip.sourceDuration-clip.trimStart-0.05) clip.trimEnd=Math.max(0,clip.sourceDuration-clip.trimStart-0.05);
  clip.duration = getEffectiveClipDuration(clip);
  return clip;
}

// ── MIDI clip ────────────────────────────────────────────────────────
function syncStudioMidiClip(clip) {
  if (!clip||clip.type!=='midi') return clip;
  clip.stepsPerBar = Math.max(1,clip.stepsPerBar||16);
  clip.bars = Math.max(1,clip.bars||1);
  clip.duration = (60/(metroClock.bpm||120))*(metroClock.ts||4)*(clip.bars||1);
  if (!Array.isArray(clip.midiNotes)) clip.midiNotes=[];
  return clip;
}
function makeEmptyMidiClip(startTime, bars) {
  const clip = {type:'midi',name:'MIDI Clip',startTime:startTime||0,bars:Math.max(1,bars||1),stepsPerBar:16,midiNotes:[]};
  return syncStudioMidiClip(clip);
}
function getStudioMidiStepDurSec(clip) {
  const bars=Math.max(1,clip?.bars||1), steps=Math.max(1,clip?.stepsPerBar||16);
  return ((60/(metroClock.bpm||120))*(metroClock.ts||4)*bars)/(steps*bars);
}
function getSelectedStudioMidiClipInfo() {
  if (studioSelectedClip) {
    const tr=studioTracks[studioSelectedClip.ti], clip=tr&&tr.clips&&tr.clips[studioSelectedClip.ci];
    if (clip&&clip.type==='midi') return {ti:studioSelectedClip.ti,ci:studioSelectedClip.ci,track:tr,clip:syncStudioMidiClip(clip)};
  }
  for (let ti=0;ti<studioTracks.length;ti++) {
    const tr=studioTracks[ti];
    for (let ci=0;ci<(tr.clips||[]).length;ci++) {
      const clip=tr.clips[ci];
      if (clip&&clip.type==='midi') { studioSelectedClip={ti,ci}; return {ti,ci,track:tr,clip:syncStudioMidiClip(clip)}; }
    }
  }
  return null;
}
function ensureStudioMidiClip() {
  let info=getSelectedStudioMidiClipInfo();
  if (info) return info;
  let ti=studioTracks.findIndex(t=>t.kind==='midi');
  if (ti<0) { addStudioTrack('MIDI 1','#55aaff','midi'); ti=studioTracks.length-1; }
  const tr=studioTracks[ti];
  if (!tr.clips.length) tr.clips.push(makeEmptyMidiClip(0,studioMidiBars||1));
  studioSelectedClip={ti,ci:0};
  return getSelectedStudioMidiClipInfo();
}

// ── MIDI playback ────────────────────────────────────────────────────
function playStudioMidiNote(midi, dur, vol) {
  try {
    if (!studioMidiCtx) studioMidiCtx=new(window.AudioContext||window.webkitAudioContext)();
    const c=studioMidiCtx, now=c.currentTime;
    const o=c.createOscillator(), g=c.createGain(), f=c.createBiquadFilter();
    o.type='triangle'; o.frequency.setValueAtTime(midiFreq(midi),now);
    f.type='lowpass'; f.frequency.value=1800;
    g.gain.setValueAtTime(vol||0.12,now);
    g.gain.exponentialRampToValueAtTime(0.001,now+Math.max(0.05,dur||0.3));
    o.connect(f); f.connect(g); g.connect(bus(c, 'notes'));
    o.start(now); o.stop(now+Math.max(0.06,dur||0.3));
  } catch(e) {}
}

function scheduleStudioMidiClipPlayback(clip, fromPlayhead) {
  syncStudioMidiClip(clip);
  const clipStart=clip.startTime||0, clipDur=Math.max(clip.duration||0,0.01);
  const offset=Math.max(0,fromPlayhead-clipStart);
  if (offset>=clipDur) return;
  const stepDur=getStudioMidiStepDurSec(clip);
  (clip.midiNotes||[]).forEach(n => {
    const noteStart=(n.step||0)*stepDur;
    const noteDur=Math.max(stepDur*(n.dot?(n.len||1)*1.5:(n.len||1))*0.95,0.05);
    if (noteStart+noteDur<=offset) return;
    const delay=Math.max(0,(clipStart+noteStart)-fromPlayhead);
    const tid=setTimeout(()=>playStudioMidiNote(n.midi,noteDur,0.14), delay*1000);
    studioPlaybackTimers.push(tid);
  });
}

export function addMidiNoteAtCursor(note, octave) {
  const info=ensureStudioMidiClip(); if (!info) return;
  const clip=syncStudioMidiClip(info.clip);
  const midi=noteOctToMidi(note,octave);
  const step=Math.max(0,studioMidiStep||0);
  const len=Math.max(1,studioMidiNoteLength||1);
  const idx=clip.midiNotes.findIndex(n=>n.step===step&&n.midi===midi);
  if (idx>=0) clip.midiNotes[idx].len=len;
  else clip.midiNotes.push({step,midi,len,vel:0.8});
  clip.midiNotes.sort((a,b)=>a.step-b.step||a.midi-b.midi);
  playStudioMidiNote(midi,0.28,0.18);
  renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel();
}

// ── Waveform canvas ──────────────────────────────────────────────────
function drawWaveform(audioSource, canvas, color, trimStart, trimEnd, baseDuration, blob) {
  if (!canvas) return;
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle=color+'18'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#ffffff18'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  const AC=window.AudioContext||window.webkitAudioContext; if (!AC) return;
  const actx=new AC();
  const dec=blob&&blob.arrayBuffer?blob.arrayBuffer():fetch(audioSource).then(r=>r.arrayBuffer());
  dec.then(buf=>actx.decodeAudioData(buf)).then(audioBuf=>{
    const data=audioBuf.getChannelData(0);
    const fullDur=Math.max(baseDuration||audioBuf.duration||0.001,0.001);
    const startS=Math.max(0,trimStart||0), endS=Math.max(startS,fullDur-Math.max(0,trimEnd||0));
    const startIdx=Math.max(0,Math.floor(startS/fullDur*data.length));
    const endIdx=Math.min(data.length,Math.max(startIdx+1,Math.floor(endS/fullDur*data.length)));
    const view=data.subarray?data.subarray(startIdx,endIdx):data.slice(startIdx,endIdx);
    const spp=Math.max(1,Math.floor(view.length/w));
    ctx.fillStyle=color+'12'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=color+'aa'; ctx.lineWidth=1;
    for (let x=0;x<w;x++) {
      const s=x*spp, e=Math.min(view.length,s+spp);
      let min=1,max=-1,rms=0,cnt=0;
      for (let i=s;i<e;i++){const v=view[i]||0;if(v<min)min=v;if(v>max)max=v;rms+=v*v;cnt++;}
      if (!cnt) continue;
      const amp=Math.max(Math.abs(min),Math.abs(max),Math.sqrt(rms/cnt)*1.5);
      ctx.beginPath(); ctx.moveTo(x+.5,(h/2)-amp*h*.42); ctx.lineTo(x+.5,(h/2)+amp*h*.42); ctx.stroke();
    }
    actx.close();
  }).catch(()=>{try{actx.close();}catch(e){}});
}

function drawMidiClipCanvas(canvas, clip, color) {
  syncStudioMidiClip(clip);
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='rgba(255,255,255,0.02)'; ctx.fillRect(0,0,w,h);
  const totalSteps=(clip.stepsPerBar||16)*(clip.bars||1);
  for (let i=0;i<=totalSteps;i++){
    const x=(i/totalSteps)*w;
    ctx.strokeStyle=i%4===0?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.05)';
    ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  (clip.midiNotes||[]).forEach(n=>{
    const x=((n.step||0)/totalSteps)*w;
    const ww=Math.max(4,((n.len||1)/totalSteps)*w-1);
    ctx.fillStyle=color||'#55aaff'; ctx.globalAlpha=0.82;
    ctx.fillRect(x+1,1,ww,Math.max(3,h-2));
    ctx.globalAlpha=1;
  });
}

// ── Track management ─────────────────────────────────────────────────
export function addStudioTrack(name, color, kind) {
  const k=kind||'audio';
  studioTracks.push({id:Date.now()+Math.floor(Math.random()*1000),name:name||((k==='midi'?'MIDI ':'Track ')+(studioTracks.length+1)),color:color||'#9977ee',kind:k,clips:[],muted:false,solo:false,armed:studioTracks.length===0&&k!=='midi',vol:80});
  if (k==='midi') {
    const tr=studioTracks[studioTracks.length-1];
    tr.clips.push(makeEmptyMidiClip(studioPlayhead||0,studioMidiBars||1));
    studioSelectedClip={ti:studioTracks.length-1,ci:0};
  }
  renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel();
}

function duplicateStudioClipAfterSelection() {
  if (!studioSelectedClip) return;
  const tr=studioTracks[studioSelectedClip.ti], clip=tr&&tr.clips[studioSelectedClip.ci];
  if (!tr||!clip) return;
  const newClip=clip.type==='midi'
    ?{type:'midi',name:(clip.name||'Clip')+' (dup)',startTime:(clip.startTime||0)+(clip.duration||4),bars:clip.bars||1,stepsPerBar:clip.stepsPerBar||16,duration:clip.duration||4,midiNotes:(clip.midiNotes||[]).map(n=>Object.assign({},n))}
    :{url:clip.url,blob:clip.blob,name:(clip.name||'Clip')+' (dup)',startTime:(clip.startTime||0)+getEffectiveClipDuration(clip),duration:getEffectiveClipDuration(clip),sourceDuration:getClipBaseDuration(clip),trimStart:getClipTrimStart(clip),trimEnd:getClipTrimEnd(clip)};
  tr.clips.push(newClip);
  tr.clips.sort((a,b)=>(a.startTime||0)-(b.startTime||0));
  studioSelectedClip={ti:studioSelectedClip.ti,ci:tr.clips.indexOf(newClip)};
  renderStudio();
}

function removeSelectedStudioClip() {
  if (!studioSelectedClip) return;
  const tr=studioTracks[studioSelectedClip.ti], clip=tr&&tr.clips[studioSelectedClip.ci];
  if (!tr||!clip) return;
  tr.clips.splice(studioSelectedClip.ci,1);
  studioSelectedClip=null;
  renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel();
}

// ── Transport ────────────────────────────────────────────────────────
function updatePlayhead() {
  const ph=document.getElementById('stu-playhead');
  if (ph) ph.style.left=(studioPlayhead*STUDIO_PX_PER_SEC)+'px';
  updateStudioTransport();
}

function animatePlayhead() {
  if (!studioPlaying) { cancelAnimationFrame(studioAnimFrame); return; }
  const now=performance.now()/1000;
  studioPlayhead+=(now-studioStartTime);
  studioStartTime=now;
  if (studioLoopEnabled) {
    const maxEnd=studioTracks.reduce((m,tr)=>Math.max(m,tr.clips.reduce((m2,c)=>Math.max(m2,(c.startTime||0)+(c.duration||4)),0)),0);
    if (maxEnd>0&&studioPlayhead>maxEnd) { studioPlayhead=0; scheduleStudioClipPlayback(0); }
  }
  const totalDur=STUDIO_TOTAL_BARS*(60/(metroClock.bpm||120))*(metroClock.ts||4);
  if (studioPlayhead>totalDur) studioPlayhead=0;
  updatePlayhead();
  const tl=document.getElementById('studio-timeline');
  if (tl){const px=studioPlayhead*STUDIO_PX_PER_SEC;if(px>tl.scrollLeft+tl.clientWidth-40)tl.scrollLeft=px-80;}
  studioAnimFrame=requestAnimationFrame(animatePlayhead);
}

function clearStudioPlaybackSchedules() {
  studioPlaybackTimers.forEach(t=>clearTimeout(t)); studioPlaybackTimers=[];
  studioPlaybackAudios.forEach(a=>{try{a.pause();a.currentTime=0;}catch(e){}});studioPlaybackAudios=[];
}

function scheduleStudioClipPlayback(fromPlayhead) {
  clearStudioPlaybackSchedules();
  const soloExists=studioTracks.some(t=>t.solo);
  studioTracks.forEach(tr=>{
    if (tr.muted||(soloExists&&!tr.solo)) return;
    tr.clips.forEach(clip=>{
      if (!clip) return;
      if (clip.type==='midi') { scheduleStudioMidiClipPlayback(clip,fromPlayhead); return; }
      if (!clip.url) return;
      normalizeClipTiming(clip);
      const clipStart=clip.startTime||0, clipDur=Math.max(getEffectiveClipDuration(clip)||0,0.05);
      const offset=Math.max(0,fromPlayhead-clipStart);
      if (offset>=clipDur) return;
      const delay=Math.max(0,clipStart-fromPlayhead);
      const sourceOffset=getClipTrimStart(clip)+offset;
      const tid=setTimeout(()=>{
        const a=new Audio(clip.url); a.loop=false;
        try{a.currentTime=sourceOffset;}catch(e){}
        a.play().catch(()=>{});
        const stopTid=setTimeout(()=>{try{a.pause();}catch(e){}}, (clipDur-offset)*1000+30);
        studioPlaybackTimers.push(stopTid); studioPlaybackAudios.push(a);
      }, delay*1000);
      studioPlaybackTimers.push(tid);
    });
  });
}

function studioStartClick() {
  studioStopClick();
  if (!studioClickCtx) studioClickCtx=new(window.AudioContext||window.webkitAudioContext)();
  const bpm=metroClock.bpm||120; studioClickBeat=0;
  function tick() {
    const t=studioClickCtx.currentTime,o=studioClickCtx.createOscillator(),g=studioClickCtx.createGain();
    o.type='sine'; o.frequency.value=studioClickBeat===0?880:660;
    g.gain.setValueAtTime(studioClickBeat===0?.3:.15,t); g.gain.exponentialRampToValueAtTime(.001,t+.05);
    o.connect(g); g.connect(bus(studioClickCtx, 'click')); o.start(t); o.stop(t+.05);
    studioClickBeat=(studioClickBeat+1)%(metroClock.ts||4);
  }
  tick(); studioClickIntv=setInterval(tick,60000/bpm);
}
function studioStopClick() { if(studioClickIntv){clearInterval(studioClickIntv);studioClickIntv=null;} }

function studioStartPlayback() {
  studioPlaying=true; studioStartTime=performance.now()/1000;
  scheduleStudioClipPlayback(studioPlayhead||0);
  if (studioClickEnabled) studioStartClick();
  studioAnimFrame=requestAnimationFrame(animatePlayhead);
  renderStudio(); renderStudioMidiPanel();
}

function studioStopPlayback() {
  studioPlaying=false; cancelAnimationFrame(studioAnimFrame);
  clearStudioPlaybackSchedules(); studioStopClick();
  renderStudio(); renderStudioMidiPanel();
}

function studioStartRecording() {
  const armedIdx=studioTracks.findIndex(t=>t.armed); if(armedIdx<0) return;
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    studioRecTarget=armedIdx; const recStart=studioPlayhead;
    const recorder=new MediaRecorder(stream); const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:'audio/webm'}); const url=URL.createObjectURL(blob);
      const dur=studioPlayhead-recStart;
      studioTracks[armedIdx].clips.push({url,blob,name:'Take '+(studioTracks[armedIdx].clips.length+1),startTime:recStart,duration:Math.max(dur,0.5),sourceDuration:Math.max(dur,0.5),trimStart:0,trimEnd:0});
      // onstop lands after studioStopPlayback has already killed the playhead rAF, so the
      // transport gets no free repaint here — ask for one or ● stays red with no take.
      stream.getTracks().forEach(t=>t.stop()); studioRecording=false; studioRecTarget=null; renderStudio(); updateStudioTransport();
    };
    recorder.start(); studioRecording=true;
    studioStartPlayback(); renderStudio(); updateStudioTransport(); studioTracks[armedIdx]._recorder=recorder;
  }).catch(()=>{});
}

function studioStopRecording() {
  const armedIdx=studioTracks.findIndex(t=>t._recorder);
  if(armedIdx>=0){studioTracks[armedIdx]._recorder.stop();studioTracks[armedIdx]._recorder=null;}
  studioStopPlayback();
}

// ── Transport display ────────────────────────────────────────────────
function updateStudioTransport() {
  const bpm=metroClock.bpm||120,ts=metroClock.ts||4;
  // the tempo readout repaints itself — it is wired to the master clock
  const lb=document.getElementById('stu-loop');
  if(lb){lb.style.background=studioLoopEnabled?STUDIO_ACCENT+'22':'#1a1a1e';lb.style.color=studioLoopEnabled?STUDIO_ACCENT:'#555';}
  const cb=document.getElementById('stu-click');
  if(cb){cb.style.background=studioClickEnabled?'#dd884422':'#1a1a1e';cb.style.color=studioClickEnabled?'#dd8844':'#555';}
  // ● is a record/stop-record toggle, so mid-take it IS the control that ends the take —
  // same job as the looper's ■ STOP REC, and it takes the same stop red and ■ glyph. The
  // red arrives with the take and leaves with it, so ⏹ never has a rival red beside it.
  const rb=document.getElementById('stu-rec');
  if(rb){
    const glyph=studioRecording?'■':'●';           // this repaints every frame while rolling
    if(rb.textContent!==glyph) rb.textContent=glyph;
    rb.style.background=studioRecording?'var(--rk-stop-soft)':STUDIO_ACCENT+'22';
    rb.style.borderColor=studioRecording?'var(--rk-stop-edge)':STUDIO_ACCENT+'55';
    rb.style.color=studioRecording?'var(--rk-stop)':STUDIO_ACCENT;
  }
  const secPerBeat=60/bpm, secPerBar=secPerBeat*ts;
  const bar=Math.floor(studioPlayhead/secPerBar)+1;
  const beat=Math.floor((studioPlayhead%secPerBar)/secPerBeat)+1;
  const tick=Math.floor(((studioPlayhead%secPerBar)%secPerBeat)/secPerBeat*100);
  const posEl=document.getElementById('stu-pos'); if(posEl) posEl.textContent=bar+'.'+beat+'.'+String(tick).padStart(2,'0');
  const mins=Math.floor(studioPlayhead/60),secs=Math.floor(studioPlayhead%60);
  const timeEl=document.getElementById('stu-time'); if(timeEl) timeEl.textContent=mins+':'+String(secs).padStart(2,'0');
}

function updateStudioViewButtons() {
  const pb=document.getElementById('stu-view-production'),mb=document.getElementById('stu-view-midi'),nb=document.getElementById('stu-view-notation');
  if(pb){pb.style.background=studioView==='production'?STUDIO_ACCENT+'24':'rgba(255,255,255,.04)';pb.style.borderColor=studioView==='production'?STUDIO_ACCENT+'55':'#333';pb.style.color=studioView==='production'?STUDIO_ACCENT:'#666';}
  if(mb){mb.style.background=studioView==='midi'?'rgba(85,170,255,.14)':'rgba(255,255,255,.04)';mb.style.borderColor=studioView==='midi'?'#55aaff55':'#333';mb.style.color=studioView==='midi'?'#55aaff':'#666';}
  if(nb){nb.style.background=studioView==='notation'?'rgba(230,211,138,.14)':'rgba(255,255,255,.04)';nb.style.borderColor=studioView==='notation'?'#e6d38a55':'#333';nb.style.color=studioView==='notation'?'#e6d38a':'#666';}
  renderStudioMidiPanel(); renderStudioNotationPanel();
}

// ── Main timeline render ─────────────────────────────────────────────
function renderStudio() {
  const barW=getStudioBarWidth(), totalW=getStudioTotalWidth(), trackH=52;
  const labelsEl=document.getElementById('stu-track-labels'); if(!labelsEl) return;

  let lh='';
  studioTracks.forEach((tr,ti)=>{
    const armed=tr.armed, isRec=studioRecording&&studioRecTarget===ti;
    lh+=`<div style="height:${trackH}px;border-bottom:1px solid #1a1a1e;padding:3px 6px;display:flex;flex-direction:column;justify-content:center">`;
    lh+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:4px">`;
    lh+=`<div class="stu-rename mono" data-ti="${ti}" style="color:${tr.color};font-size:calc(9px*var(--ui));font-weight:700;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tr.name}</div>`;
    lh+=`<span class="mono" style="color:${tr.kind==='midi'?'#55aaff':'#555'};font-size:calc(6px*var(--ui));border:1px solid ${tr.kind==='midi'?'#55aaff33':'#333'};border-radius:8px;padding:1px 4px">${tr.kind==='midi'?'MIDI':'AUDIO'}</span></div>`;
    lh+=`<div style="display:flex;gap:2px;margin-top:2px">`;
    lh+=`<button class="mono stu-arm" data-ti="${ti}" style="background:${armed?'#ff444422':'#1a1a1e'};border:1px solid ${armed?'#ff4444':'#2a2a2e'};color:${armed?'#ff4444':'#444'};border-radius:2px;width:16px;height:14px;cursor:pointer;font-size:calc(6px*var(--ui));padding:0">R</button>`;
    lh+=`<button class="mono stu-mute" data-ti="${ti}" style="background:${tr.muted?'#ffaa0022':'#1a1a1e'};border:1px solid ${tr.muted?'#ffaa00':'#2a2a2e'};color:${tr.muted?'#ffaa00':'#444'};border-radius:2px;width:16px;height:14px;cursor:pointer;font-size:calc(6px*var(--ui));padding:0">M</button>`;
    lh+=`<button class="mono stu-solo" data-ti="${ti}" style="background:${tr.solo?'#44bbdd22':'#1a1a1e'};border:1px solid ${tr.solo?'#44bbdd':'#2a2a2e'};color:${tr.solo?'#44bbdd':'#444'};border-radius:2px;width:16px;height:14px;cursor:pointer;font-size:calc(6px*var(--ui));padding:0">S</button>`;
    lh+=`<button class="mono stu-del" data-ti="${ti}" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#444;border-radius:2px;width:16px;height:14px;cursor:pointer;font-size:calc(6px*var(--ui));padding:0">x</button>`;
    lh+=`</div></div>`;
  });
  labelsEl.innerHTML=lh;

  const rulerEl=document.getElementById('stu-bar-ruler');
  if(rulerEl){
    let rh='';
    for(let b=1;b<=STUDIO_TOTAL_BARS;b++) rh+=`<div style="min-width:${barW}px;max-width:${barW}px;border-right:1px solid ${b%4===0?'#333':'#1a1a1e'};display:flex;align-items:center;padding:0 4px"><span class="mono" style="color:${b%4===1?'#666':'#333'};font-size:calc(7px*var(--ui))">${b}</span></div>`;
    rulerEl.innerHTML=rh; rulerEl.style.minWidth=totalW+'px';
  }

  const lanesEl=document.getElementById('stu-track-lanes');
  if(lanesEl){
    let th='';
    studioTracks.forEach((tr,ti)=>{
      const isRec=studioRecording&&studioRecTarget===ti;
      th+=`<div style="height:${trackH}px;border-bottom:1px solid #1a1a1e;position:relative;min-width:${totalW}px">`;
      for(let b=1;b<=STUDIO_TOTAL_BARS;b++) th+=`<div style="position:absolute;top:0;bottom:0;left:${b*barW}px;width:1px;background:${b%4===0?'#ffffff0a':'#ffffff04'}"></div>`;
      tr.clips.forEach((clip,ci)=>{
        normalizeClipTiming(clip);
        const startPx=(clip.startTime||0)*STUDIO_PX_PER_SEC;
        const durPx=(getEffectiveClipDuration(clip)||4)*STUDIO_PX_PER_SEC;
        const isSel=studioSelectedClip&&studioSelectedClip.ti===ti&&studioSelectedClip.ci===ci;
        th+=`<div class="stu-clip" data-ti="${ti}" data-ci="${ci}" style="position:absolute;top:3px;bottom:3px;left:${startPx}px;width:${durPx}px;background:${tr.color}15;border:${isSel?'2px solid '+tr.color:'1px solid '+tr.color+'33'};border-radius:3px;overflow:hidden;cursor:${clip.type==='midi'?'pointer':'grab'}">`;
        th+=`<canvas class="stu-waveform" data-ti="${ti}" data-ci="${ci}" width="${Math.max(100,Math.round(durPx))}" height="${trackH-8}" style="width:100%;height:100%;display:block"></canvas>`;
        if(clip.type!=='midi'){
          th+=`<div class="stu-trim-handle stu-trim-left" data-ti="${ti}" data-ci="${ci}" style="position:absolute;left:0;top:0;bottom:0;width:8px;background:linear-gradient(90deg,${tr.color}55,${tr.color}08);cursor:ew-resize"></div>`;
          th+=`<div class="stu-trim-handle stu-trim-right" data-ti="${ti}" data-ci="${ci}" style="position:absolute;right:0;top:0;bottom:0;width:8px;background:linear-gradient(270deg,${tr.color}55,${tr.color}08);cursor:ew-resize"></div>`;
        }
        th+=`<span class="mono" style="position:absolute;bottom:1px;left:10px;color:${tr.color};font-size:calc(6px*var(--ui));font-weight:600">${clip.name||'Clip '+(ci+1)}</span></div>`;
      });
      if(!tr.clips.length&&!isRec) th+=`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span class="mono" style="color:#222;font-size:calc(8px*var(--ui))">${tr.armed?'Armed':'Empty'}</span></div>`;
      th+=`</div>`;
    });
    lanesEl.innerHTML=th; lanesEl.style.minWidth=totalW+'px';

    document.querySelectorAll('.stu-waveform').forEach(canvas=>{
      const ti=parseInt(canvas.dataset.ti),ci=parseInt(canvas.dataset.ci);
      const clip=studioTracks[ti]&&studioTracks[ti].clips[ci];
      if(clip&&clip.type==='midi') drawMidiClipCanvas(canvas,clip,studioTracks[ti].color);
      else if(clip&&clip.url) drawWaveform(clip.url,canvas,studioTracks[ti].color,getClipTrimStart(clip),getClipTrimEnd(clip),getClipBaseDuration(clip),clip.blob);
    });

    labelsEl.querySelectorAll('.stu-rename').forEach(el2=>el2.onclick=e=>{
      e.stopPropagation(); const ti=parseInt(el2.dataset.ti);
      const n=prompt('Track name:',studioTracks[ti].name); if(n!==null&&n.trim()){studioTracks[ti].name=n.trim();renderStudio();}
    });
    labelsEl.querySelectorAll('.stu-arm').forEach(b=>b.onclick=e=>{e.stopPropagation();const ti=parseInt(b.dataset.ti);studioTracks.forEach((t,i)=>{t.armed=i===ti;});renderStudio();});
    labelsEl.querySelectorAll('.stu-mute').forEach(b=>b.onclick=e=>{e.stopPropagation();studioTracks[parseInt(b.dataset.ti)].muted=!studioTracks[parseInt(b.dataset.ti)].muted;renderStudio();});
    labelsEl.querySelectorAll('.stu-solo').forEach(b=>b.onclick=e=>{e.stopPropagation();studioTracks[parseInt(b.dataset.ti)].solo=!studioTracks[parseInt(b.dataset.ti)].solo;renderStudio();});
    labelsEl.querySelectorAll('.stu-del').forEach(b=>b.onclick=e=>{
      e.stopPropagation(); const ti=parseInt(b.dataset.ti);
      studioTracks[ti].clips.forEach(c=>{if(c&&c.url)URL.revokeObjectURL(c.url);});
      studioTracks.splice(ti,1);
      if(studioSelectedClip&&studioSelectedClip.ti===ti) studioSelectedClip=null;
      renderStudio(); renderStudioMidiPanel();
    });

    lanesEl.querySelectorAll('.stu-clip').forEach(clipEl=>{
      const ti=parseInt(clipEl.dataset.ti),ci=parseInt(clipEl.dataset.ci);
      clipEl.onclick=e=>{
        if(studioClipDragState&&studioClipDragState.moved) return;
        e.stopPropagation(); studioSelectedClip={ti,ci}; renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel();
      };
      clipEl.onmousedown=e=>{
        if(e.target.closest('.stu-trim-handle')) return;
        const clip=studioTracks[ti]&&studioTracks[ti].clips[ci]; if(!clip) return;
        studioSelectedClip={ti,ci};
        studioClipDragState={mode:'move',ti,ci,startX:e.clientX,origStart:clip.startTime||0,moved:false};
        e.preventDefault(); e.stopPropagation();
      };
    });
    lanesEl.querySelectorAll('.stu-trim-left').forEach(h=>h.onmousedown=e=>{
      const ti=parseInt(h.dataset.ti),ci=parseInt(h.dataset.ci),clip=studioTracks[ti]&&studioTracks[ti].clips[ci]; if(!clip) return;
      normalizeClipTiming(clip); studioSelectedClip={ti,ci};
      studioClipDragState={mode:'trim-left',ti,ci,startX:e.clientX,origStart:clip.startTime||0,origTrim:getClipTrimStart(clip),base:getClipBaseDuration(clip),moved:false};
      e.preventDefault(); e.stopPropagation();
    });
    lanesEl.querySelectorAll('.stu-trim-right').forEach(h=>h.onmousedown=e=>{
      const ti=parseInt(h.dataset.ti),ci=parseInt(h.dataset.ci),clip=studioTracks[ti]&&studioTracks[ti].clips[ci]; if(!clip) return;
      normalizeClipTiming(clip); studioSelectedClip={ti,ci};
      studioClipDragState={mode:'trim-right',ti,ci,startX:e.clientX,origTrim:getClipTrimEnd(clip),base:getClipBaseDuration(clip),moved:false};
      e.preventDefault(); e.stopPropagation();
    });
  }

  const dupBtn=document.getElementById('stu-dupclip');
  if(dupBtn){dupBtn.style.opacity=studioSelectedClip?'1':'0.55';}
  const delBtn=document.getElementById('stu-delclip');
  if(delBtn){delBtn.style.opacity=studioSelectedClip?'1':'0.55';}
  updatePlayhead();
}

// ── Studio catalog popup ─────────────────────────────────────────────
const STUDIO_PEDAL_TYPES = ['audio','tuner','metronome','beatmaker','amp','looper','chords','scales','arpeggios','circle5','progression','ear','notequiz'];

function darkenColor(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  return '#' + [n>>16, (n>>8)&0xff, n&0xff].map(v => Math.max(0,v-amt).toString(16).padStart(2,'0')).join('');
}

function showStudioCatalog() {
  // Remove any existing popup
  document.getElementById('studio-catalog-popup')?.remove();

  const studioItems = CATALOG.filter(c => STUDIO_PEDAL_TYPES.includes(c.type));
  const popup = document.createElement('div');
  popup.id = 'studio-catalog-popup';
  popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    width:320px;max-height:520px;overflow-y:auto;
    background:linear-gradient(180deg,#141414,#0e0e0e);
    border:1px solid #2a2a2a;border-radius:12px;
    box-shadow:0 20px 60px rgba(0,0,0,.8);
    z-index:9999;padding:16px`;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span class="mono" style="color:${STUDIO_ACCENT};font-size:calc(11px*var(--ui));font-weight:700;letter-spacing:2px">STUDIO PEDALS</span>
    <button id="stu-catalog-close" style="background:none;border:none;color:#666;cursor:pointer;font-size:calc(16px*var(--ui))">✕</button>
  </div>`;

  studioItems.forEach(item => {
    const acc  = item.accent || '#444';
    const bg   = item.color  || '#1a1a1a';
    const dark = darkenColor(bg, 15);
    const already = studioPedals.find(p => p.type === item.type);
    html += `<div class="stu-cat-item" data-type="${item.type}"
      style="background:linear-gradient(135deg,${bg},${dark});border:1px solid ${already?acc:acc+'33'};
             border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:all .2s">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        <span style="font-size:calc(15px*var(--ui))">${item.icon}</span>
        <span class="mono" style="color:${acc};font-size:calc(10px*var(--ui));font-weight:700">${item.title}</span>
        <span style="flex:1"></span>
        <span class="mono" style="background:${acc}22;border:1px solid ${acc}44;color:${acc};
               border-radius:5px;padding:1px 7px;font-size:calc(8px*var(--ui));font-weight:700">
          ${already ? '✓ OPEN' : '+ ADD'}
        </span>
      </div>
      <div style="color:#777;font-size:calc(8px*var(--ui));line-height:1.4">${item.desc}</div>
    </div>`;
  });

  popup.innerHTML = html;
  document.body.appendChild(popup);

  popup.querySelector('#stu-catalog-close')?.addEventListener('click', e => { e.stopPropagation(); popup.remove(); });

  popup.querySelectorAll('.stu-cat-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const type = item.dataset.type;
      if (studioPedals.find(p => p.type === type)) { popup.remove(); return; }
      const cat = CATALOG.find(c => c.type === type);
      if (!cat) return;
      const p = { id: type+'-stu-'+Date.now(), type, w:cat.w||280, h:cat.h||400, settings:{} };
      studioPedals.push(p);
      renderStudioPedals();
      popup.remove();
    });
  });
}

// ── Studio pedals ────────────────────────────────────────────────────
function renderStudioPedals() {
  const ct=document.getElementById('studio-pedals-container'); if(!ct) return;
  studioPedals.forEach(p=>{
    if(document.getElementById('stu-ped-'+p.id)) return;
    renderStudioPedalShell(p,ct);
  });
  [...ct.children].forEach(kid=>{
    if(kid.id&&kid.id.startsWith('stu-ped-')){
      const pid=kid.id.replace('stu-ped-','');
      if(!studioPedals.find(p=>p.id===pid)) kid.remove();
    }
  });
}

function renderStudioPedalShell(p, container) {
  const cat=CATALOG.find(c=>c.type===p.type); if(!cat) return;
  if(!p.x) p.x=20+studioPedals.indexOf(p)*30;
  if(!p.y) p.y=20+studioPedals.indexOf(p)*20;
  if(!p._origH) p._origH=p.h||cat.h||400;
  if(!p.h) p.h=p._origH;
  if(!p.w) p.w=cat.w||280;
  const div=document.createElement('div');
  div.id='stu-ped-'+p.id;
  // The same hand-off the board's shell makes (ui/pedal-system.js): the card
  // publishes this pedal's accent and chassis as variables and wears its tier
  // class. Without it the .rk body inside inherits nothing and every pedal in
  // the Studio renders in the neutral steel fallback — a violet header over
  // grey-blue controls, one card wearing two colour systems.
  div.classList.add('pedal-card','tier-'+(cat.tier||'free'));
  div.style.setProperty('--rk-pedal-accent',cat.accent);
  div.style.setProperty('--rk-accent',cat.accent);
  div.style.setProperty('--rk-chassis',cat.color);
  div.style.setProperty('--hover-accent',cat.accent);
  // Geometry only. The paint — chassis, border, the tier's lit edges — has to
  // stay in kit.css, because an inline style beats a class and the tier finish
  // would never get to win.
  Object.assign(div.style,{position:'absolute',left:p.x+'px',top:p.y+'px',width:p.w+'px',height:p.h+'px',userSelect:'none',zIndex:'10',display:'flex',flexDirection:'column',overflow:'hidden'});
  div.innerHTML=`<div class="pedal-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:grab"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:calc(16px*var(--ui))">${cat.icon}</span><span class="mono" style="color:var(--rk-pedal-accent);font-size:calc(11px*var(--ui));font-weight:800;letter-spacing:2px">${cat.title}</span></div><div style="display:flex;gap:4px"><button class="min-btn" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#aaa;border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:calc(12px*var(--ui))">▁</button><button class="rm-btn" style="background:rgba(255,50,50,.2);border:1px solid rgba(255,50,50,.3);color:#ff6666;border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:calc(12px*var(--ui))">✕</button></div></div><div id="body-${p.id}" style="flex:1;overflow:auto;padding:12px;cursor:default"></div><div class="rh" style="position:absolute;bottom:2px;right:2px;width:16px;height:16px;cursor:nwse-resize;display:flex;align-items:center;justify-content:center"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M9 1L1 9M9 5L5 9M9 8L8 9" style="stroke:var(--rk-accent)" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg></div>`;
  container.appendChild(div);
  buildContent(p);

  let topZ=10;
  const bringFront=()=>{topZ++;div.style.zIndex=String(topZ);};
  div.onmousedown=bringFront;

  div.querySelector('.min-btn').onclick=e=>{
    e.stopPropagation(); p.minimized=!p.minimized;
    const body=document.getElementById('body-'+p.id),rh=div.querySelector('.rh'),mb=div.querySelector('.min-btn');
    // parked, not demoted: the class keeps kit.css's tier finish on the title bar
    div.classList.toggle('minimized',p.minimized);
    if(p.minimized){body.style.display='none';rh.style.display='none';div.style.height='42px';mb.textContent='▢';}
    else{body.style.display='';rh.style.display='';div.style.height=p.h+'px';mb.textContent='▁';}
  };
  div.querySelector('.rm-btn').onclick=e=>{
    e.stopPropagation(); studioPedals=studioPedals.filter(sp=>sp.id!==p.id); div.remove();
  };

  const hdr=div.querySelector('.pedal-header');
  let dragging=false,dx=0,dy=0;
  hdr.onmousedown=e=>{if(e.target.closest('.rm-btn')||e.target.closest('.min-btn'))return;e.preventDefault();dragging=true;dx=e.clientX-p.x;dy=e.clientY-p.y;bringFront();hdr.style.cursor='grabbing';};
  window.addEventListener('mousemove',e=>{if(!dragging)return;p.x=e.clientX-dx;p.y=e.clientY-dy;div.style.left=p.x+'px';div.style.top=p.y+'px';});
  window.addEventListener('mouseup',()=>{if(dragging){dragging=false;hdr.style.cursor='grab';}});

  const rhEl=div.querySelector('.rh');
  let resizing=false,sw=0,sh=0,rsx=0,rsy=0;
  if(rhEl){rhEl.onmousedown=e=>{e.preventDefault();e.stopPropagation();resizing=true;sw=p.w;sh=p.h;rsx=e.clientX;rsy=e.clientY;};
    window.addEventListener('mousemove',e=>{if(!resizing)return;p.w=Math.max(200,sw+e.clientX-rsx);p.h=Math.max(160,sh+e.clientY-rsy);p._origH=p.h;div.style.width=p.w+'px';div.style.height=p.h+'px';});
    window.addEventListener('mouseup',()=>{resizing=false;});}
}

// ── Chord tools ──────────────────────────────────────────────────────
function getStudioChordMidiNotes() {
  const fam=CHORD_TYPES[studioChordFamily]||CHORD_TYPES['Triads'];
  const first=Object.keys(fam)[0]||'Major';
  if(!(studioChordType in fam)) studioChordType=first;
  const intervals=(fam[studioChordType]||[0,4,7]).slice();
  const rootIdx=NOTES.indexOf(toSharp(studioChordRoot));
  const baseOct=Math.max(1,Math.min(6,parseInt(studioChordOctave||3)));
  let mids=intervals.map(i=>((baseOct+1)*12)+rootIdx+i).sort((a,b)=>a-b);
  let inv=Math.max(0,Math.min(3,parseInt(studioChordInversion||0)));
  for(let i=0;i<inv&&i<mids.length;i++) mids[i]+=12;
  mids.sort((a,b)=>a-b);
  return mids;
}

function renderStudioChordTools(containerId, mode) {
  const el=document.getElementById(containerId); if(!el) return;
  const fam=CHORD_TYPES[studioChordFamily]||CHORD_TYPES['Triads'];
  const options=Object.keys(fam);
  if(options.indexOf(studioChordType)<0) studioChordType=options[0]||'Major';
  const accent=mode==='notation'?'#d8c58f':'#7fc0ff';
  const subtle=mode==='notation'?'#8c856e':'#6d7f9f';
  const mids=getStudioChordMidiNotes();
  const notes=mids.map(m=>midiToNoteOct(m).note);

  let h=`<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">`;
  h+=`<div><div class="mono" style="color:${subtle};font-size:calc(7px*var(--ui));margin-bottom:3px">Root</div><select id="${containerId}-root" class="mono" style="width:100%;height:26px;background:#0a0a0c;border:1px solid #333;color:${accent};font-size:calc(9px*var(--ui))">${NOTES.map(n=>`<option value="${n}"${studioChordRoot===n?' selected':''}>${n.replace('#','♯')}</option>`).join('')}</select></div>`;
  h+=`<div><div class="mono" style="color:${subtle};font-size:calc(7px*var(--ui));margin-bottom:3px">Family</div><select id="${containerId}-family" class="mono" style="width:100%;height:26px;background:#0a0a0c;border:1px solid #333;color:${accent};font-size:calc(9px*var(--ui))">${Object.keys(CHORD_TYPES).map(n=>`<option value="${n}"${studioChordFamily===n?' selected':''}>${n}</option>`).join('')}</select></div>`;
  h+=`<div><div class="mono" style="color:${subtle};font-size:calc(7px*var(--ui));margin-bottom:3px">Chord</div><select id="${containerId}-type" class="mono" style="width:100%;height:26px;background:#0a0a0c;border:1px solid #333;color:${accent};font-size:calc(9px*var(--ui))">${options.map(n=>`<option value="${n}"${studioChordType===n?' selected':''}>${n}</option>`).join('')}</select></div>`;
  h+=`<div><div class="mono" style="color:${subtle};font-size:calc(7px*var(--ui));margin-bottom:3px">Octave</div><select id="${containerId}-oct" class="mono" style="width:100%;height:26px;background:#0a0a0c;border:1px solid #333;color:${accent};font-size:calc(9px*var(--ui))">${[1,2,3,4,5].map(n=>`<option value="${n}"${studioChordOctave===n?' selected':''}>${n}</option>`).join('')}</select></div>`;
  h+=`</div>`;
  h+=`<div style="margin-top:8px;padding:8px;border:1px solid ${mode==='notation'?'#342d1d':'#223247'};border-radius:6px;background:${mode==='notation'?'#16130d':'#101521'}">`;
  h+=`<div class="mono" style="color:${subtle};font-size:calc(7px*var(--ui))">NOTES: ${notes.join(' · ')}</div>`;
  h+=`<div style="display:flex;gap:6px;margin-top:8px">`;
  h+=`<button id="${containerId}-insert" class="mono" style="flex:1;height:28px;border-radius:6px;border:1px solid ${accent}55;background:${accent}12;color:${accent};cursor:pointer;font-size:calc(8px*var(--ui))">Insert at Cursor</button>`;
  h+=`<button id="${containerId}-play" class="mono" style="height:28px;padding:0 8px;border-radius:6px;border:1px solid #333;background:#111;color:#bbb;cursor:pointer;font-size:calc(8px*var(--ui))">▶</button>`;
  h+=`</div></div>`;
  el.innerHTML=h;

  const bind=(suffix,fn)=>{const n=document.getElementById(containerId+'-'+suffix);if(n)n.onchange=fn;};
  bind('root',function(){studioChordRoot=this.value;renderStudioChordTools(containerId,mode);});
  bind('family',function(){studioChordFamily=this.value;const opts=Object.keys(CHORD_TYPES[studioChordFamily]||{});studioChordType=opts[0]||studioChordType;renderStudioChordTools(containerId,mode);});
  bind('type',function(){studioChordType=this.value;renderStudioChordTools(containerId,mode);});
  bind('oct',function(){studioChordOctave=parseInt(this.value||3);renderStudioChordTools(containerId,mode);});
  const ins=document.getElementById(containerId+'-insert');
  if(ins) ins.onclick=()=>{
    const info=ensureStudioMidiClip(); if(!info) return;
    const clip=syncStudioMidiClip(info.clip);
    const step=Math.max(0,studioMidiStep||0);
    const len=Math.max(1,studioMidiNoteLength||2);
    getStudioChordMidiNotes().forEach(m=>{
      const idx=clip.midiNotes.findIndex(n=>n.step===step&&n.midi===m);
      if(idx>=0) clip.midiNotes[idx].len=len; else clip.midiNotes.push({step,midi:m,len,vel:0.85});
    });
    clip.midiNotes.sort((a,b)=>a.step-b.step||a.midi-b.midi);
    renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel();
    getStudioChordMidiNotes().forEach((m,i)=>setTimeout(()=>playStudioMidiNote(m,0.4,0.12),i*16));
  };
  const play=document.getElementById(containerId+'-play');
  if(play) play.onclick=()=>getStudioChordMidiNotes().forEach((m,i)=>setTimeout(()=>playStudioMidiNote(m,0.6,0.12),i*22));
}

// ── MIDI panel ───────────────────────────────────────────────────────
function renderStudioMidiInputSurface() {
  const el=document.getElementById('stu-midi-input-surface'); if(!el) return;
  const inst=getInst(); let h='';
  if(inst.renderer==='keyboard'){
    h+='<div style="display:flex;flex-wrap:wrap;gap:3px">';
    for(let oct=3;oct<=5;oct++){
      NOTES.forEach(note=>{
        const isBlack=note.includes('#');
        h+=`<button class="stu-midi-note-btn mono" data-note="${note}" data-oct="${oct}" style="min-width:34px;padding:6px 4px;border-radius:5px;cursor:pointer;background:${isBlack?'#111':'#f2f2f2'};color:${isBlack?'#ddd':'#222'};border:1px solid ${isBlack?'#333':'#bbb'};font-size:calc(8px*var(--ui))">${note}<span style="opacity:.5;font-size:calc(6px*var(--ui))">${oct}</span></button>`;
      });
    }
    h+='</div>';
  } else {
    const strings=customTuning.slice().reverse();
    h+='<div style="display:flex;flex-direction:column;gap:5px">';
    strings.forEach((s,revIdx)=>{
      const si=customTuning.length-1-revIdx;
      h+=`<div><div class="mono" style="color:#666;font-size:calc(7px*var(--ui));margin-bottom:2px">String ${si+1} · ${s.note}${s.octave}</div><div style="display:flex;gap:2px;flex-wrap:wrap">`;
      for(let fret=0;fret<=12;fret++){
        const info=getNoteAtFret(s.note,s.octave,fret);
        h+=`<button class="stu-midi-fret-btn mono" data-si="${si}" data-fret="${fret}" data-note="${info.note}" data-oct="${info.octave}" style="min-width:32px;padding:4px 3px;border-radius:5px;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid #333;color:#bbb;font-size:calc(7px*var(--ui))">${info.note}<div style="font-size:calc(5px*var(--ui));color:#666">f${fret}</div></button>`;
      }
      h+='</div></div>';
    });
    h+='</div>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.stu-midi-note-btn,.stu-midi-fret-btn').forEach(b=>{
    b.onclick=e=>{e.stopPropagation();addMidiNoteAtCursor(b.dataset.note,parseInt(b.dataset.oct||3));};
  });
}

function renderStudioMidiPanel() {
  const panel=document.getElementById('studio-midi-panel'); if(!panel) return;
  panel.style.display=(studioView==='midi')?'flex':'none';
  if(studioView!=='midi') return;

  const info=getSelectedStudioMidiClipInfo();
  const clip=info?syncStudioMidiClip(info.clip):null;
  const target=document.getElementById('stu-midi-target');
  if(target) target.textContent=info?(info.track.name+' · '+(clip.name||'MIDI Clip')):'No MIDI clip selected';

  const grid=document.getElementById('stu-midi-grid');
  const wrap=document.getElementById('stu-midi-grid-wrap');
  const labelsEl=document.getElementById('stu-midi-note-labels');
  const stepLabel=document.getElementById('stu-midi-step-label');
  if(stepLabel) stepLabel.textContent='Step '+(studioMidiStep+1);

  if(!clip||!grid) { if(grid) grid.innerHTML='<div class="mono" style="color:#444;font-size:calc(9px*var(--ui));padding:20px;text-align:center">No MIDI clip selected.<br>Add a MIDI track or click a MIDI clip.</div>'; renderStudioMidiInputSurface(); renderStudioChordTools('stu-midi-chord-tools','midi'); return; }

  const rows=getStudioNotationRows();
  const rowH=18, cellW=24;
  const totalSteps=(clip.stepsPerBar||16)*(clip.bars||1);
  const width=Math.max(400,totalSteps*cellW);
  const height=rows.length*rowH;

  if(labelsEl){
    let lh='';
    rows.forEach(r=>{lh+=`<div class="mono" style="height:${rowH}px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;color:#555;font-size:calc(7px*var(--ui));border-bottom:1px solid #0d0d11">${r.label}</div>`;});
    labelsEl.innerHTML=lh;
  }

  let gh=`<div style="position:relative;width:${width}px;height:${height}px">`;
  rows.forEach((r,ri)=>{
    const y=ri*rowH;
    const isLine=r.staff==='line';
    gh+=`<div style="position:absolute;left:0;top:${y}px;width:${width}px;height:${rowH}px;background:${isLine?'rgba(85,170,255,.03)':'transparent'};border-bottom:1px solid #1a1a1e"></div>`;
  });
  for(let step=0;step<=totalSteps;step++){
    const x=step*cellW;
    gh+=`<div style="position:absolute;top:0;left:${x}px;width:${step%4===0?1.5:1}px;height:${height}px;background:${step%4===0?'rgba(85,170,255,.2)':'rgba(255,255,255,.05)'}"></div>`;
  }
  (clip.midiNotes||[]).forEach(n=>{
    const ri=rows.findIndex(r=>r.midi===n.midi); if(ri<0) return;
    const x=n.step*cellW+1, y=ri*rowH+1;
    const w=Math.max(cellW-2,(n.len||1)*cellW-2);
    const isCur=studioMidiStep===n.step;
    gh+=`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${rowH-2}px;background:#55aaff${isCur?'ff':'99'};border-radius:2px;cursor:pointer" data-step="${n.step}" data-midi="${n.midi}"></div>`;
  });
  rows.forEach((r,ri)=>{
    const y=ri*rowH;
    gh+=`<div class="stu-midi-cell" data-midi="${r.midi}" style="position:absolute;left:0;top:${y}px;width:${width}px;height:${rowH}px;cursor:crosshair;z-index:2"></div>`;
  });
  gh+='</div>';
  grid.innerHTML=gh;
  grid.style.minWidth=width+'px';

  const stepPx=studioMidiStep*cellW;
  const ph=document.getElementById('stu-midi-grid-playhead');
  if(ph){ph.style.left=stepPx+'px';ph.style.height=height+'px';}
  if(wrap&&stepPx>wrap.scrollLeft+wrap.clientWidth-60) wrap.scrollLeft=Math.max(0,stepPx-120);

  grid.querySelectorAll('.stu-midi-cell').forEach(cell=>{
    cell.onclick=e=>{
      e.stopPropagation();
      const rect=cell.getBoundingClientRect();
      const step=Math.max(0,Math.min(totalSteps-1,Math.floor((e.clientX-rect.left)/cellW)));
      studioMidiStep=step;
      const midi=parseInt(cell.dataset.midi);
      const idx=(clip.midiNotes||[]).findIndex(n=>n.step===step&&n.midi===midi);
      if(idx>=0){clip.midiNotes.splice(idx,1);}
      else{clip.midiNotes.push({step,midi,len:Math.max(1,studioMidiNoteLength||1),vel:0.8});playStudioMidiNote(midi,0.25,0.14);}
      clip.midiNotes.sort((a,b)=>a.step-b.step||a.midi-b.midi);
      renderStudio(); renderStudioMidiPanel();
    };
  });

  renderStudioMidiInputSurface();
  renderStudioChordTools('stu-midi-chord-tools','midi');
}

// ── Notation helpers ─────────────────────────────────────────────────
function getStudioNotationRows() {
  return [
    {midi:81,label:'A5',staff:'space'},{midi:79,label:'G5',staff:'space'},{midi:77,label:'F5',staff:'line'},
    {midi:76,label:'E5',staff:'space'},{midi:74,label:'D5',staff:'line'},{midi:72,label:'C5',staff:'space'},
    {midi:71,label:'B4',staff:'line'},{midi:69,label:'A4',staff:'space'},{midi:67,label:'G4',staff:'line'},
    {midi:65,label:'F4',staff:'space'},{midi:64,label:'E4',staff:'line'},{midi:62,label:'D4',staff:'space'},{midi:60,label:'C4',staff:'line'}
  ];
}
function getNotationKeySignature(key) {
  const map={'C':{type:'none',count:0},'G':{type:'sharp',count:1},'D':{type:'sharp',count:2},'A':{type:'sharp',count:3},'E':{type:'sharp',count:4},'B':{type:'sharp',count:5},'F#':{type:'sharp',count:6},'C#':{type:'sharp',count:7},'F':{type:'flat',count:1},'Bb':{type:'flat',count:2},'Eb':{type:'flat',count:3},'Ab':{type:'flat',count:4},'Db':{type:'flat',count:5}};
  return map[key]||map['C'];
}
function getNotationRowCenterY(rows,rowH,midi) { const idx=rows.findIndex(r=>r.midi===midi); return idx<0?null:(20+idx*rowH+rowH/2); }
function inferNotationBaseMidi(midi) { const rows=getStudioNotationRows(); let best=rows[0],bestDiff=999; rows.forEach(r=>{const d=Math.abs((r.midi||0)-midi);if(d<bestDiff){best=r;bestDiff=d;}}); return best.midi; }
function notationAccidentalDelta(mode) { if(mode==='sharp')return 1; if(mode==='flat')return -1; return 0; }
function getNotationDisplayInfo(note) {
  const base=(note&&note.staffBase!==undefined)?note.staffBase:inferNotationBaseMidi(note?.midi||60);
  const midi=Math.round(note?.midi||base), delta=midi-base;
  let accidental='';
  if(note&&note.accPref==='sharp') accidental='♯';
  else if(note&&note.accPref==='flat') accidental='♭';
  else if(note&&note.accPref==='natural') accidental='♮';
  else if(delta===1) accidental='♯';
  else if(delta===-1) accidental='♭';
  return {base,midi,delta,accidental};
}
function getNotationSelectionId(note) { return `${note.step}:${note.midi}:${note.staffBase!==undefined?note.staffBase:inferNotationBaseMidi(note.midi)}`; }
function setNotationSelectedNote(note) { studioNotationSelectedId=note?getNotationSelectionId(note):null; }
function getSelectedNotationNoteInfo() {
  const info=getSelectedStudioMidiClipInfo(); if(!info) return null;
  const clip=syncStudioMidiClip(info.clip);
  const note=(clip.midiNotes||[]).find(n=>getNotationSelectionId(n)===studioNotationSelectedId);
  if(!note) return null;
  return {info,clip,note};
}
function applyNotationEntrySettingsToSelectedNote() {
  const sel=getSelectedNotationNoteInfo(); if(!sel) return false;
  sel.note.len=Math.max(1,studioNotationNoteLength||4);
  sel.note.dot=!!studioNotationDotted;
  if(['sharp','flat','natural'].includes(studioNotationAccidentalMode)){
    sel.note.accPref=studioNotationAccidentalMode;
    const base=(sel.note.staffBase!==undefined)?sel.note.staffBase:inferNotationBaseMidi(sel.note.midi);
    sel.note.staffBase=base; sel.note.midi=base+notationAccidentalDelta(studioNotationAccidentalMode);
  }
  playStudioMidiNote(sel.note.midi,Math.max(0.18,sel.note.len*0.12),0.2);
  renderStudio(); renderStudioNotationPanel(); renderStudioMidiPanel();
  return true;
}
function toggleNotationCell(step, baseMidi) {
  const info=ensureStudioMidiClip(); if(!info) return;
  const clip=syncStudioMidiClip(info.clip);
  const acc=studioNotationAccidentalMode||'auto';
  const midi=baseMidi+notationAccidentalDelta(acc);
  const idx=clip.midiNotes.findIndex(n=>n.step===step&&(n.staffBase!==undefined?n.staffBase:inferNotationBaseMidi(n.midi))===baseMidi&&n.midi===midi);
  if(idx>=0){studioNotationSelectedId=getNotationSelectionId(clip.midiNotes[idx]);clip.midiNotes.splice(idx,1);studioNotationSelectedId=null;}
  else{const note={step,midi,len:Math.max(1,studioNotationNoteLength||4),vel:0.82,staffBase:baseMidi,accPref:acc,dot:!!studioNotationDotted};clip.midiNotes.push(note);studioNotationSelectedId=getNotationSelectionId(note);playStudioMidiNote(midi,Math.max(0.18,(note.dot?note.len*1.5:note.len)*0.12),0.18);}
  clip.midiNotes.sort((a,b)=>a.step-b.step||a.midi-b.midi);
  renderStudio(); renderStudioNotationPanel(); renderStudioMidiPanel();
}

function renderNotationClefSurface(surface, rows, rowH, height, keySig) {
  if(!surface) return;
  const lineMidis=[77,74,71,67,64];
  const sharpOrder=[77,72,79,74,69,76,71], flatOrder=[71,76,69,74,67,72,65];
  const g4Y=getNotationRowCenterY(rows,rowH,67)||0;
  let html=`<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.02) 18%)"></div>`;
  lineMidis.forEach(midi=>{const y=getNotationRowCenterY(rows,rowH,midi);if(y!=null)html+=`<div style="position:absolute;left:0;right:0;top:${y}px;height:1.6px;background:rgba(88,61,20,.72)"></div>`;});
  html+=`<svg style="position:absolute;left:6px;top:0;width:58px;height:${height}px;overflow:visible" viewBox="0 0 58 ${height}"><text x="3" y="${g4Y+34}" fill="#2f2410" font-size="124" font-family="'Times New Roman',Georgia,serif">𝄞</text></svg>`;
  const order=keySig.type==='sharp'?sharpOrder:flatOrder;
  const glyph=keySig.type==='sharp'?'♯':(keySig.type==='flat'?'♭':'');
  for(let i=0;i<(keySig.count||0);i++){
    const midi=order[i],y=getNotationRowCenterY(rows,rowH,midi);if(y==null)continue;
    const x=68+i*12,size=keySig.type==='sharp'?24:28;
    html+=`<div style="position:absolute;left:${x}px;top:${y-(keySig.type==='sharp'?18:21)}px;color:#3d2f10;font-size:${size}px;line-height:1;font-family:'Times New Roman',Georgia,serif">${glyph}</div>`;
  }
  surface.style.minHeight=height+'px'; surface.style.height=height+'px'; surface.innerHTML=html;
}

function renderStudioNotationPanel() {
  const panel=document.getElementById('studio-notation-panel'); if(!panel) return;
  panel.style.display=studioView==='notation'?'flex':'none';
  if(studioView!=='notation') return;

  const info=getSelectedStudioMidiClipInfo();
  const clip=info?syncStudioMidiClip(info.clip):null;
  if(clip&&clip.keySignature) studioNotationKey=clip.keySignature;
  const target=document.getElementById('stu-notation-target');
  if(target) target.textContent=info?(info.track.name+' · '+(clip.name||'Notation Clip')):'No notation clip selected';

  const wrap=document.getElementById('stu-notation-wrap');
  const grid=document.getElementById('stu-notation-grid');
  const clefSurface=document.getElementById('stu-notation-clef-surface');
  const selectedEl=document.getElementById('stu-notation-selected-note');
  const lenSel=document.getElementById('stu-notation-len');
  const barsSel=document.getElementById('stu-notation-bars');
  const keySel=document.getElementById('stu-notation-key');
  const dotCb=document.getElementById('stu-notation-dot');
  if(lenSel) lenSel.value=String(studioNotationNoteLength||4);
  if(barsSel) barsSel.value=String((clip&&clip.bars)||studioMidiBars||1);
  if(keySel) keySel.value=studioNotationKey||'C';
  if(dotCb) dotCb.checked=!!studioNotationDotted;

  const rows=getStudioNotationRows(), rowH=26, leftPad=34, cellW=34;
  const bars=Math.max(1,(clip&&clip.bars)||studioMidiBars||1);
  const totalSteps=(clip&&clip.stepsPerBar?clip.stepsPerBar:16)*bars;
  const width=Math.max((wrap?.clientWidth||600)-4,totalSteps*cellW+leftPad*2);
  const height=rows.length*rowH+40;
  const keySig=getNotationKeySignature(studioNotationKey||'C');
  renderNotationClefSurface(clefSurface,rows,rowH,height,keySig);

  const lineMidis=new Set([77,74,71,67,64]);
  let gh=`<div style="position:relative;width:${width}px;height:${height}px">`;
  rows.forEach((r,ri)=>{
    const y=20+ri*rowH+rowH/2;
    gh+=`<div style="position:absolute;left:0;top:${y}px;width:${width}px;height:${lineMidis.has(r.midi)?'1.6':'0.6'}px;background:${lineMidis.has(r.midi)?'rgba(88,61,20,.72)':'rgba(128,102,54,.14)'}"></div>`;
  });
  for(let step=0;step<=totalSteps;step++){
    const x=leftPad+step*cellW,isBar=step>0&&step%16===0,isQ=step>0&&step%4===0;
    gh+=`<div style="position:absolute;left:${x}px;top:0;width:${isBar?1.6:isQ?1:0.7}px;height:${height}px;background:${isBar?'rgba(102,71,17,.46)':isQ?'rgba(120,84,26,.20)':'rgba(120,84,26,.08)'}"></div>`;
    if(step<totalSteps&&step%16===0) gh+=`<div class="mono" style="position:absolute;left:${x+4}px;top:4px;color:rgba(104,83,43,.85);font-size:calc(8px*var(--ui))">${Math.floor(step/16)+1}</div>`;
  }
  rows.forEach((r,ri)=>{
    gh+=`<div class="stu-notation-cell" data-midi="${r.midi}" data-ri="${ri}" style="position:absolute;left:0;top:${20+ri*rowH}px;width:${width}px;height:${rowH}px;cursor:crosshair"></div>`;
  });
  const notes=(clip&&clip.midiNotes?clip.midiNotes:[]).slice().sort((a,b)=>a.step-b.step||a.midi-b.midi);
  notes.forEach(n=>{
    const di=getNotationDisplayInfo(n);
    const baseIdx=rows.findIndex(r=>r.midi===di.base); if(baseIdx<0) return;
    const x=leftPad+n.step*cellW+7, y=20+baseIdx*rowH+rowH/2;
    const noteW=Math.max(16,Math.min(26,(n.dot?n.len*1.5:n.len)*cellW-10));
    const filled=n.len<=4, stemUp=baseIdx>=7;
    const sel=getNotationSelectionId(n)===studioNotationSelectedId;
    const headFill=sel?'#856116':(filled?'#3b2f13':'#f7eed8');
    const headStroke=sel?'#f0d17a':'#2f2612';
    if(di.accidental) gh+=`<div style="position:absolute;left:${x-16}px;top:${y-14}px;color:${sel?'#6f4f10':'#4a3912'};font-size:calc(18px*var(--ui));line-height:1;font-family:serif">${di.accidental}</div>`;
    gh+=`<div class="stu-notation-note" data-note-id="${getNotationSelectionId(n)}" style="position:absolute;left:${x}px;top:${y-6}px;width:${noteW}px;height:12px;background:${headFill};border:1.6px solid ${headStroke};border-radius:999px;transform:rotate(-18deg);cursor:pointer;z-index:3"></div>`;
    if(n.len!==16){
      const stemX=stemUp?(x+noteW-2):(x+2),stemTop=stemUp?(y-34):(y-1);
      gh+=`<div style="position:absolute;left:${stemX}px;top:${stemTop}px;width:1.5px;height:34px;background:${headStroke};z-index:2"></div>`;
    }
    if(n.dot) gh+=`<div style="position:absolute;left:${x+noteW+5}px;top:${y-2}px;width:5px;height:5px;border-radius:50%;background:${headStroke};z-index:2"></div>`;
  });
  gh+='</div>';
  if(grid){grid.innerHTML=gh;grid.style.minWidth=width+'px';grid.style.height=height+'px';}

  const beatLabel=document.getElementById('stu-notation-step-label');
  if(beatLabel) beatLabel.textContent='Beat '+(Math.floor((studioMidiStep||0)/4)+1)+' · '+((studioMidiStep%4)+1);
  const ph=document.getElementById('stu-notation-grid-playhead');
  if(ph){ph.style.left=(leftPad+(studioMidiStep||0)*cellW)+'px';ph.style.height=height+'px';}

  if(grid){
    grid.querySelectorAll('.stu-notation-cell').forEach(cell=>{
      cell.onclick=e=>{
        e.stopPropagation();
        const rect=cell.getBoundingClientRect();
        const step=Math.max(0,Math.min(totalSteps-1,Math.floor((e.clientX-rect.left-leftPad)/cellW)));
        studioMidiStep=step;
        toggleNotationCell(step,parseInt(cell.dataset.midi||60));
      };
    });
    grid.querySelectorAll('.stu-notation-note').forEach(el2=>{
      el2.onclick=e=>{
        e.stopPropagation();
        studioNotationSelectedId=el2.dataset.noteId||null;
        const sel2=getSelectedNotationNoteInfo();
        if(sel2){studioNotationNoteLength=sel2.note.len||4;studioNotationDotted=!!sel2.note.dot;studioNotationAccidentalMode=sel2.note.accPref||'auto';}
        renderStudioNotationPanel();
      };
    });
  }

  document.querySelectorAll('.stu-notation-quick').forEach(b=>{
    const active=parseInt(b.dataset.len||4)===studioNotationNoteLength;
    b.style.background=active?'rgba(230,211,138,.18)':'#111';b.style.borderColor=active?'#e6d38a66':'#333';b.style.color=active?'#e6d38a':'#ccc';
  });
  document.querySelectorAll('.stu-notation-acc').forEach(b=>{
    const active=(b.dataset.acc||'auto')===studioNotationAccidentalMode;
    b.style.background=active?'rgba(230,211,138,.18)':'#111';b.style.borderColor=active?'#e6d38a66':'#333';b.style.color=active?'#e6d38a':'#ccc';
  });

  const sel3=getSelectedNotationNoteInfo();
  if(selectedEl){
    if(sel3){const no=midiToNoteOct(sel3.note.midi);const di=getNotationDisplayInfo(sel3.note);selectedEl.textContent=`${no.note}${no.octave}${di.accidental?' '+di.accidental:''} · ${sel3.note.len===16?'Whole':sel3.note.len===8?'Half':sel3.note.len===4?'Quarter':sel3.note.len===2?'Eighth':'16th'}${sel3.note.dot?' · dotted':''}`;}
    else selectedEl.textContent='No note selected';
  }
  renderStudioChordTools('stu-notation-chord-tools','notation');
}

// ── HTML template ────────────────────────────────────────────────────
// A function, not a const string: the transport's tempo block reads the LIVE
// master clock when it is built, so opening the studio after setting 96 BPM in
// the Metronome shows 96 rather than whatever the clock held at import time.
const studioHTML = () => `
<div id="studio-transport" style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:#111114;border-bottom:1px solid #1a1a1e;flex-wrap:wrap">
  <span class="mono" style="color:${STUDIO_ACCENT};font-size:calc(10px*var(--ui));font-weight:700;letter-spacing:1px">STUDIO</span>
  <div style="display:flex;gap:4px;margin-left:4px">
    <button id="stu-view-production" class="mono" style="background:${STUDIO_ACCENT}24;border:1px solid ${STUDIO_ACCENT}55;color:${STUDIO_ACCENT};border-radius:8px;padding:4px 10px;cursor:pointer;font-size:calc(8px*var(--ui));font-weight:700">PRODUCTION</button>
    <button id="stu-view-midi" class="mono" style="background:rgba(255,255,255,.04);border:1px solid #333;color:#666;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:calc(8px*var(--ui));font-weight:700">MIDI</button>
    <button id="stu-view-notation" class="mono" style="background:rgba(255,255,255,.04);border:1px solid #333;color:#666;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:calc(8px*var(--ui));font-weight:700">NOTATION</button>
  </div>
  <span style="width:1px;height:18px;background:#333;margin:0 2px"></span>
  <button id="stu-rw" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:26px;height:22px;cursor:pointer;font-size:calc(11px*var(--ui));padding:0">⏮</button>
  <!-- Armed and idle, ● is a control that STARTS something, so it wears the studio accent,
       not red: it only earns the stop red in the half of its life where pressing it ends
       the take. updateStudioTransport flips both the glyph and the colour. -->
  <button id="stu-rec" class="mono" style="background:${STUDIO_ACCENT}22;border:1px solid ${STUDIO_ACCENT}55;color:${STUDIO_ACCENT};border-radius:4px;width:26px;height:22px;cursor:pointer;font-size:calc(11px*var(--ui));padding:0">●</button>
  <button id="stu-play" class="mono" style="background:#1a1a1e;border:1px solid ${STUDIO_ACCENT}44;color:${STUDIO_ACCENT};border-radius:4px;width:26px;height:22px;cursor:pointer;font-size:calc(11px*var(--ui));padding:0">▶</button>
  <!-- The one control here that ALWAYS halts — it ends playback, and ends the take when
       one is rolling. Rewind and fast-forward just move the playhead, so they keep the
       grey; this one takes the app-wide stop red, the row's single meaning for "halts". -->
  <button id="stu-stop" class="mono" style="background:var(--rk-stop-soft);border:1px solid var(--rk-stop-edge);color:var(--rk-stop);border-radius:4px;width:26px;height:22px;cursor:pointer;font-size:calc(11px*var(--ui));padding:0">⏹</button>
  <button id="stu-ff" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:26px;height:22px;cursor:pointer;font-size:calc(11px*var(--ui));padding:0">⏭</button>
  <span style="width:1px;height:18px;background:#222;margin:0 2px"></span>
  <button id="stu-loop" class="mono" style="background:${STUDIO_ACCENT}22;border:1px solid #333;color:${STUDIO_ACCENT};border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(9px*var(--ui))">🔁</button>
  <button id="stu-click" class="mono" style="background:#1a1a1e;border:1px solid #333;color:#555;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(9px*var(--ui))">🎵</button>
  <button id="stu-dupclip" class="mono" style="background:#1a1a1e;border:1px solid #333;color:#555;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui));opacity:.55">⧉ Segment</button>
  <button id="stu-delclip" class="mono" style="background:#1a1a1e;border:1px solid #333;color:#555;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui));opacity:.55">− Segment</button>
  <span style="width:1px;height:18px;background:#222;margin:0 2px"></span>
  <button id="stu-mark" class="mono" title="Drop a named marker at the playhead" style="background:#1a1a1e;border:1px solid #e6d38a44;color:#e6d38a;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">⚑ Mark</button>
  <button id="stu-keep" class="mono" title="Save this take so it survives a reload, and cut a Songbook card to its shape" style="background:${STUDIO_ACCENT}22;border:1px solid ${STUDIO_ACCENT}55;color:${STUDIO_ACCENT};border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui));font-weight:700">⤓ Keep</button>
  <button id="stu-restore" class="mono" title="Bring back the last kept take" style="background:#1a1a1e;border:1px solid #333;color:#555;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">↺ Last</button>
  <span id="stu-msg" class="mono" style="color:${STUDIO_ACCENT};font-size:calc(9px*var(--ui));opacity:0;transition:opacity .3s;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
  <span style="width:1px;height:18px;background:#222;margin:0 2px"></span>
  <div class="rk" style="--rk-accent:${STUDIO_ACCENT};width:196px;flex:0 0 auto">${masterTempoBlock('studio', { min: 30, max: 280 })}</div>
  <span style="flex:1"></span>
  <span id="stu-pos" class="mono" style="color:${STUDIO_ACCENT};font-size:calc(11px*var(--ui));font-weight:700;min-width:60px;text-align:right">1.1.00</span>
  <span id="stu-time" class="mono" style="color:#555;font-size:calc(10px*var(--ui));min-width:36px;text-align:right">0:00</span>
</div>
<div id="studio-arrangement" style="display:flex;overflow:hidden;min-height:280px;max-height:45vh">
  <div id="studio-track-list" style="min-width:110px;max-width:110px;background:#0e0e11;border-right:1px solid #1a1a1e;overflow-y:auto;flex-shrink:0">
    <div style="height:22px;border-bottom:1px solid #1a1a1e;display:flex;align-items:center;padding:0 6px"><span class="mono" style="color:#555;font-size:calc(7px*var(--ui))">TRACKS</span></div>
    <div id="stu-track-labels"></div>
    <div style="padding:4px"><button id="stu-add" class="mono" style="background:none;border:1px dashed #333;color:#555;border-radius:4px;padding:4px;cursor:pointer;font-size:calc(8px*var(--ui));width:100%">+ Add</button></div>
  </div>
  <div id="studio-timeline" style="flex:1;overflow-x:auto;overflow-y:auto;position:relative;background:#0d0d10;cursor:pointer">
    <div id="stu-bar-ruler" style="height:22px;background:#111114;border-bottom:1px solid #1a1a1e;position:sticky;top:0;z-index:5;display:flex;min-width:100%"></div>
    <div id="stu-track-lanes" style="position:relative;min-width:100%"></div>
    <div id="stu-playhead" style="position:absolute;top:0;bottom:0;width:1px;background:${STUDIO_ACCENT};z-index:10;pointer-events:none;left:0"></div>
  </div>
</div>
<div id="studio-midi-panel" style="display:none;flex-direction:column;border-top:1px solid #1a1a1e;background:#0b0b10;min-height:260px;max-height:40vh">
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;background:#0f0f13;border-bottom:1px solid #1a1a1e">
    <span class="mono" style="color:#55aaff;font-size:calc(9px*var(--ui));font-weight:700;letter-spacing:1px">MIDI COMPOSER</span>
    <button id="stu-add-midi" class="mono" style="background:#1a1a1e;border:1px solid #55aaff44;color:#55aaff;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">+ MIDI Track</button>
    <button id="stu-midi-arm" class="mono" style="background:#1a1a1e;border:1px solid #77ddaa44;color:#77ddaa;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">Input On</button>
    <button id="stu-midi-step-dn" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:20px;height:22px;cursor:pointer;font-size:calc(10px*var(--ui));padding:0">−</button>
    <span id="stu-midi-step-label" class="mono" style="color:#55aaff;font-size:calc(10px*var(--ui));min-width:60px;text-align:center">Step 1</span>
    <button id="stu-midi-step-up" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:20px;height:22px;cursor:pointer;font-size:calc(10px*var(--ui));padding:0">+</button>
    <select id="stu-midi-len" class="mono" style="background:#0a0a0c;border:1px solid #333;color:#aaa;border-radius:4px;height:22px;font-size:calc(9px*var(--ui))"><option value="1">1/16</option><option value="2">1/8</option><option value="4">1/4</option></select>
    <select id="stu-midi-bars" class="mono" style="background:#0a0a0c;border:1px solid #333;color:#aaa;border-radius:4px;height:22px;font-size:calc(9px*var(--ui))"><option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option></select>
    <button id="stu-midi-clear" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">Clear</button>
    <span style="flex:1"></span>
    <span id="stu-midi-target" class="mono" style="color:#666;font-size:calc(8px*var(--ui))">No MIDI clip</span>
  </div>
  <div style="display:flex;flex:1;overflow:hidden">
    <div style="flex:1;display:flex;overflow:hidden">
      <div id="stu-midi-note-labels" style="width:56px;overflow:hidden;background:#101015;border-right:1px solid #1a1a1e;flex-shrink:0"></div>
      <div id="stu-midi-grid-wrap" style="position:relative;flex:1;overflow:auto;background:#0d0d11">
        <div id="stu-midi-grid" style="position:relative;min-width:100%"></div>
        <div id="stu-midi-grid-playhead" style="position:absolute;top:0;bottom:0;width:1px;background:#55aaff;pointer-events:none;left:0;z-index:4"></div>
      </div>
    </div>
    <div style="width:280px;flex-shrink:0;display:flex;flex-direction:column;background:#0f0f14;border-left:1px solid #1a1a1e;overflow:auto">
      <div style="padding:6px 8px;border-bottom:1px solid #1a1a1e"><div class="mono" style="color:#888;font-size:calc(7px*var(--ui));letter-spacing:1px">INPUT SURFACE</div></div>
      <div id="stu-midi-input-surface" style="flex:1;overflow:auto;padding:8px"></div>
      <div style="border-top:1px solid #1a1a1e;padding:6px 8px"><div class="mono" style="color:#8e83d8;font-size:calc(7px*var(--ui));letter-spacing:1px">CHORD DIRECTORY</div></div>
      <div id="stu-midi-chord-tools" style="padding:8px;overflow:auto"></div>
    </div>
  </div>
</div>
<div id="studio-notation-panel" style="display:none;flex-direction:column;border-top:1px solid #1a1a1e;background:#0a0a0d;min-height:300px;max-height:48vh">
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;background:#0f1015;border-bottom:1px solid #1a1a1e">
    <span class="mono" style="color:#e6d38a;font-size:calc(9px*var(--ui));font-weight:700;letter-spacing:1px">NOTATION</span>
    <button id="stu-add-notation" class="mono" style="background:#1a1a1e;border:1px solid #e6d38a44;color:#e6d38a;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">+ Notation Track</button>
    <button id="stu-notation-step-dn" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:20px;height:22px;cursor:pointer;font-size:calc(10px*var(--ui));padding:0">−</button>
    <span id="stu-notation-step-label" class="mono" style="color:#e6d38a;font-size:calc(10px*var(--ui));min-width:60px;text-align:center">Beat 1</span>
    <button id="stu-notation-step-up" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;width:20px;height:22px;cursor:pointer;font-size:calc(10px*var(--ui));padding:0">+</button>
    <select id="stu-notation-bars" class="mono" style="background:#0a0a0c;border:1px solid #333;color:#ddd3a0;border-radius:4px;height:22px;font-size:calc(9px*var(--ui))"><option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option></select>
    <button id="stu-notation-clear" class="mono" style="background:#1a1a1e;border:1px solid #2a2a2e;color:#666;border-radius:4px;height:22px;padding:0 8px;cursor:pointer;font-size:calc(8px*var(--ui))">Clear</button>
    <span style="flex:1"></span><span id="stu-notation-target" class="mono" style="color:#666;font-size:calc(8px*var(--ui))">No notation clip</span>
  </div>
  <div style="display:flex;flex:1;overflow:hidden">
    <div style="flex:1;display:flex;overflow:hidden;background:#16130f">
      <div id="stu-notation-clef" style="position:relative;width:148px;flex-shrink:0;background:linear-gradient(180deg,#f4ead0,#ebddbd);border-right:1px solid rgba(86,66,20,.22)">
        <div id="stu-notation-clef-surface" style="position:relative;width:100%;min-height:220px;padding:0 10px"></div>
      </div>
      <div id="stu-notation-wrap" style="position:relative;flex:1;overflow:auto;background:linear-gradient(180deg,#f8efd7,#eadab5)">
        <div id="stu-notation-grid" style="position:relative;min-width:100%"></div>
        <div id="stu-notation-grid-playhead" style="position:absolute;top:0;bottom:0;width:2px;background:rgba(196,142,51,.9);pointer-events:none;left:0;z-index:6"></div>
      </div>
    </div>
    <div style="width:260px;flex-shrink:0;display:flex;flex-direction:column;background:#101118;border-left:1px solid #1a1a1e;overflow:auto;padding:10px;gap:10px">
      <div>
        <div class="mono" style="color:#6e6752;font-size:calc(7px*var(--ui));margin-bottom:4px">Key</div>
        <select id="stu-notation-key" class="mono" style="width:100%;background:#0a0a0c;border:1px solid #333;color:#ddd3a0;border-radius:6px;height:26px;font-size:calc(9px*var(--ui))">
          <option>C</option><option>G</option><option>D</option><option>A</option><option>E</option><option>B</option><option>F#</option><option>C#</option><option>F</option><option>Bb</option><option>Eb</option><option>Ab</option><option>Db</option>
        </select>
      </div>
      <div>
        <div class="mono" style="color:#6e6752;font-size:calc(7px*var(--ui));margin-bottom:4px">Note value</div>
        <select id="stu-notation-len" class="mono" style="width:100%;background:#0a0a0c;border:1px solid #333;color:#ddd3a0;border-radius:6px;height:26px;font-size:calc(9px*var(--ui))">
          <option value="16">Whole</option><option value="8">Half</option><option value="4" selected>Quarter</option><option value="2">Eighth</option><option value="1">Sixteenth</option>
        </select>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          <button class="stu-notation-quick mono" data-len="16" style="padding:4px 6px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(7px*var(--ui))">Whole</button>
          <button class="stu-notation-quick mono" data-len="8" style="padding:4px 6px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(7px*var(--ui))">Half</button>
          <button class="stu-notation-quick mono" data-len="4" style="padding:4px 6px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(7px*var(--ui))">Quarter</button>
          <button class="stu-notation-quick mono" data-len="2" style="padding:4px 6px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(7px*var(--ui))">Eighth</button>
          <button class="stu-notation-quick mono" data-len="1" style="padding:4px 6px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(7px*var(--ui))">16th</button>
        </div>
      </div>
      <div>
        <div class="mono" style="color:#6e6752;font-size:calc(7px*var(--ui));margin-bottom:4px">Accidental</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
          <button class="stu-notation-acc mono" data-acc="auto" style="height:28px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(8px*var(--ui))">Auto</button>
          <button class="stu-notation-acc mono" data-acc="natural" style="height:28px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(12px*var(--ui))">♮</button>
          <button class="stu-notation-acc mono" data-acc="sharp" style="height:28px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(12px*var(--ui))">♯</button>
          <button class="stu-notation-acc mono" data-acc="flat" style="height:28px;border-radius:5px;border:1px solid #333;background:#111;color:#ccc;cursor:pointer;font-size:calc(12px*var(--ui))">♭</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <label class="mono" style="display:flex;align-items:center;gap:4px;color:#8c856e;font-size:calc(8px*var(--ui))"><input id="stu-notation-dot" type="checkbox" style="accent-color:#d8c58f"> dotted</label>
        <button id="stu-notation-delete-note" class="mono" style="margin-left:auto;height:26px;padding:0 8px;border-radius:5px;border:1px solid #443333;background:#171111;color:#d4a1a1;cursor:pointer;font-size:calc(8px*var(--ui))">Delete</button>
      </div>
      <div style="padding:6px 8px;border:1px solid #2b2617;border-radius:6px;background:#12120f">
        <div class="mono" style="color:#8f8364;font-size:calc(7px*var(--ui));letter-spacing:1px">SELECTED</div>
        <div id="stu-notation-selected-note" class="mono" style="margin-top:4px;color:#d8c58f;font-size:calc(9px*var(--ui));min-height:14px">No note selected</div>
      </div>
      <div style="padding:8px;border:1px solid #2b2617;border-radius:6px;background:#12120f">
        <div class="mono" style="color:#8f8364;font-size:calc(7px*var(--ui));letter-spacing:1px">CHORD TOOLS</div>
        <div id="stu-notation-chord-tools" style="margin-top:8px"></div>
      </div>
    </div>
  </div>
</div>
<div id="studio-board-area" style="position:relative;border-top:1px solid #1a1a1e;background:#0b0b0e;flex:1;min-height:360px;overflow:auto">
  <div style="position:sticky;top:0;z-index:15;display:flex;align-items:center;gap:6px;padding:4px 12px;background:#0e0e11;border-bottom:1px solid #1a1a1e">
    <span class="mono" style="color:#555;font-size:calc(8px*var(--ui))">STUDIO PEDALBOARD</span>
    <button id="stu-add-pedal" class="mono" style="background:none;border:1px dashed #444;color:#555;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:calc(8px*var(--ui))">+ Pedal</button>
    <span style="flex:1"></span>
    <button id="stu-zoom-out" class="mono" style="background:rgba(255,255,255,.06);border:1px solid #333;color:#aaa;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:calc(14px*var(--ui));padding:0">−</button>
    <span id="stu-zoom-label" class="mono" style="color:#666;font-size:calc(9px*var(--ui));min-width:32px;text-align:center">100%</span>
    <button id="stu-zoom-in" class="mono" style="background:rgba(255,255,255,.06);border:1px solid #333;color:#aaa;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:calc(14px*var(--ui));padding:0">+</button>
  </div>
  <div id="studio-pedals-container" style="position:relative;min-height:500px;min-width:100%;padding:16px;transform-origin:top left"></div>
</div>`;

// ── Wire events (called once) ────────────────────────────────────────
function wireStudioEvents() {
  const $ = id => document.getElementById(id);

  $('stu-view-production').onclick=()=>{studioView='production';updateStudioViewButtons();};
  $('stu-view-midi').onclick=()=>{studioView='midi';updateStudioViewButtons();renderStudioMidiPanel();};
  $('stu-view-notation').onclick=()=>{studioView='notation';updateStudioViewButtons();renderStudioNotationPanel();};

  $('stu-rw').onclick=()=>{studioPlayhead=Math.max(0,studioPlayhead-4*(60/(metroClock.bpm||120)));updatePlayhead();};
  $('stu-ff').onclick=()=>{studioPlayhead+=4*(60/(metroClock.bpm||120));updatePlayhead();};
  $('stu-play').onclick=()=>{if(!studioPlaying)studioStartPlayback();};
  $('stu-stop').onclick=()=>{if(studioRecording)studioStopRecording();else studioStopPlayback();};
  $('stu-rec').onclick=()=>{if(studioRecording)studioStopRecording();else studioStartRecording();};
  $('stu-mark').onclick=()=>studioMark();
  $('stu-keep').onclick=()=>keepStudioTake();
  $('stu-restore').onclick=()=>restoreStudioTake();
  $('stu-loop').onclick=()=>{studioLoopEnabled=!studioLoopEnabled;updateStudioTransport();};
  $('stu-click').onclick=()=>{studioClickEnabled=!studioClickEnabled;if(studioClickEnabled&&studioPlaying)studioStartClick();if(!studioClickEnabled)studioStopClick();updateStudioTransport();};
  $('stu-dupclip').onclick=()=>duplicateStudioClipAfterSelection();
  $('stu-delclip').onclick=()=>removeSelectedStudioClip();
  wireMasterTempo('studio');

  $('stu-add').onclick=()=>{
    if(studioView==='midi'){addStudioTrack('MIDI '+(studioTracks.filter(t=>t.kind==='midi').length+1),'#55aaff','midi');return;}
    if(studioView==='notation'){addStudioTrack('Notation '+(studioTracks.filter(t=>t.kind==='midi').length+1),'#e6d38a','midi');studioView='notation';updateStudioViewButtons();return;}
    const colors=['#ee7744','#44bbdd','#dd9944','#66aa55','#ee6688','#9977ee'];
    const names=['Guitar','Lead','Bass','Keys','Vocals','Track'];
    const idx=studioTracks.length%names.length;
    addStudioTrack(names[idx],colors[idx],'audio');
  };
  $('stu-add-midi').onclick=()=>addStudioTrack('MIDI '+(studioTracks.filter(t=>t.kind==='midi').length+1),'#55aaff','midi');
  $('stu-add-notation').onclick=()=>{addStudioTrack('Notation '+(studioTracks.filter(t=>t.kind==='midi').length+1),'#e6d38a','midi');studioView='notation';updateStudioViewButtons();};

  $('stu-midi-arm').onclick=()=>{studioMidiInputArmed=!studioMidiInputArmed;$('stu-midi-arm').textContent=studioMidiInputArmed?'Input On':'Input Off';$('stu-midi-arm').style.opacity=studioMidiInputArmed?'1':'0.55';};
  $('stu-midi-step-dn').onclick=()=>{const info=ensureStudioMidiClip();const max=((info?.clip?.stepsPerBar||16)*(info?.clip?.bars||1))-1;studioMidiStep=Math.max(0,Math.min(max,studioMidiStep-1));renderStudioMidiPanel();};
  $('stu-midi-step-up').onclick=()=>{const info=ensureStudioMidiClip();const max=((info?.clip?.stepsPerBar||16)*(info?.clip?.bars||1))-1;studioMidiStep=Math.max(0,Math.min(max,studioMidiStep+1));renderStudioMidiPanel();};
  $('stu-midi-len').onchange=function(){studioMidiNoteLength=Math.max(1,parseInt(this.value||1));};
  $('stu-midi-bars').onchange=function(){studioMidiBars=Math.max(1,parseInt(this.value||1));const info=getSelectedStudioMidiClipInfo();if(info){info.clip.bars=studioMidiBars;syncStudioMidiClip(info.clip);renderStudio();renderStudioMidiPanel();}};
  $('stu-midi-clear').onclick=()=>{const info=getSelectedStudioMidiClipInfo();if(info){info.clip.midiNotes=[];renderStudio();renderStudioMidiPanel();}};

  $('stu-notation-step-dn').onclick=()=>{const info=ensureStudioMidiClip();const max=((info?.clip?.stepsPerBar||16)*(info?.clip?.bars||1))-1;studioMidiStep=Math.max(0,Math.min(max,studioMidiStep-1));renderStudioNotationPanel();};
  $('stu-notation-step-up').onclick=()=>{const info=ensureStudioMidiClip();const max=((info?.clip?.stepsPerBar||16)*(info?.clip?.bars||1))-1;studioMidiStep=Math.max(0,Math.min(max,studioMidiStep+1));renderStudioNotationPanel();};
  $('stu-notation-bars').onchange=function(){studioMidiBars=Math.max(1,parseInt(this.value||1));const info=getSelectedStudioMidiClipInfo();if(info){info.clip.bars=studioMidiBars;syncStudioMidiClip(info.clip);renderStudio();renderStudioNotationPanel();}};
  $('stu-notation-clear').onclick=()=>{const info=getSelectedStudioMidiClipInfo();if(info){info.clip.midiNotes=[];studioNotationSelectedId=null;renderStudio();renderStudioNotationPanel();}};
  $('stu-notation-len').onchange=function(){studioNotationNoteLength=Math.max(1,parseInt(this.value||4));if(!applyNotationEntrySettingsToSelectedNote())renderStudioNotationPanel();};
  document.querySelectorAll('.stu-notation-quick').forEach(b=>b.onclick=()=>{studioNotationNoteLength=Math.max(1,parseInt(b.dataset.len||4));const s=$('stu-notation-len');if(s)s.value=String(studioNotationNoteLength);if(!applyNotationEntrySettingsToSelectedNote())renderStudioNotationPanel();});
  document.querySelectorAll('.stu-notation-acc').forEach(b=>b.onclick=()=>{studioNotationAccidentalMode=b.dataset.acc||'auto';if(!applyNotationEntrySettingsToSelectedNote())renderStudioNotationPanel();});
  $('stu-notation-dot').onchange=function(){studioNotationDotted=!!this.checked;if(!applyNotationEntrySettingsToSelectedNote())renderStudioNotationPanel();};
  $('stu-notation-delete-note').onclick=()=>{const sel=getSelectedNotationNoteInfo();if(!sel)return;const idx=sel.clip.midiNotes.indexOf(sel.note);if(idx>=0)sel.clip.midiNotes.splice(idx,1);studioNotationSelectedId=null;renderStudio();renderStudioNotationPanel();};
  $('stu-notation-key').onchange=function(){studioNotationKey=this.value||'C';const info=getSelectedStudioMidiClipInfo();if(info)info.clip.keySignature=studioNotationKey;renderStudioNotationPanel();};

  $('stu-zoom-out').onclick=()=>{stuZoom=Math.max(50,stuZoom-10);const ct=$('studio-pedals-container');if(ct)ct.style.transform=`scale(${stuZoom/100})`;$('stu-zoom-label').textContent=stuZoom+'%';};
  $('stu-zoom-in').onclick=()=>{stuZoom=Math.min(150,stuZoom+10);const ct=$('studio-pedals-container');if(ct)ct.style.transform=`scale(${stuZoom/100})`;$('stu-zoom-label').textContent=stuZoom+'%';};

  const addPedalBtn=$('stu-add-pedal');
  if(addPedalBtn) addPedalBtn.onclick=()=>showStudioCatalog();

  // Close studio catalog on backdrop click
  document.addEventListener('click', e=>{
    const popup=$('studio-catalog-popup');
    if(popup&&!popup.contains(e.target)&&e.target!==addPedalBtn) popup.remove();
  });

  // Timeline click → set playhead
  $('studio-timeline').onclick=e=>{
    if(e.target.closest('.stu-clip')) return;
    const ruler=$('stu-bar-ruler'); if(!ruler) return;
    const scrollLeft=$('studio-timeline').scrollLeft;
    const px=e.clientX-ruler.getBoundingClientRect().left+scrollLeft;
    studioPlayhead=Math.max(0,px/STUDIO_PX_PER_SEC);
    updatePlayhead();
  };

  // Clip drag (mousemove/mouseup on window)
  window.addEventListener('mousemove',e=>{
    if(!studioClipDragState) return;
    const st=studioClipDragState, tr=studioTracks[st.ti], clip=tr&&tr.clips[st.ci];
    if(!clip) return;
    const dxSec=(e.clientX-st.startX)/STUDIO_PX_PER_SEC;
    if(Math.abs(e.clientX-st.startX)>2) st.moved=true;
    if(st.mode==='move'){clip.startTime=Math.max(0,st.origStart+dxSec);}
    else if(st.mode==='trim-left'){normalizeClipTiming(clip);const maxTrim=Math.max(0,st.base-getClipTrimEnd(clip)-0.05);clip.trimStart=Math.min(maxTrim,Math.max(0,st.origTrim+dxSec));clip.startTime=Math.max(0,st.origStart+(clip.trimStart-st.origTrim));clip.duration=getEffectiveClipDuration(clip);}
    else if(st.mode==='trim-right'){normalizeClipTiming(clip);const maxTrim=Math.max(0,st.base-getClipTrimStart(clip)-0.05);clip.trimEnd=Math.min(maxTrim,Math.max(0,st.origTrim+(-dxSec)));clip.duration=getEffectiveClipDuration(clip);}
    renderStudio();
  });
  window.addEventListener('mouseup',()=>{if(studioClipDragState){studioClipDragState=null;renderStudio();}});

  // Spacebar
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!e.target.matches('input,textarea,select')){
      const sm=document.getElementById('studio-mode');
      if(sm&&sm.style.display!=='none'){e.preventDefault();if(studioPlaying)studioStopPlayback();else studioStartPlayback();}
    }
  });

  // metroClock sync
  metroClock.on(()=>updateStudioTransport());

  // Beat track upload from beat-maker
  window.addEventListener('resonote:beattrack',e=>{
    const {url,blob,name,duration}=e.detail;
    let tr=studioTracks.find(t=>t.isBeatTrack);
    if(!tr){tr={id:Date.now(),name:'Beat Track',color:'#9977ee',kind:'audio',clips:[],muted:false,solo:false,armed:false,vol:80,isBeatTrack:true};studioTracks.push(tr);}
    tr.clips.push({url,blob,name,startTime:studioPlayhead||0,duration,sourceDuration:duration,trimStart:0,trimEnd:0});
    renderStudio();
  });
}

// ── Public init ──────────────────────────────────────────────────────
// ── Visible feedback ─────────────────────────────────────────────────────────
// A deck key press has to leave a mark on screen or it is indistinguishable from
// a dead key. Two surfaces: the transport line when the Studio page is showing,
// a page-agnostic toast when it is not (the commands work from any page, because
// the arrangement lives in module memory, not in the DOM).
function fmtStudioTime(sec) { const m = Math.floor(sec / 60), s2 = Math.floor(sec % 60); return m + ':' + String(s2).padStart(2, '0'); }

function flashStudioMsg(text, color) {
  const c = color || STUDIO_ACCENT;
  const el = document.getElementById('stu-msg');
  if (el) {
    el.textContent = text; el.style.color = c; el.style.opacity = '1';
    clearTimeout(studioMsgTimer);
    studioMsgTimer = setTimeout(() => { el.style.opacity = '0'; }, 4000);
  }
  const sm = document.getElementById('studio-mode');
  if (sm && sm.style.display !== 'none' && sm.offsetParent !== null) return;  // transport line is visible; a toast would double it
  let t = document.getElementById('stu-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'stu-toast'; t.className = 'mono';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#111114;border:1px solid #2a2a2e;border-radius:8px;padding:8px 14px;font-size:calc(10px*var(--ui));box-shadow:0 6px 24px #0009;pointer-events:none;transition:opacity .3s;max-width:80vw';
    document.body.appendChild(t);
  }
  t.textContent = text; t.style.color = c; t.style.borderColor = c + '55'; t.style.opacity = '1';
  clearTimeout(studioToastTimer);
  studioToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}

function announceStudioState(last) {
  window.dispatchEvent(new CustomEvent('resonote:kept', { detail: {
    marks: studioMarkers.length,
    takes: (read(KEYS.takes, []) || []).length,
    last:  last || '',
  }}));
}

// ── Markers ──────────────────────────────────────────────────────────────────
// The ONLY thing in the Studio that can name a moment, and therefore the only
// honest source of a section name. Clip names are auto-minted ('Take 2'), so
// deriving sections from clips would invent a structure that reads as real.
export function studioMark(name) {
  const at = Math.max(0, studioPlayhead || 0);
  const m = { at, name: (name && String(name).trim()) || ('Mark ' + (studioMarkers.length + 1)) };
  studioMarkers.push(m);
  studioMarkers.sort((a, b) => a.at - b.at);
  renderStudio();
  flashStudioMsg('⚑ ' + m.name + ' @ ' + fmtStudioTime(at));
  announceStudioState('⚑ ' + m.name);
  return m;
}

export function clearStudioMarkers() { studioMarkers = []; renderStudio(); announceStudioState(''); }

// ── Take store ───────────────────────────────────────────────────────────────
// localStorage cannot hold a Blob and would not have room for a take if it could,
// so the audio goes to IndexedDB and the index row in localStorage points at it.
// The DB name is deliberately NOT 'rn-takes' so the two stores are never confused.
const TAKE_DB = 'rn-take-audio', TAKE_STORE = 'blobs';
function takeDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(TAKE_DB, 1);
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(TAKE_STORE)) db.createObjectStore(TAKE_STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror   = () => rej(rq.error);
  });
}
function takePut(key, blob) { return takeDB().then(db => new Promise((res, rej) => { const tx = db.transaction(TAKE_STORE, 'readwrite'); tx.objectStore(TAKE_STORE).put(blob, key); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); })); }
export function takeGetBlob(key) { return takeDB().then(db => new Promise((res, rej) => { const tx = db.transaction(TAKE_STORE, 'readonly'); const rq = tx.objectStore(TAKE_STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); })); }
function takeKeys() { return takeDB().then(db => new Promise((res, rej) => { const tx = db.transaction(TAKE_STORE, 'readonly'); const rq = tx.objectStore(TAKE_STORE).getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); })); }
function takeDel(key) { return takeDB().then(db => new Promise(res => { const tx = db.transaction(TAKE_STORE, 'readwrite'); tx.objectStore(TAKE_STORE).delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); })); }
async function pruneTakeBlobs(list) {
  try {
    const live = new Set();
    (list || []).forEach(r => (r.tracks || []).forEach(t => (t.clips || []).forEach(c => { if (c.blobKey) live.add(c.blobKey); })));
    for (const k of await takeKeys()) if (!live.has(k)) await takeDel(k);
  } catch (e) { /* private mode / no IDB */ }
}

// Two presses with nothing changed in between must not leave two rows. The
// fingerprint is what makes a repeat press an UPDATE and a real change an APPEND.
function studioArrangementSig() {
  const clips = studioTracks.map(t => (t.clips || []).map(c =>
    [c.name, (c.startTime || 0).toFixed(2), getEffectiveClipDuration(c).toFixed(2),
     c.type === 'midi' ? 'm' + (c.midiNotes || []).length : 'a'].join(':')).join('|')).join('||');
  return clips + '#' + studioMarkers.map(m => m.at.toFixed(2) + ':' + m.name).join('|');
}

// ── ⤓ KEEP ───────────────────────────────────────────────────────────────────
// Two artefacts from one press:
//   1. a take that survives a reload — the arrangement serialized to 'rn-takes',
//      the audio to IndexedDB. This is the actual unmet need.
//   2. a Songbook card sized to the take — right tempo, meter and bar count, with
//      markers as sections on real beats and steps that are RESTS.
// The card does NOT contain the notes and does not pretend to: there is no
// transcription in this app and no pitch-to-fret solver. It is a worksheet cut
// to the shape of what you just played, with the audio attached.
export async function keepStudioTake() {
  const clipCount = studioTracks.reduce((n, t) => n + (t.clips || []).length, 0);
  if (!clipCount) { flashStudioMsg('Nothing to keep — record or add a clip first', '#dd8844'); return { ok: false, msg: 'empty' }; }

  let bpm = metroClock.bpm || 120, ts = metroClock.ts || 4;
  for (const t of studioTracks) for (const c of (t.clips || [])) if (c.bpm) { bpm = c.bpm; ts = c.ts || ts; break; }
  const secPerBeat = 60 / bpm, secPerBar = secPerBeat * ts;

  let t0 = Infinity, tEnd = 0;
  studioTracks.forEach(t => (t.clips || []).forEach(c => {
    normalizeClipTiming(c);
    const st = c.startTime || 0;
    t0 = Math.min(t0, st);
    tEnd = Math.max(tEnd, st + getEffectiveClipDuration(c));
  }));
  if (!isFinite(t0)) t0 = 0;
  const lengthSec = Math.max(tEnd - t0, secPerBar);

  const sig  = studioArrangementSig();
  let   list = read(KEYS.takes, []) || [];
  if (!Array.isArray(list)) list = [];
  const prev = list.length ? list[list.length - 1] : null;
  const same = prev && prev.sig === sig;                 // unchanged since the last press
  const takeId  = same ? prev.id      : 'tk' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const pieceId = same ? prev.pieceId : null;

  const now   = new Date();
  const stamp = now.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ' ' +
                now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const cardName = same && prev.name ? prev.name : 'Studio — ' + stamp;

  const rowTracks = [];
  for (let ti = 0; ti < studioTracks.length; ti++) {
    const t = studioTracks[ti];
    const rt = { name: t.name, color: t.color, kind: t.kind, muted: !!t.muted, solo: !!t.solo, armed: !!t.armed, isBeatTrack: !!t.isBeatTrack, clips: [] };
    for (let ci = 0; ci < (t.clips || []).length; ci++) {
      const c = t.clips[ci];
      if (c.type === 'midi') {
        rt.clips.push({ type: 'midi', name: c.name, startTime: c.startTime || 0, bars: c.bars || 1,
                        stepsPerBar: c.stepsPerBar || 16, keySignature: c.keySignature,
                        midiNotes: JSON.parse(JSON.stringify(c.midiNotes || [])) });
        continue;
      }
      const blobKey = takeId + ':' + ti + ':' + ci;
      if (!same && c.blob) { try { await takePut(blobKey, c.blob); } catch (e) { /* quota / private */ } }
      rt.clips.push({ blobKey: c.blob ? blobKey : null, name: c.name, startTime: c.startTime || 0,
                      duration: c.duration, sourceDuration: c.sourceDuration,
                      trimStart: c.trimStart || 0, trimEnd: c.trimEnd || 0 });
    }
    rowTracks.push(rt);
  }

  const bars       = Math.max(1, Math.ceil(lengthSec / secPerBar));
  const totalSteps = bars * ts;
  const steps      = Array.from({ length: totalSteps }, () => ({ notes: [], dur: 1 }));  // dur:1 = ONE BEAT, so bar lines fall every `tsig` steps
  const seenAt = new Set();
  let sections = studioMarkers
    .map(m => ({ at: Math.max(0, Math.min(totalSteps - 1, Math.round((m.at - t0) / secPerBeat))), name: m.name }))
    .sort((a, b) => a.at - b.at)                     // MANDATORY: tab-mode.js does not sort, and derives each section's end from the next element
    .filter(x => (seenAt.has(x.at) ? false : (seenAt.add(x.at), true)));
  if (!sections.length) sections = [{ at: 0, name: cardName }];

  const ladder = { from: Math.max(30, Math.round(bpm * 0.7)), to: bpm, step: 4, everyBars: 4 };
  const trackLine = rowTracks.filter(t => t.clips.length)
    .map(t => t.name + ': ' + t.clips.map(c => c.name).join(', ')).join(' · ');
  const about = [
    `Kept from the Studio at ${bpm} BPM, ${ts}/bar — ${bars} bar${bars === 1 ? '' : 's'} (${fmtStudioTime(lengthSec)}).`,
    trackLine,
    studioMarkers.length ? `${studioMarkers.length} mark${studioMarkers.length === 1 ? '' : 's'}: ` + studioMarkers.map(m => m.name + ' @ ' + fmtStudioTime(m.at)).join(', ') : 'No marks dropped.',
    'The audio is saved with this card; the notes are not. Tap what you played onto the neck — the bars and the section marks are already the right size. The take itself comes back with ↺ Last in the Studio.',
    `Woodshed: ${ladder.from} → ${ladder.to} BPM, +${ladder.step} every ${ladder.everyBars} bars.`,
  ].filter(Boolean).join('\n');

  let entry = null;
  try {
    const sk = await import('../pedals/sketchpad.js');
    entry = sk.keepPieceToLib ? sk.keepPieceToLib({ id: pieceId || undefined, name: cardName, bpm, tsig: ts, about, sections, steps, ladder, takeId }) : null;
  } catch (e) { /* the take still persists even if the card doesn't */ }

  const row = { id: takeId, sig, at: now.toISOString(), name: cardName, bpm, ts,
                lengthSec, tracks: rowTracks, markers: studioMarkers.map(m => ({ at: m.at, name: m.name })),
                pieceId: entry ? entry.id : null };
  const at = list.findIndex(r => r && r.id === takeId);
  if (at >= 0) list[at] = row; else list.push(row);      // newest at the END — the house convention
  if (list.length > MAX_TAKES) list = list.slice(-MAX_TAKES);
  write(KEYS.takes, list);
  await pruneTakeBlobs(list);

  studioLastKeepSig = sig;
  const msg = (same ? '✓ Updated ' : '✓ Kept ') + cardName + ' — ' + bars + ' bars @ ' + bpm + ', ' + sections.length + ' section' + (sections.length === 1 ? '' : 's') + ' → 📖 Songbook';
  flashStudioMsg(msg);
  announceStudioState(msg);
  return { ok: true, fresh: !same, takeId, pieceId: row.pieceId, bars, sections: sections.length };
}

// ── ↺ Restore ────────────────────────────────────────────────────────────────
// Without this the persistence is write-only, which is the exact defect this
// feature exists to fix. Restoring REPLACES the timeline, so a blind key is
// refused whenever there is unkept work in front of it — that guard, not a
// dialog, is what makes it safe for a hardware button.
export async function restoreStudioTake(takeId) {
  const list = read(KEYS.takes, []) || [];
  const row  = takeId ? list.find(r => r && r.id === takeId) : list[list.length - 1];
  if (!row) { flashStudioMsg('No kept takes yet', '#dd8844'); return { ok: false }; }
  const hasWork = studioTracks.some(t => (t.clips || []).length);
  if (hasWork && studioArrangementSig() !== studioLastKeepSig) {
    flashStudioMsg('⤓ KEEP first — restoring would replace unkept work', '#dd8844');
    return { ok: false, msg: 'unkept' };
  }

  studioTracks.forEach(t => (t.clips || []).forEach(c => { if (c.url) { try { URL.revokeObjectURL(c.url); } catch (e) {} } }));
  const tracks = [];
  for (const t of (row.tracks || [])) {
    const tr = { id: Date.now() + Math.floor(Math.random() * 1000), name: t.name, color: t.color, kind: t.kind,
                 clips: [], muted: !!t.muted, solo: !!t.solo, armed: !!t.armed, vol: 80 };
    if (t.isBeatTrack) tr.isBeatTrack = true;
    for (const c of (t.clips || [])) {
      if (c.type === 'midi') {
        tr.clips.push(syncStudioMidiClip({ type: 'midi', name: c.name, startTime: c.startTime || 0,
          bars: c.bars || 1, stepsPerBar: c.stepsPerBar || 16, keySignature: c.keySignature,
          midiNotes: JSON.parse(JSON.stringify(c.midiNotes || [])) }));
        continue;
      }
      const blob = c.blobKey ? await takeGetBlob(c.blobKey).catch(() => null) : null;
      if (!blob) continue;                       // audio clips have no `type` field — never test type==='audio'
      tr.clips.push({ url: URL.createObjectURL(blob), blob, name: c.name, startTime: c.startTime || 0,
                      duration: c.duration, sourceDuration: c.sourceDuration,
                      trimStart: c.trimStart || 0, trimEnd: c.trimEnd || 0 });
    }
    tracks.push(tr);
  }
  studioTracks = tracks;
  studioSelectedClip = null;
  studioPlayhead = 0;
  studioMarkers = (row.markers || []).map(m => ({ at: m.at, name: m.name }));
  studioLastKeepSig = studioArrangementSig();
  metroClock.set(row.bpm || metroClock.bpm, row.ts || metroClock.ts);
  renderStudio(); renderStudioMidiPanel(); renderStudioNotationPanel(); updatePlayhead();
  flashStudioMsg('↺ Restored ' + row.name);
  return { ok: true, row };
}

// Return to the top of the arrangement.
//
// The transport has ⏮/⏭ but those NUDGE by one bar (see the stu-rw handler) --
// there was no jump-to-zero, which is the one move a record-then-review loop
// needs constantly. Same set-then-redraw pattern the rewind button uses.
export function studioToStart() {
  studioPlayhead = 0;
  updatePlayhead();
}

export function initStudio() {
  const el = document.getElementById('studio-mode');
  if (!el || el.dataset.initialized) return;
  el.dataset.initialized = '1';
  el.innerHTML = studioHTML();
  wireStudioEvents();
  updateStudioTransport();
  updateStudioViewButtons();
  renderStudio();
  renderStudioPedals();
  // Add a default track on first open
  if (!studioTracks.length) addStudioTrack('Guitar','#ee7744','audio');
}
