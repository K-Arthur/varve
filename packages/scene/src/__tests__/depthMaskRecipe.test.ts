import { describe, expect, it } from 'vitest';
import {
  collectDepthMapIds,
  depthMaskRecipeForNode,
  pruneUnreferencedDepthMaps,
  validateDepthMaskRecipe,
} from '../depthMaskRecipe';
import { addNode, createDocument, makeImageShapeNode } from '../document';
import { DocumentCodec } from '../documentCodec';
import type { DepthMaskRecipe, SceneNode } from '../types';

const depthMap = {
  id: 'depth-1',
  schemaVersion: 1 as const,
  width: 2,
  height: 1,
  depthType: 'relative' as const,
  unit: 'normalized' as const,
  nearFarConvention: 'nearIsLow' as const,
  inferenceVersion: 1,
  preprocessingVersion: 1,
  dataBase64: 'AAAAAP//',
  validBase64: 'AQE=',
  byteLength: 6,
};

const recipe: DepthMaskRecipe = {
  schemaVersion: 1,
  depthMapId: 'depth-1',
  sourceBinding: {
    nodeId: 'image-1',
    fillAssetId: 'photo-1',
    processingRevision: 4,
    coordinateSpace: 'source-image-pixels',
  },
  sourceIdentity: {
    kind: 'source-metadata',
    locator: 'asset:photo-1',
    pixelWidth: 2,
    pixelHeight: 1,
    revision: 4,
  },
  range: { near: 0.2, far: 0.7, nearTransition: 0, farTransition: 0.05 },
  invert: false,
  combine: 'replace',
  algorithmVersion: 1,
};

function node(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'image-1',
    kind: 'shape',
    name: 'Image',
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    shape: { type: 'rect', x: 0, y: 0, width: 2, height: 1 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    strokes: [],
    effects: [],
    ...overrides,
  } as SceneNode;
}

describe('depth mask recipe ownership', () => {
  it('validates intent against the accepted resource table', () => {
    const doc = { depthMaps: { 'depth-1': depthMap }, rasterMaskAssets: {} };
    expect(validateDepthMaskRecipe(recipe, doc)).toBeNull();
    expect(validateDepthMaskRecipe({ ...recipe, depthMapId: 'missing' }, doc)).toContain(
      'missing depth map',
    );
  });

  it('collects effect and mask references and prunes only unreachable maps', () => {
    const maskNode = node({
      mask: {
        type: 'alpha',
        visible: true,
        rasterMask: {
          assetId: 'mask-1',
          coordinateSpace: 'source-image-pixels',
          sourceIdentity: recipe.sourceIdentity,
          depthRecipe: recipe,
        },
      },
    });
    const blurNode = node({
      id: 'image-2',
      effects: [
        {
          type: 'depthBlur',
          depthMapId: 'depth-2',
          focusDepth: 0.5,
          focusRange: 0.2,
          blurStrength: 4,
          falloff: 0.5,
          invert: false,
          edgeProtection: 0,
          visible: true,
        },
      ],
    });
    const doc = {
      nodes: { [maskNode.id]: maskNode, [blurNode.id]: blurNode },
      depthMaps: {
        'depth-1': depthMap,
        'depth-2': { ...depthMap, id: 'depth-2' },
        orphan: depthMap,
      },
    };
    expect(collectDepthMapIds(doc)).toEqual(new Set(['depth-1', 'depth-2']));
    expect(depthMaskRecipeForNode(maskNode)).toEqual(recipe);
    const pruned = pruneUnreferencedDepthMaps(doc);
    expect(Object.keys(pruned.depthMaps ?? {})).toEqual(['depth-1', 'depth-2']);
  });

  it('round-trips a recipe with its resolved coverage and keeps that coverage offline', () => {
    const sourceNode = makeImageShapeNode('image-1', {
      src: 'asset:photo-1',
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    });
    const rasterMaskAsset = {
      id: 'mask-1',
      mimeType: 'image/png' as const,
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
      width: 1,
      height: 1,
      byteLength: 70,
    };
    const singleMap = { ...depthMap, width: 1, height: 1, dataBase64: 'AAAA', byteLength: 2 };
    const singleRecipe: DepthMaskRecipe = {
      ...recipe,
      sourceBinding: { ...recipe.sourceBinding, fillAssetId: undefined },
      sourceIdentity: {
        kind: 'source-metadata',
        locator: 'asset:photo-1',
        pixelWidth: 1,
        pixelHeight: 1,
        revision: recipe.sourceIdentity.revision,
      },
    };
    const withMask = {
      ...addNode(createDocument('Depth recipe'), sourceNode),
      nodes: {
        'image-1': {
          ...sourceNode,
          mask: {
            type: 'alpha' as const,
            visible: true,
            rasterMask: {
              assetId: rasterMaskAsset.id,
              coordinateSpace: 'source-image-pixels' as const,
              sourceIdentity: singleRecipe.sourceIdentity,
              depthRecipe: singleRecipe,
            },
          },
        },
      },
      rasterMaskAssets: { [rasterMaskAsset.id]: rasterMaskAsset },
      depthMaps: { [singleMap.id]: singleMap },
    };

    const reopened = DocumentCodec.decode(DocumentCodec.encode(withMask));
    expect(reopened.ok, reopened.ok ? '' : reopened.error).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.depthMaps?.[singleMap.id]).toEqual(singleMap);
    expect(reopened.document.nodes['image-1']?.mask?.rasterMask?.depthRecipe).toEqual(singleRecipe);

    const modelMissing = DocumentCodec.decode(
      JSON.stringify({ ...withMask, depthMaps: undefined }),
    );
    expect(modelMissing.ok, modelMissing.ok ? '' : modelMissing.error).toBe(true);
    if (!modelMissing.ok) return;
    expect(modelMissing.document.nodes['image-1']?.mask?.rasterMask?.assetId).toBe('mask-1');
    expect(modelMissing.document.nodes['image-1']?.mask?.rasterMask?.depthRecipe).toBeUndefined();
    expect(
      modelMissing.warnings.some(
        (warning) => warning.code === 'document.invalid-depth-mask-recipe',
      ),
    ).toBe(true);
  });
});
