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
import { harmonize } from './harmonize';
import { paletteColorize } from './pipeline';
import { selectiveRecolor } from './recolor';
import { resolveRuntime } from './runtimeResolver';
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
  if (request.source.revision < 0) return 'source.revision must be non-negative';
  if (request.source.width <= 0 || request.source.height <= 0) {
    return 'source dimensions must be positive';
  }

  switch (request.kind) {
    case 'selective-recolor':
      if (!request.mask) return 'selective-recolor requires a mask';
      if (!request.mask.data?.length) return 'mask.data is required';
      break;
    case 'palette-colorize':
      if (!request.palette || request.palette.colors.length < 2) {
        return 'palette-colorize requires at least 2 palette colors';
      }
      break;
    case 'reference-transfer':
      if (!request.reference) return 'reference-transfer requires a reference image';
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

// ---------------------------------------------------------------------------
// Classical (non-AI) dispatch path
// ---------------------------------------------------------------------------

async function dispatchClassical(
  request: ColorizationRequestContract,
  sourceData: ImageData,
  referenceData?: ImageData,
): Promise<ColorizationResultContract> {
  const startTime = performance.now();

  let resultData: ImageData;

  switch (request.kind) {
    case 'selective-recolor': {
      const mask = request.mask!;
      const params = request.params ?? {};
      resultData = selectiveRecolor(
        sourceData,
        mask.data,
        mask.width,
        mask.height,
        params.targetHue ?? 0,
        params.saturationScale ?? 1,
        params.luminancePreservation ?? 1,
      );
      break;
    }

    case 'reference-transfer': {
      if (!referenceData) throw new Error('Reference image data required');
      const params = request.params ?? {};
      resultData = colorTransferLab(
        sourceData,
        referenceData,
        params.luminancePreservation ?? 1,
        params.chromaStrength ?? 1,
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
      );
      break;
    }

    case 'palette-colorize': {
      const palette = request.palette!;
      const adherence = palette.adherence ?? 0.5;
      resultData = paletteColorize(sourceData, palette.colors, adherence);
      break;
    }

    default:
      throw new Error(`Classical dispatch not supported for kind: ${request.kind}`);
  }

  return {
    requestId: request.requestId,
    sourceRevision: request.source.revision,
    dispatchedAt: performance.now(),
    imageData: resultData,
    workflow: request.kind as ColorizationResultContract['workflow'],
    modelUsed: null,
    provider: 'classical',
    elapsedMs: performance.now() - startTime,
  };
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

  switch (request.kind) {
    case 'photo-colorize': {
      const params = request.params ?? {};
      const stats = analyzeImageData(sourceData);
      const resolution = resolveRuntime('photo-colorize', request.qualityMode, stats, []);
      const maxDim = resolution.maxDimension;
      const clamped = clampImageToMaxDimension(sourceData, maxDim);

      const modelPath =
        resolution.modelId === 'ddcolor-tiny'
          ? '/models/ddcolor-tiny.onnx'
          : '/models/ddcolor.onnx';

      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'ddcolor',
          modelPath,
          modelId: resolution.modelId,
          imageData: clamped,
          targetWidth: clamped.width,
          targetHeight: clamped.height,
          reuseSession: true,
        },
        { signal: request.signal, timeoutMs: DEFAULT_TIMEOUT },
      );

      const output = result.outputs.output as { data: Float32Array; dims: number[] } | undefined;
      if (!output) throw new Error('DDColor inference produced no output');

      const origW = (result.outputs.originalWidth as number) ?? clamped.width;
      const origH = (result.outputs.originalHeight as number) ?? clamped.height;
      const letterbox = result.outputs.letterbox as
        | { offsetX: number; offsetY: number }
        | undefined;

      const { a, b } = decodeDdColorOutput(
        output.data,
        output.dims[3]!,
        output.dims[2]!,
        origW,
        origH,
        letterbox,
      );

      let outputImageData = combineLabToImageData(
        clamped.data,
        clamped.width,
        clamped.height,
        a,
        b,
        params.luminancePreservation ?? 1,
      );

      // Upscale if clamped was smaller
      if (clamped.width !== sourceData.width || clamped.height !== sourceData.height) {
        const srcCanvas = new OffscreenCanvas(clamped.width, clamped.height);
        const srcCtx = srcCanvas.getContext('2d')!;
        srcCtx.putImageData(outputImageData, 0, 0);
        const dstCanvas = new OffscreenCanvas(sourceData.width, sourceData.height);
        const dstCtx = dstCanvas.getContext('2d')!;
        dstCtx.drawImage(srcCanvas, 0, 0, sourceData.width, sourceData.height);
        outputImageData = dstCtx.getImageData(0, 0, sourceData.width, sourceData.height);
      }

      return {
        requestId: request.requestId,
        sourceRevision: request.source.revision,
        dispatchedAt: performance.now(),
        imageData: outputImageData,
        workflow: 'photo-colorize',
        modelUsed: resolution.modelId,
        provider: resolution.provider,
        elapsedMs: performance.now() - startTime,
      };
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
