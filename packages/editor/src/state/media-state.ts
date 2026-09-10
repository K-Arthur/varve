/**
 * Media playback runtime state (editor session state — never serialized,
 * never undoable). The media clock is the global animated-media clock:
 * slaved to the motion timeline while it plays, otherwise driven by the
 * media context's own RAF job.
 */

export interface MediaState {
  /** Global media time in milliseconds. */
  currentTime: number;
  /** Whether media playback is active (motion-driven or self-driven). */
  isPlaying: boolean;
  /** Who currently advances the clock. */
  source: 'media' | 'motion';
  /**
   * Monotonic stamp that advances ONLY when some visible usage's resolved
   * source frame actually changed — the canvas redraw trigger. A node
   * sitting on a 500 ms source frame does not invalidate every RAF.
   */
  presentedStamp: number;
}

export function createInitialMediaState(): MediaState {
  return {
    currentTime: 0,
    isPlaying: false,
    source: 'media',
    presentedStamp: 0,
  };
}
