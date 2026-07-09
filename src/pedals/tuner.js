import { audio } from '../core/audio.js';
import { theoryPanelHTML, wireTheoryPanel } from '../ui/theory-panel.js';

const TUNER_THEORY = {
  kicker: 'PITCH', title: 'Tuning — cents & equal temperament',
  what: `The tuner listens to your string, names the nearest note, and shows how far off you are in <b>cents</b> (a cent is 1/100 of a semitone). The needle says which way to turn the peg: left of centre = <b>♭ flat</b> (tune up), right = <b>♯ sharp</b> (tune down). The green light means you're within 5¢ — dead in tune.`,
  why: `Guitars use <b>equal temperament</b> — the octave split into 12 equal steps — so every key sounds equally (and very slightly) tempered, and you can play in any key without re-tuning. In-tune strings are the foundation of everything: chords ring, intervals lock, and your ear learns true pitch. Tune before every session.`,
  lessonId: 'tuning-basics',
};

export function buildTunerContent(p) {
  const el = document.getElementById(`body-${p.id}`);
  if (!el) return;

  el.innerHTML = `
    <div class="rk rk-tuner" style="--rk-accent:#4499bb">
      <div id="tw-${p.id}" class="rk-chip" style="display:none;color:#ff6644;border-color:#ff664455;align-self:center">⚠ Connect audio input first</div>

      <div style="display:flex;flex-direction:column;align-items:center;gap:11px;padding:8px 0">
        <div id="tn-${p.id}" class="mono" style="font-size:46px;font-weight:900;color:#333;line-height:1">—</div>

        <div style="width:100%;max-width:220px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="mono" style="color:#5a5a5a;font-size:8px">♭ flat</span>
            <span class="mono" style="color:#5a5a5a;font-size:8px">in&nbsp;tune</span>
            <span class="mono" style="color:#5a5a5a;font-size:8px">sharp ♯</span>
          </div>
          <div style="width:100%;height:10px;background:#161616;border-radius:5px;position:relative;border:1px solid #2a2a2a">
            <div style="position:absolute;top:-2px;left:50%;width:2px;height:14px;background:#5a5a5a;transform:translateX(-50%);z-index:2"></div>
            <div id="ti-${p.id}" style="position:absolute;top:-3px;width:7px;height:16px;border-radius:3px;left:50%;transform:translateX(-50%);transition:left .1s;display:none"></div>
          </div>
        </div>

        <div style="display:flex;gap:18px;align-items:center">
          <span id="th-${p.id}" class="mono" style="color:#666;font-size:11px">— Hz</span>
          <div id="tl-${p.id}" style="width:16px;height:16px;border-radius:50%;background:#222;border:2px solid #444"></div>
          <span id="tc-${p.id}" class="mono" style="color:#666;font-size:11px;font-weight:700">—¢</span>
        </div>
      </div>

      ${theoryPanelHTML('tuner', TUNER_THEORY)}
    </div>`;

  wireTheoryPanel(el);

  const upd = () => {
    const det = audio.detected, cn = audio.connected;
    const w = document.getElementById(`tw-${p.id}`);
    if (w) w.style.display = cn ? 'none' : 'block';

    const c  = det?.cents || 0;
    const cc = !det ? '#555' : Math.abs(c) < 5 ? '#00ff88' : Math.abs(c) < 15 ? '#ffaa00' : '#ff4466';

    const n = document.getElementById(`tn-${p.id}`);
    if (n) {
      n.textContent      = det ? det.note : '—';
      n.style.color      = det ? cc : '#333';
      n.style.textShadow = det ? `0 0 25px ${cc}55` : 'none';
    }
    const ind = document.getElementById(`ti-${p.id}`);
    if (ind) {
      ind.style.display    = det ? 'block' : 'none';
      ind.style.left       = `${50 + c / 2}%`;
      ind.style.background  = cc;
      ind.style.boxShadow   = `0 0 8px ${cc}88`;
    }
    const hz = document.getElementById(`th-${p.id}`);
    if (hz) hz.textContent = det ? `${det.freq.toFixed(1)} Hz` : '— Hz';

    const ct = document.getElementById(`tc-${p.id}`);
    if (ct) { ct.textContent = det ? `${c > 0 ? '+' : ''}${c}¢` : '—¢'; ct.style.color = cc; }

    const led = document.getElementById(`tl-${p.id}`);
    const it  = det && Math.abs(c) < 5;
    if (led) {
      led.style.background  = it ? '#00ff88' : '#222';
      led.style.borderColor = it ? '#00ff88' : '#444';
      led.style.boxShadow   = it ? '0 0 20px rgba(0,255,136,.6)' : 'none';
    }
  };

  audio.on(upd);
  upd();
}
