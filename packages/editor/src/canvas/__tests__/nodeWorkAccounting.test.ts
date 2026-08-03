import { describe, expect, it } from 'vitest';
import {
  comparePartialRedraw,
  createNodeWorkCounters,
  type NodeWorkCounters,
  NodeWorkRing,
  nodeWorkRatios,
  rectsIntersect,
} from '../nodeWorkAccounting';

function counters(overrides: Partial<NodeWorkCounters> = {}): NodeWorkCounters {
  return { ...createNodeWorkCounters(), ...overrides };
}

describe('rectsIntersect', () => {
  const base = { x: 0, y: 0, w: 10, h: 10 };

  it('detects overlap', () => {
    expect(rectsIntersect(base, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('treats edge-touching rectangles as disjoint', () => {
    // The dirty rect is already padded by an anti-aliasing margin, so a node
    // exactly on the boundary contributes no pixels.
    expect(rectsIntersect(base, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('handles containment and full separation', () => {
    expect(rectsIntersect(base, { x: 2, y: 2, w: 1, h: 1 })).toBe(true);
    expect(rectsIntersect(base, { x: 100, y: 100, w: 1, h: 1 })).toBe(false);
  });

  it('handles negative coordinates', () => {
    expect(rectsIntersect({ x: -20, y: -20, w: 10, h: 10 }, { x: -15, y: -15, w: 10, h: 10 })).toBe(
      true,
    );
  });
});

describe('nodeWorkRatios', () => {
  it('returns zero rather than NaN for a quiet frame', () => {
    const ratios = nodeWorkRatios(createNodeWorkCounters());
    for (const value of Object.values(ratios)) expect(value).toBe(0);
  });

  it('reports lost pruning when accepted nodes miss the dirty region', () => {
    const ratios = nodeWorkRatios(
      counters({ totalSceneNodes: 1000, acceptedForReplay: 200, prunableByDirty: 190 }),
    );
    expect(ratios.repaintRatio).toBeCloseTo(0.2, 5);
    expect(ratios.lostPruningRatio).toBeCloseTo(0.95, 5);
  });

  it('exposes a fixed visible-list cost as testedPerCandidate near 1', () => {
    const ratios = nodeWorkRatios(counters({ candidates: 5_000, visibilityTested: 5_000 }));
    expect(ratios.testedPerCandidate).toBe(1);
  });
});

describe('comparePartialRedraw', () => {
  it('reports proportional tracking when node work falls with dirty area', () => {
    const result = comparePartialRedraw(
      { dirtyArea: 1000, counters: counters({ candidates: 1000, acceptedForReplay: 1000 }) },
      { dirtyArea: 100, counters: counters({ candidates: 100, acceptedForReplay: 100 }) },
    );
    expect(result.dirtyAreaReduction).toBeCloseTo(0.9, 5);
    expect(result.replayedNodeReduction).toBeCloseTo(0.9, 5);
    expect(result.workTrackingRatio).toBeCloseTo(1, 5);
  });

  it('exposes a smaller rectangle that bought no less node work', () => {
    // The case that justifies restructuring: dirty area collapses 90% while
    // the replayed-node count is unchanged.
    const result = comparePartialRedraw(
      { dirtyArea: 1000, counters: counters({ acceptedForReplay: 1000 }) },
      { dirtyArea: 100, counters: counters({ acceptedForReplay: 1000 }) },
    );
    expect(result.dirtyAreaReduction).toBeCloseTo(0.9, 5);
    expect(result.replayedNodeReduction).toBe(0);
    expect(result.workTrackingRatio).toBe(0);
  });

  it('does not divide by a zero baseline', () => {
    const result = comparePartialRedraw(
      { dirtyArea: 0, counters: createNodeWorkCounters() },
      { dirtyArea: 0, counters: createNodeWorkCounters() },
    );
    expect(result.workTrackingRatio).toBe(0);
    expect(result.dirtyAreaReduction).toBe(0);
  });

  it('clamps a frame that did more work than the baseline', () => {
    const result = comparePartialRedraw(
      { dirtyArea: 100, counters: counters({ acceptedForReplay: 10 }) },
      { dirtyArea: 500, counters: counters({ acceptedForReplay: 50 }) },
    );
    expect(result.dirtyAreaReduction).toBe(0);
    expect(result.replayedNodeReduction).toBe(0);
  });
});

describe('NodeWorkRing', () => {
  it('stays bounded over a long session', () => {
    const ring = new NodeWorkRing();
    for (let i = 0; i < NodeWorkRing.MAX_SAMPLES * 3; i++) {
      ring.record(counters({ acceptedForReplay: i }));
    }
    expect(ring.count).toBe(NodeWorkRing.MAX_SAMPLES);
    // The retained window is the most recent one.
    const recent = ring.recent(1);
    expect(recent[0]?.acceptedForReplay).toBe(NodeWorkRing.MAX_SAMPLES * 3 - 1);
  });

  it('clears on reset', () => {
    const ring = new NodeWorkRing();
    ring.record(createNodeWorkCounters());
    ring.reset();
    expect(ring.count).toBe(0);
  });
});
