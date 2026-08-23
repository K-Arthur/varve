# Selection System Implementation Plan — 2026-08-23

## Phase 1: Pixel Lasso Tool (P0 — Highest Impact)

The most critical missing capability. `PolygonSelectionShape` exists in the engine but no tool creates it.

### 1.1 Refactor LassoTool into gesture adapters
- Extract shared lasso gesture logic (pointer sampling, simplification, draft overlay, keyboard handling) into a reusable `LassoGesture` module.
- Keep `LassoTool` as `ObjectLassoTool` adapter (selects scene nodes).
- Create `PixelLassoTool` adapter (creates `PolygonSelectionShape` in `AreaSelection`).

### 1.2 Implement PixelLassoTool
- Freehand mode: drag to draw polygon, pointer sampling with distance threshold.
- Polygonal mode: click to place vertices, Backspace/Enter/Escape.
- Keyboard modifiers: Shift=add, Alt=subtract, Shift+Alt=intersect, no modifier=replace.
- Uses `combineAreaSelections()` to merge with existing selection.
- Emits draft overlay for live feedback.
- Creates `PolygonSelectionShape` leaf in expression tree.

### 1.3 Register PixelLassoTool
- Add to tool registry with appropriate shortcut (e.g., `L` for object lasso, `Shift+L` cycles to pixel lasso, or separate shortcut).
- Update toolbar/menubar with pixel lasso option.

### 1.4 Tests
- Unit tests for `PolygonSelectionShape` coverage evaluation.
- Unit tests for `PixelLassoTool` gesture lifecycle.
- Unit tests for add/subtract/intersect with polygon selections.
- E2E test for pixel lasso workflow.

## Phase 2: Selection Refinement (P1)

### 2.1 Grow/Shrink
- For raster coverage: morphological dilation/erosion.
- For analytical shapes: consider geometric offset where practical.
- Bounded rasterization approach.

### 2.2 Smooth
- Gaussian blur on rasterized coverage.
- Contour simplification for analytical shapes.

### 2.3 Threshold
- Convert soft selection to hard selection at configurable threshold.
- Destructive transformation of coverage values.

## Phase 3: Selection Transform (P1)

### 3.1 Move selection boundary
- Transform analytical expression by translation matrix.

### 3.2 Scale/Rotate selection
- Apply affine transform to expression tree.
- May require rasterization for complex expressions.

## Phase 4: Selection Paint / Quick Mask (P1)

### 4.1 Selection Paint mode
- Rasterize active selection into bounded `MaskPlane`.
- Allow brush add/subtract on the plane.
- Apply/Cancel lifecycle with snapshot.

### 4.2 Selection Paint undo
- One stroke = one undo entry.

## Phase 5: Path ↔ Selection (P1)

### 5.1 Path → Selection
- Add `PathSelectionShape` to `AreaSelectionShape` union.
- Evaluate Bezier path fill at document-space points.

### 5.2 Selection → Path
- For analytical: extract contour geometry.
- For raster: contour tracing with threshold/simplification.

## Phase 6: Saved Area Selections (P1)

### 6.1 Data model
- `SavedAreaSelection { id, name, source, bounds, metadata }`.
- Storage in `document.savedSelections`.

### 6.2 UI
- Panel/section for save/load/rename/delete.

## Phase 7: Image-Derived Selections (P1/P2)

### 7.1 Alpha/Luminance source
- Sample image alpha or luminance as coverage.
- Produce `RasterMaskSelectionShape`.

### 7.2 Color Range
- OKLab distance-based selection.
- Tolerance + contiguous/global modes.

## Phase 8: Coverage Math (P2)

### 8.1 Selection Sources panel
- Combine: alpha, luminance, saved selections.
- Operations: add, subtract, multiply, min, max.

## Execution Order

1. **Phase 1** (Pixel Lasso) — start immediately
2. **Phase 2** (Refinement) — after pixel lasso is working
3. **Phase 3** (Transform) — independent, can parallel with Phase 2
4. **Phase 4** (Selection Paint) — depends on Phase 1 (pixel lasso creates polygon selections that feed into paint)
5. **Phase 5** (Path Conversion) — independent
6. **Phase 6** (Saved Selections) — depends on stable area selection model
7. **Phase 7** (Image Sources) — depends on raster mask infrastructure
8. **Phase 8** (Coverage Math) — advanced, after core is solid

## Progress (2026-08-23)

- **Phase 1 (Pixel Lasso)** — DONE. `PixelLassoTool` + shared `LassoGesture`, wired
  in `toolRegistry`/`ShortcutManager`/workspace toolbar; 46 selection unit tests green.
