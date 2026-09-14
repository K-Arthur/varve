import { createLiquifyField } from '@varve/engine';
import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  type RasterLayerNode,
  TILE_SIZE,
} from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLiquifyRenderCacheStats,
  releaseLiquifyRenderCache,
  warpedTilesForRender,
} from './liquifyRenderCache';

function node(id: string, width: number, height: number): RasterLayerNode {
  const raster = makeRasterLayerNode(id, { width, height });
  const tile = createEmptyTile();
  tile.pixels[3] = 255;
  raster.tiles.set(makeTileKey(0, 0), tile);
  const field = createLiquifyField(width, height, 1, 1);
  field.displacement[0] = -1;
  field.displacement[2] = -1;
  field.displacement[4] = -1;
  field.displacement[6] = -1;
  return { ...raster, liquify: field };
}

describe('liquify render cache accounting', () => {
  afterEach(() => releaseLiquifyRenderCache());

  it('counts replacement entries once when a node revision changes', () => {
    warpedTilesForRender(node('same-id', TILE_SIZE, TILE_SIZE));
    warpedTilesForRender(node('same-id', TILE_SIZE * 2, TILE_SIZE * 2));

    expect(getLiquifyRenderCacheStats()).toMatchObject({ entries: 1, pixels: 4 * TILE_SIZE ** 2 });
  });
});
