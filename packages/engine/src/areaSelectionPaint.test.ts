import { describe, expect, it } from 'vitest';
import {
  areaSelectionCoverageAt,
  createAreaSelection,
  paintSelectionMask,
  type AreaSelection,
  type MaskBrushStamp,
  type RasterMaskSelectionShape,
} from './areaSelection';

const fullRect = (size: number): AreaSelection =>
  createAreaSelection({
    kind: 'rectangle',
    x: 0,
    y: 0,
    w: size,
    h: size,
    feather: 0,
    antialias: false,
  })!;

const asRaster = (sel: AreaSelection): RasterMaskSelectionShape | null => {
  expect(sel.expression.kind).toBe('shape');
  const shape = sel.expression.kind === 'shape' ? sel.expression.shape : null;
  expect(shape?.kind).toBe('raster-mask');
  return shape?.kind === 'raster-mask' ? shape : null;
};

describe('Phase 4 — Selection Paint / Quick Mask', () => {
  it('bakes a no-op batch into a mask that preserves the selection', () => {
    const painted = paintSelectionMask(fullRect(20), []);
    expect(painted).not.toBeNull();
    expect(asRaster(painted!)).not.toBeNull();
    expect(areaSelectionCoverageAt(painted!, { x: 10, y: 10 })).toBe(1); // interior
    expect(areaSelectionCoverageAt(painted!, { x: 30, y: 10 })).toBe(0); // outside bounds
  });

  it('subtracts a hard dab from the selection interior', () => {
    const subtract: MaskBrushStamp = { x: 10, y: 10, radius: 4, hardness: 1, mode: 'subtract' };
    const painted = paintSelectionMask(fullRect(20), [subtract])!;
    expect(areaSelectionCoverageAt(painted, { x: 10, y: 10 })).toBe(0); // erased centre
    expect(areaSelectionCoverageAt(painted, { x: 2, y: 2 })).toBe(1); // untouched corner
  });

  it('adds a hard dab back over a previously subtracted region', () => {
    const subtract: MaskBrushStamp = { x: 10, y: 10, radius: 4, hardness: 1, mode: 'subtract' };
    const erased = paintSelectionMask(fullRect(20), [subtract])!;
    expect(areaSelectionCoverageAt(erased, { x: 10, y: 10 })).toBe(0);
    const add: MaskBrushStamp = { ...subtract, mode: 'add' };
    const repainted = paintSelectionMask(erased, [add])!;
    expect(areaSelectionCoverageAt(repainted, { x: 10, y: 10 })).toBe(1); // restored
  });

  it('uses a hardness-driven falloff for soft dabs', () => {
    // Dab centre on a pixel centre (doc 9.5) so the sampled pixel is fully erased.
    const soft: MaskBrushStamp = { x: 9.5, y: 9.5, radius: 6, hardness: 0, mode: 'subtract' };
    const painted = paintSelectionMask(fullRect(20), [soft])!;
    expect(areaSelectionCoverageAt(painted, { x: 9, y: 9 })).toBe(0); // centre pixel erased
    const mid = areaSelectionCoverageAt(painted, { x: 12.5, y: 9.5 }); // half-radius out
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(areaSelectionCoverageAt(painted, { x: 16.5, y: 9.5 })).toBe(1); // beyond radius intact
  });

  it('caps the working-plane resolution for very large selections', () => {
    const painted = paintSelectionMask(fullRect(20_000), [])!;
    const raster = asRaster(painted)!;
    // 20_000² exceeds the 16_777_216-pixel budget, so the plane scales to 4096².
    expect(raster.width).toBe(4096);
    expect(raster.width * raster.height).toBeLessThanOrEqual(16_777_216);
  });

  it('returns null for a degenerate (zero-area) selection', () => {
    const zero = createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 0,
      h: 10,
      feather: 0,
      antialias: false,
    });
    expect(paintSelectionMask(zero!, [])).toBeNull();
  });
});
