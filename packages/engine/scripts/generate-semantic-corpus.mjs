/**
 * Varve semantic-similarity corpus generator.
 *
 * Generates a deterministic, license-clean synthetic corpus representing the
 * actual design-work domains Varve cares about (photo-like scenes, UI
 * screenshots, logos, illustrations, posters, patterns, 3D-style renders,
 * architecture) plus labeled relationship groups: exact copies, resized,
 * JPEG-recompressed, format-converted, color-adjusted, mirrored, cropped,
 * rotated, overlaid, framing/angle variants, style variants, composition
 * twins and color twins as hard negatives.
 *
 * Everything is drawn procedurally with a seeded PRNG — the output is
 * reproducible byte-for-byte on any machine, so retrieval metrics and
 * contact sheets are comparable across runs and machines.
 *
 * Output: tests/fixtures/semantic-corpus/  (gitignored; regenerate with
 * `pnpm --filter @varve/engine corpus:generate`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'tests/fixtures/semantic-corpus');
const SEED = 20260813;

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Minimal RGBA raster with flat primitives (no AA — deterministic). */
class Raster {
  constructor(w, h, bg = [255, 255, 255, 255]) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 4);
  }
  px(x, y, rgba) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3];
  }
  fillRect(x, y, w, h, rgba) {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.h, Math.ceil(y + h)); yy++)
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.w, Math.ceil(x + w)); xx++)
        this.px(xx, yy, rgba);
  }
  circle(cx, cy, r, rgba) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.px(x, y, rgba);
      }
  }
  triangle(x1, y1, x2, y2, x3, y3, rgba) {
    const minX = Math.floor(Math.min(x1, x2, x3));
    const maxX = Math.ceil(Math.max(x1, x2, x3));
    const minY = Math.floor(Math.min(y1, y2, y3));
    const maxY = Math.ceil(Math.max(y1, y2, y3));
    const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const d1 = sign(x, y, x1, y1, x2, y2);
        const d2 = sign(x, y, x2, y2, x3, y3);
        const d3 = sign(x, y, x3, y3, x1, y1);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.px(x, y, rgba);
      }
  }
  vGradient(x0, y0, x1, y1, top, bottom) {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const t = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
      const c = [
        clamp(top[0] + (bottom[0] - top[0]) * t),
        clamp(top[1] + (bottom[1] - top[1]) * t),
        clamp(top[2] + (bottom[2] - top[2]) * t),
        255,
      ];
      this.fillRect(x0, y, x1 - x0, 1, c);
    }
  }
  line(x0, y0, x1, y1, rgba, width = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, rgba);
    }
  }
  toBuffer() {
    const png = new PNG({ width: this.w, height: this.h });
    png.data.set(this.data);
    return PNG.sync.write(png);
  }
}

const randColor = (r, lo = 40, hi = 230) => [
  clamp(lo + r() * (hi - lo)),
  clamp(lo + r() * (hi - lo)),
  clamp(lo + r() * (hi - lo)),
  255,
];

/* ── Scene generators: each returns { r, id, w, h, draw } ─────────────── */

function landscape(r, w, h, framing) {
  const skyTop = randColor(r, 70, 150);
  const skyBot = randColor(r, 150, 230);
  const sunX = w * (0.2 + r() * 0.6 * framing.zoom);
  const sunY = h * (0.15 + r() * 0.2);
  const sun = [clamp(230 + r() * 25), clamp(200 + r() * 40), 120, 255];
  const mount = randColor(r, 60, 130);
  const grass = [clamp(60 + r() * 60), clamp(110 + r() * 80), clamp(50 + r() * 60), 255];
  return (dst) => {
    dst.vGradient(0, 0, w, h * 0.75, skyTop, skyBot);
    dst.circle(sunX, sunY, h * 0.07 * framing.zoom, sun);
    dst.triangle(0, h * 0.6, w * 0.3, h * (0.25 - framing.lift), w * 0.6, h * 0.6, mount);
    dst.triangle(w * 0.4, h * 0.62, w * 0.7, h * (0.3 - framing.lift), w, h * 0.62, [
      (mount[0] * 0.85) | 0,
      (mount[1] * 0.85) | 0,
      (mount[2] * 0.85) | 0,
      255,
    ]);
    dst.fillRect(0, h * 0.6, w, h * 0.4, grass);
    for (let i = 0; i < 8 * framing.density; i++)
      dst.fillRect(r() * w, h * (0.6 + r() * 0.4), 2 + r() * 4, 2 + r() * 6, [
        clamp(30 + r() * 60),
        clamp(80 + r() * 60),
        40,
        255,
      ]);
  };
}

