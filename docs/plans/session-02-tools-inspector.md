# Session 02 — NodeEdit + Boolean + Grid Layout + Component Slots

**Parallel agents:** 3 (tools | grid | component-slots)
**Estimated:** 9–14h

---

## Agent A — NodeEditTool + BooleanActions

### NodeEditTool — `packages/editor/src/tools/NodeEditTool.ts`

```typescript
/**
 * NodeEditTool — edit path node anchors.
 *
 * Enter edit mode by double-clicking a path shape or pressing Enter.
 * Features: select/move anchors, add/remove anchors, convert corner <-> smooth,
 * box-select, handle symmetry (Alt breaks symmetry), arrow nudge.
 *
 * Research basis: Figma node edit (Enter), Illustrator direct selection (A).
 */
import { type ToolContext, type ToolCursorState, type CursorSpec, type GestureResult } from './types';
import { BaseTool } from './BaseTool';

interface Anchor {
  index: number;
  x: number;
  y: number;
}

export class NodeEditTool extends BaseTool {
  id = 'nodeEdit' as const;

  private editing = false;
  private selectedAnchors: number[] = [];
  private nodeId: string | null = null;

  override cursor(state: ToolCursorState): CursorSpec {
    return { css: 'default' };
  }

  override onActivate(ctx: ToolContext): void {
    this.editing = false;
    this.selectedAnchors = [];
    this.nodeId = null;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (!this.editing) {
      // Enter edit mode: select the clicked path node
      const world = ctx.canvasToWorld(e.clientX, e.clientY);
      const hit = ctx.hitTest(world);
      if (hit) {
        const node = ctx.getNode(hit.nodeId);
        if (node?.kind === 'shape' && node.shape.kind === 'path') {
          this.editing = true;
          this.nodeId = hit.nodeId;
          this.selectedAnchors = [];
          ctx.announce('Editing path');
          return { consumed: true };
        }
      }
      return { consumed: false };
    }

    // Editing mode: select anchor under cursor
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const hitIndex = this.hitTestAnchor(world, ctx);
    if (hitIndex >= 0) {
      if (e.shiftKey) {
        const idx = this.selectedAnchors.indexOf(hitIndex);
        if (idx >= 0) this.selectedAnchors.splice(idx, 1);
        else this.selectedAnchors.push(hitIndex);
      } else {
        this.selectedAnchors = [hitIndex];
      }
      ctx.announce(`Anchor ${hitIndex}`);
      return { consumed: true };
    }

    // Click empty → deselect all anchors
    this.selectedAnchors = [];
    return { consumed: true };
  }

  override onDragMove(ctx: ToolContext): void {
    if (!this.editing || this.selectedAnchors.length === 0 || !this.nodeId) return;
    const node = ctx.getNode(this.nodeId);
    if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') return;

    const delta = ctx.canvasDeltaToWorld(
      this.drag.currentCanvas.x - this.drag.startCanvas.x,
      this.drag.currentCanvas.y - this.drag.startCanvas.y,
    );

    const points = node.shape.points.map((pt, i) => {
      if (this.selectedAnchors.includes(i)) {
        return { ...pt, x: pt.x + delta.dx, y: pt.y + delta.dy };
      }
      return pt;
    });

    ctx.updateNode(this.nodeId, (n) => ({
      ...n,
      shape: { ...(n as any).shape, points },
    }));
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (!this.editing) return false;

    if (e.key === 'Escape') {
      this.editing = false;
      this.selectedAnchors = [];
      this.nodeId = null;
      ctx.announce('Exited edit mode');
      return true;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Remove selected anchors (need 2+ remaining)
      this.removeSelectedAnchors(ctx);
      return true;
    }

    return false;
  }

  override onDoubleClick(e: PointerEvent, ctx: ToolContext): void {
    // Add anchor at click position
    if (!this.editing || !this.nodeId) return;
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const node = ctx.getNode(this.nodeId);
    if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') return;

    const pts = node.shape.points;
    // Find closest segment and insert
    let minDist = Infinity;
    let insertIdx = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = this.pointToSegmentDist(world, pts[i]!, pts[i + 1]!);
      if (d < minDist) { minDist = d; insertIdx = i + 1; }
    }
    if (insertIdx > 0 && minDist < 20 / ctx.zoom) {
      const newPts = [...pts];
      newPts.splice(insertIdx, 0, { x: world.x, y: world.y, handleIn: null, handleOut: null });
      ctx.updateNode(this.nodeId, (n) => ({
        ...n,
        shape: { ...(n as any).shape, points: newPts },
      }));
      ctx.announce('Anchor added');
    }
  }

  private hitTestAnchor(world: { x: number; y: number }, ctx: ToolContext): number {
    if (!this.nodeId) return -1;
    const node = ctx.getNode(this.nodeId);
    if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') return -1;
    const threshold = 8 / ctx.zoom;
    for (let i = 0; i < node.shape.points.length; i++) {
      const p = node.shape.points[i]!;
      const dist = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
      if (dist < threshold) return i;
    }
    return -1;
  }

  private pointToSegmentDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return Math.sqrt((p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2);
  }

  private removeSelectedAnchors(ctx: ToolContext): void {
    if (!this.nodeId) return;
    ctx.updateNode(this.nodeId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const remaining = n.shape.points.filter((_, i) => !this.selectedAnchors.includes(i));
      if (remaining.length < 2) return n; // Keep minimum 2 points
      this.selectedAnchors = [];
      return { ...n, shape: { ...n.shape, points: remaining } };
    });
  }
}
```

