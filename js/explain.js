// explain.js: the animated "How it works" page (grades 3-5).
// Every scene only animates while it is on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRobot } from './scene.js';
import { simulate, ghostSchedule, MM_PER_DEG } from './physics.js';

const FONT = '"Nunito", system-ui, sans-serif';
const C = {
  ink: '#1c2740', muted: '#5d6b85', line: '#d8e1ee',
  f: '#2f80ed', p: '#f2761d', good: '#16a34a', warn: '#d97706', bad: '#dc2626',
  path: '#2f6fdb', mat: '#f7f5ef', grid: '#e6e2d9', tape: '#17191d',
  yellow: '#ffc928', white: '#fbfbf8', grey: '#c3c8cf', dark: '#363a42', tyre: '#22252b', purple: '#7c3aed',
};
const $ = (id) => document.getElementById(id);

// ---------- animation manager
const stages = [];
let tabVisible = () => !$('tab-how').hidden;
const io = new IntersectionObserver((entries) => {
  for (const e of entries) { const s = stages.find((x) => x.el === e.target); if (s) s.visible = e.isIntersecting; }
}, { threshold: 0.05 });

function stage(el, step) {
  const s = { el, step, visible: false, t: 0, W: 0, H: 0, g: el.tagName === 'CANVAS' ? el.getContext('2d') : null };
  stages.push(s);
  io.observe(el);
  return s;
}
function sizeAll() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const s of stages) {
    const r = s.el.getBoundingClientRect();
    if (!r.width) continue;
    s.W = r.width; s.H = r.height;
    if (s.g) {
      s.el.width = Math.round(r.width * dpr); s.el.height = Math.round(r.height * dpr);
      s.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (s.onResize) s.onResize();
  }
}
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (tabVisible()) {
    for (const s of stages) {
      if (!s.visible || !s.W) continue;
      s.t += dt;
      s.step(dt, s);
    }
  }
  requestAnimationFrame(loop);
}

// ---------- drawing helpers
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function text(g, str, x, y, { size = 14, weight = 800, color = C.ink, align = 'left', base = 'alphabetic' } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  g.fillText(str, x, y);
  g.textBaseline = 'alphabetic';
}
function pill(g, str, x, y, bg, fg = '#fff', size = 13) {
  g.font = `900 ${size}px ${FONT}`;
  const w = g.measureText(str).width + 14, h = size + 9;
  rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fillStyle = bg; g.fill();
  text(g, str, x, y + size * 0.36, { size, weight: 900, color: fg, align: 'center' });
}

