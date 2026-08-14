import { describe, expect, it } from 'vitest';
import { blendTiles, computeTiles } from './scunet';

describe('blendTiles border behavior', () => {
  it('does not paint black borders at zero-weight tile edges', () => {
    // 600x600 image tiled at 256/64: border pixels are covered only by the
    // edge tile at weight 0 — they must fall back to the tile's raw value.
    const width = 600;
    const height = 600;
    const tileSize = 256;
    const overlap = 64;
    const tiles = computeTiles(width, height, tileSize, overlap);
    const results = tiles.map((tile) => {
      const tw = Math.ceil(tile.width / 8) * 8;
      const th = Math.ceil(tile.height / 8) * 8;
      const pixels = tw * th;
      const planes = new Float32Array(pixels * 3);
      // Identity-ish tile content: fill = 0.5 for all three planes.
      planes.fill(0.5);
      return planes;
    });
    const blended = blendTiles(tiles, results, width, height, overlap);
    const at = (x: number, y: number) => blended[y * width + x]!;
    // Border pixels must not be blackened by the weight-zero fallback.
    expect(at(0, 0)).toBeCloseTo(0.5, 5);
    expect(at(width - 1, 0)).toBeCloseTo(0.5, 5);
    expect(at(0, height - 1)).toBeCloseTo(0.5, 5);
    expect(at(width - 1, height - 1)).toBeCloseTo(0.5, 5);
    expect(at(300, 300)).toBeCloseTo(0.5, 5);
    // Interior pixels are a weighted average of equal tiles -> 0.5 too.
    expect(at(128, 128)).toBeCloseTo(0.5, 5);
  });

  it('weights interior overlap pixels from both tiles', () => {
    const width = 400;
    const height = 100;
    const tileSize = 256;
    const overlap = 64;
    const tiles = computeTiles(width, height, tileSize, overlap);
    // Tile 1 (left) returns 1.0, tile 2 (right) returns 0.0 in plane 0.
    const results = tiles.map((tile, index) => {
      const tw = Math.ceil(tile.width / 8) * 8;
      const th = Math.ceil(tile.height / 8) * 8;
      const pixels = tw * th;
      const planes = new Float32Array(pixels * 3);
      planes.fill(index === 0 ? 1.0 : 0.0, 0, pixels);
      return planes;
    });
    const blended = blendTiles(tiles, results, width, height, overlap);
    // In the 192..256 overlap band both tiles contribute with feather
    // weights that favour the tile whose core is closer: the mix must
    // transition monotonically from tile 1's value to tile 2's value.
    const v = (x: number) => blended[50 * width + x]!;
    expect(v(200)).toBeGreaterThan(0.8);
    expect(v(208)).toBeGreaterThan(0.5);
    expect(v(208)).toBeLessThan(0.8);
    expect(v(240)).toBeLessThan(0.5);
    expect(v(240)).toBeGreaterThan(0.1);
    expect(v(250)).toBeLessThan(0.2);
  });
});
