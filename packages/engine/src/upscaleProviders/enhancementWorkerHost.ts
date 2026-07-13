/**
 * Web Worker facade for CPU upscale/trace off the UI thread.
 * Transferable ArrayBuffers; abort via job id cancellation.
 */

import type { UpscaleOptions } from '../imageEnhancement';
import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';

export type EnhancementWorkerRequest =
  | {
      type: 'upscale';
      id: string;
      width: number;
      height: number;
      buffer: ArrayBuffer;
      options: UpscaleOptions;
      modelPath?: string;
    }
  | {
      type: 'trace';
      id: string;
      width: number;
      height: number;
      buffer: ArrayBuffer;
      options: RasterTraceOptions;
    }
  | { type: 'cancel'; id: string };

export type EnhancementWorkerResponse =
  | {
      type: 'upscale-result';
      id: string;
      width: number;
      height: number;
      buffer: ArrayBuffer;
    }
  | {
      type: 'trace-result';
      id: string;
      result: RasterTraceResult;
    }
  | { type: 'error'; id: string; message: string }
  | { type: 'cancelled'; id: string };

type Pending = {
  resolve: (value: ImageData | RasterTraceResult) => void;
  reject: (error: Error) => void;
  abortHandler?: () => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();
let nextId = 1;

function ensureWorker(): Worker {
  if (worker) return worker;
  // Bundlers resolve this as a classic/module worker URL.
  worker = new Worker(new URL('./enhancementWorker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<EnhancementWorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.type === 'cancelled') {
      entry.reject(new Error('cancelled'));
      return;
    }
    if (msg.type === 'error') {
      entry.reject(new Error(msg.message));
      return;
    }
    if (msg.type === 'upscale-result') {
      entry.resolve(new ImageData(new Uint8ClampedArray(msg.buffer), msg.width, msg.height));
      return;
    }
    entry.resolve(msg.result);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Enhancement worker failed');
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(error);
    }
  };
  return worker;
}

function imageDataToTransferable(imageData: ImageData): {
  buffer: ArrayBuffer;
  width: number;
  height: number;
} {
  const copy = new Uint8ClampedArray(imageData.data);
  return {
    buffer: copy.buffer as ArrayBuffer,
    width: imageData.width,
    height: imageData.height,
  };
}

export async function runUpscaleInWorker(
  imageData: ImageData,
  options: UpscaleOptions,
  signal?: AbortSignal,
): Promise<ImageData> {
  if (signal?.aborted) throw new Error('cancelled');
  let modelPath: string | undefined;
  if (options.method === 'ai') {
    const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
    const modelId = options.modelId ?? 'upscale-realesr-general';
    modelPath = (await getModelLoader(signal).getModelPath(modelId, signal)) ?? undefined;
    if (!modelPath) throw new Error('Install the Real-ESRGAN model in Offline Models first');
  }
  const id = `upscale-${nextId++}`;
  const { buffer, width, height } = imageDataToTransferable(imageData);
  const w = ensureWorker();
  return new Promise<ImageData>((resolve, reject) => {
    const abortHandler = () => {
      w.postMessage({ type: 'cancel', id } satisfies EnhancementWorkerRequest);
      const entry = pending.get(id);
      pending.delete(id);
      entry?.reject(new Error('cancelled'));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    pending.set(id, {
      resolve: (value) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        resolve(value as ImageData);
      },
      reject: (error) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(error);
      },
      abortHandler,
    });
    w.postMessage(
      {
        type: 'upscale',
        id,
        width,
        height,
        buffer,
        options,
        modelPath,
      } satisfies EnhancementWorkerRequest,
      [buffer],
    );
  });
}

export async function runTraceInWorker(
  imageData: ImageData,
  options: RasterTraceOptions,
  signal?: AbortSignal,
): Promise<RasterTraceResult> {
  if (signal?.aborted) throw new Error('cancelled');
  const id = `trace-${nextId++}`;
  const { buffer, width, height } = imageDataToTransferable(imageData);
  const w = ensureWorker();
  return new Promise<RasterTraceResult>((resolve, reject) => {
    const abortHandler = () => {
      w.postMessage({ type: 'cancel', id } satisfies EnhancementWorkerRequest);
      pending.delete(id);
      reject(new Error('cancelled'));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    pending.set(id, {
      resolve: (value) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        resolve(value as RasterTraceResult);
      },
      reject: (error) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(error);
      },
      abortHandler,
    });
    w.postMessage(
      { type: 'trace', id, width, height, buffer, options } satisfies EnhancementWorkerRequest,
      [buffer],
    );
  });
}

/** Test helper: reset worker singleton between tests. */
export function resetEnhancementWorkerForTests(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}
