import { describe, expect, it } from 'vitest';
import {
  createFlatMesh,
  meshTriangles,
  warpMesh,
  type MeshControlPoint,
  type MeshWarp,
} from './meshWarp';

describe('createFlatMesh', () => {
  it('creates a 2x2 mesh covering the given dimensions', () => {
    const mesh = createFlatMesh(2, 2, 200, 100);
    expect(mesh.cols).toBe(2);
    expect(mesh.rows).toBe(2);
    // (2+1)*(2+1) = 9 vertices
    expect(mesh.vertices).toHaveLength(9);
    // Corners
    expect(mesh.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(mesh.vertices[2]).toEqual({ x: 200, y: 0 });
    expect(mesh.vertices[6]).toEqual({ x: 0, y: 100 });
    expect(mesh.vertices[8]).toEqual({ x: 200, y: 100 });
  });

  it('creates a 1x1 mesh (single quad)', () => {
    const mesh = createFlatMesh(1, 1, 100, 100);
    expect(mesh.vertices).toHaveLength(4);
    // Row-major order: TL, TR, BL, BR
    expect(mesh.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(mesh.vertices[1]).toEqual({ x: 100, y: 0 });
    expect(mesh.vertices[2]).toEqual({ x: 0, y: 100 });
    expect(mesh.vertices[3]).toEqual({ x: 100, y: 100 });
  });
});

describe('meshTriangles', () => {
  it('produces 2 triangles per cell for a 1x1 mesh', () => {
    const mesh = createFlatMesh(1, 1, 100, 100);
    const tris = meshTriangles(mesh, 100, 100);
    // 1 cell * 2 triangles = 2
    expect(tris).toHaveLength(2);

    // Triangle 1: TL, TR, BR
    expect(tris[0]!.src.a).toEqual({ x: 0, y: 0 });
    expect(tris[0]!.src.b).toEqual({ x: 100, y: 0 });
    expect(tris[0]!.src.c).toEqual({ x: 100, y: 100 });

    // Triangle 2: TL, BR, BL
    expect(tris[1]!.src.a).toEqual({ x: 0, y: 0 });
    expect(tris[1]!.src.b).toEqual({ x: 100, y: 100 });
    expect(tris[1]!.src.c).toEqual({ x: 0, y: 100 });
  });

  it('produces 8 triangles for a 2x2 mesh', () => {
    const mesh = createFlatMesh(2, 2, 200, 200);
    const tris = meshTriangles(mesh, 200, 200);
    // 4 cells * 2 triangles = 8
    expect(tris).toHaveLength(8);
  });

  it('maps deformed vertices by index', () => {
    // 1x1 mesh where the bottom-right corner is displaced.
    // Row-major order: [TL, TR, BL, BR]
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 }, // [0] TL
        { x: 100, y: 0 }, // [1] TR
        { x: 0, y: 100 }, // [2] BL
        { x: 80, y: 80 }, // [3] BR displaced inward
      ],
    };
    const tris = meshTriangles(mesh, 100, 100);
    expect(tris).toHaveLength(2);
    // Triangle 1: TL, TR, BR — dst.c should be the displaced BR
    expect(tris[0]!.dst.a).toEqual({ x: 0, y: 0 });
    expect(tris[0]!.dst.b).toEqual({ x: 100, y: 0 });
    expect(tris[0]!.dst.c).toEqual({ x: 80, y: 80 });
    // Triangle 2: TL, BR, BL — dst.c should be BL
    expect(tris[1]!.dst.a).toEqual({ x: 0, y: 0 });
    expect(tris[1]!.dst.b).toEqual({ x: 80, y: 80 });
    expect(tris[1]!.dst.c).toEqual({ x: 0, y: 100 });
  });
});

describe('warpMesh', () => {
  function makeTestImage(w: number, h: number): ImageData {
    const data = new ImageData(w, h);
    // Create a simple gradient: red channel increases with x, green with y
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        data.data[idx] = Math.round((x / w) * 255);
        data.data[idx + 1] = Math.round((y / h) * 255);
        data.data[idx + 2] = 128;
        data.data[idx + 3] = 255;
      }
    }
    return data;
  }

  it('returns same image for flat (undeformed) mesh', () => {
    const w = 20;
    const h = 20;
    const src = makeTestImage(w, h);
    const mesh = createFlatMesh(2, 2, w, h);
    const result = warpMesh(src, mesh, w, h);

    expect(result.width).toBe(w);
    expect(result.height).toBe(h);
    // With no deformation, the result should closely match the source
    let diffCount = 0;
    for (let i = 0; i < src.data.length; i++) {
      const sv = src.data[i];
      const rv = result.data[i];
      if (sv !== undefined && rv !== undefined && Math.abs(sv - rv) > 2) diffCount++;
    }
    // Allow some edge pixel differences due to bilinear sampling at boundaries
    expect(diffCount).toBeLessThan(20);
  });

  it('warps content when corner is displaced', () => {
    const w = 20;
    const h = 20;
    const src = makeTestImage(w, h);
    // Displace BR corner inward by 5px.
    // Row-major: [TL, TR, BL, BR]
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w - 5, y: h - 5 }, // BR displaced inward
      ],
    };
    const result = warpMesh(src, mesh, w, h);

    // The bottom-right pixel (19,19) maps from source (14,14) approximately
    // (19 maps from w * 14/19 ≈ 14.7 via barycentric). Verify pixel changed.
    const brIdx = ((h - 1) * w + (w - 1)) * 4;
    // Source BR pixel (19,19) has r=255, g=255
    // Deformed BR output should have lower red/green because it samples from (14,14)
    expect(result.data[brIdx]).toBeLessThan(255); // red should be lower
    expect(result.data[brIdx + 1]).toBeLessThan(255); // green should be lower
  });

  it('handles different output dimensions', () => {
    const src = makeTestImage(10, 10);
    const mesh = createFlatMesh(2, 2, 10, 10);
    const result = warpMesh(src, mesh, 10, 10, 20, 20);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it('handles extreme deformation without crashing', () => {
    const src = makeTestImage(16, 16);
    // All vertices collapsed to center (row-major: TL, TR, BL, BR)
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 8, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 8 },
      ],
    };
    // Should not crash — degenerate triangles are skipped by pointInTriangle
    const result = warpMesh(src, mesh, 16, 16);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });
});
