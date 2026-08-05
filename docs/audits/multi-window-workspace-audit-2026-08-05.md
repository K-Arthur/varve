# Multi-window workspace audit — 2026-08-05

Evidence-backed current-state report for the Detachable UI Panels and Native
Multi-Monitor Workspace program. All findings reference the repository at
commit `60e4b56e` (branch `feat/workspace-windows`).

## 1. Scope and method

Read-only audit of the editor shell, workspace-mode system, panel inventory,
editor state and command architecture, platform abstraction, Tauri desktop
app, rendering surface, and test stack. Every claim is backed by a
file:line reference. No behavior was changed by this audit.

## 2. Repository map

| Layer | Location | Status |
|---|---|---|
| Editor shell | `packages/editor/src/Shell.tsx` (1046 lines, 49 imports — at ceiling) | Single-window only |
| Editor state | `packages/editor/src/context.tsx` (8736 lines) + `context/` hooks | One provider, one `useState<EditorState>` |
| Canvas | `packages/editor/src/CanvasArea.tsx` (3290 lines, 82 imports — over budget) | Single canvas, document-global |
| Workspace modes | `packages/editor/src/workspace/workspaceTypes.ts` (1276 lines) | 7 modes, mode != layout |
| Platform abstraction | `packages/platform/src/platform.ts` (324 lines) + `tauri.ts` / `web.ts` / `memory.ts` | No window API exists |
| Desktop app | `apps/desktop/` (Tauri 2.11.3, wry 0.55.1, `@tauri-apps/api` 2.11.1) | One `main` window, `decorations: false` |
| Document model | `packages/scene/src/document.ts` (flat node map, structural sharing) | Schema version 2.15 |
| Web app | `apps/web/` | Stub only (browser build = `apps/desktop` under Vite) |

## 3. Editor shell findings

### 3.1 Layout regions (Shell.tsx)

CSS grid with areas `menubar tabs layers canvas inspector timeline pagenav
selinfo status logoarea` (`editor.css:111-146`). Panels mount in Shell:

| Surface | Component | Shell.tsx | Hidden behavior |
|---|---|---|---|
| Layers | `LayersPanel` + `PresenceIndicator`/`MinimapPanel`/`MasterPanel`/`SpreadSettings` | 372-394 | **Stays mounted** (CSS zero-width + `inert`) |
| Inspector | `PropertiesPanel` + `PanelResizeHandle` | 395-412 | **Stays mounted** (same) |
| Library | `ResourcesPanel` | 413-421 | Unmounts when hidden |
| Codegen | `CodePanel` | 422-426 | Unmounts when hidden |
| Logo | `LogoPanel` | 427-433 | Unmounts when hidden (logo mode only) |
| Timeline | `TimelinePanel` (30+ callback props) | 434-535 | Unmounts when hidden |
| PageNav | inline | 367-371 | Unmounts when hidden |
| Dialog/overlay layer | Settings, Export, FindReplace, IconBrowser, Prompt, Recovery, ContextualHelp, HelpBrowser, ContextMenu, ShortcutPalette, QuickActionsBar, OnboardingLayer, PrototypePresenter, StateMachinePanel | 587-999 | All inline in Shell |

Overlays/dialogs are **inline in the Shell tree**: `<dialog>` via `@varve/ui`
`Dialog` (promoted to top layer by `showModal()`), toast host inline
(`ToastProvider.tsx:53`), tooltips portal to `document.body`
(`Tooltip.tsx:513,551,565`), menus/selects via `FloatingPortal` →
`document.body` (`FloatingPortal.tsx:152-157`). There is no central modal
root, no single toast host element, no single tooltip host.

### 3.2 Single-window assumptions (evidence)

- `document.querySelector('.editor-canvas')` — `context.tsx:3527,3541`,
  `context/viewportOps.ts:59-67`, `canvas/cameraState.ts:88-93`,
  `DnDShell.tsx:69-70`, `canvas/inputPipeline.ts:593`.
- `document.querySelector('#file-open-input'|'#file-import-input')` —
  `Menubar.tsx:1869,1872` reaches into Shell-rendered siblings.
- `document.querySelector('.editor__layers-panel'|'.editor__inspector-panel')`
  — `PanelResizeHandle.tsx:122-127` (panel width measurement).
