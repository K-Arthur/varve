/**
 * Render worker host — OffscreenCanvas replay with docVersion stale guards.
 */
import type { SceneNode as EngineNode, RenderItem } from '@strata/engine';
import type { Camera, Viewport } from '@strata/shared';
import { closeImageBitmapMap } from './collectImageBitmaps';

export type WorkerCommand =
  | {
      type: 'render';
      nodes: EngineNode[];
      ir: RenderItem[];
      camera: Camera;
      viewport: Viewport;
      docVersion: number;
      dpr: number;
      /** Pre-decoded ImageBitmaps keyed by image src URL (Structured Clone transport). */
      images?: Record<string, ImageBitmap>;
    }
  | { type: 'hitTest'; worldX: number; worldY: number; docVersion: number }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'cancel'; docVersion: number };

export type WorkerResponse =
  | {
      type: 'frameRendered';
      docVersion: number;
      camera: Camera;
      viewport: Viewport;
      dpr: number;
      bitmap?: ImageBitmap;
    }
  | { type: 'hitTestResult'; nodeId: number | null; docVersion: number }
  | { type: 'error'; message: string; docVersion?: number };

export interface RenderWorkerHost {
  /** Returns false when the host refused the command or postMessage failed. */
  post(command: WorkerCommand, transfer?: Transferable[]): boolean;
  terminate(): void;
  readonly permanentFailure: boolean;
  readonly restartCount: number;
  readonly resizeGeneration: number;
}

export function createRenderWorkerHost(
  onResponse: (msg: WorkerResponse) => void,
  onPermanentFailure?: () => void,
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
  let lastRenderCommand: WorkerCommand | null = null;
  let lastRenderUsedTransfer = false;
  let latestFrameIdentity: { viewport: Viewport; dpr: number } | null = null;
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  const maxRestarts = 5;

  function closeCommandResources(command: WorkerCommand): void {
    if (command.type === 'render' && command.images) closeImageBitmapMap(command.images);
  }

  function closeResponseResources(response: WorkerResponse): void {
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
    lastRenderCommand = null;
    lastRenderUsedTransfer = false;
    onPermanentFailure?.();
  }

  function frameIdentityMatches(response: Extract<WorkerResponse, { type: 'frameRendered' }>) {
    return (
      latestFrameIdentity !== null &&
      response.dpr === latestFrameIdentity.dpr &&
      response.viewport.width === latestFrameIdentity.viewport.width &&
      response.viewport.height === latestFrameIdentity.viewport.height
    );
  }

  function createWorker(): Worker | null {
    const gen = ++workerGen;
    try {
      const w = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (gen !== workerGen) {
          closeResponseResources(msg);
          return;
        }
        if (
          msg.type === 'frameRendered' &&
          (lastRenderResizeGeneration !== resizeGeneration || !frameIdentityMatches(msg))
        ) {
          closeResponseResources(msg);
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
        clearRestartTimeout();
        worker = createWorker();
        if (!worker) {
          markPermanentFailure();
          return;
        }
        const delay = Math.min(2 ** restartCount, 30) * 1000;
        restartTimeout = setTimeout(() => {
          if (lastRenderCommand && !permanentFailure) {
            try {
              worker?.postMessage(lastRenderCommand);
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
    post(command, transfer) {
      if (!worker || permanentFailure) {
        closeCommandResources(command);
        return false;
      }
      try {
        if (transfer?.length) {
          worker.postMessage(command, transfer);
        } else {
          worker.postMessage(command);
        }
      } catch {
        closeCommandResources(command);
        markPermanentFailure();
        return false;
      }
      if (command.type === 'render') {
        lastRenderUsedTransfer = Boolean(transfer?.length);
        // Commands containing ImageBitmaps are resource-bearing even when a
        // caller accidentally omits the transfer list; never retain them.
        lastRenderCommand = lastRenderUsedTransfer || command.images ? null : command;
        lastRenderResizeGeneration = resizeGeneration;
        latestFrameIdentity = { viewport: command.viewport, dpr: command.dpr };
      }
      if (command.type === 'resize') {
        resizeGeneration++;
      }
      return true;
    },
    terminate() {
      permanentFailure = true;
      clearRestartTimeout();
      worker?.terminate();
      worker = null;
      workerGen++;
      lastRenderCommand = null;
      lastRenderUsedTransfer = false;
    },
  };
}

/** Drop stale worker responses when document version advanced. */
export function isStaleResponse(latestDocVersion: number, responseDocVersion: number): boolean {
  return responseDocVersion < latestDocVersion;
}
