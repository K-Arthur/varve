import { describe, expect, it } from 'vitest';
import { TRIMap } from '../refineHairMatting';
import { solveTrimapMatting, trimapFromMask } from '../trimapMatting';

function makeImage(w: number, h: number, fgColor: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fgColor[0];
    data[i * 4 + 1] = fgColor[1];
    data[i * 4 + 2] = fgColor[2];
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

describe('trimapFromMask', () => {
  it('marks edge band as unknown', () => {
    const mask = new Uint8Array(25);
    mask.fill(0);
    for (let x = 1; x <= 3; x++) mask[x] = 200;
    const trimap = trimapFromMask(mask, 5, 5, 1);
    expect(trimap[2]).toBe(TRIMap.UNKNOWN);
    expect(trimap[0]).toBe(TRIMap.BG);
  });
});

describe('solveTrimapMatting', () => {
  it('propagates fg alpha into unknown band adjacent to definite fg', () => {
    const image = makeImage(4, 1, [200, 50, 50]);
    const trimap = new Uint8Array(4);
    trimap[0] = TRIMap.BG;
    trimap[1] = TRIMap.FG;
    trimap[2] = TRIMap.UNKNOWN;
    trimap[3] = TRIMap.BG;

    const mask = solveTrimapMatting(image, trimap, { iterations: 4, windowRadius: 1 });
    expect(mask[1]).toBe(255);
    expect(mask[2]).toBeGreaterThan(200);
  });

  it('keeps bg pixels at zero', () => {
    const image = makeImage(3, 3, [0, 0, 0]);
    const trimap = new Uint8Array(9);
    trimap.fill(TRIMap.BG);
    trimap[4] = TRIMap.FG;
    const mask = solveTrimapMatting(image, trimap);
    expect(mask[0]).toBe(0);
    expect(mask[8]).toBe(0);
  });
});
