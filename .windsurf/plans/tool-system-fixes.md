# Tool System Review + Targeted Fixes

**Status: COMPLETE** — All 3 priority fixes implemented via TDD, all gates pass (1415/1415 tests, 0 lint errors, 93/93 WCAG-AA tokens, 0 emoji violations). Committed as Session 29.

## Research Findings

Compared Move/Hand/Scale tool behaviors against Figma, Illustrator, and Affinity Designer.

### Professional Tool Conventions

| Feature | Figma | Illustrator | Affinity Designer | Strata (current) |
|---|---|---|---|---|
| Move undo | Single transaction per drag | Single transaction | Single transaction | OK — beginTransaction/commitTransaction |
| Scale undo | Single transaction per scale | Single transaction | Single transaction | **BROKEN — no transaction** |
| Scale tool switch mid-drag | Reverts partial scale | Reverts | Reverts | **BROKEN — no onDeactivate** |
| Keyboard nudge undo | Each nudge = 1 undo step | Each nudge = 1 undo step | Each nudge = 1 undo step | **MISSING — no transaction** |
| Shift+arrow = 10px | Yes | Yes | Yes | OK |
| Alt+arrow = 0.5px (sub-pixel) | No (Figma uses small nudge pref) | Yes | Yes | OK |
| Spacebar = spring-loaded hand | Yes | Yes | Yes | OK |
| Middle-click pan | Yes | Yes | Yes | OK |
| Momentum pan | Yes | No | No | OK (bonus) |
| Shift = constrain aspect (scale) | Yes | Yes | Yes | OK (snap to 0.25) |
| Alt = scale from center | Yes | Yes | Yes | OK (axis lock instead — different but valid) |
| Smart guides during move | Yes (edge/center snap) | Yes | Yes | OK (edge/center snap) |
| Smart guides during scale | Yes | No | No | **MISSING** (deferred — complex) |
| Multi-select resize handles | Yes (bounding box handles) | Yes | Yes | **MISSING** (deferred — SelectionOverlay change) |

## Priority Fixes (This Session)

### P0-1: ScaleTool missing undo transactions

**File:** `packages/editor/src/tools/ScaleTool.ts`

**Problem:** ScaleTool never calls `beginTransaction()` on pointer down or `commitTransaction()` on drag end. Scale operations cannot be undone via Ctrl+Z.

**Fix:**
- Add `ctx.beginTransaction()` at end of `onPointerDown` (after initial state is computed, before returning)
- Add `ctx.commitTransaction()` in `onDragEnd` (before clearing state)
- Add `ctx.abortTransaction()` in `onDragCancel` (before clearing state)

**Tests:**
- Verify `beginTransaction` called on pointer down with valid selection
- Verify `commitTransaction` called on drag end
- Verify `abortTransaction` called on drag cancel

### P0-2: ScaleTool missing onDeactivate cleanup

**File:** `packages/editor/src/tools/ScaleTool.ts`

**Problem:** No `onDeactivate` method. If user switches tools mid-scale drag, stale state persists and partial scale is not reverted.

**Fix:**
- Add `onDeactivate(ctx)` that aborts transaction if drag is active, clears `initialNodes`, `initialDist`, `initialUnionBbox`, resets drag state

**Tests:**
- Verify `abortTransaction` called when deactivating mid-drag
- Verify state cleared after deactivation

### P1-1: Keyboard nudge missing undo transaction

**File:** `packages/editor/src/tools/SelectTool.ts`

**Problem:** `onKeyDown` arrow key handler calls `setNodePosition` directly without wrapping in a transaction. Each nudge is not a coherent undo step.

**Fix:**
- Wrap the arrow key nudge block in `ctx.beginTransaction()` / `ctx.commitTransaction()`

**Tests:**
- Verify `beginTransaction` called before `setNodePosition` on arrow key
- Verify `commitTransaction` called after all nodes nudged

## Deferred (Not This Session)

- Smart guides / snapping during ScaleTool operations
- Multi-select resize handles in SelectionOverlay
- Distance measurement overlays during move
- Touch/stylus-specific optimizations
- Performance audit for large canvases
