# Tools System — Deferred Implementation Plan

Use this in a future session to complete the remaining phases.

## Completed foundation (Session 9, 2026-06-29)

| Area | Status | What was built |
|---|---|---|
| Tool interface + ToolManager | Done | `Tool` interface, `ToolContext`, `CursorSpec`, `GestureResult` in `packages/editor/src/tools/types.ts` |
| BaseTool | Done | Abstract base class with drag gesture machine, threshold, constrain/from-centre modifiers, pointer capture lifecycle |
| ToolManager | Done | Central event dispatcher, lifecycle (activate/deactivate), spring-loaded key support, modifier tracking, cursor resolution |
| CanvasArea rewrite | Done | ONE set of pointer listeners that delegate to `ToolManager`; no global "draw rectangle on pointerdown" path |
| SelectTool (V) | Done | Click→select, marquee, move, nudge, double-click enter, Shift+click toggle, frame reparent on move-end |
| HandTool (H) | Done | Drag→pan, grab/grabbing cursor, middle-button pan via midPanRef, no creation |
| ZoomTool (Z) | Done | Click→zoom in/out, marquee-zoom to region |
| FrameTool (F) | Done | Drag→FrameNode, below-threshold→375×812 default, parent containment |
| RectangleTool (R) | Done | Drag→rect, Shift=square, Alt=from-center, parent on commit |
| EllipseTool (O) | Done | Drag→ellipse, Shift=circle, Alt=from-center, parent on commit |
| LineTool (L) | Done | Drag→line, Shift=45° snap, parent on commit |
| PenTool (P) | Done | Click→corner point, close path, Enter/Escape/double-click→finish, rubber-band preview via setDraft |
| TextTool (T) | Done | Click→point text, drag→text box, creates TextNode, parent on commit |
| Frame parenting | Done | `findContainingFrameInDoc` spatial containment, `createShapeAt` accepts parentId, `addChild` for frames, `reparentNode` on move-end |
| ToolId type | Done | 21 tool IDs across context and tools/types, union-synced |
| TOOL_ICONS | Done | All tool icons mapped (arrow, zoom, nodeEdit, scale, eyedropper, boolean ops, inspect) |
| Pre-existing codegen fixes | Done | 7 files in `@varve/codegen`: `Document` type alias to `SceneDocument`, unused params/vars, `FrameNode` typing |

## Completed implementation (Session 10, 2026-06-29)

| Phase | Area | What was built | Files |
|---|---|---|---|
| 1A | PolygonTool | Drag-to-create polygon shape tool | `packages/editor/src/tools/PolygonTool.ts` |
| 1B | StarTool | Drag-to-create star shape tool | `packages/editor/src/tools/StarTool.ts` |
| 1C | ScaleTool | Drag-to-scale selected nodes proportionally | `packages/editor/src/tools/ScaleTool.ts` |
| 1D | Registration | All 3 + 4 more tools registered in CanvasArea | `CanvasArea.tsx` |
| 1E | Tests | Polygon/star/arrow shape creation tests | `editor.test.tsx` |
| 2 | Arrow shape variant | `arrow` variant in Shape/Primitive enums (TS + Rust), context factories, replay rendering, codegen SVG/tailwind | `engine/types.ts`, `replay.ts`, `scene/types.ts`, `context.tsx`, `svgt.ts`, `index.ts`, Rust crates |
| 3 | ArrowTool | Drag-to-create arrow shape with Shift=45° snap | `ArrowTool.ts`, `CanvasArea.tsx` |
| 4 | EyedropperTool | Color pick via EyeDropper API + canvas fallback | `EyedropperTool.ts`, `types.ts` (canvasElement) |
| 5 | SliceTool | Drag-to-create export slice regions (FrameNode) | `SliceTool.ts`, `context.tsx` |
| 6 | Path shape variant | `path` variant + `PathPoint` interface in Shape/Primitive enums (TS + Rust), Bezier rendering in replay, codegen SVG | `engine/types.ts`, `replay.ts`, `scene/types.ts`, `context.tsx`, svg.ts, Rust crates |
| 7 | PencilTool + fitting | RDP simplification (`simplifyPoints`), point capture via rAF, path shape commit | `fitting.ts`, `PencilTool.ts` |
| 9 | Spring-loaded tools | ToolManager bugfix (`targetId` tracking), CanvasArea key handlers for Space→Hand + tool keys | `ToolManager.ts`, `CanvasArea.tsx` |
| 12 | Codegen gap fills | tailwind.ts emits inline SVG for non-rect shapes (ellipse, circle, line, arrow, polygon, star, path) | `tailwind.ts` |

