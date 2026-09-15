# Workspace System Audit — 2026-08-05

Historical record. State of the workspace system at the time of the audit, the
defects found, what was fixed, and what was left open. Current guidance lives in
`docs/architecture/workspace-system.md`.

Branch point: `4bb55c01`. Scope: `packages/editor/src/workspace/**`,
`context/useWorkspaceMode.ts`, `context.tsx`, `Shell.tsx`, `StatusBar.tsx`,
`components/WorkspaceTabs.tsx`, `components/FloatingToolbar/**`,
`components/Inspector/PropertiesPanel.tsx`, `intelligence/useShortcutTips.ts`,
`shortcuts/ShortcutManager.ts`.

## Current-state matrix

Status is as of the end of this audit. "Gap" entries are carried into the
Limitations section of the architecture doc.

| Concern | Declared config | Runtime consumer | Persistence | UI surface | Tests | Status |
|---|---|---|---|---|---|---|
| Panel visibility | `panels[id].visible` | `panelVisibilityPatch` → EditorState; Shell (pagenav) | per-mode overrides (localStorage + platform) + global `settings.panel` | Layers, Inspector, Timeline, Library, Codegen, Logo | store/boot/reset tests | **Fixed** — boot ignored overrides; reset re-applied them |
| Panel collapsed | `panels[id].collapsed` | none | merged, unused | — | — | Gap |
| Panel order | `panels[id].order` | `getOrderedPanels` (tests only) | merged, unused | — | config-shape only | Gap |
| Panel preferred width | `panels[id].preferredWidth` | Shell grid style, only when unresized | merged | sidebar / inspector width | none | Partial — untested |
| User-resized width | — | Shell `widths` | global, not per workspace | sidebar / inspector | none | Gap |
| Default tool | `defaultTool` | `applyWorkspaceConfig` | — | active tool | yes | OK |
| Toolbar composition | `toolbar.tools` | **not the toolbar** — only `getHiddenTools` → tip suppression | — | floating toolbar | per-mode toolbar tests | **Gap** — FloatingToolbar renders its own `DRAWING_TOOLS` / `INDIVIDUAL_TOOLS` lists and `workspaceMode === …` checks |
| Toolbar flyouts | `toolbar.flyouts` | none | — | flyouts | — | Gap — component has its own `SHAPE_SUB_TOOLS` / `BOOLEAN_SUB_TOOLS` |
| Floating toolbar visibility | `floatingToolbar` | FloatingToolbar | — | toolbar | — | **Fixed** — was reading the raw config map with no unknown-mode fallback |
| Status-bar visibility | `statusBar` | Shell | — | status bar | — | OK |
| Tab-strip visibility | `tabStrip` | Shell | — | document tabs | — | OK |
| Inspector tabs | `inspectorTabs` | PropertiesPanel via `getVisibleInspectorTabs` / `getDefaultInspectorTab` | no override surface | inspector tab bar | config-level | Partial — resolves built-in config only |
| Inspector tab groups / overflow priority | `group`, `overflowPriority` | none | — | — | — | Gap |
| Status sections | `statusSections` | StatusBar via `getVisibleStatusSections` | no override surface | status bar | config-level | Partial |
| Canvas overlays | `canvasOverlays` | `overlayPatch`: `guides`, `pixelGrid`, `dotGrid`, `baselineGrid` | — | canvas | config-level | Partial — `rulers`, `bleedGuides`, `layoutGrid` have no consumer |
| Shortcut layer | `shortcuts.extra` / `.disabled` | none / tip filter | — | — | asserted bindings that did nothing | **Removed** |
| Performance | `performance` (6 fields) | none | — | — | asserted only | **Removed** |
| Onboarding description | `onboarding.description` | none | — | — | asserted non-empty | Gap — switcher tooltip shows the label only |
| Onboarding tips | `onboarding.tips` | none | — | — | asserted non-empty | Gap |
| Onboarding shortcut hint | `onboarding.shortcutHint` | none | — | — | asserted non-empty | **Removed** — stale values |
| Switch shortcuts | `WORKSPACE_SHORTCUTS` | dead switcher UI only | — | tooltips | asserted non-empty | **Removed** — contradicted the registry |

