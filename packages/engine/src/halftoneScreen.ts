/**
 * Halftone screening core (algorithm version 2).
 *
 * Shared by the Halftone adjustment (mono + CMYK process screening) and the
 * Color Halftone object filter so both use one geometry/tone contract:
 *
 *   - The screen cell period is derived from the document unit model
 *     (96 px per inch, see @varve/shared `units.ts`), not a hardcoded 72.
 *   - Threshold matrices cover exactly ONE screen cell and are sampled per
 *     output pixel inside that cell, so the rendered period equals the
 *     requested period at any zoom or export scale.
 *   - Matrix values are rank-equalized over the cell samples, which makes the
 *     inked pixel fraction equal to the source tone (Krita's "template based
 *     equalization") and removes the small-cell quantization error of the
 *     analytic spot function.
 *   - Screen phase is anchored in document coordinates: the caller converts
 *     output pixels to document coordinates and supplies the region origin,
 *     so panning, zooming, tiling, and export never shift the pattern or
 *     change its physical frequency.
 *
 * Research basis: Ulichney, "Digital Halftoning" (1987); Ulichney,
 * "The void-and-cluster method for dither array generation" (1993);
 * Krita Screentone generator reference (resolution size mode, equalization,
 * macrocell alignment); GIMP Newsprint (per-channel period/angle, black
 * pullout). All implementations here are original.
 */

import { UNIT_TO_PX } from '@varve/shared';

/** Shapes the screening core can render as a clustered-dot spot field. */
export type ScreenShape =
  | 'round'
  | 'elliptical'
  | 'square'
  | 'diamond'
  | 'line'
  | 'cross'
  | 'circle';

/**
 * Document pixels per physical inch. Varve world units are CSS px at the
 * fixed 96 ppi physical mapping (see `units.ts`), so a requested line screen
 * of F lines/inch has a cell period of 96 / F document px.
 */
export const DOC_PIXELS_PER_INCH = UNIT_TO_PX.in;

export const STANDARD_SCREEN_ANGLES: Record<'c' | 'm' | 'y' | 'k', number> = {
  c: 15,
  m: 75,
  y: 0,
  k: 45,
};

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Finite, sane line screen frequency (LPI). */
export function sanitizeLineScreen(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 45;
  return Math.max(1, Math.min(1000, value));
}

/** Document-space cell period in px for a line screen frequency. */
export function docCellPeriod(lineScreen: number): number {
  return DOC_PIXELS_PER_INCH / sanitizeLineScreen(lineScreen);
}

/**
 * Threshold-matrix resolution for a given output resolution. One matrix
 * sample per device pixel (clamped to [8, 128]) keeps the dot edge crisp
 * without regenerating per pixel. The value only affects antialiasing
 * resolution, never the requested period.
 */
export function screenMatrixSize(cellPeriodDoc: number, pixelScale = 1): number {
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const cellDevicePx = Math.max(0.05, cellPeriodDoc) * scale;
  return Math.max(4, Math.min(128, Math.round(cellDevicePx)));
}

/**
 * Scalar spot field over the normalized cell [-1, 1]^2. Only the ORDER of
 * values matters (equalization assigns thresholds by rank), so each shape is
 * a monotone-ish distance field that reaches its maximum at the shape's last
 * covered corner. This makes every shape tone-accurate and endpoint-complete:
 * tone 0 inks nothing, tone 1 inks the full cell.
 */
export function shapeField(dx: number, dy: number, shape: ScreenShape): number {
  switch (shape) {
    case 'round':
      return dx * dx + dy * dy;
    case 'elliptical':
      return dx * dx * 1.5 + dy * dy * 0.67;
    case 'square':
      return Math.max(Math.abs(dx), Math.abs(dy));
    case 'diamond':
      return (Math.abs(dx) + Math.abs(dy)) / Math.SQRT2;
    case 'line':
      return Math.abs(dy);
    case 'cross': {
      const axis = Math.min(Math.abs(dx), Math.abs(dy));
      const radial = Math.sqrt(dx * dx + dy * dy);
      return radial + axis * 0.5;
    }
    case 'circle': {
      const rad = Math.sqrt(dx * dx + dy * dy);
      return rad + Math.sin(rad * Math.PI * 6) * 0.3;
    }
  }
}

/**
 * Build a rank-equalized threshold matrix covering one screen cell.
 * Values live in [1, 255]: a 0-tone source inks nothing (0 >= 1 false) and a
 * 255-tone source inks every sample (255 >= 255 true).
 */
