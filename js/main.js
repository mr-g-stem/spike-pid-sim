// main.js: wires the sliders, the 3D view, the graphs, missions and playback together.
// Students see F and P as whole numbers: F = go power (%), P = steer-back power (% per degree).
import { simulate, DEFAULTS, frameIndexAt } from './physics.js';
import { createScene } from './scene.js';
import { createCharts } from './charts.js';
import { pybricksCode, fPower } from './codegen.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const SPEED = 200; // mm/s: the ghost's speed
const CLASS_ROBOT = { weakSide: 'left', weakPct: 2, seed: 7 };
const START = { kf: 40 / SPEED, kp: 0 };

const store = {
  get(k, d) { try { const v = localStorage.getItem('pidlab.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pidlab.' + k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

const state = {
  cfg: { ...DEFAULTS, ...CLASS_ROBOT, ...START, speed: SPEED },
  sim: null,
  history: [],
  t: 0,
  playing: false,
  speed: 1,
  runCount: 0,
  mystery: false,
  revealed: false,
  lastGap: null,
  missions: store.get('missions', {}),
  view: store.get('view', { live: false, motors: false, angles: false, charts: false, ghost: true, laser: true, trails: true }),
};

// ---------- 3D + charts
const scene = createScene($('viewport'), $('labels'));
const charts = createCharts({
  drift: $('ch-drift'), heading: $('ch-heading'), speed: $('ch-speed'), power: $('ch-power'),
}, (t) => { state.t = t; state.playing = false; hidePop(); syncPlayBtn(); });

// ---------- tuning controls (whole numbers for students)
const KNOBS = {
  kf: { range: $('kf'), out: $('kf-out'), get: () => fPower(state.cfg), set: (v) => { state.cfg.kf = v / SPEED; } },
  kp: { range: $('kp'), out: $('kp-out'), get: () => Math.round(state.cfg.kp), set: (v) => { state.cfg.kp = v; } },
};

function writeUI() {
  for (const k in KNOBS) {
    const v = KNOBS[k].get();
    KNOBS[k].range.value = v;
    KNOBS[k].out.textContent = v;
  }
  const c = state.cfg;
  $('splitF').checked = c.splitF;
  $('split-box').hidden = !c.splitF;
  $('kfL').value = Math.round(c.kfL * SPEED); $('kfL-out').textContent = Math.round(c.kfL * SPEED);
  $('kfR').value = Math.round(c.kfR * SPEED); $('kfR-out').textContent = Math.round(c.kfR * SPEED);
  $('trips').value = String(c.trips);
  $('loopMs').value = String(c.loopMs);
  $('bumps').checked = c.bumps;
  $('noise').checked = c.noise;
  $('ki').value = c.ki; $('ki-out').textContent = c.ki.toFixed(2);
  $('kd').value = c.kd; $('kd-out').textContent = c.kd.toFixed(2);
  updateWeakInfo();
}

function updateWeakInfo() {
  const c = state.cfg;
  $('weak-info').textContent = state.mystery && !state.revealed ? '??? (mystery)' : `${c.weakSide}, ${c.weakPct.toFixed(1)}% weaker`;
}

let autoTimer = null;
function changed(delay = 0) {
  $('btn-run').classList.add('pulse');
  if (!$('tab-code').hidden) updateCode();
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => runSim(true), delay);
}

for (const k in KNOBS) {
  const kn = KNOBS[k];
  kn.range.addEventListener('input', () => { const v = parseInt(kn.range.value, 10); kn.set(v); kn.out.textContent = v; $('btn-run').classList.add('pulse'); });
  kn.range.addEventListener('change', () => changed(0));
}
document.querySelectorAll('.nudge').forEach((b) => b.addEventListener('click', () => {
  const kn = KNOBS[b.dataset.k];
  const v = Math.max(+kn.range.min, Math.min(+kn.range.max, kn.get() + parseInt(b.dataset.d, 10)));
  kn.set(v); kn.range.value = v; kn.out.textContent = v;
  changed(450); // wait a moment in case they tap again
}));

// teacher: robot + course
$('splitF').addEventListener('change', () => {
  const c = state.cfg;
  c.splitF = $('splitF').checked;
  if (c.splitF) { c.kfL = c.kf; c.kfR = c.kf; } else { c.kf = (c.kfL + c.kfR) / 2; }
  writeUI(); changed();
});
for (const id of ['kfL', 'kfR']) {
  $(id).addEventListener('input', () => { state.cfg[id] = parseInt($(id).value, 10) / SPEED; $(`${id}-out`).textContent = $(id).value; });
  $(id).addEventListener('change', () => changed());
}
for (const id of ['ki', 'kd']) {
  $(id).addEventListener('input', () => { state.cfg[id] = parseFloat($(id).value); $(`${id}-out`).textContent = state.cfg[id].toFixed(2); });
  $(id).addEventListener('change', () => changed());
}
$('unlockID').addEventListener('change', () => {
  const on = $('unlockID').checked;
  $('id-box').hidden = !on;
  $('locked-row').hidden = on;
  if (!on) { state.cfg.ki = 0; state.cfg.kd = 0; writeUI(); changed(); }
});
if (params.has('unlock')) { $('unlockID').checked = true; $('id-box').hidden = false; $('locked-row').hidden = true; $('teacher').open = true; }
for (const id of ['trips', 'loopMs']) $(id).addEventListener('change', () => { state.cfg[id] = parseInt($(id).value, 10); changed(); });
for (const id of ['bumps', 'noise']) $(id).addEventListener('change', () => { state.cfg[id] = $(id).checked; changed(); });

// teacher: what shows on screen
const VIEW_OPTS = { live: 'opt-live', motors: 'opt-motors', angles: 'opt-angles', charts: 'opt-charts', ghost: 'opt-ghost', laser: 'opt-laser', trails: 'opt-trails' };
function applyView() {
  const v = state.view;
  $('live').hidden = !v.live;
  $('motors').hidden = !v.motors;
  $('more-charts').hidden = !v.charts;
  scene.opts.angles = v.angles;
  scene.opts.ghost = v.ghost;
  scene.opts.laser = v.laser;
  scene.opts.trails = v.trails;
  for (const k in VIEW_OPTS) $(VIEW_OPTS[k]).checked = !!v[k];
  requestAnimationFrame(onResize);
}
for (const k in VIEW_OPTS) {
  $(VIEW_OPTS[k]).addEventListener('change', () => { state.view[k] = $(VIEW_OPTS[k]).checked; store.set('view', state.view); applyView(); });
}

// mystery robot
$('btn-mystery').addEventListener('click', () => {
  state.mystery = true; state.revealed = false;
  state.cfg.weakSide = Math.random() < 0.5 ? 'left' : 'right';
  state.cfg.weakPct = Math.round((1.5 + Math.random() * 3) * 10) / 10;
  state.cfg.seed = 1 + Math.floor(Math.random() * 9999);
  Object.assign(state.cfg, START, { splitF: false });
  $('btn-normal').hidden = false;
  writeUI();
  runSim(true);
});
$('btn-normal').addEventListener('click', () => {
  state.mystery = false; state.revealed = false;
  Object.assign(state.cfg, CLASS_ROBOT);
  $('btn-normal').hidden = true;
  updateWeakInfo();
  runSim(true);
});
$('btn-reveal').addEventListener('click', () => { state.revealed = true; updateWeakInfo(); });
$('btn-reset').addEventListener('click', () => { state.missions = {}; store.set('missions', {}); renderMissions(); });

// ---------- run
function runSim(autoplay = true) {
  clearTimeout(autoTimer);
  const sim = simulate({ ...state.cfg });
  sim.id = ++state.runCount;
  sim.mystery = state.mystery;
  sim.legStarts = [0];
  for (const e of sim.events) if (e.type === 'start') sim.legStarts[e.leg] = e.t;
  const previous = state.history.map((h) => h.sim);
  for (const h of state.history) h.revealed = true;
  scene.setRun(sim, previous);
  charts.setRun(sim, previous[0]);
  state.history.unshift({ sim, revealed: false });
  if (state.history.length > 10) state.history.pop();
  state.sim = sim;
  state.t = 0;
  state.lastGap = null;
  state.playing = autoplay;
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
  Object.assign(state.cfg, { kf: sim.cfg.kf, kp: sim.cfg.kp, splitF: sim.cfg.splitF, kfL: sim.cfg.kfL, kfR: sim.cfg.kfR });
  writeUI();
  state.t = 0; state.lastGap = null; state.playing = true;
  hidePop(); syncPlayBtn(); renderLog(); updateCode();
}

function onEnd() {
  const entry = state.history.find((h) => h.sim === state.sim);
  const first = entry && !entry.revealed;
  if (entry) entry.revealed = true;
  renderLog();
  showPop();
  if (first) checkMissions(state.sim);
}

// ---------- missions
const MISSIONS = ['watch', 'f', 'p', 'wiggle', 'mystery'];
function checkMissions(sim) {
  const r = sim.result, m = state.missions;
  const before = { ...m };
  m.watch = true;
  if (r.endReason === 'finished' && Math.abs(r.speedErrPct) < 6) m.f = true;
  if (r.stars === 3) m.p = true;
  if (r.wobble > 2.5) m.wiggle = true;
  if (r.stars === 3 && sim.mystery) m.mystery = true;
  store.set('missions', m);
  const fresh = MISSIONS.filter((k) => m[k] && !before[k]);
  renderMissions(fresh);
  if (r.stars === 3 || fresh.length) confetti(r.stars === 3 ? 70 : 30);
}
function renderMissions(fresh = []) {
  const m = state.missions;
  let nowSet = false, done = 0;
  for (const li of $('missions').children) {
    const k = li.dataset.m;
    li.classList.toggle('done', !!m[k]);
    li.classList.toggle('just-done', fresh.includes(k));
    const isNow = !m[k] && !nowSet;
    li.classList.toggle('now', isNow);
    if (isNow) nowSet = true;
    if (m[k]) done++;
  }
  $('mcount').textContent = `${done} of ${MISSIONS.length}`;
}

function confetti(n) {
  const box = $('viewport');
  const colors = ['#ffc928', '#2f80ed', '#f2761d', '#22c55e', '#db2777', '#7c3aed'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    d.className = 'confetti';
    d.style.cssText = `position:absolute;z-index:6;left:${10 + Math.random() * 80}%;top:-12px;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px;background:${colors[i % colors.length]};border-radius:2px;pointer-events:none;`;
    box.appendChild(d);
    const dx = (Math.random() - 0.5) * 240, rot = (Math.random() - 0.5) * 900;
    const anim = d.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${dx}px, ${box.clientHeight + 30}px) rotate(${rot}deg)` }],
      { duration: 1400 + Math.random() * 1200, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 300 });
    anim.onfinish = () => d.remove();
  }
}

// ---------- transport
$('btn-run').addEventListener('click', () => runSim(true));
$('btn-play').addEventListener('click', () => {
  if (!state.sim) return;
  if (state.t >= state.sim.duration) { state.t = 0; state.lastGap = null; hidePop(); }
  state.playing = !state.playing;
  syncPlayBtn();
});
$('btn-replay').addEventListener('click', replay);
function replay() { state.t = 0; state.lastGap = null; state.playing = true; hidePop(); syncPlayBtn(); }
$('btn-end').addEventListener('click', () => {
  if (!state.sim) return;
  state.t = state.sim.duration; state.playing = false; syncPlayBtn(); onEnd();
});
$('timeline').addEventListener('input', () => {
  if (!state.sim) return;
  state.t = $('timeline').value / 1000 * state.sim.duration;
  state.playing = false; hidePop(); syncPlayBtn();
});
$('btn-fast').addEventListener('click', () => {
  state.speed = state.speed === 1 ? 2 : 1;
  $('btn-fast').setAttribute('aria-pressed', String(state.speed === 2));
});
function syncPlayBtn() { $('btn-play').textContent = state.playing ? '❚❚' : '▶'; }

$('cam-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cam]');
  if (!b) return;
  for (const x of $('cam-seg').children) x.classList.toggle('on', x === b);
  const f = state.sim ? state.sim.frames[frameIndexAt(state.sim.frames, state.t)] : null;
  scene.setCamera(b.dataset.cam, f);
});

// ---------- result pop-up
function showPop() {
  const r = state.sim.result;
  const pop = $('result-pop');
  pop.className = `result-pop ${r.coach.tone}`;
  $('pop-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('');
  $('pop-title').textContent = r.coach.title;
  $('pop-text').textContent = r.coach.text;
  const race = r.endReason === 'stuck' || r.endReason === 'tooSlow' ? 'Too slow'
    : Math.abs(r.speedErrPct) < 6 ? 'Kept up ✓' : r.speedErrPct < 0 ? 'Too slow' : 'Too fast';
  $('pop-stats').innerHTML = [
    ['Most off the path', `${Math.round(r.driftCm)} cm`],
    ['Ghost race', race],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  pop.hidden = false;
}
function hidePop() { $('result-pop').hidden = true; }
$('pop-close').addEventListener('click', hidePop);
$('pop-replay').addEventListener('click', replay);

// ---------- my tries
function renderLog() {
  const body = $('log-body');
  if (!state.history.length) { body.innerHTML = '<tr class="empty"><td colspan="5">Your tries show up here. Tap one to watch it again.</td></tr>'; return; }
  body.innerHTML = '';
  for (const h of state.history) {
    const s = h.sim, r = s.result, c = s.cfg;
    const tr = document.createElement('tr');
    if (s === state.sim) tr.className = 'cur';
    const fTxt = c.splitF ? `${Math.round(c.kfL * SPEED)}/${Math.round(c.kfR * SPEED)}` : fPower(c);
    const cells = [
      [`${s.id}${s.mystery ? '🎲' : ''}`, ''],
      [fTxt, 'tf'],
      [Math.round(c.kp), 'tp'],
      [h.revealed ? `${Math.round(r.driftCm)} cm` : '…', ''],
      [h.revealed ? ('★'.repeat(r.stars) || '–') : '…', h.revealed ? (r.stars ? 'st' : 'st0') : ''],
    ];
    for (const [v, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = v;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => loadRun(h));
    body.appendChild(tr);
  }
}

// ---------- code tab
function updateCode() { $('code-out').textContent = pybricksCode(state.cfg); }
$('btn-copy').addEventListener('click', async () => {
  const text = $('code-out').textContent;
  try { await navigator.clipboard.writeText(text); $('btn-copy').textContent = 'Copied ✓'; }
  catch { const r = document.createRange(); r.selectNodeContents($('code-out')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('btn-copy').textContent = 'Press Ctrl+C'; }
  setTimeout(() => { $('btn-copy').textContent = 'Copy code'; }, 1800);
});

// ---------- tabs
let explainLoaded = null;
function showTab(tab) {
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', String(x.dataset.tab === tab));
  $('tab-sim').hidden = tab !== 'sim';
  $('tab-code').hidden = tab !== 'code';
  $('tab-how').hidden = tab !== 'how';
  if (tab === 'code') updateCode();
  if (tab === 'sim') requestAnimationFrame(onResize);
  if (tab === 'how') {
    if (!explainLoaded) explainLoaded = import('./explain.js').then((m) => m.initExplain());
    explainLoaded.then((ex) => ex && ex.resize());
  }
  window.scrollTo(0, 0);
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto]');
  if (a) { e.preventDefault(); showTab(a.dataset.goto); }
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || $('tab-sim').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); }
  else if (e.key === 'r' || e.key === 'R') runSim(true);
});

// ---------- on-screen cards
const fmtS = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

function ghostAt(sim, f, t) {
  if (f.phase === 'done') return { x: 0, d: sim.cfg.distance };
  const fwd = f.leg % 2 === 0;
  const start = sim.legStarts[f.leg] ?? 0;
  const d = sim.ghost.inLeg(t - start);
  return { x: fwd ? d : sim.cfg.distance - d, d };
}

function updateHUD(f, gs) {
  const sim = state.sim, c = sim.cfg;
  const fwd = f.leg % 2 === 0;
  let phase = 'Ready', dot = '';
  if (f.phase === 'drive') { phase = fwd ? 'Driving out →' : '← Driving back'; dot = 'run'; }
  else if (f.phase === 'pause') { phase = 'Stopped at the line'; dot = 'pause'; }
  else if (f.phase === 'done') phase = 'Done!';
  if (state.t >= sim.duration) {
    const e = sim.result.endReason;
    if (e === 'stuck') phase = 'Stuck!';
    else if (e === 'offTable') phase = 'Off the table!';
    else if (e === 'tooSlow') phase = 'Gave up';
  }
  if (!state.playing && state.t > 0 && state.t < sim.duration) phase = 'Paused';
  $('st-phase').textContent = phase;
  $('st-dot').className = `dot ${state.playing ? dot : ''}`;
  $('st-trip').textContent = `Trip ${Math.min(c.trips, Math.floor(f.leg / 2) + 1)} of ${c.trips}`;

  // off the path
  const cm = Math.abs(f.y) / 10;
  $('kc-path-num').textContent = cm < 0.5 ? 'On the path' : `${Math.round(cm)} cm ${f.y > 0 ? 'left' : 'right'}`;
  $('kc-path').className = `kcard ${cm < 2 ? 'good' : cm < 5 ? 'warn' : 'bad'}`;
  $('lane-dot').style.left = `${Math.max(3, Math.min(97, 50 - (f.y / 300) * 50))}%`;

  // ghost race (only while driving; keep the last result at the lines)
  if (f.phase === 'drive' && state.t > 0.15) {
    const you = fwd ? f.x : c.distance - f.x;
    state.lastGap = you - gs.d;
  }
  const g = state.lastGap;
  const kg = $('kc-ghost');
  if (g === null) { $('kc-ghost-txt').textContent = 'Ready'; kg.className = 'kcard'; }
  else if (Math.abs(g) < 60) { $('kc-ghost-txt').textContent = 'Keeping up!'; kg.className = 'kcard good'; }
  else if (g < 0) { $('kc-ghost-txt').textContent = `Behind ${Math.round(-g / 10)} cm`; kg.className = `kcard ${g < -200 ? 'bad' : 'warn'}`; }
  else { $('kc-ghost-txt').textContent = `Ahead ${Math.round(g / 10)} cm`; kg.className = 'kcard warn'; }
  $('race-you').style.left = `${Math.max(3, Math.min(97, 50 + ((g || 0) / 400) * 50))}%`;

  // teacher: the code, right now
  if (state.view.live) {
    const W = 30;
    const row = (code, val, cls = 'cv') => `${code}${' '.repeat(Math.max(1, W - code.replace(/<[^>]+>/g, '').length))}<span class="cm">→</span> <span class="${cls}">${val}</span>`;
    let lines;
    if (f.phase === 'drive') {
      const steer = f.pTerm + f.iTerm + f.dTerm;
      const sgn = fwd ? '' : '−';
      lines = [
        row('error = 0 − heading', fmtS(f.err)),
        c.splitF ? row(`<span class="cf">go</span> = ${sgn}F (left/right)`, `${Math.round(f.baseL)}/${Math.round(f.baseR)}%`, 'cf')
          : row(`<span class="cf">go</span> = ${sgn}F = ${sgn}${fPower(c)}`, `${Math.round(f.base)}%`, 'cf'),
        row(`<span class="cp">steer</span> = P × error = ${Math.round(c.kp)} × ${f.err < 0 ? `(${fmtS(f.err)})` : fmtS(f.err)}`, `${fmtS(steer)}%`, 'cp'),
        row('left.dc(<span class="cf">go</span> + <span class="cp">steer</span>)', `${Math.round(f.dcL)}%`),
        row('right.dc(<span class="cf">go</span> − <span class="cp">steer</span>)', `${Math.round(f.dcR)}%`),
      ];
    } else if (f.phase === 'pause') {
      lines = ['<span class="cm"># reached the line</span>', 'left.brake()', 'right.brake()', 'wait(500)'];
    } else {
      lines = ['<span class="cm"># all done</span>', `hub.display.icon(Icon.${sim.result.endReason === 'finished' ? 'HAPPY' : 'SAD'})`];
    }
    $('live-code').innerHTML = lines.join('\n');
  }
  if (state.view.motors) {
    bar('mb-left', f.phase === 'drive' ? f.baseL : 0, f.dcL);
    bar('mb-right', f.phase === 'drive' ? f.baseR : 0, f.dcR);
  }
}

function bar(id, base, total) {
  const el = $(id);
  const fp = el.querySelector('.fpart'), pp = el.querySelector('.ppart');
  const pct = (v) => Math.max(-100, Math.min(100, v)) / 2;
  const place = (node, a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    node.style.bottom = `${50 + pct(lo)}%`;
    node.style.height = `${pct(hi) - pct(lo)}%`;
  };
  place(fp, 0, base);
  place(pp, base, total);
  pp.classList.toggle('minus', Math.abs(total) < Math.abs(base));
  el.querySelector('b').textContent = `${Math.round(total)}%`;
}

// ---------- loop
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.sim && state.playing && !$('tab-sim').hidden) {
    state.t += dt * state.speed;
    if (state.t >= state.sim.duration) {
      state.t = state.sim.duration;
      state.playing = false;
      syncPlayBtn();
      onEnd();
    }
  }
  if (!$('tab-sim').hidden) drawFrame();
  requestAnimationFrame(tick);
}

function drawFrame() {
  if (state.sim) {
    const frames = state.sim.frames;
    const i = frameIndexAt(frames, state.t);
    const f = frames[i];
    const gs = ghostAt(state.sim, f, state.t);
    scene.update(f, i, state.t, gs);
    charts.draw(state.t);
    updateHUD(f, gs);
    $('timeline').value = String(Math.round(state.t / Math.max(0.001, state.sim.duration) * 1000));
  }
  scene.render();
}

// for testing from the console: __lab.show(12.5) jumps to 12.5 s and draws it
window.__lab = {
  state, runSim, scene,
  show(t) { state.t = t; state.playing = false; syncPlayBtn(); hidePop(); drawFrame(); return state.sim.frames[frameIndexAt(state.sim.frames, t)]; },
  set(cfg) { Object.assign(state.cfg, cfg); writeUI(); runSim(false); return state.sim.result; },
  end() { state.t = state.sim.duration; state.playing = false; drawFrame(); onEnd(); return state.sim.result; },
};

function onResize() { scene.resize(); charts.resize(); }
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe($('viewport'));

// ---------- start: the robot drives back and forth, drifting
writeUI();
applyView();
renderMissions();
onResize();
runSim(true);
requestAnimationFrame(tick);
if (location.hash === '#how') showTab('how');
