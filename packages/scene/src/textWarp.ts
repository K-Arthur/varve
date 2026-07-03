/**
 * Text warp / envelope deformation foundation.
 *
 * Provides pure-math coordinate transforms for creative text effects such as
 * arcs, bulges, flags, fisheyes, and free-form mesh warps. The actual text
 * shaping is handled by the engine's path-text and text-measure modules; this
 * module operates on already-shaped glyph positions to deform them in 2D space.
 *
 * Research basis: Figma text effects, Illustrator envelopes, CSS transform
 * functions, SVG filters, and game-engine vertex displacement.
 */

import type { Point } from '@strata/engine';

export type WarpKind =
  | 'arc'
  | 'arcLower'
  | 'arcUpper'
  | 'bulge'
  | 'shellLower'
  | 'shellUpper'
  | 'flag'
  | 'wave'
  | 'fish'
  | 'rise'
  | 'freeMesh'
  | 'custom';

export interface WarpEnvelope {
  id: string;
  kind: WarpKind;
  /** Strength of the warp, typically -1 to 1. */
  bend: number;
  /** Horizontal distortion, -1 to 1. */
  horizontalDistortion: number;
  /** Vertical distortion, -1 to 1. */
  verticalDistortion: number;
  /** For mesh warps: grid of control points (rows x cols). */
  mesh?: WarpMesh;
  /** For custom warps: arbitrary deformation function. */
  customDeform?: (p: Point, bounds: { x: number; y: number; w: number; h: number }) => Point;
}

export interface WarpMesh {
  rows: number;
  cols: number;
  /** Control points in row-major order, normalized 0-1. */
  points: Point[];
}

export interface WarpedGlyph {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
}

export function makeWarpEnvelope(
  id: string,
  kind: WarpKind,
  bend: number,
  options: Partial<Omit<WarpEnvelope, 'id' | 'kind' | 'bend'>> = {},
): WarpEnvelope {
  return {
    id,
    kind,
    bend: Math.max(-1, Math.min(1, bend)),
    horizontalDistortion: options.horizontalDistortion ?? 0,
    verticalDistortion: options.verticalDistortion ?? 0,
    mesh: options.mesh,
    customDeform: options.customDeform,
  };
}

export function warpPoint(
  point: Point,
  bounds: { x: number; y: number; w: number; h: number },
  envelope: WarpEnvelope,
): Point {
  if (bounds.w === 0 || bounds.h === 0) return point;

  const nx = (point[0] - bounds.x) / bounds.w;
  const ny = (point[1] - bounds.y) / bounds.h;

  switch (envelope.kind) {
    case 'arc':
      return warpArc(point, bounds, nx, envelope.bend, false);
    case 'arcUpper':
      return warpArcUpper(point, bounds, nx, ny, envelope.bend);
    case 'arcLower':
      return warpArcLower(point, bounds, nx, ny, envelope.bend);
    case 'bulge':
      return warpBulge(point, bounds, nx, ny, envelope.bend);
    case 'shellUpper':
      return warpShellUpper(point, bounds, nx, ny, envelope.bend);
    case 'shellLower':
      return warpShellLower(point, bounds, nx, ny, envelope.bend);
    case 'flag':
      return warpFlag(point, bounds, nx, ny, envelope.bend);
    case 'wave':
      return warpWave(point, bounds, nx, ny, envelope.bend, envelope.horizontalDistortion);
    case 'fish':
      return warpFish(point, bounds, nx, ny, envelope.bend);
    case 'rise':
      return warpRise(point, bounds, nx, envelope.bend);
    case 'freeMesh':
      return envelope.mesh ? warpMesh(point, bounds, nx, ny, envelope.mesh) : point;
    case 'custom':
      return envelope.customDeform ? envelope.customDeform(point, bounds) : point;
    default:
      return point;
  }
}

function warpArc(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, bend: number, lower: boolean): Point {
  const radius = bounds.w / 2;
  const bendPx = bend * radius * 0.5;
  const cy = bounds.y + bounds.h / 2 + bendPx;
  const angle = Math.PI + (nx - 0.5) * Math.PI;
  const arcY = cy + Math.cos(angle) * bendPx * (lower ? -1 : 1);
  return [point[0], point[1] + (arcY - (bounds.y + bounds.h / 2))];
}

