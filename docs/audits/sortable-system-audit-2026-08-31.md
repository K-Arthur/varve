# Sortable and drag-reorder system audit — 2026-08-31

This is the repository-wide audit that precedes the sortable-system
consolidation. It records what is a reorder interaction, what is a different
kind of drag, and which state owner each legitimate reorder surface uses.

## Executive summary

Varve has four production reorder surfaces and several unrelated drag
interactions:

| Surface | Shape | Semantic operation | Current state owner | Decision |
| --- | --- | --- | --- | --- |
| Layers tree | Virtualized hierarchy | sibling reorder, reparent, root-level move, mask-aware clip | editor document through `updateDoc` and `reparentNode` | Keep as specialized tree adapter; share sensors/visual language only |
| Page navigator | Horizontal collection | page reorder | scene document through `reorderPagesCommand` | Migrate to shared sortable surface |
| Home file grid | Virtualized 2D collection + project targets | presentation order and cross-project move | platform file store; async refresh | Migrate to shared sortable primitives, retain platform adapter |
| Object Filters | Vertical stack | filter reorder | selected node in scene document through `updateNode` | Migrate native HTML5 DnD to shared sortable surface |

The Layers tree is not a candidate for `arrayMove()` or a generic flat list:
the panel's visual order is the inverse of the scene array, `into` changes
parentage, masks have special direct-child semantics, and only mounted rows are
available in the DOM. Its existing resolver is the correct domain boundary.

## Surface classification

### Reorder

- Layers among siblings, including rows under a frame/group and top-level page
  content.
- Pages in the page navigator.
- Files in the Home grid, where ordering is a user-facing library preference.
- Object Filters within one selected node.
- Effect, fill, stroke, warp, selection-set, section, design-canvas, and
  master ordering through explicit up/down or start/end commands. These are
  currently button-command surfaces, not drag surfaces; they should not be
  made draggable until each domain has an appropriate visible drop target and
  history contract.

### Reparent / cross-container move

- Layers into/out of frames and groups, between sibling containers, and to the
  active page surface. The Layers tree resolves this with a typed
  `LayerDropTarget`; there is no cross-page move from the tree.
- Files onto a Home project. This is a file-store move, not a document reorder,
  and must retain its async platform mutation path.
- Layers dragged from the Layers panel to the canvas. This is a specialized
  document-placement operation and must remain outside generic sorting.

### Grid and horizontal surfaces

- Home files are a responsive, virtualized grid. Collision and layout behavior
  must remain 2D-aware; virtualization cannot be removed to simplify sorting.
- The page navigator is horizontal and scrollable. It uses stable page IDs and
  a horizontal sorting strategy.

### Tree / hierarchy

The Layers tree supports:

- sibling `before` and `after` placement;
- `into` placement for frames/groups;
- moving out to the active page's content root;
- mask-source clip semantics;
- multi-selection moves with ancestor de-duplication;
- cycle and locked-destination validation;
- auto-expand and nearest-scroll-container auto-scroll;
- one document/history transaction at drop time.

The resolver uses virtualizer measurements and the live pointer rather than
mounted DOM rectangles or dnd-kit's `over`, because the editor's canvas drop
zone is large and only a window of rows is mounted.

## Implementations found

| Implementation | Files | Finding |
| --- | --- | --- |
| Global editor DnD shell | `packages/editor/src/components/Shell/DnDShell.tsx` | One editor context for layers-to-canvas and effect-stack transfer; overlay styling was local to the shell |
| Layers sortable rows | `LayersTree.tsx`, `SortableVirtualRow.tsx`, `useLayersDnD.ts` | Correctly specialized for virtualized hierarchy; row and handle both currently receive listeners |
| Page sortable tabs | `PageNav.tsx` | Separate `DndContext`, pointer distance 8, whole tab draggable, no reusable overlay |
| Home sortable cards | `HomeShell.tsx`, `FileGrid.tsx`, `FileCard.tsx` | Separate `DndContext`, pointer distance 8, virtualized grid; native file payload is also attached to the card |
| Native filter reorder | `SmartFiltersSection.tsx` | HTML5 `dragstart`/`dragover`/`drop`, local drag state, transaction lifecycle; controls share the draggable row |
| Effect-stack transfer | `EffectStackTransferBadge.tsx` | `useDraggable`, intentionally not reorder; transfers a stack onto another layer |
| Canvas/file/panel gestures | `CanvasArea.tsx`, tools, `ArchiveDialog.tsx`, `PanelWidthDragEdge.tsx`, controls | Not sortable: canvas movement, external file import, resizing, sliders, or editing gestures |

The duplicate production concerns are sensor configuration, sortable-item
transform/opacity wiring, and overlay/drop-state styling. The consolidation
introduces those as reusable UI primitives while leaving domain callbacks and
state mutation at the owning surface.

## State and history audit

- Document-semantic ordering uses immutable scene operations and the editor's
  `updateDoc`/transaction boundary. Reordering a layer or page marks the
  document dirty and is undoable.
- The Layers tree commits the preview target exactly once on drop. It does not
  write the authoritative document during pointer movement.
- Object Filters are document-semantic and already bracket native drag with one
  transaction, but a cancelled or failed HTML5 drop path is difficult to
  reason about and has no keyboard sorting path. The migration keeps the same
  `updateNode` owner and moves the transaction boundary to the sortable event
  lifecycle.
- Home file order belongs to the platform file library rather than the scene
  document. Its persistence is asynchronous and currently has no editor-style
  undo stack; the migration must not pretend it is document history.
- Selection, rename, visibility, lock, disclosure, context-menu, slider,
  canvas, and external-file gestures must not be routed through sortable state.

## Interaction requirements carried forward

- Stable IDs only; never use array indexes or labels as sortable IDs.
- Default pointer activation distance is 6 CSS pixels for ordinary collections.
  The Layers tree keeps its existing 5px activation contract for compatibility
  with its real-pointer tests. Touch/pen behavior must not disable panel scroll.
- Whole-item dragging is reserved for simple page tabs and visual file cards.
  Dense rows with controls use a dedicated handle.
- Every ordinary collection uses a visible insertion state, a restrained
  overlay, and a keyboard alternative where the collection owns document order.
- `onDragCancel`, stale IDs, missing destinations, and same-position drops are
  no-ops and must clear transient state.
- The tree's `before`/`after`/`into` indicator remains authoritative for both
  preview and commit. A generic sortable adapter must not be substituted for it.

## Follow-up audit boundaries

These surfaces have ordering commands but no drag affordance today: layer
effects, fills, strokes, warps, selection sets, inspector sections, design
canvases, masters, and toolbar tools. They are documented as explicit command
surfaces rather than silently converted. Adding drag to them requires a domain
design, visual drop indicator, and focused persistence/history tests.

The remaining `draggable` hits are intentionally specialized: icon/paint
insertion, OS file import, effect-stack transfer, canvas object movement,
retouch/curve/mesh editing, and panel-width resizing.
