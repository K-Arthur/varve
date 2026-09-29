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

## Next milestone ownership — inference session/runtime working set

Source review for the next runtime milestone found that `InferenceSessionRegistry`
already provides single-flight creation, active-run protection, release
confirmation, and failed-release retention, but its live session bytes are not
transferred into the shared platform ledger. `InferenceWorkerHost` currently
reserves inputs and adds failed-release bytes to later requests; successful
cached sessions can therefore sit outside shared admission. Its cache key is
currently only `modelType:modelPath`. `WorkerInferRequest.sessionPeakBytes` has
no production writer, even though model catalog peak estimates are available.

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
registration, but the lens-blur acceptance path currently expands inference
output to source-image dimensions before serialization. Preserve the registered
model-resolution map in the document resource; any source-sized raster needed
for an operation must be a separately admitted, disposable runtime surface.

Validation follows `AGENTS.md` and
`docs/quality/validation-strategy.md`: inspect diffs, run `pnpm verify:plan`,
run `pnpm verify:affected`, then selected focused/browser/visual checks. The
shared-tree planner's full-suite escalation belongs to the complete frozen-SHA
final gate; collect integration failures once with triage and keep unrelated
failures attributed to their owners.
