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
| Line-art colorization | Deterministic hint-guided fills: linework barriers with bounded gap closing, geodesic nearest-hint assignment, preserved strokes, transparent unfilled regions | Implemented and unit-verified |
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
| Near-neutral protection | Softens pixels that already carry small authored chroma; pure grayscale is deliberately left tintable in recolor | Recolor, harmonize | Explicit user toggle; band is documented in `heuristics.ts`, not person recognition |
| Skin-like protection | Softens pixels inside a broad Lab hue band (20–70° with chroma 8–60); a softening factor, never an exclusion | Selective recolor | Labelled heuristic; a user mask remains the authoritative correction mechanism |
| Document swatches | Real swatches selected by stable ID, with their current HEX value | Palette colorize | Deleted/unusable swatches disappear from the request; empty palettes disable Preview |
| Mapping | `Shaded palette influence` retains source L* and can produce tonal shades; `Strict palette colors` uses literal selected sRGB bytes at 100% adherence | Palette colorize | Strict output is tested against authored palette bytes |
| Adherence | 0–100%; strict constraint applies only at 100% | Palette colorize | Partial adherence is intentionally not strict quantization |
| Reference image | Decoded pixels plus identity, dimensions, and revision | Transfer, harmonize | Missing identity or pixels rejects dispatch; source and reference dimensions are independent |
| Hint image | Decoded pixels plus identity and dimensions; hint pixels above the alpha threshold are color seeds | Line art | Missing hints reject dispatch; hints may be a different resolution and are sampled in source coordinates |
| Line threshold | Ink coverage ramp: luminance below the threshold is linework, scaled by source alpha so transparent paper is fillable | Line art | Numeric field changes the request signature; stroke edges keep their antialiased blend |
| Gap closing | Barrier dilation radius in working pixels (0–8) | Line art | Zero leaves pinholes; 1–2 seals typical pen gaps without blurring the artwork |
| Line-art report | Filled fraction, unassigned fraction, and seed-pixel count | Line art | Shown after preview so an unhinted region is visible before Apply |
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

A preview is bound to the selected source node, the authored parameter
signature, and the request identity. Changing an authored control clears it;
if the selected source changes, Apply stays disabled until a new preview
matches the current source (any retained preview is marked out of date). The
commit helper re-checks the source before inserting anything.

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
recognizes skin or people. Both heuristics live in `heuristics.ts` with the
exact Lab bands and unit tests; the skin-like band can include warm wood or
leather, which is why it only softens the effect and why a manually authored
mask is the authoritative scope.

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

### Line-art colorization

Line art is handled by a deterministic pixel algorithm, never by the photo
model. The source supplies barriers: ink coverage is a luminance ramp below the
paper threshold (scaled by source alpha, so transparent paper is fillable), and
an optional chamfer dilation closes small stroke gaps. Hint pixels above the
alpha threshold become seeds; every reachable pixel is assigned to its nearest
seed by 8-connected geodesic distance, so color cannot cross linework. Strokes
and their antialiased edges are composited over the assigned fill, and pixels
no hint can reach stay transparent instead of paper-white, which keeps the
result layerable. Hints at another resolution are sampled in source
coordinates. Region assignment is bounded to a working resolution
(default 2048px) and upsampled, so a full-resolution scan cannot stall the
editor. The preview reports the filled/unassigned fractions and seed count.

This is an editor, not a semantic fill: a gap wider than the configured radius
still leaks, and the panel says so rather than implying a learned solution.

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
`ddcolor-tiny` or `ddcolor` is actually available and path-resolvable.

As of 2026-09-14 the official Apache-2.0 checkpoints have been exported and
verified: ONNX checker, ONNX Runtime CPU smoke, and PyTorch parity (mean
absolute difference below 1e-4) all pass, with the artifact SHA-256 pinned in
the catalog and manifest. The artifacts are published to the `models-v1`
release and staged in `models-source/` for the publisher script.

Download routes:

- **Desktop** uses the native `download_inference_model` command: the Rust
  side streams the bytes, verifies the catalog SHA-256 before installing, and
  serves the file through Tauri's asset protocol, so release-host CORS policy
  is irrelevant.
- **Web** requires a CORS-enabled host; GitHub release assets do not send
  `Access-Control-Allow-Origin`. `tools/ddcolor-export/mirror-to-hf.sh` mirrors
  the verified files to HuggingFace, whose resolve endpoints do send CORS
  headers. Until the web mirror is published, the web build surfaces the
  download failure as an actionable error instead of falling back to a tint.

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
| [Krita users report the colorize mask is slow and needs repeated manual updates on large images](https://www.reddit.com/r/krita/comments/1mp5e7f/help_how_does_this_thing_work1/) | Deterministic operations are explicit and bounded (256–1024px preview class); the panel never recomputes per keystroke, and Apply reuses the approved chroma instead of processing the image again. |
| [DDColor's own community notes the model cannot accept user hints or reference guidance](https://discuss.huggingface.co/t/problems-with-duplication/176137/62) | The photo lane never claims hint conditioning. Corrections are an explicit deterministic mask re-run on the source, and the photo hint states that colors are inferred, not recovered. |

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
- protection heuristics' documented Lab bands (skin-like hue/chroma gate,
  near-neutral authored chroma) with the warm-tone limitation stated;
- line-art region fills on both sides of a stroke, transparent unreachable
  regions, one-pixel gap sealing, antialiased stroke preservation,
  low-resolution hints, transparent paper, determinism, and validation;
- cached chroma reconstruction at source resolution (upscale path, identity
  path, alpha preservation, malformed planes);
- contract validation and stale palette/mask/reference/parameter revisions;
- source-preserving materialized commit and changed-source rejection.

The production UI tests exercise real Colorize control acquisition, preview
invalidations, disabled invalid states, and the functional document commit
helper. The DDColor export is verified against the official checkpoint (ONNX
checker, ORT CPU smoke, PyTorch parity) and the published asset re-downloads
byte-identical to the verified artifact. Browser visual validation covers the
Inspector and marketing page; the deterministic workflow passes in Chromium
and Firefox. Playwright WebKit on this Linux host is blocked by missing system
libraries (`libicu74`, `libxml2`, `libflite1`) that require a package-manager
install, and browser WebKit is not treated as Tauri WebKitGTK verification
either way. Native/Tauri provider coverage and cross-browser model benchmarks
remain open.

## Deferred work

1. Publish the verified DDColor ONNX artifacts to the `models-v1` release and
   keep the catalog hashes in sync with the uploaded bytes.
2. Add a versioned, source-preserving Colorize operation schema for masks,
   swatch IDs, references, authored parameters, model identity, preprocessing,
   and corrections. Materialized output must remain the offline fallback.
3. Extend line-art colorization with animated/multi-frame consistency and
   painted on-canvas hints; independent single-image runs are not a
   temporal-aware capability.
4. Add edge-aware chroma refinement only if image-corpus measurements show a
   bilinear edge failure worth the memory and latency cost.
