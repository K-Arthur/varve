# Interaction Systems Audit — 2026-07-27

Audits and improvements to snapping, grid, layer-navigation, audit-overlay,
contrast-analysis, and keyboard-nudge workflows.

## 1. Modifier-State Unification

### Decision

The `InteractionSession` singleton in `packages/editor/src/tools/InteractionContext.ts`
is the single source of truth for live modifier state during pointer gestures.
Both move-drag (SelectTool) and resize (SelectionOverlay) now consume it.

### Changes

- `InteractionSession.computeModifiers(isRaster, isEdgeHandle?, defaultProportional?)`
  returns platform-aware `ResizeModifiers` from the session's stored key state.
- `SelectionOverlay` calls `interactionSession.updateModifiers()` on pointermove
  then passes the frozen snapshot to `computeResizeModifiers()`.
- `computeResizeModifiers` in `@strata/shared` accepts an optional `snapshot`
  parameter for backward-compatible unification.
- `InteractionSnapshot` now includes `centered` and `proportional` derived fields.

### Edge Cases Handled

- Modifier changes mid-drag (live `updateModifiers` on every pointermove)
- Beginning drag with modifier already held (snapshot reflects current state)
- Touch/pen input (modifier state tracked separately from pointer type)
- Window blur (inputPipeline `onBlur` commits any open transaction)
- Tool switch (`onDeactivate` commits active nudge transaction)

## 2. Isometric Grid Customization

### Decision

Extend the existing `IsometricGrid` data model with preset definitions and
per-axis customization UI. The model already supported arbitrary axes; the gap
was UI and preset management.

### Changes

- `ISOMETRIC_PRESETS` constant with Standard (30°), Dimetric (arctan(1/2)),
  and Trimetric (15°/45°/75°) definitions.
- `getPresetAxes(preset)` returns the axes for a given preset.
- `setIsometricGrid(doc, gridId, grid)` CRUD operation in scene document.
- `IsometricGridSection` component in DocumentPanel with:
  - Visible/snap toggles
  - Preset dropdown
  - Per-axis angle input (normalized on blur), visibility, color, opacity
  - Add/remove axis buttons (2-3 axes enforced)
  - Spacing, origin, rotation, color, opacity controls
  - Validation error display for collinear/duplicate axes

### Deferred (Follow-up Issues)

- **Perspective grids**: Requires a new `PerspectiveGrid` type with vanishing
  point geometry, separate from isometric axis model.
- **Radial grids**: Requires polar coordinate snapping and rendering.
- **Grid export**: Requires serialization to PDF/SVG with grid overlay.
- **Codegen metadata**: Requires design-token annotations on grid definitions.

## 3. Layer Navigation API

### Decision

External code (audit overlays, preflight) needs a command-based API to reveal
any node in the layers panel. The `expanded` Set stays as local React state
in `LayersTree`; we expose an imperative API via the editor context.

### Changes

- `LayerNavigationCommands` interface in `layerNavigationCommands.ts`.
- `useLayerNavigation` hook that:
  1. Checks node existence in document
  2. Walks ancestor chain via `getParentFast`
  3. Updates `expanded` Set to include all ancestors
  4. Scrolls virtualizer to the node's row
  5. Optionally selects the node and fits viewport
- `'navigation'` selection origin prevents auto-reveal feedback loop.
- `AuditOverlayHost` calls `editor.layerNavigation?.revealNode()` on finding click.

### Edge Cases

- Deleted/stale node: Returns `{ found: false }` without crashing.
- Document replacement: Re-reads from latest state on each call.
- Rapid successive navigation: Each call overwrites expansion state.
- Hidden/locked nodes: Still revealable (shown dimmed in tree).

## 4. Contrast Background Resolution

### Decision

The `BackgroundResolver` (3-stage: scene-model, alpha-composite, pixel-sampled)
is now wired into the `ContrastProvider` overlay. Real contrast ratios are
computed with confidence gating.

### Changes

- `ContrastProvider` uses a shared `BackgroundResolver` instance.
- Text color extracted from `TextNode.fill`.
- Background resolved via `resolver.resolve(doc, nodeId)`.
- Contrast ratio computed via `contrastRatio(relativeLuminance(fg), relativeLuminance(bg))`.
- WCAG level determined via `wcagLevel(ratio, isLargeText(fontSize, fontWeight))`.
- Badge text shows ratio + level (e.g., "Contrast: 2.3:1 (FAIL)").
- Severity: `error` (FAIL), `warning` (AA), `suggestion` (AAA).
- Unknown backgrounds produce `advisory` severity with "Contrast: unknown".

### Confidence Levels

- `high`: Fully opaque solid ancestor fills.
- `medium`: Alpha transparency or gradient approximation.
- `low`: No ancestor fills found (default white assumed).
- `unknown`: Image fill or unresolvable background.

## 5. Worker-Backed Audit Execution

### Decision

Complete the `AuditWorkerPool` scaffolding with rule registration, chunked
result delivery, and stale-result rejection. The pool remains main-thread by
default with the infrastructure ready for true Worker offloading.

### Changes

