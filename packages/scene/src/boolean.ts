/**
 * Boolean shape operations (union, subtract, intersect, exclude).
 *
 * Converts all shapes to polygons (adaptive bezier sampling for paths),
 * then performs polygon boolean via the Vatti-style segment classification:
 *   1. Find edge-edge intersections between the two polygons
 *   2. Split both polygons at every intersection point
 *   3. Classify each edge segment as inside/outside the other polygon
 *   4. Collect boundary segments matching the operation
 *
 * Handles intersections at polygon vertices (alpha near 0/1) by recording
 * them on the existing vertex rather than inserting a duplicate.
 */
import type { PathPoint } from '@strata/engine';
import type { Fill, ShapeNode } from './types';

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'exclude';

type Point2D = { x: number; y: number };

// ── Geometry helpers ─────────────────────────────────────────────────────────

function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): { point: Point2D; t1: number; t2: number } | null {
  const denom = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y);
  if (Math.abs(denom) < 1e-10) return null;
  const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denom;
  const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denom;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return {
    point: { x: a1.x + ua * (a2.x - a1.x), y: a1.y + ua * (a2.y - a1.y) },
    t1: ua,
    t2: ub,
  };
}

function polygonArea(poly: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function ensureCCW(poly: Point2D[]): Point2D[] {
  if (polygonArea(poly) < 0) return [...poly].reverse();
  return poly;
}

// ── Adaptive cubic bezier sampling ──────────────────────────────────────────

const FLATNESS = 1.0;

function flatnessSq(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const d2 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d3 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  return d2 + d3;
}

function sampleCubicBezier(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): Point2D[] {
  if (flatnessSq(p0, p1, p2, p3) < FLATNESS) return [p0, p3];
  const mid = (a: Point2D, b: Point2D) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(p0, p1);
  const m1 = mid(p1, p2);
  const m2 = mid(p2, p3);
  const m3 = mid(m0, m1);
  const m4 = mid(m1, m2);
  const m5 = mid(m3, m4);
  const left = sampleCubicBezier(p0, m0, m3, m5);
  const right = sampleCubicBezier(m5, m4, m2, p3);
  return [...left.slice(0, -1), ...right];
}

// ── Shape → polygon conversion ──────────────────────────────────────────────

function applyAffine(
  p: Point2D,
  t: readonly [number, number, number, number, number, number],
): Point2D {
  return { x: t[0] * p.x + t[2] * p.y + t[4], y: t[1] * p.x + t[3] * p.y + t[5] };
}

function shapeToPolygon(
  shape: ShapeNode['shape'],
  transform: readonly [number, number, number, number, number, number],
): Point2D[] {
  let poly: Point2D[];
  switch (shape.kind) {
    case 'rect': {
      poly = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.w, y: shape.y },
        { x: shape.x + shape.w, y: shape.y + shape.h },
        { x: shape.x, y: shape.y + shape.h },
      ];
      break;
    }
    case 'ellipse': {
      const n = 48;
      poly = [];
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n;
        poly.push({
          x: shape.cx + shape.rx * Math.cos(theta),
          y: shape.cy + shape.ry * Math.sin(theta),
        });
      }
      break;
    }
    case 'circle': {
      const n = 48;
      poly = [];
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n;
        poly.push({
          x: shape.cx + shape.r * Math.cos(theta),
          y: shape.cy + shape.r * Math.sin(theta),
        });
      }
      break;
    }
    case 'line':
      poly = [
        { x: shape.from[0], y: shape.from[1] },
        { x: shape.to[0], y: shape.to[1] },
      ];
      break;
    case 'polygon': {
      poly = [];
      const sides = shape.sides;
      for (let i = 0; i < sides; i++) {
        const a = (2 * Math.PI * i) / sides - Math.PI / 2 + shape.rotation;
        poly.push({
          x: shape.cx + shape.radius * Math.cos(a),
          y: shape.cy + shape.radius * Math.sin(a),
        });
      }
      break;
    }
    case 'star': {
      poly = [];
      for (let i = 0; i < shape.points * 2; i++) {
        const a = (Math.PI * i) / shape.points - Math.PI / 2 + shape.rotation;
        const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
        poly.push({ x: shape.cx + r * Math.cos(a), y: shape.cy + r * Math.sin(a) });
      }
      break;
    }
    case 'arrow':
      poly = [
        { x: shape.from[0], y: shape.from[1] },
        { x: shape.to[0], y: shape.to[1] },
      ];
      break;
    case 'path': {
      poly = pathPointsToPolygon(shape.points, shape.closed);
      return poly.map((p) => applyAffine(p, transform));
    }
  }
  return poly.map((p) => applyAffine(p, transform));
}

