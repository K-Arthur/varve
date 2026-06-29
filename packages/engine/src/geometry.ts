/**
 * TS geometry helpers — mirror of strata-core's math so the stub backend can
 * hit-test and so the webview can do local picking without a round-trip.
 *
 * Research basis: same inverse-transform hit pattern as strata-core (Rust);
 * affine inverse formula for a 2x3 matrix.
 */
import type { Affine, PathPoint, Point, SceneNode, Shape } from './types';

export function applyAffine(m: Affine, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return [1, 0, 0, 1, 0, 0];
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
}

export const identity: Affine = [1, 0, 0, 1, 0, 0];

export function translate(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

export function scale(s: number): Affine {
  return [s, 0, 0, s, 0, 0];
}

export function rectContains(x: number, y: number, w: number, h: number, p: Point): boolean {
  return p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;
}

export function pointInEllipse(cx: number, cy: number, rx: number, ry: number, p: Point): boolean {
  const dx = (p[0] - cx) / rx;
  const dy = (p[1] - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

export function pointToSegmentDistSq(from: Point, to: Point, p: Point): number {
  const vx = to[0] - from[0];
  const vy = to[1] - from[1];
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    const dx = p[0] - from[0];
    const dy = p[1] - from[1];
    return dx * dx + dy * dy;
  }
  let t = ((p[0] - from[0]) * vx + (p[1] - from[1]) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = from[0] + vx * t;
  const py = from[1] + vy * t;
  const dx = p[0] - px;
  const dy = p[1] - py;
  return dx * dx + dy * dy;
}

function polygonVertices(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
    verts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return verts;
}

function starVertices(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  points: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return verts;
}

function pointInPolygon(vertices: Point[], p: Point): boolean {
  let inside = false;
  const len = vertices.length;
  for (let i = 0; i < len; i++) {
    const vi = vertices[i];
    const vj = vertices[(i + len - 1) % len];
    if (!vi || !vj) continue;
    const xi = vi[0],
      yi = vi[1];
    const xj = vj[0],
      yj = vj[1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pathVertices(points: PathPoint[]): Point[] {
  return points.map((pt) => [pt.x, pt.y] as Point);
}

function pathSegmentDistSq(points: PathPoint[], p: Point): number {
  if (points.length < 2) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const from: Point = [points[i]!.x, points[i]!.y];
    const to: Point = [points[i + 1]!.x, points[i + 1]!.y];
    const dist = pointToSegmentDistSq(from, to, p);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export function shapeContains(shape: Shape, p: Point): boolean {
  switch (shape.kind) {
    case 'rect':
      return rectContains(shape.x, shape.y, shape.w, shape.h, p);
    case 'ellipse':
      return pointInEllipse(shape.cx, shape.cy, shape.rx, shape.ry, p);
    case 'circle': {
      const dx = p[0] - shape.cx;
      const dy = p[1] - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case 'line':
      return pointToSegmentDistSq(shape.from, shape.to, p) <= shape.tolerance * shape.tolerance;
    case 'polygon':
      return pointInPolygon(
        polygonVertices(shape.cx, shape.cy, shape.radius, shape.sides, shape.rotation),
        p,
      );
    case 'star':
      return pointInPolygon(
        starVertices(
          shape.cx,
          shape.cy,
          shape.innerRadius,
          shape.outerRadius,
          shape.points,
          shape.rotation,
        ),
        p,
      );
    case 'arrow':
      return pointToSegmentDistSq(shape.from, shape.to, p) <= shape.tolerance * shape.tolerance;
    case 'path':
      if (shape.closed) {
        return pointInPolygon(pathVertices(shape.points), p);
      }
      return pathSegmentDistSq(shape.points, p) <= shape.tolerance * shape.tolerance;
  }
}

/** Topmost node (highest index) whose shape contains `world`; null if none. */
export function hitTest(nodes: SceneNode[], world: Point): number | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n || !n.shape) continue;
    const local = applyAffine(invertAffine(n.transform), world);
    if (shapeContains(n.shape, local)) return i;
  }
  return null;
}
