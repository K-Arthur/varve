import type { RasterTraceResult } from '../rasterTrace';

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
}

export function mapNativePathsToTraceResult(
  width: number,
  height: number,
  paths: NativeBezierPath[],
): RasterTraceResult {
  const mapped = paths
    .filter((p) => p.points.length >= 3)
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
      return {
        points: path.points.map((p) => ({ x: p.x, y: p.y })),
        closed: true as const,
        area: w * h,
        bounds: { x: minX, y: minY, w, h },
        ...(path.fill
          ? { fill: { r: path.fill.r, g: path.fill.g, b: path.fill.b, a: path.fill.a } }
          : {}),
      };
    });
  return {
    width,
    height,
    paths: mapped,
    omittedHoles: 0,
  };
}