function pathPointsToPolygon(points: PathPoint[], closed: boolean): Point2D[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const result: Point2D[] = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i]!;
    const next = points[(i + 1) % points.length]!;
    if (i === points.length - 1 && !closed) break;
    const p0: Point2D = { x: curr.x, y: curr.y };
    const p3: Point2D = { x: next.x, y: next.y };
    if (curr.handleOut && next.handleIn) {
      const p1: Point2D = { x: curr.x + curr.handleOut[0], y: curr.y + curr.handleOut[1] };
      const p2: Point2D = { x: next.x + next.handleIn[0], y: next.y + next.handleIn[1] };
      const sampled = sampleCubicBezier(p0, p1, p2, p3);
      for (let j = 0; j < sampled.length - 1; j++) result.push(sampled[j]!);
    } else if (curr.handleOut) {
      const p1: Point2D = { x: curr.x + curr.handleOut[0], y: curr.y + curr.handleOut[1] };
      const p2 = { x: next.x, y: next.y };
      const sampled = sampleCubicBezier(p0, p1, p2, p3);
      for (let j = 0; j < sampled.length - 1; j++) result.push(sampled[j]!);
    } else {
      result.push(p0);
    }
  }
  if (closed && result.length > 0) {
    const first = result[0]!;
    result.push({ x: first.x, y: first.y });
  }
  return result;
}

// ── Polygon intersection finding + classification ──────────────────────────

interface XDesc {
  point: Point2D;
  /** Edge index in subject */
  subEdge: number;
  /** Edge index in clip */
  clipEdge: number;
  /** Parametric position on subject edge (0-1) */
  subAlpha: number;
  /** Parametric position on clip edge (0-1) */
  clipAlpha: number;
}

function findIntersections(sub: Point2D[], clip: Point2D[]): XDesc[] {
  const results: XDesc[] = [];
  for (let si = 0; si < sub.length; si++) {
    const a1 = sub[si]!;
    const a2 = sub[(si + 1) % sub.length]!;
    // Skip degenerate (closing) edges
    if (Math.abs(a1.x - a2.x) < 1e-10 && Math.abs(a1.y - a2.y) < 1e-10) continue;
    for (let ci = 0; ci < clip.length; ci++) {
      const b1 = clip[ci]!;
      const b2 = clip[(ci + 1) % clip.length]!;
      if (Math.abs(b1.x - b2.x) < 1e-10 && Math.abs(b1.y - b2.y) < 1e-10) continue;
      const segX = segmentIntersection(a1, a2, b1, b2);
      if (segX) {
        // Keep only real crossings: subject touches the clip mid-edge
        // (subAlpha strictly between 0 and 1). Vertex-touch intersections
        // where only the clip's edge is contacted at the subject's vertex
        // are filtered — they don't create inside/outside transitions.
        if (segX.t1 <= 1e-10 || segX.t1 >= 1 - 1e-10) continue;
        results.push({
          point: segX.point,
          subEdge: si,
          clipEdge: ci,
          subAlpha: segX.t1,
          clipAlpha: segX.t2,
        });
      }
    }
  }
  return results;
}

// ── Polygon boolean via segment walk (Vatti-style) ──────────────────────────

/**
 * Split both polygons at intersection points, building a unified vertex
 * representation. Each vertex is either an original vertex or an
 * intersection point (with a partner index in the other polygon).
 */
interface BoolVert {
  point: Point2D;
  isX: boolean;
  partner: number;
}

/**
 * Build the vertex arrays for both polygons, splitting edges at
 * intersection points.
 */
