import { NOTES, KEY_PATTERNS, getKeyChords, getChordNotes, CHORD_TYPES, intervalLabel, toSharp } from '../core/music-theory.js';
import { showIntervals, setChordHighlight, clearChordHighlight, pedalBus } from '../core/state.js';
import { updateOverlays } from '../ui/fretboard.js';
import { getSecondaryDominants, getBorrowedChords, getKeySeventhChords, catOfType, qualSuffix } from '../harmony/functional-harmony.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const CIRCLE_KEYS  = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'];
const CIRCLE_MINOR = ['Am','Em','Bm','F#m','C#m','G#m','Ebm','Bbm','Fm','Cm','Gm','Dm'];

const CIRCLE_THEORY = {
  kicker: 'HARMONY', title: 'The Circle of Fifths — your map of keys',
  what: `Each step clockwise adds a sharp and moves up a <b>fifth</b>; counter-clockwise adds a flat. Neighbours on the circle share almost all their notes, so they sound closely related. The inner ring is each major key's <b>relative minor</b> — same notes, different home.`,
  why: `It's the master map for harmony: chords close together on the circle move smoothly, the chord a fifth away (the <b>V</b>) pulls strongly home, and you can <b>modulate</b> to a neighbour without a jolt. The Harmony view turns any key into its diatonic chords, secondary dominants and borrowed colours — tap one to light it on the neck and send it onward.`,
  lessonId: 'circle-of-fifths',
};

