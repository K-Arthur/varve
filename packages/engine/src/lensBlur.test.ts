import { describe, expect, it } from 'vitest';
import type { DepthMap } from './depthMap';
import { applyDepthBlur } from './lensBlur';

function map(values: number[], width: number, height: number): DepthMap {
  return {
    width,
    height,
    values: new Float32Array(values),
    valid: new Uint8Array(values.length).fill(1),
    metadata: {
      depthType: 'relative',
      unit: 'normalized',
      nearFarConvention: 'nearIsLow',
      inferenceVersion: 1,
      preprocessingVersion: 1,
    },
  };
}

describe('applyDepthBlur', () => {
  it('keeps a uniform-depth plane free of colour drift', () => {
    const input = new ImageData(new Uint8ClampedArray([220, 40, 10, 255, 220, 40, 10, 255]), 2, 1);
    const output = applyDepthBlur(input, map([0.5, 0.5], 2, 1), {
      blurAmount: 8,
      focalDepth: 0,
      transitionRange: 0,
    });
    expect([...output.data]).toEqual([...input.data]);
  });

  it('protects a near foreground edge from farther background colour', () => {
    const input = new ImageData(
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
      3,
      1,
    );
    const output = applyDepthBlur(input, map([0, 1, 1], 3, 1), {
      blurAmount: 2,
      focalDepth: 1,
      transitionRange: 0,
      edgeProtection: 0.01,
    });
    expect(output.data[0]).toBe(255);
    expect(output.data[1]).toBe(0);
    expect(output.data[2]).toBe(0);
  });

  it('does not pull RGB from transparent pixels into an alpha edge', () => {
    const input = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 0]), 2, 1);
    const output = applyDepthBlur(input, map([0, 0], 2, 1), {
      blurAmount: 2,
      focalDepth: 1,
      transitionRange: 0,
    });
    expect(output.data[4]).toBeGreaterThan(200);
    expect(output.data[5]).toBe(0);
    expect(output.data[6]).toBe(0);
    expect(output.data[7]).toBeLessThan(255);
  });
});
