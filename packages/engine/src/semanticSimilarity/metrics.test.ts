import { describe, expect, it } from 'vitest';
import { evaluateRetrieval } from './metrics';

describe('semantic retrieval metrics', () => {
  it('computes recall, average precision, and reciprocal rank separately from ranking', () => {
    const metrics = evaluateRetrieval(
      [
        { queryId: 'q1', relevantIds: new Set(['a', 'b']) },
        { queryId: 'q2', relevantIds: new Set(['c']) },
      ],
      new Map([
        ['q1', ['x', 'a', 'b']],
        ['q2', ['c', 'y']],
      ]),
    );
    expect(metrics.recallAt1).toBe(0.5);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.meanAveragePrecision).toBeCloseTo((0.5833333333 + 1) / 2);
    expect(metrics.meanReciprocalRank).toBeCloseTo((0.5 + 1) / 2);
  });
});
