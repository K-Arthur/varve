/**
 * Render worker host — latest-only OffscreenCanvas replay with render-revision guards.
 */
import type { SceneNode as EngineNode, RenderItem } from '@strata/engine';
import { asRenderRevision, type Camera, type RenderRevision, type Viewport } from '@strata/shared';
import { closeImageBitmapMap } from './collectImageBitmaps';
import { checkFault } from './faultInjection';
import {
  type BitmapBudgetState,
  estimateImagesBytes,
  estimateRgbaBytes,
  RenderBitmapBudget,
} from './renderBitmapBudget';

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
}

export type WorkerCommand =
  | WorkerRenderCommand
  | { type: 'hitTest'; worldX: number; worldY: number; docVersion: number }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'cancel'; docVersion: number; renderRevision?: RenderRevision };

export type WorkerResponse =
  | {
      type: 'frameRendered';
      docVersion: number;
      renderRevision: RenderRevision;
      camera: Camera;
      viewport: Viewport;
      dpr: number;
      bitmap?: ImageBitmap;
    }
  | { type: 'hitTestResult'; nodeId: number | null; docVersion: number }
  | { type: 'error'; message: string; docVersion?: number; renderRevision?: RenderRevision };

export interface RenderWorkerHost {
  /** Returns false when the host refused the command or postMessage failed. */
  post(command: WorkerCommand, transfer?: Transferable[]): boolean;
  terminate(): void;
  readonly permanentFailure: boolean;
  readonly restartCount: number;
  readonly resizeGeneration: number;
  readonly inFlightRenderRevision: RenderRevision | null;
  readonly pendingRenderRevision: RenderRevision | null;
  readonly bitmapBudget: RenderBitmapBudget;
  getBitmapBudgetState(): BitmapBudgetState;
}

export interface RenderWorkerHostOptions {
  /** Byte budget for main-thread-visible worker bitmaps (0 disables admission). */
  budgetBytes?: number;
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
  // OffscreenCanvas support is not uniform across the webview engines this app
  // ships on — current research (2026-07) found WebKitGTK's OffscreenCanvas
  // status is unreliable/inconsistently tracked across point releases, unlike
  // Chromium/WebView2/Firefox/Safari 17+ which all have mature support. The
  // worker module (`renderWorker.ts`) calls `new OffscreenCanvas(...)`
  // unguarded on its first message; on an engine without it, that throws
  // inside the worker's `onmessage` handler and only surfaces via `onerror`,
  // which would otherwise burn through 5 retries with exponential backoff
  // (up to ~30s each) before falling back to main-thread rendering — a
  // problem retrying can never fix. Feature-detecting here skips straight to
  // the main-thread fallback instead.
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;

  let worker: Worker | null = null;
  let restartCount = 0;
  let workerGen = 0;
  let resizeGeneration = 0;
  let lastRenderResizeGeneration = 0;
  let permanentFailure = false;
  let lastRenderCommand: NormalizedRenderCommand | null = null;
  let lastRenderUsedTransfer = false;
  let inFlightRenderRevision: RenderRevision | null = null;
  let inFlightTransferBytes = 0;
  let lastForwardedFrameBytes = 0;
  let pendingRender: PendingRender | null = null;
  let latestRequestedRevision: RenderRevision | null = null;
  let latestFrameIdentity: { viewport: Viewport; dpr: number } | null = null;
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  const maxRestarts = 5;
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
    lastRenderCommand = null;
    lastRenderUsedTransfer = false;
    releaseAllReservations();
    onPermanentFailure?.();
  }

  /** Release every main-thread bitmap reservation the host still holds. */
  function releaseAllReservations(): void {
    if (inFlightTransferBytes > 0) bitmapBudget.releaseTransfer(inFlightTransferBytes);
    inFlightTransferBytes = 0;
    if (lastForwardedFrameBytes > 0) bitmapBudget.releaseResident(lastForwardedFrameBytes);
    lastForwardedFrameBytes = 0;
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
    lastRenderUsedTransfer = Boolean(render.transfer?.length);
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
        if (msg.type === 'frameRendered') {
          const responseRevision = msg.renderRevision ?? asRenderRevision(msg.docVersion);
          if (inFlightRenderRevision === null || responseRevision !== inFlightRenderRevision) {
            closeResponseResources(msg);
            return;
          }
          const obsolete =
            (latestRequestedRevision !== null && responseRevision < latestRequestedRevision) ||
            lastRenderResizeGeneration !== resizeGeneration ||
            !frameIdentityMatches(msg);
          inFlightRenderRevision = null;
          // The completed render's outbound ImageBitmaps are now worker-held;
          // release the main-thread reservation so a long drag cannot accrue
          // reservations faster than frames complete.
          if (inFlightTransferBytes > 0) {
            bitmapBudget.releaseTransfer(inFlightTransferBytes);
            inFlightTransferBytes = 0;
          }
          if (obsolete) closeResponseResources(msg);
          else {
            if (msg.bitmap) {
              const frameBytes = estimateRgbaBytes(msg.bitmap.width, msg.bitmap.height);
              bitmapBudget.accountResidentFrame(frameBytes, lastForwardedFrameBytes);
              lastForwardedFrameBytes = frameBytes;
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
        if (lastRenderUsedTransfer || restartCount >= maxRestarts) {
          markPermanentFailure();
          return;
        }
        worker?.terminate();
        inFlightRenderRevision = null;
        clearRestartTimeout();
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

  return {
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
    terminate() {
      permanentFailure = true;
      clearRestartTimeout();
      worker?.terminate();
      worker = null;
      workerGen++;
      closePendingRender();
      inFlightRenderRevision = null;
      inFlightTransferBytes = 0;
      lastRenderCommand = null;
      lastRenderUsedTransfer = false;
      releaseAllReservations();
    },
    getBitmapBudgetState() {
      return bitmapBudget.state;
    },
    get bitmapBudget() {
      return bitmapBudget;
    },
  };
}

/** Drop stale worker responses when any pixel-producing input advanced. */
export function isStaleRenderResponse(
  latestRevision: RenderRevision,
  responseRevision: RenderRevision,
): boolean {
  return responseRevision < latestRevision;
}

/** @deprecated Prefer isStaleRenderResponse with the distinct render revision. */
export function isStaleResponse(latestDocVersion: number, responseDocVersion: number): boolean {
  return isStaleRenderResponse(
    asRenderRevision(latestDocVersion),
    asRenderRevision(responseDocVersion),
  );
}
