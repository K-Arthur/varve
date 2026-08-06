# ADR-0034: Three-way conflict rules

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0031, ADR-0033, ADR-0035

## Context

`merge(base, ours, theirs)` must be deterministic, must auto-merge only
provably independent changes, and must never silently discard an ambiguous
edit. "Last writer wins" is explicitly forbidden for overlapping design
changes.

## Alternatives

1. Field-level 3-way on scalar snapshots — no conflict keys, no entity
   semantics.
2. JSON merge (deep-3-way) — array conflicts everywhere, no ordering policy.
3. Schema-driven conflict-key model (chosen): semantic diffs from base to
   each side (ADR-0031), matched by entity + property conflict key.

## Decision

Rules:

- **Safe auto-merge when**: one side equals base; both sides make identical
  changes; changes touch disjoint entities; changes touch disjoint properties
  of the same entity; one side edits metadata while the other edits artwork;
  property-level conflict keys prove independence. Each rule is documented
  and has a test.
- **Required conflict categories** (from the plan): same scalar changed
  differently; edit vs delete; move vs delete; move vs move to different
  parents; reorder vs reorder; rename vs rename; node-type replacement; text
  range overlap; formatting overlap; path-point overlap/delete-vs-move;
  fill/effect-list overlap; component-definition change vs incompatible
  instance override; component deletion vs instance edit; variable rename vs
  reference edit; variable deletion vs value edit; asset replacement on both
  sides; guide/grid/constraint/auto-layout conflicts; timeline/keyframe,
  state-machine, prototype-interaction conflicts; page/master structural
  conflicts; color-mode conflict; schema-version conflict; persistent-id
  collision; broken reference; unsupported plugin entity; unrelated
  histories without a valid merge base.
- **Conflict records** preserve base/ours/theirs values and revision ids
  until resolution is committed (ADR-0035); resolution provenance is stored.
- **Merge application order**: validate all three inputs → confirm merge base
  → semantic diffs → match by conflict key → apply safe changes → emit
  conflicts → validate merged graph → recalculate derived data → canonicalize
  → merge transaction → two-parent revision (ADR-0022). A failed merge leaves
  branches untouched; re-running the merge is deterministic and produces the
  same bytes.
- Reorder-vs-reorder conflicts follow the ordered-child strategy (ADR-0033);
  text follows ADR-0032.

## Consequences

- **Migration impact:** none.
- **Backward compatibility:** merge is new functionality.
- **Cross-platform/Performance:** pure, cancellable, benchmarked; matrix
  tests cover every conflict class.
- **Security:** merged documents always revalidated; no execution of
  document content.
- **Accessibility:** conflicts are never color-only in the UI.
- **Rejected shortcuts:** last-writer-wins defaults; silently keeping ours;
  merging at JSON-path level without schema conflict keys.
