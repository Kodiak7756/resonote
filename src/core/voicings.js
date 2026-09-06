import { NOTES, KEY_POSITION_ZONES, getKeyChords, SCALE_TYPES, getScaleNotes,
  CANONICAL_MAJOR_TEMPLATE_BOXES, CANONICAL_MINOR_PENT_TEMPLATE_BOXES,
  CANONICAL_MAJOR_PENT_TEMPLATE_BOXES, sameIntervals,
  isFivePositionMajorScale, isFivePositionMajorPentatonic, isFivePositionMinorPentatonic
} from './music-theory.js';
import { customTuning, getNoteAtFret, getInst, currentInstrument, isStandardMajorPatternContext } from './tuning.js';
import { pianoGeo } from '../ui/fretboard.js';

// ── Open voicings (specific root shapes) ────────────────────────────
export const OPEN_VOICINGS = {
  'Major':   { 'C':[[-1,3,2,0,1,0]],'A':[[-1,0,2,2,2,0]],'G':[[3,2,0,0,0,3]],'E':[[0,2,2,1,0,0]],'D':[[-1,-1,0,2,3,2]],'F':[[1,3,3,2,1,1]] },
  'Minor':   { 'A':[[-1,0,2,2,1,0]],'E':[[0,2,2,0,0,0]],'D':[[-1,-1,0,2,3,1]],'F':[[1,3,3,1,1,1]] },
  'Dim':     { 'B':[[-1,2,3,4,3,-1]],'D':[[-1,-1,0,1,3,1]] },
  'Aug':     { 'C':[[-1,3,2,1,1,0]],'E':[[0,3,2,1,1,0]] },
  'Sus2':    { 'A':[[-1,0,2,2,0,0]],'D':[[-1,-1,0,2,3,0]],'E':[[0,2,4,4,0,0]] },
  'Sus4':    { 'A':[[-1,0,2,2,3,0]],'D':[[-1,-1,0,2,3,3]],'E':[[0,2,2,2,0,0]] },
  'Maj7':    { 'C':[[-1,3,2,0,0,0]],'A':[[-1,0,2,1,2,0]],'G':[[3,2,0,0,0,2]],'E':[[0,2,1,1,0,0]],'D':[[-1,-1,0,2,2,2]],'F':[[1,-1,2,2,1,0]] },
  '7 (Dom)': { 'A':[[-1,0,2,0,2,0]],'E':[[0,2,0,1,0,0]],'D':[[-1,-1,0,2,1,2]],'G':[[3,2,0,0,0,1]],'C':[[-1,3,2,3,1,0]],'B':[[-1,2,1,2,0,2]] },
  'Min7':    { 'A':[[-1,0,2,0,1,0]],'E':[[0,2,0,0,0,0]],'D':[[-1,-1,0,2,1,1]] },
  'Dim7':    { 'B':[[-1,2,0,1,0,1]] },
  'm7♭5':   { 'B':[[-1,2,3,2,3,-1]] },
  'mMaj7':   { 'A':[[-1,0,2,1,1,0]],'E':[[0,2,1,0,0,0]] },
  'Add9':    { 'C':[[-1,3,2,0,3,0]],'A':[[-1,0,2,4,2,0]],'G':[[3,0,0,0,0,3]],'E':[[0,2,2,1,0,2]] },
  '6':       { 'C':[[-1,3,2,2,1,0]],'A':[[-1,0,2,2,2,2]],'G':[[3,2,0,0,0,0]],'E':[[0,2,2,1,2,0]] },
  'Min6':    { 'A':[[-1,0,2,2,1,2]],'E':[[0,2,2,0,2,0]] }
};

// ── Close-position triads on a chosen 3-string set ───────────────────
// Every compact grip of a triad constrained to exactly the given strings
// (idxs low→high, si 0 = highest string): 3 rotations × per-string octave
// choices, span ≤ 4 frets, max fret 17, sorted low-on-the-neck first.
// Shared by the Voicing Lab (🧵 Workshop tab) and the Workouts pedal.
export const TRIAD_QUALITIES = { Major: [0, 4, 7], Minor: [0, 3, 7], Dim: [0, 3, 6], Aug: [0, 4, 8] };
export function findTriadsOnSet(rootPc, quality, idxs) {
  const pcs = (TRIAD_QUALITIES[quality] || TRIAD_QUALITIES.Major).map(iv => (rootPc + iv) % 12);
  const grips = [], seen = new Set();
  for (let rot = 0; rot < 3; rot++) {
    const order = [pcs[rot], pcs[(rot + 1) % 3], pcs[(rot + 2) % 3]];
    const base = idxs.map((si, k) => ((order[k] - NOTES.indexOf(customTuning[si].note)) % 12 + 12) % 12);
    for (let mask = 0; mask < 8; mask++) {
      const frets = base.map((f, k) => f + ((mask >> k) & 1) * 12);
      const mx = Math.max(...frets), mn = Math.min(...frets);
      if (mx > 17 || mx - mn > 4) continue;
      const key = frets.join(',');
      if (seen.has(key)) continue; seen.add(key);
      grips.push({ rot, frets, avg: (mx + mn) / 2, min: mn });
    }
  }
  return grips.sort((a, b) => a.avg - b.avg);
}

// ── Barre shape templates ────────────────────────────────────────────
export const BARRE_SHAPES = {
  'Major':   [{name:'E Shape (R6)',rootTab:0,rel:[0,2,2,1,0,0]},{name:'A Shape (R5)',rootTab:1,rel:[-1,0,2,2,2,0]}],
  'Minor':   [{name:'Em Shape (R6)',rootTab:0,rel:[0,2,2,0,0,0]},{name:'Am Shape (R5)',rootTab:1,rel:[-1,0,2,2,1,0]}],
  'Dim':     [{name:'Dim (R5)',rootTab:1,rel:[-1,0,1,2,1,-1]}],
  'Aug':     [{name:'Aug (R6)',rootTab:0,rel:[0,3,2,1,1,0]}],
  'Sus2':    [{name:'Sus2 (R6)',rootTab:0,rel:[0,2,4,4,0,0]},{name:'Sus2 (R5)',rootTab:1,rel:[-1,0,2,2,0,0]}],
  'Sus4':    [{name:'Sus4 (R6)',rootTab:0,rel:[0,2,2,2,0,0]},{name:'Sus4 (R5)',rootTab:1,rel:[-1,0,2,2,3,0]}],
  'Maj7':    [{name:'Maj7 (R6)',rootTab:0,rel:[0,2,1,1,0,0]},{name:'Maj7 (R5)',rootTab:1,rel:[-1,0,2,1,2,0]}],
  '7 (Dom)': [{name:'7 (R6)',rootTab:0,rel:[0,2,0,1,0,0]},{name:'7 (R5)',rootTab:1,rel:[-1,0,2,0,2,0]}],
  'Min7':    [{name:'m7 (R6)',rootTab:0,rel:[0,2,0,0,0,0]},{name:'m7 (R5)',rootTab:1,rel:[-1,0,2,0,1,0]}],
  'Dim7':    [{name:'dim7 (R5)',rootTab:1,rel:[-1,0,1,2,1,2]}],
  'm7♭5':   [{name:'m7♭5 (R6)',rootTab:0,rel:[0,1,0,0,-1,-1]},{name:'m7♭5 (R5)',rootTab:1,rel:[-1,0,1,0,1,-1]}],
  'Aug7':    [{name:'aug7 (R6)',rootTab:0,rel:[0,3,0,1,1,0]}],
  'mMaj7':   [{name:'mMaj7 (R6)',rootTab:0,rel:[0,2,1,0,0,0]},{name:'mMaj7 (R5)',rootTab:1,rel:[-1,0,2,1,1,0]}],
  '9':       [{name:'9 (R6)',rootTab:0,rel:[0,2,0,1,0,2]}],
  'Min9':    [], 'Maj9':  [],
  'Add9':    [{name:'add9 (R5)',rootTab:1,rel:[-1,0,2,4,2,-1]}],
  '6':       [{name:'6 (R6)',rootTab:0,rel:[0,2,2,1,2,0]},{name:'6 (R5)',rootTab:1,rel:[-1,0,2,2,2,2]}],
  'Min6':    [{name:'m6 (R6)',rootTab:0,rel:[0,2,2,0,2,0]}],
  // ── Extended / altered movable shells (root on 5th string) ─────────
  '6/9':     [{name:'6/9 (R6)',rootTab:0,rel:[0,-1,-1,1,2,2]}],
  '11':      [{name:'11 (R5)',rootTab:1,rel:[-1,0,0,0,0,-1]}],
  '13':      [{name:'13 (R6)',rootTab:0,rel:[0,-1,0,1,2,2]}],
  '7♭9':    [{name:'7♭9 (R6)',rootTab:0,rel:[0,-1,0,1,-1,1]}],
  '7♯9':    [{name:'7♯9 (R6)',rootTab:0,rel:[0,-1,0,1,-1,3]}],
  '7♯5':    [{name:'7♯5 (R6)',rootTab:0,rel:[0,3,0,1,1,0]}],
  '7♭5':    [{name:'7♭5 (R6)',rootTab:0,rel:[0,1,0,1,-1,-1]}]
};

