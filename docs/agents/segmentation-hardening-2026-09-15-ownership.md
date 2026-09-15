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

