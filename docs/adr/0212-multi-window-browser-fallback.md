# ADR-0212: Browser fallback

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

The browser version cannot create reliable native windows. Popup blockers,
positioning restrictions, and cross-origin policies make browser popups
unreliable as a core feature.

## Decision

D1 — Browser fallback uses dockable in-page panels only:
   - Resizable split panes within one browser window.
   - Named logical layouts.
   - Full-screen panel focus mode.
   - No native multi-monitor support.

D2 — The `NativeWindowService` capability reports `'single-window'` in
   browser. The UI labels multi-window features as "Desktop only".

D3 — Logical layout import/export works in browser. Users can prepare
   layouts that apply on desktop.

D4 — Optional browser popup experimentation behind a feature flag and
   explicit capability detection, not the default.

## Conperiences

- Single-window dock layouts remain fully usable.
- Desktop features are clearly labeled.
- Layouts transfer between browser and desktop.

## Migration impact

None — dock-tree model is shared between browser and desktop.

## Rejected shortcuts

- Using browser popups as the primary mechanism.
- Pretending browser popups equal native windows.
