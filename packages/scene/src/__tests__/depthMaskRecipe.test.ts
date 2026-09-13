import { describe, expect, it } from 'vitest';
import {
  collectDepthMapIds,
  depthMaskRecipeForNode,
  pruneUnreferencedDepthMaps,
  validateDepthMaskRecipe,
} from '../depthMaskRecipe';
import type { DepthMaskRecipe, SceneNode } from '../types';

const depthMap = {
  id: 'depth-1',
  schemaVersion: 1 as const,
  width: 2,
  height: 1,
  depthType: 'float32' as const,
  depthUnit: 'normalized' as const,
  nearFarConvention: 'nearIsLow' as const,
  dataBase64: 'AAAAAAAAgD8=',
  validBase64: 'AQE=',
  byteLength: 8,
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
});
