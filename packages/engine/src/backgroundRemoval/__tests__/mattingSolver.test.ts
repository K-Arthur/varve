import { describe, expect, it } from 'vitest';
import {
  createMattingLaplacianOperator,
  type MattingDiagnostics,
  solveMattingLaplacian,
  TRIMap,
  trimapFromMask,
} from '../mattingSolver';

interface SmallImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function makeImage(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number],
): SmallImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Independent dense reference: build the matting Laplacian from the paper's
 * definition using explicitly enumerated (clamped) window samples, then solve
 * the constrained system with Gaussian elimination.
 */
function denseMattingLaplacian(image: SmallImage, radius: number, epsilon: number): number[][] {
  const { width, height } = image;
  const n = width * height;
  const guide = (i: number) => [
    (image.data[i * 4] ?? 0) / 255,
    (image.data[i * 4 + 1] ?? 0) / 255,
    (image.data[i * 4 + 2] ?? 0) / 255,
  ];
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const indices: number[] = [];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          indices.push(y * width + x);
        }
      }
      const count = indices.length;
      const mean: [number, number, number] = [0, 0, 0];
      for (const i of indices) {
        const c = guide(i);
        mean[0] += c[0]!;
        mean[1] += c[1]!;
        mean[2] += c[2]!;
      }
      mean[0] /= count;
      mean[1] /= count;
      mean[2] /= count;
      const cov: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (const i of indices) {
        const c = guide(i);
        cov[0] += (c[0]! - mean[0]!) ** 2;
        cov[1] += (c[0]! - mean[0]!) * (c[1]! - mean[1]!);
        cov[2] += (c[0]! - mean[0]!) * (c[2]! - mean[2]!);
        cov[3] += (c[1]! - mean[1]!) ** 2;
        cov[4] += (c[1]! - mean[1]!) * (c[2]! - mean[2]!);
        cov[5] += (c[2]! - mean[2]!) ** 2;
      }
      const reg = epsilon / count;
      const m = [
        cov[0]! / count + reg,
        cov[1]! / count,
        cov[2]! / count,
        cov[3]! / count + reg,
        cov[4]! / count,
        cov[5]! / count + reg,
      ];
      const det =
        m[0]! * (m[3]! * m[5]! - m[4]! * m[4]!) -
        m[1]! * (m[1]! * m[5]! - m[4]! * m[2]!) +
        m[2]! * (m[1]! * m[4]! - m[3]! * m[2]!);
      const inv =
        det === 0
          ? null
          : [
              (m[3]! * m[5]! - m[4]! * m[4]!) / det,
              (m[2]! * m[4]! - m[1]! * m[5]!) / det,
              (m[1]! * m[4]! - m[2]! * m[3]!) / det,
              (m[0]! * m[5]! - m[2]! * m[2]!) / det,
              (m[2]! * m[1]! - m[0]! * m[4]!) / det,
              (m[0]! * m[3]! - m[1]! * m[1]!) / det,
            ];
      for (const i of indices) {
        for (const j of indices) {
          const ci = guide(i);
          const cj = guide(j);
          const di = [ci[0]! - mean[0]!, ci[1]! - mean[1]!, ci[2]! - mean[2]!];
          const dj = [cj[0]! - mean[0]!, cj[1]! - mean[1]!, cj[2]! - mean[2]!];
          const t = inv
            ? di[0]! * (inv[0]! * dj[0]! + inv[1]! * dj[1]! + inv[2]! * dj[2]!) +
              di[1]! * (inv[1]! * dj[0]! + inv[3]! * dj[1]! + inv[4]! * dj[2]!) +
              di[2]! * (inv[2]! * dj[0]! + inv[4]! * dj[1]! + inv[5]! * dj[2]!)
            : 0;
          L[i]![j]! -= (1 / count) * (1 + t);
          if (i === j) L[i]![j]! += 1;
        }
      }
    }
  }
  return L;
}

