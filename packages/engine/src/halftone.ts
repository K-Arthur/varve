/**
 * Halftone screening engine — AM (amplitude modulation) and FM (frequency
 * modulation / stochastic) screening for print-style halftone generation.
 *
 * Architecture:
 *   AM screening indexes a rank-equalized threshold matrix per output pixel
 *   inside each screen cell (algorithm version 2, see halftoneScreen.ts), at
 *   configurable LPI, angle, and dot shape. FM screening uses an ordered
 *   blue-noise matrix by default, Bayer ordered dithering for legacy
 *   documents, and explicit error diffusion when full-frame processing is
 *   requested.
 *
 * Versioning:
 *   `algorithmVersion: 1` preserves the pre-correction screen geometry and
 *   tone mapping exactly (documents created before 2026). Version 2 is the
 *   corrected contract used by all newly created effects. The scene
 *   persistence boundary pins version 1 for documents that predate the field.
 *
 * Tone domain:
 *   Version 2 screens encoded sRGB channel values (Rec.709 luma) for every
 *   method, so AM, ordered FM, and error diffusion agree on what "50% gray"
 *   means. Legacy paths keep their original mixed encoded/linear behavior.
 *
 * Research basis: Ulichney (Digital Halftoning 1987; Void-and-Cluster 1993),
 *   ISO 12647-2 screen angles, Krita Screentone (size mode, equalization,
 *   macrocell alignment), GIMP Newsprint (per-channel period/angle, black
 *   pullout), Floyd-Steinberg error diffusion (1975).
 */

import {
  applyDotGain,
  blueNoiseMatrixSize,
  cachedBlueNoiseMatrix,
  cachedScreenMatrix,
  clamp01,
  coverageAt,
  docCellPeriod,
  type ScreenShape,
  STANDARD_SCREEN_ANGLES,
  sampleScreenThreshold,
  sanitizeLineScreen,
  screenMatrixSize,
} from './halftoneScreen';

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
/** Version of the screening semantics. 1 = legacy, 2 = corrected. */
export type HalftoneAlgorithmVersion = 1 | 2;
/** FM thresholding algorithm. Ordered modes are parity-safe; error
 *  diffusion is a full-frame (export) algorithm. */
export type HalftoneFmAlgorithm = 'blue-noise' | 'bayer' | 'error-diffusion';
export type HalftoneBlackGeneration = 'none' | 'gcr' | 'ucr';
export type HalftonePreviewChannel = 'composite' | 'c' | 'm' | 'y' | 'k';

export interface HalftoneParams {
  pattern: HalftonePattern;
  frequency: number;
  angle: number;
  dotShape: HalftoneDotShape;
  channel: HalftoneChannel;
  method: HalftoneMethod;
  /** Screening semantics. Missing/1 = legacy geometry; 2 = corrected. */
  algorithmVersion?: HalftoneAlgorithmVersion;
  /** FM algorithm. Missing defaults to 'bayer' (legacy preview look). */
  fmAlgorithm?: HalftoneFmAlgorithm;
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
  /** Per-channel screen angle overrides (degrees, absolute). cmyk only. */
  channelAngles?: { c?: number; m?: number; y?: number; k?: number };
  /** Per-channel registration offset in document px. cmyk only. */
  registrationOffset?: {
    c?: [number, number];
    m?: [number, number];
    y?: [number, number];
    k?: [number, number];
  };
  /** Total area coverage limit (0-1; 1 = 400%). Default 1. cmyk only. */
  tacLimit?: number;
  /** Black generation method. Default 'none'. cmyk only. */
  blackGeneration?: HalftoneBlackGeneration;
  /** Black generation strength 0-1. Default 0.5. */
  gcrStrength?: number;
  /** Show a single separation instead of the composite. Default 'composite'. */
  previewChannel?: HalftonePreviewChannel;
  /** Dot gain compensation 0-1. Default 0. */
  dotGain?: number;
  /**
   * Alpha behavior for mono screens (algorithm version 2 only).
   * 'preserve' (default) leaves source alpha untouched.
   * 'screen' multiplies source alpha by ink coverage, producing intentional
   * ink-on-transparency screentones instead of a rectangular ink field.
   */
  alphaMode?: 'preserve' | 'screen';
}

