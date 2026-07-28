/**
 * Font detection pipeline — orchestrates the full identification flow.
 *
 * Flow:
 *   1. Quality check — reject unusable crops early
 *   2. Typography feature estimation — narrow candidate search
 *   3. Classifier inference (if model available) — top-k family predictions
 *   4. Candidate resolution — map predictions to installed/catalogue fonts
 *   5. Local render-and-compare (hybrid mode) — refine ranking
 *   6. Confidence calibration — honest uncertainty communication
 */

import type { FontCatalog } from '../font/fontCatalog';
import type { FontSourceKind } from '../font/fontIdentity';
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import type { ModelRegistry } from '../inference/ModelRegistry';
import { decodeFontClassifyOutput } from '../inference/models/fontClassify';
import { resolveClassIndex } from './fontClassLabels';
import {
  calibrateConfidence,
  combineScores,
  estimateCropQuality,
  rankCandidates,
} from './fontConfidence';
import type {
  FontCandidate,
  FontDetectionMode,
  FontDetectionRequest,
  FontDetectionResult,
  FontDetectionStatus,
  QualityWarning,
  TypographyFeatures,
} from './fontDetectionTypes';
import { estimateTypographyFeatures, generateQualityWarnings } from './typographyEstimation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLASSIFIER_MODEL_ID = 'font-classify';
const DEFAULT_MAX_CANDIDATES = 10;
const CLASSIFIER_TOP_K = 20;

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export interface PipelineDependencies {
  modelRegistry?: ModelRegistry;
  fontCatalog?: FontCatalog;
  renderCompare?: LocalRenderCompareFn;
}

export type LocalRenderCompareFn = (
  imageData: ImageData,
  families: string[],
  recognizedText?: string,
) => Promise<Map<string, number>>;

