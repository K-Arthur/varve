# Workspace System

Canonical contract for Varve's workspace modes. A workspace is a **versioned
view-and-workflow configuration over one document and one editor engine** —
Design, Print, Draw, Photo, Motion, and Email are the six task workspaces over
the same editor, not different editors. Logo is a Design workflow and Code is
a shared panel, not a workspace. The mode union,
per-mode configs, and labels live in `workspace/workspaceTypes.ts`
(`WorkspaceMode`, `WORKSPACE_CONFIGS`, `ALL_WORKSPACE_MODES`); the shortcut
registry (`workspaceDesign` … `workspaceEmail`) lives in
`shortcuts/ShortcutManager.ts`. The retired `logo` and `codegen` identifiers
remain at compatibility boundaries for old preference/layout payloads,
navigation links, plugin metadata, and the existing shortcut actions. They
resolve to Design (or reveal the shared Code panel) and are not members of the
runtime `WorkspaceMode` union. `codegen` audit categories/export targets and
the `logo` audit source remain their own typed concepts.

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
  + prefs[mode].{toolbarToolOrder,toolbarToolLocations,toolbarPinnedToolIds}
                                       toolbar ordering, existing flyout assignment, and overflow pins
  + prefs[mode].{inspectorTabOrder,inspectorTabPinnedOverrides,statusSectionOrder}
                                       inspector/status ordering and responsive tab pins
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

Dock restoration waits for durable preference hydration before recording an
attempt, so an older synchronous mirror cannot overwrite a newer recovery
revision. Each workspace tracks its own attempt. A prior pending mount counts
as a failed launch; after two interrupted restores, the app shows the built-in
layout before mounting the saved tree. The recovery surface can retry the
saved layout, restore the last layout that validated and mounted, or use the
built-in arrangement. Last-known-good promotion occurs only after tree
validation and confirmation that active panel hosts mounted. Unknown future
layout schemas are retained as opaque data until the user chooses a replacement.

localStorage alone is not sufficient: on Linux/WebKitGTK it has been observed
not surviving between app launches — the defect that made the welcome dialog
reappear every launch, fixed for onboarding the same way (see
`onboard/onboardingStore.ts`). Preferences are written to both; durable writes
are debounced (400 ms) and can be flushed explicitly.

Writes within each store are serialized after the debounce. Per-workspace
preferences and named layouts use monotonic logical revisions plus a stable
local writer identity for deterministic cross-window conflict ordering.
Desktop SQLite and web IndexedDB compare-and-set the durable app-setting value
in one transaction, retrying after a concurrent write and merging before
saving. Preference reset entries and named-layout deletion/reset tombstones
remain explicit versioned events, so stale data cannot resurrect cleared
state. Legacy preference timestamps and named-layout numeric deletion
timestamps are used only while migrating old, unstamped data. Writer identity
stays local metadata and is excluded from portable layout exports.

`hydrateWorkspacePreferencesFromPlatform` merges per-workspace revisions.
Changes made locally while hydration is in flight receive a revision above the
durable snapshot before merge, preventing a slower startup read from replacing
a fresh edit. Old preferences without revisions are resolved by their
`lastCustomized`/`clearedAt` event time once, then acquire revisions on their
next edit. A missing, empty, or corrupt payload leaves the local snapshot
untouched. Failed durable preference and named-layout writes are visible in
their respective customization dialogs, where a retry saves the current
session snapshot; editing remains available while a save is unavailable.

An unrecognized future dock-layout schema is not applied by an older build.
The preference sanitizer retains that raw dock payload as opaque data through
unrelated customization saves; installing a validated replacement or
explicitly resetting that workspace clears it. Portable named-layout exports
include only dock schemas this build can validate.

`hydrateLayoutStoreFromPlatform` merges named layouts by logical revision and
writer identity. Wall-clock `updatedAt` remains display metadata and is used
only to migrate layouts saved by older versions.

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
- Customized Logo and Codegen preference slots are converted to named
  `Recovered Logo Workspace` and `Recovered Code Workspace` layouts after both
  preference and layout stores hydrate. Stable migration ids make this
  idempotent; Design preferences are not rewritten. If the layout store has
  reached its 50-variant limit, the old preference is retained for recovery.
