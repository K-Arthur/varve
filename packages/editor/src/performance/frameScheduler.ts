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
  /** Display interval used to derive work-class budgets; defaults to 60 Hz. */
  frameIntervalMs?: number;
  /** Legacy explicit interaction budget override, in milliseconds. */
  frameWorkBudgetMs?: number;
  interactionSettleMs?: number;
  onError?: (error: unknown, key: string) => void;
}

interface QueuedJob {
  key: string;
  run: FrameJob;
}

const LANE_ORDER: readonly FrameLane[] = ['input', 'canvas', 'ui', 'background'];
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;

export interface FrameSchedulerWorkBudgets {
  interactionMs: number;
  authoritativeMs: number;
  backgroundMs: number;
}

/** Derive scheduler work windows from the current display interval. */
export function resolveFrameSchedulerWorkBudgets(
  frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
  interactionBudgetOverride?: number,
): FrameSchedulerWorkBudgets {
  const interval =
    Number.isFinite(frameIntervalMs) && frameIntervalMs > 0
      ? frameIntervalMs
      : DEFAULT_FRAME_INTERVAL_MS;
  return {
    interactionMs:
      interactionBudgetOverride && interactionBudgetOverride > 0
        ? interactionBudgetOverride
        : interval * 0.5,
    authoritativeMs: interval * 0.9,
    backgroundMs: interval * 0.25,
  };
}

export function createFrameScheduler(options: FrameSchedulerOptions = {}): FrameScheduler {
  const requestFrame =
    options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
  const now = options.now ?? (() => performance.now());
  const workBudgets = resolveFrameSchedulerWorkBudgets(
    options.frameIntervalMs,
    options.frameWorkBudgetMs,
  );
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

  const runLane = (
    lane: FrameLane,
    frameTimeMs: number,
    startedAt: number,
    budgetMs = Number.POSITIVE_INFINITY,
  ) => {
    const queue = queues.get(lane)!;
    for (const job of [...queue.values()]) {
      if (lane !== 'input' && now() - startedAt >= budgetMs) break;
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
      // Input has already consumed the latest sample. Canvas and UI work only
      // begin while the interaction window remains, keeping a rapid gesture
      // responsive even when lower-priority queues are populated.
      runLane('canvas', frameTimeMs, startedAt, workBudgets.interactionMs);
      runLane('ui', frameTimeMs, startedAt, workBudgets.interactionMs);
      const interactionSettled =
        interactionDepth === 0 && now() - interactionEndedAt >= interactionSettleMs;
      const hasBackgroundHeadroom =
        now() - startedAt < workBudgets.authoritativeMs - workBudgets.backgroundMs;
      if (interactionSettled && hasBackgroundHeadroom) {
        // Background receives its own bounded slice after current-frame work;
        // it cannot consume the interaction or authoritative viewport window.
        runLane('background', frameTimeMs, now(), workBudgets.backgroundMs);
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
