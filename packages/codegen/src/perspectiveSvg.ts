/**
 * SVG perspective (four-corner) image export.
 *
 * SVG has no projective image primitive, so a perspective-transformed image
 * fill is approximated by subdividing the node box into a grid of triangles,
 * each mapped by an affine matrix — a piecewise-affine approximation of the
 * global homography. This is the standard technique for non-affine image
 * warps in SVG/PDF (both have affine-only transforms).
 *
 * Coordinate pipeline (all in node-local space unless noted):
 *   raw image px --(drawRect scale+translate)--> pre-content node-local
 *     --(contentTransform: rotate/flip about drawRect center)--> node-local
 *     --(perspective homography)--> warped node-local
 *
 * Per triangle, the affine matrix maps RAW IMAGE px → WARPED node-local,
 * combining the content transform and the perspective warp into one matrix.
 */

import {
  applyHomography,
  isQuadValid,
  solveHomography,
  type Homography,
  type Quad,
  type Vec2,
} from '@varve/engine';
import type { ImagePlacement } from '@varve/engine';
import { perspectiveQuadToEngineQuad, type PerspectiveQuad } from '@varve/scene';

export interface PerspectiveSvgInput {
  href: string;
  /** Node-local box (0,0)-(w,h) — the homography's source rectangle. */
  w: number;
  h: number;
  /** Destination quad [TL, TR, BR, BL] in node-local coords ([x,y] tuples). */
  quad: PerspectiveQuad;
  nodeId: string;
  indent: string;
  minify: boolean;
  /** Grid subdivision per axis. 4 → 32 triangles. */
  gridSize?: number;
  /**
   * Flat placement for the same fill (from `computeImagePlacement`). When
   * given, source grid vertices are mapped to raw image pixels through its
   * inverse content transform; when omitted, node-local == raw px is assumed
   * (identity sampling — correct only for a full-frame, unrotated image).
   */
  placement?: ImagePlacement;
  /** Raw image natural size; defaults to the node box. */
  sourceWidth?: number;
  sourceHeight?: number;
}

/** 2D point as a mutable-friendly tuple-free record. */
interface Pt {
  x: number;
  y: number;
}

/**
 * Inverse content transform for one point.
 *
 * Forward (SVG): translate(cx,cy) · rotate(θ) · scale(sx,sy) · translate(-cx,-cy)
 * Inverse:       translate(cx,cy) · rotate(-θ) · scale(±1) · translate(-cx,-cy)
 *
 * sx/sy are ±1 (flips), so their inverse equals themselves.
 */
function contentInverse(
  p: Pt,
  rotationDeg: number,
  flipH: boolean,
  flipV: boolean,
  cx: number,
  cy: number,
): Pt {
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: cx + rx * (flipH ? -1 : 1),
    y: cy + ry * (flipV ? -1 : 1),
  };
}

/**
 * Solve a 2D affine transform mapping source triangle to destination triangle.
 * Returns an SVG `matrix(a b c d e f)` string; identity when degenerate.
 */
