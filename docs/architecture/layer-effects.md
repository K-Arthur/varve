# Layer Effects

**Date:** 2026-09-07 | **Status:** Verified in the Canvas2D/editor path

Layer Effects are non-destructive appearance effects owned by the scene node
that produces the pixels. They are distinct from Object Filters (adjustment
operations) and from Effect Studio recipes. The scene model, inspector,
transfer helpers, worker replay, structural replay, and export planning all
read the same `Effect[]` contract.

## Eligible owners

| Owner | Layer Effects | Coverage source |
| --- | --- | --- |
| Shape, path, component instance | Yes | Vector fills and strokes |
| Text | Yes | Shaped glyph alpha, decorations, and strokes |
| Group and frame | Yes | Composited child surface |
| Table | Yes | Composited table surface |
| Raster layer | Yes | Sparse tile surface and true tile alpha |
| Image-filled vector | Yes | Placed image alpha, crop, and background-removal mask |
| Adjustment layer | No | Its scope is the adjustment/filter pipeline, not a drawable silhouette |

Raster layers created by current code always receive `effects: []`. Document
normalization materializes that array for older files before editing. A
capability check still recognizes a legacy raster layer before normalization,
so adding an effect cannot silently do nothing.

## Execution order and editing order

The authored array preserves entry identity and masks. Rendering uses stable
execution stages:

1. **Backdrop:** Background Blur and Glass Material backdrop acquisition.
2. **Content:** fills/strokes followed by Layer Blur, Depth Blur, Chromatic
   Aberration, and Glitch.
3. **Appearance:** Drop Shadow, Inner Shadow, Outer Glow, and Inner Glow.
4. **Material highlight and post-processing:** Glass edge highlight and any
   required final compositing.

The inspector exposes one compact list, but its move controls are stage-aware:
an entry can move only to the nearest entry in the same execution stage. A
cross-stage move is disabled because it would not change pixels. Within a
stage, differently coloured shadows/glows retain meaningful authored order.
The serialized array is not silently sorted behind the user.

## Coverage and spread

Geometric replay is used only when it is equivalent to the painted coverage.
Text, raster layers, image fills, gradients, patterns, translucent fills,
compound paths, and stroke-only paths use an alpha-silhouette source. Raster
and image sources therefore preserve transparent holes, sparse tiles, crop
placement, and mask alpha; path fill rules preserve authored vector holes. A
missing offscreen buffer skips the optional effect rather than painting a
rectangular fallback over editable content.

Positive and negative spread are applied as bounded alpha dilation/erosion in
the alpha-aware path. Spread is not folded into `shadowBlur`; blur remains a
softness radius. Bounds include absolute spread, directional offsets, depth
blur, chromatic offsets, and glitch displacement conservatively.

Backdrop caches are scoped to a single replay. A new document revision or
underlying-content change therefore cannot reuse a stale backdrop merely
because the camera and effect geometry are unchanged.

## Identity, masks, and history

Every authored effect has a stable ID. Legacy IDs are deterministic during
normalization. Duplicate and transfer operations deep-clone nested parameters
and mint independent IDs. Effect masks are resolved by effect ID, not array
position; reset retains the mask while remove, duplicate, reorder, and transfer
keep mask ownership attached to the correct entry. Mask edits use one editor
transaction and validate scene-node/vector/raster sources and cycles.

Mixed selection uses the first non-empty compatible stack as the display
reference, aligns other owners by ID and then by same-stage/type ordinal, and
marks missing rows rather than showing an unrelated effect at the same array
index. Editing an absent row leaves that owner unchanged. Add appends a valid
default to every eligible owner, including empty and legacy raster stacks.

## Persistence and export

The canonical scene field is `effects`; raster-layer canonical ordering and
document normalization include it. Native/Rust interchange transports the
effect variants, but Canvas2D/software replay remains authoritative for
effects that a target cannot reproduce natively. SVG/PDF/export consumers must
rasterize the smallest affected compositing region when a target lacks the
required blur, backdrop, alpha, mask, or procedural semantics. Text, vector
geometry, and source raster assets remain editable in the document.

For pass-level details, see
[Effect Rendering Architecture](effect-rendering.md). The marketing website
has a matching user-facing Layer Effects feature page.
