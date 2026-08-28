/**
 * Incremental, causal reconstruction of a brush centreline.
 *
 * Pointer samples describe observations, not the finished stroke path. This
 * module holds one sample of look-ahead, then emits the previous segment as a
 * centripetal Catmull–Rom curve. The short delay avoids an offline fit while
 * providing a continuous tangent through sparse, fast curves. It is pure and
 * stateful only per stroke, so worker, synchronous fallback and replay all
 * consume exactly the same stream.
 */

import { catmullRomPoint, interpolatePoints, type StrokePoint } from './brush';

const MIN_CHORD_LENGTH = 0.25;
const MAX_CHORD_LENGTH = 1;
const MAX_SUBDIVISIONS = 2048;
const TANGENT_EPSILON = 1 / 1024;

export interface StrokeReconstructionOptions {
  /** Maximum polyline chord used to approximate a curve, in layer pixels. */
  maxChordLength?: number;
}

/**
 * Build a segment from p1 to p2. Geometry comes from the spline; pressure,
 * tilt, time and other dynamics are sampled at the same parameter value.
 * The first point is deliberately excluded because the previous segment (or
 * the initial tap) already emitted it.
 */
export function reconstructCentripetalSegment(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
  options: StrokeReconstructionOptions = {},
): StrokePoint[] {
  const maxChordLength = clampChordLength(options.maxChordLength);
  const subdivisions = Math.min(
    MAX_SUBDIVISIONS,
    Math.max(1, Math.ceil(estimateCurveLength(p0, p1, p2, p3) / maxChordLength)),
  );
  const result: StrokePoint[] = [];

  for (let index = 1; index <= subdivisions; index++) {
    const t = index / subdivisions;
    const position = catmullRomPoint(p0, p1, p2, p3, t);
    const sample = interpolatePoints(p1, p2, t);
    sample.x = position.x;
    sample.y = position.y;
    const tangent = curveTangent(p0, p1, p2, p3, t);
    if (tangent.x !== 0 || tangent.y !== 0) sample.direction = Math.atan2(tangent.y, tangent.x);
    result.push(sample);
  }

  return result;
}

/**
 * Causal, one-look-ahead stream reconstruction.
 *
 * `append` returns the initial sample immediately so taps have no delay. Once
 * a third sample arrives it emits the preceding curve segment. `finish`
 * constructs a deterministic forward ghost and emits the withheld tail.
 */
export class CausalStrokeReconstructor {
  private pending: StrokePoint[] = [];
  private beforePending: StrokePoint | null = null;

  constructor(private readonly options: StrokeReconstructionOptions = {}) {}

  append(point: StrokePoint): StrokePoint[] {
    this.pending.push(point);
    if (this.pending.length === 1) return [point];
    if (this.pending.length < 3) return [];

    const [start, end, lookAhead] = this.pending as [StrokePoint, StrokePoint, StrokePoint];
    const before = this.beforePending ?? extrapolateBefore(start, end);
    const result = reconstructCentripetalSegment(before, start, end, lookAhead, this.options);
    this.beforePending = start;
    this.pending.shift();
    return result;
  }

  finish(): StrokePoint[] {
    const output: StrokePoint[] = [];
    while (this.pending.length >= 2) {
      const [start, end] = this.pending as [StrokePoint, StrokePoint];
      const before = this.beforePending ?? extrapolateBefore(start, end);
      output.push(
        ...reconstructCentripetalSegment(
          before,
          start,
          end,
          extrapolateAfter(start, end),
          this.options,
        ),
      );
      this.beforePending = start;
      this.pending.shift();
    }
    return output;
  }

  /**
   * Fork this causal stream for replaceable predicted input.
   *
   * The pending look-ahead points are part of the stroke's geometry, so a
   * prediction must copy them rather than reusing the mutable instance that
   * owns confirmed input.
   */
  clone(): CausalStrokeReconstructor {
    const clone = new CausalStrokeReconstructor({ ...this.options });
    clone.pending = this.pending.map((point) => ({ ...point }));
    clone.beforePending = this.beforePending ? { ...this.beforePending } : null;
    return clone;
  }
}

/** Resolution scaled to the base spacing but bounded for tiny and large tips. */
export function reconstructionChordLength(radius: number, spacing: number): number {
  const spacingPx = Math.max(0.01, radius * 2 * spacing);
  return clampChordLength(spacingPx * 0.25);
}

function clampChordLength(value: number | undefined): number {
  if (!Number.isFinite(value)) return MAX_CHORD_LENGTH;
  return Math.max(MIN_CHORD_LENGTH, Math.min(MAX_CHORD_LENGTH, value as number));
}

function extrapolateBefore(start: StrokePoint, end: StrokePoint): StrokePoint {
  return { ...start, x: start.x * 2 - end.x, y: start.y * 2 - end.y };
}

function extrapolateAfter(start: StrokePoint, end: StrokePoint): StrokePoint {
  return { ...end, x: end.x * 2 - start.x, y: end.y * 2 - start.y };
}

function estimateCurveLength(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
): number {
  const samples = 8;
  let previous = catmullRomPoint(p0, p1, p2, p3, 0);
  let length = 0;
  for (let index = 1; index <= samples; index++) {
    const point = catmullRomPoint(p0, p1, p2, p3, index / samples);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function curveTangent(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
  t: number,
): { x: number; y: number } {
  const from = catmullRomPoint(p0, p1, p2, p3, Math.max(0, t - TANGENT_EPSILON));
  const to = catmullRomPoint(p0, p1, p2, p3, Math.min(1, t + TANGENT_EPSILON));
  return { x: to.x - from.x, y: to.y - from.y };
}
