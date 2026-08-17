import { describe, expect, it } from 'vitest';
import {
  applyMidpointBias,
  expandGradientStops,
  type GradientInterpolationSpace,
  type GradientStopInput,
  interpolateManagedColor,
  interpolateNormalizedColor,
  lerpHue,
  sampleGradientColor,
} from './colorInterpolation';

const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
const green = { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 };

describe('interpolateManagedColor', () => {
  it('red→green at t=0.5 in sRGB produces muddy olive (gray-dead-zone case)', () => {
    const mid = interpolateManagedColor(red, green, 0.5, 'srgb');
    expect(mid.r).toBe(128);
    expect(mid.g).toBe(128);
    expect(mid.b).toBe(0);
    // sRGB midpoint has low chroma — classic dead zone
    const chroma = Math.max(mid.r, mid.g, mid.b) - Math.min(mid.r, mid.g, mid.b);
    expect(chroma).toBeLessThan(130);
  });

  it('red→green at t=0.5 in OKLab stays more saturated than sRGB', () => {
    const srgbMid = interpolateManagedColor(red, green, 0.5, 'srgb');
    const oklabMid = interpolateManagedColor(red, green, 0.5, 'oklab');
    const srgbChroma =
      Math.max(srgbMid.r, srgbMid.g, srgbMid.b) - Math.min(srgbMid.r, srgbMid.g, srgbMid.b);
    const oklabChroma =
      Math.max(oklabMid.r, oklabMid.g, oklabMid.b) - Math.min(oklabMid.r, oklabMid.g, oklabMid.b);
    expect(oklabChroma).toBeGreaterThan(srgbChroma);
  });

  it('red→green at t=0.5 in OKLch preserves hue path better than sRGB', () => {
    const oklchMid = interpolateManagedColor(red, green, 0.5, 'oklch');
    // OKLch midpoint should not be near-neutral gray
    expect(oklchMid.r + oklchMid.g).toBeGreaterThan(oklchMid.b + 50);
  });

  it('interpolates alpha with premultiplied blending', () => {
    const a = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 128 };
    const b = { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 };
    const mid = interpolateManagedColor(a, b, 0.5, 'oklab', { premultiplied: true });
    expect(mid.a).toBe(192);
    // Premultiplied: RGB channels weighted by alpha, not simple lerp
    expect(mid.r).toBeLessThan(128);
    expect(mid.b).toBeGreaterThan(128);
  });

  it('returns endpoints unchanged at t=0 and t=1', () => {
    expect(interpolateManagedColor(red, green, 0, 'oklab')).toEqual(red);
    expect(interpolateManagedColor(red, green, 1, 'oklab')).toEqual(green);
  });
});

describe('applyMidpointBias', () => {
  it('returns 0.5 at midpoint when t equals midpoint', () => {
    expect(applyMidpointBias(0.25, 0.25)).toBeCloseTo(0.5, 5);
    expect(applyMidpointBias(0.75, 0.75)).toBeCloseTo(0.5, 5);
  });

  it('returns linear when midpoint is 0.5', () => {
    expect(applyMidpointBias(0, 0.5)).toBe(0);
    expect(applyMidpointBias(1, 0.5)).toBe(1);
    expect(applyMidpointBias(0.25, 0.5)).toBeCloseTo(0.25, 5);
  });
});

