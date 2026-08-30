import { buildAudioContent }     from './audio-input.js';
import { buildMetronomeContent } from './metronome.js';
import { buildCircle5Content }   from './circle-of-fifths.js';
import { buildChordContent }     from './chord-directory.js';
import { buildChordLabContent }  from './chord-family-lab.js';
import { buildTheoryContent }    from './theory-path.js';
import { buildScaleArpContent }  from './scale-arp-explorer.js';
import { buildProgressionContent } from './progression-builder.js';
import { buildFunctionalEarContent } from './functional-ear-trainer.js';
import { buildWorkshopContent }  from './technique-workshop.js';
import { buildPracticeContent }  from './practice-manager.js';
import { buildBeatMakerContent } from './beat-maker.js';
import { buildAmpContent }       from './amp-modeler.js';
import { buildLooperContent }    from './looper.js';
import { buildTabContent }       from './tab.js';
import { buildReaperBridgeContent } from './reaper-bridge.js';
import { buildWorkoutsContent }  from './workouts.js';
import { buildImprovLabContent } from './improv-lab.js';
import { buildWriteItContent } from './write-it.js';
import { buildMirrorContent }    from './mirror.js';

// Ordered by tier so the + PEDALS drawer reads as a ladder: Basic (reference &
// utilities) → Pro (the learning system) → Studio (production & recording).
//
// ── COLOUR ────────────────────────────────────────────────────────────
// `accent` is the pedal's ONE colour. The shell hands it to the card as
// --rk-pedal-accent and src/styles/kit.css derives the rest — text, panels,
// borders, washes, the lit state — from that single hex. `color` is the
// chassis it is painted on: the same hue at 18% saturation and ~11% lightness,
// so the enclosure is unmistakably the same object as the legend printed on it.
//
// Two channels, deliberately independent:
//   FAMILY (hue)  what the pedal is FOR. Six families, each on an odd multiple
//                 of 15° — which is exactly halfway between two adjacent notes
//                 on the fifths-ordered spectrum in core/colors.js, the largest
//                 gap a 30°-spaced wheel allows. Nothing here passes 46%
//                 saturation either (notes live at 78%), so a chassis reads as
//                 painted metal and never as a pitch.
//                   Utility   hue  15°  what you plug into
//                   Drill     hue  75°  reps against a clock
//                   Study     hue 135°  what to learn next
//                   Reference hue 195°  what things ARE
//                   Record    hue 255°  recording & output
//                   Create    hue 315°  making something
//                 Inside a family the accent steps 5% darker per pedal in the
//                 order they appear below, so board position reads as a
//                 progression rather than as six flat groups.
//   TIER (finish) free / pro / studio, carried by the .tier-* class kit.css
//                 puts on the card. Value and edge highlights only, never hue —
//                 which is why Amp Modeler can be studio-tier and still wear
//                 the Utility hue next to the Input pedal.
export const CATALOG = [
  // ── BASIC — look things up ─────────────────────────────────────────
  { type:'audio',       family:'utility',   title:'Input & Tuner',                  icon:'🎛️', color:'#231b18', accent:'#d3a697', desc:'Connect your guitar — gain, noise gate & a chromatic tuner in one pedal',   w:240, h:340, tier:'free'   },
  { type:'metronome',   family:'utility',   title:'Metronome',                      icon:'⏱️', color:'#211917', accent:'#cb9786', desc:'BPM, subdivisions, ghost notes, rests & speed trainer',                   w:250, h:460, tier:'free'   },
  { type:'circle5',     family:'reference', title:'Circle of Fifths',               icon:'🔮', color:'#182023', accent:'#8fbfcf', desc:'Interactive key relationships, chords & modulation map',                  w:300, h:460, tier:'free'   },
  { type:'chords',      family:'reference', title:'Chord Directory',                icon:'🎵', color:'#171e21', accent:'#7db5c7', desc:'Chord voicings, key chords & theory on the fretboard',                    w:290, h:480, tier:'free'   },
  { type:'scales',      family:'reference', title:'Scale & Arpeggio Explorer',      icon:'🎼', color:'#161d1f', accent:'#6baac0', desc:'Scales and arpeggios as CAGED box shapes across the neck — switch modes in one pedal', w:300, h:540, tier:'free'   },
  { type:'mirror',      family:'reference', title:'Mirror',                         icon:'🎹', color:'#141b1d', accent:'#59a0b8', desc:'See what you are playing on another instrument — the same notes drawn on a piano keyboard or a second neck in any tuning', w:340, h:300, tier:'free'   },
  { type:'workouts',    family:'drill',     title:'Workouts',                       icon:'🏋', color:'#202318', accent:'#a6ba6c', desc:'One-tap position practices: random open chords, upper & mid triads, CAGED runs, 3nps, broken 3rds — beat-synced or 🎤 listen-to-advance (build your own in PRO)', w:310, h:560, tier:'free'   },
  // ── PRO — understand & improve ─────────────────────────────────────
  { type:'theory',      family:'study',     title:'Theory Path',                    icon:'🧭', color:'#18231b', accent:'#73bd85', desc:'Guided music theory, basics → advanced. Find your level, then learn each concept with a teach card + a practical scored exercise', w:470, h:690, tier:'pro'    },
  { type:'practice',    family:'drill',     title:'Practice Manager',               icon:'📋', color:'#1e2117', accent:'#9cb15a', desc:'Structure sessions, track progress & build streaks',                      w:280, h:420, tier:'pro'    },
  { type:'workshop',    family:'drill',     title:'Technique Workshop',             icon:'🔥', color:'#1d1f16', accent:'#8fa54e', desc:'Positions, grooves, fingerpicking, articulations & string-set voicings — drill at tempo (5 tools in one)', w:320, h:560, tier:'pro'    },
  { type:'chordlab',    family:'study',     title:'Chord-Family Lab',               icon:'🧪', color:'#172119', accent:'#61b576', desc:'Hear, see, play & resolve sus, add9, slash, 9·11·13, aug, dim & altered chords — beyond the 7th-chord ceiling', w:440, h:660, tier:'pro'    },
  { type:'ear',         family:'study',     title:'Functional Ear Trainer',         icon:'👂', color:'#161f18', accent:'#51ac68', desc:'Train your ear (notes, intervals, chords, resolutions) AND your theory recall (fretboard, key sigs, chord function)', w:300, h:520, tier:'pro'    },
  { type:'progression', family:'create',    title:'Progression Studio',             icon:'🔁', color:'#231820', accent:'#d89fca', desc:'Build progressions by function — arm a chord, paint the bars, let Smart Next suggest what fits',  w:340, h:560, tier:'pro'    },
  { type:'improvlab',   family:'create',    title:'Improv Lab',                     icon:'🎙️', color:'#21171e', accent:'#d08dc0', desc:'Call &amp; response training (echo → answer → improvise a resolving reply) + jam over a backing track in any key with the scale, arpeggios & target tones lit on the neck', w:340, h:640, tier:'pro'    },
  { type:'writeit',     family:'create',    title:'Write It',                       icon:'✍️', color:'#1f161d', accent:'#c97bb5', desc:'A drill format for COMPOSING: pick a mode, get its one-line recipe and the two-chord vamp that proves it, then write 8 bars to a constraint card (start note, end note, pitch budget, one leap). Tap your answer on the neck, hear it over the vamp, keep it.', w:340, h:660, tier:'pro'    },
  // ── STUDIO — make & record music ───────────────────────────────────
  { type:'beatmaker',   family:'record',    title:'Backing Track',                  icon:'🥁', color:'#1b1823', accent:'#b9acdf', desc:'Beats only or a full backing track. Pick a genre and it loads the groove, the mode, the tempo and the chords in your key — Blues, Rock, Reggae, Funk, Jazz, Pop, Latin, Hip Hop, EDM, Swancore. Or build your own beat in the 16-step grid.', w:320, h:520, tier:'studio' },
  { type:'amp',         family:'utility',   title:'Amp Modeler',                    icon:'🔊', color:'#1f1816', accent:'#c38874', desc:'Guitar amp tones with gain, EQ, reverb & cabinet simulation',             w:280, h:400, tier:'studio', studioOnly:1 },
  { type:'looper',      family:'record',    title:'Looper',                         icon:'🔄', color:'#191721', accent:'#a99ad8', desc:'Record, layer & loop audio tracks with overdub',                           w:280, h:380, tier:'studio', studioOnly:1 },
  { type:'reaper',      family:'record',    title:'REAPER Bridge',                  icon:'🌉', color:'#18161f', accent:'#9a88d1', desc:'Two-way bridge to your DAW — export progressions & beats as MIDI for REAPER, and analyze REAPER renders: tempo, key & every note mapped onto the fretboard', w:360, h:600, tier:'studio' },
];