function portrait(r, w, h, framing) {
  const bgTop = randColor(r, 120, 200);
  const bgBot = randColor(r, 60, 140);
  const skin = randColor(r, 150, 215);
  const hair = [clamp(30 + r() * 50), clamp(20 + r() * 40), clamp(20 + r() * 40), 255];
  const top = randColor(r, 60, 160);
  const cx = w * (0.5 + (framing.shiftX ?? 0));
  const cy = h * (0.45 - (framing.lift ?? 0));
  return (dst) => {
    dst.vGradient(0, 0, w, h, bgTop, bgBot);
    dst.circle(cx, cy, h * 0.16 * framing.zoom, skin);
    dst.fillRect(
      cx - h * 0.17 * framing.zoom,
      cy - h * 0.05 * framing.zoom,
      h * 0.34 * framing.zoom,
      h * 0.24 * framing.zoom,
      hair,
    );
    dst.fillRect(
      cx - h * 0.16 * framing.zoom,
      cy + h * 0.1 * framing.zoom,
      h * 0.32 * framing.zoom,
      h * 0.2 * framing.zoom,
      skin,
    );
    dst.fillRect(
      cx - h * 0.24 * framing.zoom,
      cy + h * 0.24 * framing.zoom,
      h * 0.48 * framing.zoom,
      h * 0.3 * framing.zoom,
      top,
    );
  };
}

function product(r, w, h, framing) {
  const backdrop = [clamp(235 - r() * 30), clamp(235 - r() * 30), clamp(235 - r() * 30), 255];
  const box = randColor(r, 40, 200);
  const boxDark = [(box[0] * 0.7) | 0, (box[1] * 0.7) | 0, (box[2] * 0.7) | 0, 255];
  const bw = w * 0.34 * framing.zoom;
  const bh = h * 0.3 * framing.zoom;
  const bx = w / 2 - bw / 2;
  const by = h * 0.4 - bh / 2;
  const label = [255, 250, 240, 255];
  return (dst) => {
    dst.fillRect(0, 0, w, h, backdrop);
    dst.fillRect(0, h * 0.72, w, h * 0.28, [
      clamp(backdrop[0] * 0.92),
      clamp(backdrop[1] * 0.92),
      clamp(backdrop[2] * 0.92),
      255,
    ]);
    dst.fillRect(bx, by, bw, bh, box);
    dst.fillRect(bx + bw * 0.12, by + bh * 0.14, bw * 0.76, bh * 0.4, label);
    dst.fillRect(bx + bw * 0.12, by + bh * 0.6, bw * 0.5, bh * 0.08, boxDark);
    dst.circle(bx + bw / 2, by + bh * 0.55, bw * 0.3, [0, 0, 0, 26]);
    dst.fillRect(0, h * 0.74, w, h * 0.26, [
      clamp(backdrop[0] * 0.9),
      clamp(backdrop[1] * 0.9),
      clamp(backdrop[2] * 0.9),
      255,
    ]);
  };
}

