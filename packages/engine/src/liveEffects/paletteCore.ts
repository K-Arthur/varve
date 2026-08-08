/**
 * Shared quantization core for the Dither and Palette Snap effects.
 *
 * Owns: palette representation, color-distance metrics, nearest-color lookup
 * (with a uniform-grid LUT acceleration for large palettes), and palette
 * generation (median cut + k-means refinement). The Dither and Palette Snap
 * kernels both consume these primitives — nothing is duplicated.
 *
 * Metrics operate on 0..1 components internally so gamma/space conversion is
 * explicit and testable.
 */

import { linearSrgbToOklab } from '@varve/shared';
import { seeded01, srgbToLinear01 } from './prng';

export type PaletteColor = readonly [number, number, number];

export type ColorMetric = 'rgb' | 'linear-rgb' | 'lab' | 'oklab';

const LUT_GRID = 32;

/** Compute the squared distance between an sRGB byte color and a palette color. */
export function paletteDistance(
  r: number,
  g: number,
  b: number,
  pr: number,
  pg: number,
  pb: number,
  metric: ColorMetric,
): number {
  switch (metric) {
    case 'rgb': {
      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      return dr * dr + dg * dg + db * db;
    }
    case 'linear-rgb': {
      const lr = srgbToLinear01(r) - srgbToLinear01(pr);
      const lg = srgbToLinear01(g) - srgbToLinear01(pg);
      const lb = srgbToLinear01(b) - srgbToLinear01(pb);
      return lr * lr + lg * lg + lb * lb;
    }
    case 'lab':
    case 'oklab': {
      const [l1, a1, b1] = toLabSpace(r, g, b, metric);
      const [l2, a2, b2] = toLabSpace(pr, pg, pb, metric);
      const dl = l1 - l2;
      const da = a1 - a2;
      const db = b1 - b2;
      return dl * dl + da * da + db * db;
    }
  }
}

