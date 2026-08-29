# Deterministic Cross-Paradigm Undo/Redo Engine

## Executive Summary

Varve has a solid foundation: a persistent revision DAG (ADR-0019 Model A), a semantic diff system, typed operations, transaction grouping, and a content-addressed snapshot scheduler. The plan hardens and extends this foundation to meet the deterministic undo invariant across all vector and raster mutations, without replacing the existing architecture.

---

## Current State Diagnosis

### What works correctly

| Component | Status | Notes |
|---|---|---|
| Revision DAG (ADR-0019) | **Landed** | `undoRevision`/`redoRevision` move branch head correctly |
| EditorHistorySession capture | **Landed** | Semantic diff → `document.transaction-capture` → revision commit |
| Transaction grouping | **Landed** | Pointer gestures and slider scrubs produce one undo entry |
| Snapshot scheduling | **Landed** | Threshold-based (1000 ops, 5MB, 250ms, checkpoints, shutdown) |
| Branch divergence | **Landed** | New edits after undo correctly parent onto undone-to revision; `commitCapture` clears `redoTarget` |
| Raster immutable compositing | **Landed** | `compositeDabOnNode` creates new Map/tiles; old data stays alive via undo stack reference |
| In-memory undo fallback | **Landed** | 50-entry `Document[]` stack for non-migrated paths |

### Critical gaps (addressed by this plan)

| Gap | Impact | Priority |
|---|---|---|
| **Bypass mutation paths** (~10%) | createShapeAt, groupSelected, duplicateSelected, paste, logo geometry — raw `setState` + manual undo push. Persistent history never sees them. | P0 |
| **Raster tile serialization in semantic diff** | Every brush stroke diff includes full base64 tile data in the `document.transaction-capture` payload. Large strokes hit the 10MB limit. No content-addressed dedup. | P0 |
| **No raster tile before/after tracking** | The semantic diff serializes the entire `tiles` Map. A 100-dab stroke modifies 20 tiles but the diff serializes all 100. No dirty-tile optimization. | P0 |
| **Text editing per-keystroke** | No grouping for typing bursts, IME composition. Each keystroke = one undo entry. | P1 |
| **NumberField wheel per-tick** | Each scroll tick = one undo entry for inspector sliders. | P1 |
| **Dual undo stack confusion** | In-memory redo stack cleared on new edit; persistent `redoTarget` set to null. But abandoned revisions still exist in the DAG — invisible to the user but consuming storage. | P1 |
| **Epsilon in semantic diff** | `1e-6` tolerance on geometry fields. Tiny intentional changes below epsilon are dropped. History says "no change" when one exists. | P2 |
| **No compound operation grouping API** | No way to mark "select → transform → commit floating selection" as one undo entry. | P2 |

---

## Phase 1 — Migrate Bypass Mutation Paths into Transactions

**Goal**: Every authored mutation enters the transaction pipeline so persistent history captures it.

### 1A. createShapeAt → transaction-wrapped

`context.tsx:3763-3982` currently does raw `setState` + manual undo push.

**Change**: Wrap the shape creation in `beginTransaction()` → `updateDoc()` → `commitTransaction()`.

```typescript
createShapeAt: (world, size, parentId, pathPoints, pathClosed) => {
  beginTransaction();
  setState((s) => {
    // ... existing shape creation logic ...
    // but WITHOUT manual undo stack push
    return { ...s, document: newDoc, dirty: true };
  });
  commitTransaction();
}
```

**Verify**: `commitTransaction` calls `persistentHistoryRef.current.capture(before, after)`, so the shape creation enters the revision DAG.

### 1B. groupSelected / ungroupSelected → transaction-wrapped

`context.tsx:6861-6895`. Same pattern: remove manual undo push, wrap in transaction.

**Special consideration**: Group/ungroup affects node hierarchy. The existing `node.patch` operation handles `parentId`, `children` changes. The transaction capture diff will record all affected entities.

### 1C. duplicateSelected → transaction-wrapped

`context.tsx:4432-4577`. Deep clone + reparent. Wrap in transaction.

### 1D. paste → transaction-wrapped

`context.tsx:7817-7946+`. Clipboard import + subtree insertion. Wrap in transaction.

**Special consideration**: Cross-document paste may involve `foreignReferences` for masks. The capture records the full entity tree, so this is safe.

### 1E. Logo geometry (useLogoProject.ts)

Raw `setState` for logo-specific operations. Wrap in transactions.

### Migration safety

- All wrapped paths already check `inTransactionRef.current` before pushing undo entries
- `commitTransaction` checks reference equality to suppress empty transactions
- The in-memory undo stack remains as fallback during gradual migration

**Files changed**: `packages/editor/src/context.tsx`, `packages/editor/src/workspace/useLogoProject.ts`

---

## Phase 2 — Exact Replay Diff Separation

