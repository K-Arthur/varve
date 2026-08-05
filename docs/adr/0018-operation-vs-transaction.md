# ADR-0018: Atomic operation versus transaction representation

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0017, ADR-0039

## Context

A user action (drag, slider scrub, typing burst, delete selection) contains one
or more atomic mutations. History rows must be meaningful steps; the persistent
log must record operations; the revision model needs boundaries.

## Alternatives

1. One operation = one visible step: text keystrokes become 100s of steps.
2. One operation per mutation + a transaction wrapper that groups them into a
   visible step (chosen).
3. No atomic layer; only opaque "steps" of arbitrary changes: no replay, no
   merge — rejected.

## Decision

Two levels:

- **Atomic operation** — a single typed, deterministic mutation
  (`node.create`, `node.set-opacity`, `text.replace-range`, ...), registered
  in the versioned operation registry (ADR-0045).
- **Transaction / history step** — an ordered list of atomic operations plus
  step metadata (label, actor, source, affected-entity set), produced by a
  transaction coordinator with explicit grouping policies (pointer-down→up
  drags, slider scrub start→commit, IME-safe text bursts, batch actions).

Empty transactions never create steps. Failed transactions roll back or produce
a validated partial result; a step never claims operations that did not apply.
Nesting is flattened: nested begin/commit pairs contribute to the enclosing
transaction (reference-counted) rather than creating subtransactions.

## Consequences

- **Migration impact:** the existing begin/commit/abort API (`context.tsx:2581`)
  becomes the adapter entry point; grouping policies land in Milestone 4.
- **Backward compatibility:** existing transaction call sites unchanged.
- **Cross-platform/Performance:** coordinator is pure; per-op validation is
  bounded by payload size limits.
- **Security:** nested-transaction mismatches are detected; dangling open
  transactions cannot be silently committed.
- **Accessibility:** none.
- **Rejected shortcuts:** one step per atomic op (keystroke spam); "transaction
  = opaque callback" without an operation list.
