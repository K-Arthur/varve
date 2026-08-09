/**
 * Pyramid level math: level counts, dimension rounding, parent/child
 * mapping, dirty propagation, edge tiles, non-power-of-two dimensions.
 * Property tests pin that random dimensions/regions never produce
 * out-of-range tiles or missing ancestors.
 */
import { describe, expect, it } from 'vitest';
import {
  ancestorAtLevel,
  childCoordsAt,
  clampTileRect,
  invalidateAncestorRects,
  levelDimensions,
  levelTileCount,
  maxPyramidLevel,
  PYRAMID_TILE_SIZE,
  parentCoord,
  type TileRect,
  tileContentSize,
  tileRectForPixelRect,
  tilesInRect,
} from './pyramid';

describe('levelDimensions', () => {
  it('halves dimensions with ceil rounding', () => {
    expect(levelDimensions(1000, 600, 0)).toEqual({ width: 1000, height: 600 });
    expect(levelDimensions(1000, 600, 1)).toEqual({ width: 500, height: 300 });
    expect(levelDimensions(1000, 600, 2)).toEqual({ width: 250, height: 150 });
    expect(levelDimensions(4097, 4097, 3)).toEqual({ width: 513, height: 513 });
  });

  it('keeps odd dimensions alive to a single texel', () => {
    expect(levelDimensions(1, 1, 0)).toEqual({ width: 1, height: 1 });
    expect(levelDimensions(127, 127, 0)).toEqual({ width: 127, height: 127 });
    expect(levelDimensions(129, 129, 2)).toEqual({ width: 33, height: 33 });
    // Every level has at least one texel while 2^L <= max dim.
    expect(levelDimensions(129, 129, 8)).toEqual({ width: 1, height: 1 });
  });
});

describe('maxPyramidLevel', () => {
  it('is zero for single-pixel content', () => {
    expect(maxPyramidLevel(1, 1)).toBe(0);
    expect(maxPyramidLevel(1, 500)).toBe(9); // 2^9 = 512 > 500
  });

  it('covers the standard corpus without off-by-one', () => {
    expect(maxPyramidLevel(128, 128)).toBe(7);
    expect(maxPyramidLevel(129, 129)).toBe(8);
    expect(maxPyramidLevel(4097, 4097)).toBe(13);
    expect(maxPyramidLevel(16384, 16384)).toBe(14);
    expect(maxPyramidLevel(1000, 600)).toBe(10);
  });

  it('selected levels never exceed the available range', () => {
    const cases: Array<[number, number]> = [
      [1000, 600],
      [4097, 4097],
      [1, 1],
      [127, 127],
      [128, 128],
      [129, 129],
      [16384, 16384],
    ];
    for (const [w, h] of cases) {
      const max = maxPyramidLevel(w, h)!;
      expect(levelDimensions(w, h, max).width).toBe(1);
      expect(levelDimensions(w, h, max).height).toBe(1);
      expect(levelDimensions(w, h, max + 1).width).toBe(1);
    }
  });
});

describe('tile grid and edge tiles', () => {
  it('counts partial edge tiles', () => {
    expect(levelTileCount({ width: 128, height: 128 })).toEqual({ cols: 1, rows: 1 });
    expect(levelTileCount({ width: 129, height: 129 })).toEqual({ cols: 2, rows: 2 });
    expect(levelTileCount({ width: 256, height: 255 })).toEqual({ cols: 2, rows: 2 });
    expect(levelTileCount({ width: 257, height: 257 })).toEqual({ cols: 3, rows: 3 });
  });

  it('clamps edge tile content sizes', () => {
    const dims = { width: 129, height: 129 };
    expect(tileContentSize(dims, { col: 0, row: 0 })).toEqual({ width: 128, height: 128 });
    expect(tileContentSize(dims, { col: 1, row: 1 })).toEqual({ width: 1, height: 1 });
    expect(tileContentSize(dims, { col: 1, row: 0 })).toEqual({ width: 1, height: 128 });
    expect(tileContentSize(dims, { col: 0, row: 1 })).toEqual({ width: 128, height: 1 });
  });
});

