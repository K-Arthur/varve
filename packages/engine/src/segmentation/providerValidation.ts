/**
 * Measured promptable-provider validation and latency records.
 *
 * These records are the evidence `routePromptedSelection` uses to prefer one
 * feasible provider over another. They are deliberately *not* manifest
 * marketing quality numbers: every value was produced by running the shared
 * license-safe corpus in `quality/corpus.ts` through the pinned ONNX artifacts
 * with the production encode/decode functions (primary observation archived at
 * `quality/evidence/provider-ab-results-2026-09-14.json`).
 *
 * Integrity contract (G1):
 *
 * - The per-category rows below are transcribed from that archive and are the
 *   only source of the exported quality numbers.
 * - `validateMeasurementRecord` recomputes every mean, count, and worst value
 *   from those rows and compares them with the declarations built alongside
 *   them. A mismatch throws at module load: routing cannot start from
 *   contradictory evidence.
 * - Worst-category IoU and boundary F are tracked separately, so a
 *   boundary-quality claim can never cite the IoU-worst category.
 * - Artifact identities are the SHA-256 values the shipped manifest pins; the
 *   archived run used byte-identical files (verified 2026-09-15).
 *
 * Changing any number here changes production routing. Re-run the A/B harness,
 * replace the archive, and update `MEASURED_AT` / `MEASUREMENT_REVISION` in the
 * same commit, or the record is invalid.
 */

import { validateMeasurementRecord } from '../validation/measurementRecord';
import type { PromptedProviderCapabilities, PromptedQualityValidation } from './promptedRouting';
import {
  EFFICIENT_SAM_PROVIDER_ID,
  MOBILE_SAM_PROVIDER_ID,
  PROMPTED_CRITICAL_CATEGORIES,
  PROMPTED_QUALITY_CORPUS_VERSION,
  SAM2_PROVIDER_ID,
} from './promptedRouting';
import {
  buildProviderQualityRecord,
  derivePromptedQualityValidation,
  type ProviderAbEvidence,
  type ProviderCategoryMeasurement,
} from './quality/evidenceRecord';

export const PROMPTED_SELECTION_CORPUS_VERSION = PROMPTED_QUALITY_CORPUS_VERSION;

/** Environment string recorded with every synthetic-corpus measurement below. */
export const PROMPTED_VALIDATION_ENVIRONMENT =
  'onnxruntime-node 1.27.0 · CPU execution provider · Linux x86_64 · 128x128 corpus fixtures · 1024x1024 encoder input';

/** Revision and timestamp of the archived A/B observation. */
const MEASUREMENT_REVISION = '075bdcfe1';
const MEASURED_AT = '2026-09-15T00:50:02.545Z';

/**
 * Critical categories are the classes where a single bad mask is a product
 * failure — thin geometry, tiny objects, edge-touching subjects, and hair/fur —
 * and where users report "it selected the wrong thing" even when average
 * metrics look fine. Average IoU cannot hide a failure in these.
 */
export { PROMPTED_CRITICAL_CATEGORIES };

/** Shipped artifact identities the archived run's files matched byte-for-byte. */
export const PROMPTED_MEASURED_ARTIFACT_CHECKSUMS = {
  [SAM2_PROVIDER_ID]: {
    encoder: 'b4cfd6c8bec2ef3674536419d731e61d15840367bd004d65095ae6a2b88b41cf',
    decoder: 'f5a4bd656c143899fb7f52d64ed81e6f6aeb37d477a0b6da50146ac7cf2187bf',
  },
  [MOBILE_SAM_PROVIDER_ID]: {
    encoder: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749',
    decoder: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe',
  },
  [EFFICIENT_SAM_PROVIDER_ID]: {
    encoder: '84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951',
    decoder: 'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11',
  },
} as const;

const PROVIDER_LABELS: Record<string, string> = {
  [SAM2_PROVIDER_ID]: 'SAM2 Hiera Tiny',
  [MOBILE_SAM_PROVIDER_ID]: 'MobileSAM',
  [EFFICIENT_SAM_PROVIDER_ID]: 'EfficientSAM-Ti',
};

/** Per-category rows archived from the 2026-09-14 A/B harness run. */
export const MEASURED_CATEGORY_ROWS: Readonly<
  Record<string, readonly ProviderCategoryMeasurement[]>
