# Sortable system

Varve uses dnd-kit for UI ordering, but a sortable collection is not a
generic replacement for every pointer gesture. The system has one shared
primitive for ordinary collections and domain adapters for interactions whose
drop changes document structure or ownership.

## Shared primitive

`@varve/ui` exports `Sortable`, `SortableItem`, `SortableItemHandle`, and
`SortableOverlay` from `packages/ui/src/components/Sortable.tsx`.

`Sortable` owns the repeated dnd-kit wiring:

- Pointer activation at 6 CSS pixels for ordinary collections;
- keyboard pickup/move/drop/cancel through `KeyboardSensor` and
  `sortableKeyboardCoordinates`;
- vertical, horizontal, or 2D grid sorting strategies (vertical collections
  use pointer-aware collision so a drop on a visible row is deterministic);
- collection-level `onDragEnd` and `onDragCancel` callbacks;
- stable-ID validation and same-item/no-target no-op behavior;
- the shared overlay class and restrained pointer-events behavior.

The collection does not mutate state during `onDragMove`. The owning feature
receives the completed active/over IDs and commits through its existing command,
history, and persistence boundary. `SortableItemHandle` is available when a
row contains controls; the whole item is only a drag target for simple tabs or
visual cards.

## Surface policy

| Surface | Adapter | Strategy | Collision | Commit |
| --- | --- | --- | --- | --- |
| Page navigator | `Sortable` | horizontal list | closest center | `reorderPagesCommand`, one document update |
| Home file collection | `Sortable` + virtualized grid item | responsive 2D grid | closest corners | async platform ordering/project move |
| Object Filters | `Sortable` + handle | vertical list | pointer within | selected-node document update, one transaction |
| Layers | `DnDShell` + `useLayersDnD` | virtualized tree resolver | live pointer + virtualizer geometry | hierarchy-aware `reparentNode`, one transaction for a multi-move |

The Layers adapter intentionally does not use `arrayMove`: `before`, `after`,
and `into` have different hierarchy meanings, raw scene order is opposite the
visual panel order, and a target may be offscreen. Its resolver is the single
authority for indicator, auto-expand, announcement, and commit.

## Interaction contract

Handles in ordinary collections are quiet at rest, gain contrast on row
hover/focus, and use a minimum 36px effective hit target even when the icon is
compact. They use
`grab`/`grabbing` cursors and never overlap disclosure, visibility, lock,
rename, menu, or scrollbar controls. Interactive controls stop activation at
pointer-down; stopping only click is too late.

Layers is deliberately the exception: it keeps the tree's compact row density
and uses the existing compact `--space-5` handle in the first column. Its
larger hit target
would make a 40-row document unnecessarily tall; tree controls remain outside
the handle and the specialized resolver owns its live pointer geometry.

An ordinary collection uses:

- a restrained raised overlay with `pointer-events: none`;
- reduced-opacity source content, retaining its layout slot;
- a single insertion line for before/after placement;
- a separate target treatment for container/invalid states where the domain
  supports them;
- no toast for a successful trivial reorder, but an accessible completion
  announcement where the feature already has an announcer.

Keyboard sorting is a non-drag alternative, not an announcement of every
pointer sample. Page tabs and filter rows retain their existing click and
control semantics. Cancel, missing IDs, missing destinations, stale targets,
and same-position drops leave the model unchanged and clear the overlay.

## Input, scroll, and performance

Pointer sensors are appropriate for mouse, trackpad, and pen in ordinary
collections. A dedicated handle uses `touch-action: none`; the surrounding
scroll area remains scrollable. Layers keeps its existing 5 CSS pixel
activation threshold and live-pointer auto-scroll implementation because it
must compose with virtualization and canvas drops.

The primitive only changes the active item and dnd-kit transforms during a
drag. It does not serialize, persist, or update the document on hover. The
Home grid remains virtualized; the Layers tree remains virtualized and resolves
offscreen rows through measurements. Panel resizing, canvas movement, marquee
selection, sliders, file import, effect-stack transfer, and panel docking are
specialized gestures and do not use this primitive.

## Persistence and undo

Page, filter, and layer order are document state: their commit goes through the
editor's immutable update/history boundary and survives save/reload. Layers
reparenting also preserves the existing world-space transform conversion and
frame-layout application. Home file ordering belongs to the platform library;
it is persisted by the platform adapter and refreshed after its async result,
not presented as document undo.

This boundary keeps transient drag state (`activeId`, `overId`, overlay and
drop indicator) out of serialized documents and prevents one undo entry per
pointer movement.

## Deliberate exceptions

The effect, fill, stroke, warp, master, design-canvas, selection-set,
inspector-section, and toolbar ordering surfaces currently expose explicit
move commands rather than drag. They should only be migrated when their
domain-specific model and visual destination semantics are specified. Native
file drops, canvas drags, and effect-stack transfer are not sortable ordering
and remain separate.
