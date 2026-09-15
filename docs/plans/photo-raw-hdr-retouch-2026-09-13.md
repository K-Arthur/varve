# Varve photo, RAW, HDR, and retouch delivery plan

Status: active implementation plan
Owner: photo/precision integration
Date: 2026-09-13
Branch: `master`

This plan extends the existing Photo/Image Tuning, raster tools, document
assets, history, and export services. It does not create a Retouch, Develop,
RAW, or HDR workspace, route, document model, or parallel manager.

## Baseline and evidence

The working tree was already substantially dirty before this work began. The
pre-existing changes touch drawing input, generative editing, native
acceleration, typography, import, and website pages. Those changes are not
owned by this plan and must not be folded into the photo commits. The initial
`pnpm verify:plan` selected a broad closure and escalated to a full gate solely
because the existing tree contains workspace/toolchain/validation changes.

The repository audit found these relevant facts:

| Boundary | Current evidence | Root cause / risk | Reusable owner | Planned repair |
| --- | --- | --- | --- | --- |
| Ordinary retouch | Clone Stamp and Healing Brush already mutate raster tiles and use stroke snapshots. Spot Heal and Patch still call `canvas.getImageData()`/`putImageData()` and therefore disappear on redraw or reopen. | Two competing retouch paths; visible canvas is treated as artwork. | `@varve/scene` tile compositor + editor tools | Route Spot Heal and Patch through one persistent tile transaction with source snapshot, target ownership, coverage, and no-op handling. |
| Sampling | Clone can sample a flattened raster stack; healing is target-layer-only. Imported image fills are shapes, not raster layers. | Sampling scope is implicit and image-filled shapes have no declared repair target. | Existing `ToolContext`, raster target helpers, scene retouch compositor | Expose/label sampling scope and report unsupported source/target combinations. Keep image-fill rasterization an explicit boundary until a source-pixel adapter exists. |
| Alpha | Retouch tile compositing currently interpolates straight RGBA bytes independently. | Semi-transparent edges can acquire dark or incorrect fringes. | `@varve/scene/retouchRaster.ts` | Use a documented premultiplied intermediate for source-over coverage; keep destination alpha lock separate. |
| Precision | `RasterTile.pixels` is `Uint8ClampedArray`; `RasterColorEncoding` describes float/PQ/HLG but conversion and storage do not provide a range-bearing master. | High-range data can be silently quantized at tile, canvas, histogram, or export boundaries. | `@varve/shared` contract + `@varve/engine` processors | Add a real float buffer contract, finite-value policy, explicit display/export transforms, and a verified OpenEXR slice. Byte-only retouch remains explicitly SDR until a float tile owner exists. |
| RAW | Import accepts PNG/JPEG/WebP/AVIF/GIF/BMP/TIFF. No LibRaw, DNG, or camera RAW decoder is wired. | Extension/thumbnail support would be misleading. | Native bridge candidate: LibRaw; web fallback: bounded DNG subset | First support a validated, declared subset; preserve raw bytes and recipe; never substitute an embedded preview for final development. |
| Recipes | Image fills have content-addressed source assets but no RAW recipe/source revision contract. | Upstream changes could silently invalidate downstream pixel edits. | Existing `Document.assets`, smart filters, history | Add versioned recipe metadata and explicit stale/rebase policy before declaring replayable RAW retouch. |
| Brackets | Existing frame-interpolation surface is not HDR merging. No radiance merge, exposure validation, deghost, or float master export is wired. | RIFE/interpolation or averaging could be incorrectly marketed as HDR. | New `@varve/engine/hdr` module; existing contextual dialogs | Add distinct radiance merge and exposure-fusion semantics, bounded alignment/deghost controls, and a new derived master asset. |
| HDR display | Canvas/WebGPU APIs may accept float formats, but runtime/OS/display capability is not proven by API presence. Linux WebKitGTK currently documents PQ video tone-mapping to SDR. | A screenshot or feature flag cannot prove HDR luminance. | Existing compositor capability reporting | Implement numeric SDR/HDR preview probes and keep display-HDR claims hardware/runtime-specific. |
| Export | Existing export is primarily Canvas2D/SDR. | Extensions and metadata could falsely imply preserved range. | Existing export contracts and asset registry | Separate SDR rendition, range master, and display-HDR/gain-map contracts; independently decode every promised output. |

