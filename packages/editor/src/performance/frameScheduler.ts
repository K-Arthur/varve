/**
 * Coordinated frame scheduler for interactive editor work.
 *
 * Research basis: HTML requestAnimationFrame callbacks share a presentation
 * opportunity. Keyed latest-wins queues prevent redundant work while
 * preserving input-before-paint priority.
 */

export type FrameLane = 'input' | 'canvas' | 'ui' | 'background';
export type FrameJob = (frameTimeMs: number) => void;

export interface FrameSchedulerDiagnostics {
  queuedJobs: number;
  executedJobs: number;
  replacedJobs: number;
  cancelledJobs: number;
  deferredBackgroundFrames: number;
}

export interface FrameScheduler {
  request(key: string, lane: FrameLane, job: FrameJob): void;
  cancel(key: string): boolean;
  beginInteraction(): void;
  endInteraction(): void;
  /** True while at least one interaction (drag/wheel/pinch) is open. */
  isInteractionActive(): boolean;
  /** Force-close all open interactions (window blur / visibility hidden). */
  resetInteractions(): void;
  setVisible(visible: boolean): void;
  getDiagnostics(): FrameSchedulerDiagnostics;
  dispose(): void;
}

export interface FrameSchedulerOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
  frameWorkBudgetMs?: number;
  interactionSettleMs?: number;
  onError?: (error: unknown, key: string) => void;
}

interface QueuedJob {
  key: string;
  run: FrameJob;
}

const LANE_ORDER: readonly FrameLane[] = ['input', 'canvas', 'ui', 'background'];

export function createFrameScheduler(options: FrameSchedulerOptions = {}): FrameScheduler {
  const requestFrame =
    options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
  const now = options.now ?? (() => performance.now());
  const frameWorkBudgetMs = options.frameWorkBudgetMs ?? 8;
  const interactionSettleMs = options.interactionSettleMs ?? 120;
  const queues = new Map<FrameLane, Map<string, QueuedJob>>(
    LANE_ORDER.map((lane) => [lane, new Map<string, QueuedJob>()]),
  );
  let scheduledFrame: number | null = null;
  let interactionDepth = 0;
  let interactionEndedAt = Number.NEGATIVE_INFINITY;
  let visible = true;
  let disposed = false;
  const diagnostics: FrameSchedulerDiagnostics = {
    queuedJobs: 0,
    executedJobs: 0,
    replacedJobs: 0,
    cancelledJobs: 0,
    deferredBackgroundFrames: 0,
  };

  const queuedCount = () => {
    let count = 0;
    for (const queue of queues.values()) count += queue.size;
    return count;
  };

  const ensureFrame = () => {
    if (disposed || !visible || scheduledFrame !== null || queuedCount() === 0) return;
    scheduledFrame = requestFrame(flush);
  };

  const runLane = (lane: FrameLane, frameTimeMs: number, startedAt: number) => {
    const queue = queues.get(lane)!;
    for (const job of [...queue.values()]) {
      if (lane !== 'input' && now() - startedAt >= frameWorkBudgetMs) break;
      if (queue.get(job.key) !== job) continue;
      queue.delete(job.key);
      try {
        job.run(frameTimeMs);
      } catch (error) {
        options.onError?.(error, job.key);
      }
      diagnostics.executedJobs++;
    }
  };

  function flush(frameTimeMs: number) {
    scheduledFrame = null;
    if (disposed) return;
    const startedAt = now();
    runLane('input', frameTimeMs, startedAt);
    if (visible) {
      runLane('canvas', frameTimeMs, startedAt);
      runLane('ui', frameTimeMs, startedAt);
      const interactionSettled =
        interactionDepth === 0 && now() - interactionEndedAt >= interactionSettleMs;
      if (interactionSettled && now() - startedAt < frameWorkBudgetMs) {
        runLane('background', frameTimeMs, startedAt);
      } else if ((queues.get('background')?.size ?? 0) > 0) {
        diagnostics.deferredBackgroundFrames++;
      }
    }
    diagnostics.queuedJobs = queuedCount();
    ensureFrame();
  }

  return {
    request(key, lane, job) {
      if (disposed) return;
      const existingLane = LANE_ORDER.find((candidate) => queues.get(candidate)?.has(key));
      if (existingLane) {
        queues.get(existingLane)?.delete(key);
        diagnostics.replacedJobs++;
      }
      queues.get(lane)?.set(key, { key, run: job });
      diagnostics.queuedJobs = queuedCount();
      ensureFrame();
    },
    cancel(key) {
      for (const lane of LANE_ORDER) {
        if (queues.get(lane)?.delete(key)) {
          diagnostics.cancelledJobs++;
          diagnostics.queuedJobs = queuedCount();
          if (diagnostics.queuedJobs === 0 && scheduledFrame !== null) {
            cancelFrame(scheduledFrame);
            scheduledFrame = null;
          }
          return true;
        }
      }
      return false;
    },
    beginInteraction() {
      interactionDepth++;
    },
    endInteraction() {
      interactionDepth = Math.max(0, interactionDepth - 1);
      if (interactionDepth === 0) interactionEndedAt = now();
      ensureFrame();
    },
    isInteractionActive() {
      return interactionDepth > 0;
    },
    resetInteractions() {
      interactionDepth = 0;
      interactionEndedAt = now();
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      if (!visible && scheduledFrame !== null) {
        cancelFrame(scheduledFrame);
        scheduledFrame = null;
      } else if (visible) {
        ensureFrame();
      }
    },
    getDiagnostics() {
      return { ...diagnostics, queuedJobs: queuedCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scheduledFrame !== null) cancelFrame(scheduledFrame);
      scheduledFrame = null;
      for (const queue of queues.values()) queue.clear();
      diagnostics.queuedJobs = 0;
    },
  };
}
