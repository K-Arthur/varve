import {
  createDocument,
  createTimeline,
  addTimelineMarker,
  createMotionPreset,
  removeMotionPreset,
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
});
