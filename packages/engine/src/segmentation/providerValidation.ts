/**
 * Measured promptable-provider validation and latency records.
 *
 * These records are the evidence `routePromptedSelection` uses to prefer one
 * feasible provider over another. They are deliberately *not* manifest
 * marketing quality numbers: every value was measured by running the shared
 * license-safe corpus in `packages/engine/src/segmentation/quality/corpus.ts`
 * through the pinned ONNX artifacts with the production encode/decode
 * functions (see `quality/providerAb.test.ts` and
 * `docs/quality/object-selection-parity.md`). The real-photo Chromium gate is
 * recorded separately because a small visual scenario proves artifact and
 * lifecycle execution, not corpus-wide quality.
 *
 * Changing a number here changes production routing. Re-run the A/B harness
 * and update `runtimeEnvironment`, `validatedAt`, and the corpus version in
 * the same commit, or the record is invalid.
 */

import type { PromptedProviderCapabilities, PromptedQualityValidation } from './promptedRouting';
import { MOBILE_SAM_PROVIDER_ID, SAM2_PROVIDER_ID } from './promptedRouting';

export const PROMPTED_SELECTION_CORPUS_VERSION = 'object-selection-corpus-v1';

/** Environment string recorded with every synthetic-corpus measurement below. */
export const PROMPTED_VALIDATION_ENVIRONMENT =
  'onnxruntime-node 1.27.0 · CPU execution provider · Linux x86_64 · 128x128 corpus fixtures · 1024x1024 encoder input';

const VALIDATED_AT = '2026-09-14T00:00:00.000Z';

/**
 * Critical categories are the classes where a single bad mask is a product
 * failure — thin geometry, tiny objects, edge-touching subjects, and hair/fur —
 * and where users report "it selected the wrong thing" even when average
 * metrics look fine. Average IoU cannot hide a failure in these.
 */
export const PROMPTED_CRITICAL_CATEGORIES = [
  'thin-geometry',
  'tiny-object',
  'touches-edge',
  'hair-fur',
] as const;

/** Measured per-category IoU from the A/B harness. */
export const SAM2_MEASURED_CATEGORY_IOU: Readonly<Record<string, number>> = {
  'plain-background': 0.9944,
  'hair-fur': 0.9098,
  'thin-geometry': 0.9934,
  overlapping: 0.6206,
  'tiny-object': 0.8711,
  'touches-edge': 0.5516,
  'low-contrast': 0.9857,
  'glass-translucency': 0.2222,
  'multiple-similar': 0.3887,
  foliage: 0,
};

export const MOBILE_SAM_MEASURED_CATEGORY_IOU: Readonly<Record<string, number>> = {
  'plain-background': 0.9887,
  'hair-fur': 0.9272,
  'thin-geometry': 0.9922,
  overlapping: 0.622,
  'tiny-object': 1,
  'touches-edge': 0.5494,
  'low-contrast': 0.9631,
  'glass-translucency': 0.2205,
  'multiple-similar': 0.3884,
  foliage: 0.8226,
};

export const SAM2_QUALITY_VALIDATION: PromptedQualityValidation = {
  validated: true,
  corpusVersion: PROMPTED_SELECTION_CORPUS_VERSION,
  runtimeEnvironment: PROMPTED_VALIDATION_ENVIRONMENT,
  validatedAt: VALIDATED_AT,
  meanIoU: 0.6538,
  meanBoundaryF: 0.6535,
  categoryIoU: SAM2_MEASURED_CATEGORY_IOU,
  criticalCategories: PROMPTED_CRITICAL_CATEGORIES,
  worstCriticalIoU: 0.5516,
  worstCriticalBoundaryF: 0.6772,
};

export const MOBILE_SAM_QUALITY_VALIDATION: PromptedQualityValidation = {
  validated: true,
  corpusVersion: PROMPTED_SELECTION_CORPUS_VERSION,
  runtimeEnvironment: PROMPTED_VALIDATION_ENVIRONMENT,
  validatedAt: VALIDATED_AT,
  meanIoU: 0.7474,
  meanBoundaryF: 0.7141,
  categoryIoU: MOBILE_SAM_MEASURED_CATEGORY_IOU,
  criticalCategories: PROMPTED_CRITICAL_CATEGORIES,
  worstCriticalIoU: 0.5494,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: measured boundary F-score
  worstCriticalBoundaryF: 0.693,
};

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
  return undefined;
}

export function measuredCapabilities(providerId: string): PromptedProviderCapabilities | undefined {
  if (providerId === SAM2_PROVIDER_ID) return SAM2_CAPABILITIES;
  if (providerId === MOBILE_SAM_PROVIDER_ID) return MOBILE_SAM_CAPABILITIES;
  return undefined;
}
