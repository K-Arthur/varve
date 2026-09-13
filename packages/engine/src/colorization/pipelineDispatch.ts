/**
 * Colorization pipeline dispatcher — the single entry point for all
 * colorization operations. Routes requests to the appropriate backend
 * (classical pixel ops, ONNX worker, or native Tauri) based on the
 * request kind and available providers.
 *
 * This replaces the ad-hoc dispatching in `pipeline.ts` with a
 * unified contract-aware dispatcher that carries source/mask/palette/
 * reference identity for stale-result detection.
 *
 * Flow:
 *   1. Validate request contract
 *   2. Resolve provider (worker vs native vs classical)
 *   3. Execute with stale-detection guard
 *   4. Return result with metadata for caller staleness check
 */

import { clampImageToMaxDimension } from '../inference/imageTensor';
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { decodeDdColorOutput } from '../inference/models/ddcolor';
import type {
  ColorizationRequestContract,
  ColorizationResultContract,
} from './colorizationRequest';
import { combineLabToImageData } from './colorSpace';
import { resolveDdColorRuntime } from './ddcolorRuntime';
import { harmonize } from './harmonize';
import { paletteColorize, validatePalette } from './palette';
import { selectiveRecolor } from './recolor';
import { featherMask } from './sam2Recolor';
import { analyzeImageData } from './taskClassifier';
import { colorTransferLab } from './transfer';

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export function validateColorizationRequest(request: ColorizationRequestContract): string | null {
  if (!request.requestId) return 'requestId is required';
  if (!request.kind) return 'kind is required';
  if (!request.source) return 'source is required';
  if (!request.source.nodeId) return 'source.nodeId is required';
  if (!Number.isSafeInteger(request.source.revision) || request.source.revision < 0) {
    return 'source.revision must be a non-negative integer';
  }
  if (
    !Number.isSafeInteger(request.source.width) ||
    !Number.isSafeInteger(request.source.height) ||
    request.source.width <= 0 ||
    request.source.height <= 0
  ) {
    return 'source dimensions must be positive';
  }

  const params = request.params;
  const numericParams = [
    ['targetHue', params?.targetHue],
    ['saturationScale', params?.saturationScale],
    ['luminancePreservation', params?.luminancePreservation],
    ['chromaStrength', params?.chromaStrength],
    ['blendStrength', params?.blendStrength],
    ['adherence', request.palette?.adherence],
  ] as const;
  for (const [name, value] of numericParams) {
    if (value !== undefined && !Number.isFinite(value)) return `${name} must be finite`;
  }
  if (request.mask?.density !== undefined && !Number.isFinite(request.mask.density)) {
    return 'mask density must be finite';
  }
  if (
    request.mask?.density !== undefined &&
    (request.mask.density < 0 || request.mask.density > 1)
  ) {
    return 'mask density must be between 0 and 1';
  }
  if (request.mask?.feather !== undefined && !Number.isFinite(request.mask.feather)) {
    return 'mask feather must be finite';
  }
  if (request.mask?.feather !== undefined && request.mask.feather < 0) {
    return 'mask feather must be non-negative';
  }

  switch (request.kind) {
    case 'selective-recolor':
      if (!request.mask) return 'selective-recolor requires a mask';
      if (!request.mask.data?.length) return 'mask.data is required';
      if (
        !Number.isSafeInteger(request.mask.width) ||
        !Number.isSafeInteger(request.mask.height) ||
        request.mask.width <= 0 ||
        request.mask.height <= 0 ||
        request.mask.data.length < request.mask.width * request.mask.height
      ) {
        return 'mask dimensions exceed mask data length';
      }
      break;
    case 'palette-colorize':
      if (!request.palette || request.palette.colors.length === 0) {
        return 'palette-colorize requires at least one palette color';
      }
      {
        const paletteError = validatePalette(request.palette.colors);
        if (paletteError) return paletteError;
      }
      break;
    case 'reference-transfer':
      if (!request.reference) return 'reference-transfer requires a reference image';
      if (!request.reference.src) return 'reference-transfer requires a reference source';
      if (
        !Number.isSafeInteger(request.reference.width) ||
        !Number.isSafeInteger(request.reference.height) ||
        request.reference.width <= 0 ||
        request.reference.height <= 0
      ) {
        return 'reference dimensions must be positive integers';
      }
      break;
    case 'harmonize':
      if (!request.reference) return 'harmonize requires a reference image';
      if (!request.reference.src) return 'harmonize requires a reference source';
      if (
        !Number.isSafeInteger(request.reference.width) ||
        !Number.isSafeInteger(request.reference.height) ||
        request.reference.width <= 0 ||
        request.reference.height <= 0
      ) {
        return 'reference dimensions must be positive integers';
      }
      break;
    case 'sam2-encode':
      // Source image data must be provided via the editor context
      break;
    case 'sam2-decode':
      if (!request.params?.sam2Prompts) return 'sam2-decode requires sam2Prompts';
      break;
  }

  return null;
}

