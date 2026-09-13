import { areaSelectionCoverageAt } from '@varve/engine';
import { createEmptyTile, makeRasterLayerNode, makeTileKey, TILE_SIZE } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { rasterColorSelectionAt } from './rasterColorSelection';

function makeSampleLayer() {
  const node = makeRasterLayerNode('raster', { width: 8, height: 6 });
  const tile = createEmptyTile();
  for (let y = 0; y < node.height; y += 1) {
    for (let x = 0; x < node.width; x += 1) {
      const index = (y * TILE_SIZE + x) * 4;
      tile.pixels[index] = 255;
      tile.pixels[index + 1] = 255;
      tile.pixels[index + 2] = 255;
      tile.pixels[index + 3] = 255;
    }
  }
  const blue = [20, 80, 240, 255] as const;
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [6, 4],
  ] as const) {
    const index = (y * TILE_SIZE + x) * 4;
    tile.pixels[index] = blue[0];
    tile.pixels[index + 1] = blue[1];
    tile.pixels[index + 2] = blue[2];
    tile.pixels[index + 3] = blue[3];
  }
  return { ...node, tiles: new Map([[makeTileKey(0, 0), tile]]) };
}

const options = {
  tolerance: 0.05,
  feather: 0,
  mode: 'contiguous' as const,
};

describe('rasterColorSelectionAt', () => {
  it('selects a contiguous region from sparse raster tiles', () => {
    const selection = rasterColorSelectionAt(makeSampleLayer(), { x: 1.5, y: 1.5 }, options);

    expect(selection).not.toBeNull();
    expect(areaSelectionCoverageAt(selection!, { x: 1.5, y: 1.5 })).toBeGreaterThan(0.9);
    expect(areaSelectionCoverageAt(selection!, { x: 2, y: 2 })).toBeGreaterThan(0.9);
    expect(areaSelectionCoverageAt(selection!, { x: 6, y: 4 })).toBe(0);
    expect(areaSelectionCoverageAt(selection!, { x: 0, y: 0 })).toBe(0);
  });

  it('global mode includes separated matching pixels', () => {
    const selection = rasterColorSelectionAt(
      makeSampleLayer(),
      { x: 1.5, y: 1.5 },
      {
        ...options,
        mode: 'global',
      },
    );

    expect(selection).not.toBeNull();
    expect(areaSelectionCoverageAt(selection!, { x: 6, y: 4 })).toBeGreaterThan(0.9);
  });

  it('does not create a selection from transparent pixels', () => {
    const node = makeSampleLayer();
    const tile = node.tiles.get(makeTileKey(0, 0));
    if (!tile) throw new Error('sample tile missing');
    tile.pixels[(3 * TILE_SIZE + 4) * 4 + 3] = 0;
    expect(rasterColorSelectionAt(node, { x: 4, y: 3 }, options)).toBeNull();
  });
});