const ARROW_UP = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];
// Top-down SPIKE driving base. (x, y) = axle centre on screen, ang = heading in
// radians (counterclockwise on screen is +), s = pixels per mm.
function drawRobot(g, x, y, ang, s, o = {}) {
  g.save();
  g.translate(x, y); g.rotate(-ang); g.scale(s, -s);
  const ghost = !!o.ghost;
  if (o.laser) {
    const grad = g.createLinearGradient(40, 0, 40 + o.laser, 0);
    grad.addColorStop(0, 'rgba(242,118,29,0.95)'); grad.addColorStop(1, 'rgba(242,118,29,0)');
    g.fillStyle = grad; g.fillRect(40, -3.5 / s * 0.6, o.laser, 7 / s * 0.6);
  }
  if (!ghost) { g.fillStyle = 'rgba(28,39,64,0.16)'; rr(g, -92, -70, 128, 136, 20); g.fill(); }
  const fill = (c) => { g.fillStyle = ghost ? 'rgba(96,165,250,0.22)' : c; g.fill(); if (ghost) { g.strokeStyle = 'rgba(37,99,235,0.6)'; g.lineWidth = 1.6 / s; g.stroke(); } };
  // caster + rear beam
  g.beginPath(); g.arc(-80, 0, 10, 0, Math.PI * 2); fill('#aeb6c2');
  rr(g, -90, -44, 9, 88, 4); fill(C.grey);
  // wheels with moving tread
  for (const side of [1, -1]) {
    const y0 = side > 0 ? 49 : -63;
    rr(g, -28, y0, 56, 14, 4); fill(C.tyre);
    if (!ghost) {
      g.save(); rr(g, -28, y0, 56, 14, 4); g.clip();
      const a = side > 0 ? (o.aL || 0) : (o.aR || 0);
      const off = ((a * MM_PER_DEG) % 12 + 12) % 12;
      g.fillStyle = '#4a4f59';
      for (let k = -2; k < 7; k++) g.fillRect(-28 + k * 12 - off + 12, y0, 5, 14);
      g.restore();
    }
  }
  // motors
  rr(g, -33, 15, 54, 30, 6); fill(C.white);
  rr(g, -33, -45, 54, 30, 6); fill(C.white);
  if (!ghost && o.motorGlow) {
    const [gl, gr] = o.motorGlow;
    g.fillStyle = `rgba(242,118,29,${gl})`; rr(g, -33, 15, 54, 30, 6); g.fill();
    g.fillStyle = `rgba(242,118,29,${gr})`; rr(g, -33, -45, 54, 30, 6); g.fill();
  }
  // hub
  rr(g, -66, -28, 88, 56, 9); fill(C.yellow);
  if (!ghost) {
    rr(g, -63, -25, 82, 50, 7); g.fillStyle = C.white; g.fill();
    rr(g, -31, -21, 42, 42, 4); g.fillStyle = '#23272e'; g.fill();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      g.fillStyle = ARROW_UP[r][c] === '#' ? '#fff3c4' : '#3b414b';
      g.fillRect(-10 + (2 - r) * 7.6 - 2.6, (2 - c) * 7.6 - 2.6, 5.2, 5.2);
    }
    g.beginPath(); g.arc(-50, 0, 6.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 2.4; g.strokeStyle = o.ring || '#34d399'; g.stroke();
    if (o.gyroGlow) {
      g.beginPath(); g.arc(-22, 0, 22, 0, Math.PI * 2);
      g.fillStyle = `rgba(124,58,237,${0.18 + 0.12 * Math.sin(o.gyroGlow * 4)})`; g.fill();
    }
  }
  g.restore();
}

// a strip of mat with start/end tape and the blue path
function drawLane(g, X, Y, x0mm, x1mm, yTop, yBot, opts = {}) {
  g.fillStyle = C.mat; g.fillRect(X(x0mm), yTop, X(x1mm) - X(x0mm), yBot - yTop);
  g.strokeStyle = C.grid; g.lineWidth = 1;
  for (let x = Math.ceil(x0mm / 100) * 100; x <= x1mm; x += 100) { g.beginPath(); g.moveTo(X(x), yTop); g.lineTo(X(x), yBot); g.stroke(); }
  if (opts.zone) { g.fillStyle = 'rgba(22,163,74,0.16)'; g.fillRect(X(0), Y(opts.zone), X(opts.end) - X(0), Y(-opts.zone) - Y(opts.zone)); }
  g.strokeStyle = C.path; g.lineWidth = 2.5; g.setLineDash([10, 7]);
  g.beginPath(); g.moveTo(X(x0mm + 40), Y(0)); g.lineTo(X(x1mm - 40), Y(0)); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.tape;
  if (!opts.noStart) g.fillRect(X(0) - 3, yTop + 6, 6, yBot - yTop - 12);
  if (opts.end) g.fillRect(X(opts.end) - 3, yTop + 6, 6, yBot - yTop - 12);
}

function trail(g, frames, n, X, Y, color, width) {
  if (n < 2) return;
  g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(X(frames[0].x), Y(frames[0].y));
  for (let i = 1; i < n; i += 2) g.lineTo(X(frames[i].x), Y(frames[i].y));
  g.stroke();
}

// the drive out to the far line, plus the stop there
function firstLeg(sim) { return sim.frames.filter((f) => f.leg === 0); }

// =====================================================================
export function initExplain() {
  const scenes = [robot3D(), driftScene(), fScene(), gyroScene(), pScene(), lanesScene(), loopScene()];
  void scenes;
  sizeAll();
  window.addEventListener('resize', sizeAll);
  requestAnimationFrame(loop);
  return { resize: () => requestAnimationFrame(sizeAll) };
}

