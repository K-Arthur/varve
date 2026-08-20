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
  resizeMaskBilinear,
} from './maskOps';
import { validateModelContract } from './modelContract';
import { getSegmentationModelSpec, packModelInput } from './modelSpec';
import { configureOrtRuntime } from './ortRuntimeAssets';
import { downscaleImageData } from './previewDownscale';
import { computeLetterboxTransform, reconstructModelMask } from './reconstructMask';
import type { BackgroundRemovalResult, WorkerModelId } from './types';

interface WorkerCommand {
  type: 'infer';
  requestId: string;
  imageData: ImageData;
  modelPath: string;
  modelId: 'u2netp' | 'isnet-general-use' | 'birefnet-general-lite' | 'birefnet-general';
  method: 'ai-balanced' | 'ai-quality';
  reuseSession?: boolean;
  feather?: number;
  decontaminate?: boolean;
  previewMaxDimension?: number;
  /** Monotonic revision for stale-result rejection. */
  requestRevision?: number;
}

interface WorkerResponse {
  type: 'result';
  requestId: string;
  result: BackgroundRemovalResult;
}

interface WorkerError {
  type: 'error';
  requestId: string;
  message: string;
}

interface WorkerReady {
  type: 'ready';
}

let cachedSession: InferenceSession | null = null;
let cachedModelPath: string | null = null;
let cachedExecutionProvider: string = 'wasm';

/** Preferred ONNX execution providers in priority order.
 *  Determined by environment capabilities at session creation time. */
let preferredOnnxProviders: string[] | null = null;

async function getPreferredProviders(modelId: string): Promise<string[]> {
  // The bundled U²-Net graph uses MaxPool with ceil_mode, which the current
  // ONNX Runtime WebGPU EP rejects. Do not spend a provider attempt on an
  // operator-incompatible GPU graph and then poison the WASM fallback during
  // provider initialization; the 320px CPU path is the validated route.
  if (modelId === 'u2netp' || modelId === 'u2netp-int8') return ['wasm'];
  if (preferredOnnxProviders) return preferredOnnxProviders;

  try {
    const { getBestOnnxProviders } = await import('./environmentCapabilities');
    preferredOnnxProviders = await getBestOnnxProviders();
  } catch {
    preferredOnnxProviders = ['wasm'];
  }

  // Unknown providers are silently ignored by ONNX Runtime.
  return preferredOnnxProviders;
}

async function getSession(
  modelPath: string,
  modelId: string,
): Promise<{ session: InferenceSession; executionProvider: string }> {
  if (cachedSession && cachedModelPath === modelPath) {
    return { session: cachedSession, executionProvider: cachedExecutionProvider };
  }
  if (cachedSession) {
    await cachedSession.release();
    cachedSession = null;
    cachedModelPath = null;
  }
  const ort = await import('onnxruntime-web');
  configureOrtRuntime(ort);

  const providers = await getPreferredProviders(modelId);

  // Try every accelerated provider first. Bare WASM is handled separately
  // below, gated behind a memory-safety preflight.
  let lastError: Error | null = null;
  for (const provider of providers) {
    if (provider === 'wasm') continue;
    try {
      cachedSession = await ort.InferenceSession.create(modelPath, {
        // A single EP per attempt makes the reported provider truthful. With
        // `[provider, 'wasm']`, ORT can discard an unavailable provider and
        // silently create a WASM session.
        executionProviders: [provider],
      });
      verifySessionContract(modelId, cachedSession);
      cachedExecutionProvider = provider;
      cachedModelPath = modelPath;
      return { session: cachedSession, executionProvider: provider };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // No accelerated provider succeeded (or none exists) — the only remaining
  // option is bare WASM, which is the exact path that produced a
  // std::bad_alloc crash on BiRefNet in a GPU-less sandbox (WASM linear
  // memory has no controlled way to reject an over-large grow request, and
  // that failure mode can abort the worker outright rather than reject this
  // promise). Refuse the attempt before ONNX Runtime allocates anything
  // instead of catching the fallout afterward.
  const { isWasmModelSafe } = await import('./environmentCapabilities');
  if (!(await isWasmModelSafe(modelId))) {
    throw new Error(
      `This model exceeds the safe WASM memory limit in this environment (no GPU acceleration available). ${
        lastError ? `Accelerated backend also failed: ${lastError.message}` : ''
      }`.trim(),
    );
  }

  cachedSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['wasm'],
  });
  verifySessionContract(modelId, cachedSession);
  cachedExecutionProvider = 'wasm';
  cachedModelPath = modelPath;
  return { session: cachedSession, executionProvider: 'wasm' };
}

/**
 * Verify the ONNX session matches the expected model contract.
 * Throws on mismatch so a corrupted or wrong model file fails fast
 * instead of producing garbage output.
 */
