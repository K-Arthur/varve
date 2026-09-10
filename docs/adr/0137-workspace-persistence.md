# ADR-0137: Workspace persistence

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Persistence today is global-and-mode-agnostic booleans (`settings.panel`)
plus a dead per-mode override store (`workspaceStore.ts`). Named,
monitor-aware layouts with logical/device separation do not exist.

## Alternatives

1. Extend `varve-editor-settings` with geometry — rejected: pollutes the
   global settings store, no versioning, no named layouts, no
   import/export.
2. A dedicated versioned layout store with named layouts (chosen).

## Decision

- New storage: `varve-workspace-layouts` (localStorage on web; SQLite
  `app-setting` keys on desktop via `app_get_setting`/`app_set_setting`,
  `lib.rs:1824-1842`) holding `{ schemaVersion, layouts:
  NamedLayout[], activeLayoutId, lastKnownGoodLayout, restoreAttempts }`.
- `NativeWorkspaceLayout` (ADR-0126) is **portable**: logical window
  roles, dock trees, panel instances, split ratios, active tabs,
  panel-local-state references, workspace-mode association, schema
  version. `WindowPlacement` carries display **fingerprints**
  (ADR-0138), never raw coordinates as the source of truth.
- Separation (explicit in the store): portable logical layout vs
  device-specific placement vs per-mode panel visibility preferences
  (existing `WorkspaceConfig.panels`) vs document-specific pinning
  (deferred, ADR-0132).
- Named layouts: Default, Single monitor, Dual monitor, Focus canvas,
  Illustration, Print production, Motion, Developer handoff, Custom.
  Operations: save, save as, rename, duplicate, delete, reset, assign
  default per workspace mode, export logical layout, import logical
  layout (validated, machine-specific coordinates stripped).
- Imported layouts are validated by `deserializeDockTree` + placement
  sanitization (NaN/infinite/oversized geometry rejected, ADR-0145) and
  never stored with monitor coordinates.

## Consequences

- Layouts survive restart; missing monitors never create unreachable
  windows (ADR-0138); the design document never contains layout data.
- The existing `varve-editor-settings.panel` fields migrate into the dock
  tree for the primary window (migration tested, ADR-0126).

## Migration impact

One-way migration from `settings.panel` visibility/widths and the dead
`varve-workspace-preferences` overrides; legacy keys remain readable,
writes go to the new store.

## Cross-platform implications

Storage backend differs (SQLite vs localStorage) but the schema and
validation are identical; the desktop/web parity test harness
(`__tests__/parity.test.ts` pattern) extends to the layout store.

## Security implications

Imported layouts are untrusted input (fuzzed, ADR-0147); machine-local
coordinates are stripped on import; monitor geometry never enters the
design document or collaboration payloads (ADR-0145).

## Accessibility implications

Restored layouts must keep every window reachable and keyboard-usable;
restore warnings precede costly layouts (performance profile).

## Performance implications

Layout blobs are small (id-based); export/import are synchronous-safe;
restore is bounded by window count (ADR-0142 limits).

## Rejected shortcuts

Storing screen coordinates in the document; unbounded unversioned JSON;
one global "last layout" slot with no named layouts.
