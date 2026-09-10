# Export, Resampling, Colour, Print, Vector & Codegen Pipeline — Implementation Progress

**Date:** 2026-08-02
**Status:** Milestones 1–8 of the pipeline rebuild landed; see §10 for remaining
work.

This document records what the export/resampling/colour/print/vector/codegen
pipeline effort shipped, the canonical stage ordering, how each capability is
wired and verified, and the honest list of what is still missing.

---

## 1. Canonical export-pipeline ordering

The pipeline rebuild established one order of stages, used by raster export,
so every backend behaves identically:

```
render (IR replay at working resolution)
  → 1. resize / resample   (alpha-safe, premultiplied, optional linear-light)
  → 2. output sharpening   (after the final resize; radius in output px)
  → 3. colour conversion   (destination profile, once, on final pixels)
  → 4a. dithering          (error diffusion / ordered / blue-noise)
  → 4b. palette quantization (median cut)
  → encode
  → 5. metadata policy     (PNG text/iCCP chunks, EXIF orientation apply-once)
```

Rationale (also documented in `packages/engine/src/exportPipeline/pipeline.ts`):

| Decision | Choice | Why |
| --- | --- | --- |
| Resize before sharpen | after | sharpen radius is expressed in output pixels; a later scale would re-filter it |
| Resize before colour conversion | before | clipping happens once at the destination profile, not before resampling |
| Dither after colour conversion | after | error diffusion in the source space would be wrong after conversion |
| Single resize pass | yes | vector content re-renders at target; the explicit resize stage only acts when a caller supplies target dimensions |
| Alpha convention | premultiplied internally | W3C compositing §5; hidden RGB under transparent pixels never leaks |
| Working space default | `srgb` (perceptual) | matches the rest of Varve's compositing and browser `drawImage`; `linear-srgb` is the documented advanced option |
| Metadata at encode | yes | applied to encoded bytes, never to pixels |

---

## 2. Capability matrix (before → after)

| Capability | Before | After |
| --- | --- | --- |
| Typed processing-stage contracts | none | `ResizeOptions` / `SharpenOptions` / `DitherOptions` / `MetadataPolicy` / `ColorConversionOptions` in `@varve/shared` (engine-safe), re-exported from `@varve/scene/export` |
| Raster resize engine | no downscale filter (browser `drawImage` only) | `resampleImageData`: nearest, bilinear, Catmull-Rom, Mitchell–Netravali, Lanczos2/3, area box, pixel-art; alpha-safe; linear-light; tiled |
| Auto algorithm selection | none | deterministic `selectResamplingAlgorithm` with rationale logging |
| Output sharpening | effect-layer only, not export | `sharpenImageData`: unsharp mask (amount/radius/threshold), luminance-only, alpha-protect, linear-light |
| Technical dithering | halftone effect only | `ditherImageData`: Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Bayer 2/4/8, seeded blue-noise; serpentine; deterministic |
| Palette quantization | naive GIF bucket quantizer | `quantizeToPalette`: median cut, deterministic ordering, reserved transparent index |
| Metadata policies | none (canvas encodes metadata-free bytes) | `MetadataPolicy` resolution, PNG tEXt/iTXt/iCCP chunk writer/stripper, deterministic mode |
| EXIF orientation | none | `parseExifOrientation` + `applyExifOrientation` with apply-once invariant |
| PDF/X-1a actual CMYK | fills emitted RGB (hardcoded) | ICC profile threaded end-to-end; real `rgb_to_cmyk_icc` fills; embedded output-intent ICC stream |
| Colour WASM | never built/deployed | still not deployed — `varve-colour` is wasm-ready and `just wasm-build-colour` documents the build; deployment deferred (see §10 item 9) |
| SVG minify | option existed, ignored per-node | `exportNodeToSvg({ minify })` honored |
| AVIF advertising | offered in Settings despite no encoder | removed from settings; persisted `avif` default sanitized |

---

## 3. New/updated modules