> = {
  'sam2-hiera-tiny': [
    {
      category: 'plain-background',
      iou: 0.9944367176634215,
      boundaryF: 1,
      bestAvailableIou: 0.9944367176634215,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'hair-fur',
      iou: 0.9097502014504432,
      boundaryF: 0.6766450615085622,
      bestAvailableIou: 0.9221693231215069,
      regret: 0.012419121671063738,
      rankingMatch: 0,
    },
    {
      category: 'thin-geometry',
      iou: 0.993421052631579,
      boundaryF: 1,
      bestAvailableIou: 0.993421052631579,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'overlapping',
      iou: 0.620589375727026,
      boundaryF: 0.5970449966420416,
      bestAvailableIou: 0.7034682080924856,
      regret: 0.08287883236545956,
      rankingMatch: 0,
    },
    {
      category: 'tiny-object',
      iou: 0.8711340206185567,
      boundaryF: 1,
      bestAvailableIou: 0.8711340206185567,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'touches-edge',
      iou: 0.5515751575157516,
      boundaryF: 0.6928104575163399,
      bestAvailableIou: 0.9467146714671467,
      regret: 0.3951395139513951,
      rankingMatch: 0,
    },
    {
      category: 'low-contrast',
      iou: 0.9856573705179282,
      boundaryF: 1,
      bestAvailableIou: 0.9856573705179282,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'glass-translucency',
      iou: 0.2222427262102479,
      boundaryF: 0,
      bestAvailableIou: 0.2534036012296882,
      regret: 0.031160875019440287,
      rankingMatch: 0,
    },
    {
      category: 'multiple-similar',
      iou: 0.38873178159669347,
      boundaryF: 0.3535353535353535,
      bestAvailableIou: 0.5259285213735109,
      regret: 0.1371967397768174,
      rankingMatch: 0,
    },
    {
      category: 'foliage',
      iou: 0,
      boundaryF: 0.2151281648057871,
      bestAvailableIou: 0.008171912832929782,
      regret: 0.008171912832929782,
      rankingMatch: 0,
    },
  ],
  'mobile-sam': [
    {
      category: 'plain-background',
      iou: 0.9886567164179104,
      boundaryF: 1,
      bestAvailableIou: 0.9956218905472637,
      regret: 0.006965174129353269,
      rankingMatch: 0,
    },
    {
      category: 'hair-fur',
      iou: 0.9271754782966468,
      boundaryF: 0.7341115434500648,
      bestAvailableIou: 0.9306334371754933,
      regret: 0.003457958878846479,
      rankingMatch: 0,
    },
    {
      category: 'thin-geometry',
      iou: 0.9921664626682987,
      boundaryF: 1,
      bestAvailableIou: 0.9975520195838433,
      regret: 0.005385556915544654,
      rankingMatch: 0,
    },
    {
      category: 'overlapping',
      iou: 0.6219797349961029,
      boundaryF: 0.5970449966420416,
      bestAvailableIou: 0.6219797349961029,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'tiny-object',
      iou: 1,
      boundaryF: 1,
      bestAvailableIou: 1,
      regret: 0,
      rankingMatch: 0,
    },
    {
      category: 'touches-edge',
      iou: 0.5494149414941494,
      boundaryF: 0.6928104575163399,
      bestAvailableIou: 0.8162960752126548,
      regret: 0.2668811337185054,
      rankingMatch: 0,
    },
    {
      category: 'low-contrast',
      iou: 0.9630959505286256,
      boundaryF: 1,
      bestAvailableIou: 0.985836824256932,
      regret: 0.022740873728306354,
      rankingMatch: 0,
    },
    {
      category: 'glass-translucency',
      iou: 0.22052001953125,
      boundaryF: 0,
      bestAvailableIou: 0.22062774792379092,
      regret: 0.00010772839254091782,
      rankingMatch: 0,
    },
    {
      category: 'multiple-similar',
      iou: 0.38836649901596326,
      boundaryF: 0.35714285714285715,
      bestAvailableIou: 0.38836649901596326,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'foliage',
      iou: 0.8226164079822617,
      boundaryF: 0.7597237368229734,
      bestAvailableIou: 0.9464285714285714,
      regret: 0.12381216344630974,
      rankingMatch: 0,
    },
  ],
  'efficient-sam-ti': [
    {
      category: 'plain-background',
      iou: 0.9807844690966719,
      boundaryF: 1,
      bestAvailableIou: 0.9807844690966719,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'hair-fur',
      iou: 0.9094583670169766,
      boundaryF: 0.6648199445983379,
      bestAvailableIou: 0.9321962518424931,
      regret: 0.02273788482551653,
      rankingMatch: 0,
    },
    {
      category: 'thin-geometry',
      iou: 0.9785575048732943,
      boundaryF: 1,
      bestAvailableIou: 0.9785575048732943,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'overlapping',
      iou: 0.6107772824190735,
      boundaryF: 0.5943396226415094,
      bestAvailableIou: 0.6107772824190735,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'tiny-object',
      iou: 0.8756476683937824,
      boundaryF: 1,
      bestAvailableIou: 0.9230769230769231,
      regret: 0.04742925468314074,
      rankingMatch: 0,
    },
    {
      category: 'touches-edge',
      iou: 0.55098003956123,
      boundaryF: 0.6928104575163399,
      bestAvailableIou: 0.8964654884961654,
      regret: 0.3454854489349354,
      rankingMatch: 0,
    },
    {
      category: 'low-contrast',
      iou: 0.9781094527363184,
      boundaryF: 1,
      bestAvailableIou: 0.9781094527363184,
      regret: 0,
      rankingMatch: 1,
    },
    {
      category: 'glass-translucency',
      iou: 0.22225639763779528,
      boundaryF: 0,
      bestAvailableIou: 0.2225027712772509,
      regret: 0.0002463736394556215,
      rankingMatch: 0,
    },
    {
      category: 'multiple-similar',
      iou: 0.3883282141290039,
      boundaryF: 0.3536404160475483,
      bestAvailableIou: 0.39155555555555555,
      regret: 0.003227341426551622,
      rankingMatch: 0,
    },
    {
      category: 'foliage',
      iou: 0.7317554240631163,
      boundaryF: 0.5813884785819793,
      bestAvailableIou: 0.8390804597701149,
      regret: 0.10732503570699858,
      rankingMatch: 0,
    },
  ],
};

