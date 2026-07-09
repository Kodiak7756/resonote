import { NOTES, SCALE_TYPES } from '../core/music-theory.js';
import { setChordHighlight, clearChordHighlight, pedalBus, metroClock } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { CURRICULUM } from '../curriculum/curriculum-data.js';
import { drillToPlan, playPlan } from '../curriculum/drill-runner.js';

const ARP_TYPES = {
  'Triads': { 'Major':[0,4,7],'Minor':[0,3,7],'Dim':[0,3,6],'Aug':[0,4,8],'Sus2':[0,2,7],'Sus4':[0,5,7] },
  '7ths':   { 'Maj7':[0,4,7,11],'Dom7':[0,4,7,10],'Min7':[0,3,7,10],'Dim7':[0,3,6,9],'m7♭5':[0,3,6,10],'mMaj7':[0,3,7,11] },
  'Other':  { '6':[0,4,7,9],'Min6':[0,3,7,9],'Aug7':[0,4,8,10] }
};

const PRACTICE_PRESETS = [
  { name:'Quick 15',     blocks:[{label:'Warm-up scales',   cat:'scales', mins:5, random:true},{label:'Chord changes',  cat:'chords',mins:5,random:true},{label:'Free play',cat:'free',mins:5}] },
  { name:'Technique 30', blocks:[{label:'Scales & modes',   cat:'scales', mins:10,random:true},{label:'Chord transitions',cat:'chords',mins:8,random:true},{label:'Arpeggios',cat:'arps',mins:7,random:true},{label:'Song practice',cat:'free',mins:5}] },
  { name:'Deep Focus 45',blocks:[{label:'Scale positions',  cat:'scales', mins:10,random:true},{label:'Chord voicings', cat:'chords',mins:10,random:true},{label:'Arpeggio patterns',cat:'arps',mins:10,random:true},{label:'Progression practice',cat:'chords',mins:10,random:true},{label:'Improvisation',cat:'free',mins:5}] }
];

function randomPracticeAssignment(cat) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rKey = pick(NOTES);
  if (cat === 'scales') {
    const [cn, scales] = pick(Object.entries(SCALE_TYPES));
    const sn = pick(Object.keys(scales));
    return { root:rKey, typeName:sn, typeCat:cn, label:`${rKey} ${sn}` };
  }
  if (cat === 'arps') {
    const [cn, arps] = pick(Object.entries(ARP_TYPES));
    const an = pick(Object.keys(arps));
    return { root:rKey, typeName:an, typeCat:cn, label:`${rKey} ${an} Arp` };
  }
  if (cat === 'chords') {
    const kt = pick(['Major','Minor']);
    return { root:rKey, typeName:kt, typeCat:'key', label:`Key of ${rKey} ${kt}` };
  }
  return { root:'C', typeName:'', typeCat:'', label:'' };
}

function applyBlockToFretboard(blk) {
  if (!blk || blk.cat === 'free') { clearChordHighlight(); updateOverlays(); return; }
  const r = blk.root || 'C', tn = blk.typeName || '', tc = blk.typeCat || '';

  if (blk.cat === 'scales' || blk.cat === 'arps') {
    if (pedalBus.rebuildPedal) {
      const settings = blk.cat === 'scales'
        ? { root:r, mode:'scales', scaleName:tn, scaleCat:tc, _autoStart:true }
        : { root:r, mode:'arps',   arpName:tn,   arpCat:tc,   _autoStart:true };
      pedalBus.rebuildPedal('runner', settings);
      return;
    }
  } else if (blk.cat === 'chords') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('progression', { root:r, keyType:tn||'Major', _autoStart:true });
      return;
    }
  } else if (blk.cat === 'rhythm') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('rhythm', { rhythmCat:tc, rhythmPat:tn, _autoStart:true });
    }
  } else if (blk.cat === 'finger') {
    if (pedalBus.rebuildPedal) {
      pedalBus.rebuildPedal('finger', { fingerInst:tc, fingerPat:tn, _autoStart:true });
    }
  }
}

function stopPracticePedals() {
  if (!pedalBus.rebuildPedal) return;
  // Signal each pedal type to stop via settings flag
  ['runner','progression','rhythm','finger'].forEach(type => {
    pedalBus.rebuildPedal(type, { _autoStart:false });
  });
}

