# ADR-0144: Collaboration behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`@varve/collab` is a stub (`packages/collab/src/index.ts`: `CollabUser`,
`LiveCursor` types; `getCollabUsers()` returns `[]`; transaction hooks are
no-ops). The program must define multi-window behavior now so the future
real connection does not fork per window.

## Alternatives

1. Let each window open its own connection later — rejected (duplicate
   presence, cursors, subscriptions, autosave loops).
2. One connection per canonical session; windows consume shared state
   (chosen).

## Decision

- **One collaboration connection per canonical session**, owned by the
  primary window (ADR-0122). Auxiliary windows consume session-shared
  collaboration state (remote selections, presence, activity) through the
  broker snapshot/patches (ADR-0129).
- Duplicate presence connections, cursor broadcasts, document
  subscriptions, activity records, and autosave loops are forbidden.
- Which window displays collaboration toasts: the window where the
  user-facing action originated; session-level events (permission
  changes) announce in the primary and are mirrored as announcements in
  auxiliary windows.
- Permission management stays primary-owned (session modal, ADR-0140).
- Remote selections update detached panels through the shared selection
  channel (ADR-0132).
- Focus and active-document affect presence as today; window *placement*
  is machine-local and never broadcast (ADR-0123).
- Team workspace *logical templates* may become shareable only through an
  explicit separate feature; native workspace geometry never is.

## Consequences

- When a real collaboration backend lands, multi-window behavior is
  already defined; no per-window connection cleanup needed.

## Migration impact

None (stub today). The broker reserves the collaboration slice in the
snapshot schema now.

## Cross-platform implications

None beyond transport differences.

## Security implications

Collaboration state crosses the broker as validated envelopes; remote
cursors are untrusted content like any network input.

## Accessibility implications

Remote presence announcements follow the same live-region rules as local
announcements.

## Performance implications

One socket instead of N; presence updates coalesce via the patch channel
(ADR-0129).

## Rejected shortcuts

Per-window connections; broadcasting machine-local geometry to
collaborators; sharing named layouts through collaboration payloads.
