# ADR-0125: Stable window and panel-instance identity

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The app has no durable identity for windows or panel instances. Tauri labels
are per-app-declaration (`main`), arrays indexes and display titles are
unstable across renames/reorders, and process-local counters would collide
across windows and generations.

## Alternatives

1. Use Tauri labels as the durable window identity — rejected: labels are
   visible surface, must be sanitized/bounded, and must not carry document
   names; a rename/restore cycle needs an indirection layer.
2. UUIDs for both windows and panel instances, with Tauri labels derived
   (chosen).

## Decision

- `EditorSessionId`, `WorkspaceWindowId`, `PanelInstanceId`,
  `PanelHostId`, `DockNodeId`, `TransferTransactionId`, and `WorkspaceLayoutId`
  are all UUIDs (`crypto.randomUUID()`, v4), created once and never reused.
- Tauri window **labels** are derived and sanitized: `varve-w-<8 hex>` —
  bounded length, alphanumeric-safe, carrying no user content. The
  `WorkspaceWindowId` maps to the label via a broker registry
  (ADR-0128); labels are re-derived on restore.
- Panel instances carry `documentId` when pinned (deferred, ADR-0132) and a
  `localStateRef` pointing at the versioned local-state blob during transfer
  (ADR-0124).
- Idempotency keys for commands/transactions derive from
  `sessionId + windowId + sequence` (ADR-0128), never from titles or
  indexes.
- Monotonic counters are allowed only for *sequence numbers within a window
  generation*, never as identity.

## Consequences

- Restoring a layout on another machine produces fresh window ids but
  stable panel-instance ids, so logical layouts stay portable (ADR-0137).
- Crash reports use opaque ids; document names are excluded by default
  (privacy).

## Migration impact

None to existing code: identities are new. `INITIAL_SESSION_ID = 'session-0'`
(`context.tsx:1840`) becomes the seed session id; new sessions get UUIDs.

## Cross-platform implications

Label generation is platform-agnostic; all OSes get the same sanitization
rules. Wayland/Windows/macOS see identical labels.

## Security implications

No user-controlled content enters labels; `WorkspaceWindowId` is opaque;
label injection and path/name leakage are prevented at the boundary
(ADR-0145).

## Accessibility implications

Screen-reader text uses panel titles, not raw ids; ids stay in DOM
`data-*` attributes for testability.

## Performance implications

UUID generation is negligible; index-free identity removes tree-rebuild
invalidation costs in the dock model.

## Rejected shortcuts

Using Tauri labels as durable ids; using titles; using `session-${n}`
counters; reusing `nextId` (`document.ts:150`) which is document-scoped
node identity.
