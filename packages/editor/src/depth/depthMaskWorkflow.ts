/** Pure, shared operations for depth-derived mask previews and commits. */

import type { DepthMap, DepthMapResource } from '@varve/engine';
import {
  combineMaskCoverage,
  coverageToMask,
  depthHistogram,
  depthRangeToCoverage,
  deserializeDepthMap,
} from '@varve/engine';
import type { DepthMaskRecipe, NodeId, RasterMaskSourceIdentity } from '@varve/scene';

/** Keep model-validity input as a compact alpha plane, not interleaved RGBA. */
export function rgbaToAlphaPlane(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('RGBA dimensions must be positive safe integers');
  }
  const pixels = width * height;
  if (rgba.length !== pixels * 4) throw new Error('RGBA length must match its dimensions');
  const alpha = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index++) alpha[index] = rgba[index * 4 + 3] ?? 0;
  return alpha;
}

export interface DepthMaskRecipeInput {
  depthMapId: string;
  nodeId: NodeId;
  fillAssetId?: string;
  processingRevision: number;
  sourceIdentity: RasterMaskSourceIdentity;
  near: number;
  far: number;
  nearTransition: number;
  farTransition: number;
  invert: boolean;
  combine: DepthMaskRecipe['combine'];
  correction?: DepthMaskRecipe['correction'];
}

export function depthCoverageForRecipe(
  map: DepthMap,
  recipe: Pick<DepthMaskRecipe, 'range' | 'invert'>,
): Float32Array {
  return depthRangeToCoverage(map, {
    near: recipe.range.near,
    far: recipe.range.far,
    nearTransition: recipe.range.nearTransition,
    farTransition: recipe.range.farTransition,
    invert: recipe.invert,
    order: 'empty',
  });
}

export function combineDepthCoverage(
  incoming: Float32Array,
  existing: Float32Array | Uint8Array | undefined,
  mode: DepthMaskRecipe['combine'],
): Float32Array {
  return combineMaskCoverage(existing, incoming, mode);
}

export function coverageToMaskBytes(coverage: Float32Array): Uint8Array {
  return coverageToMask(coverage);
}

export function coverageToRgba(coverage: Float32Array): Uint8ClampedArray {
  const alpha = coverageToMask(coverage);
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = alpha[i]!;
  }
  return rgba;
}

export function makeDepthMaskRecipe(input: DepthMaskRecipeInput): DepthMaskRecipe {
  return {
    schemaVersion: 1,
    depthMapId: input.depthMapId,
    sourceBinding: {
      nodeId: input.nodeId,
      ...(input.fillAssetId ? { fillAssetId: input.fillAssetId } : {}),
      processingRevision: input.processingRevision,
      coordinateSpace: 'source-image-pixels',
    },
    sourceIdentity: input.sourceIdentity,
    range: {
      near: input.near,
      far: input.far,
      nearTransition: input.nearTransition,
      farTransition: input.farTransition,
    },
    invert: input.invert,
    combine: input.combine,
    algorithmVersion: 1,
    ...(input.correction ? { correction: input.correction } : {}),
  };
}

export function decodeDepthResource(resource: DepthMapResource): DepthMap {
  return deserializeDepthMap(resource);
}

export function depthMapHistogram(map: DepthMap) {
  return depthHistogram(map, 32);
}
