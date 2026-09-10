# Pen and Pencil Tools — Architecture

Last updated: 2026-08-25

## Overview

Pen and Pencil are vector path creation tools sharing the same scene model:
`ShapeNode` with `shape.kind === 'path'`. Anchors are stored in **node-local**
space; handles are **relative offsets** from each anchor.

## Pipeline

```
PointerEvent (canvas)
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

Pen stays active after each path commit (multi-path workflow).

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

| Concern | Browser (`pnpm dev`) | Tauri (WebKitGTK) |
|---|---|---|
| Pointer capture | `setPointerCapture` on canvas | Same |
| `pointerType: "pen"` | Chrome/Firefox: yes | **No — always mouse** |
| `pressure` | Stylus: real | Stuck at 0.5 |
| `getCoalescedEvents` | Chrome/Firefox/Safari 18.2+ | Stub on GTK |
| Fractional scaling | Use doubles end-to-end; rect subtract in buildToolCtx | Same code path |

Pencil degrades gracefully on Linux Tauri: geometry-only smoothing, no pressure width.

## Testing

| Layer | Location |
|---|---|
| Unit | `tools/__tests__/PenTool.test.ts`, `PencilTool.test.ts`, `pathCoords.test.ts` |
| Contract | `__tests__/createShapeAt.path.test.ts` |
| E2E | `tests/e2e/canvas/pen-pencil.spec.ts` |

E2E verifies document state and canvas paint, plus live overlay screenshots for
anchors, handles, curvature, and closure. It does **not** measure stylus feel or
pressure.

## Research Sources (2026-07-13)

- Figma vector networks: https://help.figma.com/hc/en-us/articles/360040450213
- Illustrator pen: Adobe CC manual / Smart Notes
- Inkscape keys: https://inkscape.org/doc/keys092.html
- WebKitGTK pen limitation: https://github.com/tauri-apps/tauri/issues/10636
- Wayland fractional scale: https://wayland.app/protocols/fractional-scale-v1
