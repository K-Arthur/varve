# Varve menu and overlay reliability audit — 2026-08-31

Status: implementation slice landed in the working tree; browser evidence is
green for the repaired menubar/context-menu path. This is a dated audit, not a
claim that every platform and every legacy popup has been migrated.

## Executive diagnosis

The two supplied screenshots were symptoms of a wider ownership problem, not
of one incorrect CSS offset. The repaired path had five high-impact causes:

1. Point context menus were passed as unqualified `{x, y}` values. Callers
   supplied `clientX/clientY` while the public comment described page
   coordinates, and the fixed overlay consumed them as if they were the same
   space. Canvas zoom was also allowed to remain adjacent to this boundary.
2. FloatingPortal, Menu, Popover, Select, Combobox, and individual consumers
   each performed some part of outside dismissal. A parent checked only its
   own DOM subtree, so a portaled submenu could look outside even when it was
   the active child of that menu.
3. The menubar submenu was positioned against the whole dropdown ref and the
   submenu CSS retained absolute `left/top` rules. This defeated intrinsic
   measurement and made a flyout visually detach from the hovered item.
4. FloatingPortal could paint an approximate visible position before the
   asynchronous placement result. A valid reference therefore appeared to
   jump from an initial position.
5. `document.body`, `document`, `window.innerWidth`, and global listeners were
   used as implicit owners. That is correct only for the primary browser
   window; it is not correct for a detached panel or secondary WebView.

The first implementation slice addresses those causes for shared UI
primitives, the application menubar, canvas/Layers/Home context menus, major
Inspector/tool popovers, and command surfaces. It adds owner-document
registries, explicit coordinate/anchor contracts, measured hidden-first
placement, descendant-aware dismissal, stable submenu anchors, target
snapshots, and diagnostics. Rich editors, native OS menus, and a few
specialized modal/canvas overlays remain intentionally specialized and are
listed in the residual-risk section.

## Environment and iteration record

### Environment

- Branch at final handoff: `validation-release-system`
- Commit at final handoff: `7f657faa1a36142b91eaeba32253dabaa04c1ac3`
- Dirty state at final handoff: 169 status entries. The worktree already
  contained unrelated and concurrent work; no reset, checkout, or history
  rewrite was used. The branch advanced during the audit, so this SHA is the
  reproducibility point for the final local evidence, not a new commit created
  by this task.
- Active worktree: `/home/kevina/CodingProjects/varve`
- Platform: Linux 7.2.2-1-cachyos, x86_64, Wayland (`wayland-0`, with
  `DISPLAY=:0` also present)
- Node: `v22.23.2`
- pnpm: `11.9.0`
- Rust/cargo: `1.97.1`
- just: `1.58.0`
- Floating UI: `@floating-ui/dom` `1.8.0`, declared as `^1.8.0`
- Browser evidence: Playwright Chromium, Chrome `151.0.7922.34`
- WebView evidence: not run in this slice; `pnpm desktop:preflight` passed
- Browser test viewport: `1280 × 720` CSS px
- Browser zoom: 100% in the evidence run
- Device-pixel ratio: 1 in the evidence run
- Theme/workspace: light / Design in the evidence run
- Window ID: primary Playwright browser page; detached-window runtime not
  available in the browser E2E fixture
- Owner document: the page document for the browser evidence run

The branch and SHA changed during the working session because concurrent work
was being committed to the same branch. Re-run `git rev-parse HEAD` when
producing a release or commit-level handoff; the final values above are the
reproducibility point for the evidence below.

### Scope and evidence format

- Popup surface: application menubar, menubar flyouts, Layers context menu,
  canvas keyboard context menu, shared UI Menu/ContextMenu/Popover/Select/
  Combobox/FloatingPortal, command palette, Inspector and tool popovers.
- Invocation: real mouse click, hover, right-click, keyboard Context Menu key,
  Shift+F10, Arrow/Escape, and submenu item click in Chromium.
- Invariant: every repaired floating surface has an explicit anchor, owner
  document, stable registry ID, measured hidden-first paint, and a cleanup path.
- Out of scope for this slice: native OS menu rendering parity on Windows and
  macOS, an actual Tauri secondary-window run, stylus hardware, screen-reader
  speech capture, and every legacy canvas editing overlay.

## Popup inventory

Status labels used below: **migrated** means it uses the shared placement and
overlay ancestry path; **specialized** means its semantics or top-layer policy
are intentionally separate but its status is documented; **legacy** means a
follow-up migration is still required.

