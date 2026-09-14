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
  exact paths); 96 area-selection and 502 background-removal tests pass,
  including dense-reference and naive-reference checks.
- `tests/e2e/canvas/selection-refine-operations.spec.ts` drives the real
  editor under Chromium on isolated port 1593 (heavy-task lease held); both
  cases pass and the screenshots are archived and inspected in
  `docs/screenshots/selection-refinement/2026-09-13/`.
- Performance recorded in `docs/audits/selection-refinement-audit-2026-09-13.md`
  §6 and reproducible via
  `packages/engine/src/bench/selectionRefinement.bench.test.ts`.
- Physical pen/stylus, Tauri WebKitGTK, and non-Chromium runtimes remain
  unverified; the audit records exactly what was observed.
- `pnpm verify:plan --staged` (scoped through a temporary Git index so the
  277-file concurrent working tree does not inflate the plan) reports a
  bounded closure with no full-suite escalation. `pnpm verify:affected
  --staged` passes Tier 0 and Tier 1, including the new E2E spec, then stops
  at `js-unit:@varve/website` on a reproducible baseline failure:
  `pages/features/canvas.astro` and `pages/docs/tools/grids.astro` contain
  raw colours (`#172126`, `#dce7eb`) and reference undefined
  `--surface-raised` / `--font-ui` tokens. Both files are unmodified versus
  `HEAD` (`git diff` empty) and are not part of this task's ownership.
- Tier 2 engine/editor suites are run directly because the aggregate runner
  aborts at the first failing lane. Results (2026-09-13, isolated runs):
  - Full `@varve/engine`: 4886 passed, 5 skipped, **1 failed** —
    `lut/lut-edge.test.ts > edge cases — .3dl files > file with extra
    whitespace lines`, a pre-existing LUT parser failure unrelated to
    selection refinement (the same file already has baseline type errors).
    Every selection, morphology, matting, and background-removal test passes.
  - Combined engine + editor run before the last memory/shortcut edits:
    11 985 passed, 43 failed across 4 files, with 36 snapshot mismatches.
    The offending surfaces are concurrent-agent areas (LUT parsing,
    `nativeAdapter` menu snapshot, and other uncommitted UI work); the
    Inspector and tool surfaces touched here were re-run individually and
    pass (PropertiesPanel, FloatingToolbar, SelectionSourcesPanel,
    bgRemovalFeatures, both refine tools, then the engine subset again).
