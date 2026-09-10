# Selection System Audit — 2026-08-23

## 1. Initial State

### What Varve Already Supports

#### Node Selection (Object Selection) — Mature
| Capability | Status | Evidence |
|---|---|---|
| Click to select | **Complete** | `SelectTool.ts:235-270` — click + deep Ctrl-click |
| Shift-click toggle | **Complete** | `SelectTool.ts:270-290` |
| Deep selection (Ctrl-click) | **Complete** | `HitTestEngine.ts:330-380`, `deep-selection.spec.ts` |
| Object marquee (drag on canvas) | **Complete** | `SelectTool.ts:320-490` — uses `marqueeGeometryHit()` |
| Object lasso (freehand) | **Complete** | `LassoTool.ts` — freehand + polygon modes, tests nodes |
| Object lasso (polygonal) | **Complete** | `LassoTool.ts:140-200` — click-to-place, Enter/Backspace/Escape |
| Add/Subtract/Intersect | **Complete** | `selectionOperations.ts` — shift/alt/shift+alt modifiers |
| Containment vs Intersection | **Complete** | `marqueeUsesContainment()` via Ctrl modifier |
| Selection overlay handles | **Complete** | `SelectionOverlay.tsx` — 8 resize, rotation, skew, corner radius |
| Spatial broad-phase | **Complete** | `spatialIndex.ts` — 64-unit grid, incremental updates |
| Transform caching | **Complete** | `transformCache.ts` — lazy, dirty-set invalidation |
| Parent index caching | **Complete** | `buildParentIndexMap()` used everywhere |
| Hit-test policies (9) | **Complete** | `HitTestPolicy.ts` — hover, click, deepSelect, touch, pen, etc. |
| Isolation | **Complete** | `scopeRootId` in hit-test policy |
| Selection sets (named node groups) | **Complete** | `selectionSet.ts` — CRUD, scope, reorder |
| Select by properties | **Complete** | `selectSimilar` by type/fill/stroke/opacity/font/etc. |
| Object selection persistence (session) | **Complete** | Stored in `EditorState.selection` |
| Keyboard navigation (Tab, arrows) | **Complete** | `SelectTool.ts:628-764` |
| Locked/hidden node policy | **Complete** | `isMarqueeSelectableNode()`, `filterCandidatesByPolicy()` |
| Clip-mask respect in hit-test | **Complete** | `isPointVisibleThroughClipMasks()` |

#### Area Selection (Pixel Selection) — Partial
| Capability | Status | Evidence |
|---|---|---|
| Rectangular marquee | **Complete** | `MarqueeTool.ts` — rectangle kind, full drag support |
| Elliptical marquee | **Complete** | `MarqueeTool.ts` — ellipse kind via constructor |
| Replace operation | **Complete** | Default operation in marquee tools |
| Add operation | **Complete** | Shift+drag in marquee tools |
| Subtract operation | **Complete** | Alt+drag in marquee tools |
| Intersect operation | **Complete** | Shift+Alt+drag |
| Fixed ratio | **Complete** | `MarqueeTool.ts:134-145` |
| Fixed size | **Complete** | `MarqueeTool.ts:147-155` |
| From center | **Complete** | `MarqueeTool.ts:157-165` |
| Analytical expression tree | **Complete** | `areaSelection.ts` — recursive `AreaSelectionExpression` |
| Feathering (signed-distance) | **Complete** | `smoothCoverage()` — linear ramp over feather radius |
| Antialias (supersampling) | **Complete** | `rasterizeAreaSelection` — configurable 1-8x samples |
| Fractional coverage (0-1) | **Complete** | `areaSelectionCoverageAt()` returns continuous float |
| Bounded rasterization | **Complete** | `rasterizeAreaSelection()` — finite integer bounds only |
| Generation-based invalidation | **Complete** | `AreaSelection.generation` bumped on every mutation |
| Marching-ants overlay | **Complete** | `overlayManager.tsx:drawAreaSelectionBoundary()` |
| Reduced-motion support | **Complete** | Phase animation respects `prefers-reduced-motion` |
| Inversion (bounded) | **Complete** | `invertAreaSelection()` — domain-bounded, page-relative |
| Select All (context-aware) | **Complete** | `createActionHandlers.ts:160-177` — marquee tools select page area |
| Paint clipping (all tools) | **Complete** | `selectionCoverageForDab()` — bounded per-dab mask |
| Selection→Mask conversion | **Complete** | `selectionMask.ts:rasterizeAreaSelectionForNode()` |
| Mask→Selection conversion | **Complete** | `selectionMask.ts:areaSelectionFromMaskPixels()` |
| Fractional coverage in mask bridge | **Complete** | Bilinear interpolation, 4x antialias option |
| Selection snapshot at stroke start | **Complete** | `PaintTool.ts:300` — frozen in session |
| Ephemeral (not document state) | **Complete** | `areaSelection` is editor session state only |
| Escape behavior (hierarchical) | **Complete** | `MarqueeTool.ts:103-107` — cancel gesture, then clear selection |