function warpArcUpper(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * Math.sin(nx * Math.PI) * (1 - ny);
  return [point[0], point[1] - yOffset];
}

function warpArcLower(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * Math.sin(nx * Math.PI) * ny;
  return [point[0], point[1] + yOffset];
}

function warpBulge(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const centerDist = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5));
  const yOffset = bendPx * (1 - centerDist * 2) * (1 - 2 * Math.abs(ny - 0.5));
  return [point[0], point[1] - yOffset];
}

function warpShellUpper(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * (1 - ny) * Math.sin(nx * Math.PI) * 0.5;
  return [point[0], point[1] - yOffset];
}

function warpShellLower(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * ny * Math.sin(nx * Math.PI) * 0.5;
  return [point[0], point[1] + yOffset];
}

function warpFlag(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * Math.sin(nx * Math.PI * 2) * (1 - ny * 0.5);
  return [point[0], point[1] + yOffset];
}

function warpWave(
  point: Point,
  bounds: { x: number; y: number; w: number; h: number },
  nx: number,
  ny: number,
  bend: number,
  frequency: number,
): Point {
  const bendPx = bend * bounds.h * 0.5;
  const freq = 1 + Math.abs(frequency) * 2;
  const yOffset = bendPx * Math.sin(nx * Math.PI * freq) * (1 - ny * 0.3);
  return [point[0], point[1] + yOffset];
}

function warpFish(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * Math.sin(nx * Math.PI) * (ny - 0.5) * 2;
  return [point[0], point[1] + yOffset];
}

function warpRise(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, bend: number): Point {
  const bendPx = bend * bounds.h * 0.5;
  const yOffset = bendPx * nx * nx;
  return [point[0], point[1] - yOffset];
}

function warpMesh(point: Point, bounds: { x: number; y: number; w: number; h: number }, nx: number, ny: number, mesh: WarpMesh): Point {
  const { rows, cols, points } = mesh;
  if (points.length !== rows * cols) return point;

  const col = Math.max(0, Math.min(cols - 2, Math.floor(nx * (cols - 1))));
  const row = Math.max(0, Math.min(rows - 2, Math.floor(ny * (rows - 1))));
  const tx = nx * (cols - 1) - col;
  const ty = ny * (rows - 1) - row;

  const idx = (r: number, c: number) => r * cols + c;
  const p00 = points[idx(row, col)]!;
  const p10 = points[idx(row, col + 1)]!;
  const p01 = points[idx(row + 1, col)]!;
  const p11 = points[idx(row + 1, col + 1)]!;

  const u = bilinear(p00[0], p10[0], p01[0], p11[0], tx, ty);
  const v = bilinear(p00[1], p10[1], p01[1], p11[1], tx, ty);
  return [bounds.x + u * bounds.w, bounds.y + v * bounds.h];
}

function bilinear(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

export function warpGlyph(
  glyph: { x: number; y: number; angle: number },
  bounds: { x: number; y: number; w: number; h: number },
  envelope: WarpEnvelope,
): WarpedGlyph {
  const warped = warpPoint([glyph.x, glyph.y], bounds, envelope);
  const sampleOffset = 0.01;
  const forward = warpPoint([glyph.x + Math.cos(glyph.angle) * sampleOffset, glyph.y + Math.sin(glyph.angle) * sampleOffset], bounds, envelope);
  const warpedAngle = Math.atan2(forward[1] - warped[1], forward[0] - warped[0]);
  const dx = forward[0] - warped[0];
  const dy = forward[1] - warped[1];
  const scale = Math.sqrt(dx * dx + dy * dy) / sampleOffset;
  return { x: warped[0], y: warped[1], angle: warpedAngle, scaleX: scale, scaleY: 1 };
}

export function warpBounds(
  bounds: { x: number; y: number; w: number; h: number },
  envelope: WarpEnvelope,
  samples: number = 16,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      const nx = i / samples;
      const ny = j / samples;
      const p = warpPoint([bounds.x + nx * bounds.w, bounds.y + ny * bounds.h], bounds, envelope);
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
