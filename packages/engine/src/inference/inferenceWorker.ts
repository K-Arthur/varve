/**
 * Generic multi-model inference worker — handles ONNX inference for
 * any registered model type in a single worker thread.
 *
 * Supports single-graph models (SCUNet, depth), multi-component models
 * (SAM2 with separate encoder + decoder graphs), models with a second
 * image input (LaMa's mask, RIFE's second frame), models with constant
 * non-image feeds (DETR's pixel_mask), and NHWC-layout models
 * (EfficientNet-Lite).
 *
 * Protocol: main thread sends { type: 'infer', modelType, ...inputs }
 * Worker responds with { type: 'result', outputs } or { type: 'error' }
 */

import {
  DINOV2_PREPROCESS_SPEC,
  preprocessSemanticInput,
  type SemanticResizeSpec,
} from '../semanticSimilarity/preprocess';
import type { TensorSpec } from './imageTensor';
import { packNchwTensor, packNhwcTensor } from './imageTensor';
import { DD_COLOR_INPUT_SIZE, DD_COLOR_TENSOR_SPEC } from './models/ddcolor';
import { DEPTH_ANYTHING_INPUT_SIZE, DEPTH_ANYTHING_TENSOR_SPEC } from './models/depth';
import { DETR_INPUT_SIZE, DETR_TENSOR_SPEC } from './models/detr';
import { EFFICIENTNET_INPUT_SIZE, EFFICIENTNET_TENSOR_SPEC } from './models/efficientnet';
import { YU_NET_INPUT_SIZE, YU_NET_TENSOR_SPEC } from './models/faceDetect';
import { FONT_CLASSIFY_INPUT_SIZE, FONT_CLASSIFY_TENSOR_SPEC } from './models/fontClassify';
import { LAMA_INPUT_SIZE, LAMA_TENSOR_SPEC } from './models/lama';
import { LINE_ART_INPUT_SIZE, LINE_ART_TENSOR_SPEC } from './models/lineArt';
import { NAFNET_INPUT_SIZE, NAFNET_TENSOR_SPEC } from './models/nafnet';
import { PADDLE_DET_TENSOR_SPEC } from './models/paddleocr';
import { PADDLE_REC_TENSOR_SPEC } from './models/paddlerec';
import { RIFE_INPUT_SIZE, RIFE_TENSOR_SPEC } from './models/rife';
import type { Sam2Letterbox, Sam2Prompt } from './models/sam2';
import { encodeSam2Prompts, SAM2_INPUT_SIZE, SAM2_TENSOR_SPEC } from './models/sam2';
import { SCUNET_INPUT_SIZE, SCUNET_TENSOR_SPEC } from './models/scunet';
import { SIGLIP_IMAGE_SIZE, SIGLIP_IMAGE_TENSOR_SPEC, siglipConstantFeeds } from './models/siglip';
import { TROCR_INPUT_SIZE, TROCR_TENSOR_SPEC } from './models/trocr';

export type WorkerModelType =
  | 'sam2'
  | 'sam2-encoder'
  | 'sam2-decoder'
  | 'scunet'
  | 'nafnet'
  | 'depth'
  | 'lineart'
  | 'ddcolor'
  | 'lama'
  | 'rife'
  | 'detr'
  | 'face-detect'
  | 'efficientnet'
  | 'paddleocr-det'
  | 'paddleocr-rec'
  | 'trocr'
  | 'siglip-image'
  | 'siglip-text'
  | 'dinov2-image'
  | 'font-classify';

export interface WorkerTensor {
  data: Float32Array | BigInt64Array;
  dims: number[];
  dtype?: 'float32' | 'int64';
}

export interface WorkerLetterbox {
  offsetX: number;
  offsetY: number;
}

/** External-weights sidecar: the graph-internal filename and a readable URL. */
export interface ExternalDataSpec {
  path: string;
  url: string;
}

