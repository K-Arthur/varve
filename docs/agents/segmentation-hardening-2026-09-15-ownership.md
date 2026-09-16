# Segmentation hardening ownership record (2026-09-15)

**Task:** candidate ranking quality, discovery performance/UX, detection→segmentation
memory handoff, validation-record integrity, platform evidence, and experimental
boundaries for Object Selection / text discovery.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per task
instruction; no branch or worktree was created).
**Base HEAD at start:** `ce7b2eca6`.
**Plan:** `docs/plans/segmentation-hardening-2026-09-15.md`.

## Why this record exists

The working tree is shared with concurrent writers (`codex` pts/10 actively
committing selection work; a layers-panel session; a dialog session). This
record names the paths this task owns and the paths it deliberately does not
touch because another writer was active in them at claim time.

## Owned paths (this task)

| Path | Contract |
|---|---|
| `packages/engine/src/validation/**` (new) | Measurement-record schema, validator, and derived verified summaries |
| `packages/engine/src/segmentation/providerValidation.ts` | Record declarations become validator-checked derivations |
| `packages/engine/src/segmentation/promptedRouting.ts` (+ tests) | Consume verified summaries; per-metric worst-category naming |
| `packages/engine/src/inference/SessionManager.ts` (+ tests) | Single-flight creation, release accounting, error propagation |
| `packages/engine/src/inference/inferenceWorker.ts` | Session release protocol, refcounted leases, stage timings |
| `packages/engine/src/inference/inferenceWorkerHost.ts` (+ tests) | Release/handoff API, queued-eviction, idle worker recycling |
| `packages/engine/src/inference/platformEvidence.ts` (new) | Exact model/runtime/device support matrix with unverified cells retained |
| `packages/engine/src/discovery/**` (+ tests) | Preprocessing/latency evidence; only validated optimizations change defaults |
| `packages/editor/src/context/promptedMaskValidation.ts` (+ tests) | Candidate ranking policy and its evaluation hooks |
| `packages/editor/src/context/promptedRankingEvaluation.ts` (new) | Frozen-candidate-set metrics: top-1, oracle, regret, top-k, clicks |
| `packages/editor/src/components/Inspector/sections/TextDiscoveryPanel.tsx` | Stage timings, release-after-detection, honest progress; re-checked for concurrent edits before every write |
| `tests/e2e/canvas/inference-platform-probe.spec.ts` (new) | Browser probe for isolation, threads, adapter, WebGPU session outcome |
| `docs/quality/validation-record-integrity.md` (new), related quality docs | Integrity contract and derived reports |
| `docs/architecture/object-selection-system.md`, `docs/architecture/text-discovery-system.md` | Current-state updates only where evidence exists |
| Website Object Selection / Background Removal / text-discovery copy | Verified claims only; re-read before every edit |
| This record | Ownership + handoff |

## Deliberately not touched

- `packages/editor/src/context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub
  budgets and concurrent writers.
- `packages/editor/src/context/useSam2Segmentation.ts` — owned by the
  smart-selection task; handoff wiring must go through already-exposed values
  or the discovery panel.
- `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
  — modified by the codex writer during claim time; re-read before any edit and
  never restage their hunks wholesale.
- Font, generative, depth, toolbar, layers, dialog work — other owners.

## Commit discipline

Every commit uses an explicit path list of files this task owns. Unrelated
staged/unstaged files are never restaged, reverted, or reformatted. Commits
are authored by the maintainer with no AI attribution trailers.

## Handoff state (2026-09-15, final)

| Commit | Content |
| --- | --- |
| `194e6222f` | Measurement-record validator (schema, aggregation, negative tests) |
| `4f62dda47` | Session registry, worker/host release protocol, SessionManager, discovery panel handoff |
| `c05c28525` | Provider records from primary observations, candidate ranking engine, platform matrix, experimental tests, discovery preprocessing |
| `3782a611c` | Editor ranker policy hook, frozen-set evaluation, keyboard candidate cycling |
| docs commit | `docs/quality/validation-record-integrity.md`, `docs/quality/candidate-ranking-evaluation.md`, architecture updates, `docs/audits/segmentation-hardening-2026-09-15.md` |

