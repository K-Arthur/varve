import { type ContentAwareFillQuality, runContentAwareFillPipeline } from '../contentAwareFill';
import { compositeFillResult, extractBoundedContext } from '../contentAwareFill/contextExtraction';
import { prepareDiffusionFrame } from './diffusionFrame';
import { NATIVE_GENERATIVE_MODEL_PROFILE } from './nativeModel';
import { nativeGenerativeProvider } from './nativeProvider';
import { assessGenerativeEditResources, getGenerativeEditResourceProfile } from './resourcePolicy';
import {
  type GenerativeEditCapabilities,
  type GenerativeEditCapabilityParameter,
  GenerativeEditError,
  type GenerativeEditModeCapabilities,
  type GenerativeEditProvider,
  type GenerativeEditRequest,
  type GenerativeEditResult,
} from './types';

const BROWSER_LIMITS = {
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxVariations: 1,
} as const;

const NATIVE_LIMITS = {
  maxWidth: 2_048,
  maxHeight: 2_048,
  maxVariations: 4,
  maxSteps: 100,
} as const;

function modeCapabilities(
  input: Omit<GenerativeEditModeCapabilities, 'limits'> & {
    limits?: Partial<GenerativeEditModeCapabilities['limits']>;
  },
): GenerativeEditModeCapabilities {
  return {
    ...input,
    limits: {
      ...BROWSER_LIMITS,
      ...input.limits,
    },
  };
}

function localCapabilities(): GenerativeEditCapabilities {
  const promptCapable = nativeGenerativeProvider.isAvailable();
  const resourceProfile = getGenerativeEditResourceProfile();
  const reconstructionParameters: readonly GenerativeEditCapabilityParameter[] = [
    'seed',
    'contextPadding',
    'maskExpansion',
    'feather',
  ];
  const diffusionParameters: readonly GenerativeEditCapabilityParameter[] = [
    'prompt',
    'negativePrompt',
    'seed',
    'strength',
    'steps',
    'guidanceScale',
    'variations',
    'contextPadding',
    'maskExpansion',
    'feather',
  ];
  const unavailablePromptReason = promptCapable
    ? 'Install and validate the local diffusion model before generating.'
    : 'Prompt-conditioned generation requires the packaged desktop diffusion provider.';
  return {
    fill: true,
    remove: true,
    replace: promptCapable,
    expand: promptCapable,
    prompt: promptCapable,
    variations: promptCapable,
    modes: {
      fill: modeCapabilities({
        available: true,
        ready: true,
        prompt: promptCapable,
        variations: promptCapable,
        supportedParameters: promptCapable ? diffusionParameters : reconstructionParameters,
        limits: promptCapable ? NATIVE_LIMITS : BROWSER_LIMITS,
      }),
      remove: modeCapabilities({
        available: true,
        ready: true,
        prompt: false,
        variations: false,
        supportedParameters: reconstructionParameters,
      }),
      replace: modeCapabilities({
        available: promptCapable,
        ready: false,
        prompt: promptCapable,
        variations: promptCapable,
        supportedParameters: promptCapable ? diffusionParameters : [],
        limits: promptCapable ? NATIVE_LIMITS : BROWSER_LIMITS,
        reasonCode: promptCapable ? 'model-required' : 'runtime-unavailable',
        reason: unavailablePromptReason,
      }),
      expand: modeCapabilities({
        available: promptCapable,
        ready: false,
        prompt: promptCapable,
        variations: promptCapable,
        supportedParameters: promptCapable ? diffusionParameters : [],
        limits: promptCapable ? NATIVE_LIMITS : BROWSER_LIMITS,
        reasonCode: promptCapable ? 'model-required' : 'runtime-unavailable',
        reason: unavailablePromptReason,
      }),
    },
    resourceProfile,
    ...(promptCapable ? {} : { reason: unavailablePromptReason }),
  };
}

