// physics.js: a SPIKE Prime driving base, its motors, its gyro, and the
// student's P + F drive loop, simulated ahead of time so playback can be
// scrubbed. Units: mm, seconds, degrees, motor power in % (Pybricks dc()).
//
// World frame: x runs down the lane (start line at x = 0), y is to the
// robot's LEFT, th is the math angle (counterclockwise +). The gyro reports
// Pybricks-style heading: CLOCKWISE positive, so heading = -th in degrees.

export const ROBOT = {
  wheelDiameter: 56,   // mm, SPIKE Prime 56 mm wheel (Pybricks example value)
  axleTrack: 112,      // mm between wheel centres (Pybricks example value)
  maxDegPerSec: 950,   // wheel speed at 100% power with the robot's weight on it
  deadband: 6,         // % power needed before the wheel starts to turn
  tau: 0.25,           // s, how quickly a wheel (and the robot's weight) reaches a new speed
  tauBrake: 0.05,      // s, passive brake()
  turnLag: 0.015,      // s, gyro + motor driver delay before a correction shows up
  casterX: -72,        // mm behind the axle
};

export const MM_PER_DEG = (Math.PI * ROBOT.wheelDiameter) / 360; // 0.4887 mm per wheel degree

export const DEFAULTS = {
  kf: 0.20,        // % power per mm/s of target speed
  kp: 0,           // % power per degree of heading error
  ki: 0,
  kd: 0,
  splitF: false,   // separate F for each motor
  kfL: 0.20,
  kfR: 0.20,
  speed: 200,      // mm/s target
  distance: 1500,  // mm between the two lines
  trips: 2,        // round trips (out and back = 1)
  loopMs: 10,      // wait(10) in the loop
  weakSide: 'left',
  weakPct: 2,      // % weaker
  bumps: true,
  noise: true,
  seed: 7,
  pauseS: 0.5,     // wait(500) at each line
};

// Mat bumps: fixed spots on the mat, so every run meets the same bumps and
// runs can be compared fairly. side: +1 = under the left wheel, -1 = right.
export function makeBumps(cfg) {
  if (!cfg.bumps) return [];
  const rnd = mulberry32(cfg.seed * 7919 + 13);
  const n = 3;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = cfg.distance * (0.22 + 0.56 * (i / (n - 1))) + (rnd() - 0.5) * 120;
    const side = rnd() < 0.5 ? 1 : -1;
    const kick = 1.6 + rnd() * 1.4; // degrees of sudden turn
    out.push({ x: Math.round(x), side, kick });
  }
  return out;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Steady wheel speed (deg/s) for a given dc() power, before the motor lag.
function steadySpeed(dc, strength) {
  const mag = Math.max(0, Math.abs(dc) - ROBOT.deadband) / (100 - ROBOT.deadband);
  return Math.sign(dc) * mag * ROBOT.maxDegPerSec * strength;
}

// The perfect robot: drives the same legs at exactly the target speed and
// never turns. Used for the see-through "perfect robot" in the 3D view.
export function ghostSchedule(cfg) {
  const A = 900; // mm/s^2
  const v = cfg.speed;
  const D = cfg.distance;
  const tAcc = v / A;
  const dAcc = 0.5 * A * tAcc * tAcc;
  let legT;
  if (2 * dAcc >= D) {
    legT = 2 * Math.sqrt(D / A);
  } else {
    legT = 2 * tAcc + (D - 2 * dAcc) / v;
  }
  const legs = cfg.trips * 2;
  const period = legT + cfg.pauseS;
  const total = legs * period;
  function posInLeg(s) {
    if (2 * dAcc >= D) {
      const h = legT / 2;
      return s < h ? 0.5 * A * s * s : D - 0.5 * A * (legT - s) * (legT - s);
    }
    if (s < tAcc) return 0.5 * A * s * s;
    if (s < legT - tAcc) return dAcc + v * (s - tAcc);
    const r = legT - s;
    return D - 0.5 * A * r * r;
  }
  return {
    total,
    legT,
    at(t) {
      if (t >= total) return { x: 0, moving: false, leg: legs - 1 };
      const leg = Math.floor(t / period);
      const s = t - leg * period;
      const fwd = leg % 2 === 0;
      if (s >= legT) return { x: fwd ? D : 0, moving: false, leg };
      const p = posInLeg(s);
      return { x: fwd ? p : D - p, moving: true, leg };
    },
  };
}

