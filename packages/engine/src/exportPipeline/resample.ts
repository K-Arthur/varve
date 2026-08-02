/**
 * Alpha-safe image resampling for canonical export (Strata export pipeline,
 * Phase 3).
 *
 * This is the canonical "resize the rendered surface" stage. It deliberately
 * does NOT reuse the upscale helpers in `imageEnhancement.ts` (upscale-only,
 * no downscale filter, no area averaging) — export needs a single resampler
 * that covers the full axis of algorithms and both directions.
 *
 * Guarantees:
 *  - Operates in premultiplied-alpha space, so hidden RGB stored under fully
 *    transparent pixels can never bleed into visible output and semi-transparent
 *    antialiased edges get no dark/bright fringes (W3C compositing §5).
 *  - Two-pass separable sampling with per-output-pixel weight normalization, so
 *    there is no overall brightness drift at edges or under heavy scaling.
 *  - Optional linear-light working space (IEC 61966-2-1 EOTF). Default is
 *    gamma-encoded (`srgb`), matching the rest of Strata's compositing and the
 *    conventional behavior of browser `drawImage`.
 *  - Deterministic `auto` algorithm selection (documented in
 *    `selectResamplingAlgorithm`).
 *  - Banded (tiled) processing with kernel overlap so large images run in
 *    bounded memory with no seams.
 */

import type { ExportWorkingSpace, ResamplingAlgorithm } from '@strata/shared';

export interface ResampleOptions {
  algorithm?: ResamplingAlgorithm;
  workingSpace?: ExportWorkingSpace;
  /** Explicit pixel-art hint; forces nearest/blocky output. */
  pixelArt?: boolean;
  /** Preserve exact integer scaling without interpolation. */
  integerScale?: boolean;
  /** Upper bound for any intermediate allocation, in pixels. */
  maxPixels?: number;
  /** Tile height (px) for bounded-memory processing; 0 = single pass. */
  tileHeight?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface ResampleResult {
  imageData: ImageData;
  /** The algorithm actually applied (resolves `auto`). */
  algorithm: Exclude<ResamplingAlgorithm, 'auto'>;
  /** Diagnostics: why `auto` chose what it chose. */
  resolutionLog: string[];
}

export interface SelectAlgorithmResult {
  algorithm: Exclude<ResamplingAlgorithm, 'auto'>;
  rationale: string[];
}

const DEFAULT_MAX_PIXELS = 64_000_000;

// ── sRGB EOTF / inverse (IEC 61966-2-1) ─────────────────────────────────────

/** Decode a normalized 0..1 sRGB-encoded value to linear light. */
function srgbToLinearFloat(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbFloat(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, v));
}

// ── Kernels ─────────────────────────────────────────────────────────────────

export interface Kernel {
  name: string;
  support: number;
  fn: (x: number) => number;
}

const triangle: Kernel = {
  name: 'bilinear',
  support: 1,
  fn: (x) => {
    const ax = Math.abs(x);
    return ax < 1 ? 1 - ax : 0;
  },
};

function cubic(B: number, C: number): Kernel {
  return {
    name: 'cubic',
    support: 2,
    fn: (x) => {
      const ax = Math.abs(x);
      if (ax < 1) {
        return (
          ((12 - 9 * B - 6 * C) * ax ** 3 + (-18 + 12 * B + 6 * C) * ax ** 2 + (6 - 2 * B)) / 6
        );
      }
      if (ax < 2) {
        return (
          ((-B - 6 * C) * ax ** 3 +
            (6 * B + 30 * C) * ax ** 2 +
            (-12 * B - 48 * C) * ax +
            (8 * B + 24 * C)) /
          6
        );
      }
      return 0;
    },
  };
}

const catmullRom: Kernel = cubic(0, 0.5);
const mitchell: Kernel = cubic(1 / 3, 1 / 3);

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos(a: number): Kernel {
  return {
    name: `lanczos${a}`,
    support: a,
    fn: (x) => {
      const ax = Math.abs(x);
      if (ax >= a) return 0;
      return sinc(x) * sinc(x / a);
    },
  };
}

const lanczos2: Kernel = lanczos(2);
const lanczos3: Kernel = lanczos(3);

/** Kernel lookup by canonical algorithm name. */
export function kernelFor(algorithm: Exclude<ResamplingAlgorithm, 'auto'>): Kernel | null {
  switch (algorithm) {
    case 'bilinear':
      return triangle;
    case 'bicubic':
    case 'catmull-rom':
      return catmullRom;
    case 'mitchell':
      return mitchell;
    case 'lanczos2':
      return lanczos2;
    case 'lanczos3':
      return lanczos3;
    default:
      return null; // nearest / pixel-art / area handled structurally
  }
}

