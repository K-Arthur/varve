/**
 * Timeline sampler — reads a Timeline from the Document and produces
 * per-node property overrides at a given current time.
 *
 * These overrides are ephemeral: they are applied to engine nodes during
 * rendering but never written back to the immutable Document. This means
 * animation playback doesn't dirty the document or create undo entries.
 *
 * Implements a WAAPI-style timing model: fill mode, playback direction,
 * iterations, looping, and per-track interpolation strategy.
 *
 * Research basis: Web Animations API §5 Animation model (keyframe effect
 * value computation), GSAP TweenLite.render(), Lottie interpolators.
 */
import type { AnimationKeyframe, Document, Timeline } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';
import {
  getEasingFn,
  interpolateAffine,
  interpolateColor,
  interpolateSpatialBezier,
  interpolateValue,
} from '@strata/shared';

export interface SampleResult {
  overrides: Map<string, Map<string, unknown>>;
}

export interface SampleOptions {
  /** Fill mode: what to show before/after the active interval. */
  fillMode?: Timeline['defaultFillMode'];
  /** Playback direction. */
  direction?: Timeline['defaultPlaybackDirection'];
  /** Number of iterations. Infinity means loop forever. */
  iterations?: number;
  /** Whether to reverse direction on alternating iterations. */
  autoReverse?: boolean;
}

/**
 * Sample a timeline from the document at the given currentTime.
 * Returns a map of nodeId → (property → value) overrides.
 */
export function sampleTimelineAt(
  doc: Document,
  timelineId: string,
  currentTime: number,
  options?: SampleOptions,
): SampleResult {
  const timeline = doc.timelines?.[timelineId];
  if (!timeline) return { overrides: new Map() };

  return sampleTimeline(timeline, currentTime, options);
}

/**
 * Sample a Timeline object at the given currentTime.
 * Separated from the doc-lookup to allow unit testing with inline timelines.
 */
export function sampleTimeline(
  timeline: Timeline,
  currentTime: number,
  options?: SampleOptions,
): SampleResult {
  const overrides = new Map<string, Map<string, unknown>>();
  const duration = timeline.duration > 0 ? timeline.duration : 1;
  const fillMode = options?.fillMode ?? timeline.defaultFillMode ?? 'none';
  const direction = options?.direction ?? timeline.defaultPlaybackDirection ?? 'normal';
  const iterations = options?.iterations ?? timeline.defaultIterations ?? 1;
  const autoReverse = options?.autoReverse ?? timeline.autoReverse ?? false;

  const effectiveDirection = autoReverse && direction === 'normal' ? 'alternate' : direction;

  const timing = computeActiveInterval(
    currentTime,
    duration,
    iterations,
    fillMode,
    effectiveDirection,
  );

  for (const track of timeline.tracks) {
    if (track.enabled === false || track.keyframes.length === 0) continue;

    const val = interpolateTrack(
      track.keyframes,
      timing.progress,
      timeline.defaultEasing,
      track.interpolation ?? 'linear',
    );

    if (val !== undefined && !timing.inactive) {
      if (!overrides.has(track.nodeId)) {
        overrides.set(track.nodeId, new Map());
      }
      overrides.get(track.nodeId)!.set(track.property, val);
    }
  }

  return { overrides };
}

interface TimingResult {
  /** Progress within a single iteration [0, 1]. */
  progress: number;
  /** Whether the current time is outside the active interval and fill is 'none'. */
  inactive: boolean;
}

function computeActiveInterval(
  currentTime: number,
  duration: number,
  iterations: number,
  fillMode: NonNullable<Timeline['defaultFillMode']>,
  direction: NonNullable<Timeline['defaultPlaybackDirection']>,
): TimingResult {
  const isInfinite = iterations === Infinity || Number.isNaN(iterations);
  const activeDuration = isInfinite ? Infinity : duration * Math.max(0, iterations);

  // Before the active interval: fill backwards/both applies.
  if (currentTime < 0) {
    if (fillMode === 'none' || fillMode === 'forwards') {
      return { progress: 0, inactive: true };
    }
    return {
      progress: direction === 'reverse' || direction === 'alternate-reverse' ? 1 : 0,
      inactive: false,
    };
  }

  // After the active interval: fill forwards/both applies.
  if (!isInfinite && currentTime >= activeDuration) {
    if (fillMode === 'none' || fillMode === 'backwards') {
      return { progress: 1, inactive: true };
    }
    // Use the final iteration's direction to determine the resting value.
    const lastIteration = Math.max(0, Math.ceil(iterations) - 1);
    const finalProgress = directionToProgress(lastIteration, direction);
    return { progress: finalProgress, inactive: false };
  }

  // Inside the active interval.
  const iterationIndex = Math.floor(currentTime / duration);
  const iterationOffset = currentTime - iterationIndex * duration;
  const normalized = duration > 0 ? iterationOffset / duration : 0;
  const progress = directionToProgress(iterationIndex, direction, normalized);
  return { progress, inactive: false };
}

