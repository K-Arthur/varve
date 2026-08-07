# ADR-0210: Workspace layout persistence

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Named workspace layouts must persist across sessions, survive monitor
disconnect, and separate portable logical layouts from machine-local
window placement.

## Decision

D1 — Two persistence layers:

| Layer | Content | Storage | Portable |
|-------|---------|---------|----------|
| Logical layout | Window roles, dock trees, panel instances, split ratios, active tabs | App settings (SQLite/IndexedDB) | Yes |
| Machine placement | Window geometry, display fingerprints, window state | App settings (separate key) | No |

D2 — Logical layouts are named (e.g. "Default", "Dual Monitor", "Focus").
   Each workspace mode may have a default layout.

D3 — Machine placement uses `DisplayFingerprint` for conservative fuzzy
   matching (ADR-0033). Restored windows are clamped to available work
   areas. Missing displays cascade to primary.

D4 — Schema versioning on both layers. Migration from the current
   `settings.panel.leftPanelWidth` etc. into a dock tree on first run.

D5 — Import/export operates on logical layouts only. Machine coordinates
   are stripped.

## Consequences

- Layouts are portable across machines.
- Monitor changes don't corrupt logical structure.
- Corrupt layouts fall back to last-known-good or safe defaults.

## Migration impact

Reads existing `varve-editor-settings` panel width/visibility data and
produces an initial dock tree layout on first boot.

## Security implications

Imported layouts are validated and stripped of machine-specific data.

## Rejected shortcuts

- Storing raw window coordinates in the design document.
- Single-key storage (loses per-mode layouts).
