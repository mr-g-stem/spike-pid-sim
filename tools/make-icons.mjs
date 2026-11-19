// Draws the app icons (iPad "Add to Home Screen", Android, browsers) with no
// dependencies: shapes are tested per pixel with 4x4 supersampling, then
// written as PNG with Node's zlib. Run: node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');
fs.mkdirSync(outDir, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#2f80ed'), YEL = hex('#ffc928'), YEL2 = hex('#e9ae00'), DARK = hex('#22262d'), LED = hex('#fff3c4'), OFF = hex('#3b414b'), GREEN = hex('#34d399'), WHITE = hex('#fbfbf8');

// rounded rectangle test in unit coordinates
const inRR = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const ARROW = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];

function colorAt(x, y) {
  // hub body: yellow with a darker base, white top plate
  if (inRR(x, y, 0.14, 0.24, 0.86, 0.78, 0.09)) {
    if (y > 0.68) return YEL2;
    if (inRR(x, y, 0.18, 0.28, 0.82, 0.66, 0.06)) {
      // 5x5 light matrix on the left
      if (inRR(x, y, 0.23, 0.31, 0.55, 0.63, 0.03)) {
        const c = Math.floor((x - 0.25) / 0.06), r = Math.floor((y - 0.33) / 0.06);
        const lx = 0.25 + c * 0.06, ly = 0.33 + r * 0.06;
        if (c >= 0 && c < 5 && r >= 0 && r < 5 && x - lx < 0.042 && y - ly < 0.042) return ARROW[r][c] === '#' ? LED : OFF;
        return DARK;
      }
      // centre button with a green ring
      const d = Math.hypot(x - 0.685, y - 0.47);
      if (d < 0.045) return WHITE;
      if (d < 0.07) return GREEN;
      return WHITE;
    }
    return YEL;
  }
  return BG;
}

function png(size) {
  const S = 4; // supersamples per axis
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = colorAt((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(r / (S * S)); raw[o + 1] = Math.round(g / (S * S)); raw[o + 2] = Math.round(b / (S * S)); raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return c ^ -1; }

for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png(size));
  console.log(`icons/icon-${size}.png`);
}
