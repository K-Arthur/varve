import {
  addKeyframe,
  addNode,
  addTrack,
  createDocument,
  createTimeline,
  getKeyframeCount,
  getNodesInTimeline,
  makeShapeNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeKeyframeCounts } from './LayersTree';

describe('computeKeyframeCounts', () => {
  it('matches getKeyframeCount for every animated node', () => {
    let doc = createDocument();

    const { id: a, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeShapeNode(a, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'A' }));

    const { id: b, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeShapeNode(b, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'B' }));

    const { id: timelineId, doc: d3 } = createTimeline(doc, 'Timeline 1', 1000);
    doc = d3;

    const { doc: d4, trackId: trackA } = addTrack(doc, timelineId, a, 'opacity');
    doc = d4;
    doc = addKeyframe(doc, timelineId, trackA, { progress: 0, value: 1 });
    doc = addKeyframe(doc, timelineId, trackA, { progress: 1, value: 0 });

    const { doc: d5, trackId: trackB } = addTrack(doc, timelineId, b, 'x');
    doc = d5;
    doc = addKeyframe(doc, timelineId, trackB, { progress: 0.5, value: 100 });

    const animatedNodes = getNodesInTimeline(doc);
    const counts = computeKeyframeCounts(doc, animatedNodes);

    expect(counts.get(a)).toBe(getKeyframeCount(doc, a));
    expect(counts.get(a)).toBe(2);
    expect(counts.get(b)).toBe(getKeyframeCount(doc, b));
    expect(counts.get(b)).toBe(1);
  });

  it('returns an empty map when nothing is animated', () => {
    const doc = createDocument();
    const counts = computeKeyframeCounts(doc, new Set());
    expect(counts.size).toBe(0);
  });
});
