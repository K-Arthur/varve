# Varve Panels and Canvas Information UI/UX Audit

Date: 2026-08-29
Scope: shared editor shell used by the browser/Vite product and the Tauri
desktop webview, with the home surface included only where it shares panel and
navigation patterns.

## Executive summary

This is a repository-first audit of panel navigation, layer hierarchy,
selection information, canvas overlays, and responsive editor chrome. The
implementation already contains several mature foundations: a virtualized
layers tree, workspace-driven inspector tabs, keyboard alternatives for page
and layer reordering, tokenized themes, screen-space selection geometry, and
responsive side drawers.

The highest-value issues found in this pass were semantic rather than visual:

- virtualized layer rows report the flattened tree's position and size as if
  they were sibling metadata;
- focusable panel splitters do not expose their default current value and do
  not identify the pane they resize;
- mobile drawer Escape/focus restoration was incomplete for the Resources
  drawer;
- the selection strip was visually clear but lacked an explicit status/landmark
  name, while the canvas deliberately repeats dimensions near the selected
  artwork for direct manipulation.

No Critical findings were observed. The four actionable findings are now
implemented in small, independently committed slices. The near-selection
geometry remains intentionally duplicated with the persistent strip because it
serves a different direct-manipulation context.

## Understanding and boundaries

1. Improve only panels, panel navigation, selection surfaces, canvas HUD/readouts,
   and the frontend state/semantics needed to keep those surfaces correct.
2. Preserve the shared scene model, rendering algorithms, file formats, and
   existing workspace behavior.
3. Keep stable locations and shortcuts; do not introduce adaptive reordering of
   primary controls.
4. Prefer native HTML semantics and existing Varve tokens/primitives.
5. Treat the layers panel as a hierarchical composite widget, not a flat list.
6. Treat the persistent selection strip as the nonvisual summary and the
   near-selection label as pointer-proximate manipulation feedback.
7. Validate both browser and Tauri-shared frontend paths where the environment
   permits; the actual runtime here is the Vite desktop app in Chromium.
8. Preserve the unrelated dirty Bézier and scratch Playwright work already in
   the worktree.

Out of scope: engine/rendering changes, image-processing quality, file/export
semantics, collaboration protocol, website redesign, and native window code
beyond shared editor behavior.

## Evidence and runtime limits

### Repository evidence

- `packages/editor/src/Shell.tsx` owns the grid shell and responsive panel
  mounts.
