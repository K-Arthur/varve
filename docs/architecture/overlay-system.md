# Overlay system

Status: current architecture (2026-08-31).

Varve has one shared floating-geometry and ownership layer, while keeping the
interaction contracts of menus, listboxes, comboboxes, popovers, toolbars,
tooltips, and dialogs separate. The shared layer is implemented by
`@varve/ui`'s `FloatingPortal`, `overlayGeometry`, and `OverlayRegistry`.

## Responsibility boundary

The shared layer owns:

- explicit anchor and coordinate-space contracts;
- owner `Document`/`Window` resolution;
- window-local portal roots (including a containing native dialog);
- fixed-position measurement and Floating UI collision handling;
- hidden initial measurement and stale-placement cancellation;
- stable overlay IDs, parent IDs, and descendant-tree containment;
- one pointer listener, one keyboard listener, and one blur listener per owner
  document/window while overlays are registered;
- diagnostics, placement traces, and cleanup.

Semantic primitives retain their own behavior:

| Primitive | Owns | Does not inherit automatically |
|---|---|---|
| Menubar/menu/submenu | APG roving focus, type-ahead, item activation, pointer intent | Dialog focus trap or listbox selection semantics |
| Context menu | Invocation snapshot, point/element keyboard anchor, context-specific commands | Current selection unless the command explicitly chooses it |
| Select/listbox | Value highlight, disabled options, `aria-activedescendant`, selection commit | Menu close-before-action policy |
| Combobox | Text input, filtering, editable-value commit | Menu roles for its options |
| Popover | Modal/nonmodal choice, native Popover API compatibility, optional focus trap | Menu keyboard behavior |
| Dialog | Native dialog/top-layer semantics, modal backdrop, dialog focus policy | Light-dismiss semantics of a nonmodal popover |
| Tooltip | Noninteractive hover/focus disclosure | Pointer dismissal or focus trapping |
| Rich toolbar/editor | Toolbar/form semantics and editing transactions | `role="menu"` or menu item navigation |

This boundary prevents a color picker or form-bearing inspector surface from
being made into a menu merely because it floats beside a control.

## Lifecycle

```text
native input
    │
    ▼
invocation handler ── capture immutable command/context snapshot
    │
    ▼
explicit anchor (element, viewport point, or range)
    │                 │
    │                 └─ owner document/window + local portal host
    ▼
OverlayRegistry registration (stable id + valid parent branch)
    │
    ▼
FloatingPortal renders hidden at a neutral position
    │
    ▼
Floating UI: offset → flip → shift → size → hide
    │
    ▼
visible paint + geometry trace + semantic primitive focus handoff
    │
    ├─ pointer/keyboard navigation
    ├─ child registration (parent overlay id)
    └─ command activation (validate snapshot, close tree, dispatch once)
    │
    ▼
deepest-first dismissal → focus handoff → placement/timer/listener cleanup
```

An async placement result is accepted only while the opening generation,
owner document, and mounted floating node still match. Closing or changing an
anchor invalidates the generation; a late promise cannot make a closed surface
visible again.

## Coordinate and anchor contracts

`overlayGeometry.ts` deliberately names spaces that were previously passed as
unqualified `{ x, y }` objects:

| Type | Meaning | Valid as a fixed Floating UI point? |
|---|---|---|
| `ViewportPoint` | CSS viewport/client coordinates (`clientX/Y`) | Yes |
| `PagePoint` | document coordinates (`pageX/Y`) | Only after `pageToViewport` |
| `ScreenPoint` | OS screen coordinates (`screenX/Y`) | No |
| `CanvasWorldPoint` | document/canvas scene coordinates | No; convert through the camera |

Use `pointAnchor(viewportPoint(event.clientX, event.clientY), ownerDocument,
contextElement)` for a context menu. The resulting virtual reference is a
zero-size client rectangle at the invocation point. `contextElement` is
optional metadata used for clipping and ownership; it does not change the
point.

