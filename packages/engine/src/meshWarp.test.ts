import { describe, expect, it } from 'vitest';
import {
  createFlatMesh,
  type MeshControlPoint,
  type MeshWarp,
  meshTriangles,
  warpMesh,
  warpPath,
  warpPosition,
} from './meshWarp';

describe('createFlatMesh', () => {
  it('creates a 2x2 mesh covering the given dimensions', () => {
    const mesh = createFlatMesh(2, 2, 200, 100);
    expect(mesh.cols).toBe(2);
    expect(mesh.rows).toBe(2);
    expect(mesh.vertices).toHaveLength(9);
    expect(mesh.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(mesh.vertices[2]).toEqual({ x: 200, y: 0 });
    expect(mesh.vertices[6]).toEqual({ x: 0, y: 100 });
    expect(mesh.vertices[8]).toEqual({ x: 200, y: 100 });
  });

  it('creates a 1x1 mesh (single quad)', () => {
    const mesh = createFlatMesh(1, 1, 100, 100);
    expect(mesh.vertices).toHaveLength(4);
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
    expect(tris).toHaveLength(2);
    expect(tris[0]!.src.a).toEqual({ x: 0, y: 0 });
    expect(tris[0]!.src.b).toEqual({ x: 100, y: 0 });
    expect(tris[0]!.src.c).toEqual({ x: 100, y: 100 });
    expect(tris[1]!.src.a).toEqual({ x: 0, y: 0 });
    expect(tris[1]!.src.b).toEqual({ x: 100, y: 100 });
    expect(tris[1]!.src.c).toEqual({ x: 0, y: 100 });
  });

  it('produces 8 triangles for a 2x2 mesh', () => {
    const mesh = createFlatMesh(2, 2, 200, 200);
    const tris = meshTriangles(mesh, 200, 200);
    expect(tris).toHaveLength(8);
  });

  it('maps deformed vertices by index', () => {
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 80, y: 80 },
      ],
    };
    const tris = meshTriangles(mesh, 100, 100);
    expect(tris).toHaveLength(2);
    expect(tris[0]!.dst.a).toEqual({ x: 0, y: 0 });
    expect(tris[0]!.dst.b).toEqual({ x: 100, y: 0 });
    expect(tris[0]!.dst.c).toEqual({ x: 80, y: 80 });
    expect(tris[1]!.dst.a).toEqual({ x: 0, y: 0 });
    expect(tris[1]!.dst.b).toEqual({ x: 80, y: 80 });
    expect(tris[1]!.dst.c).toEqual({ x: 0, y: 100 });
  });
});

describe('warpPosition', () => {
  it('returns the same position for an undeformed mesh', () => {
    const mesh = createFlatMesh(2, 2, 100, 100);
    const result = warpPosition(mesh, 100, 100, 50, 50);
    expect(result.x).toBeCloseTo(50, 5);
    expect(result.y).toBeCloseTo(50, 5);
  });

  it('displaces a point toward a moved corner', () => {
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 50, y: 50 },
      ],
    };
    const result = warpPosition(mesh, 100, 100, 90, 90);
    expect(result.x).toBeLessThan(60);
    expect(result.y).toBeLessThan(60);
  });

  it('returns same position for center of undeformed mesh', () => {
    const mesh = createFlatMesh(2, 2, 200, 100);
    const result = warpPosition(mesh, 200, 100, 100, 50);
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(50, 5);
  });

  it('clamps points outside the mesh to the nearest edge', () => {
    const mesh = createFlatMesh(2, 2, 100, 100);
    const result = warpPosition(mesh, 100, 100, 150, 50);
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
  });

  it('handles position at exact vertex', () => {
    const mesh = createFlatMesh(1, 1, 100, 100);
    const result = warpPosition(mesh, 100, 100, 100, 0);
    expect(result.x).toBe(100);
    expect(result.y).toBe(0);
  });
});

describe('warpPath', () => {
  it('returns the same path for an undeformed mesh', () => {
    const mesh = createFlatMesh(2, 2, 100, 100);
    const path = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 90, handleIn: null, handleOut: null },
      { x: 10, y: 90, handleIn: null, handleOut: null },
    ];
    const result = warpPath(path, mesh, 100, 100);
    expect(result).toHaveLength(4);
    expect(result[0]!.x).toBeCloseTo(10, 5);
    expect(result[0]!.y).toBeCloseTo(10, 5);
    expect(result[2]!.x).toBeCloseTo(90, 5);
    expect(result[2]!.y).toBeCloseTo(90, 5);
  });

  it('preserves handle types when possible', () => {
    const mesh = createFlatMesh(2, 2, 100, 100);
    const path = [
      { x: 10, y: 10, handleIn: null, handleOut: [20, 10] as [number, number] },
      { x: 90, y: 10, handleIn: [80, 10] as [number, number], handleOut: null },
    ];
    const result = warpPath(path, mesh, 100, 100);
    expect(result[0]!.handleOut).toEqual([20, 10]);
    expect(result[result.length - 1]!.handleIn).toEqual([80, 10]);
  });

  it('wraps path through displaced mesh', () => {
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 60, y: 60 },
      ],
    };
    const path = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 90, handleIn: null, handleOut: null },
      { x: 10, y: 90, handleIn: null, handleOut: null },
    ];
    const result = warpPath(path, mesh, 100, 100);
    expect(result).toHaveLength(4);
    expect(result[3]!.x).toBeLessThan(10);
    expect(result[3]!.y).toBeLessThan(90);
  });

  it('subdivides curves with handles before warping for accuracy', () => {
    const mesh: MeshWarp = {
      cols: 2,
      rows: 2,
      vertices: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 50 },
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 0, y: 100 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ],
    };
    const path = [
      { x: 10, y: 50, handleIn: null, handleOut: [40, 50] as [number, number] },
      { x: 90, y: 50, handleIn: [60, 50] as [number, number], handleOut: null },
    ];
    const result = warpPath(path, mesh, 100, 100);
    expect(result.length).toBeGreaterThan(2);
    const last = result[result.length - 1]!;
    expect(last.x).toBeCloseTo(90, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });

  it('does not crash on degenerate mesh (all vertices at same point)', () => {
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
      ],
    };
    const path = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 10, handleIn: null, handleOut: null },
    ];
    expect(() => warpPath(path, mesh, 100, 100)).not.toThrow();
  });
});

describe('warpMesh', () => {
  function makeTestImage(w: number, h: number): ImageData {
    const data = new ImageData(w, h);
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
    const w = 20,
      h = 20;
    const src = makeTestImage(w, h);
    const mesh = createFlatMesh(2, 2, w, h);
    const result = warpMesh(src, mesh, w, h);
    expect(result.width).toBe(w);
    expect(result.height).toBe(h);
    let diffCount = 0;
    for (let i = 0; i < src.data.length; i++) {
      const sv = src.data[i]!;
      const rv = result.data[i]!;
      if (Math.abs(sv - rv) > 2) diffCount++;
    }
    expect(diffCount).toBeLessThan(20);
  });

  it('warps content when corner is displaced', () => {
    const w = 20,
      h = 20;
    const src = makeTestImage(w, h);
    const mesh: MeshWarp = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w - 5, y: h - 5 },
      ],
    };
    const result = warpMesh(src, mesh, w, h);
    const brIdx = ((h - 1) * w + (w - 1)) * 4;
    expect(result.data[brIdx]).toBeLessThan(255);
    expect(result.data[brIdx + 1]).toBeLessThan(255);
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
    const result = warpMesh(src, mesh, 16, 16);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });
});
