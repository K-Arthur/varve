/**
 * Lasso geometry utilities — polygon intersection for freehand selection.
 *
 * Provides point-in-polygon, segment intersection, and polygon-rect
 * intersection tests used by the LassoTool to select nodes whose
 * transformed geometry intersects the lasso path.
 *
 * Research basis: Ray casting for point-in-polygon (even-odd rule),
 * segment intersection via orientation tests.
 */

import { rectContains } from '@strata/shared';

export type Point2D = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Test if a point is inside a polygon using the even-odd rule.
 * Returns true for points on the boundary (edge-inclusive).
 */
export function pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const len = polygon.length;
  for (let i = 0; i < len; i++) {
    const vi = polygon[i];
    const vj = polygon[(i + len - 1) % len];
    if (!vi || !vj) continue;
    const xi = vi.x,
      yi = vi.y;
    const xj = vj.x,
      yj = vj.y;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if two line segments intersect.
 * Segment 1: (p1, p2), Segment 2: (p3, p4)
 */
export function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const ccw = (a: Point2D, b: Point2D, c: Point2D) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

/**
 * Check if a polygon intersects a rectangle.
 * Returns true if any polygon point is inside the rect, any rect corner
 * is inside the polygon, or any polygon edge intersects any rect edge.
 */
export function polygonIntersectsBounds(polygon: Point2D[], bounds: Rect): boolean {
  // Check if any polygon point is inside the rect
  for (const pt of polygon) {
    if (rectContains(bounds, [pt.x, pt.y])) {
      return true;
    }
  }

  // Check if any rect corner is inside the polygon
  const corners: Point2D[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];
  for (const corner of corners) {
    if (pointInPolygon(corner, polygon)) {
      return true;
    }
  }

  // Check if any polygon edge intersects any rect edge
  const rectEdges: [Point2D, Point2D][] = [
    [corners[0]!, corners[1]!], // top
    [corners[1]!, corners[2]!], // right
    [corners[2]!, corners[3]!], // bottom
    [corners[3]!, corners[0]!], // left
  ];

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    if (!p1 || !p2) continue;

    for (const [r1, r2] of rectEdges) {
      if (segmentsIntersect(p1, p2, r1, r2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Simplify a polygon using distance-based filtering.
 * Removes points that are too close to the previous point.
 */
export function simplifyPolygon(polygon: Point2D[], minDistance: number): Point2D[] {
  if (polygon.length === 0) return [];
  if (!polygon[0]) return [];

  const simplified: Point2D[] = [polygon[0]];
  for (let i = 1; i < polygon.length; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = polygon[i];
    if (!prev || !curr) continue;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    if (Math.hypot(dx, dy) >= minDistance) {
      simplified.push(curr);
    }
  }
  return simplified;
}
