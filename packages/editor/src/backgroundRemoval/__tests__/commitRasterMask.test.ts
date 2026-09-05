/**
 * Tests for the native mask commit service.
 *
 * Research basis: immutability contract of addRasterMaskAsset /
 * updateRasterMaskAsset / removeRasterMaskAsset from @varve/scene.
 *
 * NOTE: The mask asset dimensions must match the source image fill
 * dimensions per validateSourcePixelDimensions. All test PNGs are 1x1.
 */

import type { Document } from '@varve/scene';
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  commitRasterMask,
  hasNativeRasterMask,
  removeRasterMaskFromNode,
} from '../commitRasterMask';

const PNG_WHITE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const PNG_BLACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

function makeDoc(): Document {
  const doc = createDocument('Test', true);
  const imgNode = makeImageShapeNode('img-1', {
    src: 'test-src',
    w: 1,
    h: 1,
    imageWidth: 1,
    imageHeight: 1,
  });
  return addNode(doc, imgNode);
}

describe('commitRasterMask', () => {
  it('never aliases mask payloads on divergent history paths', () => {
    const before = makeDoc();
    const fields = { width: 1, height: 1, dataUrl: PNG_WHITE };
    const abandoned = commitRasterMask(before, 'img-1', fields);
    const divergent = commitRasterMask(before, 'img-1', { ...fields, dataUrl: PNG_BLACK });
    const abandonedId = abandoned.nodes['img-1']!.mask!.rasterMask!.assetId;
    const divergentId = divergent.nodes['img-1']!.mask!.rasterMask!.assetId;
    expect(divergentId).not.toBe(abandonedId);
    expect(abandoned.rasterMaskAssets![abandonedId]!.dataUrl).toBe(PNG_WHITE);
    expect(divergent.rasterMaskAssets![divergentId]!.dataUrl).toBe(PNG_BLACK);
    const replacement = commitRasterMask(abandoned, 'img-1', fields);
    const fork = commitRasterMask(abandoned, 'img-1', { ...fields, dataUrl: PNG_BLACK });
    expect(replacement.nodes['img-1']!.mask!.rasterMask!.assetId).not.toBe(
      fork.nodes['img-1']!.mask!.rasterMask!.assetId,
    );
  });

  it('commits a new raster mask with an immutable asset ID', () => {
    const doc = makeDoc();
    const updated = commitRasterMask(doc, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
      method: 'ai-balanced',
      generatedAt: 1000,
      confidence: 0.95,
    });

    expect(hasNativeRasterMask(updated, 'img-1')).toBe(true);
    const node = updated.nodes['img-1']!;
    expect(node.mask?.rasterMask).toBeDefined();
    expect(node.mask!.rasterMask!.assetId).toMatch(/^mask-/);
    const asset = updated.rasterMaskAssets![node.mask!.rasterMask!.assetId]!;
    expect(asset.dataUrl).toBe(PNG_WHITE);
  });

  it('records the actual execution runtime separately from model metadata', () => {
    const updated = commitRasterMask(makeDoc(), 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
      method: 'ai-quality',
      runtime: 'wasm',
      modelId: 'birefnet-lite',
      modelVersion: '1.2.3',
      modelChecksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    expect(updated.nodes['img-1']?.mask?.rasterMask?.provenance).toMatchObject({
      method: 'ai-quality',
      runtime: 'wasm',
      modelId: 'birefnet-lite',
      modelVersion: '1.2.3',
      modelChecksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('repairs stale imported source dimensions before attaching a valid mask', () => {
    const doc = makeDoc();
    const image = doc.nodes['img-1']!;
    const stale = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'img-1': {
          ...image,
          fills:
            image.kind === 'shape'
              ? image.fills?.map((fill) =>
                  fill.type === 'image' && fill.image
                    ? { ...fill, image: { ...fill.image, imageWidth: 2, imageHeight: 2 } }
                    : fill,
                )
              : undefined,
        },
      },
    } as Document;

    const updated = commitRasterMask(stale, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
      sourceLocator: 'test-src',
    });

    expect(hasNativeRasterMask(updated, 'img-1')).toBe(true);
    const updatedNode = updated.nodes['img-1']!;
    expect(
      updatedNode.kind === 'shape' ? updatedNode.fills?.[0]?.image?.imageWidth : undefined,
    ).toBe(1);
    expect(
      updatedNode.kind === 'shape' ? updatedNode.fills?.[0]?.image?.imageHeight : undefined,
    ).toBe(1);
  });

  it('commits masks for embedded images whose data URL exceeds identity limits', () => {
    const embeddedSource = `data:image/png;base64,${'A'.repeat(12_000)}`;
    const doc = createDocument('Large embedded source', true);
    const image = makeImageShapeNode('large-image', {
      src: embeddedSource,
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    });
    const withImage = addNode(doc, image);

    const updated = commitRasterMask(withImage, image.id, {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
      sourceLocator: embeddedSource,
    });

    expect(hasNativeRasterMask(updated, image.id)).toBe(true);
    const identity = updated.nodes[image.id]?.mask?.rasterMask?.sourceIdentity;
    expect(identity?.kind).toBe('source-metadata');
    if (identity?.kind === 'source-metadata') {
      expect(identity.locator.length).toBeLessThanOrEqual(8192);
      expect(identity.locator).toContain(`length=${embeddedSource.length}`);
    }
  });

  it('creates a distinct asset ID on update', () => {
    const doc = makeDoc();
    const first = commitRasterMask(doc, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
    });

    const updated = commitRasterMask(first, 'img-1', {
      dataUrl: PNG_BLACK,
      width: 1,
      height: 1,
    });

    const node = updated.nodes['img-1']!;
    expect(node.mask?.rasterMask?.assetId).not.toBe(
      first.nodes['img-1']!.mask!.rasterMask!.assetId,
    );
    expect(node.mask?.rasterMask?.editRevision).toBeGreaterThanOrEqual(1);
    const asset = updated.rasterMaskAssets![node.mask!.rasterMask!.assetId]!;
    expect(asset.dataUrl).toBe(PNG_BLACK);
  });

  it('removes a mask and cleans up the asset', () => {
    const doc = makeDoc();
    const committed = commitRasterMask(doc, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
    });

    const removed = removeRasterMaskFromNode(committed, 'img-1');
    expect(hasNativeRasterMask(removed, 'img-1')).toBe(false);
    const node = removed.nodes['img-1']!;
    expect((node as { mask?: unknown }).mask).toBeUndefined();
    expect(
      removed.rasterMaskAssets?.[committed.nodes['img-1']!.mask!.rasterMask!.assetId],
    ).toBeUndefined();
  });

  it('hasNativeRasterMask returns false for a node without a mask', () => {
    const doc = makeDoc();
    expect(hasNativeRasterMask(doc, 'img-1')).toBe(false);
  });

  it('hasNativeRasterMask returns true after commit', () => {
    const doc = makeDoc();
    expect(hasNativeRasterMask(doc, 'img-1')).toBe(false);
    const committed = commitRasterMask(doc, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
    });
    expect(hasNativeRasterMask(committed, 'img-1')).toBe(true);
  });
});
