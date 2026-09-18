# Layers Selection and Canvas Navigation

Varve keeps Layers selection, tree focus, canvas navigation, and authored
document state separate. Selecting a row may update the selection and
inspector without moving the camera; an intentional navigation command may
move the camera without changing the selection or artwork.

## User preference

The Layers options menu persists one preference named **When selecting
layers**:

| Mode | Selection activation | Camera |
| --- | --- | --- |
| Select only | Select the row and update the inspector | Preserve pan, zoom, and rotation |
| Reveal when needed | Select the row | Preserve zoom and rotation; pan only when the target is outside the padded usable viewport |
| Center selection | Select the row | Preserve zoom and rotation; center the resolved bounds |
| Fit selection | Select the row | Center the resolved bounds and fit them with padding |

The default for new or unset settings is **Select only**. The existing
`layers.autoReveal` setting has a different direction and remains separate:
it controls whether a canvas-originated selection expands and scrolls the
Layers tree. Changing either preference does not move the current camera.

## Layers panel visual anatomy

The Layers section is a child of the left editor rail, below the minimap and
surface-navigation owners. It must participate in that rail's flex layout as
the remaining space; it must not claim the rail's full height. The visual order
inside the section is stable:

```text
Layers + document count + panel actions
filter / advanced filter
hierarchy tree
contextual bulk actions (when two or more rows are selected)
selection sets (when present)
```

The hierarchy tree owns the flexible middle region. It may scroll or yield
height to the contextual bulk actions, but those actions must remain inside
the owning Layers rail. Narrow rails wrap the bulk count above its action row
and give the actions their own horizontal scroll lane. This is a layout
contract, not a second selection or command model.

The header count is a compact summary of the active surface's layer count. The
filter bar reports a live `n of m` result only while a filter is active; the
semantic `searchbox`, tree projection, and existing ARIA state remain
authoritative. Selection, type, color, mask, effects, motion, lock, and
visibility cues continue to use the row presentation contract documented in
`docs/audits/layers-panel-organization-audit-2026-08-31.md`.

## Activation and focus contract

Automatic camera movement is attached to deliberate, unmodified row
activation. It is not attached to the selection array itself. Consequently:

- Arrow, Home, End, and type-ahead move tree focus and scroll the row only.
- Enter activates the focused row and applies the configured single-row mode.
- Ctrl/Command selection toggles and Shift range assembly do not navigate per
  intermediate row.
- Expand/collapse, rename, visibility, lock, drag initiation, undo/redo, and
  canvas-to-Layers synchronization do not trigger Layers-to-canvas movement.
- Explicit commands remain available regardless of the automatic mode:
  **Reveal on Canvas**, **Center Selection**, and **Zoom to Selection**.

This keeps the focused tree item, primary selection, range anchor, and camera
as distinct state. Camera transitions are cancelled by direct pan/zoom/camera
input, and successive automatic requests replace the previous transition.

## Expansion integrity and persistence

The expansion set is user state and is treated accordingly (2026-09-17):

- **Document edits never re-expand.** Only containers that are genuinely new
  to the document — a different node *id* — are added to the expansion set
  (`expandAddedContainers` in `LayersTree.tsx`). A rename, restyle, or
  undo/redo produces a new node object under an existing id and leaves
  disclosure untouched. Imports and pastes expand their new containers so
  fresh subtrees are visible.
- **Search is a projection.** Filtering walks collapsed branches without
  mutating the expansion set; clearing the query restores the prior
  disclosure exactly (unit and E2E covered since 2026-08-31).
- **Drag auto-expand reverts.** Containers a drag sprang open collapse again
  after the drag unless the drop landed in them (or their subtree) — see
  `docs/architecture/layers-drag-drop.md`.
- **Detach transfer.** The set is mirrored into the panel-local presentation
  codec (`layers` / `expandedIds`, capped at 1 000 ids) so a detached Layers
  window restores the same disclosure and reattaches with it. It is
  window-local presentation state, never document content. Focus index and
  scroll offset intentionally reset on detach.

## Effective visibility (direct vs inherited)

