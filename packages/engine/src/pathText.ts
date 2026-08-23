/**
 * Curved text / text-on-path math (Phase 5).
 *
 * Places glyphs along any of the 9 shape kinds by sampling position + tangent
 * angle at regular arc-length intervals. Bézier paths use a deterministic
 * cumulative arc-length lookup and de Casteljau point evaluation.
 *
 * Fast-path for circles: evenly-spaced angular sampling, no integration needed.
 *
 * Research basis: Figma "Text on a path", Illustrator Type on a Path,
 *                 W3C SVG textPath, HarfBuzz glyph positioning.
 */

import type { Affine } from '@varve/shared';
import {
  type CubicBezier,
  cubicBezierDerivative,
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

/** Options for placeGlyphsOnPath / placeClustersOnPath. */
export interface GlyphPlaceOptions {
  /** 0-1 offset along the path to start (default 0). */
  offset?: number;
  /**
   * 0-1 normalized end of the usable interval. When defined the text is
   * clipped to [offset, endOffset] (wrapping through the seam of closed
   * paths when endOffset < offset). Undefined means "to the end of the path".
   */
  endOffset?: number;
  /**
   * Which side of the curve the glyphs occupy. 'top' keeps the reading
   * direction of the path with ascenders pointing away from it; 'bottom'
   * rotates each glyph 180 degrees so text hangs on the other side and
   * reads upright relative to that side.
   */
  side?: 'top' | 'bottom';
  /**
   * Baseline shift in px along the glyph's own up direction. Positive
   * values increase clearance between the path and the baseline on
   * whichever side the glyphs are; negative values move them across it.
   * 0 places the alphabetic baseline exactly on the path.
   */
  baselineShift?: number;
  /** Rotate the placed clusters by 180° without changing their path side. */
  flip?: boolean;
  /** Font size in px (used for the legacy per-character advance estimate). */
  fontSize?: number;
  /**
   * Line height in px used to stack successive text lines on parallel
   * offset curves (multiline path text). Line 0 lies on the path itself;
   * line k is displaced by ±k·lineHeightPx along the local up normal
   * (sign follows `side`). Ignored for the first line.
   */
  lineHeightPx?: number;
  /**
   * Explicit fit-to-path: distribute inter-cluster tracking so each line
   * spans exactly the usable interval [offset, endOffset]. Glyph shapes are
   * never distorted; spacing absorbs the difference (negative when the text
   * is longer than the interval).
   */
  fitToInterval?: boolean;
}

/**
 * One shaped unit to place on the path: a grapheme/ligature cluster plus the
 * advance the shaper assigned to it. Clusters — never Unicode code points —
 * are the layout unit, so combining marks stay attached and ligatures stay
 * whole while they travel around the curve.
 */
export interface PathCluster {
  text: string;
  advance: number;
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
 *
 * Convenience wrapper over `makePathSampler` — placing a run of glyphs should
 * prefer the factory so per-call metric tables are reused across samples.
 */
export function samplePathAtLength(shape: Shape, distance: number): PathSample {
  return makePathSampler(shape)(distance);
}

/** Total arc length of a shape (for normalising offset). */
export function pathLength(shape: Shape): number {
  return makePathSampler(shape).totalLength;
}

/**
 * Place pre-shaped clusters along `shape`.
 *
 * Single-line convenience over `placeLinesOnPath`; see there for semantics.
 * Output is identical to placing one line directly (line 0 uses the exact
 * base sampler — no offset resampling).
 */
export function placeClustersOnPath(
  clusters: readonly PathCluster[],
  shape: Shape,
  options: GlyphPlaceOptions = {},
): GlyphPlacement[] {
  return placeLinesOnPath([clusters], shape, options);
}

/**
 * Place multiple lines of pre-shaped clusters on a path.
 *
 * Line 0 lies exactly on the path (baseline-on-curve). Each subsequent line
 * is laid on a parallel OFFSET curve displaced by ±k·lineHeightPx along the
 * local up normal — sign follows `side`, so lines always stack away from the
 * path on the side the glyphs occupy. Offset curves are approximated by a
 * chord LUT sampled from the base curve (~3px resolution), which correctly
 * compresses spacing where the offset curve is shorter (inside of bends)
 * and stretches it where longer.
 *
 * With `fitToInterval`, each line's inter-cluster spacing is adjusted so the
 * line spans its full usable interval; glyphs are never distorted.
 *
 * Returns placements flattened line-by-line in order.
 */
export function placeLinesOnPath(
  lines: readonly PathCluster[][],
  shape: Shape,
  options: GlyphPlaceOptions = {},
): GlyphPlacement[] {
  const nonEmpty = lines.filter((line) => line.length > 0);
  if (nonEmpty.length === 0) return [];

  const base = makePathSampler(shape);
  const totalLen = base.totalLength;
  if (!(totalLen > 0) || !Number.isFinite(totalLen)) return [];

  const startFraction = normalizeOffset(options.offset);
  const side = options.side ?? 'top';
  const flip = (side === 'bottom' ? Math.PI : 0) + (options.flip ? Math.PI : 0);
  const shift = Number.isFinite(options.baselineShift) ? options.baselineShift! : 0;
  const openEnded = !isClosedShape(shape);

  const endRaw = options.endOffset;
  const hasEnd = endRaw !== undefined && Number.isFinite(endRaw);
  const endFraction = hasEnd ? Math.max(0, Math.min(1, endRaw!)) : 1;

  // Blank paragraphs still consume a line slot.
  const lineCount = Math.max(1, lines.length);
  const lineHeightPx =
    Number.isFinite(options.lineHeightPx) && options.lineHeightPx! > 0
      ? options.lineHeightPx!
      : (options.fontSize ?? 16) * 1.4;
  const stackSign = side === 'bottom' ? -1 : 1;

  const placements: GlyphPlacement[] = [];
  let placedLineIndex = -1;

  for (let k = 0; k < lines.length; k++) {
    const clusters = lines[k]!;
    if (clusters.length === 0) continue;
    placedLineIndex += 1;

    // Ring offset for this line. Line 0 keeps the exact base sampler so
    // single-line output is bit-identical to the historical placement.
    const ringOffset = stackSign * placedLineIndex * lineHeightPx;
    const sample =
      placedLineIndex === 0 || ringOffset === 0
        ? base
        : makeOffsetSampler(base, totalLen, isClosedShape(shape), ringOffset);
    const lineLen = sample.totalLength;
    if (!(lineLen > 0) || !Number.isFinite(lineLen)) continue;

    const startDistance = startFraction * lineLen;
    const endDistance = endFraction * lineLen;
    const usableDistance = hasEnd
      ? openEnded
        ? Math.max(0, endDistance - startDistance)
        : closedIntervalLength(startDistance, endDistance, lineLen)
      : openEnded
        ? Math.max(0, lineLen - startDistance)
        : lineLen;

    // Fit-to-interval: uniform tracking delta between clusters so the line
    // spans exactly the usable interval. n===1 cannot stretch (no gaps).
    let extraTracking = 0;
    if (options.fitToInterval && clusters.length > 1) {
      let naturalWidth = 0;
      for (const c of clusters) naturalWidth += Math.max(0, c.advance);
      extraTracking = (usableDistance - naturalWidth) / (clusters.length - 1);
    }

    let cursorExtra = 0;
    for (const cluster of clusters) {
      if (cluster.text.length === 0 || !(cluster.advance >= 0)) continue;

      const relativeDistance = cursorExtra;
      const anchor = startDistance + cursorExtra;
      cursorExtra += cluster.advance + extraTracking;

      if (relativeDistance > usableDistance + CLIP_EPSILON) break;
      if (openEnded && anchor > lineLen + CLIP_EPSILON) break;

      const pt = sample(anchor);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.angle)) {
        continue;
      }

      // Shift along the glyph's own up direction, so positive values
      // increase clearance on whichever side the glyphs live.
      const upAngle = pt.angle - Math.PI / 2 + (side === 'bottom' ? Math.PI : 0);
      const px = pt.x + shift * Math.cos(upAngle);
      const py = pt.y + shift * Math.sin(upAngle);

      placements.push({
        char: cluster.text,
        x: px,
        y: py,
        angle: pt.angle + flip,
        advance: cluster.advance,
      });
    }
  }

  return placements;
}

