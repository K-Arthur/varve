/**
 * Mesh envelope warp — rasterize a source rectangle onto a bounded
 * (cols+1) x (rows+1) grid envelope. This is the mockup mesh-surface
 * mapping: folded fabric, draped banners, curved paper.
 *
 * Mapping model: each grid cell is a bilinear patch. Every output pixel in
 * a cell's bounding box is inverted through the closed-form inverse
 * bilinear of that cell to a cell-local (u, v), then sampled from the
 * source at the corresponding sub-rectangle. Bilinear — not projective —
 * is the honest model here: a mesh is an envelope, not a camera, and
 * unlike per-cell homographies the bilinear restriction to a shared edge
 * depends only on that edge's endpoints, so adjacent cells agree exactly
 * and no seam slivers or double-sampling can appear.
 *
 * Boundaries: pixels outside the mesh hull stay transparent (the caller
 * composites the plate beneath), mirroring `warpImageToQuad`. Cells are
 * validated for finiteness, convexity, and minimum area before any pixel
 * work; a folded or degenerate grid returns null so callers can report
 * invalid geometry instead of drawing corrupted output.
 *
 * This module is deliberately separate from `../meshWarp.ts` (the text
 * warp pipeline): that module forward-fills unmeshed pixels with source
 * content and has no validity contract, which would corrupt a mockup
 * composite.
 *
 * Research basis: Illustrator Envelope Distort meshes; OpenCV remap
 * (destination->source inverse family); Heckbert "Fundamentals of Texture
 * Mapping and Image Warping" §3.1.2 (inverse bilinear).
 */

import { sampleBilinear } from './quadWarp';

/** A 2D grid vertex. */
export interface MeshGridPoint {
  x: number;
  y: number;
}

/** Bounded envelope grid. vertices[row][col], row-major, (rows+1) x (cols+1). */
export interface MockupMeshGrid {
  cols: number;
  rows: number;
  vertices: MeshGridPoint[][];
}

/** The four corners of one cell, bilinear naming: p00 top-left, p10 top-right, p01 bottom-left, p11 bottom-right. */
export interface MeshCellCorners {
  p00: MeshGridPoint;
  p10: MeshGridPoint;
  p01: MeshGridPoint;
  p11: MeshGridPoint;
}

/** Grid extent caps mirrored by scene validation; renderer defends too. */
export const MESH_GRID_MAX_COLS = 16;
export const MESH_GRID_MAX_ROWS = 16;

const MIN_CELL_AREA = 1e-2;
const MAX_COORDINATE_MAGNITUDE = 1e9;
const EPSILON = 1e-9;

function pointFiniteBounded(p: MeshGridPoint): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) <= MAX_COORDINATE_MAGNITUDE &&
    Math.abs(p.y) <= MAX_COORDINATE_MAGNITUDE
  );
}

/** Corners of cell (col, row), or null when the indices are out of range. */
export function meshCellCorners(
  grid: MockupMeshGrid,
  col: number,
  row: number,
): MeshCellCorners | null {
  const vertexRow = grid.vertices[row];
  const bottomRow = grid.vertices[row + 1];
  if (!vertexRow || !bottomRow) return null;
  const p00 = vertexRow[col];
  const p10 = vertexRow[col + 1];
  const p01 = bottomRow[col];
  const p11 = bottomRow[col + 1];
  if (!p00 || !p10 || !p01 || !p11) return null;
  return { p00, p10, p01, p11 };
}

/**
 * A cell is usable when its corners are finite and it is strictly convex
 * with nonzero area. Convexity keeps the bilinear map injective (no folded
 * output) and the inverse well-defined.
 */
export function isMeshCellValid(corners: MeshCellCorners): boolean {
  const { p00, p10, p01, p11 } = corners;
  if (
    !pointFiniteBounded(p00) ||
    !pointFiniteBounded(p10) ||
    !pointFiniteBounded(p01) ||
    !pointFiniteBounded(p11)
  ) {
    return false;
  }
  // Shoelace area of the cell polygon (tl, tr, br, bl).
  const area =
    0.5 *
    (p00.x * p10.y -
      p10.x * p00.y +
      (p10.x * p11.y - p11.x * p10.y) +
      (p11.x * p01.y - p01.x * p11.y) +
      (p01.x * p00.y - p00.x * p01.y));
  if (Math.abs(area) < MIN_CELL_AREA) return false;
  // Strict convexity: consecutive edge cross products must share one sign.
  const edges: Array<[MeshGridPoint, MeshGridPoint]> = [
    [p00, p10],
    [p10, p11],
    [p11, p01],
    [p01, p00],
  ];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b] = edges[i]!;
    const [, c] = edges[(i + 1) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < EPSILON) return false;
    const current = cross > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

/** Validate grid shape (caps, exact vertex counts) and every cell. */
export function isMeshGridValid(grid: MockupMeshGrid): boolean {
  if (!grid || typeof grid !== 'object') return false;
  const { cols, rows, vertices } = grid;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return false;
  if (cols < 1 || rows < 1 || cols > MESH_GRID_MAX_COLS || rows > MESH_GRID_MAX_ROWS) return false;
  if (!Array.isArray(vertices) || vertices.length !== rows + 1) return false;
  for (const vertexRow of vertices) {
    if (!Array.isArray(vertexRow) || vertexRow.length !== cols + 1) return false;
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const corners = meshCellCorners(grid, col, row);
      if (!corners || !isMeshCellValid(corners)) return false;
    }
  }
  return true;
}

/**
 * Inverse bilinear: locate the cell-local (u, v) whose bilinear interpolation
 * of the corners hits (x, y), or null when the point does not project into
 * the cell (including numerically degenerate cells).
 */
