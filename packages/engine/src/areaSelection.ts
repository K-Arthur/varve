/**
 * Analytical, document-space pixel selection.
 *
 * Node selection remains an ordered NodeId[] in the editor. This model is a
 * separate expression tree so rectangles, ellipses, polygons, holes, and
 * disjoint regions stay analytical until a raster operation requests a
 * bounded alpha mask.
 */

import { applyAffine } from '@varve/shared';

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

/**
 * Ephemeral decoded mask selection. The pixel data is session state, not
 * document content; inverseTransform maps document points to the mask's
 * target-local coordinate system.
 */
export interface RasterMaskSelectionShape {
  kind: 'raster-mask';
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  height: number;
  data: Uint8Array;
  boundary: readonly {
    from: SelectionPoint;
    to: SelectionPoint;
  }[];
  transform: readonly [number, number, number, number, number, number];
  inverseTransform: readonly [number, number, number, number, number, number];
  feather: number;
  antialias: boolean;
}

export type AreaSelectionShape =
  | RectangleSelectionShape
  | EllipseSelectionShape
  | PolygonSelectionShape
  | RasterMaskSelectionShape;

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

/**
 * Bounds on rasterized selection coverage, aligned with the native mask
 * transfer limits in `selectionMask.ts` (16 384px per side, 16 777 216 px total).
 * Rasterizing a selection never allocates a full pasteboard bitmap, but a
 * requested target rectangle is still capped so a misbehaving caller cannot
 * trigger an unbounded allocation.
 */
export const MAX_AREA_SELECTION_DIMENSION = 16_384;
export const MAX_AREA_SELECTION_PIXELS = 16_777_216;

/**
 * Beyond this many combine nodes the selection expression is compacted into a
 * bounded raster-mask shape so evaluation cost and memory stay predictable.
 * The iterative evaluator below already removes the call-stack risk, but this
 * guard also prevents pathological tree growth from bloating every consumer.
 */
