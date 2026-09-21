import { describe, expect, it } from 'vitest';
import { createEmbeddedAsset, hashContent } from './assets';
import { addNode, createDocument, type Document, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import { imageFill } from './fills';
import type { GenerativeEditRecord } from './generativeEdit';
import { sha256Utf8 } from './sha256';
import type { RasterMaskAsset } from './types';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function maskAsset(id: string, checksum?: string): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
    width: 1,
    height: 1,
    byteLength: 68,
    ...(checksum ? { checksum } : {}),
  };
}

function generativeRecord(nodeId: string, maskId: string): GenerativeEditRecord {
  const frame = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    coordinateSpace: 'source-image-pixels' as const,
  };
  const settings = {
    quality: 'balanced' as const,
    contextPadding: 32,
    maskExpansion: 0,
    feather: 0,
  };
  return {
    schemaVersion: 2,
    id: 'edit-1',
    mode: 'remove',
    sourceNodeId: nodeId,
    sourceLocator: 'asset:source-1',
    sourceRevision: 1,
    placementRevision: 'placement-1',
    masks: {
      userMaskAssetId: maskId,
      inferenceMaskAssetId: `${maskId}-inference`,
      compositeMaskAssetId: `${maskId}-composite`,
      width: 1,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      coordinateSpace: 'source-image-pixels',
    },
    outputFrame: frame,
    maskAssetId: maskId,
    maskWidth: 1,
    maskHeight: 1,
    maskCoordinateSpace: 'source-image-pixels',
    settings,
    provider: { kind: 'local', id: 'varve-quick-cleanup', runtime: 'patchmatch' },
    variations: [
      {
        id: 'variation-1',
        assetId: 'result-1',
        width: 1,
        height: 1,
        createdAt: 1,
        settings,
        outputFrame: frame,
      },
    ],
    activeVariationId: 'variation-1',
    acceptedVariationId: 'variation-1',
    resultNodeId: nodeId,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('generative mask persistence', () => {
  it('keeps recipe-only masks through codec save/reopen and upgrades legacy checksums', () => {
    const node = makeShapeNode('image-1', { kind: 'rect', x: 0, y: 0, w: 1, h: 1 });
    const source = createEmbeddedAsset({
      dataUrl: PNG_DATA_URL,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    node.fills = [imageFill(source.dataUrl, { assetId: source.id, imageWidth: 1, imageHeight: 1 })];
    const userMask = maskAsset('mask-user', hashContent(PNG_DATA_URL));
    const inferenceMask = maskAsset('mask-user-inference');
    const compositeMask = maskAsset('mask-user-composite');
    const resultAsset = createEmbeddedAsset({
      dataUrl: PNG_DATA_URL,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const record = generativeRecord(node.id, userMask.id);
    let document: Document = addNode(createDocument('Generative masks', true), node);
    document = {
      ...document,
      assets: { [source.id]: source, [resultAsset.id]: resultAsset },
      rasterMaskAssets: {
        [userMask.id]: userMask,
        [inferenceMask.id]: inferenceMask,
        [compositeMask.id]: compositeMask,
      },
      generativeEdits: { [record.id]: record },
    };

    const encoded = JSON.parse(DocumentCodec.encode(document)) as Document;
    expect(encoded.rasterMaskAssets).toEqual(
      expect.objectContaining({
        [userMask.id]: expect.objectContaining({ checksum: sha256Utf8(PNG_DATA_URL) }),
        [inferenceMask.id]: inferenceMask,
        [compositeMask.id]: compositeMask,
      }),
    );

    const reopened = DocumentCodec.decode(JSON.stringify(encoded));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.generativeEdits?.[record.id]).toMatchObject({
      masks: record.masks,
      acceptedVariationId: record.acceptedVariationId,
    });
    expect(reopened.document.rasterMaskAssets).toEqual(encoded.rasterMaskAssets);
  });
});
