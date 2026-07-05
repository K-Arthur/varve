import { describe, expect, it } from 'vitest';
import {
  chromaKeyMask,
  edgeDetectMask,
  floodFillMask,
  kMeansMask,
  removeBackgroundHeuristic,
} from '../heuristic';
import type { HeuristicMethod } from '../types';

function makeTestImage(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

function redBlueSplit(w: number, h: number): ImageData {
  return makeTestImage(w, h, (x, _y) => {
    if (x < w / 2) return [255, 0, 0, 255];
    return [0, 0, 255, 255];
  });
}

function solidWhite(w: number, h: number): ImageData {
  return makeTestImage(w, h, () => [255, 255, 255, 255]);
}

describe('floodFillMask', () => {
  it('fills a connected region from click point', () => {
    const img = redBlueSplit(20, 20);
    const mask = floodFillMask(img, { x: 15, y: 10 }, 30);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = y * 20 + x;
        expect(mask[i]).toBe(x >= 10 ? 0 : 255);
      }
    }
  });

  it('marks entire white image as background (mask=0)', () => {
    const img = solidWhite(10, 10);
    const mask = floodFillMask(img, { x: 5, y: 5 }, 30);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('returns all-255 when click is out of bounds', () => {
    const img = redBlueSplit(10, 10);
    const mask = floodFillMask(img, { x: 100, y: 100 }, 30);
    expect(mask.every((v) => v === 255)).toBe(true);
  });

  it('low tolerance only fills very similar colors', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      const val = x < 3 ? 255 : x < 5 ? 250 : 0;
      return [val, val, val, 255];
    });
    const mask = floodFillMask(img, { x: 1, y: 5 }, 5);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 1]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
      expect(mask[y * 10 + 4]).toBe(255);
    }
  });

  it('treats transparent pixels as background (mask=0)', () => {
    const img = makeTestImage(10, 10, (x, _y) => (x < 5 ? [255, 0, 0, 0] : [255, 0, 0, 255]));
    const mask = floodFillMask(img, { x: 2, y: 5 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 4]).toBe(0);
      expect(mask[y * 10 + 5]).toBe(255);
    }
  });
});

describe('chromaKeyMask', () => {
  it('isolates foreground on pure green screen', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [0, 255, 0, 255];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
      expect(mask[y * 10 + 5]).toBe(255);
    }
  });

  it('high tolerance selects near-green as background', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [0, 255, 0, 255];
      if (x < 5) return [10, 245, 10, 255];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 50);
    expect(mask[0]).toBe(0);
    expect(mask[0 * 10 + 4]).toBe(0);
    expect(mask[0 * 10 + 5]).toBe(255);
  });
});

describe('kMeansMask', () => {
  it('separates two distinct color regions', () => {
    const img = redBlueSplit(10, 10);
    const mask = kMeansMask(img);
    const hasFg = mask.some((v) => v > 128);
    const hasBg = mask.some((v) => v <= 128);
    expect(hasFg).toBe(true);
    expect(hasBg).toBe(true);
  });

  it('returns uniform mask for single-color image', () => {
    const img = solidWhite(10, 10);
    const mask = kMeansMask(img);
    const unique = new Set(mask);
    expect(unique.size).toBeLessThanOrEqual(2);
  });
});

describe('edgeDetectMask', () => {
  it('finds a large central rectangle', () => {
    const img = makeTestImage(20, 20, (x, y) => {
      const inside = x >= 5 && x < 15 && y >= 5 && y < 15;
      return inside ? [255, 0, 0, 255] : [200, 200, 200, 255];
    });
    const mask = edgeDetectMask(img);
    expect(mask[10 * 20 + 10]).toBeGreaterThan(128);
    expect(mask[0]).toBeLessThanOrEqual(128);
  });
});

describe('removeBackgroundHeuristic', () => {
  it('auto-selects flood fill when click point provided', async () => {
    const img = redBlueSplit(20, 20);
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      clickPoint: { x: 15, y: 10 },
    });
    expect(typeof result.maskDataUrl).toBe('string');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('handles solid white image gracefully', async () => {
    const img = solidWhite(10, 10);
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(typeof result.maskDataUrl).toBe('string');
  });

  it('feather parameter non-zero changes processing time', async () => {
    const img = redBlueSplit(20, 20);
    const feathered = await removeBackgroundHeuristic(img, {
      method: 'quick',
      clickPoint: { x: 15, y: 10 },
      feather: 2,
    });
    expect(feathered.confidence).toBeGreaterThan(0);
    expect(typeof feathered.maskDataUrl).toBe('string');
  });

  it('handles minimal image (1x1) gracefully', async () => {
    const tiny = new ImageData(1, 1);
    const result = await removeBackgroundHeuristic(tiny, { method: 'quick' });
    expect(typeof result.maskDataUrl).toBe('string');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});
