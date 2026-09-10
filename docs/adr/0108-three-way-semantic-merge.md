# ADR-0108: Three-way semantic merge

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`mergeVariableStores` (`variables.ts:341-349`) is a two-way, source-wins
overwrite. Synchronization requires `base / local / remote` semantics per
field so neither side silently clobbers the other.

## Decisions

### D1 — Per-field three-way rules

For every semantic field (path, type, value, reference, description,
deprecation, extensions, file ownership, set membership, modifier values,
resolution order):

- local === base, remote changed → accept remote (fast-forward).
- remote === base, local changed → keep local.
- local and remote made the same semantic change → merge cleanly.
- both changed differently → conflict, classified explicitly.
- rename on one side + value change on the other → combine when identity is
  sufficiently certain (ADR-0109).
- delete vs edit → delete-versus-edit conflict (ADR-0110).
- incompatible type changes → explicit resolution required.
- merged reference graph contains a cycle → proposed merge rejected.

Composites merge per component (a conflict in `typography.fontSize` does not
force replacing the whole composite).

### D2 — Never policies

No latest-timestamp-wins, no whole-file replacement, no source-wins,
no local-wins, no path-order tie-breaking, no AI auto-resolution — as default
policies. AI may only propose, previewed and validated (ADR-0118).

### D3 — Validated merge plans before mutation

Merging produces a typed, validated `TokenMergePlan` (per-token op with
base/local/remote provenance) checked against the reference graph and
resource limits. The plan is applied atomically as one undo transaction or
not at all; external files are never touched by application (ADR-0116).

### D4 — Sync state machine

`disconnected | clean | local-changes | remote-changes | diverged |
conflicted | invalid | unavailable`, driven by semantic hashes and revisions
— never by timestamps alone.

## Alternatives

- Source always wins — rejected: destroys local edits.
- Newest timestamp wins — rejected: clock skew and non-determinism.
- Whole-file replace of the token document — rejected: destroys source
  formatting and unrelated tokens (ADR-0103).
- Reusing `mergeVariableStores` — rejected: it is exactly the two-way defect.

## Consequences

- The merge engine is the correctness core; property-based tests generate
  base/local/remote triples and assert validity, determinism, and no
  non-finite or cyclic results.
- The existing two-way function remains for legacy collab call sites until
  they are migrated (ADR-0100/ADR-0117).

## Migration impact

Collab merge paths gain the base snapshot concept; snapshots are versioned,
compact, recoverable, and size-bounded.

## Compatibility impact

Merge behavior changes only where synchronization is active.

## Security considerations

Merged values pass the same validation as imports (finiteness, bounded
sizes, no prototype pollution).

## Rejected shortcuts

- Applying merges without a validated plan.
- Silent auto-resolution of delete-vs-edit.
- Merging by path equality alone.
