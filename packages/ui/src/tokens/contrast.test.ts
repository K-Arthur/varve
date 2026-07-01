import { describe, expect, it } from 'vitest';
import type { Oklch } from './contrast';
import {
  contrastRatio,
  oklchContrastRatio,
  oklchPasses,
  oklchToCss,
  oklchToRgb,
  passes,
  relativeLuminance,
  rgbToOklch,
  roundOklch,
  toHex,
} from './contrast';

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

describe('OKLCH conversion', () => {
  it('round-trips teal #39d0c6 correctly', () => {
    const original: [number, number, number] = [57, 208, 198];
    const oklch = rgbToOklch(original);
    const back = oklchToRgb(oklch);
    expect(back[0]).toBe(original[0]);
    expect(back[1]).toBe(original[1]);
    expect(back[2]).toBe(original[2]);
  });

  it('round-trips black and white', () => {
    const black: [number, number, number] = [0, 0, 0];
    const white: [number, number, number] = [255, 255, 255];

    const okB = rgbToOklch(black);
    const backB = oklchToRgb(okB);
    expect(backB[0]).toBe(0);
    expect(backB[1]).toBe(0);
    expect(backB[2]).toBe(0);

    const okW = rgbToOklch(white);
    const backW = oklchToRgb(okW);
    expect(backW[0]).toBe(255);
    expect(backW[1]).toBe(255);
    expect(backW[2]).toBe(255);
  });

  it('round-trips a saturated red', () => {
    const red: [number, number, number] = [200, 50, 30];
    const oklch = rgbToOklch(red);
    const back = oklchToRgb(oklch);
    expect(Math.abs(back[0] - red[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(back[1] - red[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(back[2] - red[2])).toBeLessThanOrEqual(1);
  });

  it('oklchToCss produces correct CSS syntax', () => {
    const c: Oklch = { L: 0.779, C: 0.1229, H: 188.31 };
    expect(oklchToCss(c)).toBe('oklch(0.779 0.1229 188.31)');
  });

  it('oklchContrastRatio matches sRGB contrast ratio', () => {
    const black: Oklch = { L: 0, C: 0, H: 0 };
    const white: Oklch = { L: 1, C: 0, H: 0 };
    expect(oklchContrastRatio(black, white)).toBeCloseTo(21, 1);
  });

  it('oklchPasses works for AA grade', () => {
    const black: Oklch = { L: 0, C: 0, H: 0 };
    const white: Oklch = { L: 1, C: 0, H: 0 };
    expect(oklchPasses('AA', black, white)).toBe(true);
  });

  it('roundOklch rounds to expected precision', () => {
    const input: Oklch = { L: 0.1234567, C: 0.0456789, H: 180.12345 };
    const rounded = roundOklch(input);
    expect(rounded.L).toBe(0.1235);
    expect(rounded.C).toBe(0.0457);
    expect(rounded.H).toBe(180.12);
  });
});
