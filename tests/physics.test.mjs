// Checks that the simulated robot behaves the way the lessons say it should.
// Run: node tests/physics.test.mjs
import { simulate } from '../js/physics.js';

const rows = [];
const run = (label, cfg) => {
  const s = simulate(cfg);
  const r = s.result;
  rows.push({
    label,
    end: r.endReason,
    'drift cm': r.driftCm.toFixed(1),
    'speed': r.avgSpeed.toFixed(0),
    'spd err%': r.speedErrPct.toFixed(0),
    swings: r.wiggles, 'wobble°': r.wobble.toFixed(2),
    'lean°': r.lean.toFixed(2),
    stars: r.stars,
    secs: s.duration.toFixed(1),
    coach: r.coach.title,
  });
  return s;
};

const start = run('start F=0.20 P=0', {});
const fOnly = run('F tuned 0.235 P=0', { kf: 0.235 });
run('F too low 0.03', { kf: 0.03 });
run('F too high 0.32', { kf: 0.32, kp: 3 });
const p05 = run('P=0.5', { kf: 0.235, kp: 0.5 });
const p1 = run('P=1', { kf: 0.235, kp: 1 });
const p3 = run('P=3', { kf: 0.235, kp: 3 });
run('P=6', { kf: 0.235, kp: 6 });
const p12 = run('P=12', { kf: 0.235, kp: 12 });
const p25 = run('P=25', { kf: 0.235, kp: 25 });
run('split F, P=1', { kp: 1, splitF: true, kfL: 0.241, kfR: 0.235 });
run('no bumps P=3', { kf: 0.235, kp: 3, bumps: false });
run('right weak 4% P=0', { kf: 0.235, weakSide: 'right', weakPct: 4 });
console.table(rows);

let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
check(start.result.driftCm > 8, 'starting robot visibly drifts (> 8 cm)');
check(start.result.speedErrPct < -8, 'starting F is too low, so the coach says tune F first');
check(fOnly.result.driftCm > 8, 'F alone does not fix drift');
check(p1.result.driftCm < fOnly.result.driftCm / 3, 'P = 1 cuts drift to a third or less');
check(p3.result.driftCm < 3, 'P = 3 drives nearly straight (< 3 cm)');
check(p3.result.wobble < 1.5 && p12.result.wobble > 2.5, 'P = 3 is steady, P = 12 shakes');
check(p12.result.wiggles > p3.result.wiggles * 2, 'P = 12 swings far more than P = 3');
check(p25.result.wobble > p12.result.wobble || p25.result.endReason !== 'finished', 'P = 25 is worse than P = 12');
check(p05.result.lean > p3.result.lean * 3, 'small P leaves a bigger lean than P = 3');
// pull direction: weak left motor -> robot turns left (y grows +) when P = 0
const yEndFirstLeg = fOnly.frames.find(f => f.phase === 'pause').y;
check(yEndFirstLeg > 0, 'weak LEFT motor pulls the robot to the left');
if (fail) { console.log(`${fail} check(s) failed`); process.exit(1); }
console.log('all checks pass');

// coach says the right thing for each classroom moment
const coachChecks = [
  [start, 'Start with F'],
  [fOnly, 'Now it drifts'],
  [p12, 'shaking'],
  [p25, 'shook'],
];
let cfail = 0;
for (const [s, want] of coachChecks) {
  const ok = s.result.coach.title.includes(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + `coach "${s.result.coach.title}" contains "${want}"`);
  if (!ok) cfail++;
}
if (cfail) process.exit(1);