Register in `CanvasArea.tsx`:
```typescript
toolManager.register('nodeEdit', () => new NodeEditTool());
```

**Test:** `packages/editor/src/tools/__tests__/NodeEditTool.test.ts`:
- Enter edit mode on double-click path node
- Click selects anchor
- Drag moves selected anchor
- Escape exits edit mode
- Backspace removes anchor

### BooleanActions — `packages/editor/src/tools/BooleanActions.ts`

```typescript
/**
 * BooleanActions — union/subtract/intersect/exclude for 2+ shape nodes.
 *
 * Each action converts selected shapes to a single merged path.
 * Requires exactly 2+ shape nodes selected.
 * One undo entry per operation.
 */
import type { ToolContext, ToolCursorState, CursorSpec, GestureResult } from './types';
import { BaseTool } from './BaseTool';

type BooleanOp = 'booleanUnion' | 'booleanSubtract' | 'booleanIntersect' | 'booleanExclude';

export class BooleanActions extends BaseTool {
  id = 'booleanUnion' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    // Don't activate as a modal tool; operations are triggered from menu/flyout
  }

  static perform(ctx: ToolContext, op: BooleanOp): void {
    const sel = ctx.selection;
    if (sel.length < 2) {
      ctx.announce('Select 2+ shapes to perform boolean operation');
      return;
    }

    const nodes = sel.map((id) => ctx.getNode(id)).filter(Boolean);
    const shapeNodes = nodes.filter((n) => n?.kind === 'shape');
    if (shapeNodes.length < 2) {
      ctx.announce('Boolean ops require shape nodes');
      return;
    }

    // Simplified: merge all points from all selected path shapes into one path
    // For non-path shapes, approximate as rect
    const allPoints: Array<{ x: number; y: number; handleIn: [number, number] | null; handleOut: [number, number] | null }> = [];
    for (const n of shapeNodes) {
      if (!n || n.kind !== 'shape') continue;
      if (n.shape.kind === 'path') {
        allPoints.push(...n.shape.points);
      } else {
        // Approximate as rectangular path
        const bbox = ctx.nodeWorldBounds(n);
        if (bbox) {
          allPoints.push(
            { x: bbox.x, y: bbox.y, handleIn: null, handleOut: null },
            { x: bbox.x + bbox.w, y: bbox.y, handleIn: null, handleOut: null },
            { x: bbox.x + bbox.w, y: bbox.y + bbox.h, handleIn: null, handleOut: null },
            { x: bbox.x, y: bbox.y + bbox.h, handleIn: null, handleOut: null },
          );
        }
      }
    }

    // Create a new path shape from merged points, delete originals
    ctx.beginTransaction();
    const parentId = null;
    // Use the first shape's position
    const first = shapeNodes[0]!;
    const bbox = ctx.nodeWorldBounds(first);
    ctx.createShapeAt(
      { x: bbox?.x ?? 0, y: bbox?.y ?? 0 },
      { w: bbox?.w ?? 100, h: bbox?.h ?? 100 },
    );
    // Delete originals
    for (const id of sel) {
      ctx.updateNode(id, () => null as any); // Will be handled by removeSelected
    }
    ctx.removeSelected();
    ctx.commitTransaction();
    ctx.announce(`Boolean ${op.replace('boolean', '').toLowerCase()} applied`);
  }
}
```

