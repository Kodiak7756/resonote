// Inventory every lesson's drill: which pedal it routes to + its content.
const fs = require('fs');
const CUR = 'D:/Guitar/APP/resonote-v2/src/curriculum/curriculum-data.js';
const src = fs.readFileSync(CUR, 'utf8');
const cut = src.indexOf('export const CURRICULUM');
const cur = JSON.parse(src.slice(cut).replace(/^export const CURRICULUM\s*=\s*/, '').replace(/;\s*$/, ''));

// Mirror routeDrill() in main.js
function routeOf(d) {
  const sig = ((d.voicing || '') + ' ' + (d.pattern || '') + ' ' + (d.focus || '')).toLowerCase();
  if (/single note|one note|single-note|two-note|interval|half[- ]step|whole[- ]step|chromatic|climb|scale degree|one string/.test(sig))
    return 'SCALES (Scale & Arp Explorer)';
  return 'PROGRESSION (Progression Studio · auto-plays)';
}
const progStr = p => (p || []).map(c => `${c.numeral ? c.numeral : ''}${c.root}${c.quality === 'Major' ? '' : c.quality === 'Minor' ? 'm' : c.quality}`).join(' ');

let totalLessons = 0, withDrill = 0, scales = 0, prog = 0, withProgChords = 0;
const byVoicing = {};
let out = '';
cur.units.forEach((u, ui) => {
  out += `\n━━━ UNIT ${ui + 1}: ${u.icon || ''} ${u.title} ━━━\n`;
  (u.lessons || []).forEach(l => {
    totalLessons++;
    const d = l.drill;
    if (!d) { out += `  L${l.level} ${l.title}  —  (no drill)\n`; return; }
    withDrill++;
    const route = routeOf(d);
    if (route.startsWith('SCALES')) scales++; else { prog++; if ((d.progression || []).length) withProgChords++; }
    byVoicing[d.voicing || '(none)'] = (byVoicing[d.voicing || '(none)'] || 0) + 1;
    out += `  L${l.level} ${l.title}\n`;
    out += `       drill: "${d.title}"  · ${d.bpm || '?'}bpm ${d.timeSig || ''} · voicing: ${d.voicing || '?'}\n`;
    out += `       prog:  ${progStr(d.progression) || '(none)'}\n`;
    out += `       focus: ${d.focus || ''}\n`;
    out += `       → ${route}\n`;
  });
  if (u.improv) out += `  🎤 UNIT IMPROV: "${u.improv.title}" — backing: ${u.improv.backing?.drums || '?'} drums + ${progStr(u.improv.backing?.progression)}; solo ${u.improv.scale?.root || ''} ${u.improv.scale?.scaleName || ''}\n`;
});

console.log(`TOTALS: ${totalLessons} lessons · ${withDrill} have drills · ${scales} → Scale&Arp · ${prog} → Progression Studio (${withProgChords} with real chord progressions)`);
console.log('VOICINGS:', JSON.stringify(byVoicing, null, 0));
fs.writeFileSync('D:/Guitar/APP/resonote-v2/tools/_drill-inventory.txt', out, 'utf8');
console.log('Full inventory written to tools/_drill-inventory.txt (' + out.length + ' chars)');
