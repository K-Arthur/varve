import { describe, expect, it } from 'vitest';
import { deepCloneSubtree } from '../clone';
import { addNode, createDocument, removeNode, walkNodes } from '../document';
import { DocumentCodec } from '../documentCodec';
import {
  type BrushDab,
  compositeDabOnNode,
  createEmptyTile,
  deserializeTiles,
  eraseDabOnNode,
  makeRasterLayerNode,
  makeTileKey,
  parseTileKey,
  serializeTiles,
  TILE_SIZE,
  tileForPixel,
  tilesForBounds,
} from '../rasterLayer';
import type { RasterTile, SceneNode } from '../types';

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

describe('Tile serialization', () => {
  it('serializes and deserializes a tile', () => {
    const tile: RasterTile = {
      pixels: new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4),
      version: 1,
    };
    tile.pixels[0] = 255;
    tile.pixels[1] = 128;
    tile.pixels[2] = 64;
    tile.pixels[3] = 255;
    tile.pixels[4] = 10;
    tile.pixels[5] = 20;

    const tiles = new Map<string, RasterTile>();
    tiles.set('0:0', tile);

    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);

    expect(deserialized.size).toBe(1);
    const restored = deserialized.get('0:0')!;
    expect(restored.version).toBe(1);
    expect(restored.pixels[0]).toBe(255);
    expect(restored.pixels[1]).toBe(128);
    expect(restored.pixels[2]).toBe(64);
    expect(restored.pixels[3]).toBe(255);
    expect(restored.pixels[4]).toBe(10);
    expect(restored.pixels[5]).toBe(20);
  });

  it('serializes empty tile map', () => {
    const tiles = new Map<string, RasterTile>();
    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);
    expect(deserialized.size).toBe(0);
  });

  it('handles multiple tiles', () => {
    const tiles = new Map<string, RasterTile>();
    tiles.set('0:0', createEmptyTile());
    tiles.set('1:0', createEmptyTile());
    tiles.set('0:1', createEmptyTile());
    tiles.get('0:0')!.pixels[0] = 42;

    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);
    expect(deserialized.size).toBe(3);
    expect(deserialized.get('0:0')!.pixels[0]).toBe(42);
    expect(deserialized.get('1:0')!.pixels[0]).toBe(0);
  });
});

describe('Tile compositing', () => {
  it('erases with the brush mask instead of a square region', () => {
    const node = makeRasterLayerNode('erase-mask', { width: 256, height: 256 });
    const tile = createEmptyTile();
    for (let index = 3; index < tile.pixels.length; index += 4) tile.pixels[index] = 255;
    node.tiles.set('0:0', tile);
    const erased = eraseDabOnNode(node, {
      x: 64,
      y: 64,
      radius: 10,
      opacity: 1,
      flow: 1,
      hardness: 1,
      angle: 0,
      roundness: 1,
      strokeT: 0,
    });
    expect(erased.tiles.get('0:0')!.pixels[64 * 128 * 4 + 64 * 4 + 3]).toBe(0);
    expect(erased.tiles.get('0:0')!.pixels[54 * 128 * 4 + 54 * 4 + 3]).toBeGreaterThan(0);
  });
  it('composites a dab onto a node tile', () => {
    const node = makeRasterLayerNode('test-comp-1', { width: 256, height: 256 });
    const dab: BrushDab = {
      x: 64,
      y: 64,
      radius: 10,
      opacity: 1,
      flow: 1,
      hardness: 0.8,
      angle: 0,
      roundness: 1,
      strokeT: 0,
    };
    const color: [number, number, number, number] = [255, 0, 0, 255];

    const result = compositeDabOnNode(node, dab, color);
    expect(result.tiles.get('0:0')).toBeDefined();
  });

  it('creates new tiles only where dabs land', () => {
    const node = makeRasterLayerNode('test-comp-2', { width: 512, height: 512 });
    expect(node.tiles.size).toBe(0);

    const dab: BrushDab = {
      x: 10,
      y: 10,
      radius: 5,
      opacity: 1,
      flow: 1,
      hardness: 1,
      angle: 0,
      roundness: 1,
      strokeT: 0,
    };
    const result = compositeDabOnNode(node, dab, [255, 255, 255, 255]);
    expect(result.tiles.size).toBe(1);
    expect(result.tiles.has('0:0')).toBe(true);
  });

  it('preserves immutability of original node', () => {
    const node = makeRasterLayerNode('test-comp-3', { width: 256, height: 256 });
    expect(node.tiles.size).toBe(0);

    const dab: BrushDab = {
      x: 50,
      y: 50,
      radius: 8,
      opacity: 1,
      flow: 1,
      hardness: 0.9,
      angle: 0,
      roundness: 1,
      strokeT: 0,
    };
    const result = compositeDabOnNode(node, dab, [0, 255, 0, 255]);

    expect(result.tiles.size).toBe(1);
    expect(node.tiles.size).toBe(0);
  });

  it('spans multiple tiles for large brushes', () => {
    const node = makeRasterLayerNode('test-comp-4', { width: 512, height: 512 });
    const dab: BrushDab = {
      x: 120,
      y: 120,
      radius: 40,
      opacity: 1,
      flow: 1,
      hardness: 1,
      angle: 0,
      roundness: 1,
      strokeT: 0,
    };

    const result = compositeDabOnNode(node, dab, [0, 255, 0, 255]);
    expect(result.tiles.get('0:0')).toBeDefined();
    expect(result.tiles.get('1:0')).toBeDefined();
    expect(result.tiles.get('0:1')).toBeDefined();
    expect(result.tiles.get('1:1')).toBeDefined();
  });
});