| Surface | Component / symbol | Semantic type | Invocation | Anchor type | Coordinate contract | Strategy | Portal root | Placement / collision | Outside / Escape | Focus / child overlays | Platform / status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| File, Edit, Text, View, Object, Arrange, Page, Help | `packages/editor/src/Menubar.tsx` | `menubar` + `menu` | click, arrows, type-ahead | element: top-level button | DOM rect | `FloatingPortal`, fixed | owner body | `bottom-start`; `flip`/`shift`/`size` | root switches through registry; local deepest Escape | active item index; submenu child IDs | browser migrated; native parity pending |
| Menubar flyouts | `packages/editor/src/menu/menubarSubmenu.tsx` | `menu` | hover, Down, Right | exact parent menu item | DOM rect | `FloatingPortal`, fixed | inherited owner root | logical inline-end; left fallback; shift | descendant-aware registry | Left returns to parent item | browser migrated; Tauri runtime pending |
| Open Recent / Logo | menubar definitions + renderer | menu/submenu | pointer and keyboard | exact parent item | DOM rect | same as menubar | inherited | measured scrollable surface | full tree | stable item IDs | browser evidence passed |
| Canvas object context | `Shell.tsx`, `CanvasArea.tsx`, `canvas/inputPipeline.ts` | `context-menu` | right-click, keyboard | viewport point + canvas context element; selected object screen center for keyboard | `ViewportPoint` | virtual point, fixed | canvas owner body | `bottom-start`, top/end fallbacks; `flip`/`shift`/`size` | tree registry | snapshot selection/document/page/workspace | browser migrated; Tauri pending |
| Empty canvas context | same | `context-menu` | right-click, keyboard | viewport point or focused canvas viewport | `ViewportPoint` | virtual point, fixed | canvas owner body | edge-safe point placement | tree registry | returns to canvas | browser migrated |
| Layers row context | `LayersTree.tsx`, `LayersPanel/index.tsx` | `context-menu` | right-click, Context Menu key, Shift+F10 | viewport point + row; keyboard uses focused row after reveal/scroll | `ViewportPoint` | virtual point, fixed | Layers owner body | edge-safe point placement | tree registry | invocation selection snapshot | browser migrated |
| Pages / PageNav context | `PageNav.tsx` | context menu | pointer / keyboard | point or page item element | viewport/DOM rect | shared `ContextMenu` | owner body | point/element defaults | tree registry | page target retained | migrated |
| Home file context | `packages/home/src/FileContextMenu.tsx`, `HomeShell.tsx` | `context-menu` | file row/grid right-click | viewport point + file row | `ViewportPoint` | virtual point, fixed | Home owner body | edge-safe | tree registry | file/selection snapshot; stale file closes | browser migrated; desktop runtime pending |
| Document/tab context | workspace tab consumer | context menu | tab pointer | element/point | viewport | shared where consumer passes anchor | owner body | edge-safe | registry | document snapshot | migrated at shared call site; consumer audit pending |
| Timeline context | `TimelineRuler.tsx` and timeline consumers | context menu | ruler/track pointer | event point / track element | viewport | shared `ContextMenu` | owner body | edge-safe | registry | track snapshot | migrated |
| History/resources/library context | panel consumers | context menu | row pointer | row element or point | viewport | shared `ContextMenu` where present | owner body | edge-safe | registry | resource/history target | partial inventory; no new competing registry found |
| Panel header / section menus | `DisclosureSection.tsx`, Inspector consumers | context menu/popover | action button | element | DOM rect | shared `Menu`/`FloatingPortal` | containing owner/dialog | bottom/end fallbacks | registry | control-specific | migrated for audited consumers |
| Inspector section manager | `SectionManagerTrigger.tsx` | rich nonmodal popover/dialog-like editor | button | element | DOM rect | `FloatingPortal` | containing dialog or owner body | bottom-end/top fallbacks; max height | registry | focus first control; Escape trigger | migrated |
| Fill / adjustment menus | `FillSection.tsx`, `AdjustmentPanel.tsx` | action menu | button | element | DOM rect | shared `Menu` | owner body | bottom-start; collision | registry | action closes | migrated |
| Binding / inspector colour | `BindingMenu.tsx`, `InspectorColorPopover.tsx` | rich popover | field/button | element | DOM rect | `Popover` + shared registry | containing dialog or owner body | Floating UI compute | registry | form-specific; no menu role | migrated ownership; specialized content |
| Variable modifier | `VariableModifierPopover.tsx` | rich popover/dialog | field action | element | DOM rect | `FloatingPortal` | owner body/dialog | bottom-start/top fallbacks; max height | registry | explicit apply/cancel | migrated |
| Color pickers / gradient editors | ColorPicker consumers, `GradientMapPresetBrowser.tsx` | rich popover/picker | swatch/control | element | DOM rect | shared portal/Popover family | owner body/dialog | measured | registry | picker semantics, not menu | placement ownership migrated where audited |
| Select listboxes | `packages/ui/src/components/Select.tsx` | `listbox` | button, arrows | element | DOM rect | `FloatingPortal` | owner body/dialog | bottom-start/top; match width; size | Select-specific + registry ancestry | listbox focus model | migrated |
| Combobox suggestions | `packages/ui/src/components/Combobox.tsx` | `combobox` + listbox | input | element | DOM rect | `FloatingPortal` | owner body/dialog | bottom-start; match width | registry | input remains focus owner | migrated |
| Toolbar overflow / tool flyouts | `FloatingToolbar.tsx`, `ToolOptionsPopover.tsx` | action menu / popover | chevron/button | element | DOM rect | shared Menu/FloatingPortal | owner body | side/bottom fallbacks | registry | toolbar policy | migrated for audited surfaces |
| Selection quick bar | `SelectionQuickBar.tsx` | action menu/toolbar | selection state | explicit viewport point/element | viewport | shared `ContextMenu`/portal | owner body | edge-safe | registry | selection context | migrated |
| Floating text bar | `FloatingTextBar.tsx` | toolbar + rich popover | text selection state | viewport point; optional context can be supplied by caller | `ViewportPoint` | `FloatingPortal` | owner body | top/bottom/side fallbacks | registry | toolbar/picker-specific | migrated |
| Breadcrumb / touch candidate menu | `SelectionBreadcrumb.tsx`, `TouchCandidateMenu.tsx` | action menu / picker | click/touch | element/point | viewport | shared Menu/FloatingPortal | owner body | edge-safe | registry | candidate selection | migrated |
| Alignment/distribution | `AlignDistributeBar.tsx` | rich popover + action menu | button | element | DOM rect | shared FloatingPortal/Menu | owner body | measured | registry | form/action-specific | migrated |
| Panel detach affordance | `PanelDragHandle.tsx` | context menu + transient drag overlay | pointer/button | element/point | viewport | shared menu; drag indicator specialized | owner document body | edge-safe for menu | registry for menu | transfer coordinator owns drag cleanup | menu migrated; drag indicator specialized |
| Intelligence panel more | `IntelligencePanel.tsx` | action menu | button | element | DOM rect | shared Menu | owner body | edge-safe | registry | action close | migrated |
| Command / quick actions | `QuickActionsBar.tsx` | modal dialog with listbox | shortcut/button | viewport point or explicit anchor | `ViewportPoint` | `FloatingPortal` + `FocusTrap` | owner body/dialog | measured fixed; max height | registry pointer; FocusTrap Escape | one explicit focus handoff | migrated |
| Shortcut palette | `shortcuts/ShortcutPalette.tsx` | modal dialog | shortcut | modal surface | internal modal geometry | specialized modal portal | primary body today | centered modal | dialog policy | focus trap | specialized; secondary-window migration pending |
| Tooltip | `packages/ui/src/components/Tooltip.tsx` | tooltip | hover/focus | element | DOM rect | owner-doc portal + Floating UI | owner body | measured; lower interaction layer | tooltip policy | noninteractive | migrated ownership; native tooltip policy pending |
| Native Tauri menu | `nativeAdapter.ts`, Rust menu bridge | native OS menu | app menu | OS native | OS-native | operating-system menu | OS | OS policy | OS policy | OS policy | parity/runtime verification pending |
| Menus in dialogs | Dialog consumers | menu/listbox/popover | dialog controls | dialog-local element | dialog viewport | shared root resolver chooses closest dialog | dialog | measured above dialog content | registry in owner doc | nested deepest-first | browser tests covered; Tauri pending |
| Plugin-contributed surfaces | plugin extension points | extension-defined | extension-defined | extension-defined | must declare explicit space | extension adapter required | owner window | adapter policy | host registry required | host contract required | inventory gap; explicit follow-up |

