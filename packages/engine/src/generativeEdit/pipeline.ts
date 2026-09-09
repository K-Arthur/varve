import { type ContentAwareFillQuality, runContentAwareFillPipeline } from '../contentAwareFill';
import {
  type GenerativeEditCapabilities,
  GenerativeEditError,
  type GenerativeEditProvider,
  type GenerativeEditRequest,
  type GenerativeEditResult,
} from './types';

const LOCAL_CAPABILITIES: GenerativeEditCapabilities = {
  fill: true,
  remove: true,
  replace: false,
  expand: false,
  prompt: false,
  variations: false,
  reason: 'Replace and Expand require a verified prompt-capable provider.',
};

export function getGenerativeEditCapabilities(provider: 'local' | 'remote' = 'local') {
  if (provider === 'remote') {
    return {
      ...LOCAL_CAPABILITIES,
      reason: 'No remote provider is configured for this local-first build.',
    };
  }
  return LOCAL_CAPABILITIES;
}

function assertUsableRequest(request: GenerativeEditRequest): void {
  if (
    !Number.isSafeInteger(request.imageData.width) ||
    !Number.isSafeInteger(request.imageData.height)
  ) {
    throw new GenerativeEditError('invalid-image', 'The source image dimensions are invalid.');
  }
  if (request.imageData.width <= 0 || request.imageData.height <= 0) {
    throw new GenerativeEditError('invalid-image', 'The source image is empty.');
  }
  if (
    request.maskWidth <= 0 ||
    request.maskHeight <= 0 ||
    request.mask.length !== request.maskWidth * request.maskHeight
  ) {
    throw new GenerativeEditError(
      'invalid-mask',
      'The edit mask dimensions do not match its pixels.',
    );
  }
  if (
    (request.maskOffsetX !== undefined && !Number.isSafeInteger(request.maskOffsetX)) ||
    (request.maskOffsetY !== undefined && !Number.isSafeInteger(request.maskOffsetY))
  ) {
    throw new GenerativeEditError('invalid-mask', 'The edit mask offset is invalid.');
  }
  if (!request.mask.some((value) => value > 0)) {
    throw new GenerativeEditError('empty-mask', 'Paint an area to edit before generating.');
  }
}

function mapQuality(quality: GenerativeEditRequest['quality']): ContentAwareFillQuality {
  return quality === 'draft' ? 'fast' : 'ai';
}

function providerFor(
  result: Awaited<ReturnType<typeof runContentAwareFillPipeline>>,
): GenerativeEditProvider {
  const executionProvider = result.executionProvider ?? 'heuristic';
  return {
    kind: 'local',
    id: executionProvider === 'heuristic' ? 'varve-content-aware' : 'varve-lama-inpainting',
    ...(result.modelId ? { modelId: result.modelId } : {}),
    runtime:
      executionProvider === 'heuristic'
        ? 'patchmatch'
        : executionProvider === 'native'
          ? 'native-accelerated'
          : 'wasm',
  };
}

export async function runGenerativeEdit(
  request: GenerativeEditRequest,
): Promise<GenerativeEditResult> {
  const startTime = performance.now();
  const capabilities = getGenerativeEditCapabilities();
  if (!capabilities[request.mode]) {
    throw new GenerativeEditError(
      'unsupported-mode',
      `${request.mode[0]?.toUpperCase()}${request.mode.slice(1)} is not available with the configured local provider.`,
    );
  }
  assertUsableRequest(request);
  if (request.signal?.aborted) throw new GenerativeEditError('cancelled', 'cancelled');
  if (request.isCurrent && !request.isCurrent()) {
    throw new GenerativeEditError('stale', 'The source changed before generation started.');
  }

  const warnings: string[] = [];
  if (request.prompt?.trim()) {
    warnings.push(
      'The local provider does not use prompts; the source and painted mask determine this result.',
    );
  }
  request.onProgress?.({ stage: 'preparing', progress: 0.05 });
  if (mapQuality(request.quality) === 'ai' && !request.modelPath) {
    throw new GenerativeEditError(
      'missing-model',
      'Download the local inpainting model or choose Draft quality.',
    );
  }

  const result = await runContentAwareFillPipeline({
    imageData: request.imageData,
    mask: request.mask,
    maskWidth: request.maskWidth,
    maskHeight: request.maskHeight,
    maskOffsetX: request.maskOffsetX ?? 0,
    maskOffsetY: request.maskOffsetY ?? 0,
    quality: mapQuality(request.quality),
    outputMode: 'new-layer',
    contextPadding: request.contextPadding,
    seed: request.seed,
    signal: request.signal,
    modelPath: request.modelPath,
    modelId: request.modelId,
    onProgress: (progress) => {
      const stage = progress < 0.2 ? 'preparing' : progress < 0.9 ? 'generating' : 'compositing';
      request.onProgress?.({ stage, progress: 0.1 + progress * 0.85 });
    },
  });

  if (request.signal?.aborted) throw new GenerativeEditError('cancelled', 'cancelled');
  if (request.isCurrent && !request.isCurrent()) {
    throw new GenerativeEditError('stale', 'The source changed while generation was running.');
  }
  request.onProgress?.({ stage: 'compositing', progress: 1 });
  warnings.push(...result.warnings);
  return {
    imageData: result.imageData,
    width: result.width,
    height: result.height,
    filledBounds: result.filledBounds,
    mode: request.mode,
    quality: request.quality,
    provider: providerFor(result),
    processingTimeMs: performance.now() - startTime,
    warnings,
  };
}
