/**
 * Deterministic raster-to-vector contour tracing (monochrome + color/grayscale).
 *
 * Research basis: Potrace-style binary segmentation followed by boundary
 * extraction and Ramer-Douglas-Peucker simplification. Color mode uses
 * median-cut quantization then per-palette-mask contouring (vtracer-class
 * workflow without GPL Potrace).
 */

import { linearSrgbToOklab, srgbToLinear } from '@varve/shared';

export interface RasterTracePoint {
  x: number;
  y: number;
  /** Cubic handle offset from this anchor in source-pixel coordinates. */
  handleIn?: [number, number];
  /** Cubic handle offset from this anchor in source-pixel coordinates. */
  handleOut?: [number, number];
}

export interface RasterTraceFill {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RasterTracePath {
  points: RasterTracePoint[];
  /** Hole rings (CW) for evenodd compound fill. */
  holes?: RasterTracePoint[][];
  closed: boolean;
  area: number;
  bounds: { x: number; y: number; w: number; h: number };
  /** Solid fill for color/grayscale/pixel-art traces; monochrome defaults to black. */
  fill?: RasterTraceFill;
  /** Stroke width in source pixels for centerline mode (open paths). */
  strokeWidth?: number;
  /**
   * True when a provider already fitted cubic handles. Insertion must retain
   * those curves rather than fitting the same contour a second time.
   */
  curveFitted?: boolean;
}

export type RasterTraceMode = 'monochrome' | 'grayscale' | 'color' | 'pixel-art';

export interface RasterTraceOptions {
  threshold?: number;
  foreground?: 'dark' | 'light';
  alphaThreshold?: number;
  minArea?: number;
  simplifyTolerance?: number;
  maxPaths?: number;
  /** When true (default), attach CW loops as holes on the outer path. */
  compoundHoles?: boolean;
  /** Trace mode. Defaults to monochrome. */
  mode?: RasterTraceMode;
  /** Palette size for color/grayscale modes (2–32). Default 8 color / 4 grayscale. */
  maxColors?: number;
  /** Interior angle threshold for sharp corners (degrees, 90-180). Default 135. */
  cornerAngle?: number;
  /** Maximum Bezier fitting error in source pixels (0.01-10). Default 1.0. */
  maxError?: number;
  /** Stage progress (0-1); only providers that can report it call this. */
  onProgress?: (stage: string, progress: number) => void;
  /** Trace mode: silhouette (filled paths) or centerline (stroked paths). */
  traceMode?: 'silhouette' | 'centerline';
  /** Target stroke width for centerline mode in pixels (1-50). Default 2. */
  centerlineWidth?: number;
  /** Minimum branch length to keep for centerline mode in pixels (1-100). Default 4. */
  centerlinePrune?: number;
}

export interface RasterTraceResult {
  width: number;
  height: number;
  paths: RasterTracePath[];
  /**
   * Hole rings that could not be paired with an outer (should stay 0 when
   * compoundHoles is enabled and at least one outer exists).
   */
  omittedHoles: number;
}

interface Edge {
  start: RasterTracePoint;
  end: RasterTracePoint;
}

function pointKey(point: RasterTracePoint): string {
  return `${point.x},${point.y}`;
}

function perpendicularDistance(
  point: RasterTracePoint,
  start: RasterTracePoint,
  end: RasterTracePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy)
  );
}

