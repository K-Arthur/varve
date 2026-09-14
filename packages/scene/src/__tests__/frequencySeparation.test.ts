import { imageDataToRasterTiles, rasterTilesToImageData } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { deepCloneSubtree } from '../clone';
import { addNode, createDocument, type Document } from '../document';
import {
  createFrequencySeparation,
  decodeFrequencySeparationTiles,
  findFrequencySeparationForBand,
  flattenFrequencySeparation,
  getFrequencySeparationState,
  regenerateFrequencySeparation,
  resolveFrequencySeparation,
  validateFrequencySeparationState,
} from '../frequencySeparation';
import {
  applyLiquifyDabToNode,
  decodeNodeFreezeMask,
  getLiquifyField,
  setLiquifyFreezeMask,
} from '../liquify';
import { makeRasterLayerNode, TILE_SIZE } from '../rasterLayer';
import type { GroupNode, RasterLayerNode } from '../types';

function makeSourceImage(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 9) % 256;
      data[i + 1] = (y * 13) % 256;
      data[i + 2] = ((x + y) % 2 === 0 ? 200 : 40) + ((x * y) % 30);
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

function makeRasterDoc(w = 64, h = 48): { doc: Document; nodeId: string } {
  const node = makeRasterLayerNode('r1', { width: w, height: h }, { name: 'Photo' });
  node.tiles = imageDataToRasterTiles(makeSourceImage(w, h), TILE_SIZE);
  return { doc: addNode(createDocument(), node) as Document, nodeId: 'r1' };
}

function compositeOf(doc: Document, groupId: string): ImageData {
  const decoded = decodeFrequencySeparationTiles(doc, groupId);
  if (!decoded) throw new Error('decode failed');
  return rasterTilesToImageData(decoded.tiles, decoded.width, decoded.height, TILE_SIZE);
}

function maxError(a: ImageData, b: ImageData): number {
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a.data[i + c]! - b.data[i + c]!));
  }
  return max;
}

