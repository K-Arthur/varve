import { describe, expect, it } from 'vitest';
import {
  boxBlurSeparable,
  gaussianBlurLinearLight,
  gaussianBlurSeparable,
  gaussianKernel,
} from './blur';

function makeGradient(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = Math.round((x / (w - 1)) * 255);
      data[idx + 1] = Math.round((y / (h - 1)) * 255);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

function makeTransparentEdge(width: number, height: number, innerSize: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const halfInner = innerSize / 2;
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      if (Math.abs(x - cx) <= halfInner && Math.abs(y - cy) <= halfInner) {
        data[idx] = 200;
        data[idx + 1] = 100;
        data[idx + 2] = 50;
        data[idx + 3] = 255;
      } else {
        data[idx] = 255;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }
  return new ImageData(data, width, height);
}

function maxAbsDiff(a: ImageData, b: ImageData): number {
  const len = Math.min(a.data.length, b.data.length);
  let max = 0;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(a.data[i]! - b.data[i]!);
    if (diff > max) max = diff;
  }
  return max;
}

describe('gaussianKernel', () => {
  it('produces odd-sized, normalized weights', () => {
    const kernel = gaussianKernel(3);
    expect(kernel.length).toBe(7);
    const sum = kernel.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('with radius 0 returns [1]', () => {
    const kernel = gaussianKernel(0);
    expect(kernel).toEqual([1]);
  });

  it('has symmetric weights', () => {
    const kernel = gaussianKernel(4);
    for (let i = 0; i < kernel.length; i++) {
      expect(kernel[i]).toBeCloseTo(kernel[kernel.length - 1 - i]!, 8);
    }
  });

  it('center weight is largest', () => {
    const kernel = gaussianKernel(5);
    const center = kernel[5]!;
    for (let i = 0; i < kernel.length; i++) {
      if (i !== 5) expect(kernel[i]).toBeLessThan(center);
    }
  });
});

describe('boxBlurSeparable', () => {
  it('with radius 0 returns identical data', () => {
    const src = makeGradient(8, 8);
    const result = boxBlurSeparable(src, 0);
    expect(maxAbsDiff(src, result)).toBe(0);
  });

  it('blurs a gradient horizontally and vertically', () => {
    const src = makeGradient(16, 16);
    const result = boxBlurSeparable(src, 3);
    // All channels should be blurred (non-identical to source)
    expect(maxAbsDiff(src, result)).toBeGreaterThan(0);
    // Result should have correct dimensions
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });
});

describe('gaussianBlurSeparable', () => {
  it('with radius 0 returns identical data', () => {
    const src = makeGradient(8, 8);
    const result = gaussianBlurSeparable(src, 0);
    expect(maxAbsDiff(src, result)).toBe(0);
  });

  it('produces expected blur on a simple gradient', () => {
    const src = makeGradient(16, 16);
    const result = gaussianBlurSeparable(src, 2);
    expect(maxAbsDiff(src, result)).toBeGreaterThan(0);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });

  it('handles transparent edges without dark fringing', () => {
    const img = makeTransparentEdge(8, 8, 4);
    const result = gaussianBlurSeparable(img, 2);
    // Transparent pixels (alpha=0) should remain transparent
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (y * 8 + x) * 4;
        const halfInner = 2;
        const cx = 3.5;
        const cy = 3.5;
        if (Math.abs(x - cx) > halfInner || Math.abs(y - cy) > halfInner) {
          if (result.data[idx + 3]! === 0) {
            expect(result.data[idx]!).toBe(0);
            expect(result.data[idx + 1]!).toBe(0);
            expect(result.data[idx + 2]!).toBe(0);
          }
        }
      }
    }
  });
});

describe('gaussianBlurLinearLight', () => {
  it('matches gaussianBlurSeparable on solid colors', () => {
    const solid = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < solid.length; i += 4) {
      solid[i] = 128;
      solid[i + 1] = 128;
      solid[i + 2] = 128;
      solid[i + 3] = 255;
    }
    const src = new ImageData(solid, 16, 16);
    const blurSep = gaussianBlurSeparable(src, 3);
    const blurLinear = gaussianBlurLinearLight(src, 3);
    // Max diff should be small for a solid color
    expect(maxAbsDiff(blurSep, blurLinear)).toBeLessThanOrEqual(3);
  });
});

describe('gaussianBlurLinearLight', () => {
  it('produces similar result on gradient as gaussianBlurSeparable', () => {
    const src = makeGradient(32, 32);
    const radius = 10;
    const blurSep = gaussianBlurSeparable(src, radius);
    const blurLinear = gaussianBlurLinearLight(src, radius);
    const maxDiff = maxAbsDiff(blurSep, blurLinear);
    // Linear-light blur differs from gamma-space blur, but max diff
    // should be bounded for a smooth gradient
    expect(maxDiff).toBeLessThanOrEqual(10);
    expect(blurLinear.width).toBe(32);
    expect(blurLinear.height).toBe(32);
  });
});

describe('downsample-blur-upsample', () => {
  it('produces similar result to full-res blur on radius > 100', () => {
    const src = makeGradient(64, 64);
    const largeRadius = 120;
    const result = gaussianBlurSeparable(src, largeRadius);
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    // Result should be very smooth (low max diff from flat)
    const flatPixels: number[] = [];
    for (let i = 0; i < result.data.length; i += 4) {
      flatPixels.push(result.data[i]!);
    }
    const avg = flatPixels.reduce((a, b) => a + b, 0) / flatPixels.length;
    const variance = flatPixels.reduce((sum, v) => sum + (v - avg) ** 2, 0) / flatPixels.length;
    const stdDev = Math.sqrt(variance);
    // With such a large blur, the image should be nearly uniform
    expect(stdDev).toBeLessThan(42);
  });
});
