import { describe, expect, it } from 'vitest';
import {
  openMultiRectPartialClip,
  openUnionPartialClip,
  snapRectToDevicePixels,
} from './partialPaint';

function recordingContext() {
  const calls: Array<[string, number[]]> = [];
  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push([name, args]);
    };
  const ctx = {
    fillStyle: '',
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    save: record('save'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    clip: record('clip'),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const geometryCalls = new Set(['clearRect', 'fillRect', 'rect']);

describe('partial redraw clip snapping', () => {
  it('grows a fractional rect outward to whole device pixels', () => {
    expect(snapRectToDevicePixels({ x: 0, y: 0, w: 298.617, h: 200.239 }, 1)).toEqual({
      x: 0,
      y: 0,
      w: 299,
      h: 201,
    });
    // Fractional display scale: 10.2 CSS px at 1.5x is device x 15.3.
    expect(snapRectToDevicePixels({ x: 10.2, y: 4, w: 20, h: 10 }, 1.5)).toEqual({
      x: 15,
      y: 6,
      w: 31,
      h: 15,
    });
  });

  it('clears, fills, and clips only whole device pixels on both paths', () => {
    for (const dpr of [1, 1.25, 2]) {
      const union = recordingContext();
      openUnionPartialClip(
        union.ctx,
        { x: 428.68, y: 346.79, w: 98.66, h: 90.97 },
        dpr,
        '#000',
        () => {},
      );
      const multi = recordingContext();
      openMultiRectPartialClip(
        multi.ctx,
        [
          { x: 12, y: 7, w: 33, h: 9 },
          { x: 100.4, y: 50.6, w: 20.1, h: 10.3 },
        ],
        dpr,
        '#000',
        () => {},
      );
      for (const [name, args] of [...union.calls, ...multi.calls]) {
        if (!geometryCalls.has(name)) continue;
        expect(args.every(Number.isInteger), `${name}(${args}) at dpr ${dpr}`).toBe(true);
      }
    }
  });
});