// ── Helpers ──────────────────────────────────────────────────────────
function tabToSi(tabFrets) {
  const ns = customTuning.length;
  const si = [...tabFrets].reverse();
  while (si.length < ns) si.push(-1);
  si.length = ns;
  return si;
}

function validateShape(siFrets, chordNotes, rootNote) {
  const played = [];
  for (let si = 0; si < siFrets.length; si++) {
    if (siFrets[si] < 0) continue;
    if (siFrets[si] > 20) return null;
    const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, siFrets[si]);
    if (!chordNotes.includes(note)) return null;
    played.push({ si, fret: siFrets[si], note });
  }
  if (played.length < 3) return null;
  if (!played.some(p => p.note === rootNote)) return null;
  return played;
}

// ── Main voicing finder ───────────────────────────────────────────────
// ── Slash-chord voicings: a BASS note + a major upper triad on a higher string set ──
// (G/C = C bass + G triad.) findVoicings can't produce these — they're not a fixed quality
// shape but a two-part construction — so the Chord-Family Lab asks for them here. Every grip:
// bass on one of the two lowest strings, upper triad as a compact close-position rotation on
// an adjacent 3-string set above it (D·G·B, G·B·E, A·D·G…), open strings free, reach ≤ 4 frets.
export function findSlashVoicings(bassNote, upperSemis, upperQual) {
  const ns = customTuning.length;
  const bassPc = NOTES.indexOf(bassNote);
  if (bassPc < 0 || upperSemis == null) return [];
  const TRIAD = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6] };
  const upPcs = (TRIAD[upperQual] || TRIAD.maj).map(iv => (bassPc + upperSemis + iv) % 12);
  const out = [], seen = new Set();
  const noteOf = (si, f) => { const n = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f); return { si, fret: f, note: n.note, octave: n.octave }; };
  [ns - 1, ns - 2].forEach(bassSi => {
    if (bassSi < 3) return;                        // need at least 3 strings above the bass
    const openPc = NOTES.indexOf(customTuning[bassSi].note);
    const bf0 = ((bassPc - openPc) % 12 + 12) % 12;
    [bf0, bf0 + 12].forEach(bf => {
      if (bf > 15) return;
      for (let top = 0; top + 2 < bassSi; top++) {
        const set = [top + 2, top + 1, top];       // low → high
        for (let rot = 0; rot < 3; rot++) {
          const order = [upPcs[rot], upPcs[(rot + 1) % 3], upPcs[(rot + 2) % 3]];
          const base = set.map((si, k) => ((order[k] - NOTES.indexOf(customTuning[si].note)) % 12 + 12) % 12);
          for (let mask = 0; mask < 8; mask++) {
            const frets = base.map((f, k) => f + ((mask >> k) & 1) * 12);
            const all = [bf, ...frets];
            if (Math.max(...all) > 15) continue;
            const fretted = all.filter(f => f > 0);
            if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 4) continue;
            // open strings in the TRIO only mix with low fretted notes — an open B under a
            // 10th-fret melody note is a register jumble, not a usable grip
            const upFretted = frets.filter(f => f > 0);
            if (frets.some(f => f === 0) && upFretted.some(f => f > 5)) continue;
            const positions = [noteOf(bassSi, bf), ...set.map((si, k) => noteOf(si, frets[k]))];
            const key = positions.map(p => `${p.si}:${p.fret}`).join('|');
            if (seen.has(key)) continue; seen.add(key);
            const fr = positions.filter(p => p.fret > 0);
            out.push({
              positions: assignFingers(positions),
              name: `${customTuning[bassSi].note}-bass · ${bf === 0 ? 'open' : bf + 'fr'}`,
              cat: 'slash', priority: 0,
              minFret: fr.length ? Math.min(...fr.map(p => p.fret)) : 0,
              maxFret: fr.length ? Math.max(...fr.map(p => p.fret)) : 0
            });
          }
        }
      }
    });
  });
  return out.sort((a, b) => a.minFret - b.minFret || a.maxFret - b.maxFret).slice(0, 10);
}

export function findVoicings(rootNote, chordNotes, qualityName) {
  const ns = customTuning.length;
  const results = [], seen = new Set();

  function addResult(positions, name, cat, priority) {
    const key = positions.map(p => `${p.si}:${p.fret}`).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const fretted = positions.filter(p => p.fret > 0);
    results.push({
      positions, name, cat, priority,
      minFret: fretted.length ? Math.min(...fretted.map(p => p.fret)) : 0,
      maxFret: fretted.length ? Math.max(...fretted.map(p => p.fret)) : 0
    });
  }

  // 1. Open voicings
  const openShapes = OPEN_VOICINGS[qualityName]?.[rootNote] || [];
  openShapes.forEach((shape, i) => {
    const si = tabToSi(shape);
    const played = validateShape(si, chordNotes, rootNote);
    if (played) addResult(played, `${rootNote} Open`, 'open', 100 - i);
  });

  // 2. Barre shapes
  const barres = BARRE_SHAPES[qualityName] || [];
  barres.forEach(tmpl => {
    const rootSi = (ns <= 6 ? 5 : ns - 1) - tmpl.rootTab;
    if (rootSi < 0 || rootSi >= ns) return;
    for (let f = 1; f <= 14; f++) {
      const { note } = getNoteAtFret(customTuning[rootSi].note, customTuning[rootSi].octave, f);
      if (note !== rootNote) continue;
      const tabAbs = tmpl.rel.map(r => r === -1 ? -1 : f + r);
      if (tabAbs.some(x => x !== -1 && (x < 0 || x > 20))) continue;
      const si = tabToSi(tabAbs);
      const played = validateShape(si, chordNotes, rootNote);
      if (played) {
        const hasFret0 = played.some(p => p.fret === 0);
        addResult(played, tmpl.name, 'barre', hasFret0 ? 80 : 70 - f);
      }
    }
  });

  // 3. Triads on 3 adjacent strings
  for (let i = 0; i <= ns - 3; i++) {
    const grp = [i, i + 1, i + 2];
    for (let baseFret = 0; baseFret <= 12; baseFret++) {
      const span = 4;
      const options = grp.map(si => {
        const o = [];
        for (let f = baseFret; f <= Math.min(baseFret + span, 15); f++) {
          const { note } = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
          if (chordNotes.includes(note)) o.push({ si, fret: f, note });
        }
        return o;
      });
      if (options.some(o => o.length === 0)) continue;
      for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) {
        const notes = new Set([a.note, b.note, c.note]);
        if (notes.size < 3 || !notes.has(rootNote)) continue;
        const positions = [a, b, c].map(x => ({ si: x.si, fret: x.fret, note: x.note }));
        const strNames = grp.map(si => 6 - si).join('-');
        addResult(positions, `Triad (${strNames})`, 'triad', 50 - baseFret);
      }
    }
  }

  results.sort((a, b) => b.priority - a.priority);
  return results.slice(0, 20);
}

