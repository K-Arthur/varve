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
import type { AnimationKeyframe, CompositeOperation, Document, Timeline } from '@varve/scene';
import type { EasingDefinition } from '@varve/shared';
import {
  ensureVertexMatch,
  getEasingFn,
  interpolateAffine,
  interpolateColor,
  interpolatePath,
  interpolateSpatialBezier,
  interpolateValue,
  type PathPoint,
} from '@varve/shared';

export interface SampleResult {
  overrides: Map<string, Map<string, unknown>>;
}

/** Segment cache for sorted keyframes per track. */
const trackKeyframeCache = new Map<string, AnimationKeyframe[]>();
let samplerCacheGeneration = 0;

/** Invalidate sampler caches after timeline mutations. */
export function invalidateSamplerCache(): void {
  samplerCacheGeneration++;
  trackKeyframeCache.clear();
}

export function getSamplerCacheGeneration(): number {
  return samplerCacheGeneration;
}

function getSortedKeyframes(trackId: string, keyframes: AnimationKeyframe[]): AnimationKeyframe[] {
  const fingerprint = keyframes
    .map((k) => `${k.progress}:${String(k.value)}:${JSON.stringify(k.easing ?? null)}`)
    .join('|');
  const cacheKey = `${samplerCacheGeneration}:${trackId}:${fingerprint}`;
  const cached = trackKeyframeCache.get(cacheKey);
  if (cached) return cached;
  const sorted = [...keyframes].sort((a, b) => a.progress - b.progress);
  trackKeyframeCache.set(cacheKey, sorted);
  return sorted;
}

function applyComposite(
  op: CompositeOperation | undefined,
  existing: unknown,
  incoming: unknown,
): unknown {
  if (existing === undefined || op === 'replace' || !op) return incoming;
  if (op === 'add' || op === 'accumulate') {
    if (typeof existing === 'number' && typeof incoming === 'number') {
      return existing + incoming;
    }
  }
  return incoming;
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

  return sampleTimeline(timeline, currentTime, options, doc);
}

/**
 * Sample a Timeline object at the given currentTime.
 * Separated from the doc-lookup to allow unit testing with inline timelines.
 */
export function sampleTimeline(
  timeline: Timeline,
  currentTime: number,
  options?: SampleOptions,
  doc?: Document,
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

  const hasSoloTracks = timeline.tracks.some((track) => track.enabled !== false && track.solo);

  for (const track of timeline.tracks) {
    if (track.enabled === false || track.muted) continue;
    if (hasSoloTracks && !track.solo) continue;

    if (track.nestedTimelineId && doc) {
      const nested = doc.timelines?.[track.nestedTimelineId];
      if (!nested) continue;
      const start = track.nestedStartProgress ?? 0;
      if (timing.inactive || timing.progress < start) continue;
      const span = 1 - start;
      const nestedProgress = span > 0 ? (timing.progress - start) / span : 1;
      const nestedTime = nestedProgress * nested.duration;
      const nestedSample = sampleTimeline(nested, nestedTime, options, doc);
      mergeOverrides(overrides, nestedSample.overrides);
      continue;
    }

    if (track.keyframes.length === 0) continue;

    const val = interpolateTrack(
      getSortedKeyframes(track.id, track.keyframes),
      timing.progress,
      timeline.defaultEasing,
      track.interpolation ?? 'linear',
      track.property,
    );

    if (val !== undefined && !timing.inactive) {
      if (!overrides.has(track.nodeId)) {
        overrides.set(track.nodeId, new Map());
      }
      const nodeOverrides = overrides.get(track.nodeId)!;
      const existing = nodeOverrides.get(track.property);
      nodeOverrides.set(track.property, applyComposite(track.composite, existing, val));
    }
  }

  return { overrides };
}

