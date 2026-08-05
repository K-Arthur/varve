# ADR-0146: Selection across pages

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Selection is node-only (`state.selection: NodeId[]`); hit testing and layers
are active-page scoped. Cross-page selection, marquee, and movement are
impossible today.

## Decision

D1 — Selection set extends to a discriminated union: nodes (with owning page
context), pages, spreads, master items (inherited), and stories. Selection
state carries the owning page/spread so operations resolve the right
coordinate system.

D2 — The active page follows selection: selecting content on another page
makes it active (explicit user gesture); programmatic selection changes do
not (spec §13 — selection crossing pages does not silently churn active
page).

D3 — Marquee may span page boundaries; nodes on each page are selected with
their page context. Cross-page copy/paste converts coordinates through the
shared coordinate service (ADR-0123) and reparents atomically (ADR-0126).

D4 — Inherited master items are selectable under a policy flag (deep
selection through projections, ADR-0132 D5) and always surface override
controls; selecting an inherited item never creates an override.

D5 — Inspector states distinguish page/spread/master/inherited/local/linked
frame/story selections with contextual sections (spec §24).

## Alternatives

- Selection restricted to one page at a time (status quo) — rejected: Demo 1
  (move objects between pages) requires cross-page interaction.
- Selection as world-coordinate bag without ownership — rejected: ambiguous
  operations.

## Consequences

- Undo transactions wrap cross-page moves as one step (ADR-0149).
- Layers panel shows all pages with cross-page selection.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Selection validation on load: selected ids must exist; master-item selection
is read-only until overridden.

## Rejected shortcuts

- Selection-only-active-page (status quo).
- Auto-switching active page on every selection change.