// Run the whole drive ahead of time. Returns frames every control tick.
export function simulate(userCfg = {}) {
  const cfg = { ...DEFAULTS, ...userCfg };
  const rnd = mulberry32(cfg.seed);
  const noiseRnd = mulberry32(cfg.seed * 31 + 5);
  const bumps = makeBumps(cfg);
  const bumpHit = bumps.map(() => ({ lastSide: null }));

  const strengthL = cfg.weakSide === 'left' ? 1 - cfg.weakPct / 100 : 1;
  const strengthR = cfg.weakSide === 'right' ? 1 - cfg.weakPct / 100 : 1;
  const kfL = cfg.splitF ? cfg.kfL : cfg.kf;
  const kfR = cfg.splitF ? cfg.kfR : cfg.kf;

  const dt = 0.001;
  const loopS = cfg.loopMs / 1000;
  const targetDeg = cfg.distance / MM_PER_DEG;
  const legs = cfg.trips * 2;
  const r = ROBOT.wheelDiameter / 2;

  // State
  let t = 0, x = 0, y = 0, th = 0;
  let wL = 0, wR = 0;       // wheel speeds, deg/s (forward +)
  let aL = 0, aR = 0;       // wheel angles, deg
  let dcL = 0, dcR = 0;
  let brake = false;
  let leg = 0;
  let phase = 'drive';      // 'drive' | 'pause' | 'done'
  let pauseUntil = 0;
  let legStart = 0;
  let iSum = 0, prevErr = null;
  let bumpKick = 0, bumpUntil = 0; // rad/s extra turn while on a bump
  let lastCtrl = -Infinity;
  let heading = 0, err = 0, pTerm = 0, iTerm = 0, dTerm = 0, base = 0, baseL = 0, baseR = 0;
  let endReason = 'finished';
  const events = [];
  const frames = [];
  let nextFrame = 0;
  const frameEvery = 0.01; // record every 10 ms of sim time
  let stillSince = null;
  const maxT = 400;

  // the gyro and motor drivers answer a moment late: keep a short history of th
  const lagSteps = Math.max(0, Math.round(ROBOT.turnLag / dt));
  const thHist = new Float64Array(lagSteps + 1);
  let histI = 0;
  const readGyro = () => {
    const past = lagSteps ? thHist[(histI + 1) % (lagSteps + 1)] : th;
    const h = -past * 180 / Math.PI;
    return cfg.noise ? h + gauss(noiseRnd) * 0.08 : h;
  };

  while (t < maxT) {
    // ---- control loop: what the Pybricks program does every wait(loopMs)
    if (t - lastCtrl >= loopS - 1e-9) {
      lastCtrl = t;
      if (phase === 'drive') {
        const fwd = leg % 2 === 0;
        const avg = (Math.round(aL) + Math.round(aR)) / 2; // motor.angle() is whole degrees
        const reached = fwd ? avg >= targetDeg : avg <= 0;
        if (reached) {
          brake = true; dcL = 0; dcR = 0;
          phase = 'pause';
          pauseUntil = t + cfg.pauseS;
          events.push({ t, type: 'stop', leg, line: fwd ? 'far' : 'start' });
        } else {
          heading = readGyro();
          err = 0 - heading;
          iSum += err * loopS;
          const de = prevErr === null ? 0 : (err - prevErr) / loopS;
          prevErr = err;
          pTerm = cfg.kp * err;
          iTerm = cfg.ki * iSum;
          dTerm = cfg.kd * de;
          const corr = pTerm + iTerm + dTerm;
          const dir = fwd ? 1 : -1;
          baseL = dir * kfL * cfg.speed;
          baseR = dir * kfR * cfg.speed;
          base = (baseL + baseR) / 2;
          dcL = clamp(baseL + corr, -100, 100);
          dcR = clamp(baseR - corr, -100, 100);
          brake = false;
        }
      } else if (phase === 'pause' && t >= pauseUntil) {
        leg += 1;
        if (leg >= legs) {
          phase = 'done';
          events.push({ t, type: 'done' });
        } else {
          phase = 'drive';
          legStart = t;
          events.push({ t, type: 'start', leg });
        }
      }
      if (phase !== 'drive') {
        heading = readGyro();
        err = -heading; pTerm = 0; iTerm = 0; dTerm = 0; base = 0; baseL = 0; baseR = 0;
      }
    }

    // ---- motors
    const ssL = brake ? 0 : steadySpeed(dcL, strengthL);
    const ssR = brake ? 0 : steadySpeed(dcR, strengthR);
    const tauL = brake ? ROBOT.tauBrake : ROBOT.tau;
    const tauR = brake ? ROBOT.tauBrake : ROBOT.tau;
    wL += (ssL - wL) * dt / tauL;
    wR += (ssR - wR) * dt / tauR;
    aL += wL * dt;
    aR += wR * dt;

    // ---- body
    const vL = wL * Math.PI / 180 * r;
    const vR = wR * Math.PI / 180 * r;
    const v = (vL + vR) / 2;
    let om = (vR - vL) / ROBOT.axleTrack;

    // bumps: a wheel rolls over a raised strip and the robot twists a little
    if (bumps.length) {
      for (let i = 0; i < bumps.length; i++) {
        const b = bumps[i];
        const before = x - b.x;
        const after = before + v * Math.cos(th) * dt;
        if (before !== 0 && Math.sign(before) !== Math.sign(after) && Math.abs(v) > 20) {
          // the wheel on that side is held back for a moment: robot turns toward that side
          const dur = 0.07;
          const kickRad = b.kick * Math.PI / 180;
          const travelSign = Math.sign(v);
          bumpKick = (b.side * travelSign) * kickRad / dur;
          bumpUntil = t + dur;
          events.push({ t, type: 'bump', i });
        }
      }
    }
    if (t < bumpUntil) om += bumpKick;

    x += v * Math.cos(th) * dt;
    y += v * Math.sin(th) * dt;
    th += om * dt;
    t += dt;
    if (lagSteps) { histI = (histI + 1) % (lagSteps + 1); thHist[histI] = th; }

    // ---- record
    if (t >= nextFrame) {
      nextFrame += frameEvery;
      frames.push({
        t, x, y, th,
        heading, err, pTerm, iTerm, dTerm, base, baseL, baseR,
        dcL, dcR, wL, wR, aL, aR, v,
        target: phase === 'drive' ? (leg % 2 === 0 ? cfg.speed : -cfg.speed) : 0,
        phase, leg,
      });
    }

    // ---- end checks
    if (phase === 'done' && t > (events[events.length - 1].t + 0.4)) break;
    if (Math.abs(y) > 650 || x < -550 || x > cfg.distance + 550) {
      endReason = 'offTable';
      events.push({ t, type: 'offTable' });
      break;
    }
    if (phase === 'drive') {
      if (Math.abs(v) < 2) {
        if (stillSince === null) stillSince = t;
        if (t - stillSince > 3) { endReason = 'stuck'; events.push({ t, type: 'stuck' }); break; }
      } else {
        stillSince = null;
      }
      const expected = cfg.distance / Math.max(cfg.speed, 1);
      if (t - legStart > expected * 3 + 6) { endReason = 'tooSlow'; events.push({ t, type: 'tooSlow' }); break; }
    } else {
      stillSince = null;
    }
  }

  const result = score(cfg, frames, events, endReason);
  return { cfg, frames, events, bumps, result, ghost: ghostSchedule(cfg), duration: frames.length ? frames[frames.length - 1].t : 0 };
}