## Follow-up session (same task, 2026-09-15 late)

| Commit | Content |
| --- | --- |
| `c602e7c9e` | Admission refusals explained; detector release on cancel; full discovery timing breakdown; failure classification |
| `d23125b78` | Threaded-WASM probe on a real shipped graph (one worker/context per configuration) + matrix outcome |
| (ranking) | Intent-annotated real-photo corpus, annotation sheets, per-intent evaluation, reviewed fixture |
| `474be04a7` | Detection→segmentation handoff trace (overlap vs handoff orderings, separate processes) |
| `e7ef4146b` | Audit ledger + architecture/quality/website corrections |
| `6cf90b669` | Browser preprocessing parity probe; verified-run preprocessing identity named |

Ledger for the follow-up: `docs/audits/segmentation-hardening-followup-2026-09-15.md`.

### Closed by the follow-up

* Threaded WASM is no longer "unverified by assumption": a cross-origin
  isolated probe on a real shipped graph created a single-threaded session in
  1283 ms and ran 156.9 ms/run, while `numThreads = 2` never returned from
  session creation (terminated at 120 s). The matrix cell stays `unverified`
  with that measured reason.
* Human-annotated real-photograph acceptable/best sets now exist
  (`annotated-ranking-real-photos-v1.json`, 6 intent cases, inspected sheets),
  with recorded policy baselines and named residual ranking failures.
* The detection→segmentation transition peak is measured for both orderings in
  Node CPU: handoff 571 MB vs overlap 590 MB, release returned in 4 ms with
  RSS −15 MB.
* Browser preprocessing parity is measured: the shipped canvas path differs
  from the reference path (mean |Δ| 0.31 normalized) and is 2.15× closer to an
  independent area average.
* Discovery cancellation releases the detector; refusals name the binding
  constraint; the timing row reports image prep, tensor build, detection,
  release, and total.

### Still open (do these first)

1. **In-app candidate-review visual gate.** Re-run
   `VARVE_MOBILE_SAM_REAL_MODEL=1 … object-selection-mobile-real-model.spec.ts`
   once the shared tree and host memory allow; the follow-up attempt crashed
   the renderer at the Object Selection disclosure under another agent's
   concurrent Chromium + dev server, and a model-free follow-up was blocked in
   `global-setup` by the layers panel. Panel states are pinned by
   `TextDiscoveryPanel.test.tsx` meanwhile.
2. **Browser detector run** (`VARVE_TEXT_DISCOVERY_REAL_MODEL=1
   … text-discovery.spec.ts`) for detection parity on the v2 preprocessing
   identity and a real wall-clock number. Needs the 2.4 GB-class allocation.
3. **SAM2 browser gate** (the MobileSAM gate covers the same workflow with a
   smaller model).
4. **Human-annotated corpus growth**: 6 cases is enough to name residuals and
   set floors, not enough to promote a policy; add cases (especially
   `multiple-similar`, `thin-geometry`, and no-match negatives) before any
   ranker change is justified by it.

Two shared-tree incidents are recorded for the next writer:

1. The first documentation draft was swept into a concurrent writer's commit
   `080b58d88` because it was staged while that writer committed. Content is
   intact; the later docs commit carries the same files. Staging and committing
   in one short window (or using the lock-waiting helper in
   `/tmp/opencode/commit-when-free.sh`) avoids the race.
2. Two e2e specs owned by other writers (`export-tab.spec.ts`,
   `popover-contract.spec.ts`) temporarily failed the repository-wide e2e
   typecheck, which blocks every commit gate. They were left untouched and the
   other writers repaired them.

Unverified items carried forward: real-model ranking corpus run, browser
detection parity for the v2 preprocessing path, threaded-WASM probe, and the
timestamped detection→segmentation peak trace. See the audit ledger for exact
commands and reasons.