### Implementation-family matrix

| Implementation family | Files / consumers | Positioning owner | Dismissal owner | Focus owner | Problems found | Consolidation target |
|---|---|---|---|---|---|---|
| Shared `FloatingPortal` | `packages/ui/src/components/FloatingPortal.tsx`; Menu, Select, Combobox, audited popovers | Floating UI `computePosition` with fixed strategy | `OverlayRegistry` | semantic primitive | previously visible-first and global-body assumptions | canonical geometry/ownership layer |
| Shared action menu | `Menu.tsx`, `ContextMenu`, `MenuButton` | `FloatingPortal` | registry + local menu keyboard state | Menu | plain point contract; parent-only containment; duplicate listeners | explicit anchor + tree registration |
| Custom menubar renderer | `packages/editor/src/Menubar.tsx`, `menu/renderer.ts`, `menubarSubmenu.tsx` | `FloatingPortal` for root and exact item flyouts | registry for root conflicts; local APG state | `menubarFocus.ts` / menu renderer | submenu used parent-menu ref; CSS defeated measurement | exact item refs and logical fallback |
| Native menu adapter | `menu/nativeAdapter.ts` and desktop bridge | OS | OS/native adapter | OS | no runtime parity evidence in this slice | preserve native policy; share action IDs/state |
| Popover | `packages/ui/src/components/Popover.tsx` | Floating UI in native/fallback implementation | registry; native dismissal disabled when registered | modal opt-in FocusTrap | prior always-modal/inert behavior and duplicate listeners | keep native top-layer option, use shared ownership |
| Select/listbox | `Select.tsx` | `FloatingPortal` | listbox local + registry ancestry | Select | dialog-only nested count, global assumptions | listbox semantic + shared tree |
| Combobox | `Combobox.tsx` | `FloatingPortal` | shared registry; input policy | input/combobox | manual mousedown listener | remove competing outside listener |
| Tooltip | `Tooltip.tsx` | owner-document Floating UI portal | tooltip-specific | trigger/noninteractive | direct body/compute path | share ownership/placement; keep tooltip semantics |
| Inspector rich popovers | section manager, variable modifier, binding/color, align/fill/adjustment | shared portal/menu for audited files | registry | component-specific | manual mousedown/Escape and geometry | shared shell; rich content remains specialized |
| Command surfaces | `QuickActionsBar.tsx`, `ShortcutPalette.tsx` | Quick Actions now shared; Shortcut Palette modal remains specialized | Quick Actions registry + FocusTrap; palette modal | modal surface | Quick Actions had fixed hard-coded geometry and duplicate restoration | shared placement for action bar; separate modal policy |
| Canvas editing overlays | `TextEditOverlay.tsx`, `SoftProofOverlay.tsx`, prototype and render overlays | canvas/world transform or modal geometry | feature owner | feature owner | not all are menus; world-space must not be fed to UI portal | retain canvas owner; migrate only UI popups |
| Detachment overlay | `PanelDragHandle.tsx` | direct owner body transient indicator | gesture coordinator | no focus | transient drag UI is not a menu | keep specialized, require owner-window helper |
| Home overlays | `FileContextMenu.tsx`, Home consumers | shared point anchor | registry | Home surface | prior point/target snapshot gaps | shared context contract |
| Plugin surfaces | extension code | no single owner | no single owner | no single owner | missing host contract | require overlay adapter before contribution |

