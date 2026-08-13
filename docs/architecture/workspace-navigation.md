# Workspace Navigation — unified model, effective configuration, deep links

Status: current-state (2026-08-05). Companion tracker:
`docs/plans/workspace-navigation-progress.md`.

## 1. Current-state map (audit, 2026-08-05)

The audit traced every navigation-related surface before changing code. Each
row: state owner / UI surface / input path / persistence / tests / gaps.

| Surface | State owner | UI | Input path | Persistence | Tests | Known gap (pre-change) |
|---|---|---|---|---|---|---|
| Workspace mode | `EditorState.workspaceMode` | Menubar → `WorkspaceTabs` (APG radiogroup) | click; `Ctrl+Shift+<key>` shortcuts; command palette | subset of panel booleans via `settings.ts` | `WorkspaceTabs.test.tsx`, `workspaceMode.test.tsx`, `workspaceSwitching.test.tsx`, `workspaceReset.test.tsx` | No roving tabindex / arrow keys / Home-End; no focus restore after overflow; preferences store dead; most config fields decorative |
| Document tabs | `sessions` / `activeId` + in-memory `sessionStoreRef` | `TabStrip` (APG tablist, roving) | click, arrows, Home/End, Enter/Space, Delete, middle-click | in-memory per session; crash-recovery sessions via platform | `TabStrip.test.tsx` | Dirty-close dialog had no Save / Don't-save / Cancel-with-save; no overflow/search for many tabs; no MRU order |
| Pages | `document.pages` + `currentPageId` | `PageNav` (tablist + dnd-kit) | click, arrows, Enter, drag, context menu | in document (scene) | `PageNav.test.tsx` | No rename; no delete confirmation (delete of active page falls back deterministically); no searchable page nav |
| Viewport / camera | `zoom` / `pan` / `cameraRotation` | canvas, `MinimapPanel`, StatusBar zoom chip + fit buttons | wheel, pinch, space-hand, minimap click-drag, keyboard | viewport defaults in `settings.ts`; per-tab snapshots in memory | `wheelClassifier.test.ts`, `navigationState.test.ts`, `viewportOps.test.ts` | Side buttons 3/4 swallowed (dead); no viewport back/forward history; minimap "fit all" was selection-oriented |
| Deep links | (none — module dead) | none | none | none | none | Entire deep-link subsystem unwired; finding-only vocabulary; Tauri listener leaked |
| Workspace preferences | `workspaceStore` (dead) | none | none | raw localStorage | none | Dead code: no loaders, no appliers, no UI |
| Unified navigation | none | — | — | — | — | No `NavigationTarget` / `NavigationRequest` / `NavigationResult` vocabulary |
| Findings | local state in `IntelligencePanel` | Audit tab | — | — | — | No registry; deep-link finding targets unresolvable |

### Hypothesis verdicts

1. `WorkspaceConfig` defines panel visibility, collapse, order, widths,
   toolbar composition, inspector tabs, status-bar sections, canvas
   overlays, shortcut layers, performance prefs, onboarding, floating
   toolbar, status bar, tab strip — **CONFIRMED** (`workspaceTypes.ts`).
2. The active switching path applies only a subset (mode identity, panel
   visibility, default tool) — **CONFIRMED** (`useWorkspaceMode.ts`).
3. Workspace preference storage exists but is not applied — **CONFIRMED and
   stronger**: the entire store had zero consumers.
4. Deprecated `useWorkspace.ts` + unused barrel exports remain beside
   `useWorkspaceMode` — **CONFIRMED** (still true; removal documented).
5. `Shell.tsx` renders workspace-controlled surfaces via hard-coded
   conditions — **CONFIRMED** (`hidePageNav` from raw config; StatusBar,
   TabStrip rendered unconditionally).
6. WorkspaceTabs / doc tabs / page nav / minimap / status bar / deep links /
   canvas input work independently without a shared contract — **CONFIRMED**.
7. Workspace settings persist via raw `localStorage` while documents use
   `@varve/platform` — **CONFIRMED** (settings.ts + workspaceStore use
   localStorage with `strata-*` legacy keys; platform stores documents).
8. Minimap "fit all" calls selection-oriented viewport behavior —
   **CONFIRMED** (`revealSelection({fit:true})` no-ops without selection).
9. Deep links support findings only — **CONFIRMED**, and additionally the
   whole module was unwired (zero consumers anywhere).
