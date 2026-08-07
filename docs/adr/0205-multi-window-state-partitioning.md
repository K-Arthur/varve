# ADR-0205: State partitioning across windows

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Not all React state should be synchronized across windows. Synchronizing
everything wastes bandwidth and creates coupling; synchronizing nothing breaks
shared context. Every state value must be classified.

## Decision

D1 — State is classified into scopes:

| Scope | Examples | Sync |
|-------|----------|------|
| `document-shared` | Scene nodes, pages, styles, components, variables | Yes — snapshot + patches |
| `session-shared` | Open-document list, active document, undo, workspace mode | Yes — snapshot + patches |
| `window-local` | Focused panel, geometry, maximized state, local theme readiness | No |
| `panel-instance-local` | Scroll position, expanded tree nodes, search query, active tab | No (serialized on transfer only) |
| `machine-local` | Monitor mapping, saved placement, named layouts | No — per-device |
| `ephemeral` | Hover, pointer capture, drag preview, tooltip, IME | No |

D2 — Synchronized state uses one revision stream with monotonic sequence
   numbers. Auxiliary windows track their last-synced revision and request
   gap repair when needed.

D3 — Panel-local state is serialized only during panel transfer transactions
   (ADR-0216), bounded by `PanelLocalStateCodec.maxBytes` (64 KiB default).

## Consequences

- Bandwidth stays bounded; only document/session changes trigger patches.
- Panel-local state survives transfer without cross-window sync overhead.
- Machine-local state (monitor geometry) never leaks into documents.

## Migration impact

None — current state is already implicitly partitioned by React's tree scope.

## Rejected shortcuts

- Synchronizing all `useState` values via a proxy (too broad, creates
  feedback loops).
- Only syncing document changes (window-local workspace mode would desync).
