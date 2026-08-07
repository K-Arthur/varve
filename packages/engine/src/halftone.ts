/**
 * Halftone screening engine — AM (amplitude modulation) and FM (frequency
 * modulation / stochastic) screening for print-quality halftone generation.
 *
 * Architecture:
 *   AM screening uses pre-computed threshold matrices (clustered-dot) at
 *   configurable LPI, angle, and dot shape. FM screening uses Floyd-Steinberg
 *   error diffusion for quality export and pre-computed blue-noise matrices
 *   for real-time preview.
 *
 * Research basis: Ulichney (Void-and-Cluster 1993), ISO 12647-2,
 *   Adobe Accurate Screens, Ghostscript gxht.c, Bart Wronski's
 *   BlueNoiseGenerator, Floyd-Steinberg error diffusion (1975).
 *
 * All operations work on linearized sRGB data for perceptual correctness.
 */

export type HalftonePattern = 'dot' | 'line' | 'cross' | 'circle';
export type HalftoneDotShape =
  | 'round'
  | 'elliptical'
  | 'square'
  | 'diamond'
  | 'line'
  | 'cross'
  | 'circle';
export type HalftoneChannel = 'k' | 'c' | 'm' | 'y' | 'cmyk';
export type HalftoneMethod = 'am' | 'fm';

export interface HalftoneParams {
  pattern: HalftonePattern;
  frequency: number;
  angle: number;
  dotShape: HalftoneDotShape;
  channel: HalftoneChannel;
  method: HalftoneMethod;
  /** Threshold midpoint (0-255, default 128). Higher = less ink (brighter output). */
  threshold?: number;
  /** Effect intensity 0-1 (default 1). Blends between original and halftoned. */
  intensity?: number;
  /** Dot edge softness 0-1 (default 0 = hard binary). Higher = anti-aliased edges. */
  softness?: number;
  /** Invert the halftone output (swap ink and paper). Default false. */
  invert?: boolean;
  /** Foreground (ink) color as [r, g, b] (default [0, 0, 0] = black). */
  foregroundColor?: [number, number, number];
  /** Background (paper) color as [r, g, b] (default [255, 255, 255] = white). */
  backgroundColor?: [number, number, number];
}

// ── Standard CMYK Screen Angles ────────────────────────────────────────

const STANDARD_ANGLES: Record<string, number> = {
  c: 15, // Cyan
  m: 75, // Magenta
  y: 0, // Yellow (least visible)
  k: 45, // Black (most visible)
};

// ── Threshold Matrix Cache ──────────────────────────────────────────────
//
// applyAMScreening previously regenerated the threshold matrix from scratch
// on every call (i.e. every render frame for a live preview), even though
// the matrix depends only on (size, dotShape) and the halftone parameters
// that drive `size` change far less often than frames render. Caching this
// pure computation avoids redundant O(size²) work per frame.
//
// The cached array is shared by reference and read-only by every consumer
// in this module — callers must not mutate a matrix returned from here.

const MATRIX_CACHE_LIMIT = 64;
const matrixCache = new Map<string, Uint8Array>();

export function cachedAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  const key = `${size}:${dotShape}`;
  const cached = matrixCache.get(key);
  if (cached) return cached;

  const matrix = generateAMMatrix(size, dotShape);
  if (matrixCache.size >= MATRIX_CACHE_LIMIT) {
    const oldestKey = matrixCache.keys().next().value;
    if (oldestKey !== undefined) matrixCache.delete(oldestKey);
  }
  matrixCache.set(key, matrix);
  return matrix;
}

// ── AM Screening ───────────────────────────────────────────────────────

/**
 * Generate a threshold matrix for AM screening.
 * Uses a clustered-dot approach where dots grow from cell centers.
 *
 * @param size Matrix size (must be power of 2, e.g., 32, 64, 128)
 * @param dotShape Shape of the halftone dot
 * @returns Uint8Array (size × size) with values 0-255
 */
