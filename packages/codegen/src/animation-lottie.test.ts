import type { SceneNode } from '@varve/scene';
import { createDocument, createKeyframe, makeTimelineObject } from '@varve/scene';
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
          fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
          shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 50 },
          index: 0,
          order: 'a0',
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          strokes: [],
          effects: [],
        } as unknown as SceneNode,
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

  it('exports position with separate x/y keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Move', 2000);
    tl.tracks = [
      {
        id: 'tr-x',
        nodeId: 'n1',
        property: 'transform[4]',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 200)],
      },
      {
        id: 'tr-y',
        nodeId: 'n1',
        property: 'transform[5]',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 100)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const p = parsed.layers[0].ks.p;
    expect(p.s).toBe(1);
    expect(p.x.a).toBe(1);
    expect(p.x.k).toHaveLength(2);
    expect(p.x.k[0].s[0]).toBe(0);
    expect(p.x.k[1].s[0]).toBe(200);
    expect(p.y.a).toBe(1);
    expect(p.y.k).toHaveLength(2);
    expect(p.y.k[0].s[0]).toBe(0);
    expect(p.y.k[1].s[0]).toBe(100);
  });

  it('exports position with only x track using separate dims', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'SlideX', 1000);
    tl.tracks = [
      {
        id: 'tr-x',
        nodeId: 'n1',
        property: 'transform[4]',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 150)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const p = parsed.layers[0].ks.p;
    expect(p.s).toBe(1);
    expect(p.x.a).toBe(1);
    expect(p.x.k[0].s[0]).toBe(0);
    expect(p.x.k[1].s[0]).toBe(150);
    expect(p.y.a).toBe(0);
    expect(p.y.k).toEqual([0, 0]);
  });

  it('exports position with only y track using separate dims', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'SlideY', 1000);
    tl.tracks = [
      {
        id: 'tr-y',
        nodeId: 'n1',
        property: 'transform[5]',
        keyframes: [createKeyframe(0, 50), createKeyframe(1, 300)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const p = parsed.layers[0].ks.p;
    expect(p.s).toBe(1);
    expect(p.x.a).toBe(0);
    expect(p.x.k).toEqual([0, 0]);
    expect(p.y.a).toBe(1);
    expect(p.y.k[0].s[0]).toBe(50);
    expect(p.y.k[1].s[0]).toBe(300);
  });

  it('keeps static position when no position tracks present', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Static', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const p = parsed.layers[0].ks.p;
    expect(p.a).toBe(0);
    expect(p.k).toEqual([0, 0]);
  });

  it('exports scale with both scaleX and scaleY as multi-dim keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Grow', 1000);
    tl.tracks = [
      {
        id: 'tr-sx',
        nodeId: 'n1',
        property: 'scaleX',
        keyframes: [createKeyframe(0, 0.5), createKeyframe(1, 2)],
      },
      {
        id: 'tr-sy',
        nodeId: 'n1',
        property: 'scaleY',
        keyframes: [createKeyframe(0, 0.5), createKeyframe(1, 2)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const s = parsed.layers[0].ks.s;
    expect(s.a).toBe(1);
    expect(s.k).toHaveLength(2);
    expect(s.k[0].s).toEqual([50, 50]);
    expect(s.k[1].s).toEqual([200, 200]);
  });

  it('exports scale with only scaleX as single-dim keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'ScaleX', 1000);
    tl.tracks = [
      {
        id: 'tr-sx',
        nodeId: 'n1',
        property: 'scaleX',
        keyframes: [createKeyframe(0, 1), createKeyframe(1, 1.5)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const s = parsed.layers[0].ks.s;
    expect(s.a).toBe(1);
    expect(s.k).toHaveLength(2);
    expect(s.k[0].s[0]).toBe(100);
    expect(s.k[1].s[0]).toBe(150);
  });

  it('converts scale 0-1 to Lottie 0-100 percentages', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'ScalePct', 1000);
    tl.tracks = [
      {
        id: 'tr-sx',
        nodeId: 'n1',
        property: 'scaleX',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
      {
        id: 'tr-sy',
        nodeId: 'n1',
        property: 'scaleY',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const s = parsed.layers[0].ks.s;
    expect(s.k[0].s).toEqual([0, 0]);
    expect(s.k[1].s).toEqual([100, 100]);
  });

  it('exports stroke width keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'StrokeGrow', 1000);
    tl.tracks = [
      {
        id: 'tr-sw',
        nodeId: 'n1',
        property: 'strokeWidth',
        keyframes: [createKeyframe(0, 1), createKeyframe(1, 5)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const sw = parsed.layers[0].ks.sw;
    expect(sw).toBeDefined();
    expect(sw.a).toBe(1);
    expect(sw.k).toHaveLength(2);
    expect(sw.k[0].s[0]).toBe(1);
    expect(sw.k[1].s[0]).toBe(5);
  });

  it('exports corner radius keyframes', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'RoundCorners', 1000);
    tl.tracks = [
      {
        id: 'tr-rd',
        nodeId: 'n1',
        property: 'cornerRadius',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 20)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const rd = parsed.layers[0].ks.rd;
    expect(rd).toBeDefined();
    expect(rd.a).toBe(1);
    expect(rd.k).toHaveLength(2);
    expect(rd.k[0].s[0]).toBe(0);
    expect(rd.k[1].s[0]).toBe(20);
  });

  it('omits sw/rd when no stroke/cornerRadius tracks', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Clean', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.layers[0].ks.sw).toBeUndefined();
    expect(parsed.layers[0].ks.rd).toBeUndefined();
  });

  it('handles mixed property timeline with position, scale, opacity, and rotation', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Mixed', 2000);
    tl.tracks = [
      {
        id: 'tr-px',
        nodeId: 'n1',
        property: 'transform[4]',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 300)],
      },
      {
        id: 'tr-py',
        nodeId: 'n1',
        property: 'transform[5]',
        keyframes: [createKeyframe(0, 50), createKeyframe(1, 400)],
      },
      {
        id: 'tr-sx',
        nodeId: 'n1',
        property: 'scaleX',
        keyframes: [createKeyframe(0, 0.5), createKeyframe(1, 1.2)],
      },
      {
        id: 'tr-sy',
        nodeId: 'n1',
        property: 'scaleY',
        keyframes: [createKeyframe(0, 0.5), createKeyframe(1, 1.2)],
      },
      {
        id: 'tr-o',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
      {
        id: 'tr-r',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 90)],
      },
      {
        id: 'tr-sw',
        nodeId: 'n1',
        property: 'strokeWidth',
        keyframes: [createKeyframe(0, 1), createKeyframe(1, 4)],
      },
      {
        id: 'tr-rd',
        nodeId: 'n1',
        property: 'cornerRadius',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 16)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const ks = parsed.layers[0].ks;

    expect(ks.p.s).toBe(1);
    expect(ks.p.x.k[0].s[0]).toBe(0);
    expect(ks.p.x.k[1].s[0]).toBe(300);
    expect(ks.p.y.k[0].s[0]).toBe(50);
    expect(ks.p.y.k[1].s[0]).toBe(400);

    expect(ks.s.a).toBe(1);
    expect(ks.s.k[0].s).toEqual([50, 50]);
    expect(ks.s.k[1].s).toEqual([120, 120]);

    expect(ks.o.a).toBe(1);
    expect(ks.o.k[0].s[0]).toBe(0);
    expect(ks.o.k[1].s[0]).toBe(100);

    expect(ks.r.a).toBe(1);
    expect(ks.r.k[0].s[0]).toBe(0);
    expect(ks.r.k[1].s[0]).toBe(90);

    expect(ks.sw.a).toBe(1);
    expect(ks.sw.k[0].s[0]).toBe(1);
    expect(ks.sw.k[1].s[0]).toBe(4);

    expect(ks.rd.a).toBe(1);
    expect(ks.rd.k[0].s[0]).toBe(0);
    expect(ks.rd.k[1].s[0]).toBe(16);
  });

  it('preserves position keyframe frame numbers and easing', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'EasedMove', 2000);
    tl.tracks = [
      {
        id: 'tr-x',
        nodeId: 'n1',
        property: 'transform[4]',
        keyframes: [
          createKeyframe(0, 0),
          createKeyframe(0.5, 100, { kind: 'easeIn' }),
          createKeyframe(1, 200, { kind: 'easeOut' }),
        ],
      },
      {
        id: 'tr-y',
        nodeId: 'n1',
        property: 'transform[5]',
        keyframes: [createKeyframe(0, 0), createKeyframe(0.5, 50), createKeyframe(1, 200)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const p = parsed.layers[0].ks.p;
    expect(p.s).toBe(1);
    // X keyframes
    expect(p.x.k).toHaveLength(3);
    expect(p.x.k[0].t).toBe(0);
    expect(p.x.k[1].t).toBe(30);
    expect(p.x.k[2].t).toBe(60);
    expect(p.x.k[0].s[0]).toBe(0);
    expect(p.x.k[1].s[0]).toBe(100);
    expect(p.x.k[2].s[0]).toBe(200);
    // Y keyframes
    expect(p.y.k).toHaveLength(3);
    expect(p.y.k[0].s[0]).toBe(0);
    expect(p.y.k[1].s[0]).toBe(50);
    expect(p.y.k[2].s[0]).toBe(200);
  });

  it('exports fill color keyframes with RGB conversion', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'FillAnim', 1000);
    tl.tracks = [
      {
        id: 'tr-fc',
        nodeId: 'n1',
        property: 'fill',
        keyframes: [
          createKeyframe(0, { r: 255, g: 0, b: 0, a: 255 }),
          createKeyframe(1, { r: 0, g: 0, b: 255, a: 255 }),
        ],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const fc = parsed.layers[0].ks.fc;
    expect(fc).toBeDefined();
    expect(fc.a).toBe(1);
    expect(fc.k).toHaveLength(2);
    expect(fc.k[0].s[0]).toBeCloseTo(1);
    expect(fc.k[0].s[1]).toBeCloseTo(0);
    expect(fc.k[0].s[2]).toBeCloseTo(0);
    expect(fc.k[1].s[0]).toBeCloseTo(0);
    expect(fc.k[1].s[1]).toBeCloseTo(0);
    expect(fc.k[1].s[2]).toBeCloseTo(1);
  });

  it('exports stroke color keyframes with RGB conversion', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'StrokeAnim', 1000);
    tl.tracks = [
      {
        id: 'tr-sc',
        nodeId: 'n1',
        property: 'stroke',
        keyframes: [
          createKeyframe(0, { r: 0, g: 0, b: 0, a: 255 }),
          createKeyframe(1, { r: 128, g: 128, b: 128, a: 255 }),
        ],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    const sc = parsed.layers[0].ks.sc;
    expect(sc).toBeDefined();
    expect(sc.a).toBe(1);
    expect(sc.k).toHaveLength(2);
    expect(sc.k[0].s[0]).toBeCloseTo(0);
    expect(sc.k[1].s[0]).toBeCloseTo(128 / 255);
  });

  it('omits fc/sc when no fill/stroke color tracks', () => {
    const doc = docWithNodes(['n1']);
    const tl = makeTimelineObject('tl1', 'Clean', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const parsed = JSON.parse(timelineToLottieJSON(tl, doc));
    expect(parsed.layers[0].ks.fc).toBeUndefined();
    expect(parsed.layers[0].ks.sc).toBeUndefined();
  });
});
