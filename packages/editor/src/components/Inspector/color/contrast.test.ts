import { describe, expect, it } from 'vitest';
import { contrastRatio, formatContrast, relativeLuminance, wcagLevel } from '@strata/ui/components/ColorPicker';

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it('returns ~1 for white', () => {
    const l = relativeLuminance(255, 255, 255);
    expect(l).toBeGreaterThan(0.99);
    expect(l).toBeLessThan(1.01);
  });

  it('handles mid-tone gray', () => {
    const l = relativeLuminance(128, 128, 128);
    expect(l).toBeGreaterThan(0.2);
    expect(l).toBeLessThan(0.25);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 1);
  });

  it('returns 1 for same color', () => {
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio(0.2, 0.8)).toBeCloseTo(contrastRatio(0.8, 0.2), 2);
  });
});

describe('wcagLevel', () => {
  it('returns AAA for 7:1 ratio', () => {
    expect(wcagLevel(7.5, false)).toBe('AAA');
  });

  it('returns AA for 4.5:1 ratio', () => {
    expect(wcagLevel(4.5, false)).toBe('AA');
  });

  it('returns AA for 3:1 large text', () => {
    expect(wcagLevel(3.1, true)).toBe('AA');
  });

  it('returns fail for 2:1 ratio', () => {
    expect(wcagLevel(2, false)).toBe('fail');
  });
});

describe('formatContrast', () => {
  it('formats to one decimal', () => {
    expect(formatContrast(4.56)).toBe('4.6:1');
  });
});
