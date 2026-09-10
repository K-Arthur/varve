/**
 * Dithering stage for canonical export (Strata export pipeline, Phase 4).
 *
 * Distinct from halftone/AM-FM screening (`halftone.ts`, an artistic effect):
 * this module is the *technical* bit-depth / palette dithering stage that runs
 * just before encoding. It is never applied to full-colour PNG/JPEG output
 * without an explicit reason (a `dither.algorithm !== 'none'` setting).
 *
 * Determinism: a fixed `seed` produces byte-identical output. Error-diffusion
 * kernels are pure arithmetic; the ordered/blue-noise patterns are generated
 * from a seeded hash. `serpentine` mirrors the diffusion direction per row.
 *
 * Alpha: alpha is preserved as-is except pixels below `alphaThreshold` (which
 * are forced fully transparent so dithered colour never leaks into regions the
 * user intended as voids). Dithering never touches the alpha channel.
 */

import type { DitherAlgorithm, DitherChannelMode } from '@varve/shared';

export type { DitherAlgorithm, DitherChannelMode } from '@varve/shared';

export interface DitherImageOptions {
  algorithm?: DitherAlgorithm;
  /** 0..1 diffusion strength (error scaling) / ordered-pattern depth. */
  strength?: number;
  /** Target bit depth per channel after quantization (1..8; 8 = no quantize). */
  targetBitDepth?: number;
  serpentine?: boolean;
  /** Deterministic seed for ordered/blue-noise patterns. */
  seed?: number;
  channelMode?: DitherChannelMode;
  /** 0..1 alpha threshold; pixels below are forced fully transparent. */
  alphaThreshold?: number;
}

export interface DitherResult {
  imageData: ImageData;
  /** Number of distinct output colours (informational). */
  distinctColors: number;
}

interface KernelEntry {
  dx: number;
  dy: number;
  weight: number;
}

/** 1-row high kernels; mirrored horizontally for serpentine scanning. */
export const KERNELS: Record<
  'floyd-steinberg' | 'atkinson' | 'jarvis-judice-ninke' | 'stucki',
  KernelEntry[]
> = {
  'floyd-steinberg': [
    { dx: 1, dy: 0, weight: 7 / 16 },
    { dx: -1, dy: 1, weight: 3 / 16 },
    { dx: 0, dy: 1, weight: 5 / 16 },
    { dx: 1, dy: 1, weight: 1 / 16 },
  ],
  atkinson: [
    { dx: 1, dy: 0, weight: 1 / 8 },
    { dx: 2, dy: 0, weight: 1 / 8 },
    { dx: -1, dy: 1, weight: 1 / 8 },
    { dx: 0, dy: 1, weight: 1 / 8 },
    { dx: 1, dy: 1, weight: 1 / 8 },
    { dx: 0, dy: 2, weight: 1 / 8 },
  ],
  'jarvis-judice-ninke': [
    { dx: 1, dy: 0, weight: 7 / 48 },
    { dx: 2, dy: 0, weight: 5 / 48 },
    { dx: -2, dy: 1, weight: 3 / 48 },
    { dx: -1, dy: 1, weight: 5 / 48 },
    { dx: 0, dy: 1, weight: 7 / 48 },
    { dx: 1, dy: 1, weight: 5 / 48 },
    { dx: 2, dy: 1, weight: 3 / 48 },
    { dx: -2, dy: 2, weight: 1 / 48 },
    { dx: -1, dy: 2, weight: 3 / 48 },
    { dx: 0, dy: 2, weight: 5 / 48 },
    { dx: 1, dy: 2, weight: 3 / 48 },
    { dx: 2, dy: 2, weight: 1 / 48 },
  ],
  stucki: [
    { dx: 1, dy: 0, weight: 8 / 42 },
    { dx: 2, dy: 0, weight: 4 / 42 },
    { dx: -2, dy: 1, weight: 2 / 42 },
    { dx: -1, dy: 1, weight: 4 / 42 },
    { dx: 0, dy: 1, weight: 8 / 42 },
    { dx: 1, dy: 1, weight: 4 / 42 },
    { dx: 2, dy: 1, weight: 2 / 42 },
    { dx: -2, dy: 2, weight: 1 / 42 },
    { dx: -1, dy: 2, weight: 2 / 42 },
    { dx: 0, dy: 2, weight: 4 / 42 },
    { dx: 1, dy: 2, weight: 2 / 42 },
    { dx: 2, dy: 2, weight: 1 / 42 },
  ],
};

