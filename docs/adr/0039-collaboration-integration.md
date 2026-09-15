# ADR-0039: Collaboration integration

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0017, ADR-0018, ADR-0019

## Context

`@varve/collab` is scaffold (no-op transaction hooks, no transport, Rust
stubs). The operation log must be designed so it can later carry
collaboration without a translation layer or a second mutation path.

## Alternatives

1. CRDT document as primary with deterministic operation projections —
   heavy machinery now, no transport to justify it.
2. Operation log as the primary collaborative protocol (chosen): typed
   operations with actor/source metadata, logical sequence numbers,
   duplicate suppression by operation id, and offline queues — the same
   pipeline the history system needs.
3. Hybrid CRDT state + revision transactions — revisit if a real-time editor
   is ever built; the log stays the record.

## Decision

The `DesignOperation` envelope carries `actorId`, `actorKind`, `source`,
`transactionId`, and a document-scoped `logicalSequence`; replay is
deterministic (timestamps are metadata). This is sufficient for future
transport: remote operations enter through the same validation pipeline and
duplicate-suppression by operation id; preconditions guard stale offline
operations; undo in shared sessions becomes revert transactions (ADR-0019);
branch/checkpoint sharing semantics and permissions are explicit; machine-local
Git state is never broadcast. No CRDT library is added now; the current
`TransactionHooks` remain as the wiring seam. Collaboration is not claimed
complete until transport and convergence are genuinely implemented.

## Consequences

- **Migration impact:** operation envelope is forward-compatible.
- **Backward compatibility:** local-only behavior unchanged.
- **Cross-platform/Performance:** no transport cost today; sequence numbers
  are cheap.
- **Security:** actor identity and permission checks are enforcement points.
- **Accessibility:** none.
- **Rejected shortcuts:** wrapping Yjs transactions around opaque updater
  callbacks; broadcasting undo of other users' work; claiming production
  synchronization.
