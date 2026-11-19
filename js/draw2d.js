// draw2d.js: 2D canvas helpers shared by the How it works and Learn pages:
// colours, rounded boxes, text, pills and the top-down SPIKE driving base.
import { MM_PER_DEG } from './physics.js';

export const FONT = '"Nunito", system-ui, sans-serif';
export const C = {
  ink: '#1c2740', muted: '#5d6b85', line: '#d8e1ee',
  f: '#2f80ed', p: '#f2761d', good: '#16a34a', warn: '#d97706', bad: '#dc2626',
  path: '#2f6fdb', mat: '#f7f5ef', grid: '#e6e2d9', tape: '#17191d',
  yellow: '#ffc928', white: '#fbfbf8', grey: '#c3c8cf', dark: '#363a42', tyre: '#22252b', purple: '#7c3aed',
};

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
export function text(g, str, x, y, { size = 14, weight = 800, color = C.ink, align = 'left', base = 'alphabetic' } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  g.fillText(str, x, y);
  g.textBaseline = 'alphabetic';
}
export function pill(g, str, x, y, bg, fg = '#fff', size = 13) {
  g.font = `900 ${size}px ${FONT}`;
  const w = g.measureText(str).width + 14, h = size + 9;
  rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fillStyle = bg; g.fill();
  text(g, str, x, y + size * 0.36, { size, weight: 900, color: fg, align: 'center' });
}

export const ARROW_UP = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];
// Top-down SPIKE driving base. (x, y) = axle centre on screen, ang = heading in
// radians (counterclockwise on screen is +), s = pixels per mm.
export function drawRobot(g, x, y, ang, s, o = {}) {
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
