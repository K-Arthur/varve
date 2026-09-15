/**
 * Palette extraction CPU baseline.
 *
 * Mirrors the real editor path: the Inspector decodes a bounded 256x256
 * preview and hands it to analyzePalette. The larger direct sources below
 * exercise the engine's bounded sampling guarantee for callers that pass
 * full-resolution pixels (e.g. future batch/region analysis).
 *
 * Run: pnpm bench:palette  (or via the normal unit suite as .bench.test.ts)
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzePalette } from '../intelligence/paletteExtractor';
import { summarize, warmUp } from './benchUtils';

function syntheticPhoto(width: number, height: number, seed = 7): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0;
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const sky = y < height / 2;
      const t = sky ? y / (height / 2) : 1 - (y - height / 2) / (height / 2);
      const noise = (random() - 0.5) * 34;
      if (sky) {
        data[offset] = 40 + t * 90 + noise;
        data[offset + 1] = 80 + t * 120 + noise;
        data[offset + 2] = 180 + t * 60 + noise;
      } else {
        data[offset] = 60 + t * 130 + noise;
        data[offset + 1] = 45 + t * 90 + noise;
        data[offset + 2] = 28 + t * 40 + noise;
      }
      data[offset + 3] = 255;
    }
  }
  return data;
}

function whiteWithAccent(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(250, 0, width * height * 4 - 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset + 3] = 255;
      const accent = x > width * 0.82 && x < width * 0.92 && y > height * 0.08 && y < height * 0.3;
      if (accent) {
        data[offset] = 255;
        data[offset + 1] = 90;
        data[offset + 2] = 10;
      }
    }
  }
  return data;
}

function benchAnalysis(
  label: string,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  iterations = 8,
): { p50: number; p95: number; totalMs: number } {
  const source = { width, height, data: pixels };
  warmUp(() => analyzePalette(source), 2);
  const samples: number[] = [];
  let lastTotalMs = 0;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    const result = analyzePalette(source);
    lastTotalMs = result.timings.totalMs;
    samples.push(performance.now() - started);
  }
  const summary = summarize(samples);
  console.log(
    `PALETTE_BENCH ${label} ${width}x${height} p50=${summary.p50.toFixed(2)}ms p95=${summary.p95.toFixed(2)}ms engine-total=${lastTotalMs.toFixed(2)}ms n=${summary.count}`,
  );
  return { p50: summary.p50, p95: summary.p95, totalMs: lastTotalMs };
}

describe('palette extraction CPU baseline', () => {
  // Thresholds are deliberately generous: they must never flake on a loaded
  // shared dev machine, but they do catch algorithmic regressions (idle
  // machines run the 256px preview in well under 100ms; a 10x+ blowup from a
  // sampling or clustering change trips these bounds).
  it('analyses the bounded 256px editor preview quickly', () => {
    const { p95, totalMs } = benchAnalysis('preview-256', 256, 256, syntheticPhoto(256, 256));
    expect(totalMs).toBeLessThan(2_000);
    expect(p95).toBeLessThan(4_000);
  }, 30_000);

  it('stays bounded on a direct 1080p noisy photograph source', () => {
    const { p95, totalMs } = benchAnalysis('photo-1080p', 1920, 1080, syntheticPhoto(1920, 1080));
    expect(totalMs).toBeLessThan(2_000);
    expect(p95).toBeLessThan(4_000);
  }, 60_000);

  it('keeps the tiny saturated accent when sampling a huge white source', () => {
    const width = 3840;
    const height = 2160;
    const pixels = whiteWithAccent(width, height);
    const { p95, totalMs } = benchAnalysis('white-accent-4k', width, height, pixels);
    const result = analyzePalette({ width, height, data: pixels });
    const hasAccent = result.extracted.some(
      (swatch) => swatch.color.space === 'rgb' && swatch.color.r > 220 && swatch.color.g < 120,
    );
    expect(hasAccent).toBe(true);
    expect(totalMs).toBeLessThan(2_000);
    expect(p95).toBeLessThan(4_000);
  }, 60_000);
});
