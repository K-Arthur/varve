import { describe, expect, it } from 'vitest';
import { isAssetReferenced, pruneUnusedAssets } from './assets';
import { addNode, createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import {
  photoSourceRevision,
  validatePhotoSourceBinding,
  validateRetouchProvenance,
} from './photoSource';
import { makeRasterLayerNode } from './rasterLayer';

const rawAsset = {
  id: 'raw-1',
  storage: 'embedded' as const,
  mimeType: 'image/x-adobe-dng',
  dataUrl: 'data:image/x-adobe-dng;base64,AA==',
  naturalWidth: 2,
  naturalHeight: 2,
  byteLength: 1,
  hash: 'raw-hash',
};

const derivedAsset = {
  id: 'developed-1',
  storage: 'embedded' as const,
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,AA==',
  naturalWidth: 2,
  naturalHeight: 2,
  byteLength: 1,
  hash: 'developed-hash',
  photoSource: {
    role: 'developed-raster' as const,
    sourceAssetIds: ['raw-1'],
    sourceRevision: 'dng-revision',
    operation: 'raw-development' as const,
    decoderId: 'varve-dng-bayer-uncompressed/1',
    recipe: { exposureStops: 0 },
  },
};

describe('photo source persistence', () => {
  it('validates the source/derived binding contract and hashes recipes deterministically', () => {
    const binding = {
      operation: 'raw-development' as const,
      sourceAssetIds: ['raw-1'],
      sourceRevision: 'raw-hash',
      derivedAssetId: 'developed-1',
      decoderId: 'varve-dng-bayer-uncompressed/1',
      recipe: { whiteBalance: 'as-shot', exposureStops: 0 },
      stage: 'scene-linear' as const,
      status: 'current' as const,
    };
    expect(validatePhotoSourceBinding(binding).valid).toBe(true);
    expect(photoSourceRevision(['raw-hash'], binding.decoderId, binding.recipe)).toBe(
      photoSourceRevision(['raw-hash'], binding.decoderId, {
        exposureStops: 0,
        whiteBalance: 'as-shot',
      }),
    );
  });

  it('retains immutable RAW sources through derived-asset garbage collection', () => {
    const doc: Parameters<typeof pruneUnusedAssets>[0] = {
      nodes: {
        image: {
          fills: [
            {
              type: 'image',
              image: {
                assetId: 'developed-1',
                photoSource: {
                  sourceAssetIds: ['raw-1'],
                  derivedAssetId: 'developed-1',
                },
              },
            },
          ],
        },
      },
      assets: { 'raw-1': rawAsset, 'developed-1': derivedAsset, unused: rawAsset },
    };
    expect(isAssetReferenced(doc, 'raw-1')).toBe(true);
    const pruned = pruneUnusedAssets(doc);
    expect(Object.keys(pruned.assets ?? {}).sort()).toEqual(['developed-1', 'raw-1']);
  });

  it('round-trips a derived image binding and its source asset through the document codec', () => {
    const node = makeShapeNode('photo', { kind: 'rect', x: 0, y: 0, w: 2, h: 2 });
    node.fills = [
      {
        type: 'image',
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        image: {
          src: derivedAsset.dataUrl,
          assetId: derivedAsset.id,
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          photoSource: {
            operation: 'raw-development',
            sourceAssetIds: [rawAsset.id],
            sourceRevision: 'dng-revision',
            derivedAssetId: derivedAsset.id,
            decoderId: 'varve-dng-bayer-uncompressed/1',
            recipe: { exposureStops: 0 },
            stage: 'display-linear',
            status: 'current',
          },
        },
      },
    ];
    const doc = {
      ...addNode(createDocument('Photo source', true), node),
      assets: { [rawAsset.id]: rawAsset, [derivedAsset.id]: derivedAsset },
    };

    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedFill = reopened.document.nodes.photo?.fills?.[0];
    expect(reopenedFill?.type).toBe('image');
    if (reopenedFill?.type !== 'image' || !reopenedFill.image) return;
    expect(reopenedFill.image.photoSource).toMatchObject({
      operation: 'raw-development',
      sourceAssetIds: ['raw-1'],
      derivedAssetId: 'developed-1',
      status: 'current',
    });
    expect(reopened.document.assets?.['raw-1']?.dataUrl).toBe(rawAsset.dataUrl);
  });

  it('retains a baked repair with a missing source while warning about ownership', () => {
    const repair = {
      ...makeRasterLayerNode('repair', { width: 2, height: 2 }),
      retouchProvenance: {
        role: 'baked-retouch' as const,
        sourceNodeId: 'missing-photo',
        sourceRevision: 'old-revision',
        sourceStage: 'rendered-image' as const,
        policy: 'baked' as const,
      },
    };
    const doc = addNode(createDocument('Repair provenance', true), repair);

    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedRepair = reopened.document.nodes.repair;
    expect(reopenedRepair?.kind).toBe('rasterLayer');
    if (reopenedRepair?.kind !== 'rasterLayer') return;
    expect(reopenedRepair.retouchProvenance).toMatchObject({
      sourceNodeId: 'missing-photo',
      sourceRevision: 'old-revision',
    });
    expect(reopened.warnings.some((item) => item.code === 'document.missing-retouch-source')).toBe(
      true,
    );
    expect(validateRetouchProvenance({ policy: 'baked' }).valid).toBe(false);
  });
});
