/**
 * Motion state for the editor context — tracks playback, active timeline,
 * and selection within the timeline/keyframe editor.
 */

import type { Timeline } from '@varve/scene';
import { isReducedMotion } from '../context/reducedMotionManager';
import { TimelineEngine } from '../timeline/TimelineEngine';
import { type SampleResult, sampleTimeline } from '../timeline/TimelineSampler';

export interface MotionState {
  /** Current playhead position in milliseconds. */
  currentTime: number;
  /** Whether the timeline engine is actively playing. */
  isPlaying: boolean;
  /** The id of the active timeline (null if none selected). */
  activeTimelineId: string | null;
  /** Currently selected track ids in the timeline editor. */
  selectedTrackIds: string[];
  /** Currently selected keyframe ids (referenced by progress). */
  selectedKeyframeIds: string[];
  /** Playback speed multiplier. */
  playbackSpeed: number;
  /** Whether to loop playback indefinitely. */
  loop: boolean;
  /** When playing, property edits on selected nodes auto-insert keyframes. */
  autoKeyframe: boolean;

  // ── Onion skinning (Motion Mode) ──────────────────────────────────────────
  /** Whether onion skin overlays are enabled. */
  onionSkinEnabled: boolean;
  /** Number of frames to show before the current playhead. */
  onionSkinBeforeCount: number;
  /** Number of frames to show after the current playhead. */
  onionSkinAfterCount: number;
  /** Opacity (0-1) of the onion skin overlays. */
  onionSkinOpacity: number;
}

export function createInitialMotionState(): MotionState {
  return {
    currentTime: 0,
    isPlaying: false,
    activeTimelineId: null,
    selectedTrackIds: [],
    selectedKeyframeIds: [],
    playbackSpeed: 1,
    loop: false,
    autoKeyframe: false,
    onionSkinEnabled: false,
    onionSkinBeforeCount: 3,
    onionSkinAfterCount: 3,
    onionSkinOpacity: 0.25,
  };
}

export interface MotionPlaybackOptions {
  loop?: boolean;
  speed?: number;
}

export interface MotionEngineCallbacks {
  onFrame?: (time: number) => void;
  onFinish?: () => void;
}

export interface MotionTimelineEngine {
  engine: TimelineEngine | null;
  startPlayback: (timeline: Timeline, options?: MotionPlaybackOptions) => void;
  pausePlayback: () => void;
  stopPlayback: () => void;
  seekPlayback: (time: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  /** Get current sample overrides. Updated on each frame callback. */
  getCurrentSample: () => SampleResult;
}

export function createMotionTimelineEngine(
  callbacks?: MotionEngineCallbacks,
): MotionTimelineEngine {
  const currentSample: { result: SampleResult } = { result: { overrides: new Map() } };
  let engine: TimelineEngine | null = null;

  const engineRef: MotionTimelineEngine = {
    engine: null,

    startPlayback(timeline: Timeline, options?: MotionPlaybackOptions) {
      engineRef.stopPlayback();
      const reducedMotion = isReducedMotion();
      const loop = options?.loop ?? false;
      const eng = new TimelineEngine({
        duration: timeline.duration,
        iterations: loop ? Number.POSITIVE_INFINITY : (timeline.defaultIterations ?? 1),
        loop,
        autoReverse: timeline.autoReverse ?? false,
        reducedMotion,
      });
      if (options?.speed !== undefined) {
        eng.setSpeed(options.speed);
      }
      engine = eng;
      engineRef.engine = eng;

      eng.play({
        onFrame: (time) => {
          currentSample.result = sampleTimeline(timeline, time, {
            fillMode: timeline.defaultFillMode,
            direction: timeline.defaultPlaybackDirection,
            iterations: timeline.defaultIterations,
            autoReverse: timeline.autoReverse,
          });
          callbacks?.onFrame?.(time);
        },
        onFinish: () => {
          engine = null;
          engineRef.engine = null;
          callbacks?.onFinish?.();
        },
      });
    },

    pausePlayback() {
      if (engine && engine.state === 'playing') {
        engine.pause();
      }
    },

    stopPlayback() {
      if (engine) {
        engine.stop();
        engine = null;
        engineRef.engine = null;
      }
      currentSample.result = { overrides: new Map() };
    },

    seekPlayback(time: number) {
      if (engine) {
        engine.seek(time);
      }
    },

    setPlaybackSpeed(speed: number) {
      if (engine) {
        engine.setSpeed(speed);
      }
    },

    getCurrentSample() {
      return currentSample.result;
    },
  };

  return engineRef;
}
