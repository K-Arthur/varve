import { describe, expect, it } from 'vitest';
import { refineHairMatting } from '../refineHairMatting';

function makeSolidImage(w: number, h: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

describe('refineHairMatting', () => {
  it('preserves definite foreground and background cores', () => {
    const image = makeSolidImage(6, 6, 100, 100, 100);
    const mask = new Uint8Array(36);
    mask.fill(0);
    mask[0] = 255;
    mask[35] = 255;
    mask[17] = 128;

    const refined = refineHairMatting(image, mask, { edgeBandOnly: true });
    expect(refined[0]).toBe(255);
    expect(refined[35]).toBe(255);
  });

  it('adjusts edge-band pixels toward smoother alpha', () => {
    const image = makeSolidImage(5, 5, 200, 50, 50);
    const mask = new Uint8Array(25);
    mask.fill(0);
    for (let x = 1; x <= 3; x++) mask[x] = 128;

    const refined = refineHairMatting(image, mask, { radius: 2, edgeBandOnly: false });
    const edgeVal = refined[2] ?? 0;
    expect(edgeVal).toBeGreaterThan(0);
    expect(edgeVal).toBeLessThan(255);
  });

  it('throws on dimension mismatch', () => {
    const image = makeSolidImage(4, 4, 0, 0, 0);
    const mask = new Uint8Array(8);
    expect(() => refineHairMatting(image, mask)).toThrow(/dimensions/);
  });
});