describe('RasterLayerNode document integration', () => {
  it('preserves tile pixels through the canonical document codec', () => {
    let doc = createDocument('raster-persistence');
    const node = makeRasterLayerNode('rl-persist', { width: 256, height: 256 });
    const tile = createEmptyTile();
    tile.pixels.set([12, 34, 56, 255]);
    node.tiles.set('0:0', tile);
    doc = addNode(doc, node);

    const result = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.document.nodes['rl-persist'];
    expect(restored?.kind).toBe('rasterLayer');
    if (restored?.kind !== 'rasterLayer') return;
    expect(restored.tiles).toBeInstanceOf(Map);
    expect([...restored.tiles.get('0:0')!.pixels.slice(0, 4)]).toEqual([12, 34, 56, 255]);
  });

  it('can be added to a document via addNode', () => {
    let doc = createDocument('raster-test');
    const node = makeRasterLayerNode('rl-1', { width: 640, height: 480 });
    doc = addNode(doc, node);
    expect(doc.nodes['rl-1']).toBeDefined();
    expect(doc.nodes['rl-1']!.kind).toBe('rasterLayer');
    expect(doc.rootChildren).toContain('rl-1');
  });

  it('appears in walkNodes output', () => {
    let doc = createDocument('raster-test-2');
    const node = makeRasterLayerNode('rl-2', { width: 100, height: 100 });
    doc = addNode(doc, node);
    const result = walkNodes(doc);
    expect(result.has('rl-2')).toBe(true);
    expect(result.get('rl-2')!.node.kind).toBe('rasterLayer');
  });

  it('can be removed from a document', () => {
    let doc = createDocument('raster-test-3');
    doc = addNode(doc, makeRasterLayerNode('rl-3', { width: 200, height: 200 }));
    expect(doc.nodes['rl-3']).toBeDefined();
    doc = removeNode(doc, 'rl-3');
    expect(doc.nodes['rl-3']).toBeUndefined();
    expect(doc.rootChildren).not.toContain('rl-3');
  });

  it('clone preserves tile data', () => {
    const rl = makeRasterLayerNode('rl-clone-1', { width: 256, height: 256 });
    const tile = createEmptyTile();
    tile.pixels[0] = 128;
    tile.pixels[1] = 64;
    tile.pixels[2] = 32;
    tile.pixels[3] = 255;
    rl.tiles.set('0:0', tile);

    let doc = createDocument('raster-clone-test');
    doc = addNode(doc, rl);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, 'rl-clone-1');
    const clonedNode = result.nodes[result.rootId] as import('../types').RasterLayerNode;

    expect(clonedNode.kind).toBe('rasterLayer');
    expect(clonedNode.id).not.toBe('rl-clone-1');
    expect(clonedNode.tiles.size).toBe(1);
    expect(clonedNode.tiles.get('0:0')).toBeDefined();
    expect(clonedNode.tiles.get('0:0')!.pixels[0]).toBe(128);
    expect(clonedNode.tiles.get('0:0')!.pixels[1]).toBe(64);
    expect(clonedNode.tiles.get('0:0')!.pixels[2]).toBe(32);
    expect(clonedNode.tiles.get('0:0')!.pixels[3]).toBe(255);
  });
});