function materializeMask(mask: NonNullable<ColorizationRequestContract['mask']>): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  let data = new Uint8Array(mask.data);
  if (mask.inverted) {
    data = data.map((value) => 255 - value);
  }
  if (mask.density !== undefined && mask.density < 1) {
    data = data.map((value) => Math.round(value * mask.density!));
  }
  if (mask.feather && mask.feather > 0) {
    data = Uint8Array.from(featherMask(data, mask.width, mask.height, mask.feather));
  }
  return { data, width: mask.width, height: mask.height };
}

// ---------------------------------------------------------------------------
// Classical (non-AI) dispatch path
// ---------------------------------------------------------------------------

async function dispatchClassical(
  request: ColorizationRequestContract,
  sourceData: ImageData,
  referenceData?: ImageData,
): Promise<ColorizationResultContract> {
  const startTime = performance.now();
  request.onProgress?.({ phase: 'preprocessing', percent: 10, elapsedMs: 0 });

  let resultData: ImageData;

  switch (request.kind) {
    case 'selective-recolor': {
      const mask = request.mask!;
      const params = request.params ?? {};
      const appliedMask = materializeMask(mask);
      resultData = selectiveRecolor(
        sourceData,
        appliedMask.data,
        appliedMask.width,
        appliedMask.height,
        params.targetHue ?? 0,
        params.saturationScale ?? 1,
        params.luminancePreservation ?? 1,
        params.blendStrength ?? 1,
        params.hueMode ?? 'set',
        params.chromaStrength ?? 1,
        params.neutralProtection ?? false,
        params.skinProtection ?? false,
      );
      break;
    }

    case 'reference-transfer': {
      if (!referenceData) throw new Error('Reference image data required');
      const params = request.params ?? {};
      const appliedMask = request.mask ? materializeMask(request.mask) : undefined;
      resultData = colorTransferLab(
        sourceData,
        referenceData,
        params.luminancePreservation ?? 1,
        params.chromaStrength ?? 1,
        {
          blendStrength: params.blendStrength ?? 1,
          mask: appliedMask
            ? {
                data: appliedMask.data,
                width: appliedMask.width,
                height: appliedMask.height,
              }
            : undefined,
        },
      );
      break;
    }

    case 'harmonize': {
      if (!referenceData) throw new Error('Reference image data required');
      const params = request.params ?? {};
      resultData = harmonize(
        sourceData,
        referenceData,
        params.chromaStrength ?? 0.5,
        params.neutralProtection ?? true,
        params.blendStrength ?? 1,
        params.skinProtection ?? false,
      );
      break;
    }

    case 'palette-colorize': {
      const palette = request.palette!;
      const adherence = palette.adherence ?? 0.5;
      resultData = paletteColorize(
        sourceData,
        palette.colors,
        adherence,
        request.params?.paletteMode ?? 'shaded',
      );
      break;
    }

    default:
      throw new Error(`Classical dispatch not supported for kind: ${request.kind}`);
  }

  request.onProgress?.({
    phase: 'inference',
    percent: 70,
    elapsedMs: performance.now() - startTime,
  });

  const result = {
    requestId: request.requestId,
    documentId: request.documentId,
    parameterVersion: request.parameterVersion,
    sourceRevision: request.source.revision,
    sourceNodeId: request.source.nodeId,
    paletteRevision: request.palette?.revision,
    maskRevision: request.mask?.revision,
    referenceRevision: request.reference?.revision,
    dispatchedAt: performance.now(),
    imageData: resultData,
    workflow: request.kind as ColorizationResultContract['workflow'],
    modelUsed: null,
    provider: 'classical',
    elapsedMs: performance.now() - startTime,
  };
  request.onProgress?.({
    phase: 'complete',
    percent: 100,
    elapsedMs: performance.now() - startTime,
  });
  return result;
}

// ---------------------------------------------------------------------------
// ONNX worker dispatch path (DDColor, SAM2, SCUNet)
// ---------------------------------------------------------------------------

