# ADR-0110: Deletion and tombstone semantics

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

A token deleted externally may still be bound to nodes, referenced by
aliases, used in components and generated outputs, or modified locally. The
current system silently strips bindings on delete (`deleteVariableFromDocument`),
which is acceptable for local edits but wrong for synchronization: a
remote delete must never silently destroy a local design.

## Decisions

### D1 — Deletion is a resolution state, not an instant unbind

When a synchronized token is deleted on either side, the system enters a
deleted state in the sync state machine and offers explicit options:

- Delete and unbind (with impact preview).
- Delete but preserve current resolved literal values (unbind with
  materialization).
- Convert to local token (detach from source).
- Reconnect to a replacement token.
- Restore to source (for local deletions not yet written).
- Mark deprecated instead of deleting.
- Defer the conflict.

### D2 — Tombstones in sync metadata

Tombstones (`{ path, deletedBy, at, baseRevision }`) distinguish "deleted"
from "source unavailable" and from "never existed". They live in the sync
state (base snapshot), are versioned, and are excluded from token exports.

### D3 — Never silently substitute values

A deleted bound token is never replaced with a default color, zero, or
empty string. Bound nodes keep their last resolved value, marked unresolved
in the UI, until the user resolves the state.

## Alternatives

- Hard-delete on remote deletion — rejected: destroys bindings silently.
- Auto-convert deleted tokens to local — rejected: unsolicited divergence
  from the source.
- Ignoring remote deletions — rejected: the source would keep re-proposing
  the deletion.

## Consequences

- The delete-versus-edit conflict class exists in the merge engine
  (ADR-0108 D1); Playwright workflow 3 covers it.
- Impact preview shows bound layers and aliases before unbinding.

## Migration impact

None for existing documents (no tombstones yet).

## Compatibility impact

Tombstones are internal sync metadata; exported DTCG files contain only
actual tokens.

## Security considerations

Tombstone payloads are validated like any imported data (bounded size,
no executable content).

## Rejected shortcuts

- Auto-materializing default values on delete.
- Treating unavailable sources as deletion.
- Stripping bindings silently during a sync apply.