function simplify(points: RasterTracePoint[], tolerance: number): RasterTracePoint[] {
  if (tolerance <= 0 || points.length <= 3) return points;
  const open = [...points, points[0] as RasterTracePoint];
  const rdp = (items: RasterTracePoint[]): RasterTracePoint[] => {
    let maxDistance = 0;
    let index = 0;
    for (let i = 1; i < items.length - 1; i += 1) {
      const distance = perpendicularDistance(
        items[i] as RasterTracePoint,
        items[0] as RasterTracePoint,
        items[items.length - 1] as RasterTracePoint,
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (maxDistance <= tolerance)
      return [items[0] as RasterTracePoint, items[items.length - 1] as RasterTracePoint];
    const left = rdp(items.slice(0, index + 1));
    const right = rdp(items.slice(index));
    return [...left.slice(0, -1), ...right];
  };
  const result = rdp(open).slice(0, -1);
  return result.length >= 3 ? result : points;
}

function polygonArea(points: RasterTracePoint[]): number {
  return Math.abs(signedPolygonArea(points));
}

function signedPolygonArea(points: RasterTracePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i] as RasterTracePoint;
    const next = points[(i + 1) % points.length] as RasterTracePoint;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

/**
 * Cyclic collinear removal for closed pixel-aligned loops. Mirrors the Rust
 * engine's `contours::remove_collinear`: any point exactly on the line
 * between its neighbors (checked cyclically so the closing edge
 * participates) is removed. A closed square collapses to exactly its four
 * corners — RDP cannot do this for closed loops because its endpoints are
 * arbitrary.
 */
export function removeCollinearPoints(points: RasterTracePoint[]): RasterTracePoint[] {
  const pts = points.slice();
  if (pts.length < 4) return pts;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const m = pts.length;
    for (let i = 0; i < m; i += 1) {
      const prev = pts[(i + m - 1) % m] as RasterTracePoint;
      const cur = pts[i] as RasterTracePoint;
      const next = pts[(i + 1) % m] as RasterTracePoint;
      // Integer-pixel coordinates: collinear iff the cross product is 0.
      const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (Math.abs(cross) <= Number.EPSILON * 8) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function canonicalizeLoop(points: RasterTracePoint[]): RasterTracePoint[] {
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as RasterTracePoint;
    const current = points[start] as RasterTracePoint;
    if (point.y < current.y || (point.y === current.y && point.x < current.x)) start = index;
  }
  return [...points.slice(start), ...points.slice(0, start)];
}

function loopsFromEdges(edges: Edge[]): RasterTracePoint[][] {
  const byStart = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = pointKey(edge.start);
    byStart.set(key, [...(byStart.get(key) ?? []), edge]);
  }
  const loops: RasterTracePoint[][] = [];
  while (edges.length > 0) {
    const seed = edges.pop();
    if (!seed) break;
    const seedBucket = byStart.get(pointKey(seed.start));
    seedBucket?.splice(seedBucket.indexOf(seed), 1);
    const points = [seed.start];
    let end = seed.end;
    while (pointKey(end) !== pointKey(seed.start)) {
      points.push(end);
      const bucket = byStart.get(pointKey(end));
      const next = bucket?.pop();
      if (!next) break;
      const edgeIndex = edges.indexOf(next);
      if (edgeIndex >= 0) edges.splice(edgeIndex, 1);
      end = next.end;
    }
    if (points.length >= 3 && pointKey(end) === pointKey(seed.start)) loops.push(points);
  }
  return loops;
}

interface TraceMaskOptions {
  width: number;
  height: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  compoundHoles: boolean;
  fill?: RasterTraceFill;
}

function traceMaskToPaths(mask: Uint8Array, options: TraceMaskOptions): RasterTraceResult {
  const { width, height, minArea, simplifyTolerance, maxPaths, compoundHoles, fill } = options;
  const count = width * height;
  const visited = new Uint8Array(count);
  const paths: RasterTracePath[] = [];
  let omittedHoles = 0;

  for (let seed = 0; seed < count; seed += 1) {
    if (!mask[seed] || visited[seed]) continue;
    const queue = [seed];
    visited[seed] = 1;
    const component: number[] = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor] as number;
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    if (component.length < minArea) continue;

    const componentSet = new Set(component);
    const edges: Edge[] = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (const index of component) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
      if (y === 0 || !componentSet.has(index - width))
        edges.push({ start: { x, y }, end: { x: x + 1, y } });
      if (x + 1 === width || !componentSet.has(index + 1))
        edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 } });
      if (y + 1 === height || !componentSet.has(index + width))
        edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 } });
      if (x === 0 || !componentSet.has(index - 1))
        edges.push({ start: { x, y: y + 1 }, end: { x, y } });
    }

    const outers: RasterTracePoint[][] = [];
    const holes: RasterTracePoint[][] = [];
    for (const loop of loopsFromEdges(edges)) {
      const points = canonicalizeLoop(simplify(loop, simplifyTolerance));
      if (signedPolygonArea(points) < 0) {
        holes.push(points);
      } else {
        outers.push(points);
      }
    }

    if (outers.length === 0) {
      omittedHoles += holes.length;
      continue;
    }

    outers.sort((a, b) => polygonArea(b) - polygonArea(a));
    const primary = outers[0] as RasterTracePoint[];
    const attachedHoles = compoundHoles ? holes : [];
    if (!compoundHoles) omittedHoles += holes.length;

    paths.push({
      points: primary,
      holes: attachedHoles.length > 0 ? attachedHoles : undefined,
      closed: true,
      area: polygonArea(primary),
      bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      ...(fill ? { fill } : {}),
    });

    for (let i = 1; i < outers.length; i += 1) {
      const ring = outers[i] as RasterTracePoint[];
      paths.push({
        points: ring,
        closed: true,
        area: polygonArea(ring),
        bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        ...(fill ? { fill } : {}),
      });
    }

    while (paths.length > maxPaths) {
      paths.sort((left, right) => right.area - left.area);
      paths.pop();
    }
  }

  paths.sort((left, right) => right.area - left.area);
  return { width, height, paths, omittedHoles };
}

