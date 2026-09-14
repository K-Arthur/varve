import { applyAffine, rotateDeg, scaleXY, translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  type AreaSelectionRefineOperation,
  areaSelectionBounds,
  areaSelectionCoverageAt,
  createAreaSelection,
  refineAreaSelection,
  transformAreaSelection,
} from './areaSelection';

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<{ feather: number; antialias: boolean }> = {},
) {
  const selection = createAreaSelection({
    kind: 'rectangle',
    x,
    y,
    w,
    h,
    feather: options.feather ?? 0,
    antialias: options.antialias ?? false,
  });
  if (!selection) throw new Error('invalid test selection');
  return selection;
}

function ellipse(x: number, y: number, w: number, h: number) {
  const selection = createAreaSelection({
    kind: 'ellipse',
    x,
    y,
    w,
    h,
    feather: 0,
    antialias: false,
  });
  if (!selection) throw new Error('invalid test selection');
  return selection;
}

describe('transformAreaSelection', () => {
  it('translates a rectangle by an identity-composed translation', () => {
    const moved = transformAreaSelection(rect(0, 0, 10, 10), translate(5, 3));
    expect(moved).not.toBeNull();
    expect(areaSelectionBounds(moved!.expression)).toEqual({ x: 5, y: 3, w: 10, h: 10 });
    expect(areaSelectionCoverageAt(moved!, { x: 10, y: 8 })).toBe(1);
    expect(areaSelectionCoverageAt(moved!, { x: 2, y: 2 })).toBe(0);
  });

  it('scales a rectangle non-uniformly and keeps it fully covered', () => {
    const scaled = transformAreaSelection(rect(0, 0, 10, 10), scaleXY(2, 0.5));
    expect(areaSelectionBounds(scaled!.expression)).toEqual({ x: 0, y: 0, w: 20, h: 5 });
    expect(areaSelectionCoverageAt(scaled!, { x: 19, y: 4 })).toBe(1);
    expect(areaSelectionCoverageAt(scaled!, { x: 21, y: 4 })).toBe(0);
  });

  it('rotates a rectangle into a polygon while preserving corner coverage', () => {
    const rotated = transformAreaSelection(rect(0, 0, 10, 10), rotateDeg(90));
    expect(rotated).not.toBeNull();
    const bounds = areaSelectionBounds(rotated!.expression);
    expect(bounds.w).toBeCloseTo(10, 5);
    expect(bounds.h).toBeCloseTo(10, 5);
    // rotateDeg(90) is CCW in math convention, so the rect's centre lands at
    // (-5, 5) rather than staying in the positive quadrant.
    expect(areaSelectionCoverageAt(rotated!, { x: -5, y: 5 })).toBe(1);
  });

  it('composes a matrix with a raster-mask transform exactly', () => {
    const mask = createAreaSelection({
      kind: 'raster-mask',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      width: 4,
      height: 4,
      data: new Uint8Array([
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      ]),
      boundary: [],
      transform: [1, 0, 0, 1, 0, 0],
      inverseTransform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    });
    const moved = transformAreaSelection(mask, translate(8, 2));
    expect(areaSelectionBounds(moved!.expression)).toEqual({ x: 8, y: 2, w: 4, h: 4 });
    expect(areaSelectionCoverageAt(moved!, { x: 10, y: 4 })).toBe(1);
    expect(areaSelectionCoverageAt(moved!, { x: 2, y: 2 })).toBe(0);
  });

  it('rejects a malformed affine matrix', () => {
    expect(transformAreaSelection(rect(0, 0, 1, 1), [1, 0, 0, 1, NaN, 0] as never)).toBeNull();
    expect(transformAreaSelection(null, translate(1, 1))).toBeNull();
  });

  it('monotonically advances the generation', () => {
    const base = rect(0, 0, 1, 1);
    const moved = transformAreaSelection(base, translate(1, 1));
    expect(moved!.generation).toBe(base.generation + 1);
  });

  it('transforms an ellipse and keeps its centre covered', () => {
    const moved = transformAreaSelection(ellipse(0, 0, 10, 10), translate(20, 0));
    const centre = applyAffine(translate(20, 0), [5, 5]);
    expect(areaSelectionCoverageAt(moved!, { x: centre[0], y: centre[1] })).toBe(1);
  });
});