function evidenceFor(providerId: string): ProviderAbEvidence {
  const rows = MEASURED_CATEGORY_ROWS[providerId];
  if (!rows) throw new Error(`No archived A/B rows for provider '${providerId}'.`);
  const checksums =
    PROMPTED_MEASURED_ARTIFACT_CHECKSUMS[
      providerId as keyof typeof PROMPTED_MEASURED_ARTIFACT_CHECKSUMS
    ];
  if (!checksums) throw new Error(`No pinned artifact identity for provider '${providerId}'.`);
  return {
    providerId,
    label: PROVIDER_LABELS[providerId] ?? providerId,
    runtimeEnvironment: PROMPTED_VALIDATION_ENVIRONMENT,
    measuredAt: MEASURED_AT,
    codeRevision: MEASUREMENT_REVISION,
    artifactChecksums: { ...checksums },
    requiredCategories: rows.map((row) => row.category),
    criticalCategories: [...PROMPTED_CRITICAL_CATEGORIES],
    rows,
  };
}

/**
 * Build and verify one provider record. Throwing here is deliberate: a build
 * whose routing evidence contradicts itself has to fail visibly, not route on
 * a declared number.
 */
function verifiedValidationFor(providerId: string): PromptedQualityValidation {
  const evidence = evidenceFor(providerId);
  const record = buildProviderQualityRecord(evidence);
  const verified = validateMeasurementRecord(record);
  if (verified.status !== 'verified') {
    const detail = verified.diagnostics
      .map((diagnostic) => `${diagnostic.code}@${diagnostic.field}`)
      .join(', ');
    throw new Error(
      `Archived A/B evidence for '${providerId}' failed validation (${verified.status}): ${detail}`,
    );
  }
  return derivePromptedQualityValidation(evidence, record, verified);
}

export const SAM2_QUALITY_VALIDATION: PromptedQualityValidation =
  verifiedValidationFor(SAM2_PROVIDER_ID);
export const MOBILE_SAM_QUALITY_VALIDATION: PromptedQualityValidation =
  verifiedValidationFor(MOBILE_SAM_PROVIDER_ID);
export const EFFICIENT_SAM_QUALITY_VALIDATION: PromptedQualityValidation =
  verifiedValidationFor(EFFICIENT_SAM_PROVIDER_ID);

/** Measured per-category IoU from the A/B harness. */
export const SAM2_MEASURED_CATEGORY_IOU: Readonly<Record<string, number>> =
  SAM2_QUALITY_VALIDATION.categoryIoU;
