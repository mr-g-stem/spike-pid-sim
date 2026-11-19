// main.js: wires the sliders, the 3D view, the graphs and playback together.
import { simulate, DEFAULTS, frameIndexAt, ROBOT, MM_PER_DEG } from './physics.js';
import { createScene } from './scene.js';
import { createCharts } from './charts.js';
import { pybricksCode } from './codegen.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const UNLOCK = params.has('unlock');

const CLASS_ROBOT = { weakSide: 'left', weakPct: 2, seed: 7 };

const state = {
  cfg: { ...DEFAULTS, ...CLASS_ROBOT },
  sim: null,
  history: [],
  t: 0,
  playing: false,
  speed: 1,
  runCount: 0,
  mystery: false,
  revealed: false,
  dirty: false,
};

// ---------- 3D + charts
const scene = createScene($('viewport'), $('labels'));
const charts = createCharts({ heading: $('ch-heading'), speed: $('ch-speed'), power: $('ch-power') }, (t) => {
  state.t = t; state.playing = false; hidePop(); syncPlayBtn();
});

// ---------- F that matches the speed: what a well-tuned F looks like for this robot
function goodF(speed) {
  const perPct = ROBOT.maxDegPerSec / (100 - ROBOT.deadband) * MM_PER_DEG; // mm/s per % above the deadband
  const avgStrength = 1 - state.cfg.weakPct / 200;
  return Math.round(((ROBOT.deadband + speed / (perPct * avgStrength)) / speed) * 1000) / 1000;
}

// ---------- controls
const knobs = {
  kf: { range: $('kf'), num: $('kf-num'), dec: 3 },
  kfL: { range: $('kfL'), num: $('kfL-num'), dec: 3 },
  kfR: { range: $('kfR'), num: $('kfR-num'), dec: 3 },
  kp: { range: $('kp'), num: $('kp-num'), dec: 1 },
};

function writeUI() {
  const c = state.cfg;
  for (const k in knobs) {
    knobs[k].range.value = c[k];
    knobs[k].num.value = Number(c[k]).toFixed(knobs[k].dec);
  }
  $('speed').value = c.speed;
  $('speed-val').textContent = c.speed;
  $('splitF').checked = c.splitF;
  $('split-box').hidden = !c.splitF;
  knobs.kf.range.disabled = knobs.kf.num.disabled = c.splitF;
  $('loopMs').value = String(c.loopMs);
  $('trips').value = String(c.trips);
  $('bumps').checked = c.bumps;
  $('noise').checked = c.noise;
  $('ki').value = c.ki; $('kd').value = c.kd;
  updateHints();
  updateWeakInfo();
}

function updateHints() {
  const c = state.cfg;
  const base = c.splitF ? `${(c.kfL * c.speed).toFixed(0)}% left, ${(c.kfR * c.speed).toFixed(0)}% right` : `${(c.kf * c.speed).toFixed(0)}%`;
  $('kf-hint').innerHTML = `F × speed = <b>${base}</b> base power at ${c.speed} mm/s.`;
  $('kp-hint').innerHTML = c.kp === 0
    ? 'P = 0: the gyro is ignored, nothing steers back.'
    : `1° off course → <b>${c.kp.toFixed(1)}%</b> more power on one side, ${c.kp.toFixed(1)}% less on the other.`;
  if (UNLOCK) {
    $('ki-box').querySelector('.lock').textContent = c.ki.toFixed(2);
    $('kd-box').querySelector('.lock').textContent = c.kd.toFixed(2);
  }
}

function updateWeakInfo() {
  const c = state.cfg;
  if (state.mystery && !state.revealed) $('weak-info').textContent = '??? (mystery)';
  else $('weak-info').textContent = `${c.weakSide}, ${c.weakPct.toFixed(1)}% weaker`;
}

function markDirty() {
  state.dirty = true;
  $('btn-run').classList.add('pulse');
  updateHints();
  if (!$('tab-code').hidden) updateCode();
}

