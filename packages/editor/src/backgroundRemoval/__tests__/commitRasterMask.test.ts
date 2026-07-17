/**
 * Tests for the native mask commit service.
 *
 * Research basis: immutability contract of addRasterMaskAsset /
 * updateRasterMaskAsset / removeRasterMaskAsset from @strata/scene.
 *
 * NOTE: The mask asset dimensions must match the source image fill
 * dimensions per validateSourcePixelDimensions. All test PNGs are 1x1.
 */

import type { Document } from '@strata/scene';
import { addNode, createDocument, makeImageShapeNode } from '@strata/scene';
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
  it('commits a new raster mask with stable asset ID', () => {
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
    expect(node.mask!.rasterMask!.assetId).toBe('mask-img-1');
    const asset = updated.rasterMaskAssets!['mask-img-1']!;
    expect(asset.dataUrl).toBe(PNG_WHITE);
  });

  it('creates a versioned asset ID on update', () => {
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
    expect(node.mask?.rasterMask?.assetId).toBe('mask-img-1-v2');
    expect(node.mask?.rasterMask?.editRevision).toBeGreaterThanOrEqual(1);
    const asset = updated.rasterMaskAssets!['mask-img-1-v2']!;
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
    expect(removed.rasterMaskAssets?.['mask-img-1']).toBeUndefined();
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
