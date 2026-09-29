import { describe, expect, it } from 'vitest';
import { applyUnsharpMask, type UnsharpMaskOptions } from './unsharpMask';

// Independent full 2-D scalar convolution: no production blur, tiling or
// transfer helpers. IEC sRGB constants are stated at the reference boundary.
function reference(source: ImageData, options: UnsharpMaskOptions): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source.data);
  const decode = (v: number) =>
    options.workingSpace === 'srgb'
      ? v / 255
      : v / 255 <= 0.04045
        ? v / 255 / 12.92
        : ((v / 255 + 0.055) / 1.055) ** 2.4;
  const encode = (v: number) => {
    v = Math.max(0, Math.min(1, v));
    return Math.round(
      255 *
        (options.workingSpace === 'srgb'
          ? v
          : v <= 0.0031308
            ? 12.92 * v
            : 1.055 * v ** (1 / 2.4) - 0.055),
    );
  };
  const support = Math.ceil(options.radius),
    sigma = options.radius / 3;
  const weights = Array.from({ length: 2 * support + 1 }, (_, i) =>
    Math.exp(-((i - support) ** 2) / (2 * sigma * sigma)),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const index = (y * source.width + x) * 4;
      if (!source.data[index + 3]) continue;
      const blur = [0, 0, 0],
        current = [0, 1, 2].map((c) => decode(source.data[index + c]!));
      let coverage = 0;
      for (let dy = -support; dy <= support; dy++)
        for (let dx = -support; dx <= support; dx++) {
          const sx = Math.max(0, Math.min(source.width - 1, x + dx));
          const sy = Math.max(0, Math.min(source.height - 1, y + dy));
          const input = (sy * source.width + sx) * 4;
          const w =
            (((weights[dy + support]! * weights[dx + support]!) / (sum * sum)) *
              source.data[input + 3]!) /
            255;
          coverage += w;
          for (let c = 0; c < 3; c++) blur[c] = blur[c]! + w * decode(source.data[input + c]!);
        }
      let delta = current.map((v, c) => v - blur[c]! / coverage);
      if (options.luminanceOnly)
        delta = Array(3).fill(delta[0]! * 0.2126 + delta[1]! * 0.7152 + delta[2]! * 0.0722);
      if (Math.max(...delta.map(Math.abs)) <= Math.max(options.threshold, 1e-12)) continue;
      const amount = options.amount * (options.protectAlpha ? source.data[index + 3]! / 255 : 1);
      for (let c = 0; c < 3; c++) result[index + c] = encode(current[c]! + amount * delta[c]!);
    }
  return result;
}

function fixture(): ImageData {
  // Crosses both 128-column and 64-row production tile boundaries, including
  // colored transparent padding, partial alpha and a nonuniform diagonal.
  const pixels = new Uint8ClampedArray(133 * 70 * 4);
  for (let y = 0; y < 70; y++)
    for (let x = 0; x < 133; x++) {
      const i = (y * 133 + x) * 4;
      pixels.set(
        [
          40 + ((x + 2 * y) % 170),
          190 - ((x * 3 + y) % 120),
          70 + ((x + y) % 100),
          x % 17 === 0 ? 0 : y % 13 === 0 ? 37 : 255,
        ],
        i,
      );
    }
  return new ImageData(pixels, 133, 70);
}

describe('Gaussian unsharp full-surface oracle', () => {
  it.each([
    ['srgb', false, true, 0],
    ['linear-srgb', false, false, 0],
    ['linear-srgb', true, true, 0.025],
  ] as const)(
    'matches independent convolution across tiles: %s/luma=%s/alpha=%s/threshold=%s',
    (workingSpace, luminanceOnly, protectAlpha, threshold) => {
      const source = fixture();
      const options = {
        amount: 0.65,
        radius: 3.5,
        threshold,
        workingSpace,
        luminanceOnly,
        protectAlpha,
      };
      expect(applyUnsharpMask(source, options).data).toEqual(reference(source, options));
    },
  );
  it('returns exact copies for zero amount/radius and rejects nonfinite radius', () => {
    const source = fixture();
    const defaults = {
      amount: 1,
      radius: 3,
      threshold: 0,
      workingSpace: 'srgb' as const,
      luminanceOnly: false,
      protectAlpha: true,
    };
    for (const patch of [{ amount: 0 }, { radius: 0 }, { radius: Number.NaN }]) {
      const output = applyUnsharpMask(source, { ...defaults, ...patch });
      expect(output.data).toEqual(source.data);
      expect(output.data).not.toBe(source.data);
    }
  });
});
