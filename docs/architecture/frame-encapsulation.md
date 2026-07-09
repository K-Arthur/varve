# Frame Encapsulation Engine

## Overview

The frame encapsulation engine provides the spatial containment logic that makes frames behave as true containers. It enables:

- **Live drag highlighting**: a dashed highlight around the frame that will receive the dragged selection.
- **Frame capture-on-draw**: drawing a frame over existing sibling shapes automatically reparents fully contained shapes into the new frame.
- **Efficient containment queries**: a frame/group-only spatial index with fingerprint invalidation keeps drag feedback fast.

## Data model

- `FrameNode` is a container with `children`, `w`, and `h`.
- `GroupNode` is also a container and participates in containment queries.
- Nodes live in a flat `doc.nodes` map with parent relationships tracked by `buildParentIndexMap`.

## Components

### 1. Spatial index (`packages/editor/src/scene/spatialIndex.ts`)

- `buildFrameSpatialIndex(doc)` builds a 64px-grid spatial index of frame/group nodes.
- `computeFrameFingerprint(doc)` returns a hash of all container bounds.
- `getOrCreateFrameSpatialIndex(doc, existing)` reuses the index when the fingerprint matches.
- `queryPoint(index, x, y)` returns candidate container IDs from the cell covering the point.

The fingerprint lets the editor avoid rebuilding the index on every pointer move when only non-container shapes move. The index is cached in `CanvasArea` and passed to `findContainingFrame` so drag lookups stay fast.

### 2. Containment query (`findContainingFrameInDoc`)

`findContainingFrameInDoc(doc, world, frameIndex?)` finds the deepest frame or group containing a world coordinate.

- It walks the active page nodes and uses inverse transforms to convert the world point into the candidate's local space.
- `CanvasArea` caches a `FrameSpatialIndex` and passes it to `findContainingFrame`, so candidate containers are filtered to the grid cell covering the pointer.
- It skips locked, hidden, or isolated nodes.

### 3. Tool integration (`ToolContext`)

`ToolContext` exposes:

- `findContainingFrame(world, frameIndex?)` — wraps `findContainingFrameInDoc` using the current document and an optional cached frame index.
- `setDropTargetFrame(id)` — sets the container currently highlighted as the drop target.

`CanvasArea` adds local state:

- `dropTargetFrameId` and `setDropTargetFrameId`.
- The setter is passed to the tool context as `setDropTargetFrame`.
- The overlay canvas draws a dashed stroke around the drop target container (frame or group).

### 4. SelectTool drag feedback

`SelectTool.onDragMove`:

- Computes the world-space center of the dragged selection.
- Calls `ctx.findContainingFrame(center)`.
- Calls `ctx.setDropTargetFrame(result)` so the canvas highlights the candidate container.

`SelectTool.onDragEnd`:

- Calls `ctx.setDropTargetFrame(null)` to clear the highlight.
- For a move gesture, reparents each selected node into the container under its center (or back to the page if no container). A size heuristic prevents reparenting into a smaller container.
- Holds Ctrl to bypass auto-reparent.

### 5. Frame capture-on-draw

`EditorContext.createShapeAt` after creating a frame:

- Builds a parent index of the new document.
- Finds all siblings with the same parent as the new frame.
- For each sibling whose world bounds are fully inside the frame bounds:
  - Computes the sibling's transform relative to the frame (`frameInverse * siblingWorld`).
  - Reparents the sibling into the frame with the preserved local transform.

This only fires when the active tool is `frame` or `slice`, so drawing a regular shape does not trigger capture.

## Coordinates and transforms

- All containment checks and captures use world-space bounds.
- Reparenting preserves the world-space transform by converting the world transform into the new parent's local coordinate space.

## Files

- `packages/editor/src/scene/spatialIndex.ts` — spatial index and fingerprint
- `packages/editor/src/context.tsx` — `findContainingFrame`, `createShapeAt`, capture-on-draw
- `packages/editor/src/tools/types.ts` — `ToolContext` interface
- `packages/editor/src/tools/SelectTool.ts` — drag feedback
- `packages/editor/src/CanvasArea.tsx` — drop target highlight rendering
- `packages/editor/src/tools/frame-parenting.test.tsx` — integration tests
- `packages/editor/src/scene/__tests__/spatialIndex.test.ts` — index tests
- `packages/editor/src/tools/__tests__/SelectTool.test.ts` — drop target tests

## Future work

- Drop-reparenting currently only supports frames and groups in the same active page; cross-page or multi-page containment is not supported.
- Groups use bounds of their children for the highlight; an oriented bounding box would be more accurate for rotated groups.
- Add a visual indicator when a node is about to be reparented (e.g., a small badge near the cursor).
