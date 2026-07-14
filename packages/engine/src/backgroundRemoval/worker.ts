/**
 * Web Worker for ONNX model inference.
 * Runs background removal in a separate thread so the main thread
 * stays responsive during processing.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import {
  computeMaskConfidence,
  decontaminateMask,
  featherMaskArray,
  normalizeSegmentationOutput,
  packSegmentationChwFloat32,
  resizeMaskBilinear,
} from './maskOps';
import { downscaleImageData } from './previewDownscale';
import type { BackgroundRemovalResult } from './types';

interface WorkerCommand {
  type: 'infer';
  imageData: ImageData;
  modelPath: string;
  modelId: 'u2netp' | 'birefnet-general-lite' | 'birefnet-general';
  method: 'ai-balanced' | 'ai-quality';
  reuseSession?: boolean;
  feather?: number;
  decontaminate?: boolean;
  previewMaxDimension?: number;
}

interface WorkerResponse {
  type: 'result';
  result: BackgroundRemovalResult;
}

interface WorkerError {
  type: 'error';
  message: string;
}

interface WorkerReady {
  type: 'ready';
}

let cachedSession: InferenceSession | null = null;
let cachedModelPath: string | null = null;
let cachedExecutionProvider: 'webgl' | 'wasm' = 'wasm';

async function configureOrtWasm(ort: typeof import('onnxruntime-web')): Promise<void> {
  // In a module Worker the relative script URL is not reliable; publish the
  // WASM artifacts under /ort-wasm/ (copied from node_modules by the
  // copy-onnx-wasm postinstall script) and point ONNX Runtime at them.
  try {
    ort.env.wasm.wasmPaths = '/ort-wasm/';
  } catch {
    // Older ort builds may not expose env; ignore.
  }
}

async function getSession(
  modelPath: string,
): Promise<{ session: InferenceSession; executionProvider: 'webgl' | 'wasm' }> {
  if (cachedSession && cachedModelPath === modelPath) {
    return { session: cachedSession, executionProvider: cachedExecutionProvider };
  }
  if (cachedSession) {
    await cachedSession.release();
    cachedSession = null;
    cachedModelPath = null;
  }
  const ort = await import('onnxruntime-web');
  await configureOrtWasm(ort);
  try {
    cachedSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['webgl', 'wasm'],
    });
    cachedExecutionProvider = 'webgl';
  } catch {
    cachedSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
    });
    cachedExecutionProvider = 'wasm';
  }
  cachedModelPath = modelPath;
  return { session: cachedSession, executionProvider: cachedExecutionProvider };
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const {
    imageData,
    modelPath,
    modelId,
    method,
    reuseSession,
    feather,
    decontaminate,
    previewMaxDimension,
  } = e.data;

  try {
    const start = performance.now();
    const hadSession = cachedSession !== null && cachedModelPath === modelPath;
    const { session, executionProvider } =
      reuseSession && hadSession && cachedSession
        ? { session: cachedSession, executionProvider: cachedExecutionProvider }
        : await getSession(modelPath);

    if (!hadSession) {
      self.postMessage({ type: 'ready' } satisfies WorkerReady);
    }

    const ort = await import('onnxruntime-web');

    const inputSize = modelId === 'u2netp' ? 320 : 1024;

    const sourceImage =
      previewMaxDimension && previewMaxDimension > 0
        ? downscaleImageData(imageData, previewMaxDimension)
        : imageData;

    const resizedCanvas = new OffscreenCanvas(inputSize, inputSize);
    const resizedCtx = resizedCanvas.getContext('2d')!;

    const imageBitmap = await createImageBitmap(sourceImage);
    resizedCtx.drawImage(imageBitmap, 0, 0, inputSize, inputSize);
    imageBitmap.close();
    const resizedData = resizedCtx.getImageData(0, 0, inputSize, inputSize);

    const floatData = packSegmentationChwFloat32(resizedData);

    const inputName = session.inputNames[0]!;
    const feeds: Record<string, Tensor> = {};
    feeds[inputName] = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

    const results = await session.run(feeds as Parameters<typeof session.run>[0]);
    const outputName = session.outputNames[0]!;
    const outputData = results[outputName]?.data as Float32Array;

    const dims = results[outputName]?.dims;
    const maskW = dims?.[3] ?? inputSize;
    const maskH = dims?.[2] ?? inputSize;
    const mask = normalizeSegmentationOutput(outputData, modelId !== 'u2netp');

    // Cap upsample to previewMax as defense-in-depth; the engine entry already
    // caps imageData to this dimension before dispatch.
    const upsampleCap =
      previewMaxDimension && previewMaxDimension > 0 ? previewMaxDimension : imageData.width;
    const upsampleW = Math.min(imageData.width, upsampleCap);
    const upsampleH = Math.min(imageData.height, upsampleCap);
    let fullMask = resizeMaskBilinear(mask, maskW, maskH, upsampleW, upsampleH);

    if (decontaminate) {
      fullMask = decontaminateMask(fullMask, upsampleW, upsampleH);
    }
    if (feather && feather > 0) {
      fullMask = featherMaskArray(fullMask, upsampleW, upsampleH, feather);
    }

    const finalCanvas = new OffscreenCanvas(upsampleW, upsampleH);
    const finalCtx = finalCanvas.getContext('2d')!;
    const refined = finalCtx.createImageData(upsampleW, upsampleH);
    for (let i = 0; i < fullMask.length; i++) {
      const v = fullMask[i] ?? 0;
      refined.data[i * 4] = v;
      refined.data[i * 4 + 1] = v;
      refined.data[i * 4 + 2] = v;
      refined.data[i * 4 + 3] = 255;
    }
    finalCtx.putImageData(refined, 0, 0);

    const finalBlob = await finalCanvas.convertToBlob({ type: 'image/png' });
    const maskDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to encode mask PNG'));
      reader.readAsDataURL(finalBlob);
    });

    const processingTimeMs = Math.round(performance.now() - start);

    const response: WorkerResponse = {
      type: 'result',
      result: {
        maskDataUrl,
        confidence: computeMaskConfidence(Float32Array.from(mask, (value) => value / 255)),
        method,
        processingTimeMs,
        width: upsampleW,
        height: upsampleH,
        executionProvider,
      },
    };
    self.postMessage(response);
  } catch (err) {
    const error: WorkerError = { type: 'error', message: (err as Error).message };
    self.postMessage(error);
  }
};
