# Coordinate System — Canonical Contract

Status: canonical (ADR-0219). Applies to all packages (scene, editor, engine,
compositor, codegen, import, export). Research background:
`coordinate-spaces-research.md` (comparative matrix of Figma/SVG/Skia/Godot/
Unity/Penpot).

## Coordinate spaces

```
Screen / client        device or CSS pixels of the WebView/browser viewport
      ↓  (canvas DOM bounds + DPR)
Viewport               canvas-area CSS pixels (pan/zoom/camera rotation applied)
      ↓  camera (pan/zoom/rotation) — canvas/cameraState.ts
World (pasteboard)     the infinite-canvas coordinate system; artboards and
                       page placements live here
      ↓  parent world transform
Parent-local           a node's stored transform frame (artboard-local for a
                       direct artboard child)
      ↓  node transform (+ rotation)
Object-local           geometry before transform (shape coords, frame w/h,
                       path anchors + handles)
```

The editor's *placed world* adds each page's placement translation
(ADR-0123) on top of the scene's stored hierarchy — page-owned nodes render
at their page's pasteboard position while their stored transforms stay
page-local. `packages/editor/src/scene/world.ts` is the placed-world API;
`packages/scene/src/coordinateService.ts` is the scene-level API.

## Storage model

- Every node stores a local→parent affine `transform: Affine` (`[a,b,c,d,e,f]`,
  HTML-canvas/kurbo convention, see `packages/shared/src/affine.ts`) plus a
  separate `rotation` field (degrees) that composes AFTER the transform
  (`transform · rotate(rotation)`, about the node origin).
- **World transforms are derived, never stored.** `nodeWorldTransform` walks
  the ancestor chain; the `TransformCache` (editor) memoizes world
  transforms/bounds with per-node dirty invalidation.
- Shape/text/frame geometry (`shape`, `w`/`h`, path points) is object-local
  and never rewritten by parent movement.
- There is no persisted dual local/world representation. The only world-like
  persisted values are page placements (a page property, not a node) and the
  clipboard `worldAnchor` (a paste-time hint, see below).

## Invariants

1. Artboard (root-level frame) position is relative to world/pasteboard.
2. A direct child's transform is relative to its parent — artboard-local for
   artboard children.
3. `nodeWorldTransform = parentWorld · (transform · rotate(rotation))`.
4. Moving an artboard changes only the artboard transform; descendants'
   stored transforms are untouched (verified by
   `coordinateService.test.ts` "moving a parent must not rewrite
   descendants").
5. Reparenting preserves world pose: `newLocal = newParentWorld⁻¹ · oldWorld`
   (`reparentLocalTransform`, `world.ts`).
6. Hit-testing, snapping, marquee/lasso, selection overlays, and exports all
   evaluate in world space; the result is converted into the target parent's
   local space before model writes.

## Canonical API (single source of truth)

Scene (`@varve/scene` — unplaced):
- `nodeWorldTransform(doc, id, parentIndex?)`, `nodeWorldBounds(...)`
- `localToWorld`, `worldToLocal` (null on singular), `parentToWorld`,
  `worldToParent` (null on singular), `localSpaceTransform`
- `isArtboard`, `findArtboardForNode`, `getArtboardWorldOrigin/Rect`,
  `worldToArtboardLocal`, `artboardLocalToWorld`
- `computeReparentTransform`, `validateDocumentTransforms`,
  `bakeRotationIntoTransform`

Editor (`@varve/editor` — placed-world variants):
- `nodeWorldTransform/Bounds` (`scene/world.ts`), `worldToParent`,
  `reparentLocalTransform`, `rebaseWorldTransformToParent`,
  `pageToWorld`/`worldToPage` (page placements)
- `TransformCache` for render/hit-test/snap hot paths (placement-aware,
  ancestor-invalidating)

Tools/commands MUST use these helpers instead of inlining
`invertAffine(nodeWorldTransform(...))` — five parallel implementations
historically drifted apart (nudge page lookup, snap targets, path creation).

## Transform composition & rotation

Every consumer composes `transform · rotate(rotation)` per node: render
pipeline (`TransformCache`), thumbnails (`thumbnail/resolve.ts`), codegen
(`nodeEffectiveTransform` in `codegen/shared.ts`), masks. The engine IR is
world-transformed before it reaches the worker/compositor — rotation is
never applied a second time.

## Reparenting & hierarchy ops

- Drag reparent (`reparentNode`), group/ungroup, duplicate, and boolean-op
  placement all convert through world space and write parent-local
  transforms.
- Boolean ops clip operands in world space (`shapeNodesInWorldSpace`) and
  re-anchor the result at the first operand's home
  (`booleanAnchorForNode` + `placeBooleanResult`).
- Paste/copy: `copySelected` records each root's placed-world transform
  (`ClipboardData.worldAnchor`); paste rebases it into the destination
  frame's local space (`newLocal = targetWorld⁻¹ · anchor`). Legacy
  clipboard payloads without an anchor keep source-local semantics.

## Migration

- Legacy documents (v1.0+) already stored parent-local transforms — the
  parent-local model predates the versioned format, so no coordinate
  migration is needed for them.
- v2.4→2.5 baked the separate rotation into `transform` for existing nodes;
  the field remains live for new edits and is folded at every consumer.
- Load-time parent-graph validation rejects cycles
  (`documentCodec.decode` → `findParentCycle`) instead of hanging; the
  world-transform walk and `walkNodes` are cycle-guarded as defense in
  depth.
- Migration/validation is excluded from undo history by construction (it
  runs at decode, before the document enters editor state).

## Known edge cases

- Non-invertible (zero-scale) parents: `tryInvertAffine` returns null;
  callers fall back to the world point (draw tools) or no-op (reparent).
- Empty groups have no own geometry — reparent decisions fall back to the
  node's world origin, never the raw local translation.
- Overlapping containers resolve by depth first, then paint order (topmost
  wins at equal depth) — `findContainingFrameInDoc`.
- Constraints/auto-layout compute in frame-local space; moving a frame never
  triggers layout writes; resizing does (intended).
- Master-page content projects via render-only offsets (`masterOffsets.ts`);
  stored master coordinates are untouched.
