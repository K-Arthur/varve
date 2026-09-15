/**
 * Property-based (fuzz) tests for path fitting and simplification.
 *
 * Tests invariants for Ramer-Douglas-Peucker simplification and
 * Schneider Bezier curve fitting under randomized input.
 *
 * Uses fast-check for randomized property testing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitPathToBeziers, simplifyPoints } from '../fitting';

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** A polyline with 2–30 points (random walk ensures spatial coherence). */
const randomWalk = fc
  .array(
    fc.tuple(
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true }),
    ),
    { minLength: 2, maxLength: 30 },
  )
  .map((steps) => {
    const pts: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    for (const [dx, dy] of steps) {
      const last = pts[pts.length - 1]!;
      pts.push({ x: last.x + dx, y: last.y + dy });
    }
    return pts;
  });

/** Collinear points along a random line with adequate separation. */
const collinearPoints = fc
  .tuple(
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
  )
  .chain(([x0, y0, angle]) => {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return fc
      .array(fc.double({ min: -50, max: 50, noNaN: true }), { minLength: 3, maxLength: 20 })
      .map((ts) => ts.map((t) => ({ x: x0 + t * cosA, y: y0 + t * sinA })));
  })
  .filter((pts) => {
    const dx = pts[pts.length - 1]!.x - pts[0]!.x;
    const dy = pts[pts.length - 1]!.y - pts[0]!.y;
    return dx * dx + dy * dy > 1; // skip degenerate lines
  });

// ── Property 1: RDP endpoint preservation ────────────────────────────────────

describe('simplifyPoints endpoint preservation (property)', () => {
  it('first and last points are always preserved', () => {
    fc.assert(
      fc.property(randomWalk, (pts) => {
        const simplified = simplifyPoints(pts, 1);
        expect(simplified[0]!.x).toBe(pts[0]!.x);
        expect(simplified[0]!.y).toBe(pts[0]!.y);
        expect(simplified[simplified.length - 1]!.x).toBe(pts[pts.length - 1]!.x);
        expect(simplified[simplified.length - 1]!.y).toBe(pts[pts.length - 1]!.y);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: RDP monotonicity ─────────────────────────────────────────────

describe('simplifyPoints monotonicity (property)', () => {
  it('higher epsilon produces fewer or equal points for non-degenerate walks', () => {
    fc.assert(
      fc.property(
        randomWalk.filter((pts) => pts.length >= 2),
        (pts) => {
          const fewer = simplifyPoints(pts, 10);
          const more = simplifyPoints(pts, 0.1);
          expect(fewer.length).toBeLessThanOrEqual(more.length + 1);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 3: Collinear reduction ───────────────────────────────────────────

describe('simplifyPoints collinear reduction (property)', () => {
  it('collinear points preserve endpoints and do not add points', () => {
    fc.assert(
      fc.property(collinearPoints, (pts) => {
        const simplified = simplifyPoints(pts, 1);
        expect(simplified.length).toBeLessThanOrEqual(pts.length);
        expect(simplified.length).toBeGreaterThanOrEqual(2);
        expect(simplified[0]!.x).toBe(pts[0]!.x);
        expect(simplified[0]!.y).toBe(pts[0]!.y);
        expect(simplified[simplified.length - 1]!.x).toBe(pts[pts.length - 1]!.x);
        expect(simplified[simplified.length - 1]!.y).toBe(pts[pts.length - 1]!.y);
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 4: Bezier fitting produces correct-size output ──────────────────

describe('fitPathToBeziers output size (property)', () => {
  it('output has same first/last point as input', () => {
    fc.assert(
      fc.property(randomWalk, (pts) => {
        const fitted = fitPathToBeziers(pts);
        expect(fitted.length).toBeGreaterThanOrEqual(2);
        expect(fitted[0]!.x).toBe(pts[0]!.x);
        expect(fitted[0]!.y).toBe(pts[0]!.y);
        expect(fitted[fitted.length - 1]!.x).toBe(pts[pts.length - 1]!.x);
        expect(fitted[fitted.length - 1]!.y).toBe(pts[pts.length - 1]!.y);
      }),
      { numRuns: 50 },
    );
  });

  it('handleIn and handleOut are either [number,number] or null', () => {
    fc.assert(
      fc.property(randomWalk, (pts) => {
        const fitted = fitPathToBeziers(pts);
        for (const pt of fitted) {
          if (pt.handleIn !== null) {
            expect(Array.isArray(pt.handleIn)).toBe(true);
            expect(pt.handleIn).toHaveLength(2);
            expect(typeof pt.handleIn[0]).toBe('number');
          }
          if (pt.handleOut !== null) {
            expect(Array.isArray(pt.handleOut)).toBe(true);
            expect(pt.handleOut).toHaveLength(2);
            expect(typeof pt.handleOut[0]).toBe('number');
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
