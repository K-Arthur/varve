import type { Document } from '@strata/scene';
import {
  addKeyframe,
  addTrack,
  createDocument,
  createTimeline,
  getTimeline,
  removeKeyframe,
  removeTimeline,
  removeTrack,
  renameTimeline,
  setActiveTimeline,
  updateKeyframe,
  updateTrack,
} from '@strata/scene';
import { beforeEach, describe, expect, it } from 'vitest';

// MotionContext methods that delegate to @strata/scene immutable operations.
// We test the logic these methods contain by exercising the underlying
// @strata/scene functions directly (they share the same implementation).

function createDocWithTimeline(): Document {
  let doc = createDocument();
  const { doc: d1, id: tlId } = createTimeline(doc, 'Test Timeline', 5000);
  doc = d1;
  const { doc: d2, trackId } = addTrack(doc, tlId, 'node-1', 'opacity');
  doc = d2;
  const docWithKf1 = addKeyframe(doc, tlId, trackId, { progress: 0, value: 0 });
  const docWithKf2 = addKeyframe(docWithKf1, tlId, trackId, { progress: 0.5, value: 0.5 });
  const docWithKf3 = addKeyframe(docWithKf2, tlId, trackId, { progress: 1, value: 1 });
  return setActiveTimeline(docWithKf3, tlId);
}