describe('createFrequencySeparation', () => {
  it('converts a raster layer into a marked group with two editable bands', () => {
    const { doc, nodeId } = makeRasterDoc();
    const result = createFrequencySeparation(doc, nodeId, { radius: 4 });
    expect(result).not.toBeNull();
    const next = result!.doc as Document;
    const group = next.nodes[result!.groupId] as GroupNode;
    expect(group.kind).toBe('group');
    expect(group.children).toEqual([result!.lowId, result!.highId]);
    const state = getFrequencySeparationState(group);
    expect(state).not.toBeNull();
    expect(state!.lowNodeId).toBe(result!.lowId);
    expect(state!.highNodeId).toBe(result!.highId);
    expect(state!.radius).toBe(4);
    // The group replaces the source in the root order (no duplicate layer
    // left behind); documents may have other pre-existing root nodes.
    expect(next.rootChildren).toContain(result!.groupId);
    expect(next.rootChildren).not.toContain(result!.lowId);
    const low = next.nodes[result!.lowId] as RasterLayerNode;
    const high = next.nodes[result!.highId] as RasterLayerNode;
    expect(low.name).toBe('Photo Tone');
    expect(high.name).toBe('Photo Detail');
    expect(low.tiles.size).toBeGreaterThan(0);
    expect(high.tiles.size).toBeGreaterThan(0);
  });

  it('reconstructs the source within the declared tolerance before edits', () => {
    const { doc, nodeId } = makeRasterDoc();
    const result = createFrequencySeparation(doc, nodeId, { radius: 4 })!;
    const composite = compositeOf(result.doc as Document, result.groupId);
    const source = makeSourceImage(64, 48);
    expect(maxError(source, composite)).toBeLessThanOrEqual(1);
    expect(result.reconstruction.max).toBeLessThanOrEqual(1);
  });

  it('rejects non-raster and empty sources', () => {
    const { doc } = makeRasterDoc();
    const empty = makeRasterLayerNode('empty', { width: 10, height: 10 });
    const withEmpty = addNode(doc, empty) as Document;
    expect(createFrequencySeparation(withEmpty, 'empty', { radius: 2 })).toBeNull();
    expect(createFrequencySeparation(withEmpty, 'missing', { radius: 2 })).toBeNull();
  });

  it('editing the tone band changes the decoded composite', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 4 })!;
    const doc = result.doc as Document;
    const low = doc.nodes[result.lowId] as RasterLayerNode;
    const tiles = new Map(low.tiles);
    const first = [...tiles.entries()][0]!;
    const pixels = new Uint8ClampedArray(first[1].pixels);
    pixels[0] = 255;
    pixels[1] = 0;
    pixels[2] = 0;
    tiles.set(first[0], { pixels, version: first[1].version + 1 });
    const edited: Document = {
      ...doc,
      nodes: { ...doc.nodes, [result.lowId]: { ...low, tiles } },
    };
    const composite = compositeOf(edited, result.groupId);
    const highTile = (doc.nodes[result.highId] as RasterLayerNode).tiles.get(first[0])!;
    // Decode = edited tone + residual; the detail band carries the signed
    // residual for this exact tile/pixel.
    const residual = 2 * (highTile.pixels[0]! - 128);
    expect(composite.data[0]).toBe(Math.max(0, Math.min(255, 255 + residual)));
    expect(composite.data[1]).toBe(Math.max(0, Math.min(255, 0 + 2 * (highTile.pixels[1]! - 128))));
  });

  it('regenerate preserves the current composite and updates the radius', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 3 })!;
    const doc = result.doc as Document;
    const before = compositeOf(doc, result.groupId);
    const regenerated = regenerateFrequencySeparation(doc, result.groupId, { radius: 9 })!;
    const after = compositeOf(regenerated.doc as Document, result.groupId);
    expect(maxError(before, after)).toBeLessThanOrEqual(1);
    const state = getFrequencySeparationState((regenerated.doc as Document).nodes[result.groupId]);
    expect(state!.radius).toBe(9);
  });

  it('flatten bakes the decode into one raster layer and drops the marker', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 4 })!;
    const doc = result.doc as Document;
    const before = compositeOf(doc, result.groupId);
    const flattened = flattenFrequencySeparation(doc, result.groupId)!;
    expect(flattened.nodes[result.groupId]).toBeUndefined();
    expect(flattened.nodes[result.highId]).toBeUndefined();
    const baked = flattened.nodes[result.lowId] as RasterLayerNode;
    expect(baked.kind).toBe('rasterLayer');
    const bakedImage = rasterTilesToImageData(baked.tiles, baked.width, baked.height, TILE_SIZE);
    expect(maxError(before, bakedImage)).toBeLessThanOrEqual(1);
    expect((flattened.rootChildren ?? []).includes(result.lowId)).toBe(true);
  });

  it('resolve/lookup becomes inert when a band is deleted', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 4 })!;
    const doc = result.doc as Document;
    const nodes = { ...doc.nodes };
    delete nodes[result.highId];
    const broken: Document = { ...doc, nodes };
    expect(resolveFrequencySeparation(broken, result.groupId)).toBeNull();
    expect(decodeFrequencySeparationTiles(broken, result.groupId)).toBeNull();
    expect(findFrequencySeparationForBand(broken, result.lowId)).toBeNull();
  });

  it('validates persisted markers', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 4 })!;
    const group = result.doc.nodes[result.groupId] as GroupNode;
    expect(validateFrequencySeparationState(group.frequencySeparation)).not.toBeNull();
    expect(
      validateFrequencySeparationState({ ...group.frequencySeparation, version: 7 }),
    ).toBeNull();
    expect(
      validateFrequencySeparationState({ ...group.frequencySeparation, radius: Number.NaN }),
    ).toBeNull();
  });

  it('duplicating the group remaps both band references', () => {
    const result = createFrequencySeparation(makeRasterDoc().doc, 'r1', { radius: 4 })!;
    const doc = result.doc as Document;
    const clone = deepCloneSubtree(doc.nodes, doc.nextId, result.groupId, { nameSuffix: ' Copy' });
    const clonedGroup = clone.nodes[clone.rootId] as GroupNode;
    const state = getFrequencySeparationState(clonedGroup);
    expect(state).not.toBeNull();
    expect(state!.lowNodeId).not.toBe(result.lowId);
    expect(state!.highNodeId).not.toBe(result.highId);
    expect(clone.nodes[state!.lowNodeId]).toBeTruthy();
    expect(clone.nodes[state!.highNodeId]).toBeTruthy();
    const clonedDoc = { ...doc, nodes: { ...doc.nodes, ...clone.nodes }, nextId: clone.nextId };
    const composite = compositeOf(clonedDoc, clone.rootId);
    expect(composite.width).toBe(64);
  });
});

describe('scene liquify ops', () => {
  it('applies a push dab to a raster node without touching tiles', () => {
    const { doc, nodeId } = makeRasterDoc();
    const before = doc.nodes[nodeId] as RasterLayerNode;
    const next = applyLiquifyDabToNode(doc, nodeId, 'push', {
      x: 32,
      y: 24,
      radius: 20,
      strength: 1,
      pressure: 1,
      deltaX: 6,
      deltaY: 0,
    })!;
    const after = next.nodes[nodeId] as RasterLayerNode;
    expect(after.tiles).toBe(before.tiles);
    const field = getLiquifyField(after);
    expect(field).not.toBeNull();
    expect(field!.displacement.some((value) => Math.abs(value) > 0.01)).toBe(true);
  });

  it('freeze mask round-trips through the document', () => {
    const { doc, nodeId } = makeRasterDoc();
    const mask = { width: 8, height: 6, data: new Uint8Array(48).fill(255) };
    const next = setLiquifyFreezeMask(doc, nodeId, mask)!;
    const node = next.nodes[nodeId] as RasterLayerNode;
    const decoded = decodeNodeFreezeMask(node);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(8);
    expect(Array.from(decoded!.data)).toEqual(Array.from(mask.data));
    const cleared = setLiquifyFreezeMask(next, nodeId, null)!;
    expect((cleared.nodes[nodeId] as RasterLayerNode).liquifyFreeze).toBeUndefined();
  });
});
