import { describe, expect, it } from 'vitest';
import {
  forwardBilinear,
  inverseBilinear,
  isMeshCellValid,
  isMeshGridValid,
  type MockupMeshGrid,
  meshCellCorners,
  meshGridBounds,
  warpImageToMesh,
} from '../meshWarp';

function flatGrid(
  cols: number,
  rows: number,
  w: number,
  h: number,
  offsetX = 0,
  offsetY = 0,
): MockupMeshGrid {
  const vertices: MockupMeshGrid['vertices'] = [];
  for (let r = 0; r <= rows; r++) {
    const row: MockupMeshGrid['vertices'][number] = [];
    for (let c = 0; c <= cols; c++) {
      row.push({ x: offsetX + (c / cols) * w, y: offsetY + (r / rows) * h });
    }
    vertices.push(row);
  }
  return { cols, rows, vertices };
}

function checkerboard(w: number, h: number): Uint8ClampedArray {
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (x + y) % 2 === 0 ? 255 : 0;
      src[i] = v;
      src[i + 1] = v;
      src[i + 2] = v;
      src[i + 3] = 255;
    }
  }
  return src;
}

function opaqueAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  return data[(y * w + x) * 4 + 3]!;
}

describe('isMeshGridValid', () => {
  it('accepts a flat 2x2 grid', () => {
    expect(isMeshGridValid(flatGrid(2, 2, 100, 80))).toBe(true);
  });

  it('rejects wrong shape, out-of-range counts, and non-finite vertices', () => {
    expect(isMeshGridValid(flatGrid(0, 2, 100, 80))).toBe(false);
    expect(isMeshGridValid(flatGrid(17, 2, 100, 80))).toBe(false);
    expect(isMeshGridValid(flatGrid(2, 2, 100, 80))).toBeDefined();

    const shortRows = flatGrid(2, 2, 100, 80);
    shortRows.vertices[0] = shortRows.vertices[0]!.slice(0, 2);
    expect(isMeshGridValid(shortRows)).toBe(false);

    const tooFewRows = flatGrid(2, 2, 100, 80);
    tooFewRows.vertices.pop();
    expect(isMeshGridValid(tooFewRows)).toBe(false);

    const nan = flatGrid(1, 1, 100, 80);
    nan.vertices[0]![1] = { x: Number.NaN, y: 0 };
    expect(isMeshGridValid(nan)).toBe(false);
  });

  it('rejects a butterfly cell through isMeshCellValid', () => {
    const corners = meshCellCorners(
      {
        cols: 1,
        rows: 1,
        vertices: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          [
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        ],
      },
      0,
      0,
    );
    expect(corners).not.toBeNull();
    expect(isMeshCellValid(corners!)).toBe(false);
  });

  it('rejects folded and degenerate cells', () => {
    // Butterfly (self-crossing) cell: zero shoelace area.
    const butterfly: MockupMeshGrid = {
      cols: 1,
      rows: 1,
      vertices: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        [
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
      ],
    };
    expect(isMeshGridValid(butterfly)).toBe(false);

    // Concave cell: one edge cross flips sign.
    const concave: MockupMeshGrid = {
      cols: 1,
      rows: 1,
      vertices: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        [
          { x: 0, y: 10 },
          { x: 4, y: 4 },
        ],
      ],
    };
    expect(isMeshGridValid(concave)).toBe(false);

    const corners = meshCellCorners(concave, 0, 0);
    expect(corners).not.toBeNull();
    expect(isMeshCellValid(corners!)).toBe(false);
  });
});

describe('inverseBilinear', () => {
  it('round-trips through forwardBilinear', () => {
    const corners = {
      p00: { x: 2, y: 3 },
      p10: { x: 22, y: 5 },
      p01: { x: 4, y: 23 },
      p11: { x: 26, y: 21 },
    };
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.25, 0.75],
      [0.6, 0.3],
    ] as Array<[number, number]>) {
      const p = forwardBilinear(u, v, corners);
      const back = inverseBilinear(p.x, p.y, corners);
      expect(back).not.toBeNull();
      expect(back!.u).toBeCloseTo(u, 6);
      expect(back!.v).toBeCloseTo(v, 6);
    }
  });

  it('returns null for a point when the cell is degenerate', () => {
    const corners = {
      p00: { x: 0, y: 0 },
      p10: { x: 0, y: 0 },
      p01: { x: 0, y: 0 },
      p11: { x: 0, y: 0 },
    };
    expect(inverseBilinear(1, 1, corners)).toBeNull();
  });
});

