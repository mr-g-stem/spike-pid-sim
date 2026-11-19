// minipy.js: a tiny Python runner for first robot programs.
// It understands the beginner subset of Pybricks used in the Learn tab:
//   imports, hub = PrimeHub(), Motor(Port.X, Direction.Y), DriveBase(...),
//   robot.straight / turn / drive / stop / settings, motor.run_time / run_angle /
//   run / stop, wait(ms), hub.speaker.beep, hub.display.text/number, hub.light.on,
//   print, numbers and simple maths, variables, for i in range(n):, def f(x):.
// It turns the program into a timeline of robot poses for the 2D mat, and gives
// kid-friendly errors with line numbers. It is not a full Python.
//
// Our robot: left wheel motor in port A, right wheel motor in port B,
// 56 mm wheels, 112 mm between the wheels.

export const WHEEL = 56, TRACK = 112;
const MM_PER_DEG = Math.PI * WHEEL / 360;
const DT = 0.02; // timeline step (s)

const KNOWN_IMPORTS = {
  hubs: ['PrimeHub'],
  pupdevices: ['Motor', 'ColorSensor', 'UltrasonicSensor', 'ForceSensor'],
  parameters: ['Port', 'Direction', 'Stop', 'Color', 'Icon', 'Button', 'Axis', 'Side'],
  robotics: ['DriveBase'],
  tools: ['wait', 'StopWatch'],
};
const CONST = {
  Port: ['A', 'B', 'C', 'D', 'E', 'F'],
  Direction: ['CLOCKWISE', 'COUNTERCLOCKWISE'],
  Stop: ['COAST', 'BRAKE', 'HOLD', 'NONE', 'COAST_SMART'],
  Color: ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'VIOLET', 'MAGENTA', 'WHITE', 'GRAY', 'BLACK', 'NONE'],
  Icon: ['UP', 'DOWN', 'LEFT', 'RIGHT', 'HAPPY', 'SAD', 'HEART', 'PAUSE', 'TRUE', 'FALSE', 'CIRCLE', 'SQUARE'],
};
const METHODS = {
  drive: ['straight', 'turn', 'drive', 'stop', 'settings', 'arc', 'distance', 'angle', 'reset', 'use_gyro'],
  motor: ['run_time', 'run_angle', 'run', 'stop', 'brake', 'hold', 'run_target', 'angle', 'reset_angle', 'speed', 'dc'],
};

class KidError extends Error {
  constructor(line, msg, hint) { super(msg); this.line = line; this.hint = hint || ''; }
}

