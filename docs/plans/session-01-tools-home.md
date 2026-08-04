# Session 01 — Snapping + Floating Toolbar + Home Surface

**Parallel agents:** 3 (snapping/toolbar | home | inspector-fill)
**Estimated:** 10–14h

---

## Agent A — Snapping & Smart Guides + Floating Toolbar

### Snapping — `packages/editor/src/tools/snapping.ts`

```typescript
export interface SnapTarget {
  edges: { left: number; right: number; top: number; bottom: number };
  center: { x: number; y: number };
}

export interface SnapHint {
  type: 'edge' | 'center' | 'grid' | 'spacing';
  position: number;
  axis: 'x' | 'y';
  label?: string;
}

export function snapPosition(
  pos: { x: number; y: number; w: number; h: number },
  targets: SnapTarget[],
  grid: number,
  threshold: number,
): { x: number; y: number; hints: SnapHint[] } {
  let x = pos.x;
  let y = pos.y;
  const hints: SnapHint[] = [];

  // Grid snapping
  if (grid > 0) {
    const gx = Math.round(x / grid) * grid;
    const gy = Math.round(y / grid) * grid;
    if (Math.abs(gx - x) < threshold) { x = gx; hints.push({ type: 'grid', position: x, axis: 'x' }); }
    if (Math.abs(gy - y) < threshold) { y = gy; hints.push({ type: 'grid', position: y, axis: 'y' }); }
  }

  // Edge + center snapping (iterate targets)
  for (const t of targets) {
    const myCenterX = x + pos.w / 2;
    const myCenterY = y + pos.h / 2;
    const checks: [number, string][] = [
      [t.edges.left - x, 'x'], [t.edges.right - (x + pos.w), 'x'],
      [t.edges.top - y, 'y'], [t.edges.bottom - (y + pos.h), 'y'],
      [t.center.x - myCenterX, 'x'], [t.center.y - myCenterY, 'y'],
    ];
    for (const [delta, axis] of checks) {
      if (Math.abs(delta) < threshold) {
        if (axis === 'x') { x += delta; hints.push({ type: 'edge', position: x, axis: 'x', label: `${Math.round(delta)}px` }); }
        else { y += delta; hints.push({ type: 'edge', position: y, axis: 'y', label: `${Math.round(delta)}px` }); }
      }
    }
  }

  return { x, y, hints };
}
```

### Integrate into BaseTool

In `packages/editor/src/tools/BaseTool.ts`:
- Modify `computeDragRect(ctx)` to accept optional snap result and adjust x/y/w/h
- Add `protected snapDragRect(ctx: ToolContext): { x: number; y: number; w: number; h: number }` that calls `computeDragRect` then `ctx.snapPosition` with root node targets
- Same for `computeDragLine` → `snapDragLine`

**Important:** Only snap when `ctx.snapEnabled === true`. The `EditorState.snapEnabled` already exists on the context. Default is false.

### SnapGuidesOverlay — `packages/editor/src/components/SnapGuidesOverlay.tsx`

```typescript
// Renders SVG guide lines on top of canvas when snap is active
// Props: hints: SnapHint[], zoom: number, pan: { x: number; y: number }
// - Each hint renders a line from edge-to-edge of visible canvas
// - Color: var(--color-snap-guide) or hardcode #ff0066
// - Distance label at midpoint
// - CSS opacity transition (fade in/out)
// - Use position: absolute, pointer-events: none, z-index above canvas
```

### Floating Toolbar — `packages/editor/src/components/FloatingToolbar/`

Three files to create:

**`FloatingToolbar.tsx`:**
```tsx
// Tool groups:
//   Navigate: select (V), hand (H), scale (K)
//   Container: frame (F)
//   Shapes: rect (R), ellipse (O), polygon (U), star (S), line (L), arrow (A)
//   Vector: pen (P), pencil (N)
//   Content: text (T), image (I)
//   Utility: slice (J), eyedropper (I)
//
// Groups with >1 tool show active icon + chevron
// Click chevron → ToolGroupFlyout
// CSS: fixed bottom: 20px left: 50% transform: translateX(-50%)
// border-radius: 24px, backdrop-filter: blur(12px)
// box-shadow: 0 4px 16px rgba(0,0,0,0.12)
// bg: color-mix(in srgb, var(--color-surface-sunken) 92%, transparent)
// Keyboard: roving tabindex per APG Toolbar pattern
// Touch: min-width 44px, min-height 44px
```

**`ToolGroupFlyout.tsx`:**
```tsx
// Dropdown menu listing all tools in a group
// aria-haspopup="menu", role="menu"
// Keyboard: Enter/Space opens, arrow keys navigate, Escape closes
// Click selects tool and closes flyout
// Position above the toolbar
```

**`FloatingToolbar.css`:** Styles as described above.

**`Shell.tsx` changes:**
- Replace `<ToolPanel />` with `<FloatingToolbar />`
- Import from correct relative path

**`editor.css` changes:**
- Remove `.editor-toolbar` class and `toolbar` grid row
- Adjust grid-template-rows: remove `var(--toolbar-height)` from the row list
- Adjust grid-template-areas: remove `"toolbar  toolbar   toolbar"` row

**`ToolPanel.tsx`:** Archive — rename to `ToolPanel.tsx.archived` or just leave, remove all imports.

**Test:** `packages/editor/src/components/FloatingToolbar/__tests__/FloatingToolbar.test.tsx`
- Renders all tool groups
- Keyboard nav (Tab through groups)
- Flyout opens and tool selects

### Verification
```bash
pnpm typecheck
npx vitest run packages/editor/src/components/FloatingToolbar 2>&1
npx vitest run packages/editor/src/tools/__tests__/snapping.test.ts 2>&1
```

