/**
 * Model-backed automatic foreground proposals for "Select subject".
 *
 * This is the automatic-foreground capability family: a plausible foreground
 * region, not semantic recognition and not prompted selection. It reuses the
 * background-removal models Varve already ships (`u2netp` bundled,
 * `isnet-general-use` and `birefnet-general-lite` optional) through the shared
 * model manager, the provider chain, and the existing memory preflight.
 *
 * Routing is capability- and measurement-based, never a silent substitution:
 *
 * - `fast` requests the bundled U²-Net Light and never downloads or upgrades.
 * - `balanced` prefers IS-Net when it is installed and admissible.
 * - `high` prefers BiRefNet Lite, then IS-Net, then the bundled model.
 * - An inadmissible or missing model is recorded with its reason and its
 *   download size; the result reports what actually ran.
 * - The model-free estimator is the fallback when no model can run at all,
 *   and the caller always sees that it is the model-free path.
 *
 * Proposals never mutate a document. Callers review candidates and decide
 * whether to use one as a pixel selection or apply it as a document mask.
 */
import { removeBackground } from '../backgroundRemoval';
import {
  filterMaskByComponents,
  findConnectedComponents,
  type MaskComponent,
} from '../backgroundRemoval/maskOps';
import type { RemovalMethod, WorkerModelId } from '../backgroundRemoval/types';
import { getModelById } from '../inference/modelCatalog';
import { assessImageInferenceResources } from '../inference/resourcePolicy';
import {
  type ForegroundProposal,
  type ForegroundProposalSet,
  proposeForegroundSubjects,
} from './foregroundSelect';

export type SubjectProposalQuality = 'fast' | 'balanced' | 'high';

/** Models a model-backed automatic proposal may run. */
export type ModelSubjectSource = 'u2netp' | 'isnet-general-use' | 'birefnet-general-lite';

/** Model-backed provider, or the model-free estimator. */
export type SubjectProposalSource = ModelSubjectSource | 'model-free';

const QUALITY_MODEL: Record<SubjectProposalQuality, ModelSubjectSource> = {
  fast: 'u2netp',
  balanced: 'isnet-general-use',
  high: 'birefnet-general-lite',
};

/** Models that native (Tauri) execution can run for a given method. */
const NATIVE_MODEL: Partial<Record<ModelSubjectSource, RemovalMethod>> = {
  'isnet-general-use': 'ai-balanced',
  'birefnet-general-lite': 'ai-quality',
};

/** Minimum fraction of image pixels for a component to be offered separately. */
const MIN_COMPONENT_FRACTION = 0.001;
/** Alpha level that separates proposed foreground from background. */
const FOREGROUND_THRESHOLD = 128;

export function modelForSubjectQuality(quality: SubjectProposalQuality): ModelSubjectSource {
  return QUALITY_MODEL[quality];
}

export function methodForSubjectModel(modelId: ModelSubjectSource): RemovalMethod {
  return modelId === 'birefnet-general-lite' ? 'ai-quality' : 'ai-balanced';
}

export function subjectModelLabel(source: SubjectProposalSource): string {
  switch (source) {
    case 'u2netp':
      return 'U²-Net Light';
    case 'isnet-general-use':
      return 'IS-Net';
    case 'birefnet-general-lite':
      return 'BiRefNet Lite';
    case 'model-free':
      return 'Model-free estimate';
  }
}

export function isBundledSubjectModel(modelId: ModelSubjectSource): boolean {
  return modelId === 'u2netp';
}

export function subjectModelPeakBytes(modelId: ModelSubjectSource): number {
  const peak = getModelById(modelId)?.peakMemoryBytes;
  return typeof peak === 'number' && peak > 0 ? peak : 330_000_000;
}

export function subjectModelSizeBytes(modelId: ModelSubjectSource): number {
  return getModelById(modelId)?.sizeBytes ?? 0;
}

