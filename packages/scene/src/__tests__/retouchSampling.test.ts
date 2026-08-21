import { describe, expect, it } from 'vitest';
import { createEmptyTile, makeTileKey, TILE_SIZE } from '../rasterLayer';
import { flattenTilesForSampling, sampleTiles } from '../retouchRaster';
import type { RasterTile } from '../types';

function solidTile(r: number, g: number, b: number, a: number): Map<string, RasterTile> {
  const tile = createEmptyTile();
  for (let i = 0; i < tile.pixels.length; i += 4) {
    tile.pixels[i] = r;
    tile.pixels[i + 1] = g;
    tile.pixels[i + 2] = b;
    tile.pixels[i + 3] = a;
  }
  return new Map([[makeTileKey(0, 0), tile]]);
}

describe('sample all layers', () => {
  it('composites the visible stack bottom-up', () => {
    const flat = flattenTilesForSampling([
      { tiles: solidTile(255, 0, 0, 255) },
      { tiles: solidTile(0, 0, 255, 255) },
    ]);
    // The upper layer is opaque, so it wins.
    expect(sampleTiles(flat, 5, 5)).toMatchObject({ r: 0, b: 255 });
  });

  it('blends a semi-transparent upper layer', () => {
    const flat = flattenTilesForSampling([
      { tiles: solidTile(255, 0, 0, 255) },
      { tiles: solidTile(0, 0, 255, 128) },
    ]);
    const p = sampleTiles(flat, 5, 5)!;
    expect(p.r).toBeGreaterThan(0);
    expect(p.b).toBeGreaterThan(0);
    expect(p.a).toBe(255);
  });

  it('skips hidden layers', () => {
    const flat = flattenTilesForSampling([
      { tiles: solidTile(255, 0, 0, 255) },
      { tiles: solidTile(0, 0, 255, 255), visible: false },
    ]);
    expect(sampleTiles(flat, 5, 5)).toMatchObject({ r: 255, b: 0 });
  });

  it('honours layer opacity', () => {
    const flat = flattenTilesForSampling([{ tiles: solidTile(255, 0, 0, 255), opacity: 0.5 }]);
    expect(sampleTiles(flat, 5, 5)!.a).toBeCloseTo(128, -1);
  });

  it('skips fully transparent layers', () => {
    const flat = flattenTilesForSampling([
      { tiles: solidTile(255, 0, 0, 255) },
      { tiles: solidTile(0, 255, 0, 255), opacity: 0 },
    ]);
    expect(sampleTiles(flat, 5, 5)).toMatchObject({ r: 255, g: 0 });
  });

  it('never mutates the layers it sampled', () => {
    const lower = solidTile(255, 0, 0, 255);
    const before = Array.from(lower.get(makeTileKey(0, 0))!.pixels.slice(0, 4));
    flattenTilesForSampling([{ tiles: lower }, { tiles: solidTile(0, 0, 255, 255) }]);
    // Sampling a composite must not bake the stack into a source layer.
    expect(Array.from(lower.get(makeTileKey(0, 0))!.pixels.slice(0, 4))).toEqual(before);
  });

  it('returns an empty source for an empty stack', () => {
    expect(flattenTilesForSampling([]).size).toBe(0);
  });

  it('leaves untouched tiles absent rather than allocating blanks', () => {
    const flat = flattenTilesForSampling([{ tiles: solidTile(1, 2, 3, 255) }]);
    expect(flat.size).toBe(1);
    expect(sampleTiles(flat, TILE_SIZE + 5, 5)).toBeNull();
  });
});
