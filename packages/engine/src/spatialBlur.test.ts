import { describe, expect, it } from 'vitest';
import {
  applySpatialBlur,
  normalizeSpatialBlurEffect,
  type SpatialBlurEffect,
  spatialBlurRadiusAt,
  spatialBlurSupport,
} from './spatialBlur';

function image(width = nine(), height = 9): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  data[center] = 255;
  data[center + 3] = 255;
  return new ImageData(data, width, height);
}

function nine(): number {
  return 9;
}

const shared = {
  visible: true,
  algorithmVersion: 1,
  coordinateSpace: 'owner-normalized' as const,
  edgeMode: 'clamp' as const,
};

describe('spatial blur contract', () => {
  it('supports independent Gaussian axes and a zero-axis identity', () => {
    const effect: SpatialBlurEffect = {
      ...shared,
      type: 'gaussianBlur',
      sigmaX: 2,
      sigmaY: 0,
      linkedAxes: false,
    };
    const source = image(17, 17);
    const out = applySpatialBlur(source, effect);
    expect(out.data[8 * 17 * 4 + 8 * 4 + 3]).toBeGreaterThan(0);
    expect([...applySpatialBlur(source, { ...effect, sigmaX: 0 }).data]).toEqual([...source.data]);
  });

  it('is exact at field pins, bounded, and order-independent', () => {
    const effect: SpatialBlurEffect = {
      ...shared,
      type: 'fieldBlur',
      pins: [
        { id: 'sharp', x: 0.25, y: 0.5, radius: 0 },
        { id: 'soft', x: 0.75, y: 0.5, radius: 20 },
      ],
      outsideHull: 'nearest',
      interpolation: 'inverse-distance-v1',
      maxRadius: 20,
    };
    expect(spatialBlurRadiusAt(effect, 2.25, 4.5, 9, 9)).toBe(0);
    expect(spatialBlurRadiusAt(effect, 6.75, 4.5, 9, 9)).toBe(20);
    const middle = spatialBlurRadiusAt(effect, 4.5, 4.5, 9, 9);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThanOrEqual(20);
    const reversed = { ...effect, pins: [...effect.pins].reverse() };
    expect(spatialBlurRadiusAt(reversed, 4.5, 4.5, 9, 9)).toBeCloseTo(middle, 8);
  });

  it('gives iris and tilt-shift a continuous sharp-to-soft transition', () => {
    const iris: SpatialBlurEffect = {
      ...shared,
      type: 'irisBlur',
      regions: [
        {
          id: 'iris',
          center: { x: 0.5, y: 0.5 },
          radii: { x: 0.25, y: 0.25 },
          rotation: 0,
          innerRatio: 0.25,
          feather: 0.5,
          amount: 24,
        },
      ],
    };
    expect(spatialBlurRadiusAt(iris, 4.5, 4.5, 9, 9)).toBe(0);
    expect(spatialBlurRadiusAt(iris, 0, 4.5, 9, 9)).toBeGreaterThan(0);
    expect(spatialBlurSupport(iris)).toBe(24);

    const tilt: SpatialBlurEffect = {
      ...shared,
      type: 'tiltShiftBlur',
      regions: [
        {
          id: 'band',
          center: { x: 0.5, y: 0.5 },
          angle: 0,
          sharpHalfWidth: 1,
          feather: 2,
          amount: 18,
        },
      ],
    };
    expect(spatialBlurRadiusAt(tilt, 4.5, 4.5, 9, 9)).toBe(0);
    expect(spatialBlurRadiusAt(tilt, 4.5, 8, 9, 9)).toBeGreaterThan(0);
  });

  it('uses arc-length motion samples and preserves identity at zero motion', () => {
    const effect: SpatialBlurEffect = {
      ...shared,
      type: 'pathBlur',
      paths: [
        {
          id: 'curve',
          points: [
            { id: 'a', x: 0.2, y: 0.2 },
            { id: 'b', x: 0.5, y: 0.8 },
            { id: 'c', x: 0.9, y: 0.3 },
          ],
        },
      ],
      amount: 0,
      startAmount: 1,
      endAmount: 1,
      centered: true,
      taper: 0,
      strobe: 0,
      samples: 12,
    };
    expect([...applySpatialBlur(image(), effect).data]).toEqual([...image().data]);
    const moving = normalizeSpatialBlurEffect({ ...effect, amount: 1 });
    expect(spatialBlurSupport(moving)).toBe(1);
    expect([...applySpatialBlur(image(), moving).data]).not.toEqual([...image().data]);
  });

  it('keeps spin outside its feathered region unchanged and normalizes bad values', () => {
    const effect: SpatialBlurEffect = {
      ...shared,
      type: 'spinBlur',
      center: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      radii: { x: 0.2, y: 0.2 },
      rotation: 0,
      angle: 0,
      amount: 10,
      feather: 0.2,
      strobe: 0,
      samples: 8,
    };
    expect([...applySpatialBlur(image(), effect).data]).toEqual([...image().data]);
    const normalized = normalizeSpatialBlurEffect({
      ...effect,
      angle: Number.NaN,
      amount: Number.POSITIVE_INFINITY,
      samples: 1000,
    });
    expect(normalized.type).toBe('spinBlur');
    if (normalized.type === 'spinBlur') {
      expect(normalized.amount).toBe(0);
      expect(normalized.samples).toBe(64);
    }
  });
});
