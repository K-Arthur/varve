# Colorization System

Status: current implementation record, 2026-09-13

This document describes the production Colorize surface in Varve. It is the
current contract for the Inspector, engine dispatcher, persisted result asset,
and model-readiness messaging. Historical plans may describe earlier model
catalogs or placeholder controls; those are not evidence that photo inference
is available.

## Scope and capability status

| Workflow | Current behavior | Status |
|---|---|---|
| Tint / selective recolor | Absolute hue set or relative hue rotation in CIELAB L*C*h*, with whole-image or user-supplied mask scope | Implemented and unit-verified |
| Palette colorize | Document swatches, shaded tonal influence, or strict sRGB palette mapping | Implemented and unit-verified |
| Reference transfer | Alpha-weighted global Reinhard-style CIELAB statistics; optional source mask and strength | Implemented and unit-verified |
| Harmonize | Global chroma-distribution adjustment using a separate reference image; no object correspondence claim | Implemented and unit-verified |
| Photo colorization | DDColor ONNX adapter, bounded preview, chroma-only reconstruction, integrity-aware loader gate | Adapter implemented; model artifact and real inference blocked pending verification |
| Line-art colorization | Not routed through photo AI; deterministic drawing-color workflow remains separate | Explicitly deferred |
| Semantic reference matching | Not provided by global statistics | Deferred; never labelled as available |

Automatic photo colorization proposes plausible colors. It does not recover
verified historical facts.

## User-facing contract

Colorize is one Inspector section with task-oriented modes. It does not expose
controls that are decorative in the selected mode.

| Control | Meaning and unit | Applies to | Persistence / verification |
|---|---|---|---|
| Mode | Selects the operation, not merely a model preset | All | Dispatch kind is asserted by engine tests and UI labels |
| Scope | `Whole image` creates an explicit full-coverage mask; `Mask image` requires a real image mask | Selective recolor | Missing mask rejects the request; different mask dimensions are resampled at pixel centres |
| Hue behavior | `Set absolute hue` chooses a target hue; `Rotate existing hue` adds a relative degree offset | Selective recolor | Both paths are separate engine branches and tested |
| Hue | Degrees; `Set absolute hue` spans 0–360, `Rotate existing hue` spans -180–180; wrapped by Lab polar conversion | Selective recolor | Numeric field changes the request signature and invalidates preview |
| Saturation | Existing chroma scale (`×`); neutral source pixels receive a bounded chroma seed so a tint can introduce color | Selective recolor | Zero blend is identity; grayscale tint has a non-zero-chroma regression test |
| Chroma | Target/reference chroma multiplier (`×`) | Recolor, transfer, harmonize | Applied once in the selected operation |
| Lightness | Source L* preservation, 0–100% | Recolor, transfer | Contract is CIELAB L*, not HSL lightness or linear luminance |
| Blend | Final effect strength, 0–100%; mask coverage and blend are multiplied once | Recolor, transfer, harmonize | Zero strength is identity and is covered by tests |
| Near-neutral protection | Conservative protection of already near-neutral authored pixels; neutral grayscale is still tintable | Recolor, harmonize | Explicit user toggle; not person recognition |
| Skin-like protection | Conservative heuristic only, labelled as such | Selective recolor | Never presented as reliable segmentation; mask remains the correction mechanism |
| Document swatches | Real swatches selected by stable ID, with their current HEX value | Palette colorize | Deleted/unusable swatches disappear from the request; empty palettes disable Preview |
| Mapping | `Shaded palette influence` retains source L* and can produce tonal shades; `Strict palette colors` uses literal selected sRGB bytes at 100% adherence | Palette colorize | Strict output is tested against authored palette bytes |
| Adherence | 0–100%; strict constraint applies only at 100% | Palette colorize | Partial adherence is intentionally not strict quantization |
| Reference image | Decoded pixels plus identity, dimensions, and revision | Transfer, harmonize | Missing identity or pixels rejects dispatch; source and reference dimensions are independent |
| Quality | Selects the model input size used by both preview and apply (fast 256, balanced 512, quality/automatic 1024, capped by source) | Photo colorization | Only shown for photo mode; Apply reuses the preview's chroma, so the setting made at preview time is what commits |

## End-to-end data flow

