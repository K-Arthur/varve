# CanvasArea visual design audit — 2026-09-09

Status: scoped implementation record for the CanvasArea empty-surface pass.

This audit intentionally covers the editor canvas surface and its directly owned
visual state only. It does not redesign the shell, toolbars, Layers, Inspector,
rendering algorithms, or the underlying command model.

## Current UI map

| Surface | Owner | Visual source | Role in this pass |
|---|---|---|---|
| Desktop editor entry | `apps/desktop/src/App.tsx` | app/editor entry styles | Runtime host; unchanged |
| Canvas surface | `packages/editor/src/CanvasArea.tsx` | `packages/editor/src/editor.css` | Owns the content canvas, overlay canvas, drop state, and empty guidance |
| Canvas overlays | `packages/editor/src/components/CanvasOverlays.tsx` | overlay-specific styles and camera helpers | Rulers, selection, guides, minimap, and editor-only overlays; unchanged |
| Render lifecycle | `packages/editor/src/canvas/renderPipeline.ts` and `canvas/perfRuntime.ts` | Canvas 2D/compositor path | Correctness and performance boundary; unchanged |
| Shared visual tokens | `packages/ui/src/tokens/tokens.css` | semantic surface, text, radius, elevation, and spacing tokens | Reused; no new token family introduced |
| Marketing surface | `apps/website/src/pages/features/canvas.astro` | website tokens and feature-page styles | Documents the real empty-surface behavior |
| Browser visual evidence | `tests/e2e/workspace/visual.spec.ts`, `tests/e2e/canvas/canvas-area-visual.spec.ts` | Playwright snapshots | Full composition plus isolated CanvasArea state |

## Baseline diagnosis

The existing editor already has a restrained, dense visual language: a cool
sunken canvas surround, crisp panel edges, compact controls, a zoom-aware grid,
and explicit stacking for the opaque canvas layers. The important visual failure
was state-specific rather than global:

1. A newly created Design Canvas appeared to be a blank viewport. The existing
   guidance was gated by `state.document.rootChildren.length`, but that array
   contains the Design Canvas container, not authored artwork.
2. The guide's `z-index: var(--z-base)` left it below the opaque content canvas.
   The bug was most visible in light theme; the same layering was not a safe
   cross-theme contract.
3. Once made visible, the old guidance was a loose line of low-emphasis text.
   It did not provide a clear first hierarchy for a professional editing surface
   and its shortcut keys were not visually grouped.

The pre-change full-editor captures were taken at 1280×720 in light, dark, and
high-contrast themes before commit `9adb886fa`. The local review captures live in
the ignored `docs/screenshots/multi-window/` directory. The committed visual
baselines show the before/after change in Git history, and the after state is
represented by the full-editor and CanvasArea-specific snapshots listed below.

## Prioritized findings

| Finding | Location / evidence | Severity | Root cause | Affected surface | Recommendation | Status |
|---|---|---:|---|---|---|---|
| New canvases look unresponsive | `CanvasArea.tsx` empty-state gate; all three `workspace/visual.spec.ts` theme cases failed before the fix because `.editor-canvas__empty-state` was absent | P1 | Document-level container roots were used instead of active-canvas artwork roots | CanvasArea empty state | Derive emptiness from the existing scoped `rootNodes()` read model | Done |
| Guidance can be occluded by artwork layers | `.editor-canvas__empty-state` used `z-base` while content/overlay canvases use z 2/3 | P1 | Stacking contract was not applied to the guidance layer | CanvasArea layer composition | Place pointer-transparent guidance above opaque canvas layers | Done |
| Empty-state hierarchy is too quiet and ungrouped | Existing `.editor-canvas__empty-state-*` rules in `editor.css`; baseline had no visible state, and the old rule was plain text | P2 | No surface anatomy or shortcut-item styling | Empty Canvas guidance | Use one compact raised surface, title → shortcut group → hint, with existing tokens | Done |
| Narrow-window behavior was not directly covered by a CanvasArea visual scenario | Existing full-editor visual coverage is desktop-sized | P2 | The state had unit coverage but no scoped browser geometry check | Small canvas viewports | Add a direct visual spec and assert the card remains within the canvas | Done |
| Populated-canvas chrome remains a broader visual review area | CanvasArea owns several layers, while rulers/minimap/selection are composed by `CanvasOverlays` | P3 | The task boundary intentionally excludes shell and overlay redesign | Populated editor | Continue in a later CanvasOverlays-specific pass; do not add duplicate controls here | Deferred |

## Design direction adopted

- Canvas first: the empty state is a quiet orientation surface, not a dashboard
  card and not a second toolbar.
- Dense but legible: use the existing compact spacing and type tokens; make the
  title the only strong emphasis, with shortcut labels secondary and the import
  hint tertiary.
- One surface level: one subtle border, one existing raised elevation, and no
  decorative gradient or new color token.
- Theme-native: the same semantic recipe is used in light, dark, and
  high-contrast themes; high contrast naturally resolves the existing elevation
  token to an outline treatment.
- Stable interaction geometry: the guide is pointer-transparent and its content
  wraps within a bounded width at small canvas sizes. Existing keyboard commands
  remain the source of truth.

## Component and token consolidation plan