// ── Auto algorithm selection ────────────────────────────────────────────────

/**
 * Deterministic automatic resampling selection.
 *
 * Rules (in order of precedence):
 *  1. Explicit pixel-art hint → nearest (blocky, integer-preserving).
 *  2. Significant downscale (dst <= 50% of src) → `area` (box average) to
 *     suppress aliasing on fine detail.
 *  3. Mild downscale (50%..100%) → `lanczos2` (sharp, low ringing).
 *  4. Upscale → `lanczos3` for photographic detail; unless the scale factor is
 *     an exact integer AND the content is pixel-art-like, in which case
 *     `nearest` avoids softening hard edges.
 *
 * The result is a pure function of its inputs — no randomness, no
 * platform-specific branches — so two runs on identical inputs pick the same
 * algorithm and produce byte-identical output.
 */
export function selectResamplingAlgorithm(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  options: Pick<ResampleOptions, 'pixelArt' | 'integerScale'> = {},
): SelectAlgorithmResult {
  const rationale: string[] = [];
  if (options.pixelArt) {
    rationale.push('explicit pixel-art hint → nearest');
    return { algorithm: 'nearest', rationale };
  }
  const sx = dstWidth / Math.max(1, srcWidth);
  const sy = dstHeight / Math.max(1, srcHeight);
  const scale = Math.min(sx, sy);
  if (scale >= 1) {
    const isInteger = Number.isInteger(sx) && Number.isInteger(sy) && sx === sy;
    if (options.integerScale && isInteger) {
      rationale.push('integer upscale with integerScale → nearest');
      return { algorithm: 'nearest', rationale };
    }
    rationale.push(`upscale (${(scale * 100).toFixed(0)}%) → lanczos3`);
    return { algorithm: 'lanczos3', rationale };
  }
  if (scale <= 0.5) {
    rationale.push(`heavy downscale (${(scale * 100).toFixed(0)}%) → area box filter`);
    return { algorithm: 'area', rationale };
  }
  rationale.push(`mild downscale (${(scale * 100).toFixed(0)}%) → lanczos2`);
  return { algorithm: 'lanczos2', rationale };
}

// ── Dimension resolution ────────────────────────────────────────────────────

export function computeResampleDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  options: { maxPixels?: number } = {},
): { width: number; height: number; scaleFactor: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('Source dimensions must be positive');
  }
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error('Target dimensions must be positive');
  }
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  let width = Math.max(1, Math.round(targetWidth));
  let height = Math.max(1, Math.round(targetHeight));
  let scaleFactor = 1;
  if (width * height > maxPixels) {
    scaleFactor = Math.sqrt(maxPixels / (width * height));
    width = Math.max(1, Math.floor(width * scaleFactor));
    height = Math.max(1, Math.floor(height * scaleFactor));
  }
  return { width, height, scaleFactor };
}

// ── Contribution weights ────────────────────────────────────────────────────

interface Contribution {
  index: number;
  weight: number;
}

/**
 * Build the contribution list for every output position along one axis.
 * `srcLen`/`dstLen` are pixel counts on that axis; `scale = srcLen / dstLen`.
 */
