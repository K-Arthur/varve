# Interaction Systems — Architecture Notes

Date: 2026-07-27
Implements: Milestones 1-10 of the interaction systems audit.

## 1. InteractionContext and Snap Bypass

**Files:**
- `packages/editor/src/tools/InteractionContext.ts`
- `packages/editor/src/tools/SelectTool.ts`
- `packages/editor/src/tools/__tests__/InteractionContext.test.ts`
- `packages/editor/src/tools/__benchmarks__/move.bench.ts`

**Architecture:**
`InteractionSession` is a singleton service that tracks live modifier state
across an entire gesture (pointer-down to pointer-up). It supports:

- Live modifier updates while pointer is down (pressing/releasing Ctrl mid-drag)
- Frozen snapshots for consistent decision-making within one event handler
- Operation type tracking (move, resize, duplicate-drag, etc.)
- Per-gesture flag for duplication state
- Axis locking

Tools access it via `interactionSession.freeze().bypassSnap` instead of
ad-hoc `ctx.ctrlKey` checks. The frozen snapshot ensures that all snap
calculations within one pointer-move handler see the same state.

**Performance:** The freeze() call is O(1) and returns a cached frozen object
when state hasn't changed. The bypass path simply skips snapPosition() entirely.

**Coverage:** 6 unit tests.

## 2. Isometric Grid Config

**Files:**
- `packages/scene/src/gridTypes.ts`
- `packages/scene/src/types.ts`
- `packages/editor/src/components/DocumentGridOverlay/DocumentGridOverlay.tsx`
- `packages/editor/src/components/CanvasOverlays.tsx`

**Architecture:**
`IsometricGrid` is a new discriminated grid type with:

- `preset`: standard (30/150/90), dimetric (theta/180-theta/90), trimetric, custom
- `axes`: 2-3 axis definitions with per-axis visibility, colour, opacity
- `version` field for future migration
- Validation: 2-3 axes, no duplicates (<0.1 deg), no near-collinear (<5 deg)
- Sanitization: normalise angles to [0,360), clamp spacing, limit axes to 3

DocumentGridOverlay accepts an optional `isometricGrid` prop. When provided,
the grid renders using configurable angles and spacing from the object rather
than hardcoded `[30, 150, 90]`. Falls back to defaults when absent.

CanvasOverlays reads the first isometric grid from `doc.gridSettings.isometricGrids`
and passes it to DocumentGridOverlay.

**Deferred:** Perspective grids, radial grids, grid export, codegen metadata.
These should add new discriminated types to GridDefinition without breaking
existing code.

## 3. Layers Expansion API

**Files:**
- `packages/editor/src/components/LayersPanel/LayersTree.tsx`

**Architecture:**
Added `expandAncestors(nodeId)` to the `LayersDnDHandle` imperative API. This:

- Walks the parent chain from `nodeId` to root using `getParentFast`
- Expands each collapsed ancestor in the `expanded` Set
- Scrolls the virtualized row into view after expansion (via setTimeout for
  next tick after the setState takes effect)

The existing selection-change auto-reveal effect is unchanged. External callers
(like `useFindingNavigation`) can call `layersDndRef.current.expandAncestors(id)`
to reveal a node without changing selection.

The `expand-layers` step in `NavigationStep` type is now implementable via
this API, though it is not yet wired into `navigateToFinding`.

## 4. Findings Overlay View Menu

**Files:**
- `packages/editor/src/Menubar.tsx` (single-file menubar; `packages/editor/src/components/Menubar/index.ts` re-exports it)
- `packages/editor/src/menu/defs.ts` (menu item definitions, View menu section)
- `packages/editor/src/actions/createActionHandlers.ts`
- `packages/editor/src/context/types.ts`
- `packages/editor/src/context.tsx`
- `packages/editor/src/audit/overlay/useFindingsOverlay.ts`

**Architecture:**
View menu has a "Findings Overlay" item with submenu:

- Master toggle: Show/Hide Findings Overlay (calls toggleFindingsOverlay)
- Per-provider toggles: Contrast Issues, Vector Issues, DPI Warnings
  (disabled when master is off)

