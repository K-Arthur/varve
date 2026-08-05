# ADR-0111: Local file watching

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The only watcher in the tree watches the app data directory
(`apps/desktop/src-tauri/src/lib.rs:2202-2237`, notify crate, `.varve`/
`.strata` filters). Token documents live in arbitrary user directories and
must be watched safely.

## Decisions

### D1 — Tauri: a dedicated token watcher command set

New Tauri commands (`tokens_watch_start/stop/pause/resume`) register
`notify::recommended_watcher` on each source root, filtering to configured
entry files. Events are forwarded to the webview with a monotonic sequence
number; the platform port exposes a `TokenWatcher` capability that the
editor drives.

### D2 — Event hygiene

- Debounce and coalesce bursts (editor save patterns — temp file + rename —
  must produce one logical change).
- Self-writes are suppressed via a write-revision token issued by the atomic
  write pipeline (ADR-0112).
- Directory moves, symlink changes, delete+recreate, permission loss are all
  detected and surfaced.
- Stale parse results are rejected (document/watcher revision checks);
  superseded work is cancelled.
- Unrelated files in the root are never reparsed (per-file filtering).

### D3 — Never apply detected changes automatically

Detected changes are NOT applied when they: fail validation, create
conflicts, alter more tokens than a threshold, change source configuration,
delete referenced tokens, change the specification version, or introduce
unsupported types. Sync Center shows a notification and a status update
instead. Application requires the normal preview → apply flow (ADR-0108).

### D4 — Browser builds are honest

Browser builds provide explicit import/export and File System Access only
where the API is available; there is no pretend file watching. Watcher
capability is reported by runtime detection (ADR-0120).

## Alternatives

- Polling file mtimes — rejected: racy, noisy, and wasteful on large trees.
- Reusing the data-dir watcher — rejected: wrong scope, wrong filters.
- Watching everything under a root recursively — rejected: token files only.

## Consequences

- A watcher state machine (active/paused/stale) inside the source connection;
  pauses while a conflict-resolution write is pending; recovery when the
  source returns.

## Migration impact

None — new capability.

## Compatibility impact

None on web builds beyond the explicit import/export path.

## Security considerations

Paths are canonicalized; symlinks are resolved with containment checks so
watching never escapes the configured root; events carry no payload content.

## Rejected shortcuts

- Auto-applying watched changes.
- Renaming files on write instead of atomic replace.
- Watching with OS-level recursive scans of the whole disk.
