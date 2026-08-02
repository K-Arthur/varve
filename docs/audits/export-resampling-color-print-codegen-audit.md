# Export, Resampling, Colour, Print, Vector & Codegen — Architecture Audit

**Scope:** Raster/vector export, resampling, output sharpening, dithering,
metadata, ICC colour conversion, print production, SVG/vector options, and
code generation.

**Date:** 2026-08-02

This audit maps every requested capability to its real implementation. Status
classes: **(a)** fully implemented and wired · **(b)** partial · **(c)** UI-exposed
but backend-ignored · **(d)** backend-only (unreachable from UI) · **(e)** duplicated
in incompatible forms · **(f)** missing.

---

## 1. Capability matrix

| Capability | Browser | Tauri/Linux | Tauri/Windows | Tauri/macOS | Preview | Raster Export | SVG/PDF | Print |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PNG / JPEG / WebP encode | a | a | a | a | a | a | — | — |
| AVIF / TIFF encode | f | f | f | f | f | f | — | — |
| GIF encode | a | a | a | a | — | f (timeline only) | — | — |
| Vector re-render raster export (IR replay) | a | a | a | a | a | a | — | — |
| Raster **downscale** (real filter) | f | f | f | f | b (`drawImage`) | f | — | — |
| Raster upscale (nearest/bilinear/bicubic/lanczos3) | a | a | a | a | a | f (no hook) | — | — |
| Pixel-art scaling (EPX/Scale2x/HQ2x/xBR) | a | a | a | a | a | f (no hook) | — | — |
| Linear-light resize | f | f | f | f | f | f | — | — |
| Alpha-safe (premultiplied) sampling | a (upscale) | a | a | a | a | f | — | — |
| Output sharpening (unsharp mask) | b | b | b | b | a (effect) | f | — | — |
| Dithering — Floyd–Steinberg / Bayer / AM-FM | a | a | a | a | a | f | — | — |
| Palette quantization (median-cut, Oklab) | e | e | e | e | — | f | — | — |
| Metadata policies (EXIF/IPTC/XMP) | f | f | f | f | — | f | f | f |
| EXIF orientation handling | f | f | f | f | — | f | — | — |
| ICC conversion (real engine, tintbox) | d | b | b | b | f | f | f | b |
| Colour WASM deployed | f | — | — | — | — | — | — | — |
| Assign-vs-convert distinction | b | b | b | b | f | f | — | f |
| Rendering intent + BPC | a (model) | b | b | b | f | f | — | b |
| CMYK workflow | b | b | b | b | b | f | — | b |
| PDF/X-1a / X-4 structure | — | a | a | a | — | — | a | a |
| PDF/X-1a actual CMYK fills | — | f | f | f | — | — | f | f |
| PDF/A | f | f | f | f | — | — | f | f |
| Bleed / crop / registration / colour bars | — | a | a | a | — | — | a | a |
| Print preflight (scene checks) | a | a | a | a | a | — | — | a |
| Native OS print (CUPS/etc.) | — | d | d | d | — | — | — | d |
| SVG export | a | a | a | a | — | — | a | — |
| SVG precision / minify | a | a | a | a | — | — | a | — |
| SVG text outline / font embed | f | f | f | f | — | — | f | — |
| SVG localised raster fallback (effects) | a | a | a | a | — | — | a | — |
| Codegen SVG/CSS/Tailwind/Modules/Flutter/SwiftUI | a | a | a | a | — | — | — | — |
| Codegen HTML/Vue/Svelte/WebComponent | c | c | c | c | c | — | — | — |
| Generated-code compile validation | f | f | f | f | — | — | — | — |
| Semantic/accessible codegen | b | b | b | b | — | — | — | — |
| Export presets (versioned, migratable) | a | a | a | a | — | — | — | — |
| Export settings→executor wiring | b | b | b | b | — | — | — | — |
| Batch export / ZIP / folder save | a | a | a | a | — | — | — | — |

---

## 2. Current architecture (data flow)

There are **two parallel type systems**:

1. **Legacy persistence boundary** — `packages/scene/src/export-types.ts`
   (`ExportPreset`/`ExportJob`/`ExportBatch`). Stored on `SceneNode.presets`;
   the live dialog and `ExportService` still operate on it.
2. **Canonical model** — `packages/scene/src/export/model.ts` (versioned
   `ExportConfiguration`, sub-settings for colour/raster/vector/print/metadata/
   background/optimization), bridged by `adapter.ts`. Fully built and tested;
   the dialog expands presets through it via `plan.ts`.

