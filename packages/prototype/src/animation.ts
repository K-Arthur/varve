/**
 * Animation engine — keyframes, timelines, interpolation, and sampling.
 *
 * Supports multi-keyframe timelines with arbitrary property paths,
 * multiple easing functions, and spring-physics-based motion.
 *
 * Research basis: Web Animations API (KeyframeEffect, Animation.timeline),
 * Framer Motion (spring physics, keyframe arrays), CSS Animations
 * (@keyframes with percentage progress).
 */

import type { EasingDefinition } from './types';

/**
 * A keyframe defines property values at a specific point in the animation.
 */
export interface Keyframe {
  /** Progress 0-1 */
  progress: number;
  /** Property values at this keyframe */
  values: Record<string, unknown>;
  /** Per-keyframe easing override */
  easing?: EasingDefinition;
}

/**
 * An animation timeline.
 */
export interface AnimationTimeline {
  id: string;
  duration: number;
  defaultEasing: EasingDefinition;
  keyframes: Keyframe[];
}

/**
 * Create a new animation timeline.
 */
export function createTimeline(
  id: string,
  duration: number,
  defaultEasing: EasingDefinition,
): AnimationTimeline {
  return { id, duration, defaultEasing, keyframes: [] };
}

/**
 * Add a keyframe to a timeline. Replaces existing at same progress.
 */
export function addKeyframe(
  timeline: AnimationTimeline,
  progress: number,
  values: Record<string, unknown>,
  easing?: EasingDefinition,
): void {
  const existing = timeline.keyframes.findIndex((k) => k.progress === progress);
  const keyframe: Keyframe = { progress, values, easing };
  if (existing >= 0) {
    timeline.keyframes[existing] = keyframe;
  } else {
    timeline.keyframes.push(keyframe);
    timeline.keyframes.sort((a, b) => a.progress - b.progress);
  }
}

/**
 * Interpolate a single value between start and end at progress t.
 * Supports numbers, arrays (element-wise), and flat objects (key-wise).
 */
export function interpolateValue(
  from: unknown,
  to: unknown,
  t: number,
  easingKind: EasingKind | string,
): unknown {
  const easedT = applyEasing(easingKind, t);

  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * easedT;
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    return from.map((f, i) => {
      const tVal = to[i];
      if (typeof f === 'number' && typeof tVal === 'number') {
        return f + (tVal - f) * easedT;
      }
      return t < 0.5 ? f : tVal;
    });
  }

  if (typeof from === 'object' && typeof to === 'object' && from !== null && to !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(from as Record<string, unknown>)) {
      if (key in (to as Record<string, unknown>)) {
        result[key] = interpolateValue(
          (from as Record<string, unknown>)[key],
          (to as Record<string, unknown>)[key],
          t,
          easingKind,
        );
      }
    }
    return result;
  }

  return t < 0.5 ? from : to;
}

type EasingKind = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut';

function applyEasing(kind: EasingKind | string, t: number): number {
  switch (kind) {
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return t * (2 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:
      return t;
  }
}

/**
 * Sample a timeline at a given progress [0, 1].
 * Returns the interpolated property values at that point.
 */
export function sampleAt(timeline: AnimationTimeline, progress: number): Record<string, unknown> {
  if (timeline.keyframes.length === 0) {
    throw new Error(`Cannot sample empty timeline: ${timeline.id}`);
  }

  if (progress <= timeline.keyframes[0]?.progress) {
    return { ...timeline.keyframes[0]?.values };
  }

  const last = timeline.keyframes[timeline.keyframes.length - 1]!;
  if (progress >= last.progress) {
    return { ...last.values };
  }

  // Find the two keyframes to interpolate between
  for (let i = 0; i < timeline.keyframes.length - 1; i++) {
    const kfA = timeline.keyframes[i]!;
    const kfB = timeline.keyframes[i + 1]!;

    if (progress >= kfA.progress && progress < kfB.progress) {
      const range = kfB.progress - kfA.progress;
      const localT = range > 0 ? (progress - kfA.progress) / range : 0;
      const easing = kfA.easing ?? timeline.defaultEasing;
      const easingKind = easing.kind as EasingKind;

      const result: Record<string, unknown> = {};
      for (const key of Object.keys(kfA.values)) {
        if (key in kfB.values) {
          result[key] = interpolateValue(kfA.values[key], kfB.values[key], localT, easingKind);
        }
      }
      return result;
    }
  }

  return { ...last.values };
}
