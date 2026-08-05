# ADR-0151: Collaboration behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Collab is stubs (`collab/src/index.ts` no-op hooks; `varve-sync` is
last-write-wins blob storage). The multipage model must define collaboration
semantics before sync lands.

## Decision

D1 — Sync unit = semantic operations (ADR-0149) over stable identities
(page/master/story/frame ids never derive from array position).

D2 — Remote application is deterministic and validation-gated: reflow after
remote edits runs locally from composed inputs (ADR-0138); remote composition
caches are never authoritative; stale worker results rejected by revision
tuple (ADR-0137).

D3 — Concurrent editing rules: disjoint pages/stories merge; disjoint story
ranges merge where supported; same-range edits surface a conflict (or the
chosen CRDT semantics when the collab backend lands); master propagation is
one remote operation (never one op per assigned page).

D4 — Awareness carries page context: remote cursors/selection include page id
+ placed coordinates; users see when a remote master edit affects their
current page (projection revision bump).

D5 — Reorder never relies on array indexes over the wire: operations carry
order keys (ADR-0125).

## Alternatives

- Full CRDT document now — rejected: the operation envelope and merge rules
  must exist first; CRDT selection is a later, separate ADR.
- Page-locked collaboration (one editor per page) — rejected: story editing
  spans pages.

## Consequences

- The existing `TransactionHooks` become real; `@varve/collab` grows a
  typed awareness model without inventing sync.
- Remote page deletion of a threaded page routes through the safe-deletion
  policy (ADR-0126 D3).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Remote ops validate before apply (op registry precondition); bounded queue
and replay depth; remote text is untrusted content (ADR-0152 applies).

## Rejected shortcuts

- Last-write-wins whole documents (status quo of varve-sync).
- Deriving page positions from remote array order.