#### Pixel Lasso — Missing
| Capability | Status | Evidence |
|---|---|---|
| Pixel freehand lasso | **Unsupported** | No tool creates `PolygonSelectionShape` |
| Pixel polygonal lasso | **Unsupported** | `PolygonSelectionShape` type exists but no tool uses it |
| Pixel lasso add/subtract/intersect | **Unsupported** | No tool |
| Pixel lasso keyboard modifiers | **Unsupported** | No tool |

#### Selection Refinement — Missing
| Capability | Status | Evidence |
|---|---|---|
| Grow / Shrink | **Unsupported** | No code |
| Smooth | **Unsupported** | No code |
| Threshold | **Unsupported** | No code |
| Edge cleanup | **Unsupported** | No code |
| Selection Paint (Quick Mask) | **Unsupported** | No code |
| Selection transform (scale/rotate) | **Unsupported** | No code |

#### Path ↔ Selection — Missing
| Capability | Status | Evidence |
|---|---|---|
| Path → Area Selection | **Unsupported** | No conversion code |
| Area Selection → Path | **Unsupported** | No conversion code |
| Node Shape → Area Selection | **Unsupported** | No conversion code |
| Bézier selection shape | **Unsupported** | Not in `AreaSelectionShape` union |

#### Saved Area Selections — Missing
| Capability | Status | Evidence |
|---|---|---|
| Save area selection | **Unsupported** | No `SavedSelection` type |
| Load saved selection | **Unsupported** | No code |
| Saved selection panel | **Unsupported** | No UI |
| Saved selection persistence | **Unsupported** | No storage |

#### Image-Derived Selections — Missing
| Capability | Status | Evidence |
|---|---|---|
| Select from alpha | **Unsupported** | No code |
| Select from luminance | **Unsupported** | No code |
| Select by color range | **Unsupported** | No code |
| Select by focus | **Unsupported** | No code |
| Select Subject (AI) | **Partial** | SAM2 segmentation exists but doesn't produce `AreaSelection` |
| Coverage Math | **Unsupported** | No code |

#### Selection Persistence (Per-Document) — Missing
| Capability | Status | Evidence |
|---|---|---|
| Area selection saved in document | **Unsupported** | Ephemeral only |
| Per-page selection | **Unsupported** | Global editor state |

---

## 2. Domain Model

### Three Selection Domains (Must Stay Separate)

```
┌─────────────────────────────────────────────────────────────┐
│  NODE SELECTION                                              │
│  ─────────────                                               │
│  Data: NodeId[] (ordered set)                                │
│  Storage: EditorState.selection (ephemeral session)          │
│  UI: SelectionOverlay (handles, bounding box)               │
│  Operations: click, shift-click, marquee, lasso, Tab, arrows│
│  Persistence: SelectionSets (named groups in document)       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  AREA SELECTION (Pixel/Coverage)                             │
│  ───────────────────────────────                             │
│  Data: AreaSelection (expression tree of shapes)             │
│  Storage: EditorState.areaSelection (ephemeral session)      │
│  UI: Marching-ants boundary overlay                          │
│  Operations: marquee, lasso (future), paint, refinement      │
│  Rasterization: bounded per consumer request                 │
│  Persistence: Saved Selections (future, explicit save only)  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SELECTION SETS (Named Node Groups)                          │
│  ──────────────────────────────────                          │
│  Data: { id, name, nodeIds[], scope }                       │
│  Storage: document.selectionSets (persistent document state) │
│  UI: SelectionSetsSection in LayersPanel                     │
│  Purpose: shortcuts for re-selecting object groups           │
│  Note: NOT area-selection persistence                        │
└─────────────────────────────────────────────────────────────┘
```

