import {
  addKeyframe,
  addTimelineMarker,
  addTrack,
  applyMotionPreset,
  createDocument,
  createMotionPreset,
  createTimeline,
  removeMotionPreset,
  removeTimelineMarker,
  renameTimelineMarker,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

describe('motion presets and markers', () => {
  it('adds and removes timeline markers', () => {
    const doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Main', 3000);
    const d2 = addTimelineMarker(d1, tlId, { id: 'm1', name: 'Intro', progress: 0.25 });
    expect(d2.timelines?.[tlId]?.markers).toHaveLength(1);
  });

  it('creates and removes motion presets', () => {
    const doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Main', 3000);
    const { doc: d2, id: presetId } = createMotionPreset(d1, tlId, 'Fade In');
    expect(d2.motionPresets?.[presetId]?.timelineId).toBe(tlId);
    const d3 = removeMotionPreset(d2, presetId);
    expect(d3.motionPresets?.[presetId]).toBeUndefined();
  });

  it('renames a timeline marker', () => {
    const doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Main', 3000);
    const d2 = addTimelineMarker(d1, tlId, { id: 'm1', name: 'Intro', progress: 0.25 });
    const d3 = renameTimelineMarker(d2, tlId, 'm1', 'Outro');
    expect(d3.timelines?.[tlId]?.markers?.[0]?.name).toBe('Outro');
  });

  it('removes a timeline marker', () => {
    const doc = createDocument('test');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Main', 3000);
    const d2 = addTimelineMarker(d1, tlId, { id: 'm1', name: 'Intro', progress: 0.25 });
    const d3 = removeTimelineMarker(d2, tlId, 'm1');
    expect(d3.timelines?.[tlId]?.markers).toHaveLength(0);
  });

  it('applyMotionPreset copies tracks onto target timeline', () => {
    const doc = createDocument('test');
    const { doc: d1, id: srcId } = createTimeline(doc, 'Source', 3000);
    const { doc: d2, id: tgtId } = createTimeline(d1, 'Target', 5000);
    const { doc: d3, trackId: trId } = addTrack(d2, srcId, 'node-1', 'opacity');
    const d4 = addKeyframe(d3, srcId, trId, { progress: 0, value: 0 });
    const d5 = addKeyframe(d4, srcId, trId, { progress: 1, value: 1 });
    const { doc: d6, id: presetId } = createMotionPreset(d5, srcId, 'Fade');
    const d7 = applyMotionPreset(d6, presetId, tgtId);
    const target = d7.timelines?.[tgtId];
    expect(target?.tracks).toHaveLength(1);
    expect(target?.tracks[0]?.property).toBe('opacity');
    expect(target?.tracks[0]?.keyframes).toHaveLength(2);
    expect(target?.tracks[0]?.id).not.toBe(trId);
  });
});