interface OklabSample {
  r: number;
  g: number;
  b: number;
  L: number;
  a: number;
  b_: number;
}

interface QuantizedColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** Oklab-based median-cut palette. Uses perceptually uniform Oklab distance
 * for colour matching instead of naive RGB Euclidean distance. */
export function quantizePalette(
  source: ImageData,
  maxColors: number,
  grayscale: boolean,
  alphaThreshold: number,
): QuantizedColor[] {
  const samples: OklabSample[] = [];
  const count = source.width * source.height;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const a = source.data[offset + 3] as number;
    if (a < alphaThreshold) continue;
    let r = source.data[offset] as number;
    let g = source.data[offset + 1] as number;
    let b = source.data[offset + 2] as number;
    if (grayscale) {
      const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      r = y;
      g = y;
      b = y;
    }
    const linear = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)] as [number, number, number];
    const [L, aa, bb] = linearSrgbToOklab(linear);
    samples.push({ r, g, b, L, a: aa, b_: bb });
  }
  if (samples.length === 0) return [];

  type Bucket = OklabSample[];
  let buckets: Bucket[] = [samples];
  while (buckets.length < maxColors) {
    let splitIndex = -1;
    let splitChannel: 'L' | 'a' | 'b_' = 'L';
    let maxRange = -1;
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i] as Bucket;
      if (bucket.length < 2) continue;
      let minL = Infinity;
      let maxL = -Infinity;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const sample of bucket) {
        if (sample.L < minL) minL = sample.L;
        if (sample.L > maxL) maxL = sample.L;
        if (sample.a < minA) minA = sample.a;
        if (sample.a > maxA) maxA = sample.a;
        if (sample.b_ < minB) minB = sample.b_;
        if (sample.b_ > maxB) maxB = sample.b_;
      }
      const ranges: Array<{ ch: 'L' | 'a' | 'b_'; range: number }> = [
        { ch: 'L', range: maxL - minL },
        { ch: 'a', range: maxA - minA },
        { ch: 'b_', range: maxB - minB },
      ];
      ranges.sort((x, y) => y.range - x.range);
      const best = ranges[0];
      if (best && best.range > maxRange) {
        maxRange = best.range;
        splitIndex = i;
        splitChannel = best.ch;
      }
    }
    if (splitIndex < 0 || maxRange <= 1e-6) break;
    const bucket = buckets[splitIndex] as Bucket;
    bucket.sort((x, y) => x[splitChannel] - y[splitChannel]);
    const mid = Math.floor(bucket.length / 2);
    buckets = [
      ...buckets.slice(0, splitIndex),
      bucket.slice(0, mid),
      bucket.slice(mid),
      ...buckets.slice(splitIndex + 1),
    ];
  }

  return buckets
    .map((bucket) => {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (const sample of bucket) {
        sumR += sample.r;
        sumG += sample.g;
        sumB += sample.b;
      }
      const n = bucket.length;
      return {
        r: Math.round(sumR / n),
        g: Math.round(sumG / n),
        b: Math.round(sumB / n),
        count: n,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function oklabDistanceSq(
  r: number,
  g: number,
  b: number,
  color: { r: number; g: number; b: number },
): number {
  const linear = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)] as [number, number, number];
  const [L1, a1, b1] = linearSrgbToOklab(linear);

  const linear2 = [srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b)] as [
    number,
    number,
    number,
  ];
  const [L2, a2, b2] = linearSrgbToOklab(linear2);

  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return dL * dL + da * da + db * db;
}