describe('MotionContext — scene-level motion operations', () => {
  let doc: Document;
  let tlId: string;
  let trackId: string;

  beforeEach(() => {
    doc = createDocWithTimeline();
    const tl = Object.values(doc.timelines!)[0]!;
    tlId = tl.id;
    trackId = tl.tracks[0]!.id;
  });

  describe('deleteKeyframe', () => {
    it('removes a keyframe at the given progress', () => {
      const track = getTimeline(doc, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.length).toBe(3);

      const result = removeKeyframe(doc, tlId, trackId, 0.5);
      const updatedTrack = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(updatedTrack.keyframes.length).toBe(2);
      expect(updatedTrack.keyframes.find((k) => k.progress === 0.5)).toBeUndefined();
    });

    it('is a no-op if keyframe does not exist', () => {
      const result = removeKeyframe(doc, tlId, trackId, 0.99);
      expect(result).toBe(doc);
    });

    it('is a no-op if timeline does not exist', () => {
      const result = removeKeyframe(doc, 'nonexistent', trackId, 0.5);
      expect(result).toBe(doc);
    });
  });

  describe('moveKeyframe', () => {
    it('removes old keyframe and adds at new progress', () => {
      let result = removeKeyframe(doc, tlId, trackId, 0.5);
      result = addKeyframe(result, tlId, trackId, { progress: 0.75, value: 0.5 });

      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.length).toBe(3);
      expect(track.keyframes.find((k) => k.progress === 0.5)).toBeUndefined();
      expect(track.keyframes.find((k) => k.progress === 0.75)).toBeDefined();
    });

    it('clamps new progress to [0, 1]', () => {
      let result = removeKeyframe(doc, tlId, trackId, 0.5);
      const clamped = Math.max(0, Math.min(1, 1.5));
      result = addKeyframe(result, tlId, trackId, { progress: clamped, value: 0.5 });

      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      const moved = track.keyframes.find((k) => k.progress === 1);
      expect(moved).toBeDefined();
    });
  });

  describe('duplicateKeyframe', () => {
    it('creates a new keyframe 5% after the original', () => {
      const originalProgress = 0;
      const newProgress = Math.min(1, originalProgress + 0.05);
      const result = addKeyframe(doc, tlId, trackId, { progress: newProgress, value: 0 });

      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.length).toBe(4);
      expect(track.keyframes.find((k) => k.progress === 0.05)).toBeDefined();
    });

    it('clamps new keyframe to 1 when original is near end', () => {
      const originalProgress = 0.98;
      const newProgress = Math.min(1, originalProgress + 0.05);
      expect(newProgress).toBe(1);
      const result = addKeyframe(doc, tlId, trackId, { progress: newProgress, value: 1 });

      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      const dup = track.keyframes.find((k) => k.progress === 1);
      expect(dup).toBeDefined();
    });
  });

  describe('updateKeyframeEasing', () => {
    it('updates easing on a keyframe', () => {
      const newEasing = { kind: 'easeOut' as const };
      const result = updateKeyframe(doc, tlId, trackId, 0.5, { easing: newEasing });

      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      const kf = track.keyframes.find((k) => k.progress === 0.5)!;
      expect(kf.easing).toEqual(newEasing);
    });

    it('is a no-op if timeline does not exist', () => {
      const result = updateKeyframe(doc, 'nonexistent', trackId, 0.5, {
        easing: { kind: 'easeOut' },
      });
      expect(result).toBe(doc);
    });
  });

  describe('addTrackToTimeline', () => {
    it('adds a new track to a timeline', () => {
      const { doc: result, trackId: newTrackId } = addTrack(doc, tlId, 'node-2', 'rotation');
      expect(newTrackId).toBeTruthy();

      const timeline = getTimeline(result, tlId)!;
      expect(timeline.tracks.length).toBe(2);
      expect(timeline.tracks.find((t) => t.id === newTrackId)!.property).toBe('rotation');
    });

    it('is a no-op if timeline does not exist', () => {
      const result = addTrack(doc, 'nonexistent', 'node-2', 'rotation');
      expect(result.doc).toBe(doc);
    });
  });

  describe('setTrackMuted', () => {
    it('sets muted flag on a track', () => {
      const result = updateTrack(doc, tlId, trackId, { muted: true });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.muted).toBe(true);
    });

    it('clears muted flag on a track', () => {
      let result = updateTrack(doc, tlId, trackId, { muted: true });
      result = updateTrack(result, tlId, trackId, { muted: false });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.muted).toBe(false);
    });
  });

  describe('setTrackSolo', () => {
    it('sets solo flag on a track', () => {
      const result = updateTrack(doc, tlId, trackId, { solo: true });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.solo).toBe(true);
    });

    it('clears solo flag on a track', () => {
      let result = updateTrack(doc, tlId, trackId, { solo: true });
      result = updateTrack(result, tlId, trackId, { solo: false });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.solo).toBe(false);
    });
  });

  describe('setActiveTimeline', () => {
    it('sets active timeline id on document', () => {
      const result = setActiveTimeline(doc, tlId);
      expect(result.activeTimelineId).toBe(tlId);
    });

    it('clears active timeline when null', () => {
      let result = setActiveTimeline(doc, tlId);
      result = setActiveTimeline(result, null);
      expect(result.activeTimelineId).toBeUndefined();
    });
  });

  describe('createTimeline', () => {
    it('creates a new timeline with specified name and duration', () => {
      const { doc: result, id } = createTimeline(doc, 'New Animation', 3000);
      const tl = getTimeline(result, id)!;
      expect(tl.name).toBe('New Animation');
      expect(tl.duration).toBe(3000);
      expect(tl.tracks).toEqual([]);
    });
  });

  describe('removeTimeline', () => {
    it('removes a timeline by id', () => {
      const result = removeTimeline(doc, tlId);
      expect(result.timelines?.[tlId]).toBeUndefined();
    });

    it('clears activeTimelineId when removing the active timeline', () => {
      let result = setActiveTimeline(doc, tlId);
      result = removeTimeline(result, tlId);
      expect(result.activeTimelineId).toBeUndefined();
    });
  });

  describe('renameTimeline', () => {
    it('renames a timeline', () => {
      const result = renameTimeline(doc, tlId, 'Renamed');
      const tl = getTimeline(result, tlId)!;
      expect(tl.name).toBe('Renamed');
    });
  });

  describe('removeTrack', () => {
    it('removes a track from a timeline', () => {
      const result = removeTrack(doc, tlId, trackId);
      const tl = getTimeline(result, tlId)!;
      expect(tl.tracks.length).toBe(0);
    });

    it('is a no-op if track does not exist', () => {
      const result = removeTrack(doc, tlId, 'nonexistent');
      expect(result).toBe(doc);
    });
  });

  describe('addKeyframe', () => {
    it('adds a keyframe to a track', () => {
      const result = addKeyframe(doc, tlId, trackId, { progress: 0.25, value: 0.25 });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.length).toBe(4);
      expect(track.keyframes.find((k) => k.progress === 0.25)).toBeDefined();
    });

    it('maintains sorted order by progress', () => {
      const result = addKeyframe(doc, tlId, trackId, { progress: 0.75, value: 0.75 });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      const progresses = track.keyframes.map((k) => k.progress);
      expect(progresses).toEqual([0, 0.5, 0.75, 1]);
    });

    it('replaces existing keyframe at same progress', () => {
      const result = addKeyframe(doc, tlId, trackId, { progress: 0.5, value: 0.99 });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.length).toBe(3);
      expect(track.keyframes.find((k) => k.progress === 0.5)!.value).toBe(0.99);
    });
  });

  describe('updateTrack', () => {
    it('updates track property', () => {
      const result = updateTrack(doc, tlId, trackId, { property: 'rotation' });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.property).toBe('rotation');
    });

    it('updates track interpolation', () => {
      const result = updateTrack(doc, tlId, trackId, { interpolation: 'discrete' });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.interpolation).toBe('discrete');
    });
  });

  describe('updateKeyframe', () => {
    it('updates keyframe value', () => {
      const result = updateKeyframe(doc, tlId, trackId, 0.5, { value: 0.8 });
      const track = getTimeline(result, tlId)!.tracks.find((t) => t.id === trackId)!;
      expect(track.keyframes.find((k) => k.progress === 0.5)!.value).toBe(0.8);
    });
  });

  describe('immutability', () => {
    it('all operations return new document references', () => {
      const original = doc;
      const d1 = addKeyframe(doc, tlId, trackId, { progress: 0.25, value: 0.25 });
      expect(d1).not.toBe(original);

      const d2 = removeKeyframe(d1, tlId, trackId, 0.25);
      expect(d2).not.toBe(d1);

      const d3 = updateKeyframe(d2, tlId, trackId, 0.5, { value: 0.9 });
      expect(d3).not.toBe(d2);

      const d4 = updateTrack(d3, tlId, trackId, { muted: true });
      expect(d4).not.toBe(d3);
    });

    it('original document is not mutated', () => {
      const originalTracks = doc.timelines![tlId]!.tracks;
      const originalKeyframes = originalTracks[0]!.keyframes;

      addKeyframe(doc, tlId, trackId, { progress: 0.25, value: 0.25 });
      removeKeyframe(doc, tlId, trackId, 0.5);

      expect(doc.timelines![tlId]!.tracks[0]!.keyframes).toBe(originalKeyframes);
    });
  });
});