export function generateAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  const matrix = new Uint8Array(size * size);
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x % size) - half + 0.5;
      const cy = (y % size) - half + 0.5;
      const dx = cx / half;
      const dy = cy / half;

      let dist: number;
      switch (dotShape) {
        case 'round':
          dist = Math.sqrt(dx * dx + dy * dy);
          break;
        case 'elliptical':
          // Elliptical: stretch along one axis for smoother midtones
          dist = Math.sqrt(dx * dx * 1.5 + dy * dy * 0.67);
          break;
        case 'square':
          dist = Math.max(Math.abs(dx), Math.abs(dy));
          break;
        case 'diamond':
          dist = (Math.abs(dx) + Math.abs(dy)) / Math.SQRT2;
          break;
        case 'line':
          // Line screen: threshold along one axis only
          dist = Math.abs(dy);
          break;
        case 'cross': {
          // Cross-shaped dot: extends further along x and y axes (+ shape)
          // Off-axis (diagonal) areas get higher thresholds so the cross
          // arms grow before the corners fill in.
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          const axisDist = Math.min(adx, ady);
          const radialDist = Math.sqrt(adx * adx + ady * ady);
          dist = radialDist + axisDist * 0.5;
          break;
        }
        case 'circle': {
          // Circle / bullseye dot: concentric ring (Fresnel-like) pattern.
          // The threshold alternates with radial distance, creating
          // concentric rings instead of a single growing dot cluster.
          const rad = Math.sqrt(dx * dx + dy * dy);
          const ringPhase = Math.sin(rad * Math.PI * 6);
          dist = rad + ringPhase * 0.3;
          break;
        }
        default:
          dist = Math.sqrt(dx * dx + dy * dy);
      }

      // Normalize to 0-255 threshold value
      const threshold = Math.max(0, Math.min(255, Math.round(dist * 255)));
      matrix[y * size + x] = threshold;
    }
  }
  return matrix;
}

/**
 * Apply AM screening to pixel data.
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters
 * @param pixelScale Resolution scale (1.0 for screen, higher for print export)
 */
/**
 * Screen a single ink channel at a given rotation and return whether the
 * ink dot is "on" (deposited) at document position (docX, docY).
 *
 * All coordinates are DOCUMENT-space (doc px): the caller converts image
 * pixels to document coordinates before calling. This makes the screen
 * phase invariant under viewport pan AND zoom — the same document position
 * always maps to the same matrix entry, and the cell count across an object
 * is independent of the zoom factor.
 */
function screenChannelAt(
  docX: number,
  docY: number,
  gray: number,
  angle: number,
  cellSize: number,
  matrix: Uint8Array,
  matrixSize: number,
  threshold: number,
  softness: number,
): number {
  const rad = (angle * Math.PI) / 180;
  // Rotate coordinates for screen angle
  const rx = docX * Math.cos(rad) - docY * Math.sin(rad);
  const ry = docX * Math.sin(rad) + docY * Math.cos(rad);
  const sx = Math.round(rx / cellSize) % matrixSize;
  const sy = Math.round(ry / cellSize) % matrixSize;
  const mx = ((sx % matrixSize) + matrixSize) % matrixSize;
  const my = ((sy % matrixSize) + matrixSize) % matrixSize;
  const matrixVal = matrix[my * matrixSize + mx]!;
  // Apply threshold shift
  const adjustedGray = gray - (threshold - 128);
  if (softness > 0) {
    // Soft (anti-aliased) threshold: linear blend around the threshold boundary
    const diff = adjustedGray - matrixVal;
    const range = softness * 64; // softness controls the blend range
    if (range > 0 && Math.abs(diff) < range) {
      return Math.max(0, Math.min(1, 0.5 + diff / (range * 2)));
    }
    return diff > 0 ? 1 : 0;
  }
  return adjustedGray > matrixVal ? 1 : 0;
}

/**
 * Convert an image-space pixel to document coordinates.
 *
 * @param x Image-space x (0..width)
 * @param y Image-space y (0..height)
 * @param pixelScale Image pixels per document pixel (1.0 at zoom 1 / doc res)
 * @param offsetX Document-space x origin of the image region
 * @param offsetY Document-space y origin of the image region
 */
function toDocCoord(
  x: number,
  y: number,
  pixelScale: number,
  offsetX: number,
  offsetY: number,
): [number, number] {
  return [x / pixelScale + offsetX, y / pixelScale + offsetY];
}

// ── Parameter sanitization ─────────────────────────────────────────────
//
// Persisted documents can contain malformed values (NaN from JSON round
// trips, hand-edited garbage, future-format extremes). Every screening
// entry point sanitizes its parameters so a bad value degrades to a safe
// default instead of silently blanking the output or throwing.