async function dispatchOnnxWorker(
  request: ColorizationRequestContract,
  sourceData: ImageData,
): Promise<ColorizationResultContract> {
  const startTime = performance.now();
  const host = getInferenceWorkerHost();
  const DEFAULT_TIMEOUT = 180_000;
  request.onProgress?.({ phase: 'preprocessing', percent: 0, elapsedMs: 0 });

  switch (request.kind) {
    case 'photo-colorize': {
      const params = request.params ?? {};
      const stats = analyzeImageData(sourceData);
      const resolution = await resolveDdColorRuntime(request.qualityMode, stats, request.signal);
      const requestedPreviewMax = request.provider.previewMaxDimension;
      const maxDim =
        request.provider.intent === 'preview' && requestedPreviewMax
          ? Math.min(resolution.maxDimension, requestedPreviewMax)
          : resolution.maxDimension;
      const clamped = clampImageToMaxDimension(sourceData, maxDim);
      request.onProgress?.({
        phase: 'preprocessing',
        percent: 20,
        elapsedMs: performance.now() - startTime,
      });

      if (request.signal?.aborted) throw new Error('Request cancelled');
      request.onProgress?.({
        phase: 'inference',
        percent: 40,
        elapsedMs: performance.now() - startTime,
      });
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'ddcolor',
          modelPath: resolution.modelPath,
          modelId: resolution.modelId,
          imageData: clamped,
          targetWidth: clamped.width,
          targetHeight: clamped.height,
          reuseSession: true,
        },
        { signal: request.signal, timeoutMs: DEFAULT_TIMEOUT },
      );

      const output = result.outputs.output as { data?: unknown; dims?: unknown } | undefined;
      if (
        !output ||
        !(output.data instanceof Float32Array) ||
        !Array.isArray(output.dims) ||
        output.dims.length !== 4
      ) {
        throw new Error('DDColor inference produced an incompatible output tensor');
      }
      const outputDims = output.dims as unknown[];
      if (outputDims[0] !== 1 || outputDims[1] !== 2) {
        throw new Error('DDColor output must have shape [1, 2, H, W]');
      }
      const outputHeight = typeof outputDims[2] === 'number' ? outputDims[2] : 0;
      const outputWidth = typeof outputDims[3] === 'number' ? outputDims[3] : 0;
      if (
        !Number.isSafeInteger(outputWidth) ||
        !Number.isSafeInteger(outputHeight) ||
        outputWidth <= 0 ||
        outputHeight <= 0
      ) {
        throw new Error('DDColor output dimensions are invalid');
      }

      const letterbox = result.outputs.letterbox as
        | {
            offsetX: number;
            offsetY: number;
            contentWidth?: number;
            contentHeight?: number;
          }
        | undefined;

      const { a, b } = decodeDdColorOutput(
        output.data,
        outputWidth,
        outputHeight,
        sourceData.width,
        sourceData.height,
        letterbox,
      );

      // DDColor predicts chroma at working resolution. Upsample only the
      // chroma planes, then combine them with the original source L/detail
      // and alpha at natural resolution. Enlarging the low-resolution RGB
      // result would visibly soften texture and edge detail.
      const outputImageData = combineLabToImageData(
        sourceData.data,
        sourceData.width,
        sourceData.height,
        a,
        b,
        params.luminancePreservation ?? 1,
      );

      request.onProgress?.({
        phase: 'postprocessing',
        percent: 80,
        elapsedMs: performance.now() - startTime,
      });

      const outputResult = {
        requestId: request.requestId,
        documentId: request.documentId,
        parameterVersion: request.parameterVersion,
        sourceRevision: request.source.revision,
        sourceNodeId: request.source.nodeId,
        paletteRevision: request.palette?.revision,
        maskRevision: request.mask?.revision,
        referenceRevision: request.reference?.revision,
        dispatchedAt: performance.now(),
        imageData: outputImageData,
        workflow: 'photo-colorize' as const,
        modelUsed: resolution.modelId,
        provider:
          typeof result.outputs.executionProvider === 'string'
            ? result.outputs.executionProvider
            : resolution.provider,
        elapsedMs: performance.now() - startTime,
      };
      request.onProgress?.({
        phase: 'complete',
        percent: 100,
        elapsedMs: performance.now() - startTime,
      });

      return outputResult;
    }

    default:
      throw new Error(
        `ONNX worker dispatch not supported for kind: ${request.kind}. Use pipeline dispatch.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a colorization request to the appropriate backend.
 *
 * For requests that carry image data (selective-recolor, reference-transfer,
 * harmonize, palette-colorize), the caller must pass `sourceData`.
 * For ONNX-based requests (photo-colorize), the pipeline loads from cache.
 */
export async function dispatchColorization(
  request: ColorizationRequestContract,
  sourceData: ImageData,
  referenceData?: ImageData,
): Promise<ColorizationResultContract> {
  const validation = validateColorizationRequest(request);
  if (validation) throw new Error(`Invalid request: ${validation}`);

  if (sourceData.width !== request.source.width || sourceData.height !== request.source.height) {
    throw new Error('Source image dimensions do not match the request identity');
  }
  if (sourceData.data.length < sourceData.width * sourceData.height * 4) {
    throw new Error('Source image data is shorter than its dimensions');
  }
  if (
    referenceData &&
    request.reference &&
    (referenceData.width !== request.reference.width ||
      referenceData.height !== request.reference.height)
  ) {
    throw new Error('Reference image dimensions do not match the request identity');
  }
  if (referenceData && referenceData.data.length < referenceData.width * referenceData.height * 4) {
    throw new Error('Reference image data is shorter than its dimensions');
  }
  if (
    request.reference &&
    !referenceData &&
    ['reference-transfer', 'harmonize'].includes(request.kind)
  ) {
    throw new Error('Reference image data required');
  }

  if (request.signal?.aborted) throw new Error('Request cancelled');

  // Classical workflows don't need a model
  const classicalKinds = new Set([
    'selective-recolor',
    'reference-transfer',
    'harmonize',
    'palette-colorize',
  ]);

  if (classicalKinds.has(request.kind)) {
    return dispatchClassical(request, sourceData, referenceData);
  }

  // ONNX-based workflows go through the worker
  return dispatchOnnxWorker(request, sourceData);
}
