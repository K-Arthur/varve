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
generic page-wide bitmap. The browser canvas encoders currently provide output
pixel dimensions but do not guarantee embedded PNG/JPEG/WebP density metadata;
the UI therefore does not claim that metadata was written.

## Batch export

The export dialog shows resolved pixel dimensions before execution. Its
temporary “Override raster outputs” control applies one PPI to the selected
raster jobs for that run only. It does not alter saved per-node presets or
source image assets; vector/PDF jobs are left on their own format semantics.

Output limits are resolved before rendering. If a raster job exceeds the
runtime's axis or pixel budget, the plan records the requested and safe output
dimensions and preflight surfaces an explicit acknowledgement finding instead
of silently presenting the reduced dimensions as requested.