- `window.innerWidth/innerHeight` — 14+ sites in `context.tsx` (viewport
  fallbacks), `PanelResizeHandle.tsx:62,83`, `Shell.tsx:360`,
  `ViewportContext.tsx:201,256`, `MinimapPanel.tsx:115`, and more.
- Global listeners installed per window: `window keydown`
  (`shortcuts/useShortcuts.ts:194`), `paste` (`Shell.tsx:148`),
  `beforeunload`/`visibilitychange`/`pagehide`
  (`RecoveryManager.tsx:91-93`), `error`/`unhandledrejection`/
  `webglcontextlost` (`crash/crashController.ts:273-276`),
  `hashchange`/`popstate` (`deepLinkHandler.ts:180-181`), `storage`
  (`useRecentFiles.ts:17`, `onboardingStore.ts:132`).
- Shortcut registration re-runs on every editor state change
  (`Shell.tsx:228-272`) with the load-bearing `registerEditorActions` BEFORE
  `registerAllShortcuts` order (AGENTS.md; `actions/registerAll.ts:18-33,35-223`).

### 3.3 Panel state ownership

- Visibility: `EditorState` booleans (`context/types.ts:188-216`), patched on
  workspace switch (`context/useWorkspaceMode.ts:58-67`), persisted only for
  left/right/logo (`useWorkspaceMode.ts:72-78`); library/codegen/timeline
  visibility is **transient** (reset each session).
- Widths: `usePanelWidths` local state (`PanelResizeHandle.tsx:55-104`),
  persisted in `settings.panel.leftPanelWidth/rightPanelWidth` (number|null),
  emitted as CSS vars `--sidebar-width`/`--inspector-width`.
- Panel-local UI state is held inside components (LayersPanel filter,
  LayersTree expanded-set, PropertiesPanel tab, ResourcesPanel activeTab,
  TimelinePanel zoom) and is lost on unmount.

## 4. Workspace-mode findings

- `WorkspaceMode` lives in `@varve/shared` (`auditTypes.ts:83-90`):
  design/drawing/image/print/motion/codegen/logo. Re-exported in
  `workspaceTypes.ts:34` — do not redeclare.
- `PanelId` union (`workspaceTypes.ts:40-47`): layers, inspector, timeline,
  pagenav, library, codegen, logo. **7 ids, exhaustive for the current shell.**
- Mode config (`WorkspaceConfig`, `workspaceTypes.ts:207-234`) carries
  panels/toolbar/inspectorTabs/statusSections/canvasOverlays/shortcuts/
  performance/onboarding. Runtime consumers are a subset (see audit §4);
  `PanelConfig.order`, `.collapsed`, `.preferredWidth`, `ToolbarConfig.tools`,
  `CanvasOverlayConfig`, `ShortcutLayer.extra`, `PerformanceConfig` are
  **declared but not consumed**.
- Persistence is split:
  - `workspaceStore.ts` (`varve-workspace-preferences`) — per-mode
    `WorkspacePreference.panelOverrides`. **Zero runtime consumers** — a
    designed-but-dead schema, free to repurpose.
  - `settings.ts` (`varve-editor-settings`) — the live store; `panel`
    section is **global, not per-mode**.
  - `workspaceMode` itself is never persisted; boot is always `'design'`
    (`context.tsx:2129`).
- Dead code to avoid trusting: `workspace/useWorkspace.ts`,
  `WorkspaceSwitcher.tsx`, `workspace/index.ts` barrel,
  `WORKSPACE_SHORTCUTS` letter bindings (live registry is numeric,
  `workspaceShortcutLabel.ts`).
- No geometry/monitor/window-placement code exists anywhere in
  `packages/editor`. The `multiWindow` platform capability flag
  (`runtime.ts:220`, `menu/capabilities.ts:61`) has **no implementation**.

## 5. Editor state and command findings

- One `EditorProvider` (`context.tsx:2019`) with one `useState<EditorState>`;
  the entire mutation surface funnels through `patch()` (`context.tsx:2436`)
  and `updateDoc(fn)` (`context.tsx:2488-2516`, functional updater, pushes a
  full-document snapshot onto the undo stack, cap 50).
- `stateRef` (`context.tsx:2213`) is the synchronous mirror — the codebase's
  established escape from React batching; reuse as the cross-window sync
  precedent.
