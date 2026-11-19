// learn.js: "Learn to code" tab. Step-by-step first Pybricks program for grades 3-5,
// with pictures, animations, practice widgets and a runnable code editor.
import { runProgram, STARTER, SETUP } from './minipy.js';
import { C, FONT, rr, text, pill, drawRobot } from './draw2d.js';
import { readButton, readableText } from './speak.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pidlab.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pidlab.' + k, JSON.stringify(v)); } catch { /* fine */ } },
};

// ---------- animation manager: only what is on screen moves
const stages = [];
const io = new IntersectionObserver((es) => { for (const e of es) { const s = stages.find((x) => x.el === e.target); if (s) s.visible = e.isIntersecting; } }, { threshold: 0.05 });
function stage(el, step, onResize) {
  const s = { el, step, onResize, visible: false, W: 0, H: 0, g: el.getContext('2d') };
  stages.push(s); io.observe(el); return s;
}
function sizeAll() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const s of stages) {
    const r = s.el.getBoundingClientRect();
    if (!r.width) continue;
    s.W = r.width; s.H = r.height;
    s.el.width = Math.round(r.width * dpr); s.el.height = Math.round(r.height * dpr);
    s.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.onResize) s.onResize();
  }
}
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!$('tab-learn').hidden) for (const s of stages) if (s.visible && s.W) s.step(dt, s);
  requestAnimationFrame(loop);
}

// ---------- code colouring
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function hl(src) {
  return src.split('\n').map((line) => {
    let q = null, ci = line.length;
    for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '#') { ci = i; break; } }
    const code = line.slice(0, ci), com = line.slice(ci);
    const body = esc(code).replace(/("[^"]*"|'[^']*')|\b(\d+(?:\.\d+)?)\b|\b(from|import|def|for|in|range|return|print)\b|\b((?:Port|Direction|Color|Stop|Icon)\.[A-Z_]+)|([A-Za-z_]\w*)(?=\()|([A-Za-z_]\w*)/g,
      (m, str, numb, kw, cnst, fn, name) => str ? `<span class="s-str">${str}</span>` : numb ? `<span class="s-num">${numb}</span>` : kw ? `<span class="s-kw">${kw}</span>` : cnst ? `<span class="s-const">${cnst}</span>` : fn ? `<span class="s-fn">${fn}</span>` : `<span class="s-name">${name}</span>`);
    return body + (com ? `<span class="s-com">${esc(com)}</span>` : '');
  }).join('\n');
}
const codeBlock = (src, cls = '') => `<pre class="lp-code ${cls}">${hl(src)}</pre>`;

// =====================================================================
// MatPlayer: plays a program on a top-down mat
class MatPlayer {
  constructor(canvas, opts = {}) {
    this.opts = { minSpan: 700, margin: 160, speed: 1, ...opts };
    this.res = null; this.t = 0; this.playing = false; this.view = null; this.lastLine = -1;
    this.onLine = null; this.onEnd = null;
    this.s = stage(canvas, (dt, st) => this.step(dt, st), () => this.fit());
  }
  load(res, play = true) {
    this.res = res; this.t = 0; this.playing = play; this.lastLine = -1; this.ended = false;
    this.fit();
  }
  fit() {
    if (!this.res || !this.s.W) return;
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    if (this.opts.fixed) ({ x0, x1, y0, y1 } = this.opts.fixed);
    else for (const f of this.res.frames) { x0 = Math.min(x0, f.x); x1 = Math.max(x1, f.x); y0 = Math.min(y0, f.y); y1 = Math.max(y1, f.y); }
    const m = this.opts.fixed ? 0 : this.opts.margin;
    x0 -= m; x1 += m; y0 -= m; y1 += m;
    const ms = this.opts.minSpan;
    if (x1 - x0 < ms) { const c = (x0 + x1) / 2; x0 = c - ms / 2; x1 = c + ms / 2; }
    if (y1 - y0 < ms * this.s.H / this.s.W) { const c = (y0 + y1) / 2, h = ms * this.s.H / this.s.W; y0 = c - h / 2; y1 = c + h / 2; }
    const sc = Math.min(this.s.W / (x1 - x0), this.s.H / (y1 - y0));
    this.view = { sc, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  // jump to the end (used by the test hook below)
  skip() {
    if (!this.res) return;
    this.t = this.res.duration; this.playing = false;
    if (!this.ended) { this.ended = true; if (this.onEnd) this.onEnd(); }
  }
  frameAt(t) {
    const fr = this.res.frames;
    let lo = 0, hi = fr.length - 1;
    if (t >= fr[hi].t) return fr[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fr[mid].t <= t) lo = mid; else hi = mid; }
    return fr[lo];
  }
  step(dt, st) {
    if (!this.res) return;
    if (this.playing) {
      this.t += dt * this.opts.speed;
      if (this.t >= this.res.duration) { this.t = this.res.duration; this.playing = false; if (!this.ended) { this.ended = true; if (this.onEnd) this.onEnd(); } }
    }
    const f = this.frameAt(this.t);
    if (this.onLine && f.line !== this.lastLine) { this.lastLine = f.line; this.onLine(this.playing || this.t < this.res.duration ? f.line : 0); }
    this.draw(st, f);
  }
  draw(st, f) {
    const g = st.g, W = st.W, H = st.H, v = this.view;
    if (!v) this.fit();
    const { sc, cx, cy } = this.view;
    const X = (x) => W / 2 + (x - cx) * sc, Y = (y) => H / 2 - (y - cy) * sc;
    g.fillStyle = C.mat; g.fillRect(0, 0, W, H);
    // 10 cm grid
    g.strokeStyle = C.grid; g.lineWidth = 1;
    const gx0 = Math.floor((cx - W / 2 / sc) / 100) * 100, gy0 = Math.floor((cy - H / 2 / sc) / 100) * 100;
    for (let x = gx0; X(x) < W; x += 100) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
    for (let y = gy0; Y(y) > 0; y += 100) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
    // ruler for straight()
    if (this.opts.ruler) {
      g.strokeStyle = '#9aa6b8'; g.fillStyle = C.muted; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(-90), Y(-520)); g.lineTo(X(-90), Y(520)); g.stroke();
      for (let y = -500; y <= 500; y += 50) {
        g.beginPath(); g.moveTo(X(-90), Y(y)); g.lineTo(X(-90) - (y % 100 === 0 ? 14 : 7), Y(y)); g.stroke();
        if (y % 100 === 0) text(g, `${y / 10} cm`, X(-90) - 18, Y(y) + 4, { size: 11, color: C.muted, align: 'right' });
      }
    }
    // protractor for turn()
    if (this.opts.protractor) {
      const R = 150 * sc, ox = X(0), oy = Y(0);
      g.strokeStyle = '#c8d1de'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.stroke();
      for (let d = 0; d < 360; d += 15) {
        const a = (d - 90) * Math.PI / 180, l = d % 90 === 0 ? 12 : 6;
        g.beginPath(); g.moveTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R); g.lineTo(ox + Math.cos(a) * (R - l), oy + Math.sin(a) * (R - l)); g.stroke();
      }
      text(g, '0', ox, oy - R - 6, { size: 12, color: C.muted, align: 'center' });
      text(g, '+90 right', ox + R + 6, oy + 4, { size: 12, color: C.p });
      text(g, '−90 left', ox - R - 6, oy + 4, { size: 12, color: C.f, align: 'right' });
      text(g, '180', ox, oy + R + 16, { size: 12, color: C.muted, align: 'center' });
      const th = f.th;
      if (Math.abs(th) > 0.01) {
        g.fillStyle = th > 0 ? 'rgba(242,118,29,0.18)' : 'rgba(47,128,237,0.18)';
        g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, R * 0.8, -Math.PI / 2, -Math.PI / 2 + th, th < 0); g.closePath(); g.fill();
        const deg = Math.round(th * 180 / Math.PI);
        pill(g, `${deg > 0 ? '+' : ''}${deg}°`, ox, oy - R * 0.45 - 2, th > 0 ? C.p : C.f, '#fff', 14);
      }
    }
    // start box
    g.strokeStyle = '#8a96a8'; g.setLineDash([5, 4]); g.lineWidth = 1.5;
    rr(g, X(-75), Y(75), 150 * sc, 150 * sc, 8); g.stroke(); g.setLineDash([]);
    text(g, 'START', X(0), Y(-75) + 14, { size: 11, color: C.muted, align: 'center' });
    // trail
    const fr = this.res.frames;
    g.strokeStyle = C.p; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(fr[0].x), Y(fr[0].y));
    for (const q of fr) { if (q.t > this.t) break; g.lineTo(X(q.x), Y(q.y)); }
    g.stroke();
    // robot
    const ringCol = { RED: '#ef4444', ORANGE: '#f97316', YELLOW: '#facc15', GREEN: '#34d399', CYAN: '#22d3ee', BLUE: '#3b82f6', VIOLET: '#8b5cf6', MAGENTA: '#d946ef', WHITE: '#ffffff', NONE: '#9aa3b2' }[f.light] || '#34d399';
    drawRobot(g, X(f.x), Y(f.y), Math.PI / 2 - f.th, Math.max(sc, 0.32), { aL: f.aL, aR: f.aR, ring: ringCol });
    // things the hub does
    const ev = this.res.events;
    for (const e of ev) {
      if (e.type === 'beep' && this.t >= e.t && this.t < e.t + Math.max(0.6, e.dur / 1000)) pill(g, '♪ beep', X(f.x), Y(f.y) - 60, C.purple);
    }
    if (f.display) pill(g, `hub shows: ${f.display}`, X(f.x), Y(f.y) + 62, C.ink);
    const arms = Object.keys(f.arms || {});
    arms.forEach((p, i) => {
      const x = 16 + i * 80, y = 18;
      rr(g, x, y - 12, 72, 26, 8); g.fillStyle = '#fff'; g.fill();
      text(g, `${p}: ${Math.round(f.arms[p])}°`, x + 36, y + 6, { size: 12, align: 'center' });
    });
    // scale bar
    const bar = 100 * sc;
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W - 14 - bar, H - 14); g.lineTo(W - 14, H - 14); g.stroke();
    text(g, '10 cm', W - 14 - bar / 2, H - 20, { size: 11, color: C.muted, align: 'center' });
  }
}