- `Ctrl+Shift+7` opens Design and reveals Logo Tools. `Ctrl+Alt+Shift+L`
  toggles that panel and also resolves to Design when invoked from another
  workspace. `Ctrl+Shift+8` reveals the shared Code panel in the current
  workspace; `Ctrl+Shift+J` toggles that same panel in the desktop app. The
  browser may reserve `Ctrl+Shift+J` for Developer Tools, so browser users can
  use `Ctrl+Shift+8` or View > Panels > Code Panel. On macOS, use Command+Shift
  for the numbered actions and Command+Option+Shift+L for the Logo toggle;
  Chrome uses Command+Shift+J for Downloads, so browser users should use
  Command+Shift+8 or the View menu. These are commands, not workspace
  switches; they never select a retired mode.

## Product taxonomy

| Workspace | Shortcut | Focus |
|---|---|---|
| Design | `Ctrl+Shift+1` | UI/UX, components, prototyping, Logo tools, developer handoff |
| Print | `Ctrl+Shift+2` | Multi-page layout, typography, preflight, colour management |
| Draw | `Ctrl+Shift+3` | Raster painting, vector freehand, brushes |
| Photo | `Ctrl+Shift+4` | Nondestructive photo editing and adjustments |
| Motion | `Ctrl+Shift+5` | Timeline animation and keyframes |
| Email | `Ctrl+Shift+6` | Email-specific structure, responsive preview, compatibility checks, and export |

The workspace switcher follows this same order and each tab resolves its
shortcut label from `workspaceShortcutLabel(mode)`. The switcher paints no
shortcut chip: the ordered 1–6 mapping reaches the user through each tab's
tooltip, `aria-keyshortcuts`, the `data-shortcut-key` carried on the radio, the
overflow menu's rows, and the View ▸ Workspace submenu. Dedicated workflow
actions follow the six mode keys: `Ctrl+Shift+7` shows Logo Tools in Design and
`Ctrl+Shift+8` shows the shared Code panel. `Ctrl+Alt+Shift+L` toggles Logo
Tools, routing to Design when opening from another workspace. In the desktop
app, `Ctrl+Shift+J` toggles the same shared Code panel. The legacy action ids
`workspaceLogo` and `workspaceCodegen` remain in the shortcut registry for
compatibility, but they are not workspace modes or radio items.
On macOS, the platform shortcut formatter displays Command+Shift with the same
numbers; browser conflicts for the panel toggles are documented in the user
shortcut reference.

`tests/e2e/editor/workspace-navigation-contracts.spec.ts` drives the six mode
keys and the two workflow actions in a real browser. The visual snapshots in
`tests/e2e/workspace/visual.spec.ts-snapshots/` pin the switcher order in light,
dark, and high-contrast themes.

The product taxonomy and shortcut-order decision is recorded in
[ADR-0239](../adr/0239-six-task-workspaces-and-ordered-shortcuts.md).

### Logo and Code panel defaults

The built-in Design arrangement keeps Logo Tools closed until a Logo command
or the user opens it. Design is its only default home: `Ctrl+Shift+7`, the
Logo workflow command, or View → Panels opens the same singleton Logo panel in
Design. Keeping the project brief, concepts, variants, vectorization,
typography, validation, and package export in that focused panel avoids adding
a permanent column to the general Design canvas. A saved Design arrangement
still controls its own panel visibility and location.
The panel toggle `Ctrl+Alt+Shift+L` uses the same workflow: opening it from
another workspace switches to Design first; macOS uses Command+Option+Shift+L.

The shared Code panel is closed in every built-in workspace. It has no owning
workspace: `Ctrl+Shift+8` opens it in the current workspace, where it follows
the current selection and that workspace's saved dock layout. Its Output,
Audit, and Readiness views keep code targets, preview width, copy/download,
and quality checks together. This gives developers a direct, cross-workspace
entry point without making the panel consume canvas area when it is unused.
These are closed-by-default choices, not limits on panel availability; users
can save either panel open in a named layout.

