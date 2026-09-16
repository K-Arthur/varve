import {
  type ContentAwareFillQuality,
  QUICK_CLEANUP_PROVIDER,
  runContentAwareFillPipeline,
  runQuickCleanup,
} from '../contentAwareFill';
import {
  compositeFillResult,
  computeBoundedContextRegion,
  extractBoundedContext,
  validateMaskFrameGeometry,
} from '../contentAwareFill/contextExtraction';
import { prepareDiffusionFrame } from './diffusionFrame';
import { runDeterministicExpandFallback } from './expandFallback';
import { NATIVE_GENERATIVE_MODEL_PROFILE } from './nativeModel';
import { nativeGenerativeProvider } from './nativeProvider';
import { assessGenerativeEditResources, getGenerativeEditResourceProfile } from './resourcePolicy';
import {
  type GenerativeEditCapabilities,
  type GenerativeEditCapabilityContext,
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

function localCapabilities(
  context: GenerativeEditCapabilityContext = {},
): GenerativeEditCapabilities {
  const promptCapable = nativeGenerativeProvider.isAvailable();
  const promptReady = promptCapable && context.nativeModelReady === true;
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
    'imageGuidanceScale',
    'variations',
    'contextPadding',
    'maskExpansion',
    'feather',
  ];
  const unavailablePromptReason = promptCapable
    ? 'Install and validate the local diffusion model before generating.'
    : 'Prompt-conditioned generation requires the packaged desktop diffusion provider.';
  const unavailableBrowserExpandReason =
    'Expand is unavailable in the browser because no qualified local outpainting provider is available. Use the desktop app for local expansion; Fill and Remove remain available here.';
  return {
    fill: true,
    remove: true,
    replace: promptCapable,
    // The browser fallback can produce a structurally valid frame while
    // visibly repeating/striping photographic edges. Keep that unqualified
    // path out of the user-facing capability contract until a browser
    // outpainting provider passes the real-photo quality gate.
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
        ready: promptReady,
        prompt: promptCapable,
        variations: promptCapable,
        supportedParameters: promptCapable ? diffusionParameters : [],
        limits: promptCapable ? NATIVE_LIMITS : BROWSER_LIMITS,
        reasonCode: promptCapable ? 'model-required' : 'runtime-unavailable',
        reason: unavailablePromptReason,
      }),
      expand: modeCapabilities({
        // Desktop can use the shared local reconstruction path for promptless
        // expansion and the native provider for prompts. Browser expansion is
        // deliberately unavailable until its photographic quality is
        // qualified; do not expose a heuristic result as outpainting.
        available: promptCapable,
        ready: promptReady,
        prompt: promptCapable,
        variations: promptCapable,
        supportedParameters: promptCapable ? diffusionParameters : [],
        limits: promptCapable ? NATIVE_LIMITS : BROWSER_LIMITS,
        reasonCode: promptCapable ? undefined : 'runtime-unavailable',
        reason: promptCapable ? undefined : unavailableBrowserExpandReason,
      }),
    },
    resourceProfile,
    ...(promptCapable ? {} : { reason: unavailablePromptReason }),
  };
}

