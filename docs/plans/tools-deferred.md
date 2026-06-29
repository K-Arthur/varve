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
| Pre-existing codegen fixes | Done | 7 files in `@strata/codegen`: `Document` type alias to `SceneDocument`, unused params/vars, `FrameNode` typing |

## Immediate needs before deferred

These require the completed foundation but weren't built in Session 9:

### Phase 3d — Shape & container tools

| Tool | File | Status |
|---|---|---|
| PolygonTool | `packages/editor/src/tools/PolygonTool.ts` | ToolId exists, shape factory exists, no tool class |
| StarTool | `packages/editor/src/tools/StarTool.ts` | ToolId exists, shape factory exists, no tool class |
| ArrowTool | `packages/editor/src/tools/ArrowTool.ts` | ToolId exists, no shape factory, no tool class |
| ScaleTool | `packages/editor/src/tools/ScaleTool.ts` | ToolId exists, no tool class |

**Implementation pattern** — each extends `BaseTool`:

```typescript
// PolygonTool.ts
import { BaseTool } from './BaseTool';
export class PolygonTool extends BaseTool {
  id = 'polygon' as const;
  cursor(_state: ToolCursorState): CursorSpec { return { css: 'crosshair' }; }
  override onDragMove(ctx: ToolContext): void { ... }
  override onDragEnd(ctx: ToolContext): void { ... }
  override onDragCancel(ctx: ToolContext): void { ctx.setDraft(null); }
}
```

Register each in `getToolManager()` in `CanvasArea.tsx`:

```typescript
toolManager.register('polygon', () => new PolygonTool());
toolManager.register('star', () => new StarTool());
toolManager.register('arrow', () => new ArrowTool());
toolManager.register('scale', () => new ScaleTool());
```

### Phase 3e — Vector, content & utility tools

| Tool | File | Dependencies |
|---|---|---|
| PencilTool | `tools/PencilTool.ts` | RDP simplification + Schneider curve fit (needs `packages/editor/src/tools/fitting.ts`) |
| SliceTool | `tools/SliceTool.ts` | Defines export regions, no scene model change needed |
| EyedropperTool | `tools/EyedropperTool.ts` | Platform EyeDropper API + canvas fallback |
| NodeEditTool | `tools/NodeEditTool.ts` | Path shape variant in engine/types.ts + scene/types.ts + Rust Shape enum |
| BooleanActions | `tools/BooleanActions.ts` | Path boolean ops, needs path shape variant first |

## Deferred items

### 1. PencilTool — Freehand path creation

**When:** After `path` shape variant exists in engine/scene types.

**Research gate:** Study Schneider's algorithm ("An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems 1990) and Ramer-Douglas-Peucker simplification.

**Implementation:**

```typescript
// packages/editor/src/tools/fitting.ts
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  // Ramer-Douglas-Peucker
}

export function fitCurve(points: Point[], tolerance: number): BezierSegment[] {
  // Schneider least-squares cubic Bezier fitting
}
```

**PencilTool gesture:**
- `pointerdown` → start capture, begin `requestAnimationFrame` point collection
- `pointermove` → push point to buffer (throttled by rAF)
- `pointerup` → run RDP → run Schneider → commit path shape
- Honour stylus `pressure` from `ToolContext.pointerPressure`

**Files:**
- `packages/editor/src/tools/fitting.ts` (new)
- `packages/editor/src/tools/PencilTool.ts` (new)
- `packages/editor/src/tools/__tests__/fitting.test.ts`

### 2. Snapping & Smart Guides

**When:** All geometry tools work.

**Research gate:** Study edge/center/spacing/distribution snapping in Figma/Illustrator.

**Implementation:**

```typescript
// packages/editor/src/tools/snapping.ts
export interface SnapTarget {
  edges: { left: number; right: number; top: number; bottom: number };
  center: { x: number; y: number };
}

export function snapPosition(
  pos: { x: number; y: number; w: number; h: number },
  targets: SnapTarget[],
  grid: number,
  threshold: number,
): { x: number; y: number; hints: SnapHint[] }
```

**Smart guide rendering:**
- SVG overlay `SnapGuidesOverlay.tsx` positioned on top of the canvas
- Renders guide lines in red/magenta (token) with distance labels
- Lines extend edge-to-edge of visible canvas area
- Fade-in/out animation via CSS opacity (respect `prefers-reduced-motion`)

**Integration:**
- `BaseTool` calls `ctx.snapPosition()` during `onDragMove`
- Snap results modify the computed rectangle/line position
- Status bar shows snap state (snap toggle, grid size)
- `ToolContext.snapEnabled` and `EditorState.snapEnabled` added in Session 9

**Files:**
- `packages/editor/src/tools/snapping.ts` (new)
- `packages/editor/src/components/SnapGuidesOverlay.tsx` (new)

### 3. Floating Bottom-Center Toolbar

**When:** All tools exist and work.

**Research gate:** W3C APG Toolbar pattern, Figma floating toolbar implementation.

**Design:**

```
┌─────────────────────────────────────────────────────┐
│  [V] [H] [K]  │  [F]  │  [R] [O] [U] [S] [L] [→]  │  [P] [✏] [N]  │  [T] [I]  │  [✂] [💉]  │
│  Select Hand Scale │ Frame │ Rect Ellip Poly Star Line Arrow │ Pen Pencil Edit│ Text Image│ Slice Eye  │
│     Navigate      │ Contnr│           Shapes            │   Vector    │  Content  │  Utility   │
└─────────────────────────────────────────────────────┘
```