// =====================================================================
// a wheel seen from the side, spun by a motor
function drawWheel(g, cx, cy, R, angDeg, opts = {}) {
  g.save(); g.translate(cx, cy);
  if (opts.target !== undefined) {
    const a0 = (opts.start || 0) * Math.PI / 180, a1 = opts.target * Math.PI / 180;
    g.strokeStyle = 'rgba(242,118,29,0.55)'; g.lineWidth = 8; g.setLineDash([8, 6]);
    g.beginPath(); g.arc(0, 0, R + 18, a0 - Math.PI / 2, a1 - Math.PI / 2, a1 < a0); g.stroke(); g.setLineDash([]);
  }
  g.rotate(angDeg * Math.PI / 180);
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fillStyle = C.tyre; g.fill();
  g.strokeStyle = '#3a3f48'; g.lineWidth = 3;
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86); g.lineTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98); g.stroke(); }
  g.beginPath(); g.arc(0, 0, R * 0.68, 0, Math.PI * 2); g.fillStyle = '#c3c8cf'; g.fill();
  g.fillStyle = '#2a2d33';
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, R * 0.1, 0, Math.PI * 2); g.fill(); }
  g.fillRect(-R * 0.16, -R * 0.04, R * 0.32, R * 0.08); g.fillRect(-R * 0.04, -R * 0.16, R * 0.08, R * 0.32);
  g.fillStyle = C.yellow; rr(g, -R * 0.06, -R * 0.66, R * 0.12, R * 0.22, 3); g.fill();
  g.restore();
}

// =====================================================================
// the lesson content
const PARTS = [
  { id: 'p1', name: 'Talk to your robot', color: '#7c3aed' },
  { id: 'p2', name: 'Make a motor move', color: '#2f80ed' },
  { id: 'p3', name: 'Drive the robot', color: '#16a34a' },
  { id: 'p4', name: 'Your first program', color: '#f2761d' },
];

function stepHTML(n, part, title, body, visual, extraCls = '') {
  return `<article class="lp-step ${extraCls}" data-part="${part}" id="lp-step-${n}">
    <div class="lp-text"><span class="lp-num">${n}</span><h3>${title}</h3>${body}</div>
    <div class="lp-vis">${visual}</div>
  </article>`;
}

