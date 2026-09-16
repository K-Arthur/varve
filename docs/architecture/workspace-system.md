# Workspace System

Canonical contract for Varve's workspace modes. A workspace is a **versioned
view-and-workflow configuration over one document and one editor engine** —
Design, Print, Draw, Photo, Motion, Logo, Email, and Codegen &amp; Audit are all
the same editor with different chrome, not different editors. The mode union,
per-mode configs, and labels live in `workspace/workspaceTypes.ts`
(`WorkspaceMode`, `WORKSPACE_CONFIGS`, `ALL_WORKSPACE_MODES`); the shortcut
registry (`workspaceDesign` … `workspaceCodegen`) lives in
`shortcuts/ShortcutManager.ts`.

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

The responsive drawers and the panel-launcher FABs are deliberately **not**
gated by `statusBar`/`tabStrip`/`floatingToolbar` chrome preferences: a
workspace that hides the status bar still needs a way to open a hidden panel,
and a hidden panel is never the only route to the feature behind it.

Panel width persistence separates the user's **desired** width from the
**displayed** width. Only the desired value (panel min/max clamped) is
persisted; the displayed value additionally yields to `CANVAS_MIN_WIDTH`.
Opening a narrow window therefore cannot permanently overwrite the desktop
arrangement, and the saved value returns at the next wide viewport.


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
  + prefs[mode].toolbarToolOverrides   sparse toolbar visibility overrides
  + prefs[mode].chromeOverrides        floating-toolbar / status-bar / tab-strip visibility
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

Panel layout and toolbar visibility accept user overrides. Fields without an
override surface still resolve through the same path so that adding one later
takes effect everywhere at once.

### Applying a config

`applyWorkspaceConfig` in `context/useWorkspaceMode.ts` is the single projection
from config onto runtime state — panels, canvas overlays, the resolved active
tool, and the `settings.panel` mirror. Switch, `__setWorkspaceModeUnsafe`, and
reset all route through it. The active-tool resolver preserves a visible
selectable tool, otherwise chooses the destination default, then Select, and
finally the first selectable toolbar member. Command-only flyout actions can
never become the active tool. Normal workspace switching still runs the
editor's interaction-resolution cleanup before this projection, so crop/mask
preview and other transient states do not leave orphaned overlays.

## Persistence

| What | Where | Durability |
|---|---|---|
| Per-workspace panel overrides | `varve-workspace-preferences` (localStorage) | session mirror, read synchronously during render |
| Same, durable copy | platform app-setting `workspace-preferences` | SQLite (desktop) / IndexedDB (web) |
| Named layout variants + reset snapshot | `varve-workspace-layouts` (localStorage) | session mirror, read synchronously |
| Same, durable copy | platform app-setting `workspace-layouts` | SQLite (desktop) / IndexedDB (web) |
| Global panel mirror | `settings.panel` (`varve-editor-settings`) | legacy; seeds boot for users with no overrides yet |

localStorage alone is not sufficient: on Linux/WebKitGTK it has been observed
not surviving between app launches — the defect that made the welcome dialog
reappear every launch, fixed for onboarding the same way (see
`onboard/onboardingStore.ts`). Preferences are written to both; durable writes
are debounced (400 ms) and can be flushed explicitly.

`hydrateWorkspacePreferencesFromPlatform` runs once at startup and merges
**per mode by event time** (`lastCustomized` or `clearedAt`). Both stores are
legitimate sources — localStorage can be wiped while platform storage
survives, and platform storage can lag a write that has not flushed or came
from another window. A reset is a decision: it beats an older customization,
and a customization made after a reset beats the reset. When neither copy
carries an event, an uncustomized entry never displaces a customized one, so
durability can never itself lose a customization. A missing, empty, or corrupt
payload leaves the local snapshot untouched.

`hydrateLayoutStoreFromPlatform` follows the same pattern for named layouts,
merging by variant `updatedAt` and deletion tombstone time.

### Recovery and migration

- Legacy `strata-workspace-preferences` is read as a fallback key.
- Both stores share one `sanitizePreferences` pass: unknown panel ids and
  wrong-typed fields are dropped, unknown modes are ignored, missing modes fall
  back to defaults. That last rule is also what keeps a payload written by a
  newer build readable after a downgrade.
- Toolbar overrides use the same defensive path: unknown, removed, and
  wrong-typed tool ids are ignored; essential recovery tools cannot be hidden;
  and overrides equal to the current built-in default are removed. Sparse
  storage lets a newly added tool enter an existing workspace when its updated
  built-in default includes it, while an explicit choice for a known tool
  remains meaningful.
