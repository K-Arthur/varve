/**
 * Motion type definitions for the timeline/keyframe system.
 *
 * These types define the document-level animation model: timelines with
 * per-node property tracks, keyframes with easing, and playback control
 * parameters. Designed for integration with the existing @strata/prototype
 * animation engine and @strata/shared easing module.
 *
 * Research basis: W3C Web Animations API timing model (§4), Lottie/Bodymovin
 * v5.5 schema, GSAP Timeline architecture, After Effects layer/track model,
 * and CSS @keyframes fill/direction/iteration semantics.
 */
import type { EasingDefinition } from '@strata/shared';
import type { NodeId } from './types';

/** Fill mode: what values to show before/after the active interval. */
export type FillMode = 'none' | 'forwards' | 'backwards' | 'both';

/** Playback direction for timeline iterations. */
export type PlaybackDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

/** How multiple animations on the same property combine. */
export type CompositeOperation = 'replace' | 'add' | 'accumulate';

/** Interpolation strategy for a track. */
export type InterpolationStrategy = 'linear' | 'discrete' | 'bezier';

/**
 * A single keyframe on an animation track.
 * `progress` is 0–1 within the track's parent timeline duration.
 */
export interface AnimationKeyframe {
  progress: number;
  /** The property value at this keyframe. Type depends on the property being animated. */
  value: unknown;
  /** Easing TO this keyframe (from the previous keyframe). */
  easing?: EasingDefinition;
  /**
   * Spatial tangents for position/path properties (After Effects-style).
   * ti = tangent in, to = tangent out. Only used when interpolation is 'bezier'.
   */
  spatialTangents?: {
    ti: [number, number];
    to: [number, number];
  };
}

/**
 * A single property track within a timeline.
 * Targets one node's property using dot-notation property paths.
 */
export interface AnimationTrack {
  id: string;
  /** The node being animated. */
  nodeId: NodeId;
  /**
   * Dot-notation property path to the animated property.
   * Examples: "opacity", "rotation", "transform[4]", "fills[0].color",
   * "shape.w", "cornerRadius", "fontSize", "letterSpacing"
   */
  property: string;
  /** Keyframes sorted by progress. */
  keyframes: AnimationKeyframe[];
  /** Composite operation when multiple tracks target the same property. */
  composite?: CompositeOperation;
  /** Interpolation strategy. Defaults to 'linear'. */
  interpolation?: InterpolationStrategy;
  /** Whether this track is currently active. */
  enabled?: boolean;
}

/**
 * A named timeline containing property tracks.
 * Timelines are stored on the Document and serialized with it.
 */
export interface Timeline {
  id: string;
  name: string;
  /** Total duration in milliseconds. */
  duration: number;
  /** Default easing for tracks that don't specify per-keyframe easing. */
  defaultEasing: EasingDefinition;
  /** Property tracks in this timeline. */
  tracks: AnimationTrack[];

  // ── Playback defaults ──────────────────────────────────────────────────
  /** Default fill mode. */
  defaultFillMode?: FillMode;
  /** Default playback direction. */
  defaultPlaybackDirection?: PlaybackDirection;
  /** Default iterations (1 = play once, Infinity = loop forever). */
  defaultIterations?: number;
  /** Whether to reverse direction on alternating iterations. */
  autoReverse?: boolean;
}

/**
 * Create a new timeline with the given parameters.
 */
export function createTimeline(
  id: string,
  name: string,
  duration: number,
  defaultEasing?: EasingDefinition,
): Timeline {
  return {
    id,
    name,
    duration,
    defaultEasing: defaultEasing ?? { kind: 'linear' },
    tracks: [],
    defaultFillMode: 'none',
    defaultPlaybackDirection: 'normal',
    defaultIterations: 1,
    autoReverse: false,
  };
}

/**
 * Create a keyframe at the given progress point.
 */
export function createKeyframe(
  progress: number,
  value: unknown,
  easing?: EasingDefinition,
): AnimationKeyframe {
  return { progress, value, easing };
}
