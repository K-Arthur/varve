import { linearSrgbToOklab, srgbToLinearUnit } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { applySoftwareFilter } from './filterCompositor';
import { adjustmentToFilter, makeAdjustment } from './filters';
import { applySplitTone, splitToneWeights } from './splitTone';
import { applyRelativeWhiteBalance, estimateRelativeWhiteBalance } from './whiteBalance';

const wb = { temperature: 0, tint: 0, redGain: 1, greenGain: 1, blueGain: 1 };
const tone = {
  shadowHue: 240,
  shadowSaturation: 0,
  highlightHue: 60,
  highlightSaturation: 0,
  balance: 0.5,
  blending: 0.5,
  strength: 1,
};
function pixels(values: number[], count = 1) {
  return new ImageData(
    new Uint8ClampedArray(Array.from({ length: count }, () => values).flat()),
    (values.length / 4) * count,
    1,
  );
}
function lightness(bytes: Uint8ClampedArray, i: number) {
  return linearSrgbToOklab(
    [0, 1, 2].map((c) => srgbToLinearUnit(bytes[i + c]! / 255)) as [number, number, number],
  )[0];
}
describe('rendered RGB white balance', () => {
  it('has exact neutral identity, including alpha and hidden color', () => {
    const image = pixels([10, 145, 207, 0, 23, 47, 91, 122]);
    const original = Array.from(image.data);
    applyRelativeWhiteBalance(image, wb);
    expect(Array.from(image.data)).toEqual(original);
  });
  it('uses decoded linear gains, not additive encoded channel offsets', () => {
    const image = pixels([128, 128, 128, 140]);
    applyRelativeWhiteBalance(image, { ...wb, redGain: 2 });
    // Independent IEC sRGB transfer reference, rounded at the byte boundary.
    const linear = ((128 / 255 + 0.055) / 1.055) ** 2.4;
    const red = Math.round((1.055 * (linear * 2) ** (1 / 2.4) - 0.055) * 255);
    expect(Array.from(image.data)).toEqual([red, 128, 128, 140]);
  });
  it('neutralizes a known patch, preserves linear luminance and repeats against source', () => {
    const source = pixels([145, 132, 117, 255], 20);
    const result = estimateRelativeWhiteBalance(source, { x: 5, y: 0, radius: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const corrected = pixels([145, 132, 117, 255]);
    applyRelativeWhiteBalance(corrected, {
      ...wb,
      redGain: result.gains[0],
      greenGain: result.gains[1],
      blueGain: result.gains[2],
    });
    expect(
      Math.max(...corrected.data.slice(0, 3)) - Math.min(...corrected.data.slice(0, 3)),
    ).toBeLessThanOrEqual(1);
    expect(estimateRelativeWhiteBalance(source, { x: 5, y: 0, radius: 1 })).toEqual(result);
    expect(Array.from(source.data.slice(0, 4))).toEqual([145, 132, 117, 255]);
  });
  it.each([
    [12, 240, 40, 255],
    [255, 255, 255, 255],
    [5, 5, 5, 255],
    [120, 120, 120, 128],
  ])('rejects unreliable Auto evidence %s', (r, g, b, a) => {
    expect(estimateRelativeWhiteBalance(pixels([r, g, b, a], 32))).toMatchObject({ ok: false });
  });
  it('accepts bounded near-neutral evidence without inventing camera metadata', () => {
    const result = estimateRelativeWhiteBalance(pixels([138, 131, 126, 255], 32));
    expect(result).toMatchObject({ ok: true, samples: 32 });
  });
});
describe('photographic split toning', () => {
  it.each([{ ...tone, strength: 0 }, tone])(
    'has exact bypass with zero chromatic contribution',
    (params) => {
      const image = pixels([200, 15, 175, 128, 44, 100, 255, 0]);
      const original = Array.from(image.data);
      applySplitTone(image, params);
      expect(Array.from(image.data)).toEqual(original);
    },
  );
  it('preserves alpha, hidden RGB, black/white endpoints and Oklab lightness within quantization', () => {
    const image = pixels([0, 0, 0, 255, 255, 255, 255, 255, 120, 70, 180, 127, 23, 80, 244, 0]);
    const before = new Uint8ClampedArray(image.data);
    applySplitTone(image, { ...tone, shadowSaturation: 0.8, highlightSaturation: 0.8 });
    expect(Array.from(image.data.slice(0, 8))).toEqual(Array.from(before.slice(0, 8)));
    expect(image.data[11]).toBe(127);
    expect(Array.from(image.data.slice(12))).toEqual(Array.from(before.slice(12)));
    expect(Math.abs(lightness(image.data, 8) - lightness(before, 8))).toBeLessThan(0.004);
  });
  it('wraps hues exactly and keeps weight sum one at extreme pivots', () => {
    const a = pixels([60, 60, 60, 255, 200, 200, 200, 255]);
    const b = pixels(Array.from(a.data));
    applySplitTone(a, {
      ...tone,
      shadowHue: 0,
      highlightHue: 0,
      shadowSaturation: 0.3,
      highlightSaturation: 0.3,
    });
    applySplitTone(b, {
      ...tone,
      shadowHue: 360,
      highlightHue: 360,
      shadowSaturation: 0.3,
      highlightSaturation: 0.3,
    });
    expect(a.data).toEqual(b.data);
    for (const pivot of [0, 0.5, 1])
      for (const width of [0, 0.01, 1])
        for (let l = 0; l <= 1; l += 0.01) {
          const [s, h] = splitToneWeights(l, pivot, width);
          expect(s + h).toBe(1);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(h).toBeGreaterThanOrEqual(0);
        }
  });
  it('routes both new kinds through the actual software IR boundary', () => {
    for (const kind of ['whiteBalance', 'splitTone'] as const) {
      const filter = adjustmentToFilter(makeAdjustment('new', kind));
      const source = pixels([87, 101, 144, 255]);
      let called = false;
      applySoftwareFilter(
        {
          getImageData: () => source,
          putImageData: () => {
            called = true;
          },
        } as unknown as CanvasRenderingContext2D,
        filter,
        1,
        1,
      );
      expect(called).toBe(true);
    }
  });
});
