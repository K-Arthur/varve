/**
 * MotionFacade — unified playback seam for timeline animation.
 *
 * Owns the TimelineEngine lifecycle and bridges RAF ticks to editor state
 * via callbacks. Replaces the inline no-op stub previously in context.tsx.
 *
 * Research basis: GSAP Timeline manager pattern, WAAPI Animation playback
 * contract, Strata motion architecture (docs/architecture/motion-system.md).
 */

import type { Document, Timeline } from '@varve/scene';
import { createMotionTimelineEngine, type MotionTimelineEngine } from '../state/motion-state';

export interface MotionFacadeCallbacks {
  /** Called on each playback frame with the current time in ms. */
  onFrame: (time: number) => void;
  /** Called when playback reaches the end (non-looping). */
  onFinish: () => void;
}

/**
 * Facade over timeline playback — wires TimelineEngine to editor callbacks.
 */
export class MotionFacade {
  private readonly eng: MotionTimelineEngine;
  private loop = false;
  private speed = 1;

  constructor(private readonly callbacks: MotionFacadeCallbacks) {
    this.eng = createMotionTimelineEngine({
      onFrame: (time) => this.callbacks.onFrame(time),
      onFinish: () => this.callbacks.onFinish(),
    });
  }

  getEngine(): MotionTimelineEngine {
    return this.eng;
  }

  play(timeline: Timeline, doc?: Document): void {
    this.eng.startPlayback(timeline, doc, { loop: this.loop, speed: this.speed });
  }

  pause(): void {
    this.eng.pausePlayback();
  }

  stop(): void {
    this.eng.stopPlayback();
  }

  seek(time: number): void {
    this.eng.seekPlayback(time);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.eng.setPlaybackSpeed(speed);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }
}
