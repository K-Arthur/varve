/**
 * Gradient map CPU baseline — LUT generation and per-pixel apply cost across
 * representative raster sizes.
 *
 * Purpose: reproducible regression signal for the non-GPU gradient-map path
 * (Canvas2D/worker/export). Absolute numbers vary by machine; the assertions
 * only guard against order-of-magnitude regressions, and the JSON blob below
 * is the reference record for the docs (`GRADIENT_MAP_BENCH`).
 *
 * Run standalone: npx vitest run packages/engine/src/bench/gradientMap.bench.test.ts
 */
import { describe, expect, it } from 'vitest';
import {
  applyGradientMapFilter,
  buildGradientAlphaLut,
  buildGradientColorLut,
  type GradientMapParams,
} from '../gradientMap';

function grayRamp(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const v = Math.round((x / size) * 255);
      data[offset] = v;
      data[offset + 1] = v;
      data[offset + 2] = v;
      data[offset + 3] = y % 32 === 0 ? 0 : 255; // transparent column every 32px
    }
  }
  return new ImageData(data, size, size);
}

function smoothPhoto(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const hue = (x / size) * 2 * Math.PI;
      const lum = 0.5 + 0.5 * Math.sin(hue + y / size);
      data[offset] = Math.round(200 * lum);
      data[offset + 1] = Math.round(60 * lum);
      data[offset + 2] = Math.round(40 * lum);
      data[offset + 3] = 255;
    }
  }
  return new ImageData(data, size, size);
}

const STOPS = [
  { position: 0, color: [0, 0, 0, 255] as const },
  { position: 0.5, color: [57, 208, 198, 255] as const, midpoint: 0.4 },
  { position: 1, color: [255, 240, 220, 255] as const },
];

function time(fn: () => void, iterations = 3): number {
  let best = Infinity;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function params(overrides: Partial<GradientMapParams> = {}): GradientMapParams {
  return {
    stops: STOPS,
    dither: false,
    preserveLuminosity: false,
    ...overrides,
  };
}

describe('gradient map CPU baseline', () => {
  it('records LUT build cost across sizes and interpolation spaces', () => {
    const timings: Record<string, number> = {};
    for (const size of [256, 1024, 4096] as const) {
      for (const interpolation of ['srgb', 'oklab', 'oklch'] as const) {
        timings[`lut-${size}-${interpolation}`] = time(() =>
          buildGradientColorLut(STOPS, { size, interpolation }),
        );
      }
      timings[`alphaLut-${size}`] = time(() =>
        buildGradientAlphaLut(
          STOPS,
          [
            { position: 0, opacity: 1 },
            { position: 0.5, opacity: 0.3, midpoint: 0.6 },
            { position: 1, opacity: 1 },
          ],
          size,
        ),
      );
    }
    for (const elapsed of Object.values(timings)) expect(elapsed).toBeLessThan(250);
    console.info(`GRADIENT_MAP_BENCH ${JSON.stringify(timings)}`);
  }, 30_000);

  it('records per-pixel apply cost at 512^2, HD, and 4K', () => {
    const timings: Record<string, number> = {};
    const cases: Array<[string, number, Partial<GradientMapParams>]> = [
      ['512-dither', 512, { dither: true, ditherSize: 8 }],
      ['512-nodither', 512, { dither: false }],
      ['hd-dither', 1280, { dither: true, ditherSize: 8 }],
      ['4k-nodither', 2160, { dither: false }],
      ['4k-reverse-intensity', 2160, { dither: false, reverse: true, intensity: 0.6 }],
      ['4k-oklab', 2160, { dither: false, interpolation: 'oklab' }],
      ['4k-perceptual', 2160, { dither: false, luminanceMode: 'perceptual-lightness' }],
    ];
    for (const [label, size, overrides] of cases) {
      const image = smoothPhoto(size);
      timings[label] = time(() => applyGradientMapFilter(image, params(overrides)), 2);
    }
    // Sanity on a fresh single-apply: the dark top-left pixel (r=100) must be
    // remapped by the ramp (never equal to the source gray value).
    const probe = smoothPhoto(64);
    applyGradientMapFilter(probe, params({ dither: false }));
    expect(probe.data[0]).not.toBe(100);
    // A 4K (3840x2160) pass must stay in the low-single-digit seconds on the
    // CPU path (generous order-of-magnitude guard, not a strict gate).
    expect(timings['4k-nodither']).toBeLessThan(2_500);
    expect(timings['hd-dither']).toBeLessThan(2_500);
    console.info(`GRADIENT_MAP_BENCH ${JSON.stringify(timings)}`);
  }, 60_000);

  it('records transparent-edge and alpha-preservation cost (fringe-safe path)', () => {
    const image = grayRamp(1024);
    const timings: Record<string, number> = {};
    timings['alpha-preserve'] = time(() =>
      applyGradientMapFilter(image, params({ preserveSourceAlpha: true })),
    );
    timings['alpha-ramp'] = time(() =>
      applyGradientMapFilter(image, params({ preserveSourceAlpha: false })),
    );
    for (const elapsed of Object.values(timings)) expect(elapsed).toBeLessThan(500);
    console.info(`GRADIENT_MAP_BENCH ${JSON.stringify(timings)}`);
  }, 30_000);
});