/** Options that affect algorithm selection without changing authored look. */
export interface HalftoneRenderOptions {
  /** True when the whole document surface is being processed (export).
   *  Full-frame is the only condition under which error diffusion runs. */
  fullFrame?: boolean;
}

// ── Standard CMYK Screen Angles ────────────────────────────────────────

const STANDARD_ANGLES: Record<string, number> = STANDARD_SCREEN_ANGLES;

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
const legacyMatrixCache = new Map<string, Uint8Array>();

/** Legacy per-cell threshold matrix (algorithm version 1). */
export function cachedLegacyAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  const key = `${size}:${dotShape}`;
  const cached = legacyMatrixCache.get(key);
  if (cached) return cached;

  const matrix = generateLegacyAMMatrix(size, dotShape);
  if (legacyMatrixCache.size >= MATRIX_CACHE_LIMIT) {
    const oldestKey = legacyMatrixCache.keys().next().value;
    if (oldestKey !== undefined) legacyMatrixCache.delete(oldestKey);
  }
  legacyMatrixCache.set(key, matrix);
  return matrix;
}

// ── AM Screening ───────────────────────────────────────────────────────

function toScreenShape(dotShape: HalftoneDotShape): ScreenShape {
  return dotShape;
}

/**
 * Corrected AM threshold matrix (algorithm version 2): a rank-equalized
 * single-cell matrix, sampled per output pixel inside the cell.
 */
export function generateAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  return cachedScreenMatrix(size, toScreenShape(dotShape));
}

/** Memoized corrected AM matrix. Callers must not mutate the returned array. */
export function cachedAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  return cachedScreenMatrix(size, toScreenShape(dotShape));
}

/**
 * Legacy threshold matrix (algorithm version 1).
 *
 * Kept verbatim so documents created before the corrected screening contract
 * render exactly as authored. It is applied once per whole cell (see
 * `screenChannelAtLegacy`), which is why its effective period exceeds the
 * requested cell period.
 */
