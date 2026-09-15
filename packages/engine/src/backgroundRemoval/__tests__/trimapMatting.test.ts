import { describe, expect, it } from 'vitest';
import { TRIMap } from '../refineHairMatting';
import { solveTrimapMatting, trimapFromMask } from '../trimapMatting';

function makeImage(
  w: number,
  h: number,
  colorAt: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colorAt(x, y);
      const at = (y * w + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe('trimapFromMask', () => {
  it('marks the soft edge band as unknown and keeps distant background definite', () => {
    const mask = new Uint8Array(25);
    mask.fill(0);
    for (let x = 1; x <= 3; x++) mask[x] = 200;
    const trimap = trimapFromMask(mask, 5, 5, 1);
    expect(trimap[2]).toBe(TRIMap.UNKNOWN);
    expect(trimap[24]).toBe(TRIMap.BG);
  });

  it('adds a spatial unknown band around a hard binary edge', () => {
    const mask = new Uint8Array(25);
    mask.fill(0);
    for (let y = 0; y < 5; y++) {
      for (let x = 1; x <= 3; x++) mask[y * 5 + x] = 255;
    }
    const trimap = trimapFromMask(mask, 5, 5, 1);
    // Only the middle column is core foreground; the columns adjacent to the
    // boundary on either side are unknown.
    expect(trimap[2 * 5 + 2]).toBe(TRIMap.FG);
    expect(trimap[2 * 5 + 1]).toBe(TRIMap.UNKNOWN);
    expect(trimap[2 * 5 + 3]).toBe(TRIMap.UNKNOWN);
    expect(trimap[2 * 5 + 0]).toBe(TRIMap.UNKNOWN);
    expect(trimap[2 * 5 + 4]).toBe(TRIMap.UNKNOWN);
  });
});

describe('solveTrimapMatting', () => {
  it('propagates fg alpha into an unknown band using the colour line', () => {
    // Blue background framing a red foreground; the unknown pixel carries
    // foreground colour, so its estimated alpha is high.
    const image = makeImage(4, 3, (x) => (x === 0 || x >= 3 ? [20, 60, 220] : [220, 30, 40]));
    const trimap = new Uint8Array(4 * 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const i = y * 4 + x;
        trimap[i] =
          x === 0 ? TRIMap.BG : x === 1 ? TRIMap.FG : x === 2 ? TRIMap.UNKNOWN : TRIMap.BG;
      }
    }

    const mask = solveTrimapMatting(image, trimap, { iterations: 200, windowRadius: 1 });
    expect(mask[1 * 4 + 1]).toBe(255);
    expect(mask[1 * 4 + 2]).toBeGreaterThan(150);
  });

  it('keeps bg pixels at zero', () => {
    const image = makeImage(3, 3, () => [0, 0, 0]);
    const trimap = new Uint8Array(9);
    trimap.fill(TRIMap.BG);
    trimap[4] = TRIMap.FG;
    const mask = solveTrimapMatting(image, trimap);
    expect(mask[0]).toBe(0);
    expect(mask[8]).toBe(0);
  });

  it('throws an honest error when the trimap has no constraints', () => {
    const image = makeImage(3, 3, () => [10, 10, 10]);
    const trimap = new Uint8Array(9).fill(TRIMap.UNKNOWN);
    expect(() => solveTrimapMatting(image, trimap)).toThrow(/constraints/i);
  });
});
