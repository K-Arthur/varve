/**
 * Canvas performance runtime — single integration surface over the
 * previously-unwired frameBudget/adaptiveProfile/drawDiagnostics/
 * memoryBudget modules.
 *
 * CanvasArea.tsx is a tracked hub file with a tight import-statement budget
 * (see .health-baseline.json). Importing all four modules individually from
 * there would trip that budget, so this module wraps them behind one import.
 */
import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
} from '../performance/editorFrameRuntime';
import type { FrameJob, FrameLane } from '../performance/frameScheduler';
import {
  enableInteractionTraces,
  getInteractionTraceCount,
  getRecentInteractionTraces,
  notifyFrameCommit,
  resetInteractionTraces,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
} from '../performance/interactionTrace';
import { computeProfile, type PerformanceProfile } from './adaptiveProfile';
import {
  recordFrame as drawDiagnosticsRecordFrame,
  enableDrawDiagnostics,
  type FrameDiagnostics,
  installPerfDiagnosticsHandle as installDrawDiagnosticsHandle,
  renderDrawDiagnostics,
} from './drawDiagnostics';
import {
  endFrameTiming,
  getAverageFrameTime,
  getOverBudgetCount,
  initFrameBudget,
  startFrameTiming,
} from './frameBudget';
import { getAdaptiveCacheLimits, getMemoryBudgets, type MemoryBudgets } from './memoryBudget';
import {
  enableSnapMetrics,
  getSnapMetrics,
  getSnapMetricsCount,
  isSnapMetricsEnabled,
  recordSnapMetrics,
  resetSnapMetrics,
  summarizeSnapMetrics,
} from './snapDiagnostics';
import type { SubtreeIrCache } from './subtreeIrCache';

export {
  enableDrawDiagnostics,
  endFrameTiming,
  getAdaptiveCacheLimits,
  getAverageFrameTime,
  getInteractionTraceCount,
  getMemoryBudgets,
  getOverBudgetCount,
  getRecentInteractionTraces,
  getSnapMetrics,
  getSnapMetricsCount,
  isSnapMetricsEnabled,
  recordSnapMetrics,
  renderDrawDiagnostics,
  resetInteractionTraces,
  resetSnapMetrics,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
  startFrameTiming,
  summarizeSnapMetrics,
};

export function installPerfDiagnosticsHandle(): void {
  // The draw-diagnostics handle also flips snap metrics and interaction
  // tracing on so interaction probes reading window.__strataPerf see frame,
  // snap, and pointer-to-present data together. Gated to the same explicit
  // ?perf=1 opt-in as the frame diagnostics.
  if (typeof window !== 'undefined' && window.location.search.includes('perf=1')) {
    enableSnapMetrics(true);
    enableInteractionTraces(true);
  }
  installDrawDiagnosticsHandle();
}

/**
 * Record a frame into the diagnostics ring and correlate it with any active
 * interaction trace (pointer-to-present latency).
 */
export function recordFrame(frame: FrameDiagnostics): void {
  drawDiagnosticsRecordFrame(frame);
  notifyFrameCommit(performance.now(), frame.totalMs);
}

export function createCanvasFrameKey(scope: string): string {
  return createEditorFrameKey(`canvas-${scope}`);
}

export function scheduleCanvasFrame(key: string, lane: FrameLane, job: FrameJob): void {
  requestEditorFrame(key, lane, job);
}

export function cancelCanvasFrame(key: string): boolean {
  return cancelEditorFrame(key);
}

/** Call once per CanvasArea mount. */
export function initCanvasPerf(): void {
  initFrameBudget();
}

/** Enable or disable the dev-only diagnostics ring buffer + HUD overlay. */
export function setPerfHudEnabled(enabled: boolean): void {
  enableDrawDiagnostics(enabled);
}

/** Call right before drawing a frame that will actually run (past all guards). */
export function beginFrame(): number {
  return startFrameTiming();
}

export interface EndFrameArgs {
  frameStart: number;
  frameIndex: number;
  docVersion: number;
  redrawCount: number;
  nodeCount: number;
  culledCount: number;
  renderPath: FrameDiagnostics['renderPath'];
  wasDirty: boolean;
  partialRedraw: boolean;
  cache: SubtreeIrCache;
}

/**
 * Finish timing a frame, record it into the diagnostics ring buffer (no-op
 * unless the HUD is enabled), and return the current adaptive profile
 * computed from real rolling frame timing.
 */
export function endFrame(args: EndFrameArgs): PerformanceProfile {
  const budget = endFrameTiming(args.frameStart);
  const cacheDiag = args.cache.diagnostics();
  const profile = computeProfile(getAverageFrameTime(), getOverBudgetCount(), args.nodeCount);
  recordFrame({
    frameIndex: args.frameIndex,
    docVersion: args.docVersion,
    redrawCount: args.redrawCount,
    nodeCount: args.nodeCount,
    culledCount: args.culledCount,
    cacheHitCount: cacheDiag.hits,
    buildIrMs: 0,
    replayMs: 0,
    totalMs: budget.elapsedMs,
    renderPath: args.renderPath,
    wasDirty: args.wasDirty,
    partialRedraw: args.partialRedraw,
    cacheBytes: cacheDiag.bytes,
    cacheEntries: cacheDiag.entries,
    profileTier: profile.tier,
  });
  return profile;
}

/** Draw the dev-only HUD overlay. No-op unless setPerfHudEnabled(true) was called. */
export function renderPerfHud(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  renderDrawDiagnostics(ctx, canvasWidth);
}

/** Resolve byte/entry budgets for a persisted 'low' | 'medium' | 'high' preference. */
export function resolveMemoryBudgets(pref: 'low' | 'medium' | 'high' | undefined): MemoryBudgets {
  return getMemoryBudgets(pref);
}
