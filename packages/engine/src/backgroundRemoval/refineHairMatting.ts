/**
 * Hair/fur edge matting refinement via guided filter (He et al. ECCV 2010).
 *
 * Refines semi-transparent boundary pixels using image luminance structure
 * as a guide — appropriate for on-device CPU without GPU matting networks.
 *
 * Research basis: Guided Image Filtering (He, Sun, Tang); Photoshop Select
 * & Mask edge refinement; closed-form local linear models.
 */

export interface HairMattingOptions {
  /** Guided filter window radius in pixels (default 4). */
  radius?: number;
  /** Regularization epsilon (default 0.01). */
  epsilon?: number;
  /** Only refine pixels in the edge band (10–245), leaving core fg/bg intact. */
  edgeBandOnly?: boolean;
}

const TRIMap_FG = 255;
const TRIMap_BG = 0;
const TRIMap_UNKNOWN = 128;

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Box filter mean over a square window (separable approximation). */
function boxMean(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const out = new Float32Array(src.length);
  const diam = radius * 2 + 1;
  const area = diam * diam;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          sum += src[ny * width + nx] ?? 0;
        }
      }
      out[y * width + x] = sum / area;
    }
  }
  return out;
}

/**
 * Single-channel guided filter: refines `p` (mask alpha) guided by `I` (image).
 * Returns filtered alpha in [0, 1].
 */
function guidedFilter1D(
  guide: Float32Array,
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  epsilon: number,
): Float32Array {
  const meanI = boxMean(guide, width, height, radius);
  const meanP = boxMean(src, width, height, radius);

  const corrI = new Float32Array(src.length);
  const corrIp = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    corrI[i] = (guide[i] ?? 0) * (guide[i] ?? 0);
    corrIp[i] = (guide[i] ?? 0) * (src[i] ?? 0);
  }
  const meanII = boxMean(corrI, width, height, radius);
  const meanIp = boxMean(corrIp, width, height, radius);

  const a = new Float32Array(src.length);
  const b = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const varI = (meanII[i] ?? 0) - (meanI[i] ?? 0) * (meanI[i] ?? 0);
    const covIp = (meanIp[i] ?? 0) - (meanI[i] ?? 0) * (meanP[i] ?? 0);
    const ai = covIp / (varI + epsilon);
    a[i] = ai;
    b[i] = (meanP[i] ?? 0) - ai * (meanI[i] ?? 0);
  }

  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);

  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
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
 * @param opts - Guided filter parameters.
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

  const radius = opts.radius ?? 4;
  const epsilon = opts.epsilon ?? 0.01;
  const edgeBandOnly = opts.edgeBandOnly ?? true;

  const guide = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    guide[i] = luminance(r, g, b);
    alpha[i] = (mask[i] ?? 0) / 255;
  }

  const refined = guidedFilter1D(guide, alpha, width, height, radius, epsilon);
  const result = new Uint8Array(mask.length);

  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    if (edgeBandOnly && (v <= 10 || v >= 245)) {
      result[i] = v;
    } else {
      result[i] = Math.round((refined[i] ?? 0) * 255);
    }
  }
  return result;
}

/** Trimap zone constants for matting consumers. */
export const TRIMap = {
  FG: TRIMap_FG,
  BG: TRIMap_BG,
  UNKNOWN: TRIMap_UNKNOWN,
} as const;