Use `elementAnchor(element)` (or the compatibility `anchorRef` prop) for a
trigger, parent menu item, toolbar button, or inspector field. Use
`rangeAnchor(range, contextElement)` for text/range UI. A submenu must use the
currently rendered parent item as its element anchor, never the parent menu
container.

`pageToViewport` is the only supported conversion from page coordinates to a
fixed overlay point. Canvas-world values must go through the active camera
(`worldToCanvas`/`worldToScreen`) before creating a `ViewportPoint`; canvas
zoom is never an input to menu placement.

## Owner documents and portal hosts

The owner document is derived in this order:

1. element anchor's `ownerDocument`;
2. point anchor's explicit `ownerDocument`;
3. range anchor's start container document;
4. an explicit fallback document.

The portal host is a containing native `<dialog>` when the contextual element
is inside one; otherwise it is `ownerDocument.body` (or the document element
as a last resort). All viewport dimensions, scroll behavior, `MutationObserver`
instances, animation frames, and event listeners are resolved from that owner
window. A detached-window integration must pass an element/point anchor from
that window and must not pass the main-window `document.body` as its host.

## Placement and sizing

`FloatingPortal` uses `strategy: "fixed"` because its coordinates are viewport
coordinates. Default placements are:

| Surface | Preferred | Fallbacks |
|---|---|---|
| Menubar dropdown | `bottom-start` | Floating UI `flip`/`shift` |
| Submenu | logical inline-end `right-start` | logical inline-start `left-start`, then vertical shift |
| Context menu | point-aligned `bottom-start` | `top-start`, `bottom-end`, `top-end` |
| Inspector/toolbar popover | control-relative side | caller-provided opposite side, then shift |
| Range/editor surface | `top-start` | `bottom-start`, side placements |

RTL menus set `logicalPlacement`; physical left/right are swapped before
Floating UI collision handling. The safe viewport has an 8 CSS-pixel inset,
nonnegative dimensions, and is computed from the owner window. Floating UI's
`offset`, `flip`, `shift`, `size`, and `hide` middleware are applied in that
order. Long surfaces scroll inside their measured available height; fixed item
counts are only a legacy compatibility option.

The portal root is initially `visibility:hidden; pointer-events:none` at
`left:0; top:0`. It becomes interactive only after a finite placement result
is committed. Content width is stable (`box-sizing:border-box`, max-content
outer layer, reserved menu lanes); any dynamic label, font, theme, or item
change reruns the placement effect.

Element anchors use Floating UI `autoUpdate` while open. Point anchors remain
fixed to their invocation point by policy; a contextual element is retained
for clipping/diagnostics but scrolling does not silently turn a point into a
page coordinate. Range anchors update through their context element when one
is provided. A disconnected element/range anchor closes with
`anchor-detached`.

## Overlay tree and dismissal

`OverlayRegistry` is per owner document. Every registered surface has a stable
ID. Child registrations carry the parent ID through `OverlayParentContext`,
which survives React portals. The registry classifies a composed event path
against the current node, anchor, auxiliary elements, and every registered
descendant. Therefore a click in a portaled submenu is inside its parent tree.

```text
root menu (id: m1)
├── submenu (id: m1:s1, parentId: m1)
└── rich popover (id: m1:p1, parentId: m1)  [when intentionally nested]
```

Only one registered submenu branch is rendered by each menu level. Closing a
parent requests `parent-close` for descendants deepest-first. Closing a child
does not close its parent. Root menu kinds (`menubar-menu`, `action-menu`, and
`context-menu`) replace an existing conflicting root in the same owner
document.

| Close reason | Default result |
|---|---|
| `escape` | deepest dismissible layer; menu child returns focus to parent item |
| `left-arrow` | submenu only; focus returns to parent item |
| `tab` | full menu tree; walk focus past the invoking control |
| `outside-pointer` | relevant outside branch/tree; descendants first |
| `action` | full command tree before action dispatch |
| `trigger-toggle` | current trigger's tree |
| `open-sibling` | old conflicting root and descendants |
| `parent-close` | child requested as part of parent teardown |
| `anchor-detached` | surface closes; stale target cannot be invoked |
| `context-invalidated` / `document-change` / `workspace-change` | close or re-open from fresh context |
| `window-blur` | transient owner-window overlays close |
| `programmatic` | caller-selected tree/all-overlay cleanup |

