// scene.js: the 3D table, mat, SPIKE-style driving base, trails and overlays.
// Sim coordinates (mm): x down the lane, y to the robot's left.
// Three.js: X = sim x, Y = up, Z = -sim y. Robot faces +X when th = 0.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROBOT } from './physics.js';

const COL = {
  white: 0xf3f3ef,
  grey: 0xc3c8cf,
  dark: 0x363a42,
  black: 0x1b1d21,
  yellow: 0xffc928,
  orange: 0xff8a3d,
  blue: 0x4da3ff,
  green: 0x34d399,
  red: 0xf87171,
};

const MAT = {
  xMin: -600, xMax: 2100, // set from distance in build
  yMin: -700, yMax: 700,
  pxPerMm: 0.8,
};

const toV3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

// ---------- geometry helpers
function roundedBox(w, h, d, r = 3, bevel = 1.5) {
  const iw = w - 2 * bevel, ih = h - 2 * bevel, id = Math.max(0.1, d - 2 * bevel);
  const rr = Math.min(r, iw / 2, ih / 2);
  const s = new THREE.Shape();
  const x = -iw / 2, y = -ih / 2;
  s.moveTo(x + rr, y);
  s.lineTo(x + iw - rr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + rr);
  s.lineTo(x + iw, y + ih - rr); s.quadraticCurveTo(x + iw, y + ih, x + iw - rr, y + ih);
  s.lineTo(x + rr, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - rr);
  s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: id, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.center();
  return g;
}

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0, ...extra });
}

function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

function canvasTex(w, h, draw, renderer) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (renderer) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---------- 5x5 light matrix patterns (row 0 = front of the robot)
const ICONS = {
  up:    ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  down:  ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
  pause: ['.....', '.#.#.', '.#.#.', '.#.#.', '.....'],
  happy: ['.....', '.#.#.', '.....', '#...#', '.###.'],
  dot:   ['.....', '.....', '..#..', '.....', '.....'],
  sad:   ['.....', '.#.#.', '.....', '.###.', '#...#'],
};

