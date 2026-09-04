# ADR-0231: Canonical Layers presentation and specialist workflow ownership

- **Status:** Accepted for the 2026-08-31 Layers implementation slice
- **Date:** 2026-08-31

## Context

The Layers panel is the authoritative hierarchy surface, but its row
presentation was assembled from local switches. This made a frame, vector
shape, image-filled raster, native raster layer, export region, component,
instance, adjustment, and mask state harder to distinguish consistently. The
panel also rendered Layer States below the tree while Inspector rendered the
same document-backed workflow.

The scene model already provides the authoritative data:

- `Document.nodes`, `rootChildren`, and container `children` define structure
  and paint order;
- `Document.components` maps component definitions to their `masterRootId`;
- `FrameNode.componentId` identifies component instances;
- `NodeBase.mask` defines attached vector, raster, child-source, or live-matte
  mask state;
- `NodeBase.layerColor` stores author-assigned organization labels.

## Decision

### One derived row presentation contract

Use `resolveLayerPresentation(node, document)` in
`components/LayersPanel/layerPresentation.ts` as the canonical row contract.
It derives:

- compatibility `dataType`;
- structural/display `category`;
- specific `subtype`;
- user-facing type label;
- type icon.

It does not create a second hierarchy or duplicate scene state. Type identity
comes from the scene contract: image-filled shapes are raster images, ordinary
shape geometry is vector, native raster layers are raster layers, a component
definition is found from `masterRootId`, and an instance has `componentId`.

### Mask presentation without synthetic nodes

Do not insert synthetic mask rows. Keep the document tree authoritative and
show mask state on the owning row, with source/content relationship markers on
direct child rows when a structural child mask is used. The row exposes the
mask source form, mode, disabled state, and inversion in its status treatment
and accessible description. Inspector remains the editing surface for mask
parameters.

### Varve layer-color labels

Layer color is an authoring label, not a type. Preserve the existing seven
document colors and context/bulk commands, but render a label as a restrained
row backdrop tint plus a full-height leading color rail. Do not add a separate
colored marker or icon beside the name: the identity lane is already dense with
hierarchy and type affordances. The tint is suppressed by forced-colors. A
selected tagged row keeps its tag backdrop and rail while the selection outline
and foreground remain the dominant interaction state.

The type icon and leading type rail remain separate. Selected rows retain the
layer name remains the primary scan target. The color cue is therefore more
discoverable than a dot without turning every row into a saturated status card.

Tags are container-only metadata: a tagged group or frame does not make its
descendants tagged. Child tags remain independent through grouping, reparenting,
component operations, and page duplication. “Select same color” walks the
currently visible Layers surface and its descendants, but does not cross the
active page, design canvas, isolated subtree, or master-edit surface. It includes
only visible and unlocked matching nodes; an untagged node is not a selectable
“same tag” target.

The persisted value is the canonical logical color name or `null` for untagged.
The palette is shared by context actions, bulk controls, and filtering; its
theme-specific appearance is resolved by UI tokens and is never scene paint.
Assigning or clearing multiple tags is one document update and therefore one
undoable history step. Component instances copy the master root tag when created,
then retain an independent local tag.

Selection itself uses a restrained theme-aware row tint, an inset boundary, and
a stable leading rail. Its compact check-circle is retained only as a
pointer/touch affordance for selected or actively inspected rows; it is
aria-hidden because `aria-selected` on the treeitem is the single accessible
selection state. High-contrast and forced-colors use their stronger system
selection treatment.

### Layer States owner

Inspector is the sole visible UI owner of Layer States. Capture, apply, rename,
duplicate, recapture, and delete are selection/state editing actions and
remain available in the Inspector's document-backed section. Layers no longer
renders a duplicate list beneath the tree. Existing scene data and shared
commands are unchanged; no migration is needed.

If testing shows that users cannot discover Layer States from Layers, add a
single contextual deep link to Inspector. Do not add a second list.

### Composite widget

Keep Layers as an ARIA tree rather than changing to treegrid. Rows are
hierarchical selection/focus targets; secondary controls are bounded actions.
Selection and expansion are communicated by `aria-selected` and
`aria-expanded`, so those states are not repeated in the treeitem accessible
name.

## Consequences

### Positive

1. Type, raster/vector distinction, masks, and labels have one implementation
   path and one testable vocabulary.
2. Existing document IDs, ordering, commands, history, and persistence remain
   authoritative.
3. Layer States no longer competes with the tree for vertical space or creates
   two apparent owners.
4. Color labels remain useful for organization while type remains legible when
   labels are absent.

### Costs and follow-up

1. `LayerStatesSection` remains physically located under `LayersPanel` while
   Inspector is its visible owner; relocating the file is deferred to avoid a
   needless import migration during the current dirty worktree.
2. More mask forms and non-child live mattes need a richer projection contract
   if they become common in the hierarchy.
3. The row still contains several specialist summaries. A later progressive
   disclosure slice must measure name pressure and mounted-row cost before
   adding more metadata.
4. Tauri/WebKitGTK, touch, stylus, forced-colors, real screen-reader, and
   post-change 10,000-node performance verification remain required.

## Alternatives rejected

- **Synthetic mask tree nodes:** would duplicate scene structure and make
  reparenting/order semantics ambiguous.
- **Full-row type color washes:** would reduce name contrast and conflate type
  with user labels.
- **A second Layer States list with one collapsed:** still duplicates ownership
  and consumes discovery/scroll attention.
- **Treegrid:** would add cell-navigation complexity without a requirement for
  independently navigable status columns.