export function generateEqualizedMatrix(size: number, shape: ScreenShape): Uint8Array {
  const n = size * size;
  const field = new Float64Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      field[y * size + x] = shapeField(dx, dy, shape);
    }
  }

  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Deterministic ascending order with index tie-break.
  const sorted = Array.from(order).sort((a, b) => {
    const delta = field[a]! - field[b]!;
    return delta !== 0 ? delta : a - b;
  });

  const matrix = new Uint8Array(n);
  for (let rank = 0; rank < n; rank++) {
    const value = Math.round((255 * (rank + 0.5)) / n);
    matrix[sorted[rank]!] = Math.max(1, Math.min(255, value));
  }
  return matrix;
}

const MATRIX_CACHE_LIMIT = 48;
const matrixCache = new Map<string, Uint8Array>();

/** Memoized equalized matrix. Callers must not mutate the returned array. */
export function cachedScreenMatrix(size: number, shape: ScreenShape): Uint8Array {
  const key = `${size}:${shape}`;
  const cached = matrixCache.get(key);
  if (cached) return cached;
  const matrix = generateEqualizedMatrix(size, shape);
  if (matrixCache.size >= MATRIX_CACHE_LIMIT) {
    const oldest = matrixCache.keys().next().value;
    if (oldest !== undefined) matrixCache.delete(oldest);
  }
  matrixCache.set(key, matrix);
  return matrix;
}

/**
 * Sample the threshold field at a document-space point. `cos`/`sin` are the
 * channel's screen rotation precomputed by the caller.
 *
 * The matrix resolution is chosen so that output pixels in a cell land on
 * distinct matrix samples, and rank equalization makes the inked pixel
 * fraction of a flat tone exact at that resolution. Rotation selects a
 * rotated lattice of samples; at very small cells the area estimate then
 * carries a small angle-dependent bias, which soft edges and export
 * resolution reduce (see docs/architecture/halftone-system.md).
 */
export function sampleScreenThreshold(
  matrix: Uint8Array,
  size: number,
  docX: number,
  docY: number,
  cos: number,
  sin: number,
  cellPeriod: number,
): number {
  const rx = docX * cos - docY * sin;
  const ry = docX * sin + docY * cos;
  const u = rx / cellPeriod;
  const v = ry / cellPeriod;
  const fu = u - Math.floor(u);
  const fv = v - Math.floor(v);
  // Epsilon: exact ratios such as 13/6 produce 0.16666666666666652, whose
  // *size product falls just below the integer lattice point and would
  // otherwise shift a cell's sample set by one row/column (visible as
  // per-cell tone drift).
  let mx = Math.floor(fu * size + 1e-9);
  let my = Math.floor(fv * size + 1e-9);
  if (mx >= size) mx = size - 1;
  else if (mx < 0) mx = 0;
  if (my >= size) my = size - 1;
  else if (my < 0) my = 0;
  return matrix[my * size + mx]!;
}

/**
 * Ink coverage in [0, 1] for one ink at a document position.
 *
 * @param density  Ink density 0..255 (255 = full ink) AFTER dot-gain
 *                 compensation has been folded in by the caller.
 * @param threshold Threshold control (0..255): higher values require more
 *                  density, i.e. deposit less ink.
 * @param softness  0 = hard binary; > 0 blends linearly around the boundary.
 */
export function coverageAt(
  density: number,
  thresholdValue: number,
  threshold: number,
  softness: number,
): number {
  const clampedDensity = density <= 0 ? 0 : density >= 255 ? 255 : density;
  const adjusted = clampedDensity - (threshold - 128);
  if (softness > 0) {
    // Edge anti-aliasing must not leak ink outside the tone range: a source
    // with zero effective density stays clean paper, and full density stays
    // solid, regardless of how soft the edge is. The epsilon absorbs
    // floating-point residue from luma math such as 255 - (0.2126*255 + ...).
    if (adjusted <= 1e-6) return 0;
    if (adjusted >= 255 - 1e-6) return 1;
    const diff = adjusted - thresholdValue;
    const range = softness * 64;
    if (range > 0 && Math.abs(diff) < range) {
      return Math.max(0, Math.min(1, 0.5 + diff / (range * 2)));
    }
    return diff >= 0 ? 1 : 0;
  }
  return adjusted >= thresholdValue ? 1 : 0;
}

/**
 * Dot-gain compensation in the ink domain. Dot gain adds area around
 * midtones (maximum near 50% coverage); the model is c' = c + strength *
 * 4c(1-c), which leaves 0% and 100% fixed.
 */
export function applyDotGain(density: number, dotGain: number): number {
  if (!(dotGain > 0)) return density;
  const c = clamp01(density / 255);
  const gained = clamp01(c + dotGain * 4 * c * (1 - c));
  return gained * 255;
}

