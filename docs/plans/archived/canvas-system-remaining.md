# Canvas System — Remaining Implementation

**Generated:** 2026-07-04 | **Base commit:** `c4334be` (Phase B-05/06 + F-01/F-06 + D-01)

---

## Pre-Flight Checklist (mandatory before starting)

```bash
pnpm typecheck       # 15/15 packages must pass
pnpm test            # baseline test counts (see below)
pnpm lint            # 0 new errors on modified files
pnpm audit:tokens    # 96/96 WCAG-AA across 3 themes
pnpm audit:emoji     # zero violations
cargo test --workspace  # if Rust files touched
```

**Current baseline:** ~3042+ JS tests, 82 Rust tests. `just gate` after each phase.

---

## What's Already Done (don't redo)

| Area | Phase | Files |
|---|---|---|
| `Camera.pan` unified from tuple to `{x,y}` | A-01 | `packages/shared/src/viewport.ts`, all consumers |
| Smooth camera animation (`smoothZoomTo`, `smoothPanTo`, `smoothReveal`) | A-02/03/04 | `packages/editor/src/context.tsx` |
| Zoom indicator overlay | A-05 | `packages/editor/src/components/ZoomIndicator.tsx` |
| Inertial scrolling (momentum-based pan) | A-06 | `packages/editor/src/CanvasArea.tsx` |
| Grid-based spatial index (64px cells) | B-01 | `packages/editor/src/scene/spatialIndex.ts` |
| Parent index cache (O(1) parent lookups) | B-02 | `packages/editor/src/scene/parentIndexCache.ts` |
| Spatial index wired into `hitTestNode()` | B-02 | `packages/editor/src/context.tsx` |
| Hierarchical viewport culling (skip off-screen container subtrees) | B-03 | `packages/editor/src/CanvasArea.tsx` |
| Dirty rect tracking + partial redraw | B-04 | `packages/editor/src/CanvasArea.tsx` |
| `nodeLocalBounds` for image/adjustment kinds | F-01 | `packages/editor/src/scene/world.ts` |
| Theme-aware accent colors (replaced `#3b82f6`) | F-06 | `packages/editor/src/CanvasArea.tsx` |
| Equal-gap distribution snapping | D-01 | `packages/editor/src/tools/snapping.ts` |

---

## Remaining Items (ordered by dependency)

### Phase B-07: Multi-Canvas Layering (2-3 days)

**What**: Split the single `<canvas>` into three DOM-layered canvases composited by the browser:
1. **Content canvas** — main IR replay (changes every frame)
2. **Overlay canvas** — selection handles, snap guides, rulers (changes only on interaction)
3. **Grid canvas** — dot grid, pixel grid (rarely changes)

**Why**: Isolates overlay repaints from content repaints. Moving a selection handle shouldn't force a full content re-render.

**Files to modify**:
- `packages/editor/src/CanvasArea.tsx` — render 3 canvases instead of 1; route draw calls

**Approach**:
```typescript
// In the render tree:
<section className="editor-canvas" ref={canvasSectionRef}>
  <canvas ref={gridCanvasRef} className="editor-canvas__grid-layer" />
  <canvas ref={contentCanvasRef} className="editor-canvas__content-layer" />
  <canvas ref={overlayCanvasRef} className="editor-canvas__overlay-layer" />
  {/* Existing overlay components stay in the DOM */}
</section>
```
- Grid canvas: `pointer-events: none`, redrawn only when zoom/pan changes
- Content canvas: the main draw target for `replayIr`
- Overlay canvas: draws selection boxes, snap guides, measure overlay; redrawn only on interaction
- Add CSS classes for each layer's positioning and compositing

**TDD tests** (4 tests):
1. Content canvas receives `replayIr` calls
2. Overlay canvas draws on selection change
3. Grid canvas draws on zoom change
4. All three canvases resize together on window resize

**Acceptance**: Moving a node only redraws content canvas; moving a selection handle only redraws overlay canvas.

---

### Phase C: Worker-Based Rendering (5-7 days)

**What**: Move `walkNodes` + `toEngineNode` + `buildIr` + `replayIr` to a Web Worker using OffscreenCanvas, keeping the main thread free for UI interactions.

**Why**: This is the single highest-ROI performance improvement. Frees the main thread from all rendering workload. For documents with 10K+ nodes, this prevents UI jank.

**Architecture**:
```
Main Thread                          Render Worker
────────────                         ─────────────
EditorState mutations                OffscreenCanvas
Tool gestures                        replayIr()
Selection changes                    hitTest()
Overlays (SVG/separate canvas)       IR building
```

**New files**:
- `packages/editor/src/render/renderWorker.ts` — Worker entry: receives scene delta + camera, renders to OffscreenCanvas
- `packages/editor/src/render/worker.ts` — Worker bootstrap + message protocol
- `packages/editor/src/render/worker.test.ts` — 6 tests

