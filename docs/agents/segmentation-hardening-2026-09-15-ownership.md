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
