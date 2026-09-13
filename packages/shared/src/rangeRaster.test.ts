import { describe, expect, it } from 'vitest';
import {
  createRangeRaster,
  RangeRasterError,
  sanitizeRangeRasterInPlace,
  validateRangeRasterContract,
} from './rangeRaster';

const contract = {
  width: 2,
  height: 1,
  stride: 8,
  channelLayout: 'rgba' as const,
  sampleType: 'float32' as const,
  encoding: {
    model: 'rgb' as const,
    primaries: 'srgb' as const,
    transfer: 'linear' as const,
    bitDepth: 'float32' as const,
    alphaMode: 'straight' as const,
    provenance: 'named' as const,
  },
  reference: 'scene-linear' as const,
  referenceWhite: 1,
  alphaMode: 'straight' as const,
  provenance: 'hdr-radiance' as const,
};

describe('range raster contract', () => {
  it('accepts extended and negative RGB while requiring bounded alpha separately', () => {
    const raster = createRangeRaster(contract, new Float32Array([-0.25, 1, 4, 0.5, 2, 3, 8, 1]));
    expect(raster.pixels[0]).toBeCloseTo(-0.25);
    expect(raster.pixels[2]).toBe(4);
    expect(raster.pixels[3]).toBe(0.5);
  });

  it('sanitizes non-finite RGB and clamps only alpha/range safety limits', () => {
    const raster = createRangeRaster(
      contract,
      new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -10, 2, 1, 1, 1, -1]),
    );
    const report = sanitizeRangeRasterInPlace(raster, { maxAbsRgb: 8 });
    expect(Array.from(raster.pixels)).toEqual([0, 8, -8, 1, 1, 1, 1, 0]);
    expect(report.replacedNonFinite).toBe(2);
    expect(report.clampedRgb).toBe(1);
    expect(report.clampedAlpha).toBe(2);
  });

  it('rejects oversized or undersized buffers before processing', () => {
    expect(validateRangeRasterContract({ ...contract, stride: 4 }).valid).toBe(false);
    expect(() => createRangeRaster(contract, new Float32Array(4))).toThrow(RangeRasterError);
  });
});
