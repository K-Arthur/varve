import { beforeEach, describe, expect, it } from 'vitest';
import type { Document } from './document';
import { createDocument } from './document';
import {
  addKeyframe,
  addNodeToTimeline,
  addTrack,
  createTimeline,
  getTimeline,
  getTimelines,
  removeKeyframe,
  removeTimeline,
  removeTrack,
  renameTimeline,
  setActiveTimeline,
  updateKeyframe,
  updateTimeline,
  updateTrack,
} from './motion';
import type { AnimationKeyframe, AnimationTrack } from './motion-types';
import { createKeyframe, makeTimelineObject as makeTimeline } from './motion-types';

describe('motion-types', () => {
  it('creates a timeline with defaults', () => {
    const tl = makeTimeline('tl-1', 'Test', 5000);
    expect(tl.id).toBe('tl-1');
    expect(tl.name).toBe('Test');
    expect(tl.duration).toBe(5000);
    expect(tl.tracks).toEqual([]);
    expect(tl.defaultEasing.kind).toBe('linear');
    expect(tl.defaultFillMode).toBe('none');
    expect(tl.defaultPlaybackDirection).toBe('normal');
    expect(tl.defaultIterations).toBe(1);
  });

  it('creates a timeline with custom easing', () => {
    const tl = makeTimeline('tl-2', 'Bounce', 2000, {
      kind: 'spring',
      mass: 1,
      stiffness: 100,
      damping: 10,
    });
    expect(tl.defaultEasing.kind).toBe('spring');
  });

  it('creates a keyframe', () => {
    const kf = createKeyframe(0.5, { opacity: 0.5 });
    expect(kf.progress).toBe(0.5);
    expect(kf.value).toEqual({ opacity: 0.5 });
    expect(kf.easing).toBeUndefined();
  });

  it('creates a keyframe with easing', () => {
    const kf = createKeyframe(0, 0, { kind: 'easeOut' });
    expect(kf.easing?.kind).toBe('easeOut');
  });
});

