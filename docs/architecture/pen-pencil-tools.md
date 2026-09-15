# Pen and Pencil Tools — Architecture

Last updated: 2026-09-13

## Overview

Pen and Pencil are vector path creation tools sharing the same scene model:
`ShapeNode` with `shape.kind === 'path'`. Anchors are stored in **node-local**
space; handles are **relative offsets** from each anchor.

## Pipeline

```
PointerEvent (canvas)
  → inputPipeline pointer-ownership policy
  → CanvasArea.buildToolCtx (rect-subtract, forward pathPoints)
  → ToolManager → PenTool | PencilTool
  → world-space capture (canvasToWorld)
  → PenConstructionDraft → camera-aware overlay (anchors, handles, cubic path)
  → commit: createShapeAt | updateNode
  → createShapeAt rebases anchors to local, sets transform at origin world point
  → Document → buildIr → replayIr (cubic bezier paintPathFill)
```

## Pen Tool

Pen construction is an ephemeral interaction surface. `PenTool` publishes a
`DraftShape` with `kind: 'bezier-path'` after every anchor/handle/pointer
change; `canvas/penConstructionPreview.ts` draws the actual cubic segments,
screen-constant anchors, tangent handles, future rubber-band, and close-target
affordance. No document mutation or history entry occurs until finish/close.
The preview uses the same point/relative-handle convention as the committed
`PathPoint[]` representation, including the closing segment.

| Input | Behavior |
|---|---|
| Click | Corner anchor |
| Click-drag (>3px) | Smooth anchor, symmetric handles (⅓ chord) |
| Shift | 45° segment/handle snap |
| Alt-drag | Break handle symmetry |
| Hover/click first point | Highlight close target; close path (`closed: true`) |
| Enter / double-click | Finish open path |
| Escape (2+ pts) | Finish open path |
| Escape (dragging) | Cancel in-progress handle |
| Click path endpoint | Continue existing path; either endpoint is oriented for continuation |

While a Pen draft is visible, the canvas overlay exposes labeled **Finish**,
**Close**, **Cancel**, and **Undo anchor** buttons. They dispatch directly to
the active `PenTool`, so a touch user does not need a keyboard or a close-target
hover; disabled states reflect whether the current draft can perform Close or
Undo Anchor.

Pen stays active after each path commit (multi-path workflow).

### Contact ownership and cancellation

`packages/editor/src/tools/inputPolicy.ts` is the DOM-free contract shared by
the canvas adapter and tools:

- every contact is tracked by `pointerId`; `button` is a transition while
  `buttons` is the active state;
- the default one-finger policy is **Finger draws**. Settings can switch to
  **Finger navigates**; unknown/custom pointer types follow that preference so
  users are not stranded in a pen-only mode when a WebView cannot identify a
  stylus;
- a second touch after a provisional drawing contact returns the original
  owner ID. Only that interaction is cancelled; global undo is never used as a
  gesture repair mechanism. Both contacts then belong to navigation;
- a touch left after a pinch remains navigation-only until a fresh contact, so
  it cannot turn into an accidental stroke;
- an active pen owns the drawing surface. Foreign touch/compatibility contacts
  are ignored while the pen contact remains intact;
- `pointercancel`, lost capture, blur, visibility changes, deactivation, and
  tool changes are idempotent cleanup paths. A normal pointer-up is not treated
  as an abort, and Pen's Escape/finish/close/undo-anchor semantics remain
  distinct.

The browser adapter scopes `touch-action` to the canvas surface. Panels, text
fields, context menus, OS gestures, and accessibility zoom are not globally
disabled. See the [input behavior matrix](input-system-behavior-matrix.md) and
the dated [drawing-input audit](../audits/drawing-input-quality-audit-2026-09-13.md)
for route-specific evidence and physical-device limits.

## Pencil Tool