export function generateLegacyAMMatrix(size: number, dotShape: HalftoneDotShape): Uint8Array {
  const matrix = new Uint8Array(size * size);
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x % size) - half + 0.5;
      const cy = (y % size) - half + 0.5;
      const dx = cx / half;
      const dy = cy / half;

      // The threshold is derived from the dot shape's COVERAGE function:
      // f(dist) = fraction of the cell already covered when the growing dot
      // reaches this pixel. Mapping threshold = 255 * f makes the matrix
      // CDF uniform over 1..255, so ink coverage is proportional to source
      // tone (area-proportional thresholding, as used by real AM screening).
      // The naive `round(dist * 255)` produced only 2-3 distinct levels at
      // small matrix sizes, which made light tones render almost no dots.
      //
      // Coordinates span the cell [-1,1]^2 (area 4), so each coverage
      // formula normalizes by 4. Thresholds live in [1,255] so a 0-luminance
      // source never inks (0 >= 1 is false) and 255-luminance always inks
      // (255 >= 255 is true) — no strict-inequality corner holes.
      let coverage: number;
      switch (dotShape) {
        case 'round': {
          // Ink disk of radius r covers c = pi*r^2 / 4 of the cell; the
          // pixel is reached when dist <= r, so c = pi * dist^2 / 4.
          const d2 = dx * dx + dy * dy;
          coverage = Math.min(1, (Math.PI * d2) / 4);
          break;
        }
        case 'elliptical': {
          // Stretched round dot: anisotropic coverage for smoother midtones.
          const d2 = dx * dx * 1.5 + dy * dy * 0.67;
          coverage = Math.min(1, (Math.PI * d2) / 4);
          break;
        }
        case 'square': {
          // Growing square of half-size s covers c = s^2; reached when
          // max(|dx|,|dy|) <= s, so c = max^2.
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          coverage = Math.min(1, m * m);
          break;
        }
        case 'diamond': {
          // Growing diamond of half-diagonal s covers c = s^2 / 2; reached
          // when |dx|+|dy| <= s, so c = (|dx|+|dy|)^2 / 2.
          const ad = Math.abs(dx) + Math.abs(dy);
          coverage = Math.min(1, (ad * ad) / 2);
          break;
        }
        case 'line': {
          // Line screen: stripe of half-width s covers c = s; reached when
          // |dy| <= s, so c = |dy|.
          coverage = Math.min(1, Math.abs(dy));
          break;
        }
        case 'cross': {
          // Cross-shaped dot: arms along x/y grow first, corners fill last.
          // Sum of axis distances approximates the cross coverage.
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          const axisDist = Math.min(adx, ady);
          const radialDist = Math.sqrt(adx * adx + ady * ady);
          const d = radialDist + axisDist * 0.5;
          coverage = Math.min(1, (d * d * 1.2) / 4);
          break;
        }
        case 'circle': {
          // Circle / bullseye dot: concentric rings instead of a single
          // growing cluster (decorative). Normalized radial bands.
          const rad = Math.sqrt(dx * dx + dy * dy);
          const ringPhase = Math.sin(rad * Math.PI * 6);
          const d = rad + ringPhase * 0.3;
          coverage = Math.min(1, Math.max(0, d * 0.8));
          break;
        }
        default:
          coverage = Math.min(1, (Math.PI * (dx * dx + dy * dy)) / 4);
      }

      // Normalize to 1-255 threshold value (1..255, never 0)
      const threshold = Math.max(1, Math.min(255, Math.round(coverage * 254) + 1));
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
    return diff >= 0 ? 1 : 0;
  }
  // >= (not >): matrix values live in [1,255], so 255-luminance fully inks
  // (255 >= 255) and 0-luminance never inks (0 >= 1 is false) — no corner
  // holes at the tone extremes.
  return adjustedGray >= matrixVal ? 1 : 0;
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return 45;
  return Math.max(1, Math.min(1000, value));
}

/** Normalize an angle to a finite value in [0, 360). NaN/Infinity → 0. */
function sanitizeAngle(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

/** Clamp an 8-bit tone threshold; NaN/Infinity → 128. */
function sanitizeThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 128;
  return Math.max(0, Math.min(255, value));
}

/**
 * Legacy AM screening (algorithm version 1). Kept pixel-exact for documents
 * created before the corrected screening contract.
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters
 * @param pixelScale Image pixels per document pixel
 * @param offsetX Document-space x origin of the image region
 * @param offsetY Document-space y origin of the image region
 */