function directionToProgress(
  iterationIndex: number,
  direction: NonNullable<Timeline['defaultPlaybackDirection']>,
  normalized = 1,
): number {
  switch (direction) {
    case 'normal':
      return normalized;
    case 'reverse':
      return 1 - normalized;
    case 'alternate':
      return iterationIndex % 2 === 0 ? normalized : 1 - normalized;
    case 'alternate-reverse':
      return iterationIndex % 2 === 1 ? normalized : 1 - normalized;
    default:
      return normalized;
  }
}

function interpolateTrack(
  keyframes: AnimationKeyframe[],
  progress: number,
  defaultEasing: EasingDefinition,
  interpolation: NonNullable<import('@strata/scene').AnimationTrack['interpolation']>,
): unknown {
  if (keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0]!.value;

  // Sort by progress (defensive — should already be sorted)
  const sorted = [...keyframes].sort((a, b) => a.progress - b.progress);

  // Discrete: hold the previous keyframe value until the next keyframe.
  if (interpolation === 'discrete') {
    let selected = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      const kf = sorted[i]!;
      if (progress >= kf.progress) {
        selected = kf;
      } else {
        break;
      }
    }
    return selected.value;
  }

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

      // Easing is defined on the destination keyframe (WAAPI convention).
      const easingDef = after.easing ?? defaultEasing;
      const easingFn = getEasingFn(easingDef);
      const easedT = easingFn(localT);

      // Spatial bezier interpolation for position/path tracks with tangents.
      if (interpolation === 'bezier' && before.spatialTangents && after.spatialTangents) {
        return interpolateSpatialBezier(
          before.value,
          after.value,
          easedT,
          before.spatialTangents,
          after.spatialTangents,
        );
      }

      return interpolateTypedValue(before.value, after.value, easedT);
    }
  }

  return sorted[sorted.length - 1]!.value;
}

function interpolateTypedValue(from: unknown, to: unknown, t: number): unknown {
  // Check affine first: 6-element numeric arrays are transforms, not colors.
  const fromAffine = tryParseAffine(from);
  const toAffine = tryParseAffine(to);
  if (fromAffine && toAffine) {
    return interpolateAffine(fromAffine, toAffine, t);
  }

  const fromColor = tryParseColor(from);
  const toColor = tryParseColor(to);
  if (fromColor && toColor) {
    return interpolateColor(fromColor, toColor, t);
  }

  return interpolateValue(from, to, t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tryParseColor(v: unknown): string | number[] | null {
  if (typeof v === 'string' && v.startsWith('#')) return v;
  if (
    isRecord(v) &&
    'space' in v &&
    (v.space === 'rgb' || v.space === 'cmyk' || v.space === 'gray' || v.space === 'spot')
  ) {
    if (v.space === 'rgb') {
      const c = v as { r: number; g: number; b: number; a?: number };
      return [c.r, c.g, c.b, c.a ?? 255];
    }
    if (v.space === 'gray') {
      const c = v as { v: number; a?: number };
      return [c.v, c.v, c.v, c.a ?? 255];
    }
    // CMYK/spot fall back to generic interpolation via object path.
    return null;
  }
  if (
    Array.isArray(v) &&
    v.length >= 3 &&
    v.length !== 6 &&
    v.every((n) => typeof n === 'number')
  ) {
    return v as number[];
  }
  return null;
}

function tryParseAffine(v: unknown): import('@strata/shared').Affine | null {
  if (Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number')) {
    return v as unknown as import('@strata/shared').Affine;
  }
  return null;
}