---

## Agent B — Home Surface items

### B1: Playwright E2E — `packages/home/e2e/`

Create 8 spec files in `packages/home/e2e/`:

1. **`home-shell.spec.ts`** — verify shell renders, sidebar nav selects
2. **`create-file.spec.ts`** — dialog opens, preset creates entry, `onOpenFile` fires
3. **`search-sort-filter.spec.ts`** — query narrows results, sort key/direction changes
4. **`keyboard-nav.spec.ts`** — arrow keys, Home/End, Enter on grid cards
5. **`context-menu.spec.ts`** — right-click opens menu, actions fire
6. **`trash-flow.spec.ts`** — delete → trash → restore → back to list
7. **`empty-states.spec.ts`** — correct headline per section
8. **`a11y.spec.ts`** — axe-core zero violations

Add `playwright.config.ts` at `packages/home/` extending root config.

**IMPORTANT — All these calls already exist in Tauri:**
- `home_search_files`, `home_reorder_file`, `home_get_thumbnail`, `home_put_thumbnail`
- The `generateThumbnail` function already runs after `onCreate` in `HomeShell.tsx`
- `DndContext` is already imported and used in `HomeShell.tsx`
- `FileGrid` already wraps items with `SortableContext`/`useSortable`

So the E2E tests will focus on verifying these existing integrations work correctly.

### B2: DnD reorder (already partially wired)

Check that `packages/home/src/FileGrid.tsx` already handles reorder. Verify:
- Drag ends produce `handleDragEnd` in `HomeShell.tsx`
- `platform.reorderFile()` is called with correct new ordering key
- `generateKeyBetween` from `@varve/shared` computes the correct fractional index

Add missing pieces if `platform.reorderFile` isn't wired in `tauri.ts`:

In `packages/platform/src/tauri.ts`:
```typescript
reorderFile: async (id: string, ordering: string) => {
  await invoke('home_reorder_file', { id, ordering });
},
```

### B3: File watcher — `apps/desktop/src-tauri/`

Add `notify` to `Cargo.toml`:
```toml
notify = "7"
```

In `src/lib.rs` `setup()` function (find `tauri::Builder::default().setup(|app| {`):
```rust
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc::channel;
use std::path::PathBuf;

// In setup:
let app_handle = app.handle().clone();
let app_dir = app.path().app_data_dir()?;
std::thread::spawn(move || {
    let (tx, rx) = channel();
    let mut watcher = RecommendedWatcher::new(tx, Config::default()).expect("watcher");
    if let Err(e) = watcher.watch(&app_dir, RecursiveMode::NonRecursive) {
        eprintln!("watch error: {e}");
        return;
    }
    for event in rx {
        if event.is_ok() {
            let _ = app_handle.emit("home:files-changed", ());
        }
    }
});
```

In `packages/platform/src/tauri.ts`, add event listener:
```typescript
listenForChanges: (cb: () => void) => {
  if (!window.__TAURI__) return () => {};
  let unlisten: (() => void) | undefined;
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen('home:files-changed', () => cb()).then((fn) => { unlisten = fn; });
  });
  return () => unlisten?.();
},
```

### B4: Perf measurement — measurement only

Use `createMemoryPlatform({ seed: { files: 5000, projects: 50 } })`, mount `HomeShell` in Chromium, run DevTools Performance recording. Document results in `docs/plans/home-surface-deferred.md`.

### Verification
```bash
pnpm typecheck
cargo check -p strata-sync
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cd packages/home && npx playwright test --reporter=list 2>&1
```

---

## Agent C — Inspector Fill Stacks (Track A)

See `docs/plans/inspector-final.md` Track A (lines 26-100) for full spec.

**A1 — Model: `fills: Fill[]` on all nodes**

`packages/scene/src/types.ts`:
- Add `fills?: Fill[]` to NodeBase (keep `fill: Color` for backward compat)
- When renders is undefined, default: `[{ type:'solid', color: fill, opacity:1, blendMode:'normal', visible:true }]`
- Update factories: `makeShapeNode`, `makeTextNode`, `makeFrameNode`, `makeGroupNode`

`packages/scene/src/document.ts`:
- Add `setFill(id, fills: Fill[])`, `addFill(id, fill: Fill)`, `removeFill(id, index)`, `reorderFill(id, from, to)`

**A2 — Engine: multi-fill rendering**

`packages/engine/src/types.ts`:
- Add `fills?: Fill[]` to `RenderItem`

`packages/engine/src/replay.ts`:
- When `fills` present: iterate, composite each with srcOver blending
- Solid fills: existing fill code
- Gradients: `createLinearGradient`/`createRadialGradient` with stop positions
- Keep `fill` fallback when fills absent

`crates/strata-engine/src/lib.rs`:
- Add `fills: Vec<Fill>` to `RenderItem` with `#[serde(default, skip_serializing_if = "Vec::is_empty")]`

**A3 — UI: FillSection rewrite**

`packages/editor/src/components/Inspector/sections/FillSection.tsx`:
- Rewrite to stacked fill list with swatch strip, add/remove/reorder buttons
- Active fill shows type selector, color picker (solid) or gradient editor

**A4 — GradientEditor and GradientStopSlider**

New components as specified in inspector-final.md lines 73-99.

**A5 — Tests**

`packages/editor/src/components/Inspector/sections/fillStacks.test.tsx`:
- Fill add/remove/reorder, type changes, gradient stop editing

### Verification
```bash
pnpm typecheck
npx vitest run packages/editor/src/components/Inspector/sections/fillStacks.test.tsx 2>&1
npx vitest run packages/engine/src 2>&1
cargo test -p strata-engine 2>&1
```
