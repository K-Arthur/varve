/**
 * Canonical source-image-pixel to node-local placement tests.
 *
 * Research basis: Canvas 2D drawImage destination rectangles and reversible
 * affine coordinate mappings used by non-destructive raster mask editors.
 */
import { describe, expect, it } from 'vitest';
import {
  computeImagePlacement,
  type ImagePlacementFit,
  localToSourcePixel,
  sourcePixelToLocal,
} from './imagePlacement';

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
  it.each(['fit', 'fill', 'stretch'] as const)(
    'round-trips visible 4000x3000 pixels in an 800x800 %s fill',
    (fit) => {
      const point = fit === 'fill' ? { x: 2000, y: 1500 } : { x: 733.25, y: 1222.75 };
      expectRoundTrip(fit, { width: 4000, height: 3000 }, point);
    },
  );

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

  it('applies replay offsets and user scale after fit sizing', () => {
    const placement = computeImagePlacement({
      fit: 'fit',
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: { x: 25, y: 40, w: 800, h: 800 },
      x: 12,
      y: -7,
      scale: 2,
    });
    expect(placement?.drawRect).toEqual({ x: -363, y: -167, w: 1600, h: 1200 });
  });

  it('applies user scale after fill sizing', () => {
    const placement = computeImagePlacement({
      fit: 'fill',
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: BOUNDS,
      scale: 0.5,
    });
    expect(placement?.drawRect).toEqual({
      x: 133.33333333333337,
      y: 200,
      w: 533.3333333333333,
      h: 400,
    });
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

describe('localToSourcePixel unclipped crop mapping', () => {
  it('maps fit-mode letterboxing through the canonical placement', () => {
    const placement = computeImagePlacement({
      fit: 'fit',
      sourceWidth: 400,
      sourceHeight: 200,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    expect(placement).not.toBeNull();
    expect(localToSourcePixel(placement!, { x: 50, y: 0 })).toBeNull();
    expect(localToSourcePixel(placement!, { x: 50, y: 0 }, { unclipped: true })).toEqual({
      x: 200,
      y: -100,
    });
  });
});

describe('computeImagePlacement — crop mode', () => {
  const SOURCE = { width: 4000, height: 3000 };
  const BOUNDS = { x: 0, y: 0, w: 800, h: 800 };

  it('renders at natural size × scale, offset by x/y', () => {
    const placement = computeImagePlacement({
      fit: 'crop',
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      bounds: BOUNDS,
      x: -200,
      y: -100,
      scale: 1,
    });
    expect(placement).not.toBeNull();
    // Source image draws at 4000×3000 starting at (-200, -100)
    expect(placement!.drawRect).toEqual({ x: -200, y: -100, w: 4000, h: 3000 });
  });

  it('scales the source image with scale factor', () => {
    const placement = computeImagePlacement({
      fit: 'crop',
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      bounds: BOUNDS,
      x: 0,
      y: 0,
      scale: 0.5,
    });
    expect(placement).not.toBeNull();
    // 4000*0.5 = 2000, 3000*0.5 = 1500
    expect(placement!.drawRect).toEqual({ x: 0, y: 0, w: 2000, h: 1500 });
  });

  it('bounds change does not affect draw size (crop window stable)', () => {
    const opts = {
      fit: 'crop' as ImagePlacementFit,
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      x: -100,
      y: -50,
      scale: 1,
    };
    const smallBounds = { x: 0, y: 0, w: 400, h: 300 };
    const largeBounds = { x: 0, y: 0, w: 1600, h: 1200 };

    const small = computeImagePlacement({ ...opts, bounds: smallBounds });
    const large = computeImagePlacement({ ...opts, bounds: largeBounds });

    // Both have the same draw rect (same crop window)
    expect(small!.drawRect).toEqual(large!.drawRect);
    // But different bounds (clipping changes)
    expect(small!.bounds).toEqual(smallBounds);
    expect(large!.bounds).toEqual(largeBounds);
  });

  it('applies offset relative to bounds origin', () => {
    const placement = computeImagePlacement({
      fit: 'crop',
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      bounds: { x: 100, y: 50, w: 800, h: 800 },
      x: -300,
      y: -200,
      scale: 1,
    });
    expect(placement).not.toBeNull();
    // drawRect.x = bounds.x + offsetX = 100 + (-300) = -200
    // drawRect.y = bounds.y + offsetY = 50 + (-200) = -150
    expect(placement!.drawRect).toEqual({ x: -200, y: -150, w: 4000, h: 3000 });
  });

  it('round-trips visible source pixels local to source', () => {
    const placement = computeImagePlacement({
      fit: 'crop',
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      bounds: BOUNDS,
      x: 0,
      y: 0,
      scale: 0.25,
    });
    expect(placement).not.toBeNull();
    // With scale=0.25: drawRect is w=1000, h=750
    // Source pixel (2000, 1500) maps to local (500, 375)
    const local = sourcePixelToLocal(placement!, { x: 2000, y: 1500 });
    expect(local).not.toBeNull();
    expect(local!.x).toBeCloseTo(500, 5);
    expect(local!.y).toBeCloseTo(375, 5);

    const restored = localToSourcePixel(placement!, local!);
    expect(restored!.x).toBeCloseTo(2000, 5);
    expect(restored!.y).toBeCloseTo(1500, 5);
  });

  it('returns null for invalid inputs', () => {
    expect(
      computeImagePlacement({
        fit: 'crop',
        sourceWidth: 0,
        sourceHeight: 10,
        bounds: BOUNDS,
      }),
    ).toBeNull();
    expect(
      computeImagePlacement({
        fit: 'crop',
        sourceWidth: 10,
        sourceHeight: 0,
        bounds: BOUNDS,
      }),
    ).toBeNull();
  });
});

describe('computeImagePlacement — source crop and content transform', () => {
  it('round-trips cropped source pixels through rotation and flips', () => {
    const placement = computeImagePlacement({
      fit: 'stretch',
      sourceWidth: 400,
      sourceHeight: 200,
      sourceCrop: { x: 100, y: 25, w: 200, h: 100 },
      bounds: { x: 10, y: 20, w: 800, h: 400 },
      rotation: 90,
      flipH: true,
      flipV: true,
    });
    expect(placement).not.toBeNull();

    const source = { x: 150, y: 75 };
    const local = sourcePixelToLocal(placement!, source);
    expect(local).not.toBeNull();
    expect(local?.x).toBeCloseTo(360, 9);
    expect(local?.y).toBeCloseTo(320, 9);
    expect(localToSourcePixel(placement!, local!)).toEqual(source);
  });

  it('rejects points outside the source crop in both directions', () => {
    const placement = computeImagePlacement({
      fit: 'stretch',
      sourceWidth: 400,
      sourceHeight: 200,
      sourceCrop: { x: 100, y: 25, w: 200, h: 100 },
      bounds: { x: 0, y: 0, w: 400, h: 200 },
    });
    expect(sourcePixelToLocal(placement!, { x: 99, y: 50 })).toBeNull();
    expect(localToSourcePixel(placement!, { x: 50, y: 50 })).toBeNull();
  });

  it('exposes the crop sample destination without resizing it to the bounds', () => {
    const placement = computeImagePlacement({
      fit: 'stretch',
      sourceWidth: 400,
      sourceHeight: 200,
      sourceCrop: { x: 100, y: 50, w: 200, h: 100 },
      bounds: { x: 0, y: 0, w: 800, h: 400 },
    });
    expect(placement?.sourceRect).toEqual({ x: 100, y: 50, w: 200, h: 100 });
    expect(placement?.sampleDrawRect).toEqual({ x: 200, y: 100, w: 400, h: 200 });
  });

  it('rejects non-finite crop and transform inputs', () => {
    expect(
      computeImagePlacement({
        fit: 'fill',
        sourceWidth: 100,
        sourceHeight: 100,
        sourceCrop: { x: 0, y: 0, w: Number.NaN, h: 10 },
        bounds: BOUNDS,
      }),
    ).toBeNull();
    expect(
      computeImagePlacement({
        fit: 'fill',
        sourceWidth: 100,
        sourceHeight: 100,
        rotation: Number.POSITIVE_INFINITY,
        bounds: BOUNDS,
      }),
    ).toBeNull();
  });
});