- `packages/editor/src/components/LayersPanel/index.tsx` owns the layers
  surface; `LayersTree.tsx` owns virtualization and keyboard interaction;
  `LayersRow.tsx` owns the treeitem semantics.
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` owns the
  inspector tablist, tabpanels, and selection-specific property composition.
- `packages/editor/src/components/PanelResizeHandle.tsx` owns the side-panel
  splitter behavior and persistence.
- `packages/editor/src/components/SelectionInfoBar/` owns the persistent
  selection summary; `SelectionOverlay.tsx` owns near-selection handles and
  dimension/position labels.
- Existing registries and audits were reused rather than creating a competing
  feature-ownership system.

### Captured baseline

Captured locally under the ignored artifact directory
`artifacts/ui-ux-panels-canvas/2026-08-29-baseline/`:

| Artifact | Conditions | Notes |
|---|---|---|
| `home.png` | Chromium, 1440×900, DPR 1, empty home | Empty state, navigation, search, filters, grid/list controls |
| `editor-1440x900.png` | Chromium, 1440×900, DPR 1, blank document | Full shell, layers, inspector, toolbar, status strip |
| `editor-selected-1440x900.png` | Same, one rectangle selected | Selection overlay, layers synchronization, inspector geometry |
| `editor-900x700.png` | Chromium, 900×700, DPR 1, blank document | Side panels remain visible at the compact desktop boundary |
| `editor-640x700.png` | Chromium, 640×700, DPR 1, blank document | Mobile drawer/FAB layout and toolbar overflow behavior |

The images were opened and inspected at full-shell scale. The selected image
shows the same dimensions/position in two contexts; this is retained as an
intentional pointer-versus-persistent information split, with the persistent
strip now has explicit region and concise status semantics.

### Captured after-state

Captured locally under the ignored artifact directory
`artifacts/ui-ux-panels-canvas/2026-08-29-after/` after the implementation
slices:

| Artifact | Conditions | Notes |
|---|---|---|
| `home.png` | Chromium, 1440×900, DPR 1, empty home | Navigation and empty state remain visually stable |
| `editor-1440x900.png` | Chromium, 1440×900, DPR 1, blank document | Full shell remains balanced; panel and status chrome are readable |
| `editor-selected-1440x900.png` | Same, one rectangle selected | Canvas readout, tree selection, inspector, and persistent strip agree |
| `editor-900x700.png` | Chromium, 900×700, DPR 1, blank document | Compact desktop keeps both panel regions usable |
| `editor-640x700.png` | Chromium, 640×700, DPR 1, blank document | Closed drawers are off-screen and the three FABs remain available |

The after-state images were reopened and inspected. A browser semantic probe
observed `Selection information`, a concise selection status message, and
splitter values `288`/`320` with `aria-controls` targeting the two panel IDs.

### Runtime and platform coverage

Actually tested: Linux/CachyOS environment, Chromium through the Vite desktop
entry point, DPR 1, 1440×900, 900×700, and 640×700, light theme, blank and
single-rectangle documents. Console/page errors were absent during baseline
and after-state capture.

Not tested here: real Tauri window management, Wayland compositor behavior,
Firefox, Safari/WebKit, Windows/macOS, real touch or pen hardware, screen
readers, RTL/localized strings, forced-colors mode, DPR 2, and 200% OS/browser
scaling. Existing repository audits and E2E suites cover some of these areas,
but this document does not claim a fresh pass for them.

## Screen, flow, and component inventory

| Taxonomy | Surface / owner | User task | State model | Intended persistence |
|---|---|---|---|---|
| Global navigation | `Menubar`, `WorkspaceTabs`, `TabStrip` | Open commands, switch workspace/document | global/document | stable DOM order; shortcuts |
| Tool controls | `FloatingToolbar`, tool options popovers | Choose and configure the active tool | tool-level | workspace-configured, stable order |
| Document navigation | `PageNav`, `PagesPanel` | Move among pages and manage pages | document-level | page order; keyboard and pointer parity |
| Hierarchy/navigation | `LayersPanel`, `LayersTree`, `LayersRow` | Find, select, rename, reorder, reparent | selection/document | filter and expansion state; stable rows |
| Contextual properties | `PropertiesPanel`, inspector section registry | Inspect/edit the current selection | selection/workspace | tab/section state with migration |
| Appearance/effects | inspector `Appearance`, `Adjustments` panels | Edit paint, effects, image treatments | selection/tool | contextual, lazy-mounted |
| Prototype/motion | `PrototypePanel`, `TimelinePanel` | Define interactions and animation | document/selection | explicit workspace panel state |
| Canvas information | `SelectionOverlay`, `CanvasOverlays`, `SelectionInfoBar`, `StatusBar` | Read and manipulate geometry/state | selection/camera/tool | near-pointer transient vs persistent status |
| Navigation aids | `MinimapPanel`, breadcrumb | Reveal context and navigate large documents | document/selection | panel state; selection synchronized |
| Utility/status | `StatusBar`, preflight/debt/audit indicators | Read global health, units, zoom, save state | document/camera | persistent, compact, command-linked |
| Transient surfaces | menus, dialogs, contextual help, toasts | Complete exceptional or consequential actions | interaction | focus-contained, dismissible, restored |

## Feature-ownership matrix

| Feature | Current owner | Scope | Access paths | Finding / disposition |
|---|---|---|---|---|
| Workspace switching | `WorkspaceTabs` + shortcut registry | global | tabs, View menu, shortcuts, palette | no issue found; preserve stable ordering |
| Panel visibility | `Shell` + workspace config | workspace | menu, shortcuts, mobile FABs | mobile Escape/focus path fixed |
| Panel width | `PanelResizeHandle` + settings | workspace | pointer, keyboard, reset | splitter semantics fixed |
| Layer search/filter | `LayerFilterBar` + indexed `LayersTree` | document | search, chips, clear | no issue found in baseline |
| Layer selection | `LayersTree` + editor selection context | selection | canvas, tree, breadcrumb | no stale mismatch observed; metadata defect fixed |
| Layer rename | `LayersRow` + tree focus | selection | F2, context menu, inline input | no issue found in baseline |
| Layer reorder/reparent | `useLayersDnD` + `layerDropResolver` + keyboard commands | document | pointer DnD, keyboard reorder, context menu | no issue found in baseline; retain existing alternatives |
| Inspector grouping | `sectionRegistry` + `PropertiesPanel` | selection/workspace | tabs, section manager, palette | no issue found; registry is source of truth |
| Inspector tabs | `PropertiesPanel` | workspace | tablist, shortcuts/palette | APG structure present; preserve automatic activation |
| Selection dimensions | `SelectionOverlay` + `SelectionInfoBar` | selection/camera | near object, persistent strip | intentional two-context presentation; persistent strip named and announced |
| Selection path | `SelectionBreadcrumb` + selection strip breadcrumbs | selection | breadcrumb, deep selection | no issue found in baseline |
| Zoom/units/snap | `StatusBar` | camera/document | bottom bar, shortcuts | dense but legible at tested widths |
| Empty/loading/error states | per-panel owners + shared `EmptyState` | all | panel surface | no issue found in captured blank state |

## Panel taxonomy and ordering rationale

The target taxonomy is: global navigation → document navigation → hierarchy →
contextual properties → tool/workflow panels → utility/status → transient
surfaces. Within a surface, order follows task dependency and frequency:
identity/context first, common manipulation second, appearance/content third,
advanced/diagnostic controls last. Destructive actions stay in menus or clearly
separated bulk-action regions.

Primary controls remain stable across sessions and workspace modes. Contextual
panels may appear when applicable, but they do not silently reorder the primary
tabs or rows.

## Findings

### Medium findings

#### PNL-01 — Virtualized layer rows expose flattened rather than sibling position

| Field | Detail |
|---|---|
| Surface | Layers tree, every visible `treeitem`, including nested rows and filtered results |
| User task | Navigate a hierarchy and understand the focused item's position |
| Evidence | `LayersTree.tsx` passes `virtualizer.options.count` and flat `idx`; `LayersRow.tsx` emits them as `aria-setsize`/`aria-posinset` |
| Expected | `aria-setsize` and `aria-posinset` describe the rendered sibling set for the row's parent |
| Actual | A child can be announced as item 4 of the entire flattened tree rather than item 1 of its parent |
| Root cause | accessibility metadata is derived from virtualization order rather than tree hierarchy |
| Impact / reach | Medium impact; high reach for screen-reader users of the layers panel |
| Severity | Medium |
| Inputs | keyboard, screen reader |
| Standards | WAI-ARIA Tree View: declared position metadata when the complete tree is not in the DOM |
| Proposed fix | Derive sibling count/index after flattening, preserving filter and isolation results; pass explicit metadata to each row |
| Acceptance | nested and filtered rows report 1-based sibling positions; keyboard behavior and virtualization remain unchanged |
| Verification | `useFlatTree` unit tests, `LayersRow` semantic assertions, layers axe E2E |
| Confidence / status | High / implemented |

#### PNL-02 — Focusable panel splitters omit their default current value and controlled pane

| Field | Detail |
|---|---|
| Surface | Layers and inspector resize handles |
| User task | Resize a panel with a keyboard and understand the current width |
| Evidence | `PanelResizeHandle.tsx` only sets `aria-valuenow` when a persisted width exists; no `aria-controls` is emitted |
| Expected | A focusable separator exposes its current value, allowed range, name, and controlled panel |
| Actual | Fresh sessions expose min/max but no current value; assistive technology cannot associate the splitter with a pane |
| Root cause | the default CSS-clamped width is not reused for semantics |
| Impact / reach | Medium impact; high reach for keyboard users of resizable panels |
| Severity | Medium |
| Inputs | keyboard, screen reader |
| Standards | WAI-ARIA Window Splitter pattern; focusable `separator` requires range value metadata |
| Proposed fix | Resolve the same default width used by the shell, always emit `aria-valuenow`, and point `aria-controls` at the side panel |
| Acceptance | fresh and persisted sessions expose a numeric current width within min/max; arrow/Home/End behavior remains unchanged |
| Verification | focused component tests, browser semantic probe, and unchanged keyboard behavior |
| Confidence / status | High / implemented |

#### PNL-03 — Resources mobile drawer lacks the shared Escape/focus-return path

| Field | Detail |
|---|---|
| Surface | Resources FAB and responsive Resources drawer at ≤899px |
| User task | Open a utility drawer, dismiss it without a pointer, and resume canvas work |
| Evidence | `Shell.tsx` Escape effect watched layers/inspector only; Resources was toggled through editor state; baseline 640px screenshot showed the Resources FAB path |
| Expected | Escape, backdrop, and the explicit trigger close the drawer and return focus to the trigger |
| Actual | Escape handling was not shared with Resources, close paths did not consistently restore trigger focus, and closed mounted drawers remained in the focus tree |
| Root cause | local mobile panel state and editor-owned library state use separate dismissal logic |
| Impact / reach | Medium impact; medium reach because it affects compact layouts and keyboard users |
| Severity | Medium |
| Inputs | keyboard, touch, screen reader |
| Standards | WCAG 2.4.3/2.4.11; drawer focus-management convention |
| Proposed fix | Centralize responsive drawer close/focus restoration, include Resources, and hide closed mounted drawers from the focus tree |
| Acceptance | all three drawers close by Escape/backdrop/trigger and focus returns to the invoking FAB |
| Verification | focused E2E at 640px and manual keyboard pass |
| Confidence / status | High / implemented |

### Low findings

| ID | Surface | Issue | Disposition |
|---|---|---|---|
| PNL-04 | Selection information strip | No explicit accessible name/status role; changing selection is less discoverable nonvisually | implemented as a named region plus concise identity/count status; geometry is not live-announced |
| PNL-05 | Selection overlay | Dimensions/position appear both near the object and in the bottom strip | retain: near-object data is manipulation context, strip is persistent summary; document this split |
| PNL-06 | Layers/inspector headers | Visual titles are not consistently heading elements | existing named landmarks are adequate for the tested surface; consider shared heading primitive only if a concrete navigation failure is found |
| PNL-07 | Status bar | Many compact controls share one horizontal strip | no clipping at tested widths; run 200%/localization pass before changing stable ordering |

## Cross-lens review and resolutions

- Density versus target size: keep compact visible chrome, but preserve the
  existing 24px+ effective controls and keyboard paths. Do not shrink labels to
  solve narrow layouts.
- Direct manipulation versus duplicate information: retain the selection
  overlay's short-lived/near-object readout because it is adjacent to the
  handles; make the persistent strip the named, nonvisual summary.
- Virtualization versus semantics: calculate hierarchy metadata from the
  rendered logical result, not DOM count, so virtualization remains intact.
- Detach affordance versus panel title: retain panel detachment because it is
  an existing supported workflow; do not add a second header abstraction until
  ownership or focus failures justify it.

## Research log

| Question | Source | Applicable recommendation | Decision |
|---|---|---|---|
| How should a virtualized tree expose hierarchy position? | [WAI-ARIA APG Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) | When the full tree is not in the DOM, expose `aria-level`, `aria-setsize`, and `aria-posinset`; selected state must remain distinct from focus | derive sibling metadata in the flat logical result and keep roving focus separate from selection |
| How should inspector tabs expose focus and panels? | [WAI-ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | one active tab in the tab sequence, `aria-controls`, `aria-labelledby`, and a predictable arrow-key model | retain the existing roving tablist and automatic activation |
| What does a resizable panel separator need? | [WAI-ARIA APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) | focusable separator exposes current value, min/max, accessible name, and controlled pane | fix default `aria-valuenow` and add `aria-controls` |
| What is the current target-size baseline? | [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | pointer targets are at least 24×24 CSS px or meet an exception | retain compact visuals with effective hit areas; no blanket shrinking |
| What is required for focus visibility/obscuration? | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) | focus must remain visible and not be entirely hidden by authored surfaces | preserve the existing focus-ring tokens and verify drawer focus restoration |

## Risk register

| Risk | Likelihood | Consequence | Mitigation |
|---|---|---|---|
| Tree metadata changes break drag/index assumptions | Low | reorder or focus regression | keep metadata additive; run tree unit tests and E2E |
| Default panel width calculation drifts from CSS clamp | Medium | inaccurate spoken width | reuse the existing `defaultPanelWidth` helper and test expected values |
| Drawer focus fix conflicts with canvas Escape behavior | Medium | tool cancellation regression | close only while a responsive drawer is open; add E2E ordering assertions |
| Shared dirty work is accidentally included | High | unrelated changes committed | stage explicit paths only; report preserved files |
| Unavailable screen readers/platforms hide integration defects | Medium | incomplete accessibility confidence | state limits; retain axe plus semantic and keyboard tests |

## Priority plan

1. Complete PNL-01 and PNL-02 with focused unit tests. Done.
2. Complete PNL-03 through a small responsive drawer controller change and E2E. Done.
3. Add named selection status semantics without making pointer updates noisy. Done.
4. Run the affected planner, focused tests, layers/a11y E2E, and visual captures. In progress.
5. Re-open all after-state screenshots and record limitations in the verification
   document. In progress.
