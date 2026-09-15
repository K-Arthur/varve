/**
 * Closed-form alpha matting (Levin, Lischinski & Weiss, CVPR 2006) with hard
 * trimap constraints, solved matrix-free.
 *
 * The matting Laplacian is built from the paper's color-line model:
 *
 *   L(i,j) = Σ_k ( δ_ij − 1/|w_k| (1 + (I_i−μ_k)ᵀ (Σ_k + ε/|w_k| I₃)⁻¹ (I_j−μ_k)) )
 *
 * and the constrained system is solved only over unknown pixels, with known
 * foreground/background values fixed:
 *
 *   (L x)_u = −(L β_k)_u ,  β_k = 1 for known foreground, 0 for known background
 *
 * Rather than materializing the sparse matrix, each matrix-vector product is
 * computed with the filter identity used by large-kernel matting
 * (He et al., "Fast Matting Using Large Kernel Matting Laplacian Matrices",
 * CVPR 2010):
 *
 *   (Lp)_i = n_i p_i − Σ_{k ∋ i} ( p̄_k + a_kᵀ (I_i − μ_k) ),
 *   a_k = (Σ_k + ε/|w_k| I)⁻¹ · ( (1/|w_k|) Σ_{j∈w_k} (I_j − μ_k) p_j )
 *
 * which expands into a handful of O(N) sliding-window box sums per iteration.
 * Conjugate Gradient with a Jacobi preconditioner then solves the system.
 *
 * Honest bounds: the solve is restricted to the bounding box of the unknown
 * band (plus a margin of known pixels) and is refused — with a diagnostic —
 * when that region or the unknown count exceeds the configured caps. The
 * caller keeps its last valid result and can fall back to guided filtering.
 */

import { growPlane, shrinkPlane } from '../areaSelectionMorphology';

/** Trimap zone constants shared with the refinement tools. */
export const TRIMap = {
  FG: 255,
  BG: 0,
  UNKNOWN: 128,
} as const;

/** Coverage below/above these values is treated as definite background/foreground. */
const CORE_LOW = 10;
const CORE_HIGH = 245;

/**
 * Build a categorical trimap from a coverage mask.
 *
 * Unlike the historical implementation, which could only mark pixels that
 * already had intermediate coverage, this builds a *spatial* unknown band
 * around the 50% contour. A hard binary mask (only 0 and 255) therefore gets a
 * real unknown region and can be matted, which is the point of the trimap
 * workflow. The band is symmetric: recovering hair that the current mask
 * missed requires unknown pixels on both sides of the contour.
 *
 * Pixels with intermediate coverage are always unknown regardless of distance,
 * because their current value is exactly what matting should re-estimate.
 * Image-border pixels are never forced to background: they follow the same
 * distance rule as every other pixel.
 */
export function trimapFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  unknownBandPx = 3,
): Uint8Array {
  const n = width * height;
  const trimap = new Uint8Array(Math.max(0, n));
  if (n === 0 || mask.length < n) return trimap;
  const band = Math.max(0, Math.floor(Number.isFinite(unknownBandPx) ? unknownBandPx : 0));

  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) inside[i] = (mask[i] ?? 0) >= 128 ? 255 : 0;

  // The unknown band straddles the 50% contour: dilating the binary shape
  // marks the outside half of the band and eroding marks the inside half.
  // Morphology is O(N) and needs only one byte per plane, so a 50 MP image
  // does not allocate the three Float32 planes a signed distance field would.
  const dilated = band > 0 ? growPlane(inside, width, height, band, 'exclude') : null;
  const eroded = band > 0 ? shrinkPlane(inside, width, height, band, 'exclude') : null;
  for (let i = 0; i < n; i += 1) {
    const coverage = mask[i] ?? 0;
    const intermediate = coverage > CORE_LOW && coverage < CORE_HIGH;
    const nearBoundary =
      dilated !== null && eroded !== null && dilated[i]! >= 128 && eroded[i]! < 128;
    if (intermediate || nearBoundary) {
      trimap[i] = TRIMap.UNKNOWN;
    } else {
      trimap[i] = coverage >= 128 ? TRIMap.FG : TRIMap.BG;
    }
  }
  return trimap;
}

export interface MattingSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface MattingDiagnostics {
  method: 'closed-form';
  regionWidth: number;
  regionHeight: number;
  unknownPixels: number;
  knownForeground: number;
  knownBackground: number;
  iterations: number;
  /** ||b − Ax|| / ||b|| at the final iteration (0 when solved exactly). */
  relativeResidual: number;
  refusedReason?: 'no-constraints' | 'region-too-large' | 'unknown-too-large' | 'non-convergence';
}

