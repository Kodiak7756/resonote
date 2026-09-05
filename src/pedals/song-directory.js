import { NOTES, toSharp } from '../core/music-theory.js';
import { pedalBus } from '../core/state.js';

export const SONG_LIBRARY = [   // also consumed by the Song Sketchpad's 📖 Library view
  { title:'Let It Be',          artist:'Beatles',         key:'C',   prog:'C G Am F',                                 chords:['C','G','Am','F'],                            cat:'Rock'    },
  { title:'Wonderwall',         artist:'Oasis',           key:'F#m', prog:'F#m A E B7sus4',                           chords:['F#m','A','E','B7sus4'],                       cat:'Rock'    },
  { title:'Hotel California',   artist:'Eagles',          key:'Bm',  prog:'Bm F# A E G D Em F#',                      chords:['Bm','F#','A','E','G','D','Em','F#'],          cat:'Rock'    },
  { title:'Stand By Me',        artist:'Ben E. King',     key:'A',   prog:'A F#m D E',                                chords:['A','F#m','D','E'],                            cat:'Classic' },
  { title:'Hallelujah',         artist:'Leonard Cohen',   key:'C',   prog:'C Am C Am F G C G',                        chords:['C','Am','F','G'],                             cat:'Classic' },
  { title:'Autumn Leaves',      artist:'Jazz Standard',   key:'Gm',  prog:'Cm7 F7 BbMaj7 EbMaj7 Am7b5 D7 Gm',        chords:['Cm7','F7','BbMaj7','EbMaj7','Am7b5','D7','Gm'],cat:'Jazz'   },
  { title:'Blue Bossa',         artist:'Jazz Standard',   key:'Cm',  prog:'Cm7 Fm7 Dm7b5 G7 Cm7',                    chords:['Cm7','Fm7','Dm7b5','G7','Cm7'],               cat:'Jazz'    },
  { title:'Fly Me to the Moon', artist:'Jazz Standard',   key:'Am',  prog:'Am7 Dm7 G7 CMaj7 FMaj7 Bm7b5 E7 Am7',     chords:['Am7','Dm7','G7','CMaj7','FMaj7','Bm7b5','E7','Am7'],cat:'Jazz'},
  { title:'12-Bar Blues',       artist:'Traditional',     key:'A',   prog:'A A A A D D A A E D A E',                  chords:['A','D','E'],                                  cat:'Blues'  },
  { title:'Sweet Home Chicago', artist:'Robert Johnson',  key:'E',   prog:'E E E E A A E E B7 A E B7',               chords:['E','A','B7'],                                 cat:'Blues'   },
  { title:"Knockin' on Heaven's Door",artist:'Bob Dylan', key:'G',   prog:'G D Am Am G D C C',                        chords:['G','D','Am','C'],                             cat:'Folk'    },
  { title:'House of the Rising Sun',artist:'Traditional', key:'Am',  prog:'Am C D F Am C E E',                        chords:['Am','C','D','F','E'],                         cat:'Folk'    },
  { title:'Lean on Me',         artist:'Bill Withers',    key:'C',   prog:'C Dm Em F C Am Dm G',                      chords:['C','Dm','Em','F','Am','G'],                   cat:'Classic' },
  { title:'No Woman No Cry',    artist:'Bob Marley',      key:'C',   prog:'C G Am F C G C G',                         chords:['C','G','Am','F'],                             cat:'Reggae'  },
  { title:'Stairway to Heaven', artist:'Led Zeppelin',    key:'Am',  prog:'Am E+/G# C/G D/F# Fmaj7 G Am',            chords:['Am','C','D','Fmaj7','G'],                     cat:'Rock'    },
  { title:'Wish You Were Here', artist:'Pink Floyd',      key:'G',   prog:'Em G Em G C D Am G',                       chords:['Em','G','C','D','Am'],                        cat:'Rock'    },
];