## Research decisions

Research was performed before implementation and repeated for the RAW/HDR
format decisions. URLs below were accessed 2026-09-13; release/build values are
recorded as observed and must be rechecked at release time.

### RAW, DNG, and lens correction

- [LibRaw documentation](https://www.libraw.org/docs), [C++ API](https://www.libraw.org/docs/API-CXX.html), [data structures](https://www.libraw.org/docs/API-datastruct-eng.html), and [API notes](https://www.libraw.org/docs/API-notes.html): the API separates metadata/RAW buffers from embedded thumbnails, exposes mosaic information, cancellation, memory limits, and output controls. `unpack()` is the sensor-data path; `unpack_thumb()` is only a preview path. LibRaw documents dual LGPL-2.1/CDDL-1.0 licensing, one instance per thread, and public snapshots whose API/support are not frozen.
- [LibRaw 0.21.4 release](https://github.com/LibRaw/LibRaw/releases): use a pinned stable release for native work; do not claim all camera variants from the library name. LibRaw’s own project description says its rendering code is retained as a basic/reference conversion path, so Varve must match and document the configured processing rather than claim converter parity.
- [Adobe DNG specification and SDK page](https://helpx.adobe.com/camera-raw/desktop/dng-and-file-formats/digital-negative.html): the current page lists DNG 1.7.1.0 and DNG SDK 1.7.1 Build 2724 (2026-09-08). The SDK licensing and redistribution terms require legal review; it is not assumed to be an acceptable bundled dependency. A pure DNG reader can support a smaller, explicit subset while the native adapter is evaluated.
- [Lensfun current manual](https://lensfun.github.io/manual/latest/) and [project licensing](https://github.com/lensfun/lensfun): Lensfun 0.3.99.0 provides correction algorithms and a profile database. The code is LGPL-3, applications are GPL-3, and the database is CC BY-SA 3.0. The database is optional data, not a guarantee that a camera/lens profile exists. Missing profiles must remain visible as missing.

Decision: compare a pinned LibRaw native adapter, a maintained native Rust
binding/FFI boundary, and a bounded browser DNG reader. The first shippable
camera matrix will name exact camera/variant/compression fixtures. No external
executable is allowed as an undeclared core dependency.

The Rust binding check was repeated before settling the first slice: [`rawlib
0.3.1`](https://docs.rs/rawlib/latest/rawlib/) is a small MIT-safe wrapper but
still inherits the separately licensed LibRaw build; [`libraw
0.1.1`](https://docs.rs/crate/libraw/latest) is an old 2015 wrapper that
expects an installed `libraw_r`; [`rsraw
0.1.1`](https://docs.rs/crate/rsraw/latest) (published 2026-03-21) builds
LibRaw through a C++ submodule and had only 8.57% documented API at review;
[`libraw-rs-sys 0.0.4+libraw-0.20.1`](https://docs.rs/crate/libraw-rs-sys/0.0.4%2Blibraw-0.20.1)
is an older WIP sys crate. None supplied the maintained, pinned native/WASM
build, redistribution, camera-fixture, and resource-lifetime contract needed
for this change, so no native decoder dependency was added. This is a rejected
integration alternative, not evidence that those projects cannot decode a
given camera.

The bracket corpus check found the official [LuckyHDR real-world bracket](https://github.com/princeton-computational-imaging/lucky-hdr/blob/main/DATASETS.md),
but its example DNGs are 16-bit JPEG-compressed iPhone ProRAW (`0x8023`) files
and the dataset page says real-world capture data is not redistributed. They
are retained as local, hash-pinned unsupported fixtures. The academic-only
[Real-HDRV dataset](https://github.com/yungsyu99/Real-HDRV) and the externally
hosted RawHDR dataset were not used as release fixtures. This keeps the real
camera bracket limitation explicit instead of testing a renamed/rendered file
and calling it sensor radiance.

### Retouch provenance

- [darktable retouch manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/retouch/)
  documents clone/heal/fill/blur and wavelet decomposition as scene-referred
  linear-RGB processing with explicit shapes and source/target behavior. It is
  a development manual, not a Varve implementation or a claim that a simple
  color-shift blend is a Poisson solver.
- Real issue reports include [darktable source-anchor projection failure](https://github.com/darktable-org/darktable/issues/4388), [darktable retouch producing no visible result](https://github.com/darktable-org/darktable/issues/4655), [resolution-dependent retouch output](https://github.com/darktable-org/darktable/issues/11325), and [Lightroom users needing explicit stale repair refresh after upstream changes](https://community.adobe.com/questions-675/problem-when-switching-between-healing-tools-in-lrc-971633). These reports motivate persistent ownership, stable coordinates, authoritative redraw, and explicit stale/rebase feedback rather than a new algorithm label.

Decision: repair the existing canonical tile path first. Spot Heal is labelled
as a bounded proximity heuristic until a source-dependent synthesis solver is
implemented and measured. Model-assisted inpainting remains a separate,
optional, accept/discard workflow.

### HDR and color

- [OpenCV HDR tutorial](https://docs.opencv.org/4.13.0/d2/df0/tutorial_py_hdr.html)
  explicitly separates Debevec/Robertson radiance reconstruction from Mertens
  exposure fusion. The latter returns an LDR result and does not use exposure
  times. Varve will preserve that distinction in types, labels, tests, and
  marketing.
- [OpenEXR technical introduction](https://openexr.com/en/latest/TechnicalIntroduction.html), [file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html), and [BSD-3-Clause license](https://openexr.com/en/latest/license.html): float16/float32 scene-linear channels may exceed 1.0; RGB is conventionally premultiplied by alpha; arbitrary channels and windows are part of the format. The first Varve writer/reader will be single-part, scanline, RGB(A), uncompressed, finite float16/float32 only, with explicit rejection of unsupported deep/multipart/tiled cases.
- [ITU-R BT.2100-3](https://www.itu.int/rec/r-rec-bt.2100) and [the normative PDF](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2100-3-202502-I%21%21PDF-E.pdf) distinguish scene/display reference and state that PQ and HLG are different systems. The recommendation’s floating-point interchange table permits linear values and defines an HDR reference white convention; Varve will not infer absolute nits from arbitrary scene values.
- [ICC v4 specifications](https://www.color.org/v4spec/) provide the current profile vocabulary, but the existing Varve ICC path is not a complete PQ/HLG display pipeline. Unknown or unsupported profiles remain unknown.

Decision: use float32 scene-linear data for computation and a range-bearing
OpenEXR master as the authority. A verified Ultra HDR gain-map JPEG sharing
slice was added on top of that master (see below); PQ/HLG display encoding and
gain-map HEIF/AVIF remain unimplemented.

### Browser and desktop presentation

- [HTML Canvas](https://html.spec.whatwg.org/multipage/canvas.html) exposes
  `colorSpace` and `colorType` including `float16`; accepting a context option
  is not proof of HDR output.
- [WebGPU canvas configuration](https://gpuweb.github.io/types/interfaces/GPUCanvasConfiguration.html)
  defines `rgba16float`, color space, and an optional extended tone-mapping
  mode, while the [WebGPU explainer](https://gpuweb.github.io/gpuweb/explainer/)
  notes multiple-display capability changes and future display movement
  concerns. Varve will probe actual configuration and keep a numeric fallback.
- [Chrome WebGPU 129](https://developer.chrome.com/blog/new-in-webgpu-129)
  documents the `rgba16float`/extended-tone-mapping example, but this is an
  API capability, not a measured monitor result.
- [WebKitGTK 2.52 release notes](https://webkitgtk.org/2026/03/18/webkitgtk2.52.0-released.html)
  state that BT.2100-PQ video is tone-mapped to SDR. This is evidence against
  assuming that a Linux Tauri/WebKitGTK canvas is an HDR display route. Windows
  uses [WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/),
  and its runtime is separately versioned; macOS WKWebView and ChromeOS still
  require physical/runtime validation before a product claim.
- [Android Ultra HDR](https://developer.android.com/media/platform/hdr-image-format)
  defines a JPEG gain-map container and reconstruction metadata. It is not the
  same thing as an OpenEXR master or a PQ/HLG transfer. Gain-map export is
  deferred until an encoder and independent decoder are in the repository.

Decision: ship and verify the numeric master/SDR path independently of display
hardware. A display-HDR status can be `unavailable`, `unknown`, or `verified`
and must respond to display/context changes. No marketing page will call
WebGPU, wide-gamut CSS, or a screenshot proof of HDR presentation.

### Optional inference

- [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/)
  describe capability-based subgraph partitioning and CPU fallback. Existing
  Varve model manifests/downloads/cancellation remain the owner. Core RAW,
  retouch, and bracket computation must not require a model or cloud account.
- User reports show [Lightroom gain-map negative-value confusion](https://community.adobe.com/questions-680/lightroom-mobile-gainmap-problem-1617235), [HDR exports differing from editing previews](https://community.adobe.com/questions-675/hdr-images-not-displaying-correctly-when-exported-978766), and [gain-map compatibility gaps between formats and viewers](https://community.adobe.com/questions-675/do-the-hdr-exports-contain-gain-maps-972254). Varve can realistically address the subset by exposing base/master/output status, preserving a deliberately tone-mapped SDR rendition, and refusing unsupported gain-map claims.

## Dependency-aware implementation order

1. **Integrity and retouch slice.** Convert Spot Heal and Patch to persistent
   scene-tile transactions, fix alpha/coverage identity cases, add regression
   tests, and add a real browser pointer E2E covering undo/reopen/export where
   the existing harness supports it.
2. **Shared precision and master export slice.** Add a finite float buffer
   contract, scene/display scale metadata, bounded OpenEXR writer/reader, and
   independent numeric round trips for 1/2/4, above-white, negative-working,
   alpha, windows, and malformed inputs.
3. **RAW source slice.** Add a versioned source recipe and exact DNG subset
   decoder with synthetic packed mosaics and one legally redistributable real
   fixture. Then add native LibRaw capability probing behind the existing bridge
   only after build/license/resource checks pass. Add Image Tuning controls for
   source/profile/WB/exposure/clipping status; unsupported variants remain
   assets with actionable diagnostics.
4. **Bracket slice.** Add reviewed input records, exposure validation,
   reference selection, bounded alignment/deghost masks, radiance versus
   fusion output types, float master storage, SDR tone mapping, and a focused
   contextual dialog reachable from existing Image Tuning.
5. **Integration and presentation.** Define RAW/bracket source revisions and
   the explicit retouch policy (replay, baked revision, or stale/rebase).
   Add runtime probes for Canvas2D/WebGPU/display state, then implement only
   physically/runtime verified presentation formats. Add accessibility,
   performance admission, website capability labels, notices, guides, and
   changelog entries.

Every slice must include save/reopen, an authoritative redraw, an independent
numeric check, and a truthful export status. A source change must never
silently reinterpret or relocate an existing repair.

## Acceptance criteria

- Persistent retouch: clone/heal/spot/patch target a declared writable raster
  layer, use stable source snapshots, preserve selection/alpha semantics, and
  survive redraw, undo/redo, save/reopen, and export. Zero strength and cancel
  are identity operations and do not add history.
- RAW: final rendering reads sensor/image data from a declared supported
  fixture, not its embedded preview; metadata reports camera/variant/decoder
  and calibration status; WB/exposure/profile changes are reversible; source
  bytes remain unchanged; unsupported instructions fail visibly.
- HDR: at least one validated bracket fixture reconstructs a float scene master
  with distinguishable exposure ratios before tone mapping; alignment borders
  are invalid coverage; deghosting does not masquerade as averaging; radiance
  and fusion outputs have different semantics; the master round-trips through
  an independently decoded promised format.
- SDR/HDR separation: an SDR-only runtime can edit/open the master without
  clipping it; display-HDR status is independently tested and never inferred
  from an API flag or screenshot; output transform changes do not mutate the
  master or source recipe.
- Gain-map sharing: the exported Ultra HDR JPEG uses the stored SDR rendition
  as its base image, carries both XMP and ISO 21496-1 metadata, is independently
  decodable by libultrahdr, and reports its measured reconstruction error;
  changing the output transform without applying it blocks export.
- Website: feature and file-format pages distinguish implemented-and-verified,
  implemented-but-unverified, unsupported, deferred, and blocked capabilities.

## Current outcome ledger

Updated after the local browser, numeric, and independent-export checks on
2026-09-13. “Implemented-and-verified” is scoped to the fixture and format
subset named here; it is not a universal camera, display, or decoder claim.

| Outcome | Status | Precise reason |
| --- | --- | --- |
| Ordinary image retouch with persistent repair layer | Implemented-and-verified | Healing Brush, Spot Heal, and Patch use persistent raster targets; browser pointer E2E covers redraw, undo/redo, save/reopen, and export. The repair target remains RGBA8 and is labelled as an SDR boundary. |
| Genuine supported camera RAW development | Implemented-and-verified for one fixture/subset | The Leica M8 DNG uses the raw IFD rather than its 320x240 embedded preview, exposes a reversible recipe, and exports a 3916x2634 developed rendition. Only `varve-dng-bayer-uncompressed/1` is claimed. |
| Exposure-bracket radiance master + SDR export | Implemented-and-verified in the engine; real-camera bracket blocked | Synthetic linear tests prove 1/2/4 exposure separation and OpenEXR round-trip. The real OpenCV bracket is verified as exposure fusion, not radiance. The real iPhone ProRAW bracket is explicitly rejected because its JPEG-compressed 0x8023 DNG is outside the current decoder subset. |
| RAW → retouch → upstream change policy | Implemented; browser chain unverified | Versioned source revisions and baked repair ownership are persisted and tested. An upstream recipe change leaves the old repair in place and surfaces a stale/rebase warning; a full browser sequence across both operations still needs a dedicated fixture run. |
| SDR-only editing without master clipping | Implemented-and-verified through the Photo source surface | Float32 range-bearing processing and the verified OpenEXR master are independent of display output; supported OpenEXR masters can be reopened, output-adjusted, saved as a new SDR rendition, and downloaded without rewriting the master. The rendered fusion fixture happens to remain within [0,1], while synthetic radiance tests retain above-white and negative working values. |
| Ultra HDR gain-map JPEG sharing | Implemented-and-verified for scene-linear masters | `@varve/engine/hdr/gainMap.ts` writes XMP + ISO 21496-1 metadata in an MPF container; libultrahdr v2.0.2 probes it and preserves the SDR fallback; Varve's reconstruction is within 0.34% of source on the synthetic reference. The stored SDR rendition is the base image and an unapplied output transform blocks export. Display-linear fusion output reports no headroom instead of writing an identity map. |
| Physical HDR presentation | Unverified | No supported runtime/display evidence exists; numeric computation/storage, SDR-only master reopen/edit, and gain-map JPEG sharing are implemented, but the display route remains candidate/unknown until runtime and monitor evidence exists. |

This ledger must be updated when a new decoder, output encoder, or display
runtime is added; it must not be replaced with marketing language until the
stated evidence exists.