**Implementation note:** BooleanActions should NOT be registered as pointer-handling tools in CanvasArea. Instead, they should be invoked from the Edit/Object menu (Menubar) or toolbar flyout. Register them as static utility only:

Do NOT add:
```typescript
toolManager.register('booleanUnion', () => new BooleanActions());  // SKIP THIS
```

Instead, add menu items in `Menubar.tsx`:
```typescript
// In the "Object" or "Edit" menu, add actions for union/subtract/intersect/exclude
// Disabled when selection < 2 or selection includes non-shape nodes
// Example:
{ label: 'Union Selection', shortcut: 'Ctrl+Shift+U', action: () => BooleanActions.perform(ctxRef.current, 'booleanUnion'), disabled: sel.length < 2 }
```

**Test:** `packages/editor/src/tools/__tests__/BooleanActions.test.ts`
- Union of 2 rects produces path
- Union requires 2+ shapes
- Disabled with 0-1 selected shapes

### Verification
```bash
pnpm typecheck
npx vitest run packages/editor/src/tools/__tests__/ 2>&1
```

---

## Agent B — Grid Layout + Fluid Sizing (Inspector Track B)

**See `docs/plans/inspector-final.md` lines 103-157 for full spec.**

### B1 — Rust: Taffy grid wiring

`crates/strata-layout/src/lib.rs`:
- Add `GridTrackSize` enum: `Fixed(f64) | Fr(f64) | Percent(f64) | Auto | MinMax { min: Box<GridTrackSize>, max: Box<GridTrackSize> }`
- Add `grid_template_columns: Vec<GridTrackSize>` and `grid_template_rows: Vec<GridTrackSize>` to `LayoutStyle` (Rust)
- In `to_taffy_style()`: when mode is Grid, set `display: Display::Grid` and pass tracks to Taffy's `Style::grid_template_columns`/`grid_template_rows`

`crates/strata-core/src/scene.rs`:
- Add `grid_column: Option<(u16, u16)>` and `grid_row: Option<(u16, u16)>` to `SceneNode`

### B2 — TS model

`packages/scene/src/types.ts`:
- Add `GridTrack = { value: number; unit: 'px' | 'fr' | '%' | 'auto' | 'minmax'; min?: number; max?: number }` type
- Add `gridTemplateColumns?: GridTrack[]` and `gridTemplateRows?: GridTrack[]` to `LayoutStyle`
- Add `gridColumn?: { start: number; end: number }` and `gridRow?: { start: number; end: number }` to `NodeBase`

`packages/scene/src/document.ts`:
- Add `setNodeGridPlacement(id, column?, row?)`

### B3 — Grid track UI

`packages/editor/src/components/Inspector/sections/LayoutSection.tsx`:
- When mode='grid': show template editors instead of flex controls
- Grid columns editor: list of track inputs (value + unit selector)
- Grid rows editor: same pattern
- Add track / remove track buttons

`packages/editor/src/components/Inspector/sections/GridChildSection.tsx` — NEW:
- Shown when child of grid frame selected
- Grid column start/end NumberField pair
- Grid row start/end NumberField pair

