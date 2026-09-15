/**
 * Provider A/B evidence → canonical measurement records.
 *
 * The A/B harness (`providerAb.test.ts`) writes raw per-case observations. This
 * module is the single bridge from those observations to validator-checked
 * `MeasurementRecord`s, and from a verified record to the routing-facing
 * `PromptedQualityValidation` shape. Production records embed the same
 * per-category tables the fixture contains, so a fixture-vs-production drift
 * test can compare them without importing JSON at runtime.
 */

import type {
  MeasurementCase,
  MeasurementRecord,
  VerifiedMeasurementSummary,
} from '../../validation/measurementRecord';
import type { PromptedQualityValidation } from '../promptedRouting';

export const PROVIDER_AB_CORPUS_ID = 'object-selection-corpus-v1';

/** Numeric columns of a provider category measurement. */
export type ProviderCategoryMetric =
  | 'iou'
  | 'boundaryF'
  | 'bestAvailableIou'
  | 'regret'
  | 'rankingMatch';

/** Per-category measured values for one provider, one case per category. */
export interface ProviderCategoryMeasurement {
  category: string;
  iou: number;
  boundaryF: number;
  bestAvailableIou: number;
  regret: number;
  rankingMatch: number;
}

export interface ProviderAbEvidence {
  providerId: string;
  label: string;
  /** Version string recorded with the run (ORT version, host, threads). */
  runtimeEnvironment: string;
  /** ISO timestamp of the run. */
  measuredAt: string;
  codeRevision: string;
  artifactChecksums: Readonly<Record<string, string>>;
  /** Categories that must all be present for the record to be complete. */
  requiredCategories: readonly string[];
  criticalCategories: readonly string[];
  rows: readonly ProviderCategoryMeasurement[];
  /** Optional per-case identity (case ids), aligned with `rows` when present. */
  caseIds?: readonly string[];
}

export interface QualityRecordMetricsOptions {
  criticalCategories: readonly string[];
  requiredCategories: readonly string[];
}