function pageHTML() {
  const S = [];
  S.push(`<div class="lp-hero"><h2>Write your first robot program</h2><p>Follow the steps in order. Try every slider and button. At the end you will run your own code!</p>
    <nav class="lp-parts">${PARTS.map((p, i) => `<a href="#lp-${p.id}" style="--pc:${p.color}"><b>Part ${i + 1}</b>${p.name}</a>`).join('')}</nav></div>`);

  // ----- Part 1
  S.push(`<h2 class="lp-part" id="lp-p1" style="--pc:${PARTS[0].color}">Part 1 · Talk to your robot</h2>`);
  S.push(stepHTML(1, 'p1', 'A program is a list of steps', `
    <p>A <b>program</b> is a list of instructions. The robot does them <b>one at a time, from top to bottom</b>, just like following a recipe.</p>
    <p>Watch the yellow line jump to each step as the robot does it.</p>`,
    `<div class="lp-demo"><pre class="lp-code lp-steps" id="lp1-code"></pre><canvas class="lp-mat" id="lp1-mat"></canvas></div>`));
  S.push(stepHTML(2, 'p1', 'Bring in your tools: <code>import</code>', `
    <p>Python doesn't know about robots until you bring in the tools. Every Pybricks program starts with <b>import</b> lines.</p>
    <p><code>from</code> says which toolbox. <code>import</code> says which tools to take out.</p>`,
    `<div class="lp-imports" id="lp2">
      ${[
        ['from pybricks.hubs import PrimeHub', '🧠', 'the hub (the brain)'],
        ['from pybricks.pupdevices import Motor', '⚙️', 'motors'],
        ['from pybricks.parameters import Direction, Port', '🔌', 'port letters and directions'],
        ['from pybricks.robotics import DriveBase', '🚗', 'a robot that drives'],
        ['from pybricks.tools import wait', '⏱️', 'waiting'],
      ].map(([code, icon, what], i) => `<div class="lp-imp" style="--i:${i}">${codeBlock(code, 'inline')}<span class="lp-tool"><i>${icon}</i>${what}</span></div>`).join('')}
      <button class="btn small" id="lp2-replay">↺ Show me again</button>
    </div>`));
  S.push(stepHTML(3, 'p1', 'Give things a name with <code>=</code>', `
    <p>The <b>=</b> sign gives something a name, like sticking on a name tag. Then you use that name to talk to it.</p>
    <p><code>hub = PrimeHub()</code> means: “make a hub, and call it <b>hub</b>.”</p>
    <p>You can pick the name! Try typing a different one. (No spaces, and don't start with a number.)</p>`,
    `<div class="lp-name">
      <div class="lp-hubpic"><div class="lp-hub"><div class="lp-matrix">${'<i></i>'.repeat(25)}</div><span class="lp-btn"></span></div><div class="lp-tag" id="lp3-tag">hub</div></div>
      <label class="lp-field">Name: <input id="lp3-name" value="hub" maxlength="14" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></label>
      <div id="lp3-code"></div><p class="lp-note" id="lp3-note"></p>
    </div>`));
  S.push(stepHTML(4, 'p1', 'Plug in the motors: <code>Motor</code> and <code>Port</code>', `
    <p>The hub has 6 ports: <b>A, B, C, D, E, F</b>. A motor plugs into one of them. You tell Python which one:</p>
    ${codeBlock('left = Motor(Port.A, Direction.COUNTERCLOCKWISE)\nright = Motor(Port.B)')}
    <p>On our robot the <b>left</b> wheel motor is in <b>A</b> and the <b>right</b> one is in <b>B</b>.</p>
    <p><b>Why COUNTERCLOCKWISE?</b> The two motors face opposite ways. To make <i>both</i> wheels roll forward, the left motor has to spin the other way. Turn it off below and see what happens!</p>`,
    `<canvas class="lp-canvas" id="lp4-ports"></canvas>
     <div class="lp-row"><span>Left motor port:</span><div class="seg" id="lp4-left">${'ABCDEF'.split('').map((p) => `<button data-p="${p}" class="${p === 'A' ? 'on' : ''}">${p}</button>`).join('')}</div></div>
     <div class="lp-row"><span>Right motor port:</span><div class="seg" id="lp4-right">${'ABCDEF'.split('').map((p) => `<button data-p="${p}" class="${p === 'B' ? 'on' : ''}">${p}</button>`).join('')}</div></div>
     <div id="lp4-code"></div><p class="lp-note" id="lp4-note"></p>
     <label class="check big"><input type="checkbox" id="lp4-dir" checked> Left motor has <code>Direction.COUNTERCLOCKWISE</code></label>
     <canvas class="lp-mat short" id="lp4-mat"></canvas><p class="lp-note" id="lp4-warn"></p>`));
  S.push(stepHTML(5, 'p1', 'How to give a command', `
    <p>Every command has the same parts. Read it like a sentence: <i>“left motor, run for a time, at speed 500, for 2000 milliseconds.”</i></p>
    <ul class="facts">
      <li><b>Who:</b> the name you made, like <code>left</code> or <code>robot</code>.</li>
      <li><b>The dot</b> means “hey, do this.”</li>
      <li><b>The function</b> is the action, like <code>run_time</code> or <code>straight</code>.</li>
      <li><b>Parameters</b> go inside <code>( )</code>. They are the details: how fast, how far, how long. Commas go between them.</li>
    </ul>`,
    `<div class="lp-anatomy" id="lp5">
      <div class="lp-ana-row"><span class="a-who">left</span><span class="a-dot">.</span><span class="a-fn">run_time</span><span class="a-par">(</span><span class="a-p1">500</span><span class="a-par">,</span> <span class="a-p2">2000</span><span class="a-par">)</span></div>
      <div class="lp-ana-labels"><span class="a-who">who</span><span class="a-dot">dot</span><span class="a-fn">function: what to do</span><span class="a-p1">speed</span><span class="a-p2">time</span></div>
      <div class="lp-ana-row small"><span class="a-who">robot</span><span class="a-dot">.</span><span class="a-fn">straight</span><span class="a-par">(</span><span class="a-p1">200</span><span class="a-par">)</span></div>
      <div class="lp-ana-labels small"><span class="a-who">who</span><span class="a-dot">dot</span><span class="a-fn">function</span><span class="a-p1">distance</span></div>
      <div class="lp-machine"><div class="lp-balls"><i class="b1">500</i><i class="b2">2000</i></div><div class="lp-box">run_time</div><div class="lp-result">⟳ wheel spins!</div></div>
    </div>`));

  // ----- Part 2
  S.push(`<h2 class="lp-part" id="lp-p2" style="--pc:${PARTS[1].color}">Part 2 · Make a motor move</h2>`);
  S.push(stepHTML(6, 'p2', '<code>run_time(speed, time)</code>', `
    <p>Spin a motor <b>for a time</b>.</p>
    <ul class="facts">
      <li><b>speed</b> is in <b>degrees per second</b>. 360 degrees is one full turn. Use a minus sign (like −500) to spin backward.</li>
      <li><b>time</b> is in <b>milliseconds</b>. <b>1000 milliseconds = 1 second.</b></li>
    </ul>
    <p>Move the sliders, then press <b>Run</b>.</p>`,
    `<canvas class="lp-canvas" id="lp6-can"></canvas>
     <div class="lp-sliders">
       <label>speed <output id="lp6-sv">500</output><input type="range" id="lp6-s" min="-1000" max="1000" step="50" value="500"></label>
       <label>time <output id="lp6-tv">2000</output><input type="range" id="lp6-t" min="0" max="5000" step="250" value="2000"></label>
     </div>
     <div class="lp-runrow"><div id="lp6-code" class="grow"></div><button class="btn go small" id="lp6-run">▶ Run</button></div>
     <p class="lp-math" id="lp6-math"></p>`));
  S.push(stepHTML(7, 'p2', '<code>run_angle(speed, angle)</code>', `
    <p>Spin a motor <b>by an exact angle</b>, then stop.</p>
    <ul class="facts">
      <li><b>angle</b> is in degrees: <b>360 = one full turn</b>, 180 = half a turn, 90 = a quarter turn.</li>
      <li>Keep <b>speed</b> positive. To spin the other way, make the <b>angle</b> negative, like −90.</li>
    </ul>
    <p>The dashed orange line shows where the wheel will stop.</p>`,
    `<canvas class="lp-canvas" id="lp7-can"></canvas>
     <div class="lp-sliders">
       <label>speed <output id="lp7-sv">500</output><input type="range" id="lp7-s" min="100" max="1000" step="50" value="500"></label>
       <label>angle <output id="lp7-av">360</output><input type="range" id="lp7-a" min="-720" max="720" step="45" value="360"></label>
     </div>
     <div class="lp-runrow"><div id="lp7-code" class="grow"></div><button class="btn go small" id="lp7-run">▶ Run</button></div>`));
  S.push(stepHTML(8, 'p2', 'Parameters: the order matters!', `
    <p>Python reads parameters <b>in order</b>. For <code>run_time</code> the first number is always <b>speed</b> and the second is always <b>time</b>.</p>
    <p>So these two lines do very different things. Can you tell which one spins for <b>longer</b>?</p>`,
    `<div class="lp-quiz" id="lp8">
      <button class="lp-choice" data-c="A"><b>A</b>${codeBlock('left.run_time(1000, 500)', 'inline')}</button>
      <button class="lp-choice" data-c="B"><b>B</b>${codeBlock('left.run_time(500, 1000)', 'inline')}</button>
      <p class="lp-quiz-msg" id="lp8-msg">Tap A or B.</p>
      <canvas class="lp-canvas short" id="lp8-can"></canvas>
    </div>`));

  // ----- Part 3
  S.push(`<h2 class="lp-part" id="lp-p3" style="--pc:${PARTS[2].color}">Part 3 · Drive the robot</h2>`);
  S.push(stepHTML(9, 'p3', '<code>DriveBase</code>: two motors become one robot', `
    <p>Driving with two separate motors is hard. A <b>DriveBase</b> joins them into one robot that understands <b>millimeters</b> and <b>degrees</b>.</p>
    ${codeBlock('robot = DriveBase(left, right, wheel_diameter=56, axle_track=112)')}
    <ul class="facts">
      <li><b>left, right:</b> your two wheel motors, left first.</li>
      <li><b>wheel_diameter:</b> how tall the wheel is: 56 mm.</li>
      <li><b>axle_track:</b> the space between the two wheels: 112 mm.</li>
    </ul>
    <p>These numbers let the robot work out how far it went. Measure your own robot with a ruler!</p>`,
    `<canvas class="lp-canvas tall" id="lp9-can"></canvas>`));
  S.push(stepHTML(10, 'p3', '<code>robot.straight(distance)</code>', `
    <p>Drive forward by a <b>distance in millimeters</b>.</p>
    <ul class="facts">
      <li><b>10 mm = 1 cm</b>, so <code>straight(300)</code> drives 30 cm.</li>
      <li>A <b>negative</b> distance drives <b>backward</b>: <code>straight(-200)</code>.</li>
    </ul>`,
    `<canvas class="lp-mat" id="lp10-mat"></canvas>
     <div class="lp-sliders one"><label>distance <output id="lp10-dv">300</output><input type="range" id="lp10-d" min="-500" max="500" step="50" value="300"></label></div>
     <div class="lp-runrow"><div id="lp10-code" class="grow"></div><button class="btn go small" id="lp10-run">▶ Run</button></div>`));
  S.push(stepHTML(11, 'p3', '<code>robot.turn(angle)</code>', `
    <p>Turn in place by an <b>angle in degrees</b>.</p>
    <ul class="facts">
      <li><b>Positive</b> turns <b>right</b> (like a clock's hands). <b>Negative</b> turns <b>left</b>.</li>
      <li>90 is a quarter turn, 180 turns all the way around, 360 is a full circle.</li>
    </ul>`,
    `<canvas class="lp-mat" id="lp11-mat"></canvas>
     <div class="lp-sliders one"><label>angle <output id="lp11-av">90</output><input type="range" id="lp11-a" min="-360" max="360" step="15" value="90"></label></div>
     <div class="lp-runrow"><div id="lp11-code" class="grow"></div><button class="btn go small" id="lp11-run">▶ Run</button></div>`));

  // ----- Part 4
  S.push(`<h2 class="lp-part" id="lp-p4" style="--pc:${PARTS[3].color}">Part 4 · Your first program</h2>`);
  S.push(`<article class="lp-step lp-editor-step" data-part="p4" id="lp-step-12">
    <div class="lp-text wide"><span class="lp-num">12</span><h3>Put it all together</h3>
      <p>Here is a whole program: the tools, the names, and then the moves. Press <b>Run</b> to watch the practice robot. Then change the moves and try the challenges!</p>
      <p class="tip">Tap the buttons to add a line. The numbers on the left show which line the robot is doing right now.</p></div>
    <div class="lp-editor">
      <div class="lp-ed-left">
        <div class="lp-snips" id="lp-snips">
          <button data-s="robot.straight(200)">+ straight</button><button data-s="robot.turn(90)">+ turn</button><button data-s="wait(1000)">+ wait</button><button data-s="hub.speaker.beep()">+ beep</button><button data-s="for i in range(4):\n    robot.straight(200)\n    robot.turn(90)">+ repeat</button>
        </div>
        <div class="lp-ed-box"><div class="lp-gutter" id="lp-gutter"></div><textarea id="lp-ed" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Your program"></textarea></div>
        <div class="lp-ed-btns"><button class="btn go" id="lp-run">▶ Run</button><button class="btn" id="lp-stop">■ Stop</button><button class="btn" id="lp-reset">↺ Start over</button><button class="btn" id="lp-copy">Copy code</button></div>
      </div>
      <div class="lp-ed-right">
        <canvas class="lp-mat big" id="lp-ed-mat"></canvas>
        <div class="lp-out" id="lp-out" aria-live="polite"><span class="lp-out-idle">Press ▶ Run to see your program.</span></div>
      </div>
    </div>
    <div class="lp-challenges"><h4>Challenges</h4><ol id="lp-chal"></ol></div>
  </article>`);
  S.push(stepHTML(13, 'p4', 'Do it again: the <code>for</code> loop', `
    <p>A square is “drive, turn” four times. Instead of writing it 4 times, use a <b>loop</b>:</p>
    ${codeBlock('for i in range(4):\n    robot.straight(200)\n    robot.turn(90)')}
    <ul class="facts">
      <li><code>range(4)</code> means “4 times.”</li>
      <li>The line ends with a <b>colon :</b></li>
      <li>The lines to repeat are <b>pushed in</b> with 4 spaces. That is how Python knows they belong to the loop.</li>
    </ul>
    <button class="btn small" data-load="loop">Put this in my program</button>`,
    `<div class="lp-loopvis"><div class="lp-repeat"><span>×4</span></div><canvas class="lp-mat" id="lp13-mat"></canvas></div>`));
  S.push(stepHTML(14, 'p4', 'Make your own command: <code>def</code> and parameters', `
    <p>You can make <b>your own function</b>! <code>def</code> means “define”: teach Python a new command.</p>
    ${codeBlock('def square(size):\n    for i in range(4):\n        robot.straight(size)\n        robot.turn(90)\n\nsquare(100)\nsquare(250)')}
    <ul class="facts">
      <li><code>size</code> is a <b>parameter</b>: an empty box that gets filled in each time you use it.</li>
      <li><code>square(100)</code> puts 100 in the box. <code>square(250)</code> puts 250 in the box.</li>
      <li>Same recipe, different size!</li>
    </ul>
    <button class="btn small" data-load="def">Put this in my program</button>`,
    `<div class="lp-recipe"><div class="lp-card">def square(<span class="lp-slot" id="lp14-slot">size</span>):</div><canvas class="lp-mat" id="lp14-mat"></canvas></div>`));
  S.push(stepHTML(15, 'p4', 'Send it to the real robot', `
    <ol class="lp-send">
      <li>On a <b>Chromebook or computer</b>, open <a href="https://code.pybricks.com" target="_blank" rel="noopener">code.pybricks.com</a> in Chrome or Edge.</li>
      <li>Turn on the hub and click the <b>Bluetooth</b> button to connect.</li>
      <li>Press <b>Copy code</b> in step 12, then paste it into Pybricks.</li>
      <li>Put the robot on the floor with space around it, and press the <b>▶ Run</b> button.</li>
      <li>Did it go too far or not far enough? Change the numbers and try again. That is what real engineers do!</li>
    </ol>
    <p class="ipad-note"><b>📱 On an iPad?</b> You can practice everything here, but iPads can't connect to the hub. Use a Chromebook or computer for step 2 onward.</p>`,
    `<div class="lp-sendpic"><div class="lp-laptop">💻<span>code.pybricks.com</span></div><div class="lp-waves">)))</div><div class="lp-hub small"><div class="lp-matrix">${'<i></i>'.repeat(25)}</div><span class="lp-btn"></span></div></div>`));
  return S.join('\n');
}