function buildAxisWeights(
  srcLen: number,
  dstLen: number,
  kernel: Kernel | null,
  area: boolean,
): Contribution[][] {
  const scale = srcLen / Math.max(1, dstLen);
  const weights: Contribution[][] = Array.from({ length: dstLen }, () => []);
  for (let j = 0; j < dstLen; j += 1) {
    const contributions: Contribution[] = [];
    if (area) {
      const x0 = j * scale;
      const x1 = (j + 1) * scale;
      const lo = Math.floor(x0);
      const hi = Math.ceil(x1) - 1;
      let sum = 0;
      for (let i = lo; i <= hi; i += 1) {
        const overlap = Math.min(x1, i + 1) - Math.max(x0, i);
        if (overlap <= 0) continue;
        const index = i < 0 ? 0 : i >= srcLen ? srcLen - 1 : i;
        contributions.push({ index, weight: overlap });
        sum += overlap;
      }
      if (sum > 0) for (const c of contributions) c.weight /= sum;
    } else if (kernel === null) {
      // nearest / pixel-art: sample the source pixel whose centre covers this
      // output pixel. floor((j+0.5)*scale) yields exact block replication for
      // integer upscales (pixel art) and a deterministic sample otherwise.
      const index = clamp(Math.floor((j + 0.5) * scale), 0, srcLen - 1);
      contributions.push({ index, weight: 1 });
    } else {
      // Resampling filter with area-preserving normalization. For downscale
      // (scale > 1) the filter is widened to cover `scale` source pixels and
      // normalized by 1/scale; for upscale (scale < 1) it is applied at source
      // resolution (each source pixel an impulse) with no normalization.
      const downscale = scale > 1;
      const center = (j + 0.5) * scale - 0.5;
      const radius = kernel.support * Math.max(scale, 1);
      const lo = Math.ceil(center - radius);
      const hi = Math.floor(center + radius);
      let sum = 0;
      for (let i = lo; i <= hi; i += 1) {
        const d = downscale ? (i - center) / scale : i - center;
        const w = downscale ? kernel.fn(d) / scale : kernel.fn(d);
        if (w === 0) continue;
        const index = i < 0 ? 0 : i >= srcLen ? srcLen - 1 : i;
        contributions.push({ index, weight: w });
        sum += w;
      }
      if (sum > 0) for (const c of contributions) c.weight /= sum;
    }
    weights[j] = contributions;
  }
  return weights;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ── Sampling helpers ────────────────────────────────────────────────────────

function sampleRowPremultiplied(
  row: Float32Array,
  dst: Float32Array,
  dstOffsetBase: number,
  x: number,
  weights: Contribution[][],
): void {
  const list = weights[x];
  if (!list) return;
  const dest = dstOffsetBase + x * 4;
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let aa = 0;
  for (const c of list) {
    const src = c.index * 4;
    const w = c.weight;
    ar += row[src]! * w;
    ag += row[src + 1]! * w;
    ab += row[src + 2]! * w;
    aa += row[src + 3]! * w;
  }
  dst[dest] = ar;
  dst[dest + 1] = ag;
  dst[dest + 2] = ab;
  dst[dest + 3] = aa;
}

function sampleColumnPremultiplied(
  intermediate: Float32Array,
  intermediateStride: number,
  x: number,
  y: number,
  weights: Contribution[][],
  rowBase: number,
  dst: Float32Array,
  dstOffset: number,
): void {
  const list = weights[y];
  if (!list) return;
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let aa = 0;
  for (const c of list) {
    const src = (c.index - rowBase) * intermediateStride + x * 4;
    const w = c.weight;
    ar += intermediate[src]! * w;
    ag += intermediate[src + 1]! * w;
    ab += intermediate[src + 2]! * w;
    aa += intermediate[src + 3]! * w;
  }
  dst[dstOffset] = ar;
  dst[dstOffset + 1] = ag;
  dst[dstOffset + 2] = ab;
  dst[dstOffset + 3] = aa;
}

// ── Main resample ───────────────────────────────────────────────────────────

/**
 * Resample `source` to `targetWidth` x `targetHeight` using the given
 * algorithm (or `auto` selection). See the module docs for guarantees.
 */
export function resampleImageData(
  source: ImageData,
  targetWidth: number,
  targetHeight: number,
  options: ResampleOptions = {},
): ResampleResult {
  const srcW = source.width;
  const srcH = source.height;
  const resolved = computeResampleDimensions(srcW, srcH, targetWidth, targetHeight, options);
  const dstW = resolved.width;
  const dstH = resolved.height;
  const log: string[] = [];
  if (resolved.scaleFactor < 1) {
    log.push(
      `target ${targetWidth}x${targetHeight} exceeded the ${options.maxPixels ?? DEFAULT_MAX_PIXELS}px budget; scaled to ${dstW}x${dstH}`,
    );
  }

  let algorithm: Exclude<ResamplingAlgorithm, 'auto'>;
  const requested = options.algorithm ?? 'auto';
  if (requested === 'auto') {
    const selection = selectResamplingAlgorithm(srcW, srcH, dstW, dstH, options);
    algorithm = selection.algorithm;
    log.push(...selection.rationale);
  } else if (requested === 'pixel-art') {
    algorithm = 'nearest';
    log.push('pixel-art → nearest');
  } else {
    algorithm = requested;
    log.push(`explicit ${requested}`);
  }

  const kernel = kernelFor(algorithm);
  const isArea = algorithm === 'area';
  const workingSpace = options.workingSpace ?? 'srgb';
  if (workingSpace === 'linear-srgb') {
    log.push('working space: linear-srgb (physical light)');
  }

  const tileHeight = options.tileHeight ?? 0;
  const bandRows = tileHeight > 0 ? Math.max(16, Math.round(tileHeight)) : srcH;

  // Horizontal contribution weights (source x -> dst x).
  const hWeights = buildAxisWeights(srcW, dstW, kernel, isArea);
  // Vertical contribution weights (source y -> dst y).
  const vWeights = buildAxisWeights(srcH, dstH, kernel, isArea);

  const progress = options.onProgress;
  const vScale = srcH / Math.max(1, dstH);
  const radiusSrc = isArea || kernel === null ? 0 : kernel.support * Math.max(vScale, 1);
  const total = dstH;
  let done = 0;

  // Premultiply + optional linearize into Float32 rows, band by band.
  const intermediateStride = dstW * 4;
  const srcRow = new Float32Array(srcW * 4);
  const dstRow = new Float32Array(dstW * 4);
  const outData = new Uint8ClampedArray(dstW * dstH * 4);

  for (let bandY0 = 0; bandY0 < dstH; bandY0 += bandRows) {
    const bandY1 = Math.min(dstH, bandY0 + bandRows);
    const srcY0 = Math.max(0, Math.floor((bandY0 + 0.5) * vScale - 0.5 - radiusSrc));
    const srcY1 = Math.min(srcH, Math.ceil((bandY1 - 1 + 0.5) * vScale - 0.5 + radiusSrc) + 1);

    // Bounded per-band intermediate: only this band's source rows are stored.
    const bandRowsCount = srcY1 - srcY0;
    const intermediate = new Float32Array(bandRowsCount * intermediateStride);

    // Horizontal pass for this band's source rows.
    for (let y = srcY0; y < srcY1; y += 1) {
      const srcOffset = y * srcW * 4;
      for (let x = 0; x < srcW; x += 1) {
        const o = srcOffset + x * 4;
        const a = source.data[o + 3] as number;
        const pa = a / 255;
        // Premultiplied channels are normalized to 0..1 (alpha stays 0..1) so
        // the vertical pass and unpremultiply math stay in a single scale.
        let r = ((source.data[o] as number) / 255) * pa;
        let g = ((source.data[o + 1] as number) / 255) * pa;
        let b = ((source.data[o + 2] as number) / 255) * pa;
        if (workingSpace === 'linear-srgb') {
          r = srgbToLinearFloat(r);
          g = srgbToLinearFloat(g);
          b = srgbToLinearFloat(b);
        }
        const d = x * 4;
        srcRow[d] = r;
        srcRow[d + 1] = g;
        srcRow[d + 2] = b;
        srcRow[d + 3] = pa;
      }
      const bandOffset = (y - srcY0) * intermediateStride;
      for (let x = 0; x < dstW; x += 1) {
        sampleRowPremultiplied(srcRow, intermediate, bandOffset, x, hWeights);
      }
    }

    // Vertical pass for this band's output rows.
    for (let y = bandY0; y < bandY1; y += 1) {
      for (let x = 0; x < dstW; x += 1) {
        sampleColumnPremultiplied(
          intermediate,
          intermediateStride,
          x,
          y,
          vWeights,
          srcY0,
          dstRow,
          x * 4,
        );
      }
      // Unpremultiply + optional de-linearize + quantize.
      for (let x = 0; x < dstW; x += 1) {
        const o = x * 4;
        const a = dstRow[o + 3] as number;
        const out = (y * dstW + x) * 4;
        if (a <= 0) {
          outData[out] = 0;
          outData[out + 1] = 0;
          outData[out + 2] = 0;
          outData[out + 3] = 0;
          continue;
        }
        let r = (dstRow[o] as number) / a;
        let g = (dstRow[o + 1] as number) / a;
        let b = (dstRow[o + 2] as number) / a;
        if (workingSpace === 'linear-srgb') {
          r = linearToSrgbFloat(r);
          g = linearToSrgbFloat(g);
          b = linearToSrgbFloat(b);
        }
        outData[out] = Math.round(clamp(r, 0, 1) * 255);
        outData[out + 1] = Math.round(clamp(g, 0, 1) * 255);
        outData[out + 2] = Math.round(clamp(b, 0, 1) * 255);
        outData[out + 3] = Math.round(clamp(a, 0, 1) * 255);
      }
      done += 1;
      progress?.(done, total);
    }
  }

  return {
    imageData: new ImageData(outData, dstW, dstH),
    algorithm,
    resolutionLog: log,
  };
}
