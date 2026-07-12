/**
 * Render worker host — OffscreenCanvas replay with docVersion stale guards.
 */
import type { SceneNode as EngineNode, RenderItem } from '@strata/engine';
import type { Camera, Viewport } from '@strata/shared';

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
  | { type: 'frameRendered'; docVersion: number; camera: Camera; bitmap?: ImageBitmap }
  | { type: 'hitTestResult'; nodeId: number | null; docVersion: number }
  | { type: 'error'; message: string; docVersion?: number };

export interface RenderWorkerHost {
  post(command: WorkerCommand, transfer?: Transferable[]): void;
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
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  const maxRestarts = 5;

  function createWorker(): Worker | null {
    const gen = ++workerGen;
    try {
      const w = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (gen !== workerGen) return;
        const msg = e.data;
        if (msg.type === 'frameRendered' && lastRenderResizeGeneration !== resizeGeneration) {
          return;
        }
        onResponse(msg);
      };
      w.onerror = () => {
        if (gen !== workerGen) return;
        restartCount++;
        if (restartCount >= maxRestarts) {
          permanentFailure = true;
          onPermanentFailure?.();
          return;
        }
        worker?.terminate();
        workerGen++;
        if (restartTimeout !== null) {
          clearTimeout(restartTimeout);
        }
        worker = createWorker();
        if (!worker) {
          permanentFailure = true;
          onPermanentFailure?.();
          return;
        }
        const delay = Math.min(2 ** restartCount, 30) * 1000;
        restartTimeout = setTimeout(() => {
          if (lastRenderCommand && !permanentFailure) {
            worker?.postMessage(lastRenderCommand);
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
      if (!worker || permanentFailure) return;
      if (command.type === 'render') {
        lastRenderCommand = command;
        lastRenderResizeGeneration = resizeGeneration;
      }
      if (command.type === 'resize') {
        resizeGeneration++;
      }
      try {
        if (transfer?.length) {
          worker.postMessage(command, transfer);
        } else {
          worker.postMessage(command);
        }
      } catch {
        // worker might be terminated
      }
    },
    terminate() {
      permanentFailure = true;
      if (restartTimeout !== null) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
      worker?.terminate();
      worker = null;
      workerGen++;
    },
  };
}

/** Drop stale worker responses when document version advanced. */
export function isStaleResponse(latestDocVersion: number, responseDocVersion: number): boolean {
  return responseDocVersion < latestDocVersion;
}
