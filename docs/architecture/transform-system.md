# Transform, snapping, and alignment system

Status: canonical implementation contract. This document records the transform
pipeline as it exists in the editor and the invariants required when extending
it. Coordinate-space rules come from [the coordinate-system contract](coordinate-system.md).

## One transform pipeline

Node-selection gestures and committed geometry use this flow:

```text
pointer input / numeric command
  -> TransformEngine snapshot (initial document, world transforms, OBB)
  -> world-space selection-box delta
  -> snap policy (when enabled)
  -> each node's parent-local transform
  -> node-type geometry or transform commit
  -> transform-cache invalidation and rendering
  -> overlay, history, persistence, export
```

`TransformEngine` captures its initial state at pointer down. Each pointer
sample derives the next state from that immutable snapshot rather than from the
last preview. This avoids incremental affine drift. The selection overlay opens
one history transaction before the gesture, previews document updates during the
gesture, then commits once on pointer up; Escape/cancellation aborts that
transaction.

All interaction math is in placed world space. Before writing a selected node,
the engine uses the cached parent-world inverse to rebase the new world pose
into that node's own parent-local space. World coordinates are never persisted.

## Persisted transform semantics

| Node type | Move | Resize/scale commit | Rotation commit | Persisted representation |
| --- | --- | --- | --- | --- |
| Path | Parent-local transform during preview | Bake anchors and incoming/outgoing Bézier handles | `rotation` when decomposable; otherwise affine | Editable path coordinates plus normalized transform |
| Rect / ellipse / line / arrow | Parent-local transform during preview | Bake shape geometry | `rotation` when decomposable | Primitive geometry plus transform/rotation |
| Circle / polygon / star | Parent-local transform during preview | Uniform scale retains the primitive; anisotropic scale or reflection converts to an exact cubic path | `rotation` when decomposable | Primitive when representable, otherwise editable path geometry |
| Image-filled shape | Parent-local transform during preview | Bake placement geometry; retain source/fill/mask metadata | `rotation` when decomposable | Shape placement, not resampled source pixels |
| Frame | Parent-local transform during preview | Bake `w` / `h`; reflow layout children or apply constraints; optional scale-contents mode | `rotation` when decomposable | Frame dimensions, transform/rotation, child-local geometry |
| Text | Parent-local transform during preview | Fixed and auto-height text resize their container; point/auto-width text scales font metrics | `rotation` when decomposable | Text-mode geometry and transform/rotation |
| Group and unsupported/skewed nodes | Parent-local transform | Retain affine so hierarchy semantics are preserved | Retain affine as needed | Local affine; descendants are not needlessly rewritten |

The path rule is strict: after a normal resize commits, path points and handles
contain the changed geometry. A renderer-only scale is permitted only for a
preview frame and must not survive commit. An affine with skew remains affine
because baking it into all supported node kinds is not a semantic no-op.

The non-uniform primitive rule matters: a circle cannot represent an ellipse,
and a polygon or star cannot represent anisotropic scaling with one radius.
Those cases use the engine's exact parametric-to-cubic conversion; they are not
approximated by choosing a larger radius. Reflections use that same conversion
instead of storing negative radii or dimensions.

## Bounding boxes and modifiers

`@varve/shared/selectionBox` owns selection-box construction, oriented box
rotation, handle locations, resize deltas, and box-to-box affine matrices. It
keeps geometric coordinates in world space. `SelectionOverlay` converts its SVG
screen-space hit regions through the camera helpers, so handle hit targets stay
a practical CSS-pixel size at every zoom level while their underlying locations
remain world-correct.

The overlay uses `computeResizeModifiers` for the shared platform-aware modifier
mapping. Its active resize behaviour includes proportion locking, centre-origin
resize, the platform alternate modifier to bypass snapping, and frame
scale-contents mode. Rotation accumulates unwrapped pointer-angle deltas, so a
gesture crossing the `-pi`/`pi` branch cut remains continuous; Shift quantizes
that gesture to 15-degree increments.

There is no persisted custom pivot today. Rotation uses the selection-box centre
or the pivot supplied to the engine for a gesture. Do not persist a world pivot
without a document-level product decision.

## Snapping

`tools/snapping.ts` is the single resolver for move snapping. It evaluates X
and Y independently, which deliberately permits compatible horizontal and
vertical winners to form a smart-guide intersection. Candidate priorities are
deterministic: grid, ruler guide, layout grid, object edge, object centre,
midpoint, then spacing; ties resolve by distance and stable iteration order.

Its threshold is eight CSS pixels converted to world units by zoom. Sticky
locks hold until one-and-a-half times that distance, so zoom changes do not make
snapping feel weaker or stronger. Pixel snap is an explicit document-world
integer snap; it is off by default and must not round normal sub-pixel geometry
or use physical device pixels.

Move snapping receives spatially filtered world bounds, persistent ruler-guide
targets, layout-grid data, and the snap session from the canvas tool context.
It returns its winning guides directly to `SnapGuidesOverlay`, keeping feedback
and correction sourced from the same result.

Bounding-box resize currently calls `snapSelectionBox` through the transform
engine's snap policy. That function provides selection-box centre, grid,
layout-grid, pixel-grid, and size matching, but does not yet return a guide
result to the overlay and therefore must not grow a second candidate resolver.
When resize smart-guide feedback is extended, it must return the same winning
per-axis candidates that produced its corrected box.

## Alignment and distribution

Alignment and distribution use `@varve/shared/align` for pure bounding-box
math. The editor obtains world bounds, calculates the target in world space,
then converts every resulting bound origin back into its node's parent-local
space. This permits selected siblings, nodes in different frames, and nodes
under transformed parents to align without reparenting them.

The selection target is the collective bounds unless an active key object or
page target supplies it. A valid key object remains stationary because every
other member aligns to its world bounds. Equal-gap distribution sorts by actual
geometric position, retains the first and last objects, and divides available
space after accounting for every intervening object's width or height. Equal
centre distribution is a separate command because it intentionally has a
different result for unequal object sizes.

Key-object and alignment-reference state is editor session state, not document
content; it is intentionally excluded from export and serialization.

## Precision, safety, and tests

Stored transforms and geometry are JavaScript numbers; no transform path rounds
coordinates merely for display. Inspector formatting may choose shorter visible
decimals, but a numeric commit must send the entered value through the canonical
editor operation. New transform code must reject non-finite or non-invertible
parent cases through the shared safe affine helpers rather than silently writing
corrupt geometry.

The focused transform tests cover image/frame policies, constraints, exact
post-commit geometry, and fractional path anchors and handles. In particular,
the geometry-baking regression checks that a non-uniform circle becomes a
closed cubic path with retained handles and that no scale component remains in
the committed node transform. The shared snapping and alignment tests cover
candidate priority, sticky release, screen-space thresholds, equal gaps, and
centre distribution.

Any change to transform state, scene/world conversion, or the selected-node
pipeline requires the affected validation closure plus a browser interaction
test when it changes a canvas gesture. For pixel-reuse changes, the render
pipeline oracle remains mandatory; transform correctness cannot be inferred
from frame rate or a visually plausible screenshot alone.