export function applyLegacyAMScreening(
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

  // Generate threshold matrix for the dot shape. A 2x2 matrix degenerates
  // (all four cells are equidistant from the center → one threshold value →
  // no tone response), so clamp to >= 4. At 72 dpi, LPI above ~36 yields
  // sub-2px cells; the matrix then spans several cells, so the effective
  // screen frequency is lower than the requested LPI — a physical
  // resolution limit, not a code defect.
  const matrixSize = Math.max(4, nextPowerOfTwo(cellSize * 2));
  const matrix = cachedLegacyAMMatrix(matrixSize, dotShape);

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

// ── AM Screening (algorithm version 2) ────────────────────────────────

const REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

/** Encoded sRGB luma (Rec.709 weights). */
function encodedLuma(pixels: Uint8ClampedArray, idx: number): number {
  return REC709.r * pixels[idx]! + REC709.g * pixels[idx + 1]! + REC709.b * pixels[idx + 2]!;
}

/**
 * Ink density 0..255 for a single channel. Cyan absorbs red, magenta green,
 * yellow blue; black is encoded-luma darkness. This is the separation
 * convention used by every version-2 path.
 */
function channelInkDensity(
  pixels: Uint8ClampedArray,
  idx: number,
  channel: HalftoneChannel,
): number {
  switch (channel) {
    case 'c':
      return 255 - pixels[idx]!;
    case 'm':
      return 255 - pixels[idx + 1]!;
    case 'y':
      return 255 - pixels[idx + 2]!;
    default:
      return 255 - encodedLuma(pixels, idx);
  }
}

/**
 * Write one mono screened pixel. `preserve` keeps source alpha and inks the
 * fg/bg blend; `screen` writes the ink color with alpha = source alpha *
 * coverage, the intentional ink-on-transparency screentone mode.
 */
function writeMonoCoverage(
  pixels: Uint8ClampedArray,
  idx: number,
  coverage: number,
  params: HalftoneParams,
  fg: readonly number[],
  bg: readonly number[],
  intensity: number,
): void {
  const blend = (source: number, target: number): number =>
    intensity < 1 ? Math.round(source + (target - source) * intensity) : target;

  if (params.alphaMode === 'screen') {
    const sourceAlpha = pixels[idx + 3]!;
    const targetAlpha = Math.round(sourceAlpha * coverage);
    pixels[idx] = blend(pixels[idx]!, fg[0]!);
    pixels[idx + 1] = blend(pixels[idx + 1]!, fg[1]!);
    pixels[idx + 2] = blend(pixels[idx + 2]!, fg[2]!);
    pixels[idx + 3] = blend(sourceAlpha, targetAlpha);
    return;
  }

  const pr = Math.round(bg[0]! + (fg[0]! - bg[0]!) * coverage);
  const pg = Math.round(bg[1]! + (fg[1]! - bg[1]!) * coverage);
  const pb = Math.round(bg[2]! + (fg[2]! - bg[2]!) * coverage);
  pixels[idx] = blend(pixels[idx]!, pr);
  pixels[idx + 1] = blend(pixels[idx + 1]!, pg);
  pixels[idx + 2] = blend(pixels[idx + 2]!, pb);
}

const SUBSAMPLE_TAPS = [-0.25, 0.25] as const;

interface ResolvedChannelScreen {
  cos: number;
  sin: number;
  offsetX: number;
  offsetY: number;
}

function resolveChannelScreen(
  channel: 'c' | 'm' | 'y' | 'k',
  params: HalftoneParams,
): ResolvedChannelScreen {
  const override = params.channelAngles?.[channel];
  const angle = sanitizeAngle(typeof override === 'number' ? override : STANDARD_ANGLES[channel]!);
  const rad = (angle * Math.PI) / 180;
  const offset = params.registrationOffset?.[channel];
  const offsetX = Array.isArray(offset) && Number.isFinite(offset[0]) ? offset[0]! : 0;
  const offsetY = Array.isArray(offset) && Number.isFinite(offset[1]) ? offset[1]! : 0;
  return { cos: Math.cos(rad), sin: Math.sin(rad), offsetX, offsetY };
}

/**
 * Apply corrected AM screening (algorithm version 2).
 *
 * The matrix covers one cell and is sampled per output pixel, so the measured
 * period equals `96 / frequency` document px at any zoom or export scale.
 * CMYK separation is a documented uncalibrated preview: channel densities are
 * complementary encoded values with optional black generation, TAC limiting,
 * per-channel angles/offsets, and single-separation preview.
 */
export function applyAMScreeningV2(
  data: ImageData,
  params: HalftoneParams,
  pixelScale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0,
): void {
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const threshold = sanitizeThreshold(params.threshold);
  const intensity = clamp01(params.intensity ?? 1);
  const softness = clamp01(params.softness ?? 0);
  const dotGain = clamp01(params.dotGain ?? 0);
  const invert = params.invert ?? false;
  const fg = params.foregroundColor ?? [0, 0, 0];
  const bg = params.backgroundColor ?? [255, 255, 255];
  const frequency = sanitizeLineScreen(params.frequency);
  const cellPeriod = docCellPeriod(frequency);
  const safeScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
  const matrixSize = screenMatrixSize(cellPeriod, safeScale);
  const matrix = cachedScreenMatrix(matrixSize, toScreenShape(params.dotShape));

  if (intensity === 0) return;

  if (params.channel === 'cmyk') {
    const screens = {
      c: resolveChannelScreen('c', params),
      m: resolveChannelScreen('m', params),
      y: resolveChannelScreen('y', params),
      k: resolveChannelScreen('k', params),
    };
    const blackGeneration = params.blackGeneration ?? 'none';
    const gcrStrength = clamp01(params.gcrStrength ?? 0.5);
    const tacLimit = Number.isFinite(params.tacLimit)
      ? Math.max(0, Math.min(1, params.tacLimit as number))
      : 1;
    const previewChannel = params.previewChannel ?? 'composite';
    const tacMaximum = tacLimit * 4;
    // Process screening runs several rotated screens at once; a hard binary
    // edge at small cell sizes makes each channel's sampled area depend on
    // its angle, which tints neutral tones. A one-sample-wide edge blend is
    // the standard antialiasing cure and leaves the authored dot geometry
    // (period, angle, shape) intact.
    const channelSoftness = Math.max(softness, Math.min(0.5, 255 / (matrixSize * 128)));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (pixels[idx + 3]! === 0) continue; // skip transparent

        const docX = x / safeScale + safeOffsetX;
        const docY = y / safeScale + safeOffsetY;

        let cInk = 1 - pixels[idx]! / 255;
        let mInk = 1 - pixels[idx + 1]! / 255;
        let yInk = 1 - pixels[idx + 2]! / 255;
        const grayComponent = Math.min(cInk, mInk, yInk);
        let kInk = 0;
        if (blackGeneration === 'gcr') {
          kInk = grayComponent * gcrStrength;
        } else if (blackGeneration === 'ucr') {
          // UCR removes density only in the shadow end of the tone range.
          kInk = Math.max(0, grayComponent - 0.5) * 2 * gcrStrength;
        }
        cInk = Math.max(0, cInk - kInk);
        mInk = Math.max(0, mInk - kInk);
        yInk = Math.max(0, yInk - kInk);

        if (tacMaximum > 0) {
          const total = cInk + mInk + yInk + kInk;
          if (total > tacMaximum) {
            const scale = tacMaximum / total;
            cInk *= scale;
            mInk *= scale;
            yInk *= scale;
            kInk *= scale;
          }
        } else {
          cInk = 0;
          mInk = 0;
          yInk = 0;
          kInk = 0;
        }

        // Four sub-pixel taps estimate the channel's area coverage instead of
        // point-sampling a rotated lattice, which removes most of the
        // angle-dependent tone bias between the process screens.
        const coverageOf = (screen: ResolvedChannelScreen, density: number): number => {
          const gained = applyDotGain(density * 255, dotGain);
          const tap = 0.25 / safeScale;
          let total = 0;
          for (const sy of SUBSAMPLE_TAPS) {
            for (const sx of SUBSAMPLE_TAPS) {
              const thresholdValue = sampleScreenThreshold(
                matrix,
                matrixSize,
                docX + screen.offsetX + sx * tap,
                docY + screen.offsetY + sy * tap,
                screen.cos,
                screen.sin,
                cellPeriod,
              );
              total += coverageAt(gained, thresholdValue, threshold, channelSoftness);
            }
          }
          return total / (SUBSAMPLE_TAPS.length * SUBSAMPLE_TAPS.length);
        };

        const cCoverage = coverageOf(screens.c, cInk);
        const mCoverage = coverageOf(screens.m, mInk);
        const yCoverage = coverageOf(screens.y, yInk);
        const kCoverage = coverageOf(screens.k, kInk);

        let nr: number;
        let ng: number;
        let nb: number;
        if (previewChannel === 'composite') {
          // Uncalibrated subtractive overprint preview.
          nr = Math.round(255 * (1 - cCoverage) * (1 - kCoverage));
          ng = Math.round(255 * (1 - mCoverage) * (1 - kCoverage));
          nb = Math.round(255 * (1 - yCoverage) * (1 - kCoverage));
        } else {
          const selected = {
            c: cCoverage,
            m: mCoverage,
            y: yCoverage,
            k: kCoverage,
          }[previewChannel];
          const coverage = invert ? 1 - selected : selected;
          nr = Math.round(bg[0] + (fg[0] - bg[0]) * coverage);
          ng = Math.round(bg[1] + (fg[1] - bg[1]) * coverage);
          nb = Math.round(bg[2] + (fg[2] - bg[2]) * coverage);
        }

        if (intensity < 1) {
          pixels[idx] = Math.round(pixels[idx]! + (nr - pixels[idx]!) * intensity);
          pixels[idx + 1] = Math.round(pixels[idx + 1]! + (ng - pixels[idx + 1]!) * intensity);
          pixels[idx + 2] = Math.round(pixels[idx + 2]! + (nb - pixels[idx + 2]!) * intensity);
        } else {
          pixels[idx] = nr;
          pixels[idx + 1] = ng;
          pixels[idx + 2] = nb;
        }
        // Alpha is never an ink channel.
      }
    }
    return;
  }

  // Mono single-channel screen.
  const angle = sanitizeAngle(params.angle);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const channel: HalftoneChannel = params.channel;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (pixels[idx + 3]! === 0) continue; // skip transparent

      const docX = x / safeScale + safeOffsetX;
      const docY = y / safeScale + safeOffsetY;
      const density = channelInkDensity(pixels, idx, channel);
      const gained = applyDotGain(density, dotGain);
      const thresholdValue = sampleScreenThreshold(
        matrix,
        matrixSize,
        docX,
        docY,
        cos,
        sin,
        cellPeriod,
      );
      let coverage = coverageAt(gained, thresholdValue, threshold, softness);
      if (invert) coverage = 1 - coverage;
      writeMonoCoverage(pixels, idx, coverage, params, fg, bg, intensity);
    }
  }
}

