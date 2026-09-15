# Segmentation hardening audit — ranking, discovery performance, memory handoffs, validation integrity

Date: 2026-09-15. Base revision at start: `ce7b2eca6`.
Owner record: `docs/agents/segmentation-hardening-2026-09-15-ownership.md`.
Plan: `docs/plans/segmentation-hardening-2026-09-15.md`.

This ledger records what was changed, what was measured, and what remains
unverified. It separates verified facts from plan statements; anything not
listed as verified below was not executed.

## Commits

| Commit | Scope |
| --- | --- |
| `4f62dda47` | Refcounted session registry, honest release accounting, worker release protocol, host handoff API, SessionManager lifecycle, discovery panel stage timing/release wiring |
| `c05c28525` | Measurement-record validator integration, provider records derived from the archived A/B observation, per-metric worst categories, candidate-ranking features/policies/evaluation, platform evidence matrix, experimental boundary tests, Grounding DINO model-resolution preprocessing |
| `3782a611c` | Editor ranker policy hook, frozen-set evaluation module, keyboard candidate cycling |
| `194e6222f` | Canonical measurement-record validator (schema, aggregation, negative tests) |
| `080b58d88` (concurrent writer swept the first docs draft) | Ownership record and plan landed inside another agent's commit; content intact |
| docs commit (`docs(selection): record validation integrity…`) | `docs/quality/validation-record-integrity.md`, `docs/quality/candidate-ranking-evaluation.md`, current-state updates |

## G1 — Validation integrity

**Implemented.** `packages/engine/src/validation/measurementRecord.ts` is the
single validator/aggregator; `providerValidation.ts` derives every routing
number from per-category rows through it; `promptedRouting.ts` re-verifies
version-2 records at decision time and rejects `evidence-mismatch` /
`unverified-evidence`.

Verified corrections from the archived run:

| Provider | Declared (old) | Recomputed from per-category data |
| --- | --- | --- |
| SAM2 worst boundary F | 0.6772, category *not tracked* | 0.6766450615085622, category `hair-fur` |
| SAM2 worst IoU category named for boundary messages | `touches-edge` (IoU-worst) | `hair-fur` (boundary-worst) |
| EfficientSAM worst boundary F | 0.665 (rounded, no per-category data) | 0.6648199445983379 |
| EfficientSAM mean IoU | 0.723 | 0.7227154235532791 |

Negative tests: see `docs/quality/validation-record-integrity.md` and
`measurementRecord.test.ts` (15 tests).

Commands:

```text
pnpm exec vitest run packages/engine/src/validation/measurementRecord.test.ts          → 15 passed
pnpm exec vitest run packages/engine/src/segmentation/providerValidation.test.ts       → 7 passed
pnpm exec vitest run packages/engine/src/segmentation/promptedRouting.test.ts          → 21 passed
```

## G2 — Candidate ranking

**Measured baseline (archived A/B run, 2026-09-14, real artifacts):** the
provider's own top candidate matched the oracle-best candidate in 40% of SAM2
cases, 20% of MobileSAM cases, and 40% of EfficientSAM cases; mean IoU regret
was 0.0667 / 0.0429 / 0.0526. This is a *provider selection* measurement, not
the editor ranker.

**Implemented:** bounded per-candidate features (prompt coverage, box support,
topology, edge contact), three declared ordering policies plus the existing
default, and a frozen-set evaluator that replays sets through the real ranker
with top-1/oracle/regret/top-k/click metrics and per-category tails.

**Verified mechanics:** `candidateRanking.test.ts` (14 tests) and
`promptedRankingEvaluation.test.ts` (4 tests) including a part-vs-whole case
where the default selects a 0.6-IoU mask and `guarded-band-box` selects the
0.9-IoU one without dropping coverage. Order/selection agreement with the real
ranker is asserted per policy.

**Pending:** the real-model frozen corpus. The harness extension exists
(`providerAb.test.ts` now emits RLE candidate masks, scores, oracle IoU,
features, policy evaluations, and validator-checked records), but the bounded
run could not execute on this machine state: `/tmp` was a 12 GB tmpfs at 98%
and system RAM had 0–2 GB available with other agents' Playwright/model jobs
active; the harness peaks at ~3.1 GB RSS (EfficientSAM).

```bash
VARVE_SAM2_REAL_MODEL_DIR=/tmp/opencode/sam2 \
VARVE_MOBILE_SAM_MODEL_DIR=/tmp/opencode/acly \
VARVE_EFFICIENT_SAM_MODEL_DIR=/tmp/opencode/efficientsam \
  pnpm exec vitest run packages/engine/src/segmentation/quality/providerAb.test.ts
```

No default ranking change was made, so no ranking-quality claim is made.

## G3 — Memory handoff

**Implemented and unit-verified:**

- `InferenceSessionRegistry`: single-flight creation (concurrent duplicate gets
  create one session), refcounted runs, release-before-remove, failed releases
  kept as `unresolvedBytes`, idle-only eviction.
- Worker protocol: `release` request → `released` report with
  `{released, failed, inUse, possiblyResidentBytes, remaining, snapshot}`;
  stage timings for session/preprocess/infer/postprocess.