function splitPolygons(
  sub: Point2D[],
  clip: Point2D[],
  xs: XDesc[],
): { subVerts: BoolVert[]; clipVerts: BoolVert[] } {
  function insertInto(poly: Point2D[], xs: XDesc[], isSubject: boolean): BoolVert[] {
    // Group Xs by edge, sorted by alpha
    type EdgeX = { edgeIdx: number; alpha: number; point: Point2D; xIdx: number };
    const edges: EdgeX[] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      edges.push({
        edgeIdx: isSubject ? x.subEdge : x.clipEdge,
        alpha: isSubject ? x.subAlpha : x.clipAlpha,
        point: x.point,
        xIdx: i,
      });
    }
    edges.sort((a, b) => a.edgeIdx - b.edgeIdx || a.alpha - b.alpha);

    const result: BoolVert[] = [];
    let edgePos = 0;
    for (let i = 0; i < poly.length; i++) {
      const next = poly[(i + 1) % poly.length]!;
      // Skip degenerate closing edge
      const curr = poly[i]!;
      if (Math.abs(curr.x - next.x) < 1e-10 && Math.abs(curr.y - next.y) < 1e-10) continue;

      result.push({ point: curr, isX: false, partner: -1 });
      while (edgePos < edges.length && edges[edgePos]?.edgeIdx === i) {
        const e = edges[edgePos]!;
        const prevPt = result[result.length - 1]?.point;
        if (Math.abs(e.point.x - prevPt.x) > 1e-8 || Math.abs(e.point.y - prevPt.y) > 1e-8) {
          result.push({ point: e.point, isX: true, partner: -1 });
        }
        edgePos++;
      }
    }
    return result;
  }

  const subVerts = insertInto(sub, xs, true);
  const clipVerts = insertInto(clip, xs, false);

  // Remove ALL duplicate positions (from X insertion at polygon vertices).
  // When a duplicate is found, merge the isX flag so markers aren't lost.
  function dedupe(verts: BoolVert[]): BoolVert[] {
    if (verts.length < 2) return verts;
    const result: BoolVert[] = [];
    for (const v of verts) {
      let found = false;
      for (const r of result) {
        if (Math.abs(v.point.x - r.point.x) < 1e-8 && Math.abs(v.point.y - r.point.y) < 1e-8) {
          if (v.isX) r.isX = true;
          found = true;
          break;
        }
      }
      if (!found) result.push(v);
    }
    return result;
  }
  const subClean = dedupe(subVerts);
  const clipClean = dedupe(clipVerts);

  // Resolve partner indices after dedup
  for (let si = 0; si < subClean.length; si++) {
    const sv = subClean[si]!;
    if (!sv.isX) continue;
    for (let ci = 0; ci < clipClean.length; ci++) {
      const cv = clipClean[ci]!;
      const d = Math.abs(sv.point.x - cv.point.x) + Math.abs(sv.point.y - cv.point.y);
      if (d < 1e-8) {
        sv.partner = ci;
        cv.partner = si;
        cv.isX = true;
        break;
      }
    }
  }
  for (let ci = 0; ci < clipClean.length; ci++) {
    const cv = clipClean[ci]!;
    if (!cv.isX || cv.partner >= 0) continue;
    for (let si = 0; si < subClean.length; si++) {
      const sv = subClean[si]!;
      const d = Math.abs(sv.point.x - cv.point.x) + Math.abs(sv.point.y - cv.point.y);
      if (d < 1e-8) {
        cv.partner = si;
        sv.partner = ci;
        sv.isX = true;
        break;
      }
    }
  }

  return { subVerts: subClean, clipVerts: clipClean };
}

/**
 * For each run of non-X vertices between X vertices, classify the run
 * as inside/outside the other polygon.
 */
interface Run {
  verts: BoolVert[];
  insideOther: boolean;
}

