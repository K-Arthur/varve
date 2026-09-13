# Spatial arrangement system

Status: active. This is the contract for one-time alignment, distribution,
explicit spacing, tidy-up, persistent auto layout, and paint-order changes.
It complements the [transform system](transform-system.md): arrangement
commands choose world-space targets, while the transform pipeline persists the
result in each node's direct parent space. The research, observed behavior
matrix, and deliberately deferred cases are recorded in
[`docs/audits/nudge-snapping-alignment-research-2026-09-13.md`](../audits/nudge-snapping-alignment-research-2026-09-13.md).

## Capability matrix

| Workflow | Canonical engine | Inspector / menu | Canvas | Persistence / history | Status |
| --- | --- | --- | --- | --- | --- |
| Align six edges and centers | `selectionArrangement.ts` + `@varve/shared/align` | Align & distribute bar, Arrange menu, shortcuts | Alignment guide feedback | One document mutation | Complete |
| Selection / Frame / Page reference | World bounds + placed page bounds | Explicit reference selector | Post-command guide feedback | Session-only reference state | Complete |
| Equal visible edge gaps | `computeDistribution` / `distributeSelectionInDocument` | Distribution options | Gap relationship feedback | One mutation; outer items retained | Complete |
| Equal reference-point centers | `computeDistributionCenters` | Distribution options | Not a gap handle operation | One mutation; outer centers retained | Complete |
| Numeric gap, including two objects | Fixed-gap distribution | Distribution options | Gap handles and keyboard sliders | One mutation; first spatial item anchors | Complete |
| Tidy-up grid | `tidySelectionInDocument` + `computeTidyLayout` | Tidy-up options: columns, row gap, column gap | Not persistent layout | One mutation; selection top-left anchor retained | Complete |
| Persistent flex / grid auto layout | `@varve/layout` reflow pipeline | Layout inspector | Flow-child reorder is supported | Scene layout metadata | Complete for documented subset |
| Paint-order arrangement | `@varve/scene.arrangeNodes` | Arrange menu and Layers actions | No spatial movement | One mutation; sibling order retained | Complete |
| Canvas gap preview / cancellation | Preview transaction around canonical fixed-gap command | Gap handle | Live preview, Escape / blur cancel | One undo entry on release | Complete |
| Multi-child layout insertion indicator | — | — | — | — | Intentionally deferred |
| Absolute-child responsive anchors | — | — | — | — | Intentionally deferred |

## Geometry contract

Manual arrangement uses finite, transformed, world-space axis-aligned bounds
from `nodeWorldBounds`. These are geometric bounds, not stroke/effect bounds;
the OBB button is the explicit exception for oriented alignment. The renderer,
selection overlay, arrangement commands, and export continue to share the
scene's transform and geometry pipeline. Alignment feedback is produced from
the document after the command, so the visible target line and label cannot
silently describe a pre-command selection snapshot.

The operation is resolved as:

```text
local geometry → node and ancestor transforms → placed world bounds
→ target / gap calculation → direct-parent inverse → local transform
```

Selected descendants are removed when an ancestor is selected, so a subtree is
never translated twice. Locked, hidden, invalid, and normal flow-managed
children are not manual-position roots. Absolute-positioned auto-layout
children remain eligible. Mixed-parent selections are safe because every root
is translated through its own parent inverse; no command silently reparents.

Spatial sorting is independent of selection order. Primary position is the
chosen axis, then the perpendicular position, then node id. Alignment preserves
width, height, linear transform, rotation, scale, flips, appearance, and
parentage. Numeric gaps preserve the leading item after spatial sorting; with
three or more items the outermost items remain fixed. A negative gap is an
intentional overlap and is never silently clamped. Equal-gap distribution uses
projected object sizes and the fixed outer span (`(span - sum(sizes)) /
(count - 1)`); equal-center distribution intentionally uses center intervals
instead. Stable id tie-breaking makes repeated execution idempotent even when
selection or index iteration order changes.

Tidy-up is a one-time transform, not auto layout. It uses the deterministic
grid inference already shared by the editor and preserves the selection's
world-space top-left anchor. It does not write `layoutStyle` or child layout
metadata. Auto layout remains the only workflow that writes a persistent
parent-child layout relationship.

## Interaction and history

Inspector commands and menu actions use the editor's normal document mutation
path, producing one undo entry. The Inspector exposes the reference and mode
before execution; a key object remains fixed and its identity is included in
the resulting feedback. Gap handles open a `preview` transaction on
pointer-down and calculate every frame from the pointer-down document, avoiding
cumulative drift. Pointer-up commits one entry; Escape, window blur, and
pointer cancellation restore the exact starting document. Keyboard gap sliders
apply a single explicit numeric operation per key press.

The canvas overlay is an affordance for explicit spacing, not a second spacing
engine. Its eligible roots, bounds, and final mutation come from the same
selection arrangement module used by Inspector controls.

## Auto layout and stacking boundaries

Persistent auto layout is measured and resolved by `@varve/layout`; manual
alignment does not mutate a normal flow child because the next reflow would
discard the edit. Use the Layout inspector to change direction, gap, padding,
alignment, sizing, wrapping, or absolute positioning. Tidy-up never converts a
selection into an auto-layout frame.

Paint order is orthogonal to spatial order. `arrangeNodes` changes only the
current sibling list, preserves selected relative order, filters locked and
structurally protected nodes, and never crosses parent boundaries. Layers-panel
order and canvas paint order therefore remain the same scene order.

## Supported and deferred edges

Covered by the current regression set are differently sized, fractional,
negative-coordinate, rotated, nested-parent, mixed-parent, locked/hidden,
flow-managed, absolute-child, zero-sized, overlapping, and selection-order
variants. Browser coverage exercises the real Inspector and Layers surfaces;
the gap-handle visual matrix must be run with the canvas E2E project when the
overlay changes.

The current intentional boundaries are visual/effect bounds as an alternate
manual reference, responsive anchors for absolute children, a visual
multi-child insertion indicator, and logical RTL direction. They remain
explicitly unsupported rather than being approximated by a second geometry
path.