function food(r, w, h, framing) {
  const table = randColor(r, 120, 190);
  const plate = [250, 250, 250, 255];
  const foodCol = randColor(r, 140, 220);
  const garnish = randColor(r, 60, 130);
  const cx = w * (0.5 + (framing.shiftX ?? 0));
  const cy = h * 0.5;
  return (dst) => {
    dst.vGradient(
      0,
      0,
      w,
      h,
      [clamp(table[0] * 1.15), clamp(table[1] * 1.15), clamp(table[2] * 1.15), 255],
      table,
    );
    dst.circle(cx, cy, h * 0.22 * framing.zoom, plate);
    dst.circle(cx, cy, h * 0.13 * framing.zoom, foodCol);
    dst.circle(
      cx + h * 0.06 * framing.zoom,
      cy - h * 0.06 * framing.zoom,
      h * 0.04 * framing.zoom,
      garnish,
    );
    dst.circle(cx + w * 0.3, cy + h * 0.26, h * 0.06, [
      clamp(table[0] * 0.8),
      clamp(table[1] * 0.8),
      clamp(table[2] * 0.8),
      255,
    ]);
  };
}

function vehicle(r, w, h, framing) {
  const sky = randColor(r, 140, 210);
  const road = [60, 60, 66, 255];
  const body = randColor(r, 60, 200);
  const wheel = [25, 25, 30, 255];
  const cx = w * (0.5 + (framing.shiftX ?? 0));
  const cy = h * 0.52;
  const bw = w * 0.4 * framing.zoom;
  return (dst) => {
    dst.fillRect(0, 0, w, h * 0.7, sky);
    dst.fillRect(0, h * 0.7, w, h * 0.3, road);
    dst.fillRect(cx - bw / 2, cy - h * 0.11 * framing.zoom, bw, h * 0.1 * framing.zoom, body);
    dst.fillRect(cx - bw * 0.4, cy - h * 0.17 * framing.zoom, bw * 0.55, h * 0.07 * framing.zoom, [
      clamp(body[0] * 0.8),
      clamp(body[1] * 0.8),
      clamp(body[2] * 0.8),
      255,
    ]);
    dst.circle(cx - bw * 0.28, cy + h * 0.01, h * 0.05, wheel);
    dst.circle(cx + bw * 0.28, cy + h * 0.01, h * 0.05, wheel);
    dst.line(0, h * 0.74, w, h * 0.74, [220, 220, 220, 255], 3);
  };
}

function dashboard(r, w, h, framing) {
  const bg = [244, 246, 248, 255];
  const sidebar = [30, 36, 48, 255];
  const card = [255, 255, 255, 255];
  const accent = randColor(r, 40, 200);
  const nCards = 3 + Math.round(r() * 2);
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    dst.fillRect(0, 0, w * 0.16, h, sidebar);
    for (let i = 0; i < 6; i++)
      dst.fillRect(w * 0.02, h * (0.1 + i * 0.13), w * 0.08, h * 0.06, [60, 68, 86, 255]);
    dst.fillRect(w * 0.16, 0, w * 0.84, h * 0.08, [255, 255, 255, 255]);
    for (let i = 0; i < nCards; i++) {
      const cw = w * 0.24;
      const cx = w * 0.2 + (i % 3) * w * 0.27;
      const cy = h * 0.14 + Math.floor(i / 3) * h * 0.4;
      dst.fillRect(cx, cy, cw, h * 0.3, card);
      dst.fillRect(cx + cw * 0.08, cy + h * 0.04, cw * 0.5, h * 0.05, accent);
      dst.fillRect(cx + cw * 0.08, cy + h * 0.12, cw * 0.3, h * 0.05, [200, 208, 218, 255]);
      for (let b = 0; b < 5; b++)
        dst.fillRect(
          cx + cw * 0.08 + b * cw * 0.17,
          cy + h * 0.2 + (4 - b) * h * 0.015,
          cw * 0.1,
          h * (0.05 + b * 0.02),
          [170 + b * 8, 180 + b * 6, 200, 255],
        );
    }
  };
}