**Message protocol**:
```typescript
// Main → Worker
type WorkerCommand =
  | { type: 'render'; scene: EngineNode[]; camera: Camera; viewport: Viewport }
  | { type: 'hitTest'; worldX: number; worldY: number }
  | { type: 'resize'; width: number; height: number; dpr: number };

// Worker → Main
type WorkerResponse =
  | { type: 'frameRendered' }
  | { type: 'hitTestResult'; nodeId: NodeId | null }
  | { type: 'error'; message: string };
```

**Files to modify**:
- `packages/editor/src/CanvasArea.tsx` — create Worker, proxy render calls; fallback to main-thread render when Worker unavailable
- `packages/editor/src/context.tsx` — proxy `hitTestNode` to Worker when active

**TDD tests** (12 tests):
1. Worker instantiation and message passing
2. Full render round-trip (scene → IR → canvas)
3. Hit test via worker returns correct node
4. Worker fallback when OffscreenCanvas unavailable (Safari <16.4)
5. Camera change triggers worker re-render
6. Consecutive renders don't race (frame serialization)

**Edge cases**:
- Safari <16.4: OffscreenCanvas not available → fall back to main-thread render
- Transferable buffers: use `OffscreenCanvas.transferControlToOffscreen` for zero-copy
- Worker termination on unmount
- Memory: avoid retaining stale IR arrays in worker heap

**Acceptance**: Moving/dragging in a 10K-node document shows no main-thread frame drops.

---

### Phase D-02: Snap Candidate Limiting (1 day)

**What**: Add spatial + hierarchical pruning to snap candidate enumeration. Currently `snapPosition` considers ALL objects in the document. For 500+ nodes, this is O(N²).

**Files to modify**:
- `packages/editor/src/tools/snapping.ts`

**Algorithm**:
1. **Spatial pruning**: Only consider targets within 200px (screen-space) of the dragged object's bounding box
2. **Hierarchical pruning**: Prefer siblings and parent-children over distant relations
3. Apply both filters to `otherBounds` before the existing edge/center/midpoint loops

```typescript
function filterSnapTargets(
  draggedBounds: Rect,
  camera: Camera,
  allBounds: Array<{ nodeId: NodeId; bounds: Rect }>,
  parentIndex: Map<NodeId, NodeId | null>,
  draggedId: NodeId,
): Array<{ x: number; y: number; w: number; h: number }> {
  const maxDistScreen = 200; // CSS px
  const results: Array<{ x: number; y: number; w: number; h: number }> = [];
  const draggedParent = parentIndex.get(draggedId);

  for (const { nodeId, bounds } of allBounds) {
    if (nodeId === draggedId) continue;
    // Spatial: convert distance to screen space
    const dx = Math.max(draggedBounds.x - (bounds.x + bounds.w), bounds.x - (draggedBounds.x + draggedBounds.w), 0);
    const dy = Math.max(draggedBounds.y - (bounds.y + bounds.h), bounds.y - (draggedBounds.y + draggedBounds.h), 0);
    const distScreen = Math.sqrt(dx * dx + dy * dy) * camera.zoom;
    if (distScreen > maxDistScreen) continue;
    results.push(bounds);
  }
  return results;
}
```

**TDD tests** (4 tests):
1. Nearby target included, far target excluded
2. Sibling preferred over distant node
3. Empty results when no targets within range
4. Performance: 500 targets → < 1ms filtering

**Files to wire**: `packages/editor/src/CanvasArea.tsx` — pass camera + parent index to `buildToolCtx` for snap candidate filtering.

---

### Phase D-03: Per-Layer Snap Exclusion (1 day)

**What**: Add `snapExcluded?: boolean` field to `NodeBase` type. When true, the node is excluded from snap target enumeration. UI toggle in layers panel context menu and inspector.

**Why**: Users need to exclude background/decorative elements from snapping without hiding or locking them.

**Scene model change**:
- `packages/scene/src/types.ts` — add `snapExcluded?: boolean` to `NodeBase`
- `packages/scene/src/document.ts` — add `setSnapExcluded(doc, id, excluded)` operation (3 tests)

**Files to modify**:
- `packages/editor/src/tools/snapping.ts` — skip `snapExcluded` nodes in `otherBounds`
- `packages/editor/src/tools/types.ts` — add `isSnapExcluded?(id: NodeId) => boolean` to `ToolContext`
- `packages/editor/src/CanvasArea.tsx` — wire `isSnapExcluded` in `buildToolCtx`
- `packages/editor/src/components/LayersPanel/LayersRow.tsx` — context menu toggle
- `packages/editor/src/components/Inspector/inspector.css` — snap excluded indicator

