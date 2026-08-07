# ADR-0211: Window-close and recovery behavior

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Closing windows must follow platform conventions and never lose unsaved
panel state or corrupt the document. Auxiliary windows may crash or reload.

## Decision

D1 — Closing an auxiliary panel window:
   - Reattaches its panels to the primary window's dock tree.
   - Preserves panel-local state snapshots.
   - Does not close the document or end the session.

D2 — Closing the primary window:
   - Closes the full application session.
   - Coordinates auxiliary shutdown.
   - Prompts save if dirty.

D3 — macOS: last window close hides the app (platform convention).
   Windows/Linux: last window close exits the app.

D4 — Auxiliary window crash:
   - Panels are marked orphaned.
   - A recovery banner offers reattach or "Gather All Windows".
   - Repeated crashes (>3) enter safe mode: single-window layout.

D5 — Auxiliary window reload:
   - Fresh registration with new generation counter.
   - Old-generation messages are rejected.
   - Fresh snapshot sent; no duplicate panel instances.

## Consequences

- No data loss on close or crash.
- Platform conventions are honored.
- Crash loops are bounded.

## Migration impact

None — new lifecycle behavior.

## Cross-platform implications

macOS application lifecycle (hide-on-close vs. exit-on-close) is handled
by the platform adapter.

## Rejected shortcuts

- Closing auxiliary windows independently (orphaned state).
- Ignoring auxiliary crashes (silent data loss).