const LUMINANCE: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** Recursively construct a Bayer threshold matrix of `size` (2/4/8). */
export function bayerThresholdMatrix(size: number): Uint16Array {
  let matrix = new Uint16Array([0]);
  while (matrix.length < size * size) {
    const n = matrix.length;
    const next = new Uint16Array(n * n * 4);
    const nextN = n * 2;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const v = matrix[y * n + x]!;
        next[y * nextN + x] = v * 4;
        next[y * nextN + x + n] = v * 4 + 2;
        next[(y + n) * nextN + x] = v * 4 + 3;
        next[(y + n) * nextN + x + n] = v * 4 + 1;
      }
    }
    matrix = next;
  }
  return matrix;
}

/** Deterministic integer hash → 0..1 (used for blue-noise thresholds). */
function hash01(x: number, y: number, seed: number): number {
  let h = (seed * 374761393 + x * 668265263) ^ (y * 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function quantizeToBits(value: number, bits: number): number {
  const levels = (1 << bits) - 1;
  return Math.round(value * levels) / levels;
}

/**
 * Apply technical dithering + quantization. When `targetBitDepth` is 8 and no
 * algorithm is selected, the image is returned untouched.
 */
export function ditherImageData(source: ImageData, options: DitherImageOptions = {}): DitherResult {
  const algorithm = options.algorithm ?? 'none';
  const strength = options.strength ?? 1;
  const targetBitDepth = options.targetBitDepth ?? 8;
  const serpentine = options.serpentine ?? true;
  const seed = options.seed ?? 0;
  const channelMode = options.channelMode ?? 'all';
  const alphaThreshold = options.alphaThreshold ?? 0;

  const w = source.width;
  const h = source.height;
  const out = new Uint8ClampedArray(source.data);

  if (algorithm === 'none' || targetBitDepth >= 8) {
    const distinctColors = countDistinct(out, w, h);
    return { imageData: new ImageData(out, w, h), distinctColors };
  }

  const levels = (1 << targetBitDepth) - 1;
  const step = 1 / levels;
  const gray = channelMode === 'luminance';

  if (algorithm === 'bayer-2' || algorithm === 'bayer-4' || algorithm === 'bayer-8') {
    const size = algorithm === 'bayer-2' ? 2 : algorithm === 'bayer-4' ? 4 : 8;
    const matrix = bayerThresholdMatrix(size);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        const a = source.data[o + 3] as number;
        if (a / 255 < alphaThreshold) {
          out[o + 3] = 0;
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
          continue;
        }
        // Bayer threshold in 0..1; offset by seed so different seeds shift the
        // pattern phase deterministically.
        const t = (matrix[(y % size) * size + (x % size)]! + 0.5) / (size * size);
        const threshold = (t + (seed % 1000) / 1000 - 0.5) * strength;
        if (gray) {
          const v = luma(source.data, o);
          const q = quantizeToBits(v + (threshold - 0.5) * 0.5 * step * 4, targetBitDepth);
          const cv = Math.round(clamp01(q) * 255);
          out[o] = cv;
          out[o + 1] = cv;
          out[o + 2] = cv;
        } else {
          out[o] = bayerChannel(source.data[o]! / 255, threshold, targetBitDepth);
          out[o + 1] = bayerChannel(source.data[o + 1]! / 255, threshold, targetBitDepth);
          out[o + 2] = bayerChannel(source.data[o + 2]! / 255, threshold, targetBitDepth);
        }
        out[o + 3] = a;
      }
    }
    return { imageData: new ImageData(out, w, h), distinctColors: countDistinct(out, w, h) };
  }

  if (algorithm === 'blue-noise') {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        const a = source.data[o + 3] as number;
        if (a / 255 < alphaThreshold) {
          out[o + 3] = 0;
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
          continue;
        }
        const noise = hash01(x, y, seed) - 0.5;
        const threshold = noise * strength * step;
        if (gray) {
          const v = luma(source.data, o);
          const q = quantizeToBits(v + threshold, targetBitDepth);
          const cv = Math.round(clamp01(q) * 255);
          out[o] = cv;
          out[o + 1] = cv;
          out[o + 2] = cv;
        } else {
          out[o] = channelWithNoise(source.data[o]! / 255, threshold, targetBitDepth);
          out[o + 1] = channelWithNoise(source.data[o + 1]! / 255, threshold, targetBitDepth);
          out[o + 2] = channelWithNoise(source.data[o + 2]! / 255, threshold, targetBitDepth);
        }
        out[o + 3] = a;
      }
    }
    return { imageData: new ImageData(out, w, h), distinctColors: countDistinct(out, w, h) };
  }

  // Error diffusion (Floyd-Steinberg / Atkinson / Jarvis / Stucki).
  const kernel = KERNELS[algorithm as keyof typeof KERNELS];
  const errR = new Float32Array(w * h);
  const errG = new Float32Array(w * h);
  const errB = new Float32Array(w * h);

  for (let y = 0; y < h; y += 1) {
    const leftToRight = !serpentine || y % 2 === 0;
    for (let stepX = 0; stepX < w; stepX += 1) {
      const x = leftToRight ? stepX : w - 1 - stepX;
      const o = (y * w + x) * 4;
      const a = source.data[o + 3] as number;
      if (a / 255 < alphaThreshold) {
        out[o + 3] = 0;
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        continue;
      }
      const eo = y * w + x;
      let r = source.data[o]! / 255 + (errR[eo] ?? 0) * strength;
      let g = source.data[o + 1]! / 255 + (errG[eo] ?? 0) * strength;
      let b = source.data[o + 2]! / 255 + (errB[eo] ?? 0) * strength;
      if (gray) {
        const v = luma(source.data, o);
        r = g = b = v;
      }
      const qr = quantizeToBits(r, targetBitDepth);
      const qg = quantizeToBits(g, targetBitDepth);
      const qb = quantizeToBits(b, targetBitDepth);
      out[o] = Math.round(clamp01(qr) * 255);
      out[o + 1] = Math.round(clamp01(qg) * 255);
      out[o + 2] = Math.round(clamp01(qb) * 255);
      out[o + 3] = a;

      const er = (r - qr) * strength;
      const eg = (g - qg) * strength;
      const eb = (b - qb) * strength;
      for (const entry of kernel) {
        const nx = leftToRight ? x + entry.dx : x - entry.dx;
        const ny = y + entry.dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const ne = ny * w + nx;
        errR[ne] = (errR[ne] ?? 0) + er * entry.weight;
        errG[ne] = (errG[ne] ?? 0) + eg * entry.weight;
        errB[ne] = (errB[ne] ?? 0) + eb * entry.weight;
      }
    }
  }

  return { imageData: new ImageData(out, w, h), distinctColors: countDistinct(out, w, h) };
}

function bayerChannel(value: number, threshold: number, bits: number): number {
  const biased = value + threshold;
  return Math.round(clamp01(quantizeToBits(biased, bits)) * 255);
}

function channelWithNoise(value: number, noise: number, bits: number): number {
  return Math.round(clamp01(quantizeToBits(value + noise, bits)) * 255);
}

function luma(data: Uint8ClampedArray, o: number): number {
  return (
    (LUMINANCE[0] * (data[o] as number) +
      LUMINANCE[1] * (data[o + 1] as number) +
      LUMINANCE[2] * (data[o + 2] as number)) /
    255
  );
}

function countDistinct(data: Uint8ClampedArray, w: number, h: number): number {
  const seen = new Set<number>();
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    seen.add((data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!);
  }
  return seen.size;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
