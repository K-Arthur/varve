/**
 * Motion state for the editor context — tracks playback, active timeline,
 * and selection within the timeline/keyframe editor.
 */
import type { Timeline } from '@strata/scene';
import { prefersReducedMotion } from '@strata/prototype';
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
  };
}

export interface MotionTimelineEngine {
  engine: TimelineEngine | null;
  startPlayback: (timeline: Timeline) => void;
  pausePlayback: () => void;
  stopPlayback: () => void;
  seekPlayback: (time: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  /** Get current sample overrides. Updated on each frame callback. */
  getCurrentSample: () => SampleResult;
}

export function createMotionTimelineEngine(): MotionTimelineEngine {
  const currentSample: { result: SampleResult } = { result: { overrides: new Map() } };
  let engine: TimelineEngine | null = null;

  return {
    engine: null,

    startPlayback(timeline: Timeline) {
      this.stopPlayback();
      const reducedMotion = prefersReducedMotion();
      const eng = new TimelineEngine({
        duration: timeline.duration,
        iterations: timeline.defaultIterations ?? 1,
        loop: false,
        autoReverse: timeline.autoReverse ?? false,
        reducedMotion,
      });
      engine = eng;
      this.engine = eng;

      eng.play({
        onFrame: (time) => {
          currentSample.result = sampleTimeline(timeline, time, {
            fillMode: timeline.defaultFillMode,
            direction: timeline.defaultPlaybackDirection,
            iterations: timeline.defaultIterations,
            autoReverse: timeline.autoReverse,
          });
        },
        onFinish: () => {
          engine = null;
          this.engine = null;
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
        this.engine = null;
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
}
