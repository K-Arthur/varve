# ADR-0204: Canonical editor-session ownership

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Multi-window support requires exactly one authoritative editing session per
document to prevent divergent undo stacks, stale selections, and conflicting
mutations. Varve's current `EditorProvider` already owns document state, undo,
selection, and collaboration in one React tree. Auxiliary panel windows must not
create independent copies.

## Alternatives

A. One `EditorProvider` per native window — rejected: creates independent
   document copies, divergent undo, duplicate collaboration sockets.
B. CRDT-replicated mutable stores per window — rejected: over-engineered for
   panel-only windows; undo ownership remains ambiguous.
C. Primary window as session authority; auxiliary windows submit commands —
   accepted.

## Decision

D1 — The primary (main) window owns the canonical `EditorState` including:
   - Document revisions
   - Undo/redo stacks
   - Selection
   - Active tool
   - Active document identity
   - Collaboration connection
   - Save authority

D2 — Auxiliary windows receive synchronized projections (read-only snapshots
   + incremental patches) and submit validated commands through the session
   broker.

D3 — Commands from auxiliary windows pass through the same command authority
   as primary-window commands. No special "AI mutation path" exists.

## Consequences

- Auxiliary windows cannot independently mutate document state.
- All mutations are serialized through one authority.
- Undo from any window affects the same stack.

## Migration impact

None — primary window already owns all state.

## Cross-platform implications

None — session ownership is a TypeScript-level concern.

## Security implications

Auxiliary windows must be authenticated against the session before receiving
snapshots or submitting commands.

## Accessibility implications

Focus routing must be window-aware (ADR-0215).

## Performance implications

One snapshot + patch stream per auxiliary window. Coalescing for high-frequency
events (cursor, hover) prevents flooding.

## Rejected shortcuts

- Sharing the raw `EditorState` React context across windows (React contexts
  are single-tree scoped).
- BroadcastChannel-only sync (no security validation, no ordering guarantees).
