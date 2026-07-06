// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { downscaleImageData } from '../previewDownscale';

describe('downscaleImageData', () => {
  it('returns the same ImageData when both dimensions are within maxDim', () => {
    const img = new ImageData(100, 100);
    const result = downscaleImageData(img, 2048);
    expect(result).toBe(img);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it('downscales oversized images so the longest edge equals maxDim', () => {
    const img = new ImageData(2100, 1050);
    const result = downscaleImageData(img, 2048);
    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
  });

  it('preserves original dimensions on the source buffer after downscale', () => {
    const img = new ImageData(2100, 2100);
    downscaleImageData(img, 2048);
    expect(img.width).toBe(2100);
    expect(img.height).toBe(2100);
  });
});