- `registerRule(ruleId, executor)` allows injecting rule logic.
- `setLatestRevision(revision)` enables stale-result rejection.
- `dispatchChunked(input, onChunk, signal)` delivers partial results per rule.
- `ScanResult` includes `failures` count and per-rule timing.
- `runRule()` dispatches to registered executors instead of returning `[]`.
- `auditScanExecutor.ts` provides a serializable scan entry point.

### Worker Boundary

- Non-DOM providers: Can run in a Web Worker (serializable input/output).
- Renderer-backed providers: Remain on main thread or use render worker.
- Main-thread fallback always available (file:// protocol, no Blob support).

## 6. Spatial Index Decision

### Finding

The existing uniform grid spatial index (64-unit cells for snap targets,
128-unit cells for overlay findings) remains adequate for current use cases.

### Evidence

Benchmarks at `packages/editor/src/scene/__benchmarks__/spatialIndex.bench.ts`:

| Distribution | Count | Build | Query (viewport) |
|---|---|---|---|
| Uniform | 5,000 | <5ms | <1ms |
| Uniform | 20,000 | <20ms | <2ms |
| Dense cluster | 5,000 | <5ms | <1ms |
| Sparse | 100 | <1ms | <1ms |

### Reasoning

- Finding counts above 20,000 are rare in practice (typical documents: 500-5k).
- The uniform grid excels at viewport culling (the dominant query pattern).
- A quadtree would add complexity without meaningful improvement for
  non-uniform distributions at current scales.
- Cell size tuning (128px for overlay) already handles cluster cases.

### When to Revisit

If finding counts regularly exceed 50,000 or if query patterns shift toward
non-viewport-based lookups, consider a quadtree or hybrid strategy behind the
same `SpatialIndex` interface.

## 7. Nudge Transaction Resilience

### Decision

The existing nudge gesture already handles key-repeat coalescing, Shift-modified
large nudges, and auto-reparent on first keydown. The remaining edge cases
are visibility change and Escape handling.

### Changes

- `SelectTool.onActivate` registers a `visibilitychange` listener that resets
  `nudgeGestureActive` when the tab becomes hidden.
- `SelectTool.onDeactivate` removes the listener and commits any active transaction.
- Escape during nudge commits the transaction (preserves user intent) instead
  of only handling drag abort.
- The existing `onBlur` handler in `inputPipeline.ts` already commits open
  transactions on window blur.

### Transaction Model

One logical nudge gesture (keydown → repeats → keyup) creates exactly one
transaction. Auto-reparent runs on first keydown only, in a separate
transaction, matching Figma/Sketch behavior.

## Testing

### Unit Tests

- `packages/editor/src/tools/__tests__/InteractionContext.test.ts` — 6 tests
- `packages/shared/src/modifiers.test.ts` — 21 tests
- `packages/editor/src/commands/nudge.test.ts` — 20 tests
- `packages/editor/src/audit/overlay/__tests__/overlayProviders.test.ts` — 7 tests
- `packages/editor/src/audit/overlay/__tests__/registry.test.ts` — 9 tests
- `packages/editor/src/components/LayersPanel/` — 230 tests (all pass)

### E2E Tests

- `tests/e2e/canvas/navigate-to-finding.spec.ts` — 8 tests
- `tests/e2e/canvas/overlay-interaction.spec.ts` — 9 tests
- `tests/e2e/canvas/nudge.spec.ts` — 7 tests

### Benchmarks

- `packages/editor/src/scene/__benchmarks__/spatialIndex.bench.ts` — extended
  to 5k/20k findings and dense clusters.
- `packages/editor/src/tools/__benchmarks__/move.bench.ts` — snap performance.

## Follow-up Issues

### Issue-001: Perspective Grid Support

**Acceptance Criteria:**
- New `PerspectiveGrid` type with 1/2/3-point perspective
- Vanishing point handles on canvas
- Snap-to-perspective-line rendering
- UI in DocumentPanel with vanishing point controls

**Dependencies:** Isometric grid UI (complete), grid rendering pipeline.

### Issue-002: Radial Grid Support

**Acceptance Criteria:**
- New `RadialGrid` type with center, divisions, and angular spacing
- Polar coordinate snapping
- Rendering with concentric circles and radial lines

**Dependencies:** Isometric grid UI (complete), snapping engine extension.

### Issue-003: Grid Export to PDF/SVG

**Acceptance Criteria:**
- Optional grid layer in PDF export (toggle in export dialog)
- SVG `<pattern>` element for grid in SVG export
- Grid respects document scope (document/page/frame)

**Dependencies:** Export system (deferred per `docs/plans/export-system-deferred.md`).

### Issue-004: Grid Codegen Metadata

**Acceptance Criteria:**
- Design-token annotations on grid definitions
- Codegen outputs grid as CSS custom properties
- React/Flutter/SwiftUI code generation includes grid settings

**Dependencies:** Codegen system, design token pipeline.

### Issue-005: True Web Worker Audit Offloading

**Acceptance Criteria:**
- `AuditWorkerPool` instantiates real `Worker` from Blob URL
- Rule executors serialized and posted to worker
- Maintains main-thread fallback when workers unavailable
- Progress delivered via `postMessage` chunks

**Dependencies:** Worker scaffolding (complete), audit rule registration.