The editor captures a request from the latest selected image and sends it to
`dispatchColorization`:

```text
Inspector controls
  -> ColorizationRequestContract
  -> source / mask / swatch / reference identity validation
  -> classical pixel operation OR verified DDColor runtime resolution
  -> preview or full result
  -> source/revision/signature check
  -> embedded output asset + derived image layer
  -> document save/reopen and export
```

The legacy `colorizationPipeline.execute` facade now adapts to the same
dispatcher. Classical requests cannot fall through into AI when an input is
malformed. The result carries document, source, mask, palette, reference, and
parameter identity so a caller can reject late work.

### Source and alpha rules

The input source is decoded once per operation. Transparent pixels retain their
source RGB and alpha and do not participate in color-transfer statistics.
Mask pixels are interpreted as coverage in mask coordinates and bilinearly
sampled at source pixel centres, so a mask can have a different resolution
without shifting its edges. Document transparency is never replaced by a
checkerboard or model-input matte.

Classical operations run on the original source pixels. Applying a result adds
a new embedded image asset and derived layer; it does not overwrite the source
image. The committed asset is offline-viewable and exportable without rerunning
inference or contacting a model host.

The current compatibility boundary is deliberately explicit: the committed
result is materialized, not a fully re-editable colorization recipe. The source
layer remains available for another edit, but authored Colorize parameters,
painted hints, and external reference bytes are not yet a native operation
schema. A future operation schema must retain the same source IDs/revisions and
must not make the persisted result depend on a removed model.

## Algorithm decisions

### Tint and selective recolor

The engine converts each covered opaque pixel to CIELAB. Absolute mode sets the
target hue while retaining a bounded source-derived chroma magnitude; a neutral
source uses a small chroma seed, which is the important distinction from hue
rotation. Relative mode adds the requested hue offset to the source hue. The
chosen L* is mixed between source L* and a neutral midpoint according to the
Lightness control. Target RGB is gamut-clipped at the final sRGB/ImageData
boundary, and alpha is copied unchanged.

Protection is a reduction of local effect coverage, not a claim that the engine
recognizes skin or people. A manually authored mask is the authoritative scope.

### Palette colorize

Palette colors are validated as opaque `#RRGGBB`/`#RRGGBBAA` values with alpha
255. Empty palettes are invalid; one-color palettes are valid for tonal mapping.
Shaded mode chooses the nearest palette hue/chroma in Lab and combines it with
source L*. Strict mode at 100% adherence chooses the nearest literal palette
byte triplet. At lower adherence it blends toward that triplet, so the result is
not described as strict. Transparent source pixels are preserved.

### Reference transfer and harmonization

Reference transfer uses alpha-weighted global Lab mean and standard deviation,
with independent source and reference dimensions. It retains source lightness
when requested and transfers the reference distribution otherwise. Harmonize
transfers chroma distribution while retaining source L* and coverage. Neither
operation establishes object-to-object correspondence; an empty or fully
transparent reference is an actionable error.

### Photo colorization

DDColor is a chrominance-prediction model. The verified path reproduces the
official `ColorizationPipeline.process` contract:

```text
full-resolution source + alpha
  -> source RGB -> CIELAB L* -> Lab(L*, 0, 0) -> grayscale-derived RGB
  -> square stretch resize to the model input (no aspect padding)
  -> DDColor [1, 2, H, W] raw a*b* output (OpenCV Lab float units)
  -> bilinear a*b* resize to source dimensions
  -> original source L*/detail + predicted chroma + original alpha
```

The model is intentionally fed grayscale-derived RGB, not the original color
channels: upstream converts the resized image to Lab, keeps L*, and rebuilds
`(L*, 0, 0)`. Feeding original color would be out of distribution. The upstream
reference also squashes directly to the square model input, so the adapter has
no letterbox padding to reverse for DDColor; the letterbox contract remains in
the shared worker for the other models that need it. The implementation never
upscales a low-resolution RGB result over the source: only chroma planes are
resampled. Tensor rank, channel count, length, finite values, and output
dimensions are validated before reconstruction.