## Architecture diagrams

### Invocation to cleanup

```text
native input
    │ target + composed path + clientX/clientY + owner view
    ▼
invocation context snapshot
    │ surface, target IDs, selected IDs, document/page, input method
    ▼
explicit anchor
    ├─ ElementAnchor(element)
    ├─ PointAnchor(ViewportPoint, ownerDocument, contextElement?)
    └─ RangeAnchor(range, contextElement?)
    ▼
owner document/window + portal host
    │ closest dialog → owner body → owner document root
    ▼
OverlayRegistry registration
    │ stable ID, kind, parent ID, listeners once per owner document
    ▼
hidden mount → measure → computePosition(offset/flip/shift/size/hide)
    │ generation guard rejects late results
    ▼
visible paint + geometry trace
    ▼
semantic keyboard/pointer state machine
    │ parent-child branch and command policy remain primitive-specific
    ▼
activation / dismissal / invalidation
    ▼
deepest-first close → one focus handoff → autoUpdate/timer/listener cleanup
```

### Portaled overlay tree

```text
File menu (root: menubar-menu, owner: window A)
├── Logo item (anchor: File menu item)
└── Logo submenu (kind: submenu, parentId: File root, portal: body A)

Layers context menu (root: context-menu, owner: window A)
└── Select submenu (kind: submenu, parentId: Layers root, portal: body A)

Dialog (native top layer, owner: window A)
└── Select/listbox/popover (portal: closest dialog, same registry)

Detached Inspector (owner: window B)
└── its popup (portal: body B, listeners on document B/window B)
```

Outside classification walks registered parent IDs and the event's composed
path. A descendant portal is inside the ancestor tree; an event in a parent
but outside a child closes only that child branch; an event outside a root
closes the complete root tree deepest-first.

## Required ADRs

### ADR-1 — Infrastructure versus semantic primitives

Share explicit anchors, owner documents, portal hosts, measured placement,
registry ancestry, diagnostics, and cleanup. Keep Menu, listbox/Select,
Combobox, Popover, Tooltip, Dialog, and native menu keyboard/focus semantics
separate. Rich form content never receives `role="menu"` merely because it is
visually floating.

### ADR-2 — Coordinate system

`ViewportPoint`, `PagePoint`, `ScreenPoint`, `CanvasWorldPoint`, `ElementAnchor`,
`PointAnchor`, and `RangeAnchor` are explicit in
`packages/ui/src/components/overlayGeometry.ts`. Fixed UI consumes only
viewport points. Page points are converted with `pageToViewport`; screen and
canvas-world points require an explicit platform/camera conversion first.

### ADR-3 — Positioning strategy