function onKnobInput(key, fromNum) {
  const k = knobs[key];
  let v = parseFloat(fromNum ? k.num.value : k.range.value);
  if (!Number.isFinite(v)) return;
  v = Math.max(parseFloat(k.range.min), Math.min(parseFloat(k.range.max), v));
  state.cfg[key] = v;
  if (fromNum) k.range.value = v; else k.num.value = v.toFixed(k.dec);
  markDirty();
}
for (const key in knobs) {
  const k = knobs[key];
  k.range.addEventListener('input', () => onKnobInput(key, false));
  k.num.addEventListener('input', () => onKnobInput(key, true));
  k.range.addEventListener('change', autoRun);
  k.num.addEventListener('change', autoRun);
}
$('speed').addEventListener('input', () => { state.cfg.speed = parseInt($('speed').value, 10); $('speed-val').textContent = state.cfg.speed; markDirty(); });
$('speed').addEventListener('change', autoRun);
$('splitF').addEventListener('change', () => {
  const c = state.cfg;
  c.splitF = $('splitF').checked;
  if (c.splitF) { c.kfL = c.kf; c.kfR = c.kf; }
  else { c.kf = Math.round((c.kfL + c.kfR) / 2 * 1000) / 1000; }
  writeUI(); markDirty(); autoRun();
});
for (const [id, key, parse] of [['loopMs', 'loopMs', (v) => parseInt(v, 10)], ['trips', 'trips', (v) => parseInt(v, 10)]]) {
  $(id).addEventListener('change', () => { state.cfg[key] = parse($(id).value); markDirty(); autoRun(); });
}
for (const id of ['bumps', 'noise']) {
  $(id).addEventListener('change', () => { state.cfg[id] = $(id).checked; markDirty(); autoRun(); });
}
if (UNLOCK) {
  for (const id of ['ki', 'kd']) {
    const r = $(id);
    r.disabled = false;
    $(`${id}-box`).classList.add('unlocked');
    r.addEventListener('input', () => { state.cfg[id] = parseFloat(r.value); markDirty(); });
    r.addEventListener('change', autoRun);
  }
  document.querySelector('.locked-note').textContent = 'Teacher mode: I and D are unlocked.';
}

function autoRun() {
  if ($('autorun').checked) runSim(true);
}

// presets
const PRESETS = {
  start: () => ({ kf: 0.20, kp: 0 }),
  fgood: (s) => ({ kf: goodF(s), kp: 0 }),
  plow: (s) => ({ kf: goodF(s), kp: 0.6 }),
  pgood: (s) => ({ kf: goodF(s), kp: 5 }),
  phigh: (s) => ({ kf: goodF(s), kp: 14 }),
  pwild: (s) => ({ kf: goodF(s), kp: 26 }),
};
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-preset]');
  if (!b) return;
  const p = PRESETS[b.dataset.preset](state.cfg.speed);
  Object.assign(state.cfg, p, { splitF: false, ki: 0, kd: 0 });
  writeUI();
  runSim(true);
});

// robot
$('btn-mystery').addEventListener('click', () => {
  state.mystery = true; state.revealed = false;
  state.cfg.weakSide = Math.random() < 0.5 ? 'left' : 'right';
  state.cfg.weakPct = Math.round((1.5 + Math.random() * 3) * 10) / 10;
  state.cfg.seed = 1 + Math.floor(Math.random() * 9999);
  $('btn-reveal').hidden = false; $('btn-normal').hidden = false;
  updateWeakInfo();
  runSim(true);
});
$('btn-reveal').addEventListener('click', () => { state.revealed = true; updateWeakInfo(); $('btn-reveal').hidden = true; });
$('btn-normal').addEventListener('click', () => {
  state.mystery = false; state.revealed = false;
  Object.assign(state.cfg, CLASS_ROBOT);
  $('btn-reveal').hidden = true; $('btn-normal').hidden = true;
  updateWeakInfo();
  runSim(true);
});

// ---------- run
function runSim(autoplay = true) {
  const cfg = { ...state.cfg };
  const sim = simulate(cfg);
  sim.id = ++state.runCount;
  sim.mystery = state.mystery;
  const previous = state.history.map((h) => h.sim);
  for (const h of state.history) h.revealed = true; // a run you moved on from still shows its numbers
  scene.setRun(sim, previous);
  charts.setRun(sim, previous[0]);
  state.history.unshift({ sim, revealed: false });
  if (state.history.length > 12) state.history.pop();
  state.sim = sim;
  state.t = 0;
  state.playing = autoplay;
  state.dirty = false;
  $('btn-run').classList.remove('pulse');
  hidePop();
  syncPlayBtn();
  renderLog();
  updateCode();
}

function loadRun(entry) {
  const sim = entry.sim;
  const previous = state.history.filter((h) => h !== entry).map((h) => h.sim);
  scene.setRun(sim, previous);
  charts.setRun(sim, previous[0]);
  state.sim = sim;
  Object.assign(state.cfg, { kf: sim.cfg.kf, kp: sim.cfg.kp, splitF: sim.cfg.splitF, kfL: sim.cfg.kfL, kfR: sim.cfg.kfR, speed: sim.cfg.speed });
  writeUI();
  state.t = 0; state.playing = true;
  hidePop(); syncPlayBtn(); renderLog(); updateCode();
}

