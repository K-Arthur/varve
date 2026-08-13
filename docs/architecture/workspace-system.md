# Workspace System

Canonical contract for Varve's workspace modes. A workspace is a **versioned
view-and-workflow configuration over one document and one editor engine** —
Design, Print, Draw, Photo, Motion, Codegen & Audit, and Logo are all the same
editor with different chrome, not different editors.

Related: `docs/architecture/logo-system.md`, `docs/architecture/motion-system.md`,
`docs/architecture/focus-navigation.md`.

## Invariants

A workspace switch **must not**:

- fork the scene model or document
- duplicate commands, tools, or the renderer
- mutate artwork, or add an entry to the artwork undo stack
- reset document state, selection, viewport, dirty state, or undo/redo
- remount the editor
- hide save, recovery, undo/redo, command search, settings, help, or the
  workspace switcher
- make a tool permanently unreachable — a tool absent from a workspace toolbar
  stays reachable by shortcut and command palette

A workspace switch **may** change: visible panels, panel order/collapse/preferred
width, floating-toolbar/status-bar/tab-strip visibility, toolbar composition,
inspector tabs and default tab, status-bar sections, canvas-overlay defaults,
the active tool (only where the workspace declares `defaultTool`), and
first-use guidance.

### Responsive editor chrome

At viewports below 900px, the layers and inspector panels become drawers and
the panel FABs remain available over the canvas. The FABs must stay above the
fixed 28px status bar so document name, save state, zoom, and fit controls are
never obscured. The narrow-layout E2E assertion in
`tests/e2e/canvas/workspace-mode.spec.ts` guards this geometry.

## Scope: the workspace is application-global

The active workspace is global to the application. It is **not** stored per
document, and it is **not** carried across launches — every session opens in
Design (`BOOT_WORKSPACE_MODE`).

Rationale: a document that reopened into a specialist environment the user left
active days ago is disorienting, and per-document workspace state would have to
be serialized somewhere — either into the design document (leaking personal UI
layout into a shared file) or into a side table that drifts from it. Switching
documents therefore never changes the workspace, and switching workspaces never
changes the active document; `packages/editor/src/__tests__/workspaceModeGlobal.test.tsx`
locks both directions in so a future per-document policy has to be a deliberate
product decision rather than an accident of state plumbing.

## Configuration resolution

There is exactly one resolver. Consumers never merge configuration themselves.

```
getEffectiveWorkspaceConfig(mode, prefs?)
  = WORKSPACE_CONFIGS[mode]            built-in defaults (falls back to Design
                                       for an unknown or future mode id)
  + prefs[mode].panelOverrides         the user's per-workspace panel customizations
  + prefs[mode].inspectorTabOverrides  per-workspace inspector tab visibility
  + prefs[mode].statusSectionOverrides per-workspace status bar section visibility
```

- `workspaceTypes.ts` owns the built-in configs and pure config→derived-data
  helpers (now accepting optional `WorkspaceConfig` params for override-aware
  resolution: `getVisibleInspectorTabs`, `getDefaultInspectorTab`,
  `getVisibleStatusSections`). It has no knowledge of user preferences, which
  is what keeps it free of a cycle with the store.
- `workspaceStore.ts` owns preferences, the resolver, and persistence.
  `setInspectorTabOverride` and `setStatusSectionOverride` are the override
  writers alongside the existing `setPanelOverride`.
- `useEffectiveWorkspaceConfig(mode)` is the reactive React view; it re-renders
  workspace-controlled surfaces when a preference changes.

Panel layout is the only field that currently accepts user overrides. Fields
without an override surface still resolve through the same path so that adding
one later takes effect everywhere at once.

### Applying a config

`applyWorkspaceConfig` in `context/useWorkspaceMode.ts` is the single projection
from config onto runtime state — panels, canvas overlays, default tool, and the
`settings.panel` mirror. Switch, `__setWorkspaceModeUnsafe`, and reset all route
through it. They previously each had their own copy, and the copies drifted:
reset resolved the *effective* config before clearing the overrides it was
meant to discard, so it re-applied the customized layout instead of the
built-in one.

## Persistence

