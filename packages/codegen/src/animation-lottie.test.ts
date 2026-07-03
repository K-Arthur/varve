import { createDocument, createKeyframe, makeTimelineObject } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { timelineToLottieJSON } from './animation-lottie';

function docWithNodes(ids: string[]) {
  let doc = createDocument('Test');
  for (const id of ids) {
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [id]: {
          id,
          name: `Node-${id}`,
          kind: 'shape' as const,
          visible: true,
          transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
          fill: [57, 208, 198, 255] as [number, number, number, number],
          shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 50 },
        },
      },
    };
  }
  return doc;
}

describe('timelineToLottieJSON', () => {
  it('returns valid Lottie v5.5 JSON for empty timeline', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Empty', 1000);
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.v).toBe('5.5.2');
    expect(parsed.fr).toBe(30);
    expect(parsed.ip).toBe(0);
    expect(parsed.op).toBe(30);
    expect(parsed.layers).toEqual([]);
  });

  it('creates a layer with animated opacity from two keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Fade', 2000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].nm).toBe('Node-n1');
    expect(parsed.layers[0].ks.o.a).toBe(1);
    expect(parsed.layers[0].ks.o.k).toHaveLength(2);
    expect(parsed.op).toBe(60);
  });

  it('creates layer with animated rotation', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Spin', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 360)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.layers[0].ks.r.a).toBe(1);
    expect(parsed.layers[0].ks.r.k).toHaveLength(2);
  });

  it('converts keyframe progress to frame numbers', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Timed', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(0.5, 50), createKeyframe(1, 100)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const k = parsed.layers[0].ks.o.k;
    expect(k).toHaveLength(3);
    expect(k[0].t).toBe(0);
    expect(k[1].t).toBe(15);
    expect(k[2].t).toBe(30);
  });

  it('maps easing to Lottie bezier handles', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Eased', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          createKeyframe(0, 0),
          createKeyframe(1, 100, { kind: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 1 }),
        ],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const k = parsed.layers[0].ks.o.k;
    // First keyframe o = start handle (x1, y1)
    expect(k[0].o.x[0]).toBeCloseTo(0.42);
    expect(k[0].o.y[0]).toBeCloseTo(0);
    // Second keyframe i = end handle (x2, y2)
    expect(k[1].i.x[0]).toBeCloseTo(1);
    expect(k[1].i.y[0]).toBeCloseTo(1);
  });

  it('handles linear easing as flat bezier handles', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Linear', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 100, { kind: 'linear' })],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const k = parsed.layers[0].ks.o.k;
    expect(k[0].o.x[0]).toBe(0);
    expect(k[0].o.y[0]).toBe(0);
    expect(k[1].i.x[0]).toBe(0);
    expect(k[1].i.y[0]).toBe(0);
  });

  it('handles multiple tracks creating separate layers', () => {
    const doc = docWithNodes(['n1', 'n2']);
    const tl = makeTimelineObject('tl1', 'Multi', 2000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
      {
        id: 'tr2',
        nodeId: 'n2',
        property: 'rotation',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 180)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.layers[0].nm).toBe('Node-n1');
    expect(parsed.layers[1].nm).toBe('Node-n2');
  });

  it('converts opacity 0-1 to Lottie 0-100', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Fade', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 1), createKeyframe(1, 0)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const k = parsed.layers[0].ks.o.k;
    expect(k[0].s[0]).toBe(100);
    expect(k[1].s[0]).toBe(0);
  });
});