Logo-specific project data remains in `Document.logoProject`; invoking Logo
Tools or a Logo project/concept/variant command from another task first selects
Design and reveals the same registered Logo panel. If workspace switching is
blocked, the Logo command does not mutate the document. The toolbar, View menu,
command palette, and `Ctrl+Shift+7` expose this workflow without adding a Logo
radio item. Code export remains available
through the shared registered Code panel in the current workspace; the legacy
Codegen action and `Ctrl+Shift+8` reveal that same surface instead of selecting
a mode. The existing `Ctrl+Shift+J` Code Panel toggle also targets this single
panel in the desktop app; browsers may reserve that chord for Developer Tools,
so use `Ctrl+Shift+8` or View > Panels > Code Panel in the browser. On macOS,
use `Command+Shift+J` in the desktop app. Chrome uses that chord for Downloads
on macOS, so use `Command+Shift+8` or the View menu for Code in the browser.
Neither action replaces the user's
document, selection, history, or saved layout. The competitor failure evidence and concrete Logo/Code access
contract are recorded in
[`workspace-customization-research-2026-09-27.md`](../audits/workspace-customization-research-2026-09-27.md).

Email is kept separate because it has structured authored blocks, a dedicated
compiler, responsive preview, and email-specific compatibility checks. Entering
Email does not enable an email profile or convert the current document.

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
for display with `workspaceShortcutLabel(mode)`, never from a literal. An old
shortcut table once claimed Ctrl+Shift+D/P/R/I/M long after those keys were
reassigned to Repeat Duplicate, Present, Preview Mode, Invert Selection, and
Toggle Minimap, respectively.
The live mode assignments are now sequential (`Ctrl+Shift+1` through
`Ctrl+Shift+6`) in the same order as the switcher; Logo and Code use separate
action shortcuts. On macOS these use Command+Shift with the same numbers.

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

**Workspace onboarding tips are now shown.** All built-in workspaces (six
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
  and in the customize dialog's panel list. All built-ins declare it
  `visible: false`, so built-in layouts are unchanged; per-mode overrides now
  work.
- **The customize dialog covers the full surface.** The Toolbar Tools section
  now lists flyout-only tools (boolean operations, retouch/mask members, …)
  with their flyout membership, so hiding them is actually possible from the
  UI (the store supported it; the dialog did not). Status-section labels come
  from a single `STATUS_SECTION_LABELS` map instead of camelCase-split ids.
  Reset All now requires an explicit confirmation dialog — it discards every
  customization in all six workspaces.
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
  (`clearPanelWidths`). Layers, Inspector, Resources, Code, Logo Tools,
  Timeline, Email Preview, and Email Output now use the nested dock geometry.
  The historical Resources splitter still controls only its own width; the
  nested tree has its own accessible splitters.

## Named layout variants (2026-09-13)

A named layout is a saved **arrangement** of the surfaces the customize
dialog controls — nested dock intent, panel visibility/widths, inspector tabs,
status sections, toolbar tools, and editor chrome. It is deliberately not a
new workspace mode, editor route, or document format: applying one writes the
same per-mode preference overrides every other customization path writes, so
there is still exactly one resolver and one projection.

`workspace/layoutVariants.ts` owns the store:

- **Capture is sparse.** A payload stores only differences from the target
  mode's built-in defaults, so a layout saved before a new built-in tool
  shipped still reveals that tool when applied. Captured payloads are
  re-sanitized on read and apply. The version-4 payload also carries a
  validated nested dock layout when the workspace has one; older variants
  migrate into the same schema.
- **Persistent Apply replaces, and never switches mode.** Applying a saved
  layout to the active mode replaces that mode's arrangement (preferences are
  not merged with leftover overrides); `Default` is therefore a one-click
  mode reset and records a `clearedAt` event. The variant's `sourceMode` is
  informational. `Focus canvas` is the temporary exception described below.
  `applyWorkspaceLayout` on the editor context routes through
  `applyWorkspaceConfig`, so panel booleans, overlays, and the settings mirror
  stay in sync; `emitWorkspaceLayoutApplied` lets the resize hooks adopt the
  layout's panel widths (an omitted width intentionally falls back to the
  mode/global default).
- **Built-in templates are recovery vocabulary**: `Default` (empty payload —
  reset), `Every panel` (reveals every registered panel), and `Focus canvas`
  (enters temporary distraction-free mode and leaves saved visibility and
  chrome preferences untouched). Focus canvas exits through a viewport-pinned
  return control that remains reachable after a resize. The other built-ins
  apply persistent arrangements. Built-ins
  cannot be renamed, updated, or deleted; duplicating one creates an editable
  user variant.