Visibility inherits down the hierarchy: a child of a hidden group paints
nothing while its own `visible` flag stays true. Rows distinguish the two
states the same way lock does:

- directly hidden (`visible === false`): the existing 0.4-opacity row and the
  eye-off toggle;
- hidden through an ancestor: a lighter 0.62 treatment, an intermediate toggle
  style, and an accessible name that names the restricting layer
  (`isNodeEffectivelyHidden` / `hidingAncestorOf` in `scene/world.ts`).

The context menu's Show/Hide item carries the description "Hidden by an
ancestor layer" when the target is inherited-hidden. The command remains
enabled: setting the own flag is the correct eventual state, unlike an
ancestor-locked Lock, which is disabled because it cannot take effect.

## Range selection and row scrub

The visible tree is a flattened projection of the active surface. Its range
anchor and extent are stable `NodeId`s, not row indexes, because virtualization
can mount, unmount, filter, expand, or collapse rows during a gesture. The
same `selectionRangeBetween()` and `applySelectionRange()` helpers serve
Shift-click, Shift+Arrow, and the row-body pointer scrub. Replace/add behavior
is computed from the pointer-down selection snapshot, so reversing direction
does not shrink or reinterpret the range.

Row scrub uses measured virtualizer geometry and a bounded edge auto-scroll
loop. It previews rows without mutating committed selection or history, then
calls the bulk selection setter once on release (or clears the preview on
cancel/blur). The dedicated row grip is the only structural DnD activator;
disclosure, visibility, lock, checkbox, effect, and rename controls remain
control-owned. The active surface is the only range scope; cross-page ranges
remain the ADR-0195 follow-up.

## Bounds and active surfaces

Navigation resolves through the editor's canonical `nodeWorldBounds` service;
the Layers panel does not maintain a second approximate geometry engine. The
resolver unions the requested IDs, follows nested transforms, and filters
print navigation to the active publishing page's content root. It also
resolves adjustment rows through `resolveAdjustmentScope`:

- explicit-target adjustments navigate to their affected content;
- sibling-below and other supported scopes use the scene scope resolver;
- empty or invalid scopes return no target rather than fabricating a rectangle
  from the adjustment layer's transform.

The viewport is measured from the owned canvas content surface, not the window
or the full shell. Reveal projects all four target corners through the current
camera, so it preserves rotation and uses the minimum screen-space pan that
fits the target within padding. Center and Fit use the same projected camera
transform; Fit accounts for the rotated target AABB and the zoom limits.

Navigation is view state only. It does not write node transforms, selection
history, document history, export content, or authored scene data.

## Evidence and product decisions

Figma's public guidance supports selecting from either the canvas or Layers
panel, nested selection, multi-selection, and a separate Zoom to Selection
command. Figma's plugin viewport API also models center, zoom, bounds, and
`scrollAndZoomIntoView` as viewport state. Those references informed the
separation of selection from camera policy here; they do not establish that
Figma has Varve's four-mode preference.

- [Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Adjust your zoom and view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options)
- [Figma viewport API](https://developers.figma.com/docs/plugins/api/figma-viewport/)
- [WAI-ARIA Tree View pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

Figma Draw has a distinct sidebar and direct layer-preview zoom behavior, so
Draw-specific interactions are not treated as evidence that ordinary Figma
Design row selection should always move the camera. Varve keeps deliberate
icon double-click, findings, breadcrumbs, and the established Shift+2 Zoom to
Selection shortcut as explicit navigation routes.

## Validation contract

Pure camera and policy behavior is covered by:

- `packages/editor/src/navigation/layerNavigationPolicy.test.ts`
- `packages/editor/src/navigation/navigationBounds.test.ts`
- `packages/shared/src/viewport.test.ts`
- `packages/editor/src/settings.test.ts`

Real browser validation must cover the Layers options menu, each automatic
mode, focus-only keyboard movement, modifier/range selection, explicit
context-menu commands, reverse auto-reveal, interruption, and settled visual
states. Screenshots and recordings belong in the ignored Playwright output
directory; visual review must inspect the Layers tree, canvas, zoom readout,
and selection overlay together.
