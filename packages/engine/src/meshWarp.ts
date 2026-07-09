/**
 * Mesh warp — planar mesh-based image deformation.
 *
 * Architecture:
 *   A (cols+1) x (rows+1) grid of control points defines a deformation field.
 *   Each quad cell is split into 2 triangles; output pixels are located in
 *   source space via barycentric interpolation across the deformed mesh.
 *
 * Research basis: Photoshop Liquify mesh, Illustrator Envelope Distort,
 *   Beier-Neely line morphing (deferred), MLS deformation (deferred).
 */

/**
 * A 2D control point for the mesh warp grid.
 */
export interface MeshControlPoint {
  x: number;
  y: number;
}

/**
 * A mesh warp deformation grid.
 *
 * The mesh has (cols+1) * (rows+1) control points arranged in row-major order.
 * vertices[r * (cols+1) + c] is the control point at grid position (c, r).
 * Vertices are in world/document coordinates.
 */
export interface MeshWarp {
  cols: number;
  rows: number;
  vertices: MeshControlPoint[];
}

export interface MeshWarpCell {
  /** Four corner control point indices (top-left, top-right, bottom-right, bottom-left). */
  indices: [number, number, number, number];
}

/** Triangle formed by three control point indices from a mesh cell. */
export interface MeshTriangle {
  a: MeshControlPoint;
  b: MeshControlPoint;
  c: MeshControlPoint;
}

/**
 * Build a flat mesh with the given grid dimensions, covering [0,0] → [w,h].
 * All vertices start at their natural grid positions (no deformation).
 */
export function createFlatMesh(cols: number, rows: number, w: number, h: number): MeshWarp {
  const vertices: MeshControlPoint[] = [];
  const cellW = w / cols;
  const cellH = h / rows;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      vertices.push({ x: c * cellW, y: r * cellH });
    }
  }
  return { cols, rows, vertices };
}

/**
 * Enumerate all triangular faces of a mesh, returning source-aligned triangles
 * (the natural grid positions) and their deformed counterparts.
 */
export function meshTriangles(
  mesh: MeshWarp,
  srcW: number,
  srcH: number,
): { src: MeshTriangle; dst: MeshTriangle }[] {
  const { cols, rows, vertices } = mesh;
  const cellW = srcW / cols;
  const cellH = srcH / rows;
  const v = (r: number, c: number) => r * (cols + 1) + c;

  const triangles: { src: MeshTriangle; dst: MeshTriangle }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = v(r, c);
      const tr = v(r, c + 1);
      const br = v(r + 1, c + 1);
      const bl = v(r + 1, c);

      const sx = c * cellW;
      const sy = r * cellH;
      const ex = (c + 1) * cellW;
      const ey = (r + 1) * cellH;

      // Triangle 1: top-left, top-right, bottom-right
      triangles.push({
        src: {
          a: { x: sx, y: sy },
          b: { x: ex, y: sy },
          c: { x: ex, y: ey },
        },
        dst: {
          a: vertices[tl]!,
          b: vertices[tr]!,
          c: vertices[br]!,
        },
      });

      // Triangle 2: top-left, bottom-right, bottom-left
      triangles.push({
        src: {
          a: { x: sx, y: sy },
          b: { x: ex, y: ey },
          c: { x: sx, y: ey },
        },
        dst: {
          a: vertices[tl]!,
          b: vertices[br]!,
          c: vertices[bl]!,
        },
      });
    }
  }

  return triangles;
}

/**
 * Barycentric coordinates of point P relative to triangle ABC.
 * Returns [u, v, w] where P = u*A + v*B + w*C and u+v+w=1.
 */
function barycentric(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): [number, number, number] | null {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denom) < 1e-12) return null;

  const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
  const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
  const w = 1 - u - v;

  return [u, v, w];
}

/**
 * Check if a point lies inside a triangle (including edges).
 */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const bc = barycentric(px, py, ax, ay, bx, by, cx, cy);
  if (!bc) return false;
  return bc[0] >= -1e-10 && bc[1] >= -1e-10 && bc[2] >= -1e-10;
}

/**
 * Sample a pixel from source data at (x, y) using bilinear interpolation.
 * Coordinates are in source pixel space (may be fractional).
 */
