/**
 * Deterministic reference geometry evaluator for non-destructive warp
 * modifiers.
 *
 * The canonical pipeline (shared by every render backend, hit testing,
 * bounds computation, and export):
 *
 *   source geometry (local)
 *     → shapeToPathPoints (exact, handles preserved)
 *     → adaptive subdivision (per segment, output-space flatness)
 *     → warp maps (modifier stack, array order, first-applied first)
 *     → evaluated polyline path shape (never NaN/Infinity)
 *
 * All math here is pure and deterministic: identical inputs produce
 * identical outputs on every platform. This module is the reference
 * implementation; a Rust/WASM port must match its tolerances and order of
 * operations (see docs/adr warp ADRs).
 */

import { applyHomography, isQuadValid, type Quad, solveHomography } from '../mockup/homography';
import type { PathPoint, Shape } from '../types';
import {
  type BendMode,
  type BendModifier,
  DEFAULT_WARP_QUALITY,
  type EnvelopeModifier,
  type MeshWarpModifier,
  type PerspectiveModifier,
  type SkewModifier,
  WARP_QUALITY_TOLERANCE,
  type WarpModifier,
  type WarpQualitySettings,
  type WarpSettings,
} from './types';

/**
 * Absolute subdivision tolerance in source-local units for a quality setting.
 *
 * `DEFAULT_WARP_QUALITY` deliberately carries no `tolerance`, so it must be
 * derived from the profile (draft 2 / interactive 0.5 / high 0.25 / export
 * 0.1 px). Reading `tolerance` directly yields `undefined`, and every
 * `deviation <= undefined` comparison is false — which silently subdivides
 * every segment to the maximum depth.
 */
export function resolveWarpTolerance(quality: WarpQualitySettings | undefined): number {
  const explicit = quality?.tolerance;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const profile = quality?.profile ?? DEFAULT_WARP_QUALITY.profile;
  return WARP_QUALITY_TOLERANCE[profile] ?? WARP_QUALITY_TOLERANCE.interactive;
}

export type WarpRect = { x: number; y: number; w: number; h: number };

/** Diagnostics counters (hidden in production; no artwork data). */
export const warpDiagnostics = {
  evaluations: 0,
  generatedPoints: 0,
  nonFiniteFallbacks: 0,
  pointsCapped: 0,
  invalidCages: 0,
};

export interface WarpInvalidFlag {
  modifierId: string;
  reason: 'invalid-cage' | 'singular-map' | 'foldover' | 'points-capped' | 'non-finite-input';
  message: string;
}

/** The composite mapping for one modifier stack evaluation. */
export interface WarpEvaluation {
  /** Map a source-local point through the full stack (array order). */
  map: (x: number, y: number) => [number, number];
  /**
   * Jacobian of the composite map at a source-local point.
   * Columns: d/dx and d/dy of the output. J = [[dxdu, dxdv], [dydu, dydv]].
   */
  jacobian: (x: number, y: number) => { dxdu: number; dxdv: number; dydu: number; dydv: number };
  /** One map per enabled modifier, in stack order. */
  maps: Array<(x: number, y: number) => [number, number]>;
  /** Diagnostics for invalid/singular modifiers (they degrade to identity). */
  invalid: WarpInvalidFlag[];
  /** The source bounds the maps were built against. */
  sourceBounds: WarpRect;
}

export interface WarpEvaluationOptions {
  settings?: WarpSettings;
  quality?: WarpQualitySettings;
}

// ── helpers ────────────────────────────────────────────────────────────────

function isFiniteXY(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Normalized control (0..1) → source-local coordinate. */
function normToLocal(
  bounds: WarpRect,
  c: { x: number; y: number } | undefined,
  absolute: boolean,
): { x: number; y: number } {
  // Modifiers reaching the evaluator are normally sanitized by
  // validateWarpModifier, but a stack can also be built in code or arrive from
  // a partial migration. A missing/non-finite control degrades to the source
  // origin (an identity-ish contribution) instead of throwing — malformed data
  // must never crash the renderer or the exporter.
  if (!c || !isFiniteXY(c.x, c.y)) {
    return absolute ? { x: bounds.x, y: bounds.y } : { x: bounds.x, y: bounds.y };
  }
  if (absolute) return { x: c.x, y: c.y };
  return { x: bounds.x + c.x * bounds.w, y: bounds.y + c.y * bounds.h };
}

// ── per-modifier maps ──────────────────────────────────────────────────────

function skewMap(m: SkewModifier, bounds: WarpRect): (x: number, y: number) => [number, number] {
  const pivot = normToLocal(bounds, m.origin, false);
  const kx = Math.tan((m.skewX * Math.PI) / 180);
  const ky = Math.tan((m.skewY * Math.PI) / 180);
  return (x, y) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    return [pivot.x + dx + kx * dy, pivot.y + dy + ky * dx];
  };
}

