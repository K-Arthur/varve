# Auto Layout / Responsive Layout System

**Canonical doc** — audit status, model, engine, and merge plan.

## 1. Current State (2026-08-16)

| Capability | Scene Model | Engine | Inspector | Canvas | Tests | Status |
|---|---|---|---|---|---|---|
| Horizontal layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Vertical layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Padding | ✓ | ✓ | ✓ (per-side) | ✓ | ✓ | **Working** |
| Gap | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Reverse direction | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Wrap | ✓ | ⚠ | ✓ | ✓ | ✓ | **Engine wraps even when wrap=false** |
| Alignment (cross) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| JustifyContent | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Fill container (primary) | ✓ | ⚠ | ✓ | ✓ | ⚠ | **Equal split, not fill-after-fixed** |
| Fill container (secondary) | ✓ | ✗ | ✓ | ✗ | ✗ | **Missing: equal split instead of fill-after-fixed** |
| Fixed size | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Hug contents | ✓ | Partial | ✓ | ✗ | ✗ | **No intrinsic hug for nested frames** |
| Absolute child | ✓ (new) | ✗ | ✓ (new) | ✗ | ✓ | **Model + UI added, engine pending** |
| Per-axis sizing | ✓ (new) | ✗ | ✓ (new) | ✗ | ✓ | **Model + UI added, engine pending** |
| Min/max constraints | ✓ | ✗ | ✓ | ✗ | ✓ | **Model + UI exist, engine ignores them** |
| Hidden children | ✓ | ✗ | N/A | N/A | ✓ | **Model exists, engine doesn't filter** |
| Nested layout | ✓ | Partial | N/A | N/A | ✓ | **Single-level only; recursive pending** |
| Grid layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** (basic) |
| Components/instances | ✓ | ✓ | ✓ | N/A | ✓ | **Working** (layoutStyle synced) |
| Text intrinsic | ✓ | ✓ | N/A | N/A | ✓ | **Working** (measureText) |
| Codegen | ✓ | N/A | N/A | N/A | Partial | **Basic flex mapping exists** |
| Save/reopen | ✓ | N/A | N/A | N/A | ✓ | **Working** (schema stable) |
| Undo/redo | ✓ | N/A | N/A | N/A | ✓ | **Working** (via updateDoc) |

## 2. Architecture

```
Scene Model (persistent)
    │
    ├── FrameNode.layoutStyle      → container properties (direction, gap, padding, align, justify)
    ├── NodeBase.layoutSizing      → legacy unified sizing (fixed/hug/fill)
    ├── NodeBase.layoutSizingWidth → NEW per-axis width sizing
    ├── NodeBase.layoutSizingHeight→ NEW per-axis height sizing
    ├── NodeBase.layoutPosition    → NEW flow/absolute
    ├── NodeBase.layoutAlign       → NEW child cross-axis override
    ├── NodeBase.minWidth/maxWidth → constraints (not yet resolved by engine)
    └── NodeBase.minHeight/maxHeight
    │
    ▼
Layout Engine (@varve/layout)
    │
    ├── computeFlexLayout()   → row/column, wrap, gap, padding, align/justify, fill/grow
    ├── computeGridLayout()   → explicit tracks, auto-flow, placement overrides
    ├── reflowLayoutChildren()→ document adapter: applies results to scene
    ├── resizeNodeGeometry()  → type-aware geometry resizing
    └── checkLayoutCycle()    → fill-in-hug cycle guard
    │
    ▼
Resolved Geometry (transform + size on each child)
    │
    ▼
Render Pipeline (Canvas2D / WebGPU / Export)
```

### Engine Phases

1. **Filter**: exclude hidden and absolute children from flow
2. **Measure**: compute intrinsic sizes (text via measureText, frames via geometry, shapes via bounds)
3. **Resolve sizing modes**: per-axis width/height (fill/hug/fixed) with min/max clamping
4. **Allocate**: distribute remaining space to fill/grow children, clamp to min/max
5. **Wrap**: create line breaks when children exceed available width
6. **Align**: cross-axis alignment per line (start/center/end/stretch, with per-child override)
7. **Distribute**: main-axis justification (start/center/end/spaceBetween/spaceAround/spaceEvenly)
8. **Output**: LayoutResult[] with resolved x, y, w, h per child

## 3. Files Changed

### Scene/Model
- `packages/scene/src/types.ts` — added `layoutSizingWidth`, `layoutSizingHeight`, `layoutPosition`, `layoutAlign`, `spaceEvenly`
- `packages/scene/src/canonical.ts` — added new fields to canonical key order

### Layout Engine
- `packages/layout/src/__tests__/autolayout.test.ts` — 5 new tests documenting engine bugs (skipped until engine fix)
- `packages/layout/src/computeFlexLayout.ts` — **owned by concurrent agent** (engine repair)
- `packages/layout/src/reflow.ts` — **owned by concurrent agent** (recursive reflow)

### Editor/Inspector
- `packages/editor/src/context/types.ts` — added `setSelectedLayoutSizingWidth`, `setSelectedLayoutSizingHeight`, `setSelectedLayoutPosition`
- `packages/editor/src/context.tsx` — implemented new setters with parent reflow
- `packages/editor/src/components/Inspector/sections/LayoutSection.tsx` — updated sizing labels to match Figma conventions
- `packages/editor/src/components/Inspector/sections/LayoutChildSection.tsx` — NEW child layout controls (position, width/height sizing)
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — wired LayoutChildSection for non-frame selections

## 4. Engine Bug Inventory

These 5 tests document bugs the concurrent agent's engine repair must fix:

| Test | Bug | Expected | Actual |
|---|---|---|---|
| wrap disabled | Engine wraps even when wrap=false | Both children on same line | Second child wraps |
| fill after fixed | Fill gets remaining space | fixed=100, fill=290 | Both=200 (equal split) |
| per-axis sizing | layoutSizingWidth used | w=400 (fill), h=30 (fixed) | w=80 (ignored) |
| hidden/absolute | Filtered from flow | 1 result (flow only) | 3 results |
| min/max clamp | Fill children clamped | w=180 (maxWidth) | w=400 (ignored) |

## 5. Merge Plan

The concurrent agent is repairing `computeFlexLayout.ts` and `reflow.ts`. When done:

1. **Unskip the 5 bug tests** — they should pass with the repaired engine
2. **Run `pnpm verify:affected`** to verify the full affected chain
3. **Run Playwright visual tests** for canvas rendering
4. **Commit** the engine fix alongside the model/inspector changes

## 6. Backward Compatibility

- Old documents without `layoutSizingWidth`/`layoutSizingHeight` fall back to `layoutSizing`
- Old documents without `layoutPosition` default to `'flow'`
- `layoutAlign` defaults to `'inherit'` (uses parent's alignItems)
- No schema migration needed — all new fields are optional
