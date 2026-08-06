import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { shapeToPathPoints, warpShapeToPath } from '../geometry';
import { type PerspectiveModifier, validateWarpModifiers, type WarpModifier } from '../types';

const BOUNDS = { x: 0, y: 0, w: 200, h: 100 };

function modifier(m: WarpModifier): WarpModifier[] {
  return [m];
}

function rect(): Shape {
  return { kind: 'rect', x: 0, y: 0, w: 200, h: 100 };
}

function skewMod(skewX: number, skewY = 0): WarpModifier {
  return { id: 'm1', kind: 'skew', skewX, skewY, origin: { x: 0.5, y: 0.5 } };
}

describe('shapeToPathPoints', () => {
  it('converts rect to 4 closed corners', () => {
    const c = shapeToPathPoints(rect());
    expect(c.closed).toBe(true);
    expect(c.points).toHaveLength(4);
    expect(c.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(c.points[2]).toMatchObject({ x: 200, y: 100 });
  });

  it('converts ellipse to 4 cubic arcs with kappa handles', () => {
    const c = shapeToPathPoints({ kind: 'ellipse', cx: 50, cy: 50, rx: 50, ry: 25 });
    expect(c.closed).toBe(true);
    expect(c.points).toHaveLength(4);
    expect(c.points[0]!.handleOut![0]).toBeCloseTo(0);
    expect(c.points[0]!.handleOut![1]).toBeCloseTo(25 * 0.5522847498307936);
  });

  it('passes paths through untouched with holes and fill rule', () => {
    const p: Shape = {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 10, y: 0, handleIn: null, handleOut: null },
      ],
      closed: true,
      tolerance: 0.5,
      holes: [[{ x: 1, y: 1, handleIn: null, handleOut: null }]],
      fillRule: 'evenodd',
    };
    const c = shapeToPathPoints(p);
    expect(c.holes).toHaveLength(1);
    expect(c.fillRule).toBe('evenodd');
  });
});

describe('warpShapeToPath — skew', () => {
  it('a live zero-skew stack still converts to an exact path', () => {
    const { shape } = warpShapeToPath(rect(), modifier(skewMod(0, 0)), BOUNDS);
    expect(shape.kind).toBe('path');
    if (shape.kind === 'path') {
      expect(shape.points[0]).toMatchObject({ x: 0, y: 0 });
      expect(shape.points[2]).toMatchObject({ x: 200, y: 100 });
    }
  });

  it('skews corners exactly like the affine formula around the pivot', () => {
    const { shape } = warpShapeToPath(rect(), modifier(skewMod(20)), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    const k = Math.tan((20 * Math.PI) / 180);
    // pivot (100, 50); x' = 100 + (x-100) + k·(y-50)
    expect(shape.points[0]!.x).toBeCloseTo(-50 * k, 3);
    expect(shape.points[1]!.x).toBeCloseTo(200 - 50 * k, 3);
    expect(shape.points[2]!.x).toBeCloseTo(200 + 50 * k, 3);
    expect(shape.points[3]!.x).toBeCloseTo(50 * k, 3);
  });

  it('negative skew reflects exactly', () => {
    const { shape } = warpShapeToPath(rect(), modifier(skewMod(-30)), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    const k = Math.tan((-30 * Math.PI) / 180);
    expect(shape.points[2]!.x).toBeCloseTo(200 + k * 50, 3);
    expect(shape.points[3]!.x).toBeCloseTo(k * 50, 3);
  });
});

describe('warpShapeToPath — perspective', () => {
  it('identity cage reproduces the source rectangle', () => {
    const p: PerspectiveModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    };
    const { shape } = warpShapeToPath(rect(), modifier(p), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    expect(shape.points[0]!.x).toBeCloseTo(0, 3);
    expect(shape.points[0]!.y).toBeCloseTo(0, 3);
    expect(shape.points[1]!.x).toBeCloseTo(200, 3);
    expect(shape.points[1]!.y).toBeCloseTo(0, 3);
    expect(shape.points[2]!.x).toBeCloseTo(200, 3);
    expect(shape.points[2]!.y).toBeCloseTo(100, 3);
    expect(shape.points[3]!.x).toBeCloseTo(0, 3);
    expect(shape.points[3]!.y).toBeCloseTo(100, 3);
  });

  it('parallelogram cage agrees with the equivalent affine skew', () => {
    const p: PerspectiveModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: {
        tl: { x: 0.2, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 0.8, y: 1 },
        bl: { x: 0, y: 1 },
      },
    };
    const { shape } = warpShapeToPath(rect(), modifier(p), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    // top edge from (40,0) to (200,0); bottom edge from (0,100) to (160,100)
    expect(shape.points[1]!.x).toBeCloseTo(200, 1);
    expect(shape.points[2]!.x).toBeCloseTo(160, 1);
    expect(shape.points[3]!.x).toBeCloseTo(0, 1);
  });

  it('degenerate cage degrades to identity with an invalid flag', () => {
    const p: PerspectiveModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 0.5, y: 0 },
        bl: { x: 0, y: 1 },
      },
    };
    const { shape, evaluation } = warpShapeToPath(rect(), modifier(p), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    expect(evaluation.invalid.some((i) => i.reason === 'invalid-cage')).toBe(true);
    expect(shape.points[0]!.x).toBe(0);
    expect(shape.points[2]!.x).toBe(200);
  });
});

