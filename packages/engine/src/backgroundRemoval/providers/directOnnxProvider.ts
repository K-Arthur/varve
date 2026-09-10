import { maskToDataUrl } from '../heuristic';
import {
  computeMaskConfidence,
  decontaminateMask,
  featherMaskArray,
  normalizeSegmentationOutput,
  resizeMaskBilinear,
} from '../maskOps';
import { resolveWebModel } from '../modelSelection';
import { getSegmentationModelSpec, packModelInput } from '../modelSpec';
import { configureOrtRuntime } from '../ortRuntimeAssets';
import { downscaleImageData } from '../previewDownscale';
import { computeLetterboxTransform, reconstructModelMask } from '../reconstructMask';
import type { BackgroundRemovalOptions, BackgroundRemovalResult, WorkerModelId } from '../types';
import { DEFAULT_PREVIEW_MAX_DIMENSION, workerModelIdForMethod } from '../types';
import type { RemovalProvider } from './types';

async function getPreferredProviders(modelId: string): Promise<string[]> {
  // Keep the bundled U²-Net graph on its validated CPU path. Its MaxPool
  // ceil_mode is not supported by the current ONNX Runtime WebGPU EP, and a
  // failed GPU probe can leave the later WASM initialization unusable.
  if (modelId === 'u2netp' || modelId === 'u2netp-int8') return ['wasm'];
  try {
    const { getBestOnnxProviders } = await import('../environmentCapabilities');
    return getBestOnnxProviders();
  } catch {
    return ['wasm'];
  }
}

async function createOrtSession(
  ort: typeof import('onnxruntime-web'),
  modelPath: string,
  modelId: string,
): Promise<{
  session: import('onnxruntime-web').InferenceSession;
  executionProvider: string;
}> {
  configureOrtRuntime(ort);

  const providers = await getPreferredProviders(modelId);

  // Try every accelerated provider first; bare WASM is gated below.
  let lastError: Error | null = null;
  for (const provider of providers) {
    if (provider === 'wasm') continue;
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        // Use one provider per attempt. Supplying `wasm` as an in-session
        // fallback makes a successful create ambiguous: ORT can silently
        // remove the requested EP and initialize WASM instead, while we
        // incorrectly report the accelerated provider as the one in use.
        executionProviders: [provider],
      });
      return { session, executionProvider: provider };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // No accelerated provider succeeded (or none exists) — refuse a bare-WASM
  // attempt for models known to exceed the safe WASM memory ceiling instead
  // of letting ONNX Runtime attempt the allocation. See worker.ts getSession
  // for the full rationale (std::bad_alloc can abort the thread outright).
  const { isWasmModelSafe } = await import('../environmentCapabilities');
  if (!(await isWasmModelSafe(modelId))) {
    throw new Error(
      `This model exceeds the safe WASM memory limit in this environment (no GPU acceleration available). ${
        lastError ? `Accelerated backend also failed: ${lastError.message}` : ''
      }`.trim(),
    );
  }

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['wasm'],
  });
  return { session, executionProvider: 'wasm' };
}

function letterboxImageDataToModelInput(
  src: ImageData,
  targetW: number,
  targetH: number,
  paddingRgb: readonly [number, number, number],
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d')!;
  if (typeof ctx.fillRect === 'function') {
    ctx.fillStyle = `rgb(${paddingRgb[0]} ${paddingRgb[1]} ${paddingRgb[2]})`;
    ctx.fillRect(0, 0, targetW, targetH);
  }
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = src.width;
  tempCanvas.height = src.height;
  tempCanvas.getContext('2d')?.putImageData(src, 0, 0);
  const transform = computeLetterboxTransform(src.width, src.height, targetW, targetH);
  ctx.drawImage(
    tempCanvas,
    transform.offsetX,
    transform.offsetY,
    src.width * transform.scaleX,
    src.height * transform.scaleY,
  );
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

  const { session, executionProvider } = await createOrtSession(ort, modelPath, modelId);

  const spec = getSegmentationModelSpec(modelId);
  const inputSize = spec.inputSize;
  const previewMax = options.previewMaxDimension ?? DEFAULT_PREVIEW_MAX_DIMENSION;
  const sourceImage = previewMax > 0 ? downscaleImageData(imageData, previewMax) : imageData;

  const resized = letterboxImageDataToModelInput(
    sourceImage,
    inputSize,
    inputSize,
    spec.paddingRgb,
  );
  const floatData = packModelInput(resized, spec);
  const inputTensor = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

  const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
  feeds[session.inputNames[0]!] = inputTensor;

  try {
    const results = await session.run(feeds);
    const outputTensor = results[session.outputNames[0]!];
    const outputData = outputTensor?.data as Float32Array;
    if (!outputTensor || !outputData || outputData.length === 0) {
      throw new Error('ONNX inference returned an empty segmentation tensor');
    }

    const maskWidth = outputTensor.dims[3] ?? inputSize;
    const maskHeight = outputTensor.dims[2] ?? inputSize;

    const mask = normalizeSegmentationOutput(outputData, spec.applySigmoid);
    const outputTransform = computeLetterboxTransform(
      sourceImage.width,
      sourceImage.height,
      maskWidth,
      maskHeight,
    );
    const previewMask = reconstructModelMask(mask, maskWidth, maskHeight, outputTransform).alpha;
    const upscaledMask =
      sourceImage.width === imageData.width && sourceImage.height === imageData.height
        ? previewMask
        : resizeMaskBilinear(
            previewMask,
            sourceImage.width,
            sourceImage.height,
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
      executionProvider: executionProvider as 'webgpu' | 'webgl' | 'wasm',
      modelId,
      rawMask: finalMask,
    };
  } finally {
    inputTensor.dispose();
    await session.release();
  }
}

export const directOnnxRemovalProvider: RemovalProvider = {
  id: 'direct-onnx',

  async isAvailable(options: BackgroundRemovalOptions, signal?: AbortSignal): Promise<boolean> {
    const workerModelId = workerModelIdForMethod(options.method);
    if (!workerModelId) return false;
    const { getModelLoader } = await import('../modelLoader');
    const loader = getModelLoader(signal);
    await loader.syncFromStorage(signal);
    return (
      (await resolveWebModel(options.method, loader, options.qualityPreference, signal)) !== null
    );
  },

  async remove(imageData, options, signal) {
    const workerModelId = workerModelIdForMethod(options.method);
    if (!workerModelId) {
      throw new Error(`No direct ONNX model for method: ${options.method}`);
    }
    const { getModelLoader } = await import('../modelLoader');
    const loader = getModelLoader(signal);
    await loader.syncFromStorage(signal);
    const resolved = await resolveWebModel(
      options.method,
      loader,
      options.qualityPreference,
      signal,
    );
    if (!resolved) throw new Error(`No installed direct ONNX model for ${options.method}`);
    return removeBackgroundDirectOnnx(imageData, options, resolved.modelId, signal);
  },
};
