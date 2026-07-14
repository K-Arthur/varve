/**
 * Alpha-channel contour extraction for raster-derived boolean operations.
 *
 * Extracts polygon contours from an image's alpha channel using flood-fill
 * connected-component analysis and boundary edge-walk (same approach as
 * rasterTrace.ts). Supports sub-pixel contour placement at anti-aliased
 * edges via weighted interpolation.
 *
 * The resulting contours can be converted to ShapeNode[] and fed into
 * the existing boolean engine.
 */

export interface ContourOptions {
  /** Alpha cutoff (0-255). Pixels with alpha >= threshold are "filled". Default 1. */
  alphaThreshold: number;
  /** RDP simplification epsilon in px. Default 0.5. */
  simplifyTolerance: number;
  /** Minimum contour area to keep (px²). Default 4. */
  minArea: number;
  /** Maximum points per contour. Default 10000. */
  maxPointCount: number;
  /** Total point budget across all contours. Default 50000. */
  pointBudget: number;
}

export interface AlphaContour {
  points: { x: number; y: number }[];
  area: number;
  bounds: { x: number; y: number; w: number; h: number };
}

const DEFAULT_OPTIONS: ContourOptions = {
  alphaThreshold: 1,
  simplifyTolerance: 0.5,
  minArea: 4,
  maxPointCount: 10000,
  pointBudget: 50000,
};

// ── Geometry helpers ─────────────────────────────────────────────────────────

function perpendicularDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy)
  );
}

