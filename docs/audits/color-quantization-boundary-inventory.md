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

## Deep audit — raster lifecycle (2026-08-13)

Full end-to-end flow from imported asset bytes to the compositor:

| Hop | Module:function | Precision |
| --- | --- | --- |
| Import byte inspection | `import/import.ts` `importImageAsFile` | lossless (no decode) |
| Asset bytes → data URL | `import/bitmap.ts` `bytesToDataUrl` | lossless |
| ICC + `colorEncoding` (incl. bitDepth 8/10/12/16) recorded | `import/import.ts:90-149` → `DocumentAsset.metadata` | metadata only — **dies at the scene model** |
| Decode for display | `engine/imageCache.ts:264` `new Image()`, `:627/:634` `createImageBitmap` | **8-bit boundary — browser decoder** |
| Worker transfer | `editor/render/collectImageBitmaps.ts:283-367` | 8-bit bitmap handoff |
| Replay | `engine/replay.ts:1061` `paintImageFill` → `drawImage` | 8-bit source drawn |
| WebGPU composite | `compositor/webgpu/backend.ts:445` | images never uploaded to GPU textures — Canvas2D present surface |
| Animated media | `crates/varve-media/src/decode.rs:188` (`STRIP_16`) → `media/frameCache.ts` | **16-bit stripped at decode** |
| Raster paint layers | `engine/rasterPyramid/renderTiles.ts:243-245` (`createImageData`), `downsample.ts:88` | 8-bit |
| Export flatten | `editor/export/flattenForExport.ts:388` → `exportPipeline/pipeline.ts` | 8-bit composite |
| ICC export convert | `engine/iccImageConverter.ts:110/125` (`getImageData`) | 8-bit |
| Native helpers | `desktop/src-tauri/src/lib.rs:1176,1658` (`to_rgba8`) | flattens 16-bit sources for upscale/trace |

Key findings:
1. **The browser decoder is the master boundary.** A 16-bit PNG / 10-bit AVIF is
   decoded to 8-bit RGBA with no signal; the asset metadata still claims
   `bitDepth: 16`. Preserving >8-bit for raster content requires native/WASM
   decode paths (varve-media exists; it currently only handles GIF/APNG/WebP
   and `STRIP_16`s APNG).
2. **`ImageCache` keying is URL-only in practice.** The `ImageCacheColorVariant`
   slot (designed to carry `rasterEncodingKey()` output, tested at
   `imageCache.test.ts:499-515`) is never populated by any caller.
3. **`rasterColor/` typed buffers are unwired.** `pixelBuffer.ts` /
   `transform.ts` / `exportPolicy.ts` are complete and tested, but nothing in
   decode, cache, worker transport, replay, or compositing consumes them.

## Deep audit — effects and blend math (2026-08-13)

- The entire effect/adjustment stack is byte-space by construction: every
  kernel's input is `ImageData` via `filterCompositor.ts:150`
  (`getImageData`), processed in 0-255 arithmetic, written back via
  `putImageData`. There is no float pipeline between effect stages.
- Confirmed avoidable mid-pipeline RGBA8 allocations (each quantizes in
  series): `effectPipeline.ts:73-128` (glassMaterial — 4 sequential
  getImageData/putImageData passes), `blur.ts` `gaussianBlurLinearLight`
  (quantizes to byte immediately after linearization at :245-247 — the
  "linear-light" contract in `effectContract.ts:146` is not honored),
  `curves.ts:49-90` and `levels.ts:28-42` (hard `Uint8Array(256)` LUTs),
  `gradientMap.ts` / `duotone.ts` / `tritone.ts` (256-entry byte LUTs),
  `liveEffects/dither.ts:158-177` (float error diffusion re-quantized to
  bytes for the palette lookup — defeats the purpose).
