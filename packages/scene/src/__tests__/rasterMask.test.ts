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
  setMaskDensity,
  setMaskFeather,
  setMaskInverted,
  setMaskSourceNode,
  setMaskVectorPath,
  setMaskVisible,
  updateRasterMaskAsset,
  validateMaskSource,
} from '../masks';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function makeRasterAsset(id: string, width = 64, height = 32): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
    width,
    height,
    byteLength: 8,
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
    ).toMatch(/exactly one/i);
  });

  it('edits native raster mask properties on eligible image leaves', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const hidden = setMaskVisible(attached, imageId, false);
    const inverted = setMaskInverted(hidden, imageId, true);
    const feathered = setMaskFeather(inverted, imageId, 2.5);
    const softened = setMaskDensity(feathered, imageId, 0.75);

    expect(softened.nodes[imageId]?.mask).toMatchObject({
      visible: false,
      inverted: true,
      feather: 2.5,
      density: 0.75,
      rasterMask: { assetId: 'mask-1' },
    });
    expect(setMaskSourceNode(attached, imageId, imageId)).toBe(attached);
    expect(
      setMaskVectorPath(attached, imageId, [{ x: 0, y: 0, handleIn: null, handleOut: null }], true),
    ).toBe(attached);
  });
});

describe('raster mask document boundary validation', () => {
  it.each([
    ['invalid PNG MIME', { dataUrl: 'data:image/jpeg;base64,iVBORw0KGgo=' }, /PNG data URL/i],
    ['invalid PNG signature', { dataUrl: 'data:image/png;base64,AA==' }, /PNG signature/i],
    ['malformed base64', { dataUrl: 'data:image/png;base64,%%%%' }, /PNG data URL/i],
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

  it.each([
    [
      'invalid asset bounds',
      (doc: Document) => ({
        ...doc,
        rasterMaskAssets: {
          ...doc.rasterMaskAssets,
          'mask-1': {
            ...(doc.rasterMaskAssets?.['mask-1'] as RasterMaskAsset),
            width: 0,
          },
        },
      }),
    ],
    [
      'invalid source combination',
      (doc: Document) => ({
        ...doc,
        nodes: {
          ...doc.nodes,
          'image-1': {
            ...doc.nodes['image-1']!,
            mask: { ...doc.nodes['image-1']!.mask!, sourceNodeId: 'other' },
          } as ShapeNode,
        },
      }),
    ],
    ['missing asset reference', (doc: Document) => ({ ...doc, rasterMaskAssets: {} })],
  ])('normalizes and encodes %s without retaining unsafe raster state', (_label, corrupt) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = corrupt(attached);

    const normalized = DocumentCodec.normalize(invalid);
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'document.invalid-raster-mask', severity: 'error' }),
      ]),
    );
    expect(normalized.document.nodes[imageId]?.mask).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.['mask-1']).toBeUndefined();

    const encoded = JSON.parse(DocumentCodec.encode(invalid)) as Document;
    expect(encoded.nodes[imageId]?.mask).toBeUndefined();
    expect(encoded.rasterMaskAssets?.['mask-1']).toBeUndefined();
    expect(DocumentCodec.decode(JSON.stringify(encoded)).ok).toBe(true);
  });

  it('preserves unrelated valid raster assets while sanitizing an invalid mask', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = {
      ...attached,
      rasterMaskAssets: {
        ...attached.rasterMaskAssets,
        unrelated: makeRasterAsset('unrelated'),
      },
      nodes: {
        ...attached.nodes,
        [imageId]: {
          ...attached.nodes[imageId]!,
          mask: { ...attached.nodes[imageId]!.mask!, sourceNodeId: 'other' },
        } as ShapeNode,
      },
    };

    const normalized = DocumentCodec.normalize(invalid);
    expect(normalized.document.nodes[imageId]?.mask).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.['mask-1']).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.unrelated).toEqual(makeRasterAsset('unrelated'));
    expect(DocumentCodec.decode(DocumentCodec.encode(invalid)).ok).toBe(true);
  });

  it('removes malformed legacy background removal state with an error warning', () => {
    const { doc, imageId } = makeImageDocument();
    const legacy = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [imageId]: {
          ...doc.nodes[imageId]!,
          backgroundRemoval: { method: 'quick', confidence: 0.2 },
        },
      },
    } as unknown as Document;

    const normalized = DocumentCodec.normalize(legacy);
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'document.invalid-legacy-background-removal',
          severity: 'error',
        }),
      ]),
    );
    expect('backgroundRemoval' in normalized.document.nodes[imageId]!).toBe(false);

    const decoded = DocumentCodec.decode(JSON.stringify({ ...legacy, formatVersion: '2.0' }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'document.invalid-legacy-background-removal',
          severity: 'error',
        }),
      ]),
    );
    expect('backgroundRemoval' in decoded.document.nodes[imageId]!).toBe(false);
  });
});
