import { describe, expect, it } from 'vitest';
import { compositeFillResult, computeMaskBounds, extractBoundedContext } from './contextExtraction';

function makeSyntheticImage(w: number, h: number): ImageData {
  const id = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      id.data[idx] = Math.round((x / w) * 255); // R: gradient left-right
      id.data[idx + 1] = Math.round((y / h) * 255); // G: gradient top-bottom
      id.data[idx + 2] = 128; // B: constant
      id.data[idx + 3] = 255; // A: opaque
    }
  }
  return id;
}

describe('Content-Aware Fill Integration', () => {
  it('full pipeline: composite fills correct region', async () => {
    const img = makeSyntheticImage(100, 100);
    const mask = new Uint8Array(100 * 100);

    for (let y = 40; y < 60; y++) {
      for (let x = 40; x < 60; x++) {
        mask[y * 100 + x] = 255;
      }
    }

    const bounds = computeMaskBounds(mask, 100, 100);
    expect(bounds).toBeDefined();
    expect(bounds).toEqual({ x: 40, y: 40, w: 20, h: 20 });

    const ctx = extractBoundedContext(img, mask, 100, 100, 0, 0, 10);
    expect(ctx.width).toBeGreaterThan(20);
    expect(ctx.height).toBeGreaterThan(20);
    expect(ctx.offsetX).toBe(30);
    expect(ctx.offsetY).toBe(30);
    expect(ctx.imageData.width).toBe(ctx.width);
    expect(ctx.imageData.height).toBe(ctx.height);
    expect(ctx.mask.length).toBe(ctx.width * ctx.height);
  });

  it('full pipeline: composite into full image keeps dimensions', () => {
    const img = makeSyntheticImage(50, 50);
    const fillResult = makeSyntheticImage(20, 20);

    const result = compositeFillResult(img, fillResult, 15, 15);
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
    expect(result.data).not.toBe(img.data);
  });

  it('full pipeline: bounded context preserves pixel data', () => {
    const img = makeSyntheticImage(100, 100);
    const mask = new Uint8Array(100 * 100);
    mask[50 * 100 + 50] = 255;
    mask[51 * 100 + 51] = 255;

    const ctx = extractBoundedContext(img, mask, 100, 100, 0, 0, 20);

    expect(ctx.offsetX).toBe(30); // 50-20
    expect(ctx.offsetY).toBe(30);

    const _expectedW = 2 + 20 * 2; // 2px mask span + 20px padding each side = 42
    expect(ctx.width).toBeLessThanOrEqual(42);
    expect(ctx.height).toBeLessThanOrEqual(42);
  });

  it('pipeline handles empty mask gracefully', () => {
    const img = makeSyntheticImage(50, 50);
    const mask = new Uint8Array(50 * 50);

    const ctx = extractBoundedContext(img, mask, 50, 50, 0, 0);
    expect(ctx.offsetX).toBe(0);
    expect(ctx.offsetY).toBe(0);
    expect(ctx.width).toBe(50);
    expect(ctx.height).toBe(50);
  });

  it('pipeline handles mask at image edge', () => {
    const img = makeSyntheticImage(50, 50);
    const mask = new Uint8Array(50 * 50);
    mask[0] = 255; // top-left corner

    const ctx = extractBoundedContext(img, mask, 50, 50, 0, 0, 10);
    expect(ctx.offsetX).toBe(0); // clamped to 0
    expect(ctx.offsetY).toBe(0); // clamped to 0
    expect(ctx.width).toBeLessThanOrEqual(50);
    expect(ctx.height).toBeLessThanOrEqual(50);
  });

  it('pipeline handles full-image mask', () => {
    const _img = makeSyntheticImage(30, 30);
    const mask = new Uint8Array(30 * 30).fill(255);
    const bounds = computeMaskBounds(mask, 30, 30);
    expect(bounds).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });
});
