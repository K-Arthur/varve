/**
 * Render worker host — latest-only OffscreenCanvas replay with render-revision guards.
 */
import type { SceneNode as EngineNode, RenderItem } from '@varve/engine';
import { asRenderRevision, type Camera, type RenderRevision, type Viewport } from '@varve/shared';
import {
  isInteractionTracingEnabled,
  recordInteractionSpanAt,
} from '../performance/interactionTrace';
import { type ClockCalibration, WorkerClockCalibrator } from '../performance/workerClock';
import { closeImageBitmapMap } from './collectImageBitmaps';
import { checkFault } from './faultInjection';
import { FrameLedger, type FrameLedgerCounters } from './frameLifecycle';
import {
  type BitmapBudgetState,
  estimateImagesBytes,
  estimateRgbaBytes,
  RenderBitmapBudget,
} from './renderBitmapBudget';
import { buildWorkerRenderSpan } from './workerRenderSpan';

/** Default byte budget for main-thread-visible render-worker bitmaps. */
export const DEFAULT_WORKER_BITMAP_BUDGET_BYTES = 128 * 1024 * 1024;

export interface WorkerRenderCommand {
  type: 'render';
  /** @deprecated Worker replay consumes IR; retained only for source compatibility and never cloned. */
  nodes?: EngineNode[];
  ir: RenderItem[];
  camera: Camera;
  viewport: Viewport;
  /** History identity retained for diagnostics and compatibility. */
  docVersion: number;
  /** Pixel identity; unlike docVersion this includes camera/resources/async results. */
  renderRevision?: RenderRevision;
  dpr: number;
  /** Pre-decoded ImageBitmaps keyed by image src URL (Structured Clone transport). */
  images?: Record<string, ImageBitmap>;
  /** Full authoritative image-source manifest; `images` may contain only the missing delta. */
  imageSources?: string[];
  /** Display-only proof transform applied inside the worker before replay. */
  proof?: import('@varve/shared').ProofTransformConfig | null;
}

export type WorkerCommand =
  | WorkerRenderCommand
  | { type: 'hitTest'; worldX: number; worldY: number; docVersion: number }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'cancel'; docVersion: number; renderRevision?: RenderRevision }
  /** Clock-calibration ping; `t0` is main.performance.now() before posting. */
  | { type: 'clockPing'; seq: number; t0: number };

/**
 * Worker-side timing for one render, in the *worker's* `performance.now()`
 * domain. Never subtract these from main-thread timestamps without the
 * calibrated offset (see `performance/workerClock.ts`).
 */
export interface WorkerRenderTiming {
  /** Worker clock on message receipt. */
  receivedAt: number;
  /** Worker clock when replay began (after any canvas (re)allocation). */
  renderStartedAt: number;
  /** Worker clock when replay finished, before bitmap creation. */
  renderEndedAt: number;
  /** Worker clock after transferToImageBitmap, immediately before posting. */
  postedAt: number;
  /** Time spent allocating or resizing the OffscreenCanvas backing store. */
  surfaceMs: number;
  /** Time spent in replayIr. */
  replayMs: number;
  /** Time spent in transferToImageBitmap. */
  bitmapMs: number;
  /** IR item count actually replayed. */
  irCount: number;
  /** Image bitmaps resident in the worker's image map after this render. */
  imageCount: number;
}

export type WorkerResponse =
  | {
      type: 'frameRendered';
      docVersion: number;
      renderRevision: RenderRevision;
      camera: Camera;
      viewport: Viewport;
      dpr: number;
      bitmap?: ImageBitmap;
      /** Estimated RGBA bytes of source bitmaps resident inside the worker. */
      imageBytes?: number;
      /** Present only while interaction tracing is enabled. */
      timing?: WorkerRenderTiming;
    }
  | { type: 'hitTestResult'; nodeId: number | null; docVersion: number }
  | { type: 'error'; message: string; docVersion?: number; renderRevision?: RenderRevision }
  /** Clock-calibration pong; `t1`/`t2` are worker.performance.now(). */
  | { type: 'clockPong'; seq: number; t0: number; t1: number; t2: number };