function denseReference(
  image: SmallImage,
  trimap: Uint8Array,
  radius: number,
  epsilon: number,
): { alpha: number[]; unknown: number[] } {
  const { width, height } = image;
  const n = width * height;
  const L = denseMattingLaplacian(image, radius, epsilon);
  const unknown: number[] = [];
  const known: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const label = trimap[i] ?? 0;
    if (label >= TRIMap.FG - 10 || label <= TRIMap.BG + 10) known.push(i);
    else unknown.push(i);
  }
  const beta0 = new Array<number>(n).fill(0);
  for (const i of known) beta0[i] = (trimap[i] ?? 0) >= TRIMap.FG - 10 ? 1 : 0;
  const b = unknown.map((i) => {
    let sum = 0;
    for (const j of known) sum += L[i]![j]! * beta0[j]!;
    return -sum;
  });
  const size = unknown.length;
  const A = unknown.map((i, ri) => unknown.map((j, ci) => L[i]![j]! + (ri === ci ? 1e-12 : 0)));
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(A[row]![col]!) > Math.abs(A[pivot]![col]!)) pivot = row;
    }
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const divisor = A[col]![col]!;
    for (let k = col; k < size; k += 1) A[col]![k] = A[col]![k]! / divisor;
    b[col] = b[col]! / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = A[row]![col]!;
      if (factor === 0) continue;
      for (let k = col; k < size; k += 1) A[row]![k] = A[row]![k]! - factor * A[col]![k]!;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  const alpha = new Array<number>(n).fill(0);
  for (const i of known) alpha[i] = beta0[i]!;
  unknown.forEach((i, index) => {
    alpha[i] = b[index]!;
  });
  return { alpha, unknown };
}

const diagnostics: MattingDiagnostics[] = [];
const capture = (d: MattingDiagnostics) => {
  diagnostics.push(d);
};

describe('solveMattingLaplacian', () => {
  it('matches a dense reference on a two-colour edge', () => {
    diagnostics.length = 0;
    const width = 6;
    const height = 6;
    const image = makeImage(width, height, (x) => (x < 3 ? [220, 30, 40] : [20, 60, 220]));
    const trimap = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        trimap[i] = x <= 1 ? TRIMap.BG : x >= 4 ? TRIMap.FG : TRIMap.UNKNOWN;
      }
    }
    const result = solveMattingLaplacian(image, trimap, {
      laplacianRadius: 1,
      laplacianEpsilon: 1e-7,
      maxIterations: 500,
      tolerance: 1e-10,
      onDiagnostics: capture,
    });
    expect(result).not.toBeNull();
    const reference = denseReference(image, trimap, 1, 1e-7);
    for (const i of reference.unknown) {
      expect(result!.alpha[i]! / 255).toBeCloseTo(Math.max(0, Math.min(1, reference.alpha[i]!)), 2);
    }
    expect(result!.diagnostics.relativeResidual).toBeLessThan(1e-5);
  });

  it('matrix-free operator matches the dense Laplacian product', () => {
    const width = 5;
    const height = 4;
    const image = makeImage(width, height, (x, y) => [
      x < 3 ? 200 : 40,
      y < 2 ? 120 : 220,
      x < 3 ? 60 : 190,
    ]);
    const radius = 1;
    const epsilon = 1e-7;
    const n = width * height;
    const guideR = new Float32Array(n);
    const guideG = new Float32Array(n);
    const guideB = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      guideR[i] = (image.data[i * 4] ?? 0) / 255;
      guideG[i] = (image.data[i * 4 + 1] ?? 0) / 255;
      guideB[i] = (image.data[i * 4 + 2] ?? 0) / 255;
    }
    const operator = createMattingLaplacianOperator(
      guideR,
      guideG,
      guideB,
      width,
      height,
      radius,
      epsilon,
    );
    const p = new Float32Array(n);
    let seed = 12345;
    for (let i = 0; i < n; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      p[i] = (seed % 1000) / 1000;
    }
    const q = operator.multiply(p);
    const dense = denseMattingLaplacian(image, radius, epsilon);
    for (let i = 0; i < n; i += 1) {
      let expected = 0;
      for (let j = 0; j < n; j += 1) expected += dense[i]![j]! * p[j]!;
      expect(q[i]!).toBeCloseTo(expected, 3);
    }
  });

  it('keeps known pixels exactly at their labels', () => {
    const image = makeImage(5, 3, (x) => (x < 2 ? [10, 10, 10] : [240, 240, 240]));
    const trimap = new Uint8Array(15);
    for (let i = 0; i < 15; i += 1)
      trimap[i] = i % 5 < 2 ? TRIMap.BG : i % 5 === 2 ? TRIMap.UNKNOWN : TRIMap.FG;
    const result = solveMattingLaplacian(image, trimap)!;
    expect(result).not.toBeNull();
    for (let i = 0; i < 15; i += 1) {
      const label = trimap[i]!;
      if (label >= TRIMap.FG - 10) expect(result.alpha[i]).toBe(255);
      if (label <= TRIMap.BG + 10) expect(result.alpha[i]).toBe(0);
    }
  });

  it('returns labels directly when there is no unknown region', () => {
    const image = makeImage(2, 2, () => [128, 128, 128]);
    const trimap = new Uint8Array([TRIMap.BG, TRIMap.FG, TRIMap.FG, TRIMap.BG]);
    const result = solveMattingLaplacian(image, trimap)!;
    expect(Array.from(result.alpha)).toEqual([0, 255, 255, 0]);
    expect(result.diagnostics.unknownPixels).toBe(0);
  });

  it('refuses a trimap with no constraints and reports why', () => {
    diagnostics.length = 0;
    const image = makeImage(3, 3, () => [10, 20, 30]);
    const trimap = new Uint8Array(9).fill(TRIMap.UNKNOWN);
    const result = solveMattingLaplacian(image, trimap, { onDiagnostics: capture });
    expect(result).toBeNull();
    expect(diagnostics[0]?.refusedReason).toBe('no-constraints');
  });

  it('refuses oversized unknown bands instead of allocating without bound', () => {
    diagnostics.length = 0;
    const image = makeImage(4, 4, () => [100, 100, 100]);
    const trimap = new Uint8Array(16).fill(TRIMap.UNKNOWN);
    trimap[0] = TRIMap.FG;
    trimap[15] = TRIMap.BG;
    const result = solveMattingLaplacian(image, trimap, {
      maxUnknownPixels: 4,
      onDiagnostics: capture,
    });
    expect(result).toBeNull();
    expect(diagnostics[0]?.refusedReason).toBe('unknown-too-large');
  });

  it('lets the colour line drive alpha: an unknown pixel matching the foreground colour solves high', () => {
    const width = 5;
    const height = 3;
    // Red foreground on the left, blue background on the right; the unknown
    // pixel carries red, so the colour line should assign it high alpha.
    const image = makeImage(width, height, (x) => (x <= 2 ? [220, 30, 40] : [20, 60, 220]));
    const trimap = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        trimap[i] = x === 1 ? TRIMap.FG : x === 2 ? TRIMap.UNKNOWN : TRIMap.BG;
      }
    }
    const result = solveMattingLaplacian(image, trimap, {
      laplacianRadius: 1,
      maxIterations: 200,
      tolerance: 1e-8,
    })!;
    expect(result).not.toBeNull();
    const unknown = result.alpha[1 * width + 2]! / 255;
    expect(unknown).toBeGreaterThan(0.7);
    expect(result.alpha[1 * width + 1]).toBe(255);
    expect(Number.isFinite(unknown)).toBe(true);
  });

  it('never emits NaN or out-of-range coverage on a constant image', () => {
    const image = makeImage(5, 5, () => [77, 77, 77]);
    const trimap = new Uint8Array(25).fill(TRIMap.UNKNOWN);
    for (let i = 0; i < 25; i += 1) trimap[i] = i % 5 < 2 ? TRIMap.BG : TRIMap.FG;
    const result = solveMattingLaplacian(image, trimap, { maxIterations: 100 })!;
    for (const value of result.alpha) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });
});