- Multi-document: `EditorState.sessions` + `activeId`
  (`context/types.ts:159-160`); full per-session snapshots (document,
  selection, viewport, **undo/redo stacks**) in `sessionStoreRef`
  (`context.tsx:2233`, snapshots at 1661-1685); `newTab`/`switchTab`/
  `openFile`/`closeTab` at 7122-7223, 7225-7310, 8258-8310. Only ONE
  document is live in state at a time.
- Undo: state-snapshot based, **one active stack per session**, swapped
  wholesale on tab switch. Not command-based; a detached panel's edit must
  reach `updateDoc` of the canonical provider.
- `state.revision` (`context/types.ts:339`) is **dead** — initialized 0,
  never incremented. The session protocol needs its own revision counter.
- Command layer: `ActionRegistry` singleton (`actions/ActionRegistry.ts`),
  real handlers from `createActionHandlers` (`actions/createActionHandlers.ts`),
  registered per render in Shell; shortcut dispatch through one window
  keydown listener (`useShortcuts.ts:194`). Commands are a UI facade over
  context methods — there is no serializable command bus.
- Save: `usePersistence.ts` → `Platform` facade; autosave (`autoSaveService.ts`)
  and backup (`backupService.ts`) are per-provider singletons.
- No event bus; module-scope function-pointer bridges exist
  (`context.tsx:23-67`) — the only cross-module notification pattern today.
- Collaboration (`@varve/collab`) is a stub: no connection, no CRDT, no
  presence wire-up (`packages/collab/src/index.ts:79-86`).

## 6. Platform findings

- `Platform` interface (`platform.ts:39-289`) has **no window, monitor, or
  geometry API**. Tauri implementation uses `window.__TAURI__` globals
  (`core()`/`event.listen`), not `@tauri-apps/api` imports; unsubscription
  returns `() => void`.
- `runtime.ts` capabilities include the unused `multiWindow` flag
  (`runtime.ts:220`); `windowChrome.ts` is a pure strategy model.
- Tauri app: single window `"main"` (1280x800, min 900x600,
  `decorations: false`, `shadow: true`, `dragDropEnabled: true`), declared in
  `tauri.conf.json`; capabilities `capabilities/default.json` scoped to
  `["main"]` with only `core:window:allow-start-dragging/close/minimize/
  toggle-maximize` — **no create/monitor/geometry permissions**.
- `@tauri-apps/api/window` 2.11.1 exposes `WebviewWindow`, `getAllWindows`,
  `availableMonitors`, `primaryMonitor`, `currentMonitor`,
  `monitorFromPoint`, `LogicalPosition/Size`, `Window.setPosition/setSize/
  setFocus/show/hide/close/destroy`. The app already uses
  `apps/desktop/src/chrome/useWindowChrome.ts` (dynamic import) and
  `windowActions.ts` (`window.__TAURI__.window.getCurrentWindow()`).
- WDIO native testing exists (`wdio.conf.ts`, `tests/wdio/*.e2e.ts`,
  `tauri.test.conf.json`, `wdio` Cargo feature + capability).
- Pre-existing desktop gap (not caused by this program, documented for the
  record): ~58 `home_*` commands invoked by `tauri.ts` have no Rust handler
  (drafts/folders/collections/workspaces/libraries/templates/assets/
  branches/permissions/activity/tags/saved-searches/recent-files).

## 7. Rendering and performance surface

- Canvas renderer initializes in the editor window: worker renderer, WASM IR
  path, `SubtreeReplayCache`, ONNX model manager, font loading, thumbnail
  queues. All are **per-window** today; a panel-only window must not
  initialize them (ADR-0127).
- `replaySubtreeToCtx` in `CanvasArea.tsx` is the per-node-per-frame hot path;
  the perf harness under `docs/quality/` must be used for any replay change
  (AGENTS.md).

## 8. Test stack

- Vitest 2.1 + RTL, jsdom for editor tests; `fast-check` 4.9 available for
  property tests (root devDeps).
- Playwright E2E for the web target (`tests/e2e/`), axe via
  `@axe-core/playwright`.
- WDIO/Tauri service drives the real debug binary (`test:desktop:native`).
- Multi-window capabilities: WDIO can drive multiple Tauri windows by label
  (addressed via webview commands); no existing test exercises window
  creation, monitors, or geometry.

## 9. Panel inventory