export interface RenderWorkerHost {
  /** Returns false when the host refused the command or postMessage failed. */
  post(command: WorkerCommand, transfer?: Transferable[]): boolean;
  /**
   * Release accounting for a forwarded frame when its canvas owner disposes
   * it before another worker frame replaces it. Returns true only for the
   * currently accounted frame, making duplicate/stale releases harmless.
   */
  releaseFrame(bitmap: ImageBitmap): boolean;
  terminate(): void;
  readonly permanentFailure: boolean;
  readonly restartCount: number;
  readonly resizeGeneration: number;
  readonly inFlightRenderRevision: RenderRevision | null;
  readonly pendingRenderRevision: RenderRevision | null;
  /** Sources already resident or in the command currently dispatched to this worker generation. */
  readonly knownImageSources: ReadonlySet<string>;
  readonly bitmapBudget: RenderBitmapBudget;
  getBitmapBudgetState(): BitmapBudgetState;
  /** Current main<->worker clock calibration, or null before the first exchange. */
  getClockCalibration(): ClockCalibration | null;
  /** Exactly-once frame accounting counters (see `frameLifecycle.ts`). */
  getFrameLedgerState(): FrameLedgerCounters;
}

export interface RenderWorkerHostOptions {
  /** Byte budget for main-thread-visible worker bitmaps (0 disables admission). */
  budgetBytes?: number;
}

/** Close a frame and release host accounting at the same ownership boundary. */
export function disposeWorkerFrame(
  host: RenderWorkerHost | null,
  bitmap: ImageBitmap | null | undefined,
): void {
  if (!bitmap) return;
  host?.releaseFrame(bitmap);
  bitmap.close();
}

type NormalizedRenderCommand = WorkerRenderCommand & { renderRevision: RenderRevision };
interface PendingRender {
  command: NormalizedRenderCommand;
  transfer?: Transferable[];
  transferBytes: number;
}

function normalizeRenderCommand(command: WorkerRenderCommand): NormalizedRenderCommand {
  const { nodes: _unusedNodes, ...workerCommand } = command;
  return {
    ...workerCommand,
    renderRevision: command.renderRevision ?? asRenderRevision(command.docVersion),
  };
}