// =====================================================================
export function initLearn() {
  const root = $('learn-root');
  root.innerHTML = pageHTML();
  root.querySelectorAll('.lp-text').forEach((box) => {
    const h3 = box.querySelector('h3');
    if (h3) h3.appendChild(readButton(() => readableText(box)));
  });

  step1(); step2(); step3(); step4(); step5(); step6(); step7(); step8(); step9(); step10(); step11();
  const ed = editor(); step13(ed); step14(ed);
  sizeAll();
  window.addEventListener('resize', sizeAll);
  requestAnimationFrame(loop);
  return { resize: () => requestAnimationFrame(sizeAll) };
}

const runLines = (body) => runProgram(SETUP + body);
const setupLineCount = SETUP.split('\n').length - 1;

function step1() {
  const body = 'robot.straight(300)\nrobot.turn(90)\nrobot.straight(200)\nhub.speaker.beep()\n';
  const lines = body.trim().split('\n');
  const codeEl = $('lp1-code');
  codeEl.innerHTML = `<span class="lp-dim"># (setup lines first: you'll learn them next)</span>\n` + lines.map((l, i) => `<span class="lp-line" data-i="${i}">${hl(l)}</span>`).join('\n');
  const player = new MatPlayer($('lp1-mat'), { minSpan: 650 });
  player.onLine = (ln) => { const i = ln - setupLineCount - 1; codeEl.querySelectorAll('.lp-line').forEach((s) => s.classList.toggle('now', Number(s.dataset.i) === i)); };
  player.onEnd = () => setTimeout(() => player.load(player.res, true), 1600);
  player.load(runLines(body), true);
}

