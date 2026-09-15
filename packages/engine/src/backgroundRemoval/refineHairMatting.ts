/**
 * Hair/fur edge refinement.
 *
 * Two honestly different methods:
 *
 * - `'guided'` — the guided image filter (He, Sun & Tang, ECCV 2010) over the
 *   guide luminance. It is an O(N), edge-aware smoother for pixels that
 *   *already* carry fractional coverage; it is not a matting solver and cannot
 *   invent an alpha matte for a hard binary mask. `edgeBandOnly` (default)
 *   restricts changes to pixels in the 10–245 band and leaves definite cores
 *   byte-exact.
 * - `'closed-form'` — corrected matting Laplacian (Levin, Lischinski & Weiss,
 *   CVPR 2006) with a spatial unknown band generated from the mask. This is
 *   the method that can refine binary masks, recover thin foreground missed by
 *   the current mask, and honour user-provided trimap constraints.
 *
 * Both paths are bounded and report failures through `onDiagnostics` instead
 * of silently returning the input.
 */

import { boxMeanPlane } from '../areaSelectionMorphology';
import { type MattingDiagnostics, solveMattingLaplacian, trimapFromMask } from './mattingSolver';

export type { MattingDiagnostics } from './mattingSolver';
export { TRIMap } from './mattingSolver';

export type MattingMethod = 'guided' | 'closed-form';

export interface HairMattingOptions {
  /** Refinement method (default 'guided'). */
  method?: MattingMethod;
  /** Guided filter window radius in pixels (default 4). */
  radius?: number;
  /** Guided regularization ε (default 0.01); closed-form Laplacian ε maps here too. */
  epsilon?: number;
  /** Only refine pixels in the soft edge band (10–245), leaving cores intact. */
  edgeBandOnly?: boolean;
  /** Conjugate-gradient iteration cap for closed-form (default 100). */
  iterations?: number;
  /**
   * Closed-form soft prior weight toward the existing mask for unknown pixels.
   * Default 0 (pure boundary constraints from the spatial trimap).
   */
  lambda?: number;
  /** Closed-form matting window radius (default 1 → 3×3 windows). */
  laplacianRadius?: number;
  /** Spatial unknown-band width for closed-form (default `radius`). */
  bandRadius?: number;
  /** Relative residual tolerance for closed-form (default 1e-5). */
  tolerance?: number;
  /** Bounded-solve caps for closed-form. */
  maxUnknownPixels?: number;
  maxRegionPixels?: number;
  /** Receives solver diagnostics (iterations, residual, refusal reason). */
  onDiagnostics?: (diagnostics: MattingDiagnostics) => void;
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Single-channel guided filter: refines `p` (mask alpha) guided by `I` (image
 * luminance). Uses O(N) sliding-window box means, independent of the radius.
 */
function guidedFilter1D(
  guide: Float32Array,
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  epsilon: number,
): Float32Array {
  const n = width * height;
  const meanI = boxMeanPlane(guide, width, height, radius);
  const meanP = boxMeanPlane(src, width, height, radius);
  const corrI = new Float32Array(n);
  const corrIp = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    corrI[i] = (guide[i] ?? 0) * (guide[i] ?? 0);
    corrIp[i] = (guide[i] ?? 0) * (src[i] ?? 0);
  }
  const meanII = boxMeanPlane(corrI, width, height, radius);
  const meanIp = boxMeanPlane(corrIp, width, height, radius);

  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const varI = (meanII[i] ?? 0) - (meanI[i] ?? 0) * (meanI[i] ?? 0);
    const covIp = (meanIp[i] ?? 0) - (meanI[i] ?? 0) * (meanP[i] ?? 0);
    const ai = covIp / (varI + epsilon);
    a[i] = ai;
    b[i] = (meanP[i] ?? 0) - ai * (meanI[i] ?? 0);
  }

  const meanA = boxMeanPlane(a, width, height, radius);
  const meanB = boxMeanPlane(b, width, height, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const q = (meanA[i] ?? 0) * (guide[i] ?? 0) + (meanB[i] ?? 0);
    out[i] = Math.max(0, Math.min(1, q));
  }
  return out;
}

/**
 * Refine hair/fur/glass edges on an existing binary or soft mask.
 *
 * @param imageData - Source RGBA image (same dimensions as mask).
 * @param mask - Single-channel alpha mask (0–255).
 * @param opts - Refinement parameters (method, radius, etc.).
 */
export function refineHairMatting(
  imageData: ImageData,
  mask: Uint8Array,
  opts: HairMattingOptions = {},
): Uint8Array {
  const { width, height, data } = imageData;
  if (mask.length !== width * height) {
    throw new Error('Mask dimensions must match imageData');
  }

  const method = opts.method ?? 'guided';
  const edgeBandOnly = opts.edgeBandOnly ?? true;

  if (method === 'closed-form') {
    const radius = opts.radius ?? 4;
    const bandRadius = Math.max(1, Math.floor(opts.bandRadius ?? radius));
    const trimap = trimapFromMask(mask, width, height, bandRadius);
    const result = solveMattingLaplacian({ data, width, height }, trimap, {
      laplacianRadius: opts.laplacianRadius ?? 1,
      laplacianEpsilon: opts.epsilon ?? 1e-7,
      maxIterations: opts.iterations ?? 100,
      tolerance: opts.tolerance,
      maxUnknownPixels: opts.maxUnknownPixels,
      maxRegionPixels: opts.maxRegionPixels,
      initialAlpha: mask,
      initialWeight: Math.max(0, Number.isFinite(opts.lambda) ? opts.lambda! : 0),
      onDiagnostics: opts.onDiagnostics,
    });
    if (result) return result.alpha;
    // Refused (documented bound or no constraints): keep the previous valid
    // result rather than returning corrupted coverage, and fall back to the
    // guided smoother so the caller still gets a bounded update.
    return refineHairMatting(imageData, mask, { ...opts, method: 'guided' });
  }

  const radius = Math.max(1, Math.floor(opts.radius ?? 4));
  const epsilon = opts.epsilon ?? 0.01;
  const guide = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    guide[i] = luminance(r, g, b);
    alpha[i] = (mask[i] ?? 0) / 255;
  }

  const refined = guidedFilter1D(guide, alpha, width, height, radius, epsilon);
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    const value = mask[i] ?? 0;
    if (edgeBandOnly && (value <= 10 || value >= 245)) {
      result[i] = value;
    } else {
      result[i] = Math.round((refined[i] ?? 0) * 255);
    }
  }
  return result;
}
