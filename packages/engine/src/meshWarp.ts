/**
 * Mesh warp — planar mesh-based image & vector deformation.
 *
 * Architecture:
 *   A (cols+1) x (rows+1) grid of control points defines a deformation field.
 *   Each quad cell is split into 2 triangles; output pixels are located in
 *   source space via barycentric interpolation across the deformed mesh.
 *   Vector paths are warped via forward mapping: source points are located
 *   in the grid, bilinearly interpolated across the deformed cell, and
 *   bezier curves are subdivided first for accuracy.
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

  const r =
    (1 - fy) * ((1 - fx) * data[idx00]! + fx * data[idx10]!) +
    fy * ((1 - fx) * data[idx01]! + fx * data[idx11]!);
  const g =
    (1 - fy) * ((1 - fx) * data[idx00 + 1]! + fx * data[idx10 + 1]!) +
    fy * ((1 - fx) * data[idx01 + 1]! + fx * data[idx11 + 1]!);
  const bvalue =
    (1 - fy) * ((1 - fx) * data[idx00 + 2]! + fx * data[idx10 + 2]!) +
    fy * ((1 - fx) * data[idx01 + 2]! + fx * data[idx11 + 2]!);
  const a =
    (1 - fy) * ((1 - fx) * data[idx00 + 3]! + fx * data[idx10 + 3]!) +
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

/**
 * Draw the mesh warp grid and control point handles onto a canvas context.
 */
