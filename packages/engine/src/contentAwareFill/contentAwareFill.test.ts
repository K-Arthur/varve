import { describe, expect, it } from 'vitest';
import { compositeFillResult, computeMaskBounds, extractBoundedContext } from './contextExtraction';
import { applyFillTransform, mapMaskThroughTransform } from './coordinateMapping';
import type { FillTransform } from './types';

describe('computeMaskBounds', () => {
  it('returns null for empty mask', () => {
    const result = computeMaskBounds(new Uint8Array(100), 10, 10);
    expect(result).toBeNull();
  });

  it('finds bounds for a filled mask', () => {
    const mask = new Uint8Array(100);
    mask[22] = 255; // (2,2)
    mask[55] = 128; // (5,5)
    mask[66] = 200; // (6,6)
    const result = computeMaskBounds(mask, 10, 10);
    expect(result).toEqual({ x: 2, y: 2, w: 5, h: 5 });
  });

  it('handles mask touching left edge', () => {
    const mask = new Uint8Array(100);
    mask[0] = 255; // (0,0)
    const result = computeMaskBounds(mask, 10, 10);
    expect(result).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('handles mask touching right and bottom edges', () => {
    const mask = new Uint8Array(100);
    mask[99] = 255; // (9,9)
    const result = computeMaskBounds(mask, 10, 10);
    expect(result).toEqual({ x: 9, y: 9, w: 1, h: 1 });
  });

  it('handles mask with multiple components', () => {
    const mask = new Uint8Array(100);
    mask[10] = 255; // (0,1)
    mask[11] = 200; // (1,1)
    mask[20] = 255; // (0,2)
    mask[88] = 255; // (8,8) — separate component
    const result = computeMaskBounds(mask, 10, 10);
    expect(result).toEqual({ x: 0, y: 1, w: 9, h: 8 });
  });

  it('handles full-image mask', () => {
    const mask = new Uint8Array(100).fill(255);
    const result = computeMaskBounds(mask, 10, 10);
    expect(result).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('handles single pixel mask', () => {
    const mask = new Uint8Array(50);
    mask[24] = 255;
    const result = computeMaskBounds(mask, 10, 5);
    expect(result).toEqual({ x: 4, y: 2, w: 1, h: 1 });
  });
});

describe('applyFillTransform', () => {
  function makeImageData(
    w: number,
    h: number,
    fill: (x: number, y: number) => [number, number, number],
  ): ImageData {
    const id = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = fill(x, y);
        const idx = (y * w + x) * 4;
        id.data[idx] = r;
        id.data[idx + 1] = g;
        id.data[idx + 2] = b;
        id.data[idx + 3] = 255;
      }
    }
    return id;
  }

  it('no-op transform returns identical image', () => {
    const img = makeImageData(4, 4, (x, y) => [x * 64, y * 64, 128]);
    const result = applyFillTransform(img, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
      imageNaturalWidth: 4,
      imageNaturalHeight: 4,
    });
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    for (let i = 0; i < 16; i++) {
      expect(result.data[i * 4]).toBe(img.data[i * 4]);
    }
  });

  it('flips horizontally', () => {
    const img = makeImageData(4, 1, (x) => [x * 85, 0, 0]);
    const transform: FillTransform = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: true,
      flipV: false,
      imageNaturalWidth: 4,
      imageNaturalHeight: 1,
    };
    const result = applyFillTransform(img, transform);
    // Pixel 0 = 0, pixel 3 = 255; flipped: result pixel 0 = original pixel 3
    expect(result.data[0]).toBe(255); // was x=3
    expect(result.data[4 * 3]).toBe(0); // was x=0
  });

  it('flips vertically', () => {
    const img = makeImageData(1, 4, (_, y) => [y * 85, 0, 0]);
    const transform: FillTransform = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: true,
      imageNaturalWidth: 1,
      imageNaturalHeight: 4,
    };
    const result = applyFillTransform(img, transform);
    expect(result.data[0]).toBe(255); // was y=3
    expect(result.data[3 * 4]).toBe(0); // was y=0
  });

  it('crops image', () => {
    const img = makeImageData(10, 10, (x, y) => [x, y, 0]);
    const transform: FillTransform = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
      crop: { x: 3, y: 2, w: 4, h: 3 },
      imageNaturalWidth: 10,
      imageNaturalHeight: 10,
    };
    const result = applyFillTransform(img, transform);
    expect(result.width).toBe(4);
    expect(result.height).toBe(3);
    expect(result.data[0]).toBe(3); // original (3,2).r = 3
    expect(result.data[1]).toBe(2); // original (3,2).g = 2
  });
});

describe('mapMaskThroughTransform', () => {
  it('no-op transform returns identity', () => {
    const mask = new Uint8Array([0, 255, 128, 0]);
    const result = mapMaskThroughTransform(mask, 2, 2, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
      imageNaturalWidth: 2,
      imageNaturalHeight: 2,
    });
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.mask)).toEqual([0, 255, 128, 0]);
  });

  it('flips mask horizontally', () => {
    const mask = new Uint8Array([0, 255, 128, 64]);
    const result = mapMaskThroughTransform(mask, 2, 2, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: true,
      flipV: false,
      imageNaturalWidth: 2,
      imageNaturalHeight: 2,
    });
    expect(Array.from(result.mask)).toEqual([255, 0, 64, 128]);
  });

  it('sets offset from crop', () => {
    const mask = new Uint8Array([255]);
    const result = mapMaskThroughTransform(mask, 1, 1, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
      crop: { x: 10, y: 20, w: 1, h: 1 },
      imageNaturalWidth: 100,
      imageNaturalHeight: 100,
    });
    expect(result.offsetX).toBe(10);
    expect(result.offsetY).toBe(20);
  });
});