- `*255` round trips: `effectPipeline.ts:52` (`extractRgb` —
  `managedColorToNormalized()` immediately `×255`), `blendModes.ts:431-434`,
  `porterDuff.ts:153-156`, `filterCompositor.ts:834-846,1038-1040,1070-1072`,
  `blur.ts:17-32` (byte premultiply/unpremultiply — `255/a` amplifies
  rounding at low alpha), `exportPipeline/palette.ts:200-202` (**dead**
  `/255 → ×255` round trip inside palette scaling).
- Byte-space premultiply/unpremultiply double-quantization: `blur.ts:7-32`,
  `filterCompositor.ts:794-819` (sharpen), `liveEffects/crt.ts:268-278`,
  `rgbSplit.ts:185-195`. Correct float helpers already exist in
  `rasterColor/pixelBuffer.ts:251-277`.
- Effect colour params reach kernels as 0-255 byte tuples
  (`AdjustmentEditor.managedToColor` = `managedColorToRgba` — destroys
  float/non-RGB precision before storage; `GradientMapEditor.tsx:18-22`
  same). The one normalized path (`extractRgb`) quantizes immediately.
- 256-bin assumptions: `curves.ts`/`levels.ts` LUTs, `histogram.ts` BINS=256
  (fine for display; auto-levels stats could be float),
  `gradientMap.ts` `DEFAULT_GRADIENT_LUT_SIZE=256`, `duotone.ts`/`tritone.ts`
  luma-keyed 256 LUTs, `filterCompositor.ts:735-738` contrast pivot at 128,
  `posterize.ts`/`threshold.ts`/`halftone.ts` 128 pivots.

## Deep audit — export and print (2026-08-13)

- All implemented raster encoders are 8-bit: PNG/JPEG/WebP go through
  `rasterSurface.ts` `encodeRasterSurface` (`convertToBlob`/`toBlob`);
  GIF is inherently 256-color. `RasterExportSettings.bitDepth (8|24|32)` is
  declarative only — never read by the executor.
- `exportPolicy.ts:50` `resolveExportEncoding` hardcodes `bitDepth: 8` — the
  policy layer cannot express >8-bit output even when the source could.