| Decision | Outcome |
|---|---|
| Empty-state primitive | Keep CanvasArea's inline variant. The shared `EmptyState` component supports CTA content and different semantics; replacing this specialized editor hint with a generic card would add indirection without consolidating equivalent behavior. |
| State source | Use the existing `rootNodes()` scope. No duplicate document-root calculation was introduced. |
| Visual tokens | Reuse `surface-raised`, `surface-sunken`, `text-primary`, `text-secondary`, `text-muted`, `border-subtle`, `radius-card`, `elevation-shadow-raised`, and existing spacing tokens. |
| Variants | Preserve workspace-specific title, shortcut, and hint content through `getEmptyStateContent()`. The visual anatomy remains shared. |
| Migration order | Land the state correction and surface anatomy first; add isolated browser visual evidence; document the contract; leave shell and overlay consolidation for a separate scoped pass. |

## Feature-access map

| Existing capability | Primary access | Contextual access | Accelerated access | Shared implementation / duplication decision |
|---|---|---|---|---|
| Start a shape, frame, text, or pen action | Existing CanvasArea input surface and tool system | Existing tool selection surfaces | Keyboard shortcuts shown by the empty guide and registered shortcut system | The guide displays existing commands only; it does not add handlers or duplicate buttons |
| Place an image | Existing canvas file-drop surface | Existing drop target and mask-target behavior | Existing file/import commands | The hint remains descriptive; no dead “Import” button was added |
| Navigate the canvas | Existing canvas gesture surface and camera system | Existing rulers, minimap, and view controls | Existing keyboard/wheel/pinch shortcuts | No second navigation control was introduced in CanvasArea |

## Implemented changes

### Empty-state behavior and surface anatomy

Files:

- `packages/editor/src/CanvasArea.tsx`
- `packages/editor/src/CanvasArea.emptyState.test.tsx`
- `packages/editor/src/editor.css`

`isCanvasEmpty()` now receives the already scoped root nodes, and CanvasArea uses
`rootNodes()` when deciding whether the active surface needs guidance. The guide
is above the opaque canvas layers, remains `pointer-events: none`, uses a bounded
token-based surface, and wraps shortcut items without changing the command or
document model.

### Browser evidence

Files:

- `tests/e2e/canvas/canvas-area-visual.spec.ts`
- `tests/e2e/canvas/canvas-area-visual.spec.ts-snapshots/`
- `tests/e2e/workspace/visual.spec.ts-snapshots/full-editor-*.png`

The dedicated spec covers light, dark, and high-contrast isolated guidance,
pointer transparency, active-canvas visibility, and a 560px narrow viewport.
The existing full-editor scenarios provide composition-level evidence. The
updated images were opened and reviewed for alignment, clipping, hierarchy,
theme separation, and interaction-safe layering.

### Marketing website

`apps/website/src/pages/features/canvas.astro` now describes the empty-surface
state as a real CanvasArea behavior and adds it to the capability list. The
copy deliberately describes the scoped guide and its disappearance once artwork
exists; it does not promise a new action surface or universal performance result.

## Residual design-debt register

| Item | Severity | Why unresolved | Next action |
|---|---:|---|---|
| Full populated CanvasArea composition review across all tools | P3 | Rulers, minimap, selection, and editor overlays are separate owners and were not changed in this slice | Run a separate CanvasOverlays visual audit with populated fixtures |
| Native WebView theme/rendering matrix | P2 | This session has executable Linux Chromium evidence only | Repeat the same snapshots in Tauri/WebKitGTK and platform WebViews at release checkpoints |
| Shared full-editor snapshots include other shell surfaces | P3 | The repository's existing full composition scenario intentionally covers the whole workspace | Keep isolated CanvasArea snapshots as the stable local contract; update full composition only for intentional whole-screen changes |

## Validation record

Changed scope: CanvasArea empty-state source selection and visual anatomy,
CanvasArea unit/browser evidence, Canvas 2D architecture notes, and the canvas
feature-page copy/styles.

Validation plan: `pnpm verify:plan` selected the current dirty worktree's
affected editor/website closure; unrelated pre-existing changes also appeared
in that plan. Full-suite escalation was `NO`.

Commands run for this slice:

- `pnpm verify:plan`
- `pnpm exec vitest run packages/editor/src/CanvasArea.emptyState.test.tsx`
- `pnpm exec biome check --write packages/editor/src/CanvasArea.tsx packages/editor/src/CanvasArea.emptyState.test.tsx packages/editor/src/editor.css`
- `pnpm exec playwright test tests/e2e/workspace/visual.spec.ts --project=chromium --grep "full editor layout" --reporter=list` (pre-fix reproduction: 3 expected failures)
- `pnpm exec playwright test tests/e2e/workspace/visual.spec.ts --project=chromium --grep "full editor layout" --update-snapshots --reporter=list` (3 passed)
- `pnpm exec playwright test tests/e2e/canvas/canvas-area-visual.spec.ts --project=chromium --update-snapshots --reporter=list` (3 passed)
- `pnpm exec biome check --write tests/e2e/canvas/canvas-area-visual.spec.ts`

The commit checkpoint additionally passed staged Biome, emoji, health,
boundary, secret, contact, E2E typecheck, and the focused CanvasArea unit test.
The full repository suite, native GUI matrix, and broad Playwright matrix were
not run because the validation planner did not escalate them.