Browser floating UI uses `position: fixed` with Floating UI's `offset`,
`flip`, `shift`, `size`, and `hide` middleware. The supplied reference and
strategy therefore share viewport coordinates. Native OS menus remain native.
Canvas-world overlays remain canvas-owned and are not routed through this UI
primitive.

### ADR-4 — Owner document and portal root

The anchor determines the owner document unless an explicit owner is supplied.
The root is an explicit window-local host, the closest containing dialog, the
owner body, or the owner document root. `document.body` and the primary
window are not valid implicit owners for detached anchors.

### ADR-5 — Overlay tree and stack

Every mounted shared surface registers a stable ID and optional parent ID.
Root command menus conflict with existing root command menus. Registered child
portals count as inside their ancestors. Closing a parent requests descendant
close first; closing a child leaves the parent available.

### ADR-6 — Dismissal state machine

The registry handles outside pointer, deepest Escape, root conflicts, window
blur, and tree cleanup. Menu primitives handle Left Arrow, Tab, item activation,
and pointer-intent timing. Close callbacks receive a typed reason; a close
callback is guarded to run once.

### ADR-7 — Focus restoration and handoff

Menus return to the parent item or invocation control. A dialog-launching item
closes its tree before transferring focus and sets an explicit focus-transfer
policy so menu cleanup does not steal dialog focus. `FocusTrap` owns restoration
unless a surface (currently Quick Actions) explicitly disables it and performs
one owner-level handoff.

### ADR-8 — Submenu pointer intent

Keyboard submenu opening is immediate. Pointer hover opens the active branch
immediately and uses a short close delay while the pointer crosses toward the
child. The child pointer-enter path cancels the parent close. A geometry-aware
safe polygon remains a follow-up when the menu density/localization data shows
the delay is insufficient.

### ADR-9 — Native versus custom menus

Custom menus own browser/WebView geometry and accessibility. Tauri native menus
own OS placement and conventions. Both dispatch canonical action IDs and must
share labels, enabled/checked state, accelerators, and submenu definitions.
This slice does not claim Windows/macOS native parity without runtime evidence.

### ADR-10 — Long menus and scrolling

Floating UI constrains available height, applies `maxHeight` where the surface
has a product limit, and lets content scroll. Focused items must be scrolled
into view. A fixed item count is retained only as an explicit legacy/product
limit (`Menu.maxVisibleItems`), not as the geometry algorithm.

### ADR-11 — Popover API policy

Native Popover remains an allowed top-layer implementation for compatible
nonmodal/modal popovers, but it must share owner-document and dismissal policy
and must not double-register light dismiss. Fallback popovers preserve the
semantic modal/nonmodal distinction. A color picker or rich editor is not a
menu.

### ADR-12 — Instrumentation and regression policy

`window.__varveOverlayDebug` is development/test-only and exposes enable,
disable, snapshot, and trace for each owner document. A popup change requires
geometry assertions independent of the implementation, event-order assertions,
accessibility checks, and real-browser evidence when pointer/canvas behavior is
involved. Visual approval includes manual artifact inspection.

## Geometry specification

### Coordinate and ownership rules

- `clientX/clientY` are constructed as `viewportPoint` values in the invoking
  event's owner document.
- `pageX/pageY` are never passed directly to fixed UI; call
  `pageToViewport(pagePoint(...), ownerDocument)`.
- `screenX/screenY` are platform screen coordinates and are not viewport
  coordinates.
- Canvas-world values must go through the active camera (`worldToCanvas` or
  equivalent) before they become a UI point.
- Element anchors use the exact trigger, row, control, or active submenu item.
- Context points use a zero-size virtual reference and retain a real
  `contextElement` when available for clipping/update ownership.
- Range anchors adapt `Range.getBoundingClientRect()` without losing document
  ownership.
- All constructors reject non-finite values. Safe viewport dimensions are
  clamped to nonnegative finite values.

### Placement and sizing

| Surface | Preferred | Fallback / constraints |
|---|---|---|
| menubar dropdown | `bottom-start` | top-start and edge shift; measured max height |
| submenu | logical inline-end + `start` | inline-start, then shift/size; meaningful parent overlap |
| context point | `bottom-start` | top-start, bottom/end, top/end; point remains invocation-fixed |
| toolbar/action menu | bottom/side according to trigger | opposite side and shift |
| listbox/combobox | bottom-start | top-start; match anchor width; scroll |
| rich popover | primitive-supplied placement | opposite side and shift |

Every visible shared surface is first mounted hidden with `pointer-events`
disabled. The first visible state is the measured result. `autoUpdate` runs
only while open and is cleaned on every effect teardown. A generation and
connection check rejects stale asynchronous results after close/unmount.