| Stage | Algorithm |
|---|---|
| Capture | rAF + `getCoalescedEvents` when available |
| Simplify | Ramer-Douglas-Peucker, zoom-aware epsilon (2 screen px) |
| Fit | Schneider least-squares cubic Bezier |

Shortcut: **Shift+P** (not N — N is unused; Illustrator uses N but conflicts with browser find-on-page in web build).

## Coordinate Invariants

1. Tools work in **world space** during capture.
2. `createShapeAt(world, …, pathPoints)` rebases: `local.x = world.x - origin.x`.
3. Node `transform` translation = first anchor world position.
4. Continue-path: load local→world for editing; commit world→local via `pathPointsWorldToLocal`.

Module: `packages/editor/src/tools/pathCoords.ts`

## Deployment Targets

| Concern | Chrome tab / installed PWA | Tauri Linux (system WebKitGTK) |
|---|---|---|
| Pointer capture | Feature-detected `setPointerCapture`; cancellation is handled | Same contract, WebKitGTK behavior must be observed |
| `pointerType` | Preserved when reported; custom/empty values become `unknown` | Runtime-specific; no universal pen claim |
| Pressure/tilt/twist/eraser | Preserved when reported; observed capability starts unknown | Unknown until the installed WebKitGTK/device route is tested |
| Coalesced/predicted samples | Coalesced baseline; prediction is replaceable preview only | Feature-detected, throwing/missing APIs fall back safely |
| Fractional scaling | CSS/client → canvas/world stays in doubles | Same code path; actual Crostini scaling remains a manual check |

Pencil and Paint degrade to constant-width/opacity behavior when pressure is
disabled or not useful. A successful Linux launch does not establish pen
pressure, tilt, eraser, or multitouch support.

## Testing

| Layer | Location |
|---|---|
| Unit | `tools/__tests__/PenTool.test.ts`, `PencilTool.test.ts`, `pathCoords.test.ts` |
| Contract | `__tests__/createShapeAt.path.test.ts` |
| E2E | `tests/e2e/canvas/pen-pencil.spec.ts` |

E2E verifies document state and canvas paint, plus live overlay screenshots for
anchors, handles, curvature, and closure. It does **not** measure stylus feel or
pressure.

## Research Sources (refreshed 2026-09-13)

- Figma vector networks: https://help.figma.com/hc/en-us/articles/360040450213
- Illustrator Pen tool (official guide, last updated 2026-02-25):
  https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-curves-with-the-pen-tool.html
- Illustrator path preview (official guide, last updated 2026-02-11):
  https://helpx.adobe.com/uk/illustrator/desktop/draw-shapes-and-paths/draw-shapes/preview-paths-drawn.html
- Inkscape keys: https://inkscape.org/doc/keys092.html
- WebKitGTK pen limitation: https://github.com/tauri-apps/tauri/issues/10636
- Wayland fractional scale: https://wayland.app/protocols/fractional-scale-v1
- Pointer Events Level 3 (W3C Recommendation, 2026-06-30):
  https://www.w3.org/TR/pointerevents3/
- Pointer events, pressure, multitouch, and `touch-action` (MDN; accessed
  2026-09-13):
  https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
  https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure
  https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action
- Chrome low-latency canvas and aligned input guidance (accessed 2026-09-13):
  https://developer.chrome.com/blog/desynchronized
  https://developer.chrome.com/blog/aligning-input-events/
- Tauri v2 webview versions (accessed 2026-09-13):
  https://v2.tauri.app/reference/webview-versions/

The dated drawing-input audit records the decisions, complaint-derived failure
modes, route matrix, and source uncertainties in one place.

The first-party Pen references reinforce two interaction decisions: a visible
rubber-band/live curve preview is useful while placing the next anchor, and
closing should be discoverable by hovering the hollow first anchor. Varve
implements those behaviors for pointer input and keeps Finish/Close/Cancel
actions available to touch users without requiring the reference applications'
modifier keys.
