# ADR-0033: Monitor matching and placement restoration

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Monitor runtime IDs are unstable across reboots, docks, driver updates,
Wayland sessions, remote desktop, and reconnection. Placing windows by
stale absolute coordinates produces unreachable windows. No monitor model
exists in the codebase.

## Alternatives

1. Trust absolute coordinates (rejected — stale placement).
2. Key placement by a stable hardware ID — not available portably.
3. Conservative fuzzy matching on fingerprints (chosen).

## Decision

- Normalized monitor model in `@varve/platform` (ADR-0022):
  `DisplayInfo` = `runtimeId` (session-scoped, not durable), `name?`,
  `isPrimary`, `position`, `size`, `workArea`, `scaleFactor`, `rotation`.
  `DisplayFingerprint` = `name?`, `physicalSizeHint?`, `resolution`,
  `scaleFactor`, `relativeRole` (`primary`/`left`/`right`/`above`/`below`).
- **Matching algorithm** (pure, tested): score candidates by
  (1) relative role to primary, (2) resolution + scale similarity,
  (3) name similarity; require a minimum score; never guess between
  ambiguous candidates — restore to primary with a recovery notice.
- **Placement restoration pipeline:** enumerate current monitors →
  match saved display conservatively → convert saved logical placement to
  current scale (physical↔logical via scaleFactor) → clamp into the
  display work area → ensure title bar/drag region is reachable (clamp
  y ≥ workArea.y + a title-bar margin) → respect minimum panel size →
  avoid complete overlap (cascade within work area) → delay visibility
  until geometry is safe where supported (create hidden, show after
  placement).
- Missing saved monitor: restore visibly on the primary monitor,
  cascade multiple recovered windows, non-blocking recovery notice,
  offer "Gather all windows" (ADR-0035 wait — see ADR-0035 numbering:
  gather command is part of M9/M10 deliverables), preserve the logical
  layout so it returns when the monitor does.
- Honesty about platform limits: Wayland compositors may refuse exact
  placement — request size + monitor/relative placement and accept the
  compositor's choice, documenting the fallback (ADR-0036).

## Consequences

- Restored windows are always reachable; logical panel grouping survives
  monitor changes.
- Mixed-DPI, rotation, negative coordinates, monitors above primary,
  mirrored/virtual/remote displays are handled by the same pipeline.

## Migration impact

None; new subsystem. `WindowPlacement` uses logical coordinates plus
display fingerprint from day one.

## Cross-platform implications

Explicit per-OS notes: Wayland placement denial, Windows work-area/taskbar,
macOS Spaces/fullscreen Spaces, lid close/dock changes, remote desktop.

## Security implications

Monitor geometry is machine-local and never leaves the device
(ADR-0018/0040).

## Accessibility implications

Recovered windows are announced ("Window 2 moved to the primary display");
the recovery notice offers corrective actions without reaching the
off-screen window.

## Performance implications

Matching is O(monitors) with a tiny candidate set; placement math is
pure and fast; monitor hot-plug events are throttled.

## Rejected shortcuts

Persisting runtime ids as durable keys; trusting stale absolute
coordinates; asking the user to reposition windows manually after every
dock change.