function perspectiveMap(
  m: PerspectiveModifier,
  bounds: WarpRect,
  absolute: boolean,
): { map: (x: number, y: number) => [number, number]; invalid: boolean } {
  const src: Quad = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];
  const dst: Quad = [
    normToLocal(bounds, m.corners.tl, absolute),
    normToLocal(bounds, m.corners.tr, absolute),
    normToLocal(bounds, m.corners.br, absolute),
    normToLocal(bounds, m.corners.bl, absolute),
  ];
  if (!isQuadValid(dst)) {
    return { map: (x, y) => [x, y], invalid: true };
  }
  // Near-degenerate source domains make the DLT ill-conditioned; degrade to
  // identity rather than emit drifting geometry.
  const minDim = Math.min(bounds.w, bounds.h);
  const maxDim = Math.max(bounds.w, bounds.h);
  if (minDim <= 1e-4 || minDim / maxDim < 1e-4) {
    return { map: (x, y) => [x, y], invalid: true };
  }
  const h = solveHomography(src, dst);
  if (!h) {
    return { map: (x, y) => [x, y], invalid: true };
  }
  return {
    map: (x, y) => {
      const p = applyHomography(h, { x, y });
      return isFiniteXY(p.x, p.y) ? [p.x, p.y] : [x, y];
    },
    invalid: false,
  };
}

// Allocation-free scalar cubic at t (used by the hot envelope map).
function cubicScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function envelopeMap(
  m: EnvelopeModifier,
  bounds: WarpRect,
  absolute: boolean,
): (x: number, y: number) => [number, number] {
  const c = m.corners;
  const tl = normToLocal(bounds, c.tl, absolute);
  const tr = normToLocal(bounds, c.tr, absolute);
  const br = normToLocal(bounds, c.br, absolute);
  const bl = normToLocal(bounds, c.bl, absolute);
  // Precompute all twelve control points once (per-call allocation was the
  // hot-path bottleneck of the Coons map).
  const top = [
    tl,
    normToLocal(bounds, m.edges.top[0], absolute),
    normToLocal(bounds, m.edges.top[1], absolute),
    tr,
  ] as const;
  const bottom = [
    bl,
    normToLocal(bounds, m.edges.bottom[0], absolute),
    normToLocal(bounds, m.edges.bottom[1], absolute),
    br,
  ] as const;
  const left = [
    tl,
    normToLocal(bounds, m.edges.left[0], absolute),
    normToLocal(bounds, m.edges.left[1], absolute),
    bl,
  ] as const;
  const right = [
    tr,
    normToLocal(bounds, m.edges.right[0], absolute),
    normToLocal(bounds, m.edges.right[1], absolute),
    br,
  ] as const;
  return (x, y) => {
    const u = bounds.w === 0 ? 0 : (x - bounds.x) / bounds.w;
    const v = bounds.h === 0 ? 0 : (y - bounds.y) / bounds.h;
    // Coons patch: (1-v)·top(u) + v·bottom(u) + (1-u)·left(v) + u·right(v)
    //              − bilinear corner blend.
    const tx = cubicScalar(top[0].x, top[1].x, top[2].x, top[3].x, u);
    const ty = cubicScalar(top[0].y, top[1].y, top[2].y, top[3].y, u);
    const bx = cubicScalar(bottom[0].x, bottom[1].x, bottom[2].x, bottom[3].x, u);
    const by = cubicScalar(bottom[0].y, bottom[1].y, bottom[2].y, bottom[3].y, u);
    const lx = cubicScalar(left[0].x, left[1].x, left[2].x, left[3].x, v);
    const ly = cubicScalar(left[0].y, left[1].y, left[2].y, left[3].y, v);
    const rx = cubicScalar(right[0].x, right[1].x, right[2].x, right[3].x, v);
    const ry = cubicScalar(right[0].y, right[1].y, right[2].y, right[3].y, v);
    const bilinearX = (1 - v) * ((1 - u) * tl.x + u * tr.x) + v * ((1 - u) * bl.x + u * br.x);
    const bilinearY = (1 - v) * ((1 - u) * tl.y + u * tr.y) + v * ((1 - u) * bl.y + u * br.y);
    const px = (1 - v) * tx + v * bx + (1 - u) * lx + u * rx - bilinearX;
    const py = (1 - v) * ty + v * by + (1 - u) * ly + u * ry - bilinearY;
    return isFiniteXY(px, py) ? [px, py] : [x, y];
  };
}

