import { describe, expect, it } from 'vitest';
import { resolveFlattenRasterDimensions } from './resolution';

describe('resolveFlattenRasterDimensions', () => {
  it.each([
    [72, 960, 480, 720, 360],
    [96, 960, 480, 960, 480],
    [150, 960, 480, 1500, 750],
    [300, 960, 480, 3000, 1500],
    [600, 960, 480, 6000, 3000],
  ])(
    'resolves %d PPI without changing document geometry',
    (ppi, width, height, expectedW, expectedH) => {
      const result = resolveFlattenRasterDimensions(width, height, { dpi: ppi });
      expect(result.requestedPpi).toBe(ppi);
      expect(result.requestedPixelWidth).toBe(expectedW);
      expect(result.requestedPixelHeight).toBe(expectedH);
    },
  );

  it('keeps independent rounding for non-square bounds', () => {
    const result = resolveFlattenRasterDimensions(10.25, 7.75, { dpi: 150 });
    expect(result.requestedPixelWidth).toBe(Math.round((10.25 * 150) / 96));
    expect(result.requestedPixelHeight).toBe(Math.round((7.75 * 150) / 96));
  });

  it('supports legacy scale callers when no PPI is supplied', () => {
    const result = resolveFlattenRasterDimensions(960, 480, { scale: 2 });
    expect(result.requestedPpi).toBe(192);
    expect(result.requestedPixelWidth).toBe(1920);
    expect(result.requestedPixelHeight).toBe(960);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid PPI %d', (dpi) => {
    expect(() => resolveFlattenRasterDimensions(100, 100, { dpi })).toThrow(
      'Flatten output PPI must be a positive finite number',
    );
  });
});
