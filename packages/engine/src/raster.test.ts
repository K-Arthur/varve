import { describe, expect, it } from 'vitest';
import { computeOutputDimensions, estimateFileSize } from './raster';

/**
 * raster.ts re-exports computeOutputDimensions/estimateFileSize from ./rasterMath
 * for backward compatibility with existing @strata/engine consumers. Full behavior
 * coverage (including property tests) lives in rasterMath.test.ts /
 * rasterMath.fuzz.test.ts, which test the implementation directly. This file only
 * confirms the re-export surface stays wired up.
 */
describe('raster.ts re-exports rasterMath', () => {
  it('computeOutputDimensions is reachable via ./raster', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 100, h: 50 }, 2);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  it('estimateFileSize is reachable via ./raster', () => {
    expect(estimateFileSize(100, 100, 'png')).toBeGreaterThan(0);
  });
});
