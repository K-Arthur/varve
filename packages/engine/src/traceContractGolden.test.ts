/**
 * Trace contract golden: dark-foreground monochrome + compound hole.
 * Native Rust tracer must eventually match this before prefer-native dispatch.
 */

import { describe, expect, it } from 'vitest';
import { traceRasterToPaths } from './rasterTrace';

describe('trace contract golden', () => {
  it('emits evenodd compound rings for a donut without omitting holes', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const dark = x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
        pixels.push(dark ? 0 : 255, dark ? 0 : 255, dark ? 0 : 255, 255);
      }
    }
    const result = traceRasterToPaths(new ImageData(new Uint8ClampedArray(pixels), 5, 5), {
      simplifyTolerance: 0,
      foreground: 'dark',
      threshold: 128,
    });

    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes).toHaveLength(1);
    // Outer starts at top-left-most of the dark ring.
    expect(result.paths[0]?.points[0]).toEqual({ x: 1, y: 1 });
  });
});
