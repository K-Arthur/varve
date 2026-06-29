/**
 * Curve fitting utilities for the Pencil tool.
 *
 * Ramer–Douglas–Peucker simplification (1972/1973) reduces point count
 * while preserving visual features. Schneider's algorithm fits cubic
 * Bézier segments to the simplified points (Graphics Gems 1990).
 *
 * Research basis:
 *   Ramer, U. "An iterative procedure for the polygonal approximation
 *     of plane curves." Computer Graphics and Image Processing, 1972.
 *   Douglas, D. and Peucker, T. "Algorithms for the reduction of the
 *     number of points required to represent a digitized line or its
 *     caricature." The Canadian Cartographer, 1973.
 *   Schneider, P. "An Algorithm for Automatically Fitting Digitized
 *     Curves." Graphics Gems, 1990.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface BezierSegment {
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
}

/**
 * Ramer–Douglas–Peucker simplification.
 * Returns a subset of points that approximate the original within `epsilon`.
 */
export function simplifyPoints(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) return [...points];

  let dmax = 0;
  let idx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i]!, points[0]!, points[points.length - 1]!);
    if (d > dmax) {
      idx = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const left = simplifyPoints(points.slice(0, idx + 1), epsilon);
    const right = simplifyPoints(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0]!, points[points.length - 1]!];
}

function perpendicularDist(pt: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((pt.x - a.x) ** 2 + (pt.y - a.y) ** 2);
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((pt.x - projX) ** 2 + (pt.y - projY) ** 2);
}
