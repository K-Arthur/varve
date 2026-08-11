/**
 * Idle-priority viewport prefetch for off-screen content.
 *
 * Uses requestIdleCallback (with fallback) to build IR, decode images,
 * or prepare other reusable render data for nodes that are near (but
 * outside) the current viewport, so they render instantly when the
 * user scrolls or zooms to them.
 *
 * Prefetch runs only when:
 *   1. Interaction-critical work is complete (idle callback)
 *   2. The frame has meaningful remaining budget
 *   3. Cache and memory pressure are acceptable
 *   4. The candidate is still relevant (not invalidated by edits)
 *   5. The work can be cancelled or safely discarded
 */

import { isEditorInteractionActive } from '../performance/editorFrameRuntime';

export interface PrefetchRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrefetchCandidate {
  nodeId: string;
  priority: number; // higher = prefetch sooner
  distance: number; // viewport-edge distance in world units
}

/** Reasonable default: prefetch 75% beyond viewport in each direction. */
const PREFETCH_MARGIN = 0.75;

/** Max prefetch concurrency: 2 tasks at a time to avoid CPU storms. */
const MAX_CONCURRENT = 2;

let activeCount = 0;
let prefetchEnabled = true;

/** Compute the prefetch region around the current viewport.
 *
 * Returns a world-space rect that extends beyond the viewport by
 * `margin` fraction in each direction.
 */
export function computePrefetchRegion(
  viewport: { width: number; height: number },
  zoom: number,
  margin = PREFETCH_MARGIN,
): PrefetchRegion {
  const marginW = (viewport.width * margin) / zoom;
  const marginH = (viewport.height * margin) / zoom;
  const vpW = viewport.width / zoom;
  const vpH = viewport.height / zoom;
  return {
    x: -marginW,
    y: -marginH,
    w: vpW + marginW * 2,
    h: vpH + marginH * 2,
  };
}

/** Check if a world-space rect intersects the prefetch region
 * (but not the viewport itself). */
export function isInPrefetchRegion(
  bounds: { x: number; y: number; w: number; h: number },
  prefetchRegion: PrefetchRegion,
  viewport: { x: number; y: number; w: number; h: number },
): boolean {
  const inPrefetch =
    bounds.x < prefetchRegion.x + prefetchRegion.w &&
    bounds.x + bounds.w > prefetchRegion.x &&
    bounds.y < prefetchRegion.y + prefetchRegion.h &&
    bounds.y + bounds.h > prefetchRegion.y;

  if (!inPrefetch) return false;

  // Not in prefetch region if already in viewport
  const inViewport =
    bounds.x < viewport.x + viewport.w &&
    bounds.x + bounds.w > viewport.x &&
    bounds.y < viewport.y + viewport.h &&
    bounds.y + bounds.h > viewport.y;

  return !inViewport;
}

/** Compute distance from viewport center for priority sorting. */
export function prefetchDistance(
  cx: number,
  cy: number,
  viewport: { x: number; y: number; w: number; h: number },
): number {
  const vcx = viewport.x + viewport.w / 2;
  const vcy = viewport.y + viewport.h / 2;
  return Math.hypot(cx - vcx, cy - vcy);
}

/** Prioritise prefetch candidates: closer to viewport, larger objects first. */
export function rankPrefetchCandidates(candidates: PrefetchCandidate[]): PrefetchCandidate[] {
  return [...candidates].sort((a, b) => {
    // Closer distance = higher priority
    if (a.distance !== b.distance) return a.distance - b.distance;
    // Larger priority value wins
    return b.priority - a.priority;
  });
}

export interface PrefetchTask {
  cancel: () => void;
  readonly completed: Promise<boolean>;
}

/** Schedule a prefetch task using requestIdleCallback, with fallback. */
export function schedulePrefetch(
  callback: () => Promise<void> | void,
  timeout = 3000,
): PrefetchTask {
  let cancelled = false;
  let completedResolveFn: (v: boolean) => void = () => {};
  const completed = new Promise<boolean>((resolve) => {
    completedResolveFn = resolve;
  });

  if (activeCount >= MAX_CONCURRENT) {
    completedResolveFn(false);
    return { cancel: () => {}, completed };
  }

  activeCount++;

  let deferrals = 0;
  const DEFER_LIMIT = 5;
  const runTask = async () => {
    if (cancelled) {
      activeCount--;
      completedResolveFn(false);
      return;
    }
    try {
      await callback();
      completedResolveFn(true);
    } catch {
      completedResolveFn(false);
    } finally {
      activeCount--;
    }
  };

  const scheduleIdle = (idleTimeout: number) => {
    const doRun = () => {
      // While a pointer/wheel interaction is open, idle callbacks with a
      // timeout still fire mid-drag (the timeout is a hard bound, not a
      // preference). Re-schedule instead of stealing frame budget from input
      // (interaction audit §50). Bounded so a stuck interaction can never
      // starve prefetch forever; once the interaction ends the browser runs
      // the re-scheduled callback on the next idle slot.
      if (!cancelled && isEditorInteractionActive() && deferrals < DEFER_LIMIT) {
        deferrals++;
        scheduleIdle(idleTimeout + 250);
        return;
      }
      runTask();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const handle = requestIdleCallback(doRun, { timeout: idleTimeout });
      return handle;
    }
    return setTimeout(doRun, Math.min(idleTimeout, 50));
  };

  scheduleIdle(timeout);

  return {
    cancel: () => {
      cancelled = true;
    },
    completed,
  };
}

/** Enable or disable prefetch globally. */
export function setPrefetchEnabled(enabled: boolean): void {
  prefetchEnabled = enabled;
}

export function isPrefetchEnabled(): boolean {
  return prefetchEnabled;
}

/** Current active prefetch task count. */
export function getActivePrefetchCount(): number {
  return activeCount;
}