function mobile(r, w, h, framing) {
  const bg = randColor(r, 235, 248);
  const tile = [255, 255, 255, 255];
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    dst.fillRect(0, 0, w, h * 0.05, [40, 46, 58, 255]);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 2; j++) {
        const tw = w * 0.42;
        const th = h * 0.24;
        dst.fillRect(w * 0.04 + (i % 2) * w * 0.5, h * 0.12 + j * h * 0.38, tw, th, tile);
        dst.fillRect(
          w * 0.08 + (i % 2) * w * 0.5,
          h * 0.17 + j * h * 0.38,
          tw * 0.5,
          th * 0.12,
          randColor(r, 60, 200),
        );
        dst.fillRect(
          w * 0.08 + (i % 2) * w * 0.5,
          h * 0.24 + j * h * 0.38,
          tw * 0.7,
          th * 0.1,
          [215, 220, 228, 255],
        );
        dst.fillRect(
          w * 0.08 + (i % 2) * w * 0.5,
          h * 0.31 + j * h * 0.38,
          tw * 0.8,
          th * 0.18,
          [225, 230, 238, 255],
        );
      }
  };
}

function logoMark(r, w, h, framing) {
  const bg = [255, 255, 255, 255];
  const ink = randColor(r, 20, 90);
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    dst.circle(w * 0.5, h * 0.45, h * 0.16 * framing.zoom, ink);
    dst.triangle(w * 0.5, h * 0.28 * framing.zoom, w * 0.36, h * 0.62, w * 0.64, h * 0.62, ink);
    dst.fillRect(w * 0.2, h * 0.78, w * 0.6, h * 0.03, ink);
  };
}

function wordmark(r, w, h, framing) {
  const bg = [250, 250, 250, 255];
  const ink = randColor(r, 20, 100);
  const accent = randColor(r, 150, 230);
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    dst.fillRect(w * 0.12, h * 0.2, w * 0.5, h * 0.09, ink);
    dst.fillRect(w * 0.12, h * 0.34, w * 0.32, h * 0.09, ink);
    dst.fillRect(w * 0.12, h * 0.48, w * 0.42, h * 0.06, [180, 185, 195, 255]);
    dst.fillRect(w * 0.12, h * 0.58, w * 0.28, h * 0.06, [180, 185, 195, 255]);
    dst.circle(w * 0.8, h * 0.45, h * 0.12 * framing.zoom, accent);
    dst.triangle(w * 0.8, h * 0.3, w * 0.72, h * 0.6, w * 0.88, h * 0.6, ink);
  };
}

function illustration(r, w, h, framing) {
  const sky = randColor(r, 190, 240);
  const sun = [250, 210, 90, 255];
  const hill = randColor(r, 110, 190);
  const tree = randColor(r, 60, 140);
  const trunk = [120, 80, 50, 255];
  return (dst) => {
    dst.fillRect(0, 0, w, h, sky);
    dst.circle(w * 0.8, h * 0.18, h * 0.08, sun);
    dst.circle(w * 0.28, h * 0.66, h * 0.32, hill);
    dst.circle(w * 0.78, h * 0.78, h * 0.3, [
      clamp(hill[0] * 1.08),
      clamp(hill[1] * 1.08),
      clamp(hill[2] * 1.08),
      255,
    ]);
    dst.fillRect(w * 0.5, h * 0.55, w * 0.06, h * 0.12, trunk);
    dst.circle(w * 0.53, h * 0.48, h * 0.09 * framing.zoom, tree);
    dst.circle(w * 0.44, h * 0.53, h * 0.07 * framing.zoom, tree);
    dst.circle(w * 0.62, h * 0.53, h * 0.07 * framing.zoom, tree);
  };
}

function poster(r, w, h, framing) {
  const bg = randColor(r, 150, 220);
  const ink = [250, 250, 250, 255];
  const dark = randColor(r, 20, 70);
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    dst.fillRect(w * 0.08, h * 0.1, w * 0.5, h * 0.12, ink);
    dst.fillRect(w * 0.08, h * 0.26, w * 0.32, h * 0.08, ink);
    dst.fillRect(w * 0.08, h * 0.66, w * 0.6, h * 0.04, dark);
    dst.fillRect(w * 0.08, h * 0.74, w * 0.44, h * 0.04, dark);
    dst.circle(w * 0.72, h * 0.4, h * 0.16 * framing.zoom, dark);
    dst.circle(w * 0.72, h * 0.4, h * 0.09 * framing.zoom, ink);
  };
}