export async function detectFont(
  request: FontDetectionRequest,
  deps: PipelineDependencies = {},
): Promise<FontDetectionResult> {
  const startTime = performance.now();
  const {
    imageData,
    mode,
    recognizedText,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    signal,
  } = request;

  if (signal?.aborted) return cancelledResult(startTime);

  const quality = estimateCropQuality(imageData);
  const warnings = generateQualityWarnings(imageData, quality);

  if (quality < 0.1) {
    return insufficientQualityResult(
      startTime,
      warnings,
      'Crop quality too low for reliable detection',
    );
  }

  const features = estimateTypographyFeatures(imageData);

  if (signal?.aborted) return cancelledResult(startTime);

  const classifierAvailable = await isClassifierAvailable(deps.modelRegistry);
  const resolvedMode = resolveMode(mode, classifierAvailable);

  let candidates: FontCandidate[];
  let usedClassifier = false;

  if (resolvedMode === 'classifier' || resolvedMode === 'hybrid') {
    if (classifierAvailable) {
      candidates = await runClassifierDetection(imageData, features, deps, signal);
      usedClassifier = true;
    } else {
      candidates = await runLocalMatch(imageData, features, deps, recognizedText);
    }
  } else {
    candidates = await runLocalMatch(imageData, features, deps, recognizedText);
  }

  if (resolvedMode === 'hybrid' && deps.renderCompare && candidates.length > 0) {
    const topFamilies = candidates.slice(0, 5).map((c) => c.family);
    const renderScores = await deps.renderCompare(imageData, topFamilies, recognizedText);
    applyRenderScores(candidates, renderScores);
  }

  rankCandidates(candidates);
  const topCandidates = candidates.slice(0, maxCandidates);

  const status: FontDetectionStatus = topCandidates.length === 0 ? 'low-confidence' : 'success';
  const message =
    status === 'low-confidence'
      ? 'No reliable font candidates found. Try a clearer, higher-contrast crop.'
      : `Found ${topCandidates.length} candidate${topCandidates.length === 1 ? '' : 's'}`;

  return {
    status,
    candidates: topCandidates,
    features,
    message,
    elapsedMs: Math.round(performance.now() - startTime),
    usedClassifier,
    resolvedMode,
    qualityWarnings: warnings,
  };
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

function resolveMode(
  requested: FontDetectionMode,
  classifierAvailable: boolean,
): FontDetectionMode {
  if (requested === 'classifier' && !classifierAvailable) return 'local-match';
  if (requested === 'hybrid' && !classifierAvailable) return 'local-match';
  return requested;
}

async function isClassifierAvailable(registry?: ModelRegistry): Promise<boolean> {
  if (!registry) return false;
  return registry.isReady(CLASSIFIER_MODEL_ID);
}

// ---------------------------------------------------------------------------
// Classifier-based detection
// ---------------------------------------------------------------------------

async function runClassifierDetection(
  imageData: ImageData,
  features: TypographyFeatures,
  deps: PipelineDependencies,
  signal?: AbortSignal,
): Promise<FontCandidate[]> {
  try {
    const host = getInferenceWorkerHost();
    const result = await host.infer(
      {
        type: 'infer',
        modelType: 'font-classify',
        modelPath: `/models/${CLASSIFIER_MODEL_ID}.onnx`,
        modelId: CLASSIFIER_MODEL_ID,
        imageData,
      },
      { signal, timeoutMs: 60_000 },
    );

    if (signal?.aborted) return [];

    const output = result.outputs['output'] as { data: Float32Array; dims: number[] } | undefined;
    if (!output) return [];

    const topK = decodeFontClassifyOutput(output.data, CLASSIFIER_TOP_K);
    const quality = estimateCropQuality(imageData);

    return buildCandidatesFromClassifier(topK, quality, features, deps);
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') return [];
    return [];
  }
}

function buildCandidatesFromClassifier(
  topK: Array<{ classIndex: number; confidence: number }>,
  cropQuality: number,
  features: TypographyFeatures,
  deps: PipelineDependencies,
): FontCandidate[] {
  const candidateMap = new Map<string, FontCandidate>();

  for (const { classIndex, confidence } of topK) {
    const resolved = resolveClassIndex(classIndex);
    const family = resolved.family;

    const existing = candidateMap.get(family);
    if (existing && existing.confidenceScore >= confidence) continue;

    const isInCatalogue = deps.fontCatalog
      ? deps.fontCatalog.getEntriesForFamily(family).length > 0
      : resolved.isExact;

    const calibration = calibrateConfidence({
      probabilities: [confidence],
      cropQuality,
      isInCatalogue,
      features,
    });

    const catalogEntry = deps.fontCatalog?.getEntriesForFamily(family)[0];

    candidateMap.set(family, {
      rank: 0,
      family,
      style: resolved.style,
      confidenceCategory: calibration.category,
      confidenceScore: calibration.calibratedScore,
      matchType: calibration.matchType,
      isAvailable: isInCatalogue,
      source: mapFontSource(catalogEntry?.source, isInCatalogue),
      license: catalogEntry?.license,
      catalogEntry,
    });
  }

  return [...candidateMap.values()];
}

// ---------------------------------------------------------------------------
// Local render-and-compare fallback
// ---------------------------------------------------------------------------

async function runLocalMatch(
  imageData: ImageData,
  features: TypographyFeatures,
  deps: PipelineDependencies,
  recognizedText?: string,
): Promise<FontCandidate[]> {
  if (!deps.renderCompare || !deps.fontCatalog) return [];

  const families = deps.fontCatalog.families();
  if (families.length === 0) return [];

  const scores = await deps.renderCompare(imageData, families, recognizedText);
  if (scores.size === 0) return [];

  const candidates: FontCandidate[] = [];
  const quality = estimateCropQuality(imageData);

  for (const [family, score] of scores) {
    if (score < 0.1) continue;

    const calibration = calibrateConfidence({
      probabilities: [score],
      cropQuality: quality,
      isInCatalogue: true,
      features,
      renderAgreement: score,
    });

    const catalogEntry = deps.fontCatalog!.getEntriesForFamily(family)[0];

    candidates.push({
      rank: 0,
      family,
      style: catalogEntry?.identity.subfamilyName ?? 'Regular',
      confidenceCategory: calibration.category,
      confidenceScore: calibration.calibratedScore,
      matchType: 'similar-installed',
      isAvailable: true,
      source: mapFontSource(catalogEntry?.source, true),
      license: catalogEntry?.license,
      catalogEntry,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Render score application
// ---------------------------------------------------------------------------

function applyRenderScores(candidates: FontCandidate[], renderScores: Map<string, number>): void {
  for (const candidate of candidates) {
    const renderScore = renderScores.get(candidate.family);
    if (renderScore !== undefined) {
      candidate.confidenceScore = combineScores(candidate.confidenceScore, renderScore);
      candidate.componentScores = {
        silhouetteOverlap: renderScore,
        strokeWidthSimilarity: renderScore,
        xHeightDelta: 1 - renderScore,
        charWidthRatio: renderScore,
        compositeScore: renderScore,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapFontSource(
  source: FontSourceKind | undefined,
  isInCatalogue: boolean,
): FontCandidate['source'] {
  if (!source) return isInCatalogue ? 'unknown' : 'downloadable';
  switch (source) {
    case 'remote':
      return 'downloadable';
    case 'missing':
      return 'unknown';
    default:
      return source;
  }
}

function cancelledResult(startTime: number): FontDetectionResult {
  return {
    status: 'cancelled',
    candidates: [],
    features: null,
    message: 'Font detection cancelled',
    elapsedMs: Math.round(performance.now() - startTime),
    usedClassifier: false,
    resolvedMode: 'local-match',
    qualityWarnings: [],
  };
}

function insufficientQualityResult(
  startTime: number,
  warnings: QualityWarning[],
  message: string,
): FontDetectionResult {
  return {
    status: 'insufficient-quality',
    candidates: [],
    features: null,
    message,
    elapsedMs: Math.round(performance.now() - startTime),
    usedClassifier: false,
    resolvedMode: 'local-match',
    qualityWarnings: warnings,
  };
}