| Aspect | Value |
|---|---|
| Position | `fixed; bottom: 20px; left: 50%; transform: translateX(-50%);` |
| Shape | Pill, `border-radius: var(--radius-pill)` (~24px) |
| Background | `color-mix(in srgb, var(--color-surface-sunken) 92%, transparent)`, `backdrop-filter: blur(12px)` |
| Shadow | `box-shadow: var(--elevation-overlay)` |
| Z-index | Above canvas, below modals/menus |

**Tool groups with flyouts:**
- Groups with >1 tool show active icon + chevron
- Click chevron (or long-press on touch) → menu with all group tools
- Last-used per group remembered in session state
- `aria-haspopup="menu"`, proper menu keyboard nav

**Responsive:**
- Narrow viewports: `overflow-x: auto` with hidden scrollbar
- Very narrow: collapse into overflow menu
- Touch: `min-width: 44px; min-height: 44px`

**Files:**
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` (new)
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.css` (new)
- `packages/editor/src/components/FloatingToolbar/ToolGroupFlyout.tsx` (new)
- `packages/editor/src/editor.css` — remove `editor-toolbar` grid row
- `packages/editor/src/Shell.tsx` — replace `ToolPanel` with `FloatingToolbar`
- `packages/editor/src/ToolPanel.tsx` — archive or delete

### 4. Path shape variant (required by Pen, Pencil, NodeEdit, Boolean)

**When:** Before PenTool full commit, PencilTool, NodeEditTool.

**Types to add:**

```typescript
// packages/engine/src/types.ts
export type Shape = { kind: 'rect'; ... }
  | { kind: 'path'; points: PathPoint[]; closed: boolean; tolerance: number };

export interface PathPoint {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
}
```

```typescript
// packages/scene/src/types.ts
// Add to Shape union in ShapeNode.shape
```

```rust
// crates/strata-core/src/shape.rs
Shape::Path { points: Vec<PathPoint>, closed: bool, tolerance: f64 }
```

```rust
// crates/strata-engine/src/lib.rs
Primitive::Path { points: Vec<PathPoint>, closed: bool, tolerance: f64 }
```

**Render (TS `replay.ts`):**
- Convert path points to cubic Bezier segments
- Render each segment using `ctx.bezierCurveTo()`
- Close path if `closed === true`
- Fill/stroke per node properties

### 5. Spring-loaded tools (cross-cutting)

**When:** After all tools work.

**Implementation:** Already partially built in `ToolManager.springLoadTool`/`releaseSpring`. Wire into CanvasArea `onKeyDown`:

```typescript
// CanvasArea onKeyDown
const toolKeyMap: Record<string, ToolId> = {
  'v': 'select', 'h': 'hand', 'z': 'zoom', 'f': 'frame',
  'r': 'rect', 'o': 'ellipse', 'l': 'line', 'p': 'pen', 't': 'text',
};

if (e.key === ' ' && !e.repeat) {
  // Space → spring-load Hand
  tmInst.springLoadTool('hand', ne, buildToolCtx(ne as any));
  return;
}
```

**Behavior:**
- Tap key → sticky tool switch (existing via useShortcuts)
- Hold key >150ms → spring-load (temporarily switch, restore on keyup)
- Space → always spring-load Hand (never sticky)
- `Escape` during spring → cancel, restore previous

### 6. EyedropperTool

**Algorithm:**
1. Try `window.EyeDropper` (Chromium-only, check support)
2. Fallback: read pixel from canvas via `ctx.getImageData(x, y, 1, 1)`
3. Apply color to current selection fill (or set active color)
4. Cancel on Escape

### 7. BooleanActions (Union/Subtract/Intersect/Exclude)

**When:** Path shape variant exists.

**Surfaced as:** Toolbar grouped flyout + Object menu, not modal tools.
**Enabled:** Only with 2+ shape nodes selected.
**Implementation:** Each action converts shapes to path → runs boolean op → single editable result path.
**Undo:** One undo entry per boolean action.

### 8. NodeEditTool

**When:** Path shape variant exists.

**Features:** Select/move anchors, add/remove anchors, convert corner↔smooth, box-select, handle symmetry, arrow nudge, Enter to enter/edit mode.
**Cursor:** Crosshair for add, default for select, move for drag.

### 9. SliceTool

**Creates:** Slice region nodes (metadata-only, no render impact).
**Export:** Feeds the Export panel.
**Cursor:** Crosshair with slice indicator.

## Test requirements

| Phase | Test type | File |
|---|---|---|
| 3d (Polygon/Star/Arrow/Scale) | Vitest — shape created, parent contained | `tools/__tests__/PolygonTool.test.ts` etc. |
| 3e (Pencil) | Vitest — point capture + simplification + fitting | `tools/__tests__/fitting.test.ts` |
| 2 (Snapping) | Vitest — grid/edge/center snap + spatial index | `tools/__tests__/snapping.test.ts` |
| 3 (Toolbar) | Vitest — APG toolbar keyboard nav, flyout menus | `FloatingToolbar/__tests__/FloatingToolbar.test.tsx` |
| 3 (Toolbar) | Playwright — visual regression, touch interaction | `tests/e2e/toolbar/toolbar.spec.ts` |
| All | Playwright — full E2E gesture flows | `tests/e2e/tools/tools.spec.ts` |
| All | axe-core zero violations (after each tool) | `tests/e2e/tools/axe.spec.ts` |

## Token additions (when toolbar is redesigned)

```css
--radius-pill: 24px;
--elevation-overlay: 0 4px 16px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08);
--color-toolbar-bg: color-mix(in srgb, var(--color-surface-sunken) 92%, transparent);
```

Can be added as one-offs in `FloatingToolbar.css`; promote to `tokens.css` if reused elsewhere.