State: `findingsProviderOverrides: Record<string, boolean | undefined>` in
editor state. `setFindingsProviderOverride(providerId)` toggles individual
providers. `useFindingsOverlay` reads both `findingsOverlayVisible` and
`findingsProviderOverrides` from editor state and syncs them to the overlay
registry's toggle state.

## 5. Spatial Index for Overlay

**Files:**
- `packages/editor/src/audit/overlay/registry.ts`

**Architecture:**
The overlay registry previously built a spatial index (128px cells) as a side
effect but used a linear scan for viewport culling. Now uses `cullSpatial()`
which queries the spatial index to find only primitives in viewport-overlapping
cells, avoiding a full linear scan of potentially thousands of findings.

The grid index (128px cells) is retained over a quadtree because:
- Findings are badge/point/rect primitives, not spatial regions
- Viewport movement is typically small (cell reuse is high)
- The scan is called once per frame via rAF; the collect phase is the bottleneck
- Grid index builds in O(N), quadtree builds in O(N log N)
- Clustering (badge proximity) is distance-based, not spatial-index-based

Benchmark: `packages/editor/src/scene/__benchmarks__/spatialIndex.bench.ts`
validates grid index vs naive scan at 100/1k/5k/20k nodes.

## 6. Staged Background Resolver

**Files:**
- `packages/editor/src/audit/BackgroundResolver.ts`

**Architecture:**
Three stages with increasing cost and accuracy:

1. **Scene Model** (fast): Walk ancestor chain, alpha-over composite solid fills.
   Returns high/medium confidence. Handles nested frames, transparent fills,
   multiple fills, opacity.

2. **Alpha Composite** (medium): Handle gradients (average stop color) and
   semi-transparent compositing. Returns medium confidence with ambiguity reason.

3. **Pixel Sampled** (expensive): Delegate to renderer callback for pixel-accurate
   sampling. Falls back to "unresolvable" with explanation if no renderer.

Caching: Keyed by `(nodeId, sceneRevision)` to avoid re-computation on every
frame. Invalidated via `invalidate(sceneRevision)`.

## 7. Worker Audit

**Files:**
- `packages/editor/src/audit/auditWorker.ts`

**Architecture:**
`AuditWorkerPool` manages worker dispatch with:

- Configurable max workers (defaults to hardwareConcurrency)
- Job queue with timeout
- AbortSignal support for cancellation
- Fallback to main-thread execution when workers unavailable
- Provider-level failure isolation
- Per-rule timing collection

Renderer-backed providers (contrast with pixel sampling) remain on main thread
or use the render worker host. The boundary is documented: any provider that
needs `OffscreenCanvas`, DOM access, or the renderer must run on main thread.

## 8. Nudge Transaction Resilience

**Files:**
- `packages/editor/src/tools/SelectTool.ts`

**Fixes:**
- Auto-reparent index collision: nudge path now uses `insertIndexByParent` map
  (same as drag-end path) to ensure multiple nodes reparenting into the same
  frame get incrementing insertion indices instead of all at the same index.
- InteractionSession integration: nudge reset on deactivate/drag-cancel.

**Remaining edge cases (future work):**
- Blur/focus loss during nudge (commit on `visibilitychange`)
- Escape during nudge (abort or commit)
- Alt (0.5px fine) nudge step test coverage

## 9. Test Coverage

| Area | Unit Tests | E2E Tests |
|------|-----------|-----------|
| InteractionContext | 6 | — |
| Snap bypass (SelectTool) | Via existing SelectTool tests | — |
| Grid types (Isometric) | Via existing validate* tests | — |
| Layers expansion | Via existing expandCollapse tests | navigate-to-finding.spec.ts |
| Findings overlay | — | overlay-interaction.spec.ts |
| Nudge resilience | Via existing nudge.test.ts | nudge.spec.ts |
| Spatial index | spatialIndex.bench.ts | — |

## 10. Deferred / Follow-Up

| Feature | Reason | Acceptance Criteria |
|---------|--------|-------------------|
| Perspective grids | Not in scope | Data model extensible via new GridDefinition |
| Radial grids | Not in scope | Data model extensible via new GridDefinition |
| Grid export | Not in scope | Codegen metadata separated |
| Codegen metadata | Not in scope | Separate GridDefinition field |
| Full worker backend | Workers need Blob bundling | Workers available in production build |
