import { describe, expect, it } from 'vitest';
import { applySoftwareFilter } from './filterCompositor';
import { isIdentityFilter } from './filterIdentity';
import { adjustmentToFilter, makeAdjustment } from './filters';
import { applyUnsharpMask } from './unsharpMask';

function dispatch(source: ImageData, radius: number, scale = 1): ImageData {
  const adjustment = makeAdjustment('detail', 'sharpen');
  if (adjustment.kind !== 'sharpen') throw new Error('factory');
  let output = source;
  applySoftwareFilter(
    {
      getImageData: () => source,
      putImageData: (data: ImageData) => {
        output = data;
      },
    } as unknown as CanvasRenderingContext2D,
    adjustmentToFilter({ ...adjustment, amount: 75, radius }),
    source.width,
    source.height,
    { coordSpace: { scale, originX: 0, originY: 0, regionX: 0, regionY: 0 } },
  );
  return output;
}

describe('editing sharpening integration', () => {
  it('uses the versioned Gaussian in the authored coordinate scale, including fractional radius', () => {
    const source = new ImageData(
      new Uint8ClampedArray([90, 90, 90, 255, 130, 150, 170, 255, 180, 180, 180, 255]),
      3,
      1,
    );
    for (const scale of [0.5, 1, 2]) {
      const actual = dispatch(source, 1.5, scale);
      const reference = applyUnsharpMask(source, {
        amount: 0.75,
        radius: 1.5 * scale,
        threshold: 0,
        workingSpace: 'linear-srgb',
        luminanceOnly: false,
        protectAlpha: true,
      });
      expect(actual.data).toEqual(reference.data);
    }
  });
  it('bypasses zero radius/amount without a canvas byte round trip', () => {
    const filter = adjustmentToFilter(makeAdjustment('detail', 'sharpen'));
    expect(isIdentityFilter(filter)).toBe(true);
    expect(
      isIdentityFilter({ ...filter, kind: 'sharpen', amount: 100, radius: 0, threshold: 0 }),
    ).toBe(true);
  });
});
