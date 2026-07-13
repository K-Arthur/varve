/**
 * Image enlargement and tracing CPU baseline.
 *
 * Research basis: representative bounded raster sizes provide a reproducible
 * regression signal without relying on machine-specific absolute promises.
 */
import { describe, expect, it } from 'vitest';
import { upscaleImageData } from '../imageEnhancement';
import { traceRasterToPaths } from '../rasterTrace';

function fixture(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const foreground = x > size / 4 && x < (size * 3) / 4 && y > size / 4 && y < (size * 3) / 4;
      const value = foreground ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return new ImageData(data, size, size);
}

describe('image enhancement CPU baseline', () => {
  it('records bounded enlargement and trace latency', () => {
    const timings: Record<string, number> = {};
    for (const method of ['bilinear', 'bicubic', 'lanczos3'] as const) {
      for (const size of [64, 256]) {
        const source = fixture(size);
        const started = performance.now();
        const output = upscaleImageData(source, { scale: 2, method });
        timings[`upscale-${method}-${size}`] = performance.now() - started;
        expect(output.width).toBe(size * 2);
      }
    }

    const traceSource = fixture(512);
    const traceStarted = performance.now();
    const traced = traceRasterToPaths(traceSource, { minArea: 4, simplifyTolerance: 0.75 });
    timings['trace-512'] = performance.now() - traceStarted;
    expect(traced.paths).toHaveLength(1);

    for (const elapsed of Object.values(timings)) expect(elapsed).toBeLessThan(5_000);
    console.info(`IMAGE_ENHANCEMENT_BENCH ${JSON.stringify(timings)}`);
  }, 30_000);
});
