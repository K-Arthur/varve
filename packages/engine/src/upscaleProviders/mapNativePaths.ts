import type { RasterTracePath, RasterTraceResult } from '../rasterTrace';

interface NativeBezierPoint {
  x: number;
  y: number;
  handle_in?: [number, number] | null;
  handle_out?: [number, number] | null;
}

interface NativeBezierPath {
  points: NativeBezierPoint[];
  closed: boolean;
  fill?: { r: number; g: number; b: number; a: number } | null;
  holes?: NativeBezierPoint[][];
}

function mapNativePoint(point: NativeBezierPoint): RasterTracePath['points'][number] {
  return {
    x: point.x,
    y: point.y,
    ...(point.handle_in ? { handleIn: point.handle_in } : {}),
    ...(point.handle_out ? { handleOut: point.handle_out } : {}),
  };
}

export function mapNativePathsToTraceResult(
  width: number,
  height: number,
  paths: NativeBezierPath[],
  omittedHoles = 0,
  centerlineWidth?: number,
): RasterTraceResult {
  const mapped = paths
    .filter((p) => p.points.length >= 2)
    .map((path) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of path.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const holes = (path.holes ?? []).map((ring) => ring.map(mapNativePoint));
      return {
        points: path.points.map(mapNativePoint),
        closed: path.closed,
        area: w * h,
        bounds: { x: minX, y: minY, w, h },
        curveFitted: true,
        ...(holes.length > 0 ? { holes } : {}),
        ...(path.fill
          ? { fill: { r: path.fill.r, g: path.fill.g, b: path.fill.b, a: path.fill.a } }
          : {}),
        ...(centerlineWidth !== undefined ? { strokeWidth: centerlineWidth } : {}),
      } satisfies RasterTracePath;
    });
  return {
    width,
    height,
    paths: mapped,
    omittedHoles,
  };
}
