# ADR-0117: Collaboration behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Varve documents can be shared (varve-sync SQLite DocumentStore + collab
CRDT awareness). Synchronization introduces shared-state hazards: two users
resolving the same conflict, a remote edit changing identity mid-sync, a
source connected on one machine but not another.

## Decisions

### D1 — Separation of shared and user-local state

- Shared: token content (through the document), source identity (stable id
  + name), synchronization policy.
- User-local: filesystem connection records, absolute paths, watcher state,
  credentials.
- Paths and credentials are never broadcast to collaborators who do not need
  them; a source connected by one user appears as `unavailable` (not broken)
  to another (ADR-0107 D4).

### D2 — Stale-plan rejection

Every sync plan carries the document revision it was computed against and a
stable operation id. Plans are rejected when: the document revision moved,
the source revision moved, the selected token set changed, or a
collaborator resolved the same conflict first. Atomic patches apply only
when the revision guard passes; the whole apply is one transaction.

### D3 — Defined concurrent behaviors

- One user syncing while another edits tokens: the sync plan is computed
  against the current document; concurrent edits after plan creation bump
  the revision and re-diff.
- Two users resolving the same conflict: first applied wins; the second
  sees the resolution and re-merges.
- Rename vs value edit, delete vs bind, resolver context changes: all flow
  through the same three-way engine with revision guards.
- Multimodal previews become stale exactly like any other plan (ADR-0118-H).

### D4 — The legacy collab merge path is migrated

`mergeVariableStores` (two-way) is replaced in the collab path once the
three-way engine and base snapshots ship; until then token sync state is
merged conservatively (base-preserving) so no collab merge silently
overwrites sync state.

## Alternatives

- Disabling synchronization in shared documents — rejected: collaboration
  and token sync are both first-class requirements.
- Broadcasting connection records — rejected: privacy and portability.
- Last-writer-wins on conflicts — rejected: three-way semantics required.

## Consequences

- Document revisions and operation ids become part of the sync contract;
  tests cover out-of-order conflict resolution and stale-plan rejection.

## Migration impact

Collab call sites migrate from `mergeVariableStores` to the three-way path
with a compatibility shim during transition.

## Compatibility impact

Serialization of shared docs changes only where token sync is active.

## Security considerations

No filesystem paths, credentials, or auth metadata in shared state or
broadcast channels.

## Rejected shortcuts

- Timestamp-based conflict resolution in collab.
- Applying plans without revision guards.
- Sharing user-local source configuration.