describe('trimapFromMask', () => {
  it('builds a spatial unknown band for a binary mask', () => {
    const width = 7;
    const height = 3;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 2; x <= 4; x += 1) mask[y * width + x] = 255;
    }
    const trimap = trimapFromMask(mask, width, height, 1);
    // Boundary-adjacent pixels on both sides are unknown; the core stays fg.
    expect(trimap[1 * width + 3]).toBe(TRIMap.FG);
    expect(trimap[1 * width + 2]).toBe(TRIMap.UNKNOWN);
    expect(trimap[1 * width + 4]).toBe(TRIMap.UNKNOWN);
    expect(trimap[1 * width + 1]).toBe(TRIMap.UNKNOWN);
    expect(trimap[1 * width + 5]).toBe(TRIMap.UNKNOWN);
    expect(trimap[0]).toBe(TRIMap.BG);
  });

  it('marks intermediate coverage unknown regardless of distance', () => {
    const mask = new Uint8Array(25);
    mask[12] = 128;
    const trimap = trimapFromMask(mask, 5, 5, 0);
    expect(trimap[12]).toBe(TRIMap.UNKNOWN);
    expect(trimap[0]).toBe(TRIMap.BG);
    expect(trimap[24]).toBe(TRIMap.BG);
  });

  it('handles empty and full masks without inventing a boundary', () => {
    expect(trimapFromMask(new Uint8Array(9), 3, 3, 2).every((v) => v === TRIMap.BG)).toBe(true);
    expect(trimapFromMask(new Uint8Array(9).fill(255), 3, 3, 2).every((v) => v === TRIMap.FG)).toBe(
      true,
    );
  });
});