### Saved Area Selections (Future — Distinct from Selection Sets)

```
┌─────────────────────────────────────────────────────────────┐
│  SAVED AREA SELECTION (Future)                               │
│  ─────────────────────────────                               │
│  Data: { id, name, source: analytical | rasterAsset }       │
│  Storage: document.savedSelections (persistent)              │
│  UI: Saved Selections panel/section                          │
│  Purpose: persist complex coverage for later reuse           │
│  Note: NOT node Selection Sets                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Bugs Found

### Bug 1: Two Independent `AlphaMask` Interfaces
- **Location:** `packages/engine/src/areaSelection.ts:117` and `packages/engine/src/segmentation/maskAlgebra.ts:5`
- **Impact:** Structurally identical but separate TypeScript types; no import relationship. Could confuse consumers and prevent shared utilities.
- **Root cause:** Separate feature tracks (area selection vs SAM2 segmentation) developed independently.
- **Recommendation:** Unify into a single `AlphaMask` type in `@varve/engine`.

### Bug 2: `PolygonSelectionShape` Exists but Has No Producer
- **Location:** `packages/engine/src/areaSelection.ts:64` defines `PolygonSelectionShape` but no tool creates one.
- **Impact:** Dead type. The polygon coverage evaluator works but is unreachable.
- **Root cause:** Polygon selection was anticipated but never implemented.
- **Recommendation:** Implement Pixel Lasso tool (this audit's primary deliverable).

### Bug 3: `RefineMaskTool` Does Not Honor Active Area Selection
- **Location:** `packages/editor/src/tools/RefineMaskTool.ts`
- **Impact:** When refining a background-removal mask with a brush, an active pixel selection is ignored. The brush paints unrestricted.
- **Root cause:** `RefineMaskTool` uses `createBrushMask()` directly, bypassing `selectionCoverageForDab()`.
- **Recommendation:** Add selection coverage sampling to `RefineMaskTool` paint path.

### Bug 4: Overlay Boundary for Complex Expressions May Exceed Segment Cap
- **Location:** `packages/editor/src/tools/selectionMask.ts:244` — `MAX_BOUNDARY_SEGMENTS = 250_000`
- **Impact:** Very complex raster masks silently truncate boundary visualization. The marching ants may not close.
- **Root cause:** Protective cap to prevent DOM/canvas overload.
- **Recommendation:** Consider marching-squares contour tracing for smoother, fewer segments. Not a bug per se, but a UX limitation.

### Bug 5: LassoTool Object Intersection Uses Bounds-Only Test for Non-Primitive Nodes
- **Location:** `packages/editor/src/tools/marqueeGeometry.ts:155-160` — containers/paths fall back to AABB intersection.
- **Impact:** A large rotated group with small visible content may be falsely selected by a lasso that intersects only the AABB.
- **Root cause:** Performance tradeoff — exact path intersection for arbitrary node trees is expensive.
- **Recommendation:** Acceptable for P0. Consider geometry-aware test for paths/text in future.

---

## 4. Geometry

### Marquee
- **Rectangle:** Axis-aligned in document space. Drag either direction produces non-negative w/h. Normalized via `normalizeMarqueeRect()`.
- **Ellipse:** Mathematically elliptical in document space. Coverage evaluator normalizes to unit-ellipse space. Not approximated by bounding rectangle.
- **Fixed ratio/size/from-center:** All supported in `MarqueeTool.ts:134-165`.
- **Transform-aware:** Coverage evaluator operates in document space; rasterization for masks correctly handles image transforms.

### Lasso (Object Only Currently)
- **Freehand:** Pointer sampling with distance threshold. `simplifyPolygon()` in `lassoGeometry.ts:103-118` for point reduction.
- **Polygonal:** Click-to-place, Backspace undo, Enter commit, Escape cancel, closure near first point.
- **Intersection test:** `polygonIntersectsBounds()` — three-phase (point-in-rect, rect-in-polygon, segment-segment). Even-odd fill rule.

### Expression Tree
- Binary tree of shapes combined via `add`/`subtract`/`intersect`.
- `replace` handled at API level (discards old expression).
- Unbounded nesting depth — no guard against pathological depth.

---

## 5. Coverage

### Feathering
- **Model:** Signed-distance-based linear ramp. `smoothCoverage(signedDistance, feather)` maps [-feather, +feather] to [0, 1].
- **Per-shape:** Each shape carries its own feather value. Feather is evaluated at shape level, not expression level.
- **Document space:** Feather radius is in document units, not screen pixels. Zoom-invariant.
- **Tested:** `areaSelection.test.ts` verifies interior, boundary, and exterior coverage.

### Antialiasing
- **Model:** Supersampled rasterization. `antialias` boolean on shapes; `samples` parameter controls grid density (1-8x).
- **Effect:** Hard edges get smooth coverage transitions when `samples > 1`. Soft edges (feathered) already have continuous coverage.
- **Tested:** `areaSelection.test.ts` tests 4x4 antialiased ellipse.

### Fractional Coverage
- **Continuous [0, 1]:** `areaSelectionCoverageAt()` returns float. Not boolean.
- **Paint integration:** `CoverageMask` is 8-bit (0-255), sampled per-pixel in compositors. Multiplicative with brush mask.
- **Mask bridge:** Bilinear interpolation in `sampleDecodedAlpha()`. 4x antialias option in `rasterizeAreaSelectionForNode()`.

---

## 6. Object Selection

### Hit Testing
- **Two-phase:** Spatial index broad phase → precise geometry narrow phase.
- **Three-tier shape hit:** (1) stroke proximity via Bezier closest-point, (2) exact containment via `shapeContains()`, (3) bounding-box tolerance.
- **9 policies:** hover, click, deepSelect, touch, pen, contextMenu, marquee, touchDeepSelect, debug.
- **Clip-mask traversal:** Walks ancestor chain, tests mask geometry + inversion.
- **Performance:** Scaling tests verify near-linear (not quadratic) with candidate count.

### Deep Selection
- **Ctrl/Cmd+click:** Returns deepest non-container child via `preferLeaves` policy.
- **Fallback:** Falls back to container when no child hits.
- **Isolation:** `scopeRootId` limits hit-test to subtree.

### Spatial Performance
- **64-unit grid cells:** Point and rect queries.
- **Incremental updates:** `updateSpatialIndexNodes()` — O(changed) not O(document).
- **Transform cache:** Lazy computation with dirty-set invalidation.
- **Parent index:** O(1) per-node ancestor lookup.

---

## 7. Pixel Selection

### Marquee Tools
- **Rectangle and ellipse:** Both use `MarqueeTool` with different `kind` parameter.
- **Analytical expression:** Creates `RectangleSelectionShape` or `EllipseSelectionShape` leaf nodes.
- **Boolean combine:** `combineAreaSelections()` wraps into `combine` expression nodes.
- **Draft overlay:** Live dashed rectangle/ellipse during drag via `ctx.setDraft()`.
- **Final overlay:** Marching ants via `drawAreaSelectionBoundary()`.

### What's Missing
- **No pixel lasso tool** — `PolygonSelectionShape` exists but has no producer.
- **No selection transform** — cannot move/scale/rotate the active selection boundary.
- **No selection refinement** — no grow/shrink/smooth/threshold.

---

## 8. Selection Paint

### Architecture
- **No Quick Mask / Selection Paint mode exists.**
- `RefineMaskTool` is mask-brush-only (background removal refinement), not a general selection editing mode.
- The infrastructure is ready: `CoverageMask` + `compositeMaskDab()` + `areaSelectionCoverageAt()` could power a selection paint mode.

### What Would Be Needed
1. Temporarily rasterize active selection into bounded `MaskPlane`.
2. Allow brush add/subtract on the plane.
3. Convert result back to `RasterMaskSelectionShape`.
4. Snapshot + cancel/apply lifecycle.

---

## 9. Masks

### Selection → Mask
- **Working:** `rasterizeAreaSelectionForNode()` converts analytical selection to raster mask PNG.
- **Coordinate-aware:** Handles image transforms (fit/crop/rotate/flip) and frame-local space.
- **Fractional coverage preserved.**
- **Bounds enforced:** 16384 max dimension, 16M max pixels.

### Mask → Selection
- **Working:** `areaSelectionFromMaskPixels()` converts decoded mask pixels to `RasterMaskSelectionShape`.
- **Boundary extraction:** Contour tracing up to 250K segments for marching ants.
- **Coordinate mapping:** Restores document-space via stored transforms.

### Round-Trip
- **Tested:** `selectionMask.test.ts` verifies soft mask alpha survives round-trip.

---

## 10. Paths

### Path ↔ Selection
- **Not implemented.** No conversion code exists.
- **Type gap:** `AreaSelectionShape` has no `path` kind. Bézier geometry would need to be added.
- **Existing infrastructure:** Varve has full Bezier path geometry, `pointInPolygon()`, `isPointNearPath()`, and the image trace system's path fitting. These could be reused.

---

## 11. Saved Selections

### Current State
- **No saved area selections.** `SelectionSets` are named node-ID groups, not coverage data.
- **No `SavedSelection` type** exists anywhere in the codebase.

### What's Needed
- A new `SavedAreaSelection` type in `@varve/scene`.
- Storage in `document.savedSelections`.
- Panel/section UI for save/load/rename/delete.
- Both analytical and raster forms.

---

## 12. Image-Derived Selections

### Current State
- **SAM2 segmentation** exists (`Sam2SegmentationTool.ts`) but produces a raster mask, not an `AreaSelection`.
- **No alpha/luminance/color/focus selection** code exists.

### What's Needed
- `selectionFromAlpha(doc, nodeId)` — sample image alpha as coverage.
- `selectionFromLuminance(doc, nodeId)` — compute luminance as coverage.
- `selectionFromColorRange(doc, nodeId, color, tolerance)` — color-distance coverage.
- All should produce `AreaSelection` with `RasterMaskSelectionShape`.

---

## 13. Channel/Coverage Features

### Intentionally Not Copied
- **Split/Merge Channels:** Not useful for Varve's mixed vector/raster architecture.
- **Spot channels:** Print-specific, belongs in `varve-print` not selection system.
- **Channel panel:** Would conflate color components with selection coverage.

### Varve-Native Adaptation
- **Coverage Math** could combine: alpha, luminance, color components, saved selections, current selection.
- **Operations:** add, subtract, multiply, min, max, difference, intersect.
- **Deferred to P2.**

---

## 14. Performance

### Preserved Optimizations
| Optimization | Location | Impact |
|---|---|---|
| Spatial index broad phase | `spatialIndex.ts` | O(1) candidate lookup |
| Incremental index updates | `updateSpatialIndexNodes()` | O(changed) per frame |
| Transform cache | `transformCache.ts` | Avoids redundant group recomputation |
| Parent index | `buildParentIndexMap()` | O(1) ancestor lookup |
| Bounded paint masks | `selectionCoverageForDab()` | Per-dab allocation, not per-canvas |
| Bounded rasterization | `rasterizeAreaSelection()` | Finite bounds only |
| Snapshot at stroke start | `PaintTool.ts:300` | No mid-stroke selection re-read |
| Mask render proxy | `maskRenderCache.ts` | Caps live rendering at 2048px |
| Boundary segment cap | `selectionMask.ts:244` | 250K max segments |

### No Regressions Detected
- Object marquee uses spatial index (not O(N) scan).
- Object lasso uses `polygonIntersectsBounds()` with node walk (not full geometry).
- Selection coverage is computed per-dab, not per-canvas.

---

## 15. Tests

### Unit Tests (Selection-Related)
| File | Lines | Coverage |
|---|---|---|
| `areaSelection.test.ts` | 104 | Rectangle/ellipse rasterization, feathering, boolean algebra, inversion |
| `selectionOperations.test.ts` | 44 | Modifier resolution, set algebra, deduplication |
| `marqueeGeometry.test.ts` | 73 | Normalization, boundary, containment, rotated precision |
| `selectionCoverage.test.ts` | 45 | Identity + translated world-transform mapping |
| `selectionMask.test.ts` | ~80 | Round-trip soft mask through area selection domain |
| `HitTestEngine.test.ts` | 370 | All hit policies, deep select, clip masks, scaling |
| `SelectionOverlay.test.tsx` | 557 | Resize, rotation, handles, accessibility |
| `MaskSection` (component) | — | Mask type switching, visibility, invert |
| `lassoGeometry` | — | `Point2D`/`Rect` intersection, simplification |

### E2E Tests (Selection-Related)
| File | Lines | Coverage |
|---|---|---|
| `deep-selection.spec.ts` | 308 | Deep selection, isolation, clip masks |
| `object-selection.spec.ts` | 53 | Basic object selection |
| `object-selection-real-model.spec.ts` | 173 | Real model selection |
| `marquee-selection.spec.ts` | 93 | Marquee selection workflows |
| `selection-marquee-modes.spec.ts` | 45 | Marquee mode switching |
| `lasso-tool.spec.ts` | 132 | Object lasso tool |
| `selection-overlay-visibility.spec.ts` | 113 | Overlay visibility |
| `selection-quick-bar.spec.ts` | 46 | Quick bar |

### Gaps
- No unit tests for `LassoTool` (only E2E).
- No tests for `PolygonSelectionShape` coverage (unreachable code).
- No tests for selection refinement (not implemented).
- No tests for saved area selections (not implemented).

---

## 16. Playwright

### Existing E2E Coverage
- Object selection (click, deep select, marquee, lasso) — well covered.
- Marquee selection modes — basic coverage.
- Selection overlay visibility — basic coverage.

### Missing E2E
- Pixel lasso tool (doesn't exist yet).
- Selection refinement workflows.
- Selection → mask → selection round-trip.
- Saved selection save/load.
- Selection Paint mode.
- Path ↔ selection conversion.

---

## 17. Visual QA

### Existing Visual Tests
- `overlay-alignment.spec.ts` screenshots at 100% and 200% zoom.
- `selection-overlay-visibility.spec.ts` for overlay state.

### Known Visual Concerns
- Marching ants may truncate for complex raster masks (250K segment cap).
- Ellipse selection boundary is traced via `ctx.ellipse()` — should be visually correct.
- Feathered selection boundary renders at ~50% contour — accurate for the visual representation.

---

## 18. Accessibility

### Current State
- All selection handles have `aria-label` attributes.
- Touch targets meet minimum 16px requirement.
- `role="presentation"` on decorative elements.
- Keyboard shortcuts for all selection tools.

### Gaps
- No live announcements for selection changes ("Rectangular pixel selection created, 420×180").
- No keyboard-precise entry for selection dimensions (X/Y/W/H inputs).
- Selection paint mode (when implemented) needs accessible controls.

---

## 19. Remaining Limitations (Explicitly Deferred)

### P0 (This Audit)
- [ ] Pixel lasso tool (freehand + polygonal)
- [ ] Harden existing marquee/lasso/selection infrastructure

### P1 (Professional Editing)
- [ ] Selection refinement (grow/shrink/smooth/threshold)
- [ ] Selection transform (move/scale/rotate boundary)
- [ ] Selection Paint (Quick Mask equivalent)
- [ ] Path ↔ Selection conversion
- [ ] Saved Area Selections
- [ ] Selection from alpha/luminance

### P2 (Advanced Intelligence)
- [ ] Color range selection
- [ ] Focus-based selection
- [ ] Coverage Math
- [ ] Select Subject integration with AreaSelection

### P3 (Specialized)
- [ ] Split/Merge channels
- [ ] Cross-document saved selections
- [ ] Advanced print/spot-channel workflows