export interface MattingSolveOptions {
  /** Matting window radius. Default 1 (3×3), matching the paper. */
  laplacianRadius?: number;
  /** Regularization ε in the color-line covariance. Default 1e-7. */
  laplacianEpsilon?: number;
  /** Conjugate-gradient iteration cap. Default 100. */
  maxIterations?: number;
  /** Relative residual tolerance. Default 1e-5. */
  tolerance?: number;
  /** Refuse when the unknown band exceeds this many pixels. Default 262 144. */
  maxUnknownPixels?: number;
  /** Refuse when the cropped solve region exceeds this many pixels. Default 1 048 576. */
  maxRegionPixels?: number;
  /** Warm start for unknown pixels (0-255); defaults to 0.5 coverage. */
  initialAlpha?: Uint8Array;
  /** Optional weak data term toward `initialAlpha` for unknown pixels. Default 0. */
  initialWeight?: number;
  onDiagnostics?: (diagnostics: MattingDiagnostics) => void;
}

export interface MattingSolveResult {
  alpha: Uint8Array;
  diagnostics: MattingDiagnostics;
  /** True when the solver converged inside the tolerance. */
  converged: boolean;
}

function isForeground(label: number): boolean {
  return label >= TRIMap.FG - 10;
}

function isBackground(label: number): boolean {
  return label <= TRIMap.BG + 10;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Solve for a fractional alpha matte from a categorical trimap.
 *
 * Returns `null` when the problem is refused (with `onDiagnostics` explaining
 * why); the caller must keep its previous result rather than treating null as
 * an empty matte.
 */
export function solveMattingLaplacian(
  source: MattingSource,
  trimap: Uint8Array,
  options: MattingSolveOptions = {},
): MattingSolveResult | null {
  const imageWidth = source.width;
  const imageHeight = source.height;
  if (trimap.length !== imageWidth * imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('Trimap dimensions must match the source image');
  }

  const radius = clampInt(options.laplacianRadius ?? 1, 0, 4);
  const epsilon = finitePositive(options.laplacianEpsilon ?? 1e-7, 1e-7);
  const maxIterations = clampInt(options.maxIterations ?? 100, 1, 2000);
  const tolerance = finitePositive(options.tolerance ?? 1e-5, 1e-5);
  const maxUnknownPixels = clampInt(options.maxUnknownPixels ?? 262_144, 1, 16_777_216);
  const maxRegionPixels = clampInt(options.maxRegionPixels ?? 1_048_576, 1, 16_777_216);
  const initialWeight = Math.max(
    0,
    Number.isFinite(options.initialWeight) ? options.initialWeight! : 0,
  );

  let unknownPixels = 0;
  let knownForeground = 0;
  let knownBackground = 0;
  let minX = imageWidth;
  let minY = imageHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const i = y * imageWidth + x;
      const label = trimap[i] ?? TRIMap.BG;
      if (isForeground(label)) {
        knownForeground += 1;
      } else if (isBackground(label)) {
        knownBackground += 1;
      } else {
        unknownPixels += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const base = {
    method: 'closed-form' as const,
    regionWidth: imageWidth,
    regionHeight: imageHeight,
    unknownPixels,
    knownForeground,
    knownBackground,
    iterations: 0,
    relativeResidual: 0,
  };

  if (knownForeground + knownBackground === 0) {
    options.onDiagnostics?.({ ...base, refusedReason: 'no-constraints' });
    return null;
  }
  if (unknownPixels === 0) {
    const alpha = new Uint8Array(imageWidth * imageHeight);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = isForeground(trimap[i] ?? 0) ? 255 : 0;
    options.onDiagnostics?.({ ...base });
    return { alpha, diagnostics: { ...base }, converged: true };
  }

  // Solve only over the unknown band's bounding box plus enough known context
  // for the windows to see both labels.
  const margin = Math.max(2, radius * 3);
  const regionX = Math.max(0, minX - margin);
  const regionY = Math.max(0, minY - margin);
  const regionRight = Math.min(imageWidth - 1, maxX + margin);
  const regionBottom = Math.min(imageHeight - 1, maxY + margin);
  const regionWidth = regionRight - regionX + 1;
  const regionHeight = regionBottom - regionY + 1;
  const region = {
    ...base,
    regionWidth,
    regionHeight,
  };
  if (regionWidth * regionHeight > maxRegionPixels) {
    options.onDiagnostics?.({ ...region, refusedReason: 'region-too-large' });
    return null;
  }
  if (unknownPixels > maxUnknownPixels) {
    options.onDiagnostics?.({ ...region, refusedReason: 'unknown-too-large' });
    return null;
  }

  const width = regionWidth;
  const height = regionHeight;
  const n = width * height;
  const windowSize = (2 * radius + 1) ** 2;

  const guideR = new Float32Array(n);
  const guideG = new Float32Array(n);
  const guideB = new Float32Array(n);
  const known = new Uint8Array(n);
  const labelValue = new Float32Array(n);
  const initial = new Float32Array(n);
  const unknownIndex = new Int32Array(n).fill(-1);
  const unknownAt = new Int32Array(unknownPixels);
  let unknownCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const sourceX = regionX + x;
      const sourceY = regionY + y;
      const sourceAt = (sourceY * imageWidth + sourceX) * 4;
      guideR[i] = (source.data[sourceAt] ?? 0) / 255;
      guideG[i] = (source.data[sourceAt + 1] ?? 0) / 255;
      guideB[i] = (source.data[sourceAt + 2] ?? 0) / 255;
      const label = trimap[sourceY * imageWidth + sourceX] ?? TRIMap.BG;
      if (isForeground(label)) {
        known[i] = 1;
        labelValue[i] = 1;
        initial[i] = 1;
      } else if (isBackground(label)) {
        known[i] = 1;
        labelValue[i] = 0;
        initial[i] = 0;
      } else {
        unknownIndex[i] = unknownCount;
        unknownAt[unknownCount] = i;
        unknownCount += 1;
        const seed = options.initialAlpha?.[sourceY * imageWidth + sourceX];
        initial[i] = Number.isFinite(seed) ? (seed as number) / 255 : 0.5;
      }
    }
  }

  // Matrix-free matting Laplacian; `full` holds the current alpha vector over
  // the whole crop (known pixels fixed at their labels).
  const operator = createMattingLaplacianOperator(
    guideR,
    guideG,
    guideB,
    width,
    height,
    radius,
    epsilon,
  );
  const multiply = (input: Float32Array): Float32Array => operator.multiply(input);
  const full = new Float32Array(n);

  // Right-hand side: b_u = −(L β_k)_u.
  for (let i = 0; i < n; i += 1) full[i] = known[i] ? labelValue[i]! : 0;
  const lBeta = multiply(full).slice();
  const b = new Float32Array(unknownCount);
  for (let u = 0; u < unknownCount; u += 1) {
    b[u] = -lBeta[unknownAt[u]!]! + initialWeight * initial[unknownAt[u]!]!;
  }

  // Warm start.
  const x = new Float32Array(unknownCount);
  for (let u = 0; u < unknownCount; u += 1) x[u] = initial[unknownAt[u]!]!;

  const applyA = (input: Float32Array, target: Float32Array): void => {
    // The operator acts on the unknown subspace: known pixels are zero here
    // (their fixed labels live on the right-hand side), otherwise the product
    // would carry a constant term and CG would no longer be solving a
    // symmetric positive-definite system.
    for (let i = 0; i < n; i += 1) {
      full[i] = known[i] ? 0 : input[unknownIndex[i]!]!;
    }
    const product = multiply(full);
    const weight = initialWeight;
    for (let u = 0; u < unknownCount; u += 1) {
      target[u] = product[unknownAt[u]!]! + weight * input[u]!;
    }
  };

  const r = new Float32Array(unknownCount);
  applyA(x, r);
  let bNormSq = 0;
  for (let u = 0; u < unknownCount; u += 1) {
    r[u] = b[u]! - r[u]!;
    bNormSq += b[u]! * b[u]!;
  }
  const bNorm = Math.sqrt(bNormSq);
  const preconditioner = 1 / (windowSize + initialWeight);
  const z = new Float32Array(unknownCount);
  const p = new Float32Array(unknownCount);
  const ap = new Float32Array(unknownCount);
  for (let u = 0; u < unknownCount; u += 1) z[u] = r[u]! * preconditioner;
  p.set(z);
  let rz = 0;
  for (let u = 0; u < unknownCount; u += 1) rz += r[u]! * z[u]!;

  let iterations = 0;
  let relativeResidual =
    bNorm > 0 ? Math.sqrt(r.reduce((sum, value) => sum + value * value, 0)) / bNorm : 0;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    if (!(rz > 0)) break;
    applyA(p, ap);
    let pAp = 0;
    for (let u = 0; u < unknownCount; u += 1) pAp += p[u]! * ap[u]!;
    if (!(pAp > 1e-20)) break;
    const alphaCg = rz / pAp;
    let rSq = 0;
    for (let u = 0; u < unknownCount; u += 1) {
      x[u] = x[u]! + alphaCg * p[u]!;
      r[u] = r[u]! - alphaCg * ap[u]!;
      rSq += r[u]! * r[u]!;
    }
    relativeResidual = bNorm > 0 ? Math.sqrt(rSq) / bNorm : 0;
    if (relativeResidual <= tolerance) break;
    for (let u = 0; u < unknownCount; u += 1) z[u] = r[u]! * preconditioner;
    let rzNext = 0;
    for (let u = 0; u < unknownCount; u += 1) rzNext += r[u]! * z[u]!;
    const beta = rzNext / rz;
    for (let u = 0; u < unknownCount; u += 1) p[u] = z[u]! + beta * p[u]!;
    rz = rzNext;
  }

  const converged = relativeResidual <= tolerance;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (known[i]) alpha[i] = labelValue[i]! >= 0.5 ? 255 : 0;
  }
  for (let u = 0; u < unknownCount; u += 1) {
    alpha[unknownAt[u]!] = Math.max(0, Math.min(255, Math.round(x[u]! * 255)));
  }

  const diagnostics: MattingDiagnostics = {
    ...region,
    iterations,
    relativeResidual,
    ...(converged ? {} : { refusedReason: 'non-convergence' as const }),
  };
  options.onDiagnostics?.(diagnostics);

  // Paste the cropped result back, leaving pixels outside the region as their
  // labels (they were all known; unknown pixels are inside the region by
  // construction).
  const fullAlpha = new Uint8Array(imageWidth * imageHeight);
  for (let i = 0; i < fullAlpha.length; i += 1) {
    fullAlpha[i] = isForeground(trimap[i] ?? 0) ? 255 : 0;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      fullAlpha[(regionY + y) * imageWidth + regionX + x] = alpha[y * width + x]!;
    }
  }
  return { alpha: fullAlpha, diagnostics, converged };
}
export interface MattingLaplacianOperator {
  readonly windowSize: number;
  /** Returns L·p for the whole region (a reused, caller-owned buffer). */
  multiply(input: Float32Array): Float32Array;
}