// ---------- helpers
function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function closest(word, options) {
  let best = null, bestD = 99;
  for (const o of options) { const dd = editDistance(word, o); if (dd < bestD) { bestD = dd; best = o; } }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

// split "a, b(c, d), 'x,y'" at top-level commas
function splitArgs(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

// ---------- expressions: numbers, strings, names, + - * / // % ( ), Port.A style constants
function tokenize(src, line) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^[0-9]*\.?[0-9]+(e[+-]?\d+)?/i.exec(src.slice(i)) || /^[0-9]+/.exec(src.slice(i)); toks.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (ch === '"' || ch === "'") {
      const j = src.indexOf(ch, i + 1);
      if (j < 0) throw new KidError(line, 'A piece of text is missing its closing quote.', `Text goes between two quotes, like "Hello".`);
      toks.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*/.exec(src.slice(i)); toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
    if (src.startsWith('//', i)) { toks.push({ t: 'op', v: '//' }); i += 2; continue; }
    if ('+-*/%()'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
    throw new KidError(line, `I don't understand the symbol "${ch}" here.`);
  }
  return toks;
}

function evalExpr(src, scope, line) {
  const toks = tokenize(src, line);
  let p = 0;
  const peek = () => toks[p];
  function primary() {
    const tk = toks[p++];
    if (!tk) throw new KidError(line, 'Something is missing here.', 'Check that every ( has a ) and that there is a number.');
    if (tk.t === 'num' || tk.t === 'str') return tk.v;
    if (tk.t === 'op' && tk.v === '(') { const v = sum(); if (!peek() || peek().v !== ')') throw new KidError(line, 'A ( is missing its ).'); p++; return v; }
    if (tk.t === 'op' && tk.v === '-') return -primary();
    if (tk.t === 'op' && tk.v === '+') return +primary();
    if (tk.t === 'name') {
      if (peek() && peek().v === '(') throw new KidError(line, `You can't use ${tk.v}(...) inside a number here.`, 'Put it on its own line.');
      return lookup(tk.v, scope, line);
    }
    throw new KidError(line, `"${tk.v}" is in a strange place.`);
  }
  function product() {
    let v = primary();
    while (peek() && ['*', '/', '//', '%'].includes(peek().v)) {
      const op = toks[p++].v; const r = primary();
      if (typeof v !== 'number' || typeof r !== 'number') throw new KidError(line, 'You can only multiply or divide numbers.');
      if ((op === '/' || op === '//' || op === '%') && r === 0) throw new KidError(line, 'You divided by zero. Robots can\'t do that either!');
      v = op === '*' ? v * r : op === '/' ? v / r : op === '//' ? Math.floor(v / r) : v % r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = toks[p++].v; const r = product();
      if (op === '+' && (typeof v === 'string' || typeof r === 'string')) v = String(v) + String(r);
      else if (typeof v !== 'number' || typeof r !== 'number') throw new KidError(line, 'You can only add or subtract numbers.');
      else v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  if (p < toks.length) throw new KidError(line, `I didn't expect "${toks[p].v}" there.`, 'Is a comma or a ) missing?');
  return v;
}

function lookup(name, scope, line) {
  if (name.includes('.')) {
    const [base, member, extra] = name.split('.');
    if (CONST[base] && !extra) {
      if (!scope.has(base)) throw new KidError(line, `You used ${base} but didn't import it.`, `Add it to this line at the top: from pybricks.parameters import ${base}`);
      if (!CONST[base].includes(member)) {
        const c = closest(member, CONST[base]);
        throw new KidError(line, `There is no ${base}.${member}.`, base === 'Port' ? 'Ports are A to F, like Port.A.' : c ? `Did you mean ${base}.${c}?` : '');
      }
      return { const: base, v: member };
    }
  }
  if (scope.has(name)) return scope.get(name);
  const known = scope.names();
  const c = closest(name, known);
  if (c && c.toLowerCase() === name.toLowerCase()) throw new KidError(line, `I don't know "${name}".`, `Python cares about capital letters. You named it ${c}.`);
  throw new KidError(line, `I don't know "${name}".`, c ? `Did you mean ${c}?` : 'Did you make it on an earlier line, like robot = DriveBase(...)?');
}

class Scope {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }
  has(n) { return this.vars.has(n) || (this.parent ? this.parent.has(n) : false); }
  get(n) { return this.vars.has(n) ? this.vars.get(n) : this.parent.get(n); }
  set(n, v) { this.vars.set(n, v); }
  names() { return [...this.vars.keys(), ...(this.parent ? this.parent.names() : [])]; }
}

// ---------- parse into blocks by indentation
function parseLines(source) {
  const raw = source.replace(/\t/g, '    ').split(/\r?\n/);
  const lines = [];
  raw.forEach((text, i) => {
    const code = stripComment(text).replace(/\s+$/, '');
    if (!code.trim()) return;
    const indent = code.length - code.trimStart().length;
    lines.push({ n: i + 1, indent, code: code.trim() });
  });
  return lines;
}

function buildBlocks(lines) {
  let i = 0;
  function block(indent) {
    const out = [];
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) throw new KidError(ln.n, 'This line is pushed in (indented), but it is not inside a for or def.', 'Move it all the way to the left, or put a for/def line with a : above it.');
      i++;
      const opens = /:\s*$/.test(ln.code);
      if (/^(for|def|while|if|elif|else)\b/.test(ln.code) && !opens) {
        throw new KidError(ln.n, `A ${ln.code.split(/\s|\(/)[0]} line must end with a colon :`, 'Add : at the end of the line.');
      }
      if (opens) {
        const next = lines[i];
        if (!next || next.indent <= indent) throw new KidError(ln.n, 'The lines that belong to this one need to be pushed in (indented) under it.', 'Add 4 spaces at the start of each line inside.');
        const childIndent = next.indent;
        out.push({ ...ln, body: block(childIndent) });
      } else {
        out.push(ln);
      }
    }
    return out;
  }
  const top = block(0);
  if (i < lines.length) throw new KidError(lines[i].n, 'The spaces at the start of this line don\'t match the lines above.', 'Line it up with the other lines in the same group.');
  return top;
}

// ---------- the robot model the program drives
function makeWorld() {
  return {
    t: 0,
    x: 0, y: 0, th: 0,          // mm, heading in radians clockwise from "up"
    vL: 0, vR: 0,               // continuous wheel speeds from run()/drive() (mm/s)
    aL: 0, aR: 0,               // wheel angles for drawing (deg)
    arms: {},                   // other ports: motor angle (deg)
    armV: {},                   // continuous arm speeds (deg/s)
    frames: [],
    events: [],                 // beeps, displays, prints, lights, warnings
    light: 'GREEN', display: '',
    line: 0,
  };
}

// trapezoid speed profile: distance d at top speed v with acceleration a -> position at time t
function profile(d, v, a) {
  const D = Math.abs(d), sgn = Math.sign(d) || 1;
  const tAcc = v / a, dAcc = 0.5 * a * tAcc * tAcc;
  let T, at;
  if (2 * dAcc >= D) {
    const tp = Math.sqrt(D / a); T = 2 * tp;
    at = (t) => (t < tp ? 0.5 * a * t * t : D - 0.5 * a * (T - t) * (T - t));
  } else {
    T = 2 * tAcc + (D - 2 * dAcc) / v;
    at = (t) => (t < tAcc ? 0.5 * a * t * t : t < T - tAcc ? dAcc + v * (t - tAcc) : D - 0.5 * a * (T - t) * (T - t));
  }
  return { T, at: (t) => sgn * at(Math.max(0, Math.min(T, t))) };
}

// move the wheels: left and right travel (mm) given as functions of time over T seconds,
// while any run() speeds keep going
function moveWheels(w, T, fL, fR, armFn) {
  const steps = Math.max(1, Math.ceil(T / DT));
  let pL = 0, pR = 0;
  const startArms = { ...w.arms };
  for (let k = 1; k <= steps; k++) {
    const t = Math.min(T, k * DT), dt = t - (k - 1) * DT;
    const nL = fL ? fL(t) : 0, nR = fR ? fR(t) : 0;
    let dL = nL - pL + w.vL * dt, dR = nR - pR + w.vR * dt;
    pL = nL; pR = nR;
    integrate(w, dL, dR);
    for (const port in w.armV) w.arms[port] = (w.arms[port] || 0) + w.armV[port] * dt;
    if (armFn) armFn(t, startArms);
    w.t += dt;
    snapshot(w);
  }
}

function integrate(w, dL, dR) {
  // turning: left wheel further than right -> turns right (clockwise)
  const dTh = (dL - dR) / TRACK;
  const ds = (dL + dR) / 2;
  const mid = w.th + dTh / 2;
  w.x += ds * Math.sin(mid);
  w.y += ds * Math.cos(mid);
  w.th += dTh;
  w.aL += dL / MM_PER_DEG;
  w.aR += dR / MM_PER_DEG;
}

function snapshot(w) {
  w.frames.push({ t: w.t, x: w.x, y: w.y, th: w.th, aL: w.aL, aR: w.aR, line: w.line, arms: { ...w.arms }, light: w.light, display: w.display });
}

// ---------- the interpreter
export function runProgram(source, opts = {}) {
  const maxSteps = opts.maxSteps || 4000;
  const w = makeWorld();
  snapshot(w);
  const out = { frames: w.frames, events: w.events, error: null, warnings: [], prints: [], summary: { straights: 0, turns: 0, turned: 0, maxDist: 0, usedFor: false, usedDef: false, defWithParam: false, calledDef: false } };
  const global = new Scope();
  let steps = 0;
  const warned = new Set();
  const warn = (line, msg) => { const k = line + msg; if (!warned.has(k)) { warned.add(k); out.warnings.push({ line, msg }); w.events.push({ t: w.t, type: 'warn', line, msg }); } };
  const speeds = { straight: 200, turn: 150, acc: 750, tacc: 750 };

  function construct(name, args, line, scope) {
    if (name === 'PrimeHub') {
      if (!scope.has('PrimeHub')) throw new KidError(line, 'You used PrimeHub but didn\'t import it.', 'Add at the top: from pybricks.hubs import PrimeHub');
      return { kind: 'hub' };
    }
    if (name === 'Motor') {
      if (!scope.has('Motor')) throw new KidError(line, 'You used Motor but didn\'t import it.', 'Add at the top: from pybricks.pupdevices import Motor');
      const { pos, kw } = args;
      const port = pos[0] !== undefined ? evalExpr(pos[0], scope, line) : kw.port !== undefined ? evalExpr(kw.port, scope, line) : null;
      if (!port || port.const !== 'Port') throw new KidError(line, 'A Motor needs to know its port.', 'Like this: Motor(Port.A)');
      const dirSrc = pos[1] !== undefined ? pos[1] : kw.positive_direction;
      let dir = 'CLOCKWISE';
      if (dirSrc !== undefined) { const d = evalExpr(dirSrc, scope, line); if (!d || d.const !== 'Direction') throw new KidError(line, 'The second thing in Motor( ) should be a Direction.', 'Like this: Motor(Port.A, Direction.COUNTERCLOCKWISE)'); dir = d.v; }
      // our robot: port A = left wheel (mirrored), port B = right wheel
      const side = port.v === 'A' ? 'L' : port.v === 'B' ? 'R' : null;
      const fwd = side === 'L' ? (dir === 'COUNTERCLOCKWISE' ? 1 : -1) : side === 'R' ? (dir === 'CLOCKWISE' ? 1 : -1) : (dir === 'CLOCKWISE' ? 1 : -1);
      return { kind: 'motor', port: port.v, dir, side, fwd };
    }
    if (name === 'DriveBase') {
      if (!scope.has('DriveBase')) throw new KidError(line, 'You used DriveBase but didn\'t import it.', 'Add at the top: from pybricks.robotics import DriveBase');
      const { pos, kw } = args;
      const get = (i, key) => (pos[i] !== undefined ? evalExpr(pos[i], scope, line) : kw[key] !== undefined ? evalExpr(kw[key], scope, line) : undefined);
      const L = get(0, 'left_motor'), R = get(1, 'right_motor');
      const wd = get(2, 'wheel_diameter'), at = get(3, 'axle_track');
      if (!L || L.kind !== 'motor' || !R || R.kind !== 'motor') throw new KidError(line, 'DriveBase needs your two wheel motors first.', 'Like this: DriveBase(left, right, wheel_diameter=56, axle_track=112)');
      if (typeof wd !== 'number' || typeof at !== 'number') throw new KidError(line, 'DriveBase needs the wheel size and the space between the wheels.', 'Add: wheel_diameter=56, axle_track=112');
      if (L === R) throw new KidError(line, 'You gave DriveBase the same motor twice.', 'Use the left motor and then the right motor.');
      if (L.side !== 'L' || R.side !== 'R') warn(line, 'On our robot the left wheel motor is in port A and the right one is in port B. Check your ports.');
      if (wd < 20 || wd > 200 || at < 40 || at > 400) warn(line, 'Those sizes look unusual. Our robot has wheel_diameter=56 and axle_track=112 (millimeters).');
      return { kind: 'drive', L, R, wd, at };
    }
    throw new KidError(line, `I don't know how to make a ${name}.`);
  }

  function parseCall(text) {
    const m = /^([A-Za-z_][\w.]*)\s*\(([\s\S]*)\)$/.exec(text);
    if (!m) return null;
    const parts = splitArgs(m[2]);
    const pos = [], kw = {};
    for (const a of parts) {
      const km = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(a);
      if (km) kw[km[1]] = km[2]; else pos.push(a);
    }
    return { name: m[1], pos, kw };
  }

  function num(src, scope, line, what) {
    if (src === undefined) throw new KidError(line, `This needs a number for the ${what}.`);
    const v = evalExpr(src, scope, line);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new KidError(line, `The ${what} should be a number.`);
    return v;
  }

  // which wheel travel functions does a drive base command make?
  function driveWheels(db, dL, dR, T, line) {
    // a real DriveBase spins the motors; how the wheels roll depends on the motor directions
    const sL = db.L.fwd, sR = db.R.fwd;
    if (sL < 0 || sR < 0) warn(line, sL < 0 ? 'The robot spun around instead of driving straight! The left motor is flipped on this robot, so it needs: left = Motor(Port.A, Direction.COUNTERCLOCKWISE)' : 'The robot spun around! The right motor should not be reversed: right = Motor(Port.B)');
    const scale = WHEEL / db.wd; // if the program's wheel size is wrong, distances come out wrong
    return [(t) => dL.at(t) * sL * scale, (t) => dR.at(t) * sR * scale, T];
  }

  function callMethod(obj, objName, method, args, line, scope) {
    const { pos, kw } = args;
    if (obj.kind === 'drive') {
      if (!METHODS.drive.includes(method)) {
        const c = closest(method, METHODS.drive);
        throw new KidError(line, `A DriveBase doesn't know "${method}".`, c ? `Did you mean ${objName}.${c}( )?` : 'Try straight( ) or turn( ).');
      }
      if (method === 'straight') {
        const d = num(pos[0] ?? kw.distance, scope, line, 'distance in millimeters');
        if (d !== 0 && Math.abs(d) < 50) warn(line, `straight(${d}) is only ${(Math.abs(d) / 10).toFixed(1)} cm. Distances are in millimeters: 10 mm = 1 cm. Did you mean ${d * 10}?`);
        const pf = profile(d, speeds.straight, speeds.acc);
        const [fL, fR, T] = driveWheels(obj, pf, pf, pf.T, line);
        moveWheels(w, T, fL, fR);
        out.summary.straights++;
        return;
      }
      if (method === 'turn') {
        const a = num(pos[0] ?? kw.angle, scope, line, 'angle in degrees');
        const travel = a * Math.PI * obj.at / 360; // each wheel's distance for this turn
        const pfA = profile(a, speeds.turn, speeds.tacc);
        const fl = { at: (t) => (pfA.at(t) / (a || 1)) * travel };
        const fr = { at: (t) => -(pfA.at(t) / (a || 1)) * travel };
        const [fL, fR, T] = driveWheels(obj, fl, fr, pfA.T, line);
        moveWheels(w, T, fL, fR);
        out.summary.turns++; out.summary.turned += a;
        return;
      }
      if (method === 'drive') {
        const sp = num(pos[0] ?? kw.speed, scope, line, 'speed (mm/s)');
        const tr = num(pos[1] ?? kw.turn_rate, scope, line, 'turn rate (degrees per second)');
        const diff = tr * Math.PI * obj.at / 360;
        w.vL = (sp + diff) * obj.L.fwd * WHEEL / obj.wd; w.vR = (sp - diff) * obj.R.fwd * WHEEL / obj.wd;
        if (sp !== 0 || tr !== 0) warn(line, 'drive( ) keeps going until you call stop( ). Put a wait( ) after it.');
        return;
      }
      if (method === 'stop') { w.vL = 0; w.vR = 0; return; }
      if (method === 'settings') {
        if (pos[0] !== undefined || kw.straight_speed !== undefined) speeds.straight = Math.max(10, Math.abs(num(pos[0] ?? kw.straight_speed, scope, line, 'straight speed')));
        if (pos[1] !== undefined || kw.straight_acceleration !== undefined) speeds.acc = Math.max(50, Math.abs(num(pos[1] ?? kw.straight_acceleration, scope, line, 'acceleration')));
        if (pos[2] !== undefined || kw.turn_rate !== undefined) speeds.turn = Math.max(10, Math.abs(num(pos[2] ?? kw.turn_rate, scope, line, 'turn rate')));
        if (pos[3] !== undefined || kw.turn_acceleration !== undefined) speeds.tacc = Math.max(50, Math.abs(num(pos[3] ?? kw.turn_acceleration, scope, line, 'turn acceleration')));
        return;
      }
      if (method === 'arc') throw new KidError(line, 'arc( ) is real Pybricks, but this practice robot only knows straight( ) and turn( ).', 'Try a few small straight and turn steps instead.');
      return; // distance(), angle(), reset(), use_gyro(): fine, nothing to show
    }
    if (obj.kind === 'motor') {
      if (!METHODS.motor.includes(method)) {
        const c = closest(method, METHODS.motor);
        throw new KidError(line, `A Motor doesn't know "${method}".`, c ? `Did you mean ${objName}.${c}( )?` : 'Try run_time( ) or run_angle( ).');
      }
      const wheel = obj.side; // 'L', 'R' or null (an arm motor on C-F)
      const spin = (degFn, T) => {
        if (wheel === 'L') moveWheels(w, T, (t) => degFn(t) * MM_PER_DEG * obj.fwd, null);
        else if (wheel === 'R') moveWheels(w, T, null, (t) => degFn(t) * MM_PER_DEG * obj.fwd);
        else moveWheels(w, T, null, null, (t, start) => { w.arms[obj.port] = (start[obj.port] || 0) + degFn(t) * (obj.dir === 'CLOCKWISE' ? 1 : -1); });
      };
      if (method === 'run_time') {
        const sp = num(pos[0] ?? kw.speed, scope, line, 'speed (degrees per second)');
        const ms = num(pos[1] ?? kw.time, scope, line, 'time in milliseconds');
        if (ms > 0 && ms < 50) warn(line, `run_time time is in milliseconds: ${ms} ms is a tiny blink. 1000 = 1 second.`);
        if (Math.abs(sp) > 1100) warn(line, 'That is faster than a SPIKE motor can go (about 1000 degrees per second).');
        const v = Math.max(-1100, Math.min(1100, sp));
        spin((t) => v * t, Math.max(0, ms) / 1000);
        return;
      }
      if (method === 'run_angle') {
        const sp = num(pos[0] ?? kw.speed, scope, line, 'speed (degrees per second)');
        const ang = num(pos[1] ?? kw.rotation_angle, scope, line, 'angle in degrees');
        if (sp === 0) throw new KidError(line, 'A speed of 0 never gets there.', 'Use a speed like 500.');
        if (sp < 0) warn(line, 'Keep the speed positive in run_angle. To go the other way, make the angle negative.');
        const v = Math.min(1100, Math.abs(sp)), dirn = Math.sign(sp) * Math.sign(ang) || 0;
        const T = Math.abs(ang) / v;
        spin((t) => dirn * Math.min(Math.abs(ang), v * t), T);
        return;
      }
      if (method === 'run') {
        const sp = num(pos[0] ?? kw.speed, scope, line, 'speed (degrees per second)');
        if (wheel === 'L') w.vL = sp * MM_PER_DEG * obj.fwd;
        else if (wheel === 'R') w.vR = sp * MM_PER_DEG * obj.fwd;
        else w.armV[obj.port] = sp * (obj.dir === 'CLOCKWISE' ? 1 : -1);
        if (sp !== 0) warn(line, 'run( ) keeps the motor going until you stop it. Put a wait( ) and then .stop( ) after it.');
        return;
      }
      if (method === 'stop' || method === 'brake' || method === 'hold') {
        if (wheel === 'L') w.vL = 0; else if (wheel === 'R') w.vR = 0; else delete w.armV[obj.port];
        return;
      }
      if (method === 'run_target') throw new KidError(line, 'run_target( ) is real Pybricks, but this practice page uses run_angle( ).', 'Try run_angle(500, 90).');
      return;
    }
    if (obj.kind === 'hub') {
      throw new KidError(line, `The hub doesn't have "${method}".`, 'Try hub.speaker.beep( ), hub.display.text("Hi") or hub.light.on(Color.RED).');
    }
    throw new KidError(line, `${objName} is a number or text, so it can't do .${method}( ).`);
  }

  function hubCall(path, args, line, scope) {
    const { pos, kw } = args;
    const [, part, method] = path; // hub.speaker.beep
    if (part === 'speaker' && method === 'beep') {
      const f = pos[0] !== undefined || kw.frequency !== undefined ? num(pos[0] ?? kw.frequency, scope, line, 'pitch') : 500;
      const d = pos[1] !== undefined || kw.duration !== undefined ? num(pos[1] ?? kw.duration, scope, line, 'length in milliseconds') : 100;
      w.events.push({ t: w.t, type: 'beep', freq: f, dur: Math.max(0, d), line });
      moveWheels(w, Math.max(0, d) / 1000, null, null);
      return;
    }
    if (part === 'display' && (method === 'text' || method === 'number' || method === 'char')) {
      const v = evalExpr(pos[0] ?? '""', scope, line);
      const s = method === 'number' ? (Math.abs(v) > 99 ? (v > 0 ? '>' : '<') : String(Math.round(v))) : String(v);
      w.display = s;
      w.events.push({ t: w.t, type: 'display', text: s, line });
      if (method === 'text') moveWheels(w, Math.min(6, s.length * 0.55), null, null); // text scrolls one letter at a time
      else snapshot(w);
      return;
    }
    if (part === 'display' && method === 'off') { w.display = ''; snapshot(w); return; }
    if (part === 'display' && method === 'icon') { w.display = '♥'; snapshot(w); return; }
    if (part === 'light' && method === 'on') {
      const c = evalExpr(pos[0] ?? '', scope, line);
      if (!c || c.const !== 'Color') throw new KidError(line, 'light.on( ) needs a Color.', 'Like this: hub.light.on(Color.RED)');
      w.light = c.v; w.events.push({ t: w.t, type: 'light', color: c.v, line }); snapshot(w);
      return;
    }
    if (part === 'light' && method === 'off') { w.light = 'NONE'; snapshot(w); return; }
    throw new KidError(line, `The hub doesn't have ${path.slice(1).join('.')}( ).`, 'Try hub.speaker.beep( ), hub.display.text("Hi") or hub.light.on(Color.RED).');
  }

  function exec(stmts, scope, depth) {
    if (depth > 20) throw new KidError(w.line, 'Your functions call each other too many times.', 'A function might be calling itself forever.');
    for (const st of stmts) {
      if (++steps > maxSteps) throw new KidError(st.n, 'Your program has too many steps for this practice robot.', 'Use smaller numbers in range( ).');
      if (w.t > 600) throw new KidError(st.n, 'Your program runs for more than 10 minutes!', 'Use smaller numbers.');
      w.line = st.n;
      const code = st.code;
      let m;
      // imports
      if ((m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(code))) {
        const mod = m[1];
        const sub = mod.startsWith('pybricks.') ? mod.slice(9) : null;
        if (!sub || !KNOWN_IMPORTS[sub]) {
          const c = closest(mod, Object.keys(KNOWN_IMPORTS).map((k) => 'pybricks.' + k));
          throw new KidError(st.n, `There is no module called ${mod}.`, c ? `Did you mean ${c}?` : 'Robot tools come from pybricks, like: from pybricks.hubs import PrimeHub');
        }
        for (const name of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (name === '*') { KNOWN_IMPORTS[sub].forEach((n) => global.set(n, { kind: 'import', name: n })); continue; }
          if (!KNOWN_IMPORTS[sub].includes(name)) {
            const where = Object.keys(KNOWN_IMPORTS).find((k) => KNOWN_IMPORTS[k].includes(name));
            const c = closest(name, KNOWN_IMPORTS[sub]);
            throw new KidError(st.n, `pybricks.${sub} doesn't have ${name}.`, where ? `${name} comes from pybricks.${where}.` : c ? `Did you mean ${c}?` : '');
          }
          global.set(name, { kind: 'import', name });
        }
        continue;
      }
      if (/^import\s+/.test(code)) continue;
      if (code === 'pass') continue;
      // for loop
      if ((m = /^for\s+([A-Za-z_]\w*)\s+in\s+range\s*\((.*)\)\s*:$/.exec(code))) {
        const a = splitArgs(m[2]).map((s) => num(s, scope, st.n, 'count'));
        const [start, stop, step] = a.length === 1 ? [0, a[0], 1] : a.length === 2 ? [a[0], a[1], 1] : a;
        if (!step) throw new KidError(st.n, 'range( ) can\'t count by 0.');
        out.summary.usedFor = true;
        for (let k = start; step > 0 ? k < stop : k > stop; k += step) {
          scope.set(m[1], k);
          exec(st.body, scope, depth);
        }
        continue;
      }
      if (/^for\b/.test(code)) throw new KidError(st.n, 'A for line looks like this: for i in range(4):', 'range(4) means "do it 4 times".');
      if (/^while\b/.test(code)) throw new KidError(st.n, 'This practice robot doesn\'t run while loops, because they can go on forever.', 'Use for i in range(4): instead.');
      if (/^(if|elif|else)\b/.test(code)) throw new KidError(st.n, 'This practice page doesn\'t do if yet.', 'You can still use it on the real robot!');
      // define a function
      if ((m = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:$/.exec(code))) {
        const params = m[2].split(',').map((s) => s.trim()).filter(Boolean);
        for (const p of params) if (!/^[A-Za-z_]\w*$/.test(p)) throw new KidError(st.n, `"${p}" can't be a parameter name.`, 'Use a simple name like size or steps.');
        scope.set(m[1], { kind: 'func', name: m[1], params, body: st.body, line: st.n });
        out.summary.usedDef = true;
        if (params.length) out.summary.defWithParam = true;
        continue;
      }
      if (/^def\b/.test(code)) throw new KidError(st.n, 'A def line looks like this: def square(size):');
      // assignment
      if ((m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(code))) {
        const rhs = m[2];
        const call = parseCall(rhs);
        let val;
        if (call && ['PrimeHub', 'Motor', 'DriveBase'].includes(call.name)) val = construct(call.name, call, st.n, scope);
        else if (call && !call.name.includes('.') && scope.has(call.name) && scope.get(call.name).kind === 'func') throw new KidError(st.n, 'This practice page can\'t store what a function gives back yet.', 'Call the function on its own line.');
        else if (call && call.name.split('.').length >= 2) throw new KidError(st.n, 'This practice page can\'t store what a robot command gives back yet.', 'Call it on its own line, like robot.straight(200).');
        else val = evalExpr(rhs, scope, st.n);
        if (['PrimeHub', 'Motor', 'DriveBase', 'wait', 'print', 'range'].includes(m[1])) throw new KidError(st.n, `${m[1]} is already a Python/Pybricks name. Pick another name.`, 'Like robot, left, hub or size.');
        scope.set(m[1], val);
        continue;
      }
      // calls
      const call = parseCall(code);
      if (!call) {
        if (/^[A-Za-z_][\w.]*\s+[-\d(]/.test(code)) throw new KidError(st.n, 'The numbers need to go inside ( ).', `Like this: ${code.replace(/^([A-Za-z_][\w.]*)\s+(.*)$/, '$1($2)')}`);
        if (/^[A-Za-z_][\w.]*$/.test(code)) throw new KidError(st.n, `To make ${code} happen, add ( ) at the end.`, `Like this: ${code}( )`);
        if (/\($/.test(code) || (code.split('(').length !== code.split(')').length)) throw new KidError(st.n, 'Every ( needs a ) to close it.');
        throw new KidError(st.n, 'I don\'t understand this line.', 'Check the spelling, the dots and the ( ).');
      }
      const parts = call.name.split('.');
      if (parts.length === 1) {
        const fname = parts[0];
        if (fname === 'wait') {
          if (!scope.has('wait')) throw new KidError(st.n, 'You used wait but didn\'t import it.', 'Add at the top: from pybricks.tools import wait');
          const ms = num(call.pos[0] ?? call.kw.time, scope, st.n, 'time in milliseconds');
          if (ms > 0 && ms < 50) warn(st.n, `wait(${ms}) is only ${ms} milliseconds. 1000 = 1 second.`);
          moveWheels(w, Math.max(0, ms) / 1000, null, null);
          continue;
        }
        if (fname === 'print') {
          const text = call.pos.map((a) => String(evalExpr(a, scope, st.n))).join(' ');
          out.prints.push({ line: st.n, text }); w.events.push({ t: w.t, type: 'print', text, line: st.n });
          continue;
        }
        if (['PrimeHub', 'Motor', 'DriveBase'].includes(fname)) throw new KidError(st.n, `Give your ${fname} a name, like: ${fname === 'Motor' ? 'left' : fname === 'DriveBase' ? 'robot' : 'hub'} = ${code}`);
        if (!scope.has(fname)) {
          const names = [...scope.names(), 'wait', 'print'];
          const c = closest(fname, names);
          throw new KidError(st.n, `I don't know "${fname}".`, c ? `Did you mean ${c}?` : 'Did you write def ' + fname + '(...): above it?');
        }
        const fn = scope.get(fname);
        if (fn.kind !== 'func') throw new KidError(st.n, `${fname} isn't something you can call with ( ).`);
        if (call.pos.length !== fn.params.length) {
          throw new KidError(st.n, `${fname} needs ${fn.params.length} ${fn.params.length === 1 ? 'number' : 'numbers'} in the ( ), but you gave ${call.pos.length}.`, fn.params.length ? `It was made as: def ${fname}(${fn.params.join(', ')}):` : `Use ${fname}( ) with nothing inside.`);
        }
        const local = new Scope(global);
        fn.params.forEach((p, i) => local.set(p, evalExpr(call.pos[i], scope, st.n)));
        out.summary.calledDef = true;
        const callLine = st.n;
        exec(fn.body, local, depth + 1);
        w.line = callLine;
        continue;
      }
      const base = parts[0];
      if (!scope.has(base)) lookup(base, scope, st.n); // throws a helpful error
      const obj = scope.get(base);
      if (obj && obj.kind === 'hub') { hubCall(parts, call, st.n, scope); continue; }
      if (parts.length > 2) throw new KidError(st.n, `I don't understand ${call.name}( ).`);
      if (!obj || typeof obj !== 'object' || !obj.kind) throw new KidError(st.n, `${base} is a number or text, so it can't do .${parts[1]}( ).`);
      callMethod(obj, base, parts[1], call, st.n, scope);
    }
  }

  try {
    const lines = parseLines(source);
    const blocks = buildBlocks(lines);
    exec(blocks, global, 0);
  } catch (e) {
    if (e instanceof KidError) out.error = { line: e.line, msg: e.message, hint: e.hint };
    else out.error = { line: w.line, msg: 'Something went wrong running this line.', hint: String(e && e.message || e) };
  }
  // keep a short still moment at the end
  moveWheels(w, 0.3, null, null);
  for (const f of w.frames) out.summary.maxDist = Math.max(out.summary.maxDist, Math.hypot(f.x, f.y));
  const last = w.frames[w.frames.length - 1];
  out.final = { x: last.x, y: last.y, th: last.th };
  out.duration = last.t;
  return out;
}

// the starter program every student begins with
export const STARTER = `from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Direction, Port
from pybricks.robotics import DriveBase
from pybricks.tools import wait

hub = PrimeHub()
left = Motor(Port.A, Direction.COUNTERCLOCKWISE)
right = Motor(Port.B)
robot = DriveBase(left, right, wheel_diameter=56, axle_track=112)

# your moves go here
robot.straight(300)
robot.turn(90)
robot.straight(200)
hub.speaker.beep()
`;

// the setup lines most snippets need before they can run
export const SETUP = STARTER.split('# your moves go here')[0];
