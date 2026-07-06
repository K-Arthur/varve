import { describe, expect, it } from 'vitest';
import type { Timeline } from '@strata/scene';
import { sampleTimeline } from '../../editor/src/timeline/TimelineSampler';

function makeHeavyTimeline(trackCount: number, keyframesPerTrack: number): Timeline {
  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    const keyframes = [];
    for (let k = 0; k < keyframesPerTrack; k++) {
      keyframes.push({
        progress: k / (keyframesPerTrack - 1),
        value: k,
        easing: { kind: 'linear' as const },
      });
    }
    tracks.push({
      id: `tr-${t}`,
      nodeId: `n-${t}`,
      property: 'opacity',
      keyframes,
    });
  }
  return {
    id: 'bench',
    name: 'Bench',
    duration: 5000,
    tracks,
    defaultEasing: { kind: 'linear' },
  };
}

describe('motion sampler benchmark', () => {
  it('samples 100 tracks x 10 keyframes under 16ms budget', () => {
    const timeline = makeHeavyTimeline(100, 10);
    const start = performance.now();
    for (let i = 0; i < 60; i++) {
      sampleTimeline(timeline, (i / 60) * timeline.duration);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(16 * 60);
  });
});
