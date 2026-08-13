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

/**
 * 9x9 scene: a 6px-wide red stripe (near, depth 0.05) on a blue background
 * (far, depth 0.95). Pixels: (x, y) with x in 0..5 = subject, 6..8 = bg.
 */
function twoPlaneScene() {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);
  const depths = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (x <= 5) {
        data[offset] = 255; // red subject
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        depths[y * width + x] = 0.05;
      } else {
        data[offset] = 0; // blue background
        data[offset + 1] = 0;
        data[offset + 2] = 255;
        depths[y * width + x] = 0.95;
      }
      data[offset + 3] = 255;
    }
  }
  return { image: new ImageData(data, width, height), depth: map([...depths], width, height) };
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

  it('keeps a sharp near subject out of the blurred background (no silhouette smear)', () => {
    const { image, depth } = twoPlaneScene();
    const output = applyDepthBlur(image, depth, {
      blurAmount: 6,
      focalDepth: 0.05, // subject in focus, background out of focus
      transitionRange: 0.2,
      edgeProtection: 0.01,
    });
    const backgroundPixel = (4 * 9 + 7) * 4; // first bg column, mid row
    expect(output.data[backgroundPixel]!).toBeLessThan(32); // no red subject colour leaked in
  });

  it('lets an out-of-focus near plane contribute foreground bokeh to far pixels', () => {
    const { image, depth } = twoPlaneScene();
    const sharpFocus = applyDepthBlur(image, depth, {
      blurAmount: 6,
      focalDepth: 0.05,
      transitionRange: 0.2,
      edgeProtection: 0.01,
    });
    const midFocus = applyDepthBlur(image, depth, {
      blurAmount: 6,
      focalDepth: 0.5, // both planes out of focus
      transitionRange: 0.2,
      edgeProtection: 0.01,
    });
    const backgroundPixel = (4 * 9 + 7) * 4;
    const redWhenSubjectSharp = sharpFocus.data[backgroundPixel]!;
    const redWhenSubjectBlurred = midFocus.data[backgroundPixel]!;
    // The blurred subject's light spreads into the background region; a sharp
    // subject's light stays on its own pixels.
    expect(redWhenSubjectBlurred - redWhenSubjectSharp).toBeGreaterThan(20);
  });

  it('does not import the sharp background into a blurred foreground plane', () => {
    const { image, depth } = twoPlaneScene();
    const output = applyDepthBlur(image, depth, {
      blurAmount: 6,
      focalDepth: 0.95, // background in focus, subject out of focus
      transitionRange: 0.2,
      edgeProtection: 0.01,
    });
    const subjectPixel = (4 * 9 + 2) * 4; // inside the subject stripe
    // The subject's own blur must not import the sharp background colour.
    expect(output.data[subjectPixel + 2]!).toBeLessThan(64);
  });

  it('keeps the occlusion rule on the adaptive downscaled path', () => {
    // 2048x2048 is far above MAX_GATHER_PIXELS, so this exercises the
    // premultiplied downscale/upscale round trip.
    const size = 2048;
    const data = new Uint8ClampedArray(size * size * 4);
    const values = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        if (x < size * 0.3) {
          data[offset] = 255;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          values[y * size + x] = 0.05;
        } else {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 255;
          values[y * size + x] = 0.95;
        }
        data[offset + 3] = 255;
      }
    }
    const image = new ImageData(data, size, size);
    const depth = map([...values], size, size);
    const output = applyDepthBlur(image, depth, {
      blurAmount: 10,
      focalDepth: 0.05, // subject sharp, background blurred
      transitionRange: 0.2,
      edgeProtection: 0.01,
    });
    // Background region far from the silhouette: no red smear.
    const backgroundPixel = (Math.floor(size * 0.5) * size + Math.floor(size * 0.9)) * 4;
    expect(output.data[backgroundPixel]!).toBeLessThan(32);
    // Background region right next to the silhouette: still no red smear.
    const edgePixel = (Math.floor(size * 0.5) * size + Math.floor(size * 0.31)) * 4;
    expect(output.data[edgePixel]!).toBeLessThan(64);
  });
});
