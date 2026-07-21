/**
 * Generic multi-model inference worker.
 */
import type { TensorSpec } from './imageTensor';
import { packNchwTensor } from './imageTensor';
import { DD_COLOR_INPUT_SIZE, DD_COLOR_TENSOR_SPEC } from './models/ddcolor';
import { DEPTH_ANYTHING_INPUT_SIZE, DEPTH_ANYTHING_TENSOR_SPEC } from './models/depth';
import { LINE_ART_INPUT_SIZE, LINE_ART_TENSOR_SPEC } from './models/lineArt';
import type { Sam2Prompt } from './models/sam2';
import { encodeSam2Prompts, SAM2_INPUT_SIZE, SAM2_TENSOR_SPEC } from './models/sam2';
import { SCUNET_INPUT_SIZE, SCUNET_TENSOR_SPEC } from './models/scunet';

export type WorkerModelType =
  | 'sam2'
  | 'sam2-encoder'
  | 'sam2-decoder'
  | 'scunet'
  | 'depth'
  | 'lineart'
  | 'ddcolor';

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
  embeddings?: Record<string, WorkerTensor>;
  embedding?: WorkerTensor;
  params?: Record<string, unknown>;
  reuseSession?: boolean;
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
  encodePrompts?: (params: Record<string, unknown>) => Record<string, Float32Array>;
  getFeedDims?: (
    params: Record<string, unknown>,
    encoded: Record<string, Float32Array>,
  ) => Record<string, number[]>;
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
    const encoded = encodeSam2Prompts(prompt);
    return {
      point_coords: encoded.pointCoords.data,
      point_labels: encoded.pointLabels.data,
      mask_input: encoded.maskInput.data,
      has_mask_input: encoded.hasMaskInput.data,
    };
  },
  getFeedDims: (params: Record<string, unknown>, _encoded: Record<string, Float32Array>) => {
    const prompt: Sam2Prompt = {
      points: params.points as Sam2Prompt['points'],
      box: params.box as Sam2Prompt['box'],
      previousMask: params.previousMask as Sam2Prompt['previousMask'],
    };
    const withDims = encodeSam2Prompts(prompt);
    return {
      point_coords: withDims.pointCoords.dims,
      point_labels: withDims.pointLabels.dims,
      mask_input: withDims.maskInput.dims,
      has_mask_input: withDims.hasMaskInput.dims,
    };
  },
});

registerModelType('scunet', {
  tensorSpec: SCUNET_TENSOR_SPEC,
  getInputSize: () => SCUNET_INPUT_SIZE,
  hasImageInput: true,
});

registerModelType('lineart', {
  tensorSpec: LINE_ART_TENSOR_SPEC,
  getInputSize: () => LINE_ART_INPUT_SIZE,
  hasImageInput: true,
});

registerModelType('ddcolor', {
  tensorSpec: DD_COLOR_TENSOR_SPEC,
  getInputSize: () => DD_COLOR_INPUT_SIZE,
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
      const cs: CachedSession = {
        session,
        executionProvider: provider,
        loadedAt: Date.now(),
        modelType,
      };
      sessionCache.set(cacheKey, cs);
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

  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
  const cs: CachedSession = { session, executionProvider: 'wasm', loadedAt: Date.now(), modelType };
  sessionCache.set(cacheKey, cs);
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
    embedding,
    params,
    reuseSession,
    targetWidth,
    targetHeight,
  } = data;

  try {
    const modelPre = modelRegistry.get(modelType);
    if (!modelPre) throw new Error(`Unknown model type: ${modelType}`);

    const ort = (await import('onnxruntime-web')) as OrtModule;
    const cacheKey = `${modelType}:${modelPath}`;
    const cached = sessionCache.get(cacheKey);
    const hadSession = !!cached && cached.session;
    const { session, executionProvider } =
      reuseSession && hadSession
        ? { session: cached!.session, executionProvider: cached!.executionProvider }
        : await getSession(modelPath, modelId, modelType);
    if (!hadSession) self.postMessage({ type: 'ready' } satisfies WorkerReady);

    const inputNames = (session as OrtSession).inputNames;
    const feeds: Record<string, unknown> = {};
    const inputNameSet = new Set(inputNames);

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
      for (const [key, tensor] of Object.entries(embeddings)) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) feeds[match] = new ort.Tensor('float32', tensor.data, tensor.dims);
      }
    }

    if (embedding) {
      const embName = inputNames.find((n) =>
        ['image_embeddings', 'image_embedding', 'embedding'].includes(n.toLowerCase()),
      );
      if (embName) feeds[embName] = new ort.Tensor('float32', embedding.data, embedding.dims);
    }

    if (modelPre.encodePrompts && params) {
      const encoded = modelPre.encodePrompts(params);
      const dimsMap = modelPre.getFeedDims?.(params, encoded) ?? {};
      for (const [key, tensorData] of Object.entries(encoded)) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          const dims = dimsMap[key] ?? [1, tensorData.length];
          feeds[match] = new ort.Tensor('float32', tensorData, dims);
        }
      }
    }

    const results = await (session as OrtSession).run(feeds);
    const outputNames = (session as OrtSession).outputNames;
    const outputs: Record<string, unknown> = { executionProvider };
    for (const name of outputNames) {
      const tensor = results[name] as { data: Float32Array; dims: number[] } | undefined;
      if (tensor) outputs[name] = { data: tensor.data, dims: tensor.dims };
    }
    if (modelPre.hasImageInput && imageData) {
      outputs.originalWidth = targetWidth ?? imageData.width;
      outputs.originalHeight = targetHeight ?? imageData.height;
      outputs.paddedWidth = imageData.width;
      outputs.paddedHeight = imageData.height;
    }
    self.postMessage({ type: 'result', requestId, modelType, outputs } satisfies WorkerInferResult);
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerInferError);
  }
};

export function __resetSessionCache(): void {
  sessionCache.clear();
  preferredOnnxProviders = null;
}