- TIFF declares `highBitDepth: true` but has no encoder ("No TIFF encoder is
  implemented"). AVIF export throws.
- **PDF CMYK round trip confirmed:** `crates/varve-print` `color_to_rgba_string`
  / `color_to_cmyk_string` both start from `engine_color_rgba(fill)` — a
  `CmykColor` is converted RGB with the naive `(1-c)(1-k)` formula
  (`varve-colour/src/conversions.rs:283-321`) and then converted **back** to
  CMYK. The `profile`/`bit_depth` fields on `EngineColor::Cmyk` are ignored.
- `Document.colorConfig` is unused by export; `outputIntent` never reaches the
  PDF path (the job's `iccProfile` option string is the sole profile input).
- `PdfOptions.lossy` is never set true by any Tauri command — the precision
  loss warning path is unreachable in production.
- SVG: `preserveColorSpace` mode emits `icc-color()` with raw unnormalized
  channel values; otherwise 8-bit `rgba()` via naive CMYK→RGB.
- Import: ICC profiles are extracted (metadata only) for PNG/JPEG/WebP/TIFF/
  AVIF; **no importer decodes >8-bit pixels** — decode is `createImageBitmap`
  everywhere.

## Deep audit — frontend (2026-08-13)

- Picker contract is already ManagedColor-native
  (`ColorPicker.tsx` `value: ManagedColor` / `onChange`). Losses concentrate
  at: (a) HSV area/slider path (`hsvToRgb` `Math.round`s to 0-255,
  `color-utils.ts:38`), (b) hex + RGB spinbutton inputs (0-255 scale even for
  uint16 colors), (c) swatch selection — document/recent swatches are
  flattened via `managedColorToRgba` (`InspectorColorPopover.tsx:110-121`)
  then re-authored as fresh uint8 RGB (`ColorPicker.tsx:384-390`) — the
  biggest fidelity loss in the UI, (d) `AdjustmentEditor` / `GradientMapEditor`
  storing 0-255 tuples, (e) grid/axis colors via CSS strings
  (`DocumentPanel.tsx:321-334`), (f) `GradientEditor` add-stop interpolation
  from 8-bit tuples.
- Bit-depth segmented control exists in the picker but no editor host passes
  `bitDepth`/`onBitDepthChange` — dead UI today.
- Document color settings UI: only mode assignment exists
  (`DocumentPanel.tsx:70-103`); `bitDepth`, `workingSpace`, `rgbProfile`,
  `displayProfile`, `outputIntent`, `blackGeneration` have no reachable
  controls. `ColorConversionDialog` (Assign vs Convert) is orphaned —
  renders nowhere, no menu/command entry. `convertDocumentColors` is wired in
  context but unreachable.
- Mixed selection: strokes and effects have proper `commonValue`/MIXED
  handling; **fill color collapses to node[0]** (`FillSection.tsx:132-137`)
  — no mixed fill-color state.
- Lab/LCH authoring is float-exact (the model path); RGB/CMYK authoring is
  8-bit through the HSV/hex/field inputs.

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
6. Fix document-feedback quantizers — results that are written back into
   canonical document state must be bit-depth-aware: adaptive contrast
   resolved colors, baked LUTs, adjustment/effect colour params
   (`managedToColor` in AdjustmentEditor/GradientMapEditor), palette
   extraction. **Done 2026-08-13:** adaptive-contrast write-back scales to
   the document bit depth; the 3D LUT bake read pixels before running the
   filter stack (identity LUTs) and now samples the filtered output;
   adjustment colour params normalize at the color's own bit depth before
   the 0-255 engine tuple.
7. Make the color picker precision-preserving end-to-end: float HSV editing,
   bit-depth-aware numeric fields, swatch pass-through of full ManagedColor,
   bit-depth control wired to hosts. **Done 2026-08-13:** float HSV drafts,
   normalized emit path, 0-65535/0-1 fields, canonical swatch pass-through,
   canonical-seeded drafts; gradient stop insertion interpolates in
   normalized space. The picker's bit-depth segmented control still requires
   a host passing `onBitDepthChange`.
8. Add reachable Document Color Settings UI (bitDepth, workingSpace, profiles)
   and wire the orphaned ColorConversionDialog into menus/commands.
   **Done 2026-08-13:** Precision + Blend space controls in the Inspector
   Document Color section; File > Document Color Mode… + command palette
   open the Assign vs Convert dialog.
9. Float-domain adjustment kernels (curves/levels) with single entry/exit
   quantization for the effect pipeline; float premultiply in blur/sharpen.
   **Partial:** linear-light blur now runs fully in float32 with one
   quantization; the byte-space `ImageData` entry/exit of the adjustment
   stack remains (curves/levels LUTs stay 256-bin byte tables — consistent
   with the byte pipeline; float LUTs only pay off with a float entry).
10. PDF: emit native CMYK channels without the RGB round trip; honor
    `EngineColor::Cmyk.profile`. **Done 2026-08-13** in crates/varve-print
    (solids, strokes, gradients; pure K preserved; bit-depth-aware scaling).
11. Export: plumb real bit-depth through the policy layer; add a 16-bit PNG
    encoder path (Rust `png` crate is already a dependency of varve-media,
    decode-only today). **Not done:** the export composite is Canvas2D 8-bit;
    PNG16 without a 16-bit composite path would be fake precision. Tracked
    as an explicit boundary in colour-management.md and raster-assets.md.

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

**Status 2026-08-13:** `packages/scene/src/highPrecisionRegression.test.ts`
proves save/reopen exactness for uint16 (adjacent values distinct), float32,
CMYK (uint16 + float), a 512-level ramp, five save cycles without drift,
zero-alpha RGB preservation, small-alpha survival, and legacy boundary-value
migration. Picker channel-preservation is covered in `ColorPicker.test.tsx`.
