/**
 * Curved text / text-on-path math (Phase 5).
 *
 * Places glyphs along any of the 9 shape kinds by sampling position + tangent
 * angle at regular arc-length intervals. Uses adaptive Simpson integration for
 * bezier arc length (delegating to cubicBezierLength from bezier.ts) and
 * de Casteljau for point evaluation.
 *
 * Fast-path for circles: evenly-spaced angular sampling, no integration needed.
 *
 * Research basis: Figma "Text on a path", Illustrator Type on a Path,
 *                 W3C SVG textPath, HarfBuzz glyph positioning.
 */

import type { Affine } from '@varve/shared';
import {
  cubicBezierDerivative,
  cubicBezierLength,
  cubicBezierPoint,
  type PathPoint,
  pathPointToBezier,
} from './bezier';
import type { Shape } from './types';
import { shapeToPathPoints } from './warp/geometry';

/** Position and tangent angle at a point along a path. */
export interface PathSample {
  x: number;
  y: number;
  angle: number; // radians, tangent direction
}

/** A single glyph placed along the path. */
export interface GlyphPlacement {
  char: string;
  x: number;
  y: number;
  angle: number; // radians
  /** Baseline advance to the next glyph centre (in px). */
  advance: number;
}

/** Options for placeGlyphsOnPath. */
export interface GlyphPlaceOptions {
  /** 0-1 offset along the path to start (default 0). */
  offset?: number;
  /** 'top' = above the path (normal left-of-tangent), 'bottom' = below. */
  side?: 'top' | 'bottom';
  /** Font size in px (used for advance and side offset). */
  fontSize?: number;
}

/**
 * Convert a path geometry into another coordinate space.
 *
 * Text-on-path receives the text node's transform at replay time, while the
 * referenced shape is authored in the path node's local space. Converting to
 * cubic path points keeps the full affine (including rotation and non-uniform
 * scale) instead of pretending every transformed ellipse is axis-aligned.
 */
export function transformPathShape(shape: Shape, transform: Affine): Shape {
  const converted = shapeToPathPoints(shape);
  const transformPoint = (point: PathPoint): PathPoint => ({
    ...point,
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
    ...(point.handleIn
      ? {
          handleIn: [
            transform[0] * point.handleIn[0] + transform[2] * point.handleIn[1],
            transform[1] * point.handleIn[0] + transform[3] * point.handleIn[1],
          ] as [number, number],
        }
      : {}),
    ...(point.handleOut
      ? {
          handleOut: [
            transform[0] * point.handleOut[0] + transform[2] * point.handleOut[1],
            transform[1] * point.handleOut[0] + transform[3] * point.handleOut[1],
          ] as [number, number],
        }
      : {}),
  });

  return {
    kind: 'path',
    points: converted.points.map(transformPoint),
    closed: converted.closed,
    tolerance: 0,
    ...(converted.holes ? { holes: converted.holes.map((ring) => ring.map(transformPoint)) } : {}),
    ...(converted.fillRule ? { fillRule: converted.fillRule } : {}),
  };
}

/**
 * Sample a point on a shape at a given arc length distance from the start.
 * For closed shapes the path wraps; for open shapes it clamps to endpoints.
 */
export function samplePathAtLength(shape: Shape, distance: number): PathSample {
  switch (shape.kind) {
    case 'circle':
      return sampleCircleAtLength(shape.cx, shape.cy, shape.r, distance);
    case 'ellipse':
      return sampleEllipseAtLength(shape.cx, shape.cy, shape.rx, shape.ry, distance);
    case 'rect':
      return sampleRectAtLength(shape.x, shape.y, shape.w, shape.h, distance);
    case 'line':
      return sampleLineAtLength(shape.from, shape.to, distance);
    case 'arrow':
      return sampleLineAtLength(shape.from, shape.to, distance);
    case 'polygon':
      return samplePolygonAtLength(
        shape.cx,
        shape.cy,
        shape.radius,
        shape.sides,
        shape.rotation,
        distance,
      );
    case 'star':
      return sampleStarAtLength(
        shape.cx,
        shape.cy,
        shape.innerRadius,
        shape.outerRadius,
        shape.points,
        shape.rotation,
        distance,
      );
    case 'path':
      return samplePathPointsAtLength(shape.points, shape.closed, distance);
    default:
      return { x: 0, y: 0, angle: 0 };
  }
}