function toLabSpace(
  r: number,
  g: number,
  b: number,
  metric: ColorMetric,
): [number, number, number] {
  if (metric === 'oklab') {
    return linearSrgbToOklab([srgbToLinear01(r), srgbToLinear01(g), srgbToLinear01(b)]);
  }
  // Lab via XYZ D65 (matches @varve/shared analytical conversion path).
  const rl = srgbToLinear01(r);
  const gl = srgbToLinear01(g);
  const bl = srgbToLinear01(b);
  let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
  x /= 0.95047;
  z /= 1.08883;
  const fx = fLab(x);
  const fy = fLab(y);
  const fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function fLab(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/**
 * Nearest-palette lookup. For palettes above a size threshold a uniform-grid
 * LUT over sRGB cube is precomputed (32³ cells), so per-pixel lookup is O(1)
 * instead of O(paletteSize). The LUT is cached per (palette, metric) pair and
 * invalidated with the palette array identity.
 */
export interface PaletteLookup {
  readonly colors: PaletteColor[];
  readonly metric: ColorMetric;
  /** Nearest palette color for an sRGB byte triple. */
  find(r: number, g: number, b: number): PaletteColor;
}

const LUT_CACHE = new WeakMap<object, Map<ColorMetric, { lut: Uint16Array }>>();
const LUT_THRESHOLD = 24;

export function buildPaletteLookup(colors: PaletteColor[], metric: ColorMetric): PaletteLookup {
  if (colors.length === 0) {
    return { colors, metric, find: () => [0, 0, 0] };
  }
  if (colors.length < LUT_THRESHOLD) {
    return { colors, metric, find: (r, g, b) => nearestBrute(colors, metric, r, g, b) };
  }
  let byMetric = LUT_CACHE.get(colors);
  if (!byMetric) {
    byMetric = new Map();
    LUT_CACHE.set(colors, byMetric);
  }
  const cached = byMetric.get(metric);
  if (cached) {
    return { colors, metric, find: (r, g, b) => colors[cached.lut[gridIndex(r, g, b)]!]! };
  }
  const lut = new Uint16Array(LUT_GRID * LUT_GRID * LUT_GRID);
  const step = 256 / LUT_GRID;
  for (let ri = 0; ri < LUT_GRID; ri += 1) {
    for (let gi = 0; gi < LUT_GRID; gi += 1) {
      for (let bi = 0; bi < LUT_GRID; bi += 1) {
        const r = Math.round(ri * step + step / 2);
        const g = Math.round(gi * step + step / 2);
        const b = Math.round(bi * step + step / 2);
        const idx = (ri * LUT_GRID + gi) * LUT_GRID + bi;
        const [pr, pg, pb] = nearestBrute(colors, metric, r, g, b);
        lut[idx] = findIndexOf(colors, pr, pg, pb);
      }
    }
  }
  byMetric.set(metric, { lut });
  return { colors, metric, find: (r, g, b) => colors[lut[gridIndex(r, g, b)]!]! };
}

function gridIndex(r: number, g: number, b: number): number {
  const ri = Math.min(LUT_GRID - 1, Math.floor(r / (256 / LUT_GRID)));
  const gi = Math.min(LUT_GRID - 1, Math.floor(g / (256 / LUT_GRID)));
  const bi = Math.min(LUT_GRID - 1, Math.floor(b / (256 / LUT_GRID)));
  return (ri * LUT_GRID + gi) * LUT_GRID + bi;
}

function findIndexOf(colors: PaletteColor[], r: number, g: number, b: number): number {
  for (let i = 0; i < colors.length; i += 1) {
    const c = colors[i]!;
    if (c[0] === r && c[1] === g && c[2] === b) return i;
  }
  return 0;
}

function nearestBrute(
  colors: PaletteColor[],
  metric: ColorMetric,
  r: number,
  g: number,
  b: number,
): PaletteColor {
  let best = colors[0]!;
  let bestD = Infinity;
  for (let i = 0; i < colors.length; i += 1) {
    const c = colors[i]!;
    const d = paletteDistance(r, g, b, c[0], c[1], c[2], metric);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// ── Palette generation ─────────────────────────────────────────────────────

/**
 * Generate a palette from image data via median cut, optionally refined with
 * k-means iterations. Deterministic given (imageData, colorCount, metric,
 * seed): median cut never branches on random numbers and k-means seeds from
 * the deterministic PRNG.
 */
export function generatePalette(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  colorCount: number,
  metric: ColorMetric,
  seed: number,
): PaletteColor[] {
  const count = Math.max(1, Math.min(256, Math.round(colorCount)));
  const sample = samplePixels(pixels, w, h);
  if (sample.length === 0) return [[0, 0, 0]];
  const box: Box = { pixels: sample, rMin: 0, rMax: 255, gMin: 0, gMax: 255, bMin: 0, bMax: 255 };
  const leaves = medianCut(box, count);
  let palette = leaves.map((leaf) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [pr, pg, pb] of leaf.pixels) {
      r += pr;
      g += pg;
      b += pb;
    }
    const n = leaf.pixels.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as PaletteColor;
  });
  // K-means refinement with deterministic centroids from median cut.
  palette = kmeansRefine(palette, sample, 6, metric, seed);
  return palette;
}

interface Box {
  pixels: PaletteColor[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

function samplePixels(pixels: Uint8ClampedArray, w: number, h: number): PaletteColor[] {
  const out: PaletteColor[] = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 262144)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4;
      if (pixels[o + 3]! < 128) continue;
      out.push([pixels[o]!, pixels[o + 1]!, pixels[o + 2]!]);
    }
  }
  return out;
}

function medianCut(box: Box, target: number): Box[] {
  let boxes: Box[] = [box];
  while (boxes.length < target) {
    let largest = -1;
    let largestVolume = -1;
    for (let i = 0; i < boxes.length; i += 1) {
      const vol =
        (boxes[i]!.rMax - boxes[i]!.rMin + 1) *
        (boxes[i]!.gMax - boxes[i]!.gMin + 1) *
        (boxes[i]!.bMax - boxes[i]!.bMin + 1);
      if (vol > largestVolume) {
        largestVolume = vol;
        largest = i;
      }
    }
    if (largest < 0 || boxes[largest]!.pixels.length < 2) break;
    const split = splitBox(boxes[largest]!);
    if (!split) break;
    boxes = [...boxes.slice(0, largest), split[0], split[1], ...boxes.slice(largest + 1)];
  }
  return boxes;
}

function splitBox(box: Box): [Box, Box] | null {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  let channel: 'r' | 'g' | 'b' = 'r';
  if (gRange >= rRange && gRange >= bRange) channel = 'g';
  else if (bRange >= rRange && bRange >= gRange) channel = 'b';
  const sorted = [...box.pixels].sort(
    (a, b) =>
      a[channel === 'r' ? 0 : channel === 'g' ? 1 : 2] -
      b[channel === 'r' ? 0 : channel === 'g' ? 1 : 2],
  );
  const mid = Math.floor(sorted.length / 2);
  if (mid === 0) return null;
  const lo = sorted.slice(0, mid);
  const hi = sorted.slice(mid);
  const makeBox = (pixels: PaletteColor[]): Box => {
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;
    for (const [r, g, b] of pixels) {
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      if (g < gMin) gMin = g;
      if (g > gMax) gMax = g;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
    }
    return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
  };
  return [makeBox(lo), makeBox(hi)];
}

function kmeansRefine(
  centroids: PaletteColor[],
  samples: PaletteColor[],
  iterations: number,
  metric: ColorMetric,
  seed: number,
): PaletteColor[] {
  let centers = [...centroids];
  const rng = seed;
  for (let iter = 0; iter < iterations; iter += 1) {
    const sums = centers.map(() => [0, 0, 0, 0] as [number, number, number, number]);
    for (const [r, g, b] of samples) {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < centers.length; i += 1) {
        const c = centers[i]!;
        const d = paletteDistance(r, g, b, c[0], c[1], c[2], metric);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const s = sums[bestI]!;
      s[0] += r;
      s[1] += g;
      s[2] += b;
      s[3] += 1;
    }
    const next = centers.map((_c, i) => {
      const s = sums[i]!;
      if (s[3] === 0) {
        const jitter = Math.round(seeded01(rng + iter * 7919) * 255);
        return [jitter, jitter, jitter] as PaletteColor;
      }
      return [
        Math.round(s[0] / s[3]),
        Math.round(s[1] / s[3]),
        Math.round(s[2] / s[3]),
      ] as PaletteColor;
    });
    let changed = false;
    for (let i = 0; i < next.length; i += 1) {
      const a = next[i]!;
      const b = centers[i]!;
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) changed = true;
    }
    centers = next;
    if (!changed) break;
  }
  return centers;
}

/** Deduplicate palette colors (exact equality). */
export function dedupePalette(colors: PaletteColor[]): PaletteColor[] {
  const seen = new Set<number>();
  const out: PaletteColor[] = [];
  for (const c of colors) {
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Validate a palette from user input; drops malformed entries, caps size. */
export function sanitizePalette(colors: readonly (readonly number[])[]): PaletteColor[] {
  const out: PaletteColor[] = [];
  for (const c of colors) {
    if (!c || c.length < 3) continue;
    const r = Math.max(0, Math.min(255, Math.round(Number(c[0]) || 0)));
    const g = Math.max(0, Math.min(255, Math.round(Number(c[1]) || 0)));
    const b = Math.max(0, Math.min(255, Math.round(Number(c[2]) || 0)));
    out.push([r, g, b]);
    if (out.length >= 256) break;
  }
  return dedupePalette(out);
}
