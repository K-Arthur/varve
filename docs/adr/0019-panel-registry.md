# ADR-0019: Panel registry

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Panel identity is scattered across `PanelId` (`workspaceTypes.ts:40-47`),
Shell conditionals (`Shell.tsx:372-535`), menu definitions (`menu/defs.ts`),
action registrations (`actions/registerAll.ts`), settings, and tests.
There is no single source of truth for what a panel is, what it needs, or
whether it can detach. The existing `WorkspacePreference.panelOverrides`
store is designed but dead (audit §4).

## Alternatives

1. Enrich the existing `WorkspaceConfig.panels` record — rejected: panel
   *type capability* (detachability, document needs, expensive deps) is not a
   per-mode concern, and the config is already large.
2. A first-class declarative registry (chosen), with per-mode visibility
   remaining in `WorkspaceConfig` as a *policy* over registry entries.

## Decision

Create `packages/editor/src/workspace/panelRegistry.ts` owning:

- `PanelDefinition`: `id` (PanelTypeId, union stays compatible with
  `PanelId` + new additions), `title`, `icon`, `instancePolicy`
  (`singleton` | `single-per-document` | `multiple`), `documentRequirement`
  (`none` | `active-document`), `selectionScope` (`shared` | `none`),
  `allowedHosts` (`primary-sidebar` | `auxiliary-window`), `detachable`,
  `dockable`, `minimumSize`, `preferredSize`, `loadPolicy` (`eager` |
  `lazy`), `inactivePolicy` (`keep-mounted` | `suspend` | `unmount-with-state`),
  `capabilities` (`requiresCanvas`, `requiresRenderer`, `requiresModels`,
  `supportsDocumentPinning`), `localStateCodec` (typed, versioned,
  DOM-free, bounded), `commands` (detach/attach/move), `a11yLabels`,
  `emptyState`.
- A `DetachablePanelLifecycle` contract (`prepareForTransfer` /
  `restoreFromTransfer` / `suspend` / `resume` / `beforeHostClose`) —
  a panel is not detachable until it implements it.
- Registry-derived helpers replacing scattered lists: detach menus, window
  menu content, empty-window panel pickers, capability validation,
  per-mode visibility validation.
- `getPanelRegistry()`, `registerPanel(def)`, `assertPanelInvariants()`.

Instance identity (`PanelInstanceId`) is assigned by the dock model
(ADR-0020), not by the registry.

## Consequences

- Shell no longer decides what panels exist; it renders what the dock tree
  says (M3+), keeping Shell's import budget unchanged (no new Shell imports
  without removals).
- Panels marked detachable only after their lifecycle contract lands (M7).
- `PanelId` type remains the panel *type* id; `PanelInstanceId` is separate.

## Migration impact

`PanelId` stays source-compatible; the registry starts by registering the
seven existing panels with `detachable: false`; detachable flips per panel as
its lifecycle contract is implemented and tested.

## Cross-platform implications

None; registry is pure TS.

## Security implications

Registry is the capability gate: `detachable` + `documentRequirement`
validation prevents a panel from being transferred to an invalid host
(ADR-0040).

## Accessibility implications

Every registry entry carries `a11yLabels` (including detach/attach
announcements) so panel chrome and screen-reader text derive from one place.

## Performance implications

`loadPolicy` and `capabilities.requires*` drive auxiliary-window chunk
loading: a Layers-only window loads the layers chunk, not the canvas/model
chunks (ADR-0038).

## Rejected shortcuts

Adding a `detachable` boolean to `PanelConfig` only; keeping panel lists in
menus/tests; deriving everything from strings with switch statements.
