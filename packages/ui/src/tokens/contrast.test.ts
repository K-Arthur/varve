import { describe, expect, it } from 'vitest';
import { contrastRatio, passes, relativeLuminance, toHex } from './contrast';

describe('contrast utilities', () => {
  it('black/white is 21:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('same color is 1:1', () => {
    expect(contrastRatio([128, 64, 200], [128, 64, 200])).toBe(1);
  });

  it('luminance of white is 1 and black is 0', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
  });

  it('AA passes for the canonical 4.5:1 boundary', () => {
    expect(passes('AA', [0, 0, 0], [255, 255, 255])).toBe(true);
  });

  it('toHex formats lowercase 6-digit', () => {
    expect(toHex([57, 208, 198])).toBe('#39d0c6');
    expect(toHex([0, 0, 0])).toBe('#000000');
  });
});