describe('parent/child mapping', () => {
  it('maps children to their single parent at each level', () => {
    expect(parentCoord({ col: 3, row: 5 })).toEqual({ col: 1, row: 2 });
    expect(parentCoord({ col: 2, row: 2 })).toEqual({ col: 1, row: 1 });
    // A level-1 tile's ancestor two levels coarser is floor(coord/4).
    expect(ancestorAtLevel({ col: 5, row: 9 }, 1, 3)).toEqual({ col: 1, row: 2 });
    expect(ancestorAtLevel({ col: 5, row: 9 }, 3, 3)).toEqual({ col: 5, row: 9 });
  });

  it('every child maps up to one parent; parents cover exactly four children', () => {
    for (const c of childCoordsAt(1, { col: 4, row: 7 })) {
      expect(parentCoord(c)).toEqual({ col: 4, row: 7 });
    }
    const seen = childCoordsAt(1, { col: 0, row: 0 })
      .map((c) => `${c.col}:${c.row}`)
      .sort();
    expect(seen).toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('parent tile coverage contains every child contribution (property)', () => {
    // For random tiles: the union of children equals the parent's region.
    for (let i = 0; i < 200; i++) {
      const col = Math.floor(Math.random() * 100);
      const row = Math.floor(Math.random() * 100);
      const children = childCoordsAt(1, { col, row });
      for (const c of children) {
        expect(ancestorAtLevel(c, 0, 1)).toEqual({ col, row });
      }
      expect(new Set(children.map((c) => `${c.col}:${c.row}`)).size).toBe(4);
    }
  });
});

describe('dirty propagation', () => {
  it('a single base tile invalidates exactly one ancestor per level', () => {
    const rects = invalidateAncestorRects({ x0: 7, y0: 7, x1: 8, y1: 8 }, 0, 4);
    expect(rects).toHaveLength(4);
    expect(rects[0]).toEqual({ x0: 3, y0: 3, x1: 4, y1: 4 });
    expect(rects[1]).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 });
    expect(rects[2]).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(rects[3]).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('a region propagates as a growing rect', () => {
    const rects = invalidateAncestorRects({ x0: 1, y0: 1, x1: 3, y1: 3 }, 0, 3);
    expect(rects[0]).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
    expect(rects[1]).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(rects[2]).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('no unrelated ancestor becomes dirty (property)', () => {
    for (let i = 0; i < 300; i++) {
      const maxLevel = 8;
      const x0 = Math.floor(Math.random() * 64);
      const y0 = Math.floor(Math.random() * 64);
      const w = 1 + Math.floor(Math.random() * 8);
      const h = 1 + Math.floor(Math.random() * 8);
      const rect = { x0, y0, x1: x0 + w, y1: y0 + h };
      const rects = invalidateAncestorRects(rect, 0, maxLevel);
      // Each level's rect is a subset of the previous level's rect.
      let prev = rect;
      for (const r of rects) {
        expect(r.x0).toBeGreaterThanOrEqual(Math.floor(prev.x0 / 2));
        expect(r.y0).toBeGreaterThanOrEqual(Math.floor(prev.y0 / 2));
        expect(r.x1).toBeLessThanOrEqual(Math.ceil(prev.x1 / 2));
        expect(r.y1).toBeLessThanOrEqual(Math.ceil(prev.y1 / 2));
        prev = r;
      }
    }
  });

  it('an edit in one region leaves sibling ancestors clean (no halo)', () => {
    // Edit L0 tile (10,10): the ancestor rect at level L is exactly
    // [floor(10/2^L), floor(10/2^L)+1) on each axis.
    const rects = invalidateAncestorRects({ x0: 10, y0: 10, x1: 11, y1: 11 }, 0, 4);
    expect(rects[1]).toEqual({ x0: 2, y0: 2, x1: 3, y1: 3 }); // L2: floor(10/4)
    expect(rects[2]).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 }); // L3: floor(10/8)
    // A tile far away keeps its own ancestors disjoint from these.
    const other = invalidateAncestorRects({ x0: 40, y0: 40, x1: 41, y1: 41 }, 0, 4);
    expect(other[1]!.x0).toBe(10); // floor(40/4)
    expect(other[2]!.x0).toBe(5); // floor(40/8)
    expect(other[2]!.x0 >= rects[2]!.x1).toBe(true);
  });
});

describe('pixel rect -> tiles', () => {
  const dims = { width: 512, height: 512 };
  const T = PYRAMID_TILE_SIZE;

  it('converts exactly-aligned rects', () => {
    const r = tileRectForPixelRect({ x: 0, y: 0, width: T, height: T }, dims);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(tilesInRect(r).map((c) => `${c.col}:${c.row}`)).toEqual(['0:0']);
  });

  it('covers seam-adjacent pixels conservatively (brief §54 corpus)', () => {
    for (const edge of [128, 256]) {
      // A rect straddling the boundary must include both neighbouring tiles.
      const straddle = tileRectForPixelRect({ x: edge - 1, y: 0, width: 2, height: T }, dims);
      const straddleCols = [...new Set(tilesInRect(straddle).map((c) => c.col))];
      expect(straddleCols).toEqual([Math.floor((edge - 1) / T), Math.floor(edge / T)]);
      // A rect fully inside one tile must not leak into the neighbour.
      const inside = tileRectForPixelRect({ x: edge, y: 0, width: 1, height: T }, dims);
      expect(new Set(tilesInRect(inside).map((c) => c.col))).toEqual(new Set([edge / T]));
    }
  });

  it('clamps rects that extend past the level', () => {
    const r = tileRectForPixelRect({ x: 200, y: 200, width: 400, height: 400 }, dims);
    expect(r).toEqual({ x0: 1, y0: 1, x1: 4, y1: 4 });
  });

  it('returns empty for rects fully outside the level', () => {
    const r = tileRectForPixelRect({ x: 1000, y: 1000, width: 10, height: 10 }, dims);
    expect(r.x1 - r.x0).toBe(0);
  });

  it('union of tile bounds covers the query rect (no off-by-one holes)', () => {
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(Math.random() * 300) - 50;
      const y = Math.floor(Math.random() * 300) - 50;
      const w = 1 + Math.floor(Math.random() * 300);
      const h = 1 + Math.floor(Math.random() * 300);
      const r = tileRectForPixelRect({ x, y, width: w, height: h }, dims);
      const clamped = clampTileRect(r, dims);
      // Every level pixel in the clamped rect is covered by some tile.
      for (const t of tilesInRect(clamped)) {
        expect(t.col).toBeLessThan(levelTileCount(dims).cols);
        expect(t.row).toBeLessThan(levelTileCount(dims).rows);
        expect(t.col).toBeGreaterThanOrEqual(0);
        expect(t.row).toBeGreaterThanOrEqual(0);
      }
      // And the covered pixel range contains the visible pixel range.
      const px0 = Math.max(0, x);
      const py0 = Math.max(0, y);
      const px1 = Math.min(dims.width, x + w);
      const py1 = Math.min(dims.height, y + h);
      if (px1 > px0 && py1 > py0) {
        expect(clamped.x0 * T).toBeLessThanOrEqual(px0);
        expect(clamped.y0 * T).toBeLessThanOrEqual(py0);
        expect(clamped.x1 * T).toBeGreaterThanOrEqual(px1);
        expect(clamped.y1 * T).toBeGreaterThanOrEqual(py1);
      }
    }
  });

  it('treats zero-size rects as empty', () => {
    const r = tileRectForPixelRect({ x: 10, y: 10, width: 0, height: 0 }, dims);
    expect(r.x1 - r.x0).toBe(0);
    expect(r.y1 - r.y0).toBe(0);
  });
});

describe('tile rect helpers are closed under clamping', () => {
  it('never produces out-of-grid coords for arbitrary ints', () => {
    const dims = { width: 1000, height: 600 };
    for (let i = 0; i < 500; i++) {
      const x0 = Math.floor(Math.random() * 400) - 100;
      const y0 = Math.floor(Math.random() * 400) - 100;
      const x1 = x0 + Math.floor(Math.random() * 200);
      const y1 = y0 + Math.floor(Math.random() * 200);
      const r: TileRect = clampTileRect({ x0, y0, x1, y1 }, dims);
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.y0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(levelTileCount(dims).cols);
      expect(r.y1).toBeLessThanOrEqual(levelTileCount(dims).rows);
      expect(r.x1).toBeGreaterThanOrEqual(r.x0);
      expect(r.y1).toBeGreaterThanOrEqual(r.y0);
    }
  });
});