/** Clamp frequency to a finite, sane LPI (1–1000). NaN/Infinity → 45. */
function sanitizeFrequency(value: number | undefined): number {
  if (!Number.isFinite(value)) return 45;
  return Math.max(1, Math.min(1000, value));
}

/** Normalize an angle to a finite value in [0, 360). NaN/Infinity → 0. */
function sanitizeAngle(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

/** Clamp an 8-bit tone threshold; NaN/Infinity → 128. */
function sanitizeThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) return 128;
  return Math.max(0, Math.min(255, value));
}

/**
 * Apply AM screening to pixel data.
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters
 * @param pixelScale Image pixels per document pixel (1.0 at zoom 1; the
 *   live preview passes the camera scale so the screen resolves in device
 *   pixels while staying anchored in document space)
 * @param offsetX Document-space x origin of the image region (0 = image
 *   origin is the document origin)
 * @param offsetY Document-space y origin of the image region
 */
export function applyAMScreening(
  data: ImageData,
  params: HalftoneParams,
  pixelScale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0,
): void {
  const { dotShape, channel } = params;
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const threshold = sanitizeThreshold(params.threshold);
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 1));
  const softness = Math.max(0, Math.min(1, params.softness ?? 0));

  // Cell size is defined in DOCUMENT pixels (LPI is a physical-unit screen
  // frequency). Image-space rendering resolves it via pixelScale; the cell
  // count across any object is therefore zoom-invariant.
  const frequency = sanitizeFrequency(params.frequency);
  const cellSize = Math.max(1, Math.round(72 / frequency));
  const safeScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;

  // Generate threshold matrix for the dot shape
  const matrixSize = nextPowerOfTwo(cellSize * 2);
  const matrix = cachedAMMatrix(matrixSize, dotShape);

  if (intensity === 0) return;

  if (channel === 'cmyk') {
    // Screen each process-color ink independently (its own ink density and
    // its own standard screen angle), then recombine via subtractive
    // overprint into an RGB preview pixel. Alpha is left untouched — it is
    // not a fifth ink channel.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (pixels[idx + 3]! === 0) continue; // skip transparent

        const [docX, docY] = toDocCoord(x, y, safeScale, safeOffsetX, safeOffsetY);
        const c = screenChannelAt(
          docX,
          docY,
          getChannelLuminance(pixels, idx, 'c'),
          STANDARD_ANGLES.c!,
          cellSize,
          matrix,
          matrixSize,
          threshold,
          softness,
        );
        const m = screenChannelAt(
          docX,
          docY,
          getChannelLuminance(pixels, idx, 'm'),
          STANDARD_ANGLES.m!,
          cellSize,
          matrix,
          matrixSize,
          threshold,
          softness,
        );
        const yInk = screenChannelAt(
          docX,
          docY,
          getChannelLuminance(pixels, idx, 'y'),
          STANDARD_ANGLES.y!,
          cellSize,
          matrix,
          matrixSize,
          threshold,
          softness,
        );
        const k = screenChannelAt(
          docX,
          docY,
          getChannelLuminance(pixels, idx, 'k'),
          STANDARD_ANGLES.k!,
          cellSize,
          matrix,
          matrixSize,
          threshold,
          softness,
        );

        // Standard uncalibrated CMYK -> RGB overprint approximation.
        const nr = Math.round(255 * (1 - c) * (1 - k));
        const ng = Math.round(255 * (1 - m) * (1 - k));
        const nb = Math.round(255 * (1 - yInk) * (1 - k));

        if (intensity < 1) {
          pixels[idx] = Math.round(pixels[idx]! + (nr - pixels[idx]!) * intensity);
          pixels[idx + 1] = Math.round(pixels[idx + 1]! + (ng - pixels[idx + 1]!) * intensity);
          pixels[idx + 2] = Math.round(pixels[idx + 2]! + (nb - pixels[idx + 2]!) * intensity);
        } else {
          pixels[idx] = nr;
          pixels[idx + 1] = ng;
          pixels[idx + 2] = nb;
        }
        // pixels[idx + 3] (alpha) intentionally untouched.
      }
    }
    return;
  }

  // Single (mono) channel: halftone the luminance for that one channel.
  // Unlike the cmyk path (where fixed standard angles prevent moiré between
  // simultaneous screens), a single channel has no other screen to clash
  // with, so the user's own angle control fully governs screen rotation.
  const angle = sanitizeAngle(params.angle);
  const invert = params.invert ?? false;
  const fg = params.foregroundColor ?? [0, 0, 0];
  const bg = params.backgroundColor ?? [255, 255, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (pixels[idx + 3]! === 0) continue; // skip transparent

      const gray = getChannelLuminance(pixels, idx, channel);
      const [docX, docY] = toDocCoord(x, y, safeScale, safeOffsetX, safeOffsetY);
      let inkCoverage = screenChannelAt(
        docX,
        docY,
        gray,
        angle,
        cellSize,
        matrix,
        matrixSize,
        threshold,
        softness,
      );
      if (invert) inkCoverage = 1 - inkCoverage;
      // inkCoverage: 0 = no ink (paper color), 1 = full ink (foreground color)
      const fr = Math.round(bg[0] + (fg[0] - bg[0]) * inkCoverage);
      const fg_ = Math.round(bg[1] + (fg[1] - bg[1]) * inkCoverage);
      const fb = Math.round(bg[2] + (fg[2] - bg[2]) * inkCoverage);

      if (intensity < 1) {
        pixels[idx] = Math.round(pixels[idx]! + (fr - pixels[idx]!) * intensity);
        pixels[idx + 1] = Math.round(pixels[idx + 1]! + (fg_ - pixels[idx + 1]!) * intensity);
        pixels[idx + 2] = Math.round(pixels[idx + 2]! + (fb - pixels[idx + 2]!) * intensity);
      } else {
        pixels[idx] = fr;
        pixels[idx + 1] = fg_;
        pixels[idx + 2] = fb;
      }
    }
  }
}