// ---------- 1. Meet the robot (3D, drag to spin)
function robot3D() {
  const box = $('ex-robot');
  const labelBox = $('ex-robot-labels');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  box.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 5, 5000);
  camera.position.set(250, 260, 420);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-28, 40, 0);
  controls.enableZoom = false; controls.enablePan = false;
  controls.autoRotate = true; controls.autoRotateSpeed = 1.6;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.35;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-200, 500, 300); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 50, far: 1200 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(190, 48), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  floor.position.x = -25;
  scene.add(floor);
  const bot = buildRobot(renderer);
  bot.setMatrix('up');
  bot.setButton(0x34d399);
  scene.add(bot.group);
  // labelled parts (robot coordinates: x forward, y up, z = right side).
  // Labels sit in two columns at the sides with a line to the part, so they never pile up.
  const tags = [
    ['The hub: the brain', 'y', new THREE.Vector3(-40, 90, 0)],
    ['Gyro (inside the hub)', 'g', new THREE.Vector3(-22, 70, 0)],
    ['Left motor', 'f', new THREE.Vector3(-6, 32, -46)],
    ['Right motor', 'f', new THREE.Vector3(-6, 32, 46)],
    ['Wheel', '', new THREE.Vector3(0, 28, 63)],
    ['Wheel', '', new THREE.Vector3(0, 28, -63)],
    ['Metal ball', '', new THREE.Vector3(-80, 9, 0)],
  ].map(([t, cls, p]) => {
    const el = document.createElement('div');
    el.className = `ex-tag side ${cls}`;
    el.textContent = t;
    labelBox.appendChild(el);
    return { el, p, w: 0 };
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ex-lines');
  labelBox.prepend(svg);
  const lines = tags.map(() => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); svg.appendChild(l); return l; });
  const dots = tags.map(() => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', '4'); svg.appendChild(c); return c; });
  let wheelA = 0;
  const v = new THREE.Vector3();
  const world = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const s = stage(box, (dt) => {
    wheelA += dt * 160;
    bot.setWheels(wheelA, wheelA);
    controls.update();
    renderer.render(scene, camera);
    camera.getWorldDirection(camDir);
    // project every part; hide parts on the far side of the robot
    const pts = tags.map((tg, i) => {
      world.copy(tg.p);
      v.copy(world).project(camera);
      const toPart = world.clone().sub(camera.position).normalize();
      const facing = tg.p.z === 0 || Math.sign(tg.p.z) === Math.sign(camera.position.z - world.z) || Math.abs(camera.position.z) < 120;
      return { i, x: (v.x + 1) / 2 * s.W, y: (1 - v.y) / 2 * s.H, show: facing && toPart.dot(camDir) > 0 };
    });
    const cxs = s.W / 2;
    for (const side of [-1, 1]) {
      const col = pts.filter((p) => p.show && (p.x < cxs ? -1 : 1) === side).sort((a, b) => a.y - b.y);
      let lastY = -Infinity;
      for (const p of col) {
        const tg = tags[p.i];
        if (!tg.w) tg.w = tg.el.offsetWidth;
        const ly = Math.max(p.y, lastY + 30, 16);
        lastY = ly;
        const lx = side < 0 ? 10 : s.W - 10 - tg.w;
        tg.el.style.display = '';
        tg.el.style.transform = `translate(${lx.toFixed(1)}px, ${(ly - 13).toFixed(1)}px)`;
        const ex = side < 0 ? lx + tg.w : lx;
        lines[p.i].setAttribute('x1', ex); lines[p.i].setAttribute('y1', ly);
        lines[p.i].setAttribute('x2', p.x); lines[p.i].setAttribute('y2', p.y);
        lines[p.i].style.display = ''; dots[p.i].style.display = '';
        dots[p.i].setAttribute('cx', p.x); dots[p.i].setAttribute('cy', p.y);
      }
    }
    for (const p of pts) if (!p.show) { tags[p.i].el.style.display = 'none'; lines[p.i].style.display = 'none'; dots[p.i].style.display = 'none'; }
  });
  s.onResize = () => {
    renderer.setSize(s.W, s.H, false);
    renderer.domElement.style.width = s.W + 'px';
    renderer.domElement.style.height = s.H + 'px';
    camera.aspect = s.W / s.H; camera.updateProjectionMatrix();
  };
  return s;
}

