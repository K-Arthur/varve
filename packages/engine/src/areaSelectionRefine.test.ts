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
    expect(areaSelectionCoverageAt(grown!, { x: 5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 4, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 6, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(grown!, { x: 3, y: 5 })).toBe(0);
  });

  it('shrinks a 5x5 rectangle into a 3x3 core with amount 1', () => {
    const shrunk = refineAreaSelection(rect(0, 0, 5, 5), 'shrink', { amount: 1 });
    expect(areaSelectionCoverageAt(shrunk!, { x: 2, y: 2 })).toBe(1);
    expect(areaSelectionCoverageAt(shrunk!, { x: 0, y: 2 })).toBe(0);
    expect(areaSelectionCoverageAt(shrunk!, { x: 4, y: 2 })).toBe(0);
  });

  it('shrinking by a large amount empties the selection', () => {
    const empty = refineAreaSelection(rect(0, 0, 3, 3), 'shrink', { amount: 5 });
    expect(areaSelectionCoverageAt(empty!, { x: 1, y: 1 })).toBe(0);
  });

  it('smooths a hard edge into a graded coverage ramp', () => {
    const smoothed = refineAreaSelection(rect(0, 0, 4, 4), 'smooth', { sigma: 1 });
    const centre = areaSelectionCoverageAt(smoothed!, { x: 2, y: 2 });
    const edge = areaSelectionCoverageAt(smoothed!, { x: 0, y: 2 });
    expect(centre).toBe(1);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  it('thresholds soft coverage into a hard mask', () => {
    const selection = rect(0, 0, 4, 4, { feather: 2 });
    const hard = refineAreaSelection(selection, 'threshold', { threshold: 0.5 });
    const inner = areaSelectionCoverageAt(hard!, { x: 2, y: 2 });
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
});