## Hypothesis verification

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | `WorkspaceConfig` declares more than the switch applies | **Confirmed** | See matrix — toolbar, flyouts, collapse, order, onboarding, and 3 of 7 overlay flags had no consumer |
| 2 | Switch changes mode + panel booleans + optional tool + some settings | **Confirmed** (plus overlays) | `useWorkspaceMode.ts` `applyWorkspaceConfig` |
| 3 | Many fields partly/inconsistently wired or only tested as static config | **Confirmed** | Matrix; tests asserted `performance`/`shortcuts` values with no runtime path |
| 4 | Store supports panel overrides but the switch path may not apply them | **Partially confirmed** | The switch path did resolve them; `resetWorkspaceToDefault` resolved the *effective* config before clearing overrides, so reset re-applied the customizations it was meant to discard (`workspaceReset.test.tsx` was failing) |
| 5 | Persistence bypasses the platform abstraction | **Confirmed** | `workspaceStore.ts` was localStorage-only, with a silent catch — the storage layer this repo already found unreliable across launches on WebKitGTK |
| 6 | A deprecated `useWorkspace.ts` remains | **Confirmed** | Dead file plus a dead second switcher UI (`components/WorkspaceSwitcher.tsx`) rendering stale shortcuts |
| 7 | `Shell.tsx` renders surfaces the config claims to control | **Partially confirmed** | `statusBar` / `tabStrip` gating was already in place at the branch point; page-nav and panel widths resolve through the config |
| 8 | Switching reduces interactions to "change to Select" without commit/cancel contracts | **Confirmed — still open** | `requestWorkspaceSwitch` handles `nodeEdit`, `crop`, and mask preview only, all by switching to Select; returns `Promise<boolean>` with no way to express blocked/failed |
| 9 | Workspace tabs lack complete roving focus / arrow-key behaviour | **No longer applicable** | Implemented at the branch point; covered by `WorkspaceTabs.test.tsx` |
| 10 | Overflow can hide the active workspace's label/state | **Incorrect** | `computeWorkspaceLayout` evicts a lower-priority tab rather than the active one; covered by `workspaceOverflow.test.ts` |
| 11 | Tests verify configuration without proving it reaches the app | **Confirmed** | Whole test blocks asserted removed decorative fields; replaced with assertions on the registry binding that actually fires and on derived suppression |
| 12 | User-resized panel widths are global rather than per workspace | **Confirmed — still open** | Shell `widths` is not keyed by mode |
| 13 | Workspace mode is global across documents without that being an explicit decision | **Confirmed** | It was global *and* reset to Design each launch, documented nowhere. Now an explicit, documented, tested policy |
| 14 | Workspace shortcuts may conflict with tools, browser, or OS shortcuts | **Partially confirmed** | The literal `WORKSPACE_SHORTCUTS` table claimed Ctrl+Shift+D/P/R/I/M, keys since reassigned to Repeat Duplicate, Present, Invert Selection, and Preview Mode — every tooltip built from it was wrong. The live registry bindings (Ctrl+Shift+1–9) were not audited against OS-level or international keyboard layouts |

## Fixed in this pass

1. `resetWorkspaceToDefault` re-applied the overrides it was clearing.
2. Boot seeded panel visibility from a global mirror, so per-workspace
   customizations did not survive a restart and one mode's layout leaked into
   another's.
3. Preferences were not durable across launches on the primary Linux target.
4. Three copies of the config→state projection had drifted; unified.
5. `FloatingToolbar` bypassed the resolver and had no unknown-mode fallback.
6. Two decorative config blocks and a stale shortcut table removed.
7. Dead second switch path and dead second switcher UI removed.

## Not done

- Typed transactional switch lifecycle with per-interaction commit / cancel /
  pause / block / continue policies (hypothesis 8).
- Toolbar composition driven by `toolbar.tools` rather than the component's own
  lists and `workspaceMode === …` checks.
- Override surfaces for inspector tabs, status sections, and toolbar; panel
  order/collapse/width customization UI; per-workspace resized widths.
- Consumers for `rulers`, `bleedGuides`, `layoutGrid`, `onboarding.description`,
  and `onboarding.tips`.
- Workspace customization UI and "reset all workspaces".
- E2E, visual-regression, and cross-platform verification — the branch point
  does not build (see below), so none of it could be run.

## Environment caveat

`4bb55c01` does not typecheck or bundle on its own: committed code references
modules and context members that exist only as uncommitted files in other
working trees (`./navigation/useDeepLinkHost`, `./warp/warpActions`,
`VectorizeDialogHost`, `editor.vectorizeDialogOpen`, `sections/TableSection`,
`isWarpedContainer`). 176 pre-existing typecheck errors, none in workspace
files. Playwright, production build, and Tauri verification were therefore not
possible on this branch and are not claimed.
