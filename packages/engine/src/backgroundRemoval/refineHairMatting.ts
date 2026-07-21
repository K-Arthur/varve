/**
 * Hair/fur edge matting refinement via guided filter (He et al. ECCV 2010)
 * or closed-form matting (Levin et al. SIGGRAPH 2006).
 *
 * Refines semi-transparent boundary pixels using image luminance structure
 * as a guide — appropriate for on-device CPU without GPU matting networks.
 *
 * Research basis:
 *   - Guided Image Filtering (He, Sun, Tang, ECCV 2010)
 *   - A Closed Form Solution to Natural Image Matting (Levin, Lischinski,
 *     Weiss, SIGGRAPH 2006)
 *   - Photoshop Select & Mask edge refinement
 *
 * The `method` field selects the refinement algorithm:
 *   - `'guided'` — fast box-filter guided filter (default, ~O(N) runtime)
 *   - `'closed-form'` — sparse Laplacian matting (~O(N·iter) with Gauss-Seidel)
 */

export type MattingMethod = 'guided' | 'closed-form';

export interface HairMattingOptions {
  /** Refinement method (default 'guided'). */
  method?: MattingMethod;
  /** Guided filter window radius in pixels (default 4). */
  radius?: number;
  /** Regularization epsilon (default 0.01 for guided, 1e-6 for closed-form). */
  epsilon?: number;
  /** Only refine pixels in the edge band (10–245), leaving core fg/bg intact. */
  edgeBandOnly?: boolean;
  /** Gauss-Seidel iterations for closed-form matting (default 40). */
  iterations?: number;
  /** Weight of the data term relative to the Laplacian (default 100). */
  lambda?: number;
  /** Window radius for Laplacian affinity (default 1 → 3×3 window). */
  laplacianRadius?: number;
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

// ── Closed-form matting (Levin et al. 2006) ──────────────────────────

/**
 * Solve the sparse linear system (L + λ·D)·α = λ·v using Gauss-Seidel
 * iteration over the edge band only.
 *
 * The matting Laplacian L captures local color affinity: pixels with
 * similar colors in a local window should have similar alpha values.
 *
 * Research basis: Levin, Lischinski, Weiss, "A Closed Form Solution to
 * Natural Image Matting," SIGGRAPH 2006, Section 3.1.
 */
function applyClosedFormMatting(
  rgba: Uint8Array,
  mask: Uint8Array,
  w: number,
  h: number,
  opts: {
    laplacianEpsilon: number;
    iterations: number;
    lambda: number;
    laplacianRadius: number;
    edgeBandOnly: boolean;
  },
): Uint8Array {
  const { laplacianEpsilon, iterations, lambda, edgeBandOnly } = opts;

  const n = w * h;
  const result = new Float32Array(mask);
  const rHalf = 1; // 3×3 window

  // Identify which pixels are in the edge band (unknown region)
  const inBand = new Uint8Array(n);
  let bandCount = 0;
  const bandIndex = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mask[i] ?? 0;
    if (edgeBandOnly && (v <= 10 || v >= 245)) {
      inBand[i] = 0;
      bandIndex[i] = -1;
    } else {
      inBand[i] = 1;
      bandIndex[i] = bandCount++;
    }
  }

  // If no edge band pixels to refine, return original
  if (bandCount === 0) return new Uint8Array(mask);

