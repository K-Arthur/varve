# ADR-0132: Master projection

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Master content is never rendered: `activePageNodesWithMaster`
(`document-components.ts:324-359`) has zero production consumers. It also has a
correctness bug — hidden/deleted overrides still push the master node into the
result (lines 343-349). Master applicability is `all|left|right` only.

## Decision

D1 — Master content is **projected, never copied**: at render/hit-test time,
the page scene = globals + projected master items + page content. The
projection is a pure function of (master, master revisions, page overrides).

D2 — The projection must not list a master node whose override is
`hidden` or `deleted`; `modified` overrides substitute the local node. This
fixes the current bug and is covered by baseline + regression tests.

D3 — Applicability extends to the union type:
`all | left | right | odd | even | first-in-section | last-in-section |
section | explicit-pages` (ADR-0129 topology + ADR-0131 sections resolve
side/parity/first/last; `left|right` honor RTL binding).

D4 — Projection caching: per-page projections keyed by (master revision,
override revision, placement revision); a master edit invalidates only
assigned pages.

D5 — Hit testing allows selecting inherited items (policy flag), showing
override controls; selection alone never creates an override (ADR-0133).

## Alternatives

- Cloning master content into pages (status quo in many tools) — rejected:
  breaks propagation and overrides.
- Projecting through the same node map (master node ids in page render) —
  chosen: identities stay stable for overrides and diff.

## Consequences

- Master edits propagate to all assigned pages in one history transaction.
- Export renders the same projection as canvas (single path).

## Migration impact

Existing single-master assignments keep working; applicability subset maps
`all → all`, `left/right` unchanged.

## Compatibility impact

None.

## Security considerations

Projection must not allow master nodes to be reparented into pages; ownership
invariants (ADR-0126) hold for projected nodes too.

## Rejected shortcuts

- Materializing projected masters into page roots.
- Projecting at export time only (divergence risk).