// ---- scoring + coach
export function score(cfg, frames, events, endReason) {
  let maxDrift = 0, maxDriftSide = 0;
  let speedSum = 0, speedN = 0;
  let wiggles = 0;
  let lastSign = 0;
  const legHead = {}; // per leg: heading values while cruising
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (Math.abs(f.y) > maxDrift) { maxDrift = Math.abs(f.y); maxDriftSide = Math.sign(f.y); }
    if (f.phase === 'drive') {
      // cruise only: ignore the first 0.8 s of each leg while it speeds up
      const legStartT = legStartTime(events, f.leg);
      if (f.t - legStartT > 0.8) {
        speedSum += Math.abs(f.v); speedN++;
        (legHead[f.leg] ||= []).push(f.heading);
      }
      // swings: heading crosses from one side to the other by at least 1.5 degrees
      const h = f.heading;
      const s = h > 1.5 ? 1 : h < -1.5 ? -1 : 0;
      if (s !== 0 && lastSign !== 0 && s !== lastSign) wiggles++;
      if (s !== 0) lastSign = s;
    }
  }
  const avgSpeed = speedN ? speedSum / speedN : 0;
  // lean = how far off straight it holds on average.
  // wobble = how much it swings back and forth around a 1-second moving average,
  // so a slow steady drift (P = 0) does not count as shaking.
  let leanSum = 0, leanN = 0, wobSS = 0, wobN = 0;
  const HALF = 50; // samples each side (0.5 s)
  for (const k in legHead) {
    const a = legHead[k];
    const m = a.reduce((p, c) => p + c, 0) / a.length;
    leanSum += Math.abs(m); leanN++;
    const pre = new Float64Array(a.length + 1);
    for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < a.length; i++) {
      const lo = Math.max(0, i - HALF), hi = Math.min(a.length, i + HALF + 1);
      const avg = (pre[hi] - pre[lo]) / (hi - lo);
      wobSS += (a[i] - avg) * (a[i] - avg); wobN++;
    }
  }
  const lean = leanN ? leanSum / leanN : 0;
  const wobble = wobN ? Math.sqrt(wobSS / wobN) : 0;
  const stops = events.filter(e => e.type === 'stop').map(e => {
    const f = frameAt(frames, e.t + 0.35);
    const lineX = e.line === 'far' ? cfg.distance : 0;
    const overshoot = e.line === 'far' ? f.x - lineX : lineX - f.x;
    return { t: e.t, line: e.line, y: f.y, overshoot, heading: f.heading };
  });
  const last = frames[frames.length - 1] || { heading: 0, y: 0 };
  const speedErrPct = cfg.speed ? (avgSpeed - cfg.speed) / cfg.speed * 100 : 0;
  let stars = 0;
  const driftCm = maxDrift / 10;
  if (endReason === 'finished') {
    if (driftCm < 12) stars = 1;
    if (driftCm < 4 && Math.abs(speedErrPct) < 12 && wobble < 4) stars = 2;
    if (driftCm < 2 && Math.abs(speedErrPct) < 6 && wobble < 1.5) stars = 3;
  }

  const coach = coachHint({ cfg, endReason, avgSpeed, speedErrPct, driftCm, wiggles, wobble, lean, stars });
  return {
    endReason,
    maxDrift, maxDriftSide, driftCm,
    avgSpeed, speedErrPct,
    wiggles, wobble,
    lean,
    finalHeading: last.heading,
    stops,
    stars,
    coach,
  };
}