- **Resets leave a snapshot.** `resetWorkspaceToDefault` /
  `resetAllWorkspacesToDefaults` capture the pre-reset preferences into
  `resetSnapshot` before discarding them. Manage Layouts offers Restore,
  which re-applies the snapshot with fresh event timestamps so it outranks
  the reset. This is layout recovery, separate from document undo and enabled
  even when no optional panel is open. Clearing a snapshot leaves a revisioned
  tombstone so a stale durable copy cannot restore it.
- **User variants** support save-current-as, update, rename, duplicate, and
  delete. Duplicate names are rejected, never silently overwritten. Deleting
  is confirmed and tombstoned.
- **Import/export is capability-only.** Export emits a versioned
  `varve-workspace-layout` document with a name, source mode, and sanitized
  payload — no variant ids, timestamps, machine geometry, paths, document
  pins, or identity. Dock trees are bounded, validate registered panel types,
  and strip unknown node fields. Import is bounded to 64 KiB of UTF-8,
  rejects future versions rather than relabelling them, assigns a fresh local
  id, drops unknown/removed ids, cannot hide essential recovery tools, and
  offers replace-or-duplicate on a name collision.
- **Persistence** uses `varve-workspace-layouts` in localStorage plus the
  `workspace-layouts` platform app-setting (SQLite on desktop / IndexedDB on
  web), debounced 400 ms. Durable writes are serialized and use atomic
  compare-and-set; on a conflict, the writer reloads, merges, and retries.
  Variants, deletion tombstones, reset snapshots, and reset clears use logical
  revisions with a local writer id for deterministic tie-breaking. Legacy
  wall-clock stamps migrate to revision stamps and schema migrations are
  persisted. Identity stays out of portable exports. Unknown future store
  versions stay untouched and surface a persistence message rather than being
  rewritten by this build.

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

- **One radiogroup, two tokens per mode.** The control is an APG radiogroup
  whose children are only radios; the overflow trigger and divider are
  siblings of the group. Every mode owns `--color-workspace-accent-<mode>`
  (the active pill, hosting `text-on-accent`) and
  `--color-workspace-icon-<mode>` (the inactive icon). Both are generated from
  the token ramps and are `AA` contrast pairs in `audit:tokens` for every
  theme: the pill pair because it is text, and the icon pair because the glyph
  is the only visual identifier of an inactive mode (its name lives in the
  tooltip and the accessible name). High Contrast defines all six workspaces as
  the single HC accent — hue is never a state cue there.
  In light theme both roles resolve to the same ramp step per mode (one hue,
  one step, two roles); the darker tint steps the icons used before measured
  3.23:1 for Design and 3.59:1 for Motion, i.e. barely over the 3:1 non-text
  floor. Dark and high contrast keep distinct steps per role.
  (`docs/audits/workspace-switcher-design-review-2026-09-29.md` F3)
- **The switcher paints no shortcut chip.** The ordered `Ctrl+Shift+1…6`
  mapping is carried by `data-shortcut-key` on each radio, by
  `aria-keyshortcuts`, by each tab's tooltip, by the rows of the overflow
  menu, by the View ▸ Workspace submenu and by the shortcut reference. A
  numbered chip was removed in 2026-09-29 because it duplicated those channels
  inside the same control, overhung its own box, and read as a notification
  counter on the active pill (F1).
- **The container tier follows the presentation tier.** At `>=900px` the
  switcher is a raised card (`--elevation-surface-raised`,
  `--color-border-subtle`, `--radius-floating`, a small shadow): that is what
  groups the segmented control inside a single-row menubar. At `<=899px` the
  container is flat — transparent background and border, no shadow — because
  the layout already groups it (a second row in portrait, the space behind the
  menu rail in landscape) and an identical raised card there reproduced the
  floating toolbar's surface a few rows above the real one. Only the container
  flattens: the active pill keeps its opaque accent fill (F2).
