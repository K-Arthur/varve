import type { Timeline } from '@varve/scene';
import { addKeyframe, addTrack, createDocument, createTimeline } from '@varve/scene';
import { describe, expect, it } from 'vitest';
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
    const tl = makeTimeline({
      tracks: [{ id: 'tr-1', nodeId: 'n1', property: 'opacity', keyframes: [] }],
    });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.size).toBe(0);
  });

  it('samples a single keyframe (constant value)', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 0.5 }],
        },
      ],
    });
    const result = sampleTimeline(tl, 2500);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0.5);
  });

  it('interpolates between two keyframes', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 1 },
          ],
        },
      ],
    });
    const result = sampleTimeline(tl, 2500); // halfway
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0.5);
  });

  it('interpolates at a specific offset', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'rotation',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 360 },
          ],
        },
      ],
    });
    expect(sampleTimeline(tl, 250).overrides.get('n1')?.get('rotation')).toBe(90);
    expect(sampleTimeline(tl, 500).overrides.get('n1')?.get('rotation')).toBe(180);
    expect(sampleTimeline(tl, 750).overrides.get('n1')?.get('rotation')).toBe(270);
  });

  it('handles three keyframes', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'x',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 0.5, value: 100 },
            { progress: 1, value: 0 },
          ],
        },
      ],
    });
    expect(sampleTimeline(tl, 0).overrides.get('n1')?.get('x')).toBe(0);
    expect(sampleTimeline(tl, 250).overrides.get('n1')?.get('x')).toBe(50);
    expect(sampleTimeline(tl, 500).overrides.get('n1')?.get('x')).toBe(100);
    expect(sampleTimeline(tl, 750).overrides.get('n1')?.get('x')).toBe(50);
  });

  it('handles disabled tracks', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 1 }],
          enabled: false,
        },
        {
          id: 'tr-2',
          nodeId: 'n1',
          property: 'rotation',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 360 },
          ],
          enabled: true,
        },
      ],
    });
    const result = sampleTimeline(tl, 2500);
    expect(result.overrides.get('n1')?.has('opacity')).toBe(false);
    expect(result.overrides.get('n1')?.get('rotation')).toBe(180);
  });

  it('suppresses muted tracks and isolates solo tracks', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'muted',
          nodeId: 'muted-node',
          property: 'opacity',
          muted: true,
          keyframes: [{ progress: 0, value: 0.25 }],
        },
        {
          id: 'solo',
          nodeId: 'solo-node',
          property: 'opacity',
          solo: true,
          keyframes: [{ progress: 0, value: 0.5 }],
        },
        {
          id: 'other',
          nodeId: 'other-node',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 0.75 }],
        },
      ],
    });
    const overrides = sampleTimeline(tl, 0).overrides;
    expect(overrides.has('muted-node')).toBe(false);
    expect(overrides.get('solo-node')?.get('opacity')).toBe(0.5);
    expect(overrides.has('other-node')).toBe(false);
  });

  it('samples multiple nodes', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 1 },
            { progress: 1, value: 0 },
          ],
        },
        {
          id: 'tr-2',
          nodeId: 'n2',
          property: 'x',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 200 },
          ],
        },
      ],
    });
    const result = sampleTimeline(tl, 500);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0.5);
    expect(result.overrides.get('n2')?.get('x')).toBe(100);
    expect(result.overrides.size).toBe(2);
  });

  it('handles 0-duration timeline (no crash)', () => {
    const tl = makeTimeline({
      duration: 0,
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 1 }],
        },
      ],
    });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(1);
  });

  it('applies per-keyframe easing', () => {
    const tl = makeTimeline({
      duration: 1000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 1, easing: { kind: 'easeOut' } },
          ],
        },
      ],
    });
    const eased = sampleTimeline(tl, 250).overrides.get('n1')?.get('opacity') as number;
    // With easeOut, value at t=0.25 should be > 0.25 (starts fast, ends slow)
    expect(eased).toBeGreaterThan(0.25);
  });

  it('samples at time 0', () => {
    const tl = makeTimeline({
      duration: 1000,
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 1 },
          ],
        },
      ],
    });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0);
  });

  describe('timing model', () => {
    it('honors fill mode forwards after active interval', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultFillMode: 'forwards',
        defaultIterations: 1,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 1500).overrides.get('n1')?.get('opacity')).toBe(1);
    });

    it('honors fill mode backwards before active interval', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultFillMode: 'backwards',
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, -500).overrides.get('n1')?.get('opacity')).toBe(0);
    });

    it('fill mode none removes overrides outside active interval', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultFillMode: 'none',
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, -500).overrides.size).toBe(0);
      expect(sampleTimeline(tl, 1500).overrides.size).toBe(0);
    });

    it('supports reverse playback direction', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultPlaybackDirection: 'reverse',
        defaultFillMode: 'both',
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 0).overrides.get('n1')?.get('opacity')).toBe(1);
      expect(sampleTimeline(tl, 1000).overrides.get('n1')?.get('opacity')).toBe(0);
      expect(sampleTimeline(tl, 500).overrides.get('n1')?.get('opacity')).toBe(0.5);
    });

    it('supports alternate playback direction', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultPlaybackDirection: 'alternate',
        defaultIterations: 2,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 250).overrides.get('n1')?.get('opacity')).toBe(0.25);
      expect(sampleTimeline(tl, 1250).overrides.get('n1')?.get('opacity')).toBe(0.75);
    });

    it('supports multiple iterations', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultIterations: 3,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 2500).overrides.get('n1')?.get('opacity')).toBe(0.5);
    });

    it('supports loop via Infinity iterations', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultIterations: Infinity,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 3500).overrides.get('n1')?.get('opacity')).toBe(0.5);
    });
  });

  describe('interpolation strategies', () => {
    it('uses discrete interpolation when requested', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultFillMode: 'forwards',
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'opacity',
            interpolation: 'discrete',
            keyframes: [
              { progress: 0, value: 'a' },
              { progress: 0.5, value: 'b' },
              { progress: 1, value: 'c' },
            ],
          },
        ],
      });
      expect(sampleTimeline(tl, 0).overrides.get('n1')?.get('opacity')).toBe('a');
      expect(sampleTimeline(tl, 499).overrides.get('n1')?.get('opacity')).toBe('a');
      expect(sampleTimeline(tl, 500).overrides.get('n1')?.get('opacity')).toBe('b');
      expect(sampleTimeline(tl, 999).overrides.get('n1')?.get('opacity')).toBe('b');
      expect(sampleTimeline(tl, 1000).overrides.get('n1')?.get('opacity')).toBe('c');
    });
  });

  describe('typed interpolation', () => {
    it('interpolates RGB color values', () => {
      const tl = makeTimeline({
        duration: 1000,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'fill',
            keyframes: [
              { progress: 0, value: [0, 0, 0, 255] },
              { progress: 1, value: [255, 255, 255, 255] },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 500).overrides.get('n1')?.get('fill') as number[];
      expect(result[0]).toBe(127.5);
      expect(result[1]).toBe(127.5);
      expect(result[2]).toBe(127.5);
    });

    it('interpolates affine transforms', () => {
      const tl = makeTimeline({
        duration: 1000,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'transform',
            keyframes: [
              { progress: 0, value: [1, 0, 0, 1, 0, 0] },
              { progress: 1, value: [1, 0, 0, 1, 100, 200] },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 500).overrides.get('n1')?.get('transform') as number[];
      expect(result).toEqual([1, 0, 0, 1, 50, 100]);
    });
  });

  describe('spatial bezier interpolation', () => {
    it('interpolates position along a bezier curve with spatial tangents', () => {
      const tl = makeTimeline({
        duration: 1000,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'position',
            interpolation: 'bezier',
            keyframes: [
              {
                progress: 0,
                value: [0, 0],
                spatialTangents: { ti: [0, 0], to: [50, 100] },
              },
              {
                progress: 1,
                value: [100, 0],
                spatialTangents: { ti: [50, -100], to: [0, 0] },
              },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 500).overrides.get('n1')?.get('position') as number[];
      expect(result[0]).toBe(50);
      expect(result[1]).toBe(75);
    });

    it('returns from value at t=0 with spatial tangents', () => {
      const tl = makeTimeline({
        duration: 1000,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'position',
            interpolation: 'bezier',
            keyframes: [
              {
                progress: 0,
                value: [10, 20],
                spatialTangents: { ti: [0, 0], to: [30, 40] },
              },
              {
                progress: 1,
                value: [100, 200],
                spatialTangents: { ti: [10, 10], to: [0, 0] },
              },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 0).overrides.get('n1')?.get('position') as number[];
      expect(result[0]).toBe(10);
      expect(result[1]).toBe(20);
    });

    it('returns to value at t=1 with spatial tangents', () => {
      const tl = makeTimeline({
        duration: 1000,
        defaultFillMode: 'forwards',
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'position',
            interpolation: 'bezier',
            keyframes: [
              {
                progress: 0,
                value: [10, 20],
                spatialTangents: { ti: [0, 0], to: [30, 40] },
              },
              {
                progress: 1,
                value: [100, 200],
                spatialTangents: { ti: [10, 10], to: [0, 0] },
              },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 1000).overrides.get('n1')?.get('position') as number[];
      expect(result[0]).toBe(100);
      expect(result[1]).toBe(200);
    });

    it('falls back to linear when bezier interpolation has no spatial tangents', () => {
      const tl = makeTimeline({
        duration: 1000,
        tracks: [
          {
            id: 'tr-1',
            nodeId: 'n1',
            property: 'position',
            interpolation: 'bezier',
            keyframes: [
              { progress: 0, value: [0, 0] },
              { progress: 1, value: [100, 200] },
            ],
          },
        ],
      });
      const result = sampleTimeline(tl, 500).overrides.get('n1')?.get('position') as number[];
      expect(result[0]).toBe(50);
      expect(result[1]).toBe(100);
    });
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
    const doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'test', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0, value: 1 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 1, value: 0 });

    const result = sampleTimelineAt(d4, tlId, 500);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0.5);
  });
});

describe('composite operations', () => {
  it('adds numeric values when composite is add', () => {
    const tl = makeTimeline({
      tracks: [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          composite: 'add',
          keyframes: [
            { progress: 0, value: 0.2 },
            { progress: 1, value: 0.3 },
          ],
        },
        {
          id: 'tr-2',
          nodeId: 'n1',
          property: 'opacity',
          composite: 'add',
          keyframes: [
            { progress: 0, value: 0.1 },
            { progress: 1, value: 0.1 },
          ],
        },
      ],
    });
    const result = sampleTimeline(tl, 0);
    expect(result.overrides.get('n1')?.get('opacity')).toBeCloseTo(0.3);
  });
});

describe('findKeyframeSegmentIndex hot path', () => {
  it('1000-keyframe track midpoint matches linear reference', async () => {
    const { findKeyframeSegmentIndex } = await import('./TimelineSampler');
    const keyframes = Array.from({ length: 1000 }, (_, i) => ({
      progress: i / 999,
      value: i,
    }));
    const tl = makeTimeline({
      duration: 1000,
      tracks: [{ id: 'tr-1', nodeId: 'n1', property: 'opacity', keyframes }],
    });

    let linearRef = 0;
    for (let i = 0; i < keyframes.length - 1; i++) {
      const before = keyframes[i]!;
      const after = keyframes[i + 1]!;
      if (0.5 >= before.progress && 0.5 <= after.progress) {
        const range = after.progress - before.progress;
        const localT = range > 0 ? (0.5 - before.progress) / range : 0;
        linearRef =
          (before.value as number) + ((after.value as number) - (before.value as number)) * localT;
        break;
      }
    }

    const result = sampleTimeline(tl, 500).overrides.get('n1')?.get('opacity');
    expect(result).toBeCloseTo(linearRef, 5);
    expect(findKeyframeSegmentIndex(keyframes, 0.5)).toBe(499);
  });
});

describe('nested timeline sampling', () => {
  it('at startProgress returns nested t=0 values', () => {
    const doc = createDocument();
    const nested: Timeline = {
      id: 'tl-nested',
      name: 'Nested',
      duration: 2000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'ntr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0.2 },
            { progress: 1, value: 1 },
          ],
        },
      ],
    };
    const parent: Timeline = {
      id: 'tl-parent',
      name: 'Parent',
      duration: 4000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'ptr-1',
          nodeId: 'unused',
          property: 'opacity',
          keyframes: [],
          nestedTimelineId: 'tl-nested',
          nestedStartProgress: 0.25,
        },
      ],
    };
    const fullDoc = {
      ...doc,
      timelines: { 'tl-parent': parent, 'tl-nested': nested },
    };

    const before = sampleTimelineAt(fullDoc, 'tl-parent', 500);
    expect(before.overrides.size).toBe(0);

    const atStart = sampleTimelineAt(fullDoc, 'tl-parent', 1000);
    expect(atStart.overrides.get('n1')?.get('opacity')).toBe(0.2);
  });

  it('nested overrides win on property conflict', () => {
    const doc = createDocument();
    const nested: Timeline = {
      id: 'tl-nested',
      name: 'Nested',
      duration: 1000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'ntr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 0.9 }],
        },
      ],
    };
    const parent: Timeline = {
      id: 'tl-parent',
      name: 'Parent',
      duration: 1000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'ptr-direct',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [{ progress: 0, value: 0.1 }],
        },
        {
          id: 'ptr-nested',
          nodeId: 'unused',
          property: 'opacity',
          keyframes: [],
          nestedTimelineId: 'tl-nested',
          nestedStartProgress: 0,
        },
      ],
    };
    const fullDoc = {
      ...doc,
      timelines: { 'tl-parent': parent, 'tl-nested': nested },
    };

    const result = sampleTimelineAt(fullDoc, 'tl-parent', 0);
    expect(result.overrides.get('n1')?.get('opacity')).toBe(0.9);
  });
});

describe('sampler cache', () => {
  it('invalidateSamplerCache clears generation', async () => {
    const { invalidateSamplerCache, getSamplerCacheGeneration } = await import('./TimelineSampler');
    const before = getSamplerCacheGeneration();
    invalidateSamplerCache();
    expect(getSamplerCacheGeneration()).toBeGreaterThan(before);
  });
});
