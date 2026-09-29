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

## Boundaries

Do not edit `CanvasArea.tsx`, `Shell.tsx`, `context.tsx`, `ViewportContext.tsx`, scene types, sampling, export, or renderer code. Reuse the existing `SoftProofOverlay` mount in Shell and existing Document panel. The editor view state must not enter document serialization, undo history, or export output. Keep the work independent of the active canvas-fluidity, viewport, GPU-renderer, and scene-schema owners.

## Validation

Before editing, run `pnpm verify:plan` against an isolated index containing only this slice. After implementation run `pnpm verify:plan`, `pnpm verify:affected`, focused component/store tests, and the leased one-worker Chromium E2E on an isolated port. Inspect all required captures. Run docs, emoji, and token audits selected by the planner; no full suite is expected because no schema or renderer contract changes.
