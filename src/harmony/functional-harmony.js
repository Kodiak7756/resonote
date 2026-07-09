// ── Functional harmony helpers ───────────────────────────────────────
// Secondary dominants, modal-interchange (borrowed) chords, diatonic 7ths,
// and display helpers — used by the Circle of Fifths "harmony hub".
import { NOTES, CHORD_TYPES, getKeyChords } from '../core/music-theory.js';

const pc = n => NOTES.indexOf(n);
const at = (root, semi) => NOTES[((pc(root) + (semi % 12)) % 12 + 12) % 12];

// Which CHORD_TYPES category a type name lives in (for chord-directory push).
export function catOfType(type) {
  for (const [cat, types] of Object.entries(CHORD_TYPES)) if (type in types) return cat;
  return 'Triads';
}

// Short display suffix for a chord type/quality.
export function qualSuffix(q) {
  return {
    Major: '', Minor: 'm', Dim: '°', Aug: '+', Sus2: 'sus2', Sus4: 'sus4',
    Maj7: 'maj7', '7 (Dom)': '7', Min7: 'm7', 'm7♭5': 'ø7', Dim7: '°7', Aug7: '7♯5', mMaj7: 'mMaj7',
    AugMaj7: '+maj7',
  }[q] ?? q;
}

// Diatonic 7th chords for a key (quality becomes the 7th-chord TYPE name).
// Each key type has its OWN correctly-derived 7th template — applying the natural-minor
// template to harmonic-minor/dorian keys (the old behaviour) gave qualities that
// contradicted the triads. Audit-verified 2026-06-14 by stacking diatonic 3rds.
export function getKeySeventhChords(keyRoot, keyType) {
  const triads = getKeyChords(keyRoot, keyType);
  const SEV_BY_TYPE = {
    'Major':       ['Maj7', 'Min7', 'Min7', 'Maj7', '7 (Dom)', 'Min7', 'm7♭5'],
    'Minor':       ['Min7', 'm7♭5', 'Maj7', 'Min7', 'Min7', 'Maj7', '7 (Dom)'],
    'Harm. Minor': ['mMaj7', 'm7♭5', 'AugMaj7', 'Min7', '7 (Dom)', 'Maj7', 'Dim7'],
    'Dorian':      ['Min7', 'Min7', 'Maj7', '7 (Dom)', 'Min7', 'm7♭5', 'Maj7'],
  };
  const sev = SEV_BY_TYPE[keyType] || SEV_BY_TYPE['Minor'];
  return triads.map((ch, i) => ({ ...ch, quality: sev[i] || ch.quality }));
}

// Secondary dominants — the V7 of each tonicizable diatonic chord.
export function getSecondaryDominants(keyRoot, keyType) {
  if (keyType !== 'Major') {
    const targets = [{ deg: 5, label: 'iv' }, { deg: 7, label: 'v' }, { deg: 10, label: '♭VII' }];
    return targets.map(t => {
      const tr = at(keyRoot, t.deg);
      return { numeral: `V7/${t.label}`, root: at(tr, 7), quality: '7 (Dom)',
        why: `The dominant 7 pulling into ${t.label} (${tr}) — borrowed tension that spotlights that chord.` };
    });
  }
  const targets = [{ deg: 2, label: 'ii' }, { deg: 4, label: 'iii' }, { deg: 5, label: 'IV' }, { deg: 7, label: 'V' }, { deg: 9, label: 'vi' }];
  return targets.map(t => {
    const targetRoot = at(keyRoot, t.deg);
    return { numeral: `V7/${t.label}`, root: at(targetRoot, 7), quality: '7 (Dom)',
      why: `The dominant 7 of ${t.label} (${targetRoot}) — a chromatic chord that briefly makes ${targetRoot} feel like a home, then resolves to it.` };
  });
}

// Borrowed chords (modal interchange).
export function getBorrowedChords(keyRoot, keyType) {
  if (keyType === 'Major') {
    return [
      { numeral: 'iv',   root: at(keyRoot, 5),  quality: 'Minor', why: 'Minor iv from the parallel minor — wistful and bittersweet (the "Creep" / "Mad World" colour).' },
      { numeral: '♭VII', root: at(keyRoot, 10), quality: 'Major', why: 'Flat-VII — bluesy, anthemic lift that steps away from the leading tone.' },
      { numeral: '♭VI',  root: at(keyRoot, 8),  quality: 'Major', why: 'Flat-VI — cinematic, heroic colour borrowed from the parallel minor.' },
      { numeral: '♭III', root: at(keyRoot, 3),  quality: 'Major', why: 'Flat-III — a surprising brightening, common in rock and film.' },
      { numeral: 'ii°',  root: at(keyRoot, 2),  quality: 'Dim',   why: 'Diminished ii from minor — adds extra pull into the V chord.' },
      { numeral: '♭II',  root: at(keyRoot, 1),  quality: 'Major', why: 'Neapolitan — a dramatic chord a half-step above the tonic, usually right before V.' },
    ];
  }
  return [
    { numeral: 'IV',  root: at(keyRoot, 5), quality: 'Major', why: 'Major IV (a Dorian colour) — brightens the minor mood.' },
    { numeral: 'V',   root: at(keyRoot, 7), quality: 'Major', why: 'Major V (from harmonic minor) — the strong, leading-tone cadence back into i.' },
    { numeral: 'I',   root: keyRoot,         quality: 'Major', why: 'Picardy third — ending a minor passage on a bright major tonic.' },
    { numeral: '♭II', root: at(keyRoot, 1),  quality: 'Major', why: 'Neapolitan — a dramatic chord a half-step above the tonic, usually before V.' },
  ];
}