- **Phase 2 (Refinement)** — DONE (engine). `refineAreaSelection(selection,
  'grow'|'shrink'|'smooth'|'threshold', options)` in `packages/engine/src/areaSelection.ts`.
  Bounded rasterization (padded, capped at `MAX_AREA_SELECTION_DIMENSION`/`PIXELS`)
  with separable max/min dilation and box-blur smoothing; result re-wrapped as a
  bounded `raster-mask` shape.
- **Phase 3 (Transform)** — DONE (engine). `transformAreaSelection(selection, matrix)`
  in `packages/engine/src/areaSelection.ts`. Rectangles → 4-corner polygons,
  ellipses → 48-point polygons, polygons transform vertices in place, raster masks
  compose the matrix with their own transform/inverse (exact, point-sampled).
  Analytical expression preserved.
- **Editor UI wiring for P1 (Phase 2/3)** — DONE (code complete, committed on
  `selection/editor-ui`). Commands in `actions/createActionHandlers.ts`:
  `areaSelectionGrow`, `areaSelectionShrink`, `areaSelectionSmooth`,
  `areaSelectionThreshold` (refine) and `areaSelectionNudge{Up,Down,Left,Right}`,
  `areaSelectionScale{Up,Down}`, `areaSelectionRotate{CW,CCW}` (transform about the
  selection centre). Registration via a `pixelSelectionOps` block in
  `actions/registerAll.ts` (command palette + keywords, no shortcut bindings to
  avoid collisions). An Edit ▸ Pixel Selection submenu in `menu/defs.ts` with items
  enabled only when an area selection exists. Engine barrel (`index.ts`) now exports
  `refineAreaSelection`/`transformAreaSelection` + their types. 5 unit tests added to
  `createActionHandlers.test.ts`.
  - **Validation BLOCKED**: the editor test suite cannot load because of an unrelated,
    in-progress Layer States/PSD WIP module-load crash at
    `packages/import/src/psd.ts:31` (`PsdBlendMode.PassThrough` undefined). The editor
    typechecks clean in a stable tree, but the WIP tree is also being live-mutated by
    concurrent agents (intermittent `MenuContext.state` reverts), so editor
    tests/typecheck cannot be re-validated until that WIP lands.
- **Phase 5 (Path ↔ Selection)** — DONE (engine). `PathSelectionShape` added to the
  `AreaSelectionShape` union in `packages/engine/src/areaSelection.ts`; Bézier paths are
  flattened (bounded 64 segments/curve, cached per shape object) so coverage/bounds reuse
  the polygon machinery. `transformAreaSelection` composes the path's `transform` (curves
  stay exact). New `areaSelectionToPath(selection)` converts any selection to a closed
  vector path in document space: analytical shapes emit their exact contour; raster and
  combined expressions are traced from a bounded mask via Moore-Neighbor contour tracing
  (Jacob's stopping criterion) + Douglas–Peucker simplification. `PathCommand`/
  `PathSelectionShape`/`areaSelectionToPath` exported from the engine barrel. 10 unit
  tests in `packages/engine/src/areaSelectionPath.test.ts` (35 area-selection tests pass).
  - **Editor UI wiring for Phase 5** — pending (next turn): `pathToSelection` (convert the
    current object path/shape into a `PathSelectionShape`) and `selectionToPath` (convert
    the active area selection into a vector path node). Deferred until the Layer States WIP
    tree is stable and scene path-node creation is settled.
- **Phase 4 (Selection Paint / Quick Mask)** — DONE (engine). `paintSelectionMask(selection,
  stamps, options)` in `packages/engine/src/areaSelection.ts` rasterizes the active
  selection to a bounded `AlphaMask` working plane and composites circular brush dabs
  (`MaskBrushStamp`: doc-space centre/radius, `hardness`-driven falloff, `add` lifts
  coverage toward 255 / `subtract` pulls toward 0). Each dab composites independently so
  a stroke is deterministic; the painted plane is re-wrapped as a bounded `raster-mask`
  selection. Working-plane resolution is capped at `MAX_AREA_SELECTION_DIMENSION` and
  scaled down uniformly to respect `MAX_AREA_SELECTION_PIXELS` (16.7M) rather than
  throwing. `MaskBrushStamp`/`MaskBrushMode`/`PaintMaskOptions`/`paintSelectionMask`
  exported from the engine barrel. 6 unit tests in `areaSelectionPaint.test.ts` (41
  area-selection tests pass).
  - **Editor UI wiring for Phase 4** — pending (next turn): a Quick Mask tool that opens
    (rasterize current selection), paints (repeated `paintSelectionMask` calls or one
    batched call per stroke), applies/cancels, with **one undo entry per stroke** (the
    lifecycle the engine primitive is built around). Deferred until the Layer States WIP
    tree is stable.
- **Phases 6–8** — pending.