export interface WorkerInferRequest {
  type: 'infer';
  requestId: string;
  modelType: WorkerModelType;
  modelPath: string;
  modelId: string;
  /** Set for models whose weights live in a sibling `.onnx.data`. */
  externalData?: ExternalDataSpec;
  imageData?: ImageData;
  /** Second image input — LaMa's mask, or RIFE's second frame. */
  auxImageData?: ImageData;
  /** Pre-computed tensors (e.g. from a prior encoder call), fed by name. */
  tensors?: Record<string, WorkerTensor>;
  /** Model-specific parameters (e.g. SAM2 prompts). */
  params?: Record<string, unknown>;
  reuseSession?: boolean;
  /** Target output dimensions (for resize after inference). */
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

/** Describes a second image input fed alongside the primary image. */
interface AuxImageSpec {
  /** Candidate ONNX input names to match against, in priority order. Empty
   * when the aux image is concatenated onto the primary tensor instead of
   * fed as its own named input (RIFE). */
  inputNameCandidates: string[];
  tensorSpec: TensorSpec;
  inputSize: number;
  /** Pack as a single-channel tensor (LaMa's mask) instead of 3-channel RGB. */
  singleChannel?: boolean;
  /** Concatenate onto the primary image tensor's channel axis instead of
   * feeding as a separate named input (RIFE: frame0+frame1 -> 6 channels). */
  concatChannels?: boolean;
}

/** Describes a constant (non-image, non-prompt) feed a model always needs. */
interface ConstantFeed {
  dtype: 'float32' | 'int64';
  data: Float32Array | BigInt64Array;
  dims: number[];
}

interface ModelPreprocessor {
  tensorSpec: TensorSpec;
  getInputSize: () => number;
  hasImageInput: boolean;
  /** Pack the primary image in NHWC (interleaved per-pixel) instead of the
   * default NCHW (planar) layout — EfficientNet-Lite's TF-native export. */
  channelsLast?: boolean;
  /** Encode prompt parameters into named tensors (with dims) ready to feed. */
  encodePrompts?: (params: Record<string, unknown>) => Record<string, WorkerTensor>;
  /** Second image input spec, if this model takes one. */
  auxImage?: AuxImageSpec;
  /** Constant feeds this model always requires, independent of the image. */
  constantFeeds?: () => Record<string, ConstantFeed>;
  /** Canonical math-based semantic preprocessing (versioned, parity-tested)
   * replaces the canvas letterbox for this model. See
   * semanticSimilarity/preprocess.ts. */
  semanticPreprocess?: SemanticResizeSpec;
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
  tensorSpec: SCUNET_TENSOR_SPEC,
  getInputSize: () => SCUNET_INPUT_SIZE,
  hasImageInput: true,
});