export function buildProviderQualityRecord(
  evidence: ProviderAbEvidence,
  options: QualityRecordMetricsOptions = {
    criticalCategories: evidence.criticalCategories,
    requiredCategories: evidence.requiredCategories,
  },
): MeasurementRecord {
  if (evidence.rows.length === 0) {
    throw new Error(`Provider '${evidence.providerId}' has no measured rows.`);
  }
  const cases: MeasurementCase[] = evidence.rows.map((row, index) => ({
    caseId: evidence.caseIds?.[index] ?? `${evidence.providerId}:${row.category}`,
    category: row.category,
    outcome: 'ok',
    metrics: {
      iou: row.iou,
      boundaryF: row.boundaryF,
      bestAvailableIou: row.bestAvailableIou,
      regret: row.regret,
      rankingMatch: row.rankingMatch,
    },
  }));
  const perCategory: Record<string, Record<string, number>> = {};
  for (const row of evidence.rows) {
    perCategory[row.category] = {
      iou: row.iou,
      boundaryF: row.boundaryF,
      bestAvailableIou: row.bestAvailableIou,
      regret: row.regret,
      rankingMatch: row.rankingMatch,
    };
  }
  const categoryMean = (metric: ProviderCategoryMetric): number => {
    const values = evidence.rows.map((row) => row[metric]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const worstOf = (
    metric: ProviderCategoryMetric,
    direction: 'higher-is-better' | 'lower-is-better',
  ): { value: number; category: string } => {
    const critical = evidence.criticalCategories
      .map((category) => evidence.rows.find((row) => row.category === category))
      .filter((row): row is ProviderCategoryMeasurement => row !== undefined);
    if (critical.length === 0) throw new Error('Critical categories have no measured rows.');
    let worst = critical[0]!;
    for (const row of critical.slice(1)) {
      const worse =
        direction === 'higher-is-better'
          ? row[metric] < worst[metric]
          : row[metric] > worst[metric];
      if (worse) worst = row;
    }
    const tied = critical
      .filter((row) => row[metric] === worst[metric])
      .map((row) => row.category)
      .sort();
    return { value: worst[metric], category: tied[0] ?? worst.category };
  };
  const summary = {
    iou: categoryMean('iou'),
    boundaryF: categoryMean('boundaryF'),
    bestAvailableIou: categoryMean('bestAvailableIou'),
    regret: categoryMean('regret'),
    rankingMatch: categoryMean('rankingMatch'),
  };
  const worstCritical = {
    iou: worstOf('iou', 'higher-is-better'),
    boundaryF: worstOf('boundaryF', 'higher-is-better'),
    regret: worstOf('regret', 'lower-is-better'),
    rankingMatch: worstOf('rankingMatch', 'higher-is-better'),
  };
  return {
    schemaVersion: 1,
    kind: 'segmentation-quality',
    corpus: {
      id: PROVIDER_AB_CORPUS_ID,
      version: PROVIDER_AB_CORPUS_ID,
      hash: evidence.codeRevision,
      split: 'development',
      promptRegime: 'fixture prompts (points/box as defined by the corpus)',
    },
    identity: {
      codeRevision: evidence.codeRevision,
      dirty: false,
      artifactChecksums: evidence.artifactChecksums,
      runtime: {
        executionProvider: 'cpu',
        runtimeName: 'onnxruntime-node',
        runtimeVersion: evidence.runtimeEnvironment,
      },
      host: { os: 'linux', arch: 'x86_64' },
    },
    verification: 'real-model-harness',
    claims: [
      { topic: 'quality', scope: 'cpu' },
      { topic: 'reliability', scope: 'cpu' },
    ],
    metrics: [
      {
        name: 'iou',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
      {
        name: 'boundaryF',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
      {
        name: 'bestAvailableIou',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'reference',
      },
      {
        name: 'regret',
        direction: 'lower-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
      {
        name: 'rankingMatch',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
    ],
    requiredCategories: options.requiredCategories,
    criticalCategories: options.criticalCategories,
    cases,
    declared: {
      summary,
      perCategory,
      worstCritical,
      caseCounts: { total: cases.length, ok: cases.length },
      reliability: { successRate: 1 },
    },
  };
}

/**
 * Project a verified record back into the routing shape. The routing shape
 * keeps per-category boundary F so the validator — not a transcription — owns
 * the worst-category values.
 */
export function derivePromptedQualityValidation(
  evidence: ProviderAbEvidence,
  record: MeasurementRecord,
  verified: VerifiedMeasurementSummary,
): PromptedQualityValidation {
  if (verified.status !== 'verified') {
    throw new Error(
      `Provider '${evidence.providerId}' record is '${verified.status}'; routing needs verified evidence.`,
    );
  }
  const categoryIoU: Record<string, number> = {};
  const categoryBoundaryF: Record<string, number> = {};
  for (const [category, values] of Object.entries(verified.perCategory)) {
    categoryIoU[category] = values.iou!;
    categoryBoundaryF[category] = values.boundaryF!;
  }
  const worstCriticalIoU = verified.worstCritical.iou;
  const worstCriticalBoundaryF = verified.worstCritical.boundaryF;
  if (
    worstCriticalIoU === undefined ||
    worstCriticalBoundaryF === undefined ||
    verified.summary.iou === undefined ||
    verified.summary.boundaryF === undefined
  ) {
    throw new Error(`Provider '${evidence.providerId}' has incomplete verified summaries.`);
  }
  return {
    validated: true,
    evidenceVersion: 2,
    corpusVersion: record.corpus.id,
    runtimeEnvironment: evidence.runtimeEnvironment,
    validatedAt: evidence.measuredAt,
    meanIoU: verified.summary.iou,
    meanBoundaryF: verified.summary.boundaryF,
    categoryIoU,
    categoryBoundaryF,
    criticalCategories: evidence.criticalCategories,
    worstCriticalIoU: worstCriticalIoU.value,
    worstCriticalIoUCategory: worstCriticalIoU.canonicalCategory,
    worstCriticalBoundaryF: worstCriticalBoundaryF.value,
    worstCriticalBoundaryFCategory: worstCriticalBoundaryF.canonicalCategory,
    evidenceStatus: 'verified',
  };
}

/** PackBits-style run-length encoding of a binary mask; starts with a zero run. */
export function encodeMaskRle(mask: Uint8Array): number[] {
  const runs: number[] = [];
  let current = 0;
  let count = 0;
  for (const value of mask) {
    const bit = value === 0 ? 0 : 1;
    if (bit === current) {
      count += 1;
      continue;
    }
    runs.push(count);
    current = bit;
    count = 1;
  }
  runs.push(count);
  return runs;
}

/**
 * Decode a run-length mask back into the provider alpha convention: set
 * pixels are 255, not 1. Editor validation thresholds candidate masks at 127
 * (soft alpha), so restoring 0/1 masks would silently mark every candidate
 * invalid.
 */
export function decodeMaskRle(runs: readonly number[], length: number): Uint8Array {
  const mask = new Uint8Array(length);
  let position = 0;
  let bit = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run) || run < 0) throw new Error('Invalid mask run length.');
    if (bit === 1) mask.fill(255, position, position + run);
    position += run;
    bit = bit === 0 ? 1 : 0;
  }
  if (position !== length) {
    throw new Error(`Mask run lengths sum to ${position}, expected ${length}.`);
  }
  return mask;
}