// ── FM / Stochastic Screening ──────────────────────────────────────────

/**
 * Apply Floyd-Steinberg error diffusion dithering.
 * Processes left-to-right, top-to-bottom with serpentine scan.
 *
 * @param data ImageData to process (in-place)
 * @param levels Number of output levels (2 for 1-bit, more for multi-level)
 */
export function applyFMStochastic(data: ImageData, _params: HalftoneParams): void {
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const levels = 2; // 1-bit output for traditional halftone
  const threshold = sanitizeThreshold(_params.threshold);
  const intensity = Math.max(0, Math.min(1, _params.intensity ?? 1));
  const invert = _params.invert ?? false;
  const fg = _params.foregroundColor ?? [0, 0, 0];
  const bg = _params.backgroundColor ?? [255, 255, 255];

  if (intensity === 0) return;

  // Make a linearized copy for error computation
  const linear = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    linear[i] = srgbToLinear(pixels[i]! / 255);
    linear[i + 1] = srgbToLinear(pixels[i + 1]! / 255);
    linear[i + 2] = srgbToLinear(pixels[i + 2]! / 255);
    linear[i + 3] = pixels[i + 3]! / 255;
  }

  const step = 4; // RGBA stride
  const thresholdOffset = (threshold - 128) / 255;

  for (let y = 0; y < h; y++) {
    // Serpentine scan: alternate direction per row
    const xStart = y % 2 === 0 ? 0 : w - 1;
    const xEnd = y % 2 === 0 ? w : -1;
    const xStep = y % 2 === 0 ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * w + x) * step;
      if (pixels[idx + 3]! === 0) continue; // skip transparent

      // Convert to grayscale for single-channel halftone
      const original = 0.299 * linear[idx]! + 0.587 * linear[idx + 1]! + 0.114 * linear[idx + 2]!;
      const adjusted = original + thresholdOffset;

      // Quantize to nearest level
      const quantized = Math.round(adjusted * (levels - 1)) / (levels - 1);
      const error = adjusted - quantized;

      // inkCoverage: 0 = paper (bright), 1 = ink (dark)
      // Invert: quantized=0 (dark) → ink, quantized=1 (bright) → paper
      let inkCoverage = 1 - quantized;
      if (invert) inkCoverage = 1 - inkCoverage;

      // Map ink coverage to foreground/background color blend
      const pr = Math.round(bg[0] + (fg[0] - bg[0]) * inkCoverage);
      const pg = Math.round(bg[1] + (fg[1] - bg[1]) * inkCoverage);
      const pb = Math.round(bg[2] + (fg[2] - bg[2]) * inkCoverage);

      if (intensity < 1) {
        pixels[idx] = Math.round(pixels[idx]! + (pr - pixels[idx]!) * intensity);
        pixels[idx + 1] = Math.round(pixels[idx + 1]! + (pg - pixels[idx + 1]!) * intensity);
        pixels[idx + 2] = Math.round(pixels[idx + 2]! + (pb - pixels[idx + 2]!) * intensity);
      } else {
        pixels[idx] = pr;
        pixels[idx + 1] = pg;
        pixels[idx + 2] = pb;
      }

      // Floyd-Steinberg kernel
      //   *  7/16
      // 3/16 5/16 1/16
      if (y % 2 === 0) {
        // Left-to-right
        diffuseError(linear, idx, step, w, h, error);
      } else {
        // Right-to-left (mirrored kernel)
        diffuseErrorReversed(linear, idx, step, w, h, error);
      }
    }
  }
}

