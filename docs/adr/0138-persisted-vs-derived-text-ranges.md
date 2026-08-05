# ADR-0138: Persisted versus derived text ranges

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

No ranges are stored today (nothing composes). The design choice is whether
per-frame ranges persist.

## Decision

D1 — Frame ranges (`startGrapheme`, `endGrapheme`, lines, overset) are
**derived and cached**, never authoritative. The cache is keyed by
composition key (ADR-0137 D3) and lives outside the document (in-memory
`@varve/engine` cache, bounded LRU).

D2 — The document stores only: story content, chain membership, frame
geometry/settings — the composition *inputs*.

D3 — Cached ranges are validated against the composition key on every read;
stale entries are dropped, never trusted. Persistence of ranges in the file
is rejected.

## Alternatives

- Persisting ranges (fast load, diff-friendly) — rejected: ranges are
  derivable; persisting invites stale-range bugs, merge conflicts, and
  format churn (the audit explicitly flags "Do not make stale cached ranges
  authoritative").
- No caching (compose every frame every paint) — rejected: ADR-0139 requires
  incremental reuse.

## Consequences

- Load time composes only visible/needed stories lazily.
- Merge never merges ranges; merged source state recomposes deterministically
  (ADR-0150).

## Migration impact

None (no ranges exist to migrate).

## Compatibility impact

None.

## Security considerations

Cache bounds (bytes) and worker concurrency limits; stale-result rejection is
mandatory (ADR-0137 D5).

## Rejected shortcuts

- Persisting composed line boxes.
- Reusing cached ranges after any composition input changed.
