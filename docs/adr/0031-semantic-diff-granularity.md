# ADR-0031: Semantic diff granularity

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0027, ADR-0032, ADR-0034

## Context

Design changes must be understood at the level of entities and properties, not
JSON lines. Stable persistent ids (ADR-0025) make rename/move detection exact
(never delete+add). Ordered sequences need ordering-aware algorithms.

## Alternatives

1. JSON-line diff over canonical text — no entity semantics; rejected.
2. Whole-node before/after snapshots per change — too coarse for
   property-level conflict resolution.
3. Schema-driven property-level diff keyed by persistent id (chosen).

## Decision

`DesignDiff` = base/target ids + hashes + `SemanticChange[]` + summary +
asset changes + warnings. Each change: entity id/type, change category
(documented list: document, node structure, geometry/transform, appearance,
typography, components, variables/tokens, motion/prototyping, assets,
metadata), property path, before/after values, parent/ordering context,
visual-impact category, related transaction ids, human summary, and whether
machine-applicable. Granularity:

- **Identical entities:** stable ids make add/delete/move/rename/reorder
  exact.
- **Ordered sequences** (children, fills, effects, runs, points, keyframes):
  an ordering-aware subsequence algorithm so one insertion doesn't flag every
  following item.
- **Floating point:** property-specific comparison policies (transforms and
  typography must not share one global epsilon that hides real change);
  documented tolerance tables per property family.
- **Text:** grapheme-aware range diff (ADR-0032); formatting-only changes
  distinguished from content changes.
- **Runtime noise excluded:** key order, caches, volatile metadata never
  surface as changes (ADR-0027 guarantees this at the input level).

Output formats: typed JSON, concise text, Markdown, machine-readable Git text,
visual-diff input, review-bundle input.

## Consequences

- **Migration impact:** none; diffing is a pure function over two validated
  documents.
- **Backward compatibility:** n/a.
- **Cross-platform/Performance:** cancellable; per-entity maps of properties;
  cost bounded by entity count; benchmarked at 1k/10k/100k entities.
- **Security:** diff operates on validated documents only.
- **Accessibility:** change lists have textual alternatives by construction.
- **Rejected shortcuts:** line diffs; global epsilons; delete+add inference
  for renames; treating reorder as N property changes.