- **The active mode is always visible and named.**
  `computeWorkspaceLayout` evicts a lower-priority tab rather than the active
  one; the active pill keeps its name down to
  `WORKSPACE_ACTIVE_LABEL_MIN_WIDTH`, below which it compacts to its icon and
  the name stays in the tooltip/accessible name. No width query may collapse
  that name: the layout math reads *rendered* box widths, so a CSS-collapsed
  label is measured as zero for ever and the pill can never compact for the
  right reason. At 640×400 the name is present; at 360×740 the measurement
  genuinely does not fit and the pill compacts (F5).
- **Edges come from the shared radius API.** The bar is a floating surface
  (`--radius-floating`, like the toolbar) with `--radius-control-compact`
  members — not a pill container. Below 900px the surface treatment is dropped
  entirely (see "The container tier follows the presentation tier") while the
  radius tokens stay declared. The overflow divider uses the menubar family's
  single vertical group rule (see `docs/architecture/separator-system.md`).
- **Workspace labels come from `WORKSPACE_LABELS`.** The Code panel and Logo
  tools are shared/design surfaces and do not appear as workspace tabs.
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
  The selected mask-preview appearance (checkerboard, overlay, and related
  modes) is a presentation preference, not proof of an active preview; only
  actual background-removal or object-selection preview sessions are
  classified, and those sessions continue across workspace changes.
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
  - `toolbarToolOrder` and `toolbarToolLocations` — order and assignment to
    the main row or an already-declared flyout; protected Select, Hand, and
    Zoom tools remain in the main row
  - `toolbarPinnedToolIds` — tools to retain before responsive overflow
  - `inspectorTabOrder`, `inspectorTabPinnedOverrides`, and
    `statusSectionOrder` — ordering and responsive retention for inspector
    tabs and the status bar
  All are persisted and restored on workspace switch. A dedicated customization
  dialog (`WorkspaceCustomizeDialog`) provides visibility, ordering, flyout,
  pinning, and chrome controls accessible from View > Customize Workspace or
  the command palette. Reordering and membership changes have button/select
  controls, so dragging is not required.
  Width payloads are sanitized on load, and the immutable preference update is
  committed through `updateWorkspacePreferences` so resizing a panel actually
  notifies all workspace consumers. Toolbar visibility is applied by the shared
  `FloatingToolbar`; the effective configuration always keeps Select, Hand, and
  Zoom available as recovery/navigation tools.
  The customization dialog uses the same human-readable tool labels as the
  toolbar and disables those protected tools instead of allowing a misleading
  unchecked state.
  Named layout capture and portable export preserve these arrangement fields;
  import accepts only registered tools, tabs, sections, and existing flyout ids.
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
  variants do not move or resize detached windows. Their machine-local
  geometry stays in `panelWindowPlacement.ts`, separate from portable dock
  intent. Detaching hides the panel in the primary shell while leaving its
  dock-tree home intact; reattaching reveals it in that same location. A
  detached window is never automatically recreated after a crash.
- **The nested dock tree now positions the live shell panels.**
  `useEditorDockGeometry` resolves the primary-window tree into shell-relative
  pixel rectangles, enforces registered minimum sizes when the viewport can
  satisfy them, and collapses hidden panel branches in a render-only
  projection. Layers, Inspector, Timeline, Email Preview, Assets, Code, Logo,
  History, and Page Navigator use those rectangles when their corresponding
  panel is present in the saved tree. The built-in layout keeps Layers left,
  Inspector right, and places Motion Timeline below the canvas. Email Preview
  and Email Output share a bottom tab group with Preview selected by default.
  Below the desktop breakpoint, or when registered minimums cannot
  fit, the shell retains its drawer/fixed-slot projection without changing
  saved dock intent. Panel components remain mounted in their stable shell
  ownership locations; only their geometry changes.
- **Panel movement has keyboard, touch, and pointer paths.**
  Customize Workspace offers keyboard- and touch-operable controls to place
  visible panels left, right, above, or below a target, group them as tabs,
  order them before or after another tab, float a panel, group it with a float,
  redock a floating group, and reset its location. Floating groups can be
  dragged and resized inside the primary window; pointer changes preview live
  and commit once on pointer-up. Escape, blur, pointer-cancel, and lost capture
  discard an unfinished gesture. Float intent is stored as normalized bounds,
  never screen pixels, and dialogs remain above float controls. Docked
  singleton panels reserve a 32 CSS-pixel title row for the Move handle;
  tabbed panels use the reserved tab strip. Floating groups keep Move, Reset,
  Redock, and Resize in their title row, with panel content starting below
  that row and any tabs. No resize affordance covers panel content. Keyboard
  and touch alternatives remain in Customize Workspace. The native transfer
  round-trip remains outstanding.
  The disconnected multi-window layout, browser-fallback, and recovery model
  has been retired. The registry-aware tree in `workspace/dock/` is the only
  logical dock authority; native detached-window placement remains a separate
  machine-local store.