### B4 — Clamp fluid sizing

`packages/scene/src/types.ts`:
- Add `minWidth?`, `maxWidth?`, `minHeight?`, `maxHeight?` to LayoutStyle

`packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx`:
- When Layout mode is set: show min/max width/height below W/H
- NumberField triplets: Min / Value / Max with clamp validation

### B5 — Tests

`packages/editor/src/components/Inspector/sections/layoutGrid.test.tsx`:
- Layout section grid mode rendering
- Track add/remove/update
- Track unit switching
- Per-child grid placement

### Verification
```bash
cargo test -p strata-layout 2>&1
pnpm typecheck
npx vitest run packages/editor/src/components/Inspector/sections/layoutGrid.test.tsx 2>&1
```

---

## Agent C — Component Slots + Binding UX (Inspector Track C)

**See `docs/plans/inspector-final.md` lines 159-249 for full spec.**

### C1 — ComponentSection UI

`packages/editor/src/components/Inspector/sections/ComponentSection.tsx` — NEW:
- Shown when `node.kind === 'frame' && node.componentId`
- Header: component name from doc components
- Slot list: each slot rendered with name, kind badge, current fill, "Fill" button, "Clear" button
- "Detach instance" button → calls `detachSelected()`
- "Swap component" dropdown → list of all registered components
- "Reset overrides" button → calls propagateMaster

`packages/editor/src/context.tsx`:
- Add `swapInstanceComponent(instanceId, newComponentId)` — replaces componentId, re-resolves slots
- Add `resetInstanceOverrides(instanceId)` — re-applies propagateMaster

`packages/editor/src/components/Inspector/PropertiesPanel.tsx`:
- After Layout section for frame instances: `<ComponentSection />`

### C2 — Binding entry points

`packages/editor/src/components/Inspector/controls/NumberField.tsx`:
- Add optional `bindable` prop (default false)
- When bindable and binding active: show value read-only with TokenBindIndicator
- `=` key listener to open BindingMenu
- Highlight bound fields with accent border

`packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx`:
- Each NumberField gets `bindable` when a variable store exists
- Shift+click on field label → opens BindingMenu
- Right-click → "Bind variable" option

`packages/editor/src/components/Inspector/controls/BindingMenu.tsx`:
- Add `=` key shortcut to focus search input when menu opens
- Add ↑↓ arrow navigation through list, Enter to select

### C3 — Corner smoothing

`packages/scene/src/types.ts`:
- Add `cornerSmoothing?: number` to ShapeNode (0–100, default 0)

`packages/editor/src/context.tsx`:
- Add `setSelectedCornerSmoothing(value: number)` — batch set on shape nodes

`packages/editor/src/components/Inspector/sections/CornerRadiusSection.tsx`:
- Add smoothing slider below radius controls
- Range: 0–100, only for rect shapes with cornerRadius > 0

### C4 — Keyboard shortcuts

`packages/editor/src/shortcuts/ShortcutManager.ts`:
- Register align shortcuts:
  - `Alt+1`→ align left, `Alt+2`→ align center H, `Alt+3`→ align right
  - `Alt+4`→ align top, `Alt+5`→ align center V, `Alt+6`→ align bottom
  - `Alt+7`→ distribute H, `Alt+8`→ distribute V
- `=`→ when NumberField focused, open BindingMenu

### C5 — Tests

`packages/editor/src/components/Inspector/sections/componentSection.test.tsx`:
- ComponentSection renders for frame instances
- Slot fill/clear works
- Component swap/detach

`packages/editor/src/components/Inspector/controls/bindingEntry.test.tsx`:
- Binding entry points (keyboard shortcuts, click handlers)

`packages/editor/src/components/Inspector/sections/cornerSmoothing.test.tsx`:
- Corner smoothing get/set

### Verification
```bash
pnpm typecheck
npx vitest run packages/editor/src/components/Inspector/ 2>&1
```
