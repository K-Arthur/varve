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
  post(command: WorkerCommand): void;
  terminate(): void;
}

export function createRenderWorkerHost(
  onResponse: (msg: WorkerResponse) => void,
): RenderWorkerHost | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => onResponse(e.data);
    worker.onerror = () => onResponse({ type: 'error', message: 'render worker error' });
    return {
      post(command) {
        worker.postMessage(command);
      },
      terminate() {
        worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

/** Drop stale worker responses when document version advanced. */
export function isStaleResponse(latestDocVersion: number, responseDocVersion: number): boolean {
  return responseDocVersion < latestDocVersion;
}