### Email output surface separation (2026-09-27)

Email authoring remains the initial Inspector tab. Email Preview and Email
Output are separate registered singleton panels. In the built-in Email layout,
Preview is the selected tab in the bottom dock group and Output is one click
away; this keeps authoring controls usable while preserving a dedicated place
for generated HTML, plain text, source mapping, authored source blocks,
preflight, and export. Older layouts that contain Email Preview but no Output
gain Output as a tab beside Preview when the runtime completes their tree.
Visibility, tabs, and movement share the registry-aware dock model and
per-workspace preferences. Preview sample values remain preview-only and do not
change generated export content.

### Dock-tree implementation checkpoint (2026-09-27)

The registry-aware nested model in `workspace/dock/` uses schema version 3
with exactly one protected canvas anchor in the primary window and bounded
in-window floating groups. Its minimum size preserves a 320 CSS-pixel canvas
width floor. Version-1 panel-only trees and version-2 canvas-anchor trees
migrate idempotently while retaining their panel instances. The model bounds
trees to 16 levels, 64 nodes, 32 panels, eight windows, and 16 float groups;
validates normalized geometry, unique panel/node identities, registered
singleton and host rules, and panel minimum sizes. `reorderTab`,
`movePanelToHost`, float, group, resize, and redock operations validate the
resulting layout before returning it. Workspace preferences and version-4
named variants persist the validated schema-3 dock tree. Portable bounds scale
with the primary window; document pins, screen coordinates, and unknown
machine fields are removed on import. These are pure-model and persistence
guarantees. The live editor now projects the tree's split geometry and float
overlays onto its shell panels through `useEditorDockGeometry`; the built-in mode layouts and
canvas-only snapshots are completed with the required Layers and Inspector
surfaces at runtime without overwriting saved user geometry. A browser test
checks panel/canvas ordering and minimum widths across all six modes, then
checks the narrow viewport fallback. Customize Workspace now exposes
non-drag Move To, Group, and tab-order actions for visible panels and stores
only validated results. The movement E2E verifies that moving Layers below
Inspector changes their live rectangles and writes the dock tree. The current
evidence set is recorded in `docs/screenshots/workspace-dock-layout/README.md`.
Each split has a 24 CSS-pixel pointer target and an ARIA separator. Dragging
previews panel movement and commits one preference update on pointer-up;
Escape, blur, pointer-cancel, and lost capture discard the preview. Arrow keys
adjust a split by two percentage points, and Home/End choose its permitted
extent. The focused geometry E2E exercises keyboard and real pointer input,
Escape cancellation, and captures the resized workspace. Floating panel groups
are now draggable, resizable, resettable, and redockable, including keyboard
arrow movement and resize. Direct dock-panel movement has a targeted
real-pointer case that previews and cancels a move before committing Layers
below Inspector and capturing the resulting workspace. Its run and screenshot
review are pending the shared Playwright lease; native transfer round-trip
verification remains pending.
The float controls and resized group are visually recorded in
`docs/screenshots/workspace-dock-layout/float-controls-light.png`; the
single-worker Chromium E2E verifies create, drag preview, resize, keyboard
movement, reset, portable persistence, compact-width projection, and redock.
Dock title rows are included in registered minimum geometry. Chromium checks
that Inspector's Collapse control remains clickable beside the dock Move
handle, and that resizing a float changes its dimensions without moving it.

Visual revalidation found that the desktop compact-fallback CSS still tested
for absolute positioning on `.editor-canvas`, while the dock renderer now
places that geometry on `.editor-shell__canvas-dock`. The stale selector
classified valid desktop layouts as drawer fallback and hid the default side
panels. It now checks the wrapper that owns the dock geometry; the six-mode
geometry browser test confirms Layers and Inspector remain beside the canvas.