/**
 * Build a sampler for a curve displaced by `offsetPx` along the local up
 * normal of `base`. Chord-LUT approximation: ~3px sampling resolution
 * (clamped), cumulative arc length over the displaced polyline, binary
 * search + linear interpolation for queries. Tangents come from local chord
 * direction, which stays stable through moderate curvature and never yields
 * NaN while at least two distinct samples exist.
 */
function makeOffsetSampler(
  base: PathSampler,
  totalLen: number,
  closed: boolean,
  offsetPx: number,
): PathSampler {
  const steps = Math.max(64, Math.min(1024, Math.round(totalLen / 3)));
  const xs = new Float64Array(steps + 1);
  const ys = new Float64Array(steps + 1);
  const cum = new Float64Array(steps + 1);

  let valid = 0;
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * totalLen;
    const s = base(d);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.angle)) {
      xs[i] = NaN;
      ys[i] = NaN;
      cum[i] = i > 0 ? cum[i - 1]! : 0;
      continue;
    }
    const upAngle = s.angle - Math.PI / 2;
    xs[i] = s.x + offsetPx * Math.cos(upAngle);
    ys[i] = s.y + offsetPx * Math.sin(upAngle);
    if (i > 0 && Number.isFinite(xs[i - 1]!)) {
      cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
    } else {
      cum[i] = i > 0 ? cum[i - 1]! : 0;
    }
    valid += 1;
  }

  const total = cum[steps]!;
  const fallback = withLength(() => base(0), total);

  if (valid < 2 || !(total > 0)) return fallback;

  const sampleAt = (distance: number): PathSample => {
    const d = closed ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance));
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi]! - cum[lo]!;
    const t = seg > 0 ? (d - cum[lo]!) / seg : 0;
    const x0 = xs[lo]!;
    const y0 = ys[lo]!;
    const x1 = xs[hi]!;
    const y1 = ys[hi]!;
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return base(0);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    if (!Number.isFinite(angle)) {
      const s = base(d);
      return { x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0), angle: s.angle };
    }
    return { x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0), angle };
  };

  return withLength(sampleAt, total);
}

