/**
 * Container-local raster masks — the brush-painted layer-mask form that
 * attaches to FrameNodes.
 *
 * Covers: attachment rules (frames yes, groups/no-kind no), coordinate-space
 * validation, resolveMask/validateRasterMaskDocument acceptance, asset
 * updates, and document round-trips.
 */
import { describe, expect, it } from 'vitest';
import { DocumentCodec } from '../documentCodec';
import {
  addNode,
  addRasterMaskAsset,
  createDocument,
  type Document,
  makeFrameNode,
  makeGroupNode,
  type RasterMaskAsset,
  resolveMask,
  resolveRasterMaskAsset,
  updateRasterMaskAsset,
  validateMasks,
  validateRasterMaskDocument,
} from '../index';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeAsset(id: string, w = 1, h = 1): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
    width: w,
    height: h,
    byteLength: 68,
  };
}

function frameDoc(): { doc: Document; frameId: string } {
  let doc = createDocument('container-mask', true);
  const frame = makeFrameNode('f1', { w: 40, h: 30, children: [] });
  doc = addNode(doc, frame);
  return { doc, frameId: 'f1' };
}

describe('container-local raster masks (brush masks)', () => {
  it('addRasterMaskAsset attaches a container-local mask to a frame', () => {
    const { doc, frameId } = frameDoc();
    const updated = addRasterMaskAsset(doc, frameId, makeAsset('mask-f1'), undefined, {
      coordinateSpace: 'container-local-pixels',
    });
    const mask = updated.nodes.f1?.mask as
      | { rasterMask?: { coordinateSpace?: string; sourceIdentity?: { locator?: string } } }
      | undefined;
    expect(mask?.rasterMask?.coordinateSpace).toBe('container-local-pixels');
    expect(mask?.rasterMask?.sourceIdentity?.locator).toBe('container-local');
    expect(updated.rasterMaskAssets?.['mask-f1']).toBeDefined();
    expect(validateRasterMaskDocument(updated)).toBeNull();
  });

  it('rejects container-local masks on groups', () => {
    let doc = createDocument('container-mask-2', true);
    doc = addNode(doc, makeGroupNode('g1', { children: [] }));
    const updated = addRasterMaskAsset(doc, 'g1', makeAsset('mask-g1'), undefined, {
      coordinateSpace: 'container-local-pixels',
    });
    expect(updated.nodes.g1?.mask).toBeUndefined();
  });

  it('rejects source-image-pixels masks on frames', () => {
    const { doc, frameId } = frameDoc();
    const updated = addRasterMaskAsset(doc, frameId, makeAsset('mask-f2'), undefined, {
      coordinateSpace: 'source-image-pixels',
    });
    expect(updated.nodes.f1?.mask).toBeUndefined();
  });

  it('resolveMask and resolveRasterMaskAsset return the frame mask', () => {
    const { doc, frameId } = frameDoc();
    const updated = addRasterMaskAsset(doc, frameId, makeAsset('mask-f3'), undefined, {
      coordinateSpace: 'container-local-pixels',
    });
    expect(resolveMask(updated.nodes.f1!, updated)?.type).toBe('alpha');
    expect(resolveRasterMaskAsset(updated, updated.nodes.f1!)?.id).toBe('mask-f3');
  });

  it('rejects a container-local mask carrying a foreign source identity', () => {
    const { doc } = frameDoc();
    const withForeign = {
      ...doc,
      nodes: {
        ...doc.nodes,
        f1: {
          ...doc.nodes.f1,
          mask: {
            type: 'alpha' as const,
            visible: true,
            rasterMask: {
              assetId: 'mask-x',
              coordinateSpace: 'container-local-pixels' as const,
              sourceIdentity: {
                kind: 'content-sha256' as const,
                sha256: 'abc',
                revision: 1,
              },
            },
          },
        },
      },
      rasterMaskAssets: { 'mask-x': makeAsset('mask-x') },
    } as Document;
    expect(validateRasterMaskDocument(withForeign)).toContain('container-local');
    expect(validateMasks(withForeign)).toContain('f1');
  });

  it('updateRasterMaskAsset swaps the asset on a frame mask', () => {
    const { doc, frameId } = frameDoc();
    let updated = addRasterMaskAsset(doc, frameId, makeAsset('mask-f4'), undefined, {
      coordinateSpace: 'container-local-pixels',
    });
    updated = updateRasterMaskAsset(updated, frameId, makeAsset('mask-f4-v1'));
    const mask = updated.nodes.f1?.mask as {
      rasterMask?: { assetId?: string; editRevision?: number };
    };
    expect(mask?.rasterMask?.assetId).toBe('mask-f4-v1');
    expect(mask?.rasterMask?.editRevision).toBe(1);
    // The old asset is garbage-collected once unreferenced.
    expect(updated.rasterMaskAssets?.['mask-f4']).toBeUndefined();
    expect(validateRasterMaskDocument(updated)).toBeNull();
  });

  it('survives a DocumentCodec round trip', () => {
    const { doc, frameId } = frameDoc();
    const updated = addRasterMaskAsset(doc, frameId, makeAsset('mask-f5'), undefined, {
      coordinateSpace: 'container-local-pixels',
    });
    const json = DocumentCodec.encode(updated);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const mask = decoded.document.nodes.f1?.mask as {
      rasterMask?: { coordinateSpace?: string };
    };
    expect(mask?.rasterMask?.coordinateSpace).toBe('container-local-pixels');
    expect(validateRasterMaskDocument(decoded.document)).toBeNull();
  });
});
