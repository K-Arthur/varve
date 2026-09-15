import { describe, expect, it } from 'vitest';
import {
  mapSourceSam2PromptsToWorld,
  mergeSam2NormalizedPrompts,
  normalizeSam2Prompts,
  normalizeSourceSam2Prompts,
} from './sam2PromptCoordinates';

function mapper(points: Record<string, { x: number; y: number }>) {
  return {
    mapWorldPoint(point: { x: number; y: number }) {
      return points[`${point.x},${point.y}`] ?? null;
    },
  };
}

function sourceMapper(
  transform: (point: { x: number; y: number }) => { x: number; y: number } | null,
) {
  return {
    mapSourcePixelToWorld: transform,
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
    expect(result.unmappedPointCount).toBe(0);
    expect(result.unmappedBoxCornerCount).toBe(0);
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
    expect(result.unmappedPointCount).toBe(0);
    expect(result.unmappedBoxCornerCount).toBe(0);
    expect(result.box).toEqual({ x1: 0.5, y1: 0, x2: 0.9, y2: 0.6 });
  });

  it('reports a partially visible box instead of silently dropping corners', () => {
    const result = normalizeSam2Prompts(
      { box: { x1: 0, y1: 0, x2: 10, y2: 10 } },
      mapper({ '0,0': { x: -10, y: -20 }, '10,10': { x: 220, y: 120 } }),
      200,
      100,
    );
    expect(result.box).toBeUndefined();
    expect(result.unmappedPointCount).toBe(0);
    expect(result.unmappedBoxCornerCount).toBe(2);
  });

  it('reports a point outside the visible image instead of dropping it', () => {
    const result = normalizeSam2Prompts(
      { points: [{ x: 10, y: 20, label: 1 }] },
      mapper({}),
      200,
      100,
    );
    expect(result.points).toEqual([]);
    expect(result.unmappedPointCount).toBe(1);
    expect(result.unmappedBoxCornerCount).toBe(0);
  });
});

describe('source-space prompted selection', () => {
  it('keeps the exact detector box while adding manually mapped points', () => {
    expect(
      mergeSam2NormalizedPrompts(
        {
          box: { x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 },
          unmappedPointCount: 0,
          unmappedBoxCornerCount: 0,
        },
        {
          points: [{ x: 0.4, y: 0.5, label: 0 }],
          box: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
          unmappedPointCount: 0,
          unmappedBoxCornerCount: 0,
        },
      ),
    ).toEqual({
      points: [{ x: 0.4, y: 0.5, label: 0 }],
      box: { x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 },
      unmappedPointCount: 0,
      unmappedBoxCornerCount: 0,
    });
  });

  it('preserves a detector box without treating normalized coordinates as world units', () => {
    const result = normalizeSourceSam2Prompts({
      box: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.8 },
    });
    expect(result).toEqual({
      box: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.8 },
      unmappedPointCount: 0,
      unmappedBoxCornerCount: 0,
    });
  });

  it('maps source detector geometry to a display envelope while retaining source accuracy', () => {
    const result = mapSourceSam2PromptsToWorld(
      { box: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.8 } },
      sourceMapper((point) => ({ x: point.x * 2 + 100, y: point.y * 3 - 40 })),
      101,
      201,
    );
    expect(result).toEqual({
      box: { x1: 150, y1: 20, x2: 250, y2: 440 },
    });
  });

  it('rejects malformed or unmappable automated geometry instead of guessing', () => {
    expect(
      normalizeSourceSam2Prompts({ box: { x1: 0.2, y1: 0.2, x2: 1.1, y2: 0.8 } })
        .unmappedBoxCornerCount,
    ).toBe(4);
    expect(
      mapSourceSam2PromptsToWorld(
        { box: { x1: 0, y1: 0, x2: 1, y2: 1 } },
        sourceMapper(() => null),
        100,
        100,
      ),
    ).toBeNull();
  });
});
