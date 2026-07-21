/**
 * Generic multi-model inference worker — handles ONNX inference for
 * any registered model type in a single worker thread.
 *
 * Supports both single-graph models (SCUNet, depth) and multi-component
 * models (SAM2 with separate encoder + decoder graphs).
 *
 * Protocol: main thread sends { type: 'infer', modelType, ...inputs }
 * Worker responds with { type: 'result', outputs } or { type: 'error' }
 */
import type { TensorSpec } from './imageTensor';
import { packNchwTensor } from './imageTensor';
import { DEPTH_ANYTHING_INPUT_SIZE, DEPTH_ANYTHING_TENSOR_SPEC } from './models/depth';
import { LINE_ART_INPUT_SIZE, LINE_ART_TENSOR_SPEC } from './models/lineArt';
import type { Sam2Letterbox, Sam2Prompt } from './models/sam2';
import { encodeSam2Prompts, SAM2_INPUT_SIZE, SAM2_TENSOR_SPEC } from './models/sam2';

export type WorkerModelType =
  | 'sam2'
  | 'sam2-encoder'
  | 'sam2-decoder'
  | 'scunet'
  | 'depth'
  | 'lineart';

export interface WorkerTensor {
  data: Float32Array;
  dims: number[];
}

export interface WorkerInferRequest {
  type: 'infer';
  requestId: string;
  modelType: WorkerModelType;
  modelPath: string;
  modelId: string;
  imageData?: ImageData;
  /**
   * Pre-computed tensors from a prior encoder call, fed directly by name
   * (e.g. SAM2's image_embed/high_res_feats_0/high_res_feats_1). Unlike a
   * single embedding blob, some models (SAM2) need several named tensors.
   */
  embeddings?: Record<string, WorkerTensor>;
  /** Model-specific parameters */
  params?: Record<string, unknown>;
  reuseSession?: boolean;
  /** Target output dimensions (for resize after inference) */
  targetWidth?: number;
  targetHeight?: number;
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

interface ModelPreprocessor {
  tensorSpec: TensorSpec;
  getInputSize: () => number;
  encodePrompts?: (params: Record<string, unknown>) => Record<string, WorkerTensor>;
  hasImageInput: boolean;
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
  hasImageInput: true,
});

/**
 * Legacy single-graph registration. No combined SAM2 ONNX export actually
 * exists (verified — real exports split encoder/decoder); kept only so
 * existing tests that register a mock 'sam2' type keep compiling. The app
 * always uses 'sam2-encoder' + 'sam2-decoder' below.
 */
registerModelType('sam2', {
  tensorSpec: SAM2_TENSOR_SPEC,
  getInputSize: () => SAM2_INPUT_SIZE,
  hasImageInput: true,
});

registerModelType('sam2-encoder', {
  tensorSpec: SAM2_TENSOR_SPEC,
  getInputSize: () => SAM2_INPUT_SIZE,
  hasImageInput: true,
});

registerModelType('sam2-decoder', {
  tensorSpec: SAM2_TENSOR_SPEC,
  getInputSize: () => SAM2_INPUT_SIZE,
  hasImageInput: false,
  encodePrompts: (params: Record<string, unknown>) => {
    const prompt: Sam2Prompt = {
      points: params.points as Sam2Prompt['points'],
      box: params.box as Sam2Prompt['box'],
      previousMask: params.previousMask as Sam2Prompt['previousMask'],
    };
    // The decoder call has no imageData of its own (it consumes cached
    // encoder embeddings), so the letterbox transform can't be recomputed
    // here — it must be the one the caller cached from the encoder call
    // that produced those embeddings. See sam2.ts encodeSam2Prompts for
    // why using the wrong (or no) offset silently breaks non-square images.
    const letterbox = params.letterbox as Sam2Letterbox | undefined;
    const encoded = encodeSam2Prompts(prompt, letterbox);
    return {
      point_coords: encoded.pointCoords,
      point_labels: encoded.pointLabels,
      mask_input: encoded.maskInput,
      has_mask_input: encoded.hasMaskInput,
    };
  },
});

registerModelType('scunet', {
  tensorSpec: {
    inputWidth: 0,
    inputHeight: 0,
    mean: [0, 0, 0],
    std: [1, 1, 1],
    paddingRgb: [0, 0, 0],
  },
  getInputSize: () => 0,
  hasImageInput: true,
});

registerModelType('lineart', {
  tensorSpec: LINE_ART_TENSOR_SPEC,
  getInputSize: () => LINE_ART_INPUT_SIZE,
  hasImageInput: true,
});