**Export execution flow** (`packages/editor/src/exportService.ts`):
```
ExportDialog.buildJobs()          # node.presets → canonical configs → plan → legacy jobs
  → ExportService.run()           # sequential in-process loop, AbortSignal cancellation
    → renderJob() switch:
        svg/svg-component         → @strata/codegen exportNodeToSvg (+compositor raster assets)
        react-tailwind/...        → @strata/codegen emitters
        pdf-screen                → exportNodeAsPdf   (Tauri vector | browser raster-PDF)
        pdf-x1a/pdf-x4            → exportNodeAsPdfX  (Tauri IPC → strata-print; throws on web)
        png/jpg/webp              → exportNodeAsRaster → IR replay at target scale → canvas.toBlob
    → saveFile()  (Tauri save dialog / browser download / ZIP batch)
```

Raster export is **vector re-render, not pixel resize**: `flattenSceneToEngine`
→ `Engine.buildIr` → `replayStructuredScene` at the target scale. There is
therefore no "resize the rendered image" stage today; browser `drawImage`
does whatever the OS default bilinear does for embedded raster content.

---

## 3. Root causes of the main inconsistencies

1. **No post-render processing stage.** The raster pipeline ends at canvas
   encode. Resampling, sharpening, dithering, and palette quantization exist as
   effect-layer features or upscale helpers but have no canonical export hook.
   → Blocks a coherent resize/sharpen/dither pipeline (§4–§6).
2. **Colour WASM is never built/deployed.** `wasm-build-colour` exists in the
   justfile but is not in postinstall; `apps/desktop/public/wasm/strata_colour_bg.wasm`
   does not exist. The TS `convertToCmykIcc`/`convertImageForExport` paths are
   dead code; the analytical fallback always runs on web.
3. **PDF/X-1a is structurally PDF/X but pixel-legal RGB.** `build_pdfx_content`
   hardcodes `use_cmyk=false, profile=None` (`crates/strata-print/src/cmyk.rs:57`
   → `lib.rs:1774-1787`); the Tauri boundary drops the parsed `icc_profile`
   (`apps/desktop/src-tauri/src/lib.rs:1331` → `print_profile: None`). The
   PrintSettingsPanel claim "CMYK conversion uses the bundled Fogra39 profile"
   never executes.
4. **Metadata is unowned.** No EXIF/IPTC/XMP reader/writer anywhere; canvas
   encoding produces metadata-free output, so "strip metadata" is trivially
   satisfied but "preserve copyright" is impossible. No EXIF orientation
   handling on import.
5. **Three competing PDF writers.** Browser `makeSimpleImagePdf`
   (`SpecPanel/export.ts:251`), `rasterizeSubtreeToPdfViaPrintEngine` (no image
   manifest → D5 checkerboard risk), and Rust `strata-print`.
6. **Vector options dropped on the SVG path.** `renderJob` calls
   `exportNodeToSvg(node, doc, { rasterAssets })` — `precision`, `minify`,
   `outlineText`, `embedImages` from `VectorOptions` are never applied
   (precision/minify are honored only by the legacy `exportDocumentToSvgAdvanced`).
7. **Codegen targets are inconsistent.** Vue/Svelte/WebComponent are
   library-complete but absent from `ExportFormat` and the executor; HTML is
   `supported:false`; legacy `CodeOptions` are persisted but unconsumed; no
   generated code is ever compiled/parsed by tests.
8. **AVIF is advertised but unencodable.** `ExportSettingsTab` offers AVIF while
   `FORMAT_CAPABILITIES.avif.supported === false`; settings can persist
   `avif` as defaultFormat.

---

## 4. Fixes landed by this effort

See `docs/implementation/export-pipeline-progress.md` (this session's change
log) and the milestone commits referenced there.

| Area | Change |
| --- | --- |
| Canonical pipeline contracts | Added typed `ResizeOptions` / `SharpenOptions` / `DitherOptions` / `MetadataPolicy` / `ColorConversionOptions` in `packages/scene/src/export/pipeline.ts`, wired into `RasterExportSettings`, with validation + adapter round-trip. |
| Resampling engine | New `packages/engine/src/exportPipeline/resample.ts` (nearest/bilinear/bicubic/Mitchell–Netravali/Lanczos2/3, area/box downscale, linear-light mode, premultiplied alpha, deterministic auto-selection). |
| Sharpening | `packages/engine/src/exportPipeline/sharpen.ts` (unsharp mask: amount/radius/threshold, luminance-only, alpha-edge protection). |
| Dithering + palette | `packages/engine/src/exportPipeline/dither.ts` (Floyd–Steinberg/Atkinson/Jarvis/Stucki/ordered Bayer, serpentine, seeded) + `palette.ts` (median-cut). |
| Metadata | `packages/engine/src/metadata/` policy resolution, PNG tEXt/iTXt/iCCP writer, EXIF orientation apply-once helper. |
| ICC wiring | Rust `PdfXOptions` now passes `print_profile`; `build_pdfx_content` applies profile-aware CMYK; colour WASM built and deployed. |
