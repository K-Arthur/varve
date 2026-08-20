import { describe, expect, it } from 'vitest';
import type { BrushDab } from '../brush';
import {
  compositeMaskDab,
  createMaskPlane,
  maskPlaneFromRgba,
  maskPlaneToRgba,
  maskValueFromColor,
  unionRect,
} from '../maskPaint';
import { makeCoverageMask } from '../paintCoverage';

function dab(x: number, y: number, overrides: Partial<BrushDab> = {}): BrushDab {
  return {
    x,
    y,
    radius: 6,
    opacity: 1,
    flow: 1,
    hardness: 1,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
    shape: 'circle',
    blendMode: 'normal',
    ...overrides,
  };
}

const at = (plane: ReturnType<typeof createMaskPlane>, x: number, y: number) =>
  plane.data[y * plane.width + x]!;

describe('mask painting', () => {
  it('starts fully revealed', () => {
    const plane = createMaskPlane(32, 32);
    expect(at(plane, 5, 5)).toBe(255);
  });

  it('conceals where a black brush paints', () => {
    const plane = createMaskPlane(32, 32);
    compositeMaskDab(plane, dab(16, 16), { value: 0 });
    expect(at(plane, 16, 16)).toBe(0);
    expect(at(plane, 1, 1)).toBe(255);
  });

  it('reveals again where a white brush paints', () => {
    const plane = createMaskPlane(32, 32, 0);
    compositeMaskDab(plane, dab(16, 16), { value: 1 });
    expect(at(plane, 16, 16)).toBe(255);
  });

  it('converges on the chosen value rather than overshooting it', () => {
    const plane = createMaskPlane(32, 32);
    // Repeated soft dabs approach the target and stop there.
    for (let i = 0; i < 20; i++)
      compositeMaskDab(plane, dab(16, 16, { opacity: 0.3 }), { value: 0.5 });
    expect(at(plane, 16, 16)).toBeGreaterThanOrEqual(126);
    expect(at(plane, 16, 16)).toBeLessThanOrEqual(130);
  });

  it('produces a soft edge for a soft brush', () => {
    const plane = createMaskPlane(48, 48);
    compositeMaskDab(plane, dab(24, 24, { radius: 12, hardness: 0.1 }), { value: 0 });
    const centre = at(plane, 24, 24);
    const edge = at(plane, 24 + 10, 24);
    expect(centre).toBe(0);
    expect(edge).toBeGreaterThan(centre);
    expect(edge).toBeLessThan(255);
  });

  it('clips to selection coverage', () => {
    const plane = createMaskPlane(64, 32);
    const coverage = makeCoverageMask(20, 0, 40, 32, 255);
    compositeMaskDab(plane, dab(22, 16, { radius: 10 }), { value: 0, coverage });
    expect(at(plane, 25, 16)).toBeLessThan(255);
    expect(at(plane, 15, 16)).toBe(255);
  });

  it('reports the rectangle it touched', () => {
    const plane = createMaskPlane(64, 64);
    const rect = compositeMaskDab(plane, dab(32, 32, { radius: 5 }), { value: 0 });
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(26);
    expect(rect!.w).toBeLessThanOrEqual(12);
  });

  it('reports nothing when the dab lands outside the plane', () => {
    const plane = createMaskPlane(32, 32);
    expect(compositeMaskDab(plane, dab(-50, -50), { value: 0 })).toBeNull();
  });

  it('round-trips through RGBA', () => {
    const plane = createMaskPlane(8, 4, 0);
    compositeMaskDab(plane, dab(4, 2, { radius: 2 }), { value: 1 });
    const restored = maskPlaneFromRgba(maskPlaneToRgba(plane), plane.width, plane.height);
    expect(Array.from(restored.data)).toEqual(Array.from(plane.data));
  });

  it('writes coverage to every channel so alpha and luminance readers agree', () => {
    const plane = createMaskPlane(2, 1, 128);
    const rgba = maskPlaneToRgba(plane);
    expect(Array.from(rgba.slice(0, 4))).toEqual([128, 128, 128, 128]);
  });

  it('derives its value from the paint colour luminance', () => {
    expect(maskValueFromColor([255, 255, 255, 255])).toBe(1);
    expect(maskValueFromColor([0, 0, 0, 255])).toBe(0);
    expect(maskValueFromColor([128, 128, 128, 255])).toBeCloseTo(0.502, 2);
  });

  it('unions dirty rectangles', () => {
    expect(unionRect(null, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 4, w: 2, h: 2 })).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 6,
    });
  });
});