function diffuseError(
  linear: Float32Array,
  idx: number,
  step: number,
  w: number,
  _h: number,
  error: number,
): void {
  const right = idx + step;
  const downLeft = idx + w * step - step;
  const down = idx + w * step;
  const downRight = idx + w * step + step;

  if (right < linear.length) addError(linear, right, error, 7 / 16);
  if (downLeft >= 0 && idx % (w * step) >= step) addError(linear, downLeft, error, 3 / 16);
  if (down < linear.length) addError(linear, down, error, 5 / 16);
  if (downRight < linear.length) addError(linear, downRight, error, 1 / 16);
}

function diffuseErrorReversed(
  linear: Float32Array,
  idx: number,
  step: number,
  w: number,
  _h: number,
  error: number,
): void {
  const left = idx - step;
  const downRight = idx + w * step + step;
  const down = idx + w * step;
  const downLeft = idx + w * step - step;

  if (left >= 0) addError(linear, left, error, 7 / 16);
  if (downRight < linear.length) addError(linear, downRight, error, 3 / 16);
  if (down < linear.length) addError(linear, down, error, 5 / 16);
  if (downLeft >= 0 && idx % (w * step) < w * step - step)
    addError(linear, downLeft, error, 1 / 16);
}

function addError(linear: Float32Array, idx: number, error: number, weight: number): void {
  const e = error * weight;
  const v0 = linear[idx];
  const v1 = linear[idx + 1];
  const v2 = linear[idx + 2];
  if (v0 !== undefined) linear[idx] = v0 + e * 0.299;
  if (v1 !== undefined) linear[idx + 1] = v1 + e * 0.587;
  if (v2 !== undefined) linear[idx + 2] = v2 + e * 0.114;
}

// ── Helpers ────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return ((c + 0.055) / 1.055) ** 2.4;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Get the luminance contribution for a given channel.
 * For CMYK, each channel represents ink density.
 * For grayscale/RGB, use standard luminance weights.
 */
function getChannelLuminance(pixels: Uint8ClampedArray, idx: number, channel: string): number {
  const r = pixels[idx]!;
  const g = pixels[idx + 1]!;
  const b = pixels[idx + 2]!;
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;

  switch (channel) {
    case 'c':
      return 255 - b; // Cyan = ~Blue
    case 'm':
      return 255 - g; // Magenta = ~Green
    case 'y':
      return 255 - r; // Yellow = ~Red
    case 'k':
      return 255 - gray; // Black = luminance
    default:
      return gray;
  }
}

// ── Bayer Ordered Dithering ────────────────────────────────────────────

/**
 * Generate a Bayer ordered dithering matrix.
 * Recursive construction: M(2n) = | 4*M(n)   4*M(n)+2 |
 *                                 | 4*M(n)+3 4*M(n)+1 |
 * Base case M(2) = [[0,2],[3,1]].
 *
 * @param size Matrix dimension (must be a power of 2, e.g., 4, 8)
 * @returns Square matrix of size × size with values 0..size²-1
 */
export const BAYER_DEFAULT_SIZE = 8;

