import { describe, expect, it } from 'vitest';
import {
  antialiasPlane,
  borderPlane,
  boxMeanPlane,
  boxSumPlane,
  cleanupPlane,
  contrastPlane,
  coverageThreshold,
  gaussianBlurPlane,
  greyMorphPlane,
  shiftEdgePlane,
  signedDistancePlane,
  smoothShapePlane,
  squaredEDT,
} from './areaSelectionMorphology';

function seeded(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

function naiveMorph(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: 'dilate' | 'erode',
  border: 'exclude' | 'clamp',
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = mode === 'dilate' ? 0 : 255;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          let nx = x + dx;
          let ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            if (border === 'exclude') continue;
            nx = Math.min(width - 1, Math.max(0, nx));
            ny = Math.min(height - 1, Math.max(0, ny));
          }
          const value = data[ny * width + nx]!;
          acc = mode === 'dilate' ? Math.max(acc, value) : Math.min(acc, value);
          count += 1;
        }
      }
      out[y * width + x] = count === 0 ? data[y * width + x]! : acc;
    }
  }
  return out;
}

describe('boxSumPlane / boxMeanPlane', () => {
  it('matches a naive box sum at borders and interior', () => {
    const width = 9;
    const height = 7;
    const data = seeded(7, width * height);
    for (const radius of [0, 1, 3, 8]) {
      const sums = boxSumPlane(data, width, height, radius);
      const means = boxMeanPlane(data, width, height, radius);
      const area = (2 * radius + 1) ** 2;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let expected = 0;
          for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
              const nx = Math.min(width - 1, Math.max(0, x + dx));
              const ny = Math.min(height - 1, Math.max(0, y + dy));
              expected += data[ny * width + nx]!;
            }
          }
          expect(sums[y * width + x]!).toBeCloseTo(expected, 3);
          expect(means[y * width + x]!).toBeCloseTo(expected / area, 4);
        }
      }
    }
  });
});

describe('greyMorphPlane (van Herk / Gil-Werman)', () => {
  it('matches a naive separable min/max for multiple radii and border policies', () => {
    const width = 11;
    const height = 8;
    const data = seeded(11, width * height);
    for (const radius of [1, 2, 5]) {
      for (const mode of ['dilate', 'erode'] as const) {
        for (const border of ['exclude', 'clamp'] as const) {
          const actual = greyMorphPlane(data, width, height, radius, mode, border);
          const expected = naiveMorph(data, width, height, radius, mode, border);
          expect(Array.from(actual), `${mode}/${border}/r${radius}`).toEqual(Array.from(expected));
        }
      }
    }
  });

  it('is byte-exact for a zero radius', () => {
    const data = seeded(3, 35);
    expect(Array.from(greyMorphPlane(data, 7, 5, 0, 'dilate'))).toEqual(Array.from(data));
  });

  it('preserves coverage values while expanding the support', () => {
    const data = new Uint8Array(49);
    data[3 * 7 + 3] = 100;
    const grown = greyMorphPlane(data, 7, 7, 1, 'dilate');
    expect(grown[2 * 7 + 3]).toBe(100);
    expect(grown[3 * 7 + 2]).toBe(100);
    expect(grown[1 * 7 + 1]).toBe(0);
  });
});