function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const clampX = (v: number) => Math.max(0, Math.min(w - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(h - 1, v));

  const x0 = clampX(ix);
  const x1 = clampX(ix + 1);
  const y0 = clampY(iy);
  const y1 = clampY(iy + 1);

  const idx00 = (y0 * w + x0) * 4;
  const idx10 = (y0 * w + x1) * 4;
  const idx01 = (y1 * w + x0) * 4;
  const idx11 = (y1 * w + x1) * 4;

  const r = (1 - fy) * ((1 - fx) * data[idx00]! + fx * data[idx10]!) +
    fy * ((1 - fx) * data[idx01]! + fx * data[idx11]!);
  const g = (1 - fy) * ((1 - fx) * data[idx00 + 1]! + fx * data[idx10 + 1]!) +
    fy * ((1 - fx) * data[idx01 + 1]! + fx * data[idx11 + 1]!);
  const bvalue = (1 - fy) * ((1 - fx) * data[idx00 + 2]! + fx * data[idx10 + 2]!) +
    fy * ((1 - fx) * data[idx01 + 2]! + fx * data[idx11 + 2]!);
  const a = (1 - fy) * ((1 - fx) * data[idx00 + 3]! + fx * data[idx10 + 3]!) +
    fy * ((1 - fx) * data[idx01 + 3]! + fx * data[idx11 + 3]!);

  return [Math.round(r), Math.round(g), Math.round(bvalue), Math.round(a)];
}

/**
 * Apply a mesh warp deformation to an ImageData buffer.
 *
 * For each pixel in the output, finds which deformed triangle (if any)
 * contains it, computes the corresponding source position via barycentric
 * inversion, and samples the source image with bilinear interpolation.
 *
 * Pixels that map outside all triangles remain unchanged (fill with source).
 *
 * @param src - Source image data (the original pixels)
 * @param mesh - Mesh warp definition with deformed vertex positions
 * @param srcW - Source width in pixels
 * @param srcH - Source height in pixels
 * @param outputW - Output width (defaults to srcW)
 * @param outputH - Output height (defaults to srcH)
 * @returns New ImageData with the warp applied
 */
export function warpMesh(
  src: ImageData,
  mesh: MeshWarp,
  srcW: number,
  srcH: number,
  outputW?: number,
  outputH?: number,
): ImageData {
  const ow = outputW ?? srcW;
  const oh = outputH ?? srcH;
  const result = new ImageData(ow, oh);
  const dst = result.data;
  const srcData = src.data;

  const triangles = meshTriangles(mesh, srcW, srcH);

  // Build spatial index: assign each triangle to a 64px grid cell for faster lookup
  const gridSize = 64;
  const gridCols = Math.max(1, Math.ceil(ow / gridSize));
  const gridRows = Math.max(1, Math.ceil(oh / gridSize));
  const grid: number[][] = Array.from({ length: gridCols * gridRows }, () => []);

  for (let ti = 0; ti < triangles.length; ti++) {
    const { dst: t } = triangles[ti]!;
    const minX = Math.max(0, Math.floor(Math.min(t.a.x, t.b.x, t.c.x) / gridSize));
    const maxX = Math.min(gridCols - 1, Math.floor(Math.max(t.a.x, t.b.x, t.c.x) / gridSize));
    const minY = Math.max(0, Math.floor(Math.min(t.a.y, t.b.y, t.c.y) / gridSize));
    const maxY = Math.min(gridRows - 1, Math.floor(Math.max(t.a.y, t.b.y, t.c.y) / gridSize));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        grid[gy * gridCols + gx]!.push(ti);
      }
    }
  }

  for (let py = 0; py < oh; py++) {
    for (let px = 0; px < ow; px++) {
      const idx = (py * ow + px) * 4;
      const gx = Math.min(gridCols - 1, Math.floor(px / gridSize));
      const gy = Math.min(gridRows - 1, Math.floor(py / gridSize));
      const candidates = grid[gy * gridCols + gx]!;

      let found = false;
      for (const ti of candidates) {
        const { src: s, dst: t } = triangles[ti]!;

        if (!pointInTriangle(px, py, t.a.x, t.a.y, t.b.x, t.b.y, t.c.x, t.c.y)) continue;

        // Found containing triangle — compute source position via barycentric
        const bc = barycentric(px, py, t.a.x, t.a.y, t.b.x, t.b.y, t.c.x, t.c.y);
        if (!bc) continue;

        const [u, v, w] = bc;
        // Source position: u*s.a + v*s.b + w*s.c
        const sx = u * s.a.x + v * s.b.x + w * s.c.x;
        const sy = u * s.a.y + v * s.b.y + w * s.c.y;

        const [r, g, b, a] = sampleBilinear(srcData, srcW, srcH, sx, sy);
        dst[idx] = r;
        dst[idx + 1] = g;
        dst[idx + 2] = b;
        dst[idx + 3] = a;
        found = true;
        break;
      }

      if (!found) {
        // No triangle contains this pixel — copy source directly
        const sx = (px / ow) * srcW;
        const sy = (py / oh) * srcH;
        const [r, g, b, a] = sampleBilinear(srcData, srcW, srcH, sx, sy);
        dst[idx] = r;
        dst[idx + 1] = g;
        dst[idx + 2] = b;
        dst[idx + 3] = a;
      }
    }
  }

  return result;
}