| Module | Package | Purpose |
| --- | --- | --- |
| `src/export/pipeline.ts` | @varve/scene | typed stage contracts + validation + factories (types live in @varve/shared, re-exported) |
| `src/export/pipeline.test.ts` | @varve/scene | contract validation, defaults, policy resolution |
| `src/export/model.ts` | @varve/scene | `RasterExportSettings` extended with the typed contracts; config validation |
| `src/export/adapter.ts` | @varve/scene | legacy↔canonical round-trip of the new fields |
| `src/export-types.ts` | @varve/scene | legacy `RasterOptions` carries the bridge fields |
| `src/exportPipeline/resample.ts` + `.test.ts` + `.bench.ts` | @varve/engine | resampling engine (kernels, area, linear-light, auto-selection, tiling) |
| `src/exportPipeline/sharpen.ts` | @varve/engine | unsharp mask export stage |
| `src/exportPipeline/dither.ts` | @varve/engine | error diffusion + ordered + blue-noise dithering |
| `src/exportPipeline/palette.ts` | @varve/engine | median-cut palette quantization |
| `src/exportPipeline/pipeline.ts` + `.test.ts` | @varve/engine | stage orchestrator (order above), abort, diagnostics |
| `src/exportPipeline/stages.test.ts` | @varve/engine | sharpen/dither/palette behaviour tests |
| `src/metadata/png.ts` | @varve/engine | PNG chunk parse/insert/strip, iCCP embed, CRC32 |
| `src/metadata/exif.ts` | @varve/engine | JPEG/TIFF EXIF orientation parse + pixel transform |
| `src/metadata/policy.ts` | @varve/engine | policy → metadata content resolution, PNG entries |
| `src/metadata/metadata.test.ts` | @varve/engine | metadata/EXIF/PNG tests |
| `crates/varve-colour/src/profiles.rs` | varve-colour | `PrintProfile::parse`, `icc_bytes`, `output_condition_identifier` |
| `crates/varve-print/src/cmyk.rs` | varve-print | profile threading, embedded output-intent profile, new tests |
| `crates/varve-print/src/lib.rs` | varve-print | `shape_to_pdf_content` accepts use_cmyk/profile |
| `apps/desktop/src-tauri/src/lib.rs` | desktop | `PdfXOptions.to_pdf_options` resolves the ICC profile |
| `src/components/SpecPanel/export.ts` | @varve/editor | raster export honors pipeline + metadata |
| `src/exportService.ts` | @varve/editor | executor maps legacy raster options → canonical pipeline |
| `src/components/Settings/ExportSettingsTab.tsx` | @varve/editor | AVIF removed from format list |
| `src/settings.ts` | @varve/editor | persisted `avif` default sanitized |
| `packages/codegen/src/svg.ts` | @varve/codegen | `minify` option on the per-node SVG emitter |

---

## 4. Resampling engine behaviour (evidence)

- **Alpha safety:** sampling is premultiplied, so a fully transparent pixel
  carrying hidden RGB contributes zero weight — verified by the
  "never leaks hidden RGB" and "no fringes" tests.
- **Linear-light vs gamma:** the 2×2 checkerboard test documents the difference —
  gamma-encoded area average ≈ 128, linear-light ≈ 187 (50% physical white).
  Default is `srgb`; `linear-srgb` is the advanced option.
- **Auto selection (deterministic):**
  `pixel-art hint → nearest`; downscale ≤ 50% → `area`; downscale 50–100% →
  `lanczos2`; upscale → `lanczos3` (or `nearest` for exact integer upscales
  when `integerScale` is set).
- **Tiling:** banded vertical processing with kernel overlap; the
  "tiled matches single-pass" test verifies ±1 byte agreement and bounded
  per-band memory.

## 5. Sharpening semantics

- Applies after the final resize (single sharpen pass).
- Works on straight-alpha; the Gaussian blur is premultiplied internally.
- `luminanceOnly` preserves hue (verified: a green edge stays green).
- `protectAlpha` scales the correction by alpha so low-alpha edges are not
  slammed to maximum (verified against the unprotected run).
- Fully transparent pixels are zeroed in output (hidden RGB never emitted).

## 6. Dithering & palette

- Error-diffusion kernels (Floyd–Steinberg/Atkinson/Jarvis/Stucki) quantize to
  the requested bit depth per channel (verified: ≤ 2^bits distinct levels).
- Ordered Bayer matrices built recursively and verified; blue-noise uses a
  seeded hash (same seed → same output, different seed → different output).
- Serpentine scanning changes output vs left-to-right (verified).
- `alphaThreshold` forces low-alpha pixels fully transparent (verified).
- Median-cut palette respects the requested size, reserves index 0 for
  transparency when needed, orders deterministically, and every output pixel
  maps to a palette entry (verified).

## 7. Metadata & EXIF

- Policy kinds: `preserve`, `copyright-only`, `privacy-strip` (default),
  `strip-all`, `document`, `custom`. `privacy-strip` keeps authorship/copyright
  but drops GPS/device/timestamps/history — the privacy-conscious default.