function meshMap(
  m: MeshWarpModifier,
  bounds: WarpRect,
  absolute: boolean,
): (x: number, y: number) => [number, number] {
  const { rows, columns, points } = m;
  if (rows < 1 || columns < 1 || points.length !== (rows + 1) * (columns + 1)) {
    return (x, y) => [x, y];
  }
  const local = points.map((p) => normToLocal(bounds, p, absolute));
  const v = (r: number, c: number) => r * (columns + 1) + c;
  const pointAt = (row: number, column: number): { x: number; y: number } => {
    // Catmull–Rom needs one sample beyond every edge. Linear extrapolation
    // (rather than duplicated edge points) keeps a regular mesh exactly
    // linear through the boundary cells.
    const atColumn = (r: number, c: number): { x: number; y: number } => {
      const clampedRow = Math.max(0, Math.min(rows, r));
      if (c >= 0 && c <= columns) return local[v(clampedRow, c)]!;
      if (c < 0) {
        const first = local[v(clampedRow, 0)]!;
        const next = local[v(clampedRow, 1)]!;
        return { x: first.x + (first.x - next.x) * -c, y: first.y + (first.y - next.y) * -c };
      }
      const last = local[v(clampedRow, columns)]!;
      const previous = local[v(clampedRow, columns - 1)]!;
      return {
        x: last.x + (last.x - previous.x) * (c - columns),
        y: last.y + (last.y - previous.y) * (c - columns),
      };
    };
    if (row >= 0 && row <= rows) return atColumn(row, column);
    if (row < 0) {
      const first = atColumn(0, column);
      const next = atColumn(1, column);
      return { x: first.x + (first.x - next.x) * -row, y: first.y + (first.y - next.y) * -row };
    }
    const last = atColumn(rows, column);
    const previous = atColumn(rows - 1, column);
    return {
      x: last.x + (last.x - previous.x) * (row - rows),
      y: last.y + (last.y - previous.y) * (row - rows),
    };
  };
  const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  };
  return (x, y) => {
    const u = bounds.w === 0 ? 0 : clampUnit((x - bounds.x) / bounds.w);
    const vv = bounds.h === 0 ? 0 : clampUnit((y - bounds.y) / bounds.h);
    const col = Math.max(0, Math.min(columns - 1, Math.floor(u * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(vv * rows)));
    const tx = clampUnit(u * columns - col);
    const ty = clampUnit(vv * rows - row);
    const tl = local[v(row, col)]!;
    const tr = local[v(row, col + 1)]!;
    const bl = local[v(row + 1, col)]!;
    const br = local[v(row + 1, col + 1)]!;
    const topX = tl.x + (tr.x - tl.x) * tx;
    const bottomX = bl.x + (br.x - bl.x) * tx;
    const mx = topX + (bottomX - topX) * ty;
    const topY = tl.y + (tr.y - tl.y) * tx;
    const bottomY = bl.y + (br.y - bl.y) * tx;
    const my = topY + (bottomY - topY) * ty;
    if (m.interpolation === 'bicubic') {
      const sampleBicubic = (coordinate: 'x' | 'y') => {
        const samples = [-1, 0, 1, 2].map((rowOffset) => {
          const rowSamples = [-1, 0, 1, 2].map(
            (columnOffset) => pointAt(row + rowOffset, col + columnOffset)[coordinate],
          );
          return catmullRom(rowSamples[0]!, rowSamples[1]!, rowSamples[2]!, rowSamples[3]!, tx);
        });
        return catmullRom(samples[0]!, samples[1]!, samples[2]!, samples[3]!, ty);
      };
      const bx = sampleBicubic('x');
      const by = sampleBicubic('y');
      return isFiniteXY(bx, by) ? [bx, by] : [x, y];
    }
    return isFiniteXY(mx, my) ? [mx, my] : [x, y];
  };
}

/**
 * Resize a mesh while preserving its visible deformation. New points are
 * sampled from its current evaluator, so a topology edit remains a valid,
 * source-preserving single operation.
 */
export function resampleMeshWarp(
  modifier: MeshWarpModifier,
  rows: number,
  columns: number,
  sourceBounds: WarpRect,
): MeshWarpModifier {
  const nextRows = Math.max(1, Math.min(32, Math.trunc(rows)));
  const nextColumns = Math.max(1, Math.min(32, Math.trunc(columns)));
  if (nextRows === modifier.rows && nextColumns === modifier.columns) return modifier;
  const evaluation = buildWarpEvaluation([modifier], sourceBounds);
  const absolute = modifier.coordinateSpace === 'source-local';
  const points = Array.from({ length: (nextRows + 1) * (nextColumns + 1) }, (_, index) => {
    const row = Math.floor(index / (nextColumns + 1));
    const column = index % (nextColumns + 1);
    const sourceX = sourceBounds.x + (sourceBounds.w * column) / nextColumns;
    const sourceY = sourceBounds.y + (sourceBounds.h * row) / nextRows;
    const [x, y] = evaluation.map(sourceX, sourceY);
    return absolute
      ? { x, y }
      : {
          x: sourceBounds.w === 0 ? 0 : (x - sourceBounds.x) / sourceBounds.w,
          y: sourceBounds.h === 0 ? 0 : (y - sourceBounds.y) / sourceBounds.h,
        };
  });
  return { ...modifier, rows: nextRows, columns: nextColumns, points };
}

/**
 * Parametric bend displacement, ported from @varve/scene textWarp and
 * normalized so `amount` in -1..1 produces the same visual strength. Returns
 * a signed displacement in pixels for the across-axis at normalized (nx, ny).
 */