const CLIP_EPSILON = 0.01;

function normalizeOffset(v: number | undefined): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v!)) : 0;
}

function isClosedShape(shape: Shape): boolean {
  switch (shape.kind) {
    case 'circle':
    case 'ellipse':
    case 'rect':
    case 'polygon':
    case 'star':
      return true;
    case 'path':
      return shape.closed;
    default:
      return false;
  }
}

/** Distance from start to end while walking forward around a closed path. */
function closedIntervalLength(start: number, end: number, totalLen: number): number {
  if (!(totalLen > 0)) return 0;
  return end >= start ? end - start : totalLen - start + end;
}

/**
 * Flatten shaped runs into a sequence of PathCluster entries suitable for
 * `placeClustersOnPath`. Handles BiDi visual ordering by iterating runs in
 * their visual order and, within each RTL run, reversing the glyph array so
 * the leftmost-glyph-first placement order is correct.
 *
 * Newlines are dropped (path text is single-line by policy) but source text
 * is preserved for editing/detach.
 */
export function flattenShapedRuns(
  runs: ReadonlyArray<import('./types').ShapedRun>,
  text: string,
): PathCluster[] {
  const out: PathCluster[] = [];
  for (const run of runs) {
    // `shapeRun` returns glyphs in logical order inside each BiDi run. The
    // runs themselves have already been visited in visual order, so reverse
    // only RTL runs before walking the path. Reversing the source string (or
    // the whole paragraph) would corrupt mixed-direction text and clusters.
    const glyphs = run.direction === 'rtl' ? [...run.glyphs].reverse() : run.glyphs;
    for (const glyph of glyphs) {
      const end = glyph.sourceEnd ?? glyph.clusterUtf16 + 1;
      const cluster = text.slice(glyph.clusterUtf16, end);
      if (cluster.length === 0) continue;
      // Skip newlines: they carry no arc length on a path.
      if (cluster === '\n' || cluster === '\r\n' || cluster === '\r') continue;
      // xOffset is a glyph-position adjustment, not advance. The browser
      // shaping bridge currently emits zero offsets; native shapers may emit
      // one later, and folding it into distance would double-count spacing.
      out.push({ text: cluster, advance: glyph.xAdvance });
    }
  }
  return out;
}

