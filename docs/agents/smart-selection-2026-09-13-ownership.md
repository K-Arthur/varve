# Smart selection ownership and plan (2026-09-13)

**Task:** smart-selection infrastructure, algorithms, tools, and workflows
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per user
instruction; no branch or worktree)
**Base HEAD at start:** `c5d661ea0`

## Why this record exists

The working tree is shared with several active agents (typography/fonts,
generative editing, photo retouch, drawing input, ChromeOS stages, GPU/NPU,
integration branches). This record names the exact paths this task owns so no
other writer is overwritten, and states the paths this task deliberately does
not touch because they contain concurrent uncommitted work.

## Owned paths (single writer during this task)

| Path | Contract |
|---|---|
| `packages/editor/src/context/useSam2Segmentation.ts` | Reviewed-candidate commit path for both outputs; prompt session operations |
| `packages/editor/src/context/objectSelectionTypes.ts` | Transient session shape (additive only) |
| `packages/editor/src/tools/Sam2SegmentationTool.ts` (+ test) | Prompt gestures, per-prompt removal |
| `packages/editor/src/tools/sam2PromptCoordinates.ts` (+ test) | World → source normalization |
| `packages/editor/src/tools/selectionMask.ts` | Mask ↔ area-selection conversion |
| `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx` | Object Selection controls only |
| `packages/editor/src/canvas/overlayManager.tsx` | Prompt marker rendering only |
| `packages/engine/src/areaSelectionImage.ts` (+ test) | Deterministic colour/luminance/alpha selection |
| `packages/engine/src/intelligence/foregroundSelect.ts` (+ test) | Model-free subject/foreground proposals |
| `packages/engine/src/segmentation/**` | Selection algebra, quality corpus |
| `tests/e2e/canvas/object-selection*.spec.ts` | Real-UI selection specs |
| `docs/quality/smart-selection-research-2026-09-13.md` | Research ledger |
| This record | Ownership + plan |
| Current-state selection docs and selection/background website pages | Verified behavior only |

## Shared-file coordination

| Surface | Status | Rule |
|---|---|---|
| `context.tsx`, `CanvasArea.tsx`, `Shell.tsx`, `Menubar.tsx` | Dirty with other agents' work | **No edits.** New wiring goes through already-exposed context values or owned components. |
| `createActionHandlers.ts`, `registerAll.ts`, `ShortcutManager.ts`, `toolRegistry.ts` | Dirty | **No edits.** Existing command IDs must carry any new behavior. |
| `helpContent.ts` | Dirty | **No edits.** Help additions go to `packages/help` only if clean; otherwise documented in the selection docs. |
| Selection refinement (`RefineMaskTool`, matting solvers, `SelectionSourcesPanel` controls) | Owned by the completed `selection-refinement-2026-09-13` task | Reuse; do not fork a refinement path. |
| Background-removal model inference and model lifecycle | Existing owners | Reuse; no new model provisioning. |

## Plan (milestones, in dependency order)

1. **Research and baseline** — external research ledger (done); in-repo audit
   (done: output asymmetry, prompt editing gap, luminance alpha bug, wand
   false-success, dead foreground selector, real-model encoder absent).
2. **Existing workflow correctness** — one reviewed-candidate commit path for
   "Use as selection" and "Apply as mask"; pin candidate identity against
   stale completion; prompt removal by marker tap; honest empty-result
   handling; candidate score provenance.
3. **Complete usable selection** — deterministic fixes (luminance alpha,
   wand empty combination), prompt-correction UX, keyboard/tap alternatives.
4. **Evidence-backed intelligence** — model-free foreground/subject proposals
   with explicit ranking, bounded cost, honest labelling, and candidate choice;
   no forced downloads; no semantic claims.
5. **Quality and performance** — unit tests for every changed algorithm;
   real-UI Playwright for both outputs and prompt correction; screenshots
   inspected; measured prompt/commit paths; constrained-device notes.
6. **Independent review** — diff review, visual evidence review, docs and
   website updates limited to verified behavior, scoped commits only.

## Validation plan

- `pnpm verify:plan` before each commit; `pnpm verify:affected` at checkpoints.
- Focused Vitest on changed engine/editor files.
- Playwright `tests/e2e/canvas/object-selection.spec.ts` on an isolated port;
  inspect `reports/` screenshots and record what was seen.
- Real-model corpus gate: unavailable here (encoder artifact absent);
  recorded as unverified, not skipped silently.

## Website integration of a stopped writer (2026-09-14)

`apps/website/src/pages/docs/tools/object-selection.astro` and
`apps/website/src/pages/features/background-removal.astro` carried a stopped
writer's refinement copy (last modified 2026-09-13 23:28, over an hour before
integration) with a **stale staged snapshot** that held the reverse text. The
working-tree versions (the matting-first refinement copy matching the landed
`194b37764` refinement work) were preserved and committed together with this
task's subject-estimate and reviewed-candidate copy. No other writer's lines
were altered, and the stale staged hunks were never committed.

## Commit discipline

Every commit uses an explicit path list of files this task owns. Unrelated
staged/unstaged files are never restaged, reverted, or reformatted. Commits
are authored by the maintainer with no AI attribution trailers.
