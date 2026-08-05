# ADR-0028: Focus and shortcut routing

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Shortcuts bind through one window keydown listener per window
(`useShortcuts.ts:194`) against a per-window `ActionRegistry`. In a
multi-window app, the same shortcut (e.g. Ctrl+Z) would fire in every
window that has focus-relevant handlers, and canvas shortcuts would run in
windows without a canvas.

## Alternatives

1. Register everything in every window and dedupe — fragile, order- and
   timing-dependent.
2. Window-aware shortcut classes with a per-window decision layer (chosen).

## Decision

- Shortcuts are classified (documented in `ShortcutManager.ts`):
  - **Application-global** — save, open, preferences, gather windows,
    workspace manager. Valid in any window.
  - **Session-global** — undo, redo, find, command palette, delete-when-
    focus-is-canvas-or-selection. Routed to the broker; applied once
    (ADR-0025/0026).
  - **Document-view-specific** — zoom, pan, canvas tool shortcuts. **Only
    in the primary canvas window**; auxiliary windows never register them.
  - **Panel-local** — rename, expand tree, inspector navigation. Bound in
    the window hosting the focused panel.
- Each window owns a `shortcutArbiter` that resolves a keydown to one of:
  local panel action, local app action, broker-routed session action, or
  ignore. `shouldIgnoreShortcutTarget` (`ShortcutManager.ts:796`) is
  extended with the window's focused element + panel context so Delete in
  a detached search field never deletes artwork and Spacebar pan never
  activates without a canvas.
- Focus tracking: the broker records last-focused window and last-focused
  panel (from focus messages); `focusWindow` (ADR-0022) is the sanctioned
  cross-window focus move.
- Escape closes overlays only within the focused window (per-window modal
  roots, ADR-0035).

## Consequences

- Exactly one undo per Ctrl+Z even with two windows focused-adjacent.
- A detached window's shortcut surface is derived from the registry
  (ADR-0019) — no canvas bindings leak in.

## Migration impact

The existing `registerEditorActions` ordering invariant stays; the arbiter
is additive and per-window.

## Cross-platform implications

Binding matching stays in `ShortcutManager`; no OS-specific logic added at
this layer.

## Security implications

Broker-routed shortcuts validate sender (a spoofed window cannot trigger
session-global actions).

## Accessibility implications

Keyboard-accessible detach/attach/move commands are panel-local or
session-global actions (ADR-0041 keyboard workflows); focus restoration is
explicit in transfer (ADR-0029).

## Performance implications

Per-window arbitration is O(registry size) on keydown only; no cross-window
traffic for panel-local keys.

## Rejected shortcuts

Registering the full shortcut set in every window; global key capture
outside the focused window; letting the broker execute raw key events.
