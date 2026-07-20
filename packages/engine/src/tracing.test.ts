import { describe, expect, it, vi } from 'vitest';
import { traceSceneNodeOutline } from './tracing';
import type { PathPoint, SceneNode } from './types';

const point = (x: number, y: number): PathPoint => ({
  x,
  y,
  handleIn: null,
  handleOut: null,
});

describe('traceSceneNodeOutline', () => {
  it('traces every compound-path ring so evenodd clipping can preserve holes', () => {
    const context = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const node: SceneNode = {
      id: 'compound',
      name: 'Compound',
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: {
        kind: 'path',
        points: [point(0, 0), point(100, 0), point(100, 100), point(0, 100)],
        holes: [[point(25, 25), point(25, 75), point(75, 75), point(75, 25)]],
        closed: true,
        tolerance: 1,
        fillRule: 'evenodd',
      },
    };

    traceSceneNodeOutline(context, node);

    expect(context.moveTo).toHaveBeenNthCalledWith(1, 0, 0);
    expect(context.moveTo).toHaveBeenNthCalledWith(2, 25, 25);
    expect(context.closePath).toHaveBeenCalledTimes(2);
  });
});
