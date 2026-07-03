import { describe, expect, it } from 'vitest';
import { createTimeline, addTrack, addKeyframe, createDocument } from '@strata/scene';
import type { Timeline, AnimationKeyframe } from '@strata/scene';
import { sampleTimeline, sampleTimelineAt } from './TimelineSampler';

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'tl-1',
    name: 'Test',
    duration: 5000,
    defaultEasing: { kind: 'linear' },
    tracks: [],
    ...overrides,
  };
}

describe('sampleTimeline', () => {
  it('returns empty overrides for empty timeline', () => {
    const tl = makeTimeline();
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.size).toBe(0);
  });

  it('returns empty overrides for timeline with empty tracks', () => {
    const tl = makeTimeline({ tracks: [{ id: 'tr-1', nodeId: 'n1', property: 'opacity', keyframes: [] }] });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.size).toBe(0);
  });

  it('samples a single keyframe (constant value)', () => {
    const tl = makeTimeline({
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'opacity',
        keyframes: [{ progress: 0, value: 0.5 }],
      }],
    });
    const result = sampleTimeline(tl, 2500);
    expect(result.overrides.get('n1')!.get('opacity')).toBe(0.5);
  });

  it('interpolates between two keyframes', () => {
    const tl = makeTimeline({
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1 },
        ],
      }],
    });
    const result = sampleTimeline(tl, 2500); // halfway
    expect(result.overrides.get('n1')!.get('opacity')).toBe(0.5);
  });

  it('interpolates at a specific offset', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'rotation',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 360 },
        ],
      }],
    });
    expect(sampleTimeline(tl, 250).overrides.get('n1')!.get('rotation')).toBe(90);
    expect(sampleTimeline(tl, 500).overrides.get('n1')!.get('rotation')).toBe(180);
    expect(sampleTimeline(tl, 750).overrides.get('n1')!.get('rotation')).toBe(270);
  });

  it('handles three keyframes', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'x',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 0.5, value: 100 },
          { progress: 1, value: 0 },
        ],
      }],
    });
    expect(sampleTimeline(tl, 0).overrides.get('n1')!.get('x')).toBe(0);
    expect(sampleTimeline(tl, 250).overrides.get('n1')!.get('x')).toBe(50);
    expect(sampleTimeline(tl, 500).overrides.get('n1')!.get('x')).toBe(100);
    expect(sampleTimeline(tl, 750).overrides.get('n1')!.get('x')).toBe(50);
  });

  it('handles disabled tracks', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'tr-1', nodeId: 'n1', property: 'opacity',
          keyframes: [{ progress: 0, value: 1 }],
          enabled: false,
        },
        {
          id: 'tr-2', nodeId: 'n1', property: 'rotation',
          keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 360 }],
          enabled: true,
        },
      ],
    });
    const result = sampleTimeline(tl, 2500);
    expect(result.overrides.get('n1')!.has('opacity')).toBe(false);
    expect(result.overrides.get('n1')!.get('rotation')).toBe(180);
  });

  it('samples multiple nodes', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [
        {
          id: 'tr-1', nodeId: 'n1', property: 'opacity',
          keyframes: [{ progress: 0, value: 1 }, { progress: 1, value: 0 }],
        },
        {
          id: 'tr-2', nodeId: 'n2', property: 'x',
          keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 200 }],
        },
      ],
    });
    const result = sampleTimeline(tl, 500);
    expect(result.overrides.get('n1')!.get('opacity')).toBe(0.5);
    expect(result.overrides.get('n2')!.get('x')).toBe(100);
    expect(result.overrides.size).toBe(2);
  });

  it('handles 0-duration timeline (no crash)', () => {
    const tl = makeTimeline({
      duration: 0,
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'opacity',
        keyframes: [{ progress: 0, value: 1 }],
      }],
    });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.get('n1')!.get('opacity')).toBe(1);
  });

  it('applies per-keyframe easing', () => {
    const tl = makeTimeline({
      duration: 1000,
      defaultEasing: { kind: 'linear' },
      tracks: [{
        id: 'tr-1', nodeId: 'n1', property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1, easing: { kind: 'easeOut' } },
        ],
      }],
    });
    const linear = sampleTimeline(tl, 500).overrides.get('n1')!.get('opacity') as number;
    // With easeOut, value at t=0.5 should be > 0.5 (starts fast, ends slow)
    expect(linear).toBeGreaterThan(0.5);
  });
});

describe('sampleTimelineAt (document integration)', () => {
  it('returns empty for missing timeline id', () => {
    const doc = createDocument('test');
    const result = sampleTimelineAt(doc, 'nonexistent', 0);
    expect(result.overrides.size).toBe(0);
  });

  it('returns empty for document without timelines', () => {
    const doc = createDocument('test');
    const result = sampleTimelineAt(doc, 'tl-1', 0);
    expect(result.overrides.size).toBe(0);
  });

  it('samples from document timeline', () => {
    let doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'test', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0, value: 1 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 1, value: 0 });

    const result = sampleTimelineAt(d4, tlId, 500);
    expect(result.overrides.get('n1')!.get('opacity')).toBe(0.5);
  });
});
