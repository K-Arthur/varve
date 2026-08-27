# Layers panel drag and drop

How a layer gets reordered, reparented, or moved to the top level by dragging
it in the Layers panel — and the one invariant the whole design exists to
hold.

## The invariant

> The location and hierarchy shown under the cursor before release is the
> location and hierarchy produced after release.

This is not a quality bar, it is a structural property. It holds because
exactly one value decides where a drag lands, and both the preview and the
commit read that same value.

Any change that reintroduces a second opinion about the drop target —
recomputing an index at drag end, consulting dnd-kit's `over`, measuring rows
a second way — breaks it. Historically all three of those existed at once,
which is why the panel could highlight one row and deposit the layer in
another.

## Pipeline

```text
PointerSensor (dnd-kit, 5px activation distance)
     │
     ▼
window 'pointermove'  ──►  lastPointerRef {x, y}      real cursor, no delta math
     │
     ▼
resolveLayerDropTarget(pointer, viewport, contentTop, geometry, entries, doc)
     │
     ▼
┌──────────────────────────────────────────┐
│ LayerDropTarget                          │
│   targetId       row under cursor | null │
│   zone           before | after | into   │
│   targetParentId container | null (root) │
│   insertionIndex raw children[] index    │
│   clipInto       mask-source semantics   │
│   valid / reason cycle | locked          │
└──────────────────────────────────────────┘
     │                    │                    │
     ▼                    ▼                    ▼
drop indicator      auto-expand timer    aria announcement
     │
     ▼  pointer release — the same value, unchanged
computeMultiMoveSteps  ──►  reparentNode × N  ──►  one history entry
```

Modules:

| File | Role |
| --- | --- |
| `layerDropResolver.ts` | The resolver. Pure; no DOM, no React. |
| `layerMovePlan.ts` | Turns one target into a composable sequence of reparent steps. |
| `useLayersDnD.ts` | The gesture: pointer tracking, auto-expand, auto-scroll, commit. |
| `LayersTree.tsx` | Tree rendering and keyboard navigation. Owns no drop semantics. |
| `Shell/DnDShell.tsx` | The `DndContext`, the single drag overlay, and layer→canvas drops. |

## Why the pointer, and not `event.over`

dnd-kit's default collision detection is `rectIntersection`, and the editor
registers a `canvas-drop-zone` droppable that covers most of the window. A
28px row loses that comparison often enough to matter, so `over` could name
the canvas while the cursor was plainly over a row — or name a row while the
cursor was over the canvas.

`over` also only changes when the *winner* changes, which happens as the
cursor crosses a row boundary. A row's middle band is never a boundary, so an
`over`-driven resolver could never reach the `into` zone at all: dropping onto
a frame was unreachable, and reorder "worked" only because it is edge-driven.

The resolver therefore ignores `over` entirely. `onDragMove`/`onDragOver` are
still wired, but only as extra ticks; the authoritative signal is a
`pointermove` listener installed for the life of the drag.

The pointer is read straight from the event rather than reconstructed as
`activatorEvent.clientY + delta.y`. dnd-kit folds scroll compensation into
`delta`, so the reconstruction drifts from the real cursor by exactly the
distance the tree has auto-scrolled — worst precisely when precision matters.

## Why virtualizer measurements, and not DOM rects

The tree is virtualized (`@tanstack/react-virtual`, 28px rows, overscan 10).
Roughly twenty rows exist in the DOM at any moment out of however many the
document has.

A hit test that walks mounted row elements can only ever address those twenty.
During auto-scroll, rows mount and unmount continuously under the cursor, so
the target would vanish and reappear mid-gesture. It also cost one
`getBoundingClientRect()` per mounted row per pointer sample.

Geometry now comes from `virtualizer.measurementsCache`, which holds
`{start, end}` for **every** row, mounted or not. Resolution is a binary
search over that array plus two constant-cost rect reads (the scroll viewport,
and the scroll content whose own top edge carries the scroll offset). Cost per
pointer sample is O(log N) and independent of document size.

Rows deliberately do **not** receive dnd-kit's sortable transform. Stacking a
sort transform on the virtualizer's `translateY` makes the visible row and the
hit-tested row diverge during scroll and mount/unmount. Live sibling
displacement is traded for a drop indicator that is always right.

## Hierarchy semantics

Visual order is the reverse of array order: the panel lists front-most first,
`children[]` stores back-to-front. Every index the resolver returns is already
converted, so callers never reverse anything themselves.

| Zone | Meaning | `targetParentId` | `insertionIndex` |
| --- | --- | --- | --- |
| `before` | Immediately above the target row | target's parent | `indexOf(target) + 1` |
| `after` | Immediately below the target row | target's parent | `indexOf(target)` |
| `into` | Last child of the target container (visual top) | target | `children.length` |
| `into` on a mask source | Clipped to that matte | matte's parent | `indexOf(matte) + 1` |
| root (no row under cursor) | Top level of the active page, visual bottom | `null` | `0` |

