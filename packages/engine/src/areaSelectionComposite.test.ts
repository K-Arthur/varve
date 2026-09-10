import { describe, expect, it } from 'vitest';
import {
  type AreaSelection,
  areaSelectionCoverageAt,
  createAreaSelection,
  maskAreaSelectionFromPlane,
} from './areaSelection';
import { blendAreaSelections } from './areaSelectionComposite';

const rect = (x: number, w: number): AreaSelection =>
  createAreaSelection({ kind: 'rectangle', x, y: 0, w, h: 4, feather: 0, antialias: false })!;

/** Raster selection over a 4x4 frame at the origin; values are per-column. */
const columnPlane = (columns: number[]): AreaSelection => {
  const data = new Uint8Array(16);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      data[y * 4 + x] = columns[x]!;
    }
  }
  return maskAreaSelectionFromPlane({ data, width: 4, height: 4 }, { x: 0, y: 0, w: 4, h: 4 })!;
};

const coverage = (sel: AreaSelection, x: number): number =>
  areaSelectionCoverageAt(sel, { x, y: 0 });

describe('Phase 8 — coverage blends', () => {
  const a = rect(0, 2); // columns 0-1
  const b = rect(1, 2); // columns 1-2

  it('add covers the union and clamps overlap', () => {
    const blended = blendAreaSelections(a, b, 'add')!;
    expect(coverage(blended, 0)).toBe(1);
    expect(coverage(blended, 1)).toBe(1); // clamped, not 200%
    expect(coverage(blended, 2)).toBe(1);
    expect(coverage(blended, 3)).toBe(0);
  });

  it('subtract removes the second plane from the first', () => {
    const blended = blendAreaSelections(a, b, 'subtract')!;
    expect(coverage(blended, 0)).toBe(1);
    expect(coverage(blended, 1)).toBe(0);
    expect(coverage(blended, 2)).toBe(0); // nothing to remove there
  });

  it('multiply keeps only proportional overlap', () => {
    const blended = blendAreaSelections(a, b, 'multiply')!;
    expect(coverage(blended, 0)).toBe(0);
    expect(coverage(blended, 1)).toBe(1);
    expect(coverage(blended, 2)).toBe(0);
  });

  it('min picks the intersection, max the union', () => {
    const min = blendAreaSelections(a, b, 'min')!;
    expect(coverage(min, 1)).toBe(1);
    expect(coverage(min, 0)).toBe(0);
    expect(coverage(min, 2)).toBe(0);
    const max = blendAreaSelections(a, b, 'max')!;
    expect(coverage(max, 0)).toBe(1);
    expect(coverage(max, 1)).toBe(1);
    expect(coverage(max, 2)).toBe(1);
  });

  it('composes soft edges numerically instead of booleanly', () => {
    // Half-covered plane blended with a fully covered rect keeps half coverage.
    const soft = columnPlane([128, 128, 128, 128]);
    const hard = rect(0, 4);
    const multiplied = blendAreaSelections(soft, hard, 'multiply')!;
    expect(areaSelectionCoverageAt(multiplied, { x: 0, y: 0 })).toBeCloseTo(128 / 255, 5);
    const subtracted = blendAreaSelections(hard, soft, 'subtract')!;
    expect(areaSelectionCoverageAt(subtracted, { x: 0, y: 0 })).toBeCloseTo(127 / 255, 5);
  });

  it('blends across a union frame larger than either input', () => {
    const left = rect(0, 1);
    const right = rect(3, 1);
    const blended = blendAreaSelections(left, right, 'max')!;
    expect(coverage(blended, 0)).toBe(1);
    expect(coverage(blended, 1)).toBe(0);
    expect(coverage(blended, 3)).toBe(1);
  });

  it('returns null for degenerate unions', () => {
    const zero = createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 0,
      h: 4,
      feather: 0,
      antialias: false,
    })!;
    expect(blendAreaSelections(zero, zero, 'add')).toBeNull();
  });
});
