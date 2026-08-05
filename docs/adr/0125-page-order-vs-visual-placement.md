# ADR-0125: Page order versus visual placement

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`Page.order` (fractional keys, `types.ts:1602-1603`) is authoritative for
sequence, numbering, and export order. Visual arrangement does not exist yet.
The two must remain independent.

## Decision

D1 — Semantic order (`Page.order` + `pages[]` array) is the only driver of:
display numbering, section assignment, export order, default spread grouping.

D2 — Visual placement (`Page.placement` / `Spread.placement`, ADR-0124) never
changes order, numbering, or export order.

D3 — Auto-arrange preserves order-to-placement mapping (page N renders before
page N+1 in reading order) unless the user explicitly sets manual placement;
manual placement may freely diverge visually.

D4 — Spread membership is derived from order when `facingPages.enabled`, or
persisted when custom spreads exist (ADR-0128); reorder re-projects spread
membership but never moves content.

## Alternatives

- Placement = order (array index implies position) — rejected: foldouts and
  manual spreads require arbitrary visual position.
- Order = placement — rejected: reordering pages would relocate content.

## Consequences

- Reorder operations mutate only `pages[]` order keys and derived spread
  membership; pasteboard positions remain stable unless auto-arrange runs.
- Diff must classify reorder as a move, not delete+create (ADR-0150).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

None beyond ADR-0124 bounds.

## Rejected shortcuts

- Deriving placement from array index.
- Reordering the pages array on visual drag without explicit intent.