export function triAffine(
  srcTri: readonly [Pt, Pt, Pt],
  dstTri: readonly [Pt, Pt, Pt],
): string {
  const M: number[][] = [
    [srcTri[0].x, srcTri[0].y, 1, 0, 0, 0, dstTri[0].x],
    [0, 0, 0, srcTri[0].x, srcTri[0].y, 1, dstTri[0].y],
    [srcTri[1].x, srcTri[1].y, 1, 0, 0, 0, dstTri[1].x],
    [0, 0, 0, srcTri[1].x, srcTri[1].y, 1, dstTri[1].y],
    [srcTri[2].x, srcTri[2].y, 1, 0, 0, 0, dstTri[2].x],
    [0, 0, 0, srcTri[2].x, srcTri[2].y, 1, dstTri[2].y],
  ];

  for (let col = 0; col < 6; col++) {
    let maxRow = col;
    let maxAbs = Math.abs(M[col]![col] as number);
    for (let row = col + 1; row < 6; row++) {
      const v = Math.abs(M[row]![col] as number);
      if (v > maxAbs) {
        maxAbs = v;
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      const tmp = M[col]!;
      M[col] = M[maxRow]!;
      M[maxRow] = tmp;
    }
    if (Math.abs(M[col]![col] as number) < 1e-12) return 'matrix(1 0 0 1 0 0)';
    for (let row = col + 1; row < 6; row++) {
      const f = (M[row]![col] as number) / (M[col]![col] as number);
      for (let j = col; j < 7; j++) M[row]![j] = (M[row]![j] as number) - f * (M[col]![j] as number);
    }
  }
  const x = new Float64Array(6);
  for (let i = 5; i >= 0; i--) {
    let sum: number = M[i]![6]!;
    for (let j = i + 1; j < 6; j++) sum -= M[i]![j]! * x[j]!;
    x[i] = sum / M[i]![i]!;
  }

  // Solver rows produce unknowns in order [a, c, e, b, d, f]; SVG's
  // matrix(a b c d e f) expects column-major pairs, so reorder.
  const f = (n: number): number => (Math.abs(n) < 1e-10 ? 0 : +n.toFixed(6));
  return `matrix(${f(x[0] ?? 0)} ${f(x[3] ?? 0)} ${f(x[1] ?? 0)} ${f(x[4] ?? 0)} ${f(x[2] ?? 0)} ${f(x[5] ?? 0)})`;
}

/**
 * Build a perspective-warped image as a grid of affine-mapped triangles.
 *
 * Returns null when the quad is invalid/degenerate or the box is empty —
 * callers then fall back to the flat image emit rather than dropping the
 * fill silently.
 */
export function buildPerspectiveImageSvg(input: PerspectiveSvgInput): string | null {
  const { w, h, quad } = input;
  const gridSize = Math.max(1, Math.floor(input.gridSize ?? 4));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const engineQuad: Quad = perspectiveQuadToEngineQuad(quad);
  if (!isQuadValid(engineQuad)) return null;

  const srcRect: Quad = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const H: Homography | null = solveHomography(srcRect, engineQuad);
  if (!H) return null;

  // Warped grid — every source grid vertex through the homography.
  const destGrid: Vec2[][] = [];
  for (let row = 0; row <= gridSize; row++) {
    destGrid[row] = [];
    for (let col = 0; col <= gridSize; col++) {
      const u = (col / gridSize) * w;
      const v = (row / gridSize) * h;
      destGrid[row]![col] = applyHomography(H, { x: u, y: v });
    }
  }

  // Raw-image sampling grid — inverse content transform + drawRect mapping
  // from node-local back to raw image pixels.
  const srcGrid: Pt[][] = input.placement
    ? (() => {
        const p: ImagePlacement = input.placement;
        const cx = p.drawRect.x + p.drawRect.w / 2;
        const cy = p.drawRect.y + p.drawRect.h / 2;
        return buildSamplingGrid(gridSize, w, h, (pt) => {
          const inv = contentInverse(pt, p.rotation, p.flipH, p.flipV, cx, cy);
          return {
            x: ((inv.x - p.drawRect.x) / p.drawRect.w) * p.sourceWidth,
            y: ((inv.y - p.drawRect.y) / p.drawRect.h) * p.sourceHeight,
          };
        });
      })()
    : buildSamplingGrid(gridSize, w, h);

  const nl = input.minify ? '' : '\n';
  const parts: string[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      emitTriangle(parts, input.nodeId, row, col, 'a', [
        srcGrid[row]![col]!,
        srcGrid[row]![col + 1]!,
        srcGrid[row + 1]![col]!,
      ], [
        destGrid[row]![col]!,
        destGrid[row]![col + 1]!,
        destGrid[row + 1]![col]!,
      ], input);
      emitTriangle(parts, input.nodeId, row, col, 'b', [
        srcGrid[row]![col + 1]!,
        srcGrid[row + 1]![col + 1]!,
        srcGrid[row + 1]![col]!,
      ], [
        destGrid[row]![col + 1]!,
        destGrid[row + 1]![col + 1]!,
        destGrid[row + 1]![col]!,
      ], input);
    }
  }

  return parts.join(nl);
}

function buildSamplingGrid(
  gridSize: number,
  w: number,
  h: number,
  map?: (p: Pt) => Pt,
): Pt[][] {
  const grid: Pt[][] = [];
  for (let row = 0; row <= gridSize; row++) {
    grid[row] = [];
    for (let col = 0; col <= gridSize; col++) {
      const pt = { x: (col / gridSize) * w, y: (row / gridSize) * h };
      grid[row]![col] = map ? map(pt) : pt;
    }
  }
  return grid;
}

function emitTriangle(
  parts: string[],
  nodeId: string,
  row: number,
  col: number,
  half: 'a' | 'b',
  srcTri: readonly [Pt, Pt, Pt],
  dstTri: readonly [Pt, Pt, Pt],
  input: PerspectiveSvgInput,
): void {
  const clipId = `tp-${nodeId}-${row}-${col}-${half}`;
  const pts = dstTri.map((p) => `${round6(p.x)},${round6(p.y)}`).join(' ');
  const matrix = triAffine(srcTri, dstTri);
  parts.push(
    `${input.indent}  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${pts}" /></clipPath>`,
  );
  parts.push(
    `${input.indent}  <g clip-path="url(#${clipId})"><image href="${input.href}" x="0" y="0" width="${round6(input.sourceWidth ?? input.w)}" height="${round6(input.sourceHeight ?? input.h)}" preserveAspectRatio="none" transform="${matrix}" /></g>`,
  );
}

function round6(n: number): string {
  return String(+n.toFixed(6));
}
