import { pointToSegmentDistSq } from '@varve/shared';
import type { PathPoint } from '../types';

export interface SimplifiedPath {
  points: PathPoint[];
  originalCount: number;
  simplifiedCount: number;
  reduction: number;
}

function angleBetween(p1: PathPoint, p2: PathPoint, p3: PathPoint): number {
  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;
  const dot = dx1 * dx2 + dy1 * dy2;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (len1 === 0 || len2 === 0) return Math.PI;
  const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)));
  return Math.acos(cos);
}

function rdpRecursive(
  points: PathPoint[],
  first: number,
  last: number,
  epsilon: number,
): PathPoint[] {
  if (last - first <= 1) {
    return [points[first]!, points[last]!];
  }

  let maxDistSq = 0;
  let maxIdx = first;

  const pFirst = points[first]!;
  const pLast = points[last]!;

  for (let i = first + 1; i < last; i++) {
    const pi = points[i]!;
    const dSq = pointToSegmentDistSq([pFirst.x, pFirst.y], [pLast.x, pLast.y], [pi.x, pi.y]);
    if (dSq > maxDistSq) {
      maxDistSq = dSq;
      maxIdx = i;
    }
  }

  if (maxDistSq > epsilon * epsilon) {
    const left = rdpRecursive(points, first, maxIdx, epsilon);
    const right = rdpRecursive(points, maxIdx, last, epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [points[first]!, points[last]!];
  }
}

export function simplifyPathRDP(
  points: PathPoint[],
  epsilon: number,
  closed?: boolean,
): SimplifiedPath {
  const originalCount = points.length;
  if (points.length <= 2) {
    return {
      points: [...points],
      originalCount,
      simplifiedCount: points.length,
      reduction: 0,
    };
  }

  let result: PathPoint[];

  if (closed) {
    const centroidX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const centroidY = points.reduce((s, p) => s + p.y, 0) / points.length;
    let farthestIdx = 0;
    let maxDist = 0;
    for (let i = 0; i < points.length; i++) {
      const pi = points[i]!;
      const dx = pi.x - centroidX;
      const dy = pi.y - centroidY;
      const d = dx * dx + dy * dy;
      if (d > maxDist) {
        maxDist = d;
        farthestIdx = i;
      }
    }

    const rotated = [...points.slice(farthestIdx + 1), ...points.slice(0, farthestIdx + 1)];

    result = rdpRecursive(rotated, 0, rotated.length - 1, epsilon);
  } else {
    result = rdpRecursive(points, 0, points.length - 1, epsilon);
  }

  const simplifiedCount = result.length;
  return {
    points: result,
    originalCount,
    simplifiedCount,
    reduction: 1 - simplifiedCount / originalCount,
  };
}

export function fitCubicBezier(
  points: PathPoint[],
): { p0: PathPoint; p1: PathPoint; p2: PathPoint; p3: PathPoint } | null {
  if (points.length < 2) return null;

  const n = points.length;
  const p0 = points[0]!;
  const p3 = points[n - 1]!;

  const t = new Array<number>(n);
  t[0] = 0;
  for (let i = 1; i < n; i++) {
    const pi = points[i]!;
    const pim1 = points[i - 1]!;
    const dx = pi.x - pim1.x;
    const dy = pi.y - pim1.y;
    t[i] = t[i - 1]! + Math.sqrt(dx * dx + dy * dy);
  }
  const totalLength = t[n - 1]!;
  if (totalLength === 0) return null;

  for (let i = 0; i < n; i++) {
    t[i] = t[i]! / totalLength;
  }

  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1x = 0;
  let b2x = 0;
  let b1y = 0;
  let b2y = 0;

  for (let i = 1; i < n - 1; i++) {
    const ti = t[i]!;
    const u = 1 - ti;
    const b1 = 3 * u * u * ti;
    const b2 = 3 * u * ti * ti;
    const b0 = u * u * u;
    const b3 = ti * ti * ti;

    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;

    const pi = points[i]!;
    const rhsX = pi.x - b0 * p0.x - b3 * p3.x;
    const rhsY = pi.y - b0 * p0.y - b3 * p3.y;

    b1x += b1 * rhsX;
    b2x += b2 * rhsX;
    b1y += b1 * rhsY;
    b2y += b2 * rhsY;
  }

  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-10) return null;

  const c1x = (b1x * a22 - b2x * a12) / det;
  const c2x = (b2x * a11 - b1x * a12) / det;
  const c1y = (b1y * a22 - b2y * a12) / det;
  const c2y = (b2y * a11 - b1y * a12) / det;

  return {
    p0: { x: p0.x, y: p0.y, handleIn: null, handleOut: null },
    p1: { x: c1x, y: c1y, handleIn: null, handleOut: null },
    p2: { x: c2x, y: c2y, handleIn: null, handleOut: null },
    p3: { x: p3.x, y: p3.y, handleIn: null, handleOut: null },
  };
}

export function simplifyToBezier(
  points: PathPoint[],
  epsilon: number = 2,
  thresholdAngle: number = 120,
): PathPoint[] {
  const simplified = simplifyPathRDP(points, epsilon);
  const pts = simplified.points;
  if (pts.length <= 2) return pts;

  const thresholdRad = thresholdAngle * (Math.PI / 180);

  const splits: number[] = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = angleBetween(pts[i - 1]!, pts[i]!, pts[i + 1]!);
    if (a < thresholdRad) splits.push(i);
  }
  splits.push(pts.length - 1);

  interface BezierSeg {
    p0: PathPoint;
    p1: PathPoint;
    p2: PathPoint;
    p3: PathPoint;
  }

  const bezierSegments: BezierSeg[] = [];

  for (let s = 0; s < splits.length - 1; s++) {
    const segPts = pts.slice(splits[s]!, splits[s + 1]! + 1);
    if (segPts.length < 2) continue;

    if (segPts.length <= 3) {
      const p0 = segPts[0]!;
      const p3 = segPts[segPts.length - 1]!;
      const dx = (p3.x - p0.x) / 3;
      const dy = (p3.y - p0.y) / 3;
      bezierSegments.push({
        p0,
        p1: { x: p0.x + dx, y: p0.y + dy, handleIn: null, handleOut: null },
        p3,
        p2: { x: p3.x - dx, y: p3.y - dy, handleIn: null, handleOut: null },
      });
    } else {
      const fitted = fitCubicBezier(segPts);
      if (fitted) {
        bezierSegments.push(fitted);
      } else {
        const p0 = segPts[0]!;
        const p3 = segPts[segPts.length - 1]!;
        const dx = (p3.x - p0.x) / 3;
        const dy = (p3.y - p0.y) / 3;
        bezierSegments.push({
          p0,
          p1: { x: p0.x + dx, y: p0.y + dy, handleIn: null, handleOut: null },
          p3,
          p2: { x: p3.x - dx, y: p3.y - dy, handleIn: null, handleOut: null },
        });
      }
    }
  }

  const result: PathPoint[] = [];
  for (let i = 0; i < bezierSegments.length; i++) {
    const seg = bezierSegments[i]!;
    if (i === 0) {
      result.push({
        ...seg.p0,
        handleOut: [seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y],
      });
    }
    const nextSeg = bezierSegments[i + 1];
    const endPt: PathPoint = {
      ...seg.p3,
      handleIn: [seg.p2.x - seg.p3.x, seg.p2.y - seg.p3.y],
      handleOut: null,
    };
    if (nextSeg) {
      endPt.handleOut = [nextSeg.p1.x - nextSeg.p0.x, nextSeg.p1.y - nextSeg.p0.y];
    }
    result.push(endPt);
  }

  return result;
}
