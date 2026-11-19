// charts.js: graphs under the 3D view. The main one is "Off the path";
// teachers can turn on heading, speed and motor power too.
// Click or drag on any graph to jump the playback to that moment.

const C = {
  grid: 'rgba(93,107,133,0.14)',
  text: '#5d6b85',
  textHi: '#1c2740',
  drift: '#dc2626',
  heading: '#f2761d',
  target: '#16a34a',
  speed: '#2f80ed',
  left: '#2f80ed',
  right: '#db2777',
  f: '#5d6b85',
  prev: 'rgba(93,107,133,0.35)',
  fwd: 'rgba(47,128,237,0.06)',
  back: 'rgba(124,58,237,0.06)',
  pause: 'rgba(93,107,133,0.04)',
  zone: 'rgba(22,163,74,0.14)',
  cursor: '#f59e0b',
};
const FONT = '"Nunito", system-ui, sans-serif';

export function createCharts(els, onSeek) {
  const charts = Object.entries(els).filter(([, el]) => el).map(([kind, el]) => ({ el, kind }));
  let run = null, prev = null, tMax = 1, now = 0;
  const pad = { l: 46, r: 12, t: 26, b: 20 };

  for (const ch of charts) {
    ch.ctx = ch.el.getContext('2d');
    const seek = (ev) => {
      if (!run) return;
      const r = ch.el.getBoundingClientRect();
      const t = (ev.clientX - r.left - pad.l) / (r.width - pad.l - pad.r) * tMax;
      onSeek(Math.max(0, Math.min(run.duration, t)));
    };
    let down = false;
    ch.el.addEventListener('pointerdown', (e) => { down = true; ch.el.setPointerCapture(e.pointerId); seek(e); });
    ch.el.addEventListener('pointermove', (e) => { if (down) seek(e); });
    ch.el.addEventListener('pointerup', () => { down = false; });
    ch.el.addEventListener('pointercancel', () => { down = false; });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const ch of charts) {
      const r = ch.el.getBoundingClientRect();
      ch.w = r.width; ch.h = r.height;
      if (!r.width) continue;
      ch.el.width = Math.max(1, Math.round(r.width * dpr));
      ch.el.height = Math.max(1, Math.round(r.height * dpr));
      ch.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function setRun(sim, previous) {
    run = sim; prev = previous || null;
    tMax = Math.max(sim.duration, prev ? prev.duration : 0, 1);
    let hMax = 4, vMax = sim.cfg.speed * 1.25, pMax = 60, dMax = 50;
    for (const f of sim.frames) {
      hMax = Math.max(hMax, Math.abs(f.heading) * 1.12);
      vMax = Math.max(vMax, Math.abs(f.v) * 1.1);
      pMax = Math.max(pMax, Math.abs(f.dcL) * 1.08, Math.abs(f.dcR) * 1.08);
      dMax = Math.max(dMax, Math.abs(f.y) * 1.15);
    }
    if (prev) for (const f of prev.frames) dMax = Math.max(dMax, Math.abs(f.y) * 1.15);
    run._range = { heading: niceCeil(hMax), speed: niceCeil(vMax), power: Math.min(100, niceCeil(pMax)), drift: niceCeil(dMax / 10) };
    run._bands = [];
    let cur = null;
    for (const f of sim.frames) {
      const key = f.phase === 'drive' ? (f.leg % 2 === 0 ? 'fwd' : 'back') : 'pause';
      if (!cur || cur.key !== key) { if (cur) cur.t1 = f.t; cur = { key, t0: f.t, t1: f.t }; run._bands.push(cur); }
    }
    if (cur) cur.t1 = sim.duration;
  }

  function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= v) return s * p;
    return 10 * p;
  }

  function draw(t) {
    now = t;
    for (const ch of charts) if (ch.w) drawChart(ch);
  }

  function drawChart(ch) {
    const g = ch.ctx, W = ch.w, H = ch.h;
    g.clearRect(0, 0, W, H);
    if (!run) return;
    const x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;
    const X = (t) => x0 + (t / tMax) * (x1 - x0);
    const range = run._range[ch.kind];
    const Y = (v) => y0 + (1 - (v + range) / (2 * range)) * (y1 - y0);

    for (const b of run._bands) {
      g.fillStyle = C[b.key];
      g.fillRect(X(b.t0), y0, X(b.t1) - X(b.t0), y1 - y0);
      if (ch.kind === 'drift' && b.key !== 'pause' && X(b.t1) - X(b.t0) > 40) {
        g.fillStyle = 'rgba(93,107,133,0.55)'; g.font = `800 11px ${FONT}`; g.textAlign = 'center';
        g.fillText(b.key === 'fwd' ? 'out →' : '← back', (X(b.t0) + X(b.t1)) / 2, y1 - 5);
      }
    }
    g.strokeStyle = C.grid; g.lineWidth = 1;
    g.font = `700 11px ${FONT}`; g.fillStyle = C.text; g.textAlign = 'right';
    for (const v of [-range, -range / 2, 0, range / 2, range]) {
      g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke();
      if (ch.kind === 'drift') {
        const lab = v === 0 ? 'path' : `${Math.abs(v)} ${v > 0 ? 'L' : 'R'}`;
        g.fillText(lab, x0 - 6, Y(v) + 4);
      } else g.fillText(fmtTick(v), x0 - 6, Y(v) + 4);
    }
    g.textAlign = 'center';
    const tStep = tMax > 40 ? 10 : 5;
    for (let s = 0; s <= tMax; s += tStep) g.fillText(`${s}s`, X(s), H - 5);

    const cur = run.frames;
    const iNow = indexAt(cur, now);
    if (ch.kind === 'drift') {
      title(g, 'How far off the path (cm)', [['this try', C.drift], prev ? ['last try', C.prev] : null]);
      g.fillStyle = C.zone; g.fillRect(x0, Y(2), x1 - x0, Y(-2) - Y(2));
      g.strokeStyle = '#2f6fdb'; g.lineWidth = 2; g.setLineDash([7, 5]);
      g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke(); g.setLineDash([]);
      if (prev) series(g, prev.frames, prev.frames.length - 1, (f) => f.y / 10, X, Y, C.prev, 2, range);
      series(g, cur, iNow, (f) => f.y / 10, X, Y, C.drift, 3, range);
      const y = cur[iNow].y / 10;
      readout(g, W, Math.abs(y) < 0.5 ? 'on the path' : `${Math.round(Math.abs(y))} cm ${y > 0 ? 'left' : 'right'}`, C.drift);
    } else if (ch.kind === 'heading') {
      title(g, 'Gyro heading (°)', [['this try', C.heading], ['straight', C.target]]);
      g.strokeStyle = C.target; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke(); g.setLineDash([]);
      if (prev) series(g, prev.frames, prev.frames.length - 1, (f) => f.heading, X, Y, C.prev, 1.2, range);
      series(g, cur, iNow, (f) => f.heading, X, Y, C.heading, 2, range);
      readout(g, W, `${signed(cur[iNow].heading, 1)}°`, C.heading);
    } else if (ch.kind === 'speed') {
      title(g, 'Speed (mm/s)', [['robot', C.speed], ['ghost', C.f]]);
      g.strokeStyle = C.f; g.lineWidth = 1.4; g.setLineDash([5, 4]);
      seriesStep(g, cur, cur.length - 1, (f) => f.target, X, Y);
      g.setLineDash([]);
      series(g, cur, iNow, (f) => f.v, X, Y, C.speed, 2, range);
      readout(g, W, `${Math.round(Math.abs(cur[iNow].v))} mm/s`, C.speed);
    } else {
      title(g, 'Motor power (%)', [['left', C.left], ['right', C.right], ['F part', C.f]]);
      g.strokeStyle = C.f; g.lineWidth = 1.3; g.setLineDash([4, 4]);
      seriesStep(g, cur, iNow, (f) => f.base, X, Y);
      g.setLineDash([]);
      series(g, cur, iNow, (f) => f.dcL, X, Y, C.left, 1.6, range);
      series(g, cur, iNow, (f) => f.dcR, X, Y, C.right, 1.6, range);
      readout(g, W, `L ${Math.round(cur[iNow].dcL)}  R ${Math.round(cur[iNow].dcR)}`, C.textHi);
    }
    g.strokeStyle = C.cursor; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(now), y0 - 2); g.lineTo(X(now), y1); g.stroke();
  }

  function title(g, text, legend) {
    g.fillStyle = C.textHi; g.font = `900 13px ${FONT}`; g.textAlign = 'left';
    g.fillText(text, pad.l, 16);
    let x = pad.l + g.measureText(text).width + 14;
    g.font = `700 11.5px ${FONT}`;
    const maxX = g.canvas.width / Math.min(window.devicePixelRatio || 1, 2) - 150;
    for (const item of legend) {
      if (!item) continue;
      if (x + 14 + g.measureText(item[0]).width > maxX) break;
      g.fillStyle = item[1]; g.fillRect(x, 10, 11, 4);
      g.fillStyle = C.text; g.fillText(item[0], x + 15, 16);
      x += 15 + g.measureText(item[0]).width + 12;
    }
  }

  function readout(g, W, text, color) {
    g.font = `900 13px ${FONT}`;
    const w = g.measureText(text).width + 14;
    const x = W - pad.r - w, y = 4;
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(93,107,133,0.25)';
    g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, 19, 7); else g.rect(x, y, w, 19); g.fill(); g.stroke();
    g.textAlign = 'left'; g.fillStyle = color;
    g.fillText(text, x + 7, y + 14);
  }

  // min/max per pixel column keeps fast wiggles visible
  function series(g, frames, iEnd, get, X, Y, color, width, range) {
    if (iEnd < 1) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    let col = -1, mn = 0, mx = 0, first = true, lastV = 0;
    const cl = (v) => Math.max(-range * 1.02, Math.min(range * 1.02, v));
    const flush = () => {
      if (col < 0) return;
      if (first) { g.moveTo(col, Y(cl(lastV))); first = false; }
      g.lineTo(col, Y(cl(mx))); g.lineTo(col, Y(cl(mn))); g.lineTo(col, Y(cl(lastV)));
    };
    for (let i = 0; i <= iEnd; i++) {
      const f = frames[i];
      const c = Math.round(X(f.t));
      const v = get(f);
      if (c !== col) { flush(); col = c; mn = mx = v; } else { if (v < mn) mn = v; if (v > mx) mx = v; }
      lastV = v;
    }
    flush();
    g.stroke();
  }

  function seriesStep(g, frames, iEnd, get, X, Y) {
    if (iEnd < 1) return;
    g.beginPath();
    for (let i = 0; i <= iEnd; i += 2) {
      const f = frames[i];
      if (i === 0) g.moveTo(X(f.t), Y(get(f))); else g.lineTo(X(f.t), Y(get(f)));
    }
    g.stroke();
  }

  const signed = (v, d) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  const fmtTick = (v) => (Math.abs(v) >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)).toString().replace('-', '−');

  function indexAt(frames, t) {
    let lo = 0, hi = frames.length - 1;
    if (t >= frames[hi].t) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
    return lo;
  }

  return { resize, setRun, draw };
}