10. Native deep-link listeners need explicit lifecycle cleanup —
    **CONFIRMED by absence**: `setupTauriDeepLink` never returned a
    teardown, and was never called.

## 2. UX and architecture decisions

### D1 — Workspace mode is application-global, not per-document

Switching documents never changes the workspace; switching workspaces never
changes the active document. Rationale: modes are task-focused shells over
the same editing state; per-document mode would fork the mental model for no
product value, and tab switching must stay stateless w.r.t. mode. Locked by
`packages/editor/src/__tests__/workspaceModeGlobal.test.tsx`.

### D2 — One navigation vocabulary, one coordinator, no second context

`NavigationTarget` (typed destinations), `NavigationRequest` (policy),
`NavigationResult` (outcome), and a single `navigationCoordinator` that
delegates to the existing document/workspace/page/selection/camera APIs.
High-frequency camera input (wheel, pinch, pointer) stays in the canvas
pipeline (`inputPipeline.ts`) and never routes through React state or the
coordinator. Camera/destination changes never pollute document undo/redo
(`setPan`/`setZoom`/`setSelection(origin:'api')` do not push history; the
selection history used by side buttons is separate from artwork undo).

### D3 — The effective workspace configuration is the runtime source of truth

`getEffectiveWorkspaceConfig(mode, prefs)` = built-in config merged with the
user's persisted panel overrides. Every switch applies the full projection;
Shell consumes the same effective config for status bar / tab strip /
page-nav visibility; toggles record overrides for the active mode; reset
clears them. See §4 for the field support matrix.

### D4 — Minimap fit semantics are separate

Double-click / Enter / Space / Home on the minimap fit the **whole
document** (`fitAll`); click-drag pans; the selection fit remains a separate
status-bar action ("Fit sel"). The aria-label states the real behavior.

### D5 — Side buttons = selection history

Buttons 3/4 map to previous/next selection (the canvas analog of back /
forward) via `selectPreviousSelection` / `selectNextSelection`, which push
no artwork history. A viewport back/forward history is deferred (§9).

### D6 — Deep links speak the typed vocabulary

`varve://navigate/<kind>[/<id>]` plus legacy `finding:<id>` / `?finding=`.
The coordinator resolves staleness; cross-document targets return
`cross-document` and the host offers open-or-cancel via the platform
facade. Listeners are torn down on unmount, including the Tauri listener.

## 3. Navigation model

Files: `packages/editor/src/navigation/`.

- `navigationTargets.ts` — `NavigationTarget` union (`home`, `document`,
  `workspace`, `page`, `node`, `finding`, `viewport`), hostile-input-safe
  parsing (`parseNavigationTarget`, `parseNavigationTargetFromUrl`),
  serialization, round-trip normalization.
- `navigationRequest.ts` — `NavigationRequest` (target + source +
  activation/focus/fit/history/failure policies) and `NavigationResult`
  (`completed` / `blocked` / `cancelled` / `stale` /
  `document-unavailable` / `cross-document` / `partially-completed`).
- `navigationCoordinator.ts` — `createNavigationCoordinator()`; maps targets
  to existing APIs; checks staleness; never throws; applies failure policy.
  Cross-document opening is provided by the `openDocument` dependency.
- `deepLinkHandler.ts` — web (`hashchange`/`popstate`) + Tauri listener
  wiring with teardown, parked-link timeout/cancellation, legacy finding
  compat exports.
- `useDeepLinkHost.ts` — React-side wiring (registers the live context,
  listens for host `varve:deep-link` events, provides `openDocument` via
  the platform facade and finding navigation via `useFindingNavigation`).
- `audit/findingsRegistry.ts` — single-slot findings store so deep-link
  finding targets resolve without threading IntelligencePanel state;
  `IntelligencePanel` publishes scan results.

### State and event flow

```
link / user action / command palette / side button / minimap
        │  NavigationRequest (typed, policy-carrying)
        ▼
navigationCoordinator ──► editor APIs (switchTab / requestWorkspaceSwitch /
        │                   setActivePage / setSelection / setZoom / …)
        │  staleness checks against ctx.state.document
        ▼
NavigationResult ──► toast (failure policy) / announce / caller
```

Deep links additionally: parse → validate → (park if document loading) →
coordinate → teardown-safe listeners.

## 4. Workspace configuration field support matrix