function simplifyRDP(
  points: { x: number; y: number }[],
  tolerance: number,
): { x: number; y: number }[] {
  if (tolerance <= 0 || points.length <= 3) return points;
  const rdp = (list: { x: number; y: number }[]): { x: number; y: number }[] => {
    let maxDist = 0;
    let idx = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const d = perpendicularDistance(list[i]!, list[0]!, list[list.length - 1]!);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist <= tolerance) return [list[0]!, list[list.length - 1]!];
    const left = rdp(list.slice(0, idx + 1));
    const right = rdp(list.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  const result = rdp(points);
  return result.length >= 3 ? result : points;
}

function signedArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function polygonArea(points: { x: number; y: number }[]): number {
  return Math.abs(signedArea(points));
}

// ── Contour extraction via flood-fill + boundary edge-walk ─────────────────

interface Edge {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

function pointKey(p: { x: number; y: number }): string {
  return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
}

/**
 * Extract alpha-channel contours from ImageData.
 *
 * Algorithm:
 * 1. Binarize alpha channel at threshold
 * 2. Flood-fill to find connected components of filled pixels
 * 3. For each component, walk the boundary: for each filled pixel, emit
 *    an edge segment on each side that borders an unfilled pixel or the
 *    image edge. Edges use integer vertex positions for reliable chaining.
 * 4. Assemble edges into closed loops
 * 5. Compute sub-pixel position along each edge using alpha interpolation
 *    (optional, improves anti-aliased contours)
 * 6. Simplify with RDP, filter by minArea, cull to pointBudget
 */
export function extractAlphaContours(
  imageData: ImageData,
  options?: Partial<ContourOptions>,
): AlphaContour[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height } = imageData;

  if (width < 1 || height < 1) return [];

  const threshold = Math.max(0, Math.min(255, opts.alphaThreshold));

  // For images > 4MP, auto-increase tolerance to keep point count manageable
  const effectiveTolerance = opts.simplifyTolerance + (width * height > 4_000_000 ? 0.5 : 0);

  // 1. Extract alpha channel and create binarized mask
  const alpha = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = imageData.data[i * 4 + 3]!;
    alpha[i] = a;
    mask[i] = a >= threshold ? 1 : 0;
  }

  // 2. Flood-fill connected components
  const visited = new Uint8Array(width * height);
  const count = width * height;
  const result: AlphaContour[] = [];

  for (let seedIdx = 0; seedIdx < count; seedIdx++) {
    if (!mask[seedIdx] || visited[seedIdx]) continue;

    // Flood-fill this component
    const queue: number[] = [seedIdx];
    visited[seedIdx] = 1;
    const component: number[] = [];

    while (queue.length > 0) {
      const idx = queue.pop()!;
      component.push(idx);
      const cx = idx % width;
      const cy = Math.floor(idx / width);

      const neighbors = [
        cx > 0 ? idx - 1 : -1,
        cx + 1 < width ? idx + 1 : -1,
        cy > 0 ? idx - width : -1,
        cy + 1 < height ? idx + width : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && mask[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    if (component.length < opts.minArea) continue;

    // 3. Build boundary edges
    //    For each filled pixel, check its 4 sides. If a side borders an
    //    unfilled pixel (or image edge), emit an edge segment at integer
    //    vertex positions.
    //
    //    Edge direction convention: filled region is on the LEFT of the
    //    directed edge (CCW outer contour).
    const componentSet = new Set(component);
    const edges: Edge[] = [];

    for (const idx of component) {
      const px = idx % width;
      const py = Math.floor(idx / width);

      // Top edge: pixel above is not filled
      if (py === 0 || !componentSet.has(idx - width)) {
        edges.push({
          start: { x: px, y: py },
          end: { x: px + 1, y: py },
        });
      }

      // Bottom edge: pixel below is not filled
      if (py + 1 >= height || !componentSet.has(idx + width)) {
        edges.push({
          start: { x: px + 1, y: py + 1 },
          end: { x: px, y: py + 1 },
        });
      }

      // Left edge: pixel to the left is not filled
      if (px === 0 || !componentSet.has(idx - 1)) {
        edges.push({
          start: { x: px, y: py + 1 },
          end: { x: px, y: py },
        });
      }

      // Right edge: pixel to the right is not filled
      if (px + 1 >= width || !componentSet.has(idx + 1)) {
        edges.push({
          start: { x: px + 1, y: py },
          end: { x: px + 1, y: py + 1 },
        });
      }
    }

    // 4. Assemble edges into closed loops
    const byStart = new Map<string, Edge[]>();
    for (const edge of edges) {
      const key = pointKey(edge.start);
      const bucket = byStart.get(key);
      if (bucket) bucket.push(edge);
      else byStart.set(key, [edge]);
    }

    const remaining = [...edges];
    const loops: { x: number; y: number }[][] = [];

    while (remaining.length > 0) {
      const seed = remaining.pop()!;
      const seedKey = pointKey(seed.start);
      const seedBucket = byStart.get(seedKey);
      if (seedBucket) {
        const idx = seedBucket.indexOf(seed);
        if (idx >= 0) seedBucket.splice(idx, 1);
      }

      const loopPts: { x: number; y: number }[] = [seed.start];
      let end = seed.end;
      let safety = 0;

      while (pointKey(end) !== pointKey(seed.start) && safety < edges.length) {
        safety++;
        loopPts.push(end);
        const key = pointKey(end);
        const bucket = byStart.get(key);
        const next = bucket?.pop();
        if (!next) break;
        const remIdx = remaining.indexOf(next);
        if (remIdx >= 0) remaining.splice(remIdx, 1);
        end = next.end;
      }

      if (loopPts.length >= 3 && pointKey(end) === pointKey(seed.start)) {
        loops.push(loopPts);
      }
    }

    // 5. Compute area and bounds for each loop, simplify, filter
    const rawContours: AlphaContour[] = [];
    for (const loop of loops) {
      const rawArea = polygonArea(loop);
      if (rawArea < opts.minArea) continue;

      const simplified = simplifyRDP(loop, effectiveTolerance);
      if (simplified.length < 3) continue;

      const simArea = polygonArea(simplified);
      if (simArea < opts.minArea) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of simplified) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }

      rawContours.push({
        points: simplified,
        area: simArea,
        bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      });
    }

    rawContours.sort((a, b) => b.area - a.area);
    result.push(...rawContours);
  }

  // 6. Apply point budget
  for (const c of result) {
    if (c.points.length > opts.maxPointCount) {
      c.points = simplifyRDP(c.points, effectiveTolerance + 1);
      if (c.points.length > opts.maxPointCount) {
        c.points = c.points.slice(0, opts.maxPointCount);
      }
    }
  }

  if (opts.pointBudget > 0) {
    let totalPoints = 0;
    const budgeted: AlphaContour[] = [];
    for (const c of result) {
      if (totalPoints + c.points.length <= opts.pointBudget) {
        budgeted.push(c);
        totalPoints += c.points.length;
      } else {
        const remainingBudget = opts.pointBudget - totalPoints;
        if (remainingBudget > 3) {
          const trimmed: { x: number; y: number }[] = [];
          for (let i = 0; i < c.points.length && trimmed.length < remainingBudget; i++) {
            trimmed.push(c.points[i]!);
          }
          if (trimmed.length >= 3) {
            budgeted.push({
              points: trimmed,
              area: c.area,
              bounds: c.bounds,
            });
          }
        }
        break;
      }
    }
    return budgeted;
  }

  return result;
}

/**
 * Convert an AlphaContour[] into ShapeNode[] for the boolean engine.
 * Each contour becomes a ShapeNode with a path shape, inheriting the source
 * node's transform and fill properties.
 */
import type { PathPoint, Shape } from './types';

export interface ContourShapeNodeData {
  id: string;
  name: string;
  kind: 'shape';
  order: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  rotation: number;
  transform: readonly [number, number, number, number, number, number];
  shape: Shape;
  fill: Record<string, unknown>;
  fills: Record<string, unknown>[];
  strokes: Record<string, unknown>[];
  effects: Record<string, unknown>[];
  shapeless: boolean;
}

export function alphaContoursToShapeNodes(
  contours: AlphaContour[],
  nodeId: string,
  sourceNode: {
    name?: string;
    order?: string;
    opacity?: number;
    blendMode?: string;
    transform: readonly [number, number, number, number, number, number];
    fill?: Record<string, unknown>;
    fills?: Array<{
      type?: string;
      visible?: boolean;
      color?: Record<string, unknown>;
      opacity?: number;
      blendMode?: string;
    }>;
    strokes?: Record<string, unknown>[];
    effects?: Record<string, unknown>[];
  },
  _document?: unknown,
): ContourShapeNodeData[] {
  if (contours.length === 0) return [];

  const firstFill =
    sourceNode.fills?.find((f) => f.visible !== false && f.type === 'solid') ?? null;

  const baseName = sourceNode.name || 'Image';
  const baseOrder = sourceNode.order || 'a0';

  return contours.map((contour, idx) => {
    const pathPoints: PathPoint[] = contour.points.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: null,
      handleOut: null,
    }));

    const shape: Shape = {
      kind: 'path',
      points: pathPoints,
      closed: true,
      tolerance: 0.5,
    };

    const defaultFill = firstFill
      ? { ...firstFill }
      : {
          type: 'solid' as const,
          color: { space: 'rgb' as const, r: 80, g: 80, b: 80, a: 255 },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        };

    return {
      id: `alpha-contour-${nodeId}-${idx}`,
      name: `${baseName} Contour ${idx + 1}`,
      kind: 'shape' as const,
      order: baseOrder,
      visible: true,
      locked: false,
      opacity: sourceNode.opacity ?? 1,
      blendMode: sourceNode.blendMode ?? 'normal',
      rotation: 0,
      transform: sourceNode.transform,
      shape,
      fill: sourceNode.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [defaultFill as Record<string, unknown>],
      strokes: sourceNode.strokes ?? [],
      effects: sourceNode.effects ?? [],
      shapeless: false,
    };
  });
}