// ── Fingering + single-grip selection (drills / progressions) ────────
// Assign fretting-hand fingers (1-4; 0 = open) to a voicing: a low-fret barre takes finger 1,
// the rest fill in by fret then string. Heuristic, but matches the common open/barre grips —
// so a learner can see WHICH finger frets WHICH note. Audit-driven 2026-06-14.
export function assignFingers(positions) {
  if (!positions || !positions.length) return positions || [];
  const fretted = positions.filter(p => p.fret > 0).sort((a, b) => a.fret - b.fret || b.si - a.si);
  if (!fretted.length) return positions.map(p => ({ ...p, finger: 0 }));
  const minF = fretted[0].fret;
  const atMin = fretted.filter(p => p.fret === minF);
  // a real barre = 2+ notes share the lowest fret AND something is fretted above it
  const isBarre = atMin.length >= 2 && fretted.some(p => p.fret > minF);
  const fm = new Map();
  if (isBarre) atMin.forEach(p => fm.set(`${p.si}:${p.fret}`, 1));
  let next = isBarre ? 2 : 1;
  fretted.forEach(p => {
    const key = `${p.si}:${p.fret}`;
    if (fm.has(key)) return;
    fm.set(key, Math.min(4, next)); next++;
  });
  return positions.map(p => ({ ...p, finger: p.fret > 0 ? (fm.get(`${p.si}:${p.fret}`) || 1) : 0 }));
}

// Pick ONE playable voicing (with fingers) for a chord, by position strategy:
//   'open'        → the top-priority shape (open / lowest) — comfortable, recognisable
//   { near: fret }→ the shape closest to a target fret — stay in one hand position
//   'climb'       → the lowest shape at or above `floor` — walk the chords up the neck
export function pickGrip(root, notes, qualityName, strategy = 'open', floor = 0) {
  const vs = findVoicings(root, notes, qualityName);
  if (!vs || !vs.length) return null;
  let v;
  if (strategy === 'climb') {
    const asc = [...vs].sort((a, b) => a.minFret - b.minFret || b.priority - a.priority);
    v = asc.find(x => x.minFret >= floor) || asc[asc.length - 1];
  } else if (strategy && strategy.near != null) {
    v = [...vs].sort((a, b) => Math.abs(a.minFret - strategy.near) - Math.abs(b.minFret - strategy.near) || b.priority - a.priority)[0];
  } else {
    v = vs[0];
  }
  return { positions: assignFingers(v.positions), minFret: v.minFret, maxFret: v.maxFret, name: v.name };
}

