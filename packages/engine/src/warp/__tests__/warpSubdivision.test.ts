/**
 * Adaptive-subdivision behaviour: straight segments must follow a nonlinear
 * map, linear maps must not pay for subdivision they do not need, and the
 * quality profile must actually control the tolerance.
 */

import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { resolveWarpTolerance, warpShapeToPath } from '../geometry';
import { DEFAULT_WARP_QUALITY, WARP_QUALITY_TOLERANCE, type WarpModifier } from '../types';

const BOUNDS = { x: 0, y: 0, w: 200, h: 200 };
const rect = (): Shape => ({ kind: 'rect', x: 0, y: 0, w: 200, h: 200 });

const bend = (amount = 0.6): WarpModifier => ({
  id: 'b',
  kind: 'bend',
  mode: 'arc',
  amount,
  axis: 'horizontal',
  origin: 0.5,
});

const skew = (skewX = 30): WarpModifier => ({
  id: 's',
  kind: 'skew',
  skewX,
  skewY: 0,
  origin: { x: 0.5, y: 0.5 },
});

const perspective = (): WarpModifier => ({
  id: 'p',
  kind: 'perspective',
  corners: {
    tl: { x: 0.2, y: 0 },
    tr: { x: 0.8, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 },
  },
});

function pointCount(shape: Shape): number {
  return shape.kind === 'path' ? shape.points.length : 0;
}

describe('resolveWarpTolerance', () => {
  it('derives the tolerance from the profile when none is set explicitly', () => {
    // DEFAULT_WARP_QUALITY deliberately has no `tolerance` field; reading it
    // directly yields undefined, and `x <= undefined` is always false.
    expect(DEFAULT_WARP_QUALITY.tolerance).toBeUndefined();
    expect(resolveWarpTolerance(DEFAULT_WARP_QUALITY)).toBe(WARP_QUALITY_TOLERANCE.interactive);
    expect(resolveWarpTolerance({ profile: 'export' })).toBe(WARP_QUALITY_TOLERANCE.export);
    expect(resolveWarpTolerance({ profile: 'draft' })).toBe(WARP_QUALITY_TOLERANCE.draft);
  });

  it('honours an explicit finite positive tolerance', () => {
    expect(resolveWarpTolerance({ profile: 'export', tolerance: 0.02 })).toBe(0.02);
  });

  it('falls back to the profile for a non-finite or non-positive tolerance', () => {
    expect(resolveWarpTolerance({ profile: 'high', tolerance: 0 })).toBe(
      WARP_QUALITY_TOLERANCE.high,
    );
    expect(resolveWarpTolerance({ profile: 'high', tolerance: Number.NaN })).toBe(
      WARP_QUALITY_TOLERANCE.high,
    );
    expect(resolveWarpTolerance(undefined)).toBe(WARP_QUALITY_TOLERANCE.interactive);
  });
});

describe('straight-segment subdivision', () => {
  it('subdivides a rect edge that a nonlinear bend curves', () => {
    const { shape } = warpShapeToPath(rect(), [bend()], BOUNDS, { quality: { profile: 'high' } });
    // Four corners alone (plus the closing point) could never represent an arc.
    expect(pointCount(shape)).toBeGreaterThan(20);
  });

  it('leaves an affine skew as a 4-corner parallelogram', () => {
    // Affine maps preserve straight lines, so no interior points are needed.
    const { shape } = warpShapeToPath(rect(), [skew()], BOUNDS, { quality: { profile: 'export' } });
    expect(pointCount(shape)).toBeLessThanOrEqual(5);
  });

  it('leaves a projective perspective as a 4-corner quad', () => {
    // Homographies also map lines to lines.
    const { shape } = warpShapeToPath(rect(), [perspective()], BOUNDS, {
      quality: { profile: 'export' },
    });
    expect(pointCount(shape)).toBeLessThanOrEqual(5);
  });

  it('spends more points at a tighter tolerance', () => {
    const draft = warpShapeToPath(rect(), [bend()], BOUNDS, { quality: { profile: 'draft' } });
    const exact = warpShapeToPath(rect(), [bend()], BOUNDS, { quality: { profile: 'export' } });
    expect(pointCount(exact.shape)).toBeGreaterThan(pointCount(draft.shape));
  });

  it('stays within the generated-point budget and reports capping', () => {
    // Small enough that an export-tolerance arc cannot possibly fit, so the
    // budget is the binding constraint rather than the tolerance.
    const budget = 12;
    const budgeted = warpShapeToPath(rect(), [bend(1)], BOUNDS, {
      quality: { profile: 'export', maxGeneratedPoints: budget },
    });
    expect(pointCount(budgeted.shape)).toBeLessThanOrEqual(budget);
    expect(budgeted.capped).toBe(true);
  });

  it('does not report capping when the budget is ample', () => {
    const ample = warpShapeToPath(rect(), [bend(1)], BOUNDS, {
      quality: { profile: 'export', maxGeneratedPoints: 50000 },
    });
    expect(ample.capped).toBe(false);
  });

  it('never emits non-finite coordinates from a straight segment', () => {
    const { shape } = warpShapeToPath(rect(), [bend(1)], BOUNDS, {
      quality: { profile: 'export' },
    });
    if (shape.kind === 'path') {
      for (const p of shape.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});