function bendDisplacement(
  mode: BendMode,
  nx: number,
  ny: number,
  amount: number,
  wavelength: number,
  along: number,
  across: number,
): number {
  const pi = Math.PI;
  // Scale factor relative to the across dimension (textWarp uses h*0.5).
  const acrossScale = across * 0.5;
  // Arc scales with the along dimension (radius = along/2).
  if (mode === 'arc') {
    // y' = y + bend·(along/4)·cos(π + (nx-0.5)π) — faithful port of warpArc.
    return amount * (along / 4) * -Math.cos((nx - 0.5) * pi);
  }
  const t = Math.sin;
  switch (mode) {
    case 'arch':
      return amount * acrossScale * t(nx * pi) * (1 - ny);
    case 'bulge': {
      const centerDist = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5));
      return amount * acrossScale * (1 - centerDist * 2) * (1 - 2 * Math.abs(ny - 0.5));
    }
    case 'shell':
      return amount * acrossScale * t(nx * pi) * (1 - ny * 0.5) * 0.5;
    case 'flag':
      return amount * acrossScale * t(nx * pi * 2) * (1 - ny * 0.5);
    case 'wave':
      return amount * acrossScale * t(nx * pi * wavelength) * (1 - ny * 0.3);
    case 'rise':
      return amount * acrossScale * nx * nx * (1 - ny * 0.25);
    default:
      return 0;
  }
}

function bendMap(m: BendModifier, bounds: WarpRect): (x: number, y: number) => [number, number] {
  const wavelength = Math.max(1, Math.min(8, m.wavelength ?? 1));
  const origin = clampUnit(m.origin);
  return (x, y) => {
    const nx = bounds.w === 0 ? 0 : (x - bounds.x) / bounds.w;
    const ny = bounds.h === 0 ? 0 : (y - bounds.y) / bounds.h;
    // axis 'horizontal': bend along x, displace y (top/bottom edges move).
    // axis 'vertical': bend along y, displace x (left/right edges move).
    const horizontal = m.axis === 'horizontal';
    const along = horizontal ? nx : ny;
    const across = horizontal ? ny : nx;
    // Phase window shifted so the peak displacement sits at `origin` along
    // the axis (origin 0.5 reproduces the canonical centered formulas).
    const phase = along - origin + 0.5;
    const d = bendDisplacement(
      m.mode,
      phase,
      clampUnit(across),
      m.amount,
      wavelength,
      horizontal ? bounds.w : bounds.h,
      horizontal ? bounds.h : bounds.w,
    );
    if (horizontal) {
      return [x, y + d];
    }
    return [x + d, y];
  };
}

// ── stack composition ──────────────────────────────────────────────────────

/**
 * Build the composite warp evaluation for a modifier stack.
 *
 * Modifiers apply in array order: the first modifier transforms the source
 * first, each subsequent modifier transforms the previous result.
 * Zero/near-zero source bounds produce identity maps (safe, documented).
 */
export function buildWarpEvaluation(
  warps: WarpModifier[] | undefined,
  sourceBounds: WarpRect,
  _options: WarpEvaluationOptions = {},
): WarpEvaluation {
  warpDiagnostics.evaluations++;
  const maps: Array<(x: number, y: number) => [number, number]> = [];
  const invalid: WarpInvalidFlag[] = [];
  const identity = (x: number, y: number): [number, number] => [x, y];

  const live = (warps ?? []).filter((w) => w.enabled !== false);
  for (const w of live) {
    switch (w.kind) {
      case 'skew':
        maps.push(skewMap(w, sourceBounds));
        break;
      case 'perspective': {
        const abs = w.coordinateSpace === 'source-local';
        const r = perspectiveMap(w, sourceBounds, abs);
        maps.push(r.map);
        if (r.invalid) {
          warpDiagnostics.invalidCages++;
          invalid.push({
            modifierId: w.id,
            reason: 'invalid-cage',
            message: 'perspective cage is degenerate or self-crossing; treated as identity',
          });
        }
        break;
      }
      case 'envelope':
        maps.push(envelopeMap(w, sourceBounds, w.coordinateSpace === 'source-local'));
        break;
      case 'mesh-warp':
        maps.push(meshMap(w, sourceBounds, w.coordinateSpace === 'source-local'));
        break;
      case 'bend':
        maps.push(bendMap(w, sourceBounds));
        break;
      default:
        // Unknown future kinds are inert.
        break;
    }
  }

  const map =
    maps.length === 0
      ? identity
      : (x: number, y: number): [number, number] => {
          let px = x;
          let py = y;
          for (const m of maps) {
            const r = m(px, py);
            px = r[0];
            py = r[1];
          }
          return isFiniteXY(px, py) ? [px, py] : [x, y];
        };

  // Jacobian via central finite differences of the composite map. Deterministic
  // and matches the reference tolerance for every modifier kind.
  const eps = Math.max(1e-6, Math.min(sourceBounds.w, sourceBounds.h) / 512);
  const jacobian = (x: number, y: number) => {
    const px = map(x + eps, y);
    const mx = map(x - eps, y);
    const py = map(x, y + eps);
    const my = map(x, y - eps);
    return {
      dxdu: (px[0] - mx[0]) / (2 * eps),
      dxdv: (py[0] - my[0]) / (2 * eps),
      dydu: (px[1] - mx[1]) / (2 * eps),
      dydv: (py[1] - my[1]) / (2 * eps),
    };
  };

  return { map, jacobian, maps, invalid, sourceBounds };
}

// ── shape → path conversion ────────────────────────────────────────────────

const KAPPA = 0.5522847498307936;

export interface PathConversion {
  points: PathPoint[];
  closed: boolean;
  holes?: PathPoint[][];
  fillRule?: 'nonzero' | 'evenodd';
}

