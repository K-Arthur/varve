/**
 * Tests for text warp / envelope deformation.
 */
import { describe, expect, it } from 'vitest';
import { makeWarpEnvelope, type WarpMesh, warpBounds, warpGlyph, warpPoint } from './textWarp';

describe('makeWarpEnvelope', () => {
  it('clamps bend to [-1, 1]', () => {
    const env = makeWarpEnvelope('w1', 'arc', 2);
    expect(env.bend).toBe(1);
    const env2 = makeWarpEnvelope('w2', 'arc', -3);
    expect(env2.bend).toBe(-1);
  });

  it('stores default distortions', () => {
    const env = makeWarpEnvelope('w3', 'wave', 0.5, { horizontalDistortion: 0.3 });
    expect(env.horizontalDistortion).toBe(0.3);
    expect(env.verticalDistortion).toBe(0);
  });
});

describe('warpPoint', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 50 };

  it('returns original point for unknown kind', () => {
    const env = makeWarpEnvelope('u1', 'custom' as never, 0);
    const p = warpPoint([50, 25], bounds, env);
    expect(p[0]).toBe(50);
    expect(p[1]).toBe(25);
  });

  it('does not warp when bounds are zero-size', () => {
    const env = makeWarpEnvelope('u2', 'arc', 1);
    const p = warpPoint([50, 25], { x: 0, y: 0, w: 0, h: 0 }, env);
    expect(p[0]).toBe(50);
    expect(p[1]).toBe(25);
  });

  it('arc upper bends the top edge upward', () => {
    const env = makeWarpEnvelope('a1', 'arcUpper', 1);
    const top = warpPoint([50, 0], bounds, env);
    const bottom = warpPoint([50, 50], bounds, env);
    expect(top[1]).toBeLessThan(0);
    expect(bottom[1]).toBe(50);
  });

  it('arc lower bends the bottom edge downward', () => {
    const env = makeWarpEnvelope('a2', 'arcLower', 1);
    const top = warpPoint([50, 0], bounds, env);
    const bottom = warpPoint([50, 50], bounds, env);
    expect(top[1]).toBe(0);
    expect(bottom[1]).toBeGreaterThan(50);
  });

  it('bulge pushes center outward', () => {
    const env = makeWarpEnvelope('b1', 'bulge', 1);
    const center = warpPoint([50, 25], bounds, env);
    const edge = warpPoint([50, 50], bounds, env);
    expect(center[1]).toBeLessThan(25);
    expect(edge[1]).toBeCloseTo(50, 1);
  });

  it('rise lifts the right side', () => {
    const env = makeWarpEnvelope('r1', 'rise', 1);
    const left = warpPoint([0, 25], bounds, env);
    const right = warpPoint([100, 25], bounds, env);
    expect(left[1]).toBe(25);
    expect(right[1]).toBeLessThan(25);
  });

  it('flag creates a wave along the x-axis', () => {
    const env = makeWarpEnvelope('f1', 'flag', 1);
    const left = warpPoint([0, 25], bounds, env);
    const mid = warpPoint([50, 25], bounds, env);
    const right = warpPoint([100, 25], bounds, env);
    expect(left[1]).toBeCloseTo(25, 1);
    expect(right[1]).toBeCloseTo(25, 1);
    expect(mid[1]).not.toBe(25);
  });

  it('mesh warp maps to control points', () => {
    const mesh: WarpMesh = {
      rows: 2,
      cols: 2,
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
    };
    const env = makeWarpEnvelope('m1', 'freeMesh', 0, { mesh });
    const p = warpPoint([50, 25], bounds, env);
    expect(p[0]).toBe(50);
    expect(p[1]).toBe(25);
  });

  it('custom warp uses provided deformation', () => {
    const env = makeWarpEnvelope('c1', 'custom', 0, {
      customDeform: (p) => [p[0] + 10, p[1] - 5],
    });
    const p = warpPoint([50, 25], bounds, env);
    expect(p[0]).toBe(60);
    expect(p[1]).toBe(20);
  });
});

describe('warpGlyph', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 50 };

  it('warps position and angle', () => {
    const env = makeWarpEnvelope('g1', 'rise', 1);
    const glyph = { x: 50, y: 25, angle: 0 };
    const warped = warpGlyph(glyph, bounds, env);
    expect(warped.y).toBeLessThan(25);
    expect(typeof warped.angle).toBe('number');
    expect(warped.scaleX).toBeGreaterThan(0);
  });
});

describe('warpBounds', () => {
  it('expands bounds for an arc warp', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 50 };
    const env = makeWarpEnvelope('wb1', 'arcUpper', 1);
    const warped = warpBounds(bounds, env, 8);
    expect(warped.y).toBeLessThanOrEqual(0);
    expect(warped.h).toBeGreaterThan(bounds.h);
  });
});
