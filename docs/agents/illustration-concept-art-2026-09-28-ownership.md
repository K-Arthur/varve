# Illustration and concept-art workflow improvements — ownership

**Task:** illustration and concept-art existing-system improvements
**Owner:** primary integration agent
**Started:** 2026-09-28
**Branch:** `master` (user-requested; no branch or worktree created)
**Base observed before implementation:** `401f1e7fd4d40c86f80fc2b36888019a4f50211b`

## Shared-worktree boundary

The shared checkout already had a large mixed index and worktree (423 changed
entries at the first status check). No reset, stash, clean, broad stage, or
whole-index commit is allowed. Work is staged and committed with explicit path
lists. A second task advanced `master` from `d51f52e40` to `401f1e7fd` during
the initial inspection; its export-sharpening commit is retained as the current
base. Re-read the branch, exact `HEAD`, and every target path before each slice.

This task is the integration owner for the illustration workflows. Initial
implementation ownership is limited to the following clean paths:

| Owned path | Scope |
|---|---|
| `packages/editor/src/tools/paintTarget.ts` | Paint destination validation and explicit refusal contract. |
| `packages/editor/src/tools/__tests__/paintTarget.test.ts` | Resolver regression coverage. |
| `packages/editor/src/tools/PaintTool.ts` | Only target admission/recovery behavior; preserve the stroke worker, transaction and input lifecycle. |
| `packages/editor/src/tools/__tests__/PaintTool.test.ts` | Only fixtures/assertions affected by stricter target admission. |
| `tests/e2e/paint/brush-ui.spec.ts` | One isolated real-canvas test for refusal when a vector remains selected; no broad changes to existing paint coverage. |
| `docs/architecture/paint-system.md` | Current target resolution, mask validation and refusal contract. |
| `docs/research/illustration-concept-art-research-2026-09-28.md` | Dated sources, complaint evidence, uncertainty, and decisions. |
| `docs/audits/illustration-concept-art-capability-matrix-2026-09-28.md` | Reproductions and verified/deferred capability status. |

## Existing ownership to preserve

- `docs/agents/drawing-input-2026-09-13-ownership.md` owns canonical pointer
  normalization, `inputPipeline.ts`, and the broad Pen/Pencil/Paint lifecycle.
  This task does not replace its sample-normalization or worker protocol. Any
  follow-up to those shared contracts must be recorded as a narrow integration
  change after rereading the current files and validation state.
- `docs/agents/photo-retouch-target-sampling-2026-09-13-ownership.md` owns
  `rasterTarget.ts`, `retouchSampling.ts`, and retouch tools. Consume the
  existing sampling APIs; do not fork or overwrite them.
- `docs/agents/canvas-fluidity-2026-09-25-ownership.md` owns active canvas
  traversal, `CanvasOverlays.tsx`, portions of perspective overlays, and shared
  input/rendering paths. Do not add hub imports or silently take those paths.
- `docs/agents/gpu-rendering-2026-09-26-ownership.md` owns the active renderer,
  compositor, and pixel-reuse work. Keep this task out of those files unless
  there is a specific reviewed handoff.
- `docs/agents/guide-layouts-2026-09-21-ownership.md` owns shared scene guide
  and layout contracts. Reuse those APIs for perspective assistants.
- Marketing pages and screenshots already have unrelated staged/unstaged
  edits. Each exact website path will be checked for ownership and status
  immediately before any proposed edit.

## Validation and commit protocol

The initial `pnpm verify:plan` selected unrelated workspace/toolchain and
validation-infrastructure changes from the shared checkout and reported full
suite escalation. That result is not attributed to this task. Run focused tests
for each isolated slice, then plan and validate the exact committed range where
the planner supports it. Do not broaden validation over other tasks' staged
work. Browser runs use the repository heavy-task lease, one Chromium worker,
and a unique port/output directory; never reuse another task's screenshots.

Record each commit SHA and its exact paths here. A commit must include its
focused regression and the relevant current-state documentation. Save visual
evidence only after the application output has been inspected. Platform and
hardware gaps remain explicit in the final handoff.

## Commit log

_First target-integrity slice is validated; commit follows the scoped review._
