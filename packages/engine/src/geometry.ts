/**
 * TS geometry helpers — mirror of strata-core's math so the stub backend can
 * hit-test and so the webview can do local picking without a round-trip.
 *
 * Re-exports affine primitives from @strata/shared (the single source of
 * truth for affine math). Shape-specific helpers (polygon/star/path geometry,
 * shapeContains, hitTest) remain here because they depend on engine types.
 *
 * Research basis: same inverse-transform hit pattern as strata-core (Rust);
 * affine inverse formula for a 2x3 matrix.
 */

import {
  applyAffine,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  translate,
  transformRect,
  tryInvertAffine,
} from '@strata/shared';

// Re-export for back-compat so @strata/engine consumers still see these.
export {
  applyAffine,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  translate,
  transformRect,
  tryInvertAffine,
};

import type { PathPoint, SceneNode, Shape } from './types';
import type { Affine, Point } from '@strata/shared';

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
    const fromPt = points[i];
    const toPt = points[i + 1];
    if (!fromPt || !toPt) continue;
    const from: Point = [fromPt.x, fromPt.y];
    const to: Point = [toPt.x, toPt.y];
    const dist = pointToSegmentDistSq(from, to, p);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export function shapeContains(shape: Shape, p: Point): boolean {
  switch (shape.kind) {
    case 'rect':
      return rectContains({ x: shape.x, y: shape.y, w: shape.w, h: shape.h }, p);
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
    const local = applyAffine(invertAffine(n.transform as Affine), world);
    if (shapeContains(n.shape, local)) return i;
  }
  return null;
}