export function createRenderWorkerHost(
  onResponse: (msg: WorkerResponse) => void,
  onPermanentFailure?: () => void,
  options: RenderWorkerHostOptions = {},
): RenderWorkerHost | null {
  // The worker module (`renderWorker.ts`) calls `new OffscreenCanvas(...)`
  // unguarded on its first message; on an engine without it, that throws
  // inside the worker's `onmessage` handler and only surfaces via `onerror`,
  // which would otherwise burn through 5 retries with exponential backoff
  // (up to ~30s each) before falling back to main-thread rendering — a
  // problem retrying can never fix. Feature-detecting here skips straight to
  // the main-thread fallback instead.
  //
  // This is a presence check only, and presence is not usability. Whether the
  // full chain (construct in worker, 2D context, replay,
  // transferToImageBitmap, transfer back with pixels intact) actually works is
  // established by `offscreenCapabilityProbe.ts` and enforced by
  // `workerEligibility.ts`. Measured 2026-08-07: WebKitGTK 2.52.5 passes every
  // stage, and this guard does NOT reject it — the profile policy is the gate
  // that keeps that engine on the main thread. See
  // docs/perf/2026-08-07-webkitgtk-render-path.md.
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;

  let worker: Worker | null = null;
  let restartCount = 0;
  let workerGen = 0;
  let resizeGeneration = 0;
  let lastRenderResizeGeneration = 0;
  let permanentFailure = false;
  let lastRenderCommand: NormalizedRenderCommand | null = null;
  let lastRenderUsedTransfer = false;
  let lastRenderDependsOnImages = false;
  let inFlightRenderRevision: RenderRevision | null = null;
  let inFlightTransferBytes = 0;
  let residentImageSources = new Set<string>();
  let inFlightImageSources: Set<string> | null = null;
  /** Worker-reported estimated bytes of source bitmaps resident inside it. */
  let residentSourceBytes = 0;
  let lastForwardedFrame: ImageBitmap | null = null;
  let lastForwardedFrameBytes = 0;
  let lastForwardedFrameId: number | null = null;
  const ledger = new FrameLedger();
  let pendingRender: PendingRender | null = null;
  let latestRequestedRevision: RenderRevision | null = null;
  let latestFrameIdentity: { viewport: Viewport; dpr: number } | null = null;
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  let inFlightDispatchedAtMs = 0;
  let clockPingSeq = 0;
  const clockCalibrator = new WorkerClockCalibrator();
  const maxRestarts = 5;

  /**
   * Send a calibration exchange when tracing is on and the current estimate is
   * stale. Sending it before the render command means the worker's timing flag
   * is already set by the time the first traced frame arrives.
   */
  function maybeCalibrateClock(): void {
    if (!worker || permanentFailure) return;
    if (!isInteractionTracingEnabled()) return;
    const now = performance.now();
    if (!clockCalibrator.needsRecalibration(now)) return;
    try {
      postToWorker({ type: 'clockPing', seq: ++clockPingSeq, t0: performance.now() });
    } catch {
      // Calibration is diagnostics-only: a failed ping must never mark the
      // render worker as permanently failed.
    }
  }
  const bitmapBudget = new RenderBitmapBudget(
    options.budgetBytes ?? DEFAULT_WORKER_BITMAP_BUDGET_BYTES,
  );

  function closeCommandResources(command: WorkerCommand): void {
    if (command.type === 'render' && command.images) closeImageBitmapMap(command.images);
  }

  function closePendingRender(): void {
    if (!pendingRender) return;
    closeCommandResources(pendingRender.command);
    bitmapBudget.releaseTransfer(pendingRender.transferBytes);
    pendingRender = null;
  }

  function closeResponseResources(response: WorkerResponse): void {
    // Only close — never touch the resident accounting. Resident bytes track
    // the single forwarded frame bitmap and are released via
    // accountResidentFrame/releaseAllReservations; frames dropped here were
    // never forwarded, so releasing resident for them would under-count the
    // live frame.
    if (response.type === 'frameRendered') response.bitmap?.close();
  }

  function clearRestartTimeout(): void {
    if (restartTimeout === null) return;
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }

  function markPermanentFailure(): void {
    if (permanentFailure) return;
    permanentFailure = true;
    clearRestartTimeout();
    worker?.terminate();
    worker = null;
    workerGen++;
    closePendingRender();
    inFlightRenderRevision = null;
    inFlightTransferBytes = 0;
    residentImageSources.clear();
    inFlightImageSources = null;
    lastRenderCommand = null;
    lastRenderUsedTransfer = false;
    lastRenderDependsOnImages = false;
    releaseAllReservations();
    onPermanentFailure?.();
  }

  /** Release every main-thread bitmap reservation the host still holds. */
  function releaseAllReservations(): void {
    if (inFlightTransferBytes > 0) bitmapBudget.releaseTransfer(inFlightTransferBytes);
    inFlightTransferBytes = 0;
    if (lastForwardedFrameBytes > 0) bitmapBudget.releaseResident(lastForwardedFrameBytes);
    lastForwardedFrame = null;
    lastForwardedFrameBytes = 0;
    lastForwardedFrameId = null;
    // The worker's resident source bitmaps die with the worker; release the
    // accounting so a restarted generation starts from a clean slate.
    if (residentSourceBytes > 0) bitmapBudget.releaseResidentSource(residentSourceBytes);
    residentSourceBytes = 0;
    // Bumps the ledger generation too, so a response that arrives after
    // teardown cannot match an id issued before it.
    ledger.reclaimAll('teardown');
  }

  /** Single postMessage seam so failure injection hits every send path. */
  function postToWorker(msg: WorkerCommand, transfer?: Transferable[]): void {
    if (checkFault('post-message')) {
      throw new DOMException('injected postMessage fault', 'DataCloneError');
    }
    if (transfer?.length) {
      worker!.postMessage(msg, transfer);
    } else {
      worker!.postMessage(msg);
    }
  }

  /**
   * Emit `render.worker` for a completed frame. `disposition` distinguishes a
   * frame that reached the canvas from one that was superseded before it could
   * — without it, discarded worker work would look like presented latency.
   */
  function recordWorkerSpan(
    msg: Extract<WorkerResponse, { type: 'frameRendered' }>,
    receivedAtMs: number,
    disposition: 'presented' | 'discarded' | 'unmatched',
  ): void {
    if (!msg.timing) return;
    const span = buildWorkerRenderSpan(clockCalibrator, {
      timing: msg.timing,
      dispatchedAtMs: inFlightDispatchedAtMs,
      receivedAtMs,
    });
    recordInteractionSpanAt('render.worker', span.startTimeMs, span.durationMs, {
      ...span.attributes,
      disposition,
      renderRevision: msg.renderRevision,
      viewportWidth: msg.viewport.width,
      viewportHeight: msg.viewport.height,
      dpr: msg.dpr,
      bitmapWidth: msg.bitmap?.width ?? 0,
      bitmapHeight: msg.bitmap?.height ?? 0,
      bitmapBytes: msg.bitmap ? estimateRgbaBytes(msg.bitmap.width, msg.bitmap.height) : 0,
    });
  }

  function frameIdentityMatches(response: Extract<WorkerResponse, { type: 'frameRendered' }>) {
    return (
      latestFrameIdentity !== null &&
      response.dpr === latestFrameIdentity.dpr &&
      response.viewport.width === latestFrameIdentity.viewport.width &&
      response.viewport.height === latestFrameIdentity.viewport.height
    );
  }

  function dispatchRender(render: PendingRender): boolean {
    if (!worker || permanentFailure) {
      closeCommandResources(render.command);
      bitmapBudget.releaseTransfer(render.transferBytes);
      return false;
    }
    maybeCalibrateClock();
    inFlightDispatchedAtMs = performance.now();
    try {
      postToWorker(render.command, render.transfer);
    } catch {
      closeCommandResources(render.command);
      bitmapBudget.releaseTransfer(render.transferBytes);
      markPermanentFailure();
      return false;
    }
    bitmapBudget.commitTransfer(render.transferBytes);
    inFlightTransferBytes = render.transferBytes;
    inFlightRenderRevision = render.command.renderRevision;
    inFlightImageSources = render.command.imageSources
      ? new Set(render.command.imageSources)
      : render.command.images
        ? new Set(Object.keys(render.command.images))
        : null;
    lastRenderUsedTransfer = Boolean(render.transfer?.length);
    lastRenderDependsOnImages = Boolean(render.command.imageSources?.length);
    // Transferred or cloned ImageBitmaps cannot be replayed safely after a
    // worker crash. Plain IR commands can be retried after restart.
    lastRenderCommand = lastRenderUsedTransfer || render.command.images ? null : render.command;
    lastRenderResizeGeneration = resizeGeneration;
    return true;
  }

  function dispatchPendingRender(): void {
    if (inFlightRenderRevision !== null || !pendingRender) return;
    const next = pendingRender;
    pendingRender = null;
    dispatchRender(next);
  }

  function createWorker(): Worker | null {
    // Failure injection: a worker-startup fault is indistinguishable from an
    // engine that cannot create workers — the host reports null and the
    // caller falls back to main-thread rendering (never a retry loop).
    if (checkFault('worker-start')) return null;
    const gen = ++workerGen;
    try {
      const w = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (gen !== workerGen) {
          closeResponseResources(msg);
          return;
        }
        if (msg.type === 'clockPong') {
          clockCalibrator.addExchange({
            t0: msg.t0,
            t1: msg.t1,
            t2: msg.t2,
            t3: performance.now(),
          });
          return;
        }
        if (msg.type === 'frameRendered') {
          // The span is emitted for discarded frames too — a drag that renders
          // ten frames and presents two is exactly the case worth seeing — so
          // the timing is captured here and recorded once the disposition is
          // known below.
          const spanReceivedAtMs = msg.timing ? performance.now() : 0;
          const responseRevision = msg.renderRevision ?? asRenderRevision(msg.docVersion);
          if (inFlightRenderRevision === null || responseRevision !== inFlightRenderRevision) {
            recordWorkerSpan(msg, spanReceivedAtMs, 'unmatched');
            closeResponseResources(msg);
            return;
          }
          const obsolete =
            (latestRequestedRevision !== null && responseRevision < latestRequestedRevision) ||
            lastRenderResizeGeneration !== resizeGeneration ||
            !frameIdentityMatches(msg);
          recordWorkerSpan(msg, spanReceivedAtMs, obsolete ? 'discarded' : 'presented');
          inFlightRenderRevision = null;
          // The completed render's outbound ImageBitmaps are now worker-held;
          // release the main-thread reservation so a long drag cannot accrue
          // reservations faster than frames complete.
          if (inFlightTransferBytes > 0) {
            bitmapBudget.releaseTransfer(inFlightTransferBytes);
            inFlightTransferBytes = 0;
          }
          // Account worker-resident source bitmaps (reported by the worker)
          // and the manifest set delta: adds/removes/reuses feed admission
          // control and diagnostics so residency is measurable, not implicit.
          if (msg.imageBytes !== undefined) {
            bitmapBudget.accountResidentSource(msg.imageBytes, residentSourceBytes);
            residentSourceBytes = msg.imageBytes;
          }
          if (inFlightImageSources) {
            const resident = residentImageSources;
            let adds = 0;
            let removes = 0;
            let reuses = 0;
            for (const src of inFlightImageSources) {
              if (resident.has(src)) reuses += 1;
              else adds += 1;
            }
            for (const src of resident) {
              if (!inFlightImageSources.has(src)) removes += 1;
            }
            bitmapBudget.recordSourceSetDelta(adds, removes, reuses);
            residentImageSources = inFlightImageSources;
          }
          inFlightImageSources = null;
          if (obsolete) {
            if (msg.bitmap) {
              // Record the discard so a drag that renders ten frames and
              // presents two shows up as a stale rate rather than as nothing.
              const staleId = ledger.allocate(
                estimateRgbaBytes(msg.bitmap.width, msg.bitmap.height),
              );
              ledger.transition(staleId, 'stale');
              ledger.close(staleId);
            }
            closeResponseResources(msg);
          } else {
            if (msg.bitmap) {
              const frameBytes = estimateRgbaBytes(msg.bitmap.width, msg.bitmap.height);
              bitmapBudget.accountResidentFrame(frameBytes, lastForwardedFrameBytes);
              // The outgoing frame is released at the same boundary that
              // accounts the new one, so the two can never disagree.
              if (lastForwardedFrameId !== null) {
                ledger.transition(lastForwardedFrameId, 'replaced');
                ledger.close(lastForwardedFrameId);
              }
              const frameId = ledger.allocate(frameBytes);
              ledger.transition(frameId, 'transferred');
              ledger.transition(frameId, 'received');
              ledger.transition(frameId, 'installed');
              lastForwardedFrame = msg.bitmap;
              lastForwardedFrameBytes = frameBytes;
              lastForwardedFrameId = frameId;
            }
            onResponse(msg);
          }
          dispatchPendingRender();
          return;
        }
        if (
          msg.type === 'error' &&
          msg.renderRevision !== undefined &&
          msg.renderRevision === inFlightRenderRevision
        ) {
          inFlightRenderRevision = null;
          if (inFlightTransferBytes > 0) {
            bitmapBudget.releaseTransfer(inFlightTransferBytes);
            inFlightTransferBytes = 0;
          }
          inFlightImageSources = null;
          const obsolete =
            latestRequestedRevision !== null && msg.renderRevision < latestRequestedRevision;
          if (!obsolete) onResponse(msg);
          dispatchPendingRender();
          return;
        }
        onResponse(msg);
      };
      w.onerror = () => {
        if (gen !== workerGen) return;
        restartCount++;
        // A successful transfer detaches the sender's ImageBitmaps. Retrying
        // that command would reuse invalid resources and can never succeed.
        if (lastRenderUsedTransfer || lastRenderDependsOnImages || restartCount >= maxRestarts) {
          markPermanentFailure();
          return;
        }
        worker?.terminate();
        inFlightRenderRevision = null;
        clearRestartTimeout();
        // A replacement worker has a fresh timeOrigin, so the previous offset
        // is meaningless. Resetting bumps the calibration generation, which
        // marks every later span as belonging to a new calibration epoch.
        clockCalibrator.reset();
        worker = createWorker();
        if (!worker) {
          markPermanentFailure();
          return;
        }
        const delay = Math.min(2 ** restartCount, 30) * 1000;
        restartTimeout = setTimeout(() => {
          if (permanentFailure) return;
          if (pendingRender) {
            dispatchPendingRender();
          } else if (lastRenderCommand) {
            try {
              dispatchRender({ command: lastRenderCommand, transferBytes: 0 });
            } catch {
              markPermanentFailure();
            }
          }
        }, delay);
      };
      return w;
    } catch {
      return null;
    }
  }

  worker = createWorker();
  if (!worker) return null;

  const host: RenderWorkerHost = {
    get permanentFailure() {
      return permanentFailure;
    },
    get restartCount() {
      return restartCount;
    },
    get resizeGeneration() {
      return resizeGeneration;
    },
    get inFlightRenderRevision() {
      return inFlightRenderRevision;
    },
    get pendingRenderRevision() {
      return pendingRender?.command.renderRevision ?? null;
    },
    get knownImageSources() {
      return inFlightImageSources ?? residentImageSources;
    },
    post(command, transfer) {
      if (!worker || permanentFailure) {
        closeCommandResources(command);
        return false;
      }
      if (command.type === 'render') {
        const normalized = normalizeRenderCommand(command);
        if (
          latestRequestedRevision !== null &&
          normalized.renderRevision < latestRequestedRevision
        ) {
          closeCommandResources(normalized);
          return false;
        }
        const transferBytes = estimateImagesBytes(normalized.images ?? {});
        // Admission control: refuse the render up front when its image
        // transfer would blow the worker-bitmap budget. The caller falls back
        // to the main-thread path, which already holds these images in
        // ImageCache, so nothing is lost.
        if (!bitmapBudget.tryReserveTransfer(transferBytes)) {
          closeCommandResources(normalized);
          return false;
        }
        latestRequestedRevision = normalized.renderRevision;
        latestFrameIdentity = { viewport: normalized.viewport, dpr: normalized.dpr };
        if (inFlightRenderRevision !== null) {
          closePendingRender();
          pendingRender = { command: normalized, transfer, transferBytes };
          return true;
        }
        return dispatchRender({ command: normalized, transfer, transferBytes });
      }
      try {
        postToWorker(command, transfer);
      } catch {
        closeCommandResources(command);
        markPermanentFailure();
        return false;
      }
      if (command.type === 'resize') {
        resizeGeneration++;
        // Account the worker's OffscreenCanvas backing store for diagnostics.
        bitmapBudget.setWorkerCanvasBytes(
          estimateRgbaBytes(command.width * command.dpr, command.height * command.dpr),
        );
      }
      return true;
    },
    releaseFrame(bitmap) {
      if (bitmap !== lastForwardedFrame) {
        // A duplicate or stale release: harmless, but recorded so a caller
        // that double-disposes is visible in diagnostics rather than silent.
        ledger.close(-1);
        return false;
      }
      bitmapBudget.releaseResident(lastForwardedFrameBytes);
      if (lastForwardedFrameId !== null) ledger.close(lastForwardedFrameId);
      lastForwardedFrame = null;
      lastForwardedFrameBytes = 0;
      lastForwardedFrameId = null;
      return true;
    },
    terminate() {
      permanentFailure = true;
      clearRestartTimeout();
      worker?.terminate();
      worker = null;
      workerGen++;
      closePendingRender();
      inFlightRenderRevision = null;
      inFlightTransferBytes = 0;
      residentImageSources.clear();
      inFlightImageSources = null;
      lastRenderCommand = null;
      lastRenderUsedTransfer = false;
      lastRenderDependsOnImages = false;
      releaseAllReservations();
      if (registeredHost === host) registerWorkerHostForDiagnostics(null);
    },
    getBitmapBudgetState() {
      return bitmapBudget.state;
    },
    getClockCalibration() {
      return clockCalibrator.calibration;
    },
    getFrameLedgerState() {
      return ledger.state;
    },
    get bitmapBudget() {
      return bitmapBudget;
    },
  };
  registerWorkerHostForDiagnostics(host);
  return host;
}

/** Drop stale worker responses when any pixel-producing input advanced. */
export function isStaleRenderResponse(
  latestRevision: RenderRevision,
  responseRevision: RenderRevision,
): boolean {
  return responseRevision < latestRevision;
}

// ── Diagnostics registry ────────────────────────────────────────────────────
// The diagnostics handle reads worker-bitmap budget state without reaching
// into a specific CanvasArea's host. Only the most recently created host is
// tracked; it is cleared when that host terminates.

let registeredHost: RenderWorkerHost | null = null;

export function registerWorkerHostForDiagnostics(host: RenderWorkerHost | null): void {
  registeredHost = host;
}

export function getRegisteredWorkerHost(): RenderWorkerHost | null {
  return registeredHost;
}

/** @deprecated Prefer isStaleRenderResponse with the distinct render revision. */
export function isStaleResponse(latestDocVersion: number, responseDocVersion: number): boolean {
  return isStaleRenderResponse(
    asRenderRevision(latestDocVersion),
    asRenderRevision(responseDocVersion),
  );
}
