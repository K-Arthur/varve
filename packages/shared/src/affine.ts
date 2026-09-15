/**
 * 2D affine math — the single source of truth for transforms across the
 * engine, scene, and editor.
 *
 * Convention (identical to HTML canvas `ctx.transform(a,b,c,d,e,f)` and
 * kurbo `Affine::as_coeffs()`): the tuple `[a, b, c, d, e, f]` represents
 * the 3×3 matrix
 *
 *   ┌             ┐
 *   │ a  c  e     │
 *   │ b  d  f     │
 *   │ 0  0  1     │
 *   └             ┘
 *
 * so applying to a point `(x, y)` yields
 *
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 *
 * Composition order: `multiplyAffine(parent, child)` produces the matrix
 * that applies `child` first and then `parent` — the standard scene-graph
 * convention `worldTransform = parentWorld ∘ local`. With matrix algebra
 * this is `parent · child`.
 *
 * Research basis: kurbo `Affine` (linebender), HTML Canvas Transform,
 * CSS Transforms Module Level 1. All three agree on this coefficient
 * ordering, so the same tuple flows TS → Tauri IPC → Rust (kurbo) unchanged.
 */

/** 2D point as a 2-tuple (read-only). */
export type Point = readonly [number, number];

/** 2×3 affine as `[a, b, c, d, e, f]` (see module docs). */
export type Affine = readonly [number, number, number, number, number, number];

/** Identity affine (no translation, no rotation, no scale). */
export const identity: Affine = [1, 0, 0, 1, 0, 0];

/** Translation by `(tx, ty)`. */
export function translate(tx: number, ty: number): Affine {
  return [1, 0, 0, 1, tx, ty];
}

/** Uniform scale by `s` (same factor on both axes). */
export function scale(s: number): Affine {
  return [s, 0, 0, s, 0, 0];
}

