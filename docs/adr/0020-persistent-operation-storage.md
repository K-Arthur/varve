# ADR-0020: Persistent operation storage

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0021, ADR-0022, ADR-0046

## Context

Persistent history needs append-only operation storage with atomic ref
updates, tail-corruption detection, and bounded recovery across Tauri,
IndexedDB/OPFS, and tests. The existing platform backends store flat version
lists (web IndexedDB; desktop localStorage — not SQLite).

## Alternatives

1. Store every transaction as a full document snapshot (status quo) — storage
   grows linearly with edits; no replay granularity.
2. SQLite-native history on desktop + IndexedDB on web with divergent schemas.
3. One storage contract with a logical document layout and per-runtime
   implementations (chosen).

## Decision

Define a `HistoryStore` contract (in the new history package, implemented by
`@varve/platform`) with the logical layout:

```text
document/
  manifest
  refs/        (branches, checkpoints, HEAD — atomic multi-ref updates)
  revisions/   (revision records)
  operations/  (immutable append-only segments)
  snapshots/   (content-addressed)
  assets/      (content-addressed payloads, where separated)
  indexes/     (rebuildable entity-history indexes)
```

Append safety: operations append to a segment; the segment is checksummed; a
revision record references an `[operationStart, operationEnd]` log range; ref
updates are transactional (all-or-nothing). Tail corruption detection reads the
last valid segment; recovery walks back to the last committed revision
(ADR-0046). IndexedDB transactions and SQLite transactions both satisfy the
atomic-ref requirement. Tauri version storage migrates from localStorage to
SQLite as part of Milestone 6 (no new tiny-file-per-record design without
benchmarking).

## Consequences

- **Migration impact:** existing `versions`/`versionContent` stores migrate to
  snapshots/revisions (ADR-0024).
- **Backward compatibility:** platform document APIs unchanged; version APIs
  become facades.
- **Cross-platform:** contract implemented for memory, IndexedDB, and SQLite.
- **Performance:** appends batched and off the interaction path; segment
  checksums are incremental; hashing deferred (ADR-0021).
- **Security:** content hashes are SHA-256 (not FNV-1a alone); segment sizes
  bounded; disk-full/quota errors surfaced, never corrupting refs.
- **Accessibility:** none.
- **Rejected shortcuts:** localStorage as the desktop history store; thousands
  of tiny JSON files; storing operations only in memory.
