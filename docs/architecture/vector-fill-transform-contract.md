# Transform-Stable Vector Fill Contract

`GradientFill.transform` is the single authoritative representation of an
explicit spatial gradient. It is a Canvas-style affine tuple
`[a, b, c, d, e, f]`, mapping the unit fill square into the painted node's
local geometry space:

```text
fill-local [0, 1] × [0, 1]
  -- GradientFill.transform (G) --> node-local geometry
  -- node local transform and ancestors (N) --> document/world
  -- camera --> screen
```

With Varve's column-vector convention, `multiplyAffine(parent, child)` applies
`child` then `parent`. Therefore a point in fill-local coordinates reaches the
world as `N · G · p`.

The canonical handles are derived, never stored separately:

- Linear: start `G · [0, 0.5]`, end `G · [1, 0.5]`.
- Radial: centre `G · [0.5, 0.5]`, primary axis `G · [1, 0.5]`, secondary
  axis `G · [0.5, 1]`.

The two radial axes deliberately preserve ellipse, rotation, reflection, and
shear. A radial gradient must not be reduced to a centre plus one averaged
radius.

## Linked transform rules

For a live node transform, the gradient matrix is unchanged: the node's world
matrix carries both geometry and fill together. Translation, rotation, parent
transforms, grouping, reparenting with world-pose preservation, and unbaked
scale therefore do not mutate `GradientFill.transform`.

For a local geometry bake `B`, linked fills must be updated using:

```text
G' = B · G
```

The same equation applies independently to every gradient fill and gradient
stroke. It is the condition that makes the preview and the committed geometry
equivalent:

```text
Npreview · G = Ncommitted · G'
```

where `Npreview = Ncommitted · B`.

## Legacy gradients

Older documents may contain only `rotation`. They continue to render with the
historic bounds-and-rotation appearance until an operation requires explicit
geometry. At that boundary, Varve materializes the equivalent affine matrix
from the *pre-bake* bounds. It must never recreate a custom or legacy gradient
from post-transform bounds defaults.

The shared helpers in `packages/shared/src/gradientGeometry.ts` own this
materialization and handle derivation. Scene data flows unchanged through
`sceneToEngine`, then into fill IR and replay; SVG/PDF/export paths must use
the same matrix semantics.

## Coordinate spaces

- **Screen space**: CSS pixels used by pointer events and handle hit targets.
- **Viewport space**: screen space after the editor camera and floating origin.
- **World/document space**: placed pasteboard coordinates, including page
  placement and ancestor transforms.
- **Parent-local space**: a child's direct parent coordinate system.
- **Node-local/shape-local space**: coordinates of the node's primitive or
  path before `node.transform`.
- **Fill-local space**: the normalized unit square consumed by `G`.

Pointer editing must follow screen → world → node-local before writing a new
fill matrix. Handles are screen-sized UI; their stored coordinates remain
unrounded node-local affine values.

The inspector's linear **Rotation** field is a derived view of `atan2(b, a)`.
When edited for a single selected node, it rotates the whole affine field about
its fill centre and writes `transform`; it does not overwrite the legacy
`rotation` compatibility field or reset the secondary basis.
