# Persistent History — Mutation-Path Inventory (2026-08-05)

Part of the persistent step-level history architecture audit (Milestone 1).
Evidence gathered from `packages/editor`, `packages/scene`, `packages/platform`
on 2026-08-05. This inventory feeds ADR-0017 (authoritative mutation pipeline)
and the mutation-coverage work in Milestone 4.

## Deterministic-history follow-up (2026-08-28)

The original inventory is retained below as the baseline. The following paths
were audited again while hardening deterministic persistent replay:

| Path | Current transaction coverage | Persistent replay status |
|---|---|---|
| `createShapeAt` | Opens an owned transaction unless the caller already has one | Exact structural capture |
| `duplicateSelected` | Opens an owned transaction | Exact structural capture |
| `groupSelected` / `ungroupSelected` | Opens an owned transaction | Exact structural capture |
| `paste` | Opens an owned transaction | Exact structural capture |
| `TextEditOverlay` | 500 ms typing burst; IME commits atomically | One capture per burst |
| Inspector `NumberField` wheel | 200 ms idle burst when focused | One capture per scroll burst |
| Nested/compound work | Reference-counted nesting; `groupCompoundOperation(label, fn)` | Outer step only, labelled |
| Raster paint / erase / smudge | Transaction capture scans changed tiles | `document.raster-delta` replays committed bytes, never a brush algorithm |

`updateDoc` still emits a development warning when it is called outside a
transaction. That warning is intentionally non-fatal during the remaining
incremental migration; administrative replacement, viewport, selection, and
other runtime-only paths remain outside authored history by design.

Known follow-up: tile reachability GC and an external snapshot tile manifest.
The current snapshot codec preserves raster Maps and typed pixels directly and
refuses a lossy legacy raster snapshot.

## Summary

- **~90 % of undoable edits** flow through exactly two choke points in
  `EditorProvider`: `updateDoc(fn)` (`context.tsx:2488-2516`) and
  `updateNodeProp(id, updater)` (`context.tsx:2565-2577`).
- **~10 % bypass them** with raw `setState` plus a manual undo-stack push:
  create/duplicate/group/import paths (`context.tsx:3201, 3383, 3461, 3735,
  3870, 3987, 5764, 5785, 6561, 6656, 6675, 6206, 6274, 6352, 6430`) and
  `useLogoGeometry` (`context/useLogoGeometry.ts:57`).
- **Undo is in-memory only**: 50-entry stacks of immutable `Document`
  references in refs (`context.tsx:2226-2231`); reload wipes history
  (`resetUndo`, `usePersistence.ts:53,129`). Nothing durable records steps.
- **Transactions exist and are central**: `beginTransaction/commitTransaction/
  abortTransaction` (`context.tsx:2581-2634`); pointer-down→up drags, slider
  scrubs, and batch inspector edits already group into single undo entries.
  Empty transactions are suppressed by reference equality (`context.tsx:2606`).
- **`VersionHistoryService` is not wired** into production: the durable
  content-addressed version store exists (`versionHistory/VersionHistoryService.ts`)
  but has no production caller.
- **`EditorState.revision` is a dead counter** (declared `types.ts:338-339`,
  never incremented) — it cannot serve as a revision/hash key today.
- **`useHistory.ts` is dead code** (a near-duplicate of the transaction/undo
  machinery, no production importer).

## Authoritative update paths

| Path | Location | Undoable | Persisted | Notes |
|---|---|---|---|---|
| `updateDoc(fn)` | `context.tsx:2488` | Yes (unless in tx) | No (doc saved by Save/AutoSave) | ~130 call sites; all inspector setters, guides, variables, motion, prototype, components, pages |
| `updateNodeProp` / `updateNode` | `context.tsx:2565`, exposed `:4284` | Yes | No | Node-scoped sugar over `updateDoc` |
| Raw `setState` + manual push (create shape) | `context.tsx:3168-3378`, push `:3201` | Yes | No | Draw-tool creation |
| Raw `setState` + manual push (text) | `context.tsx:3381-3443`, push `:3383` | Yes | No | |
| Raw `setState` + manual push (frame preset) | `context.tsx:3446-3509`, push `:3461` | Yes | No | |
| Raw `setState` + manual push (duplicate / repeat / offset) | `context.tsx:3729/3868/3985`, pushes `:3735/3870/3987` | Yes | No | Alt-drag duplicates guard on `inTransactionRef` |
| Raw `setState` + manual push (group / ungroup) | `context.tsx:5759-5793`, pushes `:5764/5785` | Yes | No | |
| Raw `setState` + manual push (paste / import / batch import) | `context.tsx:6495-6671+`, push `:6561/6656/6675` | Yes | No | |
| Raw `setState` + manual push (adjustment layers, LUT, linked adj., copy edits) | `context.tsx:6205-6441`, pushes `:6206/6274/6352/6430` | Yes | No | |
| Direct stack + setState (logo geometry) | `context/useLogoGeometry.ts:44-105` | Yes | No | Pushes `undoStackRef` itself; descriptive label |
| `abortTransaction` | `context.tsx:2624-2634` | By design | No | Restores begin-time snapshot without an entry |
| `undo` / `redo` | `context.tsx:5092-5134` | n/a | No | `patch({document})`, no push |
| Load / new / open / tab switch / restore | `usePersistence.ts:118-148`, `context.tsx:7142-7278`, `:8258-8280` | Cleared | — | `resetUndo`; tab sessions only in-memory (`sessionStoreRef`) |
| Prototype playback auto-advance | `PrototypeContext.tsx:246` via `updateDoc` (`context.tsx:2551`) | **Yes — undo pollution** | No | Playback state-machine advance currently creates undo entries |

