# Layers Panel — Deferred Implementation Plan

Use this in a future session to complete the remaining phases.

## Dependencies already installed

```bash
pnpm add @tanstack/react-virtual --filter @strata/editor
pnpm add -D @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities --filter @strata/editor
pnpm add -D -w playwright @axe-core/playwright @playwright/test
```

## Completed foundation (Phases 0–1)

| Area | Status | What was built |
|---|---|---|
| Tokens | Done | `tree-row`, `tree-row-hover`, `tree-row-selected`, `tree-row-focus`, `tree-indent-guide` in color.ts; all 51 pairs pass WCAG AA |
| Shared ordering | Done | `packages/shared/src/ordering.ts` — array-index facade, `generateKeyBetween`, `midPoint` |
| Scene model | Done | `GroupNode` in types.ts; `reparentNode`, `groupNodes`, `ungroupNode`, `detachInstance` in document.ts; 13 new tests |
| Editor context | Done | Shared `aria-live` announcer, undo+selection fix, `groupSelected`, `ungroupSelected`, `detachSelected`, `reparentNode` context actions |
| Layers panel directory | Done | `packages/editor/src/components/LayersPanel/` — `index.tsx`, `LayersTree.tsx`, `LayersRow.tsx`, `layers.css`, `useFlatTree.ts`, `useTreeFocus.ts`, `useTypeAhead.ts`, `useAutoName.ts` |
| APG Tree semantics | Done | `role="tree"` with `aria-multiselectable`, `role="treeitem"` with `aria-selected`/`aria-expanded`/`aria-level`, roving tabindex |
| Keyboard map | Done | ↑↓→← Home End Enter Space Shift+↑↓ Ctrl+A F2, type-ahead |
| Multi-select | Done | Shift+Click range, Ctrl+Click toggle, Shift+Arrow extend, Ctrl+A all |
| Row anatomy | Done | Disclosure triangle, type icon, auto-naming, visibility/lock toggles, inline rename (F2/dblclick), instance badge |
| Search/filter | Done | `<input>` at top, name filter, match collapsing |
| Context menu | Done | Rename, Delete, Lock, Hide, Copy/Cut/Paste stubs, Escape close |

---

## Phase 2 — DnD reorder + reparent

### Files to modify

| File | Changes |
|---|---|
| `packages/editor/src/components/LayersPanel/LayersTree.tsx` | Wrap in `<DndContext>`. Add `useSortable` + `useDroppable`. Render `DragOverlay`. Handle drop indicators. |
| `packages/editor/src/components/LayersPanel/LayersRow.tsx` | Accept sortable props, apply drag styles (`layers-row--dragging`). |
| `packages/editor/src/components/LayersPanel/layers.css` | Add `.layers-row--dragging`, `.layers-row--drop-before`, `.layers-row--drop-after`, `.layers-row--drop-into`. |

### Implementation outline

```tsx
// LayersTree.tsx
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableRow({ id, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={isDragging ? 'layers-row--dragging' : ''}>
      <LayersRow {...props} />
    </div>
  );
}
```

### Drop indicators

- Between rows: render a `<div>` at the drop position (before/after)
- Into container: highlight the container row background
- Use `onDragOver` to compute drop zone from `closestCenter` + mouse Y position
- Auto-scroll: `onDragOver` checks `scrollTop` near edges (80px threshold), calls `virtualizer.scrollBy`
- Auto-expand: `onDragOver` checks if hovering over collapsed container, starts a 600ms timer, then expands

### Keyboard reorder (Ctrl+[ / Ctrl+])

In `LayersTree`'s `handleKeyDown`:

```tsx
if ((e.ctrlKey || e.metaKey) && e.key === '[') {
  // Move up among siblings
  e.preventDefault();
  const parentId = entries[focusIdx]?.parentId;
  const siblingIds = getSiblingIds(state.document, parentId, focusIdx, entries);
  const myIdx = siblingIds.indexOf(nodeId);
  if (myIdx > 0) {
    reparentNode(nodeId, parentId, myIdx - 1);
    announce(`Moved ${node.name} above ${siblingIds[myIdx - 1]}`);
  }
}
```

---

## Phase 3 — Virtualization (already wired in LayersTree.tsx)

@tanstack/react-virtual is already imported and configured in `LayersTree.tsx`. Verify it works at 5000+ nodes:

```tsx
// Performance test — add temporarily to LayersPanel
for (let i = 0; i < 5000; i++) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = addNode(d2, makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: `Shape ${i}` }));
}
```

### Thumbnail optimization

Create `useThumbnail.ts` in the LayersPanel directory:

```tsx
export function useThumbnail(nodeId: NodeId): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    const idle = requestIdleCallback(() => {
      const canvas = new OffscreenCanvas(28, 28);
      const ctx = canvas.getContext('2d');
      // Render simplified shape to canvas
      // Convert to data URL
      setDataUrl(canvas.convertToBlob().then(b => URL.createObjectURL(b)));
    });
    return () => cancelIdleCallback(idle);
  }, [nodeId]);
  return dataUrl;
}
```

---

## Phase 4 — Playwright E2E + axe-core

### Setup

```bash
npx playwright install --with-deps chromium firefox webkit
```

### Test file: `tests/e2e/layers/layers.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Layers Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420');
  });

  test('keyboard navigation follows APG tree pattern', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    // Assert focused row changed
    await page.keyboard.press('ArrowRight');
    // Assert expanded
  });

  test('drag reorder changes paint order', async ({ page }) => {
    // Drag first row to third position
    // Assert reorder
  });

  test('multi-select with shift+click', async ({ page }) => {
    // Click first row, shift-click third
    // Assert 3 selected
  });

  test('inline rename with F2', async ({ page }) => {
    // Select row, press F2, type, Enter
    // Assert name changed
  });

  test('search filter narrows rows', async ({ page }) => {
    // Type in filter input
    // Assert only matching rows visible
  });

  test('context menu keyboard accessible', async ({ page }) => {
    // Shift+F10 or context menu key
    // Assert menu visible, navigate with arrows, select with Enter
  });
});
```

### Axe-core test: `tests/e2e/layers/axe.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('layers panel has no axe violations', async ({ page }) => {
  await page.goto('http://localhost:1420');
  const results = await new AxeBuilder({ page }).include('.layers-panel').analyze();
  expect(results.violations).toEqual([]);
});
```

### package.json script

```json
"test:e2e": "playwright test"
```

---

## Other deferred items

### 1. ImageNode + PathNode

**When:** After engine IR for image/path rendering.

| File | Changes |
|---|---|
| `packages/scene/src/types.ts` | Add `ImageNode` (`kind:'image'`, `src: string`, `w`, `h`), `PathNode` (`kind:'path'`, `points: Point[]`, `closed: boolean`) |
| `packages/scene/src/document.ts` | `makeImageNode()`, `makePathNode()` |
| `packages/editor/src/components/LayersPanel/useAutoName.ts` | Add `image: 'Image'`, `path: 'Path'` to `TYPE_LABELS` |
| `packages/editor/src/components/LayersPanel/LayersRow.tsx` | `nodeTypeIcon` already handles `image` and `pen`/`path` via `NODE_ICONS` |

### 2. Real fractional indexing (CRDT-safe)

**When:** Collab Phase 2 per AGENTS.md.

```bash
pnpm add fractional-indexing --filter @strata/shared
```

Replace `shared/src/ordering.ts` body:

```ts
import { generateKeyBetween as genBetween } from 'fractional-indexing';
export function generateKeyBetween(a: string | null, b: string | null): string {
  return genBetween(a, b, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
}
```

Add `order: string` field to `NodeBase`. Replace array-index ordering with order-key sorting in `rootChildren` and `FrameNode.children`.

### 3. Copy/Cut/Paste (system clipboard)

**When:** After ImageNode (for MIME type handling).

```ts
// context.tsx actions
copySelected: () => {
  const json = JSON.stringify(selectedNodes());
  navigator.clipboard.write([
    new ClipboardItem({ 'application/vnd.strata+json': new Blob([json], { type: 'application/vnd.strata+json' }) })
  ]);
}
```

### 4. Full context menu (Group/Ungroup, Detach, Bring Forward, etc.)

**When:** After scene model supports all actions.

Add to `index.tsx` handle actions:

```tsx
<ContextMenuItem label="Group" shortcut="Ctrl+G" onAction={handleGroupSelected} />
<ContextMenuItem label="Ungroup" onAction={handleUngroupSelected} disabled={!isGroupSelected} />
<ContextMenuItem label="Detach Instance" onAction={handleDetachSelected} disabled={!isInstanceSelected} />
<ContextMenuItem label="Bring to Front" shortcut="Ctrl+Shift+]" onAction={() => moveToFront(state.selection[0])} />
<ContextMenuItem label="Send to Back" shortcut="Ctrl+Shift+[" onAction={() => moveToBack(state.selection[0])} />
<ContextMenuItem label="Reveal on Canvas" onAction={handleRevealOnCanvas} />
```

### 5. Custom context menu portal (not position:fixed)

Replace the current inline `position: fixed` context menu with a Portal rendered at `document.body`. This prevents clipping by the panel's `overflow: hidden`.

```tsx
import { createPortal } from 'react-dom';
// ...
{contextMenu && createPortal(<div className="layers-context-menu" ... />, document.body)}
```