function assignPaletteIndex(r: number, g: number, b: number, palette: QuantizedColor[]): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const color = palette[i] as QuantizedColor;
    const dist = oklabDistanceSq(r, g, b, color);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function traceMonochrome(source: ImageData, options: RasterTraceOptions): RasterTraceResult {
  const threshold = Math.max(0, Math.min(255, options.threshold ?? 128));
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 1));
  const foreground = options.foreground ?? 'dark';
  const count = source.width * source.height;
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const alpha = source.data[offset + 3] as number;
    const luminance =
      0.2126 * (source.data[offset] as number) +
      0.7152 * (source.data[offset + 1] as number) +
      0.0722 * (source.data[offset + 2] as number);
    const selected =
      alpha >= alphaThreshold &&
      (foreground === 'dark' ? luminance < threshold : luminance >= threshold);
    mask[i] = selected ? 1 : 0;
  }

  return traceMaskToPaths(mask, {
    width: source.width,
    height: source.height,
    minArea: Math.max(1, Math.round(options.minArea ?? 1)),
    simplifyTolerance: Math.max(0, options.simplifyTolerance ?? 0.75),
    maxPaths: Math.max(1, Math.round(options.maxPaths ?? 1_000)),
    compoundHoles: options.compoundHoles !== false,
  });
}

function tracePaletteModes(
  source: ImageData,
  options: RasterTraceOptions,
  grayscale: boolean,
): RasterTraceResult {
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 1));
  const defaultColors = grayscale ? 4 : 8;
  const maxColors = Math.max(2, Math.min(32, Math.round(options.maxColors ?? defaultColors)));
  const palette = quantizePalette(source, maxColors, grayscale, alphaThreshold);
  if (palette.length === 0) {
    return { width: source.width, height: source.height, paths: [], omittedHoles: 0 };
  }

  const count = source.width * source.height;
  const assignments = new Int16Array(count);
  assignments.fill(-1);
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const a = source.data[offset + 3] as number;
    if (a < alphaThreshold) continue;
    let r = source.data[offset] as number;
    let g = source.data[offset + 1] as number;
    let b = source.data[offset + 2] as number;
    if (grayscale) {
      const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      r = y;
      g = y;
      b = y;
    }
    assignments[i] = assignPaletteIndex(r, g, b, palette);
  }

  const minArea = Math.max(1, Math.round(options.minArea ?? 1));
  const simplifyTolerance = Math.max(0, options.simplifyTolerance ?? 0.75);
  const maxPaths = Math.max(1, Math.round(options.maxPaths ?? 1_000));
  const compoundHoles = options.compoundHoles !== false;

  const paths: RasterTracePath[] = [];
  let omittedHoles = 0;
  for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
    const color = palette[paletteIndex] as QuantizedColor;
    // Skip near-white background bucket when it dominates (>40% of opaque pixels).
    const isNearWhite = color.r > 245 && color.g > 245 && color.b > 245;
    if (isNearWhite && color.count / Math.max(1, count) > 0.4) continue;

    const mask = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      mask[i] = assignments[i] === paletteIndex ? 1 : 0;
    }
    const remaining = Math.max(1, maxPaths - paths.length);
    const result = traceMaskToPaths(mask, {
      width: source.width,
      height: source.height,
      minArea,
      simplifyTolerance,
      maxPaths: remaining,
      compoundHoles,
      fill: { r: color.r, g: color.g, b: color.b, a: 255 },
    });
    paths.push(...result.paths);
    omittedHoles += result.omittedHoles;
    if (paths.length >= maxPaths) break;
  }

  paths.sort((left, right) => right.area - left.area);
  while (paths.length > maxPaths) paths.pop();
  return { width: source.width, height: source.height, paths, omittedHoles };
}