## Mutation categories (proposed typed operations)

| Mutation | Entry point | Current grouping | Undoable | Persisted | Deterministic | Proposed typed op |
|---|---|---|---|---|---|---|
| Add node | `createShapeAt` `context.tsx:3168`; `addNode` `document-nodes.ts:19` | per action | Yes | No | Yes | `node.create` |
| Move node | SelectTool drag → `updateDoc` (`context.tsx:4152`) | pointer-down→up tx | Yes | No | Yes | `node.move` |
| Update node with callback | `updateNode(id, fn)` `context.tsx:2565` | varies | Yes | No | No (opaque fn) | `node.patch` (validated) |
| Change fill | Inspector → `updateDoc` (`updateNodeProp`) | per edit; scrub grouped | Yes | No | Yes | `node.set-fills` / `node.patch` |
| Edit rich text | `TextEditOverlay` → `updateNode` (`CanvasOverlays.tsx:265-269`) | **per keystroke — no grouping** | Yes | No | Yes | `text.replace-range` |
| Reorder children | arrange/move ops `document-nodes.ts:219` | tx | Yes | No | Yes | `node.reorder` |
| Change variable | Variable UI → `updateDoc` (`docVariableStore.ts` read-only; mutations in context) | per edit | Yes | No | Yes | `variable.set-value` |
| Import asset | `batchImportNodes` `context.tsx:6673`; `findOrCreateEmbeddedAsset` `assets.ts:143` | per import | Yes | No | Yes | `asset.register` |
| Replace full document | `loadDocument`, restore-from-backup, crash recovery, tab restore | n/a | Cleared | Durable (file/backup) | n/a | classified **administrative replacement** (not authored op) |
| Delete node | `removeNode` `document-nodes.ts:77` (via `updateDoc`) | per action | Yes | No | Yes | `node.delete` |
| Rename | `renameNodeById` `LayersTree.tsx:690` | per rename | Yes | No | Yes | `node.rename` |
| Group / ungroup | `groupSelected`/`ungroupSelected` `context.tsx:5759/5776` | per action | Yes | No | Yes | `node.group` / `node.ungroup` |
| Duplicate / paste | `duplicateSelected`/`paste` `context.tsx:3729/6495` | per action | Yes | No | Yes | `node.duplicate` / `node.paste` |
| Component ops | Component UI → `updateDoc` | per action | Yes | No | Yes | `component.*` (create/detach/override) |
| Prototype playback | `PrototypeContext.tsx:246` | none | **Yes (should not be)** | No | Yes | classify as non-authored; exclude from user steps |
| Camera / viewport | `setCamera` `context.tsx:2668`, viewport ctx | none | No | Per-tab only | n/a | runtime-only, never logged |
| Selection | `SelectionContext.tsx:45-85` | none | No | No | n/a | runtime-only, never logged |

## Opaque updater callbacks (to be eliminated from persistent boundaries)

- `updateDoc((doc) => Document)` — dominant pattern, ~130 sites in context.tsx.
- `updateNode(id, (node) => SceneNode)` — tools (`NodeEditTool.ts:166,198,253,
  272`; `PenTool.ts:295`), `TextEditOverlay` keystrokes, `LayersPanel`, inspector.
- `insertImportedSubtree(doc, tempDoc, id, (n) => n)` — clone transform for
  paste/import (`context.tsx:510-560`).
- No `applyToNode`/`mapChildren` helpers exist (grep zero hits).

## Paths that bypass undo (must stay outside the log or be explicitly classified)

- Camera/zoom/pan, selection, tool state, draft previews, trimap/quick-mask
  buffers, subject-picker session state — runtime-only.
- Load, new-document, open-file, tab switch/close, recovery restore,
  restore-from-backup, migration — administrative state replacement.
- AutoSave/Backup services — read-only w.r.t. the document model.
- `useGridSettings` patches `documentGrid` into editor state directly
  (`useGridSettings.ts:64`) — view state, not document.

## Known grouping gaps (Milestone 4 transaction-policy work)

1. **Text editing**: one undo entry per keystroke (`CanvasOverlays.tsx:265-269`);
   no pause/caret/IME-aware grouping. IME composition never split (requirement).
2. **NumberField wheel**: `onWheel` does not open a transaction
   (`NumberField.tsx:220-227`) — one undo entry per wheel tick.
3. **Prototype playback advance** creates undo entries (undo pollution).
4. **Empty transactions** already suppressed (reference equality, `context.tsx:2606`).
5. Transaction **nesting** is refcount-free: nested begin/commit pairs share one
   snapshot; mismatched nesting is not guarded (see edge cases §34 of the plan).