### Pre-existing issues resolved (Session 10)

| Issue | Fix |
|---|---|
| `TypeError: migrateDocument is not defined` | Not a real issue — workspace tests pass correctly |
| `strata-sync` compile error: missing `ordering` field in `FileRow` | Added `ordering: ""` to test `upsert_file` calls |
| TS error: missing `order` in `SceneNode` test objects | Added `order: 'a0'` to `createRectNode` test helper |
| TS error: `Affine` unused import in `PositionSizeSection` | Removed unused import |
| TS error: BindingMenu `VariableValue \| undefined` | Added undefined check with fallback |
| TS error: `shapeLocalBBox` missing `arrow`/`path` cases | Added `arrow` and `path` handlers |
| TS error: `nodeToSvg` missing `arrow`/`path`/`star` | Added handling in index.ts |

## Remaining deferred items

### Phase 3d — Additional shape tools

| Tool | File | Status |
|---|---|---|
| **PolygonTool** | `packages/editor/src/tools/PolygonTool.ts` | **Done (Session 10)** |
| **StarTool** | `packages/editor/src/tools/StarTool.ts` | **Done (Session 10)** |
| **ArrowTool** | `packages/editor/src/tools/ArrowTool.ts` | **Done (Session 10)** |
| **ScaleTool** | `packages/editor/src/tools/ScaleTool.ts` | **Done (Session 10)** |

### Phase 3e — Vector, content & utility tools

| Tool | File | Status |
|---|---|---|
| **PencilTool** | `tools/PencilTool.ts` | **Done (Session 10) — uses RDP, path shape** |
| **SliceTool** | `tools/SliceTool.ts` | **Done (Session 10)** |
| **EyedropperTool** | `tools/EyedropperTool.ts` | **Done (Session 10)** |
| NodeEditTool | `tools/NodeEditTool.ts` | **Not started — needs path editing UI framework** |
| BooleanActions | `tools/BooleanActions.ts` | **Not started — needs path boolean ops** |

### Still deferred

### 1. Snapping & Smart Guides

**When:** All geometry tools work.

**Files:**
- `packages/editor/src/tools/snapping.ts` (new)
- `packages/editor/src/components/SnapGuidesOverlay.tsx` (new)

### 2. Floating Bottom-Center Toolbar

**When:** All tools exist and work.

**Files:**
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` (new)
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.css` (new)
- `packages/editor/src/components/FloatingToolbar/ToolGroupFlyout.tsx` (new)
- `packages/editor/src/Shell.tsx` — replace `ToolPanel` with `FloatingToolbar`
- `packages/editor/src/ToolPanel.tsx` — archive or delete

### 3. NodeEditTool

**Features:** Select/move anchors, add/remove anchors, convert corner <-> smooth, box-select, handle symmetry, arrow nudge, Enter to enter/edit mode.

### 4. BooleanActions (Union/Subtract/Intersect/Exclude)

**Surfaced as:** Toolbar grouped flyout + Object menu, not modal tools.
**Enabled:** Only with 2+ shape nodes selected.

### 5. Spring-loaded tools (cross-cutting)

**Done (Session 10):** `ToolManager.springLoadTool`/`releaseSpring` wired into CanvasArea `onKeyDown`/`onKeyUp`.

## Test requirements

| Phase | Test type | File |
|---|---|---|
| 3d (Polygon/Star/Arrow/Scale) | Vitest — shape created, parent contained | **Done** (in editor.test.tsx) |
| 3e (Pencil) | Vitest — point capture + simplification + fitting | `tools/__tests__/fitting.test.ts` (pending) |
| 2 (Snapping) | Vitest — grid/edge/center snap + spatial index | `tools/__tests__/snapping.test.ts` (pending) |
| 3 (Toolbar) | Vitest — APG toolbar keyboard nav, flyout menus | `FloatingToolbar/__tests__/FloatingToolbar.test.tsx` (pending) |
| All | Playwright — full E2E gesture flows | `tests/e2e/tools/tools.spec.ts` (pending) |
| All | axe-core zero violations (after each tool) | `tests/e2e/tools/axe.spec.ts` (pending) |

## Current test counts (Session 10)

- **Rust:** 75 workspace tests (32 core + 4 engine + 9 layout + 12 print + 10 sync + 8 trace)
- **JS:** 22+ in editor+codegen (8 editor + 14 codegen); 331+ workspace-wide
- **TypeScript:** 0 errors (pre-existing `order` field issues resolved)
