# Selection & Transform Engine — Discovery Memory

---

## 0. Stack (Verified)

### Rendering backend
- **Pure Canvas2D** (`@varve/engine/replay.ts`) — no Konva/Fabric/PixiJS.
- SVG overlay for selection handles (`SelectionOverlay.tsx`).
- OffscreenCanvas render worker for non-structural scenes.
- Floating-origin for large coordinate stability.

### Framework
- **React 18/19 + TypeScript strict**.
- State: React Context (`EditorProvider` → sub-contexts: `ViewportContext`, `SelectionContext`, `DocumentContext`). No Zustand/Redux.
- Immutable document updates (`updateDoc(fn: (doc: Document) => Document)`).

### Test runner
- **Vitest** (`pnpm test`). Run from repo root.
- E2E: Playwright (`pnpm test:e2e`).
- Existing transform tests: `TransformEngine.test.ts` (202 lines), `ScaleTool.test.ts` (957 lines), `snapping.test.ts` (341 lines).
- No existing `SelectionOverlay.test.tsx`.

### Quality gates
- `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:emoji`, `pnpm audit:tokens`.
- `just gate` runs format-check + lint + test + audits.

---

## 1. Coordinate Space Model (Explicit)

**Defined in `@varve/shared/viewport.ts` and `@varve/shared/affine.ts`:**

| Space | Description |
|---|---|
| **Screen** | Raw `clientX/clientY` from PointerEvent. Includes browser chrome. |
| **Canvas** | Screen minus `canvas.getBoundingClientRect()` offset. CSS px. |
| **World** | Canvas → `screenToWorld(cam, cx, cy)`. The space layers live in. |
| **Local** | Node's own coordinate space. `transform` maps local → parent. |

**Canvas-to-world:** `world = (canvas - pan) / zoom` (with rotation support).
**World-to-canvas:** `canvas = world * zoom + pan` (with rotation).

**Conversions live in:**
- `@varve/shared/viewport.ts` — `screenToWorld`, `worldToScreen`, `screenDeltaToWorld`, `clientToCanvas`.
- `packages/editor/src/context/ViewportContext.tsx` — `canvasToWorld`, `worldToCanvas`, `canvasDeltaToWorld`.

**⚠️ Duplicate found:** `SelectionOverlay.tsx:69-85` defines its own `worldToScreen` / `screenToWorld` — same math as `@varve/shared/viewport.ts`. Should be swapped to the canonical import.

---

## 2. Affine Transform Architecture

**SSoT:** `@varve/shared/affine.ts` — `Affine = [a, b, c, d, e, f]` (same as Canvas2D `setTransform` and kurbo Rust).

- `multiplyAffine(parent, child)` — scene-graph composition (parent after child).
- `invertAffine` / `tryInvertAffine` — singular matrix detection.
- `decomposeAffine` — only for uniform scale+rotation (returns `null` on skew).
- `transformRect(m, localRect)` — AABB of transformed corners.

### Node transform pipeline (`world.ts`)
- `nodeWorldTransform(doc, id)` — walks ancestor chain composing local→parent transforms.
- `nodeLocalBounds(node)` — returns `Rect | null` per node kind (shape, text, frame, group).
- `nodeWorldBounds(doc, id)` — `transformRect(worldMat, localBounds)`.

**⚠️ Gap:** `decomposeAffine` rejects skew. If a transform accumulates skew via repeated non-uniform transforms, it cannot be round-tripped through `{translate, rotation, scale}`. The code handles this by storing `transform` as a raw affine and `rotation` as a separate field, but the separation creates ambiguity (rotation is both in the matrix and the field).

---

## 3. TransformEngine (Current)

`packages/editor/src/transform/TransformEngine.ts`

- Computes a **single delta matrix** from old → new selection box, applied to all selected nodes.
- Pattern: `M_new · M_old⁻¹` (Konva/pixi-transformer pattern).
- `resize(pointerWorld, handle, opts)` — converts pointer delta to box-local space via `pointerDeltaToBoxLocal`, calls `resizeSelectionBox`, then `boxDeltaMatrix`, then `applyDelta`.
- `rotate(angleDelta, pivot)` — calls `rotateSelectionBox`, then same delta pipeline.
- `commit(bake)` — optionally bakes vector geometry (scaleShape for rect/ellipse/circle/line/arrow/polygon/star/path).
- **Snap integration:** optional `snapBox` callback.

### ScaleTool (Separate)
- Not handle-based; uses distance-ratio from centroid.
- Axis-lock (Alt), uniform snap (Shift 0.25 increments), custom pivot.
- Has its own `updateNode` with `multiplyAffine` (independent of TransformEngine).
- Transaction lifecycle: begin on pointer down, commit on drag end, abort on cancel/deactivate.

**⚠️ Issue:** ScaleTool and TransformEngine are separate code paths for scaling. ScaleTool uses distance-ratio scaling; TransformEngine uses delta-matrix scaling. These should be unified, but the ScaleTool is a dedicated tool (K shortcut) while TransformEngine drives the handle-based resize.

---

## 4. Selection Overlay (Current)

`packages/editor/src/SelectionOverlay.tsx`

- SVG overlay rendering selection box + 8 handles + rotation handle + center indicator.
- Uses `computeSelectionBox()`, `handlePositions()` from `@varve/shared`.
- Handle hit areas: 16×16px invisible rect (larger than visible 8×8 handle square).
- Rotation: line from top-center to an offset circle 20px above.
- Cursor per handle: `nwse-resize`, `ns-resize`, `nesw-resize`, `ew-resize`.
- **Multi-select:** dashed bounding box, no handles (read-only).
- **Single-select (shape/frame/text):** full interactive handles.
- **Has its own `computeResize()` function** (lines 89-176) — this is a legacy path for non-rotated resizing. **TransformEngine is the active path.**
- **Has its own `computeRotatedLocalBBox()` function** (lines 178-268) — triggered for rotated nodes. Both of these duplicate logic that `resizeSelectionBox` from `@varve/shared` handles.