/**
 * Version-aware AM entry point. Version 1 reproduces the legacy per-cell
 * screen exactly; version 2 uses the corrected per-pixel, equalized screen.
 */
export function applyAMScreening(
  data: ImageData,
  params: HalftoneParams,
  pixelScale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0,
): void {
  if (params.algorithmVersion === 1) {
    applyLegacyAMScreening(data, params, pixelScale, offsetX, offsetY);
  } else {
    applyAMScreeningV2(data, params, pixelScale, offsetX, offsetY);
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

// ── FM Screening (algorithm version 2) ─────────────────────────────────

const bayerThresholdCache = new Map<number, Uint8Array>();

/** Bayer thresholds scaled to the same [1, 255] domain as the screen matrix. */
function bayerThresholds(size: number): Uint8Array {
  const cached = bayerThresholdCache.get(size);
  if (cached) return cached;
  const matrix = bayerMatrix(size);
  const total = size * size;
  const thresholds = new Uint8Array(total);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      thresholds[y * size + x] = Math.max(
        1,
        Math.min(255, Math.round((matrix[y]![x]! * 255) / total)),
      );
    }
  }
  bayerThresholdCache.set(size, thresholds);
  return thresholds;
}

/**
 * Document-anchored ordered dithering (algorithm version 2).
 *
 * The threshold source is explicit: 'blue-noise' (void-and-cluster) or
 * 'bayer'. Both index by document pixel, so the pattern is stable under
 * pan/zoom and identical for preview and export at the same region origin.
 * Tone is encoded darkness, matching the corrected AM contract.
 */