| Field | Runtime behavior | Notes |
|---|---|---|
| `panels.*.visible` | Applied on switch; toggles record overrides | Layers/inspector/library/codegen/logo/timeline/pagenav |
| `panels.*.preferredWidth` | Layers/inspector: seeds CSS var when user has no saved width | Codegen/timeline `100%` values are panel-internal; no CSS var wired |
| `panels.*.collapsed` / `order` | Config-declared only | No panel collapse/ordering state exists in the shell; deferred (panel layout engine) |
| `defaultTool` | Applied on switch | |
| `toolbar.tools` / `flyouts` | Applied to the FloatingToolbar's supported tool groups | Effective visibility overrides are authoritative; shared tool definitions still own icons, actions, and labels |
| `floatingToolbar` | Applied (visibility) | |
| `statusBar` | Applied (Shell hides StatusBar/SelectionInfoBar) | Section-level `statusSections` ordering partially applied (preflight/debt/shortcutTip gated; others unconditional) |
| `tabStrip` | Applied (Shell hides TabStrip) | |
| `inspectorTabs` | Applied | `PropertiesPanel` consumes visibility/default/grouping |
| `canvasOverlays` | Applied on switch (guides/pixel/dot/baseline) | `bleedGuides`, `layoutGrid` are canvas-renderer concerns without state fields; deferred |
| `shortcuts.extra` | **Deprecated — no consumer** | Never wired to ShortcutManager; removal planned |
| `shortcuts.disabled` | Applied | `useShortcutTips` |
| `performance` | **Deprecated — no consumer** | Worker/cache knobs belong to the renderer settings system; removal or rewiring planned |
| `onboarding` | Applied | Tooltips, shortcut hints, tips |
| `version` | Applied | Migration path |

### Deprecation / migration notes

- `WorkspaceConfig.shortcuts.extra` and `WorkspaceConfig.performance`: no
  runtime consumers (verified 2026-08-05). Scheduled for removal in a
  follow-up release: delete the fields, drop the assertions in
  `workspaceSwitching.test.tsx` / `workspaceTypes.test.ts` /
  `workspaceMode.test.tsx`, and bump `WORKSPACE_CONFIG_VERSION` to 2.
- `workspace/useWorkspace.ts` (`useWorkspaceSwitcher`,
  `createWorkspaceSnapshot`, `getWorkspaceShortcutHint`,
  `matchWorkspaceShortcut`): zero callers; kept exported from
  `workspace/index.ts` for external compatibility, marked `@deprecated`.
- `navigation/types.ts` (`NavigationStep`, `FindingNavigationOptions`,
  `SubjectResolution`, `StaleState`): internal to `useFindingNavigation`;
  `NavigationResult` in that file is distinct from the new model and is
  re-exported as `FindingNavigationResult`.
- Legacy storage: `strata-workspace-preferences` → `varve-workspace-
  preferences` fallback read; `strata-editor-settings` → `varve-editor-
  settings` (pre-existing). Corrupted JSON falls back to defaults; unknown
  panel ids, invalid field types, and invalid panel widths are sanitized.

### Browser fallback geometry

The single-window browser fallback (`workspace/browserFallback.ts`) maps the
logical dock layout to CSS-grid regions without relying on native windows.
Visible panels in the same region are treated as tabs, so the region uses the
largest configured slot size rather than adding tab widths together. Left and
right regions use their configured preferred sizes, while timeline/bottom
regions use their configured height (200px by default).

When a narrow viewport cannot accommodate those preferred side-panel sizes
while preserving the layout's requested `centerRatio`, the side regions are
scaled proportionally. Region geometry is clamped to finite, non-negative
dimensions, keeping the canvas and hit-testing coordinates valid during
responsive resize and malformed host-size input.

## 5. Accessibility behavior

- **Workspace switcher**: APG radiogroup — `role=radio`, `aria-checked`,
  roving `tabindex`, ArrowLeft/Right (activate + move focus), Home/End,
  Enter/Space. Active mode is never in overflow. Pointer clicks never move
  focus. Selecting from the "More" menu moves focus to the new active tab.