- `deterministic` mode strips volatile fields even under `preserve`.
- PNG text chunks are inserted before IEND with recomputed CRCs; iCCP embeds a
  deflated profile; stripping removes ancillary chunks and can keep the profile
  when asked. Applied to the encoded bytes in `exportNodeAsRaster`.
- EXIF orientation is parsed from JPEG APP1 / TIFF IFD, applied to pixels
  exactly once, and the tag is reset to 1 (`orientationAfterApply`).

## 8. Print / ICC wiring (Rust)

- `PdfXOptions.to_pdf_options` now resolves `icc_profile` → `PrintProfile`
  (case-insensitive; unknown names return `None` rather than guessing).
- `build_pdfx_content` threads `use_cmyk` + `profile` into
  `shape_to_pdf_content` → `render_fills`/`render_strokes`, so PDF/X-1a emits
  ICC-aware CMYK operators — the previous hardcoded-RGB gap is closed.
- The OutputIntent now embeds the destination ICC profile bytes (`DestOutputProfile`)
  instead of a bare Fogra39 stub.
- New tests: `pdfx1a_emits_icc_cmyk_fill_when_profile_set` (decompresses the
  content stream, asserts CMYK operators and no RGB operators),
  `pdfx1a_embeds_destination_icc_profile` (asserts an embedded `acsp` magic),
  `print_profile_parse_is_case_insensitive`, `print_profile_icc_bytes_are_valid_profiles`.

## 9. Verification commands run

| Command | Result |
| --- | --- |
| `npx vitest run packages/scene/src/export` | 138 passed |
| `npx vitest run packages/engine/src/exportPipeline packages/engine/src/metadata` | 62 passed |
| `npx vitest run packages/editor/src/exportService.test.ts packages/editor/src/components/SpecPanel` | 79 passed |
| `npx vitest run packages/codegen/src/codegen.test.ts` | 37 passed |
| `cargo test -p varve-print` | 134 passed |
| `cargo test -p varve-colour` | 72 passed |
| `cargo clippy -p varve-print -p varve-colour -- -D warnings` | clean |
| `pnpm --filter @varve/{scene,engine,shared,editor,codegen} typecheck` | 0 errors |
| `npx biome check` on all touched files | clean |
| `pnpm audit:emoji` | clean |

---

## 10. Known limitations and deferred work

Deliberately NOT implemented in this pass (each is a coherent follow-up, not a
silent gap — nothing here is presented in the UI as if it worked):

1. **Multi-page / spread PDF export** — the data model supports pages/spreads
   but the executor is per-node. Deferred (Phase 7 follow-up).
2. **Soft proofing / gamut warning display path** — the `ColorConversionOptions`
   contract and proof hook exist in the pipeline, but no profile-aware display
   transform is wired into the preview. Deferred (Phase 6 follow-up).
3. **`@varve/print` dead facade** — zero-import package with a placeholder
   stub; superseded by the editor's direct IPC. To be deleted or re-wired.
4. **Per-node SVG `precision` option** — per-node SVG emits fixed 4-decimal
   coordinates (already high fidelity); a configurable `precision` formatter
   for size optimisation is not implemented. Not advertised.
5. **Codegen output compile validation** — generators produce strings; no
   parser/build step validates generated TSX/Dart/Swift yet.
6. **Vue/Svelte/WebComponent export formats** — library-complete but not in the
   executor/format list; left out rather than half-wired.
7. **Exposure `^2.2` approximation** in `filterCompositor` (pre-existing,
   unrelated to export; tracked separately).
8. **TIFF/AVIF encoders** — still absent; capability-gated off everywhere.
9. **Colour WASM deployment** — `varve-colour` is wasm-ready (`just wasm-build-colour`
   produces `apps/desktop/public/wasm/varve_colour_bg.wasm`), but the build tooling
   (wasm-pack) was not installable on the dev machine during this session. The web
   ICC path therefore still uses the analytical fallback; desktop print uses the
   real tintbox engine. Deployment is a build/infra step, not a correctness gap in
   the code.

## 11. Commit history (this effort)

- `521d49cc` docs(audit): capability matrix and root causes
- `81c64c94` feat(export): canonical processing-stage contracts
- `8b397093` feat(export): alpha-safe resampling engine
- `d85c91e9` feat(export): output sharpening + technical dithering + palette
- `6de7281e` feat(export): metadata policies, PNG chunks, EXIF apply-once
- `3d218c65` fix(print): ICC profile through PDF/X — real CMYK + output intent
- `0e45c716` feat(export): canonical raster pipeline orchestrator wired in
- `bd6fdb15` fix(export): SVG minify honored, AVIF un-advertised