Preview and apply resolve the model to the same input size (quality mode maps
to 256/512/1024px, capped by source size), so the colors seen in the preview are
the colors that commit. Applying above preview resolution reconstructs the
approved a*b* planes over the full-resolution source L* and alpha instead of
running a second inference; the result carries the chroma planes with the
preview for exactly this purpose. The model is deterministic in the current
adapter; no fake seed-based variations are exposed.

The dispatch also classifies the source (`photo`, `lineart`, `illustration`, or
`already-colored`) and returns it with the result. The panel uses that to tell
the user when an already-colored image is being recolored rather than having
its missing color inferred.

## Model readiness and delivery

Catalog presence, download completion, checksum verification, runtime
compatibility, session load, and smoke-tested execution are separate states.
Colorize uses the integrity-aware model loader and disables photo Preview until
`ddcolor-tiny` or `ddcolor` is actually available and path-resolvable. A model
listed in a manifest is not enough.

As of 2026-09-13, this checkout contains no DDColor ONNX byte artifact: only
the model catalog/manifest entries and the official conversion route are
present. The configured `models-v1` GitHub release asset returned HTTP 404 for
both DDColor variants on that date, so it is not presented as a download
source. No community checkpoint is substituted. The official DDColor project
publishes Apache-2.0 code and an ONNX export script; the resulting weights still
require independent hash, content, tensor, numerical, and visual verification
before redistribution. See [`models-source/README.md`](../../models-source/README.md)
and [`docs/plans/ai-model-recovery-progress.md`](../plans/ai-model-recovery-progress.md).

When an artifact is absent or fails integrity, the UI names that state and
offers Settings → Models. It never returns a tint and calls it photo
colorization. Deterministic workflows remain available without a model,
account, network, or upload.

## Research record and failure-informed decisions

Research was performed against the current documentation/repositories on
2026-09-13. Versions in the implementation were checked against the installed
lockfile where applicable (ONNX Runtime Web/Node 1.27.0; Tauri API 2.11.1;
Playwright 1.62.1; Vitest 4.1.10).

