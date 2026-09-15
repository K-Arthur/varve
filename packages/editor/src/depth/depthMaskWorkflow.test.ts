import type { DepthMap } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import {
  combineDepthCoverage,
  coverageToRgba,
  depthCoverageForRecipe,
  makeDepthMaskRecipe,
  rgbaToAlphaPlane,
} from './depthMaskWorkflow';

function map(values: number[], valid = values.map(() => 1)): DepthMap {
  return {
    width: values.length,
    height: 1,
    values: Float32Array.from(values),
    valid: Uint8Array.from(valid),
    metadata: {
      depthType: 'relative',
      unit: 'normalized',
      nearFarConvention: 'nearIsLow',
      inferenceVersion: 1,
      preprocessingVersion: 1,
    },
  };
}

describe('depth mask workflow', () => {
  it('extracts alpha before projecting source validity into model space', () => {
    expect(Array.from(rgbaToAlphaPlane([10, 20, 30, 0, 40, 50, 60, 255], 2, 1))).toEqual([0, 255]);
    expect(() => rgbaToAlphaPlane([0, 0, 0], 1, 1)).toThrow('RGBA length');
  });

  it('keeps invalid samples excluded when a range is inverted', () => {
    const coverage = depthCoverageForRecipe(map([0.1, 0.5, 0.9], [1, 0, 1]), {
      range: { near: 0, far: 0.5, nearTransition: 0, farTransition: 0 },
      invert: true,
    });

    expect(Array.from(coverage)).toEqual([0, 0, 1]);
  });

  it('uses the shared soft-coverage algebra for combination', () => {
    const incoming = Float32Array.from([0.25, 0.75]);
    expect(
      Array.from(combineDepthCoverage(incoming, Float32Array.from([0.5, 0.5]), 'union')),
    ).toEqual([0.625, 0.875]);
    expect(Array.from(combineDepthCoverage(incoming, undefined, 'replace'))).toEqual([0.25, 0.75]);
  });

  it('keeps depth intent separate from resolved coverage bytes', () => {
    const recipe = makeDepthMaskRecipe({
      depthMapId: 'depth-1',
      nodeId: 'image-1',
      fillAssetId: 'asset-1',
      processingRevision: 3,
      sourceIdentity: {
        kind: 'source-metadata',
        locator: 'asset-1',
        pixelWidth: 2,
        pixelHeight: 1,
        revision: 3,
      },
      near: 0.2,
      far: 0.8,
      nearTransition: 0.05,
      farTransition: 0.1,
      invert: false,
      combine: 'intersect',
    });

    expect(recipe.depthMapId).toBe('depth-1');
    expect(recipe.range.near).toBe(0.2);
    expect(Array.from(coverageToRgba(Float32Array.from([0, 0.5])))).toEqual([
      255, 255, 255, 0, 255, 255, 255, 128,
    ]);
  });
});