Bands within a row: a container reserves 30–70% for `into`, leaving ~8px of
`before` and `after` on a 28px row. A leaf row splits cleanly in half and has
no `into` zone — there is no coherent meaning for one.

`targetParentId: null` means **the active page's content root**, not
`doc.rootChildren`. `rootChildren` holds each page's contentRoot group id, not
page content; computing an index against it would place a layer among pages.
`siblingsOf(doc, null)` and `reparentNode(id, null, i)` agree on this
resolution, and they must continue to.

### Invalid targets

An invalid target is still *resolved* — it has a row and a zone — so the panel
can show why the drop will not happen, rather than appearing to accept it and
then silently doing nothing on release.

- `cycle` — the target is the dragged node or sits beneath it. Rendered with
  `.layers-row--drop-invalid`.
- `locked` — the destination container is locked. `reparentNode` enforces the
  lock model regardless; this only makes the refusal visible in advance.

A `null` return is a different answer from an invalid target: it means the
cursor is not over the Layers tree at all, and the panel claims nothing.

### Multi-selection

Dragging a row that belongs to the current selection moves the whole selection
(Figma/Sketch/Illustrator convention). `resolveDragMoveIds` drops any selected
node whose ancestor is also selected — it travels inside its parent's subtree
and must not be reparented a second time.

`computeMultiMoveSteps` plans the move as a sequence, because `reparentNode`
applies one node at a time and each call removes the node before splicing it
back. Offsetting a base slot by "how many moved ids sit below it" is wrong for
the same reason: the members of the run that have not moved yet are still
occupying slots underneath the insertion point, so the plan must be simulated
step by step. The run stays contiguous and keeps its internal order; the whole
operation is one history entry via `beginTransaction`/`commitTransaction`.

Mixed-parent selections work: ids absent from the target sibling list are
simply arrivals, and the simulation accounts for them.

### Filtering and isolation

Structural drag stays enabled while the tree is filtered or isolated. Indices
are computed against the **full** sibling array via `indexOf`, never against
the filtered row list, so "immediately above the row you can see" resolves to
the correct slot even when the siblings between are hidden from view.

### Not supported

Cross-page dragging. The tree is scoped to the active page, and a drop with no
row under the cursor resolves to that page's content root. Moving layers
between pages goes through the page/move commands, not the Layers panel.

## Auto-scroll and auto-expand

Auto-scroll runs a continuous `requestAnimationFrame` loop for as long as the
cursor sits within 56px of a panel edge, moving `0.9px/ms × intensity`. Two
properties matter:

- It is **time-based**, so the speed is the same on a 60Hz and a 144Hz
  display. A per-frame constant runs more than twice as fast on the latter.
- It **re-resolves the target every frame**. The cursor is usually stationary
  while auto-scrolling — that is the whole gesture — so without this the
  indicator would freeze while rows slid past underneath it.

Auto-expand springs a hovered collapsed container open after 500ms. The timer
is not restarted while it is already pending, so pointer jitter inside the row
cannot postpone it indefinitely.

## Gesture disambiguation

The row is draggable from anywhere on it, which means dnd-kit's `pointerdown`
listener sits above every control nested inside the row. Those controls
(disclosure triangle, selection checkbox, visibility/lock/solo toggles) stop
`pointerdown` themselves — stopping `click` is far too late, since the drag has
already activated by then. The rename input is excluded from drag listeners
entirely so selecting text is not hijacked into a reorder.

A completed drag also produces a synthetic `click` on the dropped row, which
would run the row's ordinary click handler and replace the selection the user
just moved. Drag end installs a one-shot capturing `click` listener to swallow
it.

A structurally unchanged drop — releasing a row where it already sits — is
detected by `isNoOpMove` and commits nothing, so it spends no undo step and
causes no flicker.

## Tests

| Layer | Location |
| --- | --- |
| Resolver (pointer → target, zones, indices, validity) | `layerDropResolver.test.ts` |
| Move planning, composed step-by-step application | `dragMove.test.ts` |
| Real-pointer invariant: preview read mid-drag vs committed hierarchy | `tests/e2e/layers/layers-dnd-invariant.spec.ts` |
| Real-pointer reorder/reparent/lock/cycle/auto-scroll | `tests/e2e/layers/layers-drag-drop.spec.ts` |

The E2E invariant suite reads the drop indicator **while the button is still
down** and asserts the committed hierarchy matches it. A test that only
inspected the final scene would pass on a drag that previewed the wrong row,
which is the exact failure this system was rebuilt to eliminate.
