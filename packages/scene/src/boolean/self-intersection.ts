// Self-intersection detection and resolution.
// Used before polygon clipping to ensure simple polygon inputs.

import { pointsEqual, segmentIntersectionRobust } from './precision';
import type { Point2D } from './region';

export function hasSelfIntersections(poly: Point2D[], tol: number): boolean {
  const n = poly.length;
  if (n < 3) return false;
  const m = pointsEqual(poly[0]!, poly[n - 1]!, tol) ? n - 1 : n;
  if (m < 3) return false;

  for (let i = 0; i < m; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % m]!;
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % m]!;
      const ix = segmentIntersectionRobust(a1, a2, b1, b2, tol);
      if (ix && ix.type === 'cross') return true;
    }
  }
  return false;
}

export function resolveSelfIntersections(poly: Point2D[], tol: number): Point2D[][] {
  const n = poly.length;
  if (n < 3) return [poly];
  const m = pointsEqual(poly[0]!, poly[n - 1]!, tol) ? n - 1 : n;
  if (m < 3) return [poly];

  for (let i = 0; i < m; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % m]!;
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % m]!;
      const ix = segmentIntersectionRobust(a1, a2, b1, b2, tol);
      if (ix && ix.type === 'cross') {
        const X = ix.point;
        const polyA: Point2D[] = [X];
        for (let k = i + 1; k <= j; k++) polyA.push(poly[k % m]!);
        polyA.push(X);
        const polyB: Point2D[] = [X];
        for (let k = j + 1; k < m + i + 1; k++) polyB.push(poly[k % m]!);
        polyB.push(X);
        const result: Point2D[][] = [];
        for (const sub of [polyA, polyB]) {
          const resolved = resolveSelfIntersections(sub, tol);
          for (const r of resolved) {
            if (r.length >= 3) result.push(r);
          }
        }
        return result.length > 0 ? result : [poly];
      }
    }
  }
  return [poly];
}
