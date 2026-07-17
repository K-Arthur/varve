/**
 * Bezier curve fitting for traced raster contours.
 *
 * Takes a polyline contour from raster tracing and fits cubic Bezier curves
 * to each segment between detected corners, with recursive subdivision
 * when fitting error exceeds the threshold.
 *
 * Research basis: Schneider, "An Algorithm for Automatically Fitting Digitized
 * Curves" (Graphics Gems, 1990).
 */

import type { PathPoint } from './types';

export interface BezierFitOptions {
  /** Interior angle (degrees) below which a vertex is treated as a sharp corner. Default 135. */
  cornerAngle?: number;
  /** Maximum fitting error in pixels before subdividing. Default 1.0. */
  maxError?: number;
  /** Minimum segment length in pixels for curve fitting. Default 3. */
  minSegmentPx?: number;
}

interface CubicBezierCoeffs {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

function pointOnBezier(b: CubicBezierCoeffs, t: number): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: b.ax * t3 + b.bx * t2 + b.cx * t + b.dx,
    y: b.ay * t3 + b.by * t2 + b.cy * t + b.dy,
  };
}

function angleBetween(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): number {
  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;
  const len1 = Math.hypot(dx1, dy1);
  const len2 = Math.hypot(dx2, dy2);
  if (len1 < 1e-10 || len2 < 1e-10) return 180;
  const cos = Math.max(-1, Math.min(1, (dx1 * dx2 + dy1 * dy2) / (len1 * len2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function chordLengthParams(points: { x: number; y: number }[]): number[] {
  const params: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dp = points[i]!;
    const pp = points[i - 1]!;
    total += Math.hypot(dp.x - pp.x, dp.y - pp.y);
    params.push(total);
  }
  if (total > 0) {
    for (let i = 1; i < params.length; i += 1) params[i] = (params[i] as number) / total;
  }
  return params;
}

function fitCubicLeastSquares(
  points: { x: number; y: number }[],
  s: number,
  e: number,
): CubicBezierCoeffs | null {
  const p0 = points[s]!;
  const p3 = points[e]!;
  const segment = points.slice(s, e + 1);
  if (segment.length < 2) return null;

  const t = chordLengthParams(segment);

  let a11_acc = 0;
  let a12_acc = 0;
  let a22_acc = 0;
  let b1x_acc = 0;
  let b2x_acc = 0;
  let b1y_acc = 0;
  let b2y_acc = 0;

  for (let i = 0; i < segment.length; i += 1) {
    const ti = t[i] as number;
    const ti2 = ti * ti;
    const ti3 = ti2 * ti;
    const u = 1 - ti;
    const u2 = u * u;
    const u3 = u2 * u;
    const a0 = 3 * u2 * ti;
    const a1 = 3 * u * ti2;
    const pt = segment[i]!;
    a11_acc += a0 * a0;
    a12_acc += a0 * a1;
    a22_acc += a1 * a1;
    b1x_acc += a0 * (pt.x - u3 * p0.x - ti3 * p3.x);
    b2x_acc += a1 * (pt.x - u3 * p0.x - ti3 * p3.x);
    b1y_acc += a0 * (pt.y - u3 * p0.y - ti3 * p3.y);
    b2y_acc += a1 * (pt.y - u3 * p0.y - ti3 * p3.y);
  }

  const det = a11_acc * a22_acc - a12_acc * a12_acc;
  if (Math.abs(det) < 1e-12) return null;

  const c1x = (a22_acc * b1x_acc - a12_acc * b2x_acc) / det;
  const c2x = (a11_acc * b2x_acc - a12_acc * b1x_acc) / det;
  const c1y = (a22_acc * b1y_acc - a12_acc * b2y_acc) / det;
  const c2y = (a11_acc * b2y_acc - a12_acc * b1y_acc) / det;

  return {
    ax: p3.x - 3 * c2x + 3 * c1x - p0.x,
    ay: p3.y - 3 * c2y + 3 * c1y - p0.y,
    bx: 3 * c2x - 6 * c1x + 3 * p0.x,
    by: 3 * c2y - 6 * c1y + 3 * p0.y,
    cx: 3 * c1x - 3 * p0.x,
    cy: 3 * c1y - 3 * p0.y,
    dx: p0.x,
    dy: p0.y,
  };
}

function maxFittingErrorIndex(
  coeffs: CubicBezierCoeffs,
  points: { x: number; y: number }[],
  s: number,
  e: number,
): { maxErr: number; index: number } {
  const segment = points.slice(s, e + 1);
  const t = chordLengthParams(segment);
  let maxErr = 0;
  let maxIdx = -1;
  for (let i = 1; i < segment.length - 1; i += 1) {
    const p = pointOnBezier(coeffs, t[i] as number);
    const pt = points[s + i]!;
    const err = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (err > maxErr) {
      maxErr = err;
      maxIdx = s + i;
    }
  }
  return { maxErr, index: maxIdx };
}

function coeffsToHandles(c: CubicBezierCoeffs): {
  handleOut: [number, number] | null;
  handleIn: [number, number] | null;
} {
  const c1x = c.cx / 3 + c.dx;
  const c1y = c.cy / 3 + c.dy;
  const c2x = c.bx / 3 + (2 * c.cx) / 3 + c.dx;
  const c2y = c.by / 3 + (2 * c.cy) / 3 + c.dy;

  const hOutX = c1x - c.dx;
  const hOutY = c1y - c.dy;
  const hInX = c2x - (c.ax + c.bx + c.cx + c.dx);
  const hInY = c2y - (c.ay + c.by + c.cy + c.dy);

  return {
    handleOut: Math.abs(hOutX) > 0.5 || Math.abs(hOutY) > 0.5 ? [hOutX, hOutY] : null,
    handleIn: Math.abs(hInX) > 0.5 || Math.abs(hInY) > 0.5 ? [hInX, hInY] : null,
  };
}

/**
 * Fit cubic Bezier to a polyline from s to e with recursive subdivision.
 * Returns list of corner anchor indices to keep.
 */
function fitSegmentRecursive(
  points: { x: number; y: number }[],
  s: number,
  e: number,
  maxError: number,
  anchors: Set<number>,
): void {
  if (e - s < 3 || Math.hypot(points[e]!.x - points[s]!.x, points[e]!.y - points[s]!.y) < 3) {
    anchors.add(s);
    anchors.add(e);
    return;
  }

  const coeffs = fitCubicLeastSquares(points, s, e);
  if (!coeffs) {
    anchors.add(s);
    anchors.add(e);
    return;
  }

  const { maxErr, index } = maxFittingErrorIndex(coeffs, points, s, e);
  if (maxErr <= maxError || index < 0) {
    anchors.add(s);
    anchors.add(e);
    return;
  }

  fitSegmentRecursive(points, s, index, maxError, anchors);
  fitSegmentRecursive(points, index, e, maxError, anchors);
}

function buildAnchors(points: { x: number; y: number }[], anchorIndices: number[]): PathPoint[] {
  if (anchorIndices.length < 2) {
    return points.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
  }

  const result: PathPoint[] = [];

  for (let ai = 0; ai < anchorIndices.length - 1; ai += 1) {
    const s = anchorIndices[ai] as number;
    const e = anchorIndices[ai + 1] as number;
    const startPt = points[s]!;
    const endPt = points[e]!;

    if (e - s < 3) {
      if (result.length === 0) {
        result.push({ x: startPt.x, y: startPt.y, handleIn: null, handleOut: null });
      }
      result.push({ x: endPt.x, y: endPt.y, handleIn: null, handleOut: null });
      continue;
    }

    const coeffs = fitCubicLeastSquares(points, s, e);
    if (!coeffs) {
      if (result.length === 0) {
        result.push({ x: startPt.x, y: startPt.y, handleIn: null, handleOut: null });
      }
      result.push({ x: endPt.x, y: endPt.y, handleIn: null, handleOut: null });
      continue;
    }

    const { handleOut } = coeffsToHandles(coeffs);
    if (result.length === 0) {
      result.push({
        x: startPt.x,
        y: startPt.y,
        handleIn: null,
        handleOut,
      });
    } else {
      result[result.length - 1]!.handleOut = handleOut;
    }

    const { handleIn } = coeffsToHandles(coeffs);
    result.push({
      x: endPt.x,
      y: endPt.y,
      handleIn,
      handleOut: null,
    });
  }

  return result;
}

/**
 * Fit cubic Bezier curves to a traced polyline contour.
 *
 * Returns PathPoint[] with handleIn/handleOut offsets. Sharp corners are
 * preserved as bare corner points. Curve segments between corners are fitted
 * with cubic Bezier curves, recursively subdivided when error exceeds maxError.
 */
export function fitBezierToContour(
  contour: { x: number; y: number }[],
  closed: boolean,
  options: BezierFitOptions = {},
): PathPoint[] {
  if (contour.length < 4) {
    return contour.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
  }

  const cornerAngle = options.cornerAngle ?? 135;
  const maxError = options.maxError ?? 1.0;

  const n = contour.length;

  // If no corner or only one corner, treat the whole contour as one smooth segment
  const cornerIndices: number[] = [0];

  for (let i = 1; i < n - 1; i += 1) {
    const angle = angleBetween(contour[i - 1]!, contour[i]!, contour[i + 1]!);
    if (angle < cornerAngle) {
      cornerIndices.push(i);
    }
  }

  if (closed && n >= 3) {
    cornerIndices.push(0);
  } else {
    cornerIndices.push(n - 1);
  }

  const deduped = [...new Set(cornerIndices)].sort((a, b) => a - b);

  // No real corners found (smooth curve): treat entire contour as one curve segment
  if (deduped.length <= 1 || (deduped.length === 2 && deduped[0] === deduped[1])) {
    const allAnchors = new Set<number>();
    fitSegmentRecursive(contour, 0, n - 1, maxError, allAnchors);
    const sorted = [...allAnchors].sort((a, b) => a - b);
    if (sorted.length < 2) {
      return contour.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
    }
    const result = buildAnchors(contour, sorted);
    if (closed && result.length >= 2) {
      const f = result[0]!;
      const l = result[result.length - 1]!;
      const dx = l.x - f.x;
      const dy = l.y - f.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        result.pop();
        f.handleIn = l.handleIn;
        if (result.length >= 2) result[result.length - 1]!.handleOut = l.handleOut;
      }
    }
    return result;
  }

  const allAnchors = new Set<number>();

  for (let ci = 0; ci < deduped.length - 1; ci += 1) {
    const s = deduped[ci] as number;
    const e = deduped[ci + 1] as number;
    if (e - s < 2) {
      allAnchors.add(s);
      continue;
    }
    allAnchors.add(s);
    fitSegmentRecursive(contour, s, e, maxError, allAnchors);
  }

  // Handle wrap-around for closed contours — all indices between lastCorner
  // and firstCorner (wrapping through n-1) become anchors.
  if (closed && deduped.length >= 2) {
    const lastCorner = deduped[deduped.length - 1] as number;
    const firstCorner = deduped[0] as number;
    // From lastCorner through the end of the contour
    for (let i = lastCorner; i < n; i += 1) {
      allAnchors.add(i);
    }
    // From the start through firstCorner (if first > 0 to avoid double-add)
    for (let i = 0; i < firstCorner; i += 1) {
      allAnchors.add(i);
    }
  }

  const sorted = [...allAnchors].sort((a, b) => a - b);

  if (sorted.length < 2) {
    return contour.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
  }

  const result = buildAnchors(contour, sorted);

  if (result.length < 3) {
    return contour.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
  }

  if (closed && result.length >= 3) {
    const first = result[0]!;
    const last = result[result.length - 1]!;

    const lastDx = last.x - first.x;
    const lastDy = last.y - first.y;
    if (Math.abs(lastDx) < 0.5 && Math.abs(lastDy) < 0.5) {
      result.pop();
      first.handleIn = last.handleIn;
      if (result.length >= 2) {
        result[result.length - 1]!.handleOut = last.handleOut;
      }
    } else {
      last.handleOut = first.handleOut;
      first.handleIn = last.handleIn;
    }
  }

  for (const pt of result) {
    if (pt.handleIn && Math.abs(pt.handleIn[0]) < 0.5 && Math.abs(pt.handleIn[1]) < 0.5) {
      pt.handleIn = null;
    }
    if (pt.handleOut && Math.abs(pt.handleOut[0]) < 0.5 && Math.abs(pt.handleOut[1]) < 0.5) {
      pt.handleOut = null;
    }
  }

  return result;
}
