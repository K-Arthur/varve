/**
 * Curves adjustment engine — Catmull-Rom spline interpolation for tonal curves.
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

function ensureEndpoints(points: CurvePoint[]): CurvePoint[] {
  if (points.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first && first.x > 0) sorted.unshift({ x: 0, y: 0 });
  if (last && last.x < 1) sorted.push({ x: 1, y: 1 });
  return sorted;
}

export function buildCurveLUT(points: CurvePoint[]): Uint8Array {
  const pts = ensureEndpoints(points);
  const lut = new Uint8Array(256);

  if (pts.length === 2) {
    const p0 = pts[0]!;
    const p1 = pts[1]!;
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const y = p0.y + (p1.y - p0.y) * t;
      lut[i] = Math.round(clamp01(y) * 255);
    }
    return lut;
  }

  for (let i = 0; i < 256; i++) {
    const x = i / 255;

    let segmentIndex = 0;
    for (let j = 0; j < pts.length - 1; j++) {
      const pj = pts[j];
      const pj1 = pts[j + 1];
      if (pj && pj1 && x >= pj.x && x <= pj1.x) {
        segmentIndex = j;
        break;
      }
    }

    const p0 = pts[Math.max(0, segmentIndex - 1)]!;
    const p1 = pts[segmentIndex]!;
    const p2 = pts[Math.min(pts.length - 1, segmentIndex + 1)]!;
    const p3 = pts[Math.min(pts.length - 1, segmentIndex + 2)]!;

    const segLen = p2.x - p1.x;
    const t = segLen > 0 ? (x - p1.x) / segLen : 0;
    const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);

    lut[i] = Math.round(clamp01(y) * 255);
  }

  return lut;
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
