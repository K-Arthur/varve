# Rasterization and vectorization capability audit

Date: 2026-08-28
Scope: vector-to-raster export and flattening, and raster-to-vector tracing.

This is an audit of the current branch before the DPI-accurate rasterization
and vectorization changes. It deliberately distinguishes output pixel density
from embedded density metadata, and silhouette/region tracing from centerline
tracing. The two pipelines have separate correctness contracts.

## Sources inspected

- `docs/architecture/export-resolution.md`
- `packages/scene/src/export/{resolution,plan,pipeline,model}.ts`
- `packages/editor/src/{exportService.ts,export/compositor.ts,flatten/renderSubtree.ts}`
- `packages/editor/src/components/{Export,SpecPanel/export.ts,Vectorize}`
- `packages/engine/src/{rasterSurface.ts,exportRasterizedSubtree.ts,rasterTrace.ts,traceBezierFit.ts}`
- `packages/engine/src/upscaleProviders/{traceDispatch,nativeTraceProvider,workerTraceProvider,directTraceProvider,wasmTraceProvider}.ts`
- `crates/varve-trace/src/{lib,contours,hierarchy,quantize,pixel_art,centerline,bezier_fit}.rs`
- `packages/editor/src/{imageOperations.ts,logo/vectorization,components/Vectorize}`
- `packages/scene/src/liveTrace.ts`

Recent history also shows that the canonical resolution model and PNG `pHYs`
writer landed independently (`cc0dc9ca`, `34109056`). This audit therefore
builds on those contracts rather than replacing them.

## Capability matrix

| Capability | Current | Correct | Partial | Missing | Action |
| --- | --- | :---: | :---: | :---: | --- |
| PNG export resolution | Canonical 96 design-unit/in resolution model | Yes |  |  | Preserve canonical resolver |
| JPEG/WebP resolution | Shared raster surface dimensions | Yes |  |  | Preserve canonical resolver |
| Explicit PPI/DPI | Resolution-mode export and PPI output plan | Yes |  |  | Use PPI internally; keep UI wording friendly |
| PNG density metadata | Controlled `pHYs` injection | Yes |  |  | Retain byte-level round-trip test |
| JPEG/WebP density metadata | Canvas encoder dimensions only |  | Yes |  | Do not claim metadata was embedded |
| Rasterize selected vectors | Flatten primitive exists but no complete Object workflow |  | Yes |  | Add only after transform contract is corrected |
| Rasterize frame | Raster export exists | Yes |  |  | Keep frame clip semantics |
| Rasterize with effects | Export compositor and effect expansion | Yes |  |  | Apply exact transform to expanded bounds |
| Transparent export | PNG/WebP alpha surfaces | Yes |  |  | Add crop-edge regression coverage |
| Exact document-edge crop | Canvas is a crop surface, but some paths use a uniform scale after independent rounding |  | Yes |  | Canonical source-bounds-to-pixels transform |
| Batch PPI override | Export dialog uses temporary resolution override | Yes |  |  | Preserve temporary-only semantics |
| Monochrome trace | Native and TypeScript providers | Yes |  |  | Preserve |
| Grayscale trace | Native and TypeScript providers | Yes |  |  | Preserve |
| Color trace | Oklab palette/region pipeline | Yes |  |  | Preserve |
| Pixel-art trace | Native and TypeScript providers | Yes |  |  | Preserve nearest/pixel-boundary semantics |
| Centerline trace | Native provider only; web is explicitly gated |  | Yes |  | Keep honest platform message |
| Threshold control | Exposed, serialized, and provider-mapped | Yes |  |  | Document semantics by trace mode |
| Simplification tolerance | Exposed and persisted, not uniformly applied in trace implementations |  | Yes |  | Make it a source-pixel simplification contract |
| Bézier fit tolerance | `maxError` is exposed and native-mapped | Yes |  |  | Preserve as separate source-pixel error |
| Corner sensitivity | `cornerAngle` is exposed and native-mapped | Yes |  |  | Preserve as separate control |
| Edge detection | No general photographic edge mode |  |  | Yes | Do not mislabel silhouette tracing as edge tracing |
| Compound holes | 4-connected contour topology and evenodd insertion | Yes |  |  | Preserve topology tests |
| Live/re-trace | Provenance plus replace-in-place workflow | Yes |  |  | Preserve one undo entry |
| Desktop parity | Native is feature-complete | Yes |  |  | Keep native first under Tauri |
| Web parity | Centerline/WASM capabilities are intentionally limited |  | Yes |  | Gate honestly; no silent fallback |

## Confirmed rasterization defect

`flattenNodes` independently rounds requested width and height, then derives
one `actualScale` from the fitted width and applies it to both axes. The same
pattern appears in raster export paths that allocate rounded dimensions and
replay using a requested uniform scale. For a non-integral scale, the resulting
source bottom or right endpoint need not map to the allocated bottom or right
pixel endpoint.

The correction is an exact affine transform with independently resolved axes:

```text
scaleX = targetPixelWidth / sourceBounds.width
scaleY = targetPixelHeight / sourceBounds.height
tx = -sourceBounds.x * scaleX
ty = -sourceBounds.y * scaleY
```

There is no device-pixel-ratio term and no universal half-pixel offset. The
raster surface itself is the output-space crop `[0, width) × [0, height)`;
internal geometry retains normal Canvas anti-aliasing.

## Confirmed tracing contract gap

The Vectorize UI correctly keeps region threshold, minimum area, corner angle,
and Bézier error separate. `simplifyTolerance` is also visible, persisted in
metadata, and sent through `RasterTraceOptions`, but the TypeScript and native
region pipelines do not consistently apply it before curve fitting. This makes
the control misleading and can leave avoidable point density in traced output.

The follow-up implementation must apply simplification in source-pixel units
before Bézier fitting, retain pixel-art's exact corner behavior, and verify
that a higher tolerance never increases the number of anchors for a fixed
input/settings tuple.

## Deliberate non-goals for this change set

- Replacing the existing PPI model or mutating document geometry for export.
- Pretending PNG density metadata implies more rendered pixels.
- Adding a generic photo-edge trace mode without a separately designed and
  tested segmentation/linking contract.
- Removing the native-first desktop provider order or faking centerline output
  from the TypeScript silhouette tracer.
- Tracing visible composited appearance; the current supported contract traces
  source pixels and the limitation remains explicit.