| Question | Source / finding | Applicability | Decision, tradeoff, verification |
|---|---|---|---|
| What does a familiar Colorize control mean? | [GIMP Colorize](https://docs.gimp.org/3.0/en/gimp-tool-colorize.html) defines hue, saturation, and lightness over the active layer/selection. [Photoshop Colorize](https://helpx.adobe.com/photoshop/using/colorize.html) separates color pins and output choices. | Workflow vocabulary and scope | Varve uses explicit source scope and CIELAB L* semantics; it does not imply Photoshop Neural Filters are available. UI and unit tests trace every visible field. |
| How should line-art guidance behave? | [Krita Colorize Mask](https://docs.krita.org/en/reference_manual/tools/colorize_mask.html) documents editable color strokes, gap handling, output beneath linework, and conversion to paint. | Strong line-art reference, not a photo-model contract | Line-art is kept separate and deferred until hints and fills can be persisted and regenerated without leaks. |
| What model is suitable for photos? | [DDColor repository](https://github.com/piddnad/DDColor) and [paper](https://arxiv.org/abs/2212.11613) describe dual decoders and color queries; official code includes ONNX export instructions. | Photo adapter and provenance | Use official conversion only; do not ship an unproven community ONNX. Tensor and artifact gates are explicit. |
| What exactly does DDColor expect as input? | Upstream [`ddcolor/pipeline.py`](https://github.com/piddnad/DDColor/blob/master/ddcolor/pipeline.py) `ColorizationPipeline.process` (master, read 2026-09-13): resize to square, convert to Lab, keep L, rebuild `(L,0,0)` RGB, feed that; output a*b* resized back and combined with original L. | Tensor contract and preprocessing parity | Varve feeds grayscale-derived RGB and squashes to the square model input; it does not feed source color channels or reverse letterbox padding for this model. Unit tests assert neutral output, preserved L*/alpha, and source-resolution reconstruction. |
| What are the web runtime constraints? | [ONNX Runtime Web JavaScript guide](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [large-model guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html), and [WebGPU EP guidance](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) distinguish browser memory, external data, and provider capability. | Preview budget, model delivery, provider reporting | Use the existing worker/loader, bound preview before allocation, and report the worker's execution provider rather than the requested provider. Real hardware/provider smoke tests remain blocked with the absent artifact. |
| How should async image work be isolated? | [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas), and [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) document worker/off-main-thread image boundaries. | Preview and inference lifecycle | Keep decoded source and model work off the commit path; use immutable request identity and latest-document functional commits. |
| What is the color-space authority? | [CSS Color 4](https://www.w3.org/TR/css-color-4/) defines the relevant color-space and conversion terminology. | Avoid HSL/Lab ambiguity | Document controls say CIELAB L*; the browser ImageData boundary is sRGB RGBA8 and is not advertised as HDR/ICC-raster fidelity. |
| How should saved model results work offline? | [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) and [Tauri JavaScript API](https://v2.tauri.app/reference/javascript/api/) support persistent local storage boundaries. | Model loader and document assets | Results are embedded in the document asset table; model binaries remain in the model store, never localStorage. |

Several recurring user complaints informed bounded fixes. They are treated as
failure reports, not as mathematical authority:

| Failure pattern reported online | Varve response |
|---|---|
| [Krita users report colorize-mask leaks/gaps](https://www.reddit.com/r/krita/comments/1767arn/having_some_troubles_with_colorize_mask/) and [bleed across regions](https://www.reddit.com/r/krita/comments/1t500d3/how_to_prevent_colour_mask_bleeds_into_different/) | Require an actual mask for mask scope, make whole-image scope explicit, preserve mask dimensions, resample at pixel centres, expose density/feather in the contract, and keep line-art colorization out of the photo path. |
| [DDColor users report flicker](https://github.com/piddnad/DDColor/issues/35) and the [model zoo warns about red-block artifacts](https://github.com/piddnad/DDColor/blob/master/MODEL_ZOO.md) | Do not claim a model is ready from a filename; require artifact/hash/tensor/smoke/visual verification and keep the photo lane gated until then. |
| [DeOldify users report failed downloads or unusable output](https://github.com/jantic/DeOldify/issues/136) and [save/output problems](https://github.com/jantic/DeOldify/issues/472) | Keep acquisition states explicit, reject failed artifacts, embed accepted output bytes in the document, and make export independent of fresh inference. |
| [Photoshop users report Neural Filter errors/temporary disablement](https://www.reddit.com/r/photoshop/comments/1dtktcp/does_anyone_else_get_the_weve_temporarily_disabled_this_filter_because_of_an_error/) | Do not silently require a cloud account or fall back to a different effect. Varve names local model readiness and leaves deterministic modes usable. |

## Verification matrix

Stable deterministic coverage currently includes:

- zero blend and empty coverage identity;
- grayscale tint introducing chroma;
- absolute versus relative hue semantics;
- mask dimensions that differ from the source;
- alpha-preserving, transparent-excluded statistics;
- strict palette membership and one-color palettes;
- empty references, malformed parameters, and malformed DDColor tensors;
- DDColor grayscale-derived input conversion (neutral output, preserved L*,
  preserved alpha) and square-stretch geometry without letterbox reversal;
- cached chroma reconstruction at source resolution (upscale path, identity
  path, alpha preservation, malformed planes);
- contract validation and stale palette/mask/reference/parameter revisions;
- source-preserving materialized commit and changed-source rejection.

The production UI tests exercise real Colorize control acquisition, preview
invalidations, disabled invalid states, and the functional document commit
helper. Browser visual validation covers the Inspector and marketing page. A
real DDColor model smoke test, numerical agreement with the upstream PyTorch
implementation, native/Tauri provider coverage, and cross-browser model
benchmarks remain blocked until a verified artifact is acquired. Browser
WebKit is not treated as complete Tauri WebKitGTK verification.

## Deferred work

1. Acquire and independently verify official DDColor ONNX artifacts, including
   source revision, export command, SHA-256, license terms, numerical parity,
   provider smoke tests, and visual corpus review.
2. Add a versioned, source-preserving Colorize operation schema for masks,
   swatch IDs, references, authored parameters, model identity, preprocessing,
   and corrections. Materialized output must remain the offline fallback.
3. Build the bounded line-art hint/fill workflow on the existing mask/brush
   infrastructure, with gap/leak diagnostics and guide-overlay separation.
4. Add edge-aware chroma refinement only if image-corpus measurements show a
   bilinear edge failure worth the memory and latency cost.
