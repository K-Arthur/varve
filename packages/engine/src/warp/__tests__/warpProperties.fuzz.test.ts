/**
 * Property-based tests for the warp evaluator (fast-check).
 *
 * Properties verified:
 *  - no non-finite output for any finite input
 *  - determinism (same input → same output)
 *  - serialization round-trip preserves controls
 *  - evaluated bounds contain all generated geometry
 *  - bounded output complexity (point budget respected)
 *  - identity perspective cage is an exact identity map
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildWarpEvaluation, warpBoundsOfPoints, warpShapeToPath } from '../geometry';
import type { WarpModifier } from '../types';
import { validateWarpModifiers } from '../types';

const finite = fc.double({ min: -1000, max: 1000, noNaN: true });
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const p = (lo = -2, hi = 3) =>
  fc.record({
    x: fc.double({ min: lo, max: hi, noNaN: true }),
    y: fc.double({ min: lo, max: hi, noNaN: true }),
  });

type PathArb = {
  kind: 'path';
  points: Array<{
    x: number;
    y: number;
    handleIn: [number, number] | null;
    handleOut: [number, number] | null;
  }>;
  closed: boolean;
  tolerance: number;
};

const pathShapeArb: fc.Arbitrary<PathArb> = fc.record({
  kind: fc.constant('path' as const),
  points: fc.array(
    fc.record({
      x: finite,
      y: finite,
      handleIn: fc.option(fc.tuple(finite, finite), { nil: null }),
      handleOut: fc.option(fc.tuple(finite, finite), { nil: null }),
    }),
    { minLength: 2, maxLength: 12 },
  ),
  closed: fc.boolean(),
  tolerance: fc.constant(0.5),
});

const modifierArb: fc.Arbitrary<WarpModifier> = fc.oneof(
  fc.record({
    id: fc.constant('m'),
    kind: fc.constant('skew' as const),
    skewX: fc.double({ min: -60, max: 60, noNaN: true }),
    skewY: fc.double({ min: -60, max: 60, noNaN: true }),
    origin: fc.record({ x: unit, y: unit }),
  }),
  fc.record({
    id: fc.constant('m'),
    kind: fc.constant('envelope' as const),
    corners: fc.record({
      tl: fc.record({ x: unit, y: unit }),
      tr: fc.record({ x: unit, y: unit }),
      br: fc.record({ x: unit, y: unit }),
      bl: fc.record({ x: unit, y: unit }),
    }),
    edges: fc.record({
      top: fc.tuple(p(), p()),
      right: fc.tuple(p(), p()),
      bottom: fc.tuple(p(), p()),
      left: fc.tuple(p(), p()),
    }),
    interpolation: fc.constant('coons' as const),
  }),
  fc.record({
    id: fc.constant('m'),
    kind: fc.constant('mesh-warp' as const),
    rows: fc.constant(2),
    columns: fc.constant(3),
    points: fc.array(p(0, 1), { minLength: 12, maxLength: 12 }),
    interpolation: fc.constant('bilinear' as const),
  }),
  fc.record({
    id: fc.constant('m'),
    kind: fc.constant('bend' as const),
    mode: fc.constant('wave' as const),
    amount: fc.double({ min: -1, max: 1, noNaN: true }),
    axis: fc.constant('horizontal' as const),
    origin: unit,
    wavelength: fc.constant(2),
  }),
);

const boundsArb = fc.record({
  x: finite,
  y: finite,
  w: fc.double({ min: 0.001, max: 500, noNaN: true }),
  h: fc.double({ min: 0.001, max: 500, noNaN: true }),
});

describe('warp property: finite output', () => {
  it('never emits non-finite geometry for any finite input', () => {
    fc.assert(
      fc.property(modifierArb, pathShapeArb, boundsArb, (warp, shape, bounds) => {
        const { shape: out } = warpShapeToPath(shape, [warp], bounds, {
          quality: { profile: 'draft', maxSubdivision: 9 },
        });
        if (out.kind !== 'path') return;
        for (const pt of out.points) {
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('warp property: determinism', () => {
  it('identical inputs produce identical outputs', () => {
    fc.assert(
      fc.property(modifierArb, pathShapeArb, boundsArb, (warp, shape, bounds) => {
        const a = warpShapeToPath(shape, [warp], bounds, {
          quality: { profile: 'high', maxSubdivision: 9 },
        });
        const b = warpShapeToPath(shape, [warp], bounds, {
          quality: { profile: 'high', maxSubdivision: 9 },
        });
        expect(a.shape).toEqual(b.shape);
      }),
      { numRuns: 50 },
    );
  });
});

describe('warp property: serialization round-trip', () => {
  it('validate→serialize→validate preserves control values', () => {
    fc.assert(
      fc.property(modifierArb, (warp) => {
        const serialized = JSON.parse(JSON.stringify(warp));
        const result = validateWarpModifiers([serialized]);
        expect(result.modifiers).toHaveLength(1);
        // Canonicalize -0 (JSON drops the sign) on both sides.
        expect(JSON.parse(JSON.stringify(result.modifiers[0]))).toEqual(serialized);
      }),
      { numRuns: 40 },
    );
  });
});

describe('warp property: bounds containment', () => {
  it('evaluated bounds contain every generated point', () => {
    fc.assert(
      fc.property(modifierArb, pathShapeArb, (warp, shape) => {
        // Source bounds are derived from the path's control-point hull
        // (anchors + handles), exactly like the editor's nodeLocalBounds.
        const all: Array<[number, number]> = [];
        for (const pt of shape.points) {
          all.push([pt.x, pt.y]);
          if (pt.handleIn) all.push([pt.x + pt.handleIn[0], pt.y + pt.handleIn[1]]);
          if (pt.handleOut) all.push([pt.x + pt.handleOut[0], pt.y + pt.handleOut[1]]);
        }
        const minX = Math.min(...all.map(([x]) => x));
        const maxX = Math.max(...all.map(([x]) => x));
        const minY = Math.min(...all.map(([, y]) => y));
        const maxY = Math.max(...all.map(([, y]) => y));
        const bounds = {
          x: minX,
          y: minY,
          w: maxX - minX || 1,
          h: maxY - minY || 1,
        };
        const { shape: out } = warpShapeToPath(shape, [warp], bounds, {
          quality: { profile: 'draft', maxSubdivision: 9 },
        });
        if (out.kind !== 'path' || out.points.length === 0) return;
        // Bounds sample the control hull through the warp plus a domain grid.
        const { bounds: bb } = warpBoundsOfPoints(all, bounds, [warp], {
          quality: { profile: 'draft', maxSubdivision: 9 },
        });
        for (const pt of out.points) {
          expect(pt.x).toBeGreaterThanOrEqual(bb.x - 1e-6);
          expect(pt.x).toBeLessThanOrEqual(bb.x + bb.w + 1e-6);
          expect(pt.y).toBeGreaterThanOrEqual(bb.y - 1e-6);
          expect(pt.y).toBeLessThanOrEqual(bb.y + bb.h + 1e-6);
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('warp property: bounded output complexity', () => {
  it('never exceeds the generated-point budget', () => {
    fc.assert(
      fc.property(modifierArb, pathShapeArb, boundsArb, (warp, shape, bounds) => {
        const { shape: out, capped } = warpShapeToPath(shape, [warp], bounds, {
          quality: { profile: 'draft', maxGeneratedPoints: 500, maxSubdivision: 10 },
        });
        if (out.kind !== 'path') return;
        expect(out.points.length).toBeLessThanOrEqual(500);
        if (out.points.length >= 500) {
          expect(capped).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('warp property: identity cage is exact', () => {
  it('maps every sampled point onto itself', () => {
    const identity: WarpModifier = {
      id: 'm',
      kind: 'perspective',
      corners: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
    };
    fc.assert(
      fc.property(boundsArb, (bounds) => {
        const evalW = buildWarpEvaluation([identity], bounds);
        for (let i = 0; i <= 8; i++) {
          for (let j = 0; j <= 8; j++) {
            const x = bounds.x + (bounds.w * i) / 8;
            const y = bounds.y + (bounds.h * j) / 8;
            const [mx, my] = evalW.map(x, y);
            expect(mx).toBeCloseTo(x, 3);
            expect(my).toBeCloseTo(y, 3);
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});
