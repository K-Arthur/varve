import { describe, expect, it } from 'vitest';
import {
  type AreaSelection,
  areaSelectionCoverageAt,
  type RasterMaskSelectionShape,
} from './areaSelection';
import {
  areaSelectionFromColorRange,
  areaSelectionFromImageAlpha,
  areaSelectionFromImageLuminance,
  type ImageRgbaSource,
} from './areaSelectionImage';

type Pixel = [number, number, number, number];

const rgbaSource = (width: number, height: number, pixels: Pixel[]): ImageRgbaSource => ({
  data: new Uint8Array(pixels.flat()),
  width,
  height,
});

const asRaster = (sel: AreaSelection): RasterMaskSelectionShape | null => {
  if (sel.expression.kind !== 'shape') return null;
  const shape = sel.expression.shape;
  return shape.kind === 'raster-mask' ? shape : null;
};

const RED: Pixel = [220, 30, 40, 255];
const BLUE: Pixel = [20, 60, 220, 255];

describe('Phase 7.1 — alpha/luminance selections', () => {
  it('maps pixel alpha to proportional coverage', () => {
    const sel = areaSelectionFromImageAlpha(
      rgbaSource(2, 2, [
        [0, 0, 0, 255],
        [0, 0, 0, 128],
        [0, 0, 0, 0],
        [0, 0, 0, 64],
      ]),
    )!;
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(sel, { x: 1, y: 0 })).toBeCloseTo(128 / 255, 5);
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 1 })).toBe(0);
    expect(areaSelectionCoverageAt(sel, { x: 1, y: 1 })).toBeCloseTo(64 / 255, 5);
  });

  it('selects by Rec.709 luma', () => {
    const sel = areaSelectionFromImageLuminance(
      rgbaSource(3, 1, [
        [255, 255, 255, 255],
        [0, 0, 0, 255],
        [128, 128, 128, 255],
      ]),
    )!;
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(sel, { x: 1, y: 0 })).toBe(0);
    expect(areaSelectionCoverageAt(sel, { x: 2, y: 0 })).toBeCloseTo(128 / 255, 5);
  });

  it('binarizes with threshold and supports inversion', () => {
    const src = rgbaSource(2, 1, [
      [0, 0, 0, 200],
      [0, 0, 0, 100],
    ]);
    const hard = areaSelectionFromImageAlpha(src, { threshold: 0.6 })!;
    expect(areaSelectionCoverageAt(hard, { x: 0, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(hard, { x: 1, y: 0 })).toBe(0);
    const inverted = areaSelectionFromImageAlpha(src, { invert: true })!;
    expect(areaSelectionCoverageAt(inverted, { x: 0, y: 0 })).toBeCloseTo(55 / 255, 5);
  });

  it('returns null for malformed sources', () => {
    expect(
      areaSelectionFromImageAlpha({ data: new Uint8Array(3), width: 2, height: 2 }),
    ).toBeNull();
    expect(
      areaSelectionFromImageLuminance({ data: new Uint8Array(4), width: -1, height: 1 }),
    ).toBeNull();
  });
});

describe('Phase 7.2 — colour range selection', () => {
  it('selects every similar pixel globally', () => {
    const sel = areaSelectionFromColorRange(
      rgbaSource(3, 1, [RED, RED, BLUE]),
      { r: 220, g: 30, b: 40 },
      { tolerance: 0.05 },
    )!;
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(sel, { x: 1, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(sel, { x: 2, y: 0 })).toBe(0);
  });

  it('restricts contiguous mode to the region reachable from the seed', () => {
    const src = rgbaSource(3, 1, [RED, BLUE, RED]);
    const target = { r: 220, g: 30, b: 40 };
    const global = areaSelectionFromColorRange(src, target, { tolerance: 0.05 })!;
    expect(areaSelectionCoverageAt(global, { x: 2, y: 0 })).toBe(1); // far blob selected
    const contiguous = areaSelectionFromColorRange(src, target, {
      tolerance: 0.05,
      mode: 'contiguous',
      seed: { x: 0, y: 0 },
    })!;
    expect(areaSelectionCoverageAt(contiguous, { x: 0, y: 0 })).toBe(1); // seed blob kept
    expect(areaSelectionCoverageAt(contiguous, { x: 2, y: 0 })).toBe(0); // far blob excluded
  });

  it('ramps coverage across the feather band', () => {
    const sel = areaSelectionFromColorRange(
      rgbaSource(2, 1, [
        [0, 0, 0, 255],
        [128, 128, 128, 255],
      ]),
      { r: 0, g: 0, b: 0 },
      { tolerance: 0.2, feather: 0.6 },
    )!;
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(1); // exact match
    const mid = areaSelectionCoverageAt(sel, { x: 1, y: 0 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('ignores fully transparent pixels even on exact colour matches', () => {
    const sel = areaSelectionFromColorRange(
      rgbaSource(1, 1, [[220, 30, 40, 0]]),
      { r: 220, g: 30, b: 40 },
      { tolerance: 0.05 },
    )!;
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(0);
  });

  it('validates options and seed', () => {
    const src = rgbaSource(1, 1, [RED]);
    expect(areaSelectionFromColorRange(src, { r: 0, g: 0, b: 0 }, { tolerance: 0 })).toBeNull();
    expect(
      areaSelectionFromColorRange(
        src,
        { r: 0, g: 0, b: 0 },
        { tolerance: 0.1, mode: 'contiguous' },
      ),
    ).toBeNull();
    expect(
      areaSelectionFromColorRange(
        rgbaSource(1, 1, [RED]),
        { r: 220, g: 30, b: 40 },
        { tolerance: 0.05, mode: 'contiguous', seed: { x: 99, y: 99 } },
      )!,
    );
  });

  it('caps the working plane while keeping the full document frame', () => {
    const pixels: Pixel[] = new Array(16).fill([255, 255, 255, 255]);
    const sel = areaSelectionFromImageAlpha(
      { data: new Uint8Array(pixels.flat()), width: 4, height: 4 },
      { resolution: 2 },
    )!;
    const raster = asRaster(sel)!;
    expect(raster.width).toBe(2);
    expect(areaSelectionCoverageAt(sel, { x: 0, y: 0 })).toBe(1);
    expect(areaSelectionCoverageAt(sel, { x: 3, y: 3 })).toBe(1); // far corner inside frame
  });
});
