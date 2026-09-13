import {
  compositePatchRegionOnNode,
  compositeSpotHealDabOnNode,
  createEmptyTile,
  findSpotHealSource,
  makeRasterLayerNode,
  makeTileKey,
  sampleTilesBilinear,
  snapshotTiles,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import type { BrushDab } from '../brush';
import type { RasterLayerNode } from '../types';

function splitLayer(): RasterLayerNode {
  const node = makeRasterLayerNode('raster', { width: TILE_SIZE * 2, height: TILE_SIZE });
  const left = createEmptyTile();
  const right = createEmptyTile();
  for (let i = 0; i < left.pixels.length; i += 4) {
    left.pixels[i] = 220;
    left.pixels[i + 1] = 20;
    left.pixels[i + 2] = 20;
    left.pixels[i + 3] = 255;
    right.pixels[i] = 20;
    right.pixels[i + 1] = 40;
    right.pixels[i + 2] = 220;
    right.pixels[i + 3] = 255;
  }
  node.tiles.set(makeTileKey(0, 0), left);
  node.tiles.set(makeTileKey(1, 0), right);
  return node;
}

function dab(x: number, y: number, radius: number): BrushDab {
  return {
    x,
    y,
    radius,
    opacity: 1,
    flow: 1,
    hardness: 1,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

describe('persistent retouch raster operations', () => {
  it('keeps translucent source edges bright during bilinear sampling', () => {
    const node = makeRasterLayerNode('raster', { width: TILE_SIZE, height: TILE_SIZE });
    const tile = createEmptyTile();
    const center = (20 * TILE_SIZE + 20) * 4;
    tile.pixels[center] = 255;
    tile.pixels[center + 3] = 128;
    node.tiles.set(makeTileKey(0, 0), tile);

    const sample = sampleTilesBilinear(node.tiles, 20.5, 20);
    expect(sample).not.toBeNull();
    expect(sample!.r).toBe(255);
    expect(sample!.a).toBeCloseTo(64, 0);
  });

  it('copies a frozen source rectangle into a different destination', () => {
    const node = splitLayer();
    const sourceTiles = snapshotTiles(node);
    const before = snapshotTiles(node);
    const result = compositePatchRegionOnNode(node, {
      sourceTiles,
      sourceRect: { x: 20, y: 20, w: 24, h: 24 },
      targetRect: { x: 150, y: 20, w: 24, h: 24 },
    });

    expect(result).not.toBe(node);
    const target = result.tiles.get(makeTileKey(1, 0))!.pixels;
    const targetIndex = (32 * TILE_SIZE + 162 - TILE_SIZE) * 4;
    expect(target[targetIndex]).toBeGreaterThan(target[targetIndex + 2]!);
    expect(sourceTiles.get(makeTileKey(0, 0))!.pixels).toEqual(
      before.get(makeTileKey(0, 0))!.pixels,
    );
  });

  it('chooses a bounded source and does not feed a spot heal from its output', () => {
    const node = splitLayer();
    const tile = node.tiles.get(makeTileKey(1, 0))!;
    const blemish = (64 * TILE_SIZE + 20) * 4;
    tile.pixels[blemish] = 255;
    tile.pixels[blemish + 1] = 0;
    tile.pixels[blemish + 2] = 0;
    const source = findSpotHealSource(node.tiles, TILE_SIZE + 20, 64, 6, 48);
    expect(source).not.toBeNull();
    expect(Math.hypot(source!.x - (TILE_SIZE + 20), source!.y - 64)).toBeGreaterThanOrEqual(12);

    const result = compositeSpotHealDabOnNode(node, dab(TILE_SIZE + 20, 64, 6), {
      sourceTiles: snapshotTiles(node),
      offsetX: 0,
      offsetY: 0,
      searchRadius: 48,
    });
    expect(result).not.toBe(node);
    const output = result.tiles.get(makeTileKey(1, 0))!.pixels;
    expect(output[blemish]).toBeLessThan(255);
  });
});