/**
 * Legacy character-level placement kept for direct callers and tests that
 * reason in raw characters. Production rendering goes through
 * `placeClustersOnPath` with clusters from the canonical shaper.
 */
export function placeGlyphsOnPath(
  text: string,
  shape: Shape,
  options: GlyphPlaceOptions = {},
): GlyphPlacement[] {
  if (text.length === 0) return [];

  const fs = options.fontSize ?? 16;
  const advance = fs * 0.6; // approximate char width (matches estimateCharWidth in textMeasure)
  const clusters: PathCluster[] = [];
  for (const ch of text) {
    // Control characters (newlines etc.) carry no arc length: path layout is
    // single-line by policy, but the source text is untouched for detach.
    if (ch < ' ') continue;
    clusters.push({ text: ch, advance });
  }
  return placeClustersOnPath(clusters, shape, options);
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
  if (!(circ > 0)) return { x: cx, y: cy, angle: 0 };
  const t = ((dist % circ) / circ) * 2 * Math.PI;
  return {
    x: cx + r * Math.cos(t - Math.PI / 2),
    y: cy + r * Math.sin(t - Math.PI / 2),
    angle: t,
  };
}

// ── Ellipse (approximate via parametric) ───────────────────────────────

/**
 * Arc length of one parametric ellipse interval via 4-point Gauss-Legendre.
 * Uniform-in-t steps are NOT uniform in distance on an ellipse, so mapping
 * distance to t needs this table rather than a linear ratio.
 */
function ellipseIntervalLength(rx: number, ry: number, t0: number, t1: number): number {
  const mid = (t0 + t1) / 2;
  const half = (t1 - t0) / 2;
  let sum = 0;
  for (let i = 0; i < GL4_X.length; i++) {
    const t = mid + half * GL4_X[i]!;
    const dx = -rx * Math.sin(t);
    const dy = ry * Math.cos(t);
    sum += GL4_W[i]! * Math.hypot(dx, dy);
  }
  return half * sum;
}

const GL4_X = [0.8611363115940526, 0.3399810435848563, -0.3399810435848563, -0.8611363115940526];
const GL4_W = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
const ELLIPSE_LUT_STEPS = 128;

interface EllipseLut {
  cum: Float64Array; // cumulative length at each parametric step (incl. 0 and total)
  total: number;
}

const ellipseLutCache = new Map<string, EllipseLut>();

function ellipseLut(rx: number, ry: number): EllipseLut | null {
  if (!(rx > 0) || !(ry > 0)) return null;
  const key = `${rx}|${ry}`;
  const cached = ellipseLutCache.get(key);
  if (cached) return cached;

  const cum = new Float64Array(ELLIPSE_LUT_STEPS + 1);
  for (let i = 0; i < ELLIPSE_LUT_STEPS; i++) {
    const t0 = (i / ELLIPSE_LUT_STEPS) * 2 * Math.PI;
    const t1 = ((i + 1) / ELLIPSE_LUT_STEPS) * 2 * Math.PI;
    cum[i + 1] = cum[i]! + ellipseIntervalLength(rx, ry, t0, t1);
  }
  const lut: EllipseLut = { cum, total: cum[ELLIPSE_LUT_STEPS]! };
  if (ellipseLutCache.size > 64) ellipseLutCache.clear();
  ellipseLutCache.set(key, lut);
  return lut;
}