Pointer dismissal is capture-phase and happens once per owner document. A
child click is recognized as inside the ancestor before any close request;
child item activation therefore reaches its handler. Menu actions close before
dispatch, and only an explicit `focusTransfer` suppresses the root menu's
ordinary focus restoration so a newly opened dialog keeps focus.

## Accessibility and semantics

Menus follow the APG menubar/menu model: a composite menubar, `role="menu"`,
`menuitem`, `menuitemcheckbox`, `menuitemradio`, `aria-haspopup="menu"`,
`aria-expanded`, `aria-checked`, roving `tabIndex`, type-ahead, Home/End,
Left/Right submenu traversal, Escape, and Tab exit. Disabled menu items are
rendered with native `disabled` plus `aria-disabled` where the surrounding
primitive needs the state exposed.

Select and Combobox retain listbox/combobox semantics and do not use menu
roles. Rich color, binding, section-management, and tool-option surfaces use
dialog/popover/form semantics. Nonmodal popovers do not inert the application;
modal popovers opt into focus containment/inert behavior. Tooltips remain
noninteractive and are below active menus in the z policy.

## Layering policy

The UI token ladder remains the source of truth, with one intentional
exception for noninteractive tooltips:

```text
canvas < sticky chrome < dropdown/menu/listbox/rich popover
       < modal dialog/scrim < nested dialog < toast/emergency notice
```

Portaled menus, listboxes, and rich popovers use `--z-overlay`; dialogs and
native top-layer surfaces retain their dialog-specific policy. Transient
tooltips use `--z-popover` so they remain below an active menu and cannot
obscure its items. A portal inside a native dialog stays in that dialog's
owner host so it cannot fall behind the dialog backdrop. No overlay feature
should introduce an arbitrary extreme z-index. Canvas editing overlays (for
example the inline text textarea) remain separate because their CSS transform
is the camera-rendered world-to-screen transform rather than menu geometry;
they still need an owner-window migration before detached canvas windows are
enabled.

## Diagnostics

In development/tests, call `window.__varveOverlayDebug.enable()` (the bridge is
installed separately in each owner window). The bridge exposes:

- `snapshot()`: ID, kind, parent, owner window, portal host, node/anchor rects;
- `trace()`: registration, measurement, placement, outside classification,
  close reason, and cleanup events.

The menu E2E fixture records this data together with the native event target,
coordinates, active element, owner window, portal host, safe viewport, and
screenshots. Production does not render a diagnostics HUD.

## Contributor rules

1. Choose the semantic primitive first; do not turn form content into a menu.
2. Pass an explicit `elementAnchor` or `pointAnchor(viewportPoint(...))` for
   new floating UI. Do not add a plain `{x, y}` overlay contract.
3. Use the current parent item ref for every submenu.
4. Keep owner-document derivation and portal selection in the shared layer.
5. Declare close behavior and whether an action transfers focus.
6. Snapshot context-sensitive targets at invocation and validate them at
   activation.
7. Add a geometry/event-order test and a real Playwright interaction for
   pointer/canvas changes.
8. Verify no listeners, timers, auto-update loops, portal nodes, inert state,
   or stale placement commits survive close.

Relevant implementation and tests:

- `packages/ui/src/components/overlayGeometry.ts`
- `packages/ui/src/components/OverlayRegistry.ts`
- `packages/ui/src/components/FloatingPortal.tsx`
- `packages/ui/src/components/Menu.tsx`
- `packages/ui/src/components/Popover.tsx`
- `packages/ui/src/components/{overlayGeometry,OverlayRegistry,FloatingPortal,Menu,Popover,Select,Combobox}.test*`
- `tests/e2e/menus/overlay-reliability.spec.ts`
