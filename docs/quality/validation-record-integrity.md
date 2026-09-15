# Validation-record integrity

Status: **implemented** (2026-09-15). Canonical validator:
`packages/engine/src/validation/measurementRecord.ts`.

Every quality, latency, or platform claim that authorizes routing or a release
check derives from a measurement record, and that record is recomputed — not
trusted. This document is the contract. It exists because the previous
provider records declared a "worst critical category" value next to
per-category data with nothing checking the two agreed; the archived run shows
the declared EfficientSAM boundary F was 0.665 while the per-category minimum
was 0.6648, and the SAM2 worst boundary category was named from the IoU-worst
category (`touches-edge`) instead of the boundary-worst one (`hair-fur`).

## Record shape (schema version 1)

| Field | Meaning |
| --- | --- |
| `kind` | `segmentation-quality`, `detection-quality`, `latency`, `platform` |
| `corpus` | id, version, byte hash, split, prompt regime |
| `identity` | code revision, dirty flag, artifact checksums, runtime name/version/execution provider/threads/isolation, host OS/arch/browser |
| `verification` | `real-run` \| `real-model-harness` \| `mock-harness` \| `synthetic-fixture` |
| `claims` | what the record wants to authorize (topic + scope) |
| `metrics` | per metric: direction, range, aggregation, role, optional categories, tolerance |
| `requiredCategories` / `criticalCategories` | coverage contract |
| `cases` | per-case outcome + metrics + prompt regime + split |
| `declared` | summary, per-category values, worst-critical values, case counts, reliability |

## Semantics the validator enforces

- **Recomputation is authority.** Means, per-category means, counts, success
  rate, and worst values are recomputed from the cases. Declarations are
  compared against the recomputation with a per-metric tolerance (default
  `1e-9`; comparisons are on unrounded values).
- **Worst category per metric.** Higher-is-better metrics use the minimum over
  critical categories; lower-is-better metrics use the maximum. IoU and
  boundary F are never conflated. Ties are reported with a deterministic
  sorted member, and a declaration must name a member of the tied set.
- **Missing is unverified, never perfect.** A required category with no usable
  case, a metric with no values, or a critical-category declaration without
  data yields `unverified` diagnostics — not a zero-error pass.
- **Reliability denominators include failures.** `caseCounts.total` covers
  every observed case and `reliability.successRate` is `ok / total`. A
  declaration that only counts survivors mismatches.
- **Outcomes are explicit.** `no-match`, `timeout`, `oom`, `skipped`,
  `aborted`, and `failed` cases may omit quality metrics but remain in the
  record and the denominators.
- **Structural rejections.** Non-finite values, values outside the declared
  range, duplicate case ids, unknown metrics, undeclared references, and
  declared counts that disagree with the cases are `invalid` or `mismatch`.
- **Provenance classes cannot overclaim.** `mock-harness` and
  `synthetic-fixture` records cannot authorize quality or platform claims; a
  `platform: webgpu` claim must match a `webgpu` runtime identity, so a CPU
  measurement cannot be labeled GPU.
- **Split discipline.** A `held-out` corpus rejects cases from other splits.
- **Artifact identity.** When the validator is given expected checksums (the
  shipped manifest values), a record citing different bytes is invalid even if
  its arithmetic is perfect. Hashes prove byte identity, not that a benchmark
  was honest — that is what the verification class and evidence pointer are
  for.

## Routing integration

`PromptedQualityValidation` (version 2 records) carries per-category boundary F
and recomputed worst-category names. `routePromptedSelection` re-runs
`verifyPromptedQualityEvidence` at decision time:

- a record that disagrees with its own data is rejected with
  `evidence-mismatch`;
- a stale corpus, missing per-category data, or an unverified creation status
  is rejected with `unverified-evidence`;
- only then are the usability floors evaluated, and floor messages name the
  worst category for *that metric*.

The production provider records are built at module load by
`buildProviderQualityRecord` → `validateMeasurementRecord` →
`derivePromptedQualityValidation`; invalid evidence throws instead of routing.

## Primary observations vs derived reports

`packages/engine/src/segmentation/quality/evidence/provider-ab-results-2026-09-14.json`
is the archived primary observation. `providerValidation.ts` embeds the same
rows (a transcription test compares them exactly),
`providerValidation.test.ts` re-derives every summary, and
`evidence/provider-ab-artifact-identity-2026-09-15.json` records the artifact
hash verification against the shipped manifest. Corrections and repairs write
new derived reports; they never rewrite the observation in place.

## Negative tests

`measurementRecord.test.ts` covers: corrupted declarations, rounding with and
without a declared tolerance, worst-category ties and non-members, missing and
empty required categories, failed-case denominators, duplicate ids, count
mismatches, NaN and out-of-range values, artifact-hash substitution, corpus-hash
mismatch, CPU-as-GPU labeling, synthetic-as-real claims, oracle metrics
without annotation provenance, automatic metrics with no observation, macro vs
micro aggregation, and split leakage.

## Not yet covered

- Records for the real-photo ranking corpus and browser platform probes are
  declared in the plan but their evidence rows do not exist until those runs
  complete; they are absent, not green.
- The validator checks internal consistency and declared identity; it cannot
  detect a fabricated per-case table that is internally consistent. The
  provenance class, evidence pointer, and protected primary observations are
  the mechanisms against that, and review of new records is required.