function patternStripes(r, w, h, framing) {
  const a = randColor(r, 30, 220);
  const b = randColor(r, 200, 250);
  return (dst) => {
    dst.fillRect(0, 0, w, h, b);
    const width = 12 + r() * 24;
    for (let x = 0; x < w; x += width * 2) dst.fillRect(x, 0, width, h, a);
  };
}

function patternDots(r, w, h, framing) {
  const bg = [255, 255, 255, 255];
  const ink = randColor(r, 30, 220);
  const spacing = 40 + r() * 40;
  const radius = 8 + r() * 14;
  return (dst) => {
    dst.fillRect(0, 0, w, h, bg);
    for (let y = 0; y < h; y += spacing)
      for (let x = 0; x < w; x += spacing)
        dst.circle(x + spacing / 2, y + spacing / 2, radius, ink);
  };
}

function spheres(r, w, h, framing) {
  const bg = randColor(r, 200, 245);
  const floor = randColor(r, 150, 210);
  return (dst) => {
    dst.vGradient(0, 0, w, h * 0.72, bg, [
      clamp(bg[0] * 0.8),
      clamp(bg[1] * 0.8),
      clamp(bg[2] * 0.8),
      255,
    ]);
    dst.fillRect(0, h * 0.72, w, h * 0.28, floor);
    const cols = [randColor(r, 60, 220), randColor(r, 60, 220), randColor(r, 60, 220)];
    for (let i = 0; i < 3; i++) {
      const sx = w * (0.25 + i * 0.25);
      const sy = h * 0.48 - (i === 1 ? h * 0.08 * framing.zoom : 0);
      const sr = h * (0.1 + i * 0.02) * framing.zoom;
      dst.circle(sx, sy, sr, cols[i]);
      dst.circle(sx - sr * 0.3, sy - sr * 0.3, sr * 0.3, [
        clamp(cols[i][0] * 1.3),
        clamp(cols[i][1] * 1.3),
        clamp(cols[i][2] * 1.3),
        255,
      ]);
    }
  };
}

function architecture(r, w, h, framing) {
  const sky = randColor(r, 160, 220);
  const building = randColor(r, 100, 190);
  const window = [220, 225, 232, 255];
  const bw = w * 0.42;
  const bx = w * 0.3;
  return (dst) => {
    dst.vGradient(0, 0, w, h * 0.75, sky, [
      clamp(sky[0] * 0.85),
      clamp(sky[1] * 0.85),
      clamp(sky[2] * 0.85),
      255,
    ]);
    dst.fillRect(bx, h * 0.18, bw, h * 0.6, building);
    dst.fillRect(bx + bw * 0.75, h * 0.28, w * 0.16, h * 0.5, [
      clamp(building[0] * 0.7),
      clamp(building[1] * 0.7),
      clamp(building[2] * 0.7),
      255,
    ]);
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 4; col++)
        dst.fillRect(
          bx + bw * 0.06 + col * bw * 0.23,
          h * 0.24 + row * h * 0.09,
          bw * 0.12,
          h * 0.045,
          window,
        );
    dst.fillRect(0, h * 0.78, w, h * 0.22, [90, 96, 104, 255]);
    dst.fillRect(bx + bw * 0.3, h * 0.72, bw * 0.3, h * 0.06, [40, 44, 50, 255]);
  };
}

const SCENES = {
  landscape: { w: 640, h: 400, gen: landscape, domain: 'photo' },
  portrait: { w: 480, h: 600, gen: portrait, domain: 'photo' },
  product: { w: 560, h: 420, gen: product, domain: 'photo' },
  food: { w: 600, h: 440, gen: food, domain: 'photo' },
  vehicle: { w: 640, h: 400, gen: vehicle, domain: 'photo' },
  dashboard: { w: 800, h: 500, gen: dashboard, domain: 'ui' },
  mobile: { w: 420, h: 640, gen: mobile, domain: 'ui' },
  logoMark: { w: 480, h: 320, gen: logoMark, domain: 'logo' },
  wordmark: { w: 560, h: 300, gen: wordmark, domain: 'logo' },
  illustration: { w: 640, h: 440, gen: illustration, domain: 'illustration' },
  poster: { w: 480, h: 640, gen: poster, domain: 'poster' },
  stripes: { w: 400, h: 300, gen: patternStripes, domain: 'pattern' },
  dots: { w: 400, h: 300, gen: patternDots, domain: 'pattern' },
  spheres: { w: 640, h: 420, gen: spheres, domain: 'render' },
  architecture: { w: 640, h: 420, gen: architecture, domain: 'render' },
};