| Panel | Owner component | Singleton | Multi-instance | Document-dependent | Selection-dependent | Canvas-dependent | Detachable candidate | Notes |
|---|---|---|---|---|---|---|---|---|
| Layers | `LayersPanel` (Shell 372) | yes | no | yes | yes | no | **Yes (priority 1)** | Hidden = stays mounted; local state (filter, expansion) |
| Inspector | `PropertiesPanel` (Shell 395) | yes | no | yes | yes | no | **Yes (priority 1)** | Tab state local; tabs from mode config |
| Variables | inside Inspector (adjustments/appearance sections) | yes | no | yes | yes | no | **Via Inspector** | Not a standalone surface today |
| Assets | `ResourcesPanel` (Shell 413) | yes | no | yes (assets are document-level) | no | no | **Yes (priority 2)** | activeTab local state |
| Timeline | `TimelinePanel` (Shell 434) | yes | no | yes | yes | no | **Yes (priority 2)** | 30+ callback props; zoom local state |
| Page navigation | inline PageNav (Shell 367) | yes | no | yes | no | no | **Yes (priority 2)** | Small surface |
| Code generation | `CodePanel` (Shell 422) | yes | no | yes | yes | no | **Yes (priority 2)** | — |
| Logo | `LogoPanel` (Shell 427) | yes | no | yes | yes | no | Yes (priority 3) | Logo mode only |
| History | undo/redo via context | n/a | n/a | n/a | n/a | no | **No — session modal/command** | Not a panel surface; do not detach |
| Fonts | Inspector `fonts` tab | yes | no | yes | yes | no | **Via Inspector** | Font browser lives inside Inspector |
| Export | `ExportLayer`/ExportDialog (Shell 746) | yes | no | yes | yes | no | **No — session dialog** | Native save dialogs; keep modal in primary |
| Audit | Inspector `audit` tab + `AuditOverlayHost` | yes | no | yes | yes | no | **Via Inspector** | Overlay is canvas-coupled |
| AI | `AiToolsHintSection` etc. (Inspector) | yes | no | yes | yes | no | **Via Inspector** | Model runtime centralized (ADR-0127) |
| Minimap | `MinimapPanel` (inside Layers) | yes | no | yes | yes | yes | **No** | Canvas-dependent; stays with Layers or canvas |
| Master pages | `MasterPanel` (inside Layers) | yes | no | yes | no | no | **With Layers** | — |
| Spread settings | `SpreadSettings` (inside Layers) | yes | no | yes | no | no | **With Layers** | — |
| State machine | `StateMachinePanel` (Shell 740) | yes | no | yes | yes | no | Yes (priority 3) | — |
| Presence | `PresenceIndicator` (inside Layers) | n/a | n/a | n/a | n/a | no | **With Layers** | Collab stub |
| Contextual help | `ContextualHelpPanel` (Shell 793) | yes | no | no | no | no | Yes (priority 3) | Help-system surface |
| Help browser | `HelpBrowser` (Shell 808) | yes | no | no | no | no | Yes (priority 3) | — |

Classification: safe for initial detachment = Layers, Inspector,
ResourcesPanel (Assets), Timeline, PageNav, CodePanel. Must remain attached =
Minimap (canvas), Audit overlay host, Export dialog, all canvas overlays,
SelectionOverlay/rulers. Dialog rather than panel = Export, Settings,
FindReplace, Prompt, IconBrowser, ContentAwareFill, Upscale, LogoPreview,
Onboarding, Recovery, ContextMenu, PrototypePresenter. Not a panel = History
(undo system), Tool palette, StatusBar, TabStrip, Menubar.

## 10. State-scope inventory

| State | Location | Current scope | Proposed scope |
|---|---|---|---|
| Scene nodes, pages, styles, variables, timelines, interactions | `state.document` | document (per session snapshot) | `document-shared` |
| Open document list, activeId | `state.sessions`, `state.activeId` | provider session | `session-shared` |
| Undo/redo stacks | refs in provider | per session, single active | `session-shared` |
| Selection | `state.selection` + SelectionProvider | provider session | `session-shared` (panel windows follow) |
| Workspace mode | `state.workspaceMode` | provider | `session-shared` |
| Panel visibility flags | `state.*PanelVisible` | provider + settings | migrate to dock model |
| Panel widths | `usePanelWidths` + settings | provider window | `machine-local` (layout) |
| Panel-local UI state (filter, tabs, zoom, expansion) | components | component state | `panel-instance-local` |
| Monitor map, window placement | none | — | `machine-local` |
| Hover, drag preview, tooltips | components | ephemeral | `ephemeral` |