function legStartTime(events, leg) {
  if (leg === 0) return 0;
  for (let i = 0; i < events.length; i++) if (events[i].type === 'start' && events[i].leg === leg) return events[i].t;
  return 0;
}

export function frameAt(frames, t) {
  if (!frames.length) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }
  return frames[lo];
}

export function frameIndexAt(frames, t) {
  if (!frames.length) return 0;
  let lo = 0, hi = frames.length - 1;
  if (t >= frames[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }
  return lo;
}

function coachHint(s) {
  const { cfg, endReason } = s;
  if (endReason === 'stuck') {
    return { tone: 'bad', title: 'The robot never got going', text: `F × speed = ${(cfg.kf * cfg.speed).toFixed(0)}% power, which is not enough to get the wheels turning. Real motors need a little power just to start. Raise F.` };
  }
  if (endReason === 'tooSlow') {
    if (s.wobble > 4) return { tone: 'bad', title: 'It shook instead of driving', text: `P is so big that every correction overshoots, and the motors spend their power swinging left and right (about ±${s.wobble.toFixed(0)}°). Cut P way down.` };
    return { tone: 'bad', title: 'Too slow to reach the line', text: 'The robot was crawling. Raise F so the motors get more power for the speed you asked for.' };
  }
  if (endReason === 'offTable') {
    if (s.wobble > 4) return { tone: 'bad', title: 'It shook itself off the table', text: 'P is so big that every correction overshoots, and each swing is bigger than the last. Cut P way down.' };
    return { tone: 'bad', title: 'It drove off the table', text: cfg.kp === 0 ? 'P is 0, so the gyro is ignored: nothing steers the robot back when it starts to turn. Add some P.' : 'The drift grew too big. Raise P so it steers back harder.' };
  }
  // big shaking wastes power and slows the robot down, so blame P before F
  if (s.wobble > 3) {
    return { tone: 'warn', title: 'It is shaking: P is too big', text: `It swings about ±${s.wobble.toFixed(1)}° back and forth (${s.wiggles} swings). Each correction overshoots, so it has to correct the other way${s.speedErrPct < -8 ? ', and all that swinging slows it down' : ''}. Lower P.` };
  }
  if (s.speedErrPct < -12) {
    return { tone: 'warn', title: 'Start with F: it is driving too slow', text: `It averaged ${s.avgSpeed.toFixed(0)} mm/s but you asked for ${cfg.speed}. Raise F a little and run again. Tune F first, then P.` };
  }
  if (s.speedErrPct > 12) {
    return { tone: 'warn', title: 'F is too high: it is driving too fast', text: `It averaged ${s.avgSpeed.toFixed(0)} mm/s but you asked for ${cfg.speed}. Lower F a little.` };
  }
  if (cfg.kp === 0 && s.driftCm > 2) {
    return { tone: 'warn', title: 'The speed is good. Now it drifts.', text: `It went ${s.driftCm.toFixed(1)} cm off the line. The gyro can see the turn, but P is 0, so nothing steers back. Add some P.` };
  }
  if (s.wobble > 1.5) {
    return { tone: 'warn', title: 'It is shaking: P is too big', text: `It swings about ±${s.wobble.toFixed(1)}° back and forth (${s.wiggles} swings). Each correction overshoots, so it has to correct the other way. Lower P.` };
  }
  if (s.driftCm > 4) {
    return { tone: 'warn', title: 'Still drifting', text: `It went ${s.driftCm.toFixed(1)} cm off the line. Raise P so it steers back harder.` };
  }
  if (Math.abs(s.lean) > 0.6) {
    return { tone: 'info', title: 'Straight, but leaning', text: `It holds a small angle (about ${Math.abs(s.lean).toFixed(1)}°) because P has to keep pushing against the weaker motor. Raise P a bit, or turn on separate F for each motor.` };
  }
  if (Math.abs(s.speedErrPct) > 6) {
    return { tone: 'info', title: 'Nearly there', text: `Straight driving. The speed is ${Math.abs(s.speedErrPct).toFixed(0)}% ${s.speedErrPct < 0 ? 'slow' : 'fast'}: nudge F.` };
  }
  return { tone: 'good', title: 'Tuned!', text: 'Right speed, straight line, no snaking. Try Mystery robot: a new robot with its own weak motor.' };
}