// ---------- 2. Why does it drift?
function driftScene() {
  const base = { kf: 0.235, kp: 0, trips: 1, bumps: false, noise: false, seed: 3 };
  const sims = {
    1: firstLeg(simulate({ ...base, weakSide: 'left', weakPct: 3 })),
    0: firstLeg(simulate({ ...base, weakSide: 'left', weakPct: 0 })),
  };
  let mode = 1;
  const s = stage($('ex-drift'), (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    const frames = sims[mode];
    const dur = frames[frames.length - 1].t;
    const tt = (st.t * 1.6) % (dur + 1.5);
    const i = Math.min(frames.length - 1, Math.floor(tt / 0.01));
    const f = frames[i];
    const sc = (W - 40) / 1750;
    const X = (x) => 20 + (x + 120) * sc;
    const midY = H * 0.66;
    const Y = (y) => midY - y * sc;
    g.clearRect(0, 0, W, H);
    drawLane(g, X, Y, -120, 1630, 14, H - 64, { end: 1500, zone: 20 });
    trail(g, frames, i, X, Y, C.bad, 4);
    drawRobot(g, X(f.x), Y(f.y), f.th, sc * 1.6, { aL: f.aL, aR: f.aR });
    if (Math.abs(f.y) > 15) pill(g, `${Math.round(Math.abs(f.y) / 10)} cm off`, X(f.x), Y(f.y) - 52, C.bad);
    // wheel speed bars
    const by = H - 46, bw = Math.min(260, W * 0.42);
    const mx = 470;
    const bars = [['Left wheel', f.wL], ['Right wheel', f.wR]];
    bars.forEach(([name, w], k) => {
      const yy = by + k * 20;
      text(g, name, 20, yy + 11, { size: 13, color: C.muted });
      rr(g, 110, yy, bw, 14, 7); g.fillStyle = '#e8edf4'; g.fill();
      rr(g, 110, yy, Math.max(0, Math.min(1, w / mx)) * bw, 14, 7); g.fillStyle = k === 0 && mode === 1 ? C.p : C.f; g.fill();
    });
    if (mode === 1) text(g, '← a little slower', 118 + bw * Math.min(1, f.wL / mx), by + 11, { size: 13, color: C.p });
  });
  $('ex-drift-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-weak]');
    if (!b) return;
    mode = Number(b.dataset.weak);
    for (const x of $('ex-drift-seg').children) x.classList.toggle('on', x === b);
    s.t = 0;
  });
  return s;
}

// ---------- 3. F is the go power: race the ghost
function fScene() {
  const slider = $('ex-f'), out = $('ex-f-out'), verdict = $('ex-f-verdict');
  let leg = null, ghost = null, result = null;
  function compute() {
    const F = parseInt(slider.value, 10);
    out.textContent = F;
    const cfg = { kf: F / 200, kp: 5, trips: 1, bumps: false, noise: false, weakPct: 2 };
    const sim = simulate(cfg);
    leg = firstLeg(sim);
    ghost = ghostSchedule({ ...sim.cfg });
    result = sim.result;
    const r = result;
    let txt, cls;
    if (r.endReason === 'stuck' || leg[leg.length - 1].x < 200) { txt = 'Not even moving! More F.'; cls = 'bad'; }
    else if (r.speedErrPct < -6) { txt = 'Behind the ghost. More F!'; cls = 'warn'; }
    else if (r.speedErrPct > 6) { txt = 'Zooming ahead! Less F.'; cls = 'warn'; }
    else { txt = 'Keeping up with the ghost! ✓'; cls = 'good'; }
    verdict.textContent = txt; verdict.className = `ex-verdict ${cls}`;
    s.t = 0;
  }
  const s = stage($('ex-fcan'), (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    const dur = Math.max(ghost.legT, leg[leg.length - 1].t) + 1.2;
    const tt = st.t % Math.min(dur, 14);
    const i = Math.min(leg.length - 1, Math.floor(tt / 0.01));
    const f = leg[i];
    const gx = ghost.inLeg(tt);
    const sc = (W - 40) / 1750;
    const X = (x) => 20 + (x + 120) * sc;
    const Y1 = (y) => H * 0.33 - y * sc, Y2 = (y) => H * 0.72 - y * sc;
    g.clearRect(0, 0, W, H);
    drawLane(g, X, Y1, -120, 1630, 10, H * 0.5 - 4, { end: 1500 });
    drawLane(g, X, Y2, -120, 1630, H * 0.5 + 4, H - 10, { end: 1500 });
    drawRobot(g, X(gx), Y1(0), 0, sc * 1.6, { ghost: true });
    pill(g, 'ghost: perfect speed', X(gx), H * 0.33 - 44, '#60a5fa');
    drawRobot(g, X(f.x), Y2(f.y), f.th, sc * 1.6, { aL: f.aL, aR: f.aR, motorGlow: [f.dcL / 160, f.dcR / 160] });
    pill(g, `your robot: F = ${slider.value}`, X(f.x), H * 0.72 - 44, C.f);
    // the gap between them
    const gapPx = X(f.x) - X(gx);
    if (Math.abs(gapPx) > 12 && f.phase === 'drive') {
      g.strokeStyle = gapPx < 0 ? C.warn : C.bad; g.lineWidth = 2; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(X(gx), H * 0.5 - 4); g.lineTo(X(gx), H * 0.5 + 4); g.lineTo(X(f.x), H * 0.5 + 4); g.stroke(); g.setLineDash([]);
    }
  });
  slider.addEventListener('input', compute);
  compute();
  return s;
}