/**
 * Colors closer than this squared Oklab distance are merged into one
 * pixel-art region (≈ 0.05 Oklab — perceptually equivalent).
 */
const PIXEL_ART_MERGE_DISTANCE_SQ = 0.0025;

/** Above this many unique colors the exact-merge path is too slow (O(U^2)
 * per merge); fall back to median-cut. Mirrors the Rust engine's limit. */
const PIXEL_ART_EXACT_PALETTE_LIMIT = 256;

/**
 * Pixel-art palette: exact opaque colors when they fit the budget, otherwise
 * perceptually-near colors are merged (greedy closest pair in Oklab).
 * Deterministic and mirrors `varve-trace::pixel_art::quantize_exact_palette`.
 */
export function quantizeExactPalette(
  source: ImageData,
  maxColors: number,
  alphaThreshold: number,
): QuantizedColor[] {
  const counts = new Map<number, { r: number; g: number; b: number; count: number }>();
  const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
  const count = source.width * source.height;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    if ((source.data[offset + 3] as number) < alphaThreshold) continue;
    const r = source.data[offset] as number;
    const g = source.data[offset + 1] as number;
    const b = source.data[offset + 2] as number;
    const k = key(r, g, b);
    const entry = counts.get(k);
    if (entry) entry.count += 1;
    else counts.set(k, { r, g, b, count: 1 });
  }
  const colors = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.r - b.r || a.g - b.g || a.b - b.b,
  );
  if (colors.length === 0) return [];
  if (colors.length > PIXEL_ART_EXACT_PALETTE_LIMIT) {
    return quantizePalette(source, Math.max(1, Math.round(maxColors)), false, alphaThreshold);
  }
  const budget = Math.max(1, Math.round(maxColors));
  if (colors.length <= budget) {
    return colors.map((c) => ({ ...c, a: 255 }));
  }
  const mergePair = (list: typeof colors, i: number, j: number) => {
    const [a, b] = list[i]!.count >= list[j]!.count ? [i, j] : [j, i];
    const total = Math.max(1, list[a]!.count + list[b]!.count);
    const merged = {
      r: Math.round((list[a]!.r * list[a]!.count + list[b]!.r * list[b]!.count) / total),
      g: Math.round((list[a]!.g * list[a]!.count + list[b]!.g * list[b]!.count) / total),
      b: Math.round((list[a]!.b * list[a]!.count + list[b]!.b * list[b]!.count) / total),
      count: list[a]!.count + list[b]!.count,
    };
    list[a] = merged;
    list.splice(b, 1);
    list.sort((x, y) => y.count - x.count || x.r - y.r || x.g - y.g || x.b - y.b);
  };
  // Pass 1: merge perceptually-equivalent colors only.
  let merged = true;
  while (colors.length > budget && merged) {
    merged = false;
    outer: for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        const d = oklabDistanceSq(colors[i]!.r, colors[i]!.g, colors[i]!.b, {
          r: colors[j]!.r,
          g: colors[j]!.g,
          b: colors[j]!.b,
        });
        if (d < PIXEL_ART_MERGE_DISTANCE_SQ) {
          mergePair(colors, i, j);
          merged = true;
          break outer;
        }
      }
    }
  }
  // Pass 2: force the nearest pair until the budget fits.
  while (colors.length > budget) {
    let best = -1;
    let bestJ = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        const d = oklabDistanceSq(colors[i]!.r, colors[i]!.g, colors[i]!.b, {
          r: colors[j]!.r,
          g: colors[j]!.g,
          b: colors[j]!.b,
        });
        if (d < bestD) {
          bestD = d;
          best = i;
          bestJ = j;
        }
      }
    }
    if (best < 0 || bestJ < 0) break;
    mergePair(colors, best, bestJ);
  }
  return colors.map((c) => ({ ...c, a: 255 }));
}

