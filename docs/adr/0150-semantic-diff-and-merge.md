# ADR-0150: Semantic diff and merge behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

No document semantic diff exists; `VersionHistoryService.diffDocuments` is a
naive node-id set diff (page reorder → zero diff; delete+recreate →
indistinguishable from content move). No document three-way merge; tokens
have a real one (ADR-0108). Collab is stubbed.

## Decision

D1 — Semantic diff covers the document as a typed entity set: pages (by
stable id: reorder/move/resize/placement/master/print-geometry), spreads
(membership by spread id, ADR-0128), sections (numbering changes), masters
(projection content + applicability + override deltas), stories (text changes
vs frame-thread changes vs derived reflow — reflow never diffed), and nodes.

D2 — Diff classification distinguishes: page reorder (move) vs
delete+recreate (same id = move; new contentRoot = new page), page resize
vs content scale (separate dimensions), master update vs page override
(ADR-0133 D1), story text edit vs frame-link edit, print-geometry change vs
artwork change.

D3 — Three-way merge: automatic for disjoint entities (page A vs page B,
master edit vs unrelated page, add page vs section numbering change, story
text vs unrelated frame style) and for derived projections (recompose from
merged source, never merge line positions). Conflicts surface for: same page
reordered/resized differently, page deleted while content edited, master
item deleted while overridden, same story range edited differently, thread
reordered differently, page with linked frames deleted, incompatible section
numbering, same print-geometry property changed differently.

D4 — Merge input is the canonical serialization (ADR-0027); output must
round-trip through canonical hash; merge validation runs the load-time
validators before commit.

## Alternatives

- Whole-document overwrite merges — rejected: loses disjoint work.
- Token-style merge only — rejected: document entities need identity-based
  semantics (tokens/merge.ts is the model to follow, ADR-0108).

## Consequences

- Version comparison UI becomes truthful (page reorder visible).
- Merge lands behind the existing branch model (`platform/types.ts:430`).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Merge never trusts either side's derived caches; conflict output is
deterministic; canonical round-trip validated.

## Rejected shortcuts

- Merging page arrays by index.
- Persisting merged line positions (ADR-0138).