function sampleEllipseAtLength(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dist: number,
): PathSample {
  const lut = ellipseLut(rx, ry);
  if (!lut || !(lut.total > 0)) return { x: cx, y: cy, angle: 0 };

  const d = ((dist % lut.total) + lut.total) % lut.total;

  // Binary search for the parametric interval containing d.
  let lo = 0;
  let hi = ELLIPSE_LUT_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lut.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }

  const segLen = lut.cum[hi]! - lut.cum[lo]!;
  const local = segLen > 0 ? (d - lut.cum[lo]!) / segLen : 0;
  const t = ((lo + local) / ELLIPSE_LUT_STEPS) * 2 * Math.PI;

  const x = cx + rx * Math.cos(t);
  const y = cy + ry * Math.sin(t);
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
    if (!(seg.length > 0)) continue;
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
  if (closed && pts.length > 1) {
    segs.push(pathPointToBezier(pts[pts.length - 1]!, pts[0]!));
  }
  return segs;
}

/** Pre-integrated metric table for one bezier chain, built once per call. */
interface PathMetric {
  segs: CubicBezier[];
  cum: number[]; // cumulative length before each segment
  lengths: number[];
  total: number;
}

function buildPathMetric(pts: PathPoint[], closed: boolean): PathMetric {
  const segs = pathSegments(pts, closed);
  const cum: number[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (const seg of segs) {
    cum.push(total);
    const length = buildCubicMetric(seg).total;
    lengths.push(length);
    total += length;
  }
  return { segs, cum, lengths, total };
}

/**
 * Sample factory: binds the expensive metric computation once so placing N
 * glyphs costs one integration pass, not N.
 */
export type PathSampler = ((distance: number) => PathSample) & { totalLength: number };

function withLength(sample: (distance: number) => PathSample, totalLength: number): PathSampler {
  return Object.assign(sample, { totalLength });
}

export function makePathSampler(shape: Shape): PathSampler {
  switch (shape.kind) {
    case 'circle': {
      const { cx, cy, r } = shape;
      const radius = Math.abs(r);
      return withLength((dist) => sampleCircleAtLength(cx, cy, radius, dist), 2 * Math.PI * radius);
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = shape;
      const xRadius = Math.abs(rx);
      const yRadius = Math.abs(ry);
      const lut = ellipseLut(xRadius, yRadius);
      return withLength(
        (dist) => sampleEllipseAtLength(cx, cy, xRadius, yRadius, dist),
        lut?.total ?? 0,
      );
    }
    case 'rect': {
      const { x, y, w, h } = shape;
      const width = Math.max(0, w);
      const height = Math.max(0, h);
      return withLength(
        (dist) => sampleRectAtLength(x, y, width, height, dist),
        2 * (width + height),
      );
    }
    case 'line':
      return makeLineSampler(shape.from, shape.to);
    case 'arrow':
      return makeLineSampler(shape.from, shape.to);
    case 'polygon': {
      const verts = polygonVertices(shape.cx, shape.cy, shape.radius, shape.sides, shape.rotation);
      const perim = chainPerimeter(verts);
      return withLength((dist) => {
        if (!(perim > 0)) return { x: shape.cx, y: shape.cy, angle: 0 };
        return sampleClosedSegmentChain(verts, ((dist % perim) + perim) % perim);
      }, perim);
    }
    case 'star': {
      const verts = starVertices(
        shape.cx,
        shape.cy,
        shape.innerRadius,
        shape.outerRadius,
        shape.points,
        shape.rotation,
      );
      const perim = chainPerimeter(verts);
      return withLength((dist) => {
        if (!(perim > 0)) return { x: shape.cx, y: shape.cy, angle: 0 };
        return sampleClosedSegmentChain(verts, ((dist % perim) + perim) % perim);
      }, perim);
    }
    case 'path': {
      const metric = buildPathMetric(shape.points, shape.closed);
      const closed = shape.closed;
      const fallback: PathSample = {
        x: shape.points[0]?.x ?? 0,
        y: shape.points[0]?.y ?? 0,
        angle: 0,
      };
      return withLength((dist) => {
        const { segs, cum, total } = metric;
        if (segs.length === 0 || !(total > 0)) return fallback;
        const d = closed ? ((dist % total) + total) % total : Math.min(dist, total);
        let lo = 0;
        let hi = segs.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (cum[mid]! <= d) lo = mid;
          else hi = mid - 1;
        }
        const segLen = metric.lengths[lo] ?? 0;
        const localDistance = Math.max(0, d - cum[lo]!);
        const t = segLen > 0 ? cubicParameterAtLength(segs[lo]!, localDistance, segLen) : 1;
        const pt = cubicBezierPoint(segs[lo]!, t);
        const deriv = cubicBezierDerivative(segs[lo]!, t);
        // Degenerate derivative at cusps/anchors: fall back to chord direction
        // so glyph orientation never becomes NaN or random.
        let angle = Math.atan2(deriv.y, deriv.x);
        if (Math.hypot(deriv.x, deriv.y) < 1e-9 || !Number.isFinite(angle)) {
          const a = segs[lo]!.p0;
          const b = segs[lo]!.p3;
          angle = Math.atan2(b.y - a.y, b.x - a.x);
        }
        return { x: pt.x, y: pt.y, angle };
      }, metric.total);
    }
    default:
      return withLength(() => ({ x: 0, y: 0, angle: 0 }), 0);
  }
}