describe('squaredEDT', () => {
  it('returns exact Euclidean distances to a single sample', () => {
    const width = 7;
    const height = 7;
    const binary = new Uint8Array(width * height);
    binary[3 * width + 3] = 1;
    const distance = squaredEDT(binary, width, height);
    expect(distance[3 * width + 3]).toBe(0);
    expect(distance[3 * width + 4]).toBe(1);
    expect(distance[2 * width + 2]).toBe(2);
    expect(distance[0 * width + 0]).toBe(18);
    expect(distance[3 * width + 0]).toBe(9);
  });

  it('uses Euclidean geometry rather than a chessboard metric', () => {
    const width = 5;
    const height = 5;
    const binary = new Uint8Array(width * height);
    binary[0] = 1;
    const distance = squaredEDT(binary, width, height);
    // (3,4) is 5 away in chessboard terms but 5.0 Euclidean -> 25 squared.
    expect(distance[4 * width + 3]).toBe(25);
    expect(distance[3 * width + 4]).toBe(25);
  });

  it('returns infinity when there is no foreground', () => {
    const distance = squaredEDT(new Uint8Array(16), 4, 4);
    expect(distance.every((value) => value === Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('signedDistancePlane', () => {
  it('is negative inside and positive outside a rectangle', () => {
    const width = 9;
    const height = 9;
    const data = new Uint8Array(width * height);
    for (let y = 2; y < 7; y += 1) for (let x = 2; x < 7; x += 1) data[y * width + x] = 255;
    const field = signedDistancePlane(data, width, height);
    expect(field.hasBoundary).toBe(true);
    expect(field.signed[4 * width + 4]).toBeLessThan(0);
    expect(field.signed[4 * width + 0]).toBeGreaterThan(0);
  });

  it('reports no boundary for empty and full planes', () => {
    expect(signedDistancePlane(new Uint8Array(16), 4, 4).hasBoundary).toBe(false);
    expect(signedDistancePlane(new Uint8Array(16).fill(255), 4, 4).hasBoundary).toBe(false);
  });
});

describe('gaussianBlurPlane', () => {
  it('returns an exact copy for a non-positive sigma', () => {
    const data = seeded(5, 36);
    expect(Array.from(gaussianBlurPlane(data, 6, 6, 0))).toEqual(Array.from(data));
    expect(Array.from(gaussianBlurPlane(data, 6, 6, Number.NaN))).toEqual(Array.from(data));
  });

  it('leaves a constant plane unchanged at the border (edge lock)', () => {
    const data = new Uint8Array(36).fill(200);
    const blurred = gaussianBlurPlane(data, 6, 6, 2);
    expect(blurred.every((value) => value === 200)).toBe(true);
  });

  it('preserves total coverage approximately for a centred impulse', () => {
    const width = 15;
    const data = new Uint8Array(width * width);
    data[7 * width + 7] = 255;
    const blurred = gaussianBlurPlane(data, width, width, 1.5);
    const total = blurred.reduce((sum, value) => sum + value, 0);
    expect(total / 255).toBeGreaterThan(0.9);
    expect(total / 255).toBeLessThan(1.1);
  });

  it('softens a hard step monotonically', () => {
    const width = 11;
    const data = new Uint8Array(width);
    for (let x = 6; x < width; x += 1) data[x] = 255;
    const blurred = gaussianBlurPlane(data, width, 1, 1);
    for (let x = 1; x < width; x += 1) {
      expect(blurred[x]!).toBeGreaterThanOrEqual(blurred[x - 1]!);
    }
    expect(blurred[5]!).toBeGreaterThan(0);
    expect(blurred[5]!).toBeLessThan(255);
  });
});

describe('antialiasPlane', () => {
  it('leaves a flat plane byte-exact', () => {
    const data = new Uint8Array(64).fill(255);
    expect(Array.from(antialiasPlane(data, 8, 8))).toEqual(Array.from(data));
    expect(Array.from(antialiasPlane(new Uint8Array(64), 8, 8))).toEqual(
      Array.from(new Uint8Array(64)),
    );
  });

  it('introduces intermediate coverage only along the boundary', () => {
    const width = 9;
    const height = 9;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x - y >= 0) data[y * width + x] = 255;
      }
    }
    const out = antialiasPlane(data, width, height);
    // Far-from-edge pixels are untouched.
    expect(out[2 * width + 8]).toBe(255);
    expect(out[8 * width + 0]).toBe(0);
    // Diagonal edge pixels become partially covered.
    expect(out[3 * width + 4]!).toBeGreaterThan(0);
    expect(out[3 * width + 4]!).toBeLessThan(255);
    expect(out[3 * width + 3]!).toBeGreaterThan(0);
    expect(out[3 * width + 3]!).toBeLessThan(255);
  });
});

describe('borderPlane', () => {
  it('produces an empty plane for a zero band and no boundary', () => {
    const data = new Uint8Array(25).fill(255);
    expect(borderPlane(data, 5, 5, 0)).toEqual(new Uint8Array(25));
    expect(borderPlane(data, 5, 5, 2)).toEqual(new Uint8Array(25));
  });

  it('centers the band on the 50% contour', () => {
    const width = 11;
    const height = 11;
    const data = new Uint8Array(width * height);
    for (let y = 3; y < 8; y += 1) for (let x = 3; x < 8; x += 1) data[y * width + x] = 255;
    const centered = borderPlane(data, width, height, 2, 'centered');
    // A pixel just inside and a pixel just outside the rectangle edge are in
    // the band; the rectangle center and the far corner are not.
    expect(centered[5 * width + 3]).toBe(255);
    expect(centered[5 * width + 2]).toBe(255);
    expect(centered[5 * width + 5]).toBe(0);
    expect(centered[0]).toBe(0);
    const inside = borderPlane(data, width, height, 2, 'inside');
    expect(inside[5 * width + 4]).toBe(255);
    expect(inside[5 * width + 1]).toBe(0);
    const outside = borderPlane(data, width, height, 2, 'outside');
    expect(outside[5 * width + 2]).toBe(255);
    expect(outside[5 * width + 4]).toBe(0);
  });
});

describe('shiftEdgePlane', () => {
  it('is byte-exact for a zero shift', () => {
    const data = seeded(13, 49);
    expect(Array.from(shiftEdgePlane(data, 7, 7, 0))).toEqual(Array.from(data));
  });

  it('moves the 50% contour of a feathered edge outward and inward', () => {
    const width = 21;
    const height = 3;
    const data = new Uint8Array(width * height);
    // 50% contour at x = 10; ramp from 8 to 12.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = Math.round(Math.max(0, Math.min(1, (x - 8) / 4)) * 255);
        data[y * width + x] = value;
      }
    }
    const expanded = shiftEdgePlane(data, width, height, 1);
    const contracted = shiftEdgePlane(data, width, height, -1);
    const row = (data2: Uint8Array) => Array.from(data2.subarray(0, width));
    const middle = (values: number[]) => values[1]!;
    // Not exact due to bilateral sampling, but the ramp must move one pixel.
    expect(middle(row(expanded))).toBeGreaterThanOrEqual(middle(row(data)));
    expect(middle(row(contracted))).toBeLessThanOrEqual(middle(row(data)));
    expect(expanded[1 * width + 10]!).toBeGreaterThan(data[1 * width + 10]!);
    expect(contracted[1 * width + 10]!).toBeLessThan(data[1 * width + 10]!);
  });
});

describe('contrastPlane', () => {
  it('is an exact copy at zero and a threshold at one', () => {
    const data = new Uint8Array([0, 64, 128, 192, 255]);
    expect(Array.from(contrastPlane(data, 0))).toEqual(Array.from(data));
    expect(Array.from(contrastPlane(data, 1))).toEqual([0, 0, 255, 255, 255]);
  });

  it('never introduces values outside the source range', () => {
    const data = seeded(17, 100);
    const out = contrastPlane(data, 0.7);
    for (let i = 0; i < data.length; i += 1) {
      expect(out[i]!).toBeGreaterThanOrEqual(0);
      expect(out[i]!).toBeLessThanOrEqual(255);
    }
  });
});

describe('cleanupPlane', () => {
  it('removes small islands but keeps large ones and their coverage', () => {
    const width = 20;
    const height = 10;
    const data = new Uint8Array(width * height);
    data[1 * width + 1] = 255;
    data[1 * width + 2] = 255;
    for (let y = 3; y < 7; y += 1) {
      for (let x = 10; x < 16; x += 1) data[y * width + x] = 200;
    }
    const out = cleanupPlane(data, width, height, { minIslandArea: 4 });
    expect(out[1 * width + 1]).toBe(0);
    expect(out[1 * width + 2]).toBe(0);
    expect(out[5 * width + 12]).toBe(200);
  });

  it('fills small enclosed holes and keeps larger ones', () => {
    const width = 20;
    const height = 20;
    const data = new Uint8Array(width * height).fill(255);
    for (let x = 0; x < width; x += 1) {
      data[0 * width + x] = 0;
      data[19 * width + x] = 0;
    }
    for (let y = 0; y < height; y += 1) {
      data[y * width + 0] = 0;
      data[y * width + 19] = 0;
    }
    data[5 * width + 5] = 0;
    data[5 * width + 6] = 0;
    for (let y = 12; y < 18; y += 1) for (let x = 12; x < 18; x += 1) data[y * width + x] = 0;
    const out = cleanupPlane(data, width, height, { maxHoleArea: 4 });
    expect(out[5 * width + 5]).toBe(255);
    expect(out[5 * width + 6]).toBe(255);
    expect(out[14 * width + 14]).toBe(0);
  });

  it('is a byte-exact copy when both thresholds are zero', () => {
    const data = seeded(19, 100);
    expect(Array.from(cleanupPlane(data, 10, 10, {}))).toEqual(Array.from(data));
  });
});

describe('smoothShapePlane', () => {
  it('is byte-exact for a zero radius and for a convex hard rectangle', () => {
    const width = 15;
    const height = 15;
    const data = new Uint8Array(width * height);
    for (let y = 3; y < 12; y += 1) for (let x = 3; x < 12; x += 1) data[y * width + x] = 255;
    expect(Array.from(smoothShapePlane(data, width, height, 0))).toEqual(Array.from(data));
    expect(Array.from(smoothShapePlane(data, width, height, 2))).toEqual(Array.from(data));
  });

  it('fills a one-pixel gap and removes a one-pixel bump', () => {
    const width = 21;
    const height = 21;
    const data = new Uint8Array(width * height);
    for (let y = 4; y < 17; y += 1) for (let x = 4; x < 17; x += 1) data[y * width + x] = 255;
    data[10 * width + 10] = 0;
    data[4 * width + 1] = 255;
    const out = smoothShapePlane(data, width, height, 2);
    expect(out[10 * width + 10]).toBe(255);
    expect(out[4 * width + 1]).toBe(0);
    expect(out[10 * width + 10]).toBe(255);
  });

  it('preserves soft coverage where the shape is unchanged', () => {
    const width = 15;
    const height = 15;
    const data = new Uint8Array(width * height);
    for (let y = 3; y < 12; y += 1) for (let x = 3; x < 12; x += 1) data[y * width + x] = 150;
    const out = smoothShapePlane(data, width, height, 2);
    expect(out[7 * width + 7]).toBe(150);
  });
});

describe('coverageThreshold', () => {
  it('binarizes at the requested cut', () => {
    const out = coverageThreshold(new Uint8Array([0, 127, 128, 255]), 0.5);
    expect(Array.from(out)).toEqual([0, 0, 255, 255]);
  });
});
