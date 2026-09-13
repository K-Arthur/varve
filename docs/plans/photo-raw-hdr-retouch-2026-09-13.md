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
OpenEXR master before considering PQ/HLG or gain-map output. Keep exposure,
grading, tone mapping, gamut mapping, encoding, and display capability as
separate stages.

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
- Website: feature and file-format pages distinguish implemented-and-verified,
  implemented-but-unverified, unsupported, deferred, and blocked capabilities.

## Current outcome ledger

At plan creation, all three requested end-to-end outcomes are **not yet
complete**. The initial audit status is:

| Outcome | Status | Precise reason |
| --- | --- | --- |
| Ordinary image retouch with persistent repair layer | In progress | Clone/heal are persistent; Spot Heal/Patch still use the visible canvas. |
| Genuine supported camera RAW development | Blocked for current baseline | No RAW decoder or camera fixture is wired; implementation must establish a supported subset first. |
| Exposure-bracket radiance master + SDR export | Blocked for current baseline | No radiance merge, float master, alignment/deghost, or truthful HDR export exists in the production path. |
| RAW → retouch → upstream change policy | Blocked for current baseline | No versioned RAW recipe/source-revision contract exists. |
| SDR-only editing without master clipping | Blocked for current baseline | No range-bearing document/master path exists. |
| Physical HDR presentation | Unverified | No supported runtime/display evidence exists; numeric computation/storage is the prerequisite. |

This ledger is updated in each implementation commit and must not be replaced
with marketing language until the stated evidence exists.
