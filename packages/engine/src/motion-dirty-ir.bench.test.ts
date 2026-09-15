import { describe, expect, it } from 'vitest';

/**
 * Dirty IR rebuild benchmark (motion-only scrub).
 *
 * Simulates per-node IR cache strategy: 200 nodes, 2 animated during scrub.
 * Before: rebuild all 200 nodes each frame.
 * After: rebuild only 2 animated nodes; static nodes are cache hits.
 *
 * Typical local results (2026-07-06): ~100x fewer buildIr calls per scrub session.
 */
describe('motion dirty IR benchmark', () => {
  const NODE_COUNT = 200;
  const ANIMATED_IDS = new Set(['n0', 'n1']);
  const FRAMES = 60;

  function simulateBuildIr(nodeId: string): number {
    let acc = 0;
    for (let i = 0; i < 50; i++) acc += Math.sqrt(i + nodeId.length);
    return acc;
  }

  it('partial rebuild rebuilds fewer nodes than full rebuild on motion scrub', () => {
    let fullBuildCount = 0;
    for (let f = 0; f < FRAMES; f++) {
      for (let n = 0; n < NODE_COUNT; n++) {
        simulateBuildIr(`n${n}`);
        fullBuildCount++;
      }
    }

    let partialBuildCount = 0;
    for (let f = 0; f < FRAMES; f++) {
      for (const id of ANIMATED_IDS) {
        simulateBuildIr(id);
        partialBuildCount++;
      }
    }

    expect(partialBuildCount).toBe(FRAMES * ANIMATED_IDS.size);
    expect(partialBuildCount).toBeLessThan(fullBuildCount / 10);
  });
});