function step2() {
  const box = $('lp2');
  $('lp2-replay').addEventListener('click', () => { box.classList.remove('go'); void box.offsetWidth; box.classList.add('go'); });
  const ob = new IntersectionObserver((es) => { if (es[0].isIntersecting) { box.classList.add('go'); ob.disconnect(); } }, { threshold: 0.4 });
  ob.observe(box);
}

function step3() {
  const input = $('lp3-name');
  const upd = () => {
    const v = input.value;
    const ok = /^[A-Za-z_][A-Za-z_0-9]*$/.test(v);
    const reserved = ['for', 'in', 'def', 'import', 'from', 'print', 'range', 'PrimeHub'].includes(v);
    $('lp3-tag').textContent = v || '?';
    $('lp3-code').innerHTML = codeBlock(`${v || '???'} = PrimeHub()\n${v || '???'}.speaker.beep()`);
    $('lp3-note').textContent = !v ? 'Type a name.' : /\s/.test(v) ? 'Names can\'t have spaces. Try an _ instead, like my_hub.' : /^\d/.test(v) ? 'Names can\'t start with a number.' : !ok ? 'Use only letters, numbers and _ in a name.' : reserved ? `${v} is already a Python word. Pick another name.` : `Now you talk to the hub by its name: ${v}.speaker.beep()`;
    $('lp3-note').className = `lp-note ${ok && !reserved ? 'good' : 'bad'}`;
  };
  input.addEventListener('input', upd);
  upd();
}

function step4() {
  let L = 'A', R = 'B';
  const can = $('lp4-ports');
  const s = stage(can, (dt, st) => {
    const g = st.g, W = st.W, H = st.H;
    g.clearRect(0, 0, W, H);
    const hx = W / 2, hy = H * 0.36, hw = Math.min(170, W * 0.36), hh = hw * 0.64;
    rr(g, hx - hw / 2, hy - hh / 2, hw, hh, 14); g.fillStyle = C.yellow; g.fill();
    rr(g, hx - hw / 2 + 6, hy - hh / 2 + 6, hw - 12, hh - 12, 10); g.fillStyle = C.white; g.fill();
    rr(g, hx - hh * 0.3, hy - hh * 0.3, hh * 0.6, hh * 0.6, 6); g.fillStyle = '#23272e'; g.fill();
    const ports = { A: [-1, 0], C: [-1, 1], E: [-1, 2], B: [1, 0], D: [1, 1], F: [1, 2] };
    const pos = {};
    for (const p in ports) {
      const [side, k] = ports[p];
      const x = hx + side * (hw / 2 + 2), y = hy - hh / 2 + 16 + k * (hh - 32) / 2;
      pos[p] = [x, y];
      rr(g, x - 13, y - 11, 26, 22, 5); g.fillStyle = (p === L || p === R) ? C.ink : '#8a96a8'; g.fill();
      text(g, p, x, y + 5, { size: 14, weight: 900, color: '#fff', align: 'center' });
    }
    // two motors with wheels
    const my = H * 0.8;
    for (const [name, port, mx] of [['left motor', L, W * 0.18], ['right motor', R, W * 0.82]]) {
      rr(g, mx - 34, my - 22, 68, 44, 9); g.fillStyle = C.white; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1.5; g.stroke();
      text(g, name, mx, my + 40, { size: 13, color: C.muted, align: 'center' });
      const [px, py] = pos[port];
      g.strokeStyle = C.ink; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(mx, my - 22); g.bezierCurveTo(mx, my - 90, px + (px < hx ? -60 : 60), py, px, py); g.stroke();
      pill(g, `Port.${port}`, mx, my - 2, name.startsWith('left') ? C.f : C.p, '#fff', 13);
    }
  }, null);
  void s;
  const upd = () => {
    $('lp4-code').innerHTML = codeBlock(`left = Motor(Port.${L}${$('lp4-dir').checked ? ', Direction.COUNTERCLOCKWISE' : ''})\nright = Motor(Port.${R})`);
    $('lp4-note').textContent = L === R ? 'Two motors can\'t share one port!' : (L !== 'A' || R !== 'B') ? 'That works on a robot built that way. Our class robot uses A for the left wheel and B for the right wheel.' : 'Just like our class robot.';
    $('lp4-note').className = `lp-note ${L === R ? 'bad' : (L !== 'A' || R !== 'B') ? 'warn' : 'good'}`;
  };
  for (const [id, set] of [['lp4-left', (p) => { L = p; }], ['lp4-right', (p) => { R = p; }]]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      set(b.dataset.p); for (const x of $(id).children) x.classList.toggle('on', x === b); upd();
    });
  }
  // the Direction demo: drive straight 30 cm with and without COUNTERCLOCKWISE
  const player = new MatPlayer($('lp4-mat'), { minSpan: 650 });
  const drive = () => {
    const ok = $('lp4-dir').checked;
    const src = (ok ? SETUP : SETUP.replace('Motor(Port.A, Direction.COUNTERCLOCKWISE)', 'Motor(Port.A)')) + 'robot.straight(300)\n';
    const res = runProgram(src);
    player.load(res, true);
    $('lp4-warn').textContent = ok ? '✓ Both wheels roll forward, so robot.straight(300) drives 30 cm.' : '✗ The left wheel rolls backward, so the robot spins in place instead of driving!';
    $('lp4-warn').className = `lp-note ${ok ? 'good' : 'bad'}`;
    upd();
  };
  player.onEnd = () => setTimeout(() => player.load(player.res, true), 1400);
  $('lp4-dir').addEventListener('change', drive);
  drive();
}

