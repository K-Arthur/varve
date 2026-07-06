import { removeBackgroundHeuristic } from './heuristic';
import {
  computeMaskConfidence,
  decontaminateMask,
  featherMaskArray,
  packChwFloat32,
  resizeMaskNearestNeighbor,
  thresholdMask,
} from './maskOps';
import { runPooledInference } from './workerPool';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from './types';
import { workerModelIdForMethod } from './types';

export { removeBackgroundHeuristic } from './heuristic';
export { getModelLoader, getModelLoaderReady, resetModelLoader } from './modelLoader';
export { cancelAllWorkerJobs, terminateWorkerPool } from './workerPool';
export type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  HeuristicMethod,
  ModelMetadata,
  ModelState,
  RemovalMethod,
  WorkerModelId,
} from './types';
export { AVAILABLE_MODELS, workerModelIdForMethod } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Remove background from an ImageData buffer.
 *
 * Dispatch order:
 * 1. `method: 'quick'` — pure TypeScript heuristic, always available, no
 *    download and no IPC round-trip needed. Never touches the AI paths.
 * 2. `method: 'ai-balanced' | 'ai-quality'` — Web Worker + onnxruntime-web
 *    (WASM/WebGL). Tried FIRST for AI methods on *every* platform, including
 *    inside the Tauri webview: the desktop native `strata-bgremove` crate
 *    only ships heuristic support by default (the `ai` Cargo feature that
 *    would enable ONNX Runtime is opt-in and not part of the distributed
 *    build, per ADR-0005 offline-first bundling), so gating AI methods
 *    behind `isTauri()` would silently and permanently downgrade every
 *    desktop AI request to the heuristic with no way to recover. Routing
 *    through the Worker first means desktop users get genuine AI-quality
 *    output whenever a model has been downloaded, exactly like web users.
 * 3. Tauri native IPC — attempted only if the Worker path is unavailable or
 *    throws. Native only implements `Quick` today, so this exists as a
 *    resilient fallback (and the forward-compatible seam for a future
 *    native `ai`-feature build).
 * 4. Direct (non-Worker) onnxruntime-web import — last resort for AI
 *    methods when `Worker` doesn't exist in the current environment.
 * 5. Heuristic — final fallback when nothing else is available.
 */
export async function removeBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (imageData.width === 0 || imageData.height === 0) {
    throw new Error('Cannot remove background from a 0-byte image (width or height is zero)');
  }

  if (options.method === 'quick') {
    return removeBackgroundHeuristic(imageData, options);
  }

  if (typeof Worker !== 'undefined') {
    try {
      return await runWorkerInference(imageData, options, signal);
    } catch {
      // Fall through to native/direct/heuristic below.
    }
  }

  if (isTauri()) {
    try {
      return await invokeTauriRemoveBackground(imageData, options);
    } catch {
      // Fall through to direct/heuristic below.
    }
  }

  const workerModelId = workerModelIdForMethod(options.method);
  if (workerModelId) {
    const { getModelLoader } = await import('./modelLoader');
    const loader = getModelLoader();
    await loader.syncFromStorage();

    if (await loader.isModelAvailable(workerModelId)) {
      try {
        return await removeBackgroundAI(imageData, options, workerModelId, signal);
      } catch {
        // Last-resort AI tier failed too — fall through to heuristic.
      }
    }
  }

  return removeBackgroundHeuristic(imageData, options);
}

async function runWorkerInference(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  const workerModelId = workerModelIdForMethod(options.method);
  if (!workerModelId) {
    throw new Error(`No worker model for method: ${options.method}`);
  }
  const loader = (await import('./modelLoader')).getModelLoader();
  await loader.syncFromStorage();
  const path = (await loader.getModelPath(workerModelId)) ?? `/models/${workerModelId}.onnx`;
  return runPooledInference(imageData, options, path, workerModelId, signal);
}