export function getGenerativeEditCapabilities(provider: 'local' | 'remote' = 'local') {
  if (provider === 'remote') {
    return {
      ...localCapabilities(),
      reason: 'No remote provider is configured for this local-first build.',
    };
  }
  return localCapabilities();
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
  request.onProgress?.({ stage: 'preparing', progress: 0.05 });
  const promptRequested =
    (request.mode === 'fill' || request.mode === 'replace' || request.mode === 'expand') &&
    Boolean(request.prompt?.trim());
  if (request.mode === 'replace' && !request.prompt?.trim()) {
    throw new GenerativeEditError(
      'prompt-unavailable',
      'Replace requires a prompt describing the replacement content.',
    );
  }
  if (request.mode === 'remove' && request.prompt?.trim()) {
    warnings.push('Remove is reconstruction-based and does not use prompts.');
  }
  const requiresDiffusion =
    request.mode === 'replace' ||
    request.mode === 'expand' ||
    (request.mode === 'fill' && promptRequested);
  const resourceAssessment = assessGenerativeEditResources({
    mode: request.mode,
    width: request.imageData.width,
    height: request.imageData.height,
    outputWidth: request.outputWidth,
    outputHeight: request.outputHeight,
    quality: request.quality,
    requiresDiffusion,
  });
  if (!resourceAssessment.allowed) {
    throw new GenerativeEditError(
      resourceAssessment.reasonCode ?? 'insufficient-memory',
      resourceAssessment.reason ?? 'The requested local model does not fit this device safely.',
    );
  }
  if (requiresDiffusion && nativeGenerativeProvider.isAvailable()) {
    const context = extractBoundedContext(
      request.imageData,
      request.mask,
      request.maskWidth,
      request.maskHeight,
      request.maskOffsetX ?? 0,
      request.maskOffsetY ?? 0,
      request.contextPadding,
    );
    const diffusionFrame = prepareDiffusionFrame(
      context.imageData,
      context.mask,
      context.width,
      context.height,
    );
    const nativeResult = await nativeGenerativeProvider.infer({
      ...request,
      imageData: diffusionFrame.imageData,
      mask: diffusionFrame.mask,
      maskWidth: diffusionFrame.width,
      maskHeight: diffusionFrame.height,
      maskOffsetX: 0,
      maskOffsetY: 0,
      outputWidth: diffusionFrame.width,
      outputHeight: diffusionFrame.height,
    });
    if (request.signal?.aborted) throw new GenerativeEditError('cancelled', 'cancelled');
    if (request.isCurrent && !request.isCurrent()) {
      throw new GenerativeEditError('stale', 'The source changed while generation was running.');
    }
    const restored = diffusionFrame.restore(nativeResult.imageData);
    const composited = compositeFillResult(
      request.imageData,
      restored,
      context.offsetX,
      context.offsetY,
      context.mask,
    );
    request.onProgress?.({ stage: 'compositing', progress: 1 });
    warnings.push(...nativeResult.warnings);
    return {
      imageData: composited,
      width: composited.width,
      height: composited.height,
      filledBounds: {
        x: context.offsetX,
        y: context.offsetY,
        w: context.width,
        h: context.height,
      },
      mode: request.mode,
      quality: request.quality,
      provider: {
        kind: 'local',
        id: 'varve-diffusion-inpainting',
        runtime:
          nativeResult.executionProvider === 'native-cpu' ? 'native-cpu' : 'native-accelerated',
        ...(request.modelHandle
          ? { modelId: request.modelHandle }
          : request.modelId
            ? { modelId: request.modelId }
            : {}),
        ...(request.modelHandle
          ? {
              modelVersion: NATIVE_GENERATIVE_MODEL_PROFILE.revision,
              modelChecksum: NATIVE_GENERATIVE_MODEL_PROFILE.sha256,
            }
          : {}),
      },
      processingTimeMs: performance.now() - startTime,
      warnings,
    };
  }
  if (promptRequested) {
    throw new GenerativeEditError(
      'prompt-unavailable',
      'Prompt conditioning requires the packaged desktop diffusion provider.',
    );
  }
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
