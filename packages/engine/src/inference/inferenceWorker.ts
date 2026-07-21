/**
 * Generic multi-model inference worker — handles ONNX inference for
 * any registered model type (segmentation, depth, etc.) in a single
 * worker thread.
 *
 * Protocol: main thread sends { type: 'infer', modelType, ...inputs }
 * Worker responds with { type: 'result', outputs } or { type: 'error' }
 *
 * Model-specific preprocessing/postprocessing is dispatched via a
 * registry pattern — each model type registers its pre/post functions.
 */
import type { TensorSpec } from './imageTensor';
import { packNchwTensor } from './imageTensor';
import { DEPTH_ANYTHING_INPUT_SIZE, DEPTH_ANYTHING_TENSOR_SPEC } from './models/depth';
import { SAM2_INPUT_SIZE, SAM2_TENSOR_SPEC } from './models/sam2';

/** Supported model types in this worker */
export type WorkerModelType = 'sam2' | 'depth';

export interface WorkerInferRequest {
  type: 'infer';
  requestId: string;
  modelType: WorkerModelType;
  modelPath: string;
  modelId: string;
  imageData: ImageData;
  /** Model-specific parameters */
  params: Record<string, unknown>;
  reuseSession?: boolean;
}

export interface WorkerInferResult {
  type: 'result';
  requestId: string;
  modelType: WorkerModelType;
  outputs: Record<string, unknown>;
}

export interface WorkerInferError {
  type: 'error';
  requestId: string;
  message: string;
}

export interface WorkerReady {
  type: 'ready';
}

export type WorkerRequest = WorkerInferRequest;
export type WorkerResponse = WorkerInferResult | WorkerInferError | WorkerReady;

/** Registry of model-specific preprocessors */
interface ModelPreprocessor {
  tensorSpec: TensorSpec;
  getInputSize: () => number;
  encodePrompts?: (params: Record<string, unknown>) => Record<string, Float32Array>;
}

const modelRegistry = new Map<WorkerModelType, ModelPreprocessor>();

export function registerModelType(
  modelType: WorkerModelType,
  preprocessor: ModelPreprocessor,
): void {
  modelRegistry.set(modelType, preprocessor);
}

registerModelType('depth', {
  tensorSpec: DEPTH_ANYTHING_TENSOR_SPEC,
  getInputSize: () => DEPTH_ANYTHING_INPUT_SIZE,
});

registerModelType('sam2', {
  tensorSpec: SAM2_TENSOR_SPEC,
  getInputSize: () => SAM2_INPUT_SIZE,
  encodePrompts: (params: Record<string, unknown>) => {
    const pointCoords = params.pointCoords as Float32Array | undefined;
    const pointLabels = params.pointLabels as Float32Array | undefined;
    const boxCoords = params.boxCoords as Float32Array | undefined;
    const result: Record<string, Float32Array> = {};
    if (pointCoords && pointCoords.length > 0) {
      result.point_coords = pointCoords;
      result.point_labels = pointLabels ?? new Float32Array(pointCoords.length / 2);
    }
    if (boxCoords && boxCoords.length === 4) {
      result.box_coords = boxCoords;
    }
    return result;
  },
});

/** Session cache per model path */
interface CachedSession {
  session: unknown;
  executionProvider: string;
  loadedAt: number;
}

const sessionCache = new Map<string, CachedSession>();
let preferredOnnxProviders: string[] | null = null;

async function getPreferredProviders(): Promise<string[]> {
  if (preferredOnnxProviders) return preferredOnnxProviders;
  try {
    const { getBestOnnxProviders } = await import('../backgroundRemoval/environmentCapabilities');
    preferredOnnxProviders = await getBestOnnxProviders();
  } catch {
    preferredOnnxProviders = ['wasm'];
  }
  return preferredOnnxProviders;
}

