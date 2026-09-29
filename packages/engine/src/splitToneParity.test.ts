import { gamutMapToSrgbUnit, linearSrgbToOklab, srgbToLinearUnit } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { applySplitTone, type SplitToneParams, splitToneWeights } from './splitTone';

// Compatibility oracle for the original v1 implementation's Lab -> Lch ->
// gamut mapper route. This tests a byte-preserving optimization, separately
// from the lightness/neutral/alpha contract tests in tonalColor.test.ts.
function original(bytes: Uint8ClampedArray, p: SplitToneParams) {
  const vectors = [p.shadowHue, p.highlightHue].map((angle, range) => {
    const radians = ((((angle % 360) + 360) % 360) * Math.PI) / 180;
    const chroma = [p.shadowSaturation, p.highlightSaturation][range]! * 0.15 * p.strength;
    return [Math.cos(radians) * chroma, Math.sin(radians) * chroma];
  });
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3] === 0) continue;
    const [L, a, b] = linearSrgbToOklab(
      [0, 1, 2].map((c) => srgbToLinearUnit(bytes[i + c]! / 255)) as [number, number, number],
    );
    if (L < 1e-8 || L > 1 - 1e-7) continue;
    const [s, h] = splitToneWeights(L, p.balance, p.blending),
      envelope = 4 * L * (1 - L);
    const na = a + envelope * (vectors[0]![0]! * s + vectors[1]![0]! * h);
    const nb = b + envelope * (vectors[0]![1]! * s + vectors[1]![1]! * h);
    const rgb = gamutMapToSrgbUnit([L, Math.hypot(na, nb), Math.atan2(nb, na)]);
    for (let c = 0; c < 3; c++) bytes[i + c] = Math.round(rgb[c]!);
  }
}
describe('split tone v1 byte compatibility', () => {
  it.each([
    [240, 60, 0.18, 0.15, 0.5, 0.5],
    [359, -20, 1, 1, 0, 0.01],
    [120, 220, 0.4, 0.7, 1, 1],
  ])(
    'retains in-gamut and compressed colors for hues %s / %s',
    (shadowHue, highlightHue, shadowSaturation, highlightSaturation, balance, blending) => {
      const pixels = new Uint8ClampedArray(4096 * 4);
      let state = 123456789;
      for (let i = 0; i < pixels.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        pixels[i] = state >>> 24;
      }
      const expected = new Uint8ClampedArray(pixels);
      const params = {
        shadowHue,
        highlightHue,
        shadowSaturation,
        highlightSaturation,
        balance,
        blending,
        strength: 1,
      };
      original(expected, params);
      const image = new ImageData(pixels, 64, 64);
      applySplitTone(image, params);
      expect(image.data).toEqual(expected);
    },
  );
});