export function buildPracticeContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let blocks      = s.blocks || PRACTICE_PRESETS[0].blocks.map(b => ({ ...b }));
  let presetName  = s.presetName || 'Quick 15';
  let pmView      = s.pmView || 'session';
  let activeBlock = -1, blockTime = 0, totalTime = 0, sessionActive = false, timerIntv = null;
  let editIdx     = null;

  let history = [];
  try { const raw = localStorage.getItem('resonote-practice-log'); if (raw) history = JSON.parse(raw); } catch(e) {}

  let practiceLib = [];
  try { const raw = localStorage.getItem('resonote-practice-lib'); if (raw) practiceLib = JSON.parse(raw); } catch(e) {}

  // ── Theory exercise library (curriculum drills looped on the fretboard) ──
  let theoryUnit    = s.theoryUnit ?? 0;     // which unit section is expanded
  let theoryBpm     = s.theoryBpm  || 80;
  let theoryPlaying = null;                    // { ui, li } of the looping exercise
  if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; }   // clear any orphan loop on rebuild
  function stopTheory() { if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; } theoryPlaying = null; clearChordHighlight(); updateOverlays(); }
  function theoryLessonAt(ui, li) { const u = CURRICULUM.units[ui]; if (!u) return null; return [...u.lessons].sort((a, b) => a.level - b.level)[li] || null; }
  function playTheory(ui, li) {
    if (p._theoryStop) { p._theoryStop(); p._theoryStop = null; }
    const lesson = theoryLessonAt(ui, li); if (!lesson || !lesson.drill) return;
    metroClock.stopAll();
    const plan = drillToPlan(lesson.drill, theoryBpm);
    if (!plan) return;
    theoryPlaying = { ui, li };
    p._theoryStop = playPlan(plan, { loop: true, isAlive: () => !!document.getElementById(`body-${p.id}`) });
  }

  function getStreak() {
    if (!history.length) return 0;
    let streak = 0;
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    let checkDate = new Date();
    const today = new Date().toDateString();
    if (sorted[0] && new Date(sorted[0].date).toDateString() === today) { streak = 1; checkDate.setDate(checkDate.getDate() - 1); }
    const start = sorted[0] && new Date(sorted[0].date).toDateString() === today ? 1 : 0;
    for (let i = start; i < sorted.length; i++) {
      if (new Date(sorted[i].date).toDateString() === checkDate.toDateString()) {
        streak++; checkDate.setDate(checkDate.getDate() - 1);
      } else break;
    }
    return streak;
  }

  function startSession() {
    stopTheory();
    sessionActive = true; activeBlock = 0; blockTime = 0; totalTime = 0; editIdx = null;
    blocks.forEach(b => {
      if (b.random && b.cat && b.cat !== 'free') {
        const a = randomPracticeAssignment(b.cat);
        b.root = a.root; b.typeName = a.typeName; b.typeCat = a.typeCat; b.assignment = a.label;
      } else if (b.cat !== 'free' && b.root && b.typeName) {
        if (b.cat === 'scales')      b.assignment = `${b.root} ${b.typeName}`;
        else if (b.cat === 'arps')   b.assignment = `${b.root} ${b.typeName} Arp`;
        else if (b.cat === 'chords') b.assignment = `Key of ${b.root} ${b.typeName}`;
      } else { b.assignment = ''; }
    });
    applyBlockToFretboard(blocks[0]);
    timerIntv = setInterval(() => {
      blockTime++; totalTime++;
      if (blockTime >= blocks[activeBlock].mins * 60) {
        if (activeBlock < blocks.length - 1) {
          activeBlock++; blockTime = 0;
          applyBlockToFretboard(blocks[activeBlock]);
        } else { finishSession(); return; }
      }
      render();
    }, 1000);
    render();
  }

  function finishSession() {
    clearInterval(timerIntv); timerIntv = null;
    const entry = { date: new Date().toISOString(), duration: totalTime, blocks: blocks.map(b => b.assignment || b.label), preset: presetName };
    history.push(entry);
    try { localStorage.setItem('resonote-practice-log', JSON.stringify(history.slice(-100))); } catch(e) {}
    sessionActive = false; activeBlock = -1; blockTime = 0;
    stopPracticePedals(); clearChordHighlight(); updateOverlays(); render();
  }

  function stopSession() {
    if (totalTime > 30) {
      const entry = { date: new Date().toISOString(), duration: totalTime, blocks: blocks.slice(0, activeBlock + 1).map(b => b.assignment || b.label), preset: presetName, partial: true };
      history.push(entry);
      try { localStorage.setItem('resonote-practice-log', JSON.stringify(history.slice(-100))); } catch(e) {}
    }
    clearInterval(timerIntv); timerIntv = null;
    sessionActive = false; activeBlock = -1; blockTime = 0; totalTime = 0;
    stopPracticePedals(); clearChordHighlight(); updateOverlays(); render();
  }

  function fmtTime(secs) {
    const m = Math.floor(secs / 60), ss = secs % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function render() {
    const streak    = getStreak();
    const totalMins = blocks.reduce((a, b) => a + b.mins, 0);
    const catIcons  = { scales:'🎼', chords:'🎵', arps:'🎶', rhythm:'🥁', finger:'🤚', ear:'👂', free:'🎸' };
    const catLabels = { scales:'Scale', chords:'Chords', arps:'Arpeggio', rhythm:'Rhythm', finger:'Finger', ear:'Ear', free:'Free Play' };
    const catLabels2 = { scales:'Scales', chords:'Chord changes', arps:'Arpeggios', rhythm:'Rhythm drills', finger:'Finger technique', ear:'Ear training', free:'Free play' };

    let h = `<div style="display:flex;flex-direction:column;gap:6px">`;
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:2px 0">`;
    h += `<span class="mono" style="color:#66aa55;font-size:20px;font-weight:900">${streak}</span>`;
    h += `<span class="mono" style="color:#558844;font-size:9px">day${streak!==1?'s':''} streak</span>`;
    if (streak >= 7) h += `<span style="font-size:14px">🔥</span>`;
    h += `</div>`;

    if (!sessionActive) {
      h += `<div style="display:flex;gap:3px">`;
      h += `<button class="chord-btn pm-view" data-pv="session" style="flex:1;font-size:8px;${pmView==='session'?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">Session</button>`;
      h += `<button class="chord-btn pm-view" data-pv="theory" style="flex:1;font-size:8px;${pmView==='theory'?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">🎓 Theory</button>`;
      h += `<button class="chord-btn pm-view" data-pv="library" style="flex:1;font-size:8px;${pmView==='library'?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">📋 Library (${practiceLib.length})</button>`;
      h += `</div>`;
    }

    if (pmView === 'theory' && !sessionActive) {
      h += `<div class="mono" style="color:#7a8a8a;font-size:8px;line-height:1.4;text-align:center;padding:1px 4px">Looping practice for every Theory Path drill — follow the gold note up the neck.</div>`;
      // Tempo control
      h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(102,170,85,.06);border:1px solid rgba(102,170,85,.12);border-radius:6px;padding:5px">`;
      h += `<span class="mono" style="color:#888;font-size:8px">TEMPO</span>`;
      h += `<button class="chord-btn th-bpm" data-d="-10" style="font-size:11px;padding:1px 8px;min-width:24px">−</button>`;
      h += `<span class="mono" style="color:#88cc66;font-size:13px;font-weight:800;min-width:54px;text-align:center">${theoryBpm} BPM</span>`;
      h += `<button class="chord-btn th-bpm" data-d="10" style="font-size:11px;padding:1px 8px;min-width:24px">+</button>`;
      if (theoryPlaying) h += `<button class="chord-btn th-stop" style="font-size:8px;color:#ff6666;border-color:#ff444433;margin-left:4px">■ Stop</button>`;
      h += `</div>`;
      // Units → drills (flex-shrink:0 keeps each unit its natural height so the list scrolls)
      h += `<div style="display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto;padding-right:2px">`;
      CURRICULUM.units.forEach((u, ui) => {
        const lessons = [...u.lessons].sort((a, b) => a.level - b.level);
        const drills  = lessons.filter(l => l.drill).length;
        const expanded = theoryUnit === ui;
        h += `<div style="border:1px solid rgba(102,170,85,.15);border-radius:6px;overflow:hidden;flex-shrink:0">`;
        h += `<div class="th-unit" data-ui="${ui}" style="display:flex;align-items:center;gap:6px;padding:7px 9px;cursor:pointer;background:rgba(102,170,85,.06)">
          <span style="font-size:12px">${u.icon || '🎓'}</span>
          <span class="mono" style="color:#aad08a;font-size:11px;font-weight:700;flex:1">${u.title}</span>
          <span class="mono" style="color:#667;font-size:8px">${drills} drill${drills!==1?'s':''}</span>
          <span class="mono" style="color:#66aa55;font-size:9px">${expanded ? '▾' : '▸'}</span></div>`;
        if (expanded) {
          h += `<div style="padding:4px 6px;display:flex;flex-direction:column;gap:3px">`;
          lessons.forEach((l, li) => {
            if (!l.drill) return;
            const isPlaying = theoryPlaying && theoryPlaying.ui === ui && theoryPlaying.li === li;
            h += `<div style="background:${isPlaying?'rgba(102,170,85,.14)':'rgba(255,255,255,.02)'};border:1px solid ${isPlaying?'#66aa55':'rgba(102,170,85,.1)'};border-radius:5px;padding:5px 7px;display:flex;align-items:center;gap:6px">
              <div style="flex:1;min-width:0">
                <div class="mono" style="color:#cfe0e0;font-size:10px;font-weight:600">${l.title}</div>
                <div class="mono" style="color:#7a8a8a;font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎯 ${l.drill.focus || l.drill.title}</div>
              </div>
              <button class="th-play mono" data-ui="${ui}" data-li="${li}" style="background:${isPlaying?'rgba(255,60,60,.15)':'rgba(102,170,85,.15)'};border:1px solid ${isPlaying?'#ff4444':'#66aa55'};color:${isPlaying?'#ff6666':'#88cc66'};border-radius:6px;padding:5px 11px;cursor:pointer;font-size:11px;font-weight:700">${isPlaying?'■':'▶'}</button>
            </div>`;
          });
          h += `</div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;

    } else if (pmView === 'library' && !sessionActive) {
      if (!practiceLib.length) {
        h += `<div class="mono" style="color:#444;font-size:9px;text-align:center;padding:16px">No saved practices yet. Save songs from the Song Directory.</div>`;
      } else {
        h += `<div style="display:flex;flex-direction:column;gap:3px;max-height:240px;overflow-y:auto">`;
        practiceLib.forEach((item, i) => {
          const d = item.date ? new Date(item.date) : null;
          const dateStr = d ? `${d.getMonth()+1}/${d.getDate()}` : '';
          h += `<div style="background:rgba(102,170,85,.06);border:1px solid rgba(102,170,85,.12);border-radius:5px;padding:6px 8px">`;
          h += `<div style="display:flex;align-items:center;gap:4px">`;
          h += `<span class="mono" style="color:#66aa55;font-size:10px;font-weight:700;flex:1">${item.title||'Untitled'}</span>`;
          if (item.key) h += `<span class="mono" style="color:#888;font-size:7px">${item.key}</span>`;
          h += `<span class="mono" style="color:#555;font-size:7px">${dateStr}</span></div>`;
          if (item.artist) h += `<div class="mono" style="color:#777;font-size:8px">${item.artist}</div>`;
          if (item.prog) h += `<div class="mono" style="color:#999;font-size:7px;margin-top:2px;word-spacing:3px">${item.prog.length>60?item.prog.slice(0,60)+'...':item.prog}</div>`;
          h += `<div style="display:flex;gap:2px;margin-top:3px">`;
          h += `<button class="chord-btn lib-load"   data-li="${i}" style="flex:1;font-size:7px;color:#ef9f27;border-color:#ef9f2733">🔁 Chords</button>`;
          h += `<button class="chord-btn lib-groove" data-li="${i}" style="flex:1;font-size:7px;color:#bb66dd;border-color:#bb66dd33">🥁 Groove</button>`;
          h += `<button class="chord-btn lib-finger" data-li="${i}" style="flex:1;font-size:7px;color:#dd9944;border-color:#dd994433">🤚 Finger</button>`;
          h += `<button class="chord-btn lib-del"    data-li="${i}" style="font-size:7px;color:#ff6666;border-color:#ff444433">✕</button>`;
          h += `</div></div>`;
        });
        h += `</div>`;
      }
      h += `<button class="chord-btn pm-save-session" style="font-size:8px;width:100%;color:#66aa55;border-color:rgba(102,170,85,.2);margin-top:4px">💾 Save Current Session</button>`;

    } else if (!sessionActive) {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap">`;
      PRACTICE_PRESETS.forEach(pr => {
        const act = presetName === pr.name;
        h += `<button class="chord-btn prac-pr ${act?'active':''}" data-pr="${pr.name}" style="font-size:8px;${act?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">${pr.name}</button>`;
      });
      h += `</div>`;

      h += `<div style="display:flex;flex-direction:column;gap:3px">`;
      blocks.forEach((b, i) => {
        const icon   = catIcons[b.cat] || '';
        const isEdit = editIdx === i;
        const specific  = !b.random && b.root && b.typeName;
        const specLabel = specific
          ? (b.cat === 'scales' ? `${b.root} ${b.typeName}` : b.cat === 'arps' ? `${b.root} ${b.typeName}` : b.cat === 'chords' ? `${b.root} ${b.typeName}` : '')
          : '';
        h += `<div class="prac-block" data-bi="${i}" style="background:${isEdit?'rgba(102,170,85,.12)':'rgba(102,170,85,.06)'};border:1px solid ${isEdit?'#66aa55':'rgba(102,170,85,.12)'};border-radius:5px;padding:5px 8px;cursor:pointer">`;
        h += `<div style="display:flex;align-items:center;gap:4px">`;
        h += `<span style="font-size:10px">${icon}</span>`;
        h += `<span class="mono" style="color:#aaa;font-size:10px;flex:1">${b.label}</span>`;
        if (specific) h += `<span class="mono" style="color:#ddb040;font-size:8px">${specLabel}</span>`;
        else if (b.cat !== 'free') h += `<span class="mono" style="color:#888;font-size:7px">🎲 random</span>`;
        h += `<span class="mono" style="color:#66aa55;font-size:10px;font-weight:700">${b.mins}m</span>`;
        h += `</div>`;
        if (isEdit) {
          h += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(102,170,85,.15)">`;
          h += `<div style="display:flex;gap:3px;margin-bottom:4px">`;
          ['scales','chords','arps','rhythm','finger','ear','free'].forEach(cat => {
            h += `<button class="chord-btn edit-cat" data-cat="${cat}" style="flex:1;font-size:7px;${b.cat===cat?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">${catLabels[cat]}</button>`;
          });
          h += `</div>`;
          h += `<div style="display:flex;gap:3px;align-items:center;margin-bottom:4px"><span class="mono" style="color:#888;font-size:7px">MINS</span>`;
          [3,5,8,10,15].forEach(m => {
            h += `<button class="chord-btn edit-mins" data-mins="${m}" style="font-size:7px;min-width:22px;${b.mins===m?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">${m}</button>`;
          });
          h += `</div>`;
          if (b.cat && b.cat !== 'free') {
            h += `<div style="display:flex;gap:3px;margin-bottom:4px">`;
            h += `<button class="chord-btn edit-rand" data-rand="1" style="flex:1;font-size:7px;${b.random?'background:rgba(255,208,96,.12);border-color:#ddb040;color:#ddb040':''}">🎲 Random</button>`;
            h += `<button class="chord-btn edit-rand" data-rand="0" style="flex:1;font-size:7px;${!b.random?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">Choose</button>`;
            h += `</div>`;
            if (!b.random) {
              h += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:3px">`;
              NOTES.forEach(n => {
                h += `<button class="chord-btn edit-root" data-r="${n}" style="font-size:7px;min-width:22px;padding:2px 4px;${(b.root||'C')===n?'background:rgba(102,170,85,.15);border-color:#66aa55;color:#66aa55':''}">${n}</button>`;
              });
              h += `</div>`;
              const types = b.cat === 'scales' ? SCALE_TYPES : b.cat === 'arps' ? ARP_TYPES : null;
              if (types) {
                h += `<div style="display:flex;flex-wrap:wrap;gap:2px">`;
                Object.entries(types).forEach(([cat2, items]) => {
                  Object.keys(items).forEach(name => {
                    const act = b.typeName === name && b.typeCat === cat2;
                    h += `<button class="chord-btn edit-type" data-tn="${name}" data-tc="${cat2}" style="font-size:6px;padding:2px 4px;${act?'background:rgba(102,170,85,.12);border-color:#66aa55;color:#66aa55':''}">${name}</button>`;
                  });
                });
                h += `</div>`;
              } else if (b.cat === 'chords') {
                h += `<div style="display:flex;gap:3px">`;
                ['Major','Minor','Dorian'].forEach(kt => {
                  h += `<button class="chord-btn edit-type" data-tn="${kt}" data-tc="key" style="flex:1;font-size:7px;${b.typeName===kt?'background:rgba(102,170,85,.12);border-color:#66aa55;color:#66aa55':''}">${kt}</button>`;
                });
                h += `</div>`;
              }
            }
          }
          h += `<div style="display:flex;gap:3px;margin-top:4px">`;
          if (i > 0)              h += `<button class="chord-btn edit-move" data-dir="-1" style="font-size:8px;padding:2px 6px">▲</button>`;
          if (i < blocks.length - 1) h += `<button class="chord-btn edit-move" data-dir="1" style="font-size:8px;padding:2px 6px">▼</button>`;
          h += `<button class="chord-btn edit-remove" style="font-size:7px;color:#ff6666;margin-left:auto">✕ Remove</button>`;
          h += `</div></div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;
      h += `<button class="chord-btn prac-add" style="font-size:8px;width:100%;color:#66aa55;border-color:rgba(102,170,85,.2)">+ Add block</button>`;
      h += `<div class="mono" style="color:#555;font-size:8px;text-align:center">Total: ${totalMins} min · Tap a block to customize</div>`;
      h += `<button class="prac-start mono" style="background:rgba(102,170,85,.15);border:1px solid #66aa55;color:#66aa55;border-radius:8px;padding:8px 20px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:1px;width:100%">▶ START SESSION</button>`;

    } else {
      const blk = blocks[activeBlock];
      const blockSecs = blk.mins * 60;
      const remaining = blockSecs - blockTime;
      const pct = Math.min(100, (blockTime / blockSecs) * 100);
      h += `<div style="background:#222;border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#66aa55;border-radius:6px;transition:width 1s linear"></div></div>`;
      h += `<div style="text-align:center;padding:6px 0">`;
      h += `<div class="mono" style="color:#66aa55;font-size:8px;letter-spacing:1px">BLOCK ${activeBlock+1} OF ${blocks.length}</div>`;
      h += `<div class="mono" style="color:#88cc66;font-size:16px;font-weight:800;margin:4px 0">${blk.label}</div>`;
      if (blk.assignment) {
        h += `<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin:2px 0">`;
        h += `<span class="mono" style="color:#ffd060;font-size:13px;font-weight:700">${blk.assignment}</span>`;
        if (blk.random) h += `<button class="prac-reroll mono" style="background:rgba(255,208,96,.1);border:1px solid rgba(255,208,96,.3);color:#ffd060;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:8px;font-weight:700">🎲</button>`;
        h += `</div>`;
      }
      h += `<div class="mono" style="color:#66aa55;font-size:28px;font-weight:900">${fmtTime(remaining)}</div>`;
      h += `<div class="mono" style="color:#555;font-size:9px">Session: ${fmtTime(totalTime)}</div>`;
      h += `</div>`;
      h += `<div style="display:flex;flex-direction:column;gap:2px">`;
      blocks.forEach((b, i) => {
        const done = i < activeBlock, current = i === activeBlock;
        const bg    = done ? 'rgba(102,170,85,.15)' : current ? 'rgba(102,170,85,.1)' : 'rgba(255,255,255,.02)';
        const color = done ? '#66aa55' : current ? '#88cc66' : '#555';
        h += `<div style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:${bg}">`;
        h += `<span class="mono" style="color:${color};font-size:8px;font-weight:700">${done?'✓ ':''}${b.label}</span>`;
        if (b.assignment) h += `<span class="mono" style="color:${done?'#88aa66':current?'#ddb040':'#555'};font-size:7px;margin-left:4px">${b.assignment}</span>`;
        h += `<span class="mono" style="color:${color};font-size:8px;margin-left:auto">${b.mins}m</span>`;
        h += `</div>`;
      });
      h += `</div>`;
      h += `<button class="prac-stop mono" style="background:rgba(255,60,60,.15);border:1px solid #ff4444;color:#ff6666;border-radius:8px;padding:6px 20px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;width:100%">■ END SESSION</button>`;
    }

    if (history.length && !sessionActive && pmView !== 'theory') {
      h += `<div class="mono" style="color:#555;font-size:7px;letter-spacing:1px;text-transform:uppercase;margin-top:4px">Recent</div>`;
      history.slice(-3).reverse().forEach(entry => {
        const d = new Date(entry.date);
        const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
        const mins = Math.round(entry.duration / 60);
        h += `<div style="display:flex;align-items:center;gap:4px;padding:1px 0">`;
        h += `<span class="mono" style="color:#555;font-size:7px">${dateStr}</span>`;
        h += `<span class="mono" style="color:#888;font-size:7px;flex:1">${entry.preset||''}${entry.partial?' · partial':''}</span>`;
        h += `<span class="mono" style="color:#66aa55;font-size:7px;font-weight:700">${mins}m</span>`;
        h += `</div>`;
      });
    }
    h += `</div>`;
    el.innerHTML = h;

    // Wire
    el.querySelectorAll('.prac-pr').forEach(b => b.onclick = e => {
      e.stopPropagation(); presetName = b.dataset.pr;
      const pr = PRACTICE_PRESETS.find(x => x.name === presetName);
      if (pr) blocks = pr.blocks.map(b2 => ({ ...b2 }));
      editIdx = null; render();
    });
    el.querySelectorAll('.prac-block').forEach(b => b.onclick = e => {
      if (e.target.closest('.chord-btn')) return;
      e.stopPropagation(); const bi = parseInt(b.dataset.bi);
      editIdx = editIdx === bi ? null : bi; render();
    });
    el.querySelectorAll('.edit-cat').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      blocks[editIdx].cat = b.dataset.cat; blocks[editIdx].label = catLabels2[b.dataset.cat] || 'Block';
      if (b.dataset.cat === 'free') { blocks[editIdx].random = false; blocks[editIdx].root = ''; blocks[editIdx].typeName = ''; }
      else if (!blocks[editIdx].root) blocks[editIdx].random = true;
      render();
    });
    el.querySelectorAll('.edit-mins').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].mins = parseInt(b.dataset.mins); render(); });
    el.querySelectorAll('.edit-rand').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      const isRand = b.dataset.rand === '1';
      blocks[editIdx].random = isRand;
      if (!isRand && !blocks[editIdx].root) blocks[editIdx].root = 'C';
      render();
    });
    el.querySelectorAll('.edit-root').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].root = b.dataset.r; render(); });
    el.querySelectorAll('.edit-type').forEach(b => b.onclick = e => { e.stopPropagation(); if (editIdx === null) return; blocks[editIdx].typeName = b.dataset.tn; blocks[editIdx].typeCat = b.dataset.tc; render(); });
    el.querySelectorAll('.edit-move').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (editIdx === null) return;
      const dir = parseInt(b.dataset.dir), ni = editIdx + dir;
      if (ni >= 0 && ni < blocks.length) { const tmp = blocks[editIdx]; blocks[editIdx] = blocks[ni]; blocks[ni] = tmp; editIdx = ni; }
      render();
    });
    el.querySelector('.edit-remove')?.addEventListener('click', e => {
      e.stopPropagation(); if (editIdx !== null && blocks.length > 1) { blocks.splice(editIdx, 1); editIdx = null; render(); }
    });
    el.querySelector('.prac-add')?.addEventListener('click',  e => { e.stopPropagation(); blocks.push({ label:'Scales', cat:'scales', mins:5, random:true }); editIdx = blocks.length - 1; render(); });
    el.querySelector('.prac-start')?.addEventListener('click', e => { e.stopPropagation(); startSession(); });
    el.querySelector('.prac-stop') ?.addEventListener('click', e => { e.stopPropagation(); stopSession();  });
    el.querySelector('.prac-reroll')?.addEventListener('click', e => {
      e.stopPropagation();
      const blk2 = blocks[activeBlock];
      if (blk2 && blk2.random && blk2.cat && blk2.cat !== 'free') {
        const a = randomPracticeAssignment(blk2.cat);
        blk2.root = a.root; blk2.typeName = a.typeName; blk2.typeCat = a.typeCat; blk2.assignment = a.label;
        applyBlockToFretboard(blk2); render();
      }
    });
    el.querySelectorAll('.pm-view').forEach(b => b.onclick = e => { e.stopPropagation(); if (pmView === 'theory' && b.dataset.pv !== 'theory') stopTheory(); pmView = b.dataset.pv; render(); });

    // Theory library
    el.querySelectorAll('.th-unit').forEach(b => b.onclick = e => { e.stopPropagation(); const ui = parseInt(b.dataset.ui); theoryUnit = theoryUnit === ui ? -1 : ui; render(); });
    el.querySelectorAll('.th-play').forEach(b => b.onclick = e => {
      e.stopPropagation(); const ui = parseInt(b.dataset.ui), li = parseInt(b.dataset.li);
      if (theoryPlaying && theoryPlaying.ui === ui && theoryPlaying.li === li) stopTheory();
      else playTheory(ui, li);
      render();
    });
    el.querySelectorAll('.th-bpm').forEach(b => b.onclick = e => {
      e.stopPropagation(); theoryBpm = Math.max(40, Math.min(200, theoryBpm + parseInt(b.dataset.d)));
      if (theoryPlaying) playTheory(theoryPlaying.ui, theoryPlaying.li);   // restart at the new tempo
      render();
    });
    el.querySelector('.th-stop')?.addEventListener('click', e => { e.stopPropagation(); stopTheory(); render(); });

    el.querySelectorAll('.lib-load').forEach(b => b.onclick = e => {
      e.stopPropagation(); const item = practiceLib[parseInt(b.dataset.li)]; if (!item || !item.prog) return;
      const chords2 = item.prog.split(/\s+/).filter(x => x);
      const bars = Math.max(4, Math.ceil(chords2.length / 4) * 4);
      const grid = new Array(bars * 4).fill(null);
      const qMap = { '':'Major','m':'Minor','7':'Major','m7':'Minor','maj7':'Major','dim':'Dim','aug':'Aug' };
      chords2.forEach((ch, ci) => {
        if (ci < grid.length) {
          let rn = ch.length>1 && (ch[1]==='#'||ch[1]==='b') ? ch.slice(0,2) : ch[0];
          grid[ci * Math.floor(bars*4/chords2.length)] = { root: rn, quality: qMap[ch.slice(rn.length).toLowerCase()]||'Major', numeral:ch };
        }
      });
      if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('progression', { progMode:'custom', gridBars:bars, customGrid:grid, _autoStart:true });
    });
    el.querySelectorAll('.lib-groove').forEach(b => b.onclick = e => {
      e.stopPropagation(); const item = practiceLib[parseInt(b.dataset.li)]; if (!item) return;
      if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('rhythm', { rhyChordMode:'per-step', _autoStart:true });
    });
    el.querySelectorAll('.lib-finger').forEach(b => b.onclick = e => {
      e.stopPropagation(); const item = practiceLib[parseInt(b.dataset.li)]; if (!item) return;
      const fc = item.prog ? item.prog.split(/\s+/)[0] : 'Am';
      if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('finger', { fChordRoot:fc, fChordMode:'chord', _autoStart:true });
    });
    el.querySelectorAll('.lib-del').forEach(b => b.onclick = e => {
      e.stopPropagation(); practiceLib.splice(parseInt(b.dataset.li), 1);
      try { localStorage.setItem('resonote-practice-lib', JSON.stringify(practiceLib)); } catch(e2) {}
      render();
    });
    el.querySelector('.pm-save-session')?.addEventListener('click', e => {
      e.stopPropagation();
      const name = prompt('Name this practice:');
      if (name) {
        practiceLib.push({ title:name, prog:'', date:new Date().toISOString(), blocks:blocks.map(b => ({ label:b.label, cat:b.cat, mins:b.mins })) });
        try { localStorage.setItem('resonote-practice-lib', JSON.stringify(practiceLib.slice(-50))); } catch(e2) {}
        e.target.textContent = '✓ Saved!'; e.target.style.color = '#00ff88';
        setTimeout(() => render(), 1000);
      }
    });

    if (!sessionActive) Object.assign(s, { blocks: blocks.map(b => ({ label:b.label, cat:b.cat, mins:b.mins, random:!!b.random, root:b.root||'', typeName:b.typeName||'', typeCat:b.typeCat||'' })), presetName, pmView, theoryUnit, theoryBpm });
  }

  render();

  // Deep-link from a Theory Path lesson → open the Theory library at that drill and loop it.
  if (s._theoryOpenLesson) {
    const lid = s._theoryOpenLesson; delete s._theoryOpenLesson;
    let found = null;
    CURRICULUM.units.forEach((u, ui) => [...u.lessons].sort((a, b) => a.level - b.level).forEach((l, li) => { if (l.id === lid) found = { ui, li }; }));
    if (found) { pmView = 'theory'; theoryUnit = found.ui; render(); playTheory(found.ui, found.li); render(); }
  }
}
