# Export resolution and effective raster resolution

Varve keeps four different quantities separate:

1. **Document geometry** is the scene's fixed design-space coordinate system.
   Physical page/frame presets are converted to this space at 96 px/in. A
   frame's width and height do not change when an export uses another PPI.
2. **Output pixels** are resolved by an export configuration. Multiplier modes
   produce `geometry × multiplier`; resolution mode produces
   `geometry × (PPI / 96)`. Width/height modes use pixels directly or convert
   physical units through the same fixed 96 px/in reference.
3. **Physical size** is the document-space bounds divided by 96. A physical
   target raster uses `inches × PPI`, with one deterministic rounding policy:
   round to the nearest pixel and clamp the minimum to one.
4. **Effective PPI** is derived for each placed raster from its native source
   pixels and the displayed source sample size. It is not an editable source
   metadata field, and it is not the same as the document's export intent.

The canonical implementation lives in `packages/scene/src/export/resolution.ts`
and is consumed by the export plan and print preflight. `document.dpi` remains
document-level print metadata/preflight intent; it is never used as a hidden
geometry conversion or as the denominator for an explicit export PPI.

## Raster and vector behavior

Raster formats render the scene directly at the resolved output dimensions, so
vectors, text, gradients, and effects are rasterized at the requested density.
Changing output resolution does not mutate a placed image's source asset. A
low effective-PPI finding is advisory and leaves the user to choose a smaller
placement, lower output PPI, conventional resampling, or the existing image
enhancement workflow.

Tile fills do not receive a fabricated whole-object PPI; their tile scale is a
different diagnostic. Non-uniform transforms expose axis-specific values and
preflight uses the lower axis. Rotation and translation do not lower density.

PDF/SVG retain vector content where the format/backend supports it. PPI is
relevant to their embedded raster assets and raster fallback regions, not to a
generic page-wide bitmap. Canvas encoders provide the output pixel dimensions
but are not relied on for density metadata: the final PNG byte stream receives
a controlled `pHYs` chunk when the export has an explicit output PPI. JPEG and
WebP density metadata are not currently authored, so the UI must not claim it
was embedded for those formats.

## Raster crop transform and pixel convention

Every raster surface is an output-space crop, never an antialiased vector
rectangle. Given source bounds `{ x, y, width, height }` and an already
allocated target `{ pixelWidth, pixelHeight }`, rasterization uses one affine
mapping:

```text
scaleX = pixelWidth / width
scaleY = pixelHeight / height
translateX = -x × scaleX
translateY = -y × scaleY
```

This maps the source endpoints exactly to `[0, pixelWidth] × [0,
pixelHeight]`. Width and height are independently resolved after the canonical
nearest-pixel rounding policy, so a width-derived scale must never be reused
for the vertical axis. The backing surface clips output to `[0, pixelWidth) ×
[0, pixelHeight)`; artwork that reaches that crop boundary has full coverage
there, while internal diagonal/vector edges keep normal Canvas anti-aliasing.

There is no device-pixel-ratio multiplier in export and no blanket `+0.5`
translation. DPR belongs to an interactive display backing store, not a
requested export bitmap; a half-pixel adjustment is only valid for a specific
primitive/raster API convention and is not part of this general mapping.

## Batch export

The export dialog shows resolved pixel dimensions before execution. Its
temporary “Override raster outputs” control applies one PPI to the selected
raster jobs for that run only. It does not alter saved per-node presets or
source image assets; vector/PDF jobs are left on their own format semantics.

Output limits are resolved before rendering. If a raster job exceeds the
runtime's axis or pixel budget, the plan records the requested and safe output
dimensions and preflight surfaces an explicit acknowledgement finding instead
of silently presenting the reduced dimensions as requested.

The reusable subtree fallback follows the same rule. It fits the
effect-expanded raster surface through the shared allocation policy before
rendering, preserves its aspect ratio, and returns both requested and encoded
pixel dimensions plus the limiting guard (`dimension` or `area`). A caller
must surface that constraint; it must not label the reduced image as if the
requested PPI were rendered.

Selection/layer flattening uses the same contract. Its `FlattenOptions.dpi`
field is resolved as `scale = dpi / 96` before allocation; legacy callers may
continue to pass `scale` when they intentionally want a density-independent
multiplier. A supplied PPI always wins over `scale`, invalid PPI values are
rejected, and width/height are rounded independently. This keeps the
rasterized replacement at the original document-space placement while making
its effective output density explicit.

## Inspector image diagnostics

When a single image shape is selected, the Inspector shows an **Image
Resolution** section with read-only diagnostics: source pixel dimensions
(native asset size), placed size in millimeters, and effective resolution in
PPI. When effective PPI falls below 300, a warning note is displayed. These
values are derived from the canonical `effectiveRasterPpiForNode` calculation;
they are not editable because they are computed from source pixels and the
current placement transform.

## Clone and duplication

Duplicating or copy-pasting a node with export presets regenerates every
preset id using the document's collision-resistant minting counter (prefix `p`).
This prevents two independent copies from sharing the same preset ids, which
would collapse batch plan lookups keyed by configuration id. Preset option
sub-objects are shallow-cloned to avoid shared mutable state across nodes.

## Frame context menu

Right-clicking a single frame shows an **Export Frame…** entry that opens the
Export Dialog with the frame pre-selected. The dialog resolves the frame's
saved presets and shows output dimensions and preflight warnings before
execution. This provides a quick path to export without navigating through the
File menu or keyboard shortcuts.

## Batch summary preview

The Export Dialog shows a one-line aggregate summary above the file list:
total file count and the largest output dimensions (e.g. "3 files · Largest:
2400 × 1600 px"). This helps catch accidental high-resolution exports before
execution, especially when many frames have multiple export presets.
