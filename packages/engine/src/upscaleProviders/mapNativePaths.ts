import type { RasterTraceResult } from '../rasterTrace';

export function mapNativePathsToTraceResult(
  width: number,
  height: number,
  paths: Array<{ points: Array<{ x: number; y: number }>; closed: boolean }>,
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
      };
    });
  return {
    width,
    height,
    paths: mapped,
    omittedHoles: 0,
  };
}
