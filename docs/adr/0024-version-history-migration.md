# ADR-0024: Existing version-history migration

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0020, ADR-0022, ADR-0023

## Context

Three disconnected durable stores exist: platform versions (IndexedDB on web,
localStorage on desktop), crash-recovery points, and engine backups. The new
system must converge them rather than add a fourth store.

## Alternatives

1. Leave `VersionEntry` as a parallel store behind a compatibility facade —
   two sources of truth, forbidden by the architecture brief.
2. Migrate versions into revision/checkpoint/snapshot architecture (chosen).

## Decision

- Platform `versions`/`versionContent` migrate into content-addressed
  snapshots + imported revision records. **No fabricated linear order**: only
  versions whose content relationship can be derived safely (identical hashes,
  explicit parent markers) link; all others import as checkpoint roots /
  recovery refs with warnings.
- Named/checkpoint versions become `CheckpointRef`s pointing at their imported
  revisions. `Branch` records become `BranchRef`s with an explicit initial
  head (ADR-0023).
- `VersionHistoryService` is re-implemented as a facade over the revision
  store; home-screen "Save to Version History" maps to the checkpoint command.
- Engine backups and crash-recovery points remain orthogonal disaster-recovery
  layers (documented, not unified): their job is whole-document recovery, not
  revision history.
- The pre-migration undo stack is not ported: operations were never persisted,
  and inventing pre-migration steps is prohibited. The UI states that
  persistent history begins at the migration revision.

## Consequences

- **Migration impact:** one-time, idempotent, backup-first (original store
  retained until verified); failures leave both stores intact.
- **Backward compatibility:** old `VersionEntry` reads keep working during a
  compatibility window; desktop localStorage versions import first (they are
  the weakest store).
- **Cross-platform/Performance:** migration is bounded by store size and runs
  in chunks with progress.
- **Security:** content re-hashed with SHA-256 during import (FNV keys kept
  only as indexes).
- **Accessibility:** migration progress and warnings are announced.
- **Rejected shortcuts:** timestamp-ordered fabricated lineage; dual-write
  forever; migrating backups into the revision graph.