export function bayerMatrix(size: number): number[][] {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`Bayer matrix size must be a power of 2, got ${size}`);
  }

  // Start with M(2)
  let m: number[][] = [
    [0, 2],
    [3, 1],
  ];
  let currentSize = 2;

  while (currentSize < size) {
    const newSize = currentSize * 2;
    const newM: number[][] = Array.from({ length: newSize }, () => new Array(newSize).fill(0));

    for (let y = 0; y < currentSize; y++) {
      for (let x = 0; x < currentSize; x++) {
        const v = m[y]![x]!;
        newM[y]![x] = 4 * v;
        newM[y]![x + currentSize] = 4 * v + 2;
        newM[y + currentSize]![x] = 4 * v + 3;
        newM[y + currentSize]![x + currentSize] = 4 * v + 1;
      }
    }

    m = newM;
    currentSize = newSize;
  }

  return m;
}

/**
 * Apply Bayer ordered dithering to pixel data.
 * Uses document-relative coordinates (pixel_x + offsetX, pixel_y + offsetY)
 * to index the Bayer matrix, ensuring the dithering pattern is stable under
 * viewport pan/zoom (each document position always maps to the same matrix entry).
 *
 * For preview (viewport tiling) use this; for full-frame export use the
 * higher-quality Floyd-Steinberg error diffusion (applyFMStochastic).
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters (channel/method)
 * @param offsetX Document-space x offset of the render region
 * @param offsetY Document-space y offset of the render region
 */
export function applyBayerDithering(
  data: ImageData,
  _params: HalftoneParams,
  offsetX: number = 0,
  offsetY: number = 0,
  pixelScale: number = 1,
): void {
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const matrix = bayerMatrix(BAYER_DEFAULT_SIZE);
  const size = matrix.length;
  const totalCells = size * size;
  const threshold = sanitizeThreshold(_params.threshold);
  const intensity = Math.max(0, Math.min(1, _params.intensity ?? 1));
  const softness = Math.max(0, Math.min(1, _params.softness ?? 0));
  const thresholdOffset = (threshold - 128) / 255;
  const invert = _params.invert ?? false;
  const fg = _params.foregroundColor ?? [0, 0, 0];
  const bg = _params.backgroundColor ?? [255, 255, 255];
  const safeScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;

  if (intensity === 0) return;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (pixels[idx + 3]! === 0) continue; // skip transparent

      // Convert to luminance in linear space
      const r = srgbToLinear(pixels[idx]! / 255);
      const g = srgbToLinear(pixels[idx + 1]! / 255);
      const b = srgbToLinear(pixels[idx + 2]! / 255);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const adjusted = luminance + thresholdOffset;

      // Document-absolute coordinates — stable under viewport pan/zoom:
      // image px → doc px via pixelScale, then the region's doc origin.
      const [docX, docY] = toDocCoord(x, y, safeScale, safeOffsetX, safeOffsetY);

      // Index into Bayer matrix with document-relative coords
      const mx = ((Math.floor(docX) % size) + size) % size;
      const my = ((Math.floor(docY) % size) + size) % size;
      const thresholdVal = matrix[my]![mx]! / totalCells;

      let inkCoverage: number;
      if (softness > 0) {
        // Soft threshold: blend around the boundary.
        // Invert polarity: bright pixel → low ink coverage (paper),
        // dark pixel → high ink coverage (foreground/ink).
        const diff = thresholdVal - adjusted;
        const range = softness * 0.15;
        if (range > 0 && Math.abs(diff) < range) {
          inkCoverage = Math.max(0, Math.min(1, 0.5 + diff / (range * 2)));
        } else {
          inkCoverage = diff > 0 ? 1 : 0;
        }
      } else {
        // Binary dither: bright pixel (> threshold) → no ink (paper);
        // dark pixel (≤ threshold) → ink (foreground).
        inkCoverage = adjusted > thresholdVal ? 0 : 1;
      }
      if (invert) inkCoverage = 1 - inkCoverage;

      // Map ink coverage to foreground/background color blend
      const pr = Math.round(bg[0] + (fg[0] - bg[0]) * inkCoverage);
      const pg = Math.round(bg[1] + (fg[1] - bg[1]) * inkCoverage);
      const pb = Math.round(bg[2] + (fg[2] - bg[2]) * inkCoverage);

      if (intensity < 1) {
        pixels[idx] = Math.round(pixels[idx]! + (pr - pixels[idx]!) * intensity);
        pixels[idx + 1] = Math.round(pixels[idx + 1]! + (pg - pixels[idx + 1]!) * intensity);
        pixels[idx + 2] = Math.round(pixels[idx + 2]! + (pb - pixels[idx + 2]!) * intensity);
      } else {
        pixels[idx] = pr;
        pixels[idx + 1] = pg;
        pixels[idx + 2] = pb;
      }
    }
  }
}

