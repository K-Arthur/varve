# Photo editing and compositing capability audit

Date: 2026-09-08  
Status: current product-truth checkpoint; this is an evidence map, not a
claim that every Photoshop-class workflow is implemented.

## Executive diagnosis

Varve already has one coherent non-destructive image path for the core editing
surface:

```text
image asset / image-filled shape
  → Image Tuning, Object Filters, or Adjustment Layer
  → shared Adjustment → FilterIR → CPU/Canvas2D replay
  → canvas, thumbnail, raster export, or affected-subtree fallback
```

The important ownership boundaries are now explicit:

- Image Tuning is the curated, image-local correction surface.
- Object Filters remain attached to one rendered node and preserve stack order,
  entry opacity, blend, and bypass state.
- Adjustment Layers resolve a backdrop scope and optional adjustment mask.
- Layer/effect masks, clipping relationships, pixel selections, and
  background-removal masks are related through shared mask primitives but are
  not the same serialized ownership.
- Retouching writes raster-layer history; it does not masquerade as an
  adjustment or filter.
- Depth resources are persisted reusable guides for depth-aware effects and do
  not replace source image pixels.
- RIFE is an experimental derived-image operation called **Frame
  Interpolation**. It is not ordinary layer compositing and is not advertised
  as such.

The remaining limitations are mostly capability boundaries rather than hidden
fallbacks: per-entry Object Filter masks need a dedicated coordinate contract,
HDR/ICC/CMYK effect math is not claimed by the RGBA8 reference path, and RIFE
output still needs reference-runtime validation.

## Capability matrix

| Capability | User entry point | Canonical owner | Canvas / export | Save/reopen | Undo/cancel | Current status | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Image placement, crop, fit, rotation, and source-preserving transform | Image Placement, Crop, transform tools | Image geometry + image-filled shape | Shared replay; raster export uses the same source geometry | Persisted image fill and transform | Coherent transform/crop transactions | complete for the supported image model | Keep the crop/geometry contract; do not add destructive trim to this path |
| Basic photo correction | Photo → Image Tuning | Image-local `smartFilters`/adjustment schema | FilterIR CPU reference and Canvas2D replay; raster export participates | Normalized adjustment/filter persistence | Parameter transactions and bypass/reset | complete for the supported catalog | Continue adding only through the canonical filter registry |
| Scoped correction | Adjustment Layer editor | `AdjustmentNode` + `AdjustmentScope` + optional adjustment mask | Bounded backdrop compositor and raster export | Scope, mask, and entries persist | Layer/entry operations are undoable | complete for supported adjustments | Preserve scope and mask separation |
| Node-local creative finishing | Appearance → Object Filters / Effect Studio | Renderable node `smartFilters` | Shared object replay and export fallback | Ordered entries persist | Preview sessions, reorder, bypass, reset | complete but intentionally advanced | Keep Studio and Object Filters as two surfaces over one owner |
| Selection ↔ persistent masks | Selection tools, Mask section, background removal/object selection | Shared pixel-selection and raster-mask contracts | Transformed mask replay uses document coordinates | Mask identity and provenance persist | Selection/mask conversion is undoable | functional, expanding | Continue coverage for feathering, transforms, and stale source resources |
| Background removal and object selection | Photo → Background Removal / Object Selection | Segmentation workflow + raster mask | Preview/apply through the image/mask path | Provenance and source invalidation are persisted | Cancel/stale request handling is explicit | functional with model/runtime limits | Keep inference optional and local-first |
| Retouching and repair | Retouch tool family | Writable raster target + retouch history | Raster replay/export path | Derived pixels and history-safe raster data persist | Stroke/patch transactions, cancel/no-op handling | functional for shipped tools | Do not add model-backed inpainting without model/license/runtime evidence |
| Depth generation and Depth Blur | Photo → Lens Blur / Depth Blur | Persisted DepthMap resource + depth-aware effect | Shared preview/replay; source pixels preserved | Map metadata/provenance and staleness persist | Generate/regenerate/cancel | functional but relative-depth only | Keep metric depth, transparent-material accuracy, and 3D reconstruction out of claims |
| Layer opacity, blends, clipping, isolation | Layers and Object/Adjustment surfaces | Structural compositor | Canvas and raster export share replay semantics | Scene structure persists | Structural operations are undoable | functional for supported modes | Maintain premultiplied-alpha and transparent-edge goldens |
| Import/save/reopen/export | File/import/export workflows | Asset registry + document codec + export compositor | Unsupported editable structures rasterize with preflight rather than vanish silently | Assets, filters, masks, depth, and provenance are normalized | Export cancellation/errors are surfaced | partial by format/color space | Keep ICC/CMYK/HDR and very-large-image limits explicit |
| RIFE frame interpolation | Photo → Frame Interpolation | Optional local inference + derived image insertion | Preview is a generated bitmap; Apply inserts a new image layer | Applied result opens without the model | Abort prevents apply; Apply creates one derived result | experimental / incomplete | Validate channel convention and large-image memory before upgrading status |

## Consolidations made

The current architecture consolidates shared mechanics without flattening
meaning:

1. Adjustment and Object Filter parameters lower through the same engine
   catalogue and `FilterIR` reference path.
2. Live Canvas2D replay and raster export use the same structural compositing
   rules, with rasterization only at unsupported vector/effect boundaries.
3. Selection, segmentation preview, mask creation, and mask replay share
   coordinate and provenance rules.
4. Expensive preview/apply work uses explicit cancellation and stale-result
   rejection rather than committing late asynchronous output.
5. Photo discovery is progressively disclosed: Image Tuning for common image
   corrections, focused editors for depth/masks/curves, and Object Filters or
   Effect Studio for advanced stacks.

## Distinctions intentionally preserved

- A layer mask controls node visibility; an adjustment mask controls where a
  scoped filtered backdrop is revealed.
- A clipping path/mask is structural containment, not an editable alpha mask.
- A transient selection is not a document resource until explicitly converted.
- Object Filters do not widen to siblings; Adjustment Layers do not mutate
  source pixels.
- Layer opacity is not filter opacity.
- RIFE frame interpolation is not normal layer blending.
- Proxy previews and model outputs are not silently substituted for the
  persisted source asset.

## Website and help truth

The Photo workspace and image-treatment pages describe the supported
non-destructive path. The former “Blend Images” label was misleading because
the implementation invokes RIFE. The control is now presented as **Frame
Interpolation**, retains its legacy section id for preference compatibility,
and is described as experimental in both the app and the website guide. No
marketing claim should call it compositing, a blend mode, or timeline frame
management.

## Validation boundary

The focused checks for this checkpoint are:

- section-registry and feature-ownership tests for the Frame Interpolation
  label and experimental status;
- editor and downstream affected validation from `pnpm verify:affected`;
- website typecheck/build for the new guide and cross-links;
- browser visual review of the Photo adjustments panel and the new website
  guide in light/dark and narrow layouts.

The repository still needs platform-specific GPU, Tauri, screen-reader, and
large-image memory lanes before making cross-platform parity claims.
