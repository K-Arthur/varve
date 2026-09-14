# Selection refinement ownership record

**Task:** `selection-refinement-2026-09-13`
**Coordinator:** opencode (selection/matting session)
**Started:** 2026-09-13
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
**Initial repository base:** `530fc67df`

## Scope

This work owns the repair, completion, and verification of pixel selection
refinement and raster-mask edge refinement:

- `packages/engine/src/areaSelection.ts` refinement entry points and the new
  bounded morphology/coverage module behind them.
- `packages/engine/src/backgroundRemoval/refineHairMatting.ts`,
  `trimapMatting.ts`, and the plane operations they depend on.
- `packages/editor/src/tools/RefineMaskTool.ts`,
  `TrimapEditTool.ts`, `SelectionPaintTool.ts`, and a shared stroke helper.
- The refine/trimap controls in
  `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
  and the selection-refinement controls in
  `packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx`.
- Current-state docs and the marketing-website claims that describe the
  implemented behavior.
- Focused regression tests and browser/interaction validation.

It deliberately does **not** own `CanvasArea.tsx`, `Shell.tsx`, or
`context.tsx`; those hub files stay at their import budgets. Wiring goes
through existing context values or thin adapter modules. SAM2 model
provisioning, background-removal model inference, the render worker, and
packaging remain with their existing owners.

## Shared-file coordination

| Surface | Owner / status | Coordination rule |
|---|---|---|
| `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` | Hub owners / untouched | No new imports or responsibilities. |
| `packages/engine/src/areaSelection.ts` | This task | Extend the operation union and refine entry point; keep existing shapes/API stable. |
| `refineHairMatting.ts`, `trimapMatting.ts`, `maskOps.ts` | This task | Correct the solvers; callers in `useBackgroundRemoval.ts` keep working. |
| `useSam2Segmentation.ts` | Existing owner | Read-only except the documented selection-output bridge verification. |
| `BackgroundRemovalSection.tsx`, `SelectionSourcesPanel.tsx` | This task | UI only; no new context fields for non-owned hubs. |
| `tests/e2e/**` | This task (new spec + fixtures only) | Do not modify or restage other agents' specs. |
| Website pages | This task (selection/mask pages only) | Re-read before edits. |

The worktree was dirty with other agents' staged and unstaged work when this
task began. Every commit uses an explicit path list; unrelated staged files are
never restaged, reverted, or reformatted. The existing `ShapeBuilderTool`
untracked/staged conflict and other in-flight changes are left alone.

## Validation

- Engine and editor unit tests for every changed algorithm (`vitest run` on
  exact paths).
- `pnpm verify:plan` / `pnpm verify:affected` at checkpoints.
- A new Playwright spec drives the real refine-mask and selection-refinement
  UI on an isolated port, and its screenshots are opened and inspected.
- Physical pen/stylus and non-Chromium runtimes remain unverified unless
  hardware is attached; the audit records exactly what was observed.