describe('warpShapeToPath — envelope', () => {
  it('maps boundary points exactly onto the configured edge curves', () => {
    const e: WarpModifier = {
      id: 'm1',
      kind: 'envelope',
      corners: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
      edges: {
        top: [
          { x: 1 / 3, y: -0.2 },
          { x: 2 / 3, y: -0.2 },
        ],
        right: [
          { x: 1, y: 1 / 3 },
          { x: 1, y: 2 / 3 },
        ],
        bottom: [
          { x: 1 / 3, y: 1.2 },
          { x: 2 / 3, y: 1.2 },
        ],
        left: [
          { x: 0, y: 1 / 3 },
          { x: 0, y: 2 / 3 },
        ],
      },
      interpolation: 'coons',
    };
    const { shape } = warpShapeToPath(
      {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: [66.67, -20] },
          { x: 200, y: 0, handleIn: [-66.67, -20], handleOut: null },
          { x: 200, y: 100, handleIn: null, handleOut: null },
          { x: 0, y: 100, handleIn: null, handleOut: null },
        ],
        closed: true,
        tolerance: 0.5,
      },
      modifier(e),
      BOUNDS,
      {
        quality: { profile: 'export', tolerance: 1e-4 },
      },
    );
    if (shape.kind !== 'path') throw new Error('expected path');
    // Corners land exactly on configured corners
    expect(shape.points[0]!.x).toBeCloseTo(0, 2);
    expect(shape.points[0]!.y).toBeCloseTo(0, 2);
    // Boundary agreement: source points on the top bound line (y=0) map
    // exactly onto the configured top boundary cubic.
    const cubicY = (t: number) =>
      (1 - t) ** 3 * 0 + 3 * (1 - t) ** 2 * t * -20 + 3 * (1 - t) * t ** 2 * -20 + t ** 3 * 0;
    const { evaluation } = warpShapeToPath(rect(), modifier(e), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-4 },
    });
    for (const t of [0.2, 0.35, 0.5, 0.7, 0.9]) {
      const mapped = evaluation.map(200 * t, 0);
      expect(mapped[0]).toBeCloseTo(200 * t, 2);
      expect(mapped[1]).toBeCloseTo(cubicY(t), 2);
    }
  });
});

describe('warpShapeToPath — mesh', () => {
  it('bilinear mesh moves a point by the interpolated corner offset', () => {
    const m: WarpModifier = {
      id: 'm1',
      kind: 'mesh-warp',
      rows: 1,
      columns: 1,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      interpolation: 'bilinear',
    };
    const { shape } = warpShapeToPath(rect(), modifier(m), BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-6 },
    });
    if (shape.kind !== 'path') throw new Error('expected path');
    expect(shape.points[2]!.x).toBeCloseTo(200, 3);
    expect(shape.points[2]!.y).toBeCloseTo(100, 3);
  });
});

describe('validateWarpModifiers', () => {
  it('drops malformed known entries and keeps valid ones', () => {
    const result = validateWarpModifiers([
      { id: 'bad', kind: 'skew', skewX: NaN, skewY: 0, origin: { x: 0.5, y: 0.5 } },
      { id: 'good', kind: 'skew', skewX: 10, skewY: 0, origin: { x: 0.5, y: 0.5 } },
    ]);
    expect(result.modifiers).toHaveLength(1);
    expect(result.dropped).toBe(1);
    expect(result.modifiers[0]!.id).toBe('good');
  });

  it('preserves unknown future kinds inert', () => {
    const result = validateWarpModifiers([{ id: 'future', kind: 'warp-v2-ffd', params: { x: 1 } }]);
    expect(result.modifiers).toHaveLength(1);
    expect((result.modifiers[0] as { kind: string }).kind).toBe('warp-v2-ffd');
  });

  it('caps the stack and clamps mesh dimensions', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      kind: 'skew',
      skewX: 0,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    }));
    const result = validateWarpModifiers(many);
    expect(result.modifiers).toHaveLength(8);
  });

  it('normalizes skew origin default', () => {
    const result = validateWarpModifiers([{ id: 'm', kind: 'skew', skewX: 5, skewY: 0 }]);
    expect(result.modifiers[0]).toMatchObject({ skewX: 5, origin: { x: 0.5, y: 0.5 } });
  });
});