- Persistence failures are recorded (`getWorkspacePersistenceError()`) rather
  than swallowed, so a user whose customizations silently stopped saving has
  something to report. Failures never interrupt editing.
- Boot migrates a pre-upgrade `settings.panel` value into the mode's overrides
  once, but only where it *disagrees* with the built-in default — equality
  carries no information about what the user chose, and seeding on it would
  mark every fresh install as customized.

## Tool identity, visibility, and availability

`packages/editor/src/tools/toolRegistry.ts` is the canonical runtime registry
for tool identity metadata: stable id, label, icon, category, activation kind,
shortcut relationship, aliases, and essential recovery status. `ToolId` is
derived from that registry. `workspaceTypes.ts` owns only workspace
presentation — toolbar order, group boundaries, flyouts, and default tool —
and `workspaceStore.ts` resolves sparse user visibility overrides into the
effective config. A new toolbar tool therefore needs one registry entry and a
workspace composition entry; labels, icons, shortcut labels, customization
search, and toolbar rendering do not require parallel catalogs.

Visibility and runtime availability are deliberately different:

| State | Meaning | Toolbar consequence |
|---|---|---|
| Visible | The effective workspace toolbar presents the tool, directly or in a flyout. | Render it in its configured position. |
| Hidden by default | The workspace does not emphasize it. | Omit it from the toolbar; keep capability access elsewhere. |
| User-hidden | A sparse override explicitly removes it from this workspace. | Omit it from the main row and flyouts; remove empty flyouts. |
| Context-disabled | The tool exists but the current selection/document cannot use it. | Keep discovery, disable with the existing reason/explanation. |
| Unsupported | The runtime/platform/model cannot provide it. | Keep the appropriate surface honest; do not disguise a capability failure as workspace filtering. |
| Available elsewhere | A hidden toolbar tool is still a command, menu action, shortcut, or contextual action. | Preserve the recovery/discovery route. |

`getVisibleToolbarToolIds`, `isToolVisibleInWorkspace`, and
`getHiddenTools` answer presentation questions from the effective config;
they include flyout members. Context predicates remain separate from this
layer. `ToolKind` also distinguishes selectable tools from immediate commands
such as boolean operations, preventing a command-only flyout member from being
installed as `state.tool`.

The shortcut policy is intentionally visual-only: a toolbar-hidden tool's
shortcut remains active for expert users. Proactive shortcut tips use the
effective config and suppress hidden-tool recommendations. The command palette
and Quick Actions remain broader discovery surfaces and annotate a matching
tool action as **Hidden from toolbar** rather than silently deleting it.
Context menus and object/image/vector menus remain selection/capability-aware;
they do not disappear merely because the current workspace toolbar is focused
on a different workflow.

### Adding a tool

1. Add one stable id and its metadata to `tools/toolRegistry.ts`.
2. Register its activation action/implementation and add it to the deliberate
   workspace composition(s) in `workspaceTypes.ts`.
3. Add focused tests for the tool, its availability/context rules, and any
   flyout composition. Registry completeness tests catch missing labels/icons
   and built-in references.

Do not add a second all-tools array, label map, icon map, shortcut-label map,
or workspace visibility map. If the new entry is a command rather than a
selectable mode, set `kind: 'command'`; it may live in a flyout but must not
become the active tool.

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
`shortcuts.disabled` list was empty in every built-in and suppressed
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
| `panels[].order` | removed 2026-08-13 (was decorative — see below) | — |
| `panels[].collapsed` | removed 2026-08-13 (was decorative — see below) | — |
| `toolbar` | `composeToolbar` + `FloatingToolbar` | Live (see above) |
| `inspectorTabs` | `getVisibleInspectorTabs` / `getDefaultInspectorTab` → `PropertiesPanel` | Live |
| `statusSections` | `getVisibleStatusSections` → `StatusBar` (honors `order`) | Live |
| `canvasOverlays` | `useWorkspaceMode` overlay projection | Live |
| `defaultTool` | `useWorkspaceMode` | Live |
| `onboarding.description` | `WorkspaceCustomizeDialog` | Live |
| `onboarding.tips` | `workspaceTips` → `useDidYouKnow` | Live **as of this pass** — see below |
| `floatingToolbar` / `statusBar` / `tabStrip` | `Shell`, `FloatingToolbar` | Live |

**Workspace onboarding tips are now shown.** All built-in workspaces (eight
as of 2026-08) declare
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
  and in the customize dialog's panel list. All built-ins (eight as of
  2026-08) declare it
  `visible: false`, so built-in layouts are unchanged; per-mode overrides now
  work.