const BUILDERS = {
  theory:      buildTheoryContent,
  chordlab:    buildChordLabContent,
  audio:       buildAudioContent,
  metronome:   buildMetronomeContent,
  circle5:     buildCircle5Content,
  chords:      buildChordContent,
  scales:      buildScaleArpContent,
  arpeggios:   buildScaleArpContent,   // back-compat: saved boards with an Arpeggios pedal open in ARPS mode
  progression: buildProgressionContent,
  ear:         buildFunctionalEarContent,
  notequiz:    buildFunctionalEarContent,   // back-compat: a saved Note Quiz opens in THEORY group
  melody:      buildFunctionalEarContent,   // merged: Melody Lab's resolution drill lives in 🎯 Resolve mode
  workshop:    buildWorkshopContent,
  runner:      buildWorkshopContent,        // legacy → Technique Workshop · Positions tab
  rhythm:      buildWorkshopContent,        // legacy → Technique Workshop · Groove tab
  finger:      buildWorkshopContent,        // legacy → Technique Workshop · Finger tab
  technique:   buildWorkshopContent,        // legacy → Technique Workshop · Technique tab
  voicinglab:  buildWorkshopContent,        // merged: opens the Workshop on its 🧵 Voicings tab
  practice:    buildPracticeContent,
  beatmaker:   buildBeatMakerContent,
  amp:         buildAmpContent,
  looper:      buildLooperContent,
  tuner:       buildAudioContent,           // merged: the tuner is the Input pedal's 🎯 TUNER view
  // No 'sketchpad' or 'songdir' builder: both are migrated to 'practice' in main.js
  // before a builder is ever looked up. sketchpad.js itself stays — it IS the Practice
  // Manager's 📖 Songbook, and the TAB page imports four things from it.
  tab:         buildTabContent,
  reaper:      buildReaperBridgeContent,
  workouts:    buildWorkoutsContent,
  improvlab:   buildImprovLabContent,
  writeit:     buildWriteItContent,
  mirror:      buildMirrorContent,
};

export function buildContent(p) {
  const fn = BUILDERS[p.type];
  if (fn) fn(p);
}