/** Non-uniform scale by `(sx, sy)`. */
export function scaleXY(sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

/**
 * Counter-clockwise rotation by `radians` about the origin, in math-convention
 * axes (Y-up). In screen space (Y-down) the rotation appears clockwise.
 *
 * `rotateRad(θ) · (x, y) = (x·cos θ − y·sin θ, x·sin θ + y·cos θ)`
 */
export function rotateRad(radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

/** Rotation by `degrees` (converted to radians). See {@link rotateRad}. */
export function rotateDeg(degrees: number): Affine {
  return rotateRad((degrees * Math.PI) / 180);
}

/** Rotation + uniform scale + translation in one affine. */
export function transform(
  translateX: number,
  translateY: number,
  rotateRadians: number,
  scaleFactor: number,
): Affine {
  return multiplyAffine(
    translate(translateX, translateY),
    multiplyAffine(rotateRad(rotateRadians), scale(scaleFactor)),
  );
}

/**
 * Apply `m` to point `p`. Equivalent to `m · (p, 1)` in homogeneous coords.
 */
export function applyAffine(m: Affine, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/**
 * Multiply two affines: returns `a · b` (apply `b` first, then `a`).
 *
 * Scene-graph use: `worldTransform = multiplyAffine(parentWorld, local)`.
 */
export function multiplyAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Inverse of `m`. Returns the identity on singular matrices (det = 0).
 *
 * Use {@link tryInvertAffine} when callers must distinguish singular from
 * genuine identity inputs.
 */
export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return identity;
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
}

/**
 * Inverse of `m`, or `null` if `m` is singular (non-invertible).
 *
 * Prefer this over {@link invertAffine} in callers that need to detect
 * degenerate transforms (e.g. hit-testing a zero-area node).
 */
export function tryInvertAffine(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return null;
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
}

/** Axis-aligned bounding box in world or local space. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle containment (closed: boundary counts as inside). */
export function rectContains(r: Rect, p: Point): boolean {
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
}

/** Squared distance from `p` to segment `a→b`. Avoids sqrt for comparisons. */
export function pointToSegmentDistSq(a: Point, b: Point, p: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    const dx = p[0] - a[0];
    const dy = p[1] - a[1];
    return dx * dx + dy * dy;
  }
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + vx * t;
  const py = a[1] + vy * t;
  const dx = p[0] - px;
  const dy = p[1] - py;
  return dx * dx + dy * dy;
}

/** True if `p` lies inside the ellipse centred `(cx, cy)` with radii `rx, ry`. */
export function pointInEllipse(cx: number, cy: number, rx: number, ry: number, p: Point): boolean {
  if (rx === 0 || ry === 0) return false;
  const dx = (p[0] - cx) / rx;
  const dy = (p[1] - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * Compute the axis-aligned bounding box of `m` applied to the four corners of
 * `localRect`. Used to derive world-space bounds for a local-space rect under
 * any affine (rotation, scale, skew).
 */
export function transformRect(m: Affine, localRect: Rect): Rect {
  const p0 = applyAffine(m, [localRect.x, localRect.y]);
  const p1 = applyAffine(m, [localRect.x + localRect.w, localRect.y]);
  const p2 = applyAffine(m, [localRect.x, localRect.y + localRect.h]);
  const p3 = applyAffine(m, [localRect.x + localRect.w, localRect.y + localRect.h]);
  const minX = Math.min(p0[0], p1[0], p2[0], p3[0]);
  const maxX = Math.max(p0[0], p1[0], p2[0], p3[0]);
  const minY = Math.min(p0[1], p1[1], p2[1], p3[1]);
  const maxY = Math.max(p0[1], p1[1], p2[1], p3[1]);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Result of decomposing an affine matrix into its constituent transforms.
 * The decomposition is canonical: T * R * S * Sk where:
 *   T = translation
 *   R = rotation (radians, Y-down)
 *   S = scale (non-uniform)
 *   Sk = skew (shearX, shearY)
 *
 * For matrices without skew, skewX and skewY are 0.
 * The decomposition is stable for non-degenerate matrices.
 */
export interface DecomposedAffine {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

/**
 * Decompose an affine matrix into translation, rotation, scale, and skew.
 *
 * Uses the canonical CSS/SVG decomposition:
 *   M = translate(e,f) * rotate(θ) * skewX(α) * scale(sx, sy)
 *
 * Where:
 *   translate: (e, f)
 *   scaleX:  hypot(a, b), the length of the first column
 *   skewX:   (a*c + b*d) / (scaleX²), 0 for pure rotate+scale
 *   scaleY:  det / scaleX (preserves orientation)
 *   rotation: atan2(b, a)
 *
 * Returns null for degenerate matrices (det = 0).
 * For matrices without skew, skewX is 0 and the result matches the
 * simpler decomposeAffine transform but with non-uniform scale retained.
 */
export function decomposeAffineFull(m: Affine): DecomposedAffine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return null;

  const scaleX = Math.hypot(a, b);
  if (scaleX < 1e-10) return null;

  // Compute skewX: how much the y-axis tilts from perpendicular to the x-axis
  const skewX = (a * c + b * d) / (scaleX * scaleX);

  // Compute scaleY as determinant / scaleX (handles reflection)
  const scaleY = det / scaleX;
  if (Math.abs(scaleY) < 1e-10) return null;

  // Rotation angle from the x-axis
  const rotation = Math.atan2(b, a);

  return {
    translateX: e,
    translateY: f,
    rotation,
    scaleX,
    scaleY,
    skewX,
    skewY: 0, // Standard CSS decomposition doesn't expose skewY separately
  };
}

/**
 * Decompose an affine into translation, rotation (radians), and uniform scale.
 * Returns `null` if the matrix is degenerate or has skew or non-uniform scale.
 *
 * Useful for backward-compatible Inspector display. Prefer `decomposeAffineFull`
 * for new code that needs to handle skew.
 */
export function decomposeAffine(
  m: Affine,
): { translateX: number; translateY: number; rotation: number; scale: number } | null {
  const full = decomposeAffineFull(m);
  if (!full) return null;
  // Reject matrices with skew or non-uniform scale
  if (Math.abs(full.skewX) > 1e-9 || Math.abs(full.skewY) > 1e-9) return null;
  if (Math.abs(Math.abs(full.scaleX) - Math.abs(full.scaleY)) > 1e-9) return null;
  return {
    translateX: full.translateX,
    translateY: full.translateY,
    rotation: full.rotation,
    scale: Math.abs(full.scaleX),
  };
}