**TDD tests** (3 tests):
1. Excluded node not in snap targets
2. Toggle snap exclusion on/off
3. Exclusion persists through undo/redo

---

### Phase D-04: Snap-to-Frame Center + Edges (0.5 day)

**What**: Add constant snap targets for the current frame's center and edges, plus the document/page center. These always exist regardless of what other nodes are selected.

**Files to modify**:
- `packages/editor/src/CanvasArea.tsx` — in `buildToolCtx()`, add frame bounds and document center to `otherBounds`

```typescript
// In buildToolCtx(), after computing otherBounds from document nodes:
const pageBounds = findCurrentPageBounds(state.document, state.currentPageId);
if (pageBounds) {
  otherBounds.push(pageBounds); // page edges + center
}
const frameBounds = findContainingFrame(document, cursorWorld);
if (frameBounds) {
  otherBounds.push(frameBounds); // frame edges + center  
}
```

**TDD tests** (2 tests):
1. Snap to page center on drag
2. Snap to parent frame center

---

### Phase D-07: Guide Context Menu (1 day)

**What**: Add right-click context menu on guide lines in GuideOverlay with Lock/Delete options. Currently guides can only be removed via programmatic API.

**Files to modify**:
- `packages/editor/src/components/GuideOverlay/GuideOverlay.tsx` — add context menu event handler
- New `packages/editor/src/components/GuideOverlay/GuideContextMenu.tsx` — positioned context menu

**Events**:
- `contextmenu` on guide line → show menu at pointer
- Lock/delete actions call existing `onToggleLock`/`onRemoveGuide` props
- `Escape` or click outside → dismiss

**TDD tests** (3 tests):
1. Right-click shows context menu
2. Lock toggle fires callback
3. Delete fires callback

---

### Phase E-01: Canvas Accessibility Tree (2-3 days)

**What**: Create a hidden DOM representation of canvas nodes so screen readers can navigate individual shapes. Currently the canvas has `role="img"` which treats the entire canvas as one opaque image.

**Why**: WCAG AAA requirement. Screen readers cannot discover individual shapes on the canvas.

**Approach**:
Maintain a hidden `<div>` with `aria-hidden="false"` and `className="sr-only"` that mirrors visible nodes in the viewport using `<span>` elements with `role="img"` and `aria-label` descriptions.

```typescript
// Component: CanvasAccessibilityTree
function CanvasAccessibilityTree({ doc, camera, viewport }: Props) {
  const visibleNodes = useMemo(() => {
    const result: Array<{ id: string; label: string }> = [];
    walkNodes(doc, (node, depth) => {
      const bounds = nodeWorldBounds(doc, node.id);
      if (bounds && isWorldRectInViewport(camera, viewport, bounds)) {
        result.push({
          id: node.id,
          label: `${node.name}, ${node.kind}, ${Math.round(bounds.x)}, ${Math.round(bounds.y)}, ${Math.round(bounds.w)} x ${Math.round(bounds.h)}`,
        });
      }
    });
    return result;
  }, [doc, camera, viewport]);

  return (
    <div aria-hidden="false" className="sr-only" role="list" aria-label="Canvas shapes">
      {visibleNodes.map((n) => (
        <span key={n.id} role="img" aria-label={n.label} />
      ))}
    </div>
  );
}
```

**New files**:
- `packages/editor/src/components/CanvasAccessibilityTree.tsx`

**Files to modify**:
- `packages/editor/src/CanvasArea.tsx` — render `CanvasAccessibilityTree`

**TDD tests** (6 tests):
1. Renders visible nodes as hidden spans
2. Off-screen nodes excluded
3. Updates when viewport changes
4. Updates when document changes
5. Descriptions include name, kind, dimensions
6. Performance: 500 visible nodes → render < 50ms

---

### Phase E-02: Focus Traps for Modal Dialogs (1 day)

**What**: Add focus trap to all 8 modal dialogs so Tab cycling doesn't escape the dialog. Currently dialogs use `role="dialog"` but don't trap focus.

**Affected dialogs**:
1. `ExportDialog`
2. `ImportProgress`
3. `ImportResults`
4. `ImportPreview`
5. `SettingsDialog`
6. `RecoveryDialog`
7. `NewFileDialog`
8. `TemplateGallery` (when shown as dialog)

**Implementation**: Create a `FocusTrap` component using `useFocusTrap` hook:
```typescript
function FocusTrap({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const focusableSelector = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = container.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', handleKeyDown);
    // Focus first element on open
    const firstFocusable = container.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [active]);
  return <div ref={containerRef}>{children}</div>;
}
```

**New files**:
- `packages/editor/src/components/FocusTrap.tsx`

**Files to modify**:
- Each dialog component — wrap content in `<FocusTrap>`