function mergeOverrides(
  target: Map<string, Map<string, unknown>>,
  source: Map<string, Map<string, unknown>>,
): void {
  for (const [nodeId, props] of source) {
    if (!target.has(nodeId)) target.set(nodeId, new Map());
    const nodeOverrides = target.get(nodeId)!;
    for (const [prop, val] of props) {
      nodeOverrides.set(prop, val);
    }
  }
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
  interpolation: NonNullable<import('@varve/scene').AnimationTrack['interpolation']>,
  property: string,
): unknown {
  if (keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0]?.value;

  const sorted = keyframes;

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
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (progress <= first.progress) return first.value;
  if (progress >= last.progress) return last.value;

  // Find surrounding keyframes — binary search for large tracks
  if (sorted.length >= 32) {
    const segIdx = findKeyframeSegmentIndex(sorted, progress);
    if (segIdx >= 0) {
      const before = sorted[segIdx]!;
      const after = sorted[segIdx + 1]!;
      return interpolateSegment(before, after, progress, defaultEasing, interpolation, property);
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const before = sorted[i]!;
    const after = sorted[i + 1]!;

    if (progress >= before.progress && progress <= after.progress) {
      return interpolateSegment(before, after, progress, defaultEasing, interpolation, property);
    }
  }

  return sorted[sorted.length - 1]?.value;
}

function interpolateSegment(
  before: AnimationKeyframe,
  after: AnimationKeyframe,
  progress: number,
  defaultEasing: EasingDefinition,
  interpolation: NonNullable<import('@varve/scene').AnimationTrack['interpolation']>,
  property: string,
): unknown {
  const range = after.progress - before.progress;
  const localT = range > 0 ? (progress - before.progress) / range : 0;

  const easingDef = after.easing ?? defaultEasing;
  const easingFn = getEasingFn(easingDef);
  const easedT = easingFn(localT);

  if (interpolation === 'bezier' && before.spatialTangents && after.spatialTangents) {
    return interpolateSpatialBezier(
      before.value,
      after.value,
      easedT,
      before.spatialTangents,
      after.spatialTangents,
    );
  }

  return interpolateTypedValue(before.value, after.value, easedT, property);
}

/** O(log n) segment lookup for tracks with many keyframes. Returns segment start index or -1. */
export function findKeyframeSegmentIndex(sorted: AnimationKeyframe[], progress: number): number {
  if (sorted.length < 2) return -1;
  if (progress <= (sorted[0]?.progress ?? 0)) return 0;
  if (progress >= (sorted[sorted.length - 1]?.progress ?? 1)) return sorted.length - 2;

  let lo = 0;
  let hi = sorted.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const before = sorted[mid]!;
    const after = sorted[mid + 1]!;
    if (progress < before.progress) {
      hi = mid - 1;
    } else if (progress > after.progress) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

function interpolateTypedValue(from: unknown, to: unknown, t: number, property?: string): unknown {
  // Text animation: interpolate string content when both values are strings.
  if (
    (property === 'text' || property?.startsWith('text.')) &&
    typeof from === 'string' &&
    typeof to === 'string'
  ) {
    return interpolateValue(from, to, t);
  }
  // Check affine first: 6-element numeric arrays are transforms, not colors.
  const fromAffine = tryParseAffine(from);
  const toAffine = tryParseAffine(to);
  if (fromAffine && toAffine) {
    return interpolateAffine(fromAffine, toAffine, t);
  }

  // RGBA tuples: linear channel lerp (OKLab clips near pure black).
  if (
    Array.isArray(from) &&
    Array.isArray(to) &&
    from.length >= 3 &&
    to.length >= 3 &&
    from.every((n) => typeof n === 'number') &&
    to.every((n) => typeof n === 'number')
  ) {
    const len = Math.min(from.length, to.length);
    return Array.from({ length: len }, (_, i) => {
      const a = from[i] as number;
      const b = to[i] as number;
      return a + (b - a) * t;
    });
  }

  const fromColor = tryParseColor(from);
  const toColor = tryParseColor(to);
  if (fromColor && toColor) {
    return interpolateColor(fromColor, toColor, t);
  }

  const fromPath = tryParsePath(from);
  const toPath = tryParsePath(to);
  if (fromPath && toPath) {
    const matched = ensureVertexMatch(fromPath, toPath);
    return interpolatePath(matched.from, matched.to, t);
  }

  return interpolateValue(from, to, t);
}

function tryParsePath(v: unknown): PathPoint[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length === 0) return [];
  const first = v[0];
  if (typeof first !== 'object' || first === null || !('x' in first) || !('y' in first)) {
    return null;
  }
  return v as PathPoint[];
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

function tryParseAffine(v: unknown): import('@varve/shared').Affine | null {
  if (Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number')) {
    return v as unknown as import('@varve/shared').Affine;
  }
  return null;
}