export interface SubjectRoutingRuntime {
  isTauri: boolean;
  nativeReady: boolean;
  safePeakBytes: number;
}

export interface SubjectRoutingRequest {
  quality: SubjectProposalQuality;
  /** Model ids reported by the model manager as installed (bundled included). */
  installedModelIds: readonly string[];
  runtime: SubjectRoutingRuntime;
  sourceWidth: number;
  sourceHeight: number;
}

export interface SubjectRoutingAttempt {
  modelId: ModelSubjectSource;
  estimatedPeakBytes: number;
  /** Human-readable reason this attempt is in the plan. */
  reason: string;
  /** True when the working set was accepted through native execution. */
  native: boolean;
  /** True when this attempt is a step down from the requested quality model. */
  steppedDown: boolean;
}

export interface SubjectRoutingPlan {
  quality: SubjectProposalQuality;
  /** Ordered model attempts. Empty only when the model-free fallback is the plan. */
  attempts: SubjectRoutingAttempt[];
  fallbackSource: 'model-free' | null;
  fallbackReason?: string;
  /** Set when the requested quality model is not installed (never auto-downloads). */
  install?: {
    modelId: ModelSubjectSource;
    displayName: string;
    downloadBytes: number;
  };
  /** Models considered and skipped, with the reason. Diagnostics surface. */
  rejected: Array<{ modelId: string; reason: string }>;
}

function fallbackOrder(quality: SubjectProposalQuality): ModelSubjectSource[] {
  switch (quality) {
    case 'fast':
      return ['u2netp'];
    case 'balanced':
      return ['isnet-general-use', 'u2netp'];
    case 'high':
      return ['birefnet-general-lite', 'isnet-general-use', 'u2netp'];
  }
}

function isInstalled(modelId: ModelSubjectSource, installedModelIds: readonly string[]): boolean {
  if (isBundledSubjectModel(modelId)) return true;
  return installedModelIds.includes(modelId);
}

/**
 * Decide which automatic-foreground providers may run, in order, with the
 * reason each was chosen or rejected. Pure and synchronous so the routing
 * policy is directly testable.
 */
export function decideSubjectRouting(request: SubjectRoutingRequest): SubjectRoutingPlan {
  const requested = QUALITY_MODEL[request.quality];
  const attempts: SubjectRoutingAttempt[] = [];
  const rejected: Array<{ modelId: string; reason: string }> = [];
  let install: SubjectRoutingPlan['install'];

  if (!isInstalled(requested, request.installedModelIds)) {
    install = {
      modelId: requested,
      displayName: subjectModelLabel(requested),
      downloadBytes: subjectModelSizeBytes(requested),
    };
  }

  for (const modelId of fallbackOrder(request.quality)) {
    const steppedDown = modelId !== requested;
    if (!isInstalled(modelId, request.installedModelIds)) {
      rejected.push({ modelId, reason: 'not installed' });
      continue;
    }

    const nativeMethod = NATIVE_MODEL[modelId];
    const native = Boolean(nativeMethod) && request.runtime.isTauri && request.runtime.nativeReady;
    if (native) {
      attempts.push({
        modelId,
        estimatedPeakBytes: subjectModelPeakBytes(modelId),
        reason: 'native execution is available',
        native: true,
        steppedDown,
      });
      continue;
    }

    const peakBytes = subjectModelPeakBytes(modelId);
    const assessment = assessImageInferenceResources({
      width: request.sourceWidth,
      height: request.sourceHeight,
      modelPeakBytes: peakBytes,
      runtime: { wasmSafePeakBytes: request.runtime.safePeakBytes },
      operation: 'Automatic subject estimate',
    });
    if (!assessment.allowed) {
      rejected.push({
        modelId,
        reason: assessment.reason ?? 'does not fit this runtime memory budget',
      });
      continue;
    }
    attempts.push({
      modelId,
      estimatedPeakBytes: assessment.estimatedPeakBytes,
      reason: steppedDown
        ? install
          ? `${subjectModelLabel(requested)} is not installed; using the installed ${subjectModelLabel(modelId)}`
          : `${subjectModelLabel(requested)} does not fit this device; using ${subjectModelLabel(modelId)}`
        : 'fits the runtime memory budget',
      native: false,
      steppedDown,
    });
  }

  if (attempts.length === 0) {
    return {
      quality: request.quality,
      attempts,
      fallbackSource: 'model-free',
      fallbackReason:
        rejected.length > 0
          ? `No automatic model could run: ${rejected.map((r) => `${r.modelId} (${r.reason})`).join('; ')}`
          : 'No automatic model is available',
      install,
      rejected,
    };
  }

  return { quality: request.quality, attempts, fallbackSource: null, install, rejected };
}

