# ADR-0112: Atomic filesystem writes

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Writing token documents into repositories must be durable and recoverable.
Naive `writeFile` can leave partial files on crash or disk-full, and can
clobber concurrent external edits.

## Decisions

### D1 — Write pipeline

1. Serialize and validate the complete proposed files (in memory).
2. Write temporary files next to targets (same directory for atomic rename).
3. Flush/fsync as supported by the platform.
4. Re-read and validate the temp files.
5. Atomically replace targets (rename semantics per OS).
6. Update the base snapshot only after all successes.
7. Remove temp files.
8. Keep recoverable backups per policy (bounded, configurable).

### D2 — Multi-file transaction manifest

Directory/Git sources may touch several files; writes carry a manifest
(`{ sourceId, revision, files: [{ path, hash, status }], committedAt }`).
The sync state is marked `invalid`/`partial` unless every file reached
"replaced". The source is never marked clean on partial success.

### D3 — Failure handling

Disk full, read-only file, permission failure, deleted source, file changed
after preview (hash mismatch at write time), antivirus/indexer locks, Unix
permissions, symlinks, network-mounted drives, and unexpected encodings are
each handled with a specific diagnostic; a concurrent external writer
triggers a fresh diff instead of an overwrite.

## Alternatives

- Direct `writeFile` — rejected: partial writes and clobbering.
- Write-then-move without re-read — rejected: cannot verify durability.
- Overwriting regardless of concurrent changes — rejected: silently destroys
  external edits (core acceptance criterion).

## Consequences

- A shared `AtomicWrite` utility in `@varve/platform` with a pure planner
  (testable in node) and a Tauri-backed executor.
- Filesystem integration tests use temp repos: concurrent modification,
  partial failure, permission failure, line-ending preservation, recovery.

## Migration impact

None — new capability.

## Compatibility impact

None.

## Security considerations

Temp file names are random; paths are canonicalized; symlink targets are
containment-checked; no credentials ever touch the write path.

## Rejected shortcuts

- Trusting a write succeeded without re-read validation.
- Marking a source clean after partial multi-file success.
- Silent overwrite when the file changed since preview.