/**
 * Pixel-art trace: every opaque color becomes hard-edged, pixel-aligned
 * polygons (no anti-alias smoothing, no Bézier fitting). Mirrors the Rust
 * `PixelArt` engine mode. Deterministic.
 */
function tracePixelArt(source: ImageData, options: RasterTraceOptions): RasterTraceResult {
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 1));
  const maxColors = Math.max(1, Math.min(64, Math.round(options.maxColors ?? 8)));
  const palette = quantizeExactPalette(source, maxColors, alphaThreshold);
  if (palette.length === 0) {
    return { width: source.width, height: source.height, paths: [], omittedHoles: 0 };
  }
  const count = source.width * source.height;
  const assignments = new Int16Array(count);
  assignments.fill(-1);
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    if ((source.data[offset + 3] as number) < alphaThreshold) continue;
    const r = source.data[offset] as number;
    const g = source.data[offset + 1] as number;
    const b = source.data[offset + 2] as number;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let p = 0; p < palette.length; p += 1) {
      const c = palette[p] as QuantizedColor;
      const d = oklabDistanceSq(r, g, b, { r: c.r, g: c.g, b: c.b });
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    assignments[i] = best;
  }
  const minArea = Math.max(1, Math.round(options.minArea ?? 1));
  const maxPaths = Math.max(1, Math.round(options.maxPaths ?? 1_000));
  const compoundHoles = options.compoundHoles !== false;
  const paths: RasterTracePath[] = [];
  let omittedHoles = 0;
  for (let p = 0; p < palette.length; p += 1) {
    const color = palette[p] as QuantizedColor;
    const mask = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      mask[i] = assignments[i] === p ? 1 : 0;
    }
    const remaining = Math.max(1, maxPaths - paths.length);
    // Zero simplification tolerance collapses collinear runs while keeping
    // every true corner — the pixel grid is preserved exactly.
    const result = traceMaskToPaths(mask, {
      width: source.width,
      height: source.height,
      minArea,
      // Zero simplification tolerance keeps every pixel-grid point; the
      // cyclic collinear pass below collapses straight runs afterwards.
      simplifyTolerance: 0,
      maxPaths: remaining,
      compoundHoles,
      fill: { r: color.r, g: color.g, b: color.b, a: 255 },
    });
    // Collapse collinear runs on every ring (outer + holes), cyclically.
    const cleaned = result.paths.map((path) => ({
      ...path,
      points: removeCollinearPoints(path.points),
      ...(path.holes ? { holes: path.holes.map((ring) => removeCollinearPoints(ring)) } : {}),
    }));
    paths.push(...cleaned);
    omittedHoles += result.omittedHoles;
    if (paths.length >= maxPaths) break;
  }
  paths.sort((left, right) => right.area - left.area);
  while (paths.length > maxPaths) paths.pop();
  return { width: source.width, height: source.height, paths, omittedHoles };
}

export function traceRasterToPaths(
  source: ImageData,
  options: RasterTraceOptions = {},
): RasterTraceResult {
  if (options.traceMode === 'centerline') {
    // The TS fallback tracer has no skeleton/centerline implementation; an
    // honest error is better than silently emitting filled silhouettes.
    throw new Error('Centerline tracing requires the native desktop engine');
  }
  const mode = options.mode ?? 'monochrome';
  if (mode === 'color') return tracePaletteModes(source, options, false);
  if (mode === 'grayscale') return tracePaletteModes(source, options, true);
  if (mode === 'pixel-art') return tracePixelArt(source, options);
  return traceMonochrome(source, options);
}