export function getGenerativeEditCapabilities(
  provider: 'local' | 'remote' = 'local',
  context: GenerativeEditCapabilityContext = {},
) {
  if (provider === 'remote') {
    return {
      ...localCapabilities(context),
      reason: 'No remote provider is configured for this local-first build.',
    };
  }
  return localCapabilities(context);
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
  const geometry = validateMaskFrameGeometry(
    request.imageData.width,
    request.imageData.height,
    request.mask,
    request.maskWidth,
    request.maskHeight,
    request.maskOffsetX ?? 0,
    request.maskOffsetY ?? 0,
  );
  if (!geometry.valid) throw new GenerativeEditError('invalid-mask', geometry.message);
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
    (request.mode === 'expand' && promptRequested) ||
    (request.mode === 'fill' && promptRequested);
  const diffusionFrameContract = requiresDiffusion
    ? NATIVE_GENERATIVE_MODEL_PROFILE.frameContract
    : undefined;
  const targetModelAspectRatio = diffusionFrameContract
    ? diffusionFrameContract.frameWidth / diffusionFrameContract.frameHeight
    : undefined;
  const workingRegion = computeBoundedContextRegion(
    request.imageData.width,
    request.imageData.height,
    request.mask,
    request.maskWidth,
    request.maskHeight,
    request.maskOffsetX ?? 0,
    request.maskOffsetY ?? 0,
    request.contextPadding,
    targetModelAspectRatio,
  );
  const resourceAssessment = assessGenerativeEditResources({
    mode: request.mode,
    width: request.imageData.width,
    height: request.imageData.height,
    workingWidth: workingRegion.width,
    workingHeight: workingRegion.height,
    // The model sees the bounded context. The public result may be a full
    // source composite, but budgeting that output frame here would defeat
    // regional inference on large photographs.
    outputWidth: workingRegion.width,
    outputHeight: workingRegion.height,
    quality: request.quality,
    requiresDiffusion,
  });
  if (!resourceAssessment.allowed) {
    throw new GenerativeEditError(
      resourceAssessment.reasonCode ?? 'insufficient-memory',
      resourceAssessment.reason ?? 'The requested local model does not fit this device safely.',
    );
  }
  const usesQuickCleanup =
    request.quality === 'draft' && (request.mode === 'fill' || request.mode === 'remove');
  if (usesQuickCleanup && !requiresDiffusion) {
    const quickResult = await runQuickCleanup({
      imageData: request.imageData,
      mask: request.mask,
      maskWidth: request.maskWidth,
      maskHeight: request.maskHeight,
      maskOffsetX: request.maskOffsetX ?? 0,
      maskOffsetY: request.maskOffsetY ?? 0,
      contextPadding: request.contextPadding,
      seed: request.seed,
      signal: request.signal,
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
    warnings.push(...quickResult.warnings);
    return {
      imageData: quickResult.imageData,
      width: quickResult.width,
      height: quickResult.height,
      filledBounds: quickResult.filledBounds,
      mode: request.mode,
      quality: request.quality,
      provider: {
        kind: 'local',
        id: QUICK_CLEANUP_PROVIDER.id,
        runtime: QUICK_CLEANUP_PROVIDER.runtime,
      },
      processingTimeMs: performance.now() - startTime,
      warnings,
    };
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
      targetModelAspectRatio,
    );
    const diffusionFrame = prepareDiffusionFrame(
      context.imageData,
      context.mask,
      context.width,
      context.height,
      diffusionFrameContract ?? NATIVE_GENERATIVE_MODEL_PROFILE.frameContract,
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
        inputFrame: {
          contractId: diffusionFrame.contractId,
          preprocessingVersion: diffusionFrame.preprocessingVersion,
          width: diffusionFrame.width,
          height: diffusionFrame.height,
          sourceWidth: context.width,
          sourceHeight: context.height,
          contentX: diffusionFrame.contentX,
          contentY: diffusionFrame.contentY,
          contentWidth: diffusionFrame.contentWidth,
          contentHeight: diffusionFrame.contentHeight,
        },
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
  if (request.mode === 'expand') {
    if (
      request.maskWidth !== request.imageData.width ||
      request.maskHeight !== request.imageData.height ||
      (request.maskOffsetX ?? 0) !== 0 ||
      (request.maskOffsetY ?? 0) !== 0
    ) {
      throw new GenerativeEditError(
        'invalid-mask',
        'Expand requires a full-frame mask aligned with the expanded output frame.',
      );
    }
    const expanded = await runDeterministicExpandFallback({
      imageData: request.imageData,
      mask: request.mask,
      quality: mapQuality(request.quality),
      contextPadding: request.contextPadding,
      seed: request.seed,
      signal: request.signal,
      onProgress: (progress) => request.onProgress?.({ stage: 'generating', progress }),
      modelPath: request.modelPath,
      modelId: request.modelId,
    });
    if (request.signal?.aborted) throw new GenerativeEditError('cancelled', 'cancelled');
    if (request.isCurrent && !request.isCurrent()) {
      throw new GenerativeEditError('stale', 'The source changed while generation was running.');
    }
    return {
      imageData: expanded.imageData,
      width: expanded.width,
      height: expanded.height,
      filledBounds: expanded.filledBounds,
      mode: request.mode,
      quality: request.quality,
      provider: providerFor(expanded),
      processingTimeMs: performance.now() - startTime,
      warnings: [...warnings, ...expanded.warnings],
    };
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