describe('sampleGradientColor', () => {
  const stops: GradientStopInput[] = [
    { position: 0, color: red },
    { position: 1, color: green },
  ];

  it('samples endpoints', () => {
    expect(sampleGradientColor(stops, 0, 'srgb').r).toBe(255);
    expect(sampleGradientColor(stops, 1, 'srgb').g).toBe(255);
  });

  it('respects midpoint bias between two stops', () => {
    const biased: GradientStopInput[] = [
      { position: 0, color: red, midpoint: 0.25 },
      { position: 1, color: green },
    ];
    const at25 = sampleGradientColor(biased, 0.25, 'srgb');
    const linear25 = sampleGradientColor(stops, 0.25, 'srgb');
    // At 25% position with midpoint=0.25, blend should be 50% (more green than linear)
    expect(at25.g).toBeGreaterThan(linear25.g);
  });

  it('handles three-stop gradients', () => {
    const three: GradientStopInput[] = [
      { position: 0, color: red },
      { position: 0.5, color: { space: 'rgb', r: 255, g: 255, b: 0, a: 255 } },
      { position: 1, color: green },
    ];
    const mid = sampleGradientColor(three, 0.5, 'oklab');
    expect(mid.r).toBeGreaterThan(200);
    expect(mid.g).toBeGreaterThan(200);
  });

  it('can retain fractional channels for a working-space sample', () => {
    const precise: GradientStopInput[] = [
      { position: 0, color: { space: 'rgb', r: 12.34, g: 40.12, b: 80.34, a: 255 } },
      { position: 1, color: { space: 'rgb', r: 210.12, g: 180.34, b: 120.56, a: 255 } },
    ];
    const display = sampleGradientColor(precise, 0.5, 'srgb');
    const working = sampleGradientColor(precise, 0.5, 'srgb', { precision: 'working' });
    expect(display.r).toBe(111);
    expect(working.r).toBeCloseTo(111.23, 10);
    expect(working.r).not.toBe(display.r);
  });
});

describe('expandGradientStops', () => {
  it('returns at least original stop count', () => {
    const stops: GradientStopInput[] = [
      { position: 0, color: red },
      { position: 1, color: green },
    ];
    const expanded = expandGradientStops(stops, 'oklab', 8);
    expect(expanded.length).toBeGreaterThanOrEqual(2);
    expect(expanded[0]?.position).toBe(0);
    expect(expanded[expanded.length - 1]?.position).toBe(1);
  });

  it('OKLab expansion differs from sRGB expansion at midpoint', () => {
    const stops: GradientStopInput[] = [
      { position: 0, color: red },
      { position: 1, color: green },
    ];
    const srgb = expandGradientStops(stops, 'srgb', 16);
    const oklab = expandGradientStops(stops, 'oklab', 16);
    const srgbMid = srgb.find((s) => Math.abs(s.position - 0.5) < 0.05);
    const oklabMid = oklab.find((s) => Math.abs(s.position - 0.5) < 0.05);
    expect(srgbMid).toBeDefined();
    expect(oklabMid).toBeDefined();
    if (srgbMid && oklabMid) {
      const srgbChroma =
        Math.max(srgbMid.color.r, srgbMid.color.g, srgbMid.color.b) -
        Math.min(srgbMid.color.r, srgbMid.color.g, srgbMid.color.b);
      const oklabChroma =
        Math.max(oklabMid.color.r, oklabMid.color.g, oklabMid.color.b) -
        Math.min(oklabMid.color.r, oklabMid.color.g, oklabMid.color.b);
      expect(oklabChroma).toBeGreaterThan(srgbChroma);
    }
  });

  it('preserves monotonic positions', () => {
    const stops: GradientStopInput[] = [
      { position: 0, color: red },
      { position: 0.3, color: green },
      { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
    ];
    const expanded = expandGradientStops(stops, 'oklab', 4);
    for (let i = 1; i < expanded.length; i++) {
      expect(expanded[i]!.position).toBeGreaterThanOrEqual(expanded[i - 1]!.position);
    }
  });
});

describe('Bug 1: oklch undefined-hue through gray stops', () => {
  const gray = { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 };
  const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
  const blue = { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 };
  const black = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  const white = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 };

  it('gray→red in oklch produces red-ish color (no hue shift through green)', () => {
    const result = interpolateManagedColor(gray, red, 0.5, 'oklch');
    // Red channel should dominate — no blue/green hue shift through gray
    expect(result.r).toBeGreaterThan(150);
    expect(result.g).toBeLessThan(100);
    expect(result.b).toBeLessThan(100);
  });

  it('blue→gray in oklch keeps hue near blue (no hue shift through green/yellow)', () => {
    const result = interpolateManagedColor(blue, gray, 0.5, 'oklch');
    // Blue channel should dominate — no green/yellow hue shift
    expect(result.b).toBeGreaterThan(150);
    expect(result.g).toBeLessThan(result.b);
  });

  it('black→white→red three-stop gradient: achromatic segment preserves neutrality', () => {
    const stops: GradientStopInput[] = [
      { position: 0, color: black },
      { position: 0.5, color: white },
      { position: 1, color: red },
    ];
    // Sample at the midpoint of black→white segment (position 0.25)
    const midBw = sampleGradientColor(stops, 0.25, 'oklch');
    // Should be near-neutral gray (R≈G≈B)
    const maxC = Math.max(midBw.r, midBw.g, midBw.b);
    const minC = Math.min(midBw.r, midBw.g, midBw.b);
    expect(maxC - minC).toBeLessThan(30);
  });
});