// NAFNet checkpoints (deblur/denoise/JPEG-aware) share one architecture and
// one worker contract: dynamic [1,3,H,W] float32, already padded to a
// multiple of 16 by the client. Post-processing is model-specific and
// handled by the restoration provider.
registerModelType('nafnet', {
  tensorSpec: NAFNET_TENSOR_SPEC,
  getInputSize: () => NAFNET_INPUT_SIZE,
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

registerModelType('lama', {
  tensorSpec: LAMA_TENSOR_SPEC,
  getInputSize: () => LAMA_INPUT_SIZE,
  hasImageInput: true,
  auxImage: {
    inputNameCandidates: ['mask'],
    tensorSpec: LAMA_TENSOR_SPEC,
    inputSize: LAMA_INPUT_SIZE,
    singleChannel: true,
  },
});

registerModelType('rife', {
  tensorSpec: RIFE_TENSOR_SPEC,
  getInputSize: () => RIFE_INPUT_SIZE,
  hasImageInput: true,
  auxImage: {
    inputNameCandidates: [],
    tensorSpec: RIFE_TENSOR_SPEC,
    inputSize: RIFE_INPUT_SIZE,
    concatChannels: true,
  },
});

registerModelType('detr', {
  tensorSpec: DETR_TENSOR_SPEC,
  getInputSize: () => DETR_INPUT_SIZE,
  hasImageInput: true,
  constantFeeds: () => ({
    pixel_mask: {
      dtype: 'int64',
      data: new BigInt64Array(64 * 64).fill(1n),
      dims: [1, 64, 64],
    },
  }),
});

registerModelType('face-detect', {
  tensorSpec: YU_NET_TENSOR_SPEC,
  getInputSize: () => YU_NET_INPUT_SIZE,
  hasImageInput: true,
});

registerModelType('efficientnet', {
  tensorSpec: EFFICIENTNET_TENSOR_SPEC,
  getInputSize: () => EFFICIENTNET_INPUT_SIZE,
  hasImageInput: true,
  channelsLast: true,
});

registerModelType('paddleocr-det', {
  tensorSpec: PADDLE_DET_TENSOR_SPEC,
  getInputSize: () => 0,
  hasImageInput: true,
});

registerModelType('paddleocr-rec', {
  tensorSpec: PADDLE_REC_TENSOR_SPEC,
  // Fixed height (48), dynamic width — fed as a pre-packed float tensor
  // via the `tensors` seam (input name `x`) because the expected
  // normalization (mean/std=0.5) differs from the worker's default
  // /255 identity pack. The client preprocesses to NCHW+H=48 itself.
  getInputSize: () => 0,
  hasImageInput: false,
});

registerModelType('trocr', {
  tensorSpec: TROCR_TENSOR_SPEC,
  getInputSize: () => TROCR_INPUT_SIZE,
  hasImageInput: false,
});

registerModelType('siglip-image', {
  tensorSpec: SIGLIP_IMAGE_TENSOR_SPEC,
  getInputSize: () => SIGLIP_IMAGE_SIZE,
  hasImageInput: true,
  // The pinned SigLIP export keeps the text branch in the graph; ORT
  // rejects a run that omits input_ids even though text outputs are
  // never requested. Feed a constant zero token (verified 2026-08-13).
  constantFeeds: () => siglipConstantFeeds(),
});

registerModelType('dinov2-image', {
  tensorSpec: {
    inputWidth: 224,
    inputHeight: 224,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    paddingRgb: [128, 128, 128],
  },
  getInputSize: () => 0,
  hasImageInput: true,
  // DINOv2 evaluation preprocessing: shortest side to 256 then a 224x224
  // center crop, ImageNet normalization. The canonical math pipeline
  // (semanticSimilarity/preprocess.ts) mirrors the Python reference that
  // produced the parity fixtures.
  semanticPreprocess: DINOV2_PREPROCESS_SPEC,
});

registerModelType('siglip-text', {
  tensorSpec: {
    inputWidth: 0,
    inputHeight: 0,
    mean: [0, 0, 0],
    std: [1, 1, 1],
    paddingRgb: [0, 0, 0],
  },
  getInputSize: () => 0,
  hasImageInput: false,
});

registerModelType('font-classify', {
  tensorSpec: FONT_CLASSIFY_TENSOR_SPEC,
  getInputSize: () => FONT_CLASSIFY_INPUT_SIZE,
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

/**
 * Import ONNX Runtime with its WASM assets pointed at the app's bundled copy.
 *
 * Without `wasmPaths`, the runtime resolves its `.wasm` relative to the worker
 * script. In dev that path does not exist and the SPA fallback answers with a
 * 200 HTML document, so instantiation never completes and every inference on
 * this worker hangs until the caller's timeout rather than failing loudly.
 * The background-removal worker has always configured this; the generic
 * inference worker did not, which left every model routed through it
 * (denoise, depth, line art, segmentation, ...) unable to run.
 */
let ortModulePromise: Promise<OrtModule> | null = null;
async function loadOrt(): Promise<OrtModule> {
  if (!ortModulePromise) {
    ortModulePromise = (async () => {
      const ort = await import('onnxruntime-web');
      const { configureOrtRuntime } = await import('../backgroundRemoval/ortRuntimeAssets');
      configureOrtRuntime(ort);
      return ort as unknown as OrtModule;
    })();
  }
  return ortModulePromise;
}

async function getSession(
  modelPath: string,
  modelId: string,
  modelType: WorkerModelType,
  externalData?: ExternalDataSpec,
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

  const ort = await loadOrt();
  const providers = await getPreferredProviders();
  // Weights kept outside the graph must be handed to the runtime under the
  // exact filename the graph references, or session creation fails resolving
  // the missing tensor data.
  const externalDataOption = externalData
    ? { externalData: [{ path: externalData.path, data: externalData.url }] }
    : {};

  let lastError: Error | null = null;
  for (const provider of providers) {
    if (provider === 'wasm') continue;
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [provider],
        ...externalDataOption,
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
    ...externalDataOption,
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
    create: (
      path: string,
      opts?: {
        executionProviders?: string[];
        externalData?: Array<{ path: string; data: string }>;
      },
    ) => Promise<OrtSession>;
  };
  Tensor: new (type: string, data: ArrayLike<number> | BigInt64Array, dims: number[]) => unknown;
}

interface OrtSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  release: () => Promise<void>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

/** Letterbox-pack (or direct-pack, for dynamic-size models) a single image
 * into a Float32Array tensor, returning the transform used so callers can
 * map prompt/output coordinates through the same space (see SAM2/DETR/LaMa
 * letterbox coordinate bug notes in their respective model modules). */
function preprocessImage(
  imageData: ImageData,
  inputSize: number,
  spec: TensorSpec,
  options: { singleChannel?: boolean; channelsLast?: boolean } = {},
): { tensor: Float32Array; width: number; height: number; offsetX: number; offsetY: number } {
  if (inputSize <= 0) {
    // Dynamic-size (SCUNet, PaddleOCR detection): no letterbox, direct pack.
    const width = imageData.width;
    const height = imageData.height;
    if (options.singleChannel) {
      const tensor = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        tensor[i] = (imageData.data[i * 4] ?? 0) / 255;
      }
      return { tensor, width, height, offsetX: 0, offsetY: 0 };
    }
    const tensor = options.channelsLast
      ? packNhwcTensor(imageData, { ...spec, mean: [0, 0, 0], std: [255, 255, 255] })
      : packNchwTensor(imageData, { ...spec, mean: [0, 0, 0], std: [255, 255, 255] });
    return { tensor, width, height, offsetX: 0, offsetY: 0 };
  }

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

  if (options.singleChannel) {
    const tensor = new Float32Array(inputSize * inputSize);
    for (let i = 0; i < inputSize * inputSize; i++) {
      tensor[i] = (resizedData.data[i * 4] ?? 0) / 255;
    }
    return { tensor, width: inputSize, height: inputSize, offsetX, offsetY };
  }

  const tensor = options.channelsLast
    ? packNhwcTensor(resizedData, spec)
    : packNchwTensor(resizedData, spec);
  return { tensor, width: inputSize, height: inputSize, offsetX, offsetY };
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
    auxImageData,
    tensors,
    params,
    reuseSession,
    targetWidth,
    targetHeight,
    externalData,
  } = data;

  try {
    const modelPre = modelRegistry.get(modelType);
    if (!modelPre) {
      throw new Error(`Unknown model type: ${modelType}`);
    }

    const ort = await loadOrt();
    const cacheKey = `${modelType}:${modelPath}`;
    const cached = sessionCache.get(cacheKey);
    const hadSession = !!cached && cached.session;

    const { session, executionProvider } =
      reuseSession && hadSession
        ? { session: cached!.session, executionProvider: cached!.executionProvider }
        : await getSession(modelPath, modelId, modelType, externalData);

    if (!hadSession) {
      self.postMessage({ type: 'ready' } satisfies WorkerReady);
    }

    const inputNames = (session as OrtSession).inputNames;
    const feeds: Record<string, unknown> = {};
    const inputNameSet = new Set(inputNames);
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (modelPre.hasImageInput && imageData) {
      let finalTensor: Float32Array;
      let dims: number[];
      if (modelPre.semanticPreprocess) {
        // Canonical, parity-tested math pipeline (matte → resize/crop →
        // NCHW pack + normalize). No canvas, no letterbox.
        const semantic = preprocessSemanticInput(imageData, modelPre.semanticPreprocess);
        finalTensor = semantic.tensor;
        dims = [1, 3, semantic.height, semantic.width];
      } else {
        const inputSize = modelPre.getInputSize();
        const primary = preprocessImage(imageData, inputSize, modelPre.tensorSpec, {
          channelsLast: modelPre.channelsLast,
        });
        letterboxOffsetX = primary.offsetX;
        letterboxOffsetY = primary.offsetY;

        finalTensor = primary.tensor;
        dims = modelPre.channelsLast
          ? [1, primary.height, primary.width, 3]
          : [1, 3, primary.height, primary.width];

        if (modelPre.auxImage?.concatChannels && auxImageData) {
          const aux = preprocessImage(
            auxImageData,
            modelPre.auxImage.inputSize,
            modelPre.auxImage.tensorSpec,
            {},
          );
          const combined = new Float32Array(finalTensor.length + aux.tensor.length);
          combined.set(finalTensor, 0);
          combined.set(aux.tensor, finalTensor.length);
          finalTensor = combined;
          dims = [1, 6, primary.height, primary.width];
        }
      }

      const imageInputName =
        inputNames.find((n) =>
          ['image', 'pixel_values', 'input_image', 'x', 'input'].includes(n.toLowerCase()),
        ) ?? inputNames[0]!;
      feeds[imageInputName] = new ort.Tensor('float32', finalTensor, dims);

      if (
        modelPre.auxImage &&
        !modelPre.auxImage.concatChannels &&
        modelPre.auxImage.inputNameCandidates.length > 0 &&
        auxImageData
      ) {
        const aux = preprocessImage(
          auxImageData,
          modelPre.auxImage.inputSize,
          modelPre.auxImage.tensorSpec,
          {
            singleChannel: modelPre.auxImage.singleChannel,
          },
        );
        const auxInputName = inputNames.find((n) =>
          modelPre.auxImage!.inputNameCandidates.includes(n.toLowerCase()),
        );
        if (auxInputName) {
          const auxDims = modelPre.auxImage.singleChannel
            ? [1, 1, aux.height, aux.width]
            : [1, 3, aux.height, aux.width];
          feeds[auxInputName] = new ort.Tensor('float32', aux.tensor, auxDims);
        }
      }
    }

    if (modelPre.constantFeeds) {
      for (const [key, feed] of Object.entries(modelPre.constantFeeds())) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          feeds[match] = new ort.Tensor(feed.dtype, feed.data, feed.dims);
        }
      }
    }

    if (tensors) {
      for (const [key, tensor] of Object.entries(tensors)) {
        const match = inputNameSet.has(key)
          ? key
          : inputNames.find((n) => n.toLowerCase() === key.toLowerCase());
        if (match) {
          feeds[match] = new ort.Tensor(tensor.dtype ?? 'float32', tensor.data, tensor.dims);
        }
      }
    }

    if (modelPre.encodePrompts && params) {
      const encoded = modelPre.encodePrompts(params);
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
      if (modelPre.getInputSize() > 0) {
        outputs.letterbox = {
          offsetX: letterboxOffsetX,
          offsetY: letterboxOffsetY,
        } satisfies WorkerLetterbox;
      }
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