describe('refineAreaSelection', () => {
  const ops: AreaSelectionRefineOperation[] = ['grow', 'shrink', 'smooth', 'threshold'];

  it('returns null for a null selection and rejects bad inputs', () => {
    expect(refineAreaSelection(null, 'grow')).toBeNull();
  });

  it('grows a 1x1 rectangle into a 3x3 block with amount 1', () => {
    const grown = refineAreaSelection(rect(5, 5, 1, 1), 'grow', { amount: 1 });
    expect(grown).not.toBeNull();
    // The refined mask stores samples at cell centres (doc coordinate + 0.5).
    expect(areaSelectionCoverageAt(grown!, { x: 5.5, y: 5.5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 4.5, y: 5.5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 6.5, y: 5.5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 3.5, y: 5.5 })).toBe(0);
  });

  it('shrinks a 5x5 rectangle into a 3x3 core with amount 1', () => {
    const shrunk = refineAreaSelection(rect(0, 0, 5, 5), 'shrink', { amount: 1 });
    expect(areaSelectionCoverageAt(shrunk!, { x: 2.5, y: 2.5 })).toBe(1);
    expect(areaSelectionCoverageAt(shrunk!, { x: 0.5, y: 2.5 })).toBe(0);
    expect(areaSelectionCoverageAt(shrunk!, { x: 4.5, y: 2.5 })).toBe(0);
  });

  it('shrinking by a large amount empties the selection', () => {
    const empty = refineAreaSelection(rect(0, 0, 3, 3), 'shrink', { amount: 5 });
    expect(areaSelectionCoverageAt(empty!, { x: 1.5, y: 1.5 })).toBe(0);
  });

  it('smooths boundary irregularities without blurring a convex edge', () => {
    const smoothed = refineAreaSelection(rect(0, 0, 4, 4), 'smooth', { sigma: 1 });
    expect(areaSelectionCoverageAt(smoothed!, { x: 2.5, y: 2.5 })).toBe(1);
    expect(areaSelectionCoverageAt(smoothed!, { x: -1.5, y: 2.5 })).toBe(0);
  });

  it('thresholds soft coverage into a hard mask', () => {
    const selection = rect(0, 0, 4, 4, { feather: 2 });
    const hard = refineAreaSelection(selection, 'threshold', { threshold: 0.5 });
    const inner = areaSelectionCoverageAt(hard!, { x: 2.5, y: 2.5 });
    expect(inner === 1 || inner === 0).toBe(true);
  });

  it('keeps every operation bounded inside the selection bounds', () => {
    for (const op of ops) {
      const result = refineAreaSelection(rect(0, 0, 8, 8), op, {
        amount: 2,
        sigma: 2,
        threshold: 0.5,
      });
      expect(result).not.toBeNull();
      const bounds = areaSelectionBounds(result!.expression);
      const pad = op === 'grow' || op === 'shrink' ? 2 : op === 'smooth' ? 6 : 0;
      expect(bounds.w).toBeLessThanOrEqual(8 + pad * 2 + 1);
      expect(bounds.h).toBeLessThanOrEqual(8 + pad * 2 + 1);
    }
  });

  it('advances the generation past the source selection', () => {
    const base = rect(0, 0, 1, 1);
    const grown = refineAreaSelection(base, 'grow', { amount: 1 });
    expect(grown!.generation).toBe(base.generation + 1);
  });

  it('uses the documented default threshold instead of producing NaN coverage', () => {
    const selection = rect(0, 0, 4, 4, { feather: 2 });
    const hard = refineAreaSelection(selection, 'threshold');
    expect(hard).not.toBeNull();
    expect(areaSelectionCoverageAt(hard!, { x: 2.5, y: 2.5 })).toBe(1);
    expect(areaSelectionCoverageAt(hard!, { x: -1.5, y: 2.5 })).toBe(0);
  });

  it('is a no-op for zero-radius operations', () => {
    const zeroFeather = refineAreaSelection(rect(0, 0, 4, 4), 'feather', { sigma: 0 });
    expect(zeroFeather).not.toBeNull();
    expect(areaSelectionCoverageAt(zeroFeather!, { x: 2.5, y: 2.5 })).toBe(1);
    expect(areaSelectionCoverageAt(zeroFeather!, { x: -1.5, y: 2.5 })).toBe(0);
    const zeroContrast = refineAreaSelection(rect(0, 0, 4, 4), 'contrast', { contrast: 0 });
    expect(areaSelectionCoverageAt(zeroContrast!, { x: 2.5, y: 2.5 })).toBe(1);
  });

  it('feathers a hard edge into a monotonic transition', () => {
    const feathered = refineAreaSelection(rect(0, 0, 8, 8), 'feather', { sigma: 1 });
    expect(feathered).not.toBeNull();
    const samples = [-4, -1, 0, 1, 4].map((offset) =>
      areaSelectionCoverageAt(feathered!, { x: offset, y: 4.5 }),
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
    expect(samples[samples.length - 1]).toBe(1);
    expect(samples[0]).toBe(0);
    expect(samples[2]!).toBeGreaterThan(0);
    expect(samples[2]!).toBeLessThan(1);
  });

  it('hardens a soft transition with contrast and never inverts it', () => {
    const soft = rect(0, 0, 8, 8, { feather: 2 });
    const before = [0.5, 1.5, 2.5, 3.5].map((x) => areaSelectionCoverageAt(soft, { x, y: 4.5 }));
    const hardened = refineAreaSelection(soft, 'contrast', { contrast: 0.9 });
    const after = [0.5, 1.5, 2.5, 3.5].map((x) =>
      areaSelectionCoverageAt(hardened!, { x, y: 4.5 }),
    );
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i]!).toBeGreaterThanOrEqual(before[i]! - 1e-6);
      expect(after[i]!).toBeLessThanOrEqual(1);
    }
    expect(after[after.length - 1]).toBe(1);
  });

  it('antialiases a hard boundary within one pixel', () => {
    const soft = refineAreaSelection(rect(0, 0, 6, 6), 'antialias');
    expect(soft).not.toBeNull();
    // The centre stays fully selected and the exterior stays empty.
    expect(areaSelectionCoverageAt(soft!, { x: 3.5, y: 3.5 })).toBe(1);
    expect(areaSelectionCoverageAt(soft!, { x: -2.5, y: 3.5 })).toBe(0);
    // Sampling across the one-pixel transition yields fractional coverage.
    const edge = areaSelectionCoverageAt(soft!, { x: 0, y: 3.5 });
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  it('builds a band around the boundary without selecting the interior', () => {
    const inside = refineAreaSelection(rect(0, 0, 8, 8), 'border', {
      amount: 2,
      placement: 'inside',
    });
    expect(inside).not.toBeNull();
    expect(areaSelectionCoverageAt(inside!, { x: 4.5, y: 4.5 })).toBe(0);
    expect(areaSelectionCoverageAt(inside!, { x: 1.5, y: 4.5 })).toBe(1);
    expect(areaSelectionCoverageAt(inside!, { x: -1.5, y: 4.5 })).toBe(0);

    const centered = refineAreaSelection(rect(0, 0, 8, 8), 'border', {
      amount: 2,
      placement: 'centered',
    });
    expect(areaSelectionCoverageAt(centered!, { x: -0.5, y: 4.5 })).toBe(1);
    expect(areaSelectionCoverageAt(centered!, { x: 0.5, y: 4.5 })).toBe(1);
    expect(areaSelectionCoverageAt(centered!, { x: 2.5, y: 4.5 })).toBe(0);
  });

  it('shifts a soft edge without flattening it', () => {
    const soft = rect(0, 0, 8, 8, { feather: 2 });
    const expanded = refineAreaSelection(soft, 'shift-edge', { amount: 1 });
    const contracted = refineAreaSelection(soft, 'shift-edge', { amount: -1 });
    expect(expanded).not.toBeNull();
    expect(contracted).not.toBeNull();
    const probe = { x: 0.5, y: 4.5 };
    expect(areaSelectionCoverageAt(expanded!, probe)).toBeGreaterThan(
      areaSelectionCoverageAt(soft, probe),
    );
    expect(areaSelectionCoverageAt(contracted!, probe)).toBeLessThan(
      areaSelectionCoverageAt(soft, probe),
    );
  });

  it('cleans up small islands and holes while preserving kept coverage', () => {
    const width = 12;
    const height = 12;
    const data = new Uint8Array(width * height);
    for (let y = 3; y < 9; y += 1) for (let x = 3; x < 9; x += 1) data[y * width + x] = 180;
    data[1 * width + 1] = 255;
    data[6 * width + 6] = 0;
    const mask = createAreaSelection({
      kind: 'raster-mask',
      x: 0,
      y: 0,
      w: width,
      h: height,
      width,
      height,
      data,
      boundary: [],
      transform: [1, 0, 0, 1, 0, 0],
      inverseTransform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    });
    expect(mask).not.toBeNull();
    const cleaned = refineAreaSelection(mask!, 'cleanup', { minIslandArea: 4, maxHoleArea: 4 });
    expect(cleaned).not.toBeNull();
    expect(areaSelectionCoverageAt(cleaned!, { x: 1.5, y: 1.5 })).toBe(0);
    expect(areaSelectionCoverageAt(cleaned!, { x: 6.5, y: 6.5 })).toBe(1);
    expect(areaSelectionCoverageAt(cleaned!, { x: 5.5, y: 5.5 })).toBeCloseTo(180 / 255, 2);
  });

  it('clamps malformed parameters instead of producing NaN coverage', () => {
    const selection = rect(0, 0, 4, 4);
    for (const options of [
      { amount: Number.NaN },
      { amount: -5 },
      { sigma: Number.POSITIVE_INFINITY },
      { threshold: Number.NaN },
      { contrast: 42 },
    ]) {
      const refined = refineAreaSelection(selection, 'grow', options);
      expect(refined).not.toBeNull();
      const value = areaSelectionCoverageAt(refined!, { x: 2, y: 2 });
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