// =====================================================================
export function createScene(container, labelLayer) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdce8f5);
  scene.fog = new THREE.Fog(0xdce8f5, 5000, 14000);

  const camera = new THREE.PerspectiveCamera(38, 1, 5, 30000);
  camera.position.set(-500, 650, 1150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 180;
  controls.maxDistance = 6000;

  // ---------- lights
  scene.add(new THREE.HemisphereLight(0xeaf1ff, 0x2a2f38, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-700, 2600, 1300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1900; sun.shadow.camera.right = 1900;
  sun.shadow.camera.top = 1300; sun.shadow.camera.bottom = -1300;
  sun.shadow.camera.near = 200; sun.shadow.camera.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.55);
  fill.position.set(1500, 900, -1600);
  scene.add(fill);

  // ---------- world groups (rebuilt when the course changes)
  const world = new THREE.Group();
  scene.add(world);
  const bumpGroup = new THREE.Group();
  scene.add(bumpGroup);
  const trailGroup = new THREE.Group();
  scene.add(trailGroup);
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  let distance = 1500;
  let bumpMeshes = [];

  function buildCourse(dist) {
    distance = dist;
    MAT.xMin = -600; MAT.xMax = dist + 600;
    world.clear();
    const L = MAT.xMax - MAT.xMin, W = MAT.yMax - MAT.yMin;
    const cx = (MAT.xMin + MAT.xMax) / 2;

    // table
    const wood = std(0x7a5a3d, { roughness: 0.8 });
    const top = mesh(new THREE.BoxGeometry(L + 60, 36, W + 60), wood, cx, -18.5, 0);
    world.add(top);
    const legGeo = new THREE.BoxGeometry(60, 740, 60);
    for (const [lx, lz] of [[MAT.xMin + 40, -W / 2 + 10], [MAT.xMax - 40, -W / 2 + 10], [MAT.xMin + 40, W / 2 - 10], [MAT.xMax - 40, W / 2 - 10]]) {
      world.add(mesh(legGeo, wood, lx, -36 - 370, lz));
    }
    // floor
    const floorTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#c9d4e2'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#bcc8d8'; g.lineWidth = 3;
      for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    }, renderer);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(30, 30);
    const floor = mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }), cx, -776, 0, false);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);

    // mat
    const matTex = drawMat(dist);
    const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
    matMesh.rotation.x = -Math.PI / 2;
    matMesh.position.set(cx, 0, 0);
    matMesh.receiveShadow = true;
    world.add(matMesh);

    sun.target.position.set(dist / 2, 0, 0);
    sun.position.set(dist / 2 - 900, 2600, 1300);
  }

  function drawMat(dist) {
    const s = MAT.pxPerMm;
    const L = MAT.xMax - MAT.xMin, W = MAT.yMax - MAT.yMin;
    const cw = Math.round(L * s), ch = Math.round(W * s);
    const X = x => (x - MAT.xMin) * s;
    const Y = y => (MAT.yMax - y) * s;
    return canvasTex(cw, ch, (g) => {
      g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, cw, ch);
      // grid
      g.strokeStyle = '#e4e0d7'; g.lineWidth = 1.4;
      for (let x = Math.ceil(MAT.xMin / 100) * 100; x <= MAT.xMax; x += 100) {
        g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), ch); g.stroke();
      }
      for (let y = Math.ceil(MAT.yMin / 100) * 100; y <= MAT.yMax; y += 100) {
        g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(cw, Y(y)); g.stroke();
      }
      // on-track zone (±2 cm) and the path the robot should follow
      g.fillStyle = 'rgba(52,211,153,0.24)';
      g.fillRect(X(0), Y(20), X(dist) - X(0), Y(-20) - Y(20));
      g.strokeStyle = '#2f6fdb'; g.lineWidth = 5 * s; g.setLineDash([40 * s, 26 * s]);
      g.beginPath(); g.moveTo(X(-150), Y(0)); g.lineTo(X(dist + 150), Y(0)); g.stroke();
      g.setLineDash([]);

      // tape lines
      const FONT = '"Nunito", system-ui, sans-serif';
      const tape = (x, label) => {
        g.fillStyle = '#15171b';
        g.fillRect(X(x) - 12.5 * s, Y(420), 25 * s, Y(-420) - Y(420));
        g.font = `900 ${54 * s}px ${FONT}`; g.textAlign = 'center';
        g.fillText(label, X(x), Y(455));
      };
      tape(0, 'START');
      tape(dist, 'TURN AROUND');
      // big friendly direction arrows
      g.fillStyle = '#cfd5dd'; g.font = `900 ${90 * s}px ${FONT}`; g.textAlign = 'center';
      g.fillText('→', X(dist * 0.3), Y(-150));
      g.fillText('←', X(dist * 0.7), Y(-150));
      // edge band
      g.strokeStyle = '#2b3240'; g.lineWidth = 10 * s; g.strokeRect(0, 0, cw, ch);
    }, renderer);
  }

  // ---------- bumps
  const hazardTex = canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1d21';
    for (let i = -h; i < w + h; i += 24) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 12, 0); g.lineTo(i + 12 - h, h); g.lineTo(i - h, h); g.closePath(); g.fill(); }
  }, renderer);
  hazardTex.wrapS = THREE.RepeatWrapping;

  function setBumps(bumps) {
    bumpGroup.clear();
    bumpMeshes.forEach((b) => removeLabel(b.label));
    bumpMeshes = [];
    for (const b of bumps) {
      const span = 300;
      const tex = hazardTex.clone(); tex.needsUpdate = true; tex.repeat.set(span / 60, 1);
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffaa00, emissiveIntensity: 0 });
      const geo = new THREE.BoxGeometry(span, 5, 26);
      const bm = new THREE.Mesh(geo, m);
      bm.rotation.y = Math.PI / 2; // long side across the lane
      const yc = b.side * (span / 2 + 10);
      bm.position.copy(toV3(b.x, yc, 2.5));
      bm.castShadow = true; bm.receiveShadow = true;
      bumpGroup.add(bm);
      bumpMeshes.push({ mesh: bm, bump: b, label: addLabel('bump', 'lbl lbl-bump', toV3(b.x, yc, 10)) });
      bumpMeshes[bumpMeshes.length - 1].label.visible = false;
    }
  }

  // ---------- robot
  const robot = buildRobot(renderer);
  scene.add(robot.group);
  const ghost = buildGhost();
  scene.add(ghost.group);

  // heading laser (robot frame) + target line (world frame) + wedge
  const laserTex = canvasTex(256, 8, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,138,61,1)'); gr.addColorStop(1, 'rgba(255,138,61,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const LASER = 900;
  const laser = new THREE.Mesh(new THREE.PlaneGeometry(LASER, 7), new THREE.MeshBasicMaterial({ map: laserTex, transparent: true, depthWrite: false }));
  laser.rotation.x = -Math.PI / 2;
  laser.position.set(45 + LASER / 2, 2.2, 0);
  robot.group.add(laser);

  const dashTex = canvasTex(64, 8, (g, w, h) => { g.fillStyle = 'rgba(52,211,153,0.95)'; g.fillRect(0, 0, w * 0.6, h); });
  dashTex.wrapS = THREE.RepeatWrapping; dashTex.repeat.set(LASER / 40, 1);
  const targetLine = new THREE.Mesh(new THREE.PlaneGeometry(LASER, 5), new THREE.MeshBasicMaterial({ map: dashTex, transparent: true, depthWrite: false }));
  targetLine.rotation.x = -Math.PI / 2;
  scene.add(targetLine);

  const WEDGE_N = 40, WEDGE_R = 260;
  const wedgeGeo = new THREE.BufferGeometry();
  wedgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((WEDGE_N + 2) * 3), 3));
  const wIdx = [];
  for (let i = 1; i <= WEDGE_N; i++) wIdx.push(0, i, i + 1);
  wedgeGeo.setIndex(wIdx);
  const wedge = new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({ color: COL.orange, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  wedge.frustumCulled = false;
  scene.add(wedge);

  // drift dimension line: from the perfect path to the robot
  const driftLine = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), new THREE.MeshBasicMaterial({ color: COL.red }));
  scene.add(driftLine);
  const driftCapA = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 2, 20), new THREE.MeshBasicMaterial({ color: COL.red }));
  const driftCapB = driftCapA.clone();
  scene.add(driftCapA, driftCapB);

  // steering arrow above the hub: which way P is turning the robot
  const steer = new THREE.Group();
  const steerMat = new THREE.MeshBasicMaterial({ color: COL.orange, transparent: true, opacity: 0.95, depthTest: false });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(62, 4.5, 8, 40, Math.PI * 0.7), steerMat);
  arc.rotation.x = -Math.PI / 2;
  arc.rotation.z = -Math.PI * 0.35;
  const head = new THREE.Mesh(new THREE.ConeGeometry(11, 26, 16), steerMat);
  steer.add(arc, head);
  steer.renderOrder = 10;
  arc.renderOrder = 10; head.renderOrder = 10;
  steer.position.set(-22, 128, 0);
  robot.group.add(steer);
  function setSteer(corr) {
    const mag = Math.min(1, Math.abs(corr) / 25);
    steer.visible = Math.abs(corr) > 0.25;
    if (!steer.visible) return;
    // corr > 0: left motor gets more power -> robot turns right (clockwise from above)
    const cw = corr > 0;
    const a0 = Math.PI * 0.35; // arc end angle in the arc's own plane
    const endA = cw ? -a0 : a0;
    const px = Math.cos(endA) * 62, pz = -Math.sin(endA) * 62;
    head.position.set(px, 0, pz);
    // tangent direction at the arc end, pointing the way of travel
    const tx = -Math.sin(endA) * (cw ? -1 : 1), tz = -Math.cos(endA) * (cw ? -1 : 1);
    head.rotation.set(0, 0, 0);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx, 0, tz).normalize());
    steer.scale.setScalar(0.65 + 0.6 * mag);
    steerMat.opacity = 0.45 + 0.5 * mag;
  }

  // ---------- trails
  let trailRun = null, wheelTrails = [], ghostTrails = [];
  const RUN_COLORS = [0x60a5fa, 0xc084fc, 0x2dd4bf, 0xf472b6];

  function ribbon(points, width, color, opacity, h) {
    const n = points.length;
    const pos = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = -dy * width / 2, ny = dx * width / 2;
      pos.set([p[0] + nx, h, -(p[1] + ny)], i * 6);
      pos.set([p[0] - nx, h, -(p[1] - ny)], i * 6 + 3);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    return m;
  }

  // ---------- labels (HTML, positioned each frame)
  const labels = [];
  function addLabel(text, cls, pos3) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    labelLayer.appendChild(el);
    const L = { el, pos: pos3.clone(), visible: true };
    labels.push(L);
    return L;
  }
  function removeLabel(L) {
    const i = labels.indexOf(L);
    if (i >= 0) labels.splice(i, 1);
    L.el.remove();
  }
  const hLabel = addLabel('', 'lbl lbl-heading', new THREE.Vector3());
  const dLabel = addLabel('', 'lbl lbl-drift', new THREE.Vector3());
  const gLabel = addLabel('ghost', 'lbl lbl-ghost', new THREE.Vector3());
  const tLabel = addLabel('straight ahead', 'lbl lbl-target', new THREE.Vector3());
  let stopLabels = [];

  const tmpV = new THREE.Vector3();
  function placeLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const L of labels) {
      if (!L.visible) { L.el.style.display = 'none'; continue; }
      tmpV.copy(L.pos).project(camera);
      if (tmpV.z > 1 || tmpV.x < -1.2 || tmpV.x > 1.2 || tmpV.y < -1.2 || tmpV.y > 1.2) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      L.el.style.transform = `translate(-50%, -100%) translate(${((tmpV.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmpV.y) / 2 * h).toFixed(1)}px)`;
    }
  }

  // ---------- run management
  let run = null;
  // angles = the extra degree labels, wedge and "straight ahead" line (teacher view)
  const opts = { ghost: true, laser: true, trails: true, labels: true, angles: false };

  function setRun(sim, previous = []) {
    run = sim;
    if (sim.cfg.distance !== distance) buildCourse(sim.cfg.distance);
    setBumps(sim.bumps);
    trailGroup.clear();
    // previous runs, faded
    ghostTrails = previous.slice(0, 3).map((p, i) => {
      const pts = p.frames.map(f => [f.x, f.y]);
      const m = ribbon(pts, 6, RUN_COLORS[i % RUN_COLORS.length], 0.55, 0.9 + i * 0.05);
      trailGroup.add(m);
      return m;
    });
    // this run: centre path + tyre marks
    const pts = sim.frames.map(f => [f.x, f.y]);
    trailRun = ribbon(pts, 9, COL.orange, 1, 1.6);
    trailGroup.add(trailRun);
    const half = ROBOT.axleTrack / 2;
    const lp = sim.frames.map(f => [f.x - Math.sin(f.th) * half, f.y + Math.cos(f.th) * half]);
    const rp = sim.frames.map(f => [f.x + Math.sin(f.th) * half, f.y - Math.cos(f.th) * half]);
    wheelTrails = [ribbon(lp, 12, 0x2b2e34, 0.16, 1.1), ribbon(rp, 12, 0x2b2e34, 0.16, 1.1)];
    trailGroup.add(...wheelTrails);
    // stop markers
    markerGroup.clear();
    stopLabels.forEach((s) => removeLabel(s.L));
    stopLabels = sim.result.stops.map(s => {
      const pin = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 70, 8), std(0x2b2e34));
      pole.position.y = 35;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(10, 22, 16), std(Math.abs(s.y) < 20 ? COL.green : Math.abs(s.y) < 50 ? COL.yellow : COL.red));
      flag.position.y = 76; flag.rotation.z = Math.PI;
      pin.add(pole, flag);
      const f = frameNear(sim.frames, s.t + 0.35);
      // stand the flag just outside the line so it doesn't sit inside the robot
      const off = s.line === 'far' ? 150 : -150;
      pin.position.copy(toV3(f.x + off, f.y));
      pin.visible = false;
      markerGroup.add(pin);
      const L = addLabel(`${Math.round(Math.abs(s.y) / 10)} cm off`, 'lbl lbl-stop', toV3(f.x + off, f.y, 105));
      L.visible = false;
      return { pin, L, t: s.t + 0.35 };
    });
  }

  function frameNear(frames, t) {
    let lo = 0, hi = frames.length - 1;
    if (t >= frames[hi].t) return frames[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
    return frames[lo];
  }

  // ---------- per-frame update
  const camMode = { mode: 'follow', prevRobot: new THREE.Vector3() };
  let lastFrameIndex = 0;

  function update(frame, index, t, ghostState) {
    if (!run || !frame) return;
    lastFrameIndex = index;
    // robot pose
    robot.group.position.set(frame.x, 0, -frame.y);
    robot.group.rotation.y = frame.th;
    robot.setWheels(frame.aL, frame.aR);
    const icon = frame.phase === 'drive' ? (frame.leg % 2 === 0 ? 'up' : 'down') : frame.phase === 'pause' ? 'pause' : frame.phase === 'done' ? (run.result.endReason === 'finished' ? 'happy' : 'sad') : 'dot';
    robot.setMatrix(icon);
    robot.setButton(frame.phase === 'drive' ? COL.green : frame.phase === 'pause' ? COL.yellow : COL.blue);
    robot.setMotorGlow(frame.dcL, frame.dcR);
    const corr = frame.phase === 'drive' ? frame.pTerm + frame.iTerm + frame.dTerm : 0;
    setSteer(corr);
    if (run.result.endReason === 'offTable' && index >= run.frames.length - 1) {
      robot.group.rotation.z = -0.5; robot.group.position.y = -120;
    } else {
      robot.group.rotation.z = 0;
    }

    // trails
    const n = index + 1;
    if (trailRun) trailRun.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    for (const w of wheelTrails) w.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    trailGroup.visible = opts.trails;

    // laser / target / wedge
    laser.visible = opts.laser;
    targetLine.visible = opts.angles;
    wedge.visible = opts.angles;
    const front = 45;
    targetLine.position.set(frame.x + front + LASER / 2, 1.9, -frame.y);
    const pos = wedgeGeo.attributes.position;
    pos.setXYZ(0, frame.x, 1.7, -frame.y);
    // exaggerate tiny angles a little so 1 degree is still visible, but never lie about direction
    const th = frame.th;
    for (let i = 0; i <= WEDGE_N; i++) {
      const a = th * (i / WEDGE_N);
      pos.setXYZ(i + 1, frame.x + Math.cos(a) * WEDGE_R, 1.7, -(frame.y + Math.sin(a) * WEDGE_R));
    }
    pos.needsUpdate = true;

    const hdg = frame.heading;
    hLabel.visible = opts.angles && opts.labels;
    const endX = frame.x + Math.cos(th) * (front + LASER * 0.62), endY = frame.y + Math.sin(th) * (front + LASER * 0.62);
    hLabel.pos.set(endX, 12, -endY);
    const dir = Math.abs(hdg) < 0.05 ? 'straight' : hdg > 0 ? 'turned right' : 'turned left';
    hLabel.el.innerHTML = `<b>${hdg >= 0 ? '+' : '−'}${Math.abs(hdg).toFixed(1)}°</b> ${dir}`;
    tLabel.visible = opts.angles && opts.labels;
    tLabel.pos.set(frame.x + front + LASER * 0.95, 8, -frame.y);

    // drift line
    const dy = frame.y;
    const showDrift = Math.abs(dy) > 4;
    driftLine.visible = driftCapA.visible = driftCapB.visible = showDrift;
    dLabel.visible = showDrift && opts.labels;
    if (showDrift) {
      driftLine.scale.set(1, 1, Math.abs(dy));
      driftLine.position.set(frame.x, 2.6, -dy / 2);
      driftCapA.position.set(frame.x, 2.6, 0);
      driftCapB.position.set(frame.x, 2.6, -dy);
      dLabel.pos.set(frame.x, 6, -dy / 2);
      dLabel.el.innerHTML = `<b>${Math.round(Math.abs(dy) / 10)} cm</b> off`;
    }

    // ghost
    ghost.group.visible = opts.ghost && !!ghostState;
    gLabel.visible = ghost.group.visible && opts.labels;
    if (ghostState) {
      ghost.group.position.set(ghostState.x, 0, 0);
      ghost.setWheels(ghostState.x / (ROBOT.wheelDiameter / 2) * 180 / Math.PI);
      gLabel.pos.set(ghostState.x - 20, 150, 0);
    }

    // bumps flash
    for (const b of bumpMeshes) {
      const hit = run.events.find(e => e.type === 'bump' && run.bumps[e.i] === b.bump && t >= e.t && t < e.t + 0.45);
      b.mesh.material.emissiveIntensity = hit ? 0.9 : 0;
      b.label.visible = opts.angles && opts.labels;
    }
    // stop flags
    for (const s of stopLabels) {
      const on = t >= s.t;
      s.pin.visible = on;
      s.L.visible = on && opts.labels;
    }

    followCamera(frame);
  }

  function followCamera(frame) {
    const rp = new THREE.Vector3(frame.x, 40, -frame.y);
    if (camMode.mode === 'follow') {
      const d = rp.clone().sub(camMode.prevRobot);
      camera.position.add(d);
      controls.target.add(d);
    } else if (camMode.mode === 'driver') {
      const th = frame.th;
      const back = new THREE.Vector3(-Math.cos(th), 0, Math.sin(th));
      camera.position.copy(rp).addScaledVector(back, 520).add(new THREE.Vector3(0, 260, 0));
      controls.target.copy(rp).addScaledVector(back, -500);
    }
    camMode.prevRobot.copy(rp);
  }

  function setCamera(mode, frame) {
    camMode.mode = mode;
    const fx = frame ? frame.x : 0, fy = frame ? frame.y : 0;
    controls.enabled = mode !== 'driver';
    if (mode === 'follow') {
      controls.target.set(fx + 60, 40, -fy);
      camera.position.set(fx - 330, 360, -fy + 640);
    } else if (mode === 'top') {
      controls.target.set(distance / 2, 0, 0);
      camera.position.set(distance / 2, 3000, 420);
    } else if (mode === 'side') {
      controls.target.set(distance / 2, 0, -60);
      camera.position.set(distance / 2 - 250, 1050, 2350);
    }
    camMode.prevRobot.set(fx, 40, -fy);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function render() {
    controls.update();
    placeLabels();
    renderer.render(scene, camera);
  }

  buildCourse(1500);
  // redraw the mat once the rounded font has loaded
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildCourse(distance));
  resize();
  setCamera('follow', null);

  return { setRun, update, render, resize, setCamera, opts, camera, controls, renderer };
}

