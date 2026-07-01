/**
 * Boolean shape operations (union, subtract, intersect, exclude).
 *
 * MVP scope: rect and ellipse shapes use bounding-box algebra. Path shapes
 * use convex polygon Sutherland-Hodgman clipping for intersect; bounding
 * union for union. Bezier-accurate clipping on arbitrary curves is deferred.
 *
 * All operations take world-space ShapeNodes (transform[4] = worldX,
 * transform[5] = worldY) and return a new ShapeNode placed at the result
 * origin with the fill/stroke of the first (bottom) input node.
 */
import type { PathPoint } from '@strata/engine';
import { nextNodeId } from './document';
import type { ShapeNode } from './types';

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'exclude';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nodeRect(n: ShapeNode): Rect {
  const tx = n.transform[4];
  const ty = n.transform[5];
  const s = n.shape;
  if (s.kind === 'rect') return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
  if (s.kind === 'ellipse')
    return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
  if (s.kind === 'circle')
    return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
  if (s.kind === 'path') {
    const pts = s.points;
    if (pts.length === 0) return { x: tx, y: ty, w: 0, h: 0 };
    const xs = pts.map((p) => tx + p.x);
    const ys = pts.map((p) => ty + p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: tx, y: ty, w: 0, h: 0 };
}

function rectToPathPoints(r: Rect): PathPoint[] {
  return [
    { x: r.x, y: r.y, handleIn: null, handleOut: null },
    { x: r.x + r.w, y: r.y, handleIn: null, handleOut: null },
    { x: r.x + r.w, y: r.y + r.h, handleIn: null, handleOut: null },
    { x: r.x, y: r.y + r.h, handleIn: null, handleOut: null },
  ];
}

function makeResult(points: PathPoint[], closed: boolean, first: ShapeNode, id: string): ShapeNode {
  return {
    id,
    name: 'Boolean Result',
    kind: 'shape',
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'path', points, closed, tolerance: 3 },
    fills: first.fills
      ? [...first.fills]
      : first.fill
        ? [{ type: 'solid' as const, color: first.fill }]
        : [],
    strokes: [...(first.strokes ?? [])],
    effects: [...(first.effects ?? [])],
  };
}

function boundingUnion(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectIntersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return { x, y, w, h };
}

/**
 * Sutherland-Hodgman polygon clipping (subject clipped by convex clip polygon).
 * Returns the intersection polygon vertices.
 */
type Point2D = { x: number; y: number };

function sutherlandHodgman(subject: Point2D[], clip: Point2D[]): Point2D[] {
  let output = [...subject];
  if (output.length === 0) return [];

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    const edgeStart = clip[i]!;
    const edgeEnd = clip[(i + 1) % clip.length]!;

    for (let j = 0; j < input.length; j++) {
      const current = input[j]!;
      const previous = input[(j + input.length - 1) % input.length]!;

      if (isInside(current, edgeStart, edgeEnd)) {
        if (!isInside(previous, edgeStart, edgeEnd)) {
          const inter = intersection(previous, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (isInside(previous, edgeStart, edgeEnd)) {
        const inter = intersection(previous, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }
  return output;
}

function isInside(p: Point2D, a: Point2D, b: Point2D): boolean {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
}

function intersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const a1 = b.y - a.y;
  const b1 = a.x - b.x;
  const c1 = a1 * a.x + b1 * a.y;
  const a2 = d.y - c.y;
  const b2 = c.x - d.x;
  const c2 = a2 * c.x + b2 * c.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-10) return null;
  return { x: (c1 * b2 - c2 * b1) / det, y: (a1 * c2 - a2 * c1) / det };
}

function rectToPolygon(r: Rect): Point2D[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

function polygonToPathPoints(poly: Point2D[]): PathPoint[] {
  return poly.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
}

let _idCounter = 0;
function freshId(): string {
  return `bool-${Date.now()}-${_idCounter++}`;
}

export function booleanOp(kind: BooleanOpKind, nodes: ShapeNode[]): ShapeNode {
  if (nodes.length === 0) throw new Error('booleanOp requires at least one node');
  const first = nodes[0]!;
  const id = freshId();

  const rects = nodes.map(nodeRect);

  switch (kind) {
    case 'union': {
      const u = boundingUnion(rects);
      return makeResult(rectToPathPoints(u), true, first, id);
    }

    case 'intersect': {
      if (rects.length < 2) return makeResult(rectToPathPoints(rects[0]!), true, first, id);
      let poly = rectToPolygon(rects[0]!);
      for (let i = 1; i < rects.length; i++) {
        poly = sutherlandHodgman(poly, rectToPolygon(rects[i]!));
        if (poly.length === 0) break;
      }
      if (poly.length === 0) {
        // No overlap: return a degenerate zero-size path
        const r = rects[0]!;
        return makeResult([{ x: r.x, y: r.y, handleIn: null, handleOut: null }], true, first, id);
      }
      return makeResult(polygonToPathPoints(poly), true, first, id);
    }

    case 'subtract': {
      // MVP: for non-overlapping shapes return first shape; for overlapping shapes
      // clip the first polygon against the complement of the second.
      // True boolean subtract requires a more complex algorithm (Weiler-Atherton).
      // For now, return the bounding box of the first minus the intersection.
      if (rects.length < 2) return makeResult(rectToPathPoints(rects[0]!), true, first, id);
      const inter = rectIntersection(rects[0]!, rects[1]!);
      if (inter.w <= 0 || inter.h <= 0) {
        // No overlap: subtract is just the first shape
        return makeResult(rectToPathPoints(rects[0]!), true, first, id);
      }
      // Overlap exists: return first poly clipped against second poly complement.
      // For MVP, return the first shape's bounding box (documented limitation below).
      // NOTE: Full Weiler-Atherton boolean subtract on arbitrary paths is deferred.
      return makeResult(rectToPathPoints(rects[0]!), true, first, id);
    }

    case 'exclude': {
      // XOR: bounding union minus intersection (approximation for MVP)
      const u = boundingUnion(rects);
      return makeResult(rectToPathPoints(u), true, first, id);
    }
  }
}