function step5() {
  const box = $('lp5');
  const parts = ['a-who', 'a-dot', 'a-fn', 'a-p1', 'a-p2'];
  let k = 0;
  setInterval(() => {
    if ($('tab-learn').hidden) return;
    box.dataset.hi = parts[k % parts.length];
    k++;
  }, 1300);
}

// ---------- spinning wheel widgets
function wheelWidget(id, { mode }) {
  const can = $(`${id}-can`);
  const st = { ang: 0, start: 0, t: 0, running: false, sp: 500, time: 2000, angle: 360 };
  const s = stage(can, (dt, S) => {
    const g = S.g, W = S.W, H = S.H;
    if (st.running) {
      st.t += dt;
      if (mode === 'time') {
        const T = st.time / 1000;
        const tt = Math.min(st.t, T);
        st.ang = st.start + st.sp * tt;
        if (st.t >= T) st.running = false;
      } else {
        const T = Math.abs(st.angle) / st.sp;
        const tt = Math.min(st.t, T);
        st.ang = st.start + Math.sign(st.angle) * st.sp * tt;
        if (st.t >= T) st.running = false;
      }
    }
    g.clearRect(0, 0, W, H);
    const R = Math.min(H * 0.36, W * 0.2);
    const cx = W * 0.3, cy = H * 0.5;
    // motor block behind the wheel
    rr(g, cx - R * 0.5, cy - R * 0.5, R, R, 10); g.fillStyle = '#e8edf4'; g.fill();
    const target = mode === 'angle' && !st.running ? st.start + st.angle : mode === 'angle' ? st.start + st.angle : undefined;
    drawWheel(g, cx, cy, R, st.ang, mode === 'angle' ? { target, start: st.start } : {});
    // direction arrow
    const sp = mode === 'time' ? st.sp : st.sp * Math.sign(st.angle);
    if (sp) {
      const cw = sp > 0;
      g.strokeStyle = cw ? C.p : C.f; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.arc(cx, cy, R + 34, cw ? -2.2 : -0.94, cw ? -0.94 : -2.2, !cw); g.stroke();
      text(g, cw ? 'forward ⟳' : '⟲ backward', cx, cy - R - 44, { size: 13, color: cw ? C.p : C.f, align: 'center' });
    }
    // readouts
    const turned = st.ang - (st.runStart ?? st.start);
    const x0 = W * 0.58;
    const tShown = mode === 'time' ? Math.min(st.t, st.time / 1000) : st.t;
    text(g, '⏱ ' + (st.running || st.t ? tShown.toFixed(2) : '0.00') + ' s', x0, cy - 34, { size: 24, weight: 900 });
    text(g, `${Math.round(turned)}°`, x0, cy + 4, { size: 24, weight: 900, color: C.p });
    text(g, `= ${(Math.abs(turned) / 360).toFixed(2)} turns`, x0, cy + 30, { size: 15, color: C.muted });
  });
  void s;
  return st;
}

function step6() {
  const st = wheelWidget('lp6', { mode: 'time' });
  const upd = () => {
    st.sp = Number($('lp6-s').value); st.time = Number($('lp6-t').value);
    $('lp6-sv').textContent = st.sp; $('lp6-tv').textContent = st.time;
    $('lp6-code').innerHTML = codeBlock(`left.run_time(${st.sp}, ${st.time})`, 'inline');
    const deg = st.sp * st.time / 1000;
    $('lp6-math').innerHTML = `${st.sp} degrees per second × ${(st.time / 1000).toString()} seconds = <b>${Math.round(deg)} degrees</b> (${(Math.abs(deg) / 360).toFixed(1)} turns)`;
  };
  $('lp6-s').addEventListener('input', upd); $('lp6-t').addEventListener('input', upd);
  $('lp6-run').addEventListener('click', () => { st.runStart = st.ang; st.start = st.ang; st.t = 0; st.running = true; });
  upd();
}

function step7() {
  const st = wheelWidget('lp7', { mode: 'angle' });
  const upd = () => {
    st.sp = Number($('lp7-s').value); if (!st.running) st.angle = Number($('lp7-a').value);
    $('lp7-sv').textContent = st.sp; $('lp7-av').textContent = $('lp7-a').value;
    $('lp7-code').innerHTML = codeBlock(`left.run_angle(${st.sp}, ${$('lp7-a').value})`, 'inline');
  };
  $('lp7-s').addEventListener('input', upd); $('lp7-a').addEventListener('input', upd);
  $('lp7-run').addEventListener('click', () => { st.angle = Number($('lp7-a').value); st.runStart = st.ang; st.start = st.ang; st.t = 0; st.running = true; });
  upd();
}