function writePrefix(dst: Float64Array, src: Float32Array, width: number, height: number): void {
  const stride = width + 1;
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const row = y * width;
    const nextRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[row + x]!;
      dst[nextRow + x + 1] = dst[previousRow + x + 1]! + rowSum;
    }
  }
}

function writeProductPrefix(
  dst: Float64Array,
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
): void {
  const stride = width + 1;
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const row = y * width;
    const nextRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += a[row + x]! * b[row + x]!;
      dst[nextRow + x + 1] = dst[previousRow + x + 1]! + rowSum;
    }
  }
}

function prefixRect(
  prefix: Float64Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return (
    prefix[(y1 + 1) * stride + x1 + 1]! -
    prefix[y0 * stride + x1 + 1]! -
    prefix[(y1 + 1) * stride + x0]! +
    prefix[y0 * stride + x0]!
  );
}

/**
 * Build the matrix-free matting Laplacian product for a guide image.
 *
 * Windows are partial at region edges, exactly as in the paper: a window
 * contributes only its in-bounds pixels and its covariance is normalized by
 * that count. This keeps the operator equal to the dense matting Laplacian
 * with no edge convention, no duplicated samples, and L’s constant
 * nullspace. Exposed for reference tests.
 */
export function createMattingLaplacianOperator(
  guideR: Float32Array,
  guideG: Float32Array,
  guideB: Float32Array,
  width: number,
  height: number,
  radius: number,
  epsilon: number,
): MattingLaplacianOperator {
  const n = width * height;
  const windowSize = (2 * radius + 1) ** 2;
  const stride = width + 1;
  const prefixLength = (width + 1) * (height + 1);

  // Guide statistics are data-independent and built once.
  const prefixIR = new Float64Array(prefixLength);
  const prefixIG = new Float64Array(prefixLength);
  const prefixIB = new Float64Array(prefixLength);
  const prefixIRR = new Float64Array(prefixLength);
  const prefixIRG = new Float64Array(prefixLength);
  const prefixIRB = new Float64Array(prefixLength);
  const prefixIGG = new Float64Array(prefixLength);
  const prefixIGB = new Float64Array(prefixLength);
  const prefixIBB = new Float64Array(prefixLength);
  writePrefix(prefixIR, guideR, width, height);
  writePrefix(prefixIG, guideG, width, height);
  writePrefix(prefixIB, guideB, width, height);
  writeProductPrefix(prefixIRR, guideR, guideR, width, height);
  writeProductPrefix(prefixIRG, guideR, guideG, width, height);
  writeProductPrefix(prefixIRB, guideR, guideB, width, height);
  writeProductPrefix(prefixIGG, guideG, guideG, width, height);
  writeProductPrefix(prefixIGB, guideG, guideB, width, height);
  writeProductPrefix(prefixIBB, guideB, guideB, width, height);

  // Per-product prefixes (reused every matrix-vector multiply).
  const prefixP = new Float64Array(prefixLength);
  const prefixPR = new Float64Array(prefixLength);
  const prefixPG = new Float64Array(prefixLength);
  const prefixPB = new Float64Array(prefixLength);
  const out = new Float32Array(n);

  const multiply = (input: Float32Array): Float32Array => {
    writePrefix(prefixP, input, width, height);
    writeProductPrefix(prefixPR, input, guideR, width, height);
    writeProductPrefix(prefixPG, input, guideG, width, height);
    writeProductPrefix(prefixPB, input, guideB, width, height);
    out.fill(0);
    for (let cy = 0; cy < height; cy += 1) {
      const y0 = Math.max(0, cy - radius);
      const y1 = Math.min(height - 1, cy + radius);
      for (let cx = 0; cx < width; cx += 1) {
        const x0 = Math.max(0, cx - radius);
        const x1 = Math.min(width - 1, cx + radius);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const invCount = 1 / count;
        const sumP = prefixRect(prefixP, stride, x0, y0, x1, y1);
        const mr = prefixRect(prefixIR, stride, x0, y0, x1, y1) * invCount;
        const mg = prefixRect(prefixIG, stride, x0, y0, x1, y1) * invCount;
        const mb = prefixRect(prefixIB, stride, x0, y0, x1, y1) * invCount;
        const cRR =
          prefixRect(prefixIRR, stride, x0, y0, x1, y1) * invCount - mr * mr + epsilon * invCount;
        const cRG = prefixRect(prefixIRG, stride, x0, y0, x1, y1) * invCount - mr * mg;
        const cRB = prefixRect(prefixIRB, stride, x0, y0, x1, y1) * invCount - mr * mb;
        const cGG =
          prefixRect(prefixIGG, stride, x0, y0, x1, y1) * invCount - mg * mg + epsilon * invCount;
        const cGB = prefixRect(prefixIGB, stride, x0, y0, x1, y1) * invCount - mg * mb;
        const cBB =
          prefixRect(prefixIBB, stride, x0, y0, x1, y1) * invCount - mb * mb + epsilon * invCount;
        const det =
          cRR * (cGG * cBB - cGB * cGB) -
          cRG * (cRG * cBB - cGB * cRB) +
          cRB * (cRG * cGB - cGG * cRB);
        let aR = 0;
        let aG = 0;
        let aB = 0;
        const pBar = sumP * invCount;
        if (Math.abs(det) > 1e-20) {
          const invDet = 1 / det;
          const iRR = (cGG * cBB - cGB * cGB) * invDet;
          const iRG = (cRB * cGB - cRG * cBB) * invDet;
          const iRB = (cRG * cGB - cRB * cGG) * invDet;
          const iGG = (cRR * cBB - cRB * cRB) * invDet;
          const iGB = (cRB * cRG - cRR * cGB) * invDet;
          const iBB = (cRR * cGG - cRG * cRG) * invDet;
          const cpr = (prefixRect(prefixPR, stride, x0, y0, x1, y1) - mr * sumP) * invCount;
          const cpg = (prefixRect(prefixPG, stride, x0, y0, x1, y1) - mg * sumP) * invCount;
          const cpb = (prefixRect(prefixPB, stride, x0, y0, x1, y1) - mb * sumP) * invCount;
          aR = iRR * cpr + iRG * cpg + iRB * cpb;
          aG = iRG * cpr + iGG * cpg + iGB * cpb;
          aB = iRB * cpr + iGB * cpg + iBB * cpb;
        }
        for (let py = y0; py <= y1; py += 1) {
          const row = py * width;
          for (let px = x0; px <= x1; px += 1) {
            const i = row + px;
            out[i]! +=
              input[i]! -
              (pBar + aR * (guideR[i]! - mr) + aG * (guideG[i]! - mg) + aB * (guideB[i]! - mb));
          }
        }
      }
    }
    return out;
  };

  return { windowSize, multiply };
}
