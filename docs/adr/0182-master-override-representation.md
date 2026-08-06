# ADR-0182: Master override representation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`MasterOverride` is whole-node: `{ masterNodeId, type: modified|hidden|deleted,
localNodeId? }` (`types.ts:1634-1642`), stored as a map keyed by master node
id. Whole-node overrides force full-node copies for one property change and
break when the master item is edited (the local copy diverges silently).

## Decision

D1 — Keep whole-node overrides as the **default representation** (matches
existing schema, cheap to migrate), and add **property-path overrides** as an
alternative kind: `{ kind: 'property', path: PropertyPath, value }` where
`PropertyPath` is validated against the node schema (property-path module
exists in scene).

D2 — Override records gain optional `baseRevision: masterRevision` (hash of
the overridden master node at override time) to detect stale overrides after
master edits.

D3 — Operations: override one property, override selected properties, reset
one, reset all on item, reset all on page, detach item (promote to page-owned
copy), detach master (all items). Promotion to master requires explicit
confirmation.

D4 — Resolution order on projection: page override > master item. Stale
overrides (master node removed or baseRevision mismatch) are flagged, never
silently applied; user can reset or re-apply.

## Alternatives

- Always property-path — rejected: whole-node kind already exists and is
  simpler for structural edits (delete/replace).
- Full local copies always — rejected: defeats sparse overrides and causes
  ADR-0181 propagation conflicts.

## Consequences

- Diff distinguishes master edit vs page override (ADR-0199).
- Merge: same master item overridden differently on one page = conflict;
  override on a deleted master item = stale override, surfaced.

## Migration impact

Existing `MasterOverride` records map to whole-node kind with
`baseRevision` = undefined (treated as current).

## Compatibility impact

Extra optional fields; old readers see additional keys only.

## Security considerations

Property paths validated against a fixed schema (no arbitrary paths — the
existing `property-path.ts` module restricts this).

## Rejected shortcuts

- Override by full node duplication only.
- Unvalidated JSON-path overrides.
