// Checks the Pybricks program the Code tab produces.
// Run: node tests/codegen.test.mjs   (also runs with Python if it is installed)
import { pybricksCode } from '../js/codegen.js';
import { DEFAULTS } from '../js/physics.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const variants = {
  normal: { ...DEFAULTS, kf: 47 / 200, kp: 5 },
  splitF: { ...DEFAULTS, splitF: true, kfL: 48 / 200, kfR: 46 / 200, kp: 3 },
  withID: { ...DEFAULTS, kf: 47 / 200, kp: 3, ki: 0.2, kd: 0.05 },
};

let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };

for (const [name, cfg] of Object.entries(variants)) {
  const code = pybricksCode(cfg);
  // every helper that is called is also defined (this once broke: limit() was missing)
  const calls = [...code.matchAll(/\b([a-z_]+)\(/g)].map((m) => m[1]);
  const builtins = new Set(['max', 'min', 'range', 'print', 'Motor', 'PrimeHub', 'wait']);
  const defined = new Set([...code.matchAll(/^def ([a-z_]+)\(/gm)].map((m) => m[1]));
  const methods = new Set([...code.matchAll(/\.([a-z_]+)\(/g)].map((m) => m[1]));
  const missing = [...new Set(calls)].filter((c) => !builtins.has(c) && !defined.has(c) && !methods.has(c));
  check(missing.length === 0, `${name}: every called function exists ${missing.length ? '(missing: ' + missing.join(', ') + ')' : ''}`);
  check(/^from pybricks\.hubs import PrimeHub$/m.test(code), `${name}: imports PrimeHub`);
  check(/Motor\(Port\.A, Direction\.COUNTERCLOCKWISE\)/.test(code), `${name}: left motor is port A, counterclockwise`);
  check(/error = 0 - hub\.imu\.heading\(\)/.test(code), `${name}: error comes from the gyro`);
  check(cfg.splitF ? /^F_LEFT = 48\b/m.test(code) && /^F_RIGHT = 46\b/m.test(code) : /^F = 47\b/m.test(code), `${name}: F is a whole-number go power`);
  check(code.split('\n').every((l) => (l.match(/^ */)[0].length % 4) === 0), `${name}: indentation is in steps of 4`);
  if (cfg.ki) check(/^total_error = 0$/m.test(code) && /global total_error, last_error/.test(code), `${name}: I and D keep their state between loops`);

  // optional: run it through Python's compiler if Python is on this computer
  const py = ['python', 'python3', path.join(os.homedir(), 'AppData/Local/Programs/Thonny/python.exe')].find((p) => spawnSync(p, ['--version']).status === 0);
  if (py) {
    const f = path.join(os.tmpdir(), `pidlab_${name}.py`);
    fs.writeFileSync(f, code);
    const r = spawnSync(py, ['-m', 'py_compile', f]);
    check(r.status === 0, `${name}: Python compiles it ${r.status ? String(r.stderr) : ''}`);
  }
}
if (fail) { console.log(`${fail} check(s) failed`); process.exit(1); }
console.log('all code checks pass');
