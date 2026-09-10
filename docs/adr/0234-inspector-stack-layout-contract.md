# ADR-0234: Inspector and stack-layout contract

*Status: accepted — 2026-09-09*

## Context

The inspector had duplicated geometry and table controls, mixed persisted and
display units, and several mutations that replaced unrelated paint data. The
layout engine also conflated Fixed bounds with resolved constraints, treated
relative sizing as flexible weight, and let each renderer infer paint order.

## Decision

The Design inspector owns one canonical section composition for single and
mixed selections. Position & Size contains the single width/height pair,
per-axis sizing modes, bounds, ratio lock, and sizing explanation. Stack/Grid
contains container flow, signed flex spacing, padding, distribution, and grid
tracks. Fills, strokes, effects, typography, images, components, tables, and
export each have one owner and one stable row identity.

Quick properties is a compact, non-owning summary for single selection. It
routes edits through the same commands as Position & Size, Appearance, and
Fills, which remain the canonical owners for persistence, bindings, and
history. Effect parameters open in a focused anchored editor while secondary
effect actions live in the row menu.

The scene model retains authored sizing mode and percentage fields. Fixed
constraints remain serialised but inactive; Hug measures occupied content;
Fill receives residual space; Relative resolves a literal percentage of its
defined reference. Invalid numeric input is rejected before mutation and
normalisation removes non-finite optional values without rewriting authored
zero.

Flex spacing is signed and intrinsic Hug measurement uses the occupied union.
`includeBordersInLayout` defaults off and, when enabled, includes visible
stroke protrusions while excluding shadows and blur. `overlapOrder` is resolved
by a scene-owned effective paint-order function. It may reverse flow
participants in their existing slots but never mutates authored child arrays.

All property edits use the existing transaction path. Reflow is bounded and
preserves affine linear components. Codegen retains authored sizing semantics
and reports target limitations such as CSS's inability to express negative
gaps.

## Consequences

The inspector is easier to scan at narrow widths and mixed selections keep
unrelated values intact. A few advanced controls remain behind focused editors
and table spans remain read-only until merge/split commands are connected. This
is deliberate progressive disclosure: the main panel summarises active state
and specialised editors own complex operations.

## Validation

The contract is covered by layout, scene migration, paint-order, and focused
inspector tests. The browser baseline must be recaptured after the current
dirty engine export prerequisite is loaded; the full browser and native matrix
remains a final gate because this change crosses layout, rendering, and codegen.
