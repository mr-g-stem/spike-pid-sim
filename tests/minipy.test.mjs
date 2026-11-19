// Checks the practice Python runner used by the Learn tab.
// Run: node tests/minipy.test.mjs
import { runProgram, STARTER, SETUP } from '../js/minipy.js';

let fail = 0;
const check = (ok, msg, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (ok ? '' : '  ' + extra)); if (!ok) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const deg = (r) => r * 180 / Math.PI;
const run = (body) => runProgram(SETUP + body);

// 1. the starter program: 30 cm up, turn right, 20 cm right
let r = runProgram(STARTER);
check(!r.error, 'starter program runs', JSON.stringify(r.error));
check(near(r.final.x, 200, 3) && near(r.final.y, 300, 3), 'starter ends 20 cm right, 30 cm up', JSON.stringify(r.final));
check(near(deg(r.final.th), 90, 1), 'starter ends facing right (turn(90) = right)', deg(r.final.th));
check(r.events.some((e) => e.type === 'beep'), 'starter beeps');

// 2. a square with a loop comes home
r = run('for i in range(4):\n    robot.straight(200)\n    robot.turn(90)\n');
check(!r.error && near(r.final.x, 0, 3) && near(r.final.y, 0, 3) && near(deg(r.final.th), 360, 1), 'square with for-loop comes back to the start', JSON.stringify([r.error, r.final]));
check(r.summary.usedFor && r.summary.turns === 4 && r.summary.straights === 4, 'summary counts the loop moves');

// 3. a function with a parameter
r = run('def square(size):\n    for i in range(4):\n        robot.straight(size)\n        robot.turn(90)\n\nsquare(100)\nsquare(300)\n');
check(!r.error && r.summary.defWithParam && r.summary.calledDef, 'def square(size) runs twice', JSON.stringify(r.error));
check(near(r.final.x, 0, 4) && near(r.final.y, 0, 4), 'two squares end back at the start', JSON.stringify(r.final));

// 4. negative numbers: backward and left
r = run('robot.straight(-150)\nrobot.turn(-90)\n');
check(near(r.final.y, -150, 3) && near(deg(r.final.th), -90, 1), 'straight(-150) backs up, turn(-90) turns left', JSON.stringify(r.final));

// 5. one wheel motor alone makes the robot pivot
r = run('left.run_angle(500, 360)\n');
check(!r.error && deg(r.final.th) > 80 && deg(r.final.th) < 100, 'left.run_angle(500, 360) pivots right about 90 degrees', deg(r.final.th));
r = run('right.run_time(500, 1000)\n');
check(!r.error && deg(r.final.th) < -60 && near(r.duration, 1.3, 0.1), 'right.run_time(500, 1000) lasts 1 s and pivots left', [deg(r.final.th), r.duration].join(' '));

// 6. wait adds time
const a = run('robot.straight(100)\n'), b = run('robot.straight(100)\nwait(1000)\n');
check(near(b.duration - a.duration, 1, 0.05), 'wait(1000) adds 1 second');

// 7. the flipped left motor spins the robot and warns
r = runProgram(SETUP.replace('Motor(Port.A, Direction.COUNTERCLOCKWISE)', 'Motor(Port.A)') + 'robot.straight(300)\n');
check(r.warnings.some((w) => /COUNTERCLOCKWISE/.test(w.msg)), 'missing Direction.COUNTERCLOCKWISE explains the spin');
check(Math.hypot(r.final.x, r.final.y) < 5 && Math.abs(deg(r.final.th)) > 200, 'and straight(300) really spins in place instead of driving', JSON.stringify(r.final));

// 8. kid-friendly errors with the right line
const err = (src) => runProgram(src).error || {};
let e = err(STARTER.replace('from pybricks.pupdevices import Motor\n', ''));
check(e.line === 7 && /import/.test(e.msg) && /pupdevices import Motor/.test(e.hint), 'forgot to import Motor', JSON.stringify(e));
e = err(SETUP + 'robot.strait(100)\n');
check(/straight/.test(e.hint), 'robot.strait -> did you mean straight', JSON.stringify(e));
e = err(SETUP + 'Robot.straight(100)\n');
check(/capital/.test(e.hint), 'Robot vs robot -> capital letters hint', JSON.stringify(e));
e = err(SETUP + 'for i in range(4)\n    robot.straight(100)\n');
check(/colon/.test(e.msg), 'missing colon on for', JSON.stringify(e));
e = err(SETUP + 'robot.straight(100)\n    robot.turn(90)\n');
check(/indented/.test(e.msg), 'stray indent is explained', JSON.stringify(e));
e = err(SETUP + 'robot.straight 200\n');
check(/inside \( \)/.test(e.msg) && /robot\.straight\(200\)/.test(e.hint), 'robot.straight 200 -> put it in ( )', JSON.stringify(e));
e = err(SETUP.replace('Port.B', 'Port.G'));
check(/Port\.G/.test(e.msg) && /A to F/.test(e.hint), 'Port.G is not a port', JSON.stringify(e));
e = err(SETUP + 'def hop(size):\n    robot.straight(size)\n\nhop()\n');
check(/needs 1 number/.test(e.msg), 'calling a function with the wrong count', JSON.stringify(e));
e = err(SETUP + 'robot.straight(100\n');
check(e.line === 12 && e.msg, 'missing ) is reported on its line', JSON.stringify(e));

// 9. friendly unit warnings
r = run('robot.straight(30)\n');
check(r.warnings.some((w) => /millimeters/.test(w.msg)), 'straight(30) warns that it is only 3 cm');
r = run('wait(2)\n');
check(r.warnings.some((w) => /1000 = 1 second/.test(w.msg)), 'wait(2) warns about milliseconds');

// 10. comments, blank lines and variables
r = run('# drive a bit\nsize = 120   # mm\nrobot.straight(size * 2)\n\n');
check(!r.error && near(r.final.y, 240, 3), 'variables, maths and comments work', JSON.stringify([r.error, r.final]));

// 11. the hub
r = run('hub.display.text("Hi")\nhub.light.on(Color.RED)\n');
check(r.error && /Color/.test(r.error.msg), 'Color must be imported first');
r = runProgram(SETUP.replace('import Direction, Port', 'import Color, Direction, Port') + 'hub.display.text("Hi")\nhub.light.on(Color.RED)\nprint("done")\n');
check(!r.error && r.events.some((x) => x.type === 'display' && x.text === 'Hi') && r.prints[0].text === 'done', 'display, light and print work', JSON.stringify(r.error));

// 12. runaway programs stop politely
r = run('for i in range(100000):\n    robot.turn(1)\n');
check(r.error && /too many steps/.test(r.error.msg), 'huge loops stop with a message');

if (fail) { console.log(`${fail} check(s) failed`); process.exit(1); }
console.log('all practice-runner checks pass');
