/**
 * Immutable motion operations on the Document.
 *
 * All functions follow the immutable pattern established by document.ts:
 * each returns a new Document with the mutation applied, never mutating
 * the input document.
 *
 * Timelines are stored on Document.timelines as Record<string, Timeline>.
 */
import type { EasingDefinition } from '@varve/shared';
import type { Document } from './document';
import type { AnimationKeyframe, AnimationTrack, Timeline } from './motion-types';
import { makeTimelineObject } from './motion-types';
import type { NodeId } from './types';

function timelineId(): string {
  return `tl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trackId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Timeline CRUD ────────────────────────────────────────────────────────────

/** Create a new timeline and add it to the document. */
export function createTimeline(
  doc: Document,
  name: string,
  duration: number,
  defaultEasing?: EasingDefinition,
): { doc: Document; id: string } {
  const id = timelineId();
  const timeline = makeTimelineObject(id, name, duration, defaultEasing);
  return {
    doc: {
      ...doc,
      timelines: { ...(doc.timelines ?? {}), [id]: timeline },
    },
    id,
  };
}

/** Remove a timeline by id. No-op if not found. */
export function removeTimeline(doc: Document, timelineId: string): Document {
  if (!doc.timelines?.[timelineId]) return doc;
  const next = { ...doc.timelines };
  delete next[timelineId];
  const result: Document = { ...doc, timelines: next };
  if (doc.activeTimelineId === timelineId) {
    result.activeTimelineId = undefined;
  }
  return result;
}

/** Rename a timeline. No-op if not found. */
export function renameTimeline(doc: Document, timelineId: string, name: string): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, name },
    },
  };
}

/** Update timeline properties (duration, defaultEasing, playback defaults). */
export function updateTimeline(
  doc: Document,
  timelineId: string,
  updates: Partial<
    Pick<
      Timeline,
      | 'duration'
      | 'defaultEasing'
      | 'defaultFillMode'
      | 'defaultPlaybackDirection'
      | 'defaultIterations'
      | 'autoReverse'
      | 'name'
    >
  >,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, ...updates },
    },
  };
}

/** Set the active timeline id (or null to deactivate). */
export function setActiveTimeline(doc: Document, timelineId: string | null): Document {
  return { ...doc, activeTimelineId: timelineId ?? undefined };
}

// ── Track CRUD ───────────────────────────────────────────────────────────────

/** Add a track to a timeline. Returns the new document and track id. */
export function addTrack(
  doc: Document,
  timelineId: string,
  nodeId: NodeId,
  property: string,
  opts?: { interpolation?: 'linear' | 'discrete' | 'bezier' | 'path'; enabled?: boolean },
): { doc: Document; trackId: string } {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return { doc, trackId: '' };

  const id = trackId();
  const track: AnimationTrack = {
    id,
    nodeId,
    property,
    keyframes: [],
    interpolation: opts?.interpolation ?? 'linear',
    enabled: opts?.enabled ?? true,
  };

  return {
    doc: {
      ...doc,
      timelines: {
        ...doc.timelines,
        [timelineId]: {
          ...timeline,
          tracks: [...timeline.tracks, track],
        },
      },
    },
    trackId: id,
  };
}

/** Remove a track from a timeline. No-op if not found. */
export function removeTrack(doc: Document, timelineId: string, trackId: string): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  if (!timeline.tracks.some((t) => t.id === trackId)) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: {
        ...timeline,
        tracks: timeline.tracks.filter((t) => t.id !== trackId),
      },
    },
  };
}

/** Update track properties. */
export function updateTrack(
  doc: Document,
  timelineId: string,
  trackId: string,
  updates: Partial<
    Pick<
      AnimationTrack,
      | 'property'
      | 'interpolation'
      | 'composite'
      | 'enabled'
      | 'nodeId'
      | 'nestedTimelineId'
      | 'nestedStartProgress'
      | 'muted'
      | 'solo'
    >
  >,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  if (!timeline.tracks.some((t) => t.id === trackId)) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: {
        ...timeline,
        tracks: timeline.tracks.map((t) => {
          if (t.id !== trackId) return t;
          const next: AnimationTrack = { ...t, ...updates };
          if ('nestedTimelineId' in updates && updates.nestedTimelineId === undefined) {
            delete next.nestedTimelineId;
          }
          if ('nestedStartProgress' in updates && updates.nestedStartProgress === undefined) {
            delete next.nestedStartProgress;
          }
          return next;
        }),
      },
    },
  };
}

// ── Keyframe CRUD ────────────────────────────────────────────────────────────

/** Add a keyframe to a track. Maintains sorted order by progress. */
export function addKeyframe(
  doc: Document,
  timelineId: string,
  trackId: string,
  keyframe: AnimationKeyframe,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  if (!timeline.tracks.some((t) => t.id === trackId)) return doc;

  const tracks = timeline.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const existing = t.keyframes.findIndex((k) => k.progress === keyframe.progress);
    let next: AnimationKeyframe[];
    if (existing >= 0) {
      // Replace at same progress
      next = [...t.keyframes];
      next[existing] = keyframe;
    } else {
      next = [...t.keyframes, keyframe];
    }
    next.sort((a, b) => a.progress - b.progress);
    return { ...t, keyframes: next };
  });

  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, tracks },
    },
  };
}

/** Remove a keyframe by progress value. No-op if not found. */
export function removeKeyframe(
  doc: Document,
  timelineId: string,
  trackId: string,
  progress: number,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track?.keyframes.some((k) => k.progress === progress)) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: {
        ...timeline,
        tracks: timeline.tracks.map((t) =>
          t.id === trackId
            ? { ...t, keyframes: t.keyframes.filter((k) => k.progress !== progress) }
            : t,
        ),
      },
    },
  };
}

/** Update a keyframe by progress. */
export function updateKeyframe(
  doc: Document,
  timelineId: string,
  trackId: string,
  progress: number,
  updates: Partial<AnimationKeyframe>,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: {
        ...timeline,
        tracks: timeline.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                keyframes: t.keyframes.map((k) =>
                  k.progress === progress ? { ...k, ...updates } : k,
                ),
              }
            : t,
        ),
      },
    },
  };
}

/** Convenience: add a node to a timeline with an initial keyframe on a property. */
export function addNodeToTimeline(
  doc: Document,
  timelineId: string,
  nodeId: NodeId,
  property: string,
  initialValue?: unknown,
): { doc: Document; trackId: string } {
  const { doc: d1, trackId } = addTrack(doc, timelineId, nodeId, property);
  if (!trackId) return { doc, trackId: '' };

  if (initialValue !== undefined) {
    const d2 = addKeyframe(d1, timelineId, trackId, { progress: 0, value: initialValue });
    return { doc: d2, trackId };
  }
  return { doc: d1, trackId };
}

/** Get all timelines on a document. */
export function getTimelines(doc: Document): Record<string, Timeline> {
  return doc.timelines ?? {};
}

/** Get a single timeline by id. */
export function getTimeline(doc: Document, timelineId: string): Timeline | undefined {
  return doc.timelines?.[timelineId];
}

/**
 * Returns a Set of NodeIds that have animation keyframes in any timeline.
 */
export function getNodesInTimeline(doc: Document): Set<NodeId> {
  const result = new Set<NodeId>();
  if (!doc.timelines) return result;
  for (const timeline of Object.values(doc.timelines)) {
    for (const track of timeline.tracks) {
      if (track.nodeId) result.add(track.nodeId);
    }
  }
  return result;
}

/**
 * Returns the number of keyframes for a given node across all timelines.
 */
export function getKeyframeCount(doc: Document, nodeId: NodeId): number {
  if (!doc.timelines) return 0;
  let count = 0;
  for (const timeline of Object.values(doc.timelines)) {
    for (const track of timeline.tracks) {
      if (track.nodeId === nodeId) {
        count += track.keyframes.length;
      }
    }
  }
  return count;
}

// ── Timeline markers ─────────────────────────────────────────────────────────

export function addTimelineMarker(
  doc: Document,
  timelineId: string,
  marker: import('./motion-types').TimelineMarker,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  const markers = [...(timeline.markers ?? []), marker];
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, markers },
    },
  };
}

export function removeTimelineMarker(
  doc: Document,
  timelineId: string,
  markerId: string,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  const markers = (timeline.markers ?? []).filter((m) => m.id !== markerId);
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, markers },
    },
  };
}

/** Rename a timeline marker. No-op if not found. */
export function renameTimelineMarker(
  doc: Document,
  timelineId: string,
  markerId: string,
  name: string,
): Document {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return doc;
  const markers = (timeline.markers ?? []).map((m) => (m.id === markerId ? { ...m, name } : m));
  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [timelineId]: { ...timeline, markers },
    },
  };
}

// ── Motion presets ───────────────────────────────────────────────────────────

function presetId(): string {
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMotionPreset(
  doc: Document,
  timelineId: string,
  name: string,
): { doc: Document; id: string } {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return { doc, id: '' };
  const id = presetId();
  const preset: import('./motion-types').MotionPreset = {
    id,
    name,
    timelineId,
    duration: timeline.duration,
  };
  return {
    doc: {
      ...doc,
      motionPresets: { ...(doc.motionPresets ?? {}), [id]: preset },
    },
    id,
  };
}

export function removeMotionPreset(doc: Document, presetId: string): Document {
  if (!doc.motionPresets?.[presetId]) return doc;
  const next = { ...doc.motionPresets };
  delete next[presetId];
  return { ...doc, motionPresets: next };
}

/** Copy tracks from a preset's source timeline onto the target timeline. */
export function applyMotionPreset(
  doc: Document,
  presetId: string,
  targetTimelineId: string,
): Document {
  const preset = doc.motionPresets?.[presetId];
  if (!preset) return doc;
  const sourceTimeline = doc.timelines?.[preset.timelineId];
  const targetTimeline = doc.timelines?.[targetTimelineId];
  if (!sourceTimeline || !targetTimeline) return doc;

  const copiedTracks: AnimationTrack[] = sourceTimeline.tracks.map((track) => ({
    ...track,
    id: trackId(),
    keyframes: track.keyframes.map((k) => ({ ...k })),
  }));

  return {
    ...doc,
    timelines: {
      ...doc.timelines,
      [targetTimelineId]: {
        ...targetTimeline,
        duration: Math.max(targetTimeline.duration, preset.duration),
        tracks: [...targetTimeline.tracks, ...copiedTracks],
      },
    },
  };
}