async function getSession(
  modelPath: string,
  modelId: string,
): Promise<{ session: unknown; executionProvider: string }> {
  const cached = sessionCache.get(modelPath);
  if (cached) return { session: cached.session, executionProvider: cached.executionProvider };

  // Evict oldest if at capacity (max 3 sessions)
  if (sessionCache.size >= 3) {
    const oldest = sessionCache.keys().next().value;
    if (oldest) {
      const old = sessionCache.get(oldest);
      if (old) {
        try {
          const s = old.session as { release: () => Promise<void> };
          if (typeof s.release === 'function') await s.release();
        } catch {
          /* best-effort */
        }
      }
      sessionCache.delete(oldest);
    }
  }

  const ort = (await import('onnxruntime-web')) as OrtModule;
  const providers = await getPreferredProviders();

  let lastError: Error | null = null;
  for (const provider of providers) {
    if (provider === 'wasm') continue;
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [provider],
      });
      const cachedSession: CachedSession = {
        session,
        executionProvider: provider,
        loadedAt: Date.now(),
      };
      sessionCache.set(modelPath, cachedSession);
      return { session, executionProvider: provider };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // WASM fallback with memory-safety gate
  try {
    const { isWasmModelSafe } = await import('../backgroundRemoval/environmentCapabilities');
    if (!(await isWasmModelSafe(modelId))) {
      throw new Error(
        `Model exceeds safe WASM memory limit. ${lastError ? `Accelerated backend also failed: ${lastError.message}` : ''}`.trim(),
      );
    }
  } catch (gateErr) {
    throw gateErr instanceof Error && gateErr.message.includes('safe WASM')
      ? gateErr
      : new Error(
          `Model exceeds safe WASM memory limit. ${lastError ? `Accelerated backend also failed: ${lastError.message}` : ''}`.trim(),
        );
  }

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['wasm'],
  });
  const cachedSession: CachedSession = { session, executionProvider: 'wasm', loadedAt: Date.now() };
  sessionCache.set(modelPath, cachedSession);
  return { session, executionProvider: 'wasm' };
}

interface OrtModule {
  InferenceSession: {
    create: (path: string, opts?: { executionProviders?: string[] }) => Promise<OrtSession>;
  };
  Tensor: new (type: string, data: ArrayLike<number>, dims: number[]) => unknown;
}

interface OrtSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  release: () => Promise<void>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const data = e.data;
  if (data?.type !== 'infer') return;

  const { requestId, modelType, modelPath, modelId, imageData, params, reuseSession } = data;

  try {
    const modelPre = modelRegistry.get(modelType);
    if (!modelPre) {
      throw new Error(`Unknown model type: ${modelType}`);
    }

    const ort = (await import('onnxruntime-web')) as OrtModule;
    const cached = sessionCache.get(modelPath);
    const hadSession = !!cached && cached.session;

    const { session, executionProvider } =
      reuseSession && hadSession
        ? { session: cached!.session, executionProvider: cached!.executionProvider }
        : await getSession(modelPath, modelId);

    if (!hadSession) {
      self.postMessage({ type: 'ready' } satisfies WorkerReady);
    }

    const inputSize = modelPre.getInputSize();
    const spec = modelPre.tensorSpec;

    // Preprocess: letterbox resize + NCHW pack
    const resizedCanvas = new OffscreenCanvas(inputSize, inputSize);
    const ctx = resizedCanvas.getContext('2d')!;
    ctx.fillStyle = `rgb(${spec.paddingRgb[0]} ${spec.paddingRgb[1]} ${spec.paddingRgb[2]})`;
    ctx.fillRect(0, 0, inputSize, inputSize);

    const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imageData, 0, 0);

    const scale = Math.min(inputSize / imageData.width, inputSize / imageData.height);
    const offsetX = (inputSize - imageData.width * scale) / 2;
    const offsetY = (inputSize - imageData.height * scale) / 2;

    ctx.drawImage(srcCanvas, offsetX, offsetY, imageData.width * scale, imageData.height * scale);
    const resizedData = ctx.getImageData(0, 0, inputSize, inputSize);
    const imageTensor = packNchwTensor(resizedData, spec);

    // Build input feeds
    const feeds: Record<string, unknown> = {};
    const inputNames = (session as OrtSession).inputNames;
    feeds[inputNames[0]!] = new ort.Tensor('float32', imageTensor, [1, 3, inputSize, inputSize]);

    // Add encoded prompts if the model has them.
    // Encoded prompt keys are matched against the session's actual input
    // names (e.g. "point_coords", "point_labels", "box_coords") so the
    // ordering of the ONNX graph's inputs does not matter.
    if (modelPre.encodePrompts) {
      const encoded = modelPre.encodePrompts(params);
      const inputNameSet = new Set(inputNames);
      for (const [key, arr] of Object.entries(encoded)) {
        // Match exact name or case-insensitive fallback
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          feeds[match] = new ort.Tensor('float32', arr, [1, arr.length]);
        }
      }
    }

    // Run inference
    const results = await (session as OrtSession).run(feeds);
    const outputNames = (session as OrtSession).outputNames;
    const outputTensor = results[outputNames[0]!] as { data: Float32Array; dims: number[] };
    const outputData = outputTensor.data as Float32Array;
    const dims = outputTensor.dims;

    const response: WorkerInferResult = {
      type: 'result',
      requestId,
      modelType,
      outputs: {
        data: outputData,
        dims,
        executionProvider,
        inputWidth: imageData.width,
        inputHeight: imageData.height,
      },
    };
    self.postMessage(response);
  } catch (err) {
    const error: WorkerInferError = {
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(error);
  }
};

export function __resetSessionCache(): void {
  sessionCache.clear();
  preferredOnnxProviders = null;
}
