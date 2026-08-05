# ADR-0129: Snapshot and incremental synchronization

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

A new auxiliary window needs the state its panels require before first
paint, then a stream of updates. Without revisions and patches, every
update would be a full snapshot and gaps would be undetectable.

## Alternatives

1. Full state broadcast on every change — rejected (memory/IPC cost).
2. Snapshot + revisioned patches with gap detection and resync (chosen).

## Decision

- The broker maintains a **session revision** (monotonic integer, distinct
  from the dead `state.revision`, `context/types.ts:339`). Every
  session-shared mutation bumps it.
- Hydration flow: auxiliary window sends `WINDOW_READY` → broker replies
  with a `SessionSnapshot` (`{ revision, openDocuments, activeDocumentId,
  workspaceMode, theme, locale, selection, commandAvailability,
  panelLayout, panelLocalState, collaborationSummary }`) sized to the
  hosted panels (ADR-0123) — never DOM nodes, canvas contexts, worker
  handles, functions, image buffers, full undo history, credentials, or
  native paths.
- Incremental updates are typed domain patches: `{ baseRevision, patches }`
  with `baseRevision = revision - 1` normally; the receiver detects gaps,
  drops, duplicates, and out-of-order events by `(generation, sequence)`
  and `revision` arithmetic.
- On gap/duplicate/stale detection → `RESYNC_REQUEST` → fresh snapshot;
  the broker coalesces high-frequency events (selection changes during
  drags) into last-value-wins patches, respecting monotonic revisions.
- Backpressure: per-window bounded queues; overflow drops coalescible
  patches and requests resync rather than growing memory.
- Bounded payloads: envelope size cap; panel-local state snapshots are
  size-limited (ADR-0124 codec).

## Consequences

- Fresh windows converge in one round trip; steady state is patch traffic
  proportional to actual change.
- Full document bytes are not resent per small edit (the canonical
  document lives in the primary; panels get projections, ADR-0122).

## Migration impact

None; new subsystem.

## Cross-platform implications

Identical logic across transports; browser fallback reuses the same
revision/queue code with BroadcastChannel transport.

## Security implications

Snapshots contain only session-required slices; the broker refuses to
serialize excluded fields (defense-in-depth with ADR-0145).

## Accessibility implications

`WINDOW_HYDRATED` gates "panel ready" announcements; a failed hydration
produces the recoverable error screen (ADR-0136).

## Performance implications

Measurements (M6): snapshot bytes, patch rate, gap rate, resync count —
targeted budgets recorded in `docs/quality/perf-budgets.md`; coalescing
prevents selection-drag storms.

## Rejected shortcuts

Sending the full `Document` on every change; skipping revisions and
trusting transport ordering; unbounded queues.