export function applyOrderedDitherV2(
  data: ImageData,
  params: HalftoneParams,
  algorithm: 'blue-noise' | 'bayer',
  offsetX: number = 0,
  offsetY: number = 0,
  pixelScale: number = 1,
): void {
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const matrix =
    algorithm === 'blue-noise' ? cachedBlueNoiseMatrix() : bayerThresholds(BAYER_DEFAULT_SIZE);
  const size = algorithm === 'blue-noise' ? blueNoiseMatrixSize() : BAYER_DEFAULT_SIZE;
  const threshold = sanitizeThreshold(params.threshold);
  const intensity = clamp01(params.intensity ?? 1);
  const softness = clamp01(params.softness ?? 0);
  const dotGain = clamp01(params.dotGain ?? 0);
  const invert = params.invert ?? false;
  const fg = params.foregroundColor ?? [0, 0, 0];
  const bg = params.backgroundColor ?? [255, 255, 255];
  const safeScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
  const channel = params.channel === 'cmyk' ? 'k' : params.channel;

  if (intensity === 0) return;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (pixels[idx + 3]! === 0) continue; // skip transparent

      const docX = x / safeScale + safeOffsetX;
      const docY = y / safeScale + safeOffsetY;
      const mx = ((Math.floor(docX) % size) + size) % size;
      const my = ((Math.floor(docY) % size) + size) % size;
      const thresholdValue = matrix[my * size + mx]!;
      const density = applyDotGain(channelInkDensity(pixels, idx, channel), dotGain);
      let coverage = coverageAt(density, thresholdValue, threshold, softness);
      if (invert) coverage = 1 - coverage;
      writeMonoCoverage(pixels, idx, coverage, params, fg, bg, intensity);
    }
  }
}

