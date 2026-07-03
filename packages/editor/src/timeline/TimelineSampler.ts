/**
 * Timeline sampler — reads a Timeline from the Document and produces
 * per-node property overrides at a given current time.
 *
 * These overrides are ephemeral: they are applied to engine nodes during
 * rendering but never written back to the immutable Document. This means
 * animation playback doesn't dirty the document or create undo entries.
 *
 * Research basis: Web Animations API §5 Animation model (keyframe effect
 * value computation), GSAP TweenLite.render(), Lottie interpolators.
 */
import type { Document, Timeline, AnimationKeyframe } from '@strata/scene';
import { interpolateValue } from '@strata/shared';
import { getEasingFn } from '@strata/shared';
import type { EasingDefinition } from '@strata/shared';

export interface SampleResult {
  overrides: Map<string, Map<string, unknown>>;
}

/**
 * Sample a timeline from the document at the given currentTime.
 * Returns a map of nodeId → (property → value) overrides.
 */
export function sampleTimelineAt(
  doc: Document,
  timelineId: string,
  currentTime: number,
): SampleResult {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return { overrides: new Map() };

  return sampleTimeline(timeline, currentTime);
}

/**
 * Sample a Timeline object at the given currentTime.
 * Separated from the doc-lookup to allow unit testing with inline timelines.
 */
export function sampleTimeline(timeline: Timeline, currentTime: number): SampleResult {
  const overrides = new Map<string, Map<string, unknown>>();
  const duration = timeline.duration > 0 ? timeline.duration : 1;
  const progress = Math.max(0, Math.min(currentTime / duration, 1));

  for (const track of timeline.tracks) {
    if (track.enabled === false || track.keyframes.length === 0) continue;

    const val = interpolateTrack(track.keyframes, progress, timeline.defaultEasing);

    if (val !== undefined) {
      if (!overrides.has(track.nodeId)) {
        overrides.set(track.nodeId, new Map());
      }
      overrides.get(track.nodeId)!.set(track.property, val);
    }
  }

  return { overrides };
}

function interpolateTrack(
  keyframes: AnimationKeyframe[],
  progress: number,
  defaultEasing: EasingDefinition,
): unknown {
  if (keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0]!.value;

  // Sort by progress (defensive — should already be sorted)
  const sorted = [...keyframes].sort((a, b) => a.progress - b.progress);

  // Clamp at boundaries
  if (progress <= sorted[0]!.progress) return sorted[0]!.value;
  if (progress >= sorted[sorted.length - 1]!.progress) return sorted[sorted.length - 1]!.value;

  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const before = sorted[i]!;
    const after = sorted[i + 1]!;

    if (progress >= before.progress && progress <= after.progress) {
      const range = after.progress - before.progress;
      const localT = range > 0 ? (progress - before.progress) / range : 0;

      const easingDef = after.easing ?? defaultEasing;
      const easingFn = getEasingFn(easingDef);
      const easedT = easingFn(localT);

      return interpolateValue(before.value, after.value, easedT);
    }
  }

  return sorted[sorted.length - 1]!.value;
}
