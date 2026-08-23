/**
 * Homography — planar projective transform between two quadrilaterals.
 *
 * A homography (3x3, up to scale) maps points between two planes and is the
 * exact model for four-corner perspective placement: an axis-aligned source
 * rect mapped onto an arbitrary destination quad.
 *
 * Implementation notes:
 * - Solved with the normalized Direct Linear Transform (DLT) over the four
 *   corner correspondences. Four points give 8 equations; the null vector
 *   of the 8x9 design matrix is the solution (smallest singular value).
 *   Normalization (Hartley) improves numerical conditioning for points far
 *   from the origin and for extreme quads.
 * - The matrix is stored as a flat 9-array in row-major order
 *   [h11 h12 h13 h21 h22 h23 h31 h32 h33], matching the convention of
 *   mapping x' = (h11 x + h12 y + h13) / (h31 x + h32 y + h33).
 * - All geometry is validated before use: NaN/Infinity, zero area,
 *   reversed winding, self-crossing edges, and near-degenerate quads are
 *   rejected rather than producing corrupted output.
 *
 * Research basis: Hartley & Zisserman "Multiple View Geometry" (2nd ed.)
 * §4.1 DLT, §2.4 normalization; OpenCV getPerspectiveTransform/findHomography.
 */

/** A 2D point. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A 3x3 homography matrix, row-major flat array [h11,h12,h13,h21,h22,h23,h31,h32,h33]. */
export type Homography = [number, number, number, number, number, number, number, number, number];

/** Four points in counter-clockwise order. */
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

/** Minimum distance between distinct corners of a valid quad, in px. */
const MIN_CORNER_DISTANCE = 1e-4;
/** Prevent hostile/corrupt documents from overflowing intermediate math. */
const MAX_COORDINATE_MAGNITUDE = 1e9;

/**
 * Validate a quad for use as a homography source or destination.
 *
 * Rejects: non-finite values, coincident corners, (near-)zero polygon area,
 * self-crossing edge pairs, and concave quads. Concave and crossing quads do
 * not have a well-defined projective mapping of a rectangle's interior, so
 * they are rejected rather than silently producing folded output.
 */
export function isQuadValid(quad: Quad): boolean {
  if (quad.length !== 4) return false;
  for (const p of quad) {
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      Math.abs(p.x) > MAX_COORDINATE_MAGNITUDE ||
      Math.abs(p.y) > MAX_COORDINATE_MAGNITUDE
    ) {
      return false;
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < MIN_CORNER_DISTANCE) return false;
  }
  if (Math.abs(polygonArea(quad)) < MIN_CORNER_DISTANCE * MIN_CORNER_DISTANCE) return false;
  return !isQuadSelfCrossing(quad) && !isQuadConcave(quad);
}

/** Signed polygon area (shoelace). */
function polygonArea(quad: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** True when any non-adjacent edge pair of the quad intersects. */
export function isQuadSelfCrossing(quad: Quad): boolean {
  const p0 = quad[0];
  const p1 = quad[1];
  const p2 = quad[2];
  const p3 = quad[3];
  return segmentsIntersect(p0, p1, p2, p3) || segmentsIntersect(p1, p2, p3, p0);
}

/** True when the quad is concave (interior angle > 180 at some corner). */
export function isQuadConcave(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return true;
  }
  return false;
}

/** Orientation cross product of segments ab x bc. */
function crossSign(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** True when segments (a,b) and (c,d) properly intersect (excluding shared endpoints). */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = crossSign(c, d, a);
  const d2 = crossSign(c, d, b);
  const d3 = crossSign(a, b, c);
  const d4 = crossSign(a, b, d);
  if (d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0) return false;
  return d1 !== d2 && d3 !== d4;
}

/**
 * Reorder quad corners to counter-clockwise winding starting from the
 * top-left-ish corner (minimum x + y). Reversed and shuffled windings are
 * normalized so consumers see a stable, non-crossing ordering.
 */
export function normalizeQuadCorners(quad: Quad): Quad {
  const pts = [...quad];
  const centroid = {
    x: (pts[0]!.x + pts[1]!.x + pts[2]!.x + pts[3]!.x) / 4,
    y: (pts[0]!.y + pts[1]!.y + pts[2]!.y + pts[3]!.y) / 4,
  };
  pts.sort(
    (p, q) =>
      Math.atan2(p.y - centroid.y, p.x - centroid.x) -
      Math.atan2(q.y - centroid.y, q.x - centroid.x),
  );
  const ccw = crossSign(pts[0]!, pts[1]!, pts[2]!) >= 0 ? pts : [...pts].reverse();
  const start = ccw.reduce((best, p, i) => {
    const score = p.x + p.y;
    return score < ccw[best]!.x + ccw[best]!.y ? i : best;
  }, 0);
  return [ccw[start]!, ccw[(start + 1) % 4]!, ccw[(start + 2) % 4]!, ccw[(start + 3) % 4]!] as Quad;
}

/**
 * Normalize a quad's coordinates (Hartley) for numerical stability: scale
 * points to mean ~sqrt(2) distance from centroid and translate to origin.
 */