/**
 * Apply halftone effect to pixel data.
 * Dispatches to AM or FM method based on params.
 *
 * For FM (stochastic) method:
 * - Without offset params (full-frame export): uses Floyd-Steinberg error diffusion
 *   for highest quality.
 * - With offset params (viewport-tiled preview): uses Bayer ordered dithering,
 *   which is position-stable under pan/zoom because threshold selection is
 *   based on document-absolute coordinates, not relative scan position.
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters
 * @param offsetX Document-space x offset of the render region (document
 *   anchoring: panning the viewport never shifts the pattern phase)
 * @param offsetY Document-space y offset of the render region
 * @param pixelScale Image pixels per document pixel (live preview passes
 *   the camera scale so cell geometry resolves in device pixels while
 *   staying anchored in document space; default 1)
 */
export function applyHalftone(
  data: ImageData,
  params: HalftoneParams,
  offsetX?: number,
  offsetY?: number,
  pixelScale: number = 1,
): ImageData {
  const hasOffset = offsetX !== undefined && offsetY !== undefined;
  if (params.method === 'fm') {
    if (hasOffset) {
      applyBayerDithering(data, params, offsetX, offsetY, pixelScale);
    } else {
      applyFMStochastic(data, params);
    }
  } else {
    applyAMScreening(
      data,
      params,
      pixelScale,
      hasOffset ? (offsetX as number) : 0,
      hasOffset ? (offsetY as number) : 0,
    );
  }
  return data;
}

// ── Presets ─────────────────────────────────────────────────────────────

export interface HalftonePreset {
  id: string;
  name: string;
  description: string;
  params: Partial<Omit<HalftoneParams, 'pattern'>> & { pattern: HalftonePattern };
}

export const HALFTONE_PRESETS: HalftonePreset[] = [
  {
    id: 'newspaper',
    name: 'Newspaper',
    description: 'Classic AM clustered-dot — traditional newspaper print look',
    params: {
      pattern: 'dot',
      frequency: 35,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'fine-print',
    name: 'Fine Print',
    description: 'High-frequency AM — smooth offset magazine quality',
    params: {
      pattern: 'dot',
      frequency: 85,
      angle: 45,
      dotShape: 'elliptical',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'comic-dots',
    name: 'Comic Dots',
    description: 'Large coarse dots — pop-art / comic book halftone',
    params: {
      pattern: 'dot',
      frequency: 12,
      angle: 15,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'coarse-dots',
    name: 'Coarse Dots',
    description: 'Very large dots — heavy screen-print aesthetic',
    params: {
      pattern: 'dot',
      frequency: 8,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'line-screen',
    name: 'Lines',
    description: 'Parallel line halftone — engraving / etching look',
    params: {
      pattern: 'line',
      frequency: 25,
      angle: 45,
      dotShape: 'line',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'vintage-screen',
    name: 'Vintage Screen',
    description: 'Retro dot matrix — vintage print / risograph feel',
    params: {
      pattern: 'dot',
      frequency: 20,
      angle: 30,
      dotShape: 'square',
      channel: 'k',
      method: 'am',
      softness: 0.3,
    },
  },
  {
    id: 'stochastic-fine',
    name: 'Stochastic Fine',
    description: 'FM error diffusion — modern stochastic screening',
    params: {
      pattern: 'dot',
      frequency: 50,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    },
  },
  {
    id: 'cross-hatch',
    name: 'Cross Hatch',
    description: 'Cross-shaped dots — decorative screen pattern',
    params: {
      pattern: 'cross',
      frequency: 20,
      angle: 0,
      dotShape: 'cross',
      channel: 'k',
      method: 'am',
    },
  },
  {
    id: 'diamond-dots',
    name: 'Diamond Dots',
    description: 'Faceted diamond dots — textile / textile print',
    params: {
      pattern: 'dot',
      frequency: 18,
      angle: 30,
      dotShape: 'diamond',
      channel: 'k',
      method: 'am',
    },
  },
];