export function inkDensityFromCoverage(coverage: number): number {
  return clamp01(coverage) * 255;
}

// ── Blue-noise (void-and-cluster) threshold matrix ─────────────────────

const BLUE_NOISE_SIZE = 64;
const BLUE_NOISE_SEED = 0x5eed1234;
let blueNoiseMatrix: Uint8Array | null = null;

/** Memoized 64x64 blue-noise threshold matrix. Callers must not mutate it. */
export function cachedBlueNoiseMatrix(): Uint8Array {
  if (!blueNoiseMatrix) blueNoiseMatrix = generateBlueNoiseMatrix(BLUE_NOISE_SIZE);
  return blueNoiseMatrix;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blueNoiseMatrixSize(): number {
  return BLUE_NOISE_SIZE;
}

/**
 * Ulichney void-and-cluster ordered-dither array. Deterministic (fixed seed)
 * and maskable: periodic wrap means tiles seam-free for any offset.
 */
export function generateBlueNoiseMatrix(size: number): Uint8Array {
  const n = size * size;
  const random = mulberry32(BLUE_NOISE_SEED);
  const pattern = new Uint8Array(n);
  const minorityTarget = Math.max(1, Math.round(n / 8));
  let placed = 0;
  while (placed < minorityTarget) {
    const index = Math.floor(random() * n);
    if (pattern[index] === 0) {
      pattern[index] = 1;
      placed++;
    }
  }

  const radius = Math.max(3, Math.round(size / 8));
  const kernelSize = radius * 2 + 1;
  const sigma = size / 32;
  const kernel = new Float64Array(kernelSize * kernelSize);
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      kernel[(y + radius) * kernelSize + (x + radius)] = Math.exp(
        -(x * x + y * y) / (2 * sigma * sigma),
      );
    }
  }

  const field = new Float64Array(n);
  const applyKernel = (center: number, sign: number): void => {
    const cy = Math.floor(center / size);
    const cx = center - cy * size;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = (cy + dy + size) % size;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = (cx + dx + size) % size;
        const index = y * size + x;
        field[index] = field[index]! + sign * kernel[(dy + radius) * kernelSize + (dx + radius)]!;
      }
    }
  };

  for (let i = 0; i < n; i++) {
    if (pattern[i] === 1) applyKernel(i, 1);
  }

  const findCluster = (): number => {
    let best = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < n; i++) {
      if (pattern[i] === 1 && field[i]! > bestValue) {
        bestValue = field[i]!;
        best = i;
      }
    }
    return best;
  };
  const findVoid = (): number => {
    let best = -1;
    let bestValue = Infinity;
    for (let i = 0; i < n; i++) {
      if (pattern[i] === 0 && field[i]! < bestValue) {
        bestValue = field[i]!;
        best = i;
      }
    }
    return best;
  };

  // Relax the random pattern: move the tightest cluster into the largest void
  // until removing the cluster would itself create the largest void.
  for (;;) {
    const cluster = findCluster();
    if (cluster < 0) break;
    pattern[cluster] = 0;
    applyKernel(cluster, -1);
    const voidIndex = findVoid();
    if (voidIndex < 0 || voidIndex === cluster) {
      pattern[cluster] = 1;
      applyKernel(cluster, 1);
      break;
    }
    pattern[voidIndex] = 1;
    applyKernel(voidIndex, 1);
  }

  const relaxed = pattern.slice();
  const ranks = new Int32Array(n);
  ranks.fill(-1);

  // Phase 1: rank the relaxed minority pixels by removal order.
  let rank = minorityTarget - 1;
  for (let removed = 0; removed < minorityTarget; removed++) {
    const cluster = findCluster();
    if (cluster < 0) break;
    ranks[cluster] = rank--;
    pattern[cluster] = 0;
    applyKernel(cluster, -1);
  }

  // Restore the relaxed pattern and rank the majority pixels by insertion.
  pattern.set(relaxed);
  field.fill(0);
  for (let i = 0; i < n; i++) {
    if (pattern[i] === 1) applyKernel(i, 1);
  }
  for (let insertRank = minorityTarget; insertRank < n; insertRank++) {
    const voidIndex = findVoid();
    if (voidIndex < 0) break;
    ranks[voidIndex] = insertRank;
    pattern[voidIndex] = 1;
    applyKernel(voidIndex, 1);
  }

  const matrix = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const value = Math.round((255 * (ranks[i]! + 0.5)) / n);
    matrix[i] = Math.max(1, Math.min(255, value));
  }
  return matrix;
}
