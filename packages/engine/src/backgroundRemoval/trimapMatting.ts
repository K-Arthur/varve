/**
 * Trimap-based alpha matting.
 *
 * The heavy lifting lives in `mattingSolver.ts`: a corrected closed-form
 * matting Laplacian (Levin et al., CVPR 2006) solved matrix-free over the
 * unknown band with hard foreground/background constraints. This module keeps
 * the historical `solveTrimapMatting` / `trimapFromMask` surface for existing
 * callers.
 */

import { type MattingDiagnostics, solveMattingLaplacian, TRIMap } from './mattingSolver';

export { trimapFromMask } from './mattingSolver';

export interface TrimapMattingOptions {
  /** Conjugate-gradient iteration cap (default 100). */
  iterations?: number;
  /** Matting window radius (default 1 → 3×3 windows). */
  windowRadius?: number;
  /** Warm start for unknown pixels. */
  initialAlpha?: Uint8Array;
  /** Laplacian regularization ε (default 1e-7). */
  laplacianEpsilon?: number;
  /** Relative residual tolerance (default 1e-5). */
  tolerance?: number;
  maxUnknownPixels?: number;
  maxRegionPixels?: number;
  onDiagnostics?: (diagnostics: MattingDiagnostics) => void;
}

function isForeground(label: number): boolean {
  return label >= TRIMap.FG - 10;
}

/**
 * Solve alpha from a user-painted trimap and source image.
 *
 * Known labels are hard constraints; unknown pixels are estimated from the
 * image's local colour line. Throws an honest error when the trimap has no
 * constraints or the bounded solver refuses; callers keep their previous mask.
 *
 * @param imageData - Source RGBA image.
 * @param trimap - Per-pixel trimap values: 0=bg, 128=unknown, 255=fg.
 */
export function solveTrimapMatting(
  imageData: ImageData,
  trimap: Uint8Array,
  opts: TrimapMattingOptions = {},
): Uint8Array {
  const { width, height } = imageData;
  if (trimap.length !== width * height) {
    throw new Error('Trimap dimensions must match imageData');
  }

  let refusal: string | undefined;
  const result = solveMattingLaplacian({ data: imageData.data, width, height }, trimap, {
    laplacianRadius: opts.windowRadius ?? 1,
    laplacianEpsilon: opts.laplacianEpsilon ?? 1e-7,
    maxIterations: opts.iterations ?? 100,
    tolerance: opts.tolerance,
    maxUnknownPixels: opts.maxUnknownPixels,
    maxRegionPixels: opts.maxRegionPixels,
    initialAlpha: opts.initialAlpha,
    onDiagnostics: (diagnostics) => {
      refusal = diagnostics.refusedReason;
      opts.onDiagnostics?.(diagnostics);
    },
  });
  if (result) return result.alpha;

  if (opts.initialAlpha && opts.initialAlpha.length === trimap.length) {
    return new Uint8Array(opts.initialAlpha);
  }
  throw new Error(
    refusal === 'no-constraints'
      ? 'Paint foreground and background constraints before solving the matte'
      : `Matting could not be solved (${refusal ?? 'unknown reason'})`,
  );
}

/**
 * Iterative alpha propagation used by older callers that cannot provide a
 * colour image. Prefer `solveTrimapMatting`; this remains a bounded,
 * deterministic fallback that never treats `TRIMap.UNKNOWN` as 50% opacity.
 */
export function propagateTrimapAlpha(
  trimap: Uint8Array,
  width: number,
  height: number,
  iterations = 8,
): Uint8Array {
  const n = width * height;
  const alpha = new Float32Array(n);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const label = trimap[i] ?? 0;
    if (isForeground(label)) {
      alpha[i] = 1;
      known[i] = 1;
    } else if (label <= TRIMap.BG + 10) {
      alpha[i] = 0;
      known[i] = 1;
    }
  }
  const rounds = Math.max(0, Math.min(1024, Math.floor(iterations)));
  const queue = new Int32Array(n);
  const distance = new Int32Array(n).fill(-1);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i += 1) {
    if (known[i]) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const current = queue[head++]!;
    const x = current % width;
    const y = (current - x) / width;
    if (distance[current]! >= rounds) continue;
    for (let k = 0; k < 4; k += 1) {
      const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (distance[next]! >= 0) continue;
      distance[next] = distance[current]! + 1;
      alpha[next] = alpha[current]!;
      queue[tail++] = next;
    }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round((alpha[i] ?? 0) * 255)));
  }
  return out;
}
