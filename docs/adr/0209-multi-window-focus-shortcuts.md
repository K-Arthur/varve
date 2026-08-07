# ADR-0209: Focus and shortcut routing

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Shortcuts must be routed to the correct window. A Delete keypress while
focus is in a detached Layers panel must not delete canvas artwork. Undo
must fire once, not twice (once per window).

## Decision

D1 — Shortcuts are classified into scopes:

| Scope | Examples | Routing |
|-------|----------|---------|
| Application-global | Save, Open, Preferences, Gather Windows | Always primary window |
| Session-global | Undo, Redo, Find, Command Palette | Primary window (command authority) |
| Document-view-specific | Zoom, Pan, Canvas tool shortcuts | Only if canvas is focused |
| Panel-local | Rename layer, Expand tree, Move focus within panel | Only the focused panel's window |

D2 — The primary window tracks `lastFocusedWindowId` and
   `lastFocusedPanelId`. Panel-local shortcuts are dispatched only to the
   focused panel's window.

D3 — Session-global shortcuts (undo, redo) are intercepted by the primary
   window regardless of which window has focus. The focused window sends a
   `request-undo` command to the primary, which executes once.

D4 — Canvas-only shortcuts (spacebar pan, tool keys) are suppressed when
   no canvas is focused. The auxiliary window does not register canvas
   shortcuts.

## Consequences

- No duplicate undo/redo.
- No accidental canvas mutations from panel focus.
- Keyboard-only workflow is fully supported.

## Migration impact

`useShortcuts` hook gains a `scope` parameter. Existing shortcuts default
to session-global.

## Accessibility implications

Focus transfer on detach/reattach must be announced for screen readers.

## Rejected shortcuts

- Per-window independent shortcut registration (duplicate handlers).
- Global shortcut interception by every window (race conditions).