function parseSongChords(song) {
  const chords2 = song.prog.split(/\s+/).filter(x => x);
  const bars = Math.max(4, Math.ceil(chords2.length / 4) * 4);
  const grid = new Array(bars * 4).fill(null);
  const qMap = { '':'Major','m':'Minor','7':'Major','m7':'Minor','maj7':'Major','dim':'Dim','aug':'Aug','sus4':'Major','sus2':'Major' };
  chords2.forEach((ch, ci) => {
    if (ci < grid.length) {
      let rn = ch.length > 1 && (ch[1] === '#' || ch[1] === 'b') ? ch.slice(0, 2) : ch[0];
      const qual = ch.slice(rn.length) || '';
      grid[ci * Math.floor(bars * 4 / chords2.length)] = { root: toSharp(rn), quality: qMap[qual.toLowerCase()] || 'Major', numeral: ch };
    }
  });
  const k = song.key;
  const root = toSharp(k.length > 1 && (k[1] === '#' || k[1] === 'b') ? k.slice(0, 2) : k[0]);
  return { grid, bars, root };
}

export function buildSongDirContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  const s = p.settings || (p.settings = {});
  let filterCat  = s.sdCat  || 'All';
  let viewMode   = s.sdMode || 'library';
  let selectedIdx = s.sdSel ?? null;
  let savedSongs = [];
  try { const raw = localStorage.getItem('resonote-songs'); if (raw) savedSongs = JSON.parse(raw); } catch(e) {}
  let addTitle = '', addArtist = '', addKey = 'C', addProg = '';

  function getFiltered() {
    const all = viewMode === 'saved' ? savedSongs : SONG_LIBRARY;
    if (filterCat === 'All') return all;
    return all.filter(s2 => s2.cat === filterCat);
  }

  function saveSong(song) {
    savedSongs.push(song);
    try { localStorage.setItem('resonote-songs', JSON.stringify(savedSongs)); } catch(e) {}
  }

  function deleteSaved(idx) {
    savedSongs.splice(idx, 1);
    try { localStorage.setItem('resonote-songs', JSON.stringify(savedSongs)); } catch(e) {}
    render();
  }

  function render() {
    const accent = 'var(--rk-accent)';
    const songs  = getFiltered();
    const cats   = [...new Set(SONG_LIBRARY.map(s2 => s2.cat))];
    let h = `<div class="rk" style="display:flex;flex-direction:column;gap:5px">`;

    h += `<div style="display:flex;gap:3px">`;
    [['library','Library'],['saved','My Songs'],['add','+ New']].forEach(([m, label]) => {
      h += `<button class="chord-btn sd-view" data-sv="${m}" style="min-height:calc(28px*var(--ui));flex:1;font-size:calc(10px*var(--ui));${viewMode===m?`background:var(--rk-soft2);border-color:var(--rk-line);color:${accent}`:''}">${label}</button>`;
    });
    h += `</div>`;

    if (viewMode === 'add') {
      h += `<div style="display:flex;flex-direction:column;gap:4px;background:var(--rk-soft);border:1px solid var(--rk-edge-soft);border-radius:6px;padding:8px">`;
      h += `<input class="sd-title" placeholder="Song title" value="${addTitle}" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:4px;padding:4px 6px;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace">`;
      h += `<input class="sd-artist" placeholder="Artist" value="${addArtist}" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:4px;padding:4px 6px;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace">`;
      h += `<div style="display:flex;gap:4px;align-items:center"><span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">KEY</span>`;
      h += `<select class="sd-key" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:4px;padding:2px 4px;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace">`;
      NOTES.forEach(n => { h += `<option value="${n}"${addKey===n?' selected':''}>${n}</option>`; });
      h += `</select></div>`;
      h += `<textarea class="sd-prog" placeholder="Chord progression (e.g. Am C D F)" rows="2" style="background:var(--rk-panel);border:1px solid var(--rk-edge-soft);color:var(--rk-ink);border-radius:4px;padding:4px 6px;font-size:calc(10px*var(--ui));font-family:'JetBrains Mono',monospace;resize:vertical">${addProg}</textarea>`;
      h += `<button class="chord-btn sd-save" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:var(--rk-ok);border-color:color-mix(in srgb, var(--rk-ok) 40%, transparent)">Save Song</button>`;
      h += `</div>`;
    } else {
      h += `<div style="display:flex;gap:2px;flex-wrap:wrap">`;
      h += `<button class="chord-btn sd-cat" data-sc="All" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));${filterCat==='All'?`background:var(--rk-soft);border-color:var(--rk-line);color:${accent}`:''}">All</button>`;
      cats.forEach(c => {
        h += `<button class="chord-btn sd-cat" data-sc="${c}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));${filterCat===c?`background:var(--rk-soft);border-color:var(--rk-line);color:${accent}`:''}">${c}</button>`;
      });
      if (viewMode === 'saved') h += `<button class="chord-btn sd-cat" data-sc="Custom" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));${filterCat==='Custom'?`background:var(--rk-soft);border-color:var(--rk-line);color:${accent}`:''}">Custom</button>`;
      h += `</div>`;

      h += `<div style="display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto">`;
      if (!songs.length) {
        h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(10px*var(--ui));text-align:center;padding:12px">${viewMode==='saved'?'No saved songs yet':'No songs in this category'}</div>`;
      }
      songs.forEach((song, i) => {
        const isSel = selectedIdx === i;
        h += `<div class="sd-song" data-si="${i}" style="background:${isSel?'var(--rk-soft)':'var(--rk-panel)'};border:1px solid ${isSel?'var(--rk-line)':'var(--rk-edge-soft)'};border-radius:4px;padding:5px 6px;cursor:pointer">`;
        h += `<div style="display:flex;align-items:center;gap:4px">`;
        h += `<span class="mono" style="color:${accent};font-size:calc(10px*var(--ui));font-weight:700;flex:1">${song.title}</span>`;
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${song.key}</span>`;
        h += `<span class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui))">${song.cat}</span>`;
        h += `</div><div class="mono" style="color:var(--rk-ink-dim);font-size:calc(8px*var(--ui))">${song.artist}</div>`;
        if (isSel) {
          h += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--rk-edge-soft)">`;
          h += `<div class="mono" style="color:${accent};font-size:calc(9px*var(--ui));font-weight:600;margin-bottom:2px">Progression:</div>`;
          h += `<div class="mono" style="color:var(--rk-ink);font-size:calc(10px*var(--ui));line-height:1.6;word-spacing:4px">${song.prog}</div>`;
          h += `<div class="mono" style="color:var(--rk-ink-mute);font-size:calc(8px*var(--ui));margin-top:4px">Practice with:</div>`;
          // These four used to be painted in the DESTINATION pedals' old accents,
          // which is how a hex gets stale: recolour a pedal and its shortcut here
          // still wears last year's paint. The emoji names the destination; the
          // button wears the directory's own accent like every other control.
          h += `<div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:2px">`;
          h += `<button class="chord-btn sd-route" data-si="${i}" data-rt="progression" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:${accent};border-color:var(--rk-line)">🔁 Chords</button>`;
          h += `<button class="chord-btn sd-route" data-si="${i}" data-rt="rhythm"      style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:${accent};border-color:var(--rk-line)">🥁 Groove</button>`;
          h += `<button class="chord-btn sd-route" data-si="${i}" data-rt="finger"      style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:${accent};border-color:var(--rk-line)">🤚 Finger</button>`;
          h += `<button class="chord-btn sd-route" data-si="${i}" data-rt="runner"      style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:${accent};border-color:var(--rk-line)">💪 Scales</button>`;
          h += `</div>`;
          h += `<div style="display:flex;gap:3px;margin-top:3px">`;
          h += `<button class="chord-btn sd-save-practice" data-si="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));flex:1;color:var(--rk-dim);border-color:var(--rk-edge-soft)">📋 Save to Practice Library</button>`;
          if (viewMode === 'saved') h += `<button class="chord-btn sd-del" data-di="${i}" style="min-height:calc(28px*var(--ui));font-size:calc(10px*var(--ui));color:var(--rk-bad)">✕</button>`;
          h += `</div></div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
    el.innerHTML = h;

    // Wire
    el.querySelectorAll('.sd-view').forEach(b => b.onclick = e => { e.stopPropagation(); viewMode = b.dataset.sv; selectedIdx = null; filterCat = 'All'; render(); });
    el.querySelectorAll('.sd-cat') .forEach(b => b.onclick = e => { e.stopPropagation(); filterCat = b.dataset.sc; selectedIdx = null; render(); });
    el.querySelectorAll('.sd-song').forEach(b => b.onclick = e => {
      e.stopPropagation(); const si = parseInt(b.dataset.si);
      selectedIdx = selectedIdx === si ? null : si; render();
    });
    el.querySelectorAll('.sd-del') .forEach(b => b.onclick = e => { e.stopPropagation(); deleteSaved(parseInt(b.dataset.di)); });

    el.querySelectorAll('.sd-route').forEach(b => b.onclick = e => {
      e.stopPropagation();
      if (!pedalBus.rebuildPedal) return;
      const si   = parseInt(b.dataset.si);
      const rt   = b.dataset.rt;
      const song = getFiltered()[si];
      if (!song) return;
      const parsed = parseSongChords(song);
      if (rt === 'progression') {
        pedalBus.rebuildPedal('progression', { progMode:'custom', gridBars:parsed.bars, customGrid:parsed.grid, root:parsed.root, _autoStart:true });
      } else if (rt === 'rhythm') {
        pedalBus.rebuildPedal('rhythm', { rhyChordMode:'per-step', _autoStart:true });
      } else if (rt === 'finger') {
        const firstChord = song.prog.split(/\s+/)[0] || 'Am';
        pedalBus.rebuildPedal('finger', { fChordRoot:firstChord, fChordMode:'chord', _autoStart:true });
      } else if (rt === 'runner') {
        pedalBus.rebuildPedal('runner', { root:parsed.root, mode:'scales', _autoStart:true });
      }
    });

    el.querySelectorAll('.sd-save-practice').forEach(b => b.onclick = e => {
      e.stopPropagation(); const si = parseInt(b.dataset.si);
      const song = getFiltered()[si]; if (!song) return;
      let lib = [];
      try { const raw = localStorage.getItem('resonote-practice-lib'); if (raw) lib = JSON.parse(raw); } catch(e2) {}
      lib.push({ title: song.title, artist: song.artist, key: song.key, prog: song.prog, date: new Date().toISOString() });
      try { localStorage.setItem('resonote-practice-lib', JSON.stringify(lib.slice(-50))); } catch(e2) {}
      b.textContent = '✓ Saved!'; b.style.color = 'var(--rk-ok)';
      setTimeout(() => { b.textContent = '📋 Save to Practice Library'; b.style.color = 'var(--rk-dim)'; }, 1200);
    });

    const saveBtn = el.querySelector('.sd-save');
    if (saveBtn) saveBtn.onclick = e => {
      e.stopPropagation();
      const t  = el.querySelector('.sd-title')?.value  || '';
      const ar = el.querySelector('.sd-artist')?.value || '';
      const k  = el.querySelector('.sd-key')?.value    || 'C';
      const pr = el.querySelector('.sd-prog')?.value   || '';
      if (t && pr) {
        saveSong({ title:t, artist:ar||'Me', key:k, prog:pr, chords:[...new Set(pr.split(/\s+/).filter(x=>x))], cat:'Custom' });
        addTitle = ''; addArtist = ''; addProg = ''; viewMode = 'saved'; render();
      }
    };

    el.querySelector('.sd-title') ?.addEventListener('input', e => { addTitle  = e.target.value; });
    el.querySelector('.sd-artist')?.addEventListener('input', e => { addArtist = e.target.value; });
    el.querySelector('.sd-key')   ?.addEventListener('change',e => { addKey    = e.target.value; });
    el.querySelector('.sd-prog')  ?.addEventListener('input', e => { addProg   = e.target.value; });

    Object.assign(s, { sdCat: filterCat, sdMode: viewMode, sdSel: selectedIdx });
  }

  render();
}
