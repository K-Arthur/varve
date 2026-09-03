import { describe, expect, it, vi } from 'vitest';
import { applyRasterizationTransform, sourceBoundsToRasterTransform } from './rasterTransform';

function map(transform: ReturnType<typeof sourceBoundsToRasterTransform>, x: number, y: number) {
  return {
    x: transform.scaleX * x + transform.translateX,
    y: transform.scaleY * y + transform.translateY,
  };
}

describe('sourceBoundsToRasterTransform', () => {
  it('maps independently rounded axes to the exact output crop endpoints', () => {
    const source = { x: 12.25, y: -3.5, width: 127.25, height: 45.5 };
    const target = { width: 398, height: 142 };

    const transform = sourceBoundsToRasterTransform(source, target);

    expect(transform.scaleX).not.toBe(transform.scaleY);
    expect(map(transform, source.x, source.y)).toEqual({ x: 0, y: 0 });
    expect(map(transform, source.x + source.width, source.y + source.height)).toEqual({
      x: target.width,
      y: target.height,
    });
  });

  it('does not introduce a half-pixel or DPR offset', () => {
    const transform = sourceBoundsToRasterTransform(
      { x: 0, y: 0, width: 96, height: 96 },
      { width: 300, height: 300 },
    );

    expect(transform).toEqual({ scaleX: 3.125, scaleY: 3.125, translateX: 0, translateY: 0 });
  });

  it('rejects degenerate source bounds and non-integer backing-store dimensions', () => {
    expect(() =>
      sourceBoundsToRasterTransform({ x: 0, y: 0, width: 0, height: 10 }, { width: 1, height: 1 }),
    ).toThrow(/positive width and height/);
    expect(() =>
      sourceBoundsToRasterTransform({ x: 0, y: 0, width: 1, height: 1 }, { width: 1.5, height: 1 }),
    ).toThrow(/safe integers/);
  });

  it('sets the resolved matrix in one operation', () => {
    const setTransform = vi.fn();
    applyRasterizationTransform(
      { setTransform },
      { x: 2, y: 4, width: 10, height: 8 },
      { width: 25, height: 12 },
    );

    expect(setTransform).toHaveBeenCalledWith(2.5, 0, 0, 1.5, -5, -6);
  });
});
