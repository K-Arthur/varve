# Low-end effects and model runtime ownership (2026-09-28)

**Task:** complete Varve's low-end effects rendering, image treatment, and model
runtime work, with progressive commits on `master`, updated documentation,
marketing claims, and host-side visual evidence.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` per user
instruction. Do not create a branch or worktree.
**Base HEAD at task continuation:** `b39129198`.
**Plan:** user-provided Varve low-end effects and model runtime implementation
plan; progress ledger: `docs/audits/low-end-effects-runtime-baseline-2026-09-13.md`.

## Shared checkout boundary

The checkout contains extensive staged, unstaged, and untracked work from other
tasks. Preserve it. Before each milestone, recheck branch, status, exact path
diffs, staged index, and this ownership record. Commit only reviewed task-owned
paths with explicit path lists. Do not reset, stash, clean, broadly stage, or
push.

## Current milestone ownership

| Paths | Owned change |
|---|---|
| `packages/engine/src/inference/inferenceWorkerHost.ts` | Caller cancellation retains execution identity, deadline, and admission until response or owning-worker termination. |
| `packages/engine/src/inference/inferenceWorker.ts` | Session-creation timeout waits for late creation and confirmed release; fatal cleanup failure retires the worker. |
| `packages/engine/src/inference/core/sessionCreation.ts` (+ tests) | Isolated bounded session creation and late-release contract. |
| `packages/engine/src/inference/__tests__/workerHostMessages.test.ts` | Worker lifecycle, cancellation, timeout, fatal cleanup, and reservation regressions. |
| `docs/audits/low-end-effects-runtime-baseline-2026-09-13.md` | Source findings, decisions, and evidence ledger for this task. |
| This file | Ownership and handoff ledger. |

## Next milestone ownership

For shared resource admission, this task owns these paths after inspecting the
shared tree at `8fcdfeb34` and confirming they have no local diff:

| Paths | Owned change |
|---|---|
| `packages/platform/src/derivedWorkAdmission.ts` (+ tests) | Extend the existing cross-feature gate with byte reservations, resident ownership, refusal/accounting diagnostics, and bounded aging without breaking legacy callers. |
| `packages/engine/src/inference/admission.ts` (+ tests) | Preserve the inference API as a compatibility adapter over the shared gate. |
| `packages/engine/src/contentAwareFill/nativeProvider.test.ts`, `packages/engine/src/generativeEdit/nativeProvider.test.ts` | Keep native inference provider tests compatible with the shared platform facade instead of incomplete module mocks. |
| `packages/engine/src/generativeEdit/nativeProvider.ts` | Preserve a typed insufficient-memory result when shared admission refuses a native request before dispatch. |
| `docs/architecture/onnx-inference-architecture.md` | Document the shared admission contract, budget defaults, and remaining caller migration. |
| This file and the baseline audit | Record the single-writer transfer and measured limits. |

The older ChromeOS Stage 3 and segmentation-hardening records mention these
admission/inference surfaces from completed work. At this checkpoint their
files were clean; this ownership is limited to the next diffs above. The
dirty `packages/platform/src/memory.ts` remains reserved to its current writer
and is excluded from this milestone.

Historical inference ownership records describe completed earlier work. This
continuation owns only the current diffs named above; preserve pre-existing
behavior and inspect any newly appearing hunks before editing or committing.

## Milestone 5 implementation ownership (pre-edit HEAD: `63d67d723`)

Before this pass, `git status --short --branch` showed `master` with 248 local
commits ahead of `origin/master` and a large set of unrelated staged,
unstaged, and untracked files. The current integration owner had added several
unrelated commits since the earlier M4 snapshot; this work remains on master
and does not include those paths. The following exact M5 files are task-owned:

| Paths | Owned change |
|---|---|
| `packages/engine/src/inference/core/ortRuntime.ts`, `core/__tests__/ortRuntime.test.ts` | Single-flight runtime entrypoint selection, matching WASM/WebGPU module selection, WebGPU-import fallback, failed-promise reset, and no in-worker entrypoint switching. |
| `packages/engine/src/inference/inferenceWorker.ts`, `inferenceWorkerHost.ts`, `sessionKeys.ts`, `sessionKeys.test.ts`, `__tests__/workerHostMessages.test.ts` | Resident session byte transfer, confirmed-release eviction, artifact/runtime/device-generation identity, per-request creation confirmation, and cache-residency diagnostics. The registry records the actual execution provider; the host key distinguishes the requested provider profile. |
| `packages/engine/src/depthMap.ts`, `depthMap.test.ts`, `index.ts` | Persist source-to-model-grid registration and resample registered depth directly into a disposable render surface without persisting source-sized samples. |
| `packages/editor/src/components/Inspector/sections/LensBlurSection.tsx`, `packages/editor/src/render/groupEffectStages.ts`, `tests/e2e/canvas/depth-blur.spec.ts` | Generate compact registered depth resources, use the same registration-aware runtime resampling in preview and compositor, and assert Save persists the model-grid resource. |
| `docs/architecture/onnx-inference-architecture.md`, `docs/architecture/depth-aware-imaging.md`, `docs/audits/low-end-effects-runtime-baseline-2026-09-13.md`, this file | Update runtime/session/depth contracts, evidence, validation, and known limitations. |

These paths were reviewed against the current shared status before edits. The
coexisting website, workspace, GPU, tablet, and unrelated editor changes are
not M5-owned and must not be staged with this milestone. Keep the exact-path
stage/commit boundary when committing.

The M5 browser reproduction initially exposed a resampling metadata bug: the
saved model-grid map had been carrying its model-grid `validSampleCount` into a
source-sized aligned view. The Depth Mask histogram correctly rejected that
inconsistent metadata. This milestone now recounts valid samples whenever a
depth grid is resampled, while retaining source range metadata only when at
least one valid output sample remains. A separate repeat showed the E2E setup
helpers returned script strings but were passed as Playwright callbacks, so
they never installed the worker stub or seeded model. The spec now passes the
returned scripts to `addInitScript` and asserts that the stub responds. The
first failing screenshot was
inspected at
`test-results/low-end-depth-m5-0929b/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/test-failed-1.png`;
the spinner capture from the harness failure is at
`test-results/low-end-depth-m5-0929d/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/test-failed-1.png`.
The corrected repeat passed both tests in 51.4s. Its saved-state screenshot,
showing the selected artwork and saved Depth Blur controls, was inspected at
`test-results/low-end-depth-m5-0929f/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/depth-resource-saved.png`.

## Reserved / shared paths

- Canvas compositor, render worker, `CanvasArea.tsx`, `Shell.tsx`, and current
  worker-fidelity oracle paths are actively shared with GPU-rendering and
  canvas-fluidity work. Re-read their ownership records and diffs before any
  integration; do not include their changes in this task's commits.
- Export implementation/tests, shared memory admission, workspace/settings,
  tokens, and most marketing/docs files are dirty in the shared checkout. Read
  their current diffs and establish a clean hunk/path boundary before touching.
- Physical Duet, ChromeOS browser/PWA, ARM64 Crostini, and real-touch checks are
  unavailable in this host session; report them as pending and provide a
  device kit rather than implying they passed.

## Commit and validation ledger

| Commit | Scope |
|---|---|
| `33c00bf51` | Refreshed continuation source/research baseline. |
| `8fcdfeb34` | Retain inference reservations through actual execution completion and prevent overlapping session-provider fallback. |
| `0112de9a8` | Shared byte admission and inference compatibility adapter; normal scoped commit checks passed. |
| `b6727dfe5` | Runtime entrypoint selection, worker session resident accounting, compact registered depth resources; focused browser and unit checks passed. |

M5's normal scoped commit checkpoint passed all hooks, including typecheck of
E2E sources and four direct suites (43 tests). A separate focused run passed
six suites (59 tests), and the lease-wrapped depth Save/mask browser flow passed
both cases. The selected-artwork screenshot after Save was inspected. The
shared planner still sees 527 files and escalates because concurrent workspace,
toolchain, and validation-infrastructure changes select the full suite; the
affected command stops before starting lanes. That frozen-SHA gate remains a
final integration checkpoint.

## M6 implementation — bounded model storage and verified publication

Pre-edit HEAD is `53f442ae2` on `master`. Immediately before this storage pass,
the candidate storage paths below were clean in the shared index and worktree;
other staged/unstaged changes remain outside this ownership. Refresh status and
review exact diffs again before staging or committing.

The source review confirmed that generic downloads concatenated response
chunks, background-removal owned a second model store, and the localStorage and
Tauri adapters still exposed large JSON byte-array write paths. The shared
storage layer now stages incremental writes in OPFS or chunked IndexedDB,
streams legacy artifacts through handles where possible, and verifies size and
digest before metadata publication. The existing native Rust streaming command
was reused; the concurrently dirty `apps/desktop/src-tauri/src/lib.rs` was not
edited.

| Paths | M6 ownership under review |
|---|---|
| `packages/engine/src/inference/core/ModelStorage.ts`, `core/__tests__/ModelStorage.test.ts`, and `core/index.ts` | Metadata/stat, artifact handles, staged verified writes, OPFS preference, 256 KiB IndexedDB chunk fallback, read compatibility, and atomic batch reference publication. |
| `packages/engine/src/inference/core/DownloadManager.ts`, `TauriModelStorage.ts`, and `core/__tests__/DownloadManager.test.ts` | Stream model bytes, preserve validated resume, keep multipart artifacts private until a verified batch commit, and disable large JSON-array IPC writes. The pre-existing Rust streaming downloader remains the desktop installer. |
| `packages/engine/src/backgroundRemoval/modelStore.ts`, `modelLoader.ts`, and `backgroundRemoval/__tests__/modelLoader.test.ts` | Reuse shared staged storage, stream ordinary model and external-data artifacts, resume only matching partials, and atomically publish graph plus sidecar. |
| `packages/engine/src/inference/types.ts`, `manifest.ts`, `core/types.ts`, `modelCatalog.ts`, `packages/engine/src/backgroundRemoval/modelManifest.ts`, and `apps/desktop/public/models/manifest.json` | Carry external-data checksum/size metadata and pin SCUNet graph/weights to one upstream revision. |
| `packages/engine/package.json`, `pnpm-lock.yaml` | Add the incremental SHA-256 implementation dependency. Keep ONNX Runtime at its existing pinned version. |
| `docs/architecture/onnx-inference-architecture.md`, `docs/architecture/loading-system.md`, this file, and the baseline audit | Record the verified storage/publication contract, evidence, and known boundaries. |

No Rust source was changed. OPFS remains a preferred backend only when the
browser exposes it; IndexedDB chunks are the fallback. Physical and browser
engine acceptance remain separate and are not established by the M6 tests.

## Current milestone ownership — responsive live-effect job lane

The shared render pipeline and compositor paths remain dirty under the GPU and
canvas-fluidity owners. This milestone therefore owns a new engine-level lane
that captures disposable RGBA only after admission, transfers it to one worker,
and coalesces obsolete work per preview owner. It does not edit
`renderPipeline.ts`, `CanvasArea.tsx`, `renderWorker.ts`, `effectContract.ts`,
or the compositor.

| Paths | Owned change |
|---|---|
| `packages/engine/src/liveEffects/cpuProvider.ts`, `effectPreviewWorker.ts`, `effectPreviewRunner.ts` | Share canonical CPU kernels with a transferable module worker and a latest-only owner scheduler; retain admission until worker completion. |
| `packages/engine/src/liveEffects/dispatch.ts`, `index.ts` | Re-export canonical CPU application without changing existing provider order or synchronous callers. |
| `packages/engine/src/liveEffects/__tests__/effectPreviewRunner.test.ts` and dispatch tests | Prove byte-equivalence, pre-capture admission, identity invalidation, per-owner replacement, cancellation, and late worker completion accounting. |
| `packages/editor/src/components/AdjustmentLayer/LiveEffectEditors.tsx`, `EffectKernelPreview.tsx`, `effectKernelPreview.css`, and `EffectKernelPreview.test.tsx` | Add a small, labeled synthetic-kernel sample to live-effect controls. This exercises the lane without presenting synthetic pixels as the selected artwork or changing the authoritative canvas preview. |
| `tests/e2e/effects/live-effect-kernel-preview.spec.ts` | Real Chromium worker transfer and light/dark/high-contrast screenshot acceptance for the synthetic sample; must run through the heavy-task lease. |
| `docs/architecture/live-effects-system.md` | Document the worker job contract and its current integration boundary. |
| This file and `docs/audits/low-end-effects-runtime-baseline-2026-09-13.md` | Record single-writer boundary, refreshed competitor failure evidence, validation, and limitations. |

M4 focused Vitest (19 tests), engine typecheck, E2E typecheck, Biome, docs,
emoji, and token audits pass. Editor package typecheck currently reports two
existing errors in the unchanged `CurveEditor.test.tsx` (`getByRole`'s `exact`
option is absent from the current test-library types); the new task-owned
component files have no remaining TypeScript errors. The lease-wrapped real
Chromium worker test passed in 40.2s, and its light, dark, and high-contrast
captures were inspected. An exploratory narrow/forced-colors extension did
not progress past viewport resizing after saving the theme captures and was
interrupted; that case remains for the separate touch/portrait milestone. The
test now limits M4 acceptance to the worker and three theme states.

The 2026-09-28 refresh confirmed the existing user reports remain at their
original URLs. Photopea's report describes a 3692×4800 image and 20–30 second
filter/slider waits, and says reducing it to 1000×1300 made little difference
([report](https://www.reddit.com/r/photopea/comments/11nqi3n/photopea_is_unbearably_laggy/)).
The Krita issue describes input lag in the AI-diffusion plugin after a remote
ComfyUI setup change and presents GUI-thread event-loop starvation as a
hypothesis rather than a confirmed root cause
([issue](https://github.com/Acly/krita-ai-diffusion/issues/2534)). Adobe's
official known-issues page lists downloads that fail after appearing to start,
transparent pixels after Colorize, loss of fine detail in JPEG artifact
removal, and pauses when resource-intensive Landscape Mixer is combined with
other filters ([Adobe](https://helpx.adobe.com/photoshop/using/neural-filters-feedback.html)).
The Figma report describes pan, page-switch, and SVG-export lag; support asked
for more data and did not establish a cause
([report](https://forum.figma.com/ask-the-community-7/figma-has-become-very-slow-22519)).
These are user reports and documented product issues, not comparative
benchmarks; Varve's acceptance cases test the corresponding behaviors.

The baseline audit contains the exact focused validation commands and outcomes
for the completed milestones. The admission commit hook reran 47 tests across
four suites; the pre-commit seven-suite validation ran 60 tests. Engine
typecheck for M4 passes. The earlier M3 engine typecheck was blocked by the
unrelated shared `tonalControls.bench.ts` callback errors documented in the
audit.

## M5 source baseline — inference session/runtime working set

The source review before M5 found that `InferenceSessionRegistry`
already provides single-flight creation, active-run protection, release
confirmation, and failed-release retention, but its live session bytes are not
transferred into the shared platform ledger. `InferenceWorkerHost` currently
reserves inputs and adds failed-release bytes to later requests; successful
cached sessions can therefore sit outside shared admission. Its cache key is
currently only `modelType:modelPath`. `WorkerInferRequest.sessionPeakBytes` had
no production writer, even though model catalog peak estimates were available.
The M5 implementation ownership and result are recorded above.

| Paths | Intended change |
|---|---|
| `packages/engine/src/inference/inferenceWorkerHost.ts`, `inferenceWorker.ts`, `sessionRegistry.ts`, `sessionKeys.ts` | Reserve catalog/session and input working sets before worker creation; transfer created sessions to shared resident leases; release resident ownership only after worker confirmation or worker termination; key sessions by model/artifact, actual provider, external data, runtime configuration, and worker/device generation. |
| `packages/engine/src/inference/__tests__/workerHostMessages.test.ts`, `sessionRegistry.test.ts`, worker/runtime tests | Cover resident transfer/release, eviction, unknown or undersized estimates, key separation, duplicate creation, provider fallback, and fatal worker/device loss without overlap. |
| `packages/engine/src/backgroundRemoval/ortRuntimeAssets.ts` and tests (only if needed) | Preserve matching 1.27.0 runtime assets and one-thread worker defaults while selecting the entrypoint that includes the provider actually requested. |
| `packages/editor/src/components/Inspector/sections/LensBlurSection.tsx`, depth map tests | Keep generated depth samples at model resolution and persist their existing source registration instead of upsampling the saved resource to source dimensions. |
| `docs/architecture/onnx-inference-architecture.md`, this file, and the baseline audit | Record runtime-entrypoint constraints, cache/resident lifetime, compact depth registration, exact validation, and current hardware limits. |

The installed `onnxruntime-web` and companion assets are pinned at 1.27.0.
The fresh official ORT documentation states that `env.wasm.numThreads` is a
global setting and that one disables pthread workers; the current dedicated
inference worker already sets it to one. ORT's worker proxy cannot use WebGPU,
and the official WebGPU instructions use the `onnxruntime-web/webgpu`
entrypoint. The ordinary and WebGPU bundles must keep matching ORT asset
versions ([environment flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
[WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)).

The depth resource serializer already stores its actual `width`/`height` and
registration. M5 changes the lens-blur acceptance path to retain the registered
model-grid map and resample it through that transform for source-sized preview
and compositor surfaces. This avoids persisting a source-sized intermediate;
full pre-decode admission for every caller remains later integration work.

Validation follows `AGENTS.md` and
`docs/quality/validation-strategy.md`: inspect diffs, run `pnpm verify:plan`,
run `pnpm verify:affected`, then selected focused/browser/visual checks. The
shared-tree planner's full-suite escalation belongs to the complete frozen-SHA
final gate; collect integration failures once with triage and keep unrelated
failures attributed to their owners.