export function buildCircle5Content(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let selKey      = s.selKey !== undefined ? s.selKey : 0;
  let selMinor    = !!s.selMinor;
  let selChordIdx = null;
  let c5View      = s.c5View || 'chords';
  let harm7       = !!s.harm7;          // diatonic 7ths toggle in Harmony view
  let selHarm     = null;               // { kind:'dia'|'sec'|'bor', idx }
  let harmLists   = { dia: [], sec: [], bor: [] };

  function findCircleIndex(root) {
    const sharp = toSharp(root || '');          // equate enharmonics: Eb ≡ D#, Bb ≡ A#, …
    return CIRCLE_KEYS.findIndex(k => toSharp(k) === sharp);
  }

  pedalBus.on(ev => {
    if (!ev.root || ev.source === p.id || !document.getElementById(`body-${p.id}`)) return;
    const idx = findCircleIndex(ev.root);
    if (idx < 0) return;
    selKey = idx;
    selMinor = ev.keyType === 'Minor' || ev.keyType === 'Harm. Minor';
    selChordIdx = null;
    applyC5Highlight(false);
    render();
  });

  function getKeyInfo() {
    if (selKey === null) return null;
    const rawRoot  = selMinor ? CIRCLE_MINOR[selKey].replace('m', '') : CIRCLE_KEYS[selKey];
    const keyType  = selMinor ? 'Minor' : 'Major';
    // rawRoot keeps the circle's flat spelling (Eb, Bb…) for display; keyRoot is the
    // canonical sharp pitch every other pedal speaks (Eb → D#). toSharp equates them.
    return { keyRoot: toSharp(rawRoot), keyType, displayRoot: rawRoot };
  }

  function applyC5Highlight(broadcast = true) {
    if (selKey === null) { clearChordHighlight(); pedalBus.clear(); updateOverlays(); return; }
    const ki = getKeyInfo();
    if (broadcast) pedalBus.setKey(ki.keyRoot, ki.keyType, { source: p.id });
    const pat = KEY_PATTERNS[ki.keyType];
    if (!pat) { clearChordHighlight(); updateOverlays(); return; }
    const allNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(ki.keyRoot) + i) % 12]);
    const colors = c5View === 'scale'
      ? { root:'#44bbcc', tone:'#2a7a8a', rootStroke:'#66ddee', toneStroke:'#3a9aaa' }
      : c5View === 'arpeggio'
      ? { root:'#cc66aa', tone:'#884477', rootStroke:'#ee88cc', toneStroke:'#aa5588' }
      : { root:'#8877dd', tone:'#554488', rootStroke:'#aa99ee', toneStroke:'#7766bb' };
    const label = c5View === 'scale'
      ? `${ki.keyRoot} ${ki.keyType} Scale`
      : `Key of ${ki.keyRoot} ${ki.keyType}`;
    setChordHighlight(ki.keyRoot, allNotes, label, null, colors);
    updateOverlays();
  }

  // Push a chord to the shared fretboard + (explicit gesture) the Chord Directory.
  function pushChord(ch) {
    const cat = catOfType(ch.type);
    const intervals = CHORD_TYPES[cat]?.[ch.type] || [0, 4, 7];
    const notes = getChordNotes(ch.root, intervals);
    setChordHighlight(ch.root, notes, ch.label || `${ch.numeral || ''} ${ch.root}${qualSuffix(ch.type)}`.trim(), null,
      { root: '#8877dd', tone: '#554488', rootStroke: '#aa99ee', toneStroke: '#7766bb' });
    updateOverlays();
    if (pedalBus.rebuildPedal) pedalBus.rebuildPedal('chords', { mode: 'chord', root: ch.root, chordType: ch.type, chordCat: cat });
  }
  function addToProgression(ch) {
    const ki = getKeyInfo(); if (!ki || !pedalBus.rebuildPedal) return;
    pedalBus.rebuildPedal('progression', { root: ki.keyRoot, keyType: ki.keyType, progMode: 'custom',
      _appendChord: { root: ch.root, quality: ch.quality, numeral: ch.numeral } });
  }

  function render() {
    const pw   = el.parentElement?.clientWidth || 280;
    const size = Math.min(pw - 24, 280);
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 20, minorR = outerR - 28;
    const majS = 34, minS = 26;

    let h = `<div class="rk rk-circle" style="--rk-accent:#8877dd;align-items:center;gap:8px">`;
    h += `<div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0">`;

    if (selKey !== null) {
      h += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:0">`;
      h += `<div class="mono" style="color:#ddd;font-size:20px;font-weight:800">${selMinor ? CIRCLE_MINOR[selKey] : CIRCLE_KEYS[selKey]}</div>`;
      h += `<div class="mono" style="color:#555;font-size:9px">${selMinor ? 'minor' : 'major'}</div></div>`;
    } else {
      h += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:0"><div class="mono" style="color:#555;font-size:9px">Select a key</div></div>`;
    }

    CIRCLE_KEYS.forEach((key, i) => {
      const ang = (i * 30 - 90) * Math.PI / 180;
      const bx = cx + outerR * Math.cos(ang) - majS / 2;
      const by = cy + outerR * Math.sin(ang) - majS / 2;
      const isSel  = selKey === i && !selMinor;
      const isNear = selKey !== null && !selMinor && (i === (selKey + 1) % 12 || i === (selKey + 11) % 12);
      const bg     = isSel ? '#ccc'                    : isNear ? 'rgba(200,200,200,.2)' : 'rgba(40,40,45,.6)';
      const border = isSel ? '2px solid #fff'          : isNear ? '1px solid #aaa'       : '1px solid #555';
      const color  = isSel ? '#111'                    : isNear ? '#ccc'                 : '#ddd';
      h += `<button class="c5-major mono" data-ki="${i}" style="position:absolute;left:${bx}px;top:${by}px;width:${majS}px;height:${majS}px;border-radius:50%;background:${bg};border:${border};color:${color};font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2">${key}</button>`;
    });
    CIRCLE_MINOR.forEach((key, i) => {
      const ang = (i * 30 - 90) * Math.PI / 180;
      const bx = cx + minorR * Math.cos(ang) - minS / 2;
      const by = cy + minorR * Math.sin(ang) - minS / 2;
      const isSel  = selKey === i && selMinor;
      const isNear = selKey !== null && selMinor && (i === (selKey + 1) % 12 || i === (selKey + 11) % 12);
      const bg     = isSel ? '#999'                  : isNear ? 'rgba(160,160,160,.2)' : 'rgba(30,30,35,.5)';
      const border = isSel ? '2px solid #ccc'        : isNear ? '1px solid #888'       : '1px solid #3a3a3a';
      const color  = isSel ? '#111'                  : isNear ? '#bbb'                 : '#999';
      h += `<button class="c5-minor mono" data-ki="${i}" style="position:absolute;left:${bx}px;top:${by}px;width:${minS}px;height:${minS}px;border-radius:50%;background:${bg};border:${border};color:${color};font-size:9px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2">${key}</button>`;
    });

    if (selKey !== null) {
      h += `<svg style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;pointer-events:none;z-index:1" viewBox="0 0 ${size} ${size}">`;
      const prev = (selKey + 11) % 12, next = (selKey + 1) % 12;
      [prev, next].forEach(ki => {
        const a1 = (selKey * 30 - 90) * Math.PI / 180;
        const a2 = (ki * 30 - 90) * Math.PI / 180;
        const mr = (outerR + minorR) / 2;
        h += `<line x1="${cx + mr * Math.cos(a1)}" y1="${cy + mr * Math.sin(a1)}" x2="${cx + mr * Math.cos(a2)}" y2="${cy + mr * Math.sin(a2)}" stroke="rgba(200,200,200,.2)" stroke-width="1.5"/>`;
      });
      const a1 = (selKey * 30 - 90) * Math.PI / 180;
      h += `<line x1="${cx + outerR * Math.cos(a1)}" y1="${cy + outerR * Math.sin(a1)}" x2="${cx + minorR * Math.cos(a1)}" y2="${cy + minorR * Math.sin(a1)}" stroke="rgba(200,200,200,.12)" stroke-width="1"/>`;
      h += `</svg>`;
    }
    h += `</div>`;

    if (selKey !== null) {
      const ki = getKeyInfo();
      const chords = getKeyChords(ki.keyRoot, ki.keyType);

      h += `<div style="display:flex;gap:3px;width:100%">`;
      h += `<button class="chord-btn c5v" data-c5v="harmony"  style="flex:1;font-size:8px;${c5View==='harmony'  ? 'background:rgba(136,119,221,.2);border-color:#8877dd;color:#bbaaee'  : ''}">🎹 Harmony</button>`;
      h += `<button class="chord-btn c5v" data-c5v="chords"   style="flex:1;font-size:8px;${c5View==='chords'   ? 'background:rgba(136,119,221,.15);border-color:#8877dd;color:#aa99dd' : ''}">🎵 Chords</button>`;
      h += `<button class="chord-btn c5v" data-c5v="scale"    style="flex:1;font-size:8px;${c5View==='scale'    ? 'background:rgba(68,187,204,.15);border-color:#44bbcc;color:#44bbcc'   : ''}">🎼 Scale</button>`;
      h += `<button class="chord-btn c5v" data-c5v="arpeggio" style="flex:1;font-size:8px;${c5View==='arpeggio' ? 'background:rgba(204,102,170,.15);border-color:#cc66aa;color:#cc66aa'  : ''}">🎶 Arp</button>`;
      h += `</div>`;

      if (c5View === 'chords' && chords.length) {
        h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
        chords.forEach((ch, ci) => {
          const ql   = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ch.quality === 'Aug' ? '+' : ch.quality;
          const isSel = selChordIdx === ci;
          h += `<button class="c5-chord" data-ci="${ci}" style="background:${isSel ? 'rgba(136,119,221,.25)' : 'rgba(136,119,221,.06)'};border:1px solid ${isSel ? '#aa99ee' : 'rgba(136,119,221,.2)'};color:${isSel ? '#ccbbff' : '#aa99dd'};border-radius:5px;padding:4px 8px;cursor:pointer;font-size:9px;font-family:'JetBrains Mono',monospace;font-weight:600">`;
          h += `<span style="font-size:8px;opacity:.6">${ch.numeral}</span> ${ch.root}${ql}`;
          h += `</button>`;
        });
        h += `</div>`;
      }

      if (c5View === 'scale') {
        const pat = KEY_PATTERNS[ki.keyType];
        if (pat) {
          const scaleNotes = pat.intervals.map(i => NOTES[(NOTES.indexOf(ki.keyRoot) + i) % 12]);
          h += `<div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;padding:4px 0">`;
          scaleNotes.forEach((n, i) => {
            const isR = i === 0;
            h += `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(68,187,204,.08);border:1px solid rgba(68,187,204,.2);border-radius:4px;padding:2px 6px">`;
            h += `<span style="width:8px;height:8px;border-radius:50%;background:${isR ? '#44bbcc' : '#2a7a8a'}"></span>`;
            h += `<span class="mono" style="color:${isR ? '#44bbcc' : '#7aafbb'};font-size:9px;font-weight:600">${showIntervals ? intervalLabel(ki.keyRoot, n) : n}</span>`;
            h += `</span>`;
          });
          h += `</div>`;
          h += `<div class="mono" style="color:#555;font-size:8px;text-align:center">${ki.keyRoot} ${ki.keyType} scale highlighted on fretboard</div>`;
        }
      }

      if (c5View === 'arpeggio') {
        h += `<div class="mono" style="color:#666;font-size:7px;text-align:center;margin-bottom:2px">Select a chord arpeggio</div>`;
        h += `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">`;
        chords.forEach((ch, ci) => {
          const ql   = ch.quality === 'Major' ? '' : ch.quality === 'Minor' ? 'm' : ch.quality === 'Dim' ? '°' : ch.quality === 'Aug' ? '+' : ch.quality;
          const isSel = selChordIdx === ci;
          h += `<button class="c5-arp" data-ci="${ci}" style="background:${isSel ? 'rgba(204,102,170,.2)' : 'rgba(204,102,170,.06)'};border:1px solid ${isSel ? '#cc66aa' : 'rgba(204,102,170,.2)'};color:${isSel ? '#ee88cc' : '#bb77aa'};border-radius:5px;padding:4px 8px;cursor:pointer;font-size:9px;font-family:'JetBrains Mono',monospace;font-weight:600">`;
          h += `<span style="font-size:8px;opacity:.6">${ch.numeral}</span> ${ch.root}${ql}`;
          h += `</button>`;
        });
        h += `</div>`;
      }

      if (c5View === 'harmony') {
        const dia = (harm7 ? getKeySeventhChords(ki.keyRoot, ki.keyType) : getKeyChords(ki.keyRoot, ki.keyType))
          .map(ch => ({ root: ch.root, type: ch.quality, quality: ch.quality, numeral: ch.numeral,
            why: `${ch.numeral} — the diatonic ${ch.root}${qualSuffix(ch.quality)} chord, built straight from the ${ki.keyRoot} ${ki.keyType} scale.` }));
        const sec = getSecondaryDominants(ki.keyRoot, ki.keyType).map(c => ({ root: c.root, type: c.quality, quality: c.quality, numeral: c.numeral, why: c.why }));
        const bor = getBorrowedChords(ki.keyRoot, ki.keyType).map(c => ({ root: c.root, type: c.quality, quality: c.quality, numeral: c.numeral, why: c.why }));
        harmLists = { dia, sec, bor };

        h += `<div style="display:flex;gap:4px;width:100%">`;
        h += `<button class="harm7" data-h7="0" style="flex:1;font-size:8px;padding:3px;border-radius:4px;border:1px solid ${!harm7?'#8877dd':'#3a3a3a'};background:${!harm7?'rgba(136,119,221,.12)':'transparent'};color:${!harm7?'#aa99dd':'#888'};cursor:pointer">Triads</button>`;
        h += `<button class="harm7" data-h7="1" style="flex:1;font-size:8px;padding:3px;border-radius:4px;border:1px solid ${harm7?'#8877dd':'#3a3a3a'};background:${harm7?'rgba(136,119,221,.12)':'transparent'};color:${harm7?'#aa99dd':'#888'};cursor:pointer">7ths</button>`;
        h += `</div>`;

        const rowLabel = t => `<div class="mono" style="color:#666;font-size:7px;letter-spacing:1px;width:100%;margin-top:2px">${t}</div>`;
        const chip = (c, kind, i) => {
          const sel = selHarm && selHarm.kind === kind && selHarm.idx === i;
          return `<button class="harm-chip" data-hk="${kind}" data-hi="${i}" style="background:${sel?'rgba(136,119,221,.28)':'rgba(136,119,221,.06)'};border:1px solid ${sel?'#aa99ee':'rgba(136,119,221,.2)'};color:${sel?'#ccbbff':'#aa99dd'};border-radius:5px;padding:3px 6px;cursor:pointer;font-size:9px;font-family:'JetBrains Mono',monospace;font-weight:600"><span style="font-size:7px;opacity:.7">${c.numeral}</span> ${c.root}${qualSuffix(c.type)}</button>`;
        };
        const row = (list, kind) => `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center;width:100%">${list.map((c, i) => chip(c, kind, i)).join('')}</div>`;

        h += rowLabel('IN KEY — diatonic');
        h += row(dia, 'dia');
        h += rowLabel('SECONDARY DOMINANTS — borrowed tension');
        h += row(sec, 'sec');
        h += rowLabel('BORROWED — modal interchange');
        h += row(bor, 'bor');

        if (selHarm && harmLists[selHarm.kind] && harmLists[selHarm.kind][selHarm.idx]) {
          const c = harmLists[selHarm.kind][selHarm.idx];
          h += `<div style="font-size:9px;line-height:1.5;color:#cbb8f0;background:rgba(136,119,221,.08);border-left:2px solid #8877dd;padding:5px 7px;border-radius:4px;width:100%;margin-top:2px">${c.numeral} · ${c.root}${qualSuffix(c.type)} — ${c.why}</div>`;
          h += `<button class="harm-addprog" style="width:100%;font-size:8px;border:1px solid #ef9f27;background:rgba(239,159,39,.1);color:#ef9f27;border-radius:5px;padding:5px;cursor:pointer;margin-top:2px">＋ Add to Progression Builder</button>`;
        } else {
          h += `<div class="mono" style="color:#555;font-size:8px;text-align:center;margin-top:2px;line-height:1.4">Tap any chord to hear it, light it on the fretboard &amp; send it to the Chord Directory</div>`;
        }
      }

      const prev = CIRCLE_KEYS[(selKey + 11) % 12], next = CIRCLE_KEYS[(selKey + 1) % 12];
      const rel  = selMinor ? CIRCLE_KEYS[selKey] : CIRCLE_MINOR[selKey];
      h += `<div class="mono" style="color:#444;font-size:7px;text-align:center;margin-top:2px">Related: <span style="color:#bbb">${prev}</span> · <span style="color:#bbb">${next}</span> · <span style="color:#bbb">${rel}</span></div>`;
    }
    h += theoryPanelHTML('circle', CIRCLE_THEORY);
    h += `</div>`;
    el.innerHTML = h;
    wireTheoryPanel(el);

    el.querySelectorAll('.c5-major').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ki = parseInt(b.dataset.ki);
      if (selKey === ki && !selMinor) { selKey = null; selMinor = false; }
      else { selKey = ki; selMinor = false; }
      selChordIdx = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5-minor').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ki = parseInt(b.dataset.ki);
      if (selKey === ki && selMinor) { selKey = null; selMinor = false; }
      else { selKey = ki; selMinor = true; }
      selChordIdx = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5v').forEach(b => b.onclick = e => {
      e.stopPropagation(); c5View = b.dataset.c5v; selChordIdx = null; selHarm = null; applyC5Highlight(); render();
    });
    el.querySelectorAll('.c5-chord').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ci = parseInt(b.dataset.ci);
      selChordIdx = selChordIdx === ci ? null : ci;
      const ki = getKeyInfo(); if (!ki) return;
      const chords = getKeyChords(ki.keyRoot, ki.keyType);
      if (selChordIdx !== null && chords[selChordIdx]) {
        const ch = chords[selChordIdx];
        pushChord({ root: ch.root, type: ch.quality, quality: ch.quality, numeral: ch.numeral, label: `${ch.numeral} — ${ch.root}${qualSuffix(ch.quality)}` });
      } else { applyC5Highlight(); }
      render();
    });
    el.querySelectorAll('.c5-arp').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ci = parseInt(b.dataset.ci);
      selChordIdx = selChordIdx === ci ? null : ci;
      const ki = getKeyInfo(); if (!ki) return;
      const chords = getKeyChords(ki.keyRoot, ki.keyType);
      if (selChordIdx !== null && chords[selChordIdx]) {
        const ch = chords[selChordIdx];
        const formula = ({ Major:[0,4,7], Minor:[0,3,7], Dim:[0,3,6], Aug:[0,4,8] })[ch.quality] || [0,4,7];
        const notes = formula.map(i => NOTES[(NOTES.indexOf(ch.root) + i) % 12]);
        setChordHighlight(ch.root, notes, `${ch.root} ${ch.quality} Arpeggio`, null, { root:'#cc66aa', tone:'#884477', rootStroke:'#ee88cc', toneStroke:'#aa5588' });
      } else { applyC5Highlight(); }
      updateOverlays(); render();
    });
    el.querySelectorAll('.harm7').forEach(b => b.onclick = e => { e.stopPropagation(); harm7 = b.dataset.h7 === '1'; render(); });
    el.querySelectorAll('.harm-chip').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const kind = b.dataset.hk, idx = parseInt(b.dataset.hi);
      selHarm = (selHarm && selHarm.kind === kind && selHarm.idx === idx) ? null : { kind, idx };
      if (selHarm && harmLists[kind] && harmLists[kind][idx]) pushChord(harmLists[kind][idx]);
      else applyC5Highlight(false);
      render();
    });
    el.querySelector('.harm-addprog')?.addEventListener('click', e => {
      e.stopPropagation();
      if (selHarm && harmLists[selHarm.kind] && harmLists[selHarm.kind][selHarm.idx]) addToProgression(harmLists[selHarm.kind][selHarm.idx]);
    });
    Object.assign(s, { selKey, selMinor, c5View, harm7 });
  }

  render();
}