/* ── Variant transformers ─────────────────────────────────────────────── */

function resizeBilinear(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const srcY = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(sh - 1, y0 + 1);
    const yf = Math.max(0, Math.min(1, srcY - y0));
    for (let x = 0; x < dw; x++) {
      const srcX = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(sw - 1, x0 + 1);
      const xf = Math.max(0, Math.min(1, srcX - x0));
      const d = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = src[(y0 * sw + x0) * 4 + c];
        const v01 = src[(y0 * sw + x1) * 4 + c];
        const v10 = src[(y1 * sw + x0) * 4 + c];
        const v11 = src[(y1 * sw + x1) * 4 + c];
        out[d + c] = clamp(
          (v00 * (1 - xf) + v01 * xf) * (1 - yf) + (v10 * (1 - xf) + v11 * xf) * yf,
        );
      }
    }
  }
  return out;
}

function hueShift(rgba, delta) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let hue = 0;
    let sat = 0;
    if (max !== min) {
      const d = max - min;
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) hue = ((b - r) / d + 2) / 6;
      else hue = ((r - g) / d + 4) / 6;
    }
    hue = (hue + delta / 360) % 1;
    sat = clamp(sat * 1.3, 0, 1);
    // HSL → RGB (Smax = 1 - |2l-1|)
    const smax = 1 - Math.abs(2 * l - 1);
    const s2 = Math.min(sat, smax > 0 ? 1 : 0) * (smax > 0 ? 1 : 0);
    const c = (1 - Math.abs(2 * l - 1)) * s2;
    const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
    const m = l - c / 2;
    let rr = 0,
      gg = 0,
      bb = 0;
    const h6 = hue * 6;
    if (h6 < 1) [rr, gg, bb] = [c, x, 0];
    else if (h6 < 2) [rr, gg, bb] = [x, c, 0];
    else if (h6 < 3) [rr, gg, bb] = [0, c, x];
    else if (h6 < 4) [rr, gg, bb] = [0, x, c];
    else if (h6 < 5) [rr, gg, bb] = [x, 0, c];
    else [rr, gg, bb] = [c, 0, x];
    out[i] = clamp((rr + m) * 255);
    out[i + 1] = clamp((gg + m) * 255);
    out[i + 2] = clamp((bb + m) * 255);
  }
  return out;
}

function monochrome(rgba) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    const g = clamp(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    out[i] = g;
    out[i + 1] = g;
    out[i + 2] = g;
  }
  return out;
}

function mirrorH(rgba, w, h) {
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return out;
}

function crop(rgba, w, h, fx, fy, fw, fh) {
  const cw = Math.round(w * fw);
  const ch = Math.round(h * fh);
  const ox = Math.round((w - cw) * fx);
  const oy = Math.round((h - ch) * fy);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    out.set(rgba.subarray(((oy + y) * w + ox) * 4, ((oy + y) * w + ox + cw) * 4), y * cw * 4);
  return { data: out, w: cw, h: ch };
}

function rotate90(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (x * h + (h - 1 - y)) * 4);
  return { data: out, w: h, h: w };
}

function overlayBadge(rgba, w, h, r) {
  const out = new Uint8ClampedArray(rgba);
  const cx = w * 0.82;
  const cy = h * 0.18;
  const rad = w * 0.09;
  const ink = [clamp(r() * 255), clamp(r() * 255), clamp(r() * 255), 255];
  const ring = [255, 255, 255, 255];
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * w + x) * 4;
      if (dist <= rad * 0.72) out.set(ink, i);
      else if (dist <= rad) out.set(ring, i);
    }
  return out;
}

