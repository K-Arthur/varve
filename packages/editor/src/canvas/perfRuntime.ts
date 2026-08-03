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
  beginInteractionSpan,
  enableInteractionTraces,
  getInteractionTraceCount,
  getRecentInteractionTraces,
  isInteractionTracingEnabled,
  notifyFrameCommit,
  recordInteractionSpan,
  resetInteractionTraces,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
  summarizeInteractionTraces,
} from '../performance/interactionTrace';
import { getRegisteredWorkerHost } from '../render/workerHost';
import {
  computeProfile,
  detectPlatformCapabilities,
  type PerformanceProfile,
} from './adaptiveProfile';
import {
  recordFrame as drawDiagnosticsRecordFrame,
  enableDrawDiagnostics,
  type FrameDiagnostics,
  installPerfDiagnosticsHandle as installDrawDiagnosticsHandle,
  renderDrawDiagnostics,
  resolveDirtyScreenRect,
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
  beginInteractionSpan,
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
  resolveDirtyScreenRect,
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
  augmentPerfDiagnosticsHandle();
}

/**
 * Merge the snap, interaction, worker-budget, frame-budget and capability
 * getters into the dev-only `window.__strataPerf` handle so probes and E2E
 * tests can read every subsystem from one place. Inert unless ?perf=1.
 */
function augmentPerfDiagnosticsHandle(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.search.includes('perf=1')) return;
  const target = window as unknown as {
    __strataPerf?: Record<string, unknown>;
  };
  if (!target.__strataPerf || typeof target.__strataPerf !== 'object') return;
  target.__strataPerf = {
    ...target.__strataPerf,
    snap: {
      getSamples: (n = 10) => getSnapMetrics(n),
      count: () => getSnapMetricsCount(),
      summary: () => summarizeSnapMetrics(getSnapMetrics(120)),
      reset: resetSnapMetrics,
    },
    interactions: {
      getTraces: (n = 10) => getRecentInteractionTraces(n),
      count: () => getInteractionTraceCount(),
      summary: () => summarizeInteractionTraces(getRecentInteractionTraces(50)),
      reset: resetInteractionTraces,
      setSlowThreshold: setSlowInteractionThreshold,
      setSlowOnly: setSlowCaptureOnly,
    },
    frameBudget: {
      averageMs: () => getAverageFrameTime(),
      overBudgetCount: () => getOverBudgetCount(),
    },
    capabilities: () => detectPlatformCapabilities(),
    workerBitmapBudget: () => getRegisteredWorkerHost()?.getBitmapBudgetState() ?? null,
  };
}

/**
 * Record a frame into the diagnostics ring and correlate it with any active
 * interaction trace (pointer-to-present latency).
 */
export function recordFrame(frame: FrameDiagnostics): void {
  drawDiagnosticsRecordFrame(frame);
  recordInteractionSpan('render.main', frame.totalMs, {
    renderPath: frame.renderPath,
    nodeCount: frame.nodeCount,
    partialRedraw: frame.partialRedraw,
  });
  notifyFrameCommit(performance.now(), frame.totalMs);
}

export function createCanvasFrameKey(scope: string): string {
  return createEditorFrameKey(`canvas-${scope}`);
}

export function scheduleCanvasFrame(key: string, lane: FrameLane, job: FrameJob): void {
  if (isInteractionTracingEnabled()) {
    const finishQueue = beginInteractionSpan('render.queue', { lane });
    requestEditorFrame(key, lane, (frameTimeMs) => {
      finishQueue();
      job(frameTimeMs);
    });
    return;
  }
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
  renderSecondaryPerfPanel(ctx, canvasWidth);
}

/**
 * Second dev-only HUD panel: snap candidate counts, worker bitmap budget,
 * interaction latency summary and capability flags. Drawn on the same overlay
 * canvas below the frame panel; no-op when the frame ring buffer is disabled.
 */
function renderSecondaryPerfPanel(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  const snapCount = getSnapMetricsCount();
  const traceCount = getInteractionTraceCount();
  if (snapCount === 0 && traceCount === 0) return;

  const snap = summarizeSnapMetrics(getSnapMetrics(120));
  const traces = getRecentInteractionTraces(120);
  const summary = summarizeInteractionTraces(traces);
  const budget = getRegisteredWorkerHost()?.getBitmapBudgetState();
  const caps = detectPlatformCapabilities();

  const lines: string[] = [];
  if (snap.samples > 0) {
    lines.push(
      `snap: ${snap.samples} samples, broad ${snap.avgBroadPhase.toFixed(0)} / semantic ${snap.avgSemantic.toFixed(0)} / fine ${snap.avgFinePhase.toFixed(0)}, ${snap.avgEvalMs.toFixed(2)}ms`,
    );
  }
  if (budget) {
    const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
    lines.push(
      `worker: ${mb(budget.pendingBytes)} pend + ${mb(budget.inFlightBytes)} inflight + ${mb(budget.residentBytes)} res + ${mb(budget.workerCanvasBytes)} canvas / ${mb(budget.budgetBytes)} budget, reject ${budget.admissionRejections}`,
    );
  }
  if (summary.count > 0) {
    lines.push(
      `interactions: ${summary.count} (${summary.slowCount} slow), p2p p95/p99 ${summary.pointerToPresent.p95.toFixed(1)}/${summary.pointerToPresent.p99.toFixed(1)}ms, total p95 ${summary.p95TotalMs.toFixed(1)}ms`,
    );
  }
  if (lines.length === 0) return;

  lines.push(
    `engine:${caps.engine}${caps.webKitVersion ? `/${caps.webKitVersion}` : ''} offscreen:${caps.hasOffscreenCanvas ? 'y' : 'n'} bitmap:${caps.hasCreateImageBitmap ? 'y' : 'n'} gpu:${caps.hasWebGPU ? 'webgpu' : caps.hasWebGL ? 'webgl' : 'none'}`,
  );

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  const boxHeight = 8 + lines.length * 18;
  ctx.fillRect(canvasWidth - 420, 168, 416, boxHeight);
  ctx.fillStyle = '#0f0';
  ctx.textAlign = 'right';
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth - 8, 186 + i * 18);
  });
  ctx.restore();
}

/** Resolve byte/entry budgets for a persisted 'low' | 'medium' | 'high' preference. */
export function resolveMemoryBudgets(pref: 'low' | 'medium' | 'high' | undefined): MemoryBudgets {
  return getMemoryBudgets(pref);
}