const MAX_AREA_SELECTION_NODES = 4_096;

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
  } else if (shape.kind === 'raster-mask') {
    if (
      ![shape.x, shape.y, shape.w, shape.h, shape.width, shape.height].every(Number.isFinite) ||
      !Number.isInteger(shape.width) ||
      !Number.isInteger(shape.height) ||
      shape.width <= 0 ||
      shape.height <= 0 ||
      shape.data.length !== shape.width * shape.height
    ) {
      return null;
    }
    normalized = {
      ...shape,
      data: new Uint8Array(shape.data),
      feather: finiteNonNegative(shape.feather),
      antialias: Boolean(shape.antialias),
    };
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

  return maybeCompact({
    coordinateSpace: current.coordinateSpace,
    generation,
    expression: {
      kind: 'combine',
      operation,
      left: current.expression,
      right: incoming.expression,
    },
  });
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
  return maybeCompact({
    coordinateSpace: domain.coordinateSpace,
    generation,
    expression: {
      kind: 'combine',
      operation: 'subtract',
      left: domain.expression,
      right: selection.expression,
    },
  });
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
    if (shape.kind === 'raster-mask') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
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

  if (shape.kind === 'raster-mask') {
    const local = applyAffine(shape.inverseTransform, [point.x, point.y]);
    const nx = ((local[0] - shape.x) / shape.w) * shape.width;
    const ny = ((local[1] - shape.y) / shape.h) * shape.height;
    if (nx < 0 || ny < 0 || nx >= shape.width || ny >= shape.height) return 0;
    const x0 = Math.floor(nx);
    const y0 = Math.floor(ny);
    const x1 = Math.min(shape.width - 1, x0 + 1);
    const y1 = Math.min(shape.height - 1, y0 + 1);
    const tx = nx - x0;
    const ty = ny - y0;
    const at = (x: number, y: number) => shape.data[y * shape.width + x]! / 255;
    const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return top * (1 - ty) + bottom * ty;
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

function combineCoverage(
  left: number,
  right: number,
  operation: 'add' | 'subtract' | 'intersect',
): number {
  switch (operation) {
    case 'add':
      return Math.max(left, right);
    case 'subtract':
      return left * (1 - right);
    case 'intersect':
      return Math.min(left, right);
  }
}

/**
 * Evaluate a selection expression at one document-space point.
 *
 * The implementation is iterative (explicit stack) rather than recursive so a
 * deeply nested combine tree — e.g. hundreds of successive add/subtract
 * gestures — cannot overflow the JavaScript call stack. A left-associative
 * post-order traversal pushes combine nodes twice (once to schedule child
 * evaluation, once to fold the result) and keeps an explicit result stack.
 */
function evaluateExpression(expression: AreaSelectionExpression, point: SelectionPoint): number {
  const work: Array<{ node: AreaSelectionExpression; visited: boolean }> = [
    { node: expression, visited: false },
  ];
  const results: number[] = [];
  while (work.length > 0) {
    const top = work.pop()!;
    if (top.node.kind === 'shape') {
      results.push(shapeCoverage(top.node.shape, point));
      continue;
    }
    if (!top.visited) {
      work.push({ node: top.node, visited: true });
      // Push right before left so the left operand is evaluated and folded
      // first, preserving left-associative combine semantics (subtract and
      // intersect are not commutative).
      work.push({ node: top.node.right, visited: false });
      work.push({ node: top.node.left, visited: false });
    } else {
      const right = results.pop() ?? 0;
      const left = results.pop() ?? 0;
      results.push(combineCoverage(left, right, top.node.operation));
    }
  }
  return results.pop() ?? 0;
}

function expressionNodeCount(expression: AreaSelectionExpression): number {
  if (expression.kind === 'shape') return 1;
  return 1 + expressionNodeCount(expression.left) + expressionNodeCount(expression.right);
}

/**
 * Compact an arbitrarily deep expression into a single bounded raster-mask
 * shape covering its own bounds. Used only when `expressionNodeCount` exceeds
 * `MAX_AREA_SELECTION_NODES` so subsequent evaluation and rasterization stay
 * bounded. Fractional coverage is preserved because the rasterization samples
 * the expression at pixel centres.
 */
function compactAreaSelection(selection: AreaSelection): AreaSelection {
  const bounds = areaSelectionBounds(selection.expression);
  const width = Math.max(1, Math.ceil(bounds.w));
  const height = Math.max(1, Math.ceil(bounds.h));
  const mask = rasterizeAreaSelection(selection, {
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    samples: 1,
  });
  return {
    coordinateSpace: 'document',
    generation: selection.generation + 1,
    expression: {
      kind: 'shape',
      shape: {
        kind: 'raster-mask',
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        width: mask.width,
        height: mask.height,
        data: mask.data,
        boundary: [],
        transform: [1, 0, 0, 1, 0, 0],
        inverseTransform: [1, 0, 0, 1, 0, 0],
        feather: 0,
        antialias: false,
      },
    },
  };
}

function maybeCompact(selection: AreaSelection): AreaSelection {
  if (expressionNodeCount(selection.expression) > MAX_AREA_SELECTION_NODES) {
    try {
      return compactAreaSelection(selection);
    } catch {
      return selection;
    }
  }
  return selection;
}

/** Sample a selection expression at one document-space point. */
export function areaSelectionCoverageAt(selection: AreaSelection, point: SelectionPoint): number {
  return evaluateExpression(selection.expression, point);
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

  if (
    width > MAX_AREA_SELECTION_DIMENSION ||
    height > MAX_AREA_SELECTION_DIMENSION ||
    width * height > MAX_AREA_SELECTION_PIXELS
  ) {
    throw new Error('Rasterization bounds exceed area-selection memory limits');
  }

  const samples = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(options.samples ?? 1)));
  const data = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let total = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          total += evaluateExpression(selection.expression, {
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