function normalizePoints(pts: readonly Vec2[]): { n: Vec2[]; s: number; c: Vec2 } {
  const n = pts.map((p) => ({ x: p.x, y: p.y }));
  const cx = n.reduce((s, p) => s + p.x, 0) / n.length;
  const cy = n.reduce((s, p) => s + p.y, 0) / n.length;
  for (const p of n) {
    p.x -= cx;
    p.y -= cy;
  }
  const dist = n.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / n.length;
  const scale = dist > 1e-12 ? Math.SQRT2 / dist : 1;
  for (const p of n) {
    p.x *= scale;
    p.y *= scale;
  }
  return { n, s: scale, c: { x: cx, y: cy } };
}

/** Solve the 3x3 homography mapping the source quad to the destination quad. */
export function solveHomography(src: Quad, dst: Quad): Homography | null {
  if (!isQuadValid(src) || !isQuadValid(dst)) return null;

  const sn = normalizePoints(src);
  const dn = normalizePoints(dst);

  // DLT rows: for correspondence p -> q with q = (u, v, 1):
  // [ -x -y -1 0 0 0 ux uy u ]
  // [ 0 0 0 -x -y -1 vx vy v ]
  const a: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = sn.n[i]!;
    const q = dn.n[i]!;
    const u = q.x;
    const v = q.y;
    const w = 1;
    a.push(-p.x, -p.y, -1, 0, 0, 0, u * p.x, u * p.y, u * w);
    a.push(0, 0, 0, -p.x, -p.y, -1, v * p.x, v * p.y, v * w);
  }

  const h = solveHomogeneous8x9(a);
  if (!h) return null;

  // Denormalize: H = T_dst^-1 * H_n * T_src, where
  // T_src(p) = s_src * (p - c_src) and T_dst^-1(q) = q / s_dst + c_dst.
  const sSrc = sn.s;
  const sDst = dn.s;
  const cSrc = sn.c;
  const cDst = dn.c;
  const tSrc: Homography = [sSrc, 0, -sSrc * cSrc.x, 0, sSrc, -sSrc * cSrc.y, 0, 0, 1];
  const tDstInv: Homography = [1 / sDst, 0, cDst.x, 0, 1 / sDst, cDst.y, 0, 0, 1];
  const H = multiplyHomography(multiplyHomography(tDstInv, h), tSrc);
  const h33 = H[8]!;
  if (!Number.isFinite(h33) || Math.abs(h33) < 1e-12) return null;
  for (let i = 0; i < 9; i++) H[i]! = H[i]! / h33;

  // Re-validate against the input corners (round-trip error must be tiny).
  const err = cornerRoundTripError(H, src, dst);
  if (err > 1e-6) return null;

  return H;
}

/** Multiply two 3x3 row-major homography matrices (a * b). */
export function multiplyHomography(a: Homography, b: Homography): Homography {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Solve the homogeneous 8x9 linear system via Gaussian elimination on A^T A. */
function solveHomogeneous8x9(rows: number[]): Homography | null {
  // A is 8x9; solve for the null vector of A via A^T A (8x8) least squares.
  const n = 8;
  const ata: number[][] = [];
  for (let i = 0; i < n; i++) {
    ata.push(new Array(n + 1).fill(0));
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let r = 0; r < 8; r++) {
        s += rows[r * 9 + i]! * rows[r * 9 + j]!;
      }
      ata[i]![j]! = s;
    }
    let s = 0;
    for (let r = 0; r < 8; r++) {
      s += rows[r * 9 + i]! * rows[r * 9 + 8]!;
    }
    ata[i]![n]! = -s;
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(ata[r]![col]!) > Math.abs(ata[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(ata[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = ata[col] as number[];
      ata[col] = ata[pivot] as number[];
      ata[pivot] = tmp;
    }
    const pv = ata[col]![col]!;
    for (let c = col; c <= n; c++) ata[col]![c]! = ata[col]![c]! / pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = ata[r]![col]!;
      for (let c = col; c <= n; c++) ata[r]![c]! = ata[r]![c]! - f * ata[col]![c]!;
    }
  }

  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = ata[i]![n]!;
  const result: Homography = [...x, 1] as Homography;
  if (!result.every((v) => Number.isFinite(v))) return null;
  const norm = Math.hypot(...result);
  if (!Number.isFinite(norm) || norm < 1e-12) return null;
  for (let i = 0; i < 9; i++) result[i]! = result[i]! / norm;
  return result;
}

/** Map a point through the homography (perspective divide). */
export function applyHomography(h: Homography, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Invert a homography analytically. */
export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i2, j] = h;
  const det = a * (e * j - f * i2) - b * (d * j - f * g) + c * (d * i2 - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [
    (e * j - f * i2) / det,
    (c * i2 - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i2 - e * g) / det,
    (b * g - a * i2) / det,
    (a * e - b * d) / det,
  ];
}

/** Maximum mapping error of the four corners under H (in dest units). */
function cornerRoundTripError(h: Homography, src: Quad, dst: Quad): number {
  let maxErr = 0;
  for (let i = 0; i < 4; i++) {
    const mapped = applyHomography(h, src[i]!);
    if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return Infinity;
    const err = Math.hypot(mapped.x - dst[i]!.x, mapped.y - dst[i]!.y);
    if (err > maxErr) maxErr = err;
  }
  return maxErr;
}

/** Bounding box of a quad. */
export function quadBounds(quad: Quad): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of quad) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
