// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { computeForceLayout } from '../computeForceLayout';

describe('computeForceLayout', () => {
  it('returns grid fallback when no edges', () => {
    const nodes = [
      { id: 'a', width: 50, height: 50 },
      { id: 'b', width: 50, height: 50 },
      { id: 'c', width: 50, height: 50 },
    ];
    const result = computeForceLayout(nodes, [], { width: 400, height: 400 });

    expect(result).toHaveLength(3);
    // Fallback grid: nodes placed in a grid pattern
    expect(result[0]).toMatchObject({ id: 'a' });
    expect(result[1]).toMatchObject({ id: 'b' });
    expect(result[2]).toMatchObject({ id: 'c' });
  });

  it('returns correct count of results', () => {
    const nodes = [
      { id: 'a', width: 50, height: 50 },
      { id: 'b', width: 50, height: 50 },
    ];
    const edges = [{ source: 'a', target: 'b' }];
    const result = computeForceLayout(nodes, edges, {
      width: 200,
      height: 200,
      idealLength: 80,
      maxIterations: 10,
    });
    expect(result).toHaveLength(2);
  });

  it('returns empty for no nodes', () => {
    const result = computeForceLayout([], []);
    expect(result).toEqual([]);
  });
});