function classifyRuns(
  subVerts: BoolVert[],
  clipVerts: BoolVert[],
): { subRuns: Run[]; clipRuns: Run[] } {
  function build(verts: BoolVert[], other: BoolVert[]): Run[] {
    const runs: Run[] = [];
    const otherPts = other.map((v) => v.point);

    // Find X indices
    const xIdxs: number[] = [];
    for (let i = 0; i < verts.length; i++) {
      if (verts[i]?.isX) xIdxs.push(i);
    }

    if (xIdxs.length < 2) return runs;

    for (let r = 0; r < xIdxs.length; r++) {
      const start = xIdxs[r]!;
      const end = xIdxs[(r + 1) % xIdxs.length]!;

      const seg: BoolVert[] = [];
      if (start < end) {
        for (let i = start; i <= end; i++) seg.push(verts[i]!);
      } else {
        for (let i = start; i < verts.length; i++) seg.push(verts[i]!);
        for (let i = 0; i <= end; i++) seg.push(verts[i]!);
      }

      if (seg.length < 2) continue;

      // Use midpoint of the first edge in the run with tiny nudge
      const midX = (seg[0]?.point.x + seg[1]?.point.x) / 2 + 1e-5;
      const midY = (seg[0]?.point.y + seg[1]?.point.y) / 2 + 1e-5;
      const inside = pointInPolygon({ x: midX, y: midY }, otherPts);
      runs.push({ verts: seg, insideOther: inside });
    }
    return runs;
  }

  return { subRuns: build(subVerts, clipVerts), clipRuns: build(clipVerts, subVerts) };
}

/**
 * Assemble result contour(s) from accepted runs.
 * Runs are connected at their start/end intersection points.
 */
function assembleContour(runs: Run[]): Point2D[] | null {
  if (runs.length === 0) return null;

  const used = new Set<number>();
  let best: Point2D[] | null = null;
  let bestArea = 0;

  for (let start = 0; start < runs.length; start++) {
    if (used.has(start)) continue;

    const contour: Point2D[] = [];
    let currentIdx = start;
    let safety = 0;

    while (!used.has(currentIdx) && safety < runs.length + 1) {
      safety++;
      used.add(currentIdx);
      const run = runs[currentIdx]!;

      // Add vertices (all but the last—the end-X, which connects to next run)
      for (let i = 0; i < run.verts.length - 1; i++) {
        contour.push(run.verts[i]?.point);
      }

      const lastPt = run.verts[run.verts.length - 1]?.point;

      // Find next run starting at lastPt
      let nextIdx = -1;
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const candFirst = runs[i]?.verts[0]?.point;
        if (Math.abs(candFirst.x - lastPt.x) < 1e-8 && Math.abs(candFirst.y - lastPt.y) < 1e-8) {
          nextIdx = i;
          break;
        }
        // Try reversed
        const candLast = runs[i]?.verts[runs[i]?.verts.length - 1]?.point;
        if (Math.abs(candLast.x - lastPt.x) < 1e-8 && Math.abs(candLast.y - lastPt.y) < 1e-8) {
          runs[i]?.verts.reverse();
          nextIdx = i;
          break;
        }
      }

      if (nextIdx < 0) break;
      currentIdx = nextIdx;
    }

    if (contour.length >= 3) {
      // Close
      const f = contour[0]!;
      const l = contour[contour.length - 1]!;
      if (Math.abs(f.x - l.x) > 1e-8 || Math.abs(f.y - l.y) > 1e-8) {
        contour.push({ x: f.x, y: f.y });
      }
      const area = Math.abs(polygonArea(contour));
      if (area > 0.5 && area > bestArea) {
        bestArea = area;
        best = contour;
      }
    }
  }

  return best;
}

function clipPolygons(
  subject: Point2D[],
  clip: Point2D[],
  operation: 'intersect' | 'union' | 'subtract',
): Point2D[] | null {
  const sub = ensureCCW(subject);
  const clp = ensureCCW(clip);
  const xs = findIntersections(sub, clp);

  if (xs.length === 0) {
    // No intersections — check containment
    const subMid =
      sub.length > 2
        ? {
            x: (sub[0]?.x + sub[Math.floor(sub.length / 2)]?.x) / 2,
            y: (sub[0]?.y + sub[Math.floor(sub.length / 2)]?.y) / 2,
          }
        : sub[0]!;
    const clipMid =
      clp.length > 2
        ? {
            x: (clp[0]?.x + clp[Math.floor(clp.length / 2)]?.x) / 2,
            y: (clp[0]?.y + clp[Math.floor(clp.length / 2)]?.y) / 2,
          }
        : clp[0]!;
    const subInsideClip = pointInPolygon(subMid, clp);
    const clipInsideSub = pointInPolygon(clipMid, sub);

    switch (operation) {
      case 'intersect':
        return null;
      case 'union': {
        if (subInsideClip) return [...clp];
        if (clipInsideSub) return [...sub];
        return [...sub, ...clp];
      }
      case 'subtract': {
        if (subInsideClip) return null;
        return [...sub];
      }
    }
  }

  const { subVerts, clipVerts } = splitPolygons(sub, clp, xs);
  const { subRuns, clipRuns } = classifyRuns(subVerts, clipVerts);

  // Collect accepted runs based on operation
  const acceptInside = operation === 'intersect';
  const isSubtract = operation === 'subtract';

  const accepted: Run[] = [];

  for (const run of subRuns) {
    if (isSubtract ? !run.insideOther : run.insideOther === acceptInside) {
      accepted.push(run);
    }
  }

  for (const run of clipRuns) {
    if (isSubtract ? run.insideOther : run.insideOther === acceptInside) {
      if (isSubtract) run.verts.reverse();
      accepted.push(run);
    }
  }

  const result = assembleContour(accepted);
  if (result) return ensureCCW(result);
  return null;
}

