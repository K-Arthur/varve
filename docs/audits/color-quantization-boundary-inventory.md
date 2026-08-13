# Color Quantization-Boundary Inventory

**Audit date:** 2026-08-13  
**Scope:** document colors, scene/engine IR, vector rendering, raster buffers,
compositor backends, import/export, and native image paths.

This inventory is the baseline for the high-precision color work. It separates
the canonical document value from derived display, raster, GPU, and codec
representations. A conversion to 8-bit is not automatically a bug; it is a bug
when the result is written back to canonical state or used as an intermediate
for an operation that claims to preserve document precision.

## Current lifecycle

```text
ManagedColor in Document
  -> scene/engine IR (tagged color object is retained)
  -> derived RGB/display or raster representation
  -> Canvas2D/WebGPU/codec boundary
```

The first arrow is currently structurally lossless for vector colors. The
second arrow is not uniformly lossless: several helpers intentionally produce
RGBA8 for display, while other helpers accidentally use that display result as
their working input.

## Boundary inventory

| Pipeline location | Current representation | Why 8-bit occurs | Required? | Can preserve precision? | Finding |
| --- | --- | --- | --- | --- | --- |
| `Document` fills, strokes, effects, gradient stops, text colors | Tagged `ManagedColor`; RGB/CMYK/Gray have optional `bitDepth` | None in the model; legacy colors default to `uint8` | No | Yes | Canonical model is already wider than RGBA8, but default factories still create legacy-scale values. |
| Scene → engine IR | `EngineColor`/`ManagedColorShim` | No conversion at the type boundary | No | Yes | Preserve the tagged object; do not replace this with an RGBA tuple. |
| `managedColorToRgba()` | RGBA8 tuple | Canvas/CSS and legacy engine consumers accept 0–255 channels | Yes for those callers | Yes, by using a separate normalized/working path | Legitimate display boundary only. It must never be the source for document edits or precision-sensitive math. |
| `managedColorToNormalized()` | 0–1 tuple directly from tagged channels | None; display conversion is no longer on the working path | No | Yes | **Fixed:** 16-bit/float values remain distinct for blending, gradients, effects, and proof transforms. |
| Gradient expansion in `engine/replay.ts` and shared interpolation | Fractional RGB channels until CSS/Canvas2D stop construction | Canvas gradients need display-compatible stops; final formatting is fractional but browser-surface precision remains limited | Only at final Canvas2D stop construction | Yes | **Fixed:** high-precision stop values are not rounded before interpolation. |
| Proofing in `editor/render/proofing.ts` | Normalized provider result, with explicit RGBA8 fallback | Runtime may only expose the legacy display provider | No for the derived proof working value | Yes | **Fixed:** normalized proof providers are preferred; RGBA8 is disclosed as preview fallback. |
| Effect color parameters in `engine/effectPipeline.ts` | Previously raw component numbers were mixed into an RGBA8 backdrop | Glass-material tinting consumed the union member directly | No | Yes, by normalizing the tagged color before the display-only effect pass | **Fixed in precision milestone:** RGB/CMYK/Gray/float colors now enter this pass through normalized working conversion. The `ImageData` backdrop remains an explicit preview boundary. |
| Canvas2D CSS colors and `CanvasRenderingContext2D` | Browser display surface, effectively RGBA8 | Browser API/display surface | Yes | No on the surface; yes in canonical state | Explicit display boundary. Document state must remain separate. |
| Canvas2D `ImageData` effects/masks | `Uint8ClampedArray` RGBA8 | `ImageData` API and existing effect contracts | Sometimes | Yes with a float/16-bit working buffer | Existing effects are display-precision operations unless upgraded or explicitly marked as preview fallback. |
| WebGPU base compositor | `rgba8unorm` texture; normalized managed-color vertex upload | Current backend selects the broadest universally available preview format | No for an intermediate | Yes with capability-selected `rgba16float`/`rgba32float` | **Partial fix:** vector colors now reach the GPU in normalized working values; the preview target remains RGBA8 and must not become canonical state. |
| WebGPU effect runner | `rgba8unorm` storage texture + `Uint8ClampedArray` readback | Current effect kernels and runner contract | No for canonical/effect working data | Yes with float storage/readback path | **Root cause:** GPU effects quantize every pass when used on high-precision content. |
| Raster pixel buffer descriptor | Typed `rgba8`, `rgba16`, `rgba16f`, `rgba32f` storage plus encoding/alpha metadata | Format is selected by owner | No | Yes | **Implemented:** budgeted allocator, half-float helpers, and non-mutating `convertPixelBufferFormat()` quantization boundary; decode integration remains separate. |
| Raster analytic transform over `ImageData` | In-place RGBA8 | The API accepts `ImageData` | Yes for `ImageData` callers | Yes via `convertFloat32()`/typed buffers | Explicit low-precision adapter; must not be used to overwrite a higher-precision source asset. |
| Raster analytic transform over typed buffers | RGBA8/16 integer or RGBA16F/32F float storage | Integer formats quantize only when writing the selected storage format | No | Yes | **Implemented:** `convertPixelBuffer()` is tiled, cancellable, preserves alpha mode, and updates the target encoding only after success. |
| Image cache identity | URL-only by default; optional stable raster-encoding variant | Previously a future converted representation could collide with source pixels | No | Yes | **Implemented:** full-size and at-size cache keys can be partitioned by `rasterEncodingKey()`; decode conversion remains a separate provider concern. |
| PNG/JPEG/WebP export policy | Destination is currently 8-bit RGB | Common browser encoders/output contracts | Format-dependent | PNG16/TIFF/float outputs require separate encoders | Quantization is valid only when the selected target requires it and must be disclosed. |
| GIF export | Indexed palette, max 256 colors | GIF file format | Yes | No | Explicit output limitation. Never feed GIF output back into the document. |
| Desktop background removal / AI helpers | Rust `DynamicImage::to_rgba8()` and RGBA8 output | Model and image codec contracts | For current model path | Yes only by retaining the source separately | Scoped processing boundary; source asset metadata/state must not be replaced by the preview result. |
| Native/WebAssembly render bridge | Render IR carries tagged colors; shader validation fixtures write `rgba8unorm` | Preview shader target | No for canonical IR | Yes with a separate high-precision render target | Keep native/WASM IR color contract independent from preview texture format. |