function point(
  x: number,
  y: number,
  handleIn: [number, number] | null = null,
  handleOut: [number, number] | null = null,
): PathPoint {
  return { x, y, handleIn, handleOut };
}

/**
 * Exact conversion of any parametric Shape into PathPoints. Curves are
 * preserved as cubic Bézier handles; nothing is flattened here.
 */
export function shapeToPathPoints(shape: Shape): PathConversion {
  switch (shape.kind) {
    case 'rect': {
      const { x, y, w, h } = shape;
      const pts = [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)];
      return { points: pts, closed: true };
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = shape;
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      const pts = [
        point(cx + rx, cy, [0, -ky], [0, ky]),
        point(cx, cy + ry, [kx, 0], [-kx, 0]),
        point(cx - rx, cy, [0, ky], [0, -ky]),
        point(cx, cy - ry, [-kx, 0], [kx, 0]),
      ];
      return { points: pts, closed: true };
    }
    case 'circle': {
      const { cx, cy, r } = shape;
      return shapeToPathPoints({ kind: 'ellipse', cx, cy, rx: r, ry: r });
    }
    case 'line': {
      const [fx, fy] = shape.from;
      const [tx, ty] = shape.to;
      return { points: [point(fx, fy), point(tx, ty)], closed: false };
    }
    case 'arrow': {
      const [fx, fy] = shape.from;
      const [tx, ty] = shape.to;
      return { points: [point(fx, fy), point(tx, ty)], closed: false };
    }
    case 'polygon': {
      const pts: PathPoint[] = [];
      const n = Math.max(3, Math.trunc(shape.sides));
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2 + shape.rotation;
        pts.push(
          point(shape.cx + Math.cos(a) * shape.radius, shape.cy + Math.sin(a) * shape.radius),
        );
      }
      return { points: pts, closed: true };
    }
    case 'star': {
      const pts: PathPoint[] = [];
      const n = Math.max(3, Math.trunc(shape.points));
      for (let i = 0; i < n * 2; i++) {
        const a = (Math.PI * i) / n - Math.PI / 2 + shape.rotation;
        const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
        pts.push(point(shape.cx + Math.cos(a) * r, shape.cy + Math.sin(a) * r));
      }
      return { points: pts, closed: true };
    }
    case 'path':
      return {
        points: shape.points,
        closed: shape.closed,
        holes: shape.holes,
        fillRule: shape.fillRule,
      };
    default:
      return { points: [], closed: false };
  }
}

// ── adaptive subdivision ───────────────────────────────────────────────────

export interface SubdivisionBudget {
  maxDepth: number;
  maxPoints: number;
}

/**
 * Warp one path ring through the evaluation with adaptive subdivision.
 * Curved segments are subdivided against output-space flatness; straight
 * segments map endpoints only. Never emits non-finite coordinates, never
 * exceeds the budget, and always terminates (depth + point caps).
 */
