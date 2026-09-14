import { describe, expect, it } from 'vitest';
import {
  buildDisplayPaths,
  type DisplayPath,
  displayPathPaint,
  traceDisplayPath,
  traceDisplayRing,
} from './previewPaths';

type Command =
  | ['moveTo', number, number]
  | ['lineTo', number, number]
  | ['bezierCurveTo', number, number, number, number, number, number]
  | ['closePath'];

function recordingContext() {
  const commands: Command[] = [];
  return {
    commands,
    moveTo: (x: number, y: number) => {
      commands.push(['moveTo', x, y]);
    },
    lineTo: (x: number, y: number) => {
      commands.push(['lineTo', x, y]);
    },
    bezierCurveTo: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      commands.push(['bezierCurveTo', a, b, c, d, e, f]);
    },
    closePath: () => {
      commands.push(['closePath']);
    },
  };
}

const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });

describe('traceDisplayRing', () => {
  it('emits cubic segments when handles are present (offsets from anchors)', () => {
    const ctx = recordingContext();
    traceDisplayRing(
      ctx,
      [
        { x: 0, y: 0, handleIn: null, handleOut: [10, 0] },
        { x: 100, y: 0, handleIn: [-10, 0], handleOut: null },
      ],
      false,
    );
    expect(ctx.commands).toEqual([
      ['moveTo', 0, 0],
      ['bezierCurveTo', 10, 0, 90, 0, 100, 0],
    ]);
  });

  it('never closes an open ring even when it has handles', () => {
    const ctx = recordingContext();
    traceDisplayRing(ctx, [point(0, 0), point(10, 0), point(10, 10)], false);
    expect(ctx.commands.some((command) => command[0] === 'closePath')).toBe(false);
  });

  it('closes a closed ring and connects the last anchor back to the first', () => {
    const ctx = recordingContext();
    traceDisplayRing(
      ctx,
      [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 10, y: 0, handleIn: null, handleOut: null },
        { x: 10, y: 10, handleIn: [0, 10], handleOut: null },
      ],
      true,
    );
    expect(ctx.commands.at(-1)).toEqual(['closePath']);
    expect(ctx.commands.at(-2)).toEqual(['bezierCurveTo', 10, 0, 10, 20, 10, 10]);
  });
});

describe('traceDisplayPath', () => {
  it('closes every hole subpath, not just the outer ring', () => {
    const ctx = recordingContext();
    const path: DisplayPath = {
      points: [point(0, 0), point(10, 0), point(10, 10), point(0, 10)],
      holes: [
        [point(2, 2), point(4, 2), point(4, 4), point(2, 4)],
        [point(6, 6), point(8, 6), point(8, 8), point(6, 8)],
      ],
      closed: true,
      stroked: false,
    };
    traceDisplayPath(ctx, path);
    const closes = ctx.commands.filter((command) => command[0] === 'closePath');
    expect(closes).toHaveLength(3);
  });
});

describe('displayPathPaint', () => {
  it('strokes centerline output in the committed black, never a theme color', () => {
    const paint = displayPathPaint({
      points: [point(0, 0), point(1, 1)],
      closed: false,
      stroked: true,
      strokeWidth: 3,
    });
    expect(paint).toEqual({ kind: 'stroke', style: 'rgb(0, 0, 0)' });
  });

  it('fills silhouettes with the provider fill color and alpha', () => {
    const paint = displayPathPaint({
      points: [point(0, 0), point(1, 1), point(1, 0)],
      closed: true,
      stroked: false,
      fill: { r: 10, g: 20, b: 30, a: 128 },
    });
    expect(paint.kind).toBe('fill');
    expect(paint.style).toBe('rgba(10, 20, 30, 0.5019607843137255)');
  });
});

describe('buildDisplayPaths', () => {
  const circle = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50 };
  });

  it('fits provider polylines into cubics using the insertion options', () => {
    const display = buildDisplayPaths(
      {
        width: 200,
        height: 200,
        omittedHoles: 0,
        paths: [
          {
            points: circle,
            closed: true,
            area: 1,
            bounds: { x: -50, y: -50, w: 100, h: 100 },
          },
        ],
      },
      { cornerAngle: 135, maxError: 1 },
    );
    const hasHandles = display[0]?.points.some((p) => p.handleIn || p.handleOut);
    expect(hasHandles).toBe(true);
  });

  it('passes provider-fitted handles through without a second fit', () => {
    const display = buildDisplayPaths(
      {
        width: 200,
        height: 200,
        omittedHoles: 0,
        paths: [
          {
            points: [
              { x: 0, y: 0, handleOut: [5, 5] },
              { x: 50, y: 0, handleIn: [-5, 5] },
              { x: 50, y: 50 },
            ],
            closed: true,
            curveFitted: true,
            area: 1,
            bounds: { x: 0, y: 0, w: 50, h: 50 },
          },
        ],
      },
      { cornerAngle: 135, maxError: 1 },
    );
    expect(display[0]?.points[0]?.handleOut).toEqual([5, 5]);
    expect(display[0]?.points[1]?.handleIn).toEqual([-5, 5]);
    expect(display[0]?.points[2]?.handleIn).toBeNull();
  });

  it('marks strokeWidth paths as stroked so closed loops stay unfilled', () => {
    const display = buildDisplayPaths(
      {
        width: 10,
        height: 10,
        omittedHoles: 0,
        paths: [
          {
            points: circle.slice(0, 4),
            closed: true,
            strokeWidth: 2,
            area: 1,
            bounds: { x: 0, y: 0, w: 10, h: 10 },
          },
        ],
      },
      { cornerAngle: 135, maxError: 1 },
    );
    expect(display[0]?.stroked).toBe(true);
    expect(display[0]?.closed).toBe(true);
  });
});