interface CachedSession {
  session: unknown;
  executionProvider: string;
  loadedAt: number;
  modelType: WorkerModelType;
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
  modelType: WorkerModelType,
): Promise<{ session: unknown; executionProvider: string }> {
  const cacheKey = `${modelType}:${modelPath}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) return { session: cached.session, executionProvider: cached.executionProvider };

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
        modelType,
      };
      sessionCache.set(cacheKey, cachedSession);
      return { session, executionProvider: provider };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

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
  const cachedSession: CachedSession = {
    session,
    executionProvider: 'wasm',
    loadedAt: Date.now(),
    modelType,
  };
  sessionCache.set(cacheKey, cachedSession);
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

  const {
    requestId,
    modelType,
    modelPath,
    modelId,
    imageData,
    embeddings,
    params,
    reuseSession,
    targetWidth,
    targetHeight,
  } = data;

  try {
    const modelPre = modelRegistry.get(modelType);
    if (!modelPre) {
      throw new Error(`Unknown model type: ${modelType}`);
    }

    const ort = (await import('onnxruntime-web')) as OrtModule;
    const cacheKey = `${modelType}:${modelPath}`;
    const cached = sessionCache.get(cacheKey);
    const hadSession = !!cached && cached.session;

    const { session, executionProvider } =
      reuseSession && hadSession
        ? { session: cached!.session, executionProvider: cached!.executionProvider }
        : await getSession(modelPath, modelId, modelType);

    if (!hadSession) {
      self.postMessage({ type: 'ready' } satisfies WorkerReady);
    }

    const inputNames = (session as OrtSession).inputNames;
    const feeds: Record<string, unknown> = {};
    let letterbox: { offsetX: number; offsetY: number } | null = null;

    if (modelPre.hasImageInput && imageData) {
      const inputSize = modelPre.getInputSize();
      const spec = modelPre.tensorSpec;

      let imageTensor: Float32Array;
      let actualW: number;
      let actualH: number;

      if (inputSize > 0) {
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
        letterbox = { offsetX, offsetY };

        ctx.drawImage(
          srcCanvas,
          offsetX,
          offsetY,
          imageData.width * scale,
          imageData.height * scale,
        );
        const resizedData = ctx.getImageData(0, 0, inputSize, inputSize);
        imageTensor = packNchwTensor(resizedData, spec);
        actualW = inputSize;
        actualH = inputSize;
      } else {
        actualW = imageData.width;
        actualH = imageData.height;
        const pixelCount = actualW * actualH;
        imageTensor = new Float32Array(pixelCount * 3);
        for (let i = 0; i < pixelCount; i++) {
          const offset = i * 4;
          imageTensor[i] = imageData.data[offset]! / 255;
          imageTensor[pixelCount + i] = imageData.data[offset + 1]! / 255;
          imageTensor[pixelCount * 2 + i] = imageData.data[offset + 2]! / 255;
        }
      }

      const imageInputName =
        inputNames.find((n) =>
          ['image', 'pixel_values', 'input_image', 'x'].includes(n.toLowerCase()),
        ) ?? inputNames[0]!;
      feeds[imageInputName] = new ort.Tensor('float32', imageTensor, [1, 3, actualH, actualW]);
    }

    if (embeddings) {
      const inputNameSet = new Set(inputNames);
      for (const [key, tensor] of Object.entries(embeddings)) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          feeds[match] = new ort.Tensor('float32', tensor.data, tensor.dims);
        }
      }
    }

    if (modelPre.encodePrompts && params) {
      const encoded = modelPre.encodePrompts(params);
      const inputNameSet = new Set(inputNames);
      for (const [key, tensor] of Object.entries(encoded)) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          feeds[match] = new ort.Tensor('float32', tensor.data, tensor.dims);
        }
      }
    }

    const results = await (session as OrtSession).run(feeds);
    const outputNames = (session as OrtSession).outputNames;
    const outputs: Record<string, unknown> = { executionProvider };

    for (const name of outputNames) {
      const tensor = results[name] as { data: Float32Array; dims: number[] } | undefined;
      if (tensor) {
        outputs[name] = { data: tensor.data, dims: tensor.dims };
      }
    }

    if (modelPre.hasImageInput && imageData) {
      outputs.originalWidth = targetWidth ?? imageData.width;
      outputs.originalHeight = targetHeight ?? imageData.height;
      outputs.paddedWidth = imageData.width;
      outputs.paddedHeight = imageData.height;
    }

    if (letterbox) {
      // Exposed so callers that need to map coordinates into the padded
      // model-input space (e.g. SAM2 prompt encoding) use the *actual*
      // transform this image went through, not a guess. See sam2.ts for
      // why this matters — naive normalized-coordinate mapping silently
      // breaks for any non-square source image.
      outputs.letterbox = letterbox;
    }

    self.postMessage({ type: 'result', requestId, modelType, outputs } satisfies WorkerInferResult);
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
