import { describe, expect, it } from 'vitest';
import {
  applyMidpointBias,
  expandGradientStops,
  type GradientInterpolationSpace,
  type GradientStopInput,
  interpolateManagedColor,
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
