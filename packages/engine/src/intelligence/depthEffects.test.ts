// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyDepthFog, applyDepthOfField, computeHeuristicDepth } from './depthEffects';

function makeTestImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 128;
      data[idx + 1] = 128;
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('computeHeuristicDepth', () => {
  it('produces depth map with correct dimensions', () => {
    const img = makeTestImage(32, 24);
    const depth = computeHeuristicDepth(img);

    expect(depth.width).toBe(32);
    expect(depth.height).toBe(24);
    expect(depth.data.length).toBe(768);
  });

  it('center pixels are nearer (higher value) than corner pixels', () => {
    const img = makeTestImage(32, 32);
    const depth = computeHeuristicDepth(img);

    const centerVal = depth.data[16 * 32 + 16]!;
    const cornerVal = depth.data[0]!;

    expect(centerVal).toBeGreaterThanOrEqual(cornerVal);
  });
});

describe('applyDepthOfField', () => {
  it('returns image with same dimensions', () => {
    const img = makeTestImage(16, 16);
    const depth = computeHeuristicDepth(img);
    const result = applyDepthOfField(img, depth, {
      blurStrength: 4,
      focalDepth: 128,
      focalRange: 64,
    });

    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.data.length).toBe(1024);
  });
});

describe('applyDepthFog', () => {
  it('applies fog effect without changing dimensions', () => {
    const img = makeTestImage(16, 16);
    const depth = computeHeuristicDepth(img);
    const result = applyDepthFog(img, depth, [200, 210, 220], 0.3);

    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.data.length).toBe(1024);
  });
});