**Goal**: The history system never uses epsilon-based comparison for undo/redo replay.

### 2A. Add `ReplayDiff` mode to `diffDocuments`

`packages/history/src/diff.ts` currently has `epsilonPolicy: 'default' | 'exact'`.

**Change**: When called from `capture()` in `editorHistorySession.ts`, pass `{ epsilonPolicy: 'exact' }`.

```typescript
// editorHistorySession.ts:298
const diff = diffDocuments(before, after, { epsilonPolicy: 'exact' });
```

This ensures every authored numeric change — even `5e-7` — is captured in the revision.

**Impact on storage**: Some diffs will have more changes. This is correct: those changes ARE the authored state.

### 2B. Semantic diff retains default epsilon

The semantic diff continues to use epsilon for:
- Merge conflict resolution
- Review/summary generation
- Historical display in the History panel

The two modes are:
- **`'exact'`** — for replay capture (canonical hash must match)
- **`'default'`** — for human-facing review/merge

### 2C. Add replay hash assertion in tests

```typescript
it('tiny authored changes are captured exactly', () => {
  const before = { ...doc, nodes: { ...doc.nodes, [id]: { ...node, x: 10.0 } } };
  const after = { ...doc, nodes: { ...doc.nodes, [id]: { ...node, x: 10.0000004 } } };
  const diff = diffDocuments(before, after, { epsilonPolicy: 'exact' });
  expect(diff.changed).toBe(true);
  expect(diff.changes).toHaveLength(1);
  // Verify replay reproduces the exact target hash
});
```

**Files changed**: `packages/history/src/diff.ts` (add `epsilonPolicy` to options), `packages/editor/src/history/editorHistorySession.ts` (pass `exact`), `packages/history/src/__tests__/diff.test.ts`

---

## Phase 3 — Raster Tile History (Content-Addressed)

**Goal**: Brush/eraser/smudge undo restores exact pixel state without serializing full tile data into operation payloads.

### 3A. Content-addressed tile store

New module: `packages/history/src/rasterTileStore.ts`

```typescript
interface RasterTileEntry {
  tileKey: string;        // "{nodeId}:{col}:{row}"
  contentHash: string;    // SHA-256 of pixels
  pixels: Uint8ClampedArray;
}

interface RasterTileStore {
  put(entry: RasterTileEntry): Promise<string>;  // returns contentHash
  get(contentHash: string): Promise<Uint8ClampedArray | null>;
  has(contentHash: string): Promise<boolean>;
  deleteBatch(hashes: string[]): Promise<void>;
  stats(): Promise<{ totalTiles: number; totalBytes: number }>;
}
```

Implementation backed by IndexedDB (separate object store from history log).

### 3B. Tile dirty-tracking in compositeDabOnNode

`packages/scene/src/rasterLayer.ts` already tracks touched tiles in `compositeDabOnNode`. Extend to record:

```typescript
interface TileDirtyRecord {
  tileKey: string;
  beforeHash: string;   // hash of tile pixels before dab
  afterHash: string;    // hash of tile pixels after dab
  beforeSnapshot: Uint8ClampedArray;  // captured at dab start
}
```

### 3C. Raster delta operation type

New operation: `document.raster-delta`

```typescript
interface RasterDeltaPayload {
  nodeId: string;
  tiles: Array<{
    tileKey: string;
    beforeHash: string;
    afterHash: string;
  }>;
  beforeHash: string;
  afterHash: string;
}
```

**Application**: Look up `beforeHash` and `afterHash` in the tile store. Replace tile pixels.

### 3D. Integration with transaction capture

In `editorHistorySession.ts`, when the diff contains raster tile changes:

1. Extract raster delta from the diff (tile keys that changed)
2. Store before/after tile pixels in the content-addressed tile store
3. Record the `document.raster-delta` operation with content hashes
4. The semantic diff continues to record structural changes (node properties other than tiles)

**Hybrid approach**: Each raster-involving transaction produces TWO operations:
- `document.raster-delta` (pixel content, content-addressed)
- `document.transaction-capture` (structural/metadata changes only, excluding tile pixel data)

### 3E. Snapshot integration

When creating a snapshot, the snapshot includes a manifest of referenced tile hashes. On snapshot restore, verify all referenced tiles exist in the store.

**Files changed**: New `packages/history/src/rasterTileStore.ts`, `packages/scene/src/rasterLayer.ts` (dirty tracking), `packages/editor/src/history/editorHistorySession.ts` (raster-aware capture), `packages/scene/src/operations/ops/captureOps.ts` (raster-delta operation)

---

## Phase 4 — Transaction Coverage Enforcement

**Goal**: No new mutation path can silently bypass the transaction pipeline.

### 4A. Mutation guard

Add a development-mode assertion:

```typescript
// context.tsx — at the top of updateDoc
if (process.env.NODE_ENV === 'development' && !inTransactionRef.current) {
  console.warn('[history] updateDoc called outside transaction — persistent capture will use in-memory fallback');
}
```

This surfaces migration gaps during development without breaking production.

### 4B. Bypass inventory audit

Document remaining bypasses and their migration status in `docs/audits/history-mutation-inventory.md` (update the existing 2026-08-05 audit).

**Files changed**: `packages/editor/src/context.tsx`, `docs/audits/history-mutation-inventory.md`

---

## Phase 5 — Text Editing Grouping

**Goal**: Typing bursts and IME composition produce one undo entry, not one per keystroke.

### 5A. Text edit batching

`TextEditOverlay` calls `updateNode` per keystroke. Wrap in a debounce/grouping pattern:

```typescript
// TextEditOverlay uses a "typing burst" timer:
// - On first keystroke: beginTransaction()
// - On subsequent keystrokes within 500ms: continue transaction
// - On 500ms idle or IME composition end: commitTransaction()
```

### 5B. IME composition atomicity

IME composition events (`compositionstart` → `compositionupdate`* → `compositionend`) must not produce intermediate undo entries. The transaction stays open until `compositionend`.

**Files changed**: `packages/editor/src/components/TextEditOverlay.tsx` (typing burst grouping)

---

## Phase 6 — NumberField Wheel Grouping

**Goal**: Inspector slider/scroll gestures produce one undo entry.

### 6A. Wheel event batching

`NumberField` dispatches per-tick updates. Add transaction wrapping:

```typescript
// On first wheel event: beginTransaction()
// On subsequent wheel events within 200ms: continue transaction
// On 200ms idle: commitTransaction()
```

**Files changed**: `packages/ui/src/components/NumberField.tsx` (or wherever the inspector number input lives)

---

## Phase 7 — Persistent History Redo Semantics Clarification

**Goal**: Clear behavior specification for redo after undo-then-new-edit.

### Current behavior (verified correct)

```
A → B → C → Undo(C) → Undo(B) → Edit D

Persistent history:
  Revision chain: A ← B ← C (abandoned)
                   ↑
                   D (new head)
  
  redoTarget = null (cleared by commitCapture)
  User cannot redo to B/C
  B/C remain in DAG as abandoned descendants
  materializeDivergence() can preserve them as a named branch
```

**This is correct.** The persistent system correctly:
1. Clears `redoTarget` on new edit (line 407 of editorHistorySession.ts)
2. Parents new revision D onto current head A
3. Preserves B/C in the DAG for `materializeDivergence`

### In-memory stack behavior

```
undoStackRef: [A] (after undoing B)
redoStackRef: [B, C] (from undo operations)
New edit D:
  undoStackRef: [A, (snapshot-before-D)]
  redoStackRef: [] (cleared by updateDoc line 2901)
```

**This is also correct.** Redo is cleared on new edit.

### Documentation

Document this behavior in the architecture doc to prevent future confusion.

**Files changed**: `docs/architecture/persistent-history.md` (add redo-after-undo section)

---

## Phase 8 — Compound Operation Grouping API

**Goal**: Operations spanning multiple internal mutations can be marked as one undo entry.

### 8A. Explicit grouping API

```typescript
// context.tsx
const groupCompoundOperation = useCallback((label: string, fn: () => void) => {
  beginTransaction();
  fn();
  commitTransaction({ label });
}, []);
```

### 8B. Use cases

- **Select → Transform → Commit floating selection**: Wrap all three in one group
- **Create shape → Set fill → Set stroke**: Wrap in one group when user intent is "create styled shape"
- **Boolean operation**: Union of two paths → one entry

### 8C. Audit which operations need grouping

Review the mutation inventory for compound operations that currently produce multiple undo entries.

**Files changed**: `packages/editor/src/context.tsx` (add `groupCompoundOperation`), various tool files

---

## Phase 9 — Snapshot and Recovery Hardening

### 9A. Snapshot tile manifest

When creating a snapshot involving raster data, record which tile content hashes are referenced. On restore, verify all referenced tiles exist.

### 9B. GC safety

Tile GC must check:
- All branch heads
- All checkpoint refs
- All snapshots
- The current working document

A tile is unreachable only if no reachable revision/snapshot/branch references it.

### 9C. Crash recovery

If a commit fails between persisting tiles and creating the revision:
- The revision head doesn't move
- Orphaned tiles are GC'd on next integrity check
- The transaction is not recorded

**Files changed**: `packages/history/src/snapshots.ts`, `packages/history/src/rasterTileStore.ts`, `packages/history/src/recovery.ts`

---

## Phase 10 — Validation and Testing

### 10A. Cross-paradigm undo regression test