The safe viewport uses an 8 CSS-pixel inset, then Floating UI's `size` and
`shift` middleware. Width and height are finite and nonnegative; content uses
`box-sizing: border-box` and `overflow-y: auto`. Menu styling reserves stable
lanes for labels, shortcuts, checkmarks, badges, and submenu arrows.

### Scrolling, transforms, and RTL

Element anchors update with their owner-document scroll/resize/layout changes.
Point context menus stay at their invocation viewport point by policy; a
consumer may close on scroll when that is more appropriate. A detached anchor
or range closes with `anchor-detached` rather than continuing from a stale
rectangle. Horizontal logical placement swaps inline-end/inline-start for RTL;
vertical alignment remains Floating UI's start/end behavior.

## Dismissal and focus specification

| Close reason | Levels closed | Focus destination | Action / cleanup |
|---|---|---|---|
| `escape` | deepest dismissible level | parent item, or invocation context at root | prevent default; one close request; remove registry/autoUpdate |
| `left-arrow` | current submenu only | parent menu item | keep parent active |
| `tab` | complete menu tree | browser's next/previous tab destination | leave composite widget |
| `outside-pointer` | full root tree, or child branch when parent is inside | primitive policy; do not steal intentional outside focus | classify composed path before unmount |
| `action` | declared item policy, usually full tree | dialog/new surface if transfer declared | capture context, dispatch canonical action, cleanup |
| `trigger-toggle` | toggled root | trigger | no duplicate open tree |
| `open-sibling` | previous conflicting root and descendants | new trigger/menu | registry replaces root command tree |
| `parent-close` | descendant only | parent cleanup owns final handoff | deepest-first |
| `anchor-detached` | affected tree | invocation context if still connected | cancel placement and autoUpdate |
| `context-invalidated` | affected context tree | surviving active surface/context | no stale command mutation |
| `window-blur` | transient surfaces in owner window | platform/browser default | clear timers/listeners |
| `document-change` / `workspace-change` | affected menu trees | new document/workspace focus | clear target snapshots and branches |
| `programmatic` | caller-selected tree/all owner overlays | caller policy | idempotent cleanup |

Outside pointer handling is capture-phase, owner-document-local, and
composed-path aware. It does not remove a child before a click inside that
child can bubble to its item. Parent and child callbacks are idempotent. A
dialog launched from a menu is an explicit focus transfer, so menu restoration
is suppressed for that path.

## Implementation slice

### Shared infrastructure

| File / symbol | Change | Reason |
|---|---|---|
| `packages/ui/src/components/overlayGeometry.ts` | explicit point/element/range types, constructors, page conversion, safe rect, RTL and portal-root helpers | eliminate coordinate ambiguity and implicit window ownership |
| `packages/ui/src/components/OverlayRegistry.ts` | owner-document registry, stable IDs, ancestry, root conflict, deepest Escape, outside tree classification, blur, bounded debug trace | one dismissal/ownership authority |
| `packages/ui/src/components/FloatingPortal.tsx` | hidden-first fixed placement, middleware, owner root, detached ref resolution, mutation detachment, generation guard, debug metadata | eliminate first-frame jump, clipping, and stale placement |
| `packages/ui/src/components/Menu.tsx` | explicit anchors, virtual point menus, submenu parent refs, tree registration, keyboard context invocation, action focus-transfer policy | repair core menu/context behavior |
| `packages/ui/src/components/Popover.tsx` | modal opt-in, owner-local fallback/native handling, shared ancestry and stale guards | stop treating every popover as modal and remove duplicate dismissal |
| `packages/ui/src/components/Select.tsx` / `Combobox.tsx` | shared portal placement and removal of competing outside listener where applicable | retain listbox/combobox semantics with shared geometry |
| `packages/ui/src/components/FocusTrap.tsx` | owner document/window and explicit `restoreFocus` opt-out | prevent duplicate focus restoration for one explicit handoff |
| `packages/ui/src/components/Tooltip.tsx` | owner-document root and guarded placement | keep tooltip below active interactive menu layers |
| `packages/ui/src/components/index.ts` | public exports | make contracts available without deep imports |

### High-impact consumers

- `packages/editor/src/Menubar.tsx` and
  `packages/editor/src/menu/menubarSubmenu.tsx`: exact top-level/item anchors,
  logical submenu fallback, menu conflict/reset, pointer switching.
- `packages/editor/src/canvas/inputPipeline.ts`, `CanvasArea.tsx`, and
  `Shell.tsx`: client points are explicit viewport points; keyboard canvas
  invocation uses selected object screen geometry or the canvas viewport and
  never canvas-world coordinates directly. Canvas menus snapshot the active
  document, session, page, workspace, and selection, and close on mismatch
  before live command definitions can target a different context.
- `packages/editor/src/components/LayersPanel/{index,LayersTree}.tsx` and
  `useTreeKeyboardNavigation.ts`: row anchor/context snapshot, keyboard reveal,
  stale target close.