describe('Bug 2: stops outside [0,1] unclamped in expandGradientStops', () => {
  it('handles stop at -0.5 by clamping to 0', () => {
    const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
    const green = { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 };
    const stops: GradientStopInput[] = [
      { position: -0.5, color: red },
      { position: 0.5, color: green },
    ];
    const expanded = expandGradientStops(stops, 'oklab', 4);
    for (const s of expanded) {
      expect(s.position).toBeGreaterThanOrEqual(0);
      expect(s.position).toBeLessThanOrEqual(1);
    }
  });

  it('handles stop at 1.5 by clamping to 1', () => {
    const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
    const green = { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 };
    const stops: GradientStopInput[] = [
      { position: 0.2, color: red },
      { position: 1.5, color: green },
    ];
    const expanded = expandGradientStops(stops, 'oklab', 4);
    for (const s of expanded) {
      expect(s.position).toBeGreaterThanOrEqual(0);
      expect(s.position).toBeLessThanOrEqual(1);
    }
  });
});

describe('interpolation space dispatch', () => {
  const spaces: GradientInterpolationSpace[] = ['srgb', 'oklab', 'oklch', 'hsl'];

  for (const space of spaces) {
    it(`${space}: produces valid RGB at t=0.5`, () => {
      const mid = interpolateManagedColor(red, green, 0.5, space);
      expect(mid.r).toBeGreaterThanOrEqual(0);
      expect(mid.r).toBeLessThanOrEqual(255);
      expect(mid.g).toBeGreaterThanOrEqual(0);
      expect(mid.g).toBeLessThanOrEqual(255);
      expect(mid.b).toBeGreaterThanOrEqual(0);
      expect(mid.b).toBeLessThanOrEqual(255);
    });
  }
});

