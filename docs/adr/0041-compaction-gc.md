# ADR-0041: Compaction and garbage collection

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0020, ADR-0022, ADR-0023

## Context

An append-only log grows forever; snapshots accumulate. GC must never remove
history reachable from any ref, and must be conservative after corruption.

## Alternatives

1. Time/TTL-based pruning only — can delete reachable history; rejected.
2. Full manual deletion — dangerous defaults.
3. Reachability-based compaction + explicit GC (chosen).

## Decision

- **Reachable roots:** current branch heads, named checkpoints, pinned
  revisions, merge bases of reachable merges, recovery refs, exported/shared
  refs, Git-linked refs (where tracked), user-configured retention.
- **Compaction:** rewrites operation segments and snapshots, preserving
  everything reachable, dropping unreachable history only when GC is
  explicitly requested. Compaction is interruptible, resumable, and tested
  against branch/merge graphs (criss-cross, archived branches, pinned
  checkpoints).
- **GC:** explicit user action (never automatic deletion of unreachable
  revisions); dry-run preview of what would be removed; backup-before-GC.
- **Integrity:** after corruption, GC is disabled until repair completes
  (conservative mode). Ref updates remain atomic; a snapshot that is written
  but unreferenced is collected only by GC.
- **Storage model note:** operation segments are still needed for replay when
  snapshots are missing; compaction may fold segments into snapshots when
  the reachable prefix is fully covered.

## Consequences

- **Migration impact:** existing version-store prune logic maps onto
  reachability pruning (named/pinned preserved — already the rule).
- **Backward compatibility:** old prune APIs become facade wrappers.
- **Cross-platform/Performance:** compaction is background/worker work;
  bounded memory; benchmarked at 1k/10k/100k operations.
- **Security:** no destructive automatic behavior; conservative after
  corruption.
- **Accessibility:** GC flows have confirmations and progress announcements.
- **Rejected shortcuts:** time-based auto-deletion of reachable history;
  compacting without a dry-run; dropping recovery refs.