describe('extractBoundedContext', () => {
  function makeImage(w: number, h: number): ImageData {
    const id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      id.data[i * 4] = i % 256;
      id.data[i * 4 + 1] = (i * 2) % 256;
      id.data[i * 4 + 2] = (i * 3) % 256;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }

  it('extracts bounded region with padding', () => {
    const img = makeImage(30, 30);
    const mask = new Uint8Array(900);
    mask[10 * 30 + 10] = 255; // (10,10) — far enough from edge for padding
    mask[15 * 30 + 15] = 255; // (15,15)

    const ctx = extractBoundedContext(img, mask, 30, 30, 0, 0, 8);
    expect(ctx.width).toBeGreaterThan(0);
    expect(ctx.height).toBeGreaterThan(0);
    expect(ctx.offsetX).toBe(2); // 10 - 8 = 2
    expect(ctx.offsetY).toBe(2); // 10 - 8 = 2
    expect(ctx.width).toBeLessThanOrEqual(30);
    expect(ctx.height).toBeLessThanOrEqual(30);
  });

  it('returns original when mask fills entire image', () => {
    const img = makeImage(10, 10);
    const mask = new Uint8Array(100).fill(255);
    const ctx = extractBoundedContext(img, mask, 10, 10, 0, 0);
    expect(ctx.offsetX).toBe(0);
    expect(ctx.offsetY).toBe(0);
    expect(ctx.width).toBe(10);
    expect(ctx.height).toBe(10);
  });

  it('returns original for empty mask', () => {
    const img = makeImage(10, 10);
    const mask = new Uint8Array(100);
    const ctx = extractBoundedContext(img, mask, 10, 10, 0, 0);
    expect(ctx.width).toBe(10);
    expect(ctx.height).toBe(10);
  });

  it('clamps context to image bounds', () => {
    const img = makeImage(10, 10);
    const mask = new Uint8Array(100);
    mask[0] = 255; // (0,0) — top-left corner
    const ctx = extractBoundedContext(img, mask, 10, 10, 0, 0, 100);
    expect(ctx.offsetX).toBe(0);
    expect(ctx.offsetY).toBe(0);
    expect(ctx.width).toBeLessThanOrEqual(10);
    expect(ctx.height).toBeLessThanOrEqual(10);
  });

  it('handles mask offset', () => {
    const img = makeImage(30, 30);
    const mask = new Uint8Array(100);
    mask[5 * 10 + 5] = 255; // (5,5) in mask space = (15,15) in image space
    const ctx = extractBoundedContext(img, mask, 10, 10, 10, 10, 8);
    expect(ctx.offsetX).toBe(7); // 10 + 5 - 8 = 7
    expect(ctx.offsetY).toBe(7); // 10 + 5 - 8 = 7
  });
});

describe('compositeFillResult', () => {
  function makeCheckerboard(w: number, h: number): ImageData {
    const id = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const v = (x + y) % 2 === 0 ? 255 : 0;
        id.data[idx] = v;
        id.data[idx + 1] = v;
        id.data[idx + 2] = v;
        id.data[idx + 3] = 255;
      }
    }
    return id;
  }

  it('composites filled region at correct offset', () => {
    const img = makeCheckerboard(10, 10);
    const fill = new ImageData(4, 4);
    fill.data.fill(128); // fill pixels RGBA
    for (let i = 0; i < 4 * 4; i++) {
      fill.data[i * 4 + 3] = 255; // fully opaque
    }

    const result = compositeFillResult(img, fill, 3, 3);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    // Pixel at (3,3) should be filled (128)
    const idx = (3 * 10 + 3) * 4;
    expect(result.data[idx]).toBe(128);
    // Pixel at (0,0) should remain unchanged (255 for checkerboard)
    expect(result.data[0]).toBe(255);
  });

  it('clamps fill to image bounds', () => {
    const img = makeCheckerboard(5, 5);
    const fill = new ImageData(10, 10);
    fill.data.fill(200);
    for (let i = 0; i < 10 * 10; i++) {
      fill.data[i * 4 + 3] = 255;
    }

    const result = compositeFillResult(img, fill, 0, 0);
    expect(result.width).toBe(5);
    expect(result.height).toBe(5);
    // All pixels should be 200 (filled)
    expect(result.data[0]).toBe(200);
    expect(result.data[(4 * 5 + 4) * 4]).toBe(200);
  });

  it('handles partial alpha blending', () => {
    const img = makeCheckerboard(4, 4);
    const fill = new ImageData(4, 4);
    fill.data.fill(200);
    for (let i = 0; i < 4 * 4; i++) {
      fill.data[i * 4] = 200;
      fill.data[i * 4 + 1] = 100;
      fill.data[i * 4 + 2] = 50;
      fill.data[i * 4 + 3] = 128; // 50% alpha
    }

    const result = compositeFillResult(img, fill, 0, 0);
    expect(result.width).toBe(4);
    // With 50% alpha, result should be blend of original and fill
    expect(result.data[0]).not.toBe(200);
    expect(result.data[0]).not.toBe(255);
    expect(result.data[3]).toBe(255); // always fully opaque
  });

  it('returns new ImageData with correct dimensions', () => {
    const img = makeCheckerboard(5, 7);
    const fill = new ImageData(5, 7);
    const result = compositeFillResult(img, fill, 0, 0);
    expect(result.width).toBe(5);
    expect(result.height).toBe(7);
    expect(result.data).not.toBe(img.data);
  });
});
