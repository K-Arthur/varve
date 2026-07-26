/**
 * Property-based (fuzz) tests for the pure raster size math in rasterMath.ts.
 *
 * Uses fast-check for randomized property testing, following the pattern in
 * __tests__/bezier.fuzz.test.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeOutputDimensions, estimateFileSize, type RasterFormat } from './rasterMath';

const nonNegativeDimension = fc.double({ min: 0, max: 1e5, noNaN: true, noDefaultInfinity: true });
const nonNegativeScale = fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true });
const bounds = fc.record({
  x: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
  w: nonNegativeDimension,
  h: nonNegativeDimension,
});
const rasterFormat: fc.Arbitrary<RasterFormat> = fc.constantFrom('png', 'jpeg', 'webp', 'avif');
const quality = fc.double({ min: 1, max: 100, noNaN: true, noDefaultInfinity: true });

describe('computeOutputDimensions (property)', () => {
  it('never produces negative dimensions for non-negative bounds and scale', () => {
    fc.assert(
      fc.property(bounds, nonNegativeScale, (b, scale) => {
        const { width, height } = computeOutputDimensions(b, scale);
        expect(width).toBeGreaterThanOrEqual(0);
        expect(height).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it('always rounds to an integer', () => {
    fc.assert(
      fc.property(bounds, nonNegativeScale, (b, scale) => {
        const { width, height } = computeOutputDimensions(b, scale);
        expect(Number.isInteger(width)).toBe(true);
        expect(Number.isInteger(height)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('preserves aspect ratio within rounding error', () => {
    fc.assert(
      fc.property(
        bounds.filter((b) => b.w >= 1 && b.h >= 1),
        fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
        (b, scale) => {
          const { width, height } = computeOutputDimensions(b, scale);
          const expectedRatio = b.w / b.h;
          const actualRatio = width / Math.max(height, 1);
          // Rounding error dominates at small output sizes; tolerance scales inversely
          // with the smaller output dimension.
          const smallerDim = Math.min(width, height, 1);
          const tolerance = Math.max(0.05, 2 / smallerDim);
          expect(Math.abs(actualRatio - expectedRatio)).toBeLessThanOrEqual(
            expectedRatio * tolerance + tolerance,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('stays finite at extreme scale factors', () => {
    fc.assert(
      fc.property(
        bounds,
        fc.double({ min: 1e4, max: 1e8, noNaN: true, noDefaultInfinity: true }),
        (b, scale) => {
          const { width, height } = computeOutputDimensions(b, scale);
          expect(Number.isFinite(width)).toBe(true);
          expect(Number.isFinite(height)).toBe(true);
          expect(width).toBeGreaterThanOrEqual(0);
          expect(height).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('zero-size bounds scale to zero regardless of scale factor', () => {
    fc.assert(
      fc.property(nonNegativeScale, (scale) => {
        const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 0, h: 0 }, scale);
        expect(width).toBe(0);
        expect(height).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('one-pixel bounds at 1x scale stay one pixel', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 1, h: 1 }, 1);
    expect(width).toBe(1);
    expect(height).toBe(1);
  });

  it('identity at scale=1 matches rounded input dimensions', () => {
    fc.assert(
      fc.property(bounds, (b) => {
        const { width, height } = computeOutputDimensions(b, 1);
        expect(width).toBe(Math.round(b.w));
        expect(height).toBe(Math.round(b.h));
      }),
      { numRuns: 300 },
    );
  });
});

describe('estimateFileSize (property)', () => {
  it('never produces a negative estimate for non-negative dimensions', () => {
    fc.assert(
      fc.property(
        nonNegativeDimension,
        nonNegativeDimension,
        rasterFormat,
        quality,
        (w, h, f, q) => {
          expect(estimateFileSize(w, h, f, q)).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('always rounds to an integer', () => {
    fc.assert(
      fc.property(
        nonNegativeDimension,
        nonNegativeDimension,
        rasterFormat,
        quality,
        (w, h, f, q) => {
          expect(Number.isInteger(estimateFileSize(w, h, f, q))).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('zero-pixel images always estimate to zero bytes', () => {
    fc.assert(
      fc.property(rasterFormat, quality, (f, q) => {
        expect(estimateFileSize(0, 0, f, q)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('is monotonically non-decreasing in pixel area for a fixed format/quality', () => {
    fc.assert(
      fc.property(
        nonNegativeDimension,
        nonNegativeDimension,
        fc.double({ min: 1, max: 8, noNaN: true, noDefaultInfinity: true }),
        rasterFormat,
        quality,
        (w, h, growth, f, q) => {
          const base = estimateFileSize(w, h, f, q);
          const grown = estimateFileSize(w * growth, h * growth, f, q);
          expect(grown).toBeGreaterThanOrEqual(base);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('clamps out-of-range quality without throwing, and stays within the [1,100] result', () => {
    fc.assert(
      fc.property(
        nonNegativeDimension,
        nonNegativeDimension,
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (w, h, q) => {
          const clamped = estimateFileSize(w, h, 'jpeg', Math.max(1, Math.min(100, q)));
          const raw = estimateFileSize(w, h, 'jpeg', q);
          expect(raw).toBe(clamped);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('at extreme (but finite) dimensions, stays finite and non-negative', () => {
    const huge = fc.double({ min: 1e4, max: 1e6, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(huge, huge, rasterFormat, quality, (w, h, f, q) => {
        const size = estimateFileSize(w, h, f, q);
        expect(Number.isFinite(size)).toBe(true);
        expect(size).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});