---

## 5. Snapping (Current)

`packages/editor/src/tools/snapping.ts`

- `snapPosition(x, y, w, h, otherBounds, grid, snapExcludedIds, opts)` → `{x, y, guides, session}`.
- Threshold: **8 screen px** (converted to world units via `8 / zoom`). Hysteresis release at 12px.
- Snaps: edge-to-edge, center-to-center, midpoint-between-two, spacing distribution, grid, layout grid.
- Sticky snap session (hysteresis via `SnapSession`).
- `snapSelectionBox(box, options)` — wraps snap for selection box center+size.
- `filterSnapTargets(draggedBounds, camera, allBounds, parentIndex, draggedId)` — spatial filter with sibling priority.

---

## 6. Undo/Redo

`packages/editor/src/context/DocumentContext.tsx`

- **Transaction-based:** `beginTransaction` / `commitTransaction` / `abortTransaction`.
- **Stack with pointer** — each transaction captures a document snapshot.
- `undo()` reverts to previous transaction snapshot; `redo()` advances.
- Each drag gesture = one transaction.
- Also has separate `useSelectionHistory` hook for selection history (Cmd+[ / Cmd+]).

---

## 7. Hit-Testing (Current)

`packages/editor/src/tools/SelectTool.ts`

- `resolveHit(world, ctx)` → calls `ctx.hitTest(world)` → `hitTestNode` in context.
- `findNodesAtPoint(world, ctx)` walks all visible unlocked nodes via `walkNodes()`, checking `rectContains(bbox, worldPoint)`.
- **No alpha-aware hit-testing** — pure bbox.
- **No ray-casting for paths** — uses bbox only.
- B1: depth cycling on click (descending paint order).
- B2: transparent/stroke-only pass-through.
- Handles locked/hidden/isolated filter.
- **⚠️ Gap:** `SpatialIndex` exists (`packages/editor/src/scene/spatialIndex.ts`) but hit-testing walks all nodes O(n) per click rather than using it.

---

## 8. Existing Edge Cases Covered

| Case | Status |
|---|---|
| Scale clamp [0.01, 100] | ✅ ScaleTool |
| Multi-selection relative position | ✅ ScaleTool + TransformEngine |
| Rotated node scale | ✅ ScaleTool (decompose test) |
| Nested parent transform | ✅ TransformEngine (nested test) |
| Centered resize (Alt) | ✅ SelectionBox.resize (centered option) |
| Proportional resize (Shift) | ✅ SelectionBox.resize (proportional option) |
| Min size clamp | ✅ SelectionBox (1e-3 default) |
| Snap hysteresis | ✅ Snapping sticky session |
| Zero-size minSize guard | ✅ (clampDim, clampScale) |
| Hit-test skip locked/hidden | ✅ SelectTool |
| Depth cycling | ✅ SelectTool |

## 9. Edge Cases Missing / Weak

| Case | Severity | Gap |
|---|---|---|
| Drag-through-zero (negative scale → flip) | P1 | resizeSelectionBox clamps w/h to minSize, never goes negative; no flip logic |
| Text layer resize (scale vs reflow) | P1 | TransformEngine.bakeNode falls through to `{...node, transform: localTransform}` — no special text handling |
| Stroke width preservation | P2 | bakeNode.setNodePosition does not preserve stroke width |
| Alpha-masked hit-test | P2 | `findNodesAtPoint` uses bbox only; no clipping check |
| Path ray-cast hit-test | P2 | Path uses bbox (`rectContains`), not bezier segment distance |
| Multiple blur effects compose | P2 | replayer takes max radius |
| High-DPI handle consistency | P1 | SelectionOverlay uses CSS px for hit areas — DPR handled by canvas, but SVG overlay may not account for zoom-dependent handle rendering |
| CORD-tainted canvas fallback | P2 | Cross-origin images tokenize canvas; no fallback defined for raster scale ops that need getImageData |
| Skew/float drift from matrix re-composition | P1 | decomposeAffine rejects skew; repeated non-uniform scale → rotate accumulates drift |
| Mixed rotation multi-selection | P1 | computeSelectionBox → multi returns `rotation: 0` (AABB union) — correct, but scaling such a box must apply delta per node, not unify rotation |
| Snap disable during marquee | P2 | Snap not explicitly disabled during marquee drags |
| Snap priority tie-break (grid vs edge vs center) | P2 | First-match wins in iteration order; no deterministic priority |
| Locked layers in multi-select | P2 | Locked layers excluded from movement but still visible in marquee area; no explicit mix-of-locked+unlocked test |
| Undo per drag gesture | ✅ | beginTransaction/commitTransaction per drag — verified in ScaleTool tests |
| Listener cleanup on unmount | P1 | SelectionOverlay has no explicit cleanup for pointer capture on unmount |
| Resize minimum handle hit area for tiny objects | P2 | 16px hit area handles; for objects smaller than 16px screen, hit area overlaps — no minimum on-screen handle spacing |

---

## 10. Build Configuration

| Command | What it runs |
|---|---|
| `pnpm test` | Vitest across all packages |
| `pnpm typecheck` | tsc --noEmit across packages/* |
| `pnpm lint` | Biome |
| `pnpm format` | Biome + cargo fmt |
| `just gate` | format-check + lint + test + audits |
| `pnpm dev` (in apps/desktop) | Vite dev server, browser @ localhost:1420 |