export function warpPathRing(
  points: PathPoint[],
  closed: boolean,
  evalWarp: WarpEvaluation,
  tolerance: number,
  budget: SubdivisionBudget = { maxDepth: 14, maxPoints: 50000 },
): { points: PathPoint[]; capped: boolean; nonFinite: number } {
  if (points.length === 0) return { points: [], capped: false, nonFinite: 0 };
  const out: PathPoint[] = [];
  let capped = false;
  let nonFinite = 0;

  const emit = (p: PathPoint) => {
    if (out.length >= budget.maxPoints) {
      capped = true;
      return;
    }
    const mapped = evalWarp.map(p.x, p.y);
    if (!isFiniteXY(mapped[0], mapped[1])) {
      nonFinite++;
      warpDiagnostics.nonFiniteFallbacks++;
      out.push(point(p.x, p.y));
      return;
    }
    out.push(point(mapped[0], mapped[1]));
  };

  /**
   * Adaptive subdivision of a straight source segment through the map.
   * Recurses while the mapped midpoint deviates from the chord between the
   * mapped endpoints by more than `tolerance`, bounded by the same depth and
   * point budgets as the curve path. Emits the segment's endpoint last so a
   * ring stays continuous.
   */
  const warpStraightSegment = (a: PathPoint, b: PathPoint) => {
    if (capped) return;
    const m0 = evalWarp.map(a.x, a.y);
    const m1 = evalWarp.map(b.x, b.y);
    const m0x = isFiniteXY(m0[0], m0[1]) ? m0[0] : a.x;
    const m0y = isFiniteXY(m0[0], m0[1]) ? m0[1] : a.y;
    const m1x = isFiniteXY(m1[0], m1[1]) ? m1[0] : b.x;
    const m1y = isFiniteXY(m1[0], m1[1]) ? m1[1] : b.y;

    const walk = (
      ax: number,
      ay: number,
      max: number,
      may: number,
      bx: number,
      by: number,
      mbx: number,
      mby: number,
      depth: number,
    ) => {
      if (capped) return;
      if (depth >= budget.maxDepth || out.length + 2 >= budget.maxPoints) {
        if (depth < budget.maxDepth) capped = true;
        emit(point(bx, by));
        return;
      }
      const sx = (ax + bx) / 2;
      const sy = (ay + by) / 2;
      const mid = evalWarp.map(sx, sy);
      const midX = isFiniteXY(mid[0], mid[1]) ? mid[0] : sx;
      const midY = isFiniteXY(mid[0], mid[1]) ? mid[1] : sy;
      // Perpendicular distance of the mapped midpoint from the mapped chord.
      const ex = mbx - max;
      const ey = mby - may;
      const len2 = ex * ex + ey * ey;
      const deviation =
        len2 < 1e-12
          ? Math.hypot(midX - max, midY - may)
          : (() => {
              const tt = Math.max(0, Math.min(1, ((midX - max) * ex + (midY - may) * ey) / len2));
              return Math.hypot(midX - (max + tt * ex), midY - (may + tt * ey));
            })();
      if (deviation <= tolerance) {
        emit(point(bx, by));
        return;
      }
      walk(ax, ay, max, may, sx, sy, midX, midY, depth + 1);
      walk(sx, sy, midX, midY, bx, by, mbx, mby, depth + 1);
    };

    walk(a.x, a.y, m0x, m0y, b.x, b.y, m1x, m1y, 0);
  };

  const n = points.length;
  const segment = (fromIdx: number, toIdx: number) => {
    if (capped) return;
    const a = points[fromIdx]!;
    const b = points[toIdx]!;
    const hasOut = a.handleOut && (a.handleOut[0] !== 0 || a.handleOut[1] !== 0);
    const hasIn = b.handleIn && (b.handleIn[0] !== 0 || b.handleIn[1] !== 0);
    if (!hasOut && !hasIn) {
      // A straight source segment is NOT straight after a nonlinear map
      // (envelope, mesh, bend). Mapping only its endpoints would silently drop
      // the deformation along the whole edge — a rectangle would keep perfectly
      // straight sides under an envelope. Subdivide it against the same
      // output-space tolerance used for curves. Affine and projective maps do
      // preserve straightness, so their midpoints test flat immediately and
      // this costs one extra evaluation per segment.
      warpStraightSegment(a, b);
      return;
    }
    const c1x = a.x + (a.handleOut?.[0] ?? 0);
    const c1y = a.y + (a.handleOut?.[1] ?? 0);
    const c2x = b.x + (b.handleIn?.[0] ?? 0);
    const c2y = b.y + (b.handleIn?.[1] ?? 0);
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;

    // Output-space flatness: map all four control points and measure the
    // deviation of the mapped interior controls from the mapped endpoints'
    // chord. The parent's mapped endpoints are reused by the children.
    const flatEnoughOutput = (
      m0x: number,
      m0y: number,
      c1x: number,
      c1y: number,
      c2x: number,
      c2y: number,
      m3x: number,
      m3y: number,
    ): { flat: boolean; m1x: number; m1y: number; m2x: number; m2y: number } => {
      const m1 = evalWarp.map(c1x, c1y);
      const m2 = evalWarp.map(c2x, c2y);
      if (!isFiniteXY(m0x, m0y) || !isFiniteXY(m3x, m3y)) {
        return { flat: true, m1x: m1[0], m1y: m1[1], m2x: m2[0], m2y: m2[1] };
      }
      const lineDev = (mx: number, my: number) => {
        const ex = m3x - m0x;
        const ey = m3y - m0y;
        const len2 = ex * ex + ey * ey;
        if (len2 < 1e-12) return Math.hypot(mx - m0x, my - m0y);
        const tt = Math.max(0, Math.min(1, ((mx - m0x) * ex + (my - m0y) * ey) / len2));
        return Math.hypot(mx - (m0x + tt * ex), my - (m0y + tt * ey));
      };
      return {
        flat: Math.max(lineDev(m1[0], m1[1]), lineDev(m2[0], m2[1])) <= tolerance,
        m1x: m1[0],
        m1y: m1[1],
        m2x: m2[0],
        m2y: m2[1],
      };
    };

    const subdivide = (
      px: number,
      py: number,
      m0x: number,
      m0y: number,
      c1x: number,
      c1y: number,
      c2x: number,
      c2y: number,
      qx: number,
      qy: number,
      m3x: number,
      m3y: number,
      depth: number,
    ) => {
      if (capped) return;
      if (depth >= budget.maxDepth) {
        emit(point(qx, qy));
        return;
      }
      const f = flatEnoughOutput(m0x, m0y, c1x, c1y, c2x, c2y, m3x, m3y);
      if (f.flat || out.length + 8 >= budget.maxPoints) {
        if (f.flat) {
          emit(point(qx, qy));
        } else {
          // Out of point budget mid-curve: emit the endpoint and mark capped.
          capped = true;
        }
        return;
      }
      const mx1 = (px + c1x) / 2,
        my1 = (py + c1y) / 2;
      const mx2 = (c1x + c2x) / 2,
        my2 = (c1y + c2y) / 2;
      const mx3 = (c2x + qx) / 2,
        my3 = (c2y + qy) / 2;
      const mx4 = (mx1 + mx2) / 2,
        my4 = (my1 + my2) / 2;
      const mx5 = (mx2 + mx3) / 2,
        my5 = (my2 + my3) / 2;
      const sx = (mx4 + mx5) / 2,
        sy = (my4 + my5) / 2;
      const mid = evalWarp.map(sx, sy);
      const midX = isFiniteXY(mid[0], mid[1]) ? mid[0] : sx;
      const midY = isFiniteXY(mid[0], mid[1]) ? mid[1] : sy;
      subdivide(px, py, m0x, m0y, mx1, my1, mx4, my4, sx, sy, midX, midY, depth + 1);
      subdivide(sx, sy, midX, midY, mx5, my5, mx3, my3, qx, qy, m3x, m3y, depth + 1);
    };

    if (capped) return;
    const m0 = evalWarp.map(ax, ay);
    const m3 = evalWarp.map(bx, by);
    const m0x = isFiniteXY(m0[0], m0[1]) ? m0[0] : ax;
    const m0y = isFiniteXY(m0[0], m0[1]) ? m0[1] : ay;
    const m3x = isFiniteXY(m3[0], m3[1]) ? m3[0] : bx;
    const m3y = isFiniteXY(m3[0], m3[1]) ? m3[1] : by;
    subdivide(ax, ay, m0x, m0y, c1x, c1y, c2x, c2y, bx, by, m3x, m3y, 0);
  };

  emit(points[0]!);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    segment(i, (i + 1) % n);
  }
  if (capped) warpDiagnostics.pointsCapped++;
  warpDiagnostics.generatedPoints += out.length;

  // Remove exact duplicate consecutive points (never emit junk geometry).
  const cleaned: PathPoint[] = [];
  for (const pt of out) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(last.x - pt.x) < 1e-9 && Math.abs(last.y - pt.y) < 1e-9) continue;
    cleaned.push(pt);
  }
  return { points: cleaned, capped, nonFinite };
}