function step8() {
  const can = $('lp8-can');
  const W2 = { a: { sp: 1000, ms: 500, ang: 0 }, b: { sp: 500, ms: 1000, ang: 0 }, t: 0, run: false };
  stage(can, (dt, S) => {
    const g = S.g, W = S.W, H = S.H;
    if (W2.run) W2.t += dt;
    g.clearRect(0, 0, W, H);
    const R = Math.min(H * 0.3, W * 0.13);
    [['A', W2.a, W * 0.27], ['B', W2.b, W * 0.73]].forEach(([n, w, cx]) => {
      const tt = Math.min(W2.t, w.ms / 1000);
      drawWheel(g, cx, H * 0.48, R, w.sp * tt);
      text(g, n, cx - R - 22, H * 0.48 + 8, { size: 24, weight: 900 });
      const done = W2.t >= w.ms / 1000;
      text(g, `${tt.toFixed(2)} s${done && W2.run ? ' ✓ done' : ''}`, cx, H * 0.48 + R + 26, { size: 16, weight: 900, align: 'center', color: done && W2.run ? C.good : C.ink });
    });
    if (W2.t > 1.6) W2.run = false;
  });
  $('lp8').addEventListener('click', (e) => {
    const b = e.target.closest('.lp-choice'); if (!b) return;
    const right = b.dataset.c === 'B';
    $('lp8').querySelectorAll('.lp-choice').forEach((x) => x.classList.toggle('picked', x === b));
    b.classList.toggle('right', right); b.classList.toggle('wrong', !right);
    $('lp8-msg').innerHTML = right ? '✓ Yes! B spins for <b>1000 ms (1 second)</b>. The second number is the time. A spins faster but stops after only half a second.' : 'Not quite. A has the bigger <b>first</b> number, so it spins <b>faster</b>, but its time is only 500 ms. Watch:';
    $('lp8-msg').className = `lp-quiz-msg ${right ? 'good' : 'bad'}`;
    W2.t = 0; W2.run = true;
  });
}

function step9() {
  stage($('lp9-can'), (dt, S) => {
    const g = S.g, W = S.W, H = S.H;
    g.clearRect(0, 0, W, H);
    const sc = Math.min(W / 300, H / 230);
    const cx = W * 0.42, cy = H * 0.5;
    drawRobot(g, cx, cy, Math.PI / 2, sc, {});
    // axle track: between wheel centres (robot faces up, wheels left/right of the axle)
    const y = cy, xl = cx - 56 * sc, xr = cx + 56 * sc;
    g.strokeStyle = C.p; g.fillStyle = C.p; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(xl, y); g.lineTo(xr, y); g.stroke();
    for (const [x, d] of [[xl, 1], [xr, -1]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + d * 10, y - 6); g.lineTo(x + d * 10, y + 6); g.closePath(); g.fill(); }
    pill(g, 'axle_track = 112 mm', cx, y + 22, C.p, '#fff', 13);
    // wheel diameter: side view of a wheel to the right
    const R = 28 * sc * 0.9, wx = W * 0.83, wy = cy;
    drawWheel(g, wx, wy, R, 0);
    g.strokeStyle = C.f; g.fillStyle = C.f; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(wx + R + 14, wy - R); g.lineTo(wx + R + 14, wy + R); g.stroke();
    for (const [yy, d] of [[wy - R, 1], [wy + R, -1]]) { g.beginPath(); g.moveTo(wx + R + 14, yy); g.lineTo(wx + R + 8, yy + d * 10); g.lineTo(wx + R + 20, yy + d * 10); g.closePath(); g.fill(); }
    text(g, 'wheel_diameter', wx, wy + R + 22, { size: 13, weight: 900, color: C.f, align: 'center' });
    text(g, '= 56 mm', wx, wy + R + 38, { size: 13, weight: 900, color: C.f, align: 'center' });
    text(g, 'seen from the side', wx, wy - R - 12, { size: 11, color: C.muted, align: 'center' });
    pill(g, 'left motor', cx - 62 * sc, cy - 70 * sc, C.f, '#fff', 12);
    pill(g, 'right motor', cx + 62 * sc, cy - 70 * sc, C.f, '#fff', 12);
    text(g, '↑ front', cx, cy - 92 * sc, { size: 12, color: C.muted, align: 'center' });
  });
}

function sliderDemo(n, key, make, opts) {
  const player = new MatPlayer($(`lp${n}-mat`), opts);
  const input = $(`lp${n}-${key}`), out = $(`lp${n}-${key}v`);
  const show = () => { out.textContent = input.value; $(`lp${n}-code`).innerHTML = codeBlock(make(input.value), 'inline'); };
  const go = () => { show(); player.load(runLines(make(input.value) + '\n'), true); };
  input.addEventListener('input', show);
  input.addEventListener('change', go);
  $(`lp${n}-run`).addEventListener('click', go);
  show(); player.load(runLines(make(input.value) + '\n'), false);
}
function step10() { sliderDemo(10, 'd', (v) => `robot.straight(${v})`, { fixed: { x0: -420, x1: 420, y0: -560, y1: 560 }, ruler: true }); }
function step11() { sliderDemo(11, 'a', (v) => `robot.turn(${v})`, { fixed: { x0: -260, x1: 260, y0: -230, y1: 230 }, protractor: true }); }

// ---------- the editor
const CHALLENGES = [
  { id: 'back', name: 'Out and back', how: 'Drive at least 25 cm away, then come back to START.', test: (r) => r.summary.maxDist >= 250 && Math.hypot(r.final.x, r.final.y) < 40 },
  { id: 'square', name: 'Square', how: 'Drive a square and end back on START.', test: (r) => r.summary.straights >= 4 && Math.abs(Math.abs(r.summary.turned) - 360) < 20 && r.summary.maxDist >= 120 && Math.hypot(r.final.x, r.final.y) < 40 },
  { id: 'triangle', name: 'Triangle', how: 'Drive a triangle and end back on START. (Hint: turn 120.)', test: (r) => r.summary.turns === 3 && Math.abs(Math.abs(r.summary.turned) - 360) < 20 && r.summary.maxDist >= 120 && Math.hypot(r.final.x, r.final.y) < 40 },
  { id: 'loop', name: 'Square with a loop', how: 'Make the square using for i in range(4): (step 13).', test: (r, src) => r.summary.usedFor && CHALLENGES[1].test(r, src) },
  { id: 'def', name: 'Your own command', how: 'Make a def with a parameter and use it (step 14).', test: (r) => r.summary.defWithParam && r.summary.calledDef },
  { id: 'show', name: 'Beep and show', how: 'Make the hub beep and show a word with hub.display.text("Hi").', test: (r) => r.events.some((e) => e.type === 'beep') && r.events.some((e) => e.type === 'display') },
];

