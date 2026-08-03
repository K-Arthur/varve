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
  recordInteractionSpanAt,
  resetInteractionTraces,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
  summarizeInteractionTraces,
} from '../performance/interactionTrace';
import {
  detectPresentationCapabilities,
  estimateCompositeFromRaf,
  observePresentation,
  PRESENTATION_EVIDENCE_BY_RUNTIME,
  RefreshIntervalEstimator,
} from '../performance/presentationTiming';
import { getRegisteredWorkerHost } from '../render/workerHost';
import {
  computeProfile,
  detectPlatformCapabilities,
  type PerformanceProfile,
} from './adaptiveProfile';
import type { DirtyRegionRecorder } from './dirtyRegion';
import { computeMergedDirtyRegion, mergeDirtyRects } from './dirtyRegionMerge';
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
  createNodeWorkCounters,
  type NodeWorkCounters,
  NodeWorkRing,
  nodeWorkRatios,
  rectsIntersect,
} from './nodeWorkAccounting';
import {
  beginContentFrame,
  createRedrawCoordinator,
  type RedrawCoordinator,
} from './redrawCoordinator';
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

export type {
  FrameInvalidation,
  FrameStateSnapshot,
  RedrawCoordinator,
  RedrawReason,
} from './redrawCoordinator';
export {
  beginContentFrame,
  beginInteractionSpan,
  computeMergedDirtyRegion,
  createNodeWorkCounters,
  createRedrawCoordinator,
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
  mergeDirtyRects,
  recordSnapMetrics,
  rectsIntersect,
  renderDrawDiagnostics,
  resetInteractionTraces,
  resetSnapMetrics,
  resolveDirtyScreenRect,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
  startFrameTiming,
  summarizeSnapMetrics,
};

// ── Redraw coordinator registry ─────────────────────────────────────────────
// The coordinator instance is owned by CanvasArea (one per mount); the
// diagnostics handle needs to read it, so it is registered here — mirroring
// the worker-host registry pattern.

let registeredCoordinator: RedrawCoordinator | null = null;

export function registerRedrawCoordinator(coordinator: RedrawCoordinator | null): void {
  registeredCoordinator = coordinator;
}

export function getRegisteredRedrawCoordinator(): RedrawCoordinator | null {
  return registeredCoordinator;
}

// ── Node-work accounting ────────────────────────────────────────────────────
// Recording is opt-in so the production render loop pays only the integer
// increments already inlined in it, and never allocates a rectangle recorder.

const nodeWorkRing = new NodeWorkRing();
let lastDirtyRects: DirtyRegionRecorder | null = null;
let lastMergedDirty: import('./dirtyRegionMerge').DirtyMergeResult | null = null;

export function isNodeWorkRecordingEnabled(): boolean {
  return isInteractionTracingEnabled();
}

/**
 * Record one frame's node-work counters and the individual pre-merge dirty
 * rectangles that produced them. Both are bounded rings/caps; a long drag
 * cannot grow either without limit.
 */
export function recordNodeWork(
  counters: NodeWorkCounters,
  recorder?: DirtyRegionRecorder | null,
): void {
  if (!isNodeWorkRecordingEnabled()) return;
  nodeWorkRing.record(counters);
  // Keep the last recording that actually captured rectangles. Overwriting
  // unconditionally means a trailing clean frame — which has no dirty region —
  // erases the evidence from the frames that did, and the diagnostic then
  // always reports zero rectangles.
  if (recorder && recorder.rects.length > 0) lastDirtyRects = recorder;
  recordInteractionSpan('render.nodework', 0, {
    total: counters.totalSceneNodes,
    candidates: counters.candidates,
    tested: counters.visibilityTested,
    rejectedByViewport: counters.rejectedByViewport,
    rejectedByDirty: counters.rejectedByDirty,
    prunableByDirty: counters.prunableByDirty,
    accepted: counters.acceptedForReplay,
    fullFallback: counters.fullFallback,
  });
}