- `packages/home/src/{HomeShell,FileContextMenu}.tsx`: file anchor and target
  snapshot, dialog actions declare focus transfer.
- Inspector, toolbar, breadcrumb, timeline, text bar, selection quick bar,
  panel detach, and command surfaces listed in the inventory now use shared
  placement/ownership where their content allows it.
- `packages/editor/src/components/QuickActionsBar/QuickActionsBar.tsx`: the
  command surface now uses a point/explicit anchor and shared measured portal;
  `FocusTrap` remains because its dialog/listbox semantics are distinct.

### CSS and semantics

The outer portal owns fixed geometry; inner menu/popover content is static.
This was applied to editor submenu, context-menu, Inspector section manager,
variable modifier, text bar, and Quick Actions styles. Rich picker content was
changed from an invalid menu/menuitemradio tree to a labelled group/radio
surface. No label-based action closing was introduced; item policy is explicit.

## Verification and evidence

### Real-input Chromium E2E

Command:

```text
VARVE_E2E_PORT=1502 pnpm exec playwright test \
  tests/e2e/menus/overlay-reliability.spec.ts \
  --project=chromium --workers=1 --reporter=line
```

Result: passed. The complete `tests/e2e/menus` collection was 43/44 passed;
the only failure was the unrelated browser chrome y-offset assertion recorded
below. The test drives real pointer and keyboard events and asserts
independent relationships between reference/target rectangles, viewport
containment, vertical overlap, submenu action delivery, Escape unwinding,
owner/portal metadata, and the debug trace. It covers:

- File → Logo pointer flyout;
- Layers row right-click → Select flyout → child activation;
- Layers Shift+F10 with a focused row;
- canvas Shift+F10;
- Escape child then root;
- no visible initial jump by requiring the visible state only after a finite
  settled rectangle;
- final absence of the context/submenu registration after activation/close.

Captured artifacts from the final passed run:

- `test-results/run-3703813-1502/menus-overlay-reliability--8436c-attached-through-real-input-chromium/menubar-file-logo.png`
- `test-results/run-3703813-1502/menus-overlay-reliability--8436c-attached-through-real-input-chromium/layers-context-select.png`
- `test-results/run-3703813-1502/menus-overlay-reliability--8436c-attached-through-real-input-chromium/layers-context-keyboard.png`
- `test-results/run-3703813-1502/menus-overlay-reliability--8436c-attached-through-real-input-chromium/canvas-context-keyboard.png`

Manual inspection found the File menu aligned below File, Logo's submenu
aligned to the Logo item, and the Layers Select submenu attached to the Select
row and within the 1280×720 viewport. The keyboard screenshots are final
post-Escape evidence rather than a claim that the closed state is itself a
menu screenshot; the E2E geometry assertions cover the open keyboard state.

### Focused tests and component evidence

| Command | Result |
|---|---|
| `VARVE_TEST_WORKERS=1 pnpm exec vitest run [36 explicitly listed overlay-related files] --reporter=dot` | 36 files, 413 tests passed |
| `pnpm exec playwright test tests/e2e/menus/visual-integrity.spec.ts --project=chromium --workers=1` | 5/5 passed |
| `VARVE_E2E_PORT=1503 pnpm exec playwright test tests/e2e/menus --project=chromium --workers=1 --reporter=list` | 43/44 passed; one unrelated chrome y-offset failure |
| `pnpm typecheck:e2e` | passed |
| `pnpm desktop:preflight` | passed |

Baseline context: before this slice the focused shared-menu set was 162/186
passing; the 24 failures were existing snapshot expectations for the dirty
branch's `toggleMarqueeContainment` item. The pre-existing menu E2E suite was
42/43; its one failure was the existing empty Layers axe tree/status
relationship. Those failures were not hidden or rewritten as overlay fixes.

### Geometry/event/focus trace

| Time | Event | Target | Phase | Overlay | Decision |
|---|---|---|---|---|---|
| t0 | `contextmenu` | Layers row | native input | none | capture client point, row, IDs, owner document |
| t1 | anchor creation | row + virtual point | layout | context-menu root | `ViewportPoint`, portal owner body |
| t2 | registration | portal layer | layout | stable root ID | one owner-document registry entry |
| t3 | placement | virtual point | async guarded result | root | hidden → finite fixed rectangle, edge-safe |
| t4 | submenu hover | Select menuitem | React pointer | submenu child | exact item ref; parent ID registered |
| t5 | child click | Select Same Type | pointer/click | child | composed path is inside child/parent; action receives click |
| t6 | action | command registry | application | root + child | target snapshot retained; tree closes |
| t7 | Escape | focused menu/row | keydown | deepest active | child first, then root; focus returns predictably |
| t8 | cleanup | portal nodes | effect teardown | all closed | autoUpdate, mutation observer, registry entries removed |

