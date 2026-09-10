# Boolean Geometry and Pathfinder

Varve's Pathfinder resolves filled, closed vector geometry through one shared
TypeScript kernel. The same deterministic code is used by web and desktop;
there is no native-only Boolean implementation to drift from the browser.

## Current architecture

```text
editable ShapeNode operands
  -> placed-world compound regions
  -> translation-normalized working frame
  -> polygon-clipping sweep-line kernel
  -> component + hole result
  -> even-odd compound path
  -> destination-parent local placement
```

`packages/scene/src/boolean/` owns the kernel. `integration.ts` is the only
scene adapter: it samples source curves, lifts operands into a common placed
world coordinate system, and places destructive results back in the base
operand's parent-local space.

The clipping dependency is `polygon-clipping` 0.15.7 (MIT). It provides
synchronous ESM/CJS/browser builds, bundled TypeScript declarations, N-ary
union/intersection/difference/XOR and a Martinez-Rueda-Feito sweep-line core.
Its published API has `O((n + k) log n)` complexity, where `n` is edge count
and `k` is intersection count. It was selected over a second desktop-only
kernel so saved documents have identical topology on desktop and web.

## Audit: state before this overhaul

| Concern | Previous behaviour | Correct? | Risk | Required action |
| --- | --- | ---: | --- | --- |
| Curve handling | Adaptive sampling with a fixed flatness threshold; circles used 48 segments | No | Scale-dependent quality and corner-only results | Relative adaptive flattening; retain the curve-output limitation below |
| Intersection detection | Hand-written segment walking with fixed epsilons | No | Phantom intersections and coincident-edge failures | Replace with one sweep-line kernel |
| Coincident edges | Not represented as a separate topology case | No | Duplicate boundaries and spikes | Delegate shared edges to kernel; clean only redundant vertices |
| Self-intersections | Recursive local splitting, then first-contour-style reduction | Partial | Some fill semantics could be discarded | Split simple crossings before clipping and retain every resolved part |
| Multiple contours | Result was one `PathPoint[]` | No | Disconnected islands could be concatenated | Preserve components and additional subpaths |
| Holes | Not carried through the clipping boundary consistently | No | Donuts became solids or malformed paths | Pass compound regions to the kernel and use even-odd output |
| Fill rules | Implicit orientation / default Canvas fill | Partial | Imported holes could render differently | Preserve input subpaths; use explicit even-odd Boolean output |
| Union | Pairwise manual contour assembly | Partial | Incorrect disjoint/contained results | N-ary kernel union |
| Subtract | Sequential clipping with selection-order side effects | No | Unclear subject and lost cutters | First operand is the explicit base; subtract all remaining operands |
| Intersect | Pairwise first-contour reduction | No | Lost disconnected intersections | N-ary kernel intersection |
| Difference/XOR | Two subtract passes and concatenation | No | Not parity for more than two inputs | Genuine N-ary kernel XOR |
| Multi-operand ops | Accidental pairwise semantics | No | Operation-specific topology drift | Define N-ary semantics once |
| World/local transforms | Existing placed-world conversion and result placement | Yes | Regression risk, not redesign work | Retain and regression-test it |
| Non-destructive booleans | No durable scene representation | No | Source editing forced destructive expansion | Live Boolean group model |
| Destructive expansion | Replaced operands, but output could lose topology | Partial | Invalid or partial paths | Emit explicit compound path/empty path |
| Precision policy | Fixed constants mixed through the segment walker | No | Translation/scale instability | Normalize and derive tolerance from operation scale |
| Cleanup | Global simplification after clipping | No | Legitimate small artwork could disappear | Remove only duplicate, zero-length, and provably collinear vertices |
| Undo | Snapshot infrastructure already atomic | Yes | Must preserve hierarchy in live operations | Route UI mutations through one transaction |
| Export parity | Existing path renderer supports holes/even-odd | Partial | A new live group needs resolution at each export path | Resolve live groups before export/replay |

## Region model

Internally a result is a list of components:

```ts
type RegionComponent = {
  outer: Point2D[];
  holes: Point2D[][];
};
```

The public compatibility result also exposes flat `outerContours` and `holes`.
When serializing to Varve's path shape, `contours` is the canonical authored
ring list (outer first). `points` and `holes` remain populated as a compatibility
projection for older readers. Despite the historical `holes` field name, these
are additional subpaths, not necessarily holes: even-odd filling correctly
represents disconnected islands, holes, and nested island/hole parity without
joining rings with false segments.

