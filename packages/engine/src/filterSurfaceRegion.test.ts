import { describe, expect, it } from 'vitest';
import { computePointwiseFilterSurface } from './filterSurfaceRegion';
import type { FilterIR } from './types';

const exposure: FilterIR = {
  kind: 'exposure',
  value: 1,
  offset: 0,
  gammaCorrection: 1,
  opacity: 1,
  blendMode: 'normal',
};

const blur: FilterIR = {
  kind: 'blur',
  radius: 4,
  opacity: 1,
  blendMode: 'normal',
};

const base = {
  sourceBounds: { x: 10, y: 20, w: 30, h: 40 },
  cameraTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  itemTransform: [1, 0, 0, 1, 0, 0] as const,
  filters: [exposure],
  hasVisibleEffects: false,
  canvasWidth: 200,
  canvasHeight: 150,
};

describe('pointwise filter surface region', () => {
  it('limits a small untransformed item to its painted bounds', () => {
    expect(computePointwiseFilterSurface(base)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('uses transformed bounds and includes stroke coverage', () => {
    expect(
      computePointwiseFilterSurface({
        ...base,
        sourceBounds: { x: 0, y: 0, w: 10, h: 20 },
        cameraTransform: { a: 1, b: 0, c: 0, d: 1, e: 30, f: 40 },
        strokes: [{ weight: 4 }],
      }),
    ).toEqual({ x: 26, y: 36, width: 18, height: 28 });
  });

  it('clips the region to the target canvas', () => {
    expect(
      computePointwiseFilterSurface({
        ...base,
        sourceBounds: { x: -20, y: -10, w: 40, h: 30 },
      }),
    ).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('keeps spatial or effect-bearing items on the full-surface path', () => {
    expect(computePointwiseFilterSurface({ ...base, filters: [blur] })).toBeUndefined();
    expect(computePointwiseFilterSurface({ ...base, hasVisibleEffects: true })).toBeUndefined();
  });

  it('rejects malformed bounds and non-finite transforms', () => {
    expect(
      computePointwiseFilterSurface({ ...base, sourceBounds: { ...base.sourceBounds, w: 0 } }),
    ).toBeUndefined();
    expect(
      computePointwiseFilterSurface({
        ...base,
        cameraTransform: { ...base.cameraTransform, a: Number.NaN },
      }),
    ).toBeUndefined();
  });
});