- **The customize dialog covers the full surface.** The Toolbar Tools section
  now lists flyout-only tools (boolean operations, retouch/mask members, …)
  with their flyout membership, so hiding them is actually possible from the
  UI (the store supported it; the dialog did not). Status-section labels come
  from a single `STATUS_SECTION_LABELS` map instead of camelCase-split ids.
  Reset All now requires an explicit confirmation dialog — it discards every
  customization in all eight modes.
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

## Named layout variants (2026-09-13)

A named layout is a saved **arrangement** of the surfaces the customize
dialog already controls — panel visibility/widths, inspector tabs, status
sections, toolbar tools, and editor chrome. It is deliberately not a new
workspace mode, editor route, or document format: applying one writes the
same per-mode preference overrides every other customization path writes, so
there is still exactly one resolver and one projection.

`workspace/layoutVariants.ts` owns the store:

- **Capture is sparse.** A payload stores only differences from the target
  mode's built-in defaults, so a layout saved before a new built-in tool
  shipped still reveals that tool when applied. Captured payloads are
  re-sanitized on read and apply.
- **Apply replaces, and never switches mode.** Applying a variant to the
  active mode replaces that mode's arrangement (preferences are not merged
  with leftover overrides); `Default` is therefore a one-click mode reset and
  records a `clearedAt` event. The variant's `sourceMode` is informational.
  `applyWorkspaceLayout` on the editor context routes through
  `applyWorkspaceConfig`, so panel booleans, overlays, and the settings mirror
  stay in sync; `emitWorkspaceLayoutApplied` lets the resize hooks adopt the
  layout's panel widths (an omitted width intentionally falls back to the
  mode/global default).
- **Built-in templates are recovery vocabulary**: `Default` (empty payload —
  reset), `Every panel` (reveals every registered panel), and `Focus canvas`
  (hides every panel plus the status bar and tab strip, keeping the floating
  toolbar). Built-ins cannot be renamed, updated, or deleted; duplicating one
  creates an editable user variant.
- **Resets leave a snapshot.** `resetWorkspaceToDefault` /
  `resetAllWorkspacesToDefaults` capture the pre-reset preferences into
  `resetSnapshot` before discarding them. Manage Layouts offers Restore,
  which re-applies the snapshot with fresh event timestamps so it outranks
  the reset. This is layout recovery, separate from document undo and enabled
  even when no optional panel is open.
- **User variants** support save-current-as, update, rename, duplicate, and
  delete. Duplicate names are rejected, never silently overwritten. Deleting
  is confirmed and tombstoned.
- **Import/export is capability-only.** Export emits a versioned
  `varve-workspace-layout` document with a name, source mode, and sanitized
  payload — no ids, timestamps, machine geometry, paths, or identity. Import
  is bounded (64 KiB), rejects future versions rather than relabelling them,
  assigns a fresh local id, drops unknown/removed ids, cannot hide essential
  recovery tools, and offers replace-or-duplicate on a name collision.
- **Persistence** uses `varve-workspace-layouts` in localStorage plus the
  `workspace-layouts` platform app-setting (SQLite on desktop / IndexedDB on
  web), debounced 400 ms. Merge is by variant `updatedAt` with deletion
  tombstones, so a stale durable copy can never resurrect a deleted variant,
  and hydration never overwrites local edits.

Entry points: **View ▸ Manage Layouts…** and the command palette
(`manageWorkspaceLayouts`); the native menu defs carry the
same id. `WorkspaceCustomizeDialog` exposes the chrome toggles a layout can
capture under **Editor Chrome**.

## Switching


`requestWorkspaceSwitch(mode, options?)` on the editor context is the **only**
switch path. It guards re-entrancy with `workspaceSwitchInProgressRef`, is a
no-op when the target equals the current mode, resolves in-progress
interactions, applies the effective config, and announces the change.

Current interaction policy: `workspace/interactionResolution.ts` classifies
in-progress interactions before the projection runs and returns a typed plan
(commit / cancel / pause / continue / block). Node editing, crop, and mask
previews resolve to Select; a focused text field or active control is
committed with a blur so hiding a panel cannot discard a draft; timeline
playback continues because the motion system is not remounted; an active IME
composition or an open modal blocks the switch with an announced reason, and
`options.force` skips resolution entirely. Layout application runs the same
resolver (ignoring the modal that initiated it) before replacing the
arrangement. The public return remains `Promise<boolean>`; the typed plan is
what the hook executes, and a blocked transition announces why.

