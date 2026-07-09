import { buildAudioContent }     from './audio-input.js';
import { buildTunerContent }     from './tuner.js';
import { buildMetronomeContent } from './metronome.js';
import { buildCircle5Content }   from './circle-of-fifths.js';
import { buildChordContent }     from './chord-directory.js';
import { buildChordLabContent }  from './chord-family-lab.js';
import { buildMelodyContent }    from './melody-lab.js';
import { buildTheoryContent }    from './theory-path.js';
import { buildScaleArpContent }  from './scale-arp-explorer.js';
import { buildProgressionContent } from './progression-builder.js';
import { buildFunctionalEarContent } from './functional-ear-trainer.js';
import { buildWorkshopContent }  from './technique-workshop.js';
import { buildPracticeContent }  from './practice-manager.js';
import { buildBeatMakerContent } from './beat-maker.js';
import { buildAmpContent }       from './amp-modeler.js';
import { buildLooperContent }    from './looper.js';
import { buildSongDirContent }   from './song-directory.js';
import { buildTabContent }       from './tab.js';
import { buildSketchpadContent } from './sketchpad.js';

export const CATALOG = [
  { type:'theory',    title:'Theory Path',         icon:'🧭', color:'#0e1f1d', accent:'#5ad1c0', desc:'Guided music theory, basics → advanced. Find your level, then learn each concept with a teach card + a practical scored exercise', w:470, h:690, tier:'free'   },
  { type:'chordlab',  title:'Chord-Family Lab',    icon:'🧪', color:'#1a1426', accent:'#b07cff', desc:'Hear, see, play & resolve sus, add9, 9·11·13, aug, dim & altered chords — beyond the 7th-chord ceiling', w:440, h:660, tier:'free'   },
  { type:'melody',    title:'Melody Lab',          icon:'🎵', color:'#241620', accent:'#ec6a8a', desc:'Make melodies that sing — land on chord tones, resolve tensions into them, with a single-note resolution drill', w:340, h:640, tier:'free'   },
  { type:'audio',     title:'Audio Input',        icon:'🎛️', color:'#1a2a1a', accent:'#00ff88', desc:'Guitar input, gain & noise gate',                                          w:230, h:300, tier:'free'   },
  { type:'tuner',     title:'Chromatic Tuner',     icon:'🎯', color:'#1a2228', accent:'#4499bb', desc:'Real-time pitch detection',                                                w:220, h:260, tier:'free'   },
  { type:'metronome', title:'Metronome',           icon:'⏱️', color:'#2a2018', accent:'#dd8844', desc:'BPM, subdivisions, ghost notes, rests & speed trainer',                   w:250, h:460, tier:'free'   },
  { type:'circle5',   title:'Circle of Fifths',    icon:'🔮', color:'#1a1a1a', accent:'#cccccc', desc:'Interactive key relationships, chords & modulation map',                  w:300, h:460, tier:'free'   },
  { type:'chords',    title:'Chord Directory',     icon:'🎵', color:'#1a1a2a', accent:'#8877dd', desc:'Chord voicings, key chords & theory on the fretboard',                    w:290, h:480, tier:'free'   },
  { type:'scales',    title:'Scale & Arpeggio Explorer', icon:'🎼', color:'#18282a', accent:'#44bbcc', desc:'Scales and arpeggios as CAGED box shapes across the neck — switch modes in one pedal', w:300, h:540, tier:'free'   },
  { type:'progression',title:'Progression Studio', icon:'🔁', color:'#2a2210', accent:'#ef9f27', desc:'Build progressions by function — arm a chord, paint the bars, let Smart Next suggest what fits',  w:340, h:560, tier:'pro'    },
  { type:'ear',       title:'Functional Ear Trainer', icon:'👂', color:'#1a2028', accent:'#ee6688', desc:'Train your ear (notes, intervals, chords, melodies) AND your theory recall (fretboard, key sigs, chord function) — one pedal, two modes', w:300, h:520, tier:'pro'    },
  { type:'workshop',  title:'Technique Workshop',  icon:'🔥', color:'#241a1a', accent:'#ff7744', desc:'Positions, grooves, fingerpicking rolls & articulations — drill at tempo (4 tools in one)', w:320, h:560, tier:'pro'    },
  { type:'practice',  title:'Practice Manager',    icon:'📋', color:'#1a2a18', accent:'#66aa55', desc:'Structure sessions, track progress & build streaks',                      w:280, h:420, tier:'pro'    },
  { type:'beatmaker', title:'Beat Maker',          icon:'🎹', color:'#1a1828', accent:'#9977ee', desc:'16-step drum sequencer with genre presets synced to tempo',               w:320, h:420, tier:'studio' },
  { type:'amp',       title:'Amp Modeler',         icon:'🔊', color:'#281a1a', accent:'#ee7744', desc:'Guitar amp tones with gain, EQ, reverb & cabinet simulation',             w:280, h:400, tier:'studio', studioOnly:1 },
  { type:'looper',    title:'Looper',              icon:'🔄', color:'#1a2828', accent:'#44bbdd', desc:'Record, layer & loop audio tracks with overdub',                           w:280, h:380, tier:'studio', studioOnly:1 },
  { type:'songdir',   title:'Song Directory',      icon:'📖', color:'#282018', accent:'#ddaa44', desc:'Reference chord progressions & melodies, save your own',                  w:280, h:440, tier:'studio' },
  { type:'sketchpad', title:'Song Sketchpad',       icon:'✏️', color:'#241f12', accent:'#ef9f27', desc:'Compose on the neck OR import a tab → play it through with a live concept readout (chord · note · number), set lengths & save', w:360, h:580, tier:'free'   },
];

const BUILDERS = {
  theory:      buildTheoryContent,
  chordlab:    buildChordLabContent,
  melody:      buildMelodyContent,
  audio:       buildAudioContent,
  tuner:       buildTunerContent,
  metronome:   buildMetronomeContent,
  circle5:     buildCircle5Content,
  chords:      buildChordContent,
  scales:      buildScaleArpContent,
  arpeggios:   buildScaleArpContent,   // back-compat: saved boards with an Arpeggios pedal open in ARPS mode
  progression: buildProgressionContent,
  ear:         buildFunctionalEarContent,
  notequiz:    buildFunctionalEarContent,   // back-compat: a saved Note Quiz opens in THEORY group
  workshop:    buildWorkshopContent,
  runner:      buildWorkshopContent,        // legacy → Technique Workshop · Positions tab
  rhythm:      buildWorkshopContent,        // legacy → Technique Workshop · Groove tab
  finger:      buildWorkshopContent,        // legacy → Technique Workshop · Finger tab
  technique:   buildWorkshopContent,        // legacy → Technique Workshop · Technique tab
  practice:    buildPracticeContent,
  beatmaker:   buildBeatMakerContent,
  amp:         buildAmpContent,
  looper:      buildLooperContent,
  songdir:     buildSongDirContent,
  tab:         buildTabContent,
  sketchpad:   buildSketchpadContent,
};

export function buildContent(p) {
  const fn = BUILDERS[p.type];
  if (fn) fn(p);
}