// =====================================================================
// The SPIKE-style driving base. Origin = centre of the wheel axle on the mat.
export function buildRobot(renderer) {
  const group = new THREE.Group();
  const white = std(COL.white, { roughness: 0.42 });
  const grey = std(COL.grey, { roughness: 0.5 });
  const dark = std(COL.dark, { roughness: 0.6 });
  const yellow = std(COL.yellow, { roughness: 0.45 });
  const tyreTex = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = '#1c1e22'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c2f35';
    for (let i = 0; i < w; i += 16) g.fillRect(i, 0, 7, h);
  }, renderer);
  tyreTex.wrapS = THREE.RepeatWrapping;
  const tyreMat = new THREE.MeshStandardMaterial({ map: tyreTex, roughness: 0.92 });
  const tyreSide = std(0x202226, { roughness: 0.9 });

  // wheels
  const wheels = [];
  for (const side of [-1, 1]) { // -1 = left (z = -56), +1 = right
    const w = new THREE.Group();
    w.position.set(0, 28, side * ROBOT.axleTrack / 2);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 14, 48, 1, true), tyreMat);
    tyre.rotation.x = Math.PI / 2; tyre.castShadow = true;
    const sideRing = new THREE.Mesh(new THREE.RingGeometry(19, 28, 48), tyreSide);
    sideRing.position.z = side * 7.01; sideRing.rotation.y = side < 0 ? Math.PI : 0;
    const innerRing = sideRing.clone(); innerRing.position.z = -side * 7.01; innerRing.rotation.y = side < 0 ? 0 : Math.PI;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 13, 40), grey);
    rim.rotation.x = Math.PI / 2; rim.castShadow = true;
    w.add(tyre, sideRing, innerRing, rim);
    // rim holes + hub cross so you can see it spin
    const holeMat = std(0x2a2d33);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(3.4, 16), holeMat);
      hole.position.set(Math.cos(a) * 11.5, Math.sin(a) * 11.5, side * 6.6);
      hole.rotation.y = side < 0 ? Math.PI : 0;
      w.add(hole);
    }
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 1), holeMat);
    crossA.position.z = side * 6.7;
    const crossB = crossA.clone(); crossB.rotation.z = Math.PI / 2;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 1.2), std(COL.yellow, { emissive: 0x553300 }));
    marker.position.set(0, 23.5, side * 7.2);
    w.add(crossA, crossB, marker);
    group.add(w);
    wheels.push(w);
  }

  // motors
  const motorMats = [];
  for (const side of [-1, 1]) {
    const mm = std(COL.white, { roughness: 0.42, emissive: 0x000000 });
    motorMats.push(mm);
    const body = mesh(roundedBox(54, 36, 30, 6, 2.5), mm, -6, 30, side * 30);
    group.add(body);
    const face = mesh(new THREE.CylinderGeometry(14, 14, 3, 32), dark, 0, 28, side * 46.5);
    face.rotation.x = Math.PI / 2;
    const axle = mesh(new THREE.CylinderGeometry(4, 4, 6, 12), dark, 0, 28, side * 49);
    axle.rotation.x = Math.PI / 2;
    const stripe = mesh(roundedBox(30, 3, 31, 1, 0.8), dark, -16, 47, side * 30);
    group.add(face, axle, stripe);
  }
  // frame
  group.add(mesh(roundedBox(16, 16, 30, 3), grey, -6, 30, 0));
  const holeGeo = new THREE.CircleGeometry(2.4, 12);
  const holeMat = std(0x2a2d33);
  const beam = (len, x, y, z, along = 'x') => {
    const g = along === 'x' ? roundedBox(len, 8, 8, 3.5, 1) : roundedBox(8, 8, len, 3.5, 1);
    const b = mesh(g, grey, x, y, z);
    group.add(b);
    const n = Math.floor(len / 8);
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + 4 + i * 8;
      if (along === 'x') {
        for (const s of [-1, 1]) {
          const h = new THREE.Mesh(holeGeo, holeMat);
          h.position.set(x + o, y, z + s * 4.05);
          h.rotation.y = s < 0 ? Math.PI : 0;
          group.add(h);
        }
      } else {
        for (const s of [-1, 1]) {
          const h = new THREE.Mesh(holeGeo, holeMat);
          h.position.set(x + s * 4.05, y, z + o);
          h.rotation.y = s * Math.PI / 2;
          group.add(h);
        }
      }
    }
  };
  beam(120, -28, 52, -38);
  beam(120, -28, 52, 38);
  beam(88, -84, 52, 0, 'z');
  beam(104, 30, 36, 0, 'z');

  // caster
  group.add(mesh(roundedBox(22, 38, 22, 4), dark, -80, 33, 0));
  const ball = mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 1, roughness: 0.18 }), -80, 9, 0);
  group.add(ball);

  // hub
  const HX = -22;
  group.add(mesh(roundedBox(88, 13, 56, 6, 2.5), yellow, HX, 63, 0));
  group.add(mesh(roundedBox(88, 21, 56, 7, 3), white, HX, 79, 0));
  const top = 89.6;
  group.add(mesh(roundedBox(46, 1.6, 46, 4, 0.6), std(0x22262d, { roughness: 0.35 }), HX + 12, top, 0, false));
  const px = [];
  const pxGeo = new THREE.BoxGeometry(5.2, 1.4, 5.2);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x3a3f48, emissive: 0xfff2c4, emissiveIntensity: 0, roughness: 0.4 });
      const p = new THREE.Mesh(pxGeo, m);
      p.position.set(HX + 12 + (2 - r) * 8.2, top + 0.9, (c - 2) * 8.2);
      group.add(p);
      px.push(m);
    }
  }
  const button = mesh(new THREE.CylinderGeometry(6.5, 6.5, 2.4, 24), white, HX - 27, top + 0.6, 0);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COL.blue, emissiveIntensity: 1.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(8.2, 1.3, 8, 32), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.set(HX - 27, top + 0.4, 0);
  group.add(button, ring);
  // ports A/C/E (left side) and B/D/F (right side)
  const portTex = (ch) => canvasTex(64, 64, (g) => {
    g.fillStyle = '#2b2f36'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#f3f3ef'; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, 32, 34);
  });
  const ports = [['A', 'B'], ['C', 'D'], ['E', 'F']];
  ports.forEach(([l, r], i) => {
    const x = HX + 26 - i * 26;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: portTex(l) }));
    pl.position.set(x, 74, -28.3); pl.rotation.y = Math.PI;
    const pr = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: portTex(r) }));
    pr.position.set(x, 74, 28.3);
    group.add(pl, pr);
  });
  // cables: left motor -> port A, right motor -> port B
  const cableMat = std(0x18191c, { roughness: 0.7 });
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(-32, 40, side * 30),
      new THREE.Vector3(-46, 54, side * 46),
      new THREE.Vector3(-10, 70, side * 44),
      new THREE.Vector3(HX + 26, 74, side * 30),
    ];
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 2.2, 8), cableMat);
    tube.castShadow = true;
    group.add(tube);
  }

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  let currentIcon = null;
  return {
    group,
    setWheels(aL, aR) {
      wheels[0].rotation.z = -aL * Math.PI / 180;
      wheels[1].rotation.z = -aR * Math.PI / 180;
    },
    setMatrix(name) {
      if (name === currentIcon) return;
      currentIcon = name;
      const rows = ICONS[name] || ICONS.dot;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
        const on = rows[r][c] === '#';
        const m = px[r * 5 + c];
        m.emissiveIntensity = on ? 2.2 : 0;
        m.color.setHex(on ? 0xfff6dc : 0x3a3f48);
      }
    },
    setButton(hex) { ringMat.emissive.setHex(hex); },
    setMotorGlow(dcL, dcR) {
      // motors tint orange when working hard
      [dcL, dcR].forEach((dc, i) => {
        const k = Math.min(1, Math.abs(dc) / 100);
        motorMats[i].emissive.setRGB(0.35 * k * k, 0.12 * k * k, 0);
      });
    },
  };
}

// see-through "perfect robot"
function buildGhost() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.3, emissive: 0x1d4ed8, emissiveIntensity: 0.4 });
  const edge = new THREE.LineBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.55 });
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edge); e.position.copy(m.position); group.add(e);
    return m;
  };
  add(new THREE.BoxGeometry(88, 34, 56), -22, 72, 0);
  add(new THREE.BoxGeometry(54, 36, 90), -6, 30, 0);
  add(new THREE.BoxGeometry(22, 30, 22), -80, 22, 0);
  const wheels = [];
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(0, 28, side * 56);
    const geo = new THREE.CylinderGeometry(28, 28, 14, 24);
    const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge); e.rotation.x = Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(4, 50, 15), mat);
    w.add(m, e, spoke);
    group.add(w);
    wheels.push(w);
  }
  group.renderOrder = 5;
  return {
    group,
    setWheels(a) { for (const w of wheels) w.rotation.z = -a * Math.PI / 180; },
  };
}