- **Document tabs**: existing APG tablist preserved; dirty-close dialog is
  now a three-action `role=dialog` (Save / Don't save / Cancel) with the
  native `showModal` focus trap and Esc-cancel.

### Unsaved-change protection fix (found by the e2e dirty-close flow)

`createShapeAt` / `createTextNodeAt` (the rect/text tool draw paths) never
set `dirty`, so a tab holding freshly drawn shapes showed no dirty dot and
closed without confirmation — silent data loss. Fixed in `context.tsx`:
both paths now mark `state.dirty` and the owning session dirty. `closeTab`
and the TabStrip dirty dot additionally fall back to `state.dirty` for the
active tab as a safety net against any other path that updates only the
global flag.
- **Minimap**: `role=img` with an aria-label describing the actual
  interaction (drag to pan, double-click/Enter to fit the whole document);
  Escape collapses; roving-free single-stop tab.
- **Page nav**: existing roving tablist; arrows auto-activate; focus moves
  to the replacement page after delete and to the new page after add.
- **Announcements**: mode switches announce via the existing announcer;
  navigation failures surface as toasts (aria-live) rather than silent
  no-ops.
- **Workspace customization**: tool checkboxes use product labels and expose
  an explicit “Always available” explanation for Select, Hand, and Zoom. Those
  recovery tools cannot be hidden from the toolbar.

## 6. Persistence and migration

- Workspace preferences live in `localStorage` under
  `varve-workspace-preferences` (legacy `strata-workspace-preferences`
  fallback), schema `WorkspacePreference` per mode. Debounced via
  `updateWorkspacePreferences` (single write per toggle, not per frame).
- Panel visibility toggles record overrides for the current mode; effective
  config merges them; reset-to-default clears the mode's overrides.
- Layers and inspector widths are stored in `WorkspacePreference.panelWidths`
  per workspace and mirrored to the legacy editor settings keys for existing
  installations. Widths are clamped at application time so a smaller window
  cannot strand the canvas below its minimum usable width. Selection, hand, and
  zoom remain available even when toolbar customization attempts to hide them.
- Per-tab viewport state (zoom/pan/rotation/grids/snapping/units/guides)
  stays in-memory per session (`sessionStoreRef`) and restores on
  `switchTab`; crash recovery sessions persist via the platform facade.
  Persisting open tabs across restart remains deferred.
- Storage failure modes: corrupted JSON → defaults; unknown panel ids and
  invalid field types → sanitized; quota/unavailable storage → write
  silently skipped (store is advisory).

## 7. Tests

Unit: `navigation/navigationTargets.test.ts` (parse/validate/serialize,
hostile input), `navigation/navigationCoordinator.test.ts` (targets, stale,
cross-document, blocked), `navigation/deepLinkHandler.test.ts` (parking,
timeout, teardown, legacy parsing), `workspace/workspaceStore.test.ts`
(migration, corruption, sanitization, effective config, reset, subscribe),
`canvas/sideButtonNavigation.test.ts`.

Component: `components/WorkspaceTabs.test.tsx` (radiogroup keyboard
contract, roving tabindex), `TabStrip.dirtyClose.test.tsx` (Save / Don't
save / Cancel incl. background-tab save and failed-save), 
`components/Minimap/MinimapPanel.navigation.test.tsx` (fit-all semantics,
aria-label), `__tests__/workspaceModeGlobal.test.tsx` (mode is global).

E2E: Playwright additions under `tests/e2e/` where the repo harness allows;
see the progress tracker.

## 8. Performance

- No per-frame work added: the coordinator runs only on explicit
  navigation events; preferences store writes are per-toggle, not per
  camera frame; deep links are rare events with poll + timeout.
- The canvas input pipeline is untouched for wheel/pinch (still
  `passive:false` + preventDefault while the canvas owns the gesture;
  rotation-correct cursor-anchored zoom).
- `Shell.tsx` import budget respected (52 → 53 imports; ceiling 55).

## 9. Deferred work and reasons

1. **Viewport back/forward history** — no existing store; would need a
   bounded camera snapshot stack with coalescing. Side buttons are wired
   to selection history instead, which exists and is tested.
2. **Toolbar composition from config** — FloatingToolbar predates the
   config; rewiring risks a visual regression across 7 modes; tracked as
   tool-registry work.
3. **Panel collapse/ordering state** — requires a panel layout engine in
   the shell grid; the `collapsed`/`order` fields stay declarative.
4. **Persist open tabs across restart** — crash-recovery exists; tab
   restoration is a product decision (which tabs to reopen) tracked
   separately.
5. **Page rename / delete confirmation UI** — PageNav has duplicate/add/
   reorder; rename + confirm dialog are small follow-ups.
6. **Native (Tauri) deep-link registration** — the app registers the
   listener and honors `varve:deep-link` host events; registering the
   `tauri-plugin-deep-link` in `tauri.conf.json` is a packaging task.
7. **`shortcuts.extra` / `performance` config fields** — deprecated (see
   §4); removal in a follow-up release.