export function renderWarpGrid(
  ctx: CanvasRenderingContext2D,
  mesh: MeshWarp,
  color: string = '#39d0c6',
  handleColor: string = '#ffffff',
  handleRadius: number = 5,
): void {
  const { cols, rows, vertices } = mesh;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;

  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    const start = vertices[r * (cols + 1)]!;
    ctx.moveTo(start.x, start.y);
    for (let c = 1; c <= cols; c++) {
      const v = vertices[r * (cols + 1) + c]!;
      ctx.lineTo(v.x, v.y);
    }
    ctx.stroke();
  }

  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    const start = vertices[c]!;
    ctx.moveTo(start.x, start.y);
    for (let r = 1; r <= rows; r++) {
      const v = vertices[r * (cols + 1) + c]!;
      ctx.lineTo(v.x, v.y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = handleColor;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const v of vertices) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Warp a single source point through the mesh deformation.
 *
 * Finds which grid cell contains the source point, computes its normalized
 * UV within that cell, and bilinearly interpolates across the four deformed
 * vertices of that cell to determine the warped position.
 *
 * Points outside the mesh bounds are clamped to the nearest edge.
 */
export function warpPosition(
  mesh: MeshWarp,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { cols, rows, vertices } = mesh;
  if (cols === 0 || rows === 0) return { x: sx, y: sy };

  const cellW = srcW / cols;
  const cellH = srcH / rows;

  const col = Math.max(0, Math.min(cols - 1, Math.floor(sx / cellW)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(sy / cellH)));

  const cellX = sx / cellW - col;
  const cellY = sy / cellH - row;
  const tx = Math.max(0, Math.min(1, cellX));
  const ty = Math.max(0, Math.min(1, cellY));

  const v = (r: number, c: number) => r * (cols + 1) + c;

  const tl = vertices[v(row, col)]!;
  const tr = vertices[v(row, col + 1)]!;
  const bl = vertices[v(row + 1, col)]!;
  const br = vertices[v(row + 1, col + 1)]!;

  const topX = tl.x + (tr.x - tl.x) * tx;
  const bottomX = bl.x + (br.x - bl.x) * tx;
  const x = topX + (bottomX - topX) * ty;

  const topY = tl.y + (tr.y - tl.y) * tx;
  const bottomY = bl.y + (br.y - bl.y) * ty;
  const y = topY + (bottomY - topY) * ty;

  return { x, y };
}

/**
 * Subdivide a cubic bezier segment between two path points to within
 * the given tolerance, returning intermediate points (excluding start).
 * Uses recursive midpoint subdivision with a flatness test.
 */
function subdivideSegment(
  prev: { x: number; y: number; handleOut?: [number, number] | null },
  curr: { x: number; y: number; handleIn?: [number, number] | null },
  tolerance: number,
): { x: number; y: number }[] {
  const hasOut = prev.handleOut && (prev.handleOut[0] !== 0 || prev.handleOut[1] !== 0);
  const hasIn = curr.handleIn && (curr.handleIn[0] !== 0 || curr.handleIn[1] !== 0);
  if (!hasOut && !hasIn) return [];

  const c1x = prev.x + (prev.handleOut?.[0] ?? 0);
  const c1y = prev.y + (prev.handleOut?.[1] ?? 0);
  const c2x = curr.x + (curr.handleIn?.[0] ?? 0);
  const c2y = curr.y + (curr.handleIn?.[1] ?? 0);

  const points: { x: number; y: number }[] = [];

  function subdivide(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    depth: number,
  ) {
    if (depth > 10) return;

    const flatness =
      Math.abs(ax + cx - bx - bx) +
      Math.abs(bx + dx - cx - cx) +
      Math.abs(ay + cy - by - by) +
      Math.abs(by + dy - cy - cy);

    if (flatness < tolerance * 4) {
      points.push({ x: dx, y: dy });
      return;
    }

    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    const nx = (bx + cx) / 2,
      ny = (by + cy) / 2;
    const ox = (cx + dx) / 2,
      oy = (cy + dy) / 2;
    const px = (mx + nx) / 2,
      py = (my + ny) / 2;
    const qx = (nx + ox) / 2,
      qy = (ny + oy) / 2;
    const rx = (px + qx) / 2,
      ry = (py + qy) / 2;

    subdivide(ax, ay, mx, my, px, py, rx, ry, depth + 1);
    subdivide(rx, ry, qx, qy, ox, oy, dx, dy, depth + 1);
  }

  subdivide(prev.x, prev.y, c1x, c1y, c2x, c2y, curr.x, curr.y, 0);
  return points;
}

/**
 * Warp a vector path through the mesh deformation.
 *
 * For corner points (no handles): warps directly via warpPosition.
 * For curve segments with bezier handles: subdivides the curve to a
 * tolerance first, warps each resulting point, then returns a polyline
 * approximation of the warped curve.
 *
 * Handles on corner points are preserved as-is (they're in local space
 * and the warp is a coordinate transform).
 */
export function warpPath(
  path: {
    x: number;
    y: number;
    handleIn?: [number, number] | null;
    handleOut?: [number, number] | null;
  }[],
  mesh: MeshWarp,
  srcW: number,
  srcH: number,
  tolerance: number = 1,
): {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
}[] {
  if (path.length === 0) return [];

  const result: {
    x: number;
    y: number;
    handleIn: [number, number] | null;
    handleOut: [number, number] | null;
  }[] = [];

  const wp = (px: number, py: number) => warpPosition(mesh, srcW, srcH, px, py);

  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = i > 0 ? path[i - 1] : null;

    const warped = wp(p.x, p.y);

    const hIn: [number, number] | null =
      p.handleIn && (p.handleIn[0] !== 0 || p.handleIn[1] !== 0) ? p.handleIn : null;
    const hOut: [number, number] | null =
      p.handleOut && (p.handleOut[0] !== 0 || p.handleOut[1] !== 0) ? p.handleOut : null;

    const hasPrevOut = prev?.handleOut && (prev.handleOut[0] !== 0 || prev.handleOut[1] !== 0);
    const hasCurrIn = hIn !== null;
    if (prev && (hasPrevOut || hasCurrIn)) {
      const subdivided = subdivideSegment(prev, p, tolerance);
      for (const sp of subdivided) {
        const w = wp(sp.x, sp.y);
        result.push({ x: w.x, y: w.y, handleIn: null, handleOut: null });
      }
    }

    result.push({ x: warped.x, y: warped.y, handleIn: hIn, handleOut: hOut });
  }

  return result;
}
