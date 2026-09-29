/**
 * Versioned curves: legacy Catmull-Rom and shape-preserving PCHIP.
 *
 * Research basis: Photoshop Curves adjustment uses a cubic spline through
 * user-placed anchor points. Catmull-Rom provides C1 continuity with local
 * control (moving one point affects only neighbouring segments).
 *
 * Architecture: given N anchor points {(x_i, y_i)}, generate a 256-entry
 * lookup table by evaluating the Catmull-Rom spline at each integer input
 * value. Clamp outputs to [0, 1]. Flat-line identity when no points set.
 */

export interface CurvePoint {
  id?: string;
  x: number;
  y: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ensureEndpoints(points: CurvePoint[], minSpacing = 0): CurvePoint[] {
  if (points.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }
  const sorted = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: clamp01(point.x),
      y: clamp01(point.y),
    }))
    .sort((a, b) => a.x - b.x);
  if (sorted.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }

  // Two points at the same input coordinate do not define a segment. Keep the
  // last authored value deterministically instead of allowing a zero-length
  // segment to depend on sort stability or emit NaN for malformed input.
  const unique: CurvePoint[] = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && point.x - previous.x <= minSpacing) previous.y = point.y;
    else unique.push(point);
  }
  const normalized = unique;
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first && first.x > 0) normalized.unshift({ x: 0, y: 0 });
  if (last && last.x < 1) normalized.push({ x: 1, y: 1 });
  return normalized;
}

export type CurveAlgorithm = 'legacy' | 'pchip';

function endpointSlope(h0: number, h1: number, d0: number, d1: number): number {
  const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(slope) !== Math.sign(d0)) return 0;
  return Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > 3 * Math.abs(d0) ? 3 * d0 : slope;
}

function pchipSlopes(points: CurvePoint[]): number[] {
  const h = points.slice(1).map((p, i) => p.x - points[i]!.x);
  const d = points.slice(1).map((p, i) => (p.y - points[i]!.y) / h[i]!);
  if (points.length === 2) return [d[0]!, d[0]!];
  const slopes = [endpointSlope(h[0]!, h[1]!, d[0]!, d[1]!)];
  for (let i = 1; i < points.length - 1; i++) {
    const before = d[i - 1]!,
      after = d[i]!;
    const w1 = 2 * h[i]! + h[i - 1]!,
      w2 = h[i]! + 2 * h[i - 1]!;
    slopes.push(before * after <= 0 ? 0 : (w1 + w2) / (w1 / before + w2 / after));
  }
  const last = h.length - 1;
  slopes.push(endpointSlope(h[last]!, h[last - 1]!, d[last]!, d[last - 1]!));
  return slopes;
}

const compiledCache = new Map<string, (input: number) => number>();

/** One transfer for graph, byte LUT and arbitrary floating input. */
export function compileCurve(
  points: CurvePoint[],
  algorithm: CurveAlgorithm = 'legacy',
): (input: number) => number {
  const pts = ensureEndpoints(points.slice(0, 256), algorithm === 'pchip' ? 1e-9 : 0);
  const key = JSON.stringify([algorithm, pts]);
  const cached = compiledCache.get(key);
  if (cached) return cached;
  const slopes = algorithm === 'pchip' ? pchipSlopes(pts) : [];
  const identity = pts.every((point) => point.x === point.y);
  const evaluate = (input: number): number => {
    const x = Number.isFinite(input) ? clamp01(input) : 0;
    if (algorithm === 'pchip' && identity) return x;
    if (pts.length === 2) return clamp01(pts[0]!.y + (pts[1]!.y - pts[0]!.y) * x);
    let segment = 0;
    while (segment < pts.length - 2 && x > pts[segment + 1]!.x) segment++;
    const p1 = pts[segment]!,
      p2 = pts[segment + 1]!;
    const h = p2.x - p1.x;
    const t = h > 0 ? (x - p1.x) / h : 0;
    if (algorithm === 'legacy') {
      return clamp01(
        catmullRom(
          pts[Math.max(0, segment - 1)]!.y,
          p1.y,
          p2.y,
          pts[Math.min(pts.length - 1, segment + 2)]!.y,
          t,
        ),
      );
    }
    const t2 = t * t,
      t3 = t2 * t;
    return clamp01(
      (2 * t3 - 3 * t2 + 1) * p1.y +
        (t3 - 2 * t2 + t) * h * slopes[segment]! +
        (-2 * t3 + 3 * t2) * p2.y +
        (t3 - t2) * h * slopes[segment + 1]!,
    );
  };
  if (compiledCache.size >= 32) compiledCache.delete(compiledCache.keys().next().value!);
  compiledCache.set(key, evaluate);
  return evaluate;
}

export function buildCurveLUT(
  points: CurvePoint[],
  algorithm: CurveAlgorithm = 'legacy',
): Uint8Array {
  const evaluate = compileCurve(points, algorithm);
  return Uint8Array.from({ length: 256 }, (_, i) => Math.round(evaluate(i / 255) * 255));
}

export function applyCurve(
  imageData: ImageData,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  lut: Uint8Array,
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(w, h);
  const src = imageData.data;
  const dst = result.data;

  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    const alpha = src[off + 3]!;
    if (alpha === 0) {
      dst[off] = src[off]!;
      dst[off + 1] = src[off + 1]!;
      dst[off + 2] = src[off + 2]!;
      dst[off + 3] = alpha;
      continue;
    }
    if (channel === 'rgb' || channel === 'red') {
      dst[off] = lut[src[off]!]!;
    } else {
      dst[off] = src[off]!;
    }
    if (channel === 'rgb' || channel === 'green') {
      dst[off + 1] = lut[src[off + 1]!]!;
    } else {
      dst[off + 1] = src[off + 1]!;
    }
    if (channel === 'rgb' || channel === 'blue') {
      dst[off + 2] = lut[src[off + 2]!]!;
    } else {
      dst[off + 2] = src[off + 2]!;
    }
    dst[off + 3] = alpha;
  }

  return result;
}
