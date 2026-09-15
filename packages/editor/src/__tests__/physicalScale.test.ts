import { UNIT_TO_PX } from '@varve/shared';
import { describe, expect, it } from 'vitest';

/**
 * Compute pxPerUnit — the number of CSS pixels per document unit at the given DPI.
 * At the baseline 96 DPI, UNIT_TO_PX[unit] gives the correct value.
 * For arbitrary DPI, scale linearly: pxPerUnit = UNIT_TO_PX[unit] * dpi / 96.
 * When dpi <= 0 (screen/undefined), no physical scaling is applied.
 */
function computePxPerUnit(
  documentUnit: 'px' | 'pt' | 'mm' | 'cm' | 'in' | 'pc',
  dpi: number,
): number {
  const effectiveDPI = dpi > 0 ? dpi : 96;
  return (UNIT_TO_PX[documentUnit] * effectiveDPI) / 96;
}

describe('pxPerUnit computation', () => {
  it('returns UNIT_TO_PX value at 96 DPI', () => {
    expect(computePxPerUnit('mm', 96)).toBeCloseTo(96 / 25.4, 6);
    expect(computePxPerUnit('in', 96)).toBe(96);
    expect(computePxPerUnit('pt', 96)).toBeCloseTo(96 / 72, 6);
    expect(computePxPerUnit('cm', 96)).toBeCloseTo(96 / 2.54, 6);
  });

  it('scales linearly with DPI', () => {
    // At 300 DPI, 1mm = 300/25.4 px
    const pxPerUnit300 = computePxPerUnit('mm', 300);
    expect(pxPerUnit300).toBeCloseTo(300 / 25.4, 4);

    // At 600 DPI, 1mm = 600/25.4 px
    const pxPerUnit600 = computePxPerUnit('mm', 600);
    expect(pxPerUnit600).toBeCloseTo(600 / 25.4, 4);

    // Ratio should equal 600/300
    expect(pxPerUnit600 / pxPerUnit300).toBeCloseTo(2, 4);
  });

  it('returns UNIT_TO_PX when dpi is 0 (screen default)', () => {
    expect(computePxPerUnit('mm', 0)).toBeCloseTo(96 / 25.4, 6);
  });

  it('returns UNIT_TO_PX when dpi is negative', () => {
    expect(computePxPerUnit('pt', -1)).toBeCloseTo(96 / 72, 6);
  });

  it('computes correctly for inches', () => {
    // At 300 DPI, 1in = 300px
    expect(computePxPerUnit('in', 300)).toBe(300);
    // At 96 DPI, 1in = 96px
    expect(computePxPerUnit('in', 96)).toBe(96);
  });

  it('computes correctly for cm', () => {
    // At 300 DPI, 1cm = 300/2.54 px
    expect(computePxPerUnit('cm', 300)).toBeCloseTo(300 / 2.54, 4);
  });

  it('computes correctly for px (identity)', () => {
    expect(computePxPerUnit('px', 96)).toBe(1);
    expect(computePxPerUnit('px', 300)).toBe(300 / 96);
  });

  it('computes correctly for pc (picas)', () => {
    // UNIT_TO_PX['pc'] = (96 / 72) * 12 = 16
    // At 300 DPI: 16 * 300 / 96 = 50
    expect(computePxPerUnit('pc', 300)).toBeCloseTo(50, 4);
  });
});