function onEnd() {
  const entry = state.history.find((h) => h.sim === state.sim);
  if (entry) entry.revealed = true;
  renderLog();
  showPop();
  updateSteps();
}

// ---------- transport
$('btn-run').addEventListener('click', () => runSim(true));
$('btn-play').addEventListener('click', () => {
  if (!state.sim) return;
  if (state.t >= state.sim.duration) { state.t = 0; hidePop(); }
  state.playing = !state.playing;
  syncPlayBtn();
});
$('btn-replay').addEventListener('click', () => { state.t = 0; state.playing = true; hidePop(); syncPlayBtn(); });
$('btn-end').addEventListener('click', () => {
  if (!state.sim) return;
  state.t = state.sim.duration; state.playing = false; syncPlayBtn(); onEnd();
});
$('timeline').addEventListener('input', () => {
  if (!state.sim) return;
  state.t = $('timeline').value / 1000 * state.sim.duration;
  state.playing = false; hidePop(); syncPlayBtn();
});
$('speed-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-speed]');
  if (!b) return;
  state.speed = parseFloat(b.dataset.speed);
  for (const x of $('speed-seg').children) x.classList.toggle('on', x === b);
});
function syncPlayBtn() { $('btn-play').textContent = state.playing ? '❚❚' : '▶'; }

// camera + view options
$('cam-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cam]');
  if (!b) return;
  for (const x of $('cam-seg').children) x.classList.toggle('on', x === b);
  const f = state.sim ? state.sim.frames[frameIndexAt(state.sim.frames, state.t)] : null;
  scene.setCamera(b.dataset.cam, f);
});
for (const [id, key] of [['opt-ghost', 'ghost'], ['opt-laser', 'laser'], ['opt-trails', 'trails'], ['opt-labels', 'labels']]) {
  $(id).addEventListener('change', () => { scene.opts[key] = $(id).checked; });
}
$('opt-live').addEventListener('change', () => { $('live').hidden = !$('opt-live').checked; });
$('opt-motors').addEventListener('change', () => { $('motors').hidden = !$('opt-motors').checked; });
$('live-hide').addEventListener('click', () => {
  const box = $('live');
  box.classList.toggle('collapsed');
  $('live-hide').textContent = box.classList.contains('collapsed') ? '+' : '–';
});

// result pop-up
function showPop() {
  const r = state.sim.result;
  const pop = $('result-pop');
  pop.className = `result-pop ${r.coach.tone}`;
  $('pop-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('');
  $('pop-title').textContent = r.coach.title;
  $('pop-text').textContent = r.coach.text;
  const stops = r.stops.length ? r.stops.reduce((a, s) => a + Math.abs(s.y), 0) / r.stops.length / 10 : 0;
  $('pop-stats').innerHTML = [
    ['Most off path', `${r.driftCm.toFixed(1)} cm`],
    ['Wobble', `±${r.wobble.toFixed(1)}°`],
    ['Speed', `${Math.round(r.avgSpeed)} / ${state.sim.cfg.speed}`],
    ['Off at the lines', `${stops.toFixed(1)} cm`],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  pop.hidden = false;
}
function hidePop() { $('result-pop').hidden = true; }
$('pop-close').addEventListener('click', hidePop);
$('pop-replay').addEventListener('click', () => { state.t = 0; state.playing = true; hidePop(); syncPlayBtn(); });

// steps: F first, then P
function updateSteps() {
  const best = state.history.find((h) => h.revealed);
  const sf = $('step-f'), sp = $('step-p');
  sf.className = 'step'; sp.className = 'step';
  if (!best) { sf.classList.add('now'); return; }
  const r = best.sim.result;
  const fOk = r.endReason === 'finished' && Math.abs(r.speedErrPct) < 6;
  if (!fOk) { sf.classList.add('now'); return; }
  sf.classList.add('done');
  if (r.stars === 3) sp.classList.add('done'); else sp.classList.add('now');
}

// run log
function renderLog() {
  const body = $('log-body');
  if (!state.history.length) { body.innerHTML = '<tr class="empty"><td colspan="7">Runs show up here. Click one to load its F and P.</td></tr>'; return; }
  body.innerHTML = '';
  for (const h of state.history) {
    const s = h.sim, r = s.result, c = s.cfg;
    const tr = document.createElement('tr');
    if (s === state.sim) tr.className = 'cur';
    const fTxt = c.splitF ? `${c.kfL.toFixed(3)}/${c.kfR.toFixed(3)}` : c.kf.toFixed(3);
    const cells = h.revealed
      ? [`${s.id}${s.mystery ? '?' : ''}`, fTxt, c.kp.toFixed(1), `${r.driftCm.toFixed(1)}cm`, `±${r.wobble.toFixed(1)}°`, `${Math.round(r.avgSpeed)}`, '★'.repeat(r.stars) || '–']
      : [`${s.id}${s.mystery ? '?' : ''}`, fTxt, c.kp.toFixed(1), '…', '…', '…', '…'];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (i === 6 && h.revealed) td.className = `s${r.stars}`;
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => loadRun(h));
    body.appendChild(tr);
  }
}
$('btn-clear').addEventListener('click', () => {
  state.history = state.sim ? [state.history.find((h) => h.sim === state.sim)] : [];
  renderLog();
});

// ---------- code tab
function updateCode() { $('code-out').textContent = pybricksCode(state.cfg); }
$('btn-copy').addEventListener('click', async () => {
  const text = $('code-out').textContent;
  try { await navigator.clipboard.writeText(text); $('btn-copy').textContent = 'Copied ✓'; }
  catch { const r = document.createRange(); r.selectNodeContents($('code-out')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('btn-copy').textContent = 'Press Ctrl+C'; }
  setTimeout(() => { $('btn-copy').textContent = 'Copy code'; }, 1800);
});

// tabs
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', String(x === b));
  const tab = b.dataset.tab;
  $('tab-sim').hidden = tab !== 'sim';
  $('tab-code').hidden = tab !== 'code';
  $('tab-how').hidden = tab !== 'how';
  if (tab === 'code') updateCode();
  if (tab === 'sim') requestAnimationFrame(onResize);
});

// keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); }
  else if (e.key === 'r' || e.key === 'R') runSim(true);
});

// ---------- HUD
const fmtS = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
function setRo(id, value, sub, tone) {
  const el = $(id);
  el.textContent = value;
  $(`${id}-sub`).textContent = sub;
  el.parentElement.className = `ro ${tone || ''}`;
}

function updateHUD(f) {
  const sim = state.sim, c = sim.cfg;
  const fwd = f.leg % 2 === 0;
  let phase = 'Ready', dot = '';
  if (f.phase === 'drive') { phase = fwd ? 'Driving out to line B →' : '← Driving back to line A'; dot = 'run'; }
  else if (f.phase === 'pause') { phase = fwd ? 'Stopped at line B' : 'Stopped at line A'; dot = 'pause'; }
  else if (f.phase === 'done') phase = 'Finished';
  if (state.t >= sim.duration) {
    const e = sim.result.endReason;
    if (e === 'stuck') phase = 'Stuck: not enough power';
    else if (e === 'offTable') phase = 'Drove off the table!';
    else if (e === 'tooSlow') phase = 'Gave up: too slow';
  }
  if (!state.playing && state.t < sim.duration && state.t > 0) phase += ' (paused)';
  $('st-phase').textContent = phase;
  $('st-dot').className = `dot ${state.playing ? dot : ''}`;
  $('st-trip').textContent = `Trip ${Math.min(c.trips, Math.floor(f.leg / 2) + 1)} of ${c.trips}`;

  const h = f.heading, ah = Math.abs(h);
  setRo('ro-heading', `${fmtS(h)}°`, ah < 0.3 ? 'straight' : h > 0 ? 'turned right' : 'turned left', ah < 1 ? 'good' : ah < 3 ? 'warn' : 'bad');
  const dcm = Math.abs(f.y) / 10;
  setRo('ro-drift', `${dcm.toFixed(1)} cm`, dcm < 0.2 ? 'on the path' : f.y > 0 ? 'left of the path' : 'right of the path', dcm < 2 ? 'good' : dcm < 5 ? 'warn' : 'bad');
  const sp = Math.abs(f.v);
  let st = '';
  if (f.phase === 'drive' && f.t > 0.8) { const e = Math.abs(sp - c.speed) / c.speed; st = e < 0.06 ? 'good' : e < 0.15 ? 'warn' : 'bad'; }
  setRo('ro-speed', `${Math.round(sp)}`, `of ${c.speed} mm/s`, st);

  // live program
  const live = $('live-code');
  if (!$('live').classList.contains('collapsed')) {
    const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
    const W = 36;
    const row = (code, val, cls = 'cv') => `${code}${' '.repeat(Math.max(1, W - stripTags(code).length))}<span class="cm">→</span> <span class="${cls}">${val}</span>`;
    let lines;
    if (f.phase === 'drive') {
      const sgn = fwd ? '' : '−';
      const corr = f.pTerm + f.iTerm + f.dTerm;
      lines = [
        row(`heading = hub.imu.heading()`, `${fmtS(h)}°`),
        row(`error = 0 − heading`, fmtS(f.err)),
      ];
      if (c.splitF) {
        lines.push(row(`<span class="cf">baseL</span> = ${sgn}F<sub>L</sub> × SPEED = ${sgn}${c.kfL.toFixed(3)} × ${c.speed}`, `${fmtS(f.baseL)}%`, 'cf'));
        lines.push(row(`<span class="cf">baseR</span> = ${sgn}F<sub>R</sub> × SPEED = ${sgn}${c.kfR.toFixed(3)} × ${c.speed}`, `${fmtS(f.baseR)}%`, 'cf'));
      } else {
        lines.push(row(`<span class="cf">base</span> = ${sgn}F × SPEED = ${sgn}${c.kf.toFixed(3)} × ${c.speed}`, `${fmtS(f.base)}%`, 'cf'));
      }
      lines.push(row(`<span class="cp">corr</span> = P × error = ${c.kp.toFixed(1)} × ${paren(f.err)}`, `${fmtS(corr)}%`, 'cp'));
      lines.push(row(`left.dc(<span class="cf">base</span> + <span class="cp">corr</span>)`, `${fmtS(f.dcL)}%`));
      lines.push(row(`right.dc(<span class="cf">base</span> − <span class="cp">corr</span>)`, `${fmtS(f.dcR)}%`));
    } else if (f.phase === 'pause') {
      lines = [
        `<span class="cm"># reached the line: travelled ${Math.round((f.aL + f.aR) / 2)}° of wheel</span>`,
        'left.brake()',
        'right.brake()',
        'wait(500)',
        `<span class="cm"># then drive ${fwd ? 'back to line A' : 'out again'}</span>`,
      ];
    } else {
      lines = [`<span class="cm"># program finished</span>`, `hub.display.icon(Icon.${sim.result.endReason === 'finished' ? 'HAPPY' : 'SAD'})`];
    }
    live.innerHTML = lines.join('\n');
    void pad;
  }

  // motor bars
  bar('mb-left', f.phase === 'drive' ? f.baseL : 0, f.dcL);
  bar('mb-right', f.phase === 'drive' ? f.baseR : 0, f.dcR);
}
const paren = (v) => (v < 0 ? `(${fmtS(v)})` : fmtS(v));
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

