# Alignment Memory — Discovery & Decisions

## Discovery Results (2026-07-10)

### Existing Geometry Model
- **`packages/shared/src/affine.ts`**: Full 2D affine math — Affine type, translate/rotate/scale/multiply/invert/apply. Single source of truth. Reused by engine, scene, viewport, selectionBox, align.
- **`packages/shared/src/viewport.ts`**: Camera/viewport math — screenToWorld, worldToScreen, zoomAboutPoint, fitBoundsCamera, revealBoundsCamera.
- **`packages/shared/src/selectionBox.ts`**: Selection box OBB math — computeSelectionBox (OBB for single, AABB for multi), boxDeltaMatrix, resizeSelectionBox, rotateSelectionBox.
- **`packages/shared/src/coordinates.ts`**: Artboard coordinate conversions (worldToArtboard, artboardToWorld).
- **`packages/editor/src/scene/world.ts`**: nodeWorldTransform, nodeLocalBounds, nodeWorldBounds, groupWorldBounds — canonical bounds/transform functions.

### Existing Alignment System (packages/shared/src/align.ts)
- **AABB alignment**: `alignBBox`, `computeAlignmentTarget`, `bboxUnion` — complete
- **OBB alignment**: `orientedBBox`, `obbToAABB`, `obbAlignmentTarget` — separate API
- **Distribution**: `computeDistribution` (equal-gap only, edge-to-edge), `distributeToPosition`
- **Tidy Up**: `computeTidyLayout` (proximity-based grid, ~O(n²))
- **30+ tests** in `align.test.ts`

### Editor Wiring (context.tsx)
- `alignSelected` — AABB, with keyObjectId / alignToPage / collective bounds fallback
- `distributeSelected` — equal-gap only
- `distributeWithGap` — fixed-gap distribution
- `obbAlignSelected` — OBB-aware alignment
- `tidySelected` — grid layout
- `setKeyObject` / `alignToPage` — state in EditorState
- **Helpers**: `getValidItemsWithBounds`, `worldToLocalOrigin`, `computeKeyObjectTarget`, `getParentFast`

### Undo System
- `beginTransaction/commitTransaction/abortTransaction` available
- `updateDoc` creates one undo entry per call
- **Gap**: spacing-bar drag creates N undo entries (each pointerUp = one updateDoc call)

### Existing Auto-Layout
- `computeFlexLayout` — full CSS Flexbox engine (row/column, wrap, gap, padding, alignItems, justifyContent, grow/shrink, layoutSizing)
- `computeGridLayout` — CSS Grid engine

### Interaction Overlay
- `AlignmentHandleOverlay` — SVG gap handles, uses `distributeWithGap` on pointerUp
- `AlignDistributeBar` — inspector toolbar with align/distribute/tidy/key-object/page buttons

### Auto-layout cycle detection
- **MISSING**: No cycle detection for parent-child resize loops.

---

## Decisions (per §1 of spec)

### 1. OBB vs AABB — AABB PRIMARY, OBB OPT-IN
- `alignSelected` uses AABB (Figma-compatible, predictable for mixed rotations)
- `obbAlignSelected` available as explicit opt-in via toggle in AlignDistributeBar
- Rationale: Figma aligns rotated objects by AABB; edge-to-edge OBB alignment on objects at different rotations produces results users find unpredictable.

### 2. Distribution mode — EQUAL-GAP DEFAULT, EQUAL-CENTER OPTION
- `computeDistribution` stays equal-gap (edge-to-edge)
- NEW `computeDistributionCenters` for equal center-to-center spacing
- NEW context method `distributeWithMode` accepting mode param

### 3. Key Object UX — EXPLICIT "SET KEY OBJECT" BUTTON
- User clicks "Set key object" in AlignDistributeBar → sets `state.keyObjectId`
- When key object is set, alignment targets that node's bounds
- When null, targets collective bounds (or page if alignToPage)

### 4. Auto-layout scope — EXISTING FLEXBOX IS SUFFICIENT
- Wrap: supported ✓
- Min/max sizing: supported via layoutSizing ✓
- Text auto-resize: supported via layoutSizing: 'hug' ✓
- **CYCLE DETECTION**: needs implementation for parent-child resize loops