```
1. Create cubic Bézier path with fractional anchors:
   anchor[1].x = 120.12573
   anchor[1].y = 83.77311
   handleIn = [-17.38291, 4.99127]
   handleOut = [23.77831, -11.28441]

2. Edit one anchor (Action 1)

3. Create raster layer, paint overlapping brush stroke (Action 2)

4. Undo once → verify:
   - Raster pixels == pre-stroke state (hash comparison)
   - Vector geometry == post-Action-1 state (exact value comparison)
   - Same node ID, same anchor count, same handles

5. Undo twice → verify:
   - Vector geometry == initial state (exact)

6. Redo twice → verify:
   - Action 1 vector state restored exactly
   - Brush pixels restored exactly (hash comparison)
```

### 10B. Interleaving torture test

```
vector anchor edit
brush stroke
vector transform
eraser stroke
Boolean operation
raster mask stroke
path node deletion
image adjustment
undo × 8
redo × 8
```

At every step: record canonical document hash + raster tile hashes. Verify on undo/redo.

### 10C. Round-trip property test

For random valid edit sequences S0→S1→...→Sn:
- undo n times → verify state == S0
- redo n times → verify state == Sn

### 10D. Branch divergence test

```
A → B → C → Undo(C) → Undo(B) → Edit D

Verify:
- canRedo == false
- redo() is no-op
- D's parent == A in revision DAG
- B/C still reachable via store.getRevision
- materializeDivergence creates named branch with B→C chain
```

### 10E. Text grouping test

```
Type "hello" quickly → one undo entry
Undo → text reverts completely
```

### 10F. Persistence test

```
Edit vector path
Edit raster layer
Save
Close/reopen
Undo → verify exact restoration
Redo → verify exact restoration
```

### 10G. Raster hash comparison test

```
Paint stroke on 1024x1024 canvas
Record tile hashes
Undo → verify all affected tile hashes match pre-stroke
Redo → verify all affected tile hashes match post-stroke
```

**Files changed**: `packages/history/src/__tests__/`, `packages/editor/src/history/__tests__/`, new test files

---

## Implementation Order

| Phase | Dependencies | Estimated Risk |
|---|---|---|
| 1. Migrate bypass paths | None | Low — wrapping existing logic |
| 2. Exact replay diff | None | Low — flag change |
| 3. Raster tile store | None (new module) | Medium — new infrastructure |
| 4. Mutation guard | Phase 1 | Low — dev assertion |
| 5. Text grouping | None | Low — debounce pattern |
| 6. NumberField grouping | None | Low — debounce pattern |
| 7. Redo documentation | None | Zero — doc only |
| 8. Compound grouping | Phase 1 | Low — API addition |
| 9. Snapshot/recovery hardening | Phase 3 | Medium — edge cases |
| 10. Tests | All above | Low — additive |

---

## Files Changed (Major)

| File | Change | Phase |
|---|---|---|
| `packages/editor/src/context.tsx` | Wrap bypass mutations in transactions; add `groupCompoundOperation`; dev guard | 1, 4, 8 |
| `packages/history/src/diff.ts` | Add `epsilonPolicy: 'exact'` option | 2 |
| `packages/editor/src/history/editorHistorySession.ts` | Pass `exact` policy; raster-aware capture | 2, 3 |
| `packages/history/src/rasterTileStore.ts` | **New** — content-addressed tile storage | 3 |
| `packages/scene/src/rasterLayer.ts` | Add dirty-tile tracking to `compositeDabOnNode` | 3 |
| `packages/scene/src/operations/ops/captureOps.ts` | Add `document.raster-delta` operation | 3 |
| `packages/editor/src/components/TextEditOverlay.tsx` | Typing burst grouping | 5 |
| `packages/history/src/snapshots.ts` | Tile manifest in snapshots | 9 |
| `packages/history/src/recovery.ts` | Tile-aware recovery | 9 |
| `docs/architecture/persistent-history.md` | Redo semantics, raster history architecture | 7 |
| `docs/audits/history-mutation-inventory.md` | Updated bypass audit | 4 |

---

## Acceptance Criteria

- [ ] All mutation paths go through `beginTransaction/commitTransaction`
- [ ] `diffDocuments` called with `epsilonPolicy: 'exact'` for history capture
- [ ] Raster brush strokes stored via content-addressed tile hashes
- [ ] Undo restores exact vector geometry (no recalculation)
- [ ] Undo restores exact raster pixels (no brush re-execution)
- [ ] Redo after undo-then-new-edit correctly discards redo path
- [ ] Text editing produces one undo entry per typing burst
- [ ] Compound operations can be grouped as one undo entry
- [ ] Snapshot tile manifests verify tile integrity on restore
- [ ] GC does not delete tiles reachable from any revision/snapshot/branch
- [ ] Cross-paradigm undo regression test passes
- [ ] Interleaving torture test passes
- [ ] Round-trip property tests pass
- [ ] Persistence/reload tests pass