function editor() {
  const ta = $('lp-ed'), gut = $('lp-gutter');
  ta.value = store.get('code', STARTER);
  const done = store.get('chal', {});
  let marks = { now: 0, err: 0, warn: new Set() };
  const renderGutter = () => {
    const n = ta.value.split('\n').length;
    let h = '';
    for (let i = 1; i <= n; i++) h += `<div class="${i === marks.now ? 'now' : ''} ${i === marks.err ? 'err' : ''} ${marks.warn.has(i) ? 'warn' : ''}">${i}</div>`;
    gut.innerHTML = h;
    gut.scrollTop = ta.scrollTop;
  };
  const renderChal = (fresh = []) => {
    $('lp-chal').innerHTML = CHALLENGES.map((c) => `<li class="${done[c.id] ? 'done' : ''} ${fresh.includes(c.id) ? 'just-done' : ''}"><i class="tick"></i><div><b>${c.name}</b><span>${c.how}</span></div></li>`).join('');
  };
  ta.addEventListener('input', () => { marks = { now: 0, err: 0, warn: new Set() }; renderGutter(); store.set('code', ta.value); });
  ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
  // Tab inserts 4 spaces; Enter keeps the indent (and adds one after a colon)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insertAt('    ', false); }
    else if (e.key === 'Enter') {
      const before = ta.value.slice(0, ta.selectionStart);
      const lineStart = before.lastIndexOf('\n') + 1;
      const cur = before.slice(lineStart);
      let indent = cur.match(/^ */)[0];
      if (/:\s*$/.test(cur)) indent += '    ';
      e.preventDefault(); insertAt('\n' + indent, false);
    }
  });
  function insertAt(str, asLine) {
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    let ins = str;
    if (asLine) {
      // add as a new line after the current line, with the current line's indent
      const lineEnd = ta.value.indexOf('\n', e2) === -1 ? ta.value.length : ta.value.indexOf('\n', e2);
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const curLine = ta.value.slice(lineStart, lineEnd);
      if (curLine.trim() === '') {
        // an empty line: fill it in instead of adding another line below it
        const prev = ta.value.slice(0, Math.max(0, lineStart - 1));
        const prevLine = prev.slice(prev.lastIndexOf('\n') + 1);
        let indent = prevLine.match(/^ */)[0];
        if (/:\s*$/.test(prevLine)) indent += '    ';
        ins = str.split('\n').map((l) => indent + l).join('\n');
        ta.value = ta.value.slice(0, lineStart) + ins + ta.value.slice(lineEnd);
        const pos = lineStart + ins.length;
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new Event('input'));
        return;
      }
      let indent = curLine.match(/^ */)[0];
      if (/:\s*$/.test(curLine)) indent += '    ';
      ins = '\n' + str.split('\n').map((l) => indent + l).join('\n');
      ta.value = ta.value.slice(0, lineEnd) + ins + ta.value.slice(lineEnd);
      const pos = lineEnd + ins.length;
      ta.setSelectionRange(pos, pos);
    } else {
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e2);
      ta.setSelectionRange(s + ins.length, s + ins.length);
    }
    ta.dispatchEvent(new Event('input'));
  }
  $('lp-snips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]'); if (!b) return;
    ta.focus({ preventScroll: true });
    if (ta.selectionStart === 0 && ta.selectionEnd === 0) ta.setSelectionRange(ta.value.length, ta.value.length);
    insertAt(b.dataset.s.replace(/\\n/g, '\n'), true);
  });

  const player = new MatPlayer($('lp-ed-mat'), { minSpan: 800 });
  const out = $('lp-out');
  let lastRes = null;
  player.onLine = (ln) => { marks.now = ln; renderGutter(); };
  player.onEnd = () => {
    marks.now = 0; renderGutter();
    if (lastRes && lastRes.error) return;
    const fresh = [];
    for (const c of CHALLENGES) if (!done[c.id] && c.test(lastRes, ta.value)) { done[c.id] = true; fresh.push(c.id); }
    if (fresh.length) { store.set('chal', done); renderChal(fresh); out.insertAdjacentHTML('afterbegin', `<div class="lp-msg good">🎉 Challenge done: ${fresh.map((id) => CHALLENGES.find((c) => c.id === id).name).join(', ')}!</div>`); }
  };
  function run() {
    const res = runProgram(ta.value);
    lastRes = res;
    marks = { now: 0, err: res.error ? res.error.line : 0, warn: new Set(res.warnings.map((w) => w.line)) };
    renderGutter();
    const msgs = [];
    if (res.error) msgs.push(`<div class="lp-msg bad"><b>Line ${res.error.line}:</b> ${esc(res.error.msg)}${res.error.hint ? `<br><span>💡 ${esc(res.error.hint)}</span>` : ''}</div>`);
    for (const w of res.warnings) msgs.push(`<div class="lp-msg warn"><b>Line ${w.line}:</b> ${esc(w.msg)}</div>`);
    for (const p of res.prints) msgs.push(`<div class="lp-msg print">print: ${esc(p.text)}</div>`);
    if (!msgs.length) msgs.push('<div class="lp-msg good">✓ No problems. Watch it go!</div>');
    out.innerHTML = msgs.join('');
    player.load(res, true);
  }
  $('lp-run').addEventListener('click', run);
  $('lp-stop').addEventListener('click', () => { player.playing = false; marks.now = 0; renderGutter(); });
  $('lp-reset').addEventListener('click', () => {
    if (ta.value !== STARTER && !confirm('Start over with the example program? Your changes will be erased.')) return;
    ta.value = STARTER; ta.dispatchEvent(new Event('input')); out.innerHTML = '<span class="lp-out-idle">Press ▶ Run to see your program.</span>';
  });
  $('lp-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); $('lp-copy').textContent = 'Copied ✓'; }
    catch { ta.select(); $('lp-copy').textContent = 'Press Ctrl+C'; }
    setTimeout(() => { $('lp-copy').textContent = 'Copy code'; }, 1800);
  });
  renderGutter(); renderChal();
  // for testing from the console: __learn.run() then __learn.skip()
  window.__learn = { run, skip: () => player.skip() };
  player.load(runProgram(ta.value), false);
  return {
    load(kind) {
      const body = kind === 'loop' ? 'for i in range(4):\n    robot.straight(200)\n    robot.turn(90)\n' : 'def square(size):\n    for i in range(4):\n        robot.straight(size)\n        robot.turn(90)\n\nsquare(100)\nsquare(250)\n';
      ta.value = SETUP + body; ta.dispatchEvent(new Event('input'));
      $('lp-step-12').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(run, 500);
    },
  };
}

function step13(ed) {
  const p = new MatPlayer($('lp13-mat'), { minSpan: 520 });
  p.onEnd = () => setTimeout(() => p.load(p.res, true), 1500);
  p.load(runLines('for i in range(4):\n    robot.straight(200)\n    robot.turn(90)\n'), true);
  document.querySelector('[data-load="loop"]').addEventListener('click', () => ed.load('loop'));
}
function step14(ed) {
  const p = new MatPlayer($('lp14-mat'), { minSpan: 560 });
  const slot = $('lp14-slot');
  p.onLine = (ln) => {
    // show which size is in the box right now
    const f = p.frameAt(p.t);
    slot.textContent = f.t < (p.res.split || 0) ? 'size = 100' : 'size = 250';
  };
  const res = runLines('def square(size):\n    for i in range(4):\n        robot.straight(size)\n        robot.turn(90)\n\nsquare(100)\nsquare(250)\n');
  // the first square ends when the robot has turned 360 degrees
  const firstEnd = res.frames.find((f) => f.th >= Math.PI * 2 - 0.01);
  res.split = firstEnd ? firstEnd.t + 0.05 : res.duration / 2;
  p.onEnd = () => setTimeout(() => p.load(res, true), 1500);
  p.load(res, true);
  document.querySelector('[data-load="def"]').addEventListener('click', () => ed.load('def'));
}