// ---------- 4. The gyro feels turns (drag the robot)
function gyroScene() {
  const el = $('ex-gyro');
  let h = 0, target = 0, dragging = false, lastTouch = -10;
  const s = stage(el, (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    if (!dragging && st.t - lastTouch > 2.5) target = 30 * Math.sin((st.t - lastTouch) * 0.9);
    h += (target - h) * Math.min(1, dt * (dragging ? 18 : 4));
    const cx = W / 2, cy = H * 0.7, R = Math.min(W * 0.4, H * 0.5);
    g.clearRect(0, 0, W, H);
    // dial (top half)
    g.lineWidth = 16; g.strokeStyle = '#e8edf4';
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.stroke();
    g.lineWidth = 16; g.strokeStyle = h >= 0 ? 'rgba(242,118,29,0.55)' : 'rgba(47,128,237,0.55)';
    const a0 = -Math.PI / 2, a1 = -Math.PI / 2 + (h * Math.PI / 180);
    g.beginPath(); g.arc(cx, cy, R, Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
    for (let d = -90; d <= 90; d += 10) {
      const a = -Math.PI / 2 + d * Math.PI / 180;
      const len = d % 30 === 0 ? 16 : 8;
      g.strokeStyle = C.muted; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.lineTo(cx + Math.cos(a) * (R - 12 - len), cy + Math.sin(a) * (R - 12 - len)); g.stroke();
      if (d % 30 === 0) text(g, d === 0 ? '0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`, cx + Math.cos(a) * (R + 22), cy + Math.sin(a) * (R + 22) + 5, { size: 13, color: C.muted, align: 'center' });
    }
    text(g, 'LEFT', cx - R - 6, cy + 24, { size: 13, color: C.f, align: 'center', weight: 900 });
    text(g, 'RIGHT', cx + R + 6, cy + 24, { size: 13, color: C.p, align: 'center', weight: 900 });
    // robot in the middle, facing up; heading + = turned right (clockwise)
    const ang = Math.PI / 2 - h * Math.PI / 180;
    const rs = Math.min(1, R / 190);
    drawRobot(g, cx, cy, ang, rs, { laser: R * 0.88 / rs, gyroGlow: st.t });
    // the number the gyro reports
    const n = Math.round(h);
    const sgn = n > 0 ? '+' : n < 0 ? '−' : '';
    rr(g, 12, 12, 150, 62, 14); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1.5; g.stroke();
    text(g, `gyro: ${sgn}${Math.abs(n)}`, 87, 42, { size: 24, weight: 900, align: 'center', color: n > 0 ? C.p : n < 0 ? C.f : C.good });
    text(g, n > 0 ? 'turned right' : n < 0 ? 'turned left' : 'straight', 87, 63, { size: 14, align: 'center', color: C.muted });
  });
  const toH = (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left - s.W / 2, dy = e.clientY - r.top - s.H * 0.7;
    return Math.max(-120, Math.min(120, Math.atan2(dx, -dy) * 180 / Math.PI));
  };
  el.addEventListener('pointerdown', (e) => { dragging = true; el.setPointerCapture(e.pointerId); target = toH(e); });
  el.addEventListener('pointermove', (e) => { if (dragging) target = toH(e); });
  const up = () => { dragging = false; lastTouch = s.t; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return s;
}

// ---------- 5. P is the steer-back power (the times problem)
function pScene() {
  const slider = $('ex-p'), out = $('ex-p-out');
  const GO = 47;
  let h = 0, w = 0, nextBump = 0.8;
  const bump = () => { h = -14; w = 0; };
  $('ex-p-bump').addEventListener('click', () => { bump(); nextBump = s.t + 6; });
  slider.addEventListener('input', () => { out.textContent = slider.value; });
  const s = stage($('ex-pcan'), (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    const P = parseInt(slider.value, 10);
    if (st.t > nextBump) { bump(); nextBump = st.t + 6; }
    // slow-motion steering: the robot turns toward straight, harder when P is bigger
    const sub = 4;
    for (let k = 0; k < sub; k++) {
      const d = dt * 0.55 / sub;
      const err = -h;
      const steer = Math.max(-53, Math.min(53, P * err));
      w += ((2.4 * steer) - w) * d / 0.16; // steer > 0: left wheel faster, robot turns right
      h += w * d;
    }
    const err = -h;
    const steer = Math.max(-53, Math.min(53, P * err));
    g.clearRect(0, 0, W, H);
    // robot on a strip of path (left part)
    const rw = W * 0.56;
    const X = (x) => 16 + (x + 200) * (rw / 900), Y = (y) => H * 0.62 - y * (rw / 900);
    drawLane(g, X, Y, -200, 700, 64, H - 14, { noStart: true });
    const sc = rw / 900 * 1.25;
    drawRobot(g, X(0), Y(0), -h * Math.PI / 180, sc, { laser: 520, motorGlow: [Math.max(0, steer) / 70, Math.max(0, -steer) / 70] });
    // turning arrow
    if (Math.abs(steer) > 1) {
      const cx = X(-20), cy = Y(0), r = 78;
      const cw = steer > 0; // more power on the left -> turns right (clockwise)
      g.strokeStyle = C.p; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath();
      if (cw) g.arc(cx, cy, r, -Math.PI * 0.45, -Math.PI * 0.12); else g.arc(cx, cy, r, Math.PI * 0.12, Math.PI * 0.45);
      g.stroke();
      const ea = cw ? -Math.PI * 0.12 : Math.PI * 0.12;
      const ex = cx + Math.cos(ea) * r, ey = cy + Math.sin(ea) * r;
      g.fillStyle = C.p; g.beginPath();
      const dir = cw ? 1 : -1;
      g.moveTo(ex + 10, ey + dir * 2); g.lineTo(ex - 8, ey - dir * 4); g.lineTo(ex + 2, ey + dir * 14); g.closePath(); g.fill();
    }
    // the times problem
    // show whole numbers that really multiply: off × P = steer
    const off = Math.round(Math.abs(err));
    const st2 = off * P;
    const shown = Math.sign(err) * st2;
    const top = 14;
    const boxes = [[`${off}°`, 'off by', C.ink], [`× ${P}`, 'P', C.p], [`= ${st2}`, 'steer', C.p]];
    let bx = 16;
    for (const [big, small, col] of boxes) {
      g.font = `900 22px ${FONT}`;
      const bwid = Math.max(64, g.measureText(big).width + 22);
      rr(g, bx, top, bwid, 44, 12); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1.5; g.stroke();
      text(g, big, bx + bwid / 2, top + 25, { size: 22, weight: 900, align: 'center', color: col });
      text(g, small, bx + bwid / 2, top + 39, { size: 11, align: 'center', color: C.muted });
      bx += bwid + 8;
    }
    text(g, off <= 0 ? 'straight!' : err > 0 ? 'turned left: steer right' : 'turned right: steer left', bx + 6, top + 28, { size: 14, color: C.muted });
    // wheel power bars (right part)
    const L = Math.max(0, Math.min(100, GO + shown)), Rt = Math.max(0, Math.min(100, GO - shown));
    const bx0 = rw + 40, bh = H - 120, by0 = 80;
    const barW = Math.min(46, (W - bx0 - 20) / 3);
    [['LEFT', L], ['RIGHT', Rt]].forEach(([name, v], k) => {
      const x = bx0 + k * (barW + 34);
      rr(g, x, by0, barW, bh, 10); g.fillStyle = '#eef2f7'; g.fill();
      const yOf = (p) => by0 + bh - (p / 100) * bh;
      // F part
      g.fillStyle = C.f; g.fillRect(x + 5, yOf(Math.min(GO, v)), barW - 10, (Math.min(GO, v) / 100) * bh);
      if (v > GO) { g.fillStyle = C.p; g.fillRect(x + 5, yOf(v), barW - 10, ((v - GO) / 100) * bh); }
      if (v < GO) { g.fillStyle = 'rgba(242,118,29,0.25)'; g.fillRect(x + 5, yOf(GO), barW - 10, ((GO - v) / 100) * bh); g.strokeStyle = C.p; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeRect(x + 5, yOf(GO), barW - 10, ((GO - v) / 100) * bh); g.setLineDash([]); }
      text(g, `${Math.round(v)}`, x + barW / 2, by0 - 8, { size: 18, weight: 900, align: 'center' });
      text(g, name, x + barW / 2, by0 + bh + 18, { size: 12, weight: 900, align: 'center', color: C.muted });
    });
    text(g, `go = ${GO}`, bx0, by0 + bh + 36, { size: 12, color: C.f });
    text(g, '+ / − steer', bx0 + 56, by0 + bh + 36, { size: 12, color: C.p });
    text(g, 'slow motion', W - 12, H - 10, { size: 11, color: C.muted, align: 'right' });
  });
  return s;
}

// ---------- 6. How much P? Four robots side by side
function lanesScene() {
  const base = { kf: 0.235, trips: 1, bumps: true, noise: false, weakSide: 'left', weakPct: 2.5, seed: 11 };
  const STRETCH = 1.5; // sideways moves drawn 1.5x bigger
  const rows = [
    { P: 0, name: 'P = 0', say: 'Never steers back', col: C.bad },
    { P: 1, name: 'P = 1', say: 'Too small', col: C.warn },
    { P: 5, name: 'P = 5', say: 'Just right', col: C.good },
    { P: 16, name: 'P = 16', say: 'Too big: wiggles', col: C.purple },
  ].map((r) => ({ ...r, sim: simulate({ ...base, kp: r.P }) }));
  rows.forEach((r) => { r.leg = firstLeg(r.sim); });
  const bumps = rows[0].sim.bumps;
  const s = stage($('ex-lanes'), (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    const dur = Math.max(...rows.map((r) => r.leg[r.leg.length - 1].t));
    const tt = (st.t * 1.3) % (dur + 1.8);
    const left = Math.min(150, W * 0.24);
    const sc = (W - left - 10) / 1750;
    g.clearRect(0, 0, W, H);
    const lh = (H - 14) / rows.length;
    rows.forEach((r, k) => {
      const top = k * lh, bot = top + lh, mid = top + lh * 0.74; // weak LEFT motor: drift goes up
      const X = (x) => left + (x + 120) * sc;
      const Y = (y) => mid - y * sc * STRETCH;
      g.save();
      g.beginPath(); g.rect(0, top + 3, W, lh - 6); g.clip();
      drawLane(g, X, Y, -120, 1630, top + 4, bot - 4, { end: 1500, zone: 20 });
      for (const b of bumps) { g.fillStyle = '#ffd23f'; g.fillRect(X(b.x) - 3, b.side > 0 ? top + 6 : mid, 6, b.side > 0 ? mid - top - 6 : bot - 6 - mid); }
      const i = Math.min(r.leg.length - 1, Math.floor(tt / 0.01));
      const f = r.leg[i];
      trail(g, r.leg, i, X, Y, r.col, 3);
      drawRobot(g, X(f.x), Y(f.y), Math.atan(Math.tan(f.th) * STRETCH), sc * 1.5, { laser: 240, aL: f.aL, aR: f.aR });
      if (Y(f.y) < top + 14) pill(g, 'way off! ↑', Math.min(W - 50, X(f.x)), top + 16, r.col);
      g.restore();
      text(g, r.name, 10, top + lh * 0.48, { size: 17, weight: 900, color: C.p });
      text(g, r.say, 10, top + lh * 0.48 + 19, { size: 13.5, weight: 900, color: r.col });
    });
    text(g, 'sideways moves are drawn a little bigger so you can see them', W - 10, H - 3, { size: 11, color: C.muted, align: 'right' });
  });
  return s;
}

// ---------- 7. The loop, 100 times a second
function loopScene() {
  const steps = [
    { n: '1', t: 'Check the gyro', icon: 'gyro', col: C.purple },
    { n: '2', t: 'How far off?', icon: 'ruler', col: C.ink },
    { n: '3', t: 'Steer back', icon: 'wheel', col: C.p },
    { n: '4', t: 'Wait 10 ms', icon: 'clock', col: C.f },
  ];
  const STEP = 1.1;
  let count = 0;
  const s = stage($('ex-loop'), (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    count += dt * 100;
    const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.33;
    g.clearRect(0, 0, W, H);
    // ring
    g.strokeStyle = '#e3e9f2'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    const phase = (st.t / STEP) % 4;
    const active = Math.floor(phase);
    const a = -Math.PI / 2 + (phase / 4) * Math.PI * 2;
    // progress arc
    g.strokeStyle = 'rgba(28,39,64,0.25)'; g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, a); g.stroke();
    // arrows on ring
    for (let k = 0; k < 4; k++) {
      const aa = -Math.PI / 2 + (k + 0.5) * Math.PI / 2;
      const ax = cx + Math.cos(aa) * R, ay = cy + Math.sin(aa) * R;
      g.save(); g.translate(ax, ay); g.rotate(aa + Math.PI / 2);
      g.fillStyle = '#b5c1d3'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.restore();
    }
    // moving dot
    g.fillStyle = C.yellow; g.strokeStyle = C.ink; g.lineWidth = 3;
    g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 10, 0, Math.PI * 2); g.fill(); g.stroke();
    // stations
    steps.forEach((sp, k) => {
      const aa = -Math.PI / 2 + k * Math.PI / 2;
      const x = cx + Math.cos(aa) * R, y = cy + Math.sin(aa) * R;
      const on = k === active;
      const pulse = on ? 1 + 0.08 * Math.sin(st.t * 10) : 1;
      const r = 30 * pulse;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = on ? sp.col : '#fff'; g.fill();
      g.strokeStyle = sp.col; g.lineWidth = 3; g.stroke();
      icon(g, sp.icon, x, y, on ? '#fff' : sp.col, st.t);
      // label outside the ring
      const lx = cx + Math.cos(aa) * (R + 50), ly = cy + Math.sin(aa) * (R + 50);
      const align = Math.abs(Math.cos(aa)) < 0.1 ? 'center' : Math.cos(aa) > 0 ? 'left' : 'right';
      const ox = align === 'left' ? -12 : align === 'right' ? 12 : 0;
      const oy = Math.sin(aa) < -0.5 ? -2 : Math.sin(aa) > 0.5 ? 14 : 5;
      text(g, `${sp.n}. ${sp.t}`, lx + ox, ly + oy, { size: on ? 16 : 14, weight: 900, color: on ? sp.col : C.muted, align });
    });
    // centre: the counter
    text(g, Math.floor(count).toLocaleString(), cx, cy + 6, { size: 30, weight: 900, align: 'center' });
    text(g, 'loops so far', cx, cy + 26, { size: 13, align: 'center', color: C.muted });
  });
  return s;
}

function icon(g, kind, x, y, col, t) {
  g.save(); g.translate(x, y); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3; g.lineCap = 'round';
  if (kind === 'gyro') {
    g.rotate(t * 2);
    g.beginPath(); g.arc(0, 0, 12, 0.3, Math.PI * 1.7); g.stroke();
    g.beginPath(); g.moveTo(12, -6); g.lineTo(15, 3); g.lineTo(7, 0); g.closePath(); g.fill();
  } else if (kind === 'ruler') {
    g.beginPath(); g.moveTo(0, 12); g.lineTo(0, -12); g.stroke();
    g.beginPath(); g.moveTo(0, 12); g.lineTo(9, -10); g.stroke();
    g.beginPath(); g.arc(0, 12, 12, -Math.PI / 2, -Math.PI / 2 + 0.4); g.stroke();
  } else if (kind === 'wheel') {
    g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.moveTo(0, 0); g.lineTo(0, 12); g.stroke();
  } else {
    g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -8); g.moveTo(0, 0); g.lineTo(6, 3); g.stroke();
  }
  g.restore();
}