export interface SubjectProposalRequest extends SubjectRoutingRequest {
  /** Decoded source pixels (source resolution). */
  imageData: ImageData;
  signal?: AbortSignal;
  /** Maximum number of region candidates after the foreground union. Default 4. */
  maxRegionCandidates?: number;
  /** Allow the model-free estimator when no model can run. Default true. */
  allowModelFreeFallback?: boolean;
}

export interface SubjectProposalAttemptResult {
  modelId: SubjectProposalSource;
  outcome: 'used' | 'failed' | 'skipped';
  reason?: string;
  elapsedMs?: number;
}

export interface SubjectProposalResult {
  source: SubjectProposalSource;
  quality: SubjectProposalQuality;
  /** The model that produced the candidates, or null for the model-free path. */
  modelId: string | null;
  set: ForegroundProposalSet;
  plan: SubjectRoutingPlan;
  attempts: SubjectProposalAttemptResult[];
  elapsedMs: number;
}

/**
 * Derive reviewable candidates from a model alpha mask.
 *
 * The union candidate keeps the soft coverage. Region candidates are binary:
 * they name one significant connected component so users can pick between
 * subjects without a second model run.
 */
export function proposalSetFromAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  maxRegionCandidates = 4,
): ForegroundProposalSet {
  if (alpha.length !== width * height || width <= 0 || height <= 0) {
    return {
      width,
      height,
      analysisWidth: width,
      analysisHeight: height,
      candidates: [],
      emptyReason: 'unsupported-source',
    };
  }

  const total = width * height;
  let foregroundPixels = 0;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < total; index += 1) {
    if ((alpha[index] ?? 0) >= FOREGROUND_THRESHOLD) {
      foregroundPixels += 1;
      const x = index % width;
      sumX += x;
      sumY += (index - x) / width;
    }
  }
  if (foregroundPixels === 0) {
    return {
      width,
      height,
      analysisWidth: width,
      analysisHeight: height,
      candidates: [],
      emptyReason: 'no-subject',
    };
  }

  const binary = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if ((alpha[index] ?? 0) >= FOREGROUND_THRESHOLD) binary[index] = 255;
  }

  const coverage = foregroundPixels / total;
  const unionCandidate: ForegroundProposal = {
    mask: binary,
    alpha,
    label: 'All foreground',
    coverage,
    score: Math.max(0, Math.min(1, coverage / 0.25)),
    centroid: {
      x: sumX / Math.max(1, foregroundPixels) / width,
      y: sumY / Math.max(1, foregroundPixels) / height,
    },
    edgeAlignment: 0,
  };

  const minPixels = Math.max(16, Math.floor(total * MIN_COMPONENT_FRACTION));
  const components = findConnectedComponents(alpha, width, height, FOREGROUND_THRESHOLD)
    .filter((component: MaskComponent) => component.pixelCount >= minPixels)
    .sort((a, b) => b.pixelCount - a.pixelCount)
    .slice(0, maxRegionCandidates);

  if (components.length <= 1) {
    return {
      width,
      height,
      analysisWidth: width,
      analysisHeight: height,
      candidates: [unionCandidate],
    };
  }

  const regionCandidates: ForegroundProposal[] = components.map((component, index) => ({
    mask: filterMaskByComponents(
      alpha,
      width,
      height,
      new Set([component.id]),
      FOREGROUND_THRESHOLD,
    ),
    label: `Region ${index + 1}`,
    coverage: component.pixelCount / total,
    score: Math.max(0, Math.min(1, component.pixelCount / total / 0.25)),
    centroid: {
      x: component.centerOfMass.x / width,
      y: component.centerOfMass.y / height,
    },
    edgeAlignment: 0,
  }));

  return {
    width,
    height,
    analysisWidth: width,
    analysisHeight: height,
    candidates: [unionCandidate, ...regionCandidates],
  };
}

