import { describe, expect, it } from 'vitest';
import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  parseTileKey,
  TILE_SIZE,
  tileForPixel,
  tilesForBounds,
} from '../rasterLayer';
import type { SceneNode } from '../types';

describe('RasterLayerNode', () => {
  it('creates a raster layer node with correct kind', () => {
    const node = makeRasterLayerNode('test-1', { width: 1920, height: 1080 });
    expect(node.kind).toBe('rasterLayer');
    expect(node.width).toBe(1920);
    expect(node.height).toBe(1080);
    expect(node.tiles.size).toBe(0);
  });

  it('uses default name and opts', () => {
    const node = makeRasterLayerNode('test-2', { width: 100, height: 200 });
    expect(node.name).toBe('Raster Layer');
    expect(node.visible).toBe(true);
    expect(node.locked).toBe(false);
    expect(node.opacity).toBe(1);
    expect(node.blendMode).toBe('normal');
  });

  it('accepts optional overrides', () => {
    const node = makeRasterLayerNode(
      'test-3',
      { width: 400, height: 300 },
      {
        name: 'Sketch Layer',
        opacity: 0.5,
        visible: false,
        locked: true,
        blendMode: 'multiply',
      },
    );
    expect(node.name).toBe('Sketch Layer');
    expect(node.opacity).toBe(0.5);
    expect(node.visible).toBe(false);
    expect(node.locked).toBe(true);
    expect(node.blendMode).toBe('multiply');
  });

  it('produces a valid SceneNode', () => {
    const node = makeRasterLayerNode('test-4', { width: 64, height: 64 }) as SceneNode;
    expect(node.kind).toBe('rasterLayer');
  });

  it('enforces minimum dimensions of 1', () => {
    const node = makeRasterLayerNode('test-5', { width: 0, height: 0 });
    expect(node.width).toBe(1);
    expect(node.height).toBe(1);
  });
});

describe('Tile utilities', () => {
  it('createEmptyTile produces correct size', () => {
    const tile = createEmptyTile();
    expect(tile.pixels.length).toBe(TILE_SIZE * TILE_SIZE * 4);
    expect(tile.version).toBe(1);
    expect(tile.pixels.every((b) => b === 0)).toBe(true);
  });

  it('tileForPixel computes correct tile key', () => {
    expect(tileForPixel(0, 0)).toEqual({ col: 0, row: 0 });
    expect(tileForPixel(127, 127)).toEqual({ col: 0, row: 0 });
    expect(tileForPixel(128, 0)).toEqual({ col: 1, row: 0 });
    expect(tileForPixel(0, 128)).toEqual({ col: 0, row: 1 });
    expect(tileForPixel(256, 256)).toEqual({ col: 2, row: 2 });
  });

  it('makeTileKey and parseTileKey round-trip', () => {
    expect(makeTileKey(3, 7)).toBe('3:7');
    expect(parseTileKey('3:7')).toEqual({ col: 3, row: 7 });
  });

  it('tilesForBounds returns covered tile keys', () => {
    const keys = tilesForBounds(0, 0, 256, 256);
    expect(keys).toHaveLength(4);
    expect(keys).toContainEqual({ col: 0, row: 0 });
    expect(keys).toContainEqual({ col: 1, row: 0 });
    expect(keys).toContainEqual({ col: 0, row: 1 });
    expect(keys).toContainEqual({ col: 1, row: 1 });
  });

  it('tilesForBounds handles single tile', () => {
    const keys = tilesForBounds(10, 10, 50, 50);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ col: 0, row: 0 });
  });
});
