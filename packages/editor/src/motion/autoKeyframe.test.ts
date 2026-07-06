import {
  addKeyframe,
  addNode,
  addTrack,
  createDocument,
  createTimeline,
  type Document,
  makeShapeNode,
  type NodeId,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { type AutoKeyframeContext, applyAutoKeyframes, shouldAutoKeyframe } from './autoKeyframe';

function makeShapeDoc(): { doc: Document; nodeId: NodeId; timelineId: string } {
  const doc = createDocument('test');
  const r = nextNodeId(doc);
  const node = makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { name: 'Rect' });
  const withNode = addNode(r.doc, node);
  const { doc: withTl, id: timelineId } = createTimeline(withNode, 'Main', 2000);
  return { doc: withTl, nodeId: r.id, timelineId };
}

describe('autoKeyframe', () => {
  it('shouldAutoKeyframe is true when playing with auto mode on', () => {
    const ctx: AutoKeyframeContext = {
      autoKeyframe: true,
      isPlaying: true,
      activeTimelineId: 'tl-1',
      currentTime: 500,
      selection: ['n1'],
    };
    expect(shouldAutoKeyframe(ctx)).toBe(true);
  });

  it('shouldAutoKeyframe is false when not playing', () => {
    const ctx: AutoKeyframeContext = {
      autoKeyframe: true,
      isPlaying: false,
      activeTimelineId: 'tl-1',
      currentTime: 500,
      selection: ['n1'],
    };
    expect(shouldAutoKeyframe(ctx)).toBe(false);
  });

  it('inserts opacity keyframe at currentTime while playing', () => {
    const { doc, nodeId, timelineId } = makeShapeDoc();
    const ctx: AutoKeyframeContext = {
      autoKeyframe: true,
      isPlaying: true,
      activeTimelineId: timelineId,
      currentTime: 1000,
      selection: [nodeId],
    };
    const next = applyAutoKeyframes(doc, ctx, 'opacity');
    const timeline = next.timelines?.[timelineId];
    expect(timeline?.tracks).toHaveLength(1);
    expect(timeline?.tracks[0]?.property).toBe('opacity');
    expect(timeline?.tracks[0]?.keyframes[0]?.progress).toBe(0.5);
  });

  it('updates existing track keyframe at current progress', () => {
    const { doc, nodeId, timelineId } = makeShapeDoc();
    const { doc: d1, trackId } = addTrack(doc, timelineId, nodeId, 'opacity');
    const d2 = addKeyframe(d1, timelineId, trackId, { progress: 0.5, value: 0.25 });
    const ctx: AutoKeyframeContext = {
      autoKeyframe: true,
      isPlaying: true,
      activeTimelineId: timelineId,
      currentTime: 1000,
      selection: [nodeId],
    };
    const next = applyAutoKeyframes(d2, ctx, 'opacity');
    const track = next.timelines?.[timelineId]?.tracks[0];
    expect(track?.keyframes).toHaveLength(1);
    expect(track?.keyframes[0]?.value).toBe(1);
  });
});