// ── Mini chord diagram SVG ───────────────────────────────────────────
export function renderMiniDiagram(voicing, rootNote, isActive, showIntervals, intervalLabel) {
  const ns = customTuning.length;
  const full = [];
  for (let si = 0; si < ns; si++) {
    const p = voicing.positions.find(x => x.si === si);
    full.push(p || { si, fret: -1, note: null });
  }
  const played  = full.filter(p => p.fret >= 0);
  const fretted = played.filter(p => p.fret > 0);
  const minF    = fretted.length ? Math.min(...fretted.map(p => p.fret)) : 1;
  const maxF    = fretted.length ? Math.max(...fretted.map(p => p.fret)) : 1;
  const startFret = minF <= 1 ? 1 : minF;
  const numFrets  = Math.max(4, maxF - startFret + 2);
  const strW  = ns <= 4 ? 12 : ns <= 6 ? 10 : 8;
  const w = 14 + ns * strW, h = 16 + numFrets * 13 + 8;
  const sx = 14, sy = 16, sw = (ns - 1) * strW, fh = (h - sy - 8) / numFrets;
  const bdr = isActive ? '#8877dd' : '#444';
  const bg  = isActive ? 'rgba(136,119,221,.12)' : 'rgba(255,255,255,.03)';
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="${bdr}" stroke-width="1"/>`;
  s += `<text x="${w/2}" y="${h-2}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" fill="#555">${voicing.name}</text>`;
  if (startFret > 1) s += `<text x="4" y="${sy+fh/2+3}" font-size="6" font-family="'JetBrains Mono',monospace" fill="#888">${startFret}fr</text>`;
  if (startFret <= 1) s += `<rect x="${sx-2}" y="${sy-2}" width="${sw+4}" height="3" rx="1" fill="#ccc"/>`;
  for (let f = 0; f <= numFrets; f++) s += `<line x1="${sx}" y1="${sy+f*fh}" x2="${sx+sw}" y2="${sy+f*fh}" stroke="#555" stroke-width="${f===0?1.5:.6}"/>`;
  for (let i = 0; i < ns; i++) s += `<line x1="${sx+i*strW}" y1="${sy}" x2="${sx+i*strW}" y2="${sy+numFrets*fh}" stroke="#777" stroke-width="${.4+(ns-1-i)*.12}"/>`;
  full.forEach((p, si) => {
    const x = sx + (ns - 1 - si) * strW;
    const dl = showIntervals && intervalLabel ? intervalLabel(rootNote, p.note) : p.note;
    if (p.fret < 0) { s += `<text x="${x}" y="${sy-4}" text-anchor="middle" font-size="6" fill="#555">✕</text>`; return; }
    if (p.fret === 0) {
      const isR = p.note === rootNote;
      s += `<circle cx="${x}" cy="${sy-5}" r="3" fill="${isR?'#8877dd':'none'}" stroke="${isR?'#8877dd':'#2a8a5a'}" stroke-width="1.2"/>`;
      if (showIntervals) s += `<text x="${x}" y="${sy-10}" text-anchor="middle" font-size="4" font-family="'JetBrains Mono',monospace" fill="#888">${dl}</text>`;
      return;
    }
    const fy = sy + (p.fret - startFret) * fh + fh / 2;
    const isR = p.note === rootNote;
    s += `<circle cx="${x}" cy="${fy}" r="4.5" fill="${isR?'#8877dd':'#2a8a5a'}"/>`;
    s += `<text x="${x}" y="${fy+2.5}" text-anchor="middle" font-size="5" font-family="'JetBrains Mono',monospace" font-weight="700" fill="#fff">${dl}</text>`;
  });
  s += '</svg>';
  return s;
}

// ── Key position zone grouping ───────────────────────────────────────
export function getKeyPositionZones(rt, km, chords) {
  const useChords = chords || getKeyChords(rt, km);
  const allChordVoicings = useChords.map((ch, ci) => {
    const vs = findVoicings(ch.root, ch.notes, ch.quality);
    return vs.map(v => ({ ...v, root: ch.root, quality: ch.quality, numeral: ch.numeral, numIdx: ci, notes: ch.notes }));
  }).flat();

  const zones = KEY_POSITION_ZONES.map(z => {
    const matching = [];
    allChordVoicings.forEach(v => {
      const played  = v.positions.filter(p => p.fret >= 0);
      const fretted = played.filter(p => p.fret > 0);
      if (fretted.length === 0 && z.lo === 0) { matching.push(v); return; }
      if (fretted.length === 0) return;
      const lo = Math.min(...fretted.map(p => p.fret));
      const hi = Math.max(...fretted.map(p => p.fret));
      if (lo >= z.lo && hi <= z.hi) matching.push(v);
    });
    const byDegree = {};
    matching.forEach(v => {
      if (!byDegree[v.numIdx] || v.priority > byDegree[v.numIdx].priority) byDegree[v.numIdx] = v;
    });
    const chordList = Object.values(byDegree).sort((a, b) => a.numIdx - b.numIdx);
    return { ...z, chords: chordList };
  });
  return { zones };
}

// ── Scale box position helpers ────────────────────────────────────────

function isFivePositionNaturalMinor(intervals) { return sameIntervals(intervals, [0,2,3,5,7,8,10]); }

function isStandardBass4Context() {
  if (currentInstrument !== 'bass4' || customTuning.length !== 4) return false;
  const std = ['G2','D2','A1','E1'];
  return customTuning.every((s,i) => `${s.note}${s.octave}` === std[i]);
}
function isStandardGuitar8Context() {
  if (currentInstrument !== 'guitar8' || customTuning.length !== 8) return false;
  const std = ['E4','B3','G3','D3','A2','E2','B1','F#1'];
  return customTuning.every((s,i) => `${s.note}${s.octave}` === std[i]);
}
function isExtendedCanonicalStringContext() {
  return isStandardBass4Context() || isStandardGuitar8Context();
}

// The piano and the Lumatone are both 'keyed' boards: no strings, no frets,
// one key per pitch. Scale boxes on either are root-to-root octave runs, and
// the hex board's MIDI span comfortably covers the piano's C2..C6, so the
// keyboard box engine serves both without knowing which one is on screen.
function isKeyedRenderer() {
  const r = getInst().renderer;
  return r === 'keyboard' || r === 'hex';
}

function getInstrumentPositionProfile() {
  const ns = customTuning.length;
  if (isKeyedRenderer()) return { maxSpan:12, maxNPS:8, minCoveredStrings:0 };
  if (currentInstrument === 'mandolin') return { maxSpan:4, maxNPS:3, minCoveredStrings:3 };
  if (currentInstrument === 'banjo5')   return { maxSpan:4, maxNPS:3, minCoveredStrings:4 };
  if (currentInstrument === 'bass4')    return { maxSpan:4, maxNPS:3, minCoveredStrings:3 };
  if (currentInstrument === 'guitar8')  return { maxSpan:4, maxNPS:3, minCoveredStrings:5 };
  return { maxSpan:3, maxNPS:3, minCoveredStrings:Math.max(4, ns-2) };
}

function getKeyboardVisibleNotes(root, intervals) {
  const g = pianoGeo();
  const scaleSet = new Set(getScaleNotes(root, intervals));
  const out = [];
  for (let o = g.startOct; o <= g.startOct + g.octs; o++) {
    for (let semi = 0; semi < 12; semi++) {
      const note = NOTES[semi];
      if (!scaleSet.has(note)) continue;
      out.push({ note, octave:o, midi:o*12+semi, isRoot:note===root, deg:(semi-NOTES.indexOf(root)+12)%12 });
    }
  }
  return out.sort((a,b) => a.midi - b.midi);
}

function findKeyboardScaleBoxes(root, intervals) {
  const visible = getKeyboardVisibleNotes(root, intervals);
  const roots = visible.filter(n => n.isRoot).sort((a,b) => a.midi - b.midi);
  if (roots.length < 2) return [];
  const desired = Math.min(5, roots.length-1);
  const picks = [];
  for (let i = 0; i < desired; i++) {
    const idx = Math.round(i * ((roots.length-2)) / Math.max(1, desired-1));
    if (!picks.includes(idx)) picks.push(idx);
  }
  while (picks.length < desired) {
    const next = picks.length;
    if (next < roots.length-1 && !picks.includes(next)) picks.push(next); else break;
  }
  return picks.map((rootIdx, boxIdx) => {
    const startRoot = roots[rootIdx];
    const endRoot   = roots[Math.min(rootIdx+1, roots.length-1)];
    const positions = visible.filter(n => n.midi >= startRoot.midi && n.midi <= endRoot.midi);
    const loOct = Math.min(...positions.map(p => p.octave));
    const hiOct = Math.max(...positions.map(p => p.octave));
    return { sf:startRoot.octave, lo:loOct, hi:hiOct, label:`Pos ${boxIdx+1}`, positions, totalNotes:positions.length, canonical:true, keyboard:true, rootToRoot:true };
  });
}

// ── Canonical template helpers ────────────────────────────────────────

function getCanonicalAnchorFret(root, templateRootFret, templateMin, templateMax) {
  const nf = getInst().frets;
  const targetPc = NOTES.indexOf(root);
  const lowOpenPc = NOTES.indexOf(customTuning[5]?.note || customTuning[customTuning.length-1].note);
  const candidates = [];
  for (let fret = 0; fret <= nf; fret++) {
    if ((lowOpenPc + fret) % 12 !== targetPc) continue;
    const delta = fret - templateRootFret;
    if (templateMin + delta < 0 || templateMax + delta > nf) continue;
    candidates.push(fret);
  }
  if (!candidates.length) return null;
  return candidates.sort((a,b) => Math.abs(a-templateRootFret) - Math.abs(b-templateRootFret) || a-b)[0];
}
function getCanonicalMajorAnchorFret(root) { return getCanonicalAnchorFret(root, 3, 2, 15); }

function normalizePitchDelta(referenceRoot, targetRoot) {
  let delta = NOTES.indexOf(targetRoot) - NOTES.indexOf(referenceRoot);
  if (delta > 6)  delta -= 12;
  if (delta < -6) delta += 12;
  return delta;
}

function chooseTemplateOctaveShift(baseFrets, nf, opts={}) {
  const fits = [-24,-12,0,12,24].filter(shift => baseFrets.every(f => f+shift >= 0 && f+shift <= nf));
  if (!fits.length) return 0;
  if (opts.preferLow) return fits.sort((a,b) => (Math.min(...baseFrets.map(f=>f+a)) - Math.min(...baseFrets.map(f=>f+b))) || a-b)[0];
  return fits.sort((a,b) => {
    const aFrets = baseFrets.map(f=>f+a), bFrets = baseFrets.map(f=>f+b);
    const aScore = Math.abs(((Math.min(...aFrets)+Math.max(...aFrets))/2) - (nf/2)) + Math.min(...aFrets)/100;
    const bScore = Math.abs(((Math.min(...bFrets)+Math.max(...bFrets))/2) - (nf/2)) + Math.min(...bFrets)/100;
    return aScore - bScore;
  })[0];
}

function shiftCanonicalBoxByOctave(positions, shift, root, rootIdx) {
  return positions.map(p => {
    const fret = p.fret + shift;
    if (fret < 0 || fret > getInst().frets) return null;
    const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
    return { si:p.si, fret, note:info.note, octave:info.octave,
      midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
      deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 };
  }).filter(Boolean).sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
}

function maybeApplyCanonicalLowRegisterOverride(root, boxIndex, positions, rootIdx) {
  if (root !== 'C') return positions;
  if (boxIndex === 2 || boxIndex === 3 || boxIndex === 4) {
    const shifted = shiftCanonicalBoxByOctave(positions, -12, root, rootIdx);
    if (shifted.length === positions.length) return shifted;
  }
  return positions;
}

function buildCanonicalBoxesFromTemplates(root, templates, anchorFret, templateRootFret, opts={}) {
  if (anchorFret === null) return null;
  const delta = anchorFret - templateRootFret;
  const rootIdx = NOTES.indexOf(root);
  return templates.map((tmpl, i) => {
    let positions = tmpl.map(p => {
      const fret = p.fret + delta;
      const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
      return { si:p.si, fret, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:p.deg===0,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 };
    }).sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    if (opts.lowRegisterOverride) positions = opts.lowRegisterOverride(root, i, positions, rootIdx);
    const lo = Math.min(...positions.map(p=>p.fret));
    const hi = Math.max(...positions.map(p=>p.fret));
    return { sf:lo, lo, hi, label:`Pos ${i+1}`, positions, totalNotes:positions.length, canonical:true };
  });
}

function buildCanonicalBoxesFromReference(root, templates, referenceRoot, opts={}) {
  const nf = getInst().frets;
  const rootIdx = NOTES.indexOf(root);
  const delta = normalizePitchDelta(referenceRoot, root);
  return templates.map((tmpl, i) => {
    const baseFrets = tmpl.map(p => p.fret + delta);
    const octaveShift = chooseTemplateOctaveShift(baseFrets, nf, opts.boxShiftPreferences?.[i] || opts);
    let positions = tmpl.map(p => {
      const fret = p.fret + delta + octaveShift;
      const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
      return { si:p.si, fret, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 };
    }).sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    if (opts.lowRegisterOverride) positions = opts.lowRegisterOverride(root, i, positions, rootIdx);
    const allowed = opts.allowedDegs;
    if (allowed) positions = positions.filter(p => allowed.has(p.deg));
    const lo = Math.min(...positions.map(p=>p.fret));
    const hi = Math.max(...positions.map(p=>p.fret));
    return { sf:lo, lo, hi, label:`Pos ${i+1}`, positions, totalNotes:positions.length, canonical:true };
  }).filter(box => box.positions.length);
}

function buildCanonicalSubsetBoxesFromReference(root, templates, referenceRoot, allowedDegs, opts={}) {
  return buildCanonicalBoxesFromReference(root, templates, referenceRoot, { ...opts, allowedDegs: new Set(allowedDegs) });
}

function buildCanonicalMajorBoxes(root) {
  return buildCanonicalBoxesFromTemplates(root, CANONICAL_MAJOR_TEMPLATE_BOXES,
    getCanonicalMajorAnchorFret(root), 3, { lowRegisterOverride: maybeApplyCanonicalLowRegisterOverride });
}
function buildCanonicalMajorPentBoxes(root) {
  return buildCanonicalBoxesFromReference(root, CANONICAL_MAJOR_PENT_TEMPLATE_BOXES, 'G',
    { boxShiftPreferences: { 3:{preferLow:true}, 4:{preferLow:true} } });
}
function buildCanonicalMinorPentBoxes(root) {
  return buildCanonicalBoxesFromReference(root, CANONICAL_MINOR_PENT_TEMPLATE_BOXES, 'G',
    { boxShiftPreferences: { 3:{preferLow:true}, 4:{preferLow:true} } });
}

function isSubsetIntervals(intervals, reference) {
  const ref = new Set(reference);
  return intervals.every(v => ref.has(v));
}
function buildCanonicalSubsetBoxes(root, intervals) {
  if (isSubsetIntervals(intervals, [0,2,4,7,9]))
    return buildCanonicalSubsetBoxesFromReference(root, CANONICAL_MAJOR_PENT_TEMPLATE_BOXES, 'G', intervals, { boxShiftPreferences:{3:{preferLow:true},4:{preferLow:true}} });
  if (isSubsetIntervals(intervals, [0,3,5,7,10]))
    return buildCanonicalSubsetBoxesFromReference(root, CANONICAL_MINOR_PENT_TEMPLATE_BOXES, 'G', intervals, { boxShiftPreferences:{3:{preferLow:true},4:{preferLow:true}} });
  if (isSubsetIntervals(intervals, [0,2,4,5,7,9,11]))
    return buildCanonicalSubsetBoxesFromReference(root, CANONICAL_MAJOR_TEMPLATE_BOXES, 'G', intervals, { boxShiftPreferences:{2:{preferLow:root==='C'},3:{preferLow:root==='C'},4:{preferLow:root==='C'}} });
  return null;
}

const MODE_PARENT_MAJOR_OFFSETS = { Ionian:0, Dorian:-2, Phrygian:-4, Lydian:-5, Mixolydian:-7, Aeolian:-9, Locrian:-11 };
const MODE_START_BOX_INDEX = { Ionian:0, Dorian:1, Phrygian:2, Lydian:2, Mixolydian:3, Aeolian:4, Locrian:0 };

function transposeNote(note, semitones) { return NOTES[(NOTES.indexOf(note)+semitones+120)%12]; }

// Octave-drop a box that sits high on the neck (flat-key minors/modes anchor at
// fret 19-23 because the parent major anchor is high) so the position set spans the
// playable neck instead of clustering at the top. Pitch classes are preserved, so
// the box shape and degrees are identical — only the register changes. 2026-06-14.
function normalizeBoxToLowRegister(positions) {
  let cur = positions, lo = Math.min(...cur.map(p => p.fret));
  while (lo >= 12 && cur.every(p => p.fret - 12 >= 0)) {
    cur = cur.map(p => {
      const fret = p.fret - 12;
      const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
      return { ...p, fret, octave:info.octave, midi:info.octave*12+NOTES.indexOf(info.note) };
    });
    lo = Math.min(...cur.map(p => p.fret));
  }
  return cur;
}

function buildCanonicalModeBoxes(root, modeName) {
  const parentOffset = MODE_PARENT_MAJOR_OFFSETS[modeName];
  const startIdx = MODE_START_BOX_INDEX[modeName];
  if (parentOffset === undefined || startIdx === undefined) return null;
  const parentRoot = transposeNote(root, parentOffset);
  const parentBoxes = buildCanonicalMajorBoxes(parentRoot);
  if (!parentBoxes || !parentBoxes.length) return null;
  const intervals = SCALE_TYPES.Modes[modeName];
  const allowed = new Set(intervals);
  const rootIdx = NOTES.indexOf(root);
  const reordered = [];
  for (let k = 0; k < parentBoxes.length; k++) {
    const src = parentBoxes[(startIdx+k) % parentBoxes.length];
    let positions = src.positions.map(p => {
      const deg = (NOTES.indexOf(p.note)-rootIdx+12) % 12;
      return { ...p, isRoot: p.note===root, deg };
    }).filter(p => allowed.has(p.deg));
    if (!positions.length) continue;
    positions = normalizeBoxToLowRegister(positions);
    positions.sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    const lo = Math.min(...positions.map(p=>p.fret));
    const hi = Math.max(...positions.map(p=>p.fret));
    reordered.push({ sf:lo, lo, hi, label:`Pos ${k+1}`, positions, totalNotes:positions.length, canonical:true, modeDerived:true });
  }
  // Order the cards low→high on the neck and re-label so Pos 1 is the lowest box.
  reordered.sort((a,b) => a.lo-b.lo || a.hi-b.hi);
  reordered.forEach((b,i) => { b.label = `Pos ${i+1}`; });
  return reordered;
}

// Harmonic/melodic minor = the natural-minor (Aeolian) positions with raised degrees.
// raiseMap maps a natural-minor degree to its raised form: {10:11}=♭7→7 (harmonic),
// {8:9,10:11}=♭6→6 & ♭7→7 (melodic). Each raised note shifts up one fret on its string,
// preserving the playable box shape. Audit-driven 2026-06-14.
function deriveAlteredMinorBoxes(root, raiseMap) {
  const aeolian = buildCanonicalModeBoxes(root, 'Aeolian');
  if (!aeolian || !aeolian.length) return null;
  const rootIdx = NOTES.indexOf(root), nf = getInst().frets;
  return aeolian.map(box => {
    const positions = box.positions.map(p => {
      if (raiseMap[p.deg] === undefined) return p;
      const fret = p.fret + 1;
      if (fret > nf) return null;
      const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
      return { si:p.si, fret, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 };
    }).filter(Boolean).sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    if (!positions.length) return null;
    const lo = Math.min(...positions.map(p=>p.fret)), hi = Math.max(...positions.map(p=>p.fret));
    return { sf:lo, lo, hi, label:box.label, positions, totalNotes:positions.length, canonical:true };
  }).filter(Boolean);
}

// Blues = pentatonic positions + the "blue note" (♭5 for minor blues / ♭3 for major blues)
// added wherever it falls inside each pentatonic box window.
function deriveBluesBoxes(root, pentBoxes, blueDeg) {
  if (!pentBoxes || !pentBoxes.length) return null;
  const rootIdx = NOTES.indexOf(root), bluePc = (rootIdx + blueDeg) % 12;
  return pentBoxes.map(box => {
    const positions = box.positions.map(p => ({ ...p }));
    for (let si = 0; si < customTuning.length; si++) {
      for (let f = box.lo; f <= box.hi; f++) {
        const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
        if (NOTES.indexOf(info.note) === bluePc && !positions.some(p => p.si === si && p.fret === f))
          positions.push({ si, fret:f, note:info.note, octave:info.octave,
            midi:info.octave*12+bluePc, isRoot:false, deg:blueDeg });
      }
    }
    positions.sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    return { ...box, positions, totalNotes:positions.length };
  });
}

// Symmetric scales (whole-tone, diminished) repeat every `period` frets, so they
// have only `period` unique fretboard shapes — padding to 5 just duplicates them.
// Each box is a low-register hand-span window holding up to `nps` scale notes/string.
// getDisplayPositionsForBox octave-spreads each shape across the neck. 2026-06-14.
function buildSymmetricScaleBoxes(root, intervals, period, nps) {
  const ns = customTuning.length, nf = getInst().frets;
  const scaleSet = new Set(getScaleNotes(root, intervals));
  const rootIdx = NOTES.indexOf(root);
  const boxes = [];
  for (let k = 0; k < period; k++) {
    const lo = k;
    const positions = [];
    for (let si = ns-1; si >= 0; si--) {
      let count = 0;
      for (let f = lo; f <= Math.min(nf, lo + 4); f++) {
        const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
        if (!scaleSet.has(info.note)) continue;
        positions.push({ si, fret:f, note:info.note, octave:info.octave,
          midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
          deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
        if (++count >= nps) break;
      }
    }
    if (!positions.length) continue;
    positions.sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    const bl = Math.min(...positions.map(p=>p.fret)), bh = Math.max(...positions.map(p=>p.fret));
    boxes.push({ sf:bl, lo:bl, hi:bh, label:`Pos ${k+1}`, positions, totalNotes:positions.length, canonical:true });
  }
  return boxes.length ? boxes : null;
}

function buildSymmetricBoxesForIntervals(root, intervals) {
  if (sameIntervals(intervals, [0,2,4,6,8,10]))      return buildSymmetricScaleBoxes(root, intervals, 2, 3); // whole tone
  if (sameIntervals(intervals, [0,2,3,5,6,8,9,11]))  return buildSymmetricScaleBoxes(root, intervals, 3, 3); // dim W-H
  if (sameIntervals(intervals, [0,1,3,4,6,7,9,10]))  return buildSymmetricScaleBoxes(root, intervals, 3, 3); // dim H-W
  return null;
}

// N-notes-per-string scale fingerings — the alternative to CAGED boxes. Each position
// plays exactly `nps` consecutive scale tones on every string, walking up the neck. One
// position is anchored on each scale degree, then they're sorted low→high. Works for any
// scale/root/tuning. Used by the Technique Workshop's "3/4 per string" practice modes.
export function buildNpsBoxes(root, intervals, nps) {
  if (!customTuning.length || !intervals.length) return null;
  const ns = customTuning.length, nf = getInst().frets;
  const rootIdx = NOTES.indexOf(root);
  const scaleSet = new Set(getScaleNotes(root, intervals));
  const lowSi = ns - 1;
  const orderedDegs = [...intervals].sort((a, b) => a - b);
  const k = orderedDegs.length;
  // Every scale tone per string, ascending by fret.
  const perString = [];
  for (let si = 0; si < ns; si++) {
    const arr = [];
    for (let f = 0; f <= nf; f++) {
      const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
      if (!scaleSet.has(info.note)) continue;
      arr.push({ si, fret:f, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
    }
    perString.push(arr);
  }
  const boxes = [], seen = new Set();
  for (let startIdx = 0; startIdx < k; startIdx++) {
    const startNotes = perString[lowSi].filter(p => p.deg === orderedDegs[startIdx]);
    if (!startNotes.length) continue;
    const positions = [];
    let degPtr = startIdx, minFret = startNotes[0].fret, ok = true;
    for (let si = lowSi; si >= 0; si--) {
      let searchFret = si === lowSi ? startNotes[0].fret : Math.max(0, minFret - 1);
      const strNotes = [];
      for (let n = 0; n < nps; n++) {
        const wantDeg = orderedDegs[degPtr % k];
        const found = perString[si].find(p => p.deg === wantDeg && p.fret >= searchFret);
        if (!found) { ok = false; break; }
        strNotes.push(found);
        searchFret = found.fret + 1;
        degPtr++;
      }
      if (!ok) break;
      positions.push(...strNotes);
      minFret = strNotes[0].fret;
    }
    if (!ok || !positions.length) continue;
    positions.sort((a, b) => b.si - a.si || a.fret - b.fret || a.midi - b.midi);
    const sig = positions.map(p => `${p.si}:${p.fret}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const lo = Math.min(...positions.map(p => p.fret)), hi = Math.max(...positions.map(p => p.fret));
    boxes.push({ sf:lo, lo, hi, label:'', positions, totalNotes:positions.length, canonical:true, nps, noOctaveDup:true });
  }
  boxes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  boxes.forEach((b, i) => { b.label = `${nps}nps · Pos ${i + 1}`; });
  return boxes.length ? boxes : null;
}