function verifySessionContract(modelId: string, session: InferenceSession): void {
  const result = validateModelContract(
    modelId as WorkerModelId,
    session.inputNames,
    session.outputNames,
  );
  if (!result.valid) {
    const details = result.violations
      .map((v) => `${v.kind}[${v.index}].${v.field}: expected ${v.expected}, got ${v.actual}`)
      .join('; ');
    throw new Error(`Model contract verification failed for ${modelId}: ${details}`);
  }
}

/** Reset cached provider preference (used in tests and when environment changes). */
export function __resetPreferredProviders(): void {
  preferredOnnxProviders = null;
}

self.onmessage = async (e: MessageEvent<unknown>) => {
  const data = e.data as Partial<WorkerCommand> | undefined;
  if (!data || typeof data !== 'object' || data.type !== 'infer' || !data.requestId) {
    return;
  }
  const {
    requestId,
    imageData,
    modelPath,
    modelId,
    method,
    reuseSession,
    feather,
    decontaminate,
    previewMaxDimension,
    requestRevision,
  } = data as WorkerCommand;

  try {
    const start = performance.now();
    const hadSession = cachedSession !== null && cachedModelPath === modelPath;
    const { session, executionProvider } =
      reuseSession && hadSession && cachedSession
        ? { session: cachedSession, executionProvider: cachedExecutionProvider }
        : await getSession(modelPath, modelId);

    if (!hadSession) {
      self.postMessage({ type: 'ready' } satisfies WorkerReady);
    }

    const ort = await import('onnxruntime-web');

    const spec = getSegmentationModelSpec(modelId);
    const inputSize = spec.inputSize;

    const sourceImage =
      previewMaxDimension && previewMaxDimension > 0
        ? downscaleImageData(imageData, previewMaxDimension)
        : imageData;

    const resizedCanvas = new OffscreenCanvas(inputSize, inputSize);
    const resizedCtx = resizedCanvas.getContext('2d')!;
    const inputTransform = computeLetterboxTransform(
      sourceImage.width,
      sourceImage.height,
      inputSize,
      inputSize,
    );
    resizedCtx.fillStyle = `rgb(${spec.paddingRgb[0]} ${spec.paddingRgb[1]} ${spec.paddingRgb[2]})`;
    resizedCtx.fillRect(0, 0, inputSize, inputSize);

    const imageBitmap = await createImageBitmap(sourceImage);
    resizedCtx.drawImage(
      imageBitmap,
      inputTransform.offsetX,
      inputTransform.offsetY,
      sourceImage.width * inputTransform.scaleX,
      sourceImage.height * inputTransform.scaleY,
    );
    imageBitmap.close();
    const resizedData = resizedCtx.getImageData(0, 0, inputSize, inputSize);

    const floatData = packModelInput(resizedData, spec);

    const inputName = session.inputNames[0]!;
    const feeds: Record<string, Tensor> = {};
    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
    feeds[inputName] = inputTensor;

    let results: Awaited<ReturnType<typeof session.run>>;
    try {
      results = await session.run(feeds as Parameters<typeof session.run>[0]);
    } finally {
      inputTensor.dispose();
    }
    const outputName = session.outputNames[0]!;
    const outputTensor = results[outputName];
    const outputData = outputTensor?.data as Float32Array;
    if (!outputTensor || !outputData || outputData.length === 0) {
      throw new Error('ONNX inference returned an empty segmentation tensor');
    }

    const dims = outputTensor.dims;
    const maskW = dims?.[3] ?? inputSize;
    const maskH = dims?.[2] ?? inputSize;
    const mask = normalizeSegmentationOutput(outputData, spec.applySigmoid);
    outputTensor.dispose();

    // Cap upsample to previewMax as defense-in-depth; the engine entry already
    // caps imageData to this dimension before dispatch.
    const outputTransform = computeLetterboxTransform(
      sourceImage.width,
      sourceImage.height,
      maskW,
      maskH,
    );
    const previewMask = reconstructModelMask(mask, maskW, maskH, outputTransform).alpha;
    const upsampleW = imageData.width;
    const upsampleH = imageData.height;
    let fullMask =
      sourceImage.width === upsampleW && sourceImage.height === upsampleH
        ? previewMask
        : resizeMaskBilinear(
            previewMask,
            sourceImage.width,
            sourceImage.height,
            upsampleW,
            upsampleH,
          );

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
      refined.data[i * 4 + 3] = v;
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

    const isInt8 = modelId.endsWith('-int8');
    const response: WorkerResponse = {
      type: 'result',
      requestId,
      result: {
        maskDataUrl,
        confidence: computeMaskConfidence(Float32Array.from(mask, (value) => value / 255)),
        method,
        processingTimeMs,
        width: upsampleW,
        height: upsampleH,
        executionProvider: executionProvider as 'webgpu' | 'webgl' | 'wasm',
        modelId,
        modelPrecision: isInt8 ? 'int8' : 'fp32',
        rawMask: fullMask,
        requestRevision,
      },
    };
    self.postMessage(response);
  } catch (err) {
    const error: WorkerError = { type: 'error', requestId, message: (err as Error).message };
    self.postMessage(error);
  }
};
