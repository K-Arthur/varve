import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode, removeNode } from '../document';
import { imageFill } from '../fills';
import { makePaint } from '../types';
import {
  createEmbeddedAsset,
  findOrCreateEmbeddedAsset,
  getAsset,
  hashContent,
  isAssetReferenced,
  pruneUnusedAssets,
  upsertAsset,
} from '../assets';

const DATA_URL_A = 'data:image/png;base64,aGVsbG8gd29ybGQ=';
const DATA_URL_B = 'data:image/png;base64,Z29vZGJ5ZSB3b3JsZA==';

describe('hashContent', () => {
  it('is deterministic for identical input', () => {
    expect(hashContent(DATA_URL_A)).toBe(hashContent(DATA_URL_A));
  });

  it('differs for different input', () => {
    expect(hashContent(DATA_URL_A)).not.toBe(hashContent(DATA_URL_B));
  });
});

describe('createEmbeddedAsset', () => {
  it('builds a DocumentAsset with a stable content-derived id', () => {
    const asset = createEmbeddedAsset({
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    expect(asset.storage).toBe('embedded');
    expect(asset.dataUrl).toBe(DATA_URL_A);
    expect(asset.naturalWidth).toBe(10);
    expect(asset.naturalHeight).toBe(20);
    expect(asset.mimeType).toBe('image/png');
    expect(asset.hash).toBe(hashContent(DATA_URL_A));
    expect(asset.id).toContain(asset.hash);
    expect(asset.byteLength).toBeGreaterThan(0);
  });

  it('produces the same id for identical bytes', () => {
    const a = createEmbeddedAsset({
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const b = createEmbeddedAsset({
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    expect(a.id).toBe(b.id);
  });
});

describe('upsertAsset / getAsset', () => {
  it('stores and retrieves an asset', () => {
    const doc = createDocument();
    const asset = createEmbeddedAsset({
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const updated = upsertAsset(doc, asset);
    expect(getAsset(updated, asset.id)).toEqual(asset);
    expect(getAsset(updated, 'not-a-real-id')).toBeUndefined();
  });
});

describe('findOrCreateEmbeddedAsset', () => {
  it('creates a new asset on first insert', () => {
    const doc = createDocument();
    const result = findOrCreateEmbeddedAsset(doc, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    expect(Object.keys(result.document.assets ?? {})).toHaveLength(1);
    expect(getAsset(result.document, result.assetId)?.dataUrl).toBe(DATA_URL_A);
  });

  it('dedups identical content into the same asset id without growing the table', () => {
    const doc = createDocument();
    const first = findOrCreateEmbeddedAsset(doc, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const second = findOrCreateEmbeddedAsset(first.document, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    expect(second.assetId).toBe(first.assetId);
    expect(Object.keys(second.document.assets ?? {})).toHaveLength(1);
  });

  it('creates distinct assets for distinct content', () => {
    const doc = createDocument();
    const first = findOrCreateEmbeddedAsset(doc, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const second = findOrCreateEmbeddedAsset(first.document, {
      dataUrl: DATA_URL_B,
      mimeType: 'image/png',
      naturalWidth: 5,
      naturalHeight: 5,
    });
    expect(second.assetId).not.toBe(first.assetId);
    expect(Object.keys(second.document.assets ?? {})).toHaveLength(2);
  });
});

describe('isAssetReferenced / pruneUnusedAssets', () => {
  it('detects references from node fills and shared paints', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shape.fills = [imageFill(DATA_URL_A, { assetId })];
    const doc2 = addNode(doc1, shape);

    expect(isAssetReferenced(doc2, assetId)).toBe(true);
    expect(isAssetReferenced(doc2, 'unused-id')).toBe(false);
  });

  it('detects references via Document.paints', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const fill = imageFill(DATA_URL_A, { assetId });
    const doc2 = { ...doc1, paints: { p1: makePaint('p1', 'Shared image', fill) } };
    expect(isAssetReferenced(doc2, assetId)).toBe(true);
  });

  it('prunes assets no longer referenced by any node or paint', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    expect(getAsset(doc1, assetId)).toBeDefined();
    const pruned = pruneUnusedAssets(doc1);
    expect(pruned.assets).toBeUndefined();
  });

  it('keeps referenced assets and drops only unreferenced ones', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId: keptId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const { document: doc2, assetId: droppedId } = findOrCreateEmbeddedAsset(doc1, {
      dataUrl: DATA_URL_B,
      mimeType: 'image/png',
      naturalWidth: 5,
      naturalHeight: 5,
    });
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shape.fills = [imageFill(DATA_URL_A, { assetId: keptId })];
    const doc3 = addNode(doc2, shape);

    const pruned = pruneUnusedAssets(doc3);
    expect(getAsset(pruned, keptId)).toBeDefined();
    expect(getAsset(pruned, droppedId)).toBeUndefined();
  });
});

describe('removeNode garbage-collects unshared image assets', () => {
  it('drops an asset once its only referencing node is removed', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shape.fills = [imageFill(DATA_URL_A, { assetId })];
    const doc2 = addNode(doc1, shape);
    expect(getAsset(doc2, assetId)).toBeDefined();

    const doc3 = removeNode(doc2, 'n1');
    expect(getAsset(doc3, assetId)).toBeUndefined();
  });

  it('keeps an asset still referenced by a sibling node', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const shapeA = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shapeA.fills = [imageFill(DATA_URL_A, { assetId })];
    const shapeB = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shapeB.fills = [imageFill(DATA_URL_A, { assetId })];
    const doc2 = addNode(addNode(doc1, shapeA), shapeB);

    const doc3 = removeNode(doc2, 'n1');
    expect(getAsset(doc3, assetId)).toBeDefined();
  });

  it('keeps an asset still referenced by a shared Paint', () => {
    const doc0 = createDocument();
    const { document: doc1, assetId } = findOrCreateEmbeddedAsset(doc0, {
      dataUrl: DATA_URL_A,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 20,
    });
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    shape.fills = [imageFill(DATA_URL_A, { assetId })];
    const doc2 = {
      ...addNode(doc1, shape),
      paints: { p1: makePaint('p1', 'Shared image', imageFill(DATA_URL_A, { assetId })) },
    };

    const doc3 = removeNode(doc2, 'n1');
    expect(getAsset(doc3, assetId)).toBeDefined();
  });
});