// ── Extended instrument boxes (8-string, bass) ────────────────────────

function adjustExtendedCanonicalWindow(root, boxIndex, window) {
  let { lo, hi } = window;
  if (currentInstrument === 'guitar8') {
    if (root === 'C') {
      if (boxIndex === 0) return { lo:3, hi:6 };
      if (boxIndex === 3) return { lo:8, hi:12 };
    }
  }
  return { lo, hi };
}

function adjustGuitar8CanonicalPositions(root, intervals, boxIndex, lo, hi, positions, scaleSet, rootIdx) {
  if (currentInstrument !== 'guitar8') return positions;
  const addIfScale = (si, fret) => {
    if (fret < 0 || fret > getInst().frets) return;
    const key = `${si}:${fret}`;
    if (positions.some(p => `${p.si}:${p.fret}` === key)) return;
    const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    if (!scaleSet.has(info.note)) return;
    positions.push({ si, fret, note:info.note, octave:info.octave,
      midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
      deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
  };
  if (boxIndex === 0) { [6,7].forEach(si => { addIfScale(si, lo-1); addIfScale(si, hi); }); }
  if (boxIndex === 3) { positions = positions.filter(p => p.fret !== lo); }
  return positions;
}

function adjustBassCanonicalPositions(root, intervals, boxIndex, lo, hi, positions, scaleSet, rootIdx) {
  if (currentInstrument !== 'bass4') return positions;
  const addIfScale = (si, fret) => {
    if (fret < 0 || fret > getInst().frets) return;
    const key = `${si}:${fret}`;
    if (positions.some(p => `${p.si}:${p.fret}` === key)) return;
    const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
    if (!scaleSet.has(info.note)) return;
    positions.push({ si, fret, note:info.note, octave:info.octave,
      midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
      deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
  };
  if (boxIndex === 1) { [0,1].forEach(si => addIfScale(si, lo-1)); }
  if (boxIndex === 4) { addIfScale(0, lo-1); }
  return positions;
}

function populateCanonicalWindowForInstrument(root, intervals, sourceBox, boxIndex) {
  const ns = customTuning.length, nf = getInst().frets;
  const scaleSet = new Set(getScaleNotes(root, intervals));
  const rootIdx = NOTES.indexOf(root);
  const lo = Math.max(0, sourceBox.lo), hi = Math.min(nf, sourceBox.hi);
  let positions = [];
  for (let si = 0; si < ns; si++) {
    const stringPositions = [];
    for (let fret = lo; fret <= hi; fret++) {
      const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, fret);
      if (!scaleSet.has(info.note)) continue;
      stringPositions.push({ si, fret, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
    }
    positions.push(...stringPositions.slice(0,4));
  }
  positions = adjustGuitar8CanonicalPositions(root, intervals, boxIndex, lo, hi, positions, scaleSet, rootIdx);
  positions = adjustBassCanonicalPositions(root, intervals, boxIndex, lo, hi, positions, scaleSet, rootIdx);
  const dedup = new Map();
  positions.forEach(p => dedup.set(`${p.si}:${p.fret}`, p));
  const out = [...dedup.values()].sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
  if (!out.length) return null;
  return { sf:lo, lo, hi, label:sourceBox.label, positions:out, totalNotes:out.length, canonical:true, sourceCanonical:true };
}

function getExtendedWindowBaseBoxes(kind) {
  const presets = {
    major:    [[2,5],[5,8],[7,10],[8,13],[12,15]],
    majorPent:[[2,5],[4,8],[7,10],[9,12],[12,15]],
    minorPent:[[3,6],[5,8],[7,11],[10,13],[12,15]],
    aeolian:  [[2,5],[4,7],[5,8],[7,10],[10,13]],
    mode:     [[2,5],[5,8],[7,10],[8,13],[12,15]]
  };
  return (presets[kind] || []).map((pair, i) => ({ lo:pair[0], hi:pair[1], label:`Pos ${i+1}`, canonical:true }));
}

function shiftExtendedWindowBoxes(boxes, referenceRoot, targetRoot, opts={}) {
  const delta = normalizePitchDelta(referenceRoot, targetRoot);
  const nf = getInst().frets;
  return boxes.map((box, i) => {
    let lo = box.lo+delta, hi = box.hi+delta;
    const fits = [-24,-12,0,12,24].filter(shift => lo+shift >= 0 && hi+shift <= nf);
    if (fits.length) {
      const preferLow = !!(opts.boxShiftPreferences?.[i]?.preferLow || opts.preferLow);
      const chosen = preferLow
        ? fits.sort((a,b) => (lo+a)-(lo+b) || a-b)[0]
        : fits.sort((a,b) => {
            const aMid=((lo+a)+(hi+a))/2, bMid=((lo+b)+(hi+b))/2;
            return Math.abs(aMid-(nf/2)) - Math.abs(bMid-(nf/2)) || (lo+a)-(lo+b);
          })[0];
      lo += chosen; hi += chosen;
    }
    if (opts.lowRegisterOverride) {
      const out = opts.lowRegisterOverride(targetRoot, i, {lo,hi}) || {lo,hi};
      lo = out.lo; hi = out.hi;
    }
    return { lo, hi, label:`Pos ${i+1}`, canonical:true };
  });
}

function getExtendedSourceBoxesForArpeggioIntervals(root, intervals, opts={}) {
  const sig = (intervals||[]).join(',');
  const majorKinds = new Set(['0,4,7','0,4,7,11','0,4,7,10','0,4,7,9','0,2,7','0,5,7','0,4,8','0,4,8,10']);
  const minorKinds = new Set(['0,3,7','0,3,7,10','0,3,7,9','0,3,7,11']);
  const diminishedKinds = new Set(['0,3,6','0,3,6,9','0,3,6,10']);
  if (majorKinds.has(sig))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('major'), 'G', root, { lowRegisterOverride:adjustExtendedCanonicalWindow });
  if (minorKinds.has(sig) || diminishedKinds.has(sig))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('aeolian'), 'A', root, { boxShiftPreferences:{4:{preferLow:true}}, lowRegisterOverride:adjustExtendedCanonicalWindow });
  return null;
}

function getExtendedSourceBoxesForIntervals(root, intervals, opts={}) {
  const majorOpts = { lowRegisterOverride: adjustExtendedCanonicalWindow };
  const minorOpts = { boxShiftPreferences:{4:{preferLow:true}}, lowRegisterOverride: adjustExtendedCanonicalWindow };
  const majorPentOpts = { lowRegisterOverride: adjustExtendedCanonicalWindow };
  const minorPentOpts = { boxShiftPreferences:{3:{preferLow:true},4:{preferLow:true}}, lowRegisterOverride: adjustExtendedCanonicalWindow };

  if (isFivePositionMajorScale(intervals))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('major'), 'G', root, majorOpts);
  if (isFivePositionNaturalMinor(intervals))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('aeolian'), 'A', root, minorOpts);
  if (isFivePositionMajorPentatonic(intervals))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('majorPent'), 'G', root, majorPentOpts);
  if (isFivePositionMinorPentatonic(intervals))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('minorPent'), 'G', root, minorPentOpts);
  if (opts.scaleCat === 'Modes' && opts.scaleName && SCALE_TYPES.Modes[opts.scaleName]) {
    const modeName = opts.scaleName;
    const modeToKind = { Ionian:'major', Dorian:'aeolian', Phrygian:'aeolian', Lydian:'major', Mixolydian:'major', Aeolian:'aeolian', Locrian:'aeolian' };
    const kind = modeToKind[modeName] || 'major';
    const refRootMap = { Ionian:'G', Dorian:'A', Phrygian:'B', Lydian:'C', Mixolydian:'D', Aeolian:'E', Locrian:'F#' };
    const shiftOpts = kind === 'aeolian' ? minorOpts : majorOpts;
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes(kind), refRootMap[modeName] || 'G', root, shiftOpts);
  }
  if (opts.scaleCat === 'Blues') {
    const kind = opts.scaleName === 'Blues Major' ? 'majorPent' : 'minorPent';
    const shiftOpts = kind === 'majorPent' ? majorPentOpts : minorPentOpts;
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes(kind), 'G', root, shiftOpts);
  }
  if (opts.scaleCat === 'Diatonic' && (opts.scaleName === 'Harm. Minor' || opts.scaleName === 'Mel. Minor'))
    return shiftExtendedWindowBoxes(getExtendedWindowBaseBoxes('aeolian'), 'A', root, minorOpts);
  return getExtendedSourceBoxesForArpeggioIntervals(root, intervals, opts);
}

