# ADR-0177: Explicit versus derived spreads

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`rebuildSpreads` recomputes spreads from `facingPages` on every toggle
(`document-pages.ts:392-440`); spread IDs are fresh per rebuild
(`cryptoId()`), so spread-level guides and identity are lost on reorder/toggle.
The audit flags this as "authored-but-derived" — serialized as an array yet
recomputed wholesale (ADR-0199 merge hazard).

## Decision

D1 — Spread membership is **derived by default**: when
`facingPages.enabled`, spreads = pairs from `pages[]` order (single first page
when `startOnRight`). This projection is deterministic and stateless.

D2 — Custom spreads (foldouts, user regrouping) are **explicit**: persisted
`Spread` records with stable IDs and `kind` (`single|facing|foldout|custom`).
Any custom spread sets `spreadModel: 'custom'` on the document; the derived
projection stops overriding membership.

D3 — Spread IDs are stable for derived spreads: computed from the ordered
page IDs (e.g. `spread:<n>` index slots), never regenerated. Custom spread IDs
are minted once and persist.

D4 — Guides attach to spread IDs when in spread scope; derived-spread guide
scoping re-resolves after reorder.

D5 — `rebuildSpreads` becomes a pure projection helper consumed by rendering
and export; it no longer mutates document state.

## Alternatives

- Always-persisted spreads — rejected: reorder/insertion would need
  reconciliation rules everywhere.
- Always-derived — rejected: foldouts and user grouping impossible.

## Consequences

- Merge semantics: derived spreads merge from order; custom spreads merge by
  ID with conflict detection (ADR-0199).
- PageNav/Pages panel show derived spread grouping live.

## Migration impact

v2.19 migration materializes current spreads as either derived (default) or
custom records; no data loss.

## Compatibility impact

Old readers see an extra `spreadModel` field (pass-through codec).

## Security considerations

Spread validation: no duplicate page across spreads, no missing page refs,
bounded spread size (≤ 12 pages).

## Rejected shortcuts

- Random spread IDs on every rebuild (status quo).
- Spreads as nested page arrays inside `Document`.