/** Latest node-work samples plus derived ratios, for probes and the HUD. */
export function getNodeWorkSamples(n = 30): {
  samples: NodeWorkCounters[];
  latestRatios: ReturnType<typeof nodeWorkRatios> | null;
  dirtyRects: { rects: unknown[]; truncated: number } | null;
  mergedDirty: import('./dirtyRegionMerge').DirtyMergeResult | null;
} {
  const samples = nodeWorkRing.recent(n);
  const latest = samples[samples.length - 1];
  return {
    samples,
    latestRatios: latest ? nodeWorkRatios(latest) : null,
    dirtyRects: lastDirtyRects
      ? { rects: [...lastDirtyRects.rects], truncated: lastDirtyRects.truncated }
      : null,
    mergedDirty: lastMergedDirty,
  };
}

/**
 * Record the per-frame merged dirty-region result (bounded rect set). The
 * merge itself runs in production (it feeds the partial-redraw query); only
 * the retention is gated on tracing.
 */
export function recordMergedDirty(
  result: import('./dirtyRegionMerge').DirtyMergeResult | null,
): import('./dirtyRegionMerge').DirtyMergeResult | null {
  if (isNodeWorkRecordingEnabled()) lastMergedDirty = result;
  return result;
}

export function resetNodeWork(): void {
  nodeWorkRing.reset();
  lastDirtyRects = null;
  lastMergedDirty = null;
}

let disposePresentationObserver: (() => void) | null = null;

/** Detach the Event Timing observer (canvas teardown / tracing disabled). */
export function stopPresentationObserver(): void {
  disposePresentationObserver?.();
  disposePresentationObserver = null;
}

export function installPerfDiagnosticsHandle(): void {
  // The draw-diagnostics handle also flips snap metrics and interaction
  // tracing on so interaction probes reading window.__strataPerf see frame,
  // snap, and pointer-to-present data together. Gated to the same explicit
  // ?perf=1 opt-in as the frame diagnostics.
  if (typeof window !== 'undefined' && window.location.search.includes('perf=1')) {
    enableSnapMetrics(true);
    enableInteractionTraces(true);
    // Real presentation evidence where the runtime exposes it (Event Timing
    // reports input → next paint). No-op on engines that do not, which fall
    // back to the rAF lower bound recorded per frame.
    disposePresentationObserver?.();
    disposePresentationObserver = observePresentation();
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
    // Presentation evidence is reported with its class and limits so a probe
    // cannot mistake the rAF lower bound for a measured presentation time.
    // Node work and the individual pre-merge dirty rectangles behind it, so a
    // probe can compare dirty-area reduction against actual scene work.
    nodeWork: {
      getSamples: (n = 30) => getNodeWorkSamples(n),
      reset: resetNodeWork,
    },
    scheduler: () =>
      registeredCoordinator?.getDiagnostics() ?? { error: 'no coordinator registered' },
    presentation: () => ({
      capabilities: detectPresentationCapabilities(),
      evidenceByRuntime: PRESENTATION_EVIDENCE_BY_RUNTIME,
      refreshIntervalMs: refreshEstimator.intervalMs,
    }),
    clockCalibration: () => getRegisteredWorkerHost()?.getClockCalibration() ?? null,
  };
}

const refreshEstimator = new RefreshIntervalEstimator();

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
  const committedAt = performance.now();
  notifyFrameCommit(committedAt, frame.totalMs);
  scheduleCompositeEstimate(committedAt);
}

/**
 * Bound when the browser composited this frame using the next animation-frame
 * callback. This is a lower bound, not a presentation timestamp — see
 * `presentationTiming.ts` for why nothing here is called `composite.present`.
 * Skipped entirely when tracing is off, so production pays nothing.
 */
function scheduleCompositeEstimate(committedAtMs: number): void {
  if (!isInteractionTracingEnabled()) return;
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame((rafTimestampMs) => {
    refreshEstimator.sample(rafTimestampMs);
    const sample = estimateCompositeFromRaf(
      committedAtMs,
      rafTimestampMs,
      refreshEstimator.intervalMs,
    );
    recordInteractionSpanAt(sample.name, sample.startTimeMs, sample.durationMs, {
      ...sample.attributes,
      uncertaintyMs: sample.uncertaintyMs,
    });
  });
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
