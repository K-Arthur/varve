# ADR-0022: Revision DAG

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0019, ADR-0020, ADR-0021

## Context

The existing version model is a flat per-file list (`types.ts:384-403`) with no
parent links. Non-linear history, branches, and merges require a graph.

## Alternatives

1. Snapshot list with branch metadata (status quo) — no ancestry, no merge
   parents, cannot express divergence.
2. Linear-only log with branch pointers — cannot represent merges.
3. Immutable revision DAG (chosen).

## Decision

A revision is an immutable record: `revisionId`, `documentId`,
`parentRevisionIds` (0 genesis / 1 normal / exactly 2 merge), the transaction
id + log range that produced it, the canonical document hash, optional
snapshot id, author, semantic summary, `createdAt`, schema version, and origin
(`edit|undo|redo|revert|save|autosave|checkpoint|branch|merge|import|migration|recovery`).

Invariants enforced and tested: genesis has zero parents; normal revisions have
one; merge revisions exactly two; parents exist; cycles impossible; hashes
match replayed content; transaction ranges do not overlap incorrectly;
revision ids immutable. Branch refs and checkpoint refs point at revisions
(ADR-0023). Undo is cursor movement over this DAG (ADR-0019). Timestamps are
metadata only — they never determine ordering.

## Consequences

- **Migration impact:** existing versions import as snapshot revisions without
  fabricated lineage (ADR-0024).
- **Backward compatibility:** revision store is additive; version APIs become
  facades.
- **Cross-platform/Performance:** DAG operations are O(depth) lookups;
  generation and verification are linear in log size.
- **Security:** hash verification on load; unknown parent ids rejected.
- **Accessibility:** the DAG surfaces to users only through curated views
  (steps/checkpoints/branches) plus an accessible text alternative.
- **Rejected shortcuts:** linear snapshots with fake parent links; mutating
  revision records; timestamps as ordering keys.