function buildExtendedCanonicalInstrumentBoxes(root, intervals, opts={}) {
  const sourceBoxes = getExtendedSourceBoxesForIntervals(root, intervals, opts);
  if (!sourceBoxes || !sourceBoxes.length) return null;
  const boxes = sourceBoxes.map((box,i) => populateCanonicalWindowForInstrument(root, intervals, box, i))
    .filter(Boolean)
    .map((box,i) => ({ ...box, noOctaveDup: currentInstrument === 'guitar8' && i === 3 }));
  return boxes.length ? boxes : null;
}

function reduceBoxesToFivePositions(boxes) {
  if (boxes.length <= 5) return boxes;
  const sorted = [...boxes].sort((a,b) => a.lo-b.lo || a.hi-b.hi || b.totalNotes-a.totalNotes);
  const clusters = [];
  sorted.forEach(box => {
    const last = clusters[clusters.length-1];
    if (!last || box.lo-last[last.length-1].lo > 2) clusters.push([box]);
    else last.push(box);
  });
  const ranked = clusters.map(group => group.slice().sort((a,b) => {
    const aSpan=a.hi-a.lo, bSpan=b.hi-b.lo;
    const aScore=a.totalNotes*10-aSpan-Math.abs((a.lo+a.hi)/2-7);
    const bScore=b.totalNotes*10-bSpan-Math.abs((b.lo+b.hi)/2-7);
    return bScore-aScore;
  })[0]);
  if (ranked.length <= 5) return ranked.map((box,i) => ({
    ...box, label: box.lo===0 ? `Pos ${i+1} (Open)` : box.hi-box.lo<=3 ? `Pos ${i+1} (Fret ${box.lo})` : `Pos ${i+1} (${box.lo}-${box.hi})`
  }));
  const picks = [];
  const lastIdx = ranked.length-1;
  [0, lastIdx/4, lastIdx/2, (lastIdx*3)/4, lastIdx].map(v => Math.round(v)).forEach(idx => { if (!picks.includes(idx)) picks.push(idx); });
  let cursor = 0;
  while (picks.length < 5 && cursor < ranked.length) { if (!picks.includes(cursor)) picks.push(cursor); cursor++; }
  picks.sort((a,b) => a-b);
  return picks.slice(0,5).map((idx,i) => {
    const box = ranked[idx];
    return { ...box, label: box.lo===0 ? `Pos ${i+1} (Open)` : box.hi-box.lo<=3 ? `Pos ${i+1} (Fret ${box.lo})` : `Pos ${i+1} (${box.lo}-${box.hi})` };
  });
}

