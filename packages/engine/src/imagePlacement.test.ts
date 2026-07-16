/**
 * Canonical source-image-pixel to node-local placement tests.
 *
 * Research basis: Canvas 2D drawImage destination rectangles and reversible
 * affine coordinate mappings used by non-destructive raster mask editors.
 */
import { describe, expect, it } from 'vitest';
import { computeImagePlacement, localToSourcePixel, sourcePixelToLocal } from './imagePlacement';

const BOUNDS = { x: 0, y: 0, w: 800, h: 800 };

function expectRoundTrip(
  fit: 'fit' | 'fill' | 'stretch',
  source: { width: number; height: number },
  point: { x: number; y: number },
  bounds = BOUNDS,
): void {
  const placement = computeImagePlacement({
    fit,
    sourceWidth: source.width,
    sourceHeight: source.height,
    bounds,
  });
  expect(placement).not.toBeNull();
  if (!placement) return;
  const local = sourcePixelToLocal(placement, point);
  expect(local).not.toBeNull();
  if (!local) return;
  const restored = localToSourcePixel(placement, local);
  expect(restored?.x).toBeCloseTo(point.x, 9);
  expect(restored?.y).toBeCloseTo(point.y, 9);
}

describe('computeImagePlacement', () => {
  it.each([
    'fit',
    'fill',
    'stretch',
  ] as const)('round-trips visible 4000x3000 pixels in an 800x800 %s fill', (fit) => {
    const point = fit === 'fill' ? { x: 2000, y: 1500 } : { x: 733.25, y: 1222.75 };
    expectRoundTrip(fit, { width: 4000, height: 3000 }, point);
  });

  it('preserves panorama and portrait aspect ratios', () => {
    const panorama = computeImagePlacement({
      fit: 'fit',
      sourceWidth: 12000,
      sourceHeight: 500,
      bounds: BOUNDS,
    });
    const portrait = computeImagePlacement({
      fit: 'fill',
      sourceWidth: 500,
      sourceHeight: 12000,
      bounds: BOUNDS,
    });
    expect(panorama?.drawRect).toEqual({
      x: 0,
      y: 383.3333333333333,
      w: 800,
      h: 33.333333333333336,
    });
    expect(portrait?.drawRect).toEqual({ x: 0, y: -9200, w: 800, h: 19200 });
  });

  it('preserves replay offsets and fit scale semantics', () => {
    const placement = computeImagePlacement({
      fit: 'fit',
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: { x: 25, y: 40, w: 800, h: 800 },
      x: 12,
      y: -7,
      scale: 2,
    });
    expect(placement?.drawRect).toEqual({ x: 37, y: 133, w: 800, h: 600 });
  });

  it('includes non-zero bounds origins in both directions', () => {
    expectRoundTrip(
      'stretch',
      { width: 4000, height: 3000 },
      { x: 1234.5, y: 987.25 },
      { x: -350, y: 225, w: 800, h: 800 },
    );
  });

  it('maps tiles deterministically and wraps local coordinates to source pixels', () => {
    const placement = computeImagePlacement({
      fit: 'tile',
      sourceWidth: 100,
      sourceHeight: 50,
      bounds: { x: 10, y: 20, w: 250, h: 140 },
      x: 7,
      y: -3,
      scale: 2,
    });
    expect(placement?.drawRect).toEqual({ x: -183, y: 17, w: 200, h: 100 });
    expect(localToSourcePixel(placement!, { x: 227, y: 127 })).toEqual({ x: 5, y: 5 });
    expect(sourcePixelToLocal(placement!, { x: 5, y: 5 })).toEqual({ x: 27, y: 27 });
  });

  it('returns null consistently for invalid inputs and points outside effective paint', () => {
    expect(
      computeImagePlacement({ fit: 'fill', sourceWidth: 0, sourceHeight: 10, bounds: BOUNDS }),
    ).toBeNull();
    const fit = computeImagePlacement({
      fit: 'fit',
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: BOUNDS,
    });
    expect(localToSourcePixel(fit!, { x: 400, y: 50 })).toBeNull();
    expect(sourcePixelToLocal(fit!, { x: -1, y: 20 })).toBeNull();

    const fill = computeImagePlacement({
      fit: 'fill',
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: BOUNDS,
    });
    // A square cover crop hides 500 source pixels from each horizontal edge.
    expect(sourcePixelToLocal(fill!, { x: 100, y: 1500 })).toBeNull();
  });

  it('rejects finite inputs whose computed destination overflows', () => {
    expect(
      computeImagePlacement({
        fit: 'stretch',
        sourceWidth: 10,
        sourceHeight: 10,
        bounds: { x: Number.MAX_VALUE, y: 0, w: Number.MAX_VALUE, h: 10 },
        x: Number.MAX_VALUE,
      }),
    ).toBeNull();
  });

  it('retains precision for extreme source dimensions', () => {
    const placement = computeImagePlacement({
      fit: 'stretch',
      sourceWidth: 1_000_000_000,
      sourceHeight: 17,
      bounds: { x: 0.125, y: -9000, w: 0.001, h: 12345.678 },
    });
    const source = { x: 987_654_321.125, y: 8.75 };
    const local = sourcePixelToLocal(placement!, source);
    const restored = localToSourcePixel(placement!, local!);
    // The absolute x error stays below one hundred-thousandth of a pixel even
    // after mapping a billion pixels through a 0.001-local-unit destination.
    expect(Math.abs(restored!.x - source.x)).toBeLessThan(0.00001);
    expect(restored!.y).toBeCloseTo(source.y, 9);
  });
});