describe('motion ops (immutable)', () => {
  let doc: Document;

  beforeEach(() => {
    doc = createDocument('motion-test');
  });

  it('creates a timeline on document', () => {
    const { doc: d1, id } = createTimeline(doc, 'Anim 1', 3000);
    expect(d1.timelines).toBeDefined();
    expect(d1.timelines?.[id]).toBeDefined();
    expect(d1.timelines?.[id]?.name).toBe('Anim 1');
    expect(d1.timelines?.[id]?.duration).toBe(3000);
    expect(d1.timelines?.[id]?.tracks).toEqual([]);
  });

  it('creates multiple timelines', () => {
    const { doc: d1 } = createTimeline(doc, 'A', 1000);
    const { doc: d2, id } = createTimeline(d1, 'B', 2000);
    const keys = Object.keys(d2.timelines!);
    expect(keys.length).toBe(2);
    expect(d2.timelines?.[id]?.name).toBe('B');
  });

  it('removes a timeline', () => {
    const { doc: d1, id } = createTimeline(doc, 'Remove Me', 1000);
    const d2 = removeTimeline(d1, id);
    expect(d2.timelines).toBeDefined();
    expect(d2.timelines?.[id]).toBeUndefined();
  });

  it('removes a timeline and unsets activeTimelineId', () => {
    const { doc: d1, id } = createTimeline(doc, 'Active', 1000);
    const d2 = setActiveTimeline(d1, id);
    expect(d2.activeTimelineId).toBe(id);
    const d3 = removeTimeline(d2, id);
    expect(d3.activeTimelineId).toBeUndefined();
  });

  it('removeTimeline is no-op for missing id', () => {
    const d1 = removeTimeline(doc, 'nonexistent');
    expect(d1).toBe(doc);
  });

  it('renames a timeline', () => {
    const { doc: d1, id } = createTimeline(doc, 'Old', 1000);
    const d2 = renameTimeline(d1, id, 'New Name');
    expect(d2.timelines?.[id]?.name).toBe('New Name');
  });

  it('renameTimeline is no-op for missing id', () => {
    const d1 = renameTimeline(doc, 'nonexistent', 'X');
    expect(d1).toBe(doc);
  });

  it('updates timeline properties', () => {
    const { doc: d1, id } = createTimeline(doc, 'Update', 1000);
    const d2 = updateTimeline(d1, id, {
      duration: 5000,
      defaultFillMode: 'forwards',
      defaultIterations: Infinity,
    });
    const tl = d2.timelines?.[id]!;
    expect(tl.duration).toBe(5000);
    expect(tl.defaultFillMode).toBe('forwards');
    expect(tl.defaultIterations).toBe(Infinity);
  });

  it('updateTimeline is no-op for missing id', () => {
    const d1 = updateTimeline(doc, 'missing', { duration: 999 });
    expect(d1).toBe(doc);
  });

  it('sets and clears active timeline', () => {
    const { doc: d1, id } = createTimeline(doc, 'Active Test', 1000);
    const d2 = setActiveTimeline(d1, id);
    expect(d2.activeTimelineId).toBe(id);
    const d3 = setActiveTimeline(d2, null);
    expect(d3.activeTimelineId).toBeUndefined();
  });

  it('adds a track to a timeline', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Track Test', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    expect(trackId).toBeTruthy();
    const track = d2.timelines?.[tlId]?.tracks[0]!;
    expect(track).toBeDefined();
    expect(track.nodeId).toBe('n1');
    expect(track.property).toBe('opacity');
    expect(track.keyframes).toEqual([]);
    expect(track.enabled).toBe(true);
  });

  it('adds multiple tracks to a timeline', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Multi', 1000);
    const { doc: d2 } = addTrack(d1, tlId, 'n1', 'opacity');
    const { doc: d3 } = addTrack(d2, tlId, 'n2', 'rotation');
    expect(d3.timelines?.[tlId]?.tracks.length).toBe(2);
  });

  it('addTrack is no-op for missing timeline', () => {
    const { doc: d1, trackId } = addTrack(doc, 'missing', 'n1', 'opacity');
    expect(d1).toBe(doc);
    expect(trackId).toBe('');
  });

  it('removes a track', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Remove Track', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = removeTrack(d2, tlId, trackId);
    expect(d3.timelines?.[tlId]?.tracks.length).toBe(0);
  });

  it('removeTrack is no-op for missing track', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Test', 1000);
    const d2 = removeTrack(d1, tlId, 'nonexistent');
    expect(d2).toBe(d1);
  });

  it('updates a track', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Update Track', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = updateTrack(d2, tlId, trackId, { property: 'rotation', enabled: false });
    const track = d3.timelines?.[tlId]?.tracks[0]!;
    expect(track.property).toBe('rotation');
    expect(track.enabled).toBe(false);
  });

  it('adds a keyframe to a track', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'KF Test', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0, value: 1 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 1, value: 0 });
    const kfs = d4.timelines?.[tlId]?.tracks[0]?.keyframes!;
    expect(kfs.length).toBe(2);
    expect(kfs[0]?.progress).toBe(0);
    expect(kfs[1]?.progress).toBe(1);
  });

  it('replaces keyframe at same progress', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Replace KF', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0.5, value: 0.5 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 0.5, value: 0.8 });
    expect(d4.timelines?.[tlId]?.tracks[0]?.keyframes.length).toBe(1);
    expect(d4.timelines?.[tlId]?.tracks[0]?.keyframes[0]?.value).toBe(0.8);
  });

  it('maintains sorted keyframe order', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Sort KF', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 1, value: 0 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 0, value: 1 });
    const d5 = addKeyframe(d4, tlId, trackId, { progress: 0.5, value: 0.5 });
    const kfs = d5.timelines?.[tlId]?.tracks[0]?.keyframes!;
    expect(kfs[0]?.progress).toBe(0);
    expect(kfs[1]?.progress).toBe(0.5);
    expect(kfs[2]?.progress).toBe(1);
  });

  it('removes a keyframe by progress', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Remove KF', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0, value: 1 });
    const d4 = addKeyframe(d3, tlId, trackId, { progress: 1, value: 0 });
    const d5 = removeKeyframe(d4, tlId, trackId, 0);
    expect(d5.timelines?.[tlId]?.tracks[0]?.keyframes.length).toBe(1);
    expect(d5.timelines?.[tlId]?.tracks[0]?.keyframes[0]?.progress).toBe(1);
  });

  it('removeKeyframe is no-op for missing progress', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Test', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = removeKeyframe(d2, tlId, trackId, 0.999);
    expect(d3).toBe(d2);
  });

  it('updates a keyframe', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Update KF', 1000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'n1', 'opacity');
    const d3 = addKeyframe(d2, tlId, trackId, { progress: 0, value: 1 });
    const d4 = updateKeyframe(d3, tlId, trackId, 0, {
      value: 0.5,
      easing: { kind: 'easeOut' },
    });
    const kf = d4.timelines?.[tlId]?.tracks[0]?.keyframes[0] as AnimationKeyframe;
    expect(kf.value).toBe(0.5);
    expect(kf.easing?.kind).toBe('easeOut');
  });

  it('adds a node to a timeline with an initial value', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Node Add', 1000);
    const { doc: d2, trackId } = addNodeToTimeline(d1, tlId, 'n1', 'opacity', 1);
    expect(trackId).toBeTruthy();
    const track = d2.timelines?.[tlId]?.tracks[0] as AnimationTrack;
    expect(track.nodeId).toBe('n1');
    expect(track.keyframes.length).toBe(1);
    expect((track.keyframes[0] as AnimationKeyframe).value).toBe(1);
  });

  it('addNodeToTimeline without initial value', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Node Add No Val', 1000);
    const { doc: d2 } = addNodeToTimeline(d1, tlId, 'n1', 'opacity');
    const track = d2.timelines?.[tlId]?.tracks[0] as AnimationTrack;
    expect(track.keyframes).toEqual([]);
  });

  it('getTimelines returns empty object when no timelines', () => {
    expect(getTimelines(doc)).toEqual({});
  });

  it('getTimelines returns all timelines', () => {
    const { doc: d1 } = createTimeline(doc, 'A', 1000);
    const { doc: d2 } = createTimeline(d1, 'B', 2000);
    expect(Object.keys(getTimelines(d2))).toHaveLength(2);
  });

  it('getTimeline returns undefined for missing id', () => {
    expect(getTimeline(doc, 'nonexistent')).toBeUndefined();
  });

  it('getTimeline returns the timeline', () => {
    const { doc: d1, id } = createTimeline(doc, 'Get Me', 1000);
    const tl = getTimeline(d1, id);
    expect(tl).toBeDefined();
    expect(tl?.name).toBe('Get Me');
  });

  it('preserves document immutability', () => {
    const original = { ...doc };
    const { doc: d1 } = createTimeline(doc, 'Immutable', 1000);
    expect(doc.timelines).toBeUndefined();
    expect(d1.timelines).toBeDefined();
    expect(Object.keys(original)).toEqual(Object.keys(doc));
  });

  it('handles addKeyframe on missing timeline', () => {
    const d1 = addKeyframe(doc, 'missing', 'track-id', { progress: 0, value: 1 });
    expect(d1).toBe(doc);
  });

  it('handles removeKeyframe on missing track', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Test', 1000);
    const d2 = removeKeyframe(d1, tlId, 'missing', 0.5);
    expect(d2).toBe(d1);
  });

  it('tracks keep their order when added sequentially', () => {
    const { doc: d1, id: tlId } = createTimeline(doc, 'Order', 1000);
    const { doc: d2 } = addTrack(d1, tlId, 'n1', 'opacity');
    const { doc: d3 } = addTrack(d2, tlId, 'n2', 'rotation');
    const { doc: d4 } = addTrack(d3, tlId, 'n3', 'scale');
    const tracks = d4.timelines?.[tlId]?.tracks!;
    expect((tracks[0] as AnimationTrack).property).toBe('opacity');
    expect((tracks[1] as AnimationTrack).property).toBe('rotation');
    expect((tracks[2] as AnimationTrack).property).toBe('scale');
  });
});