function reduceBoxesToRepresentativePositions(boxes, intervals) {
  if (!boxes.length) return boxes;
  const grouped = new Map();
  boxes.forEach(box => {
    const sig = box.positions.map(p => `${p.si}:${((p.fret%12)+12)%12}`).sort().join('|');
    const arr = grouped.get(sig) || [];
    arr.push(box);
    grouped.set(sig, arr);
  });
  let deduped = [...grouped.values()].map(group => group.slice().sort((a,b) => {
    const aOpen=a.lo===0?1:0, bOpen=b.lo===0?1:0;
    return bOpen-aOpen || a.lo-b.lo || a.hi-b.hi || b.totalNotes-a.totalNotes;
  })[0]).sort((a,b) => a.lo-b.lo || a.hi-b.hi);
  const targetMax = intervals.length >= 3 ? 5 : Math.min(5, deduped.length);
  if (deduped.length > targetMax) deduped = reduceBoxesToFivePositions(deduped).slice(0, targetMax);
  return deduped.map((box,i) => ({
    ...box,
    label: box.lo===0 ? `Pos ${i+1} (Open)` : box.hi-box.lo<=3 ? `Pos ${i+1} (Fret ${box.lo})` : `Pos ${i+1} (${box.lo}-${box.hi})`
  }));
}

