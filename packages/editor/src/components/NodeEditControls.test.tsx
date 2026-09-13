import type { ShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { isOpenOuterEndpoint } from './NodeEditControls';

const pathShape = (closed: boolean): Extract<ShapeNode['shape'], { kind: 'path' }> => ({
  kind: 'path',
  points: [
    { x: 0, y: 0, handleIn: null, handleOut: null },
    { x: 100, y: 0, handleIn: null, handleOut: null },
  ],
  contours: [
    [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ],
    [
      { x: 20, y: 20, handleIn: null, handleOut: null },
      { x: 80, y: 20, handleIn: null, handleOut: null },
      { x: 50, y: 80, handleIn: null, handleOut: null },
    ],
  ],
  closed,
  tolerance: 0.5,
});

describe('node edit control topology guards', () => {
  it('keeps hole closing segments insertable when the outer contour is open', () => {
    const shape = pathShape(false);
    expect(isOpenOuterEndpoint(shape, 0, 1)).toBe(true);
    expect(isOpenOuterEndpoint(shape, 1, 2)).toBe(false);
  });

  it('treats every endpoint as part of a closed outer contour after closing', () => {
    const shape = pathShape(true);
    expect(isOpenOuterEndpoint(shape, 0, 1)).toBe(false);
    expect(isOpenOuterEndpoint(shape, 1, 2)).toBe(false);
  });
});