describe('interpolateNormalizedColor', () => {
  const from = { r: 0.5, g: 0.25, b: 0.75, a: 1 };
  const to = { r: 0.125, g: 0.625, b: 0.375, a: 0.5 };
  const spaces: GradientInterpolationSpace[] = ['srgb', 'oklab', 'oklch', 'hsl'];

  it('returns endpoints exactly', () => {
    for (const space of spaces) {
      expect(interpolateNormalizedColor(from, to, 0, space)).toEqual(from);
      expect(interpolateNormalizedColor(from, to, 1, space)).toEqual(to);
    }
  });

  it('produces 0-1 output in every space at t=0.5', () => {
    for (const space of spaces) {
      const mid = interpolateNormalizedColor(from, to, 0.5, space);
      for (const v of [mid.r, mid.g, mid.b, mid.a]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('preserves high precision: no 8-bit lattice in the result', () => {
    // A result on the 8-bit lattice would be a multiple of 1/255.
    const a = { r: 0.500015, g: 0.624817, b: 0.731232, a: 1 };
    const b = { r: 0.25001, g: 0.5, b: 0.75, a: 1 };
    for (const space of spaces) {
      const mid = interpolateNormalizedColor(a, b, 0.5, space);
      const lattice = (v: number) => Math.abs(v * 255 - Math.round(v * 255)) < 1e-9;
      // Alpha is a straight lerp (0.5 exactly in srgb space only for that
      // channel); the RGB channels must not all collapse to 8-bit levels.
      const nonLattice = [mid.r, mid.g, mid.b].some((v) => !lattice(v));
      expect(nonLattice).toBe(true);
    }
  });
});

// ── lerpHue tests ──────────────────────────────────────────────────────────

describe('lerpHue', () => {
  it('shorter: 350°→10° travels through 0° (20° arc)', () => {
    expect(lerpHue(350, 10, 0.5, 'shorter')).toBeCloseTo(0, 1);
    expect(lerpHue(350, 10, 0, 'shorter')).toBeCloseTo(350, 1);
    expect(lerpHue(350, 10, 1, 'shorter')).toBeCloseTo(10, 1);
  });

  it('longer: 350°→10° travels through 180° (340° arc)', () => {
    const mid = lerpHue(350, 10, 0.5, 'longer');
    // Longer arc goes the other way: 350 → 180 → 10
    expect(mid).toBeCloseTo(180, 0);
  });

  it('increasing: 350°→10° goes 350→360/0→10 (positive direction)', () => {
    const mid = lerpHue(350, 10, 0.5, 'increasing');
    expect(mid).toBeCloseTo(0, 1);
  });

  it('decreasing: 350°→10° goes 350→180→10 (negative direction)', () => {
    const mid = lerpHue(350, 10, 0.5, 'decreasing');
    expect(mid).toBeCloseTo(180, 0);
  });

  it('shorter: 10°→350° also takes the short path', () => {
    const mid = lerpHue(10, 350, 0.5, 'shorter');
    expect(mid).toBeCloseTo(0, 1);
  });

  it('returns exact endpoints at t=0 and t=1', () => {
    for (const dir of ['shorter', 'longer', 'increasing', 'decreasing'] as const) {
      expect(lerpHue(30, 200, 0, dir)).toBeCloseTo(30, 10);
      expect(lerpHue(30, 200, 1, dir)).toBeCloseTo(200, 10);
    }
  });

  it('handles identical hues', () => {
    for (const dir of ['shorter', 'longer', 'increasing', 'decreasing'] as const) {
      expect(lerpHue(120, 120, 0.5, dir)).toBeCloseTo(120, 5);
    }
  });

  it('normalises inputs outside [0,360)', () => {
    expect(lerpHue(-10, 370, 0.5, 'shorter')).toBeCloseTo(0, 1);
    expect(lerpHue(720, 10, 0.5, 'shorter')).toBeCloseTo(5, 0);
  });
});

// ── linear-srgb interpolation ──────────────────────────────────────────────

describe('linear-srgb interpolation', () => {
  it('red→green midpoint differs from sRGB midpoint (linear is more saturated)', () => {
    const srgbMid = interpolateManagedColor(red, green, 0.5, 'srgb');
    const linMid = interpolateManagedColor(red, green, 0.5, 'linear-srgb');
    // Linear RGB should produce a brighter, more saturated midpoint
    const srgbLuma = 0.2126 * srgbMid.r + 0.7152 * srgbMid.g + 0.0722 * srgbMid.b;
    const linLuma = 0.2126 * linMid.r + 0.7152 * linMid.g + 0.0722 * linMid.b;
    // Linear midpoint should be brighter than sRGB midpoint
    expect(linLuma).toBeGreaterThan(srgbLuma);
  });

  it('produces valid output in all spaces', () => {
    const spaces: GradientInterpolationSpace[] = ['srgb', 'linear-srgb', 'oklab', 'oklch', 'hsl'];
    for (const space of spaces) {
      const mid = interpolateManagedColor(red, green, 0.5, space);
      expect(mid.r).toBeGreaterThanOrEqual(0);
      expect(mid.r).toBeLessThanOrEqual(255);
      expect(mid.g).toBeGreaterThanOrEqual(0);
      expect(mid.g).toBeLessThanOrEqual(255);
      expect(mid.b).toBeGreaterThanOrEqual(0);
      expect(mid.b).toBeLessThanOrEqual(255);
    }
  });

  it('normalized linear-srgb produces 0-1 output', () => {
    const from = { r: 0.8, g: 0.2, b: 0.4, a: 1 };
    const to = { r: 0.1, g: 0.7, b: 0.9, a: 1 };
    const mid = interpolateNormalizedColor(from, to, 0.5, 'linear-srgb');
    for (const v of [mid.r, mid.g, mid.b, mid.a]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ── Hue interpolation integration with OKLCH ───────────────────────────────

describe('OKLCH hue interpolation direction', () => {
  const blue = { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 };
  const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };

  it('shorter hue: blue→red takes the short path (through purple)', () => {
    const mid = interpolateManagedColor(blue, red, 0.5, 'oklch', {
      hueInterpolation: 'shorter',
    });
    // Should be a purple/magenta-ish color (short path from blue to red)
    expect(mid.b).toBeGreaterThan(50);
    expect(mid.r).toBeGreaterThan(50);
  });

  it('longer hue: blue→red takes the long path (through green/yellow)', () => {
    const mid = interpolateManagedColor(blue, red, 0.5, 'oklch', {
      hueInterpolation: 'longer',
    });
    // Should have significant green component (long path)
    expect(mid.g).toBeGreaterThan(30);
  });
});

// ── Achromatic edge cases ──────────────────────────────────────────────────

describe('achromatic edge cases', () => {
  const black = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  const white = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 };
  const gray = { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 };
  const red = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };

  it('black→white in oklch stays achromatic', () => {
    const mid = interpolateManagedColor(black, white, 0.5, 'oklch');
    const maxDiff = Math.max(mid.r, mid.g, mid.b) - Math.min(mid.r, mid.g, mid.b);
    expect(maxDiff).toBeLessThan(10);
  });

  it('gray→red in oklch falls back to oklab (no NaN)', () => {
    const mid = interpolateManagedColor(gray, red, 0.5, 'oklch');
    expect(Number.isFinite(mid.r)).toBe(true);
    expect(Number.isFinite(mid.g)).toBe(true);
    expect(Number.isFinite(mid.b)).toBe(true);
    expect(mid.r).toBeGreaterThan(100);
  });

  it('black→saturated color in oklch does not produce NaN', () => {
    const mid = interpolateManagedColor(black, red, 0.5, 'oklch');
    expect(Number.isNaN(mid.r)).toBe(false);
    expect(Number.isNaN(mid.g)).toBe(false);
    expect(Number.isNaN(mid.b)).toBe(false);
  });
});

// ── Round-trip consistency ─────────────────────────────────────────────────

describe('round-trip consistency', () => {
  it('sRGB: interpolation at t=0 and t=1 returns exact endpoints', () => {
    const a = { space: 'rgb' as const, r: 42, g: 128, b: 200, a: 255 };
    const b = { space: 'rgb' as const, r: 180, g: 60, b: 90, a: 255 };
    expect(interpolateManagedColor(a, b, 0, 'srgb')).toEqual(a);
    expect(interpolateManagedColor(a, b, 1, 'srgb')).toEqual(b);
    expect(interpolateManagedColor(a, b, 0, 'linear-srgb')).toEqual(a);
    expect(interpolateManagedColor(a, b, 1, 'linear-srgb')).toEqual(b);
    expect(interpolateManagedColor(a, b, 0, 'oklab')).toEqual(a);
    expect(interpolateManagedColor(a, b, 1, 'oklab')).toEqual(b);
  });

  it('oklch: t=0 and t=1 return exact endpoints even with hue wrapping', () => {
    const a = { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 };
    const b = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
    expect(interpolateManagedColor(a, b, 0, 'oklch')).toEqual(a);
    expect(interpolateManagedColor(a, b, 1, 'oklch')).toEqual(b);
  });
});

// ── Boundary values ────────────────────────────────────────────────────────

describe('boundary values', () => {
  it('t < 0 returns from color', () => {
    const result = interpolateManagedColor(red, green, -0.5, 'oklab');
    expect(result).toEqual(red);
  });

  it('t > 1 returns to color', () => {
    const result = interpolateManagedColor(red, green, 1.5, 'oklab');
    expect(result).toEqual(green);
  });
});
