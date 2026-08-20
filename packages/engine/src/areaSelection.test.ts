import { describe, expect, it } from 'vitest';
import {
  areaSelectionCoverageAt,
  combineAreaSelections,
  createAreaSelection,
  invertAreaSelection,
  rasterizeAreaSelection,
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

describe('analytical area selection', () => {
  it('rasterizes an exact 1x1 rectangle using pixel-center coverage', () => {
    const result = rasterizeAreaSelection(rect(0, 0, 1, 1), {
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    });
    expect([...result.data]).toEqual([255, 0, 0, 0]);
  });

  it('keeps ellipse coverage analytical and anti-aliases its boundary deterministically', () => {
    const selection = createAreaSelection({
      kind: 'ellipse',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      feather: 0,
      antialias: true,
    });
    expect(selection).not.toBeNull();
    const result = rasterizeAreaSelection(selection!, {
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      samples: 4,
    });
    expect(result.data[5]).toBe(255);
    expect(result.data[0]).toBeGreaterThanOrEqual(0);
    expect(result.data[0]).toBeLessThan(255);
  });

  it('preserves soft feather coverage rather than expanding a rectangle', () => {
    const selection = rect(1, 1, 2, 2, { feather: 1 });
    expect(areaSelectionCoverageAt(selection, { x: 2, y: 2 })).toBe(1);
    expect(areaSelectionCoverageAt(selection, { x: 1, y: 2 })).toBe(0.5);
    expect(areaSelectionCoverageAt(selection, { x: 0, y: 2 })).toBe(0);
  });

  it('implements union, subtraction, and intersection as coverage algebra', () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(1, 0, 2, 2);
    const union = combineAreaSelections(a, b, 'add');
    const subtract = combineAreaSelections(a, b, 'subtract');
    const intersect = combineAreaSelections(a, b, 'intersect');
    expect(union && areaSelectionCoverageAt(union, { x: 2.5, y: 1 })).toBe(1);
    expect(subtract && areaSelectionCoverageAt(subtract, { x: 1.5, y: 1 })).toBe(0);
    expect(intersect && areaSelectionCoverageAt(intersect, { x: 1.5, y: 1 })).toBe(1);
    expect(subtract && areaSelectionCoverageAt(subtract, { x: 0.5, y: 1 })).toBe(1);
  });

  it('does not create an unbounded inverse when no finite selection exists', () => {
    const incoming = rect(0, 0, 1, 1);
    expect(combineAreaSelections(null, incoming, 'subtract')).toBeNull();
    expect(combineAreaSelections(null, incoming, 'intersect')).toBeNull();
  });

  it('inverts only inside an explicit finite domain', () => {
    const selection = rect(1, 1, 2, 2);
    const domain = rect(0, 0, 4, 4);
    const inverted = invertAreaSelection(selection, domain);
    expect(areaSelectionCoverageAt(inverted, { x: 0.5, y: 0.5 })).toBe(1);
    expect(areaSelectionCoverageAt(inverted, { x: 1.5, y: 1.5 })).toBe(0);
    expect(areaSelectionCoverageAt(inverted, { x: 4.5, y: 4.5 })).toBe(0);
  });

  it('rejects corrupt and non-integral raster bounds', () => {
    const selection = rect(0, 0, 2, 2);
    expect(() => rasterizeAreaSelection(selection, { x: 0, y: 0, width: 1.5, height: 2 })).toThrow(
      'Rasterization bounds',
    );
  });
});
