# Segmentation hardening plan — ranking, discovery performance, memory handoffs, validation integrity

Status: **active** (2026-09-15). Owner: segmentation-hardening session
(`docs/agents/segmentation-hardening-2026-09-15-ownership.md`).
Base HEAD: `ce7b2eca6`.

This is a follow-on hardening pass over shipped Object Selection, text
discovery, and the shared inference worker. It does not rebuild the features
and does not create a parallel inference manager.

## 1. Reconciled baseline (verified in this checkout, 2026-09-15)

| # | Verified fact | Where |
|---|---|---|
| 1 | `onnxruntime-web@1.27.0` is installed; its WASM heap cannot shrink and `session.release()` does not return heap capacity to the OS (upstream #21673) | `node_modules/.pnpm/onnxruntime-web@1.27.0`; research ledger §2/§6/§8 |
| 2 | The production session owner is `inferenceWorker.ts` `sessionCache` (cap 3), not `SessionManager` (exported but has no production callers) | grep: `SessionManager` used only by its test + `index.ts` export |
| 3 | `sessionCache` has no release message, no single-flight creation, and no use/eviction refcounts; eviction awaits `release()` then deletes and swallows failures, so cache removal is treated as reclaimed memory | `inferenceWorker.ts:553-644` |
| 4 | `SessionManager.release()` deletes the cache entry **before** awaiting `session.release()` and swallows errors | `SessionManager.ts:156-168` |
| 5 | Worker ORT runtime is pinned to `numThreads = 1`; `crossOriginIsolated` only raises the admission budget (1.2 GB → 3.0 GB on an 8 GB tier), it does not enable threads | `ortRuntimeAssets.ts:28-31`, `RuntimeCapabilities.ts:84-92` |
| 6 | Grounding DINO Tiny INT8 manifest is WASM-only, `peakMemoryBytes: 2_600_000_000` (measured 2.4 GB browser WASM + headroom); ~42 s single-threaded forward pass | `modelCatalog.ts:762-811`, `text-discovery-system.md` |
| 7 | After discovery, decoded detections live in React state and the detector session stays cached; nothing releases it before segmentation | `TextDiscoveryPanel.tsx:212-266` |
| 8 | The discovery panel shows a countdown and three guessed stage labels, not measured stage timings | `TextDiscoveryPanel.tsx:62-85, 371-385` |
| 9 | Candidate ranking is a validity filter + max provider score with a refinement preference; there is no ranking evaluation harness, no oracle/regret metrics | `promptedMaskValidation.ts:316-358` |
| 10 | Routing reasons pick the worst category from **IoU only** and use it for boundary-F reasons too | `promptedRouting.ts:469-495` |
| 11 | `EFFICIENT_SAM_QUALITY_VALIDATION.worstCriticalBoundaryF` is a manually entered value with no per-category boundary-F data behind it | `providerValidation.ts:144-157` |
| 12 | Real photographs (`tests/e2e/fixtures/real-life-*.jpg`) and the pinned model artifacts (`sam2_hiera_tiny.*`, `mobile_sam` split, `grounding-dino/model_int8.onnx`) exist locally, so real-model evaluation is feasible without downloads | filesystem, 2026-09-15 |

## 2. Research decisions (2026-09-15; full ledger in the audit doc)

| Decision | Basis |
|---|---|
| Do not plan around `initialMemory`/`maximumMemory`; they do not exist in 1.27.0 | installed `.d.ts` + dist grep |
| Treat `session.release()` as freeing *logical* session resources, never as returning wasm capacity to the OS | upstream #21673; MDN `Memory.grow` (cannot shrink, views detach) |
| Keep worker `numThreads = 1` as the proven default; expose the actual thread count and keep threaded status unverified until a probe passes | `ortRuntimeAssets.ts` deadlock history; ORT threading requires crossOriginIsolated |
| `navigator.deviceMemory` is a coarse tier hint, never current free memory | MDN; existing `estimateWasmSafePeakBytes` use |
| Grounding DINO WebGPU stays explicitly unsupported/unverified: four of five feeds are int64 and ORT-web's WebGPU int64 kernel coverage is narrow | `text-discovery-system.md`; ORT operator table |
| A failed/indeterminate release must keep conservative accounting and may only recycle an exclusively-owned idle worker | upstream behavior + shared-host constraint |
| Ranking improvements must be justified by frozen candidate-set metrics before defaults change | evaluation-integrity requirements |

## 3. Milestones (dependency order)

### M1 — Validation-record integrity (G1)
- New `packages/engine/src/validation/` module: versioned measurement record
  (cases, categories, outcomes, metrics, identities, provenance class),
  canonical validator/aggregator, declared-vs-recomputed diagnostics,
  per-metric worst-category rules (min for higher-is-better), tie handling,
  tolerance, coverage/denominator checks, reliability denominators including
  failed/skipped cases.
- `providerValidation.ts` declarations become derived from per-category data;
  `promptedRouting.ts` consumes only verified summaries and names the
  worst category per metric. Fixes fact #10 and #11.
- Negative tests: corrupted declarations, rounding, ties, missing categories,
  duplicate case ids, invalid counts, hash substitution, cpu-as-gpu labeling,
  oracle/top-1 confusion, mock/synthetic records presented as real runs.

### M2 — Detection→segmentation memory handoff (G3)
- Worker protocol: `release` request → `released` report with
  `{ released, failed, inUse, possiblyResidentBytes }`; refcounted runs;
  single-flight session creation; sessions marked `releaseFailed` keep
  conservative accounting.
- Host: `releaseModels()`, `getResidencySnapshot()`, and idle-only
  `recycleWorker()` (never terminates the shared host with work in flight).
- Discovery panel: materialize compact detections → release detector → review →
  segmentation admission under a new decision that includes unresolved
  residency; bounded detection-result cache keyed by source revision + query +
  thresholds so re-review does not rerun inference.
- Tests: concurrent gets create one session; in-use sessions refuse release;
  failed release retains accounting; segmentation admission sees the handoff;
  no release of unrelated jobs.

### M3 — Candidate ranking (G2)
- `promptedRankingEvaluation.ts`: frozen candidate sets, per-case metrics
  (automatic top-1, oracle best-available, regret, top-k acceptable recall,
  clicks/cycles) with per-category tails and sample counts.
- Real-photo candidate sets generated once with the pinned models via the real
  model gates, then frozen for ranker isolation; acceptable/best candidates
  annotated by inspecting contact sheets.
- Change ranking defaults only if held-out top-1 improves or regret drops
  without coverage loss; otherwise keep the baseline and publish residual
  failures per category.

### M4 — Discovery performance and UX (G5)
- Surface measured stage timings (session load vs inference vs preprocess vs
  decode) from the worker and panel; warm/cold labels from the session cache.
- Coalesce identical pending queries; cancel superseded ones; never rerun
  discovery on rank-order change or detection selection.
- Validate a preprocessing optimization only if real-photo detection parity
  holds; otherwise keep the current path and record the result.
- No interactive-speed claims; the 8-minute soft deadline and point/box
  fallback stay.

### M5 — Platform evidence (G4)
- `platformEvidence.ts` matrix with explicit `verified | unverified |
  unsupported` cells and evidence pointers for Grounding DINO/WebGPU,
  threaded WASM, MobileSAM, and the segmentation providers.
- Browser probe spec records isolation, actual thread configuration, adapter
  presence, and (when present) a small WebGPU session outcome without
  promoting unverified cells.

### M6 — Experimental boundaries and integration (G6)
- Regression tests: MobileSAM explicit-only on every Auto/fallback/retry path;
  text discovery optional and memory-gated before download; experimental
  outputs excluded from release claims.
- Docs + website copy updated only from measured evidence; final acceptance
  report with G1–G6 status, exact commands, and unverified platforms retained.

## 4. Validation plan

- Per slice: `pnpm verify:plan` → `pnpm verify:affected`; focused vitest for
  changed engine/editor modules.
- Real-model gates (Node, env-gated): Grounding DINO real model; SAM2/MobileSAM
  real model where ranking evidence is generated.
- Browser: isolated Playwright ports, `VARVE_E2E_WORKERS=1`, heavy-task lease;
  screenshots inspected (not just generated).
- No full gate unless the planner escalates or a checkpoint requires it; every
  deviation recorded in the final report.

## 5. Resource schedule

Heavy model runs are serialized and never run concurrently with another
session's Playwright/model work: use the heavy-task lease, isolate ports,
and keep browser profiles separate. Node real-model runs use bounded timeouts
and are recorded as attempts when they are censored.
