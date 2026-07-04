/**
 * Retouch engine tests — 8 tests covering all retouch functions.
 */
import { describe, expect, it } from 'vitest';
import {
  clonePixels,
  createBrushMask,
  findBestPatch,
  healPixels,
  ncc,
  patchRegion,
  spotHeal,
} from './retouch';

function makeTestImageData(w: number, h: number, fill: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe('clonePixels', () => {
  it('copies pixels from source to target respecting brush mask', () => {
    const w = 20;
    const h = 20;
    const black = makeTestImageData(w, h, () => 0);
    const white = makeTestImageData(w, h, () => 255);

    const result = clonePixels(black, white, 10, 10, 0, 0, 5, null);

    const idx = (10 * w + 10) * 4;
    expect(result.data[idx]).toBe(255);
    expect(result.data[idx + 1]).toBe(255);
    expect(result.data[idx + 2]).toBe(255);
  });

  it('blends at soft brush edges', () => {
    const w = 10;
    const h = 10;
    const target = makeTestImageData(w, h, () => 0);
    const source = makeTestImageData(w, h, () => 200);
    const { mask } = createBrushMask(5, 0.5);

    const result = clonePixels(target, source, 5, 5, 0, 0, 5, mask);

    const centerIdx = (5 * w + 5) * 4;
    expect(result.data[centerIdx]).toBeGreaterThan(0);
    expect(result.data[centerIdx]).toBeLessThanOrEqual(200);
  });

  it('clamps to image boundaries', () => {
    const w = 10;
    const h = 10;
    const target = makeTestImageData(w, h, () => 0);
    const source = makeTestImageData(w, h, () => 255);

    expect(() => clonePixels(target, source, 0, 0, 0, 0, 20, null)).not.toThrow();
  });
});

describe('createBrushMask', () => {
  it('produces a circular mask with correct dimensions', () => {
    const { mask, diameter } = createBrushMask(9, 1);
    expect(diameter).toBe(9);
    expect(mask.length).toBe(81);
    expect(mask[40]).toBe(255);
  });

  it('produces soft edges with hardness < 1', () => {
    const { mask } = createBrushMask(9, 0.5);
    const center = mask[40];
    expect(center).toBe(255);
    const corner = mask[0];
    expect(corner).toBeLessThan(255);
  });
});

describe('ncc', () => {
  it('returns 1 for identical patches', () => {
    const data = makeTestImageData(10, 10, (x, y) => (x + y) % 256);
    const score = ncc(data.data, data.data, 0, 40, 9);
    expect(score).toBeCloseTo(1, 3);
  });

  it('returns lower score for different patches', () => {
    const a = makeTestImageData(10, 10, (x, y) => (x + y) % 256);
    const b = makeTestImageData(10, 10, (x, y) => (255 - x - y) % 256);
    const score = ncc(a.data, b.data, 0, 40, 9);
    expect(score).toBeLessThan(0.9);
  });
});

describe('findBestPatch', () => {
  it('finds a similar region within search radius', () => {
    const w = 20;
    const h = 20;
    const src = makeTestImageData(w, h, (x, y) => {
      if (x >= 5 && x <= 7 && y >= 5 && y <= 7) return 200;
      if (x >= 13 && x <= 15 && y >= 13 && y <= 15) return 200;
      return 50;
    });

    const result = findBestPatch(src, src, 6, 6, 1, 10);
    expect(result.x).toBeGreaterThanOrEqual(5);
    expect(result.y).toBeGreaterThanOrEqual(5);
  });
});

describe('healPixels', () => {
  it('blends source patch into target with mask', () => {
    const w = 16;
    const h = 16;
    const target = makeTestImageData(w, h, () => 0);
    const patch = makeTestImageData(w, h, () => 200);
    const mask = new Uint8Array(w * h).fill(255);

    const result = healPixels(target, patch, mask);
    expect(result.data[0]).toBe(200);
  });
});

describe('spotHeal', () => {
  it('modifies pixel data within the heal radius', () => {
    const w = 30;
    const h = 30;
    const cx = 15;
    const cy = 15;
    const img = makeTestImageData(w, h, (x, y) => {
      if (x >= cx - 2 && x <= cx + 2 && y >= cy - 2 && y <= cy + 2) return 255;
      return 100 + ((x * 7 + y * 13) % 30);
    });

    const before = new Uint8Array(img.data);
    const result = spotHeal(img, cx, cy, 3);
    let changed = false;
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        const i = (y * w + x) * 4;
        if (result.data[i] !== before[i]) { changed = true; break; }
      }
      if (changed) break;
    }
    expect(changed).toBe(true);
  });

  it('handles edge of canvas gracefully', () => {
    const w = 10;
    const h = 10;
    const img = makeTestImageData(w, h, () => 100);
    expect(() => spotHeal(img, 1, 1, 2)).not.toThrow();
  });
});

describe('patchRegion', () => {
  it('copies source rect to target rect with edge blending', () => {
    const w = 20;
    const h = 20;
    const src = makeTestImageData(w, h, (x, y) => {
      if (x >= 0 && x <= 4 && y >= 0 && y <= 4) return 200;
      return 50;
    });

    const result = patchRegion(src, { x: 0, y: 0, w: 5, h: 5 }, { x: 10, y: 10, w: 5, h: 5 });

    const centerIdx = (12 * w + 12) * 4;
    expect(result.data[centerIdx]).toBeGreaterThanOrEqual(100);
    expect(result.data[centerIdx]).toBeLessThanOrEqual(200);
  });
});