### Switcher surface (`WorkspaceTabs`)

The switcher in the menubar is the primary pointer surface for
`requestWorkspaceSwitch`; it owns no state beyond layout and focus. Its
contract (review: `docs/audits/workspace-switcher-review-2026-09-15.md`):

- **One radiogroup, one accent.** The control is an APG radiogroup whose
  children are only radios; the overflow trigger and divider are siblings of
  the group. Color comes from the shared semantic tokens — the active mode is
  a `--color-interactive-default` pill with `--color-text-on-accent`, inactive
  modes are `--color-text-secondary` icons. Mode identity is the icon shape,
  never a hue: per-mode colors bypassed `audit:tokens` and failed rendered
  contrast checks.
- **The active mode is always visible and named.** `computeWorkspaceLayout`
  evicts a lower-priority tab rather than the active one; the active pill
  keeps its label down to `WORKSPACE_ACTIVE_LABEL_MIN_WIDTH`, below which it
  compacts to its icon and the name stays in the tooltip/accessible name.
- **Labels come from `WORKSPACE_LABELS` and must equal the command label.**
  The ShortcutManager label (`Workspace: Codegen`), the View menu item, and
  the switcher must use the same words; a panel may title itself more
  descriptively (the Code panel reads "Codegen & Audit").
- **The overflow math measures; it never assumes.** Tab widths are read from
  rendered boxes and the inter-tab gap is read from the resolved `column-gap`,
  so a spacing-token change flows into the calculation. `tabWidths` never
  include the gap. Every mode is reachable from the visible strip or the
  overflow menu at every width.
- **Focus contract.** Pointer activation never moves focus; keyboard
  activation moves the roving focus to the activated radio; activating from
  the overflow menu focuses the newly visible tab, and dismissal without a
  selection returns focus to the trigger. A relayout that pushes the focused
  tab into overflow moves focus to the active tab.
- **Text enlargement.** The bar and its items use `min-height`, and the bar is
  observed alongside the flex wrapper, so a user font-size preference grows
  the chrome and re-runs the overflow math instead of clipping text or
  leaving stale measurements.
- **Hover is CSS-only.** A slight in-place scale on the pointed icon, disabled
  under `prefers-reduced-motion`. Hit targets never move or resize — the
  macOS-Dock-style fisheye spring that wrote icon dimensions every frame was
  removed: fisheye magnification anchored to the cursor has no motor-space
  benefit and is associated with hunting/distraction (Zhai et al., CHI 2005;
  Cockburn & Firth, *Improving the Acquisition of Small Targets*).

## Limitations

These are known gaps, not settled design:

- **Interaction resolution is typed but bounded.** `interactionResolution.ts`
  classifies text drafts, IME composition, active controls, transient tools,
  playback, and modals. A modal is any open native dialog, which covers the
  export, upscale, and generative-edit dialogs; background inference without
  a modal has no cancellable UI and is deliberately `continue` because a
  workspace change never unmounts the AI or motion stores. Canvas pointer
  capture held by an arbitrary overlay is still not individually inspectable.
  `requestWorkspaceSwitch` still returns `Promise<boolean>`; the typed plan is
  executed internally and a blocked transition announces its reason.
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
- **Workspace customization is complete for the supported surfaces.**
  Reset exists (`resetWorkspaceToDefault`, `resetAllWorkspacesToDefaults`),
  a "customized" dot indicator is shown on workspace tabs, and the
  `WorkspaceCustomizeDialog` provides panel, toolbar, inspector, status
  section, and editor-chrome toggles with immediate application and
  persistence. Named layout variants (`layoutVariants.ts`, Manage Layouts)
  extend the same override surface with save/apply/import/export and a
  pre-reset recovery snapshot.
- **Detached panel windows are desktop-only and deliberately narrow.**
  Layers, Inspector, Assets, Code, and Logo can move to auxiliary windows;
  Timeline, Page Navigator, and History cannot. The single-window layout
  variants do not move or resize those windows — device placement stays in
  the panel-placement store, and the multi-window logical-layout path
  (`layoutPersistence.ts`, `dockOps.ts`) remains unwired pending the
  multi-window milestone. Its recovery snapshot and safe-mode generators are
  sound and tested, but no runtime surface applies them yet.
- **Panel move/reorder within the shell is not offered.** The shell's fixed
  grid defines the permitted regions per panel; customization covers
  visibility, width, tabs/sections, and chrome instead of arbitrary docking.
  A full dock tree is explicitly not a prerequisite for the supported
  customization surface.
