/**
 * Property-based (fuzz) tests for cubic Bezier math.
 *
 * Tests invariants that must hold for ALL valid input configurations,
 * including edge cases like zero-length handles, near-coincident anchors,
 * and extreme handle lengths.
 *
 * Uses fast-check for randomized property testing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cubicBezierPoint, cubicBezierSplit } from '../bezier';

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Finite doubles in a practical coordinate range (no overflow, no subnormals). */
const practicalFloat = fc
  .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
  .filter((v) => v === 0 || Math.abs(v) >= 1e-200);

const point = fc.record({
  x: practicalFloat,
  y: practicalFloat,
});

const cubicBezier = fc.record({
  p0: point,
  p1: point,
  p2: point,
  p3: point,
});

// ── Property 1: Endpoint interpolation ───────────────────────────────────────

describe('cubicBezierPoint endpoints (property)', () => {
  it('B(0) equals p0 within IEEE 754 precision for any finite control points', () => {
    fc.assert(
      fc.property(cubicBezier, (cb) => {
        const b0 = cubicBezierPoint(cb, 0);
        expect(Math.abs(b0.x - cb.p0.x)).toBeLessThan(1e-6);
        expect(Math.abs(b0.y - cb.p0.y)).toBeLessThan(1e-6);
      }),
      { numRuns: 200 },
    );
  });

  it('B(1) equals p3 within IEEE 754 precision for any finite control points', () => {
    fc.assert(
      fc.property(cubicBezier, (cb) => {
        const b1 = cubicBezierPoint(cb, 1);
        expect(Math.abs(b1.x - cb.p3.x)).toBeLessThan(1e-6);
        expect(Math.abs(b1.y - cb.p3.y)).toBeLessThan(1e-6);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 2: Split concatenation ──────────────────────────────────────────

describe('cubicBezierSplit continuity (property)', () => {
  it('split point matches from both halves', () => {
    fc.assert(
      fc.property(
        cubicBezier,
        fc.double({ min: 0.05, max: 0.95, noNaN: true, noDefaultInfinity: true }),
        (cb, t) => {
          const [left, right] = cubicBezierSplit(cb, t);
          const leftEnd = cubicBezierPoint(left, 1);
          const rightStart = cubicBezierPoint(right, 0);
          expect(Math.abs(leftEnd.x - rightStart.x)).toBeLessThan(1e-6);
          expect(Math.abs(leftEnd.y - rightStart.y)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: NaN/Infinity stability ───────────────────────────────────────

describe('degenerate bezier stability (property)', () => {
  it('cubicBezierPoint never returns NaN for finite inputs', () => {
    fc.assert(
      fc.property(
        cubicBezier,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (cb, t) => {
          const pt = cubicBezierPoint(cb, t);
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('cubicBezierSplit never returns NaN for finite inputs', () => {
    fc.assert(
      fc.property(
        cubicBezier,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (cb, t) => {
          const [left, right] = cubicBezierSplit(cb, t);
          for (const p of [
            left.p0,
            left.p1,
            left.p2,
            left.p3,
            right.p0,
            right.p1,
            right.p2,
            right.p3,
          ]) {
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
