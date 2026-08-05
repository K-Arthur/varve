# ADR-0030: Window-close behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The app has one window (`main`), and its close path is implicit. With
auxiliary windows, every close path must be defined: panel close, window
close, primary close, last-window close — per platform conventions
(macOS keeps the app alive with no windows; Windows/Linux exit).

## Alternatives

1. Primary-window close immediately kills all windows — rejected:
   unsaved prompts would duplicate; detached panels could be orphaned.
2. Coordinated close policy with a designated close coordinator (chosen).

## Decision

- **Closing a panel:** policy per registry entry — hide (keep instance +
  local state) or destroy; never silently destroy unsaved panel-local
  input (ADR-0034 confirms first).
- **Closing an auxiliary window:** default policy = reattach its panels to
  the primary window (source panels are never lost); alternative policies
  (hide window keeping layout; close optional panels) are configurable per
  layout but never defaulted to data loss. An empty auxiliary window
  closes after its last panel transfers out (ADR-0029).
- **Closing the primary window:** treated as session close; the close
  coordinator (broker, ADR-0023) runs: resolve save/recovery prompts once
  (no duplicate prompts from every window), then coordinate auxiliary
  shutdown (ordered: suspend panels → close auxiliaries → exit). No
  auxiliary window outlives the session with orphaned state.
- **Closing the last window:** platform-conventional — on macOS hide
  (application continues running, per `app.on_window_event` CloseRequested
  semantics + `ExitRequested` handling); on Windows/Linux exit the app.
  macOS menu/Quit still exits.
- Native close events arrive via Tauri `onCloseRequested`; the primary
  intercepts and runs the coordinator; auxiliaries register their close
  intent with the broker before destroying.

## Consequences

- No window can close and leave detached panels unaccounted for.
- Save prompts appear once, from the coordinator, even with 10 windows.

## Migration impact

Primary close currently just exits; the coordinator wraps that path (M11).

## Cross-platform implications

macOS application lifetime (no-window alive state) is explicit; Windows
snap/close semantics unchanged; Linux (X11/Wayland) uses the same
coordinated flow.

## Security implications

Close intent messages are validated envelopes; only the broker can order
auxiliary shutdown.

## Accessibility implications

Close prompts are session modals (ADR-0035) with correct focus trapping
and announcements.

## Performance implications

Auxiliary shutdown is parallelized; timers/listeners are torn down per
window (ADR-0038).

## Rejected shortcuts

Killing all windows from the primary's close handler without coordination;
per-window unsaved prompts; silently destroying panel state on close.
