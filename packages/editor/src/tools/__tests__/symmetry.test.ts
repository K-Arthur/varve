import { strokePoint } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  clampRadialCount,
  defaultSymmetrySettings,
  MAX_RADIAL_SEGMENTS,
  resolveSymmetryTransforms,
  symmetryBranchCount,
  transformStrokePoint,
} from '../symmetry';

const at = (x: number, y: number, direction = 0) => ({ x, y, direction });

describe('symmetry transforms', () => {
  it('produces a single identity branch when disabled', () => {
    const [identity, ...rest] = resolveSymmetryTransforms(null);
    expect(rest).toHaveLength(0);
    expect(identity!(at(3, 7, 1))).toEqual(at(3, 7, 1));
  });

  it('mirrors across a vertical axis through the origin', () => {
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorY' as const, originX: 50, originY: 0 };
    const [, mirror] = resolveSymmetryTransforms(s);
    const p = mirror!(at(70, 20));
    expect(p.x).toBeCloseTo(30, 9);
    expect(p.y).toBeCloseTo(20, 9);
  });

  it('mirrors across a horizontal axis through the origin', () => {
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorX' as const, originX: 0, originY: 40 };
    const [, mirror] = resolveSymmetryTransforms(s);
    const p = mirror!(at(20, 70));
    expect(p.x).toBeCloseTo(20, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });

  it('reflects direction rather than merely negating it', () => {
    // Mirroring about the x axis maps a heading of +30 degrees to -30.
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorX' as const, originX: 0, originY: 0 };
    const [, mirror] = resolveSymmetryTransforms(s);
    const p = mirror!(at(10, 10, Math.PI / 6));
    expect(Math.atan2(Math.sin(p.direction), Math.cos(p.direction))).toBeCloseTo(-Math.PI / 6, 9);
  });

  it('is an involution — mirroring twice returns the original point', () => {
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorY' as const, originX: 12, originY: 5 };
    const [, mirror] = resolveSymmetryTransforms(s);
    const p = mirror!(mirror!(at(31, 44, 0.7)));
    expect(p.x).toBeCloseTo(31, 9);
    expect(p.y).toBeCloseTo(44, 9);
    expect(p.direction).toBeCloseTo(0.7, 9);
  });

  it('gives mirrorXY four quadrants', () => {
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorXY' as const, originX: 0, originY: 0 };
    const points = resolveSymmetryTransforms(s).map((t) => t(at(10, 20)));
    const rounded = points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort();
    expect(rounded).toEqual(['-10,-20', '-10,20', '10,-20', '10,20']);
  });

  it('spaces radial copies evenly around the origin', () => {
    const s = {
      ...defaultSymmetrySettings(),
      mode: 'radial' as const,
      originX: 0,
      originY: 0,
      radialCount: 4,
    };
    const transforms = resolveSymmetryTransforms(s);
    expect(transforms).toHaveLength(4);
    const radii = transforms.map((t) => {
      const p = t(at(10, 0));
      return Math.hypot(p.x, p.y);
    });
    for (const r of radii) expect(r).toBeCloseTo(10, 9);
    const angles = transforms
      .map((t) => {
        const p = t(at(10, 0));
        return Math.round((Math.atan2(p.y, p.x) * 180) / Math.PI);
      })
      .sort((a, b) => a - b);
    expect(angles).toEqual([-90, 0, 90, 180]);
  });

  it('rotates direction with each radial copy', () => {
    const s = {
      ...defaultSymmetrySettings(),
      mode: 'radial' as const,
      radialCount: 4,
      originX: 0,
      originY: 0,
    };
    const transforms = resolveSymmetryTransforms(s);
    expect(transforms[1]!(at(10, 0, 0)).direction).toBeCloseTo(Math.PI / 2, 9);
  });

  it('doubles the branch count for kaleidoscope mode', () => {
    const base = { ...defaultSymmetrySettings(), mode: 'radial' as const, radialCount: 6 };
    expect(symmetryBranchCount(base)).toBe(6);
    expect(symmetryBranchCount({ ...base, radialMirror: true })).toBe(12);
  });

  it('bounds radial segments so a huge brush cannot wedge the app', () => {
    expect(clampRadialCount(1000)).toBe(MAX_RADIAL_SEGMENTS);
    expect(clampRadialCount(0)).toBe(2);
    expect(clampRadialCount(Number.NaN)).toBe(2);
  });

  it('preserves pressure and tilt through a transform', () => {
    const s = { ...defaultSymmetrySettings(), mode: 'mirrorY' as const, originX: 0, originY: 0 };
    const [, mirror] = resolveSymmetryTransforms(s);
    const src = strokePoint(10, 20, {
      pressure: 0.3,
      tilt: 42,
      tiltAzimuth: Math.PI / 3,
      twist: 30,
      speed: 99,
      time: 7,
    });
    const out = transformStrokePoint(src, mirror!);
    expect(out.pressure).toBe(0.3);
    expect(out.tilt).toBe(42);
    expect(out.speed).toBe(99);
    expect(out.time).toBe(7);
    expect(out.x).toBeCloseTo(-10, 9);
    expect(out.tiltAzimuth).toBeCloseTo((2 * Math.PI) / 3, 9);
    expect(out.twist).toBe(150);
  });

  it('returns the same object when a transform is a no-op', () => {
    const [identity] = resolveSymmetryTransforms(null);
    const src = strokePoint(1, 2);
    expect(transformStrokePoint(src, identity!)).toBe(src);
  });
});
