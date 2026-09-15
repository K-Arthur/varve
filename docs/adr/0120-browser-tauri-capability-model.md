# ADR-0120: Browser versus Tauri capability model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Varve runs as a Tauri desktop app and as a web build. Filesystem watching,
atomic writes, Git processes, and secure storage are desktop capabilities;
the browser has File System Access (partial), IndexedDB, and no process
execution. The UI must not pretend capabilities exist where they do not.

## Decisions

### D1 — Capability detection is the gate

`detectRuntimeKind`/`hasCapability` (packages/platform) gains token
capabilities: `token.fileSystem` (read/write arbitrary paths),
`token.watching` (Tauri watcher), `token.atomicWrites`, `token.git`,
`token.secureStorage`, `token.fsa` (File System Access in browser).
Feature availability is computed from these; Sync Center renders only
offered operations (ADR-0114 D2).

### D2 — Desktop (Tauri) capabilities

- File/directory sources with watcher (ADR-0111) and atomic writes
  (ADR-0112).
- Git working-tree source (ADR-0113).
- Secure credential storage (ADR-0119).
- All deterministic token logic (parse/validate/diff/merge) runs locally.

### D3 — Browser capabilities

- Explicit import (file picker / drag-drop) and export (download).
- File System Access integration only where `showOpenFilePicker` +
  `showSaveFilePicker` are available, with the browser's own permission
  prompts.
- No file watching (a manual "refresh source" affordance is shown instead),
  no Git, no secure storage.
- Synchronization state, diffs, and merges still work on documents whose
  source is an import/export channel.

### D4 — WebKitGTK notes

Tauri on Linux uses WebKitGTK; the desktop IPC surface for token commands is
plain invoke-based (same as existing `home_*` commands), avoiding webkit2gtk
event-passing quirks by keeping watcher events small and sequence-numbered.

## Alternatives

- Emulating file watching in the browser — rejected: dishonest and
  unreliable.
- Shipping Git in the web build via WASM — rejected: security surface with
  no demonstrated need.
- Failing silently when capabilities are missing — rejected: the UI must
  explain and offer the closest safe alternative.

## Consequences

- One capability matrix drives both UI and adapter availability; Playwright
  runs cover the web fallbacks (import/export only).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Browser File System Access respects the origin's permission prompts; no
capability is force-enabled across runtime boundaries.

## Rejected shortcuts

- Pretending browser watching equals Tauri watching.
- Exposing Git commands in web builds.
- Overriding browser permission prompts.
