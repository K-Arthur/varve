import { describe, expect, it } from 'vitest';
import { normalizeSam2Prompts } from './sam2PromptCoordinates';

function mapper(points: Record<string, { x: number; y: number }>) {
  return {
    mapWorldPoint(point: { x: number; y: number }) {
      return points[`${point.x},${point.y}`] ?? null;
    },
  };
}

describe('normalizeSam2Prompts', () => {
  it('normalizes points and preserves positive/background labels', () => {
    const result = normalizeSam2Prompts(
      {
        points: [
          { x: 10, y: 20, label: 1 },
          { x: 30, y: 40, label: 0 },
        ],
      },
      mapper({ '10,20': { x: 50, y: 25 }, '30,40': { x: 150, y: 75 } }),
      200,
      100,
    );
    expect(result.points).toEqual([
      { x: 0.25, y: 0.25, label: 1 },
      { x: 0.75, y: 0.75, label: 0 },
    ]);
  });

  it('maps all four box corners before taking the source-space AABB', () => {
    const result = normalizeSam2Prompts(
      { box: { x1: 0, y1: 0, x2: 10, y2: 20 } },
      mapper({
        '0,0': { x: 100, y: 20 },
        '10,0': { x: 140, y: 0 },
        '10,20': { x: 180, y: 40 },
        '0,20': { x: 140, y: 60 },
      }),
      200,
      100,
    );
    expect(result.box).toEqual({ x1: 0.5, y1: 0, x2: 0.9, y2: 0.6 });
  });

  it('keeps a partially visible box usable and clamps source coordinates', () => {
    const result = normalizeSam2Prompts(
      { box: { x1: 0, y1: 0, x2: 10, y2: 10 } },
      mapper({ '0,0': { x: -10, y: -20 }, '10,10': { x: 220, y: 120 } }),
      200,
      100,
    );
    expect(result.box).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });
});
