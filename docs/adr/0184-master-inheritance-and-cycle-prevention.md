# ADR-0184: Master inheritance and cycle prevention

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

No master-to-master inheritance exists. ADR-0183 defers it. Cycles and
deterministic resolution must be designed before any inheritance ships.

## Decision

D1 — **v1: no master inheritance.** A master's content is authored directly;
assignment is page→master only. This is an explicit, documented limitation.

D2 — When inheritance ships (v2), it must satisfy: acyclic directed graph
(check on create/update via DFS with cycle rejection), depth limit (≤ 8),
deterministic projection (topological order, stable tiebreak), and override
precedence (page > derived master > base master, each sparse).

D3 — Any future inheritance schema stores `master.extendsId` plus a resolved
projection cache invalidated by ancestor revision.

## Alternatives

- Shipping inheritance now — rejected: no user evidence yet; adds cycle,
  override-ownership, and merge complexity to an already large milestone.
- Composition via copies — rejected: inherits ADR-0181 copying defects.

## Consequences

- Multi-layer workflows use independent masters (ADR-0183) until v2.
- Validation rejects cycles even in the deferred schema by design.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Cycle checks are load-time validation when the field ever appears; unknown
`extendsId` values are flagged, not resolved.

## Rejected shortcuts

- Inheriting via shared component-instance graph.
- Silent truncation of deep chains.