  // Cache RGB as float [0,1]
  const rBuf = new Float32Array(n);
  const gBuf = new Float32Array(n);
  const bBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rBuf[i] = (rgba[i * 4] ?? 0) / 255;
    gBuf[i] = (rgba[i * 4 + 1] ?? 0) / 255;
    bBuf[i] = (rgba[i * 4 + 2] ?? 0) / 255;
  }

  // Store Laplacian as sparse rows: for each pixel in band, accumulate
  // affinity contributions from every window that contains it.
  // L(i,j) = sum over windows k containing both i,j of
  //   (1/|w_k|) * (1 + (I_i - μ_k)^T (Σ_k + ε/|w_k| I)^{-1} (I_j - μ_k))
  // with negative sign for off-diagonal.
  // We store the sparse matrix as weighted adjacency lists.

  const laplacianRows: Map<number, number>[] = new Array(bandCount);
  for (let i = 0; i < bandCount; i++) {
    laplacianRows[i] = new Map();
  }

  const windowSize = (2 * rHalf + 1) ** 2; // 9 for 3×3
  const invWindowSize = 1 / windowSize;

  // Build the Laplacian: iterate over every 3×3 window
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      // Collect pixels in this window
      const pxIndices: number[] = [];
      const colors: number[][] = [];
      for (let dy = -rHalf; dy <= rHalf; dy++) {
        for (let dx = -rHalf; dx <= rHalf; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px >= 0 && px < w && py >= 0 && py < h) {
            const idx = py * w + px;
            pxIndices.push(idx);
            colors.push([rBuf[idx] ?? 0, gBuf[idx] ?? 0, bBuf[idx] ?? 0]);
          }
        }
      }

      if (pxIndices.length < 3) continue;

      // Compute mean color in the window
      let mR = 0,
        mG = 0,
        mB = 0;
      for (const c of colors) {
        mR += c[0]!;
        mG += c[1]!;
        mB += c[2]!;
      }
      const nPx = colors.length;
      mR /= nPx;
      mG /= nPx;
      mB /= nPx;

      // Compute covariance matrix (3×3)
      let c00 = 0,
        c01 = 0,
        c02 = 0;
      let c11 = 0,
        c12 = 0;
      let c22 = 0;
      for (const c of colors) {
        c00 += (c[0]! - mR) * (c[0]! - mR);
        c01 += (c[0]! - mR) * (c[1]! - mG);
        c02 += (c[0]! - mR) * (c[2]! - mB);
        c11 += (c[1]! - mG) * (c[1]! - mG);
        c12 += (c[1]! - mG) * (c[2]! - mB);
        c22 += (c[2]! - mB) * (c[2]! - mB);
      }
      const invN = 1 / nPx;
      c00 *= invN;
      c01 *= invN;
      c02 *= invN;
      c11 *= invN;
      c12 *= invN;
      c22 *= invN;

      // Regularize: Σ_k + (ε / |w_k|) I
      const eps = opts.laplacianEpsilon;
      const reg = eps * invWindowSize;
      c00 += reg;
      c11 += reg;
      c22 += reg;

      // Determinant of the 3×3 matrix
      const det =
        c00 * (c11 * c22 - c12 * c12) -
        c01 * (c01 * c22 - c12 * c02) +
        c02 * (c01 * c12 - c11 * c02);

      if (Math.abs(det) < 1e-12) continue;

      const invDet = 1 / det;
      // Compute inverse matrix (symmetric)
      const ic00 = (c11 * c22 - c12 * c12) * invDet;
      const ic01 = (c02 * c12 - c01 * c22) * invDet;
      const ic02 = (c01 * c12 - c11 * c02) * invDet;
      const ic11 = (c00 * c22 - c02 * c02) * invDet;
      const ic12 = (c02 * c01 - c00 * c12) * invDet;
      const ic22 = (c00 * c11 - c01 * c01) * invDet;

      // Compute affinity for each pair in the window
      for (let ii = 0; ii < pxIndices.length; ii++) {
        const iIdx = pxIndices[ii]!;
        const bi = bandIndex[iIdx]!;
        if (bi < 0) continue;

        const ci = colors[ii]!;
        const jr0 = ci[0]! - mR;
        const jg0 = ci[1]! - mG;
        const jb0 = ci[2]! - mB;

        for (let jj = 0; jj < pxIndices.length; jj++) {
          const jIdx = pxIndices[jj]!;
          const bj = bandIndex[jIdx]!;
          if (bj < 0) continue;

          const cj = colors[jj]!;
          const jr1 = cj[0]! - mR;
          const jg1 = cj[1]! - mG;
          const jb1 = cj[2]! - mB;

          const t =
            jr0 * (ic00 * jr1 + ic01 * jg1 + ic02 * jb1) +
            jg0 * (ic01 * jr1 + ic11 * jg1 + ic12 * jb1) +
            jb0 * (ic02 * jr1 + ic12 * jg1 + ic22 * jb1);

          const affinity = -invWindowSize * (1 + t);

          if (iIdx === jIdx) {
            const cur = laplacianRows[bi]!.get(bj) ?? 0;
            laplacianRows[bi]!.set(bj, cur + (invWindowSize * nPx - 1 - affinity));
          } else {
            const cur = laplacianRows[bi]!.get(bj) ?? 0;
            laplacianRows[bi]!.set(bj, cur - affinity);
          }
        }
      }
    }
  }

  // Gauss-Seidel iteration on the band system
  // System: (L_band + λ·I) · α_band = λ · α_init_band
  // where α_init comes from the original mask values
  const x = new Float32Array(bandCount);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    if (bandIndex[i]! >= 0) {
      x[idx++] = result[i]!;
    }
  }

  const constraintWeight = new Float32Array(bandCount).fill(lambda);
  const constraintValue = new Float32Array(bandCount);

  idx = 0;
  for (let i = 0; i < n; i++) {
    if (bandIndex[i]! >= 0) {
      const v = mask[i] ?? 0;
      if (v <= 10) {
        constraintValue[idx] = 0;
        constraintWeight[idx] = lambda * 10;
      } else if (v >= 245) {
        constraintValue[idx] = 1;
        constraintWeight[idx] = lambda * 10;
      } else {
        constraintValue[idx] = (mask[i] ?? 0) / 255;
        constraintWeight[idx] = 1;
      }
      idx++;
    }
  }

  // Gauss-Seidel: for each pixel, solve using current estimates of neighbors
  for (let iter = 0; iter < iterations; iter++) {
    let maxDiff = 0;
    for (let i = 0; i < bandCount; i++) {
      const row = laplacianRows[i]!;
      let diag = 0;
      let sumOffDiag = 0;
      for (const [j, val] of row) {
        if (j === i) {
          diag = val;
        } else {
          sumOffDiag += val * (x[j] ?? 0);
        }
      }

      // (L_ii + λ) * x_i = -sum(L_ij * x_j) + λ * constraintValue
      const denominator = diag + (constraintWeight[i] ?? 0);
      if (denominator < 1e-12) continue;

      const newVal =
        (-sumOffDiag + (constraintWeight[i] ?? 0) * (constraintValue[i] ?? 0)) / denominator;
      const diff = Math.abs(newVal - x[i]!);
      if (diff > maxDiff) maxDiff = diff;
      x[i] = Math.max(0, Math.min(1, newVal));
    }
    if (maxDiff < 1e-4) break; // Converged
  }

  // Write back
  const out = new Uint8Array(n);
  idx = 0;
  for (let i = 0; i < n; i++) {
    if (bandIndex[i]! >= 0) {
      out[i] = Math.round(Math.min(255, Math.max(0, x[idx++]! * 255)));
    } else {
      out[i] = mask[i] ?? 0;
    }
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
    return applyClosedFormMatting(data as unknown as Uint8Array, mask, width, height, {
      laplacianEpsilon: opts.epsilon ?? 1e-6,
      iterations: opts.iterations ?? 40,
      lambda: opts.lambda ?? 100,
      laplacianRadius: opts.laplacianRadius ?? 1,
      edgeBandOnly,
    });
  }

  // Default: guided filter
  const radius = opts.radius ?? 4;
  const epsilon = opts.epsilon ?? 0.01;

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