/**
 * Error diffusion (algorithm version 2) — an explicit full-frame algorithm.
 *
 * A single scalar ink-density plane drives the diffusion, so the quantizer's
 * error is conserved exactly (the legacy RGB-weighted diffusion lost about
 * 55% of it and shifted hue). Serpentine scan; the kernel never wraps across
 * row boundaries. Transparent pixels neither emit nor retain error that could
 * leak back into opaque neighbors.
 */
export function applyErrorDiffusionV2(data: ImageData, params: HalftoneParams): void {
  const w = data.width;
  const h = data.height;
  const pixels = data.data;
  const threshold = sanitizeThreshold(params.threshold);
  const intensity = clamp01(params.intensity ?? 1);
  const dotGain = clamp01(params.dotGain ?? 0);
  const invert = params.invert ?? false;
  const fg = params.foregroundColor ?? [0, 0, 0];
  const bg = params.backgroundColor ?? [255, 255, 255];
  const channel = params.channel === 'cmyk' ? 'k' : params.channel;

  if (intensity === 0) return;

  const plane = new Float32Array(w * h);
  for (let i = 0, p = 0; i < plane.length; i++, p += 4) {
    plane[i] = pixels[p + 3]! === 0 ? 0 : channelInkDensity(pixels, p, channel);
  }

  const addError = (index: number, x: number, y: number, error: number, weight: number): void => {
    if (x < 0 || x >= w || y >= h) return;
    const next = plane[index]! + error * weight;
    plane[index] = next < -512 ? -512 : next > 512 ? 512 : next;
  };

  for (let y = 0; y < h; y++) {
    const leftToRight = y % 2 === 0;
    const start = leftToRight ? 0 : w - 1;
    const end = leftToRight ? w : -1;
    const step = leftToRight ? 1 : -1;

    for (let x = start; x !== end; x += step) {
      const index = y * w + x;
      const pixel = index * 4;
      if (pixels[pixel + 3]! === 0) continue;

      const adjusted = applyDotGain(plane[index]!, dotGain) - (threshold - 128);
      const ink = adjusted >= 128 ? 1 : 0;
      const quantized = ink ? 255 : 0;
      const error = adjusted - quantized;
      const coverage = invert ? 1 - ink : ink;
      writeMonoCoverage(pixels, pixel, coverage, params, fg, bg, intensity);

      if (leftToRight) {
        addError(index + 1, x + 1, y, error, 7 / 16);
        addError(index + w - 1, x - 1, y + 1, error, 3 / 16);
        addError(index + w, x, y + 1, error, 5 / 16);
        addError(index + w + 1, x + 1, y + 1, error, 1 / 16);
      } else {
        addError(index - 1, x - 1, y, error, 7 / 16);
        addError(index + w + 1, x + 1, y + 1, error, 3 / 16);
        addError(index + w, x, y + 1, error, 5 / 16);
        addError(index + w - 1, x - 1, y + 1, error, 1 / 16);
      }
    }
  }
}