**TDD tests** (3 tests per dialog = 24 total, can be 1 integration test):
1. Tab cycles within dialog
2. Shift+Tab cycles in reverse
3. Focus returns to trigger element on close

---

### Phase F-09: Background Blur (1 day)

**What**: Implement real background blur by capturing the backdrop behind an item into an OffscreenCanvas, blurring it, then compositing. Currently `backgroundBlur` in `replay.ts` is a stub that falls through to `layerBlur` (blurring the item's own content).

**Files to modify**:
- `packages/engine/src/replay.ts` — `paintEffects` case for `backgroundBlur`

**Algorithm**:
```typescript
function applyBackgroundBlur(
  ctx: CanvasRenderingContext2D,
  item: RenderItem,
  blurRadius: number,
): void {
  // 1. Get backdrop: the content behind this item
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const backdrop = ctx.getImageData(0, 0, w, h);
  // 2. Apply blur to backdrop (box blur or CSS filter)
  // 3. Save state, clip to item outline, draw blurred backdrop
  ctx.save();
  traceOutline(ctx, item);
  ctx.clip();
  // Use canvas filter for GPU-accelerated blur
  ctx.filter = `blur(${blurRadius}px)`;
  ctx.putImageData(backdrop, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
}
```

**Note**: `getImageData`/`putImageData` is slow. For production, prefer compositing on an OffscreenCanvas layer (see Phase B-07). This implementation is a correctness fix.

**TDD tests** (4 tests):
1. Background blur renders differently from layer blur
2. Blur radius affects result
3. Multiple background blurs compose correctly
4. No effect when blurRadius = 0

---

### Phase F-10: `traceShapeOutline` Deduplication (0.5 day)

**What**: Remove the duplicate `traceShapeOutline()` function in `CanvasArea.tsx` (lines 82-153) and make the renderer's `traceOutline()` from `replay.ts` importable and shared. Currently both functions independently implement the same shape→canvas path logic, and they've drifted.

**Evidence of drift**: `CanvasArea.tsx` line 149 uses default w/h of 100 while `replay.ts` uses different defaults for the same case.

**New file**: `packages/shared/src/tracing.ts` or `packages/engine/src/tracing.ts`

Export a single `traceShapeOutline(ctx, shape, kind)` function used by both CanvasArea and replay.ts. The function takes a `CanvasRenderingContext2D`, a shape union, and a kind discriminator, and produces the same path.

**Files to modify**:
- New shared module
- `packages/editor/src/CanvasArea.tsx` — import from shared
- `packages/engine/src/replay.ts` — import from shared

**TDD tests** (3 tests):
1. Both callers produce identical paths for each shape kind
2. Edge cases (empty path, degenerate triangle, zero-size rect)
3. Import path resolves correctly from both packages

---

### Remaining Hardcoded Colors (0.5 day)

**What**: Find and replace remaining inline color strings in canvas-related files with CSS custom property lookups.

**Files to audit**:
- `packages/editor/src/SelectionOverlay.tsx` — check for `stroke`/`fill` hardcoded colors
- `packages/editor/src/components/SnapGuidesOverlay.tsx` — check for inline colors
- `packages/editor/src/components/NodeEditOverlay.tsx` — check handle/spline colors
- `packages/editor/src/editor.css` — verify no hardcoded colors remain

**Approach**: 
```bash
# Find remaining hardcoded colors
grep -rn "'#[0-9a-fA-F]\{6\}'" packages/editor/src --include="*.tsx" --include="*.ts" | grep -v ".test."
grep -rn "rgba(" packages/editor/src --include="*.tsx" --include="*.ts" | grep -v ".test."
```

Replace each with:
```typescript
const accentColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-accent-primary').trim() || '#3b82f6';
```

**Acceptance**: Zero hardcoded colors in canvas rendering code.

---

## Verification Protocol

After each phase:

```bash
pnpm format
pnpm typecheck       # 15/15 packages pass
pnpm lint            # 0 new errors
pnpm test            # all pass
pnpm audit:tokens    # 96/96 WCAG-AA
pnpm audit:emoji     # zero violations
cargo test --workspace  # if Rust files touched
git log --oneline -3 # verify commit
```

Run `just gate` after each cross-package boundary.

---

## Commit Convention

```
Phase {LETTER}-{NUMBER}: {Description}

- {Bullet list of changes}
- {Tests added/passed}
```

---

## Dependency Graph

```
B-07 (multi-canvas) ──→ C (worker rendering) ──→ F-09 (background blur)
                              │
D-02 (snap limiting) ──→ D-03 (snap exclusion)
                              │
D-04 (frame snaps)           D-07 (guide menu)
                              │
E-01 (accessibility tree) ──→ E-02 (focus traps)
                              │
F-10 (trace dedup)           F-10 (trace dedup) ──→ remaining color audit
```

Phases with no arrow between them are independent and can run in parallel.