## Required changes derived from this audit

1. ~~Make normalized working conversion direct from the tagged channels.~~
   Completed in `@varve/shared`.
2. ~~Keep gradient interpolation in normalized/high-precision values and
   quantize only while constructing a Canvas2D-compatible display stop.~~
   Completed in `@varve/engine` and `@varve/shared`.
3. ~~Ensure proofing and other derived transforms do not rebuild authoritative
   colors from an RGBA8 tuple.~~ Completed for effects and editor proofing;
   legacy providers remain explicit preview fallbacks.
4. Carry pixel-buffer format and color-encoding metadata across raster decode,
   cache, transform, compositor, and export boundaries. The typed storage
   contract is implemented; end-to-end decode/cache/compositor integration is
   still pending.
5. Keep Canvas2D, `ImageData`, `rgba8unorm`, JPEG, GIF, and model-specific RGBA8
   paths explicitly labeled as output/preview or capability boundaries.

## Baseline regression corpus

The existing unit corpus covers legacy boundary values and basic high-precision
conversion. The high-precision regression suite must additionally prove:

- more than 256 distinct normalized RGB levels survive a working pass;
- uint16 and float32 CMYK channel values remain exact until explicit display
  conversion;
- editing one channel does not rewrite the other channels;
- gradient samples are not rounded before interpolation;
- save/reopen preserves color values, model, bit depth, and profile identity;
- a display conversion never mutates the source `ManagedColor`.

These are numerical assertions; screenshots alone cannot establish them.
