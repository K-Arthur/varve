# Illustration view-proof checks — ownership

**Task:** session-only grayscale and mirror checks for concept-art review
**Owner:** illustration/concept-art integration
**Branch:** `master` (user-requested)
**Scope:** editor view only; no scene schema, saved-document, compositor, or export changes.

## Owned paths

| Path | Scope |
|---|---|
| `packages/editor/src/components/viewProofState.ts` and `.test.ts` | Ephemeral module store for the two review toggles; default off on reload. |
| `packages/editor/src/components/SoftProofOverlay.tsx` and `.test.tsx` | Apply view-only grayscale/mirror attributes to the existing `.editor-canvas`; reapply if the canvas is replaced. Mirror mode disables canvas pointer and keyboard input. |
| `packages/editor/src/components/SoftProofOverlay.css` | Isolated styles for the two display transforms. |
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` and `.test.tsx` | Add accessible switches and explain view-only, session-only behavior inside the existing proof controls. |
| `tests/e2e/paint/view-proof.spec.ts` | Real browser check that the display changes while the backing artwork pixels remain unchanged; capture Light, Dark, High Contrast, and narrow views. |
| `docs/architecture/viewport-guides-system.md` | Document the view-only boundary and mirror input lock. |
| `CHANGELOG.md` | Record the session-only canvas review capability for the next release. |

## Boundaries

Do not edit `CanvasArea.tsx`, `Shell.tsx`, `context.tsx`, `ViewportContext.tsx`, scene types, sampling, export, or renderer code. Reuse the existing `SoftProofOverlay` mount in Shell and existing Document panel. The editor view state must not enter document serialization, undo history, or export output. Keep the work independent of the active canvas-fluidity, viewport, GPU-renderer, and scene-schema owners.

## Validation

Before editing, run `pnpm verify:plan` against an isolated index containing only this slice. After implementation run `pnpm verify:plan`, `pnpm verify:affected`, focused component/store tests, and the leased one-worker Chromium E2E on an isolated port. Inspect all required captures. Run docs, emoji, and token audits selected by the planner; no full suite is expected because no schema or renderer contract changes.

### Results — 2026-09-29

- Focused tests passed: `pnpm exec vitest run packages/editor/src/components/SoftProofOverlay.test.tsx packages/editor/src/components/viewProofState.test.ts packages/editor/src/components/Inspector/panels/DocumentPanel.test.tsx --maxWorkers=1` (13 tests).
- Browser workflow passed: `VARVE_E2E_PORT=4385 node scripts/quality/heavy-lease.mjs "e2e: grayscale and mirror view-only proof" -- npx playwright test tests/e2e/paint/view-proof.spec.ts --project=chromium --workers=1 --reporter=list --output=test-results/view-proof-20260929-r2` (1 test).
- Inspected captures in `test-results/view-proof-20260929-r2/paint-view-proof-grayscale-b5dad-tay-view-only-across-themes-chromium/`: Light grayscale, reflected canvas, and narrow High Contrast. The canvas backing-pixel hash stayed unchanged during both views, and mirror mode blocked the attempted drawing gesture. Dark-mode capture was also inspected.
- `pnpm audit:docs`, `pnpm audit:inspector-css`, and `pnpm audit:sizing` passed. The initial standalone `pnpm audit:emoji` passed; the latest affected-planner rerun now detects an unrelated emoji in the concurrently added `packages/editor/src/findReplace/findReplaceSafety.test.ts:208`. `pnpm audit:tokens` passed all 324 contrast pairs but its usage scan stopped on the existing dynamic `bg-[var(--name)]` expression in `packages/codegen/src/tailwind.ts:685`. `pnpm audit:spacing` and `pnpm audit:radius` reported unrelated existing violations in Minimap and Presentation styles.
- `pnpm verify:affected --staged` selected the affected checks but stopped before Tier 1: its initial run stopped at the unrelated token-usage failure above, and the latest run stopped earlier at the unrelated emoji-audit hit above. E2E, editor, and desktop type checks also report pre-existing failures in presentation layout overrides, find/replace, and editor test typings.
- `pnpm exec vitest run packages/editor --maxWorkers=2` completed 864 files: 8,326 passed, 13 failed, and 2 skipped (8,341 tests total). The failures are in unrelated Find/Replace, workspace tool-visibility/registry/lifecycle, layer-panel configuration, dock property, and middle-button pan suites. No view-proof test failed.
- `pnpm exec vitest run apps/desktop --maxWorkers=1` passed all 80 tests across 13 files.
- The full repository suite was not run; this slice changes neither schema nor renderer contracts. Linux Tauri/WebKitGTK, physical stylus, and hardware-specific checks remain unverified.