export function inverseBilinear(
  x: number,
  y: number,
  corners: MeshCellCorners,
): { u: number; v: number } | null {
  const { p00, p10, p01, p11 } = corners;
  const ex = x - p00.x;
  const fy = y - p00.y;
  const a1 = p10.x - p00.x;
  const a2 = p01.x - p00.x;
  const a3 = p11.x - p10.x - p01.x + p00.x;
  const b1 = p10.y - p00.y;
  const b2 = p01.y - p00.y;
  const b3 = p11.y - p10.y - p01.y + p00.y;

  // Solve (b2*a3 - b3*a2) v^2 + (b2*a1 - b1*a2 + b3*ex - a3*fy) v + (b1*ex - a1*fy) = 0,
  // then u = (ex - a2 v) / (a1 + a3 v).
  const A2 = b2 * a3 - b3 * a2;
  const A1 = b2 * a1 - b1 * a2 + b3 * ex - a3 * fy;
  const A0 = b1 * ex - a1 * fy;

  const candidates: Array<{ u: number; v: number; denom: number }> = [];
  const pushCandidate = (v: number): void => {
    const denom = a1 + a3 * v;
    if (Math.abs(denom) < EPSILON) return;
    const u = (ex - a2 * v) / denom;
    if (u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6) {
      candidates.push({ u, v, denom });
    }
  };

  if (Math.abs(A2) < EPSILON) {
    if (Math.abs(A1) < EPSILON) return null;
    pushCandidate(-A0 / A1);
  } else {
    const disc = A1 * A1 - 4 * A2 * A0;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    pushCandidate((-A1 + root) / (2 * A2));
    pushCandidate((-A1 - root) / (2 * A2));
  }

  if (candidates.length === 0) return null;
  // Prefer a strictly interior solution; tie-break on the larger denominator
  // (the numerically stable branch).
  candidates.sort(
    (a, b) => interiorScore(b) - interiorScore(a) || Math.abs(b.denom) - Math.abs(a.denom),
  );
  const best = candidates[0]!;
  return {
    u: Math.min(1, Math.max(0, best.u)),
    v: Math.min(1, Math.max(0, best.v)),
  };
}

function interiorScore(candidate: { u: number; v: number }): number {
  const uInterior = candidate.u >= 0 && candidate.u <= 1 ? 1 : 0;
  const vInterior = candidate.v >= 0 && candidate.v <= 1 ? 1 : 0;
  return uInterior + vInterior;
}

/** Forward bilinear (cell-local (u, v) to output space) — test and handle math. */
export function forwardBilinear(u: number, v: number, corners: MeshCellCorners): MeshGridPoint {
  const { p00, p10, p01, p11 } = corners;
  const w00 = (1 - u) * (1 - v);
  const w10 = u * (1 - v);
  const w01 = (1 - u) * v;
  const w11 = u * v;
  return {
    x: w00 * p00.x + w10 * p10.x + w01 * p01.x + w11 * p11.x,
    y: w00 * p00.y + w10 * p10.y + w01 * p01.y + w11 * p11.y,
  };
}

/** Bounding box of all grid vertices. */
export function meshGridBounds(grid: MockupMeshGrid): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertexRow of grid.vertices) {
    for (const p of vertexRow) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Warp the source rectangle onto the mesh envelope.
 *
 * @param src - source RGBA pixels.
 * @param srcW - source width.
 * @param srcH - source height.
 * @param grid - envelope grid in output coordinates; grid cell (col, row)
 *   corresponds to the source sub-rectangle [(col)/cols, (col+1)/cols] x
 *   [(row)/rows, (row+1)/rows]. Must pass `isMeshGridValid`.
 * @param outW - output width.
 * @param outH - output height.
 * @returns output ImageData (transparent outside the hull), or null when the
 *   grid is invalid (callers must report invalid geometry, not draw it).
 */
export function warpImageToMesh(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  grid: MockupMeshGrid,
  outW: number,
  outH: number,
): ImageData | null {
  if (srcW <= 0 || srcH <= 0 || outW <= 0 || outH <= 0) return null;
  if (src.length < srcW * srcH * 4) return null;
  if (!isMeshGridValid(grid)) return null;

  const out = new ImageData(outW, outH);
  const data = out.data;

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const corners = meshCellCorners(grid, col, row);
      if (!corners) continue;
      const minX = Math.max(
        0,
        Math.floor(Math.min(corners.p00.x, corners.p01.x, corners.p10.x, corners.p11.x)),
      );
      const maxX = Math.min(
        outW - 1,
        Math.ceil(Math.max(corners.p00.x, corners.p01.x, corners.p10.x, corners.p11.x)),
      );
      const minY = Math.max(
        0,
        Math.floor(Math.min(corners.p00.y, corners.p01.y, corners.p10.y, corners.p11.y)),
      );
      const maxY = Math.min(
        outH - 1,
        Math.ceil(Math.max(corners.p00.y, corners.p01.y, corners.p10.y, corners.p11.y)),
      );

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          // Integer sampling (same convention as warpImageToQuad) so an
          // identity grid reproduces the source pixels exactly.
          const local = inverseBilinear(x, y, corners);
          if (!local) continue;
          if (local.u < 0 || local.u > 1 || local.v < 0 || local.v > 1) continue;
          const sx = ((col + local.u) / grid.cols) * srcW;
          const sy = ((row + local.v) / grid.rows) * srcH;
          if (sx < 0 || sy < 0 || sx > srcW || sy > srcH) continue;
          sampleBilinear(src, srcW, srcH, sx, sy, data, (y * outW + x) * 4);
        }
      }
    }
  }
  return out;
}