describe('warpImageToMesh', () => {
  it('returns null for invalid grids and zero dimensions', () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    expect(warpImageToMesh(src, 4, 4, flatGrid(1, 1, 10, 10), 0, 8)).toBeNull();
    const folded = flatGrid(1, 1, 10, 10);
    folded.vertices[1]![1] = { x: -2, y: 12 };
    expect(isMeshGridValid(folded)).toBe(false);
    expect(warpImageToMesh(src, 4, 4, folded, 12, 12)).toBeNull();
  });

  it('reproduces the source exactly on an identity grid', () => {
    const w = 8;
    const h = 8;
    const src = checkerboard(w, h);
    const out = warpImageToMesh(src, w, h, flatGrid(2, 2, w, h), w, h);
    expect(out).not.toBeNull();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        expect(out!.data[i]).toBe(src[i]);
        expect(out!.data[i + 3]).toBe(255);
      }
    }
  });

  it('keeps pixels outside the hull transparent and hits the corners', () => {
    const w = 8;
    const h = 8;
    const src = checkerboard(w, h);
    // Offset identity: one-pixel transparent margin on every side.
    const out = warpImageToMesh(src, w, h, flatGrid(2, 2, w, h, 1, 1), 10, 10);
    expect(out).not.toBeNull();
    const o = out!.data;
    expect(opaqueAt(o, 10, 0, 0)).toBe(0);
    // The hull boundary itself paints inclusively (same convention as
    // warpImageToQuad: inclusive far edge avoids a one-pixel rim).
    expect(opaqueAt(o, 10, 9, 9)).toBe(255);
    expect(opaqueAt(o, 10, 0, 9)).toBe(0);
    expect(opaqueAt(o, 10, 9, 0)).toBe(0);
    expect(opaqueAt(o, 10, 0, 5)).toBe(0);
    expect(opaqueAt(o, 10, 5, 0)).toBe(0);
    // Interior pixels are opaque.
    expect(opaqueAt(o, 10, 3, 3)).toBe(255);
    expect(opaqueAt(o, 10, 8, 8)).toBe(255);
  });

  it('stays continuous across a folded seam (no transparent gap)', () => {
    const w = 8;
    const h = 4;
    const src = checkerboard(w, h);
    // A vertical crease at x=4 with the top edge pushed down one pixel.
    const grid: MockupMeshGrid = {
      cols: 2,
      rows: 1,
      vertices: [
        [
          { x: 0, y: 0 },
          { x: 4, y: 1 },
          { x: 8, y: 0 },
        ],
        [
          { x: 0, y: 4 },
          { x: 4, y: 5 },
          { x: 8, y: 4 },
        ],
      ],
    };
    expect(isMeshGridValid(grid)).toBe(true);
    const out = warpImageToMesh(src, w, h, grid, 8, 6);
    expect(out).not.toBeNull();
    // The seam column and its neighbours stay opaque mid-height: adjacent
    // cells agree on shared edges, so no sliver of transparency appears.
    for (let y = 2; y <= 3; y++) {
      expect(opaqueAt(out!.data, 8, 3, y)).toBe(255);
      expect(opaqueAt(out!.data, 8, 4, y)).toBe(255);
      expect(opaqueAt(out!.data, 8, 5, y)).toBe(255);
    }
  });

  it('maps cell corners onto grid vertices (corner correspondence)', () => {
    const w = 10;
    const h = 10;
    const src = new Uint8ClampedArray(w * h * 4).fill(255, 0, w * h * 4);
    const grid: MockupMeshGrid = {
      cols: 2,
      rows: 2,
      vertices: [
        [
          { x: 2, y: 1 },
          { x: 7, y: 2 },
          { x: 12, y: 1 },
        ],
        [
          { x: 3, y: 6 },
          { x: 7, y: 7 },
          { x: 11, y: 6 },
        ],
        [
          { x: 2, y: 11 },
          { x: 7, y: 12 },
          { x: 12, y: 11 },
        ],
      ],
    };
    const out = warpImageToMesh(src, w, h, grid, 14, 14);
    expect(out).not.toBeNull();
    // Vertex neighbourhoods are opaque; far outside stays transparent.
    const vertexHits: Array<[number, number]> = [
      [2, 1],
      [12, 1],
      [7, 7],
      [2, 11],
      [12, 11],
    ];
    for (const [vx, vy] of vertexHits) {
      expect(opaqueAt(out!.data, 14, vx, vy)).toBe(255);
    }
    expect(opaqueAt(out!.data, 14, 0, 0)).toBe(0);
    expect(opaqueAt(out!.data, 14, 13, 13)).toBe(0);
  });
});

describe('meshGridBounds', () => {
  it('returns the vertex bounding box', () => {
    const bounds = meshGridBounds(flatGrid(2, 3, 60, 90, 5, -2));
    expect(bounds).toEqual({ x: 5, y: -2, width: 60, height: 90 });
  });
});