- Host: `releaseModels` / `releaseModel` / `getResidencyDiagnostics` /
  `recycleWorkerIfIdle` (refuses while work is in flight); unresolved residency
  is added to the next inference reservation until a recycle clears it.
- `SessionManager` (exported API with no production callers) received the same
  single-flight and honest-release fixes.
- Discovery panel: after detections are materialized it calls
  `releaseModel('grounding-dino', graphPath)`, reports the outcome, attempts an
  idle-worker recycle on failure, and reuses an in-session detection cache for
  identical query/source/threshold searches.

Commands: `sessionRegistry.test.ts` 6 passed, `workerHostMessages.test.ts`
6 passed (including release correlation, unresolved accounting, idle-only
recycle), `SessionManager.test.ts` 6 passed.

**Pending measurement:** the timestamped transition peak (detector session vs
segmenter session) cannot be captured until a real-model browser run is
possible. The ordering and accounting contracts are tested; the byte-level
peak improvement is not measured here.

## G4 — Platform evidence

`packages/engine/src/inference/platformEvidence.ts` records exact cells.
Reconciled facts:

- The editor worker pins `ort.env.wasm.numThreads = 1`; verified by
  `ortRuntimeAssets.test.ts` (4 tests). Cross-origin isolation raises the
  admission budget only. **Threaded WASM for Grounding DINO is unverified, not
  “working”.**
- Grounding DINO WebGPU is **unsupported**: four of five feeds are int64 and
  the catalog declares WASM only.
- SAM2 WebGPU is **unverified**: the manifest allows it, but no run has
  captured node assignment or compared outputs with the CPU reference.
- Verified cells cite their evidence pointer; `matrixIntegrityProblems()`
  rejects a verified cell without evidence (`platformEvidence.test.ts`, 4
  tests).

## G5 — Discovery performance and UX

**Implemented:** measured stage timings from the worker (session load,
preprocess, inference, postprocess) plus source load and release wall time in
the panel; warm/cold labeled; detector release after detection; identical
search caching; the browser preprocessing path now draws directly to the
800×800 model canvas (`preprocessGroundingDinoModelImage`), replacing a
full-resolution `getImageData` copy plus a JS nearest-neighbour resize for a
24 MP photo with a 2.6 MB read and browser smoothing. The v1 Node path is
unchanged; the cache key includes the preprocessing identity.

**Pending:** browser detection parity for the new preprocessing path (one
bounded Playwright run with the real detector) and a measured before/after
latency comparison. No interactive-speed claim is made.

## G6 — Experimental boundaries

`experimentalPolicy.test.ts` (8 tests) verifies across `auto`, `fast`,
`balanced`, `quality`, capability-filtered requests, over-budget requests,
unsupported-runtime requests, and the explicit-selection path that:

- MobileSAM and EfficientSAM-Ti are never selected automatically;
- the opt-in flag only applies to the explicitly requested provider;
- when the validated provider cannot run, the router refuses instead of falling
  back to an experimental provider;
- text discovery is refused by the resource assessment below its 2.6 GB
  reservation and is explicit-download only;
- the WASM fallback for the detector fails the default budget gate.

## Visual/E2E validation

| Run | Result |
| --- | --- |
| `tests/e2e/canvas/object-selection.spec.ts` (port 1601, COOP/COEP, no model) | **3 passed, 1 failed.** Passed: promptable surface usable without a model; draft box and pointer path; clean-install messaging. Failed: the `deviceMemory = 2` low-memory case asserted a budget-refusal message that cannot appear when cross-origin isolation raises the budget to 1.5 GB — the run configuration was wrong for that test, not the product. |
| `…object-selection.spec.ts -g "keeps a real photo usable when the browser reports 2 GB"` (port 1602, no isolation, correct config) | **Failed: browser target crashed** (`Target crashed` at `boundingBox`) under host memory pressure (≈2 GB available, other agents' Chromium/model jobs active). The same assertion had previously failed cleanly on the budget message, so this was an environment crash, not a reproduced product defect. |
| `tests/e2e/canvas/object-selection-mobile-real-model.spec.ts` (port 1603, isolation, MobileSAM artifacts staged in the gitignored models dir) | see the final Agent Validation Report |
| `tests/e2e/canvas/object-selection-real-model.spec.ts` with `VARVE_SAM2_REAL_MODEL=1` | not attempted: the SAM2 browser gate needs the same host capacity and the MobileSAM gate exercises the same candidate-review path with a smaller model |
| `tests/e2e/canvas/inference-platform-probe.spec.ts` (new) | see the final Agent Validation Report |
| `tests/e2e/canvas/text-discovery.spec.ts` with `VARVE_TEXT_DISCOVERY_REAL_MODEL=1` | not attempted; the prior session recorded the engine Node gate as authoritative and the browser gate as incomplete (no console error, no completion in 15 minutes) |

## Resource notes

During this session `/tmp` (12 GB tmpfs) reached 98% and turned Vitest runs
into `ENOSPC` failures. Ten stale scratch directories from 2026-09-12 were
removed (~1.5 GB). No repository artifact, evidence directory, or model file
was deleted.