// ── Main exported scale box functions ────────────────────────────────

export function getDisplayPositionsForBox(box, root) {
  if (!box || !box.positions) return null;
  if (isKeyedRenderer()) {
    return box.positions.map(p => ({...p})).sort((a,b) => a.midi - b.midi);
  }
  const rootIdx = NOTES.indexOf(root);
  const nf = getInst().frets;
  const seen = new Set();
  const out = [];
  const shifts = box.noOctaveDup ? [0] : [-12, 0, 12];
  shifts.forEach(shift => {
    box.positions.forEach(p => {
      const fret = p.fret + shift;
      if (fret < 0 || fret > nf) return;
      const key = `${p.si}:${fret}`;
      if (seen.has(key)) return;
      seen.add(key);
      const info = getNoteAtFret(customTuning[p.si].note, customTuning[p.si].octave, fret);
      out.push({ si:p.si, fret, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
    });
  });
  return out.sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
}

export function findScaleBoxes(root, intervals, opts={}) {
  if (isKeyedRenderer()) return findKeyboardScaleBoxes(root, intervals);
  if (isExtendedCanonicalStringContext()) {
    const extended = buildExtendedCanonicalInstrumentBoxes(root, intervals, opts);
    if (extended && extended.length) return extended;
  }
  if (isStandardMajorPatternContext()) {
    if (opts.scaleCat === 'Modes' && opts.scaleName && SCALE_TYPES.Modes[opts.scaleName]) {
      const modal = buildCanonicalModeBoxes(root, opts.scaleName);
      if (modal && modal.length) return modal;
    }
    // Symmetric scales (whole tone, diminished) — period-based shapes, no generic window.
    const symmetric = buildSymmetricBoxesForIntervals(root, intervals);
    if (symmetric && symmetric.length) return symmetric;
    // Natural minor IS the Aeolian mode (same notes as its relative major) — give it the
    // proper 5 relative-major positions instead of the generic window (which finds only 2).
    if (isFivePositionNaturalMinor(intervals)) {
      const aeolian = buildCanonicalModeBoxes(root, 'Aeolian');
      if (aeolian && aeolian.length) return aeolian;
    }
    // Harmonic / melodic minor — derive from the natural-minor positions with raised degrees.
    if (sameIntervals(intervals, [0,2,3,5,7,8,11])) {
      const b = deriveAlteredMinorBoxes(root, { 10: 11 });
      if (b && b.length) return b;
    }
    if (sameIntervals(intervals, [0,2,3,5,7,9,11])) {
      const b = deriveAlteredMinorBoxes(root, { 8: 9, 10: 11 });
      if (b && b.length) return b;
    }
    // Blues — pentatonic positions plus the blue note.
    if (opts.scaleCat === 'Blues') {
      const pent = opts.scaleName === 'Blues Major' ? buildCanonicalMajorPentBoxes(root) : buildCanonicalMinorPentBoxes(root);
      const b = deriveBluesBoxes(root, pent, opts.scaleName === 'Blues Major' ? 3 : 6);
      if (b && b.length) return b;
    }
    if (isFivePositionMajorScale(intervals)) {
      const canonical = buildCanonicalMajorBoxes(root);
      if (canonical && canonical.length) return canonical;
    }
    if (isFivePositionMajorPentatonic(intervals)) {
      const canonical = buildCanonicalMajorPentBoxes(root);
      if (canonical && canonical.length) return canonical;
    }
    if (isFivePositionMinorPentatonic(intervals)) {
      const canonical = buildCanonicalMinorPentBoxes(root);
      if (canonical && canonical.length) return canonical;
    }
    const canonicalSubset = buildCanonicalSubsetBoxes(root, intervals);
    if (canonicalSubset && canonicalSubset.length) return canonicalSubset;
  }
  const ns = customTuning.length, nf = getInst().frets;
  const scaleSet = new Set(getScaleNotes(root, intervals));
  const rootIdx = NOTES.indexOf(root);
  const profile = getInstrumentPositionProfile();
  const maxSpan = profile.maxSpan, maxNPS = profile.maxNPS;
  const boxes = [], seen = new Set();
  const stringNotes = [];
  for (let si = 0; si < ns; si++) {
    const frets = [];
    for (let f = 0; f <= nf; f++) {
      const info = getNoteAtFret(customTuning[si].note, customTuning[si].octave, f);
      if (!scaleSet.has(info.note)) continue;
      frets.push({ si, fret:f, note:info.note, octave:info.octave,
        midi:info.octave*12+NOTES.indexOf(info.note), isRoot:info.note===root,
        deg:(NOTES.indexOf(info.note)-rootIdx+12)%12 });
    }
    stringNotes.push(frets);
  }
  for (let sf = 0; sf <= nf; sf++) {
    const searchLo = sf === 0 ? 0 : sf;
    const searchHi = Math.min(nf, sf+maxSpan);
    const positions = [];
    let hasRoot = false, coveredStrings = 0;
    for (let si = 0; si < ns; si++) {
      const candidates = stringNotes[si].filter(n => n.fret >= searchLo && n.fret <= searchHi);
      if (!candidates.length) continue;
      coveredStrings++;
      let chosen = candidates.slice(0, maxNPS);
      if (sf === 0 && searchHi <= 4) chosen = chosen.filter(n => n.fret <= searchHi).slice(0, maxNPS);
      chosen.forEach(p => { if (p.isRoot) hasRoot = true; positions.push({...p}); });
    }
    const minCovered = Math.min(ns, profile.minCoveredStrings || Math.max(3, ns-1));
    if (!hasRoot || coveredStrings < minCovered || positions.length < Math.max(ns, Math.min(ns*2, 6))) continue;
    positions.sort((a,b) => b.si-a.si || a.fret-b.fret || a.midi-b.midi);
    const lo = Math.min(...positions.map(p=>p.fret));
    const hi = Math.max(...positions.map(p=>p.fret));
    const key = positions.map(p => `${p.si}:${p.fret}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const label = lo===0 ? `Pos ${boxes.length+1} (Open)` : hi-lo<=maxSpan ? `Pos ${boxes.length+1} (Fret ${lo})` : `Pos ${boxes.length+1} (${lo}-${hi})`;
    boxes.push({ sf:lo, lo, hi, label, positions, totalNotes:positions.length });
  }
  return reduceBoxesToRepresentativePositions(boxes, intervals);
}
