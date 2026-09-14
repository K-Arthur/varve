/**
 * Display geometry for the vectorization preview.
 *
 * The preview must show the same curves that insertion will commit. Insertion
 * (`insertTraceGroup`) fits cubics with `fitBezierToContour` unless a provider
 * already returned fitted handles. This module is the single preview-side
 * mirror of that decision, plus a canvas tracer whose segment semantics match
 * the renderer's `tracePathRing` (handles are offsets from their anchor; open
 * paths are not closed).
 *
 * Pure: no DOM, no canvas access outside the `ctx` argument, so the command
 * stream is unit-testable with a recording context.
 */

import {
  fitBezierToContour,
  type PathPoint,
  type RasterTracePath,
  type RasterTraceResult,
} from '@varve/engine';

/** A path prepared for preview drawing (source-pixel coordinates). */
export interface DisplayPath {
  points: PathPoint[];
  holes?: PathPoint[][];
  closed: boolean;
  fill?: { r: number; g: number; b: number; a: number };
  strokeWidth?: number;
  /** Centerline output is stroked, never filled, even when the loop closes. */
  stroked: boolean;
}

export interface DisplayPathOptions {
  cornerAngle: number;
  maxError: number;
}

function toPathPoints(points: RasterTracePath['points']): PathPoint[] {
  return points.map((point) => ({
    x: point.x,
    y: point.y,
    handleIn: point.handleIn ?? null,
    handleOut: point.handleOut ?? null,
  }));
}

function fitRing(
  ring: RasterTracePath['points'],
  closed: boolean,
  options: DisplayPathOptions,
): PathPoint[] {
  return fitBezierToContour(ring, closed, {
    cornerAngle: options.cornerAngle,
    maxError: options.maxError,
  });
}

/**
 * Build the preview geometry for a trace result.
 *
 * Providers with `curveFitted` handles are passed through unchanged (no second
 * fit, matching insertion). Provider polylines are fitted exactly like
 * insertion at the preview resolution, so preview and document agree on the
 * curve model even though their raster resolutions differ.
 */
export function buildDisplayPaths(
  result: RasterTraceResult,
  options: DisplayPathOptions,
): DisplayPath[] {
  return result.paths.map((path) => {
    const points = path.curveFitted
      ? toPathPoints(path.points)
      : fitRing(path.points, path.closed, options);
    const holes = path.holes?.map((hole) =>
      path.curveFitted ? toPathPoints(hole) : fitRing(hole, true, options),
    );
    return {
      points,
      ...(holes && holes.length > 0 ? { holes } : {}),
      closed: path.closed,
      ...(path.fill ? { fill: { ...path.fill } } : {}),
      ...(path.strokeWidth !== undefined ? { strokeWidth: path.strokeWidth } : {}),
      stroked: path.strokeWidth !== undefined,
    };
  });
}

/** Minimal canvas surface needed to trace display paths. */
export interface TracePathTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Trace one ring. Mirrors engine `tracePathRing`: a segment is a cubic only
 * when either endpoint declares a handle, and open rings are never closed.
 */
export function traceDisplayRing(
  ctx: TracePathTarget,
  ring: readonly PathPoint[],
  closed: boolean,
): void {
  const first = ring[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i];
    const previous = ring[i - 1];
    if (!point || !previous) continue;
    if (previous.handleOut || point.handleIn) {
      const cp1x = previous.handleOut ? previous.x + previous.handleOut[0] : previous.x;
      const cp1y = previous.handleOut ? previous.y + previous.handleOut[1] : previous.y;
      const cp2x = point.handleIn ? point.x + point.handleIn[0] : point.x;
      const cp2y = point.handleIn ? point.y + point.handleIn[1] : point.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  if (closed && ring.length > 1) {
    const last = ring[ring.length - 1];
    if (last && (last.handleOut || first.handleIn)) {
      const cp1x = last.handleOut ? last.x + last.handleOut[0] : last.x;
      const cp1y = last.handleOut ? last.y + last.handleOut[1] : last.y;
      const cp2x = first.handleIn ? first.x + first.handleIn[0] : first.x;
      const cp2y = first.handleIn ? first.y + first.handleIn[1] : first.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
    }
    ctx.closePath();
  }
}

/** Trace every subpath of a display path into the current canvas path. */
export function traceDisplayPath(ctx: TracePathTarget, path: DisplayPath): void {
  traceDisplayRing(ctx, path.points, path.closed);
  for (const hole of path.holes ?? []) {
    traceDisplayRing(ctx, hole, true);
  }
}

/** The color committed for centerline strokes (`makeTraceChildNode`). */
export const CENTERLINE_STROKE_RGB = 'rgb(0, 0, 0)';

/** The fill color committed for monochrome silhouettes. */
export const MONOCHROME_FILL_RGB = 'rgb(0, 0, 0)';

/** Resolve the paint a display path will commit with. */
export function displayPathPaint(path: DisplayPath): {
  kind: 'stroke' | 'fill';
  style: string;
} {
  if (path.stroked) return { kind: 'stroke', style: CENTERLINE_STROKE_RGB };
  const fill = path.fill ?? { r: 0, g: 0, b: 0, a: 255 };
  return { kind: 'fill', style: `rgba(${fill.r}, ${fill.g}, ${fill.b}, ${fill.a / 255})` };
}
