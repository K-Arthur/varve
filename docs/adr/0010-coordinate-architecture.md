# ADR-0010: Coordinate Architecture

- **Status:** Accepted

## Context

Strata's coordinate handling was scattered across multiple modules with no
single source of truth. Transform composition lived in
`packages/editor/src/scene/world.ts`, camera math in
`packages/shared/src/viewport.ts`, artboard display conversions in
`packages/shared/src/coordinates.ts`, and 30+ overlay components each
re-implemented their own `worldToScreen`/`screenToWorld` wrappers.

This caused:
- **Inconsistency**: Different code paths used different coordinate
  conversion formulas, leading to subtle bugs (e.g., overlays drifting from
  the canonical camera transform under rotation).
- **Duplication**: The same affine math was re-implemented in dozens of files.
- **No artboard-local space**: Artboard coordinates were display-only (ruler
  offset), not a first-class concept for storage or interaction.
- **Rotation inconsistency**: The `rotation` field was stored separately from
  `transform`, composed at render time, causing `nodeLocalBounds` to return
  un-rotated bounds while the renderer applied rotation.

## Decision

Establish `packages/scene/src/coordinateService.ts` as the single source of
truth for all scene-graph coordinate conversions.

### Coordinate Space Hierarchy

```
Object-local   — geometry before transform (shape coords, frame w/h)
    ↓  node.transform (+ rotation)
Parent-local   — node origin in parent's coordinate frame
    ↓  ancestor chain composition
World          — global document space (renderer, hit-test, snap)
    ↓  camera (pan/zoom/rotation)
Viewport       — canvas-area CSS pixels
    ↓  DPR
Screen         — device pixels
```

### Centralized APIs

The `CoordinateService` provides:

| Category | Functions |
|----------|-----------|
| **World transforms** | `nodeWorldTransform`, `nodeWorldBounds`, `groupWorldBounds` |
| **Point conversion** | `localToWorld`, `worldToLocal`, `parentToWorld`, `worldToParent` |
| **Rect conversion** | `localRectToWorld`, `worldRectToLocal` |
| **Cross-node** | `localSpaceTransform` (maps between any two nodes' local spaces) |
| **Artboard** | `isArtboard`, `findArtboardForNode`, `getArtboardWorldOrigin`, `getArtboardWorldRect`, `worldToArtboardLocal`, `artboardLocalToWorld`, `getAllArtboards` |
| **Reparenting** | `computeReparentTransform`, `computeReparentPosition` |
| **Migration** | `bakeRotationIntoTransform`, `migrateRotationToTransform`, `validateDocumentTransforms` |

### Artboard Model

An artboard is a `FrameNode` that is a direct child of a page content root
(or `rootChildren` in flat mode). This matches Figma's convention: top-level
frames are artboards, nested frames are regular containers.

Artboard-local coordinates use the full inverse world transform (handling
rotation and scale), not just a simple offset.

### Rotation Baking (v2.5)

The separate `rotation` field is baked into the `transform` tuple during
document migration (2.4 → 2.5). After migration:
- `transform` encodes the full local→parent affine (rotation + scale + translation)
- `rotation` is always 0
- `nodeLocalBounds` returns correct bounds (no longer needs to account for
  rotation separately)

### Package Structure

- `@varve/shared` — pure math (`affine.ts`, `viewport.ts`, `coordinates.ts`)
- `@varve/scene` — scene-graph-aware conversions (`coordinateService.ts`, `nodeBounds.ts`)
- `@varve/editor` — re-exports from scene for backward compatibility (`world.ts`, `nodeBounds.ts`)

## Consequences

### Positive
- Single source of truth eliminates coordinate drift between subsystems
- Artboard-local coordinates enable Figma-style ruler modes and per-artboard guides
- Rotation baking simplifies the data model and eliminates a class of bugs
- Reparenting helpers ensure world-position preservation across container changes

### Migration
- Existing documents are migrated 2.4 → 2.5 on next open (rotation baked in)
- The editor's `world.ts` and `nodeBounds.ts` re-export from `@varve/scene`
  for backward compatibility — existing imports continue to work
- New code should import directly from `@varve/scene`

### Performance
- `nodeWorldTransform` accepts an optional `parentIndex` map for O(1) parent
  lookups (callers should pre-build via `buildParentIndexMap`)
- The editor's `TransformCache` wrapper adds memoization on top of the
  stateless scene functions

## Research Basis

- **Figma**: `relativeTransform` per node, frame-local coordinates, lazy
  transform invalidation (`transformDirty` flag)
- **Unity/Godot/Bevy**: Post-multiply composition (`parent × local`),
  `SetParent(worldPositionStays: true)` for reparenting
- **Penpot**: 6-component affine matrix, `multiply(m1, m2)` post-multiply,
  `inverse` returns `nil` on singular
- **Skia/Canvas2D**: `CTM = CTM × local` post-multiply convention
- **SVG**: Left-to-right nested transforms (equivalent to post-multiply)
