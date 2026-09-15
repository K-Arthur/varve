import type { Affine } from '@varve/engine';
import { createEmptyTile, makeRasterLayerNode, TILE_SIZE } from './rasterLayer';
import type { RasterLayerNode } from './types';

export const MAX_RASTER_SOURCE_PIXELS = 16_000_000;

export interface RgbaRasterSource {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/**
 * Promote an explicitly decoded ordinary image into native tile storage.
 *
 * This is an intentional user action used to put a locked pixel source below
 * a separate repair layer. It is not used by ordinary import, so the original
 * image asset and its editable placement remain available for non-destructive
 * workflows.
 */
export function makeRasterSourceLayer(
  id: string,
  source: RgbaRasterSource,
  options: { name?: string; transform?: Affine; locked?: boolean } = {},
): RasterLayerNode {
  const pixels = source.width * source.height;
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    pixels > MAX_RASTER_SOURCE_PIXELS
  ) {
    throw new Error(`Pixel source exceeds ${MAX_RASTER_SOURCE_PIXELS.toLocaleString()} pixels`);
  }
  if (source.pixels.length !== pixels * 4) {
    throw new Error('Pixel source must contain width × height × 4 RGBA samples');
  }

  const base = makeRasterLayerNode(
    id,
    { width: source.width, height: source.height },
    { name: options.name ?? 'Photo pixels', locked: options.locked ?? true },
  );
  const tiles = new Map(base.tiles);
  const tileColumns = Math.ceil(source.width / TILE_SIZE);
  const tileRows = Math.ceil(source.height / TILE_SIZE);
  for (let row = 0; row < tileRows; row++) {
    for (let column = 0; column < tileColumns; column++) {
      const tile = createEmptyTile();
      const startX = column * TILE_SIZE;
      const startY = row * TILE_SIZE;
      const copyWidth = Math.min(TILE_SIZE, source.width - startX);
      const copyHeight = Math.min(TILE_SIZE, source.height - startY);
      for (let y = 0; y < copyHeight; y++) {
        const sourceStart = ((startY + y) * source.width + startX) * 4;
        const destinationStart = y * TILE_SIZE * 4;
        tile.pixels.set(
          source.pixels.subarray(sourceStart, sourceStart + copyWidth * 4),
          destinationStart,
        );
      }
      tiles.set(`${column}:${row}`, tile);
    }
  }
  return {
    ...base,
    transform: options.transform ?? base.transform,
    tiles,
  };
}