| What | Where | Durability |
|---|---|---|
| Per-workspace panel overrides | `varve-workspace-preferences` (localStorage) | session mirror, read synchronously during render |
| Same, durable copy | platform app-setting `workspace-preferences` | SQLite (desktop) / IndexedDB (web) |
| Global panel mirror | `settings.panel` (`varve-editor-settings`) | legacy; seeds boot for users with no overrides yet |

localStorage alone is not sufficient: on Linux/WebKitGTK it has been observed
not surviving between app launches — the defect that made the welcome dialog
reappear every launch, fixed for onboarding the same way (see
`onboard/onboardingStore.ts`). Preferences are written to both; durable writes
are debounced (400 ms) and can be flushed explicitly.

`hydrateWorkspacePreferencesFromPlatform` runs once at startup and merges
**per mode by `lastCustomized`**. Both stores are legitimate sources —
localStorage can be wiped while platform storage survives, and platform storage
can lag a write that has not flushed or came from another window. An
uncustomized entry never displaces a customized one, so durability can never
itself lose a customization. A missing, empty, or corrupt payload leaves the
local snapshot untouched.

### Recovery and migration

- Legacy `strata-workspace-preferences` is read as a fallback key.
- Both stores share one `sanitizePreferences` pass: unknown panel ids and
  wrong-typed fields are dropped, unknown modes are ignored, missing modes fall
  back to defaults. That last rule is also what keeps a payload written by a
  newer build readable after a downgrade.
- Persistence failures are recorded (`getWorkspacePersistenceError()`) rather
  than swallowed, so a user whose customizations silently stopped saving has
  something to report. Failures never interrupt editing.
- Boot migrates a pre-upgrade `settings.panel` value into the mode's overrides
  once, but only where it *disagrees* with the built-in default — equality
  carries no information about what the user chose, and seeding on it would
  mark every fresh install as customized.

## What is deliberately not workspace configuration

**Keyboard bindings.** `ShortcutManager` holds one global binding per action
id and has no per-workspace layer. A `shortcuts.extra` map in the workspace
config declared per-mode bindings that nothing registered, so the config
advertised keys that did nothing when pressed. Switch shortcuts are resolved
for display with `workspaceShortcutLabel(mode)`, never from a literal — a
hard-coded `WORKSPACE_SHORTCUTS` table still claimed Ctrl+Shift+D/P/R/I/M long
after those keys were reassigned to Repeat Duplicate, Present, Invert
Selection, and Preview Mode.

**Renderer policy.** A `performance` block (worker renderer, subtree cache,
viewport culling, image-cache size, layer thumbnails, real-time preview) had no
runtime consumer — only tests, which made it read as live policy. Renderer
behaviour belongs to the global render/performance settings (`settings.ts`) and
the adaptive memory budget (`canvas/memoryBudget.ts`), which can account for
hardware capability, memory pressure, and scene complexity. A workspace switch
is a layout change and must not reconfigure the renderer as a side effect.

**Shortcut-tip suppression** is derived, not declared. Tips for tools a
workspace hides are suppressed via `suppressedTipShortcutIds(mode)`, computed
from the workspace's own toolbar. The previous hand-maintained
`shortcuts.disabled` list was empty in all seven built-ins and suppressed
nothing.

## Toolbar composition

`workspace/toolbarComposition.ts` turns a workspace's `ToolbarConfig` into the
ordered slots `FloatingToolbar` renders. The config is authoritative for
**order, grouping, and flyout membership**; the toolbar owns no tool list.

`composeToolbar(toolbar)` returns `ToolbarSlot[]`:

- Main-row tools appear in declared order, carrying their `groupStart`
  separators. A repeated tool renders once.
- Each flyout replaces its members and is anchored at the position of its first
  declared member, inheriting that member's separator — so a config that starts
  a group with `rect` starts that group with the Shapes flyout.
- A flyout whose members are not in the main row (boolean operations are
  commands, not selectable tools) is appended after it.
- A flyout left with no members by customization is dropped rather than
  rendering a chevron that opens nothing.

Visibility policy stays in `getEffectiveWorkspaceConfig`, which applies the
user's overrides — to flyout members as well as the main row — before the
config reaches the composition. One place decides *whether* a tool is shown;
one decides *where* it goes.

Until 2026-08-13 `FloatingToolbar` rendered from two hard-coded arrays
(`INDIVIDUAL_TOOLS` / `DRAWING_TOOLS`) and consulted the config only as a
visibility filter. That violated invariant 9 and produced three defects, each
now covered by `toolbarComposition.test.ts`:

1. Declared order was ignored, so Image mode led with Line/Text instead of the
   Select/Crop/retouch order its config declares for photo work.
2. Declared tools missing from the hard-coded arrays were unreachable from the
   toolbar even though they are implemented tools with icons — `nodeEdit`
   (Logo), `refineMask` and `trimapEdit` (Image).
3. Flyout contents were hard-coded, so `flyouts[].tools` never applied and
   boolean operations could not be hidden: the preference sanitizer accepted
   only ids present in `toolbar.tools`, which excludes flyout-only tools.

## Config-field consumer audit (2026-08-13)

Every `WorkspaceConfig` field was re-checked against its runtime consumers,
the same review that found the toolbar defects above. Result:

| Field | Consumer | Status |
|---|---|---|
| `panels[].visible` | `Shell`, `panelVisibilityPatch` | Live |
| `panels[].preferredWidth` | `Shell` (layers, inspector) | Live for the two sidebars; `codegen`/`timeline` declare `'100%'`, which `Shell` ignores |
| `panels[].order` | `getOrderedPanels` — exported, but called only by its own test | **Decorative** |
| `panels[].collapsed` | preference sanitizer only; `Shell` derives `data-collapsed` from visibility | **Decorative** |
| `toolbar` | `composeToolbar` + `FloatingToolbar` | Live (see above) |
| `inspectorTabs` | `getVisibleInspectorTabs` / `getDefaultInspectorTab` → `PropertiesPanel` | Live |
| `statusSections` | `getVisibleStatusSections` → `StatusBar` (honors `order`) | Live |
| `canvasOverlays` | `useWorkspaceMode` overlay projection | Live |
| `defaultTool` | `useWorkspaceMode` | Live |
| `onboarding.description` | `WorkspaceCustomizeDialog` | Live |
| `onboarding.tips` | `workspaceTips` → `useDidYouKnow` | Live **as of this pass** — see below |
| `floatingToolbar` / `statusBar` / `tabStrip` | `Shell`, `FloatingToolbar` | Live |

**Workspace onboarding tips are now shown.** All seven workspaces declared
`onboarding.tips` (roughly 28 authored, workspace-specific hints) that nothing
read, while the Did-You-Know surface drew only from the global, workspace-blind
`TIPS` list. `onboard/DidYouKnow/workspaceTips.ts` adapts the declared tips into
the existing `Tip` shape and `useDidYouKnow` merges them ahead of the global
list, so they inherit the daily cap, idle trigger, dismissal, and "don't show
again" rather than gaining a second tip surface. A tip is eligible only while
its workspace is active, and switching workspaces discards a queue built for
the previous one. Ids are content-hashed (`workspace:<mode>:<hash>`) so that
reordering a workspace's tips does not reassign which tip a user dismissed.

`panels[].order` and `panels[].collapsed` were **removed** (2026-08-13, this
pass): both were persisted inside `panelOverrides` with no runtime consumer
(the two-sidebar `Shell` derives everything from visibility). Removal is
self-healing — the preference sanitizer drops unknown fields on load, so
stored payloads migrate without a version bump, and a dedicated
`workspaceStore.test.ts` case locks the contract. `getOrderedPanels` was
deleted with them. `preferredWidth` remains (Shell consumes it).

## Panel contract completion (2026-08-13)

Follow-up pass on the consumer audit, closing the remaining declared-vs-live
gaps:

- **`panels.history` now projects at runtime.** `panelVisibilityPatch` was
  missing `historyPanelVisible`, so the History panel was the one panel id with
  no switch-time projection: overrides for it were recorded but never applied
  by a workspace switch (invariant 9 violation). It is now in the projection
  and in the customize dialog's panel list. All seven built-ins declare it
  `visible: false`, so built-in layouts are unchanged; per-mode overrides now
  work.
- **The customize dialog covers the full surface.** The Toolbar Tools section
  now lists flyout-only tools (boolean operations, retouch/mask members, …)
  with their flyout membership, so hiding them is actually possible from the
  UI (the store supported it; the dialog did not). Status-section labels come
  from a single `STATUS_SECTION_LABELS` map instead of camelCase-split ids.
  Reset All now requires an explicit confirmation dialog — it discards every
  customization in all seven modes.
