import {
  createDocument,
  createEmbeddedAsset,
  type Document,
  deepCloneSubtree,
  imageFill,
  makeImageShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { mergeImportedResources } from './mergeImportedResources';

const MASK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

function depthResource(id: string, sourceAssetId: string, scalar = 'AAAA') {
  return {
    id,
    schemaVersion: 1 as const,
    width: 1,
    height: 1,
    depthType: 'relative' as const,
    unit: 'normalized' as const,
    nearFarConvention: 'nearIsLow' as const,
    sourceAssetId,
    sourceRevision: 3,
    inferenceVersion: 1,
    preprocessingVersion: 1,
    dataBase64: scalar,
    byteLength: 2,
  };
}

describe('depth resource paste ownership', () => {
  it('remaps colliding map, mask, source, and recipe references together', () => {
    const sourceAsset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,AA==',
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const sourceNode = makeImageShapeNode('source-image', {
      src: sourceAsset.dataUrl,
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    });
    sourceNode.fills = [
      imageFill(sourceAsset.dataUrl, {
        assetId: sourceAsset.id,
        imageWidth: 1,
        imageHeight: 1,
      }),
    ];
    const recipe = {
      schemaVersion: 1 as const,
      depthMapId: 'depth-1',
      sourceBinding: {
        nodeId: sourceNode.id,
        fillAssetId: sourceAsset.id,
        processingRevision: 3,
        coordinateSpace: 'source-image-pixels' as const,
      },
      sourceIdentity: {
        kind: 'source-metadata' as const,
        locator: `asset:${sourceAsset.id}`,
        pixelWidth: 1,
        pixelHeight: 1,
        revision: 3,
      },
      range: { near: 0.1, far: 0.8, nearTransition: 0, farTransition: 0 },
      invert: false,
      combine: 'replace' as const,
      algorithmVersion: 1,
    };
    const source: Document = {
      ...createDocument('source'),
      rootChildren: [sourceNode.id],
      nodes: {
        [sourceNode.id]: {
          ...sourceNode,
          mask: {
            type: 'alpha' as const,
            visible: true,
            rasterMask: {
              assetId: 'mask-1',
              coordinateSpace: 'source-image-pixels' as const,
              sourceIdentity: recipe.sourceIdentity,
              depthRecipe: recipe,
            },
          },
        },
      },
      assets: { [sourceAsset.id]: sourceAsset },
      rasterMaskAssets: {
        'mask-1': {
          id: 'mask-1',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AA==',
          width: 1,
          height: 1,
          byteLength: 1,
        },
      },
      depthMaps: { 'depth-1': depthResource('depth-1', sourceAsset.id) },
    };

    const targetAsset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,AQ==',
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const target: Document = {
      ...createDocument('target'),
      assets: { [sourceAsset.id]: { ...targetAsset, id: sourceAsset.id } },
      rasterMaskAssets: {
        'mask-1': {
          id: 'mask-1',
          mimeType: 'image/png',
          dataUrl: MASK_PNG,
          width: 1,
          height: 1,
          byteLength: 70,
        },
      },
      depthMaps: { 'depth-1': depthResource('depth-1', sourceAsset.id, '//8=') },
    };
    const clone = deepCloneSubtree(source.nodes, target.nextId, sourceNode.id, {
      dropForeignReferences: true,
    });
    const clonedDocument: Document = {
      ...target,
      nodes: clone.nodes,
      rootChildren: [clone.rootId],
      nextId: clone.nextId,
    };

    const merged = mergeImportedResources(clonedDocument, [
      { sourceDoc: source, idMap: clone.idMap },
    ]);
    const clonedNode = merged.nodes[clone.rootId]!;
    const rasterMask = clonedNode.mask?.rasterMask;
    const remappedDepthId = rasterMask?.depthRecipe?.depthMapId;
    const remappedSourceAssetId = rasterMask?.depthRecipe?.sourceBinding.fillAssetId;

    expect(rasterMask?.assetId).toBeTruthy();
    expect(rasterMask?.assetId).not.toBe('mask-1');
    expect(remappedDepthId).toBeTruthy();
    expect(remappedDepthId).not.toBe('depth-1');
    expect(rasterMask?.depthRecipe?.sourceBinding.nodeId).toBe(clonedNode.id);
    expect(remappedSourceAssetId).toBeTruthy();
    expect(remappedSourceAssetId).not.toBe(sourceAsset.id);
    expect(merged.depthMaps?.[remappedDepthId!]?.sourceAssetId).toBe(remappedSourceAssetId);
  });
});
