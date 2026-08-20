/**
 * Analytical, document-space pixel selection.
 *
 * Node selection remains an ordered NodeId[] in the editor. This model is a
 * separate expression tree so rectangles, ellipses, polygons, holes, and
 * disjoint regions stay analytical until a raster operation requests a
 * bounded alpha mask.
 */

export type AreaSelectionOperation = 'replace' | 'add' | 'subtract' | 'intersect';

export type AreaSelectionStyle = 'normal' | 'fixed-ratio' | 'fixed-size';

/** Ephemeral controls shared by the rectangular and elliptical marquee tools. */
export interface AreaSelectionSettings {
  operation: AreaSelectionOperation;
  style: AreaSelectionStyle;
  ratio: number;
  fixedWidth: number;
  fixedHeight: number;
  fromCenter: boolean;
  feather: number;
  antialias: boolean;
}

export const DEFAULT_AREA_SELECTION_SETTINGS: Readonly<AreaSelectionSettings> = Object.freeze({
  operation: 'replace',
  style: 'normal',
  ratio: 1,
  fixedWidth: 100,
  fixedHeight: 100,
  fromCenter: false,
  feather: 0,
  antialias: false,
});

export interface SelectionPoint {
  x: number;
  y: number;
}

export interface RectangleSelectionShape {
  kind: 'rectangle';
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
  antialias: boolean;
}

export interface EllipseSelectionShape {
  kind: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
  antialias: boolean;
}

export interface PolygonSelectionShape {
  kind: 'polygon';
  points: readonly SelectionPoint[];
  feather: number;
  antialias: boolean;
}

export type AreaSelectionShape =
  | RectangleSelectionShape
  | EllipseSelectionShape
  | PolygonSelectionShape;

export type AreaSelectionExpression =
  | { kind: 'shape'; shape: AreaSelectionShape }
  | {
      kind: 'combine';
      operation: Exclude<AreaSelectionOperation, 'replace'>;
      left: AreaSelectionExpression;
      right: AreaSelectionExpression;
    };

export interface AreaSelection {
  coordinateSpace: 'document';
  expression: AreaSelectionExpression;
  /** Monotonic editor-session generation used by mask caches/workers. */
  generation: number;
}

export interface AlphaMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface RasterizeAreaSelectionOptions {
  /** Document-space origin of the first output pixel. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1 = pixel-center sampling; 4 gives deterministic 4x4 coverage. */
  samples?: number;
}

const MAX_SAMPLES = 8;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeRectShape(
  shape: RectangleSelectionShape | EllipseSelectionShape,
): RectangleSelectionShape | EllipseSelectionShape {
  const x2 = shape.x + shape.w;
  const y2 = shape.y + shape.h;
  return {
    ...shape,
    x: Math.min(shape.x, x2),
    y: Math.min(shape.y, y2),
    w: Math.abs(shape.w),
    h: Math.abs(shape.h),
    feather: finiteNonNegative(shape.feather),
    antialias: Boolean(shape.antialias),
  };
}

/** Create a safe shape expression with normalized geometry and options. */
export function createAreaSelection(
  shape: AreaSelectionShape,
  generation = 1,
): AreaSelection | null {
  if (!Number.isFinite(generation) || generation < 0) return null;

  let normalized: AreaSelectionShape;
  if (shape.kind === 'rectangle' || shape.kind === 'ellipse') {
    if (![shape.x, shape.y, shape.w, shape.h].every(Number.isFinite)) return null;
    normalized = normalizeRectShape(shape);
  } else {
    if (
      shape.points.length < 3 ||
      shape.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      return null;
    }
    normalized = {
      kind: 'polygon',
      points: shape.points.map((point) => ({ x: point.x, y: point.y })),
      feather: finiteNonNegative(shape.feather),
      antialias: Boolean(shape.antialias),
    };
  }

  return {
    coordinateSpace: 'document',
    expression: { kind: 'shape', shape: normalized },
    generation: Math.floor(generation),
  };
}

/** Combine two analytical selections without allocating a full-canvas mask. */
export function combineAreaSelections(
  current: AreaSelection | null,
  incoming: AreaSelection,
  operation: AreaSelectionOperation,
  generation = Math.max(current?.generation ?? 0, incoming.generation) + 1,
): AreaSelection | null {
  if (operation === 'replace' || !current) {
    return operation === 'replace' || operation === 'add' ? { ...incoming, generation } : null;
  }

  if (current.coordinateSpace !== incoming.coordinateSpace) {
    throw new Error('Area selections must use the same coordinate space');
  }

  return {
    coordinateSpace: current.coordinateSpace,
    generation,
    expression: {
      kind: 'combine',
      operation,
      left: current.expression,
      right: incoming.expression,
    },
  };
}