Canvas replay and engine hit testing already append all path subpaths and apply
the explicit fill rule. Therefore a donut's centre is not a fill hit, and a
disconnected result remains disconnected.

## Operation semantics

- Union: union of every selected operand.
- Subtract: `base - union(cutters)`. The first selected operand is the base;
  live Boolean Layers order makes that choice visible and reorderable.
- Intersect: region shared by every selected operand.
- Exclude: N-ary XOR. A point survives only when it belongs to an odd number
  of operands. It is not implemented as a pair of subtract operations.

Open centreline paths, arrows, and lines do not provide filled regions. They
are rejected by the region adapter rather than receiving an invisible closing
edge. Authors can outline a stroke first when they want stroke-area Boolean
semantics.

## Numerical policy

Before a Boolean operation, all input contours move by the combined operation
bounds origin. This improves conditioning for documents at large positive or
negative offsets. The working tolerance is a small fraction of the combined
bounding-box diagonal, with only a floating-point safety floor. Cleanup uses
that tolerance only for adjacent duplicates, zero-length edges, collinear
points within linear error, and components below the corresponding numeric
area floor. It never uses a fixed world-unit size to erase artwork.

The underlying kernel depends on robust predicates for sweep ordering. The
adapter closes input rings, canonicalizes winding for the kernel, removes only
redundant output vertices, and returns all components produced by the kernel.

## Live Boolean groups

A live Boolean is a normal `GroupNode` with versioned `boolean` state. Its
direct `children` are its ordered operands. There is deliberately no persisted
resolved path cache. `resolveLiveBooleanShape()` has an ephemeral `WeakMap`
cache keyed by immutable document identity, so repeated rendering of an
unchanged document reuses derived geometry while every child edit, transform,
operation change, or operand reorder automatically resolves afresh without
flattening sources.

Live groups can nest. Resolution has cycle and depth guards, so malformed
documents cannot recurse indefinitely. Creating one moves selected operands
under the live group while converting their transforms to the group's parent
space, preserving each operand's placed-world geometry even across frames.

`expandLiveBooleanDoc()` is the destructive boundary: it resolves the group,
removes the live group and its source children, and inserts a directly editable
compound path at the same parent and sibling anchor. UI callers must wrap both
creation and expansion in a single history transaction.

## Explicit current limitations

- The selected kernel is polygonal. Bézier inputs are flattened adaptively and
  intersection output contains corner nodes; it does not reconstruct cubic
  curves. No-op/single-valid-operand conversions preserve authored Bézier
  handles (including affine placement), but a curve-aware WASM kernel or a
  validated fitting stage is still required for curve-preserving intersections.
- Compound paths now serialize their authored rings in the additive `contours`
  field. The legacy `points`/`holes` projection remains for compatibility, and
  component ownership is still represented by the resolved Boolean cache rather
  than a separately serialized component graph.
- Self-intersecting polygon input is split through a deterministic planar
  half-edge arrangement, retaining every bounded face and assigning holes to
  the face that contains them. Arbitrary looping Béziers are still subject to
  adaptive flattening, and pathological self-touching/overlapping paths may
  require a dedicated fill-rule-aware arrangement implementation.
- Existing Boolean actions now create live groups by default. The contextual
  menu exposes **Expand Boolean** and all four operation changes; normal Group
  expansion and child ordering in Layers expose source operands and Subtract's
  explicit base. Open paths, lines, arrows, image-filled shapes, hidden nodes,
  and locked nodes are rejected consistently by command and toolbar surfaces.
- The Properties inspector now exposes a Pathfinder section for live groups:
  operation changes, ordered operand selection/isolation, safe removal while
  retaining the two-operand minimum, and destructive expansion. Adding an
  operand from an arbitrary external selection is still future work; use
  Layers/reparenting to add a source today. SVG export has live-Boolean
  resolution fixtures, and native PDF emits compound rings with the authored
  fill rule.

## Validation corpus

The focused suite covers base-minus-union semantics, true N-ary XOR parity,
contained holes, hit topology, compound input, identical paths, shared edges,
translation and scale stability, cross-parent live operand preservation,
operation change/reorder, expansion, renderer substitution, deterministic
multi-crossing face recovery, and Pathfinder inspector controls. Deterministic
polygon complexity fixtures live in
`packages/scene/src/__benchmarks__/booleanGeometry.bench.ts`; future work can
add broader fuzzing, curve-error measurements, and pointer-driven inspector
coverage.
