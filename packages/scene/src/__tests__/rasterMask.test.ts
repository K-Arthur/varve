/**
 * Raster mask contract tests.
 *
 * Research basis: Adobe/PSD-style non-destructive pixel masks and local-first
 * immutable asset ownership require source-pixel coordinates and copy-on-write
 * updates at document boundaries.
 */
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode } from '../document';
import { DocumentCodec } from '../documentCodec';
import type { Document, RasterMaskAsset, ShapeNode } from '../index';
import {
  addRasterMaskAsset,
  removeRasterMaskAsset,
  resolveMask,
  updateRasterMaskAsset,
  validateMaskSource,
} from '../masks';

const PNG_DATA_URL = 'data:image/png;base64,AA==';

function makeRasterAsset(id: string, width = 64, height = 32): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
    width,
    height,
    byteLength: 1,
  };
}

function makeImageDocument(): { doc: Document; imageId: string } {
  const imageId = 'image-1';
  const image = makeShapeNode(imageId, { kind: 'rect', x: 0, y: 0, w: 64, h: 32 });
  image.fills = [
    {
      type: 'image',
      image: { src: 'image-a', fit: 'fill', x: 0, y: 0, scale: 1, imageWidth: 64, imageHeight: 32 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  ];
  return { doc: addNode(createDocument('Raster masks', true), image), imageId };
}

describe('native raster masks', () => {
  it('attaches a source-pixel raster alpha mask to an image shape', () => {
    const { doc, imageId } = makeImageDocument();
    const next = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));

    expect(next).not.toBe(doc);
    expect(next.nodes[imageId]?.mask).toEqual({
      type: 'alpha',
      visible: true,
      rasterMask: {
        assetId: 'mask-1',
        coordinateSpace: 'source-image-pixels',
        sourceFingerprint: 'sha256:image-a',
        sourcePixelRevision: 1,
      },
    });
    expect(next.rasterMaskAssets?.['mask-1']?.width).toBe(64);
    expect(resolveMask(next.nodes[imageId]!)).toEqual(next.nodes[imageId]?.mask);
  });

  it('only attaches raster masks to image-filled shapes with a resolved asset', () => {
    const shape = makeShapeNode('shape-1', { kind: 'rect', x: 0, y: 0, w: 64, h: 32 });
    const doc = addNode(createDocument('No image', true), shape);
    expect(addRasterMaskAsset(doc, shape.id, makeRasterAsset('mask-1'))).toBe(doc);

    const { doc: imageDoc, imageId } = makeImageDocument();
    const dangling = {
      ...imageDoc,
      nodes: {
        ...imageDoc.nodes,
        [imageId]: {
          ...imageDoc.nodes[imageId],
          mask: {
            type: 'alpha',
            visible: true,
            rasterMask: {
              assetId: 'missing',
              coordinateSpace: 'source-image-pixels',
              sourceFingerprint: 'sha256:image-a',
              sourcePixelRevision: 1,
            },
          },
        } as ShapeNode,
      },
    };
    expect(validateMaskSource(dangling, dangling.nodes[imageId]!.mask!)).toMatch(/missing/i);
  });

  it('updates shared assets copy-on-write and removes only unreferenced payloads', () => {
    const { doc, imageId } = makeImageDocument();
    const second = { ...(doc.nodes[imageId] as ShapeNode), id: 'image-2', name: 'Copy' };
    let shared = addNode(doc, second);
    shared = addRasterMaskAsset(shared, imageId, makeRasterAsset('shared-mask'));
    shared = addRasterMaskAsset(shared, second.id, makeRasterAsset('shared-mask'));

    const updated = updateRasterMaskAsset(shared, imageId, makeRasterAsset('edited-mask'));
    expect(updated.nodes[imageId]?.mask?.rasterMask?.assetId).toBe('edited-mask');
    expect(updated.nodes[second.id]?.mask?.rasterMask?.assetId).toBe('shared-mask');
    expect(updated.rasterMaskAssets?.['shared-mask']).toBeDefined();
    expect(updated.rasterMaskAssets?.['edited-mask']).toBeDefined();

    const oneRemoved = removeRasterMaskAsset(updated, second.id);
    expect(oneRemoved.nodes[second.id]?.mask).toBeUndefined();
    expect(oneRemoved.rasterMaskAssets?.['shared-mask']).toBeUndefined();
    expect(oneRemoved.rasterMaskAssets?.['edited-mask']).toBeDefined();

    const allRemoved = removeRasterMaskAsset(oneRemoved, imageId);
    expect(allRemoved.rasterMaskAssets?.['edited-mask']).toBeUndefined();
  });

  it('requires exactly one meaningful mask source', () => {
    const rasterMask = {
      assetId: 'mask-1',
      coordinateSpace: 'source-image-pixels' as const,
      sourceFingerprint: 'sha256:image-a',
      sourcePixelRevision: 1,
    };
    expect(validateMaskSource(undefined, { type: 'alpha', visible: true })).toMatch(/exactly one/i);
    expect(
      validateMaskSource(undefined, {
        type: 'alpha',
        visible: true,
        sourceNodeId: 'source',
        rasterMask,
      }),
    ).toMatch(/exactly one/i);
    expect(
      validateMaskSource(undefined, {
        type: 'clip',
        visible: true,
        vectorMask: { points: [], closed: true, fillRule: 'nonzero' },
      }),
    ).toBeNull();
  });
});

describe('raster mask document boundary validation', () => {
  it.each([
    ['invalid PNG data URL', { dataUrl: 'data:image/jpeg;base64,AA==' }, /PNG data URL/i],
    ['zero width', { width: 0 }, /positive dimensions/i],
    ['dimension above limit', { width: 16_385 }, /dimension limit/i],
    ['decoded pixel limit', { width: 16_385, height: 16_385 }, /decoded pixel limit/i],
    ['encoded byte limit', { byteLength: 128 * 1024 * 1024 + 1 }, /encoded byte limit/i],
  ])('rejects %s', (_label, override, error) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = {
      ...attached,
      rasterMaskAssets: {
        ...attached.rasterMaskAssets,
        'mask-1': { ...attached.rasterMaskAssets?.['mask-1'], ...override },
      },
    };

    const decoded = DocumentCodec.decode(JSON.stringify(invalid));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(error);
  });

  it('rejects a missing raster asset reference', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const decoded = DocumentCodec.decode(JSON.stringify({ ...attached, rasterMaskAssets: {} }));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/missing raster mask asset/i);
  });
});
