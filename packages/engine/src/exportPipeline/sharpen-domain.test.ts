import { describe, expect, it } from 'vitest';
import { sharpenImageData } from './sharpen';

function image(pixels: number[][]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels.flat()), pixels.length, 1);
}

describe('output sharpening domain and alpha oracles', () => {
  it.each(['srgb', 'linear-srgb'] as const)(
    'keeps flat colored patches exact in %s',
    (workingSpace) => {
      const source = image(Array.from({ length: 7 }, () => [128, 87, 203, 255]));
      const result = sharpenImageData(source, {
        mode: 'unsharp',
        amount: 1,
        radius: 3,
        threshold: 0,
        workingSpace,
      });
      expect(result.imageData.data).toEqual(source.data);
    },
  );

  it.each(['srgb', 'linear-srgb'] as const)(
    'ignores hidden color and preserves alpha in %s',
    (workingSpace) => {
      const source = image([
        [111, 55, 199, 255],
        [111, 55, 199, 60],
        [250, 1, 10, 0],
      ]);
      const result = sharpenImageData(source, {
        mode: 'unsharp',
        amount: 1,
        radius: 2,
        threshold: 0,
        workingSpace,
        luminanceOnly: false,
      });
      expect(result.imageData.data).toEqual(source.data);
    },
  );

  it('matches independent linear-light two-pixel Gaussian reference', () => {
    const decode = (v: number) =>
      v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    const encode = (v: number) =>
      Math.round(
        255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)),
      );
    // radius=3 means sigma=1, support=3; clamped edge includes the centre
    // and every sample on that side of the two-pixel boundary.
    const weights = [-3, -2, -1, 0, 1, 2, 3].map((d) => Math.exp((-d * d) / 2));
    const crossWeight =
      weights.slice(4).reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0);
    const dark = decode(90),
      light = decode(180);
    const expected = [
      encode(dark + 0.5 * crossWeight * (dark - light)),
      encode(light + 0.5 * crossWeight * (light - dark)),
    ];
    const result = sharpenImageData(
      image([
        [90, 90, 90, 255],
        [180, 180, 180, 255],
      ]),
      {
        mode: 'unsharp',
        amount: 0.5,
        radius: 3,
        threshold: 0,
        workingSpace: 'linear-srgb',
        luminanceOnly: false,
      },
    );
    expect([result.imageData.data[0], result.imageData.data[4]]).toEqual(expected);
  });

  it('does not suppress an isoluminant chromatic edge in component mode', () => {
    const source = image([
      [180, 70, 80, 255],
      [70, 102, 87, 255],
    ]);
    const result = sharpenImageData(source, {
      mode: 'unsharp',
      amount: 1,
      radius: 3,
      threshold: 0.01,
      luminanceOnly: false,
    });
    expect(result.imageData.data[0]).toBeGreaterThan(180);
    expect(result.imageData.data[4]).toBeLessThan(70);
  });
});