function bar(id, base, total) {
  const el = $(id);
  const fp = el.querySelector('.fpart'), pp = el.querySelector('.ppart');
  const pct = (v) => Math.max(-100, Math.min(100, v)) / 2; // track is 200% tall, centre = 0
  const placeBar = (node, a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    node.style.bottom = `${50 + pct(lo)}%`;
    node.style.height = `${pct(hi) - pct(lo)}%`;
  };
  placeBar(fp, 0, base);
  placeBar(pp, base, total);
  pp.classList.toggle('minus', Math.abs(total) < Math.abs(base));
  el.querySelector('b').textContent = `${Math.round(total)}%`;
}

// ---------- loop
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.sim) {
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= state.sim.duration) {
        state.t = state.sim.duration;
        state.playing = false;
        syncPlayBtn();
        onEnd();
      }
    }
  }
  drawFrame();
  requestAnimationFrame(tick);
}

function drawFrame() {
  if (state.sim) {
    const frames = state.sim.frames;
    const i = frameIndexAt(frames, state.t);
    const f = frames[i];
    const g = state.sim.ghost;
    const gs = state.t <= g.total ? g.at(state.t) : { x: 0 };
    scene.update(f, i, state.t, gs);
    charts.draw(state.t);
    updateHUD(f);
    $('timeline').value = String(Math.round(state.t / Math.max(0.001, state.sim.duration) * 1000));
    $('time').textContent = `${state.t.toFixed(1)} / ${state.sim.duration.toFixed(1)} s`;
  }
  scene.render();
}

// for testing from the console: __lab.show(12.5) jumps to 12.5 s and draws it
window.__lab = {
  state, runSim, scene,
  show(t) { state.t = t; state.playing = false; syncPlayBtn(); hidePop(); drawFrame(); return state.sim.frames[frameIndexAt(state.sim.frames, t)]; },
  set(cfg) { Object.assign(state.cfg, cfg); writeUI(); runSim(false); return state.sim.result; },
};

function onResize() {
  scene.resize();
  charts.resize();
}
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe($('viewport'));

// ---------- start: the robot drives back and forth, drifting
writeUI();
updateSteps();
onResize();
runSim(true);
requestAnimationFrame(tick);