// ── Result construction ─────────────────────────────────────────────────────

function makeResult(points: PathPoint[], closed: boolean, first: ShapeNode, id: string): ShapeNode {
  return {
    id,
    name: 'Boolean Result',
    kind: 'shape',
    index: first.index,
    order: first.order,
    visible: true,
    locked: false,
    opacity: first.opacity,
    blendMode: first.blendMode,
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'path', points, closed, tolerance: 3 },
    fill: first.fill,
    fills: (first.fills?.length
      ? [...first.fills]
      : first.fill
        ? [
            {
              type: 'solid' as const,
              color: first.fill,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            } as Fill,
          ]
        : []) as Fill[],
    strokes: [...(first.strokes ?? [])],
    effects: [...(first.effects ?? [])],
  };
}

let _idCounter = 0;
function freshId(): string {
  return `bool-${Date.now()}-${_idCounter++}`;
}

function polygonToPathPoints(poly: Point2D[]): PathPoint[] {
  return poly.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
}

function simplifyPolygon(poly: Point2D[]): Point2D[] {
  if (poly.length < 3) return poly;
  const result: Point2D[] = [poly[0]!];
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const curr = poly[i]!;
    const next = poly[i + 1]!;
    const cross = Math.abs(
      (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x),
    );
    if (cross > 0.5) result.push(curr);
  }
  result.push(poly[poly.length - 1]!);
  return result;
}

function dedupePoly(poly: Point2D[]): Point2D[] {
  if (poly.length < 2) return poly;
  const result: Point2D[] = [poly[0]!];
  for (let i = 1; i < poly.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = poly[i]!;
    if (Math.abs(curr.x - prev.x) > 1e-8 || Math.abs(curr.y - prev.y) > 1e-8) {
      result.push(curr);
    }
  }
  return result;
}

export function booleanOp(kind: BooleanOpKind, nodes: ShapeNode[]): ShapeNode {
  if (nodes.length === 0) throw new Error('booleanOp requires at least one node');
  const first = nodes[0]!;
  const id = freshId();

  const polygons = nodes.map((n) => shapeToPolygon(n.shape, n.transform));

  switch (kind) {
    case 'union': {
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'union');
        if (!clipped || clipped.length < 3) {
          result = [...result, ...polygons[i]!];
        } else {
          result = clipped;
        }
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'intersect': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'intersect');
        if (!clipped || clipped.length < 3) {
          const origin = result[0] || { x: 0, y: 0 };
          return makeResult(
            [{ x: origin.x, y: origin.y, handleIn: null, handleOut: null }],
            true,
            first,
            id,
          );
        }
        result = clipped;
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'subtract': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'subtract');
        if (clipped && clipped.length >= 3) result = clipped;
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'exclude': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let ab = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const c = clipPolygons(ab, polygons[i]!, 'subtract');
        if (c && c.length >= 3) ab = c;
      }
      let ba = polygons[polygons.length - 1]!;
      for (let i = polygons.length - 2; i >= 0; i--) {
        const c = clipPolygons(ba, polygons[i]!, 'subtract');
        if (c && c.length >= 3) ba = c;
      }
      const unionResult = clipPolygons(ab, ba, 'union');
      const result = unionResult && unionResult.length >= 3 ? unionResult : [...ab, ...ba];
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }
  }
}
