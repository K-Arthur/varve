import { removeBackgroundHeuristic } from './heuristic';
import { decontaminateMask } from './maskOps';
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

function transferImageData(imageData: ImageData): ImageData {
  return imageData;
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
): Promise<BackgroundRemovalResult> {
  if (imageData.width === 0 || imageData.height === 0) {
    throw new Error('Cannot remove background from a 0-byte image (width or height is zero)');
  }

  if (options.method === 'quick') {
    return removeBackgroundHeuristic(imageData, options);
  }

  if (typeof Worker !== 'undefined') {
    try {
      return await runWorkerInference(imageData, options);
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

  const { getModelLoader } = await import('./modelLoader');
  const loader = getModelLoader();

  if (loader.getState() === 'ready') {
    try {
      return await removeBackgroundAI(imageData, options);
    } catch {
      // Last-resort AI tier failed too (e.g. cached model file went
      // missing on disk, or both WebGL and WASM execution providers are
      // unavailable in this environment). Fall through to the
      // always-available heuristic rather than surfacing a hard failure
      // for what the user experiences as "remove background didn't work".
    }
  }

  return removeBackgroundHeuristic(imageData, options);
}

async function runWorkerInference(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const workerModelId = workerModelIdForMethod(options.method);
  if (!workerModelId) {
    throw new Error(`No worker model for method: ${options.method}`);
  }
  const loader = (await import('./modelLoader')).getModelLoader();
  await loader.syncFromStorage();
  const path = (await loader.getModelPath(workerModelId)) ?? `/models/${workerModelId}.onnx`;
  return runPooledInference(imageData, options, path, workerModelId);
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
  // (the `ai` Cargo feature is opt-in per ADR-0005), so `raw.method` is the
  // ground truth for what actually ran — never trust the requested
  // `options.method` when reporting back what happened.
  return {
    maskDataUrl: `data:image/png;base64,${raw.maskBase64}`,
    confidence: raw.confidence,
    method: raw.method === 'quick' ? 'quick' : options.method,
    processingTimeMs: raw.processingTimeMs,
    width: raw.width,
    height: raw.height,
  };
}

async function removeBackgroundAI(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const start = performance.now();

  const modelId = options.method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite';
  const modelPath = `/${modelId}.onnx`;

  let ort: any;
  try {
    ort = await import('onnxruntime-web');
  } catch {
    throw new Error('ONNX Runtime Web not available. Install onnxruntime-web or use quick remove.');
  }

  const session = await ort.InferenceSession.create(modelPath);

  const inputSize = 1024;
  const resized = resizeImageData(imageData, inputSize, inputSize);
  const inputTensor = imageDataToTensor(resized);

  const feeds: Record<string, any> = {};
  const inputNames = session.inputNames;
  feeds[inputNames[0]] = inputTensor;

  const results = await session.run(feeds);
  const outputTensor = results[session.outputNames[0]];
  const outputData = outputTensor.data as Float32Array;

  const maskWidth = outputTensor.dims[3];
  const maskHeight = outputTensor.dims[2];

  const mask = new Uint8Array(maskWidth * maskHeight);
  for (let i = 0; i < outputData.length; i++) {
    mask[i] = (outputData[i] ?? 0) > 0.5 ? 255 : 0;
  }

  const upscaledMask = resizeMask(mask, maskWidth, maskHeight, imageData.width, imageData.height);

  let finalMask = upscaledMask;
  if (options.decontaminate) {
    finalMask = decontaminateMask(finalMask, imageData.width, imageData.height);
  }
  if (options.feather && options.feather > 0) {
    finalMask = await applySimpleFeather(
      finalMask,
      imageData.width,
      imageData.height,
      options.feather,
    );
  }

  const maskDataUrl = maskToDataUrl(finalMask, imageData.width, imageData.height);
  const processingTimeMs = performance.now() - start;

  return {
    maskDataUrl,
    confidence: 0.85,
    method: options.method,
    processingTimeMs: Math.round(processingTimeMs),
    width: imageData.width,
    height: imageData.height,
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

function resizeMask(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return mask;

  const result = new Uint8Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx * srcW) / dstW;
      const sy = (dy * srcH) / dstH;
      const ix = Math.min(Math.floor(sx), srcW - 1);
      const iy = Math.min(Math.floor(sy), srcH - 1);
      result[dy * dstW + dx] = mask[iy * srcW + ix] ?? 0;
    }
  }
  return result;
}

function imageDataToTensor(imageData: ImageData): any {
  const { data, width, height } = imageData;
  const floatData = new Float32Array(width * height * 3);

  for (let i = 0; i < data.length / 4; i++) {
    floatData[i] = (data[i * 4] ?? 0) / 255;
    floatData[width * height + i] = (data[i * 4 + 1] ?? 0) / 255;
    floatData[width * height * 2 + i] = (data[i * 4 + 2] ?? 0) / 255;
  }

  return new Float32Array(floatData);
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

async function applySimpleFeather(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    imageData.data[i * 4] = mask[i] ?? 0;
    imageData.data[i * 4 + 1] = mask[i] ?? 0;
    imageData.data[i * 4 + 2] = mask[i] ?? 0;
    imageData.data[i * 4 + 3] = mask[i] ?? 0;
  }
  ctx.putImageData(imageData, 0, 0);

  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = `blur(${Math.round(radius)}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';

  const blurred = ctx.getImageData(0, 0, width, height);
  const result = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) {
    result[i] = blurred.data[i * 4] ?? 0;
  }
  return result;
}