- **The status bar is section-honest.** Every renderable section
  (`toolName`, `cursorPos`, `layoutScore`, `unit`, `zoom`, `selectionInfo`,
  plus the already-gated `preflight`/`debt`/`shortcutTip`) is gated by its
  section id, so a user toggling a section in the customize dialog sees the
  status bar change. Three previously declared-but-unrendered sections now
  have renderers: `pageInfo` (active page name/position, print), `colorMode`
  (document working color config, print/photo), `imageInfo` (natural source
  pixel dimensions of the selected raster node, photo).
- **`restoreAllPanels` ("Show All Panels")** is a recovery command in the View
  menu and command palette: it reveals every panel the active workspace knows
  and records the choice as overrides, so the restored layout persists.
- **Dead code removed.** `saveCurrentWidths` / `restoreWorkspaceWidths` from
  `useWorkspacePanelWidths` were exported but never consumed — widths are
  written on switch and reset only. The hook no longer returns anything.
- **Schema hygiene:** motion declared `version: 2` while
  `WORKSPACE_CONFIG_VERSION` is 1; normalized to 1 and the switching test now
  asserts every built-in matches the constant.
- **The Resources panel is resizable.** `PanelWidthDragEdge` (mounted inside
  `ResourcesPanel`, no Shell changes) gives the library panel the same
  APG window-splitter resize surface the sidebars have — drag, arrow keys
  (+Shift coarse), Home/End, double-click reset — persisted per workspace
  mode through `panelWidths.library` and cleared on reset
  (`clearPanelWidths`). Codegen, Logo, and Timeline remain fixed-layout by
  design (their content is code/text and timeline-spanning).

## Switching

`requestWorkspaceSwitch(mode, options?)` on the editor context is the **only**
switch path. It guards re-entrancy with `workspaceSwitchInProgressRef`, is a
no-op when the target equals the current mode, resolves in-progress
interactions, applies the effective config, and announces the change.

Current interaction policy: node editing, crop, and an active mask preview are
resolved to the Select tool before the switch (`options.force` skips this).
This is deliberately conservative and is the main area still to develop — see
Limitations.

## Limitations

These are known gaps, not settled design:

- **Interaction resolution is coarse.** Text editing, IME composition, active
  drags with pointer capture, transform sessions, inline rename, open modals,
  motion playback, and in-flight export/inference are not individually
  classified into commit / cancel / pause / block / continue; several are
  simply reduced to "switch to Select". `requestWorkspaceSwitch` returns
  `Promise<boolean>` rather than a typed result that can express *blocked* or
  *failed* with a reason.
- **Panel overrides now support visibility, widths, inspector tabs, status
  sections, and toolbar tools.** The full override surface is wired:
  - `panelOverrides` — visibility per panel
  - `panelWidths` — per-workspace panel pixel widths, saved on switch
  - `inspectorTabOverrides` — visibility per inspector tab
  - `statusSectionOverrides` — visibility per status bar section
  - `toolbarToolOverrides` — visibility per toolbar tool, including
    flyout-only tools such as the boolean operations
  All are persisted and restored on workspace switch. A dedicated customization
  dialog (`WorkspaceCustomizeDialog`) provides a toggle UI accessible from
  View > Customize Workspace or the command palette.
  Width payloads are sanitized on load, and the immutable preference update is
  committed through `updateWorkspacePreferences` so resizing a panel actually
  notifies all workspace consumers. Toolbar visibility is applied by the shared
  `FloatingToolbar`; the effective configuration always keeps Select, Hand, and
  Zoom available as recovery/navigation tools.
  The customization dialog uses the same human-readable tool labels as the
  toolbar and disables those protected tools instead of allowing a misleading
  unchecked state.
- **`canvasOverlays.bleedGuides` and `layoutGrid` now have runtime consumers.**
  `bleedGuidesVisible` controls `PrintOverlays` rendering on the canvas.
  Both are projected from workspace config via `overlayPatch` and persisted
  in viewport settings.
- **Workspace customization is now complete for the supported surfaces.**
  Reset exists (`resetWorkspaceToDefault`, `resetAllWorkspacesToDefaults`),
  a "customized" dot indicator is shown on workspace tabs, and the
  `WorkspaceCustomizeDialog` provides panel, toolbar, inspector, and status
  section toggles with immediate application and persistence.