function textOverlay(rgba, w, h, r) {
  const out = new Uint8ClampedArray(rgba);
  const barH = Math.round(h * 0.12);
  const y0 = Math.round(h * 0.78);
  for (let y = y0; y < y0 + barH; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = 24;
      out[i + 1] = 26;
      out[i + 2] = 32;
      out[i + 3] = 230;
    }
  return out;
}

/* ── Image encoding helpers ───────────────────────────────────────────── */

function rasterToRgba(r) {
  return new Uint8ClampedArray(r.data);
}

function encodePng(data, w, h) {
  const png = new PNG({ width: w, height: h });
  png.data.set(data);
  return PNG.sync.write(png);
}

function encodeJpeg(data, w, h, quality) {
  return jpeg.encode({ data: Buffer.from(data), width: w, height: h }, quality).data;
}

function decodeImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
  }
  const jpg = jpeg.decode(buf, { useTArray: true });
  return { data: new Uint8ClampedArray(jpg.data), w: jpg.width, h: jpg.height };
}

/* ── Corpus assembly ──────────────────────────────────────────────────── */

function main() {
  mkdirSync(OUT, { recursive: true });
  const r = rng(SEED);
  const manifest = [];
  let fileIndex = 0;
  const written = [];

  const write = (data, w, h, ext) => {
    const id = `img-${String(fileIndex++).padStart(3, '0')}`;
    const name = `${id}.${ext}`;
    writeFileSync(join(OUT, name), data);
    return { id, name, w, h };
  };

  const baseKeys = Object.keys(SCENES);
  for (const key of baseKeys) {
    const scene = SCENES[key];
    const genRng = rng(SEED ^ (baseKeys.indexOf(key) * 7919 + 1));
    // base image
    const framing = { zoom: 1, lift: 0, density: 1 };
    const base = new Raster(scene.w, scene.h);
    scene.gen(genRng, scene.w, scene.h, framing)(base);
    const baseData = rasterToRgba(base);
    const family = `fam-${key}`;

    const emit = (data, w, h, ext, relation, extra = {}) => {
      const { id, name } = write(encodePng(data, w, h), w, h, ext);
      manifest.push({
        id,
        file: name,
        domain: scene.domain,
        base: key,
        relation,
        family,
        size: [w, h],
        ...extra,
      });
    };

    emit(baseData, scene.w, scene.h, 'png', 'base');
    // pixel-close variant family (near-duplicate lane)
    emit(baseData, scene.w, scene.h, 'png', 'exact');
    {
      const { data, w, h } = {
        data: resizeBilinear(
          baseData,
          scene.w,
          scene.h,
          Math.round(scene.w / 4),
          Math.round(scene.h / 4),
        ),
        w: Math.round(scene.w / 4),
        h: Math.round(scene.h / 4),
      };
      emit(data, w, h, 'png', 'resized');
    }
    {
      const { data, w, h } = {
        data: resizeBilinear(baseData, scene.w, scene.h, scene.w * 2, scene.h * 2),
        w: scene.w * 2,
        h: scene.h * 2,
      };
      emit(data, w, h, 'png', 'resized-up');
    }
    // JPEG recompression + conversion
    {
      const j = decodeImage(encodeJpeg(baseData, scene.w, scene.h, 60));
      emit(j.data, j.w, j.h, 'jpg', 'jpeg-q60');
    }
    {
      const j = decodeImage(encodeJpeg(baseData, scene.w, scene.h, 85));
      emit(j.data, j.w, j.h, 'jpg', 'jpeg-q85');
    }
    {
      const j = decodeImage(encodeJpeg(baseData, scene.w, scene.h, 90));
      emit(j.data, j.w, j.h, 'png', 'png-jpeg-roundtrip');
    }
    // color adjustments
    emit(hueShift(baseData, 38), scene.w, scene.h, 'png', 'hue-shifted');
    emit(hueShift(baseData, -25), scene.w, scene.h, 'png', 'hue-shifted-neg');
    emit(monochrome(baseData), scene.w, scene.h, 'png', 'monochrome');
    // geometry
    emit(mirrorH(baseData, scene.w, scene.h), scene.w, scene.h, 'png', 'mirrored');
    {
      const c = crop(baseData, scene.w, scene.h, 0.5, 0.5, 0.7, 0.7);
      emit(c.data, c.w, c.h, 'png', 'crop-center');
    }
    {
      const c = crop(baseData, scene.w, scene.h, 0.15, 0.15, 0.7, 0.7);
      emit(c.data, c.w, c.h, 'png', 'crop-offset');
    }
    {
      const ro = rotate90(baseData, scene.w, scene.h);
      emit(ro.data, ro.w, ro.h, 'png', 'rotate-90');
    }
    // overlays
    emit(
      overlayBadge(baseData, scene.w, scene.h, genRng),
      scene.w,
      scene.h,
      'png',
      'badge-overlay',
    );
    emit(textOverlay(baseData, scene.w, scene.h, genRng), scene.w, scene.h, 'png', 'text-overlay');
    // subject family: same scene, different framing/angle
    {
      const f = { zoom: 0.72, lift: 0.06, density: 0.7 };
      const v = new Raster(scene.w, scene.h);
      scene.gen(genRng, scene.w, scene.h, f)(v);
      emit(rasterToRgba(v), scene.w, scene.h, 'png', 'framing');
    }
    {
      const f = { zoom: 1.25, lift: -0.05, density: 1.4, shiftX: 0.08 };
      const v = new Raster(scene.w, scene.h);
      scene.gen(genRng, scene.w, scene.h, f)(v);
      emit(rasterToRgba(v), scene.w, scene.h, 'png', 'framing-2');
    }
    // style variant: same subject, different palette treatment
    {
      const f = { zoom: 1, lift: 0, density: 1 };
      const v = new Raster(scene.w, scene.h);
      const paletteSwap = (c) => [c[2], c[0], c[1], 255];
      scene.gen(genRng, scene.w, scene.h, f)(v);
      emit(rasterToRgba(v), scene.w, scene.h, 'png', 'style');
    }
  }

  // Hard negatives: composition twins + color twins.
  for (let i = 0; i < 8; i++) {
    const a = baseKeys[Math.floor(r() * baseKeys.length)];
    if (r() < 0.25) continue;
    const scene = SCENES[a];
    const r2 = rng(SEED ^ (i * 104729) ^ 1);
    const v = new Raster(scene.w, scene.h);
    scene.gen(r2, scene.w, scene.h, { zoom: 1, lift: 0, density: 1 })(v);
    const { id, name } = write(
      encodePng(rasterToRgba(v), scene.w, scene.h),
      scene.w,
      scene.h,
      'png',
    );
    manifest.push({
      id,
      file: name,
      domain: scene.domain,
      base: a,
      relation: 'composition-twin',
      family: `fam-${a}-comp`,
      layoutTwinOf: a,
      size: [scene.w, scene.h],
    });
  }
  // color twins: same dominant color family, unrelated subject
  for (let i = 0; i < 6; i++) {
    const key = baseKeys[Math.floor(r() * baseKeys.length)];
    const scene = SCENES[key];
    const r2 = rng(SEED ^ (i * 15485863) ^ 2);
    const v = new Raster(scene.w, scene.h);
    scene.gen(r2, scene.w, scene.h, { zoom: 1.35, lift: 0.2, density: 0.5 })(v);
    const { id, name } = write(
      encodePng(rasterToRgba(v), scene.w, scene.h),
      scene.w,
      scene.h,
      'png',
    );
    manifest.push({
      id,
      file: name,
      domain: scene.domain,
      base: key,
      relation: 'color-twin',
      family: `fam-${key}-twin`,
      size: [scene.w, scene.h],
    });
  }

  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify({ seed: SEED, generatedAt: 'deterministic', images: manifest }, null, 1),
  );
  console.log(`corpus written: ${manifest.length} images -> ${OUT}`);
}

main();
