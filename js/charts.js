// charts.js: three live graphs under the 3D view: heading, speed, motor power.
// Click or drag on any graph to jump the playback to that moment.

const C = {
  grid: 'rgba(148,163,184,0.14)',
  axis: 'rgba(148,163,184,0.55)',
  text: '#94a3b8',
  textHi: '#e2e8f0',
  heading: '#ff8a3d',
  target: '#34d399',
  speed: '#4da3ff',
  left: '#60a5fa',
  right: '#f472b6',
  f: '#cbd5e1',
  prev: 'rgba(203,213,225,0.28)',
  fwd: 'rgba(77,163,255,0.07)',
  back: 'rgba(192,132,252,0.08)',
  pause: 'rgba(148,163,184,0.06)',
  cursor: '#fbbf24',
};

export function createCharts(els, onSeek) {
  const charts = [
    { el: els.heading, kind: 'heading' },
    { el: els.speed, kind: 'speed' },
    { el: els.power, kind: 'power' },
  ];
  let run = null, prev = null, tMax = 1, now = 0;
  const pad = { l: 40, r: 10, t: 22, b: 18 };

  for (const ch of charts) {
    ch.ctx = ch.el.getContext('2d');
    const seek = (ev) => {
      if (!run) return;
      const r = ch.el.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const t = (x - pad.l) / (r.width - pad.l - pad.r) * tMax;
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
      ch.el.width = Math.max(1, Math.round(r.width * dpr));
      ch.el.height = Math.max(1, Math.round(r.height * dpr));
      ch.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function setRun(sim, previous) {
    run = sim; prev = previous || null;
    tMax = Math.max(sim.duration, prev ? prev.duration : 0, 1);
    // stable y ranges for the whole run
    let hMax = 4, vMax = sim.cfg.speed * 1.25, pMax = 60;
    for (const f of sim.frames) {
      hMax = Math.max(hMax, Math.abs(f.heading) * 1.12);
      vMax = Math.max(vMax, Math.abs(f.v) * 1.1);
      pMax = Math.max(pMax, Math.abs(f.dcL) * 1.08, Math.abs(f.dcR) * 1.08);
    }
    if (prev) for (const f of prev.frames) hMax = Math.max(hMax, Math.min(Math.abs(f.heading) * 1.12, hMax * 1.6));
    run._range = { h: niceCeil(hMax), v: niceCeil(vMax), p: Math.min(100, niceCeil(pMax)) };
    // phase bands
    run._bands = [];
    let cur = null;
    for (const f of sim.frames) {
      const key = f.phase === 'drive' ? (f.leg % 2 === 0 ? 'fwd' : 'back') : 'pause';
      if (!cur || cur.key !== key) { if (cur) cur.t1 = f.t; cur = { key, t0: f.t, t1: f.t }; run._bands.push(cur); }
    }
    if (cur) cur.t1 = sim.duration;
  }

  function niceCeil(v) {
    const steps = [1, 2, 2.5, 5, 10];
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of steps) if (s * p >= v) return s * p;
    return 10 * p;
  }

  function draw(t) {
    now = t;
    for (const ch of charts) drawChart(ch);
  }

  function drawChart(ch) {
    const g = ch.ctx, W = ch.w, H = ch.h;
    if (!W || !H) return;
    g.clearRect(0, 0, W, H);
    const x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;
    const X = (t) => x0 + (t / tMax) * (x1 - x0);
    if (!run) return;
    const range = ch.kind === 'heading' ? run._range.h : ch.kind === 'speed' ? run._range.v : run._range.p;
    const Y = (v) => y0 + (1 - (v + range) / (2 * range)) * (y1 - y0);

    // phase bands
    for (const b of run._bands) {
      g.fillStyle = C[b.key];
      g.fillRect(X(b.t0), y0, X(b.t1) - X(b.t0), y1 - y0);
      if (ch.kind === 'heading' && b.key !== 'pause' && X(b.t1) - X(b.t0) > 34) {
        g.fillStyle = 'rgba(148,163,184,0.5)'; g.font = '600 10px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText(b.key === 'fwd' ? 'out →' : '← back', (X(b.t0) + X(b.t1)) / 2, y1 - 4);
      }
    }
    // grid
    g.strokeStyle = C.grid; g.lineWidth = 1;
    g.font = '10px system-ui, sans-serif'; g.fillStyle = C.text; g.textAlign = 'right';
    for (const v of [-range, -range / 2, 0, range / 2, range]) {
      g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke();
      g.fillText(fmtTick(v), x0 - 5, Y(v) + 3);
    }
    g.textAlign = 'center';
    const tStep = tMax > 40 ? 10 : 5;
    for (let s = 0; s <= tMax; s += tStep) {
      g.beginPath(); g.moveTo(X(s), y0); g.lineTo(X(s), y1); g.stroke();
      g.fillText(`${s}s`, X(s), H - 4);
    }

    const cur = run.frames;
    let iNow = indexAt(cur, now);
    if (ch.kind === 'heading') {
      title(g, 'Gyro heading (°)', [['this run', C.heading], ['target 0°', C.target], prev ? ['last run', C.prev] : null]);
      g.strokeStyle = C.target; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke(); g.setLineDash([]);
      if (prev) series(g, prev.frames, prev.frames.length - 1, f => f.heading, X, Y, C.prev, 1.2, range);
      series(g, cur, iNow, f => f.heading, X, Y, C.heading, 1.8, range);
      readout(g, W, `${signed(cur[iNow].heading, 1)}°`, C.heading);
    } else if (ch.kind === 'speed') {
      title(g, 'Speed (mm/s)', [['actual', C.speed], ['asked for', C.f], prev ? ['last run', C.prev] : null]);
      g.strokeStyle = C.f; g.lineWidth = 1.4; g.setLineDash([5, 4]);
      seriesStep(g, cur, cur.length - 1, f => f.target, X, Y);
      g.setLineDash([]);
      if (prev) series(g, prev.frames, prev.frames.length - 1, f => f.v, X, Y, C.prev, 1.2, range);
      series(g, cur, iNow, f => f.v, X, Y, C.speed, 1.8, range);
      readout(g, W, `${Math.round(Math.abs(cur[iNow].v))} mm/s`, C.speed);
    } else {
      title(g, 'Motor power (%)', [['left', C.left], ['right', C.right], ['F part', C.f]]);
      g.strokeStyle = C.f; g.lineWidth = 1.3; g.setLineDash([4, 4]);
      seriesStep(g, cur, iNow, f => f.base, X, Y);
      g.setLineDash([]);
      series(g, cur, iNow, f => f.dcL, X, Y, C.left, 1.5, range);
      series(g, cur, iNow, f => f.dcR, X, Y, C.right, 1.5, range);
      readout(g, W, `L ${Math.round(cur[iNow].dcL)}  R ${Math.round(cur[iNow].dcR)}`, C.textHi);
    }
    // cursor
    g.strokeStyle = C.cursor; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(X(now), y0 - 2); g.lineTo(X(now), y1); g.stroke();
  }

  function title(g, text, legend) {
    g.fillStyle = C.textHi; g.font = '700 11.5px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(text, pad.l, 14);
    let x = pad.l + g.measureText(text).width + 14;
    g.font = '10.5px system-ui, sans-serif';
    const maxX = g.canvas.width / Math.min(window.devicePixelRatio || 1, 2) - pad.r;
    for (const item of legend) {
      if (!item) continue;
      if (x + 14 + g.measureText(item[0]).width > maxX) break; // no room: drop the rest

      g.fillStyle = item[1]; g.fillRect(x, 8, 10, 3);
      g.fillStyle = C.text; g.fillText(item[0], x + 14, 14);
      x += 14 + g.measureText(item[0]).width + 12;
    }
  }

  // current value: a small pill in the top-right corner of the plot
  function readout(g, W, text, color) {
    g.font = '700 11.5px ui-monospace, Consolas, monospace';
    const w = g.measureText(text).width + 12;
    const x = W - pad.r - w - 2, y = pad.t + 3;
    g.fillStyle = 'rgba(11,16,25,0.88)';
    g.beginPath(); g.roundRect ? g.roundRect(x, y, w, 17, 5) : g.rect(x, y, w, 17); g.fill();
    g.textAlign = 'left'; g.fillStyle = color;
    g.fillText(text, x + 6, y + 12.5);
  }

  // min/max per pixel column keeps fast wiggles visible
  function series(g, frames, iEnd, get, X, Y, color, width, range) {
    if (iEnd < 1) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round';
    g.beginPath();
    let col = -1, mn = 0, mx = 0, first = true, lastV = 0;
    const flush = () => {
      if (col < 0) return;
      const ymn = Y(clamp(mn, range)), ymx = Y(clamp(mx, range));
      if (first) { g.moveTo(col, Y(clamp(lastV, range))); first = false; }
      g.lineTo(col, ymx); g.lineTo(col, ymn); g.lineTo(col, Y(clamp(lastV, range)));
    };
    for (let i = 0; i <= iEnd; i++) {
      const f = frames[i];
      const c = Math.round(X(f.t));
      const v = get(f);
      if (c !== col) { flush(); col = c; mn = mx = v; }
      else { if (v < mn) mn = v; if (v > mx) mx = v; }
      lastV = v;
    }
    flush();
    g.stroke();
  }

  function seriesStep(g, frames, iEnd, get, X, Y) {
    if (iEnd < 1) return;
    g.beginPath();
    let prevV = null;
    for (let i = 0; i <= iEnd; i += 2) {
      const f = frames[i];
      const v = get(f);
      if (prevV === null) g.moveTo(X(f.t), Y(v));
      else g.lineTo(X(f.t), Y(v));
      prevV = v;
    }
    g.stroke();
  }

  const clamp = (v, r) => Math.max(-r * 1.02, Math.min(r * 1.02, v));
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
