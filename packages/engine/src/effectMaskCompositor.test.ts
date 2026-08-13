import { describe, expect, it } from 'vitest';
import { compositeMaskedEffectPixels } from './effectMaskCompositor';

const rgba = (values: number[]): { data: Uint8ClampedArray; width: number; height: number } => ({
  data: new Uint8ClampedArray(values),
  width: 2,
  height: 1,
});

describe('compositeMaskedEffectPixels', () => {
  it('cross-fades input and evaluated output only within the effect mask', () => {
    const result = compositeMaskedEffectPixels(
      rgba([255, 0, 0, 255, 255, 0, 0, 255]),
      rgba([0, 0, 255, 255, 0, 0, 255, 255]),
      rgba([255, 255, 255, 255, 255, 0, 0, 0, 0]),
      {
        type: 'alpha',
        coordinateSpace: 'target-local',
        source: { kind: 'raster-asset', assetId: 'm' },
      },
    );
    expect(Array.from(result.data)).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  });

  it('supports density, inversion, and luminance coverage', () => {
    const result = compositeMaskedEffectPixels(
      rgba([0, 0, 0, 255, 0, 0, 0, 255]),
      rgba([255, 255, 255, 255, 255, 255, 255, 255]),
      rgba([255, 255, 255, 255, 0, 0, 0, 255]),
      {
        type: 'luminance',
        coordinateSpace: 'target-local',
        source: { kind: 'raster-asset', assetId: 'm' },
        density: 0.5,
        inverted: true,
      },
    );
    expect(result.data[0]).toBe(128);
    expect(result.data[4]).toBe(255);
  });
});
