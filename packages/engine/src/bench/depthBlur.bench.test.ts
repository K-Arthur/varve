/**
 * Depth Blur CPU baseline — depth-aware gather cost across representative
 * raster sizes.
 *
 * Purpose: reproducible regression signal for the non-GPU depth-blur path
 * (Canvas2D replay, worker, export). Absolute numbers vary by machine; the
 * assertions only guard against order-of-magnitude regressions, and the JSON
 * blob below is the reference record for the docs (`DEPTH_BLUR_BENCH`).
 *
 * Run standalone: npx vitest run packages/engine/src/bench/depthBlur.bench.test.ts
 */
import { describe, expect, it } from 'vitest';
import type { DepthMap } from '../depthMap';
import { applyDepthBlur } from '../lensBlur';

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

/** Smooth depth ramp with a sharp foreground stripe, mimicking a portrait. */
function portraitDepth(size: number): DepthMap {
  return portraitDepthSize(size, size);
}

function portraitDepthSize(width: number, height: number): DepthMap {
  const values = new Float32Array(width * height);
  const valid = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const foreground = x < width * 0.3 ? 0.05 : undefined;
      const background = 0.4 + 0.6 * (x / width);
      values[y * width + x] = foreground ?? background;
    }
  }
  return {
    width,
    height,
    values,
    valid,
    metadata: {
      depthType: 'relative',
      unit: 'normalized',
      nearFarConvention: 'nearIsLow',
      inferenceVersion: 1,
      preprocessingVersion: 1,
    },
  };
}

function smoothPhotoSize(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const hue = (x / width) * 2 * Math.PI;
      const lum = 0.5 + 0.5 * Math.sin(hue + y / height);
      data[offset] = Math.round(200 * lum);
      data[offset + 1] = Math.round(60 * lum);
      data[offset + 2] = Math.round(40 * lum);
      data[offset + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

function time(fn: () => void, iterations = 3): number {
  let best = Infinity;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

const RESULTS: Record<string, { ms: number }> = {};

describe('depth blur CPU baseline', () => {
  it('reports interactive cost at 512x512', () => {
    const size = 512;
    const image = smoothPhoto(size);
    const depth = portraitDepth(size);
    const ms = time(() =>
      applyDepthBlur(image, depth, { blurAmount: 8, focalDepth: 0.5, transitionRange: 0.2 }),
    );
    RESULTS['512x512'] = { ms };
    expect(ms).toBeLessThan(5000);
  });

  it('reports final-render cost at 1080p', () => {
    const width = 1920;
    const height = 1080;
    const image = smoothPhotoSize(width, height);
    const depth = portraitDepthSize(width, height);
    const ms = time(
      () => applyDepthBlur(image, depth, { blurAmount: 8, focalDepth: 0.5, transitionRange: 0.2 }),
      1,
    );
    RESULTS['1920x1080'] = { ms };
    expect(ms).toBeLessThan(60000);
  }, 240000);
});

// Reference record for docs (DEPTH_BLUR_BENCH). Intentional console output:
// the bench suite is executed by the perf harness and reported there.
// eslint-disable-next-line no-console
console.log('DEPTH_BLUR_BENCH', JSON.stringify(RESULTS, null, 2));
