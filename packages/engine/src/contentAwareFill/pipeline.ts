import { decodeLamaOutput, getInferenceWorkerHost } from '../inference';
import { compositeFillResult, extractBoundedContext } from './contextExtraction';
import { nativeLaMaProvider } from './nativeProvider';
import { patchMatchFill } from './patchMatch';
import type { BoundedContext, ContentAwareFillOptions, ContentAwareFillResult } from './types';

function pickSoleOutputTensor(outputs: Record<string, unknown>): {
  data: Float32Array;
  dims: number[];
} | null {
  const keys = Object.keys(outputs);
  for (const key of keys) {
    const v = outputs[key];
    if (v && typeof v === 'object' && 'data' in v && 'dims' in v) {
      return v as { data: Float32Array; dims: number[] };
    }
  }
  return null;
}

export interface LaMaInferResult {
  imageData: ImageData;
  width: number;
  height: number;
  executionProvider: string;
  warnings: string[];
}

export async function runLaMaInference(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  modelPath: string,
  modelId: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<LaMaInferResult> {
  if (nativeLaMaProvider.isAvailable()) {
    onProgress?.(0.2);
    const nativeResult = await nativeLaMaProvider.infer(imageData, mask, signal);
    onProgress?.(1);
    return nativeResult;
  }

  const maskImageData = new ImageData(maskWidth, maskHeight);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    maskImageData.data[i * 4] = v;
    maskImageData.data[i * 4 + 1] = v;
    maskImageData.data[i * 4 + 2] = v;
    maskImageData.data[i * 4 + 3] = 255;
  }

  onProgress?.(0.2);

  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: 'lama',
      modelPath,
      modelId,
      imageData,
      auxImageData: maskImageData,
      reuseSession: true,
    },
    { signal, timeoutMs: 120_000 },
  );

  if (signal?.aborted) throw new Error('cancelled');

  onProgress?.(0.7);

  const rawOutputs = result.outputs as Record<string, unknown>;
  const output = pickSoleOutputTensor(rawOutputs);
  if (!output) throw new Error('Fill inference did not produce an output tensor');

  const outputDimH = (output.dims[2] as number) ?? (output.dims[1] as number) ?? 512;
  const outputDimW = (output.dims[3] as number) ?? (output.dims[0] as number) ?? 512;
  const outputH = Math.max(outputDimH, outputDimW > outputDimH ? outputDimW : outputDimH);
  const outputW = Math.min(outputDimH, outputDimW > outputDimH ? outputDimW : outputDimH);

  const letterbox = rawOutputs.letterbox as { offsetX: number; offsetY: number } | undefined;

  const decoded = decodeLamaOutput(
    output.data,
    imageData.width > imageData.height ? outputW : outputH,
    imageData.width > imageData.height ? outputH : outputW,
    imageData.width,
    imageData.height,
    letterbox,
  );

  onProgress?.(1);
  return {
    imageData: decoded,
    width: imageData.width,
    height: imageData.height,
    executionProvider: (rawOutputs.executionProvider as string) ?? 'wasm',
    warnings: [],
  };
}

export async function runContentAwareFillPipeline(
  options: ContentAwareFillOptions,
): Promise<ContentAwareFillResult> {
  const startTime = performance.now();
  const warnings: string[] = [];
  const {
    imageData,
    mask,
    maskWidth,
    maskHeight,
    maskOffsetX,
    maskOffsetY,
    quality,
    signal,
    onProgress,
    modelPath,
    modelId,
  } = options;

  if (signal?.aborted) throw new Error('cancelled');
  onProgress?.(0);

  let boundedCtx: BoundedContext;
  let fillResult: { imageData: ImageData; width: number; height: number };
  let filledBounds: { x: number; y: number; w: number; h: number };
  let executionProvider = 'heuristic';

  if (quality === 'fast') {
    boundedCtx = extractBoundedContext(
      imageData,
      mask,
      maskWidth,
      maskHeight,
      maskOffsetX,
      maskOffsetY,
      32,
    );

    if (signal?.aborted) throw new Error('cancelled');
    onProgress?.(0.1);

    const pmResult = patchMatchFill(
      boundedCtx.imageData,
      boundedCtx.mask,
      boundedCtx.width,
      boundedCtx.height,
      0,
      0,
      signal,
    );

    fillResult = {
      imageData: pmResult.imageData,
      width: pmResult.imageData.width,
      height: pmResult.imageData.height,
    };
    filledBounds = {
      x: boundedCtx.offsetX + pmResult.filledBounds.x,
      y: boundedCtx.offsetY + pmResult.filledBounds.y,
      w: pmResult.filledBounds.w,
      h: pmResult.filledBounds.h,
    };
  } else {
    if (!modelPath) {
      throw new Error('AI model not downloaded. Download the model first or use Fast mode.');
    }

    boundedCtx = extractBoundedContext(
      imageData,
      mask,
      maskWidth,
      maskHeight,
      maskOffsetX,
      maskOffsetY,
    );

    if (signal?.aborted) throw new Error('cancelled');

    if (boundedCtx.width > 2048 || boundedCtx.height > 2048) {
      warnings.push('Large region detected. Processing at reduced resolution for performance.');
    }

    const laMaResult = await runLaMaInference(
      boundedCtx.imageData,
      boundedCtx.mask,
      boundedCtx.width,
      boundedCtx.height,
      modelPath,
      modelId ?? 'lama-inpainting',
      signal,
      (p) => onProgress?.(0.1 + p * 0.8),
    );

    fillResult = laMaResult;
    executionProvider = laMaResult.executionProvider;
    warnings.push(...laMaResult.warnings);
    filledBounds = {
      x: boundedCtx.offsetX,
      y: boundedCtx.offsetY,
      w: boundedCtx.width,
      h: boundedCtx.height,
    };
  }

  if (signal?.aborted) throw new Error('cancelled');
  onProgress?.(0.9);

  const composited = compositeFillResult(
    imageData,
    fillResult.imageData,
    boundedCtx.offsetX,
    boundedCtx.offsetY,
  );

  onProgress?.(1);

  return {
    imageData: composited,
    width: composited.width,
    height: composited.height,
    filledBounds,
    quality,
    executionProvider,
    modelId: quality === 'fast' ? undefined : modelId,
    processingTimeMs: performance.now() - startTime,
    warnings,
  };
}