/** Total arc length of a shape (for normalising offset). */
export function pathLength(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return 2 * Math.PI * shape.r;
    case 'ellipse':
      return ellipseCircumference(shape.rx, shape.ry);
    case 'rect':
      return 2 * (shape.w + shape.h);
    case 'line':
      return pointDist2D(shape.from, shape.to);
    case 'arrow':
      return pointDist2D(shape.from, shape.to);
    case 'polygon':
      return polygonPerimeter(shape.cx, shape.cy, shape.radius, shape.sides, shape.rotation);
    case 'star':
      return starPerimeter(
        shape.cx,
        shape.cy,
        shape.innerRadius,
        shape.outerRadius,
        shape.points,
        shape.rotation,
      );
    case 'path':
      return pathPointsLength(shape.points, shape.closed);
    default:
      return 0;
  }
}

/**
 * Place glyphs of `text` along `shape`, returning positioned glyphs.
 * Letter-spacing is proportional to fontSize. For empty text, returns [].
 */
export function placeGlyphsOnPath(
  text: string,
  shape: Shape,
  options: GlyphPlaceOptions = {},
): GlyphPlacement[] {
  if (text.length === 0) return [];

  const totalLen = pathLength(shape);
  if (totalLen === 0) return [];

  const fs = options.fontSize ?? 16;
  const advance = fs * 0.6; // approximate char width (matches estimateCharWidth in textMeasure)
  const offset = Math.max(0, Math.min(1, options.offset ?? 0));
  const side = options.side ?? 'top';
  const sideOffset = side === 'bottom' ? -fs * 0.3 : fs * 0.3;

  const startDistance = offset * totalLen;
  const placements: GlyphPlacement[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const glyphCentre = startDistance + i * advance + advance / 2;
    if (glyphCentre > totalLen) break;

    const sample = samplePathAtLength(shape, glyphCentre);

    // Offset perpendicular to tangent (left/right of path direction)
    const perpAngle = sample.angle + Math.PI / 2;
    const px = sample.x + sideOffset * Math.cos(perpAngle);
    const py = sample.y + sideOffset * Math.sin(perpAngle);

    placements.push({
      char,
      x: px,
      y: py,
      angle: sample.angle,
      advance,
    });
  }

  return placements;
}

// ── Helpers ────────────────────────────────────────────────────────────

function pointDist2D(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Circle fast path ───────────────────────────────────────────────────

function sampleCircleAtLength(cx: number, cy: number, r: number, dist: number): PathSample {
  const circ = 2 * Math.PI * r;
  const t = ((dist % circ) / circ) * 2 * Math.PI;
  return {
    x: cx + r * Math.cos(t - Math.PI / 2),
    y: cy + r * Math.sin(t - Math.PI / 2),
    angle: t,
  };
}

// ── Ellipse (approximate via parametric) ───────────────────────────────

function ellipseCircumference(rx: number, ry: number): number {
  // Ramanujan approximation
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function sampleEllipseAtLength(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dist: number,
): PathSample {
  const circ = ellipseCircumference(rx, ry);
  if (circ === 0) return { x: cx, y: cy, angle: 0 };
  const ratio = (dist % circ) / circ;
  const t = ratio * 2 * Math.PI;
  // point on ellipse
  const x = cx + rx * Math.cos(t);
  const y = cy + ry * Math.sin(t);
  // tangent via derivative
  const dx = -rx * Math.sin(t);
  const dy = ry * Math.cos(t);
  return { x, y, angle: Math.atan2(dy, dx) };
}

// ── Rect (perimeter walk) ──────────────────────────────────────────────

function sampleRectAtLength(x: number, y: number, w: number, h: number, dist: number): PathSample {
  const perim = 2 * (w + h);
  if (perim === 0) return { x, y, angle: 0 };
  const d = dist % perim;

  const segments: Array<{ start: [number, number]; end: [number, number]; length: number }> = [
    { start: [x, y], end: [x + w, y], length: w },
    { start: [x + w, y], end: [x + w, y + h], length: h },
    { start: [x + w, y + h], end: [x, y + h], length: w },
    { start: [x, y + h], end: [x, y], length: h },
  ];

  let accumulated = 0;
  for (const seg of segments) {
    if (d <= accumulated + seg.length) {
      const t = (d - accumulated) / seg.length;
      const px = seg.start[0] + t * (seg.end[0] - seg.start[0]);
      const py = seg.start[1] + t * (seg.end[1] - seg.start[1]);
      const angle = Math.atan2(seg.end[1] - seg.start[1], seg.end[0] - seg.start[0]);
      return { x: px, y: py, angle };
    }
    accumulated += seg.length;
  }

  return { x, y, angle: 0 };
}

// ── Line / Arrow ───────────────────────────────────────────────────────

function sampleLineAtLength(
  from: readonly [number, number],
  to: readonly [number, number],
  dist: number,
): PathSample {
  const len = pointDist2D(from, to);
  if (len === 0) return { x: from[0], y: from[1], angle: 0 };
  const t = Math.min(1, dist / len);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return {
    x: from[0] + t * (to[0] - from[0]),
    y: from[1] + t * (to[1] - from[1]),
    angle,
  };
}

// ── Polygon ────────────────────────────────────────────────────────────

function polygonVertices(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): Array<[number, number]> {
  const verts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
    verts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return verts;
}

function polygonPerimeter(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): number {
  const verts = polygonVertices(cx, cy, radius, sides, rotation);
  let perim = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    perim += pointDist2D(verts[i]!, verts[j]!);
  }
  return perim;
}

function samplePolygonAtLength(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
  dist: number,
): PathSample {
  const verts = polygonVertices(cx, cy, radius, sides, rotation);
  const perim = polygonPerimeter(cx, cy, radius, sides, rotation);
  if (perim === 0) return { x: cx, y: cy, angle: 0 };
  return sampleClosedSegmentChain(verts, dist % perim);
}

// ── Star ───────────────────────────────────────────────────────────────

function starVertices(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  points: number,
  rotation: number,
): Array<[number, number]> {
  const verts: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
    const r = i % 2 === 0 ? outerR : innerR;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return verts;
}

function starPerimeter(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  points: number,
  rotation: number,
): number {
  const verts = starVertices(cx, cy, innerR, outerR, points, rotation);
  let perim = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    perim += pointDist2D(verts[i]!, verts[j]!);
  }
  return perim;
}