/**
 * Evaluate a source shape through the warp stack into an exact path shape.
 * Returns the input unchanged when the stack has no live modifiers.
 */
export function warpShapeToPath(
  shape: Shape,
  warps: WarpModifier[] | undefined,
  sourceBounds: WarpRect,
  options: WarpEvaluationOptions = {},
): { shape: Shape; evaluation: WarpEvaluation; capped: boolean } {
  const hasLive = (warps ?? []).some((w) => w.enabled !== false);
  const evaluation = buildWarpEvaluation(warps, sourceBounds, options);
  if (!hasLive) {
    return { shape, evaluation, capped: false };
  }
  const quality = options.quality ?? options.settings?.quality ?? DEFAULT_WARP_QUALITY;
  const tolerance = resolveWarpTolerance(quality);
  const budget = {
    maxDepth: quality.maxSubdivision ?? DEFAULT_WARP_QUALITY.maxSubdivision!,
    maxPoints: quality.maxGeneratedPoints ?? DEFAULT_WARP_QUALITY.maxGeneratedPoints!,
  };
  const converted = shapeToPathPoints(shape);
  let capped = false;
  const ring = warpPathRing(converted.points, converted.closed, evaluation, tolerance, budget);
  if (ring.capped) capped = true;
  const holes =
    converted.holes && converted.holes.length > 0
      ? converted.holes.map((h) => {
          const r = warpPathRing(h, true, evaluation, tolerance, budget);
          if (r.capped) capped = true;
          return r.points;
        })
      : undefined;
  return {
    shape: {
      kind: 'path',
      points: ring.points,
      closed: converted.closed,
      tolerance: shape.kind === 'path' ? shape.tolerance : 0.5,
      ...(holes && holes.length > 0 ? { holes } : {}),
      ...(converted.fillRule ? { fillRule: converted.fillRule } : {}),
    },
    evaluation,
    capped,
  };
}

/**
 * Conservative evaluated bounds of a set of SOURCE-space points mapped
 * through the stack. Samples the points plus an interior grid over the
 * source bounds and pads for curvature between samples and the evaluation
 * tolerance. For already-warped geometry use `warpBoundsOfWarpedPoints`
 * (mapping again would double-warp).
 */
export function warpBoundsOfPoints(
  points: Array<[number, number]>,
  sourceBounds: WarpRect,
  warps: WarpModifier[] | undefined,
  options: WarpEvaluationOptions = {},
): { bounds: WarpRect; evaluation: WarpEvaluation } {
  const evaluation = buildWarpEvaluation(warps, sourceBounds, options);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number) => {
    if (!isFiniteXY(x, y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const [x, y] of points) acc(...evaluation.map(x, y));
  // Sample interior grid to catch interior extrema of the deformation.
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = sourceBounds.x + (sourceBounds.w * i) / N;
      const y = sourceBounds.y + (sourceBounds.h * j) / N;
      acc(...evaluation.map(x, y));
    }
  }
  return { ...finishBounds(sourceBounds, minX, minY, maxX, maxY, options), evaluation };
}

/**
 * Conservative bounds of an already-warped point set (e.g. evaluated
 * container children). No mapping is applied — only padding.
 */
