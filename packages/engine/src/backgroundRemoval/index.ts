import { removeBackgroundHeuristic } from './heuristic';
import { runPooledInference } from './workerPool';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from './types';

export { removeBackgroundHeuristic } from './heuristic';
export { getModelLoader, resetModelLoader } from './modelLoader';
export { cancelAllWorkerJobs, terminateWorkerPool } from './workerPool';
export type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  HeuristicMethod,
  ModelMetadata,
  ModelState,
  RemovalMethod,
} from './types';
export { AVAILABLE_MODELS } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

function transferImageData(imageData: ImageData): ImageData {
  return imageData;
}

/**
 * Remove background from an ImageData buffer.
 *
 * Supports three paths:
 * 1. `method: 'quick'` — pure TypeScript heuristic (no download needed)
 * 2. `method: 'ai-balanced' | 'ai-quality'` — Web Worker with ONNX model (browser)
 * 3. Tauri — native Rust inference via IPC
 *
 * Web Worker and AI methods fall back to heuristic when unavailable.
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

  if (isTauri()) {
    return invokeTauriRemoveBackground(imageData, options);
  }

  if (typeof Worker !== 'undefined') {
    try {
      return await runWorkerInference(imageData, options);
    } catch {
      // Fall through to heuristic
    }
  }

  const { getModelLoader } = await import('./modelLoader');
  const loader = getModelLoader();

  if (loader.getState() === 'ready') {
    return removeBackgroundAI(imageData, options);
  }

  return removeBackgroundHeuristic(imageData, options);
}

async function runWorkerInference(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const modelId = options.method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite';
  const workerModelId =
    options.method === 'ai-quality' ? ('birefnet-general-lite' as const) : ('u2netp' as const);
  const loader = (await import('./modelLoader')).getModelLoader();
  const path = (await loader.getModelPath(workerModelId)) ?? `/models/${workerModelId}.onnx`;
  return runPooledInference(imageData, options, path, workerModelId);
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
  return invoke('remove_background', {
    imageData: Array.from(bytes),
    options: {
      method: options.method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite',
      featherRadius: options.feather ?? 0,
      smoothIterations: options.smooth ?? 0,
      decontaminate: options.decontaminate ?? true,
    },
  });
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