/**
 * Complement a selection inside an explicit finite domain. This is the only
 * supported inversion operation: document-space selections are not allowed to
 * become an infinite mask on an unbounded pasteboard.
 */
export function invertAreaSelection(
  selection: AreaSelection | null,
  domain: AreaSelection,
  generation = Math.max(selection?.generation ?? 0, domain.generation) + 1,
): AreaSelection {
  if (!selection) return { ...domain, generation };
  return {
    coordinateSpace: domain.coordinateSpace,
    generation,
    expression: {
      kind: 'combine',
      operation: 'subtract',
      left: domain.expression,
      right: selection.expression,
    },
  };
}

export function areaSelectionBounds(expression: AreaSelectionExpression): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (expression.kind === 'shape') {
    const shape = expression.shape;
    if (shape.kind === 'polygon') {
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }

  const left = areaSelectionBounds(expression.left);
  const right = areaSelectionBounds(expression.right);
  if (expression.operation === 'intersect') {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    return {
      x,
      y,
      w: Math.max(0, Math.min(left.x + left.w, right.x + right.w) - x),
      h: Math.max(0, Math.min(left.y + left.h, right.y + right.h) - y),
    };
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    w: Math.max(left.x + left.w, right.x + right.w) - x,
    h: Math.max(left.y + left.h, right.y + right.h) - y,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCoverage(signedDistance: number, feather: number): number {
  if (feather <= 0) return signedDistance >= 0 ? 1 : 0;
  return clamp01(0.5 + signedDistance / (2 * feather));
}

function pointSegmentDistance(point: SelectionPoint, a: SelectionPoint, b: SelectionPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function pointInPolygon(point: SelectionPoint, points: readonly SelectionPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function shapeCoverage(shape: AreaSelectionShape, point: SelectionPoint): number {
  if (shape.kind === 'rectangle') {
    const inside =
      point.x >= shape.x &&
      point.x <= shape.x + shape.w &&
      point.y >= shape.y &&
      point.y <= shape.y + shape.h;
    const dx = Math.max(shape.x - point.x, 0, point.x - (shape.x + shape.w));
    const dy = Math.max(shape.y - point.y, 0, point.y - (shape.y + shape.h));
    const outsideDistance = Math.hypot(dx, dy);
    const insideDistance = Math.min(
      point.x - shape.x,
      shape.x + shape.w - point.x,
      point.y - shape.y,
      shape.y + shape.h - point.y,
    );
    return smoothCoverage(inside ? insideDistance : -outsideDistance, shape.feather);
  }

  if (shape.kind === 'ellipse') {
    const rx = shape.w / 2;
    const ry = shape.h / 2;
    if (rx <= 0 || ry <= 0) return 0;
    const nx = (point.x - (shape.x + rx)) / rx;
    const ny = (point.y - (shape.y + ry)) / ry;
    return smoothCoverage((1 - Math.hypot(nx, ny)) * Math.min(rx, ry), shape.feather);
  }

  const inside = pointInPolygon(point, shape.points);
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < shape.points.length; i++) {
    distance = Math.min(
      distance,
      pointSegmentDistance(point, shape.points[i]!, shape.points[(i + 1) % shape.points.length]!),
    );
  }
  return smoothCoverage(inside ? distance : -distance, shape.feather);
}

function expressionCoverage(expression: AreaSelectionExpression, point: SelectionPoint): number {
  if (expression.kind === 'shape') return shapeCoverage(expression.shape, point);
  const left = expressionCoverage(expression.left, point);
  const right = expressionCoverage(expression.right, point);
  switch (expression.operation) {
    case 'add':
      return Math.max(left, right);
    case 'subtract':
      return left * (1 - right);
    case 'intersect':
      return Math.min(left, right);
  }
}

/** Sample a selection expression at one document-space point. */
export function areaSelectionCoverageAt(selection: AreaSelection, point: SelectionPoint): number {
  return expressionCoverage(selection.expression, point);
}

/** Rasterize only the requested finite target bounds. */
export function rasterizeAreaSelection(
  selection: AreaSelection,
  options: RasterizeAreaSelectionOptions,
): AlphaMask {
  const { x, y, width, height } = options;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width < 0 ||
    height < 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    throw new Error('Rasterization bounds must be finite, non-negative integers');
  }

  const samples = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(options.samples ?? 1)));
  const data = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let total = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          total += expressionCoverage(selection.expression, {
            x: x + px + (sx + 0.5) / samples,
            y: y + py + (sy + 0.5) / samples,
          });
        }
      }
      data[py * width + px] = Math.round((total / (samples * samples)) * 255);
    }
  }
  return { data, width, height };
}