## 11. Capability matrix

| Capability | State | Evidence | Proposed owner |
|---|---|---|---|
| Typed panel IDs | Existing | `PanelId` (`workspaceTypes.ts:40-47`) | panel registry (M2) |
| Declarative panel registry | Missing | no registry exists | `@varve/editor` registry (M2) |
| Stable panel instance IDs | Missing | none | registry (M2) |
| Dock tree | Missing | fixed CSS grid in Shell | dock model (M3) |
| Panel tab groups | Partial | Inspector tabs only | dock model (M3) |
| Panel visibility persistence | Partial | left/right/logo only (`settings.ts:34-41`) | dock model (M3) |
| Panel width persistence | Existing | `panel.leftPanelWidth/rightPanelWidth` | migrate to dock model |
| Native auxiliary windows | Missing | zero window APIs | `@varve/platform` window service (M4) |
| Window enumeration | Missing | none | window service (M4) |
| Monitor enumeration | Missing | none | window service (M4) |
| Window geometry persistence | Missing | none | window service + layout store (M4/M9) |
| Cross-window state sync | Missing | no BroadcastChannel, no broker | session protocol (M5) |
| Versioned IPC protocol | Missing | none | session protocol (M5) |
| Command routing | Partial | ActionRegistry is per-window | session broker (M5/M8) |
| Undo ownership | Partial | per-session single-active stacks | session broker (M5/M8) |
| Focus routing | Missing | single window keydown | focus model (M8+) |
| Cross-window drag and drop | Missing | none | M13 (deferred) |
| Dialog ownership | Partial | inline `<dialog>` in Shell | session modals (M11) |
| Crash recovery | Partial | BackupService/RecoveryManager per window | auxiliary recovery (M11) |
| Named layouts | Missing | none | layout store (M9/M10) |
| Gather-windows action | Missing | none | window service (M9) |
| Browser fallback | Missing | none | browser window service (M4/M12) |
| Native E2E coverage | Partial | WDIO smoke/native-menu | WDIO workflows (M7+) |
| Low-memory behavior | Missing | per-window renderer init | window service (M4+) |
| Multimodal layout proposals | Missing | none | `@varve/ai` (M14, deferred) |

## 12. Reuse / generalize / wrap / migrate / deprecate / remove

- **Reuse:** `settings.ts` persistence plumbing; `@tauri-apps/api/window`
  through a platform facade; ActionRegistry ordering invariant;
  `stateRef` sync-mirror pattern; per-session snapshot model
  (`snapshotEditorSession`); `runtime.ts` capability gating.
- **Generalize:** `PanelId` → registry-driven type; `PanelConfig` →
  dock-backed layout; `getVisibleInspectorTabs` → registry-derived;
  `usePanelWidths` → dock split ratios.
- **Wrap:** all Tauri window/monitor calls in `@varve/platform` window
  service (nothing may import Tauri APIs outside `@varve/platform` and
  `apps/desktop/src/chrome/`).
- **Migrate:** `varve-workspace-preferences` (currently dead) becomes the
  storage home of logical dock layouts; `panel.leftPanelWidth/
  rightPanelWidth` migrate into split ratios; `settings.panel` visibility
  flags migrate into dock roots.
- **Deprecate:** `useWorkspace.ts`, `WorkspaceSwitcher.tsx`,
  `workspace/index.ts` barrel, `WORKSPACE_SHORTCUTS` letters.
- **Remove after migration:** Shell-side panel conditional rendering
  (becomes dock-driven), `multiWindow` flag without implementation.

## 13. Pre-existing failures (recorded, not caused by this program)

- Editor package typecheck at `60e4b56e` passes for source; the full
  monorepo typecheck completed with 0 errors across 15/15 packages (baseline
  run 2026-08-05).
- ~58 `home_*` Tauri commands invoked by `platform/src/tauri.ts` have no Rust
  handler — a pre-existing desktop gap in the home/file surface, unrelated
  to windowing.

## 14. Constraints carried forward (from AGENTS.md)

- Shell.tsx (46 imports) and CanvasArea.tsx (82) are over-budget hub files:
  **no new import into either without removing one of equal weight.**
- Complexity ceilings enforced by pre-commit; over-ceiling files need
  `// COMPLEXITY:` comments.
- ActionRegistry registration order is load-bearing.
- `pnpm format` / `typecheck` / `lint` / `test` / audits run after every
  architecture change.