/** Wire-format response from the Rust `remove_background` Tauri command
 * (see `BgRemoveResult` in `apps/desktop/src-tauri/src/lib.rs`). */
interface TauriBgRemoveResponse {
  maskBase64: string;
  confidence: number;
  method: string;
  processingTimeMs: number;
  width: number;
  height: number;
}

async function invokeTauriRemoveBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<TauriBgRemoveResponse>('remove_background', {
    imageData: Array.from(bytes),
    options: {
      method: options.method,
      tolerance: options.tolerance,
      featherRadius: options.feather,
      decontaminate: options.decontaminate ?? true,
      clickX: options.clickPoint?.x,
      clickY: options.clickPoint?.y,
    },
  });

  // Native `RemovalMethod`/`RemovalResult` only round-trips `'quick'`
  // (the `ai` Cargo feature is opt-in per ADR-0005). Never trust
  // `raw.method` for AI claims — the shipped native path always runs
  // the heuristic engine regardless of what the caller requested.
  return {
    maskDataUrl: `data:image/png;base64,${raw.maskBase64}`,
    confidence: raw.confidence,
    method: 'quick',
    processingTimeMs: raw.processingTimeMs,
    width: raw.width,
    height: raw.height,
  };
}

async function createOrtSession(
  ort: typeof import('onnxruntime-web'),
  modelPath: string,
): Promise<{
  session: import('onnxruntime-web').InferenceSession;
  executionProvider: 'webgl' | 'wasm';
}> {
  try {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['webgl', 'wasm'],
    });
    return { session, executionProvider: 'webgl' };
  } catch {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
    });
    return { session, executionProvider: 'wasm' };
  }
}

async function removeBackgroundAI(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  modelId: import('./types').WorkerModelId,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  const start = performance.now();

  const loader = (await import('./modelLoader')).getModelLoader();
  await loader.syncFromStorage();
  const modelPath = (await loader.getModelPath(modelId)) ?? `/models/${modelId}.onnx`;

  let ort: typeof import('onnxruntime-web');
  try {
    ort = await import('onnxruntime-web');
  } catch {
    throw new Error('ONNX Runtime Web not available. Install onnxruntime-web or use quick remove.');
  }

  const { session, executionProvider } = await createOrtSession(ort, modelPath);

  const inputSize = modelId === 'u2netp' ? 320 : 1024;
  const resized = resizeImageData(imageData, inputSize, inputSize);
  const floatData = packChwFloat32(resized);
  const inputTensor = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

  const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
  const inputNames = session.inputNames;
  feeds[inputNames[0]!] = inputTensor;

  const results = await session.run(feeds);
  const outputTensor = results[session.outputNames[0]!];
  const outputData = outputTensor?.data as Float32Array;

  const maskWidth = outputTensor?.dims[3] ?? inputSize;
  const maskHeight = outputTensor?.dims[2] ?? inputSize;

  const mask = thresholdMask(outputData);
  const upscaledMask = resizeMaskNearestNeighbor(
    mask,
    maskWidth,
    maskHeight,
    imageData.width,
    imageData.height,
  );

  let finalMask = upscaledMask;
  if (options.decontaminate) {
    finalMask = decontaminateMask(finalMask, imageData.width, imageData.height);
  }
  if (options.feather && options.feather > 0) {
    finalMask = featherMaskArray(finalMask, imageData.width, imageData.height, options.feather);
  }

  const maskDataUrl = maskToDataUrl(finalMask, imageData.width, imageData.height);
  const processingTimeMs = performance.now() - start;

  return {
    maskDataUrl,
    confidence: computeMaskConfidence(outputData),
    method: options.method,
    processingTimeMs: Math.round(processingTimeMs),
    width: imageData.width,
    height: imageData.height,
    executionProvider,
  };
}

function resizeImageData(src: ImageData, targetW: number, targetH: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d')!;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = src.width;
  tempCanvas.height = src.height;
  tempCanvas.getContext('2d')?.putImageData(src, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}

function maskToDataUrl(mask: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
