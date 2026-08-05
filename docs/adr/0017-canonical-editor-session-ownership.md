# ADR-0017: Canonical editor-session ownership

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Every native window is an independent JS context. If each window mounted its
own `EditorProvider` (one `useState<EditorState>` per window, `context.tsx:2045`),
the document, undo stacks, autosave, and backup would fork. The single-window
app already keeps exactly one canonical session per provider instance; the
question is which process owns that session when multiple windows exist.

## Alternatives

1. **Primary window as session authority** — the existing `EditorProvider` in
   the `main` window stays canonical; auxiliary windows run a projection
   client over a typed channel.
2. Rust app state as session authority — the document would live in
   `varve-sync` and every edit round-trips through SQLite; large refactor of
   the entire editor, far beyond windowing.
3. Shared worker as authority — not available in every WebView; wry/WebKitGTK
   support for shared workers is inconsistent; browser fallback would fork.

## Decision

**One canonical editing session per application session, owned by the primary
window's `EditorProvider`.** Auxiliary windows never mount an `EditorProvider`:
they run a minimal `AuxiliaryShell` whose providers are projections fed by a
session broker (ADR-0023/0024). The broker's authority lives in the primary
window's JS with Rust as transport/liveness (window registry, event relay).
When the primary window reloads or closes, the broker generation is torn down
and the session re-hydrates on the replacement window (ADR-0031); if the
primary closes as session close, auxiliary windows shut down coordinated
(ADR-0030).

## Consequences

- Auxiliary panels cannot call `useEditor()`; they receive a typed, narrow
  `PanelSessionContext` (document descriptors, selection, active document,
  command client) instead.
- All document mutations continue to pass through the canonical
  `patch`/`updateDoc` pair (`context.tsx:2436,2488`).
- Primary-window reload becomes a recoverable event, not a catastrophic one.
- The broker is the single place that owns session identity, revisions,
  registration, and liveness (ADR-0023).

## Migration impact

None until M6 (first auxiliary window). M2–M5 build the registry, dock model,
window service, and protocol as pure/additive modules with no session changes.

## Cross-platform implications

Identical authority model on all OSes; transport differs (Tauri events on
desktop, BroadcastChannel + storage events in the browser fallback,
in-memory in tests).

## Security implications

Auxiliary windows must authenticate to the broker (session id + window id +
generation, ADR-0040); the broker rejects unregistered senders.

## Accessibility implications

Screen-reader announcements and live regions remain primary-window-owned;
auxiliary windows announce their own local events (detach/attach).

## Performance implications

One document copy exists at a time per session in the primary; auxiliary
windows hold projections (ADR-0024). No duplicate document store, undo
stack, or save authority. Cost: one IPC hop per remote edit.

## Rejected shortcuts

Copying the editor store into every window (state forks, undo breaks);
Rust-owned document state (unnecessary rewrite); leaderless CRDT-only
synchronization (the collab layer is a stub; overkill for window sync).