function sampleStarAtLength(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  points: number,
  rotation: number,
  dist: number,
): PathSample {
  const verts = starVertices(cx, cy, innerR, outerR, points, rotation);
  const perim = starPerimeter(cx, cy, innerR, outerR, points, rotation);
  if (perim === 0) return { x: cx, y: cy, angle: 0 };
  return sampleClosedSegmentChain(verts, dist % perim);
}

// ── Generic closed segment chain ───────────────────────────────────────

function sampleClosedSegmentChain(verts: Array<[number, number]>, dist: number): PathSample {
  let accumulated = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const vi = verts[i]!;
    const vj = verts[j]!;
    const segLen = pointDist2D(vi, vj);
    if (dist <= accumulated + segLen || i === n - 1) {
      const t = segLen > 0 ? (dist - accumulated) / segLen : 0;
      const px = vi[0] + t * (vj[0] - vi[0]);
      const py = vi[1] + t * (vj[1] - vi[1]);
      const angle = Math.atan2(vj[1] - vi[1], vj[0] - vi[0]);
      return { x: px, y: py, angle };
    }
    accumulated += segLen;
  }
  const v0 = verts[0]!;
  return { x: v0[0], y: v0[1], angle: 0 };
}

// ── Path (bezier segments) ─────────────────────────────────────────────

function pathSegments(pts: PathPoint[], closed: boolean): CubicBezier[] {
  if (pts.length < 2) return [];
  const segs: CubicBezier[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push(pathPointToBezier(pts[i]!, pts[i + 1]!));
  }
  if (closed && pts.length > 2) {
    segs.push(pathPointToBezier(pts[pts.length - 1]!, pts[0]!));
  }
  return segs;
}

import type { CubicBezier } from './bezier';

function pathPointsLength(pts: PathPoint[], closed: boolean): number {
  const segs = pathSegments(pts, closed);
  let total = 0;
  for (const seg of segs) {
    total += cubicBezierLength(seg);
  }
  return total;
}

function samplePathPointsAtLength(pts: PathPoint[], closed: boolean, dist: number): PathSample {
  const segs = pathSegments(pts, closed);
  const totalLen = pathPointsLength(pts, closed);
  if (totalLen === 0 || segs.length === 0) {
    return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, angle: 0 };
  }

  const d = closed ? dist % totalLen : Math.min(dist, totalLen);
  let accumulated = 0;

  for (const seg of segs) {
    const segLen = cubicBezierLength(seg);
    if (d <= accumulated + segLen || seg === segs[segs.length - 1]) {
      const t = segLen > 0 ? (d - accumulated) / segLen : 1;
      const pt = cubicBezierPoint(seg, Math.min(1, Math.max(0, t)));
      const deriv = cubicBezierDerivative(seg, Math.min(1, Math.max(0, t)));
      const angle = Math.atan2(deriv.y, deriv.x);
      return { x: pt.x, y: pt.y, angle };
    }
    accumulated += segLen;
  }

  const lastSeg = segs[segs.length - 1]!;
  return { x: lastSeg.p3.x, y: lastSeg.p3.y, angle: 0 };
}