export const MOBILE_SAM_MEASURED_CATEGORY_IOU: Readonly<Record<string, number>> =
  MOBILE_SAM_QUALITY_VALIDATION.categoryIoU;

/**
 * EfficientSAM-Ti measured record from the 2026-09-14 A/B run. The provider is
 * experimental and never eligible for automatic routing; the numbers only gate
 * an explicit, informed selection.
 */
export const EFFICIENT_SAM_MEASURED_CATEGORY_IOU: Readonly<Record<string, number>> =
  EFFICIENT_SAM_QUALITY_VALIDATION.categoryIoU;

/** Per-category boundary F for every measured provider. */
export const SAM2_MEASURED_CATEGORY_BOUNDARY_F: Readonly<Record<string, number>> =
  SAM2_QUALITY_VALIDATION.categoryBoundaryF ?? {};
export const MOBILE_SAM_MEASURED_CATEGORY_BOUNDARY_F: Readonly<Record<string, number>> =
  MOBILE_SAM_QUALITY_VALIDATION.categoryBoundaryF ?? {};
export const EFFICIENT_SAM_MEASURED_CATEGORY_BOUNDARY_F: Readonly<Record<string, number>> =
  EFFICIENT_SAM_QUALITY_VALIDATION.categoryBoundaryF ?? {};

export const MOBILE_SAM_CAPABILITIES: PromptedProviderCapabilities = {
  pointPrompts: true,
  boxPrompts: true,
  maskPrompts: true,
  multipleCandidates: true,
};

export const SAM2_CAPABILITIES: PromptedProviderCapabilities = {
  pointPrompts: true,
  boxPrompts: true,
  maskPrompts: true,
  multipleCandidates: true,
};

/**
 * EfficientSAM-Ti's official split decoder has no mask-input tensor, so it
 * cannot satisfy a mask prompt or a refinement round-trip. Keeping that gap in
 * the capability record makes the router reject mask-prompt requests instead
 * of silently feeding an incompatible tensor.
 */
export const EFFICIENT_SAM_CAPABILITIES: PromptedProviderCapabilities = {
  pointPrompts: true,
  boxPrompts: true,
  maskPrompts: false,
  multipleCandidates: true,
};

/**
 * Warm prompt p95 proxies measured on the same Node CPU run (decoder only,
 * embedding resident). The real Chromium gate exercises the WASM worker and
 * visual commit path, but it does not yet provide a controlled browser timing
 * corpus; consumers must present these as estimated relative orderings, not
 * as absolute browser latencies.
 */
export const PROMPTED_PROVIDER_LATENCY_PROXY: Readonly<
  Record<string, { p50Ms: number; p95Ms: number; source: 'estimated' | 'measured' }>
> = {
  [SAM2_PROVIDER_ID]: { p50Ms: 496, p95Ms: 1068, source: 'estimated' },
  [MOBILE_SAM_PROVIDER_ID]: { p50Ms: 326, p95Ms: 485, source: 'estimated' },
  // Isolated Node CPU run in the EfficientSAM A/B: 548 ms cold load and
  // 2 900 ms encode+decode at 1280x853. Peak working set measured higher than
  // MobileSAM, which is why this provider is explicit-only.
  [EFFICIENT_SAM_PROVIDER_ID]: { p50Ms: 900, p95Ms: 2900, source: 'estimated' },
};

/**
 * Convenience accessor for editors wiring provider facts. Returns `undefined`
 * when the provider has no measured record, which keeps it out of automatic
 * routing by design.
 */
export function measuredQualityValidation(
  providerId: string,
): PromptedQualityValidation | undefined {
  if (providerId === SAM2_PROVIDER_ID) return SAM2_QUALITY_VALIDATION;
  if (providerId === MOBILE_SAM_PROVIDER_ID) return MOBILE_SAM_QUALITY_VALIDATION;
  if (providerId === EFFICIENT_SAM_PROVIDER_ID) return EFFICIENT_SAM_QUALITY_VALIDATION;
  return undefined;
}

export function measuredCapabilities(providerId: string): PromptedProviderCapabilities | undefined {
  if (providerId === SAM2_PROVIDER_ID) return SAM2_CAPABILITIES;
  if (providerId === MOBILE_SAM_PROVIDER_ID) return MOBILE_SAM_CAPABILITIES;
  if (providerId === EFFICIENT_SAM_PROVIDER_ID) return EFFICIENT_SAM_CAPABILITIES;
  return undefined;
}