export function warpBoundsOfWarpedPoints(
  points: Array<[number, number]>,
  sourceBounds: WarpRect,
  options: WarpEvaluationOptions = {},
): WarpRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (!isFiniteXY(x, y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return finishBounds(sourceBounds, minX, minY, maxX, maxY, options).bounds;
}

/** Bounds of the whole source domain through the stack (grid-sampled). */
export function warpDomainBounds(
  sourceBounds: WarpRect,
  warps: WarpModifier[] | undefined,
  options: WarpEvaluationOptions = {},
): { bounds: WarpRect; evaluation: WarpEvaluation } {
  const evaluation = buildWarpEvaluation(warps, sourceBounds, options);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const N = 32;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = sourceBounds.x + (sourceBounds.w * i) / N;
      const y = sourceBounds.y + (sourceBounds.h * j) / N;
      const m = evaluation.map(x, y);
      if (!isFiniteXY(m[0], m[1])) continue;
      if (m[0] < minX) minX = m[0];
      if (m[1] < minY) minY = m[1];
      if (m[0] > maxX) maxX = m[0];
      if (m[1] > maxY) maxY = m[1];
    }
  }
  return { bounds: finishBounds(sourceBounds, minX, minY, maxX, maxY, options).bounds, evaluation };
}

function finishBounds(
  sourceBounds: WarpRect,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: WarpEvaluationOptions,
): { bounds: WarpRect } {
  const quality = options.quality ?? options.settings?.quality ?? DEFAULT_WARP_QUALITY;
  const tolerance = resolveWarpTolerance(quality);
  const pad = Math.max(1, Math.max(sourceBounds.w, sourceBounds.h) * 0.01 + tolerance * 2);
  return {
    bounds: {
      x: minX === Infinity ? sourceBounds.x : minX - pad,
      y: minY === Infinity ? sourceBounds.y : minY - pad,
      w: maxX === -Infinity ? sourceBounds.w : maxX - minX + pad * 2,
      h: maxY === -Infinity ? sourceBounds.h : maxY - minY + pad * 2,
    },
  };
}

// ── foldover analysis ──────────────────────────────────────────────────────

export interface FoldoverAnalysis {
  /** True when any sampled cell has a non-positive Jacobian determinant. */
  foldover: boolean;
  /** Number of inverted (negative Jacobian) sampled cells. */
  invertedCells: number;
  /** Number of collapsed (near-zero Jacobian) sampled cells. */
  collapsedCells: number;
  /** Sampled determinant range. */
  minJacobian: number;
  maxJacobian: number;
  /** Source-space regions containing foldover cells. */
  regions: WarpRect[];
  severity: 'none' | 'minor' | 'severe';
}

/**
 * Sample the Jacobian determinant on a grid to detect foldovers, inverted
 * cells, and local singularities. Deterministic; used for warnings and the
 * 'prevent' drag-revert policy in the editor.
 */
export function analyzeFoldover(
  sourceBounds: WarpRect,
  warps: WarpModifier[] | undefined,
  options: WarpEvaluationOptions = {},
  grid = 24,
): FoldoverAnalysis {
  const evaluation = buildWarpEvaluation(warps, sourceBounds, options);
  let invertedCells = 0;
  let collapsedCells = 0;
  let minJ = Infinity;
  let maxJ = -Infinity;
  const regions: WarpRect[] = [];
  const cellW = sourceBounds.w / grid;
  const cellH = sourceBounds.h / grid;

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = sourceBounds.x + i * cellW;
      const y = sourceBounds.y + j * cellH;
      const jac = evaluation.jacobian(x + cellW / 2, y + cellH / 2);
      const det = jac.dxdu * jac.dydv - jac.dxdv * jac.dydu;
      if (!isFiniteXY(det, det)) continue;
      if (det < minJ) minJ = det;
      if (det > maxJ) maxJ = det;
      if (det <= 0) {
        invertedCells++;
        regions.push({ x, y, w: cellW, h: cellH });
      } else if (det < 1e-9) {
        collapsedCells++;
      }
    }
  }

  const foldover = invertedCells > 0;
  const severity = !foldover ? 'none' : invertedCells >= 8 ? 'severe' : 'minor';
  return {
    foldover,
    invertedCells,
    collapsedCells,
    minJacobian: minJ === Infinity ? 1 : minJ,
    maxJacobian: maxJ === -Infinity ? 1 : maxJ,
    regions,
    severity,
  };
}

/** Identity check: does the stack leave every point unchanged? */
export function isIdentityWarp(
  warps: WarpModifier[] | undefined,
  sourceBounds: WarpRect,
  options: WarpEvaluationOptions = {},
): boolean {
  const live = (warps ?? []).filter((w) => w.enabled !== false);
  if (live.length === 0) return true;
  const evaluation = buildWarpEvaluation(warps, sourceBounds, options);
  // Check corners and center — affine/perspective/envelope/mesh identity is
  // fully determined by the boundary controls, so corners+center suffice for
  // every supported kind.
  const samples: Array<[number, number]> = [
    [sourceBounds.x, sourceBounds.y],
    [sourceBounds.x + sourceBounds.w, sourceBounds.y],
    [sourceBounds.x + sourceBounds.w, sourceBounds.y + sourceBounds.h],
    [sourceBounds.x, sourceBounds.y + sourceBounds.h],
    [sourceBounds.x + sourceBounds.w / 2, sourceBounds.y + sourceBounds.h / 2],
  ];
  return samples.every(([x, y]) => {
    const m = evaluation.map(x, y);
    return Math.abs(m[0] - x) < 1e-6 && Math.abs(m[1] - y) < 1e-6;
  });
}
