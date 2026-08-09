/**
 * Visible tile selection: viewport-in-layer-local-pixels -> tile set at a
 * level, clamped to the level grid, conservative at the edges.
 */
import { describe, expect, it } from 'vitest';
import { PYRAMID_TILE_SIZE as T } from './pyramid';
import { visibleTileCountAtLevel, visibleTilesAtLevel } from './tileQuery';

const dims = { width: 4096, height: 4096 };

describe('visibleTilesAtLevel', () => {
  it('full layer at L0 covers the whole grid', () => {
    const v = visibleTilesAtLevel(0, { x: 0, y: 0, width: 4096, height: 4096 }, dims);
    expect(v.tiles.length).toBe(32 * 32);
  });

  it('small viewport at low zoom touches few tiles (the core win)', () => {
    // A 64x64 screen-px viewport on a 4096^2 layer at 12.5% zoom (L3):
    // 64 screen px = 512 layer px = 64 level px = 1 tile.
    const v = visibleTilesAtLevel(3, { x: 0, y: 0, width: 64, height: 64 }, dims);
    expect(v.tiles.length).toBe(1);
    expect(v.tiles[0]).toEqual({ col: 0, row: 0 });
    // Panning to the far corner touches the last (edge) tile.
    const c = visibleTilesAtLevel(3, { x: 448, y: 448, width: 64, height: 64 }, dims);
    expect(c.tiles).toEqual([{ col: 3, row: 3 }]);
  });

  it('viewport spanning a tile boundary includes both tiles', () => {
    const v = visibleTilesAtLevel(0, { x: 120, y: 120, width: 20, height: 20 }, dims);
    expect(new Set(v.tiles.map((t) => `${t.col}:${t.row}`))).toEqual(
      new Set(['0:0', '0:1', '1:0', '1:1']),
    );
  });

  it('clamps to the level grid (layer smaller than viewport)', () => {
    const small = { width: 200, height: 100 };
    const v = visibleTilesAtLevel(0, { x: 0, y: 0, width: 500, height: 500 }, small);
    expect(v.rect.x1).toBe(2);
    expect(v.rect.y1).toBe(1);
    expect(v.tiles.length).toBe(2);
  });

  it('rects beyond the layer yield no tiles', () => {
    const v = visibleTilesAtLevel(0, { x: 5000, y: 5000, width: 64, height: 64 }, dims);
    expect(v.tiles.length).toBe(0);
  });

  it('negative coords clamp to zero', () => {
    const v = visibleTilesAtLevel(0, { x: -40, y: -40, width: 64, height: 64 }, dims);
    expect(v.tiles[0]).toEqual({ col: 0, row: 0 });
  });

  it('no visible pixel is left uncovered at any level (property)', () => {
    for (let i = 0; i < 300; i++) {
      const level = Math.floor(Math.random() * 8);
      const f = 2 ** level;
      const x = Math.floor(Math.random() * 4000) - 200;
      const y = Math.floor(Math.random() * 4000) - 200;
      const w = 1 + Math.floor(Math.random() * 512);
      const h = 1 + Math.floor(Math.random() * 512);
      // The rect is passed in level-local pixels (as the renderer would).
      const v = visibleTilesAtLevel(
        level,
        { x: x / f, y: y / f, width: w / f, height: h / f },
        dims,
      );
      const lx0 = Math.max(0, x / f);
      const ly0 = Math.max(0, y / f);
      const lx1 = Math.min((x + w) / f, 4096 / f);
      const ly1 = Math.min((y + h) / f, 4096 / f);
      if (lx1 <= lx0 || ly1 <= ly0) {
        expect(v.tiles.length).toBe(0);
        continue;
      }
      // The union of tile rects must cover the level-local pixel rect.
      // Level-local coords are lx0..lx1; tile col c covers [c*T, (c+1)*T).
      expect(Math.max(...v.tiles.map((t) => t.col)) * T + T).toBeGreaterThanOrEqual(lx1);
      expect(Math.max(...v.tiles.map((t) => t.row)) * T + T).toBeGreaterThanOrEqual(ly1);
      expect(Math.min(...v.tiles.map((t) => t.col)) * T).toBeLessThanOrEqual(lx0);
      expect(v.tiles.length).toBeGreaterThan(0);
    }
  });
});

describe('visibleTileCountAtLevel', () => {
  it('matches the enumerated list length', () => {
    const rect = { x: 100, y: 200, width: 800, height: 400 };
    const v = visibleTilesAtLevel(2, rect, dims);
    expect(visibleTileCountAtLevel(2, rect, dims)).toBe(v.tiles.length);
  });
});