/**
 * Run the preferred automatic-foreground provider for the requested quality,
 * stepping down only through the model-backed order with the reason recorded.
 */
export async function proposeSubjects(
  request: SubjectProposalRequest,
): Promise<SubjectProposalResult> {
  const startedAt = performance.now();
  const plan = decideSubjectRouting(request);
  const attempts: SubjectProposalAttemptResult[] = [];
  const signal = request.signal;

  for (const attempt of plan.attempts) {
    if (signal?.aborted) throw new Error('cancelled');
    const attemptStart = performance.now();
    try {
      const result = await removeBackground(
        request.imageData,
        {
          method: methodForSubjectModel(attempt.modelId),
          modelId: attempt.modelId,
          previewMaxDimension: 2048,
        },
        signal,
      );
      const alpha = result.rawMask ?? result.sourceAlpha;
      if (!alpha || result.width <= 0 || result.height <= 0) {
        attempts.push({
          modelId: attempt.modelId,
          outcome: 'failed',
          reason: 'the model returned no mask',
          elapsedMs: Math.round(performance.now() - attemptStart),
        });
        continue;
      }
      const set = proposalSetFromAlpha(
        alpha,
        result.width,
        result.height,
        request.maxRegionCandidates ?? 4,
      );
      if (set.candidates.length === 0) {
        attempts.push({
          modelId: attempt.modelId,
          outcome: 'failed',
          reason: 'the model found no foreground',
          elapsedMs: Math.round(performance.now() - attemptStart),
        });
        continue;
      }
      attempts.push({
        modelId: attempt.modelId,
        outcome: 'used',
        reason: attempt.reason,
        elapsedMs: Math.round(performance.now() - attemptStart),
      });
      return {
        source: attempt.modelId,
        quality: request.quality,
        modelId: attempt.modelId,
        set,
        plan,
        attempts,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      if (signal?.aborted) throw new Error('cancelled');
      const raw = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(raw)) throw new Error('cancelled');
      attempts.push({
        modelId: attempt.modelId,
        outcome: 'failed',
        reason: raw,
        elapsedMs: Math.round(performance.now() - attemptStart),
      });
    }
  }

  if (request.allowModelFreeFallback === false) {
    throw new Error(
      plan.fallbackReason ?? 'No automatic foreground model could run on this device.',
    );
  }

  const heuristic = proposeForegroundSubjects({
    data: request.imageData.data,
    width: request.imageData.width,
    height: request.imageData.height,
  });
  const fallbackReason =
    plan.fallbackReason ??
    (attempts.length > 0
      ? `No model produced a proposal: ${attempts.map((a) => `${a.modelId} (${a.reason ?? a.outcome})`).join('; ')}`
      : undefined);
  attempts.push({ modelId: 'model-free', outcome: 'used', reason: fallbackReason });
  return {
    source: 'model-free',
    quality: request.quality,
    modelId: null,
    set: heuristic,
    plan: { ...plan, fallbackReason },
    attempts,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

/** Re-exported so callers can type provider ids without importing the catalog. */
export type { WorkerModelId };
