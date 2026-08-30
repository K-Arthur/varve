# Master pages

Master pages are the publishing reuse system in Varve. They are distinct from
design frames, which are authored containers inside a surface, and from
components, which are reusable object instances. A page owns its local content;
a master owns a source tree that is projected onto assigned pages.

## Ownership and projection

```text
master source tree + page assignment + sparse page overrides
  → activePageNodesWithMaster
  → resolved render / hit-test / page thumbnail projection
```

The projection preserves inherited source ids. It emits global content, the
assigned master's visible top-level children, and the page-local children in
paint order. A `modified` override substitutes its local replacement node;
`hidden` and `deleted` overrides omit the inherited source node. Resolved
projection ids are not written into the page's local content root.

## Mutations and history

All supported master changes use the versioned `master.*` operation family and
the editor's normal `updateDoc` boundary. This covers creation, deletion,
rename, duplication, applicability metadata, assignment/detachment, one
override, one override removal, and reset-all-overrides. Validation checks page,
master, source-node, and replacement-node existence before applying a stale
panel action.

Detaching removes the assignment and all page override records. Resetting
overrides restores the assigned master projection while preserving the
assignment. Removing one override restores only that source node. A modified
override's replacement node is intentionally not garbage-collected by the
override operation; ownership cleanup belongs to a later detach/materialize
policy so a reset cannot destroy user content.

## Applicability and workspace scope

`MasterPage.appliesTo` records whether a master is intended for all, left, or
right pages. It does not silently assign or remove masters from pages. Explicit
assignment is authoritative, and the page side comes from persisted spread
topology and binding configuration.

Master data is document data, not workspace data. The Print workspace exposes
the Masters panel because masters are publishing concepts; other workspaces
may hide that panel without changing projection, persistence, export, or
command availability. A workspace filter must never turn an assigned master
off, and a UI exclusion must never be interpreted as print export exclusion.

## Current boundary

The current model supports one directly assigned master per page and top-level
source children. It does not yet expose master source edit mode, multiple
stacked masters, based-on-master inheritance, page/range assignment, nested
source overrides, or full visual detach materialization. UI additions must wait
for corresponding resolver, persistence, operation, and focused interaction
tests; the current panel deliberately exposes only actions whose semantics are
implemented.
