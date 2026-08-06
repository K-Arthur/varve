/**
 * DTCG color bridge tests: conversion matrices, gamut warnings, alpha,
 * 'none' components, unsupported spaces, hex round trip.
 */
import { describe, expect, it } from 'vitest';

import { dtcgColorDeltaE, dtcgColorToVarve, hexToDtcgColor } from '../colorBridge';

describe('dtcgColorToVarve', () => {
  it('converts srgb exactly', () => {
    const result = dtcgColorToVarve({ colorSpace: 'srgb', components: [1, 0, 0] });
    expect(result.hex).toBe('#ff0000');
    expect(result.converted).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('converts srgb with alpha', () => {
    const result = dtcgColorToVarve({ colorSpace: 'srgb', components: [0, 0.4, 0.8], alpha: 0.5 });
    expect(result.hex).toBe('#0066cc');
    expect(result.alpha).toBe(0.5);
  });

  it('defaults alpha to 1', () => {
    const result = dtcgColorToVarve({ colorSpace: 'srgb', components: [0, 0, 0] });
    expect(result.alpha).toBe(1);
  });

  it('converts srgb-linear through the gamma transfer', () => {
    const result = dtcgColorToVarve({ colorSpace: 'srgb-linear', components: [0.5, 0, 0] });
    // linear 0.5 → srgb 187.5 → rounds to 188 (0xbc) per the transfer convention
    expect(result.hex).toBe('#bc0000');
    expect(result.converted).toBe(true);
  });

  it('converts display-p3 with the documented matrix', () => {
    const result = dtcgColorToVarve({ colorSpace: 'display-p3', components: [1, 0, 1] });
    expect(result.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.converted).toBe(true);
  });

  it('converts oklab and lab deterministically', () => {
    const ok = dtcgColorToVarve({ colorSpace: 'oklab', components: [0.701, 0.2746, -0.169] });
    expect(ok.hex).toMatch(/^#[0-9a-f]{6}$/);
    const lab = dtcgColorToVarve({ colorSpace: 'lab', components: [60.17, 93.54, -60.5] });
    expect(lab.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('reports out-of-gamut clamping instead of silently converting', () => {
    const result = dtcgColorToVarve({ colorSpace: 'display-p3', components: [0, 1, 0] });
    expect(result.warnings.some((w) => w.includes('out of sRGB gamut'))).toBe(true);
  });

  it('warns when none components are treated as 0', () => {
    const result = dtcgColorToVarve({
      colorSpace: 'hsl',
      components: ['none', 0, 100],
      hex: '#ffffff',
    });
    expect(result.warnings.some((w) => w.includes('none'))).toBe(true);
  });

  it('refuses silent conversion for unsupported spaces and uses hex fallback', () => {
    const result = dtcgColorToVarve({ colorSpace: 'hwb', components: [330, 0, 0], hex: '#ff00ff' });
    expect(result.hex).toBe('#ff00ff');
    expect(result.warnings.some((w) => w.includes('not convertible'))).toBe(true);

    const cmykLike = dtcgColorToVarve({ colorSpace: 'cmyk', components: [0, 0, 0, 0] });
    expect(cmykLike.warnings.some((w) => w.includes('Unsupported color space'))).toBe(true);
  });

  it('handles hsl, lch, oklch, rec2020, xyz-d50 as explicit-conversion-only', () => {
    for (const space of ['hsl', 'lch', 'oklch', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d50']) {
      const result = dtcgColorToVarve({ colorSpace: space, components: [0, 0, 0], hex: '#000000' });
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('hexToDtcgColor', () => {
  it('round-trips srgb hex', () => {
    const dtcg = hexToDtcgColor('#0066cc');
    expect(dtcg.colorSpace).toBe('srgb');
    expect(dtcg.components[0]).toBeCloseTo(0 / 255, 5);
    expect(dtcg.components[1]).toBeCloseTo(0x66 / 255, 5);
    expect(dtcg.components[2]).toBeCloseTo(0xcc / 255, 5);
    expect(dtcgColorToVarve(dtcg).hex).toBe('#0066cc');
  });

  it('rejects non-hex input', () => {
    expect(() => hexToDtcgColor('red')).toThrow();
    expect(() => hexToDtcgColor('#fff')).toThrow();
  });
});

describe('dtcgColorDeltaE', () => {
  it('is zero for identical colors and positive for different ones', () => {
    const a = { colorSpace: 'srgb', components: [1, 0, 0] };
    const b = { colorSpace: 'srgb', components: [1, 0, 0] };
    const c = { colorSpace: 'srgb', components: [0, 0, 1] };
    expect(dtcgColorDeltaE(a, b)).toBeCloseTo(0, 5);
    expect(dtcgColorDeltaE(a, c)!).toBeGreaterThan(1);
  });
});
