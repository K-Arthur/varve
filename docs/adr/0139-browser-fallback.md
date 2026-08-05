# ADR-0139: Browser fallback

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The browser build (`apps/desktop` under plain Vite, `detectPlatform()`
resolving to web/memory) is a first-class target. Browser popups cannot
deliver reliable multi-window behavior (popup blocking, positioning
restrictions, storage partitioning, unreliable restoration).

## Alternatives

1. Use `window.open` popups with `BroadcastChannel` sync — rejected as the
   core path (unreliable; only an opt-in experiment).
2. Honest single-window fallback: dock-tree layouts in one window +
   full-screen panel focus mode + capability-labeled UI (chosen).

## Decision

- Browser `windowService.capability` = `'single-window'` (ADR-0127):
  native multi-monitor windows are labeled as a **desktop capability** in
  the workspace manager and window menus; detach affordances show an
  accurate explanation instead of pretending.
- The **same dock-tree model** (ADR-0126) renders in one browser window:
  in-page dock groups, tabs, resizable split panes, named logical layouts
  (ADR-0137), full-screen panel focus mode as the closest in-page analog
  of detachment.
- Popup experimentation is allowed only behind capability detection
  (popup blockers detectable via `window.open` return) with clear
  warnings and no core-correctness dependency; `BroadcastChannel` may
  power the experimental popup path only as a transport behind the broker
  (ADR-0128) — never as the authority.
- Logical layout import/export works in the browser; machine placement is
  stripped on import (ADR-0137).

## Consequences

- Browser users get the full dock/layout model minus native windows;
  no silent no-ops — every unsupported operation explains itself.
- The broker, protocol, transfer state machine, and dock model run on
  `memoryTransport`/`broadcastChannelTransport`, so the same tests cover
  web and desktop.

## Migration impact

The single-window browser layout is exactly one dock tree — the same
shape as the desktop primary window after M12.

## Cross-platform implications

Browser behavior is uniform across OSes; mobile browsers degrade to the
single-window dock without native claims.

## Security implications

No window.open with untrusted URLs; popup creation is never automatic;
storage partitioning is handled by keeping session state in the primary
context.

## Accessibility implications

Focus mode and keyboard dock controls are fully keyboard-accessible;
capability labels are announced.

## Performance implications

One window = no duplicate renderers; the browser path costs nothing extra.

## Rejected shortcuts

Pretending popups are native windows; hiding unsupported operations;
silently falling back without explanation.
