import type {
  ColorizationRequestContract,
  ColorizationResultContract,
  ColorizationProgress as ContractProgress,
} from './colorizationRequest';
import { generateColorizationRequestId } from './colorizationRequest';
import { dispatchColorization } from './pipelineDispatch';
import { resolveRuntime } from './runtimeResolver';
import type {
  ColorizationParams,
  ColorizationPipeline,
  ColorizationProgress,
  ColorizationRequest,
  ColorizationResult,
  ImageStats,
  QualityMode,
  RuntimeResolution,
} from './types';

export const colorizationPipeline: ColorizationPipeline = {
  resolveRuntime(
    workflow: string,
    qualityMode: QualityMode,
    stats: ImageStats,
    installedModels: string[],
  ): RuntimeResolution {
    return resolveRuntime(workflow, qualityMode, stats, installedModels);
  },

  async execute(request: ColorizationRequest): Promise<ColorizationResult> {
    return dispatchColorize(request);
  },
};

export async function dispatchColorize(request: ColorizationRequest): Promise<ColorizationResult> {
  const {
    params,
    imageData,
    referenceData,
    hintsData,
    maskData,
    maskWidth,
    maskHeight,
    signal,
    onProgress,
  } = request;
  const startTime = performance.now();
  const workflow = params.workflow;
  const contract: ColorizationRequestContract = {
    requestId: generateColorizationRequestId(),
    kind: legacyWorkflowKind(workflow),
    source: {
      nodeId: params.sourceNodeId,
      revision: params.sourceRevision,
      width: imageData.width,
      height: imageData.height,
    },
    qualityMode: params.qualityMode,
    provider: {
      backend: 'auto',
      intent: request.providerIntent ?? 'full',
      previewMaxDimension: request.previewMaxDimension,
    },
    mask:
      maskData && maskWidth && maskHeight
        ? {
            maskId: params.maskNodeId ?? 'legacy-mask',
            revision: params.sourceRevision,
            data: maskData,
            width: maskWidth,
            height: maskHeight,
          }
        : undefined,
    palette:
      params.palette && params.palette.length > 0
        ? {
            colors: [...params.palette],
            revision: params.sourceRevision,
            adherence: params.adherence,
          }
        : undefined,
    reference: referenceData
      ? {
          assetId: params.referenceNodeId ?? 'legacy-reference',
          revision: params.sourceRevision,
          width: referenceData.width,
          height: referenceData.height,
          src: request.referenceSrc ?? 'legacy-reference',
        }
      : undefined,
    hints: hintsData
      ? {
          assetId: params.hintsNodeId ?? 'legacy-hints',
          revision: params.sourceRevision,
          width: hintsData.width,
          height: hintsData.height,
          src: request.hintsSrc ?? 'legacy-hints',
        }
      : undefined,
    params: {
      targetHue: params.targetHue,
      hueMode: params.hueMode,
      saturationScale: params.saturationScale,
      chromaStrength: params.chromaStrength,
      blendStrength: params.blendStrength,
      luminancePreservation: params.luminancePreservation,
      paletteMode: params.paletteMode,
      neutralProtection: params.neutralProtection,
      skinProtection: params.skinProtection,
      lineThreshold: params.lineThreshold,
      gapClose: params.gapClose,
    },
    signal,
    onProgress: (progress) => {
      onProgress?.({
        phase: mapLegacyProgressPhase(progress),
        percent: progress.percent,
        elapsedMs: progress.elapsedMs,
      });
    },
  };

  const result = await dispatchColorization(contract, imageData, referenceData, hintsData);
  return toLegacyResult(result, params.sourceNodeId, params.sourceRevision, workflow, startTime);
}

function legacyWorkflowKind(
  workflow: ColorizationParams['workflow'],
): ColorizationRequestContract['kind'] {
  switch (workflow) {
    case 'reference-transfer':
      return 'reference-transfer';
    case 'selective-recolor':
      return 'selective-recolor';
    case 'palette-colorize':
      return 'palette-colorize';
    case 'harmonize':
      return 'harmonize';
    case 'photo-colorize':
      return 'photo-colorize';
    case 'lineart-colorize':
      return 'lineart-colorize';
  }
}

function mapLegacyProgressPhase(progress: ContractProgress): ColorizationProgress['phase'] {
  switch (progress.phase) {
    case 'model-download':
      return 'downloading';
    case 'decoding':
    case 'encoding':
    case 'compositing':
      return 'postprocessing';
    default:
      return progress.phase;
  }
}

function toLegacyResult(
  result: ColorizationResultContract,
  sourceNodeId: string,
  sourceRevision: number,
  workflow: ColorizationParams['workflow'],
  startTime: number,
): ColorizationResult {
  return {
    imageData: result.imageData,
    sourceNodeId,
    sourceRevision,
    workflow,
    modelUsed: result.modelUsed,
    provider: result.provider,
    elapsedMs: performance.now() - startTime,
  };
}

export { harmonize } from './harmonize';
export { paletteColorize, validatePalette } from './palette';
export { selectiveRecolor } from './recolor';
export { colorTransferLab } from './transfer';