/**
 * Apply halftone effect to pixel data.
 *
 * Version 1 replays the legacy dispatch exactly (FM chose Bayer when region
 * offsets were present and Floyd-Steinberg otherwise). Version 2 selects its
 * algorithm explicitly from `params.fmAlgorithm`; error diffusion runs only
 * when the caller declares a full-frame render (`options.fullFrame`), and the
 * position-stable blue-noise screen is used otherwise so previews never
 * substitute a different authored pattern silently.
 *
 * @param data ImageData to process (in-place)
 * @param params Halftone parameters
 * @param offsetX Document-space x offset of the render region
 * @param offsetY Document-space y offset of the render region
 * @param pixelScale Image pixels per document pixel
 * @param options Render-mode options that do not change authored parameters
 */
export function applyHalftone(
  data: ImageData,
  params: HalftoneParams,
  offsetX?: number,
  offsetY?: number,
  pixelScale: number = 1,
  options: HalftoneRenderOptions = {},
): ImageData {
  const hasOffset = offsetX !== undefined && offsetY !== undefined;
  if (params.algorithmVersion === 1) {
    if (params.method === 'fm') {
      if (hasOffset) {
        applyBayerDithering(data, params, offsetX, offsetY, pixelScale);
      } else {
        applyFMStochastic(data, params);
      }
    } else {
      applyLegacyAMScreening(
        data,
        params,
        pixelScale,
        hasOffset ? (offsetX as number) : 0,
        hasOffset ? (offsetY as number) : 0,
      );
    }
    return data;
  }

  const ox = hasOffset ? (offsetX as number) : 0;
  const oy = hasOffset ? (offsetY as number) : 0;
  if (params.method === 'am') {
    applyAMScreeningV2(data, params, pixelScale, ox, oy);
    return data;
  }

  const algorithm = params.fmAlgorithm ?? 'bayer';
  if (algorithm === 'error-diffusion' && options.fullFrame) {
    applyErrorDiffusionV2(data, params);
  } else if (algorithm === 'error-diffusion') {
    applyOrderedDitherV2(data, params, 'blue-noise', ox, oy, pixelScale);
  } else {
    applyOrderedDitherV2(data, params, algorithm, ox, oy, pixelScale);
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
    description: 'Fine blue-noise FM screen — modern stochastic screening',
    params: {
      pattern: 'dot',
      frequency: 50,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      fmAlgorithm: 'blue-noise',
    },
  },
  {
    id: 'zine-stochastic',
    name: 'Zine Stochastic',
    description: 'Coarse blue-noise FM screen — photocopy and zine texture',
    params: {
      pattern: 'dot',
      frequency: 28,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      fmAlgorithm: 'blue-noise',
      threshold: 120,
    },
  },
  {
    id: 'process-cmyk',
    name: 'Process CMYK',
    description: 'Four-colour process screen with GCR black generation',
    params: {
      pattern: 'dot',
      frequency: 60,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
      blackGeneration: 'gcr',
      gcrStrength: 0.7,
      tacLimit: 1,
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
