import { maskToDataUrl } from '../heuristic';
import {
  computeMaskConfidence,
  decontaminateMask,
  featherMaskArray,
  normalizeSegmentationOutput,
  packSegmentationChwFloat32,
  resizeMaskBilinear,
} from '../maskOps';
import { downscaleImageData } from '../previewDownscale';
import type { BackgroundRemovalOptions, BackgroundRemovalResult, WorkerModelId } from '../types';
import { DEFAULT_PREVIEW_MAX_DIMENSION, workerModelIdForMethod } from '../types';
import type { RemovalProvider } from './types';

function configureOrtWasm(ort: typeof import('onnxruntime-web')): void {
  try {
    ort.env.wasm.wasmPaths = '/ort-wasm/';
  } catch {
    // Older ort builds may not expose env; ignore.
  }
}

async function createOrtSession(
  ort: typeof import('onnxruntime-web'),
  modelPath: string,
): Promise<{
  session: import('onnxruntime-web').InferenceSession;
  executionProvider: 'webgl' | 'wasm';
}> {
  configureOrtWasm(ort);
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

function resizeImageDataToModelInput(src: ImageData, targetW: number, targetH: number): ImageData {
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

async function removeBackgroundDirectOnnx(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  modelId: WorkerModelId,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  const start = performance.now();

  const { getModelLoader } = await import('../modelLoader');
  const loader = getModelLoader(signal);
  await loader.syncFromStorage(signal);
  const modelPath = (await loader.getModelPath(modelId, signal)) ?? `/models/${modelId}.onnx`;

  let ort: typeof import('onnxruntime-web');
  try {
    ort = await import('onnxruntime-web');
  } catch {
    throw new Error('ONNX Runtime Web not available. Install onnxruntime-web or use quick remove.');
  }

  const { session, executionProvider } = await createOrtSession(ort, modelPath);

  const inputSize = modelId === 'u2netp' ? 320 : 1024;
  const previewMax = options.previewMaxDimension ?? DEFAULT_PREVIEW_MAX_DIMENSION;
  const sourceImage = previewMax > 0 ? downscaleImageData(imageData, previewMax) : imageData;

  const resized = resizeImageDataToModelInput(sourceImage, inputSize, inputSize);
  const floatData = packSegmentationChwFloat32(resized);
  const inputTensor = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

  const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
  feeds[session.inputNames[0]!] = inputTensor;

  const results = await session.run(feeds);
  const outputTensor = results[session.outputNames[0]!];
  const outputData = outputTensor?.data as Float32Array;

  const maskWidth = outputTensor?.dims[3] ?? inputSize;
  const maskHeight = outputTensor?.dims[2] ?? inputSize;

  const mask = normalizeSegmentationOutput(outputData, modelId !== 'u2netp');
  const upscaledMask = resizeMaskBilinear(
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
    confidence: computeMaskConfidence(Float32Array.from(mask, (value) => value / 255)),
    method: options.method,
    processingTimeMs: Math.round(processingTimeMs),
    width: imageData.width,
    height: imageData.height,
    executionProvider,
  };
}

export const directOnnxRemovalProvider: RemovalProvider = {
  id: 'direct-onnx',

  async isAvailable(options: BackgroundRemovalOptions, signal?: AbortSignal): Promise<boolean> {
    const workerModelId = workerModelIdForMethod(options.method);
    if (!workerModelId) return false;
    const { getModelLoader } = await import('../modelLoader');
    const loader = getModelLoader(signal);
    await loader.syncFromStorage(signal);
    return loader.isModelAvailable(workerModelId, signal);
  },

  async remove(imageData, options, signal) {
    const workerModelId = workerModelIdForMethod(options.method);
    if (!workerModelId) {
      throw new Error(`No direct ONNX model for method: ${options.method}`);
    }
    return removeBackgroundDirectOnnx(imageData, options, workerModelId, signal);
  },
};
