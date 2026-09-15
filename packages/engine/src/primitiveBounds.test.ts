import { describe, expect, it } from 'vitest';
import { primitiveBounds } from './replay';

describe('primitiveBounds', () => {
  it('includes path anchors, Bézier handles, and hole rings', () => {
    expect(
      primitiveBounds({
        kind: 'path',
        points: [
          { x: 10, y: 20, handleIn: null, handleOut: [-30, 5] },
          { x: 50, y: 60, handleIn: [40, -80], handleOut: null },
        ],
        holes: [
          [
            { x: -100, y: 200, handleIn: null, handleOut: [-10, 30] },
            { x: -80, y: 210, handleIn: null, handleOut: null },
          ],
        ],
        closed: true,
        tolerance: 1,
        fillRule: 'evenodd',
      }),
    ).toEqual({ x: -110, y: -20, w: 200, h: 250 });
  });

  it('returns finite zero bounds for an empty path', () => {
    expect(primitiveBounds({ kind: 'path', points: [], closed: false, tolerance: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });

  it('uses canonical compound contours when the legacy holes alias is absent', () => {
    expect(
      primitiveBounds({
        kind: 'path',
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        contours: [
          [
            { x: 10, y: 20, handleIn: null, handleOut: null },
            { x: 30, y: 20, handleIn: null, handleOut: null },
            { x: 30, y: 40, handleIn: null, handleOut: null },
          ],
          [
            { x: -20, y: -10, handleIn: null, handleOut: null },
            { x: -5, y: -10, handleIn: null, handleOut: null },
            { x: -5, y: 0, handleIn: null, handleOut: null },
          ],
        ],
        closed: true,
        tolerance: 1,
        fillRule: 'evenodd',
      }),
    ).toEqual({ x: -20, y: -10, w: 50, h: 50 });
  });

  it('ignores non-finite path coordinates and handles', () => {
    const bounds = primitiveBounds({
      kind: 'path',
      points: [
        { x: Number.NaN, y: 10, handleIn: null, handleOut: null },
        { x: 20, y: 30, handleIn: [Number.POSITIVE_INFINITY, 0], handleOut: [-5, 10] },
      ],
      closed: false,
      tolerance: 1,
    });

    expect(bounds).toEqual({ x: 15, y: 30, w: 5, h: 10 });
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
  });
});