The development bridge records `anchor-measured`, `placement-computed`,
`outside-event`, `escape`, `close-requested`, and `placement-cleanup` with
owner window, parent ID, placement, middleware data, and safe viewport. It can
be enabled with `window.__varveOverlayDebug.enable()` in development.

### Performance and leak evidence

The registry has one pointer listener and one key listener per owner document,
plus an optional owner-window blur listener, instead of one listener per menu
level. `autoUpdate` is installed only while a surface is open. Unit tests cover
idempotent cleanup, bounded traces, root conflict, descendant containment, and
one-close-per-registration. A 1,000-open stress benchmark, heap snapshot, and
native secondary-window listener count were not run in this slice and remain
release-gate work.

## Accessibility decisions

- Menubars retain `menubar`, `menu`, `menuitem`, checkbox/radio item roles,
  `aria-haspopup="menu"`, and expanded/checked state as appropriate.
- Select/Combobox retain listbox/combobox semantics and do not become menus.
- Rich color, gradient, variable, and section surfaces use dialog/group/form
  semantics, not menu roles.
- Disabled menu behavior remains the existing Varve policy: disabled items
  expose disabled state and cannot activate; the exact focusability policy is
  primitive-specific and needs the wider APG audit before being declared
  uniform.
- Type-ahead and stable item IDs remain in the menubar/menu renderer; the new
  placement layer does not rebuild definitions on pointer movement.
- Focus is tested for keyboard context invocation, submenu Left/Escape, Tab
  exit in existing menu tests, and action/command surface restoration.
- Forced-colors, full screen-reader speech, stylus, and 200% text-scale
  screenshots are not claimed here; the CSS and semantic changes preserve
  focus-visible and high-contrast hooks but need platform evidence.

## Platform and top-layer findings

- Browser fixed portals now use the event/anchor owner document and are safe
  from the primary-window assumption in the shared path.
- A closest native dialog is selected as portal root so a menu/listbox opened
  inside a dialog remains in the dialog's top-layer stacking context.
- Native Popover remains a separate top-layer option and is not mixed with a
  custom body portal in one dismissal path.
- Tauri Linux Wayland, Windows scaling, macOS native conventions, actual
  WebKitGTK runtime, and detached window invocation still require runtime
  verification. `desktop:preflight` checks build/environment readiness only;
  it is not a behavioral Tauri test.
- `PanelDragHandle`'s transient drag indicator and canvas-world editing
  overlays intentionally remain feature-owned; they are not menu surfaces.

## Residual-risk report

| Risk | Impact | Follow-up |
|---|---|---|
| Native Tauri/custom menu parity unverified | duplicate accelerators or state drift could remain on desktop | run Linux Wayland, Windows, macOS native menu matrix against action IDs |
| Detached panel actual browser/Tauri run unverified | a consumer may omit explicit anchor/owner when using a ref-only path | add a multi-window Playwright/Tauri fixture and assert document/window IDs |
| ShortcutPalette still owns a modal body portal | secondary-window ownership and shared registry are not yet uniform | migrate the modal shell through an owner-document dialog/portal adapter |
| TextEditOverlay and other canvas overlays are specialized | world-space/UI-space mistakes can recur if a UI popup is added there | classify each as canvas overlay vs UI popup before migration |
| Plugin-contributed popup contract is not enforced | third-party surfaces can reintroduce global listeners/roles | require an overlay adapter and registration API in plugin host |
| Pointer-intent uses a short delay, not a safe polygon | very diagonal movement with dense menus may still flicker | add geometry-corridor tests and tune from recordings |
| Long translated/200%/RTL visual matrix incomplete | clipping or shortcut-lane regressions may be localization-specific | add visual projects and inspect artifacts manually |
| Full leak/performance stress incomplete | slow accumulation may evade unit tests | add 1,000-open trace/listener/heap test and performance marks |
| Pre-existing browser chrome assertion | broad menu gate is 43/44; `role=menubar` measured y≈7.73px against a ≤4px guard | isolate the concurrent shell/grid chrome change and repair with its owner |

## Next smallest coherent slice

The next slice is detached-window and native-menu verification. Prerequisites:

1. freeze the concurrent branch and record a new SHA;
2. expose a deterministic detached-window test fixture or Tauri harness;
3. migrate ShortcutPalette's modal shell to the owner-document adapter;
4. instrument native/custom action dispatch IDs and accelerator counts;
5. run exact Linux Wayland behavior first, then Windows/macOS or disclose the
   unavailable hosts.

Rollback is limited to the new shared UI files and their consumer imports:
revert the overlay slice as a coherent commit once the worktree is isolated;
do not reset this dirty branch or discard unrelated changes. The semantic
menu definitions and canonical action registry are intentionally unchanged.
