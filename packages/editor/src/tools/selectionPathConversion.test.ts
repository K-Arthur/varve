import type { PathPoint } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import {
  pathPointsToSelectionCommands,
  selectionCommandsToPathRing,
} from './selectionPathConversion';

describe('selection path conversion', () => {
  it('preserves transformed cubic handles as document-space controls', () => {
    const points: PathPoint[] = [
      { x: 10, y: 20, handleIn: null, handleOut: [4, 2] },
      { x: 30, y: 40, handleIn: [-3, 5], handleOut: null },
    ];
    const commands = pathPointsToSelectionCommands(points, true, [2, 0, 0, 3, 100, 200]);
    expect(commands).toEqual([
      { type: 'move', x: 120, y: 260 },
      { type: 'curve', cx1: 128, cy1: 266, cx2: 154, cy2: 305, x: 160, y: 320 },
      { type: 'curve', cx1: 160, cy1: 320, cx2: 120, cy2: 260, x: 120, y: 260 },
      { type: 'close' },
    ]);
  });

  it('round-trips line and cubic commands into relative scene handles', () => {
    const ring = selectionCommandsToPathRing([
      { type: 'move', x: 0, y: 0 },
      { type: 'curve', cx1: 10, cy1: 0, cx2: 20, cy2: 30, x: 30, y: 30 },
      { type: 'line', x: 0, y: 30 },
      { type: 'close' },
    ]);
    expect(ring).toEqual({
      closed: true,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [10, 0] },
        { x: 30, y: 30, handleIn: [-10, 0], handleOut: null },
        { x: 0, y: 30, handleIn: null, handleOut: null },
      ],
    });
  });
});
