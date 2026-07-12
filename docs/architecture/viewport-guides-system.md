# Viewport and Guides System

**Updated:** 2026-07-12

## Target Model

Strata currently has one production viewport and guide implementation in the
shared React editor package:

- `packages/editor/src/CanvasArea.tsx` owns the live canvas DOM event pipeline,
  draw scheduling, guide/ruler overlays, and tool dispatch.
- `packages/shared/src/viewport.ts` owns camera math.
- `packages/scene/src/document.ts` owns persisted document guides.
- `apps/desktop` hosts the shared editor in Tauri 2. The configured Tauri app has
  one native window label, `main`; native multi-window viewport state is not
  implemented.
- `apps/web` is still a stub. The browser-runnable workflow today is the Vite
  frontend from `apps/desktop`, served in a normal browser tab for development
  and Playwright. Multiple browser tabs are independent page loads; there is no
  shared JS heap or BroadcastChannel-backed viewport synchronization.

The practical split is therefore:

| Concern | Tauri desktop | Browser dev/web |
|---|---|---|
| Viewport implementation | Shared editor DOM events inside the webview | Same shared editor DOM events |
| Window model | One configured native window today | One browser tab per load |
| In-app tabs | `EditorProvider` sessions, per-tab viewport snapshots | Same |
| Native multi-window | Not implemented | Not applicable |
| Reserved shortcuts | Tauri can add native menu/global shortcut handling later | Browser/OS reserved shortcuts remain constrained |
| File/fullscreen permissions | Tauri commands/capabilities available | Browser File System and Fullscreen APIs require browser permissions and user activation |

## Coordinate Spaces

The canonical camera transform lives in `@strata/shared/viewport`:

```
screen = T(pan) * T(viewportCenter) * R(rotation) * T(-viewportCenter)
       * S(zoom) * T(-floatingOrigin) * world
```

`pan` is stored in canvas-area CSS pixels. DPR is applied separately to the
Canvas2D context. The floating origin is recomputed from the camera to keep large
world coordinates numerically stable during replay.

When a caller has a real canvas viewport, it must pass that viewport to
`zoomAboutPoint`. The origin-aware path keeps the chosen world anchor stable at
the same screen coordinate across zoom changes, including view rotation. Calling
`zoomAboutPoint` without a viewport keeps the older zero-origin behavior for
legacy math tests and non-editor utility callers.

## Guides and Rulers

Guides are persisted on `Document.guides` and are not part of rendered/exported
IR. Rulers and guide overlays are editor UI layers only.

Current behavior:

- Dragging from the top ruler creates one vertical guide and moves that same
  guide during the drag.
- Dragging from the left ruler creates one horizontal guide and moves that same
  guide during the drag.
- Right-clicking a guide opens the guide context menu for lock/unlock and delete.
- Locked guides cannot be dragged, but they remain visible and snap targets.
- Objects snap to permanent ruler guides when snapping is enabled. Guide snapping
  has lower priority than the explicit snap grid and higher priority than object
  edge/center snapping.

Guide creation returns the created guide id from `editor.addGuide(...)`. This is
used by the ruler so a drag can create once, then call `moveGuide(id, position)`
for subsequent pointer movement.

## Input Pipeline

Canvas navigation is driven by DOM events in `CanvasArea`:

- Pointer events route through `ToolManager` for drawing/selection tools.
- Touch two-pointer pinch bypasses tools and updates pan/zoom directly.
- Wheel events are attached natively with `{ passive: false }` so Ctrl/Cmd-wheel
  pinch-zoom can call `preventDefault()` instead of fighting browser page zoom.
- Wheel `deltaMode` is normalized: pixel, line, and page deltas are converted to
  CSS-pixel intent before applying pan/zoom.
- Pointer capture failures are caught and logged so drag-to-create tools do not
  silently abort before entering their drag state.

Browser and Tauri currently share this pipeline because Tauri forwards webview DOM
events. Native Tauri shortcut/window APIs are not used for viewport commands yet.

## Research Notes

Access date: 2026-07-12.

- Adobe Illustrator docs distinguish global and artboard rulers and describe
  creating guides by dragging from the top or left ruler:
  https://helpx.adobe.com/illustrator/desktop/measure-and-align/grids-and-guides/about-rulers.html
  and
  https://helpx.adobe.com/illustrator/desktop/measure-and-align/grids-and-guides/align-graphic-objects-with-guides.html
- Adobe InDesign docs describe snap-to-guide behavior as dragging an object near
  a ruler guide until an edge enters the snap zone:
  https://helpx.adobe.com/indesign/desktop/layout-and-grid-tools/rulers-and-measure-tools/snap-objects-to-guides.html
- Figma help documents layout guides, keyboard canvas navigation, and accessible
  guide adjustment workflows:
  https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides
  and
  https://help.figma.com/hc/en-us/articles/35063862380311-Accessibility-at-Figma
- MDN `wheel` event docs confirm wheel events cover wheel-like trackpad devices
  and expose `deltaMode`; this drove native non-passive wheel handling plus
  delta-mode normalization:
  https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
- W3C Pointer Events and MDN PointerEvent docs confirm pointer capture and
  coalesced/predicted event concepts. This supports keeping the editor on a
  unified pointer-event pipeline:
  https://www.w3.org/TR/pointerevents/
  and
  https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent
- MDN Fullscreen and File System API docs confirm browser permission/user-gesture
  constraints that do not map 1:1 to Tauri native capabilities:
  https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
  and
  https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- Tauri 2 docs confirm windows/webviews are label-addressed and capabilities are
  scoped to windows/webviews. Native multi-window is possible but not wired into
  Strata's viewport state today:
  https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/
  and
  https://v2.tauri.app/security/capabilities/

## Prioritized Backlog

Shipped this session:

1. P0 correctness: origin-aware cursor zoom for real editor viewports.
2. P0 data integrity: ruler drag creates one guide instead of appending a guide
   on every pointer move.
3. P1 parity: permanent ruler guides participate in object snapping.
4. P1 regression coverage: focused unit tests plus a Chromium Playwright test
   for the actual ruler drag workflow.

Deferred:

1. P0/P1 native Tauri E2E: no tauri-driver/WebDriver harness is configured in
   this repo. Current E2E coverage runs the shared frontend in Chromium.
2. P1 keyboard-only guide creation and adjustment UI. Figma documents an
   accessible guide adjustment workflow; Strata currently exposes guide context
   operations by pointer/context menu only.
3. P1 per-target shortcut documentation in-app. Browser-reserved shortcuts are
   not surfaced to users yet.
4. P2 guide visibility, page-scoped guides, and guide copy/paste. The document
   model currently stores all guides at document level.
5. P2 full visual regression matrix for light/dark/high-contrast guide rendering.
   Token styling exists, but only the new Chromium workflow was directly executed
   this session.
6. P2 performance benchmark for hundreds/thousands of guides. Existing tests
   cover snapping behavior, not a guide-heavy overlay frame budget.

## Verification Added

- `packages/shared/src/viewport.test.ts`: viewport-aware zoom anchoring with
  floating origin and rotation.
- `packages/editor/src/tools/__tests__/snapping.test.ts`: snap-to-guide targets
  and priority.
- `packages/editor/src/components/Ruler/Ruler.test.tsx`: one guide per ruler
  drag, moved by id.
- `tests/e2e/canvas/guides.spec.ts`: Chromium browser workflow for ruler drag.