function makeLineSampler(
  from: readonly [number, number],
  to: readonly [number, number],
): PathSampler {
  const len = pointDist2D(from, to);
  const angle = len > 0 ? Math.atan2(to[1] - from[1], to[0] - from[0]) : 0;
  return withLength((dist) => {
    if (len === 0) return { x: from[0], y: from[1], angle: 0 };
    const t = Math.min(1, dist / len);
    return {
      x: from[0] + t * (to[0] - from[0]),
      y: from[1] + t * (to[1] - from[1]),
      angle,
    };
  }, len);
}

function chainPerimeter(verts: Array<[number, number]>): number {
  let perim = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    perim += pointDist2D(verts[i]!, verts[j]!);
  }
  return perim;
}

interface CubicMetric {
  ts: Float64Array;
  cum: Float64Array;
  total: number;
}

/**
 * Build a monotone arc-length lookup for a cubic. Uniform parameter `t` is
 * not uniform distance; this table keeps tight and asymmetric curves from
 * bunching glyphs while avoiding integration once per glyph during replay.
 */
const CUBIC_LUT_STEPS = 128;
const cubicMetricCache = new WeakMap<object, CubicMetric>();

function buildCubicMetric(cb: CubicBezier): CubicMetric {
  const cached = cubicMetricCache.get(cb);
  if (cached) return cached;

  const ts = new Float64Array(CUBIC_LUT_STEPS + 1);
  const cum = new Float64Array(CUBIC_LUT_STEPS + 1);
  let previous = cb.p0;
  for (let i = 1; i <= CUBIC_LUT_STEPS; i += 1) {
    const t = i / CUBIC_LUT_STEPS;
    const point = cubicBezierPoint(cb, t);
    ts[i] = t;
    cum[i] = cum[i - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }

  const metric = { ts, cum, total: cum[CUBIC_LUT_STEPS]! };
  cubicMetricCache.set(cb, metric);
  return metric;
}

function cubicParameterAtLength(cb: CubicBezier, distance: number, total: number): number {
  if (!(total > 0)) return 0;
  const metric = buildCubicMetric(cb);
  const d = Math.max(0, Math.min(total, distance));
  let lo = 0;
  let hi = CUBIC_LUT_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (metric.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = metric.cum[hi]! - metric.cum[lo]!;
  const ratio = span > 0 ? (d - metric.cum[lo]!) / span : 0;
  return metric.ts[lo]! + (metric.ts[hi]! - metric.ts[lo]!) * ratio;
}
