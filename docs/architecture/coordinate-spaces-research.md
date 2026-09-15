# Coordinate Spaces in Professional Design Tools & Graphics Engine

Research compiled 2026-07-20. Sources: Skia docs, MDN (Canvas2D/CSS/SVG),
Godot 4.7 docs, Unity 6.5 scripting API, Bevy 0.19 source, Penpot matrix.cljc
source, Figma REST API docs.

> This file is the comparative research record. The canonical Varve
> contract (spaces, storage, invariants, API, migration) is
> `coordinate-system.md` (ADR-0219) — start there for implementation.

---

## 1. Comparative matrix

| Dimension | Figma | SVG | Illustrator | Skia | CSS/WebKit | Unity | Godot | Penpot | Canvas2D |
|---|---|---|---|---|---|---|---|---|---|
| **Local space** | Frame-relative (`relativeTransform`) | Element coords w.r.t. nearest `viewBox`/viewport | Layer/artboard-local | Geometry coords supplied to canvas | Element's own border box | Parent-relative (`localPosition`) | Item-local ("CanvasItem coords") | W.r.t. parent group | Current CTM state |
| **World/root space** | Page root coordinate system | Root `<svg>` user units | Global artboard coords | Device coords (pixels) of surface | Viewport / Page coords | Scene origin (`Vector3.zero`) | Canvas / Viewport coords | Page-level origin | Canvas pixel origin |
| **Screen space** | Canvas viewport (infinite) | Device pixels after viewBox mapping | Monitor/desktop | Device coords (0,0 = top-left) | Screen coords (`screenX/Y`) | Camera projection → screen | Embedder / Screen coords | N/A (web canvas only) | N/A (`<canvas>` pixels) |
| **Transform storage** | `relativeTransform` 2×3affine on each node; `size`on node itself | `transform`attribute, parsed into matrix | AI-private tree; transform per layer | `SkMatrix`on canvas stack; no persistent node tree | Computed `DOMMatrix`from `transform` list | TRS (Vec3 pos, Quat rot, Vec3 scale) + parent ref | `Transform2D`per node; parent ref | 6-component `Matrix`record (a–f) | 6-number CTM (a,b,c,d,e,f) |
| **Compose order** | Parent × child (pre-multiply) | Left-to-right nested (outer first) | Tree walk outer→inner | Post-multiply on canvas stack (M' = M × localMatrix) | Left-to-right (transform-functions establish nested spaces) | `parent.localToWorldMatrix × local` (post-mult) | `parent_transform × item_transform` (post-mult) | `multiply(m1, m2)`(post-mult) | `transform()`multiplies current CTM |
| **World-transform cache** | Lazily invalidated (`recomputeTransformDirty`) | None (stateless) | Yes (invalidation per layer) | None (stack-based) | Computed once per layout frame; cached in render layers | `localToWorldMatrix`is lazy-computed; `hasChanged` flag | `get_global_transform()`recomputed on tree change | Derived on demand from tree walk | N/A (no scene graph) |
| **Reparent preserve-world** | Yes — recomputes `relativeTransform` so world position is preserved | N/A (immutable per frame) | Yes — maintains world position on layer move | N/A | N/A | `SetParent(worldPositionStays=true)` recomputes local TRS | Recompute `transform` from new parent | Multiplies by old parent⁻¹ × new parent | Manual |
| **Non-invertible handling** | Guards on degenerate (zero-scale) | Spec fallback (`<svg>`fallback) | Refuses operation | `SkMatrix::invert()`returns false | NaNs propagate; spec requires finite | Refuses via matrix guard | `affine_inverse()`handles degenerate | `inverse`returns `nil`when `det ≈ 0` | `transform(Infinity)`marks matrix infinite |
| **Dirty / revision strategy** | Monotonic `transformDirty` + `boundsDirty` per node; propagates to children | None (declarative) | Observer-based invalidation | push/pop matrix stack; no persistent dirty flags | Style invalidation cascades (full / partial) | `hasChanged` flag per Transform; hierarchy dirty propagates | Tree dirty flags (`notify_transform_changed`) | `modif_tree.cljc` tracks dirty subtrees | Manual redraw |
| **Instancing / symbols** | Component instances share master geometry; per-instance transform | `<use>`+ `transform` | Symbols | No scene graph (explicit draw) | No | Prefab + per-instance | Scenes / inherited scenes | Components / clones | No |
| **Z / paint order** | Children index in `children[]` (reverse paint) | Document order (later = on top) | Layer order + z-index | Draw order on canvas (no auto-sort) | Stacking context + z-index | Sorting layer / order in layer | Z-index + draw order | Object list order | Draw call order |

---

## 2. Per-system architectural patterns

### 2.1 Figma

- **Coordinate model**: Every node stores a `relativeTransform` — a 2×3 affine
  matrix expressing the node's position *relative to its parent*. The page
  root is in page coordinates. Nested frames create nested coordinate spaces
  automatically. Hit-testing walks the tree top-down composing world
  transforms.
- **Frame-local space**: Children of a frame are positioned relative to the
  frame's origin. The frame's own `relativeTransform` maps frame-local coords
  into the parent's space. Clips (`clipsContent`) apply in the frame's
  local space.
- **Transform composition**: Figma pre-multiplies — to draw a node, it walks
  ancestors composing `parent × child`. The renderer caches world transforms
  per node and invalidates them lazily (`transformDirty` flag) when a node's
  transform or parent changes. Invalidation propagates to descendants.
- **Reparenting**: When a node is moved to a new parent, Figma recomputes
  `relativeTransform` from the node's current world matrix and the new
  parent's inverse, preserving world position — analogous to Unity's
  `SetParent(worldPositionStays: true)`.
- **Non-invertible**: A zero-scale or degenerate affine is guarded at
  the node-creation and mutation level — the UI prevents scaling to exactly
  zero.
- **Performance**: `transformDirty` + `boundsDirty` are monotonic revision
  counters. The webGL/Metal renderer only re-rasterizes changed tile
  regions (tile-based progressive rendering).

### 2.2 SVG

- **Coordinate model**: SVG is *declarative and stateless* — there is no
  runtime scene graph with dirty flags. The browser engine builds a render
  tree per layout pass and evaluates transforms then.
- **Nested coordinate systems**:
  - Each `<svg>` element with a `viewBox` establishes a **new user
    coordinate system** via the `viewBox → viewport` mapping (the
    `preserveAspectRatio` parameter controls fit behaviour).
  - Nested `<g>` elements with `transform` attributes compose via
    *left-to-right* multiplication: outer transform first, inner
    appended — equivalent to post-multiplying a matrix stack.
  - `transform` is parsed into an `SVGMatrix` (DOMMatrix) at parse time.
- **viewBox and units**: `viewBox="minX minY w h"` maps the user coordinate
  system onto the SVG viewport. User units can be scaled (`1user-unit ≠
  1px`). Absolute units (cm, mm, in, pt) are converted via DPI (96dpi in
  CSS).
- **World transform caching**: None — transforms are recomputed at every
  layout/paint.
- **Reparenting**: Not applicable in the DOM-free sense. Moving a node
  between `<g>` elements updates its `transform` attribute; layout is
  invalidated globally for the affected subtrees.
- **Non-invertible**: If a matrix is non-invertible, hit-testing and
  rendering both fall back to no-op (the element is not rendered / not
  hittable). The spec defines how browsers should handle degenerate
  transforms (e.g. zero-scale = not rendered).
- **Performance**: The browser's render-tree style-invalidation cascade
  determines what repaints — the SVG itself does not expose dirty tracking.

### 2.3 Adobe Illustrator

*(Derived from published behaviour and SDK documentation — Illustrator is
closed-source.)*

- **Coordinate model**: Illustrator uses an *artboard-local* coordinate
  system per document. Each layer and sub-layer stores a transform that
  composes through the layer tree. Nested layers (sublayers) work like
  Figma nested frames — they create a new local coordinate space.
- **Transform storage**: The internal scene graph (AI's `AIDocument` /
  `AILayerSuite`) stores transforms deep in a proprietary tree. Each
  artoplaceable artwork item has a `AIRealMatrix` (6-value affine).
- **Transform composition**: Parent×child world matrix composition; cached
  during the layout/update walk. World bounds are cached and invalidated
  through an observer/notification system — the artwork tree broadcasts
  `kAICascadeChanged` notifications on edit.
- **Reparenting**: Moving a layer or object between groups/layers preserves
  world position — the source recomputes the local transform from the new
  parent's inverse.
- **Non-invertible**: Illustrator prevents zero-scale operations in the
  UI and guards against degenerate matrices when importing. Operations that
  would produce a non-invertible matrix are blocked.
- **Performance**: Observer-based invalidation + tiled rendering canvas.
  Illustrator caches rasterized tile representations for complex artwork
  and invalidates only the tiles whose source changed.

### 2.4 Skia

- **Coordinate model**: Skia has exactly two coordinate spaces —
  **device** and **local**.
  - **Device coordinates** are defined by the `SkSurface` you render
    into: `(0,0)` to `(w,h)` in pixels, origin top-left.
  - **Local coordinates** are how geometry and shaders are described
    to the `SkCanvas`. By default local == device, but the canvas
    transformation matrix remaps them.
- **Transform storage**: There is *no scene graph*. Skia is an
  *immediate-mode canvas* API. The only persistent transform state is the
  canvas' current transformation matrix (CTM) and a stack of saved CTMs
  (`save()` / `restore()`).
- **Local matrix operations**:
  - `translate()`, `rotate()`, `scale()` all *post-multiply* the CTM
    (`CTM = CTM × op`).
  - `setMatrix()` / `concat()` replace or multiply the CTM.
- **Shaders have their own space**: An `SkShader` is evaluated in local
  coordinates independent of where geometry lands. To move a shader
  with geometry you must either rebuild the shader or supply a
  `localMatrix` parameter when constructing the gradient — the shader
  is then transformed by `CTM × localMatrix` while geometry is
  transformed by `CTM` alone.
- **World transform caching**: None — no scene graph, no caching beyond
  the CTM stack. Replaying a frame re-issues draw commands.
- **Reparenting**: Not applicable — Skia has no concept of nested
  objects.
- **Non-invertible**: `SkMatrix::invert()` returns `false` on failure,
  and the matrix is left unchanged. `SkCanvas::concat()` validates
  finiteness (rejects NaN/Inf).
- **Performance**: Skia's performance model is the **display list** —
  `SkPicture` records draw commands for later replay. GPU-accelerated
  backends (`GrContext`) batch and cache complex draws. `saveLayer()`
  flattens a subtree into an offscreen texture — the Skia equivalent of
  stacking-context isolation.

### 2.5 CSS / WebKit (and Blink, Gecko)

- **Coordinate model**: CSS has four standard pixel coordinate systems
  (per MDN/CSSOM):
  1. **Offset** — relative to the target element's padding edge
     (`offsetX/Y`).
  2. **Viewport** (client) — relative to the visible viewport
     (`clientX/Y`).
  3. **Page** — relative to the whole document (`pageX/Y`).
  4. **Screen** — relative to the physical display (`screenX/Y`).
- **Stacking contexts**: A `transform` (other than `none`) creates a
  new **stacking context** — and the transformed element becomes a
  containing block for `position:fixed/absolute` descendants. Multiple
  `transform` functions compose *left-to-right*: the outermost transform
  establishes a coordinate space that the next transform operates in.
- **Transform storage**: Computed by the layout engine from the
  `transform` list, resolved against the element's `transform-box`
  (default `view-box` in CSS4, formerly `border-box`) and
  `transform-origin`. The browser computes a `TransformationMatrix`
  (4×4 homogeneous — `Matrix4` in WebKit/Blink) during the *style →
  layout → paint* pipeline.
- **World-transform caching**: The computed 4×4 is cached in the
  render layer / `PaintProperties` tree. It is recomputed when style
  invalidation propagates or transform changes. WebKit and Blink
  maintain a **render-layer → graphics-layer → render-layer** tree; the
  `GraphicsLayer` stores transforms that are animated on the
  compositor thread.
- **Reparenting**: When DOM nodes are reparented and the new parent has
  a `transform`, the element's `offsetX/Y` and other DOM-visible metrics
  are recomputed during the next style/layout pass via the render-tree
  walk.
- **Non-invertible**: The CSS Transforms spec says the *used value* of
  a transform must be finite. Non-invertible transforms (e.g. scaling
  all axes to 0) can still be *applied* but are not necessarily rendered
  as visible — rendering engines handle degenerate cases by culling or
  no-op. Hit-testing uses `matrix4.inverse()` and falls back gracefully.
- **Performance**: Style-invalidation cascades (full vs partial
  invalidation). The compositor thread can animate `transform`
  independently of main-thread layout (the basis of smooth CSS
  transitions/animations). `will-change: transform` hints the engine to
  promote to a `GraphicsLayer` upfront.

### 2.6 Unity

- **Coordinate model**: Parent-child `Transform` hierarchy. Every
  `GameObject` has a `Transform` component storing `localPosition`,
  `localRotation` (Quaternion), `localScale`. The root of the scene is
  the world origin `(0,0,0)`.
- **Transform storage**: Explicit TRS (Vec3 + Quat + Vec3) + parent
  reference. World matrix reconstructed by walking the hierarchy.
  `localToWorldMatrix` and `worldToLocalMatrix` are exposed.
- **Transform composition**: Post-multiply —
  `world = parent.localToWorldMatrix × localTRSMatrix`. Transforms
  compose from right-to-left: `t1 × t2` means apply `t2` first, then
  `t1`.
- **World-transform cache**: `Transform` stores the parent ref; dirty
  propagation flows from root to descendants. When a transform changes
  the system flags `hasChanged` and re-walks children. Unity uses a
  hierarchical dirty-flag system — `Transform::HasChanged` and the
  `hierarchyCount`/`hierarchyCapacity` bookkeeping guide when to
  recompute matrices.
- **Reparenting**: `Transform.SetParent(newParent, worldPositionStays)`
  — when `worldPositionStays=true`, Unity recomputes `localPosition`,
  `localRotation`, `localScale` from the new parent's inverse so world
  position is preserved. When `false`, it keeps local TRS as-is.
- **Non-invertible**: Unity prevents zero-scale in many workflows; the
  `lossyScale` property gives the *world* scale even if it is not
  directly expressible from local scales (due to rotation). Matrix
  inversions guard against non-invertible cases in `worldToLocalMatrix`.
- **Performance**: Hierarchy dirty propagation. The C# Job System +
  `TransformAccessBatch` allow bulk transform reads on worker threads.
  `Transform-system` (DOTS/ECS) compacts transforms into contiguous
  `LocalToWorld` matrices and updates via the
  `TransformSystemGroup.LateRunningGroup`.

### 2.7 Godot 4.x

- **Coordinate model**: Godot has *seven* distinct 2D coordinate systems:
  1. **Item coords** — local to a `CanvasItem` (Node2D/Control).
  2. **Parent item coords** — local to the item's parent.
  3. **Canvas coords** (also called world coords) — the coordinate
     system of the current `CanvasLayer` or the Viewport's default
     canvas.
  4. **Viewport coords** — the `Viewport`'s coordinate system.
  5. **Camera coords** — internal, used for 3D projection raycasts.
  6. **Embedder / Screen coords** — coordinates of the embedding
     node / OS window manager.
  7. **Absolute embedder / Absolute screen** — origin at the
     embedding node's absolute top-left.
- **Transform storage**: Each `CanvasItem` stores a `Transform2D`
  (3×2 affine: `xx, xy, yx, yy, origin`). `CanvasLayer`, `Viewport`,
  `Window`, `SubViewportContainer`, and `SubViewport` each add their
  own affine transform. `Control` nodes use `position`, `scale`,
  `rotation`, and `pivot_offset` rather than a free matrix.
- **Transform composition**: All transforms are `Transform2D`
  post-multiplied —
  `screen_coord = viewport_stretch × global_canvas_transform ×
   canvas_layer_transform × parent_canvas_item_transform ×
   canvas_item_transform × local_coord`.
- **World-transform cache**: `CanvasItem::get_global_transform()`
  recomputes from the tree walk and marks a dirty notification
  (`notify_transform_changed`). On any transform change, Godot
  invalidates the item and *all descendants*. There is no lazy flag
  — notification is eager but the actual matrix is recomputed lazily.
- **Reparenting**: The `CanvasItem` API recomputes `transform` when
  the parent changes to preserve world position (analogous to Unity's
  worldPositionStays). `CanvasItem::set_transform()` operates in
  current parent-local space.
- **Non-invertible**: `Transform2D::affine_inverse()` handles
  degenerate cases; if the determinant is near-zero the inverse is
  unspecified. Higher-level APIs (e.g. `make_input_local()`) guard
  against invalid inverses.
- **Performance**: Hierarchical invalidation via
  `notification(NOTIFICATION_TRANSFORM_CHANGED)`. The 2D renderer
  maintains a draw-command buffer rebuilt from the visible `CanvasItem`
  tree each frame. `CanvasLayer` isolation gives a flatten/snapshot
  boundary analogous to `saveLayer` in Skia.

### 2.8 Bevy (Rust ECS)

- **Coordinate model**: Bevy is an ECS — transforms are *data*, not
  behaviour. `Transform` (translation: `Vec3`, rotation: `Quat`,
  scale: `Vec3`) is stored per entity. `GlobalTransform` is a
  separately cached component computed from `Transform` + the
  `ChildOf` (parent) relationship.
- **Transform storage**: Explicit TRS + parent entity reference
  (`ChildOf`). `GlobalTransform` stores an `Affine3A` (compact
  affine) — kept in sync by the
  `TransformSystems::Propagate` system during `PostUpdate`.
- **Transform composition**: Post-multiply —
  `GlobalTransform = parent.GlobalTransform × Transform`. The docs
  explicitly state: "Transforms compose from right to left: `t1 × t2`
  means apply `t2` first, then apply `t1`."
- **World-transform cache**: `GlobalTransform` IS the cache. Bevy's
  `Propagate` system walks from roots to leaves, recomputing
  `GlobalTransform` for every dirty or newly-transformed entity.
  Because Bevy uses ECS queries, `Propagate` can run in parallel
  across independent subtrees.
- **Reparenting**: When an entity's `ChildOf` target changes, the
  next `Propagate` pass recomputes its `GlobalTransform` from the
  new parent. Bevy does *not* automatically preserve world position
  on reparent — preserving world position must be done in user code
  by computing new local TRS from the new parent's inverse.
- **Non-invertible**: Debug assertions (`assert_is_normalized`) check
  quaternion normalization. The `Affine3A` inverse is computed with
  care for degenerate scale — Bevy's ECS systems guard against zero
  scale at the application level.
- **Performance**: ECS-based top-down propagation with `Query`
  filtering. `Propagate` runs during `PostUpdate`, giving a 1-frame
  lag before `GlobalTransform` is current. Bevy's archetype-based
  storage makes transform iteration cache-friendly.

### 2.9 Penpot

- **Coordinate model**: Penpot stores an explicit affine `Matrix`
  record (`a, b, c, d, e, f`) per shape/group. Groups compose via
  matrix multiplication. The world space is the page origin.
- **Transform storage**: `Matrix` is a Clojure/ClojureScript record
  with 6 double-precision components. Penpot has *immutable* data
  transforms — every edit returns a new `Matrix` rather than mutating
  in-place.
- **Transform composition**: `multiply(m1, m2)` post-multiplies
  (equivalent to `m1 × m2`). `multiply!` is a mutating variant for
  hot paths. `translate`, `rotate`, `scale`, `skew` all produce a
  matrix and post-multiply via `multiply`.
- **World-transform cache**: Penpot tracks dirty state through
  `modif_tree.cljc` (modification tree) — a per-object dirty
  notification structure analogous to `transformDirty` flags. Shapes
  cache their `outline` and `bounding-box`; transforms invalidate
  those caches.
- **Reparenting**: Reparent is implemented as a matrix operation:
  new-local = old-parent-inverse × old-world × new-parent-inverse.
  The `inverse` helper returns `nil` when determinant ≈ 0, and
  callers are expected to guard against `nil`.
- **Non-invertible**: `determinant` is computed as `a*d - c*b`.
  `inverse` returns `nil` when `det ≈ 0` (`mth/almost-zero?`),
  callers are expected to guard against `nil`.
- **Performance**: Immutable data + structural sharing (Clojure's
  persistent data structures) for cheap snapshots/undo. `multiply!`
  (mutation) is used on rendering hot paths to avoid allocation
  pressure.

### 2.10 Canvas2D

- **Coordinate model**: Immediate-mode 2D context with a single
  current transformation matrix (CTM). The canvas origin is top-left;
  geometry is submitted in whatever coordinate system the CTM
  establishes.
- **Transform storage**: 6-number CTM (`a, b, c, d, e, f`).
  `save()` pushes the CTM onto a state stack; `restore()` pops it.
  The saved state includes not just the CTM but also fillStyle,
  strokeStyle, globalAlpha, line*, shadow*, font, clipping path —
  everything that defines the drawing context.
- **Transform composition**:
  - `transform(a,b,c,d,e,f)` multiplies the CTM by the given matrix
    (`CTM = CTM × M`).
  - `setTransform()` resets to identity first (replaces CTM).
  - `translate()`, `rotate()`, `scale()` all post-multiply
    convenience operations.
- **World-transform caching**: None. No scene graph. World coords are
  established explicitly by pre-multiplying view/camera transforms
  onto the CTM before issuing draw calls.
- **Reparenting**: Not applicable — no scene graph.
- **Non-invertible**: If any argument to `transform()` is `Infinity`,
  the CTM is marked infinite (the spec says "must be marked infinite
  instead of throwing"). The browser then treats draws in an infinite
  CTM as no-ops.
- **Performance**: Beginner-trap free: `save()`/`restore()`
  mismanagement is the #1 source of state leaks. For performance,
  browsers record a display list (`RecordingCanvas`) and replay it
  without re-issuing JS calls. `setTransform()` is preferred over
  manual matrix math for resetting.

---

## 3. Transform composition conventions — compare/contrast

### 3.1 Multiplication order

| System | Order | Interpretation |
|---|---|---|
| Figma | Pre-multiply (parent × child) | Root-to-leaf, left-to-right |
| SVG | Left-to-right chained | `translate() rotate()` = move then rotate in new space |
| Skia | `CTM = CTM × local` (post-multiply) | New ops apply in current space |
| Canvas2D | `CTM = CTM × M` (post-multiply) | Matches Skia |
| CSS | Left-to-right reading | Each function establishes a new space for the next |
| Unity | `parent × local` (post-multiply) | "Right-to-left" composition semantics |
| Godot | `parent × item` (post-multiply) | Right-to-left in formula |
| Bevy | `parent × local` (post-multiply) | "Right-to-left" — `t1 × t2` applies `t2` first |
| Penpot | `multiply(m1, m2)` = `m1 × m2` | Post-multiply in right-to-left reading |

### 3.2 TRS vs affine matrix storage

| System | Storage | Tradeoff |
|---|---|---|
| Unity, Godot, Bevy | TRS (translation, quaternion, scale) | Easy to edit/animate; must compose to matrix for rendering; non-uniform scale + rotation coupling; gimbal-free rotation via quaternion |
| Figma, SVG, Penpot, Canvas2D | 6-component affine (a–f) | Compact; easy to compose/invert; harder for humans to read; must decompose for UI editing |
| CSS | Decomposed list of transform functions | Human-friendly; browser composes into `TransformationMatrix` for rendering |
| Skia | `SkMatrix` (affine) | Compact; operates on canvas stack |
| Illustrator | `AIRealMatrix` (affine) | Same as Figma/SVG |

---

## 4. Reparenting preserve-world — the algorithm

All systems that support reparenting (Figma, Unity, Godot, Illustrator,
Penpot) use the same algorithm:

```
oldWorld = parentOld.worldMatrix × child.localMatrix
newLocal = newParent.worldMatrix.inverse × oldWorld
```

In TRS form this becomes:

```
newLocal = newParent.InverseTransformPoint(worldPos)
newLocalRotation = parentOld.worldRotation.Inverse × worldRotation
newLocalScale = decompose(parentOld.worldScale.Inverse × worldScale)
```

Bevy is the notable exception: it does **not** auto-preserve world
position on reparent; the user code must compute new local TRS.

---

## 5. Dirty/revision strategies summary

| Strategy | Used by | Mechanism |
|---|---|---|
| Monotonic dirty flag per node | Figma | `transformDirty`, `boundsDirty` propagate to children |
| Hierarchical notification | Godot | `notification(NOTIFICATION_TRANSFORM_CHANGED)` propagates eagerly, world matrix recomputed lazily |
| ECS top-down propagation | Bevy | `TransformSystems::Propagate` system walks `ChildOf` relationships, recomputes `GlobalTransform` |
| `hasChanged`per-transform flag | Unity | Dirty flag per transform + hierarchy tracking; job-friendly batch query |
| Observer cascade | Illustrator | `AICascadeChanged` notifications propagate from changed artwork |
| Style invalidation | CSS | Style → layout → paint phase; `transform` triggers full or partial invalidation |
| Render-tree snapshot | SVG, Canvas2D | No per-node dirty tracking — rebuild every frame (SVG) or immediate-mode draw (Canvas2D) |
| Immutable + structural sharing | Penpot | `modif_tree.cljc` + persistent data structures; cheap snapshots |
| Display list + tile raster | Skia | `SkPicture` for command replay; `saveLayer` for subtree isolation |

---

## 6. Lessons for Varve's architecture

1. **TRS storage + parent ref** (Unity/Godot/Bevy pattern) is the most
   practical for a design tool: editable in the UI, animatable, and can
   be composed into a world affine for rendering. Penpot's pure-affine
   is simpler but harder to degrade gracefully for non-technical
   editing.

2. **GlobalTransform should be a cached separate component** (Bevy's
   pattern) rather than a recomputing getter. Decoupling local editing
   from world-space queries avoids subtle 1-frame-lag bugs and lets
   the renderer read world transforms in parallel.

3. **On reparent, preserve world position** (Unity/Godot/Figma
   formula) — this is the expected behaviour and prevents jumps when
   moving objects between frames.

4. **Dirty flags should propagate eagerly, recompute lazily** — Godot's
   `notify_transform_changed` (eager notification, lazy matrix walk)
   is a good balance. Bevy's ECS propagation is more deterministic
   but requires running the propagation system.

5. **Non-invertible guards at the math layer** — Penpot's
   `inverse` returning `nil` when `det ≈ 0` is a clean, composable
   pattern. Varve's `tryInvertAffine` in `packages/shared/src/affine.ts`
   already follows this pattern.

6. **Separate shader-space transforms** (Skia's `localMatrix` insight):
   fills/gradients should have their own transform space independent
   of the shape geometry — this unlocks Figma-style gradient handles.

7. **Stacking-context isolation via offscreen** — CSS's stacking
   context and Skia's `saveLayer` both establish a new compositing
   boundary per transformed/subtree root. Varve's
   `sceneNeedsStructuralCompositing` already does this; mirroring
   the CSS/Skia language helps document the tradeoffs.
