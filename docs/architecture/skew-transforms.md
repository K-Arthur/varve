# Skew Transform Support

## Transform Representation

Varve uses the canonical 2x3 affine matrix `[a, b, c, d, e, f]` matching the
HTML Canvas and kurbo conventions. This matrix inherently supports shear/skew:

```
| a  c  e |
| b  d  f |
| 0  0  1 |
```

### Composition order

`M = translate · rotate · skew · scale`

### Decomposition

`decomposeAffineFull()` in `@varve/shared/affine.ts` extracts:
- `translateX`, `translateY` — from e, f
- `rotation` — from atan2(b, a)
- `scaleX`, `scaleY` — from hypot(a,b), det/scaleX
- `skewX` — from (a·c + b·d) / scaleX^2

Returns `null` for singular (det=0) matrices.

## Extracting Skew (formerly `extractTRS`)

The original `TransformEngine.extractTRS()` rejected shear at
`Math.abs(a*c + b*d) > 1e-6 * scaleX * scaleY`. This was replaced with
`decomposeAffineFull()` which preserves skew in the decomposition.

## Bake Behavior

When `bakeNode()` detects non-zero skew (`|skewX| > 1e-9 || |skewY| > 1e-9`),
the full affine matrix is preserved in `node.transform` instead of baking
scale/rotation into geometry. This prevents data loss for text, shape, and
frame nodes.

## Canvas Handles

Four diamond-shaped skew handles appear at edge midpoints of the selection box:
- East/West handles → vertical drag applies skewY
- North/South handles → horizontal drag applies skewX

Each drag composes a shear matrix `[1, tan(θ), 0, 1, 0, 0]` (skewY) or
`[1, 0, tan(θ), 1, 0, 0]` (skewX) onto the transform delta.

## Inspector

Skew X/Y fields exist in `PositionSizeSection.tsx` and are fully wired:
- Reading: `decomposeAffineFull()` → `atan(skewX) * 180/π` for degree display
- Writing: `setSelectedSkew()` applies shear to the affine matrix

## Export

- SVG: matrix and skewX/skewY transforms are supported
- Raster: rendered correctly via full affine transform
- PDF: affine transformation matrices supported
- Codegen: uses `transform: matrix(...)` 

## Animation

Skew properties can be keyframed via the property paths `"skewX"` and `"skewY"`.
The `interpolateAffine()` function already handles all 6 matrix elements
including skew components.
