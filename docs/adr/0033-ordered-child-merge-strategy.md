# ADR-0033: Ordered-child merge strategy

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0034

## Context

Children are ordered by fractional-indexing keys (`generateKeyBetween`,
`@varve/shared`). When both branches insert different children at the same
position, a deterministic strategy must order them without last-writer-wins
and without wall-clock timestamps.

## Alternatives

1. Base order + append new children in a fixed order — misplaces concurrent
   inserts.
2. Anchor-based: insert relative to the sibling anchors each side used —
   ambiguous when both target the same gap.
3. Order keys + anchor ids + persistent-id tie-break (chosen).

## Decision

Concurrent inserts into the same gap are merged as: (1) all base children
retain their order; (2) each side's insertions are placed at their
requested anchor with their fractional key; (3) when both sides insert into
the exact same gap, the two inserted subtrees are ordered by **documented
deterministic tie-break: the lexicographic comparison of the full persistent
node ids** of the inserted roots (stable across platforms and runs; ids
contain the branch-random component so same-counter collisions cannot happen).
If the conflict resolver later reorders, it produces a new `node.reorder`
transaction — the auto-merged order is never mutated in place. "Both sides
insert the same child" (identical content hash) collapses to one insertion.

## Consequences

- **Migration impact:** none; order keys already exist.
- **Backward compatibility:** existing order keys valid.
- **Cross-platform/Performance:** deterministic byte-level output; O(n log n)
  worst case.
- **Security:** id tie-break is derived data, not user input.
- **Accessibility:** none.
- **Rejected shortcuts:** timestamp ordering; "ours first" (branch-name
  dependent, non-deterministic across Git merge direction); appending
  blindly.
