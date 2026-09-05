import {
  createFrameScheduler,
  type FrameJob,
  type FrameLane,
  type FrameScheduler,
} from './frameScheduler';

let scheduler: FrameScheduler | null = null;
let nextKey = 1;
let removeVisibilityListener: (() => void) | null = null;

function createRuntimeScheduler(): FrameScheduler {
  const refreshRate =
    typeof screen !== 'undefined'
      ? (screen as typeof screen & { refreshRate?: number }).refreshRate
      : undefined;
  const runtime = createFrameScheduler({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    frameIntervalMs:
      typeof refreshRate === 'number' && Number.isFinite(refreshRate) && refreshRate > 0
        ? 1000 / refreshRate
        : undefined,
  });
  if (typeof document !== 'undefined') {
    const updateVisibility = () => runtime.setVisible(document.visibilityState !== 'hidden');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    removeVisibilityListener = () =>
      document.removeEventListener('visibilitychange', updateVisibility);
  }
  return runtime;
}

export function getEditorFrameScheduler(): FrameScheduler {
  scheduler ??= createRuntimeScheduler();
  return scheduler;
}

export function createEditorFrameKey(scope: string): string {
  return `${scope}:${nextKey++}`;
}

export function requestEditorFrame(key: string, lane: FrameLane, job: FrameJob): void {
  // Async renderer work can finish after a test environment (or an SSR
  // request) has torn down its Window. There is no presentation surface left
  // to update in that case, and touching window.requestAnimationFrame would
  // turn harmless late work into an unhandled rejection.
  if (typeof window === 'undefined') return;
  getEditorFrameScheduler().request(key, lane, job);
}

export function cancelEditorFrame(key: string): boolean {
  return getEditorFrameScheduler().cancel(key);
}

/** Open a user interaction (drag/pinch/wheel burst) on the shared scheduler. */
export function beginEditorInteraction(): void {
  getEditorFrameScheduler().beginInteraction();
}

/** Close a user interaction. Must pair with beginEditorInteraction. */
export function endEditorInteraction(): void {
  getEditorFrameScheduler().endInteraction();
}

/**
 * True while a pointer/keyboard/wheel interaction is open. Background work
 * (viewport prefetch, thumbnail generation) defers itself while this is set
 * so input keeps the frame budget (see §50 of the interaction audit).
 */
export function isEditorInteractionActive(): boolean {
  return getEditorFrameScheduler().isInteractionActive();
}

/** Force-close open interactions after blur/visibility loss. */
export function resetEditorInteractions(): void {
  getEditorFrameScheduler().resetInteractions();
}

export function resetEditorFrameRuntimeForTests(): void {
  scheduler?.dispose();
  scheduler = null;
  removeVisibilityListener?.();
  removeVisibilityListener = null;
  nextKey = 1;
}
