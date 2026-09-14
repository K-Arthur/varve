# Photo and image editing research ledger — 2026-09-13

This ledger records the external evidence and the Varve observations used for
the current photo/image-editing work. It is deliberately narrower than a
feature wish list: a source-backed finding is separated from an observation of
the current tree, a hypothesis, and a product decision.

Access date for the sources below: **2026-09-13** (America/Vancouver). Private
artwork and documents were not uploaded to any external service.

## Source ledger

| Source (access date) | Applicable version/status | Finding | Varve consequence | Uncertainty |
| --- | --- | --- | --- | --- |
| [Adobe: Nondestructive editing](https://helpx.adobe.com/sg/photoshop/using/nondestructive-editing.html) | Current product documentation, accessed 2026-09-13 | Adjustment layers, layer masks, Smart Objects, and separate-layer retouching retain editable source state; Crop can hide pixels instead of deleting them. | Keep original assets, placed instances, masks, adjustment recipes, and writable retouch layers distinct. A rendered preview or session Undo is not enough evidence of non-destructive editing. | This is behavioral reference material, not a proposal to copy Photoshop’s UI or proprietary algorithms. |
| [Adobe: Layer masks](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/use-layer-masks-to-target-adjustment-or-fill-layers.html) | Current product documentation, accessed 2026-09-13 | White reveals, black conceals, and gray preserves partial coverage; the mask can be refined after the adjustment. | Preserve fractional mask/selection coverage and make local edits attach to the declared adjustment or layer scope. | Varve’s mask formats and scope contracts are its own; parity is tested behavior, not file-format compatibility. |
| [W3C: Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | W3C Recommendation, accessed 2026-09-13 | Blending is separate from alpha compositing; the simple source-over equations are defined in premultiplied form and group backdrops/isolation affect the result. | Validate transparent edges analytically and do not treat straight RGB interpolation plus independent alpha interpolation as a universal compositor. | Full ICC-managed blending and every browser blend mode remain broader than this work slice. |
| [W3C: WCAG 2.2](https://www.w3.org/TR/wcag/) | WCAG 2.2, accessed 2026-09-13 | Success Criterion 2.5.7 requires a single-pointer, non-drag alternative for dragging operations unless an exception applies; target-size guidance also affects compact controls. | Numeric fields, keyboard alternatives, visible focus, and touch-sized controls belong beside slider/drag interactions. Freehand drawing needs route-specific assessment rather than a blanket claim. | Compliance requires a full product audit; this ledger does not certify Varve. |
| [PNG 3rd Edition](https://www.w3.org/TR/png-3/) and [PNG editor’s draft](https://w3c.github.io/png/) | W3C PNG specification/current draft, accessed 2026-09-13 | PNG carries alpha and color metadata such as `iCCP`, `sRGB`, and `gAMA`; PNG samples are non-premultiplied while alpha is a separate linear coverage value. | Convert to premultiplied working values before resampling, then unpremultiply and encode; never let hidden RGB under transparent pixels tint an edge. Keep profile tagging separate from pixel conversion. | Browser encoder metadata behavior is runtime-dependent; Varve post-processes only the chunks it can validate. |
| [ICC: Getting started](https://www.color.org/getting-started/) | ICC color-management overview, accessed 2026-09-13 | Predictable color exchange needs explicit source/destination transforms through the profile connection space; assigning a profile is not the same as converting values. | Track source encoding, conversion, display/proof, and export tagging as separate boundaries. Do not advertise a higher-precision or profiled pipeline from a typed array alone. | Varve’s browser analytic RGB transform is not a general ICC CMM or CMYK proof. |
| [MDN: Canvas 2D context attributes](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getContextAttributes) and [ImageData color space](https://github.com/mdn/content/blob/main/files/en-us/web/api/imagedata/colorspace/index.md?plain=1) | Current web platform documentation, accessed 2026-09-13 | `ImageData`/2D color-space and pixel-format support is runtime-dependent; the requested storage type does not prove the browser’s full processing/display precision. | Treat Canvas2D as an explicit boundary and identify where RGBA8 is used. Keep any higher-precision source metadata honest when a stage must pass through 8-bit pixels. | WebKitGTK, Chromium, and Tauri versions can differ; only the environments listed in validation evidence are verified. |
| [libvips: `Image.thumbnail`](https://www.libvips.org/API/8.17/ctor.Image.thumbnail.html) and [image shrinking guidance](https://github.com/libvips/libvips/wiki/HOWTO----Image-shrinking) | libvips API 8.17 documentation/current wiki, accessed 2026-09-13 | Shrink-on-load, streaming, premultiplication before shrinking, and linear-light options reduce memory pressure and transparent-edge artifacts. | Validate dimensions before allocation, use bounded/tiled processing, and make the chosen resampling space explicit. The current fix applies the alpha/transfer-order rule to the shared export resampler. | Varve’s browser Canvas decoder cannot always shrink before decode; decode-time protection remains a separate platform task. |
| [Mitchell and Netravali, Reconstruction Filters](https://www.cs.utexas.edu/~fussell/courses/cs384g-fall2013/lectures/mitchell/Mitchell.pdf) | Original 1988 paper, accessed 2026-09-13 | Reconstruction filters trade sharpness, ringing, and alias suppression; a named filter is not a guarantee of detail recovery. | Keep resize algorithm selection and rationale explicit, and test downscale, upscale, edges, gradients, and pixel art separately. | No single filter is best for every photograph or illustration. |
| [Poisson Image Editing](https://legacy.sites.fas.harvard.edu/~cs278/papers/poisson.pdf) and [Telea inpainting](https://www.howardzzh.com/research/papers/vision/2004.JGT.Telea.ImageInpainting.pdf) | Original papers, accessed 2026-09-13 | Gradient-domain cloning and fast-marching inpainting are materially different from a color-offset or blur-based healing approximation. | Use honest names for current healing/spot repair and do not claim Poisson/model-based reconstruction without the corresponding solver and evidence. | Quality varies with mask geometry, texture, and boundaries; a future solver needs independent fixtures. |
| [LibRaw supported cameras](https://www.libraw.org/supported-cameras) | LibRaw 0.22 support page, accessed 2026-09-13 | Camera coverage is version/build-dependent; a library page is not proof that every build supports every listed camera or RAW variant. | Describe RAW as a verified subset with decoder/build/version evidence. Do not market “universal RAW” from JPEG-preview opening. | Camera corpus coverage in this checkout remains limited; see the RAW/HDR audit for the tested subset. |
| [ONNX Runtime Web: large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) | Current ONNX Runtime Web documentation, accessed 2026-09-13 | Browser ArrayBuffer, protobuf, WebAssembly, model-weight, and copied/intermediate buffers impose separate memory limits. | Admission estimates must include decoded images, model/runtime allocations, scratch buffers, and output staging. Model size alone is not a performance or feasibility measure. | Exact peaks vary by provider and browser; benchmark evidence must name the runtime and workload. |

## Failure patterns worth preventing

These are public user reports or maintained-project discussions, not controlled
benchmarks. They are useful because they identify failure modes users notice in
ordinary work.

| Reported failure | Realistic Varve mitigation | Evidence/verification |
| --- | --- | --- |
| [Adobe healing/clone layer data disappearing](https://community.adobe.com/questions-712/layer-data-disappears-when-using-healing-brush-and-clone-stamp-tools-photoshop-cc-2018-1060095) and [black spots from Spot Heal](https://community.adobe.com/questions-712/photoshop-spot-healing-brush-leaving-black-spots-1106121) | Resolve a writable destination before mutation, keep immutable source sampling separate, reject ambiguous targets, and commit no-op/cancelled strokes as no history. | Retouch target/sampling owner and engine alpha tests; independent UI verification remains a required follow-up. |
| [Clone source overlay/offset mismatch](https://community.adobe.com/questions-712/clone-stamp-and-healing-brush-overlay-offset-locks-after-keyboard-shortcut-and-moved-photoshop-1083512) and [missing source crosshair](https://community.adobe.com/bug-reports-711/p-clone-stamp-source-crosshair-missing-not-showing-disappeared-photoshop-20-0-5-659774) | Keep source markers in the same camera/transform path as artwork and expose aligned/non-aligned state; do not let a hidden marker imply a different source. | Overlay and rotated/nested-image E2E fixtures are required; no claim is made from a unit test alone. |
| [Cross-document Clone/Healing scaling failure](https://community.adobe.com/bug-reports-711/p-clone-tool-and-healing-brush-don-t-copy-from-document-to-document-correctly-658784) | Map source points through source and destination transforms rather than matching tile coordinates; define out-of-bounds behavior. | Coordinate-mapping tests and a rotated/cropped/nested fixture. |
| [Krita clone cursor regression](https://bugs.kde.org/show_bug.cgi?id=502690) | Treat source marker state, cursor feedback, and stroke input as observable behavior; test pointer cancellation and sparse samples. | Browser E2E plus screenshot inspection, not only event-handler assertions. |
| [darktable sidecar workflow](https://darktable-org.github.io/dtdocs/en/overview/sidecar-files/sidecar/) and [export workflow](https://darktable-org.github.io/dtdocs/en/overview/workflow/export/) | Keep editable project state distinct from flattened export, retain source assets, and make metadata/privacy policy explicit. | Save/reopen/export fixtures and export byte/metadata inspection. |
| [darktable sidecar timestamp/backup discussion](https://github.com/darktable-org/darktable/issues/16676) and [sidecar race discussion](https://github.com/darktable-org/darktable/issues/4450) | Make asset writes atomic, revision-aware, and recoverable; do not let late jobs or stale sidecars overwrite newer document state. | Async revision tests, save/reopen, and crash-recovery validation. |
| [Photopea large-file save issue](https://github.com/photopea/photopea/issues/5941) and user reports of large PSD/PSB hangs ([example](https://www.reddit.com/r/photopea/comments/1izaq5d)) | Bound raster allocations before creating a canvas, use tiles/pyramids where justified, cancel superseded work, and never commit a proxy as the source. | Peak-memory, cancellation-latency, and full-resolution save/export fixtures on constrained hardware. |
| [Photoshop white-outline healing report](https://community.adobe.com/t5/photoshop-ecosystem-discussions/healing-brush-tool-creates-unwanted-white-outline/m-p/11900931) | Test alpha-aware healing over transparent product edges on more than one background; never sample transparent RGB as visible color. | Analytical alpha fixtures plus exported PNG inspection. |

## Varve evidence classification

### Externally verified behavior

- Non-destructive editing requires retained source/parameters and a declared
  scope; Undo alone is session history, not a saved edit contract.
- Alpha compositing and blending have distinct stages, and premultiplied
  source-over math is the safe analytical reference for transparent edges.
- Linear-light and encoded-space resampling are different products; the
  working space must be explicit.
- RAW support, HDR display, ICC conversion, and model feasibility need
  end-to-end evidence rather than labels or file extensions.

### Observed in the current Varve tree

- `exportNodeAsRaster` renders through the shared replay path, then optionally
  runs the typed resize/sharpen/color/dither pipeline before encoding.
- The shared resampler already uses premultiplied intermediate values and has
  tests for hidden RGB, semi-transparent edges, tiled processing, and linear
  opaque checkers.
- Before this slice, the linear-light branch applied the sRGB transfer function
  to an already-premultiplied encoded channel. That is not equivalent to
  linearizing straight RGB and then premultiplying by alpha.
- PNG profile/text handling and JPEG ICC insertion are post-encode operations;
  WebP profile embedding is intentionally disclosed as unavailable on this
  Canvas encoder path.
- The existing product/docs surfaces already describe RAW/HDR and enhancement
  as verified subsets rather than universal support. Those claims remain
  bounded by the current audits and runtime evidence.

### Hypotheses requiring further evidence

- Browser Canvas2D `alpha: false` behavior and default matte can differ by
  runtime; direct export tests must inspect encoded pixels, not infer them from
  context attributes.
- A native/accelerated path may have different precision or edge behavior from
  the authoritative software path until a parity fixture proves otherwise.
- A full document composite sampler would need scene replay of vectors,
  transforms, masks, clipping, isolation, and effects; matching raster tile
  coordinates is insufficient.

### Product decisions for this work

1. Fix the shared linear-light resampler first because it is isolated, testable,
   and protects every caller that explicitly requests physical-light resizing.
2. Preserve the existing default encoded-sRGB resize behavior for compatibility;
   do not globally switch every operator to linear light without semantic and
   visual review.
3. Keep export warnings and capability labels aligned with the actual encoder;
   no transparency, profile, metadata, RAW, HDR, or AI claim should exceed the
   verified vertical slice.
4. Use the existing Photo workspace, export service, asset model, and website
   pages. No second raster document, effect registry, selection state, or model
   manager is introduced.

## Implementation outcome — 2026-09-14

The first verified vertical slice implemented the highest-confidence boundary
fixes from this ledger:

- The shared resampler now reads straight encoded RGB, converts to linear sRGB
  when requested, then premultiplies before filtering. The default remains
  encoded sRGB for compatibility.
- Opaque raster export now paints an explicit white matte when no matte is
  supplied and emits a warning that transparency was flattened. This covers
  JPEG inherently and PNG/WebP when transparency is disabled. Callers can
  provide a different matte through the existing `matteColor` option.
- Object → Resize Image exposes the working-space choice through the existing
  dialog and passes it through the existing editor/context operation. The
  operation changes source-pixel dimensions while preserving placed bounds;
  it is not placement scaling, canvas resizing, or detail recovery.
- The existing feature and tool documentation now describes those boundaries,
  including the local/offline behavior and the honest limits of the selected
  resampling mode.

Focused numerical/component checks passed: 27 tests across the resampler,
image-resize, dialog, and opaque-matte suites, including JPEG and explicitly
opaque PNG export. The Chromium image-resize workflow also
passed end to end on Linux, including selecting `Linear light (photo edges)`
through the real dialog, with screenshots for open, configured, and applied
states; the screenshots were inspected as pixels, not only checked for
existence. A follow-up run after widening the dialog passed the same flow and
confirmed the full working-space label is visible. The website build
completed all 102 static routes, and the two changed pages were reviewed at
desktop and narrow mobile widths.

This does not certify universal RAW/HDR support, full ICC management,
source-preserving resize history, WebKitGTK/ChromeOS runtime parity, or the
separate retouch/selection work owned by other agents. Those remain bounded by
the capability matrix and their own validation records.

## Capability matrix and ownership

| Workflow/capability | Status in this checkout | Evidence/fixture | Primary owner | This slice |
| --- | --- | --- | --- | --- |
| Source-preserving crop/placement | Working for the supported image-fill model; transform follow-up is active elsewhere | `docs/audits/photo-editing-compositing-audit-2026-09-08.md`, crop/transform E2E ownership records | Image/crop integration owner | Do not overlap |
| Shared tonal/filter operators | Working/partial by operator and scope | Photo audit and engine adjustment tests | Adjustment/effects owners | Do not duplicate |
| Separate-layer retouch target/sampling | Recently repaired, with remaining scope limits | `docs/quality/photo-retouch-research-2026-09-13.md`, retouch ownership ledger | Retouch owner | Verify independently later |
| Alpha-safe encoded-space resize | Working before this slice | Resampler unit suite | Engine export pipeline | Add regression coverage |
| Alpha-safe linear-light resize | Broken at the transfer/premultiplication boundary before this slice | New semi-transparent linear-light fixture | Engine export pipeline | Repair |
| PNG/JPEG export and ICC tagging | Partial but explicit | Export tests and raster color tests | Editor/engine export | Keep claims bounded |
| WebP ICC embedding | Intentionally unavailable on Canvas path | `webpProfileEmbeddingSupported()` and export warning | Engine/editor export | Do not claim support |
| Universal RAW / HDR display | Missing or verified subset only | RAW/HDR architecture/docs | Photo source owner | Do not broaden claims |
| Large-image constrained-device behavior | Partial | Raster allocation policy; dedicated perf fixture still required | Engine/editor performance | Measure before optimization |

## Validation required for the implementation

The first change is an engine-only numerical correction, so the inner loop is
the focused resampler test. Before completion, the affected validation planner
must be run against the final diff. A real UI export should then be exercised
in Chromium with screenshots and encoded-pixel inspection; Chromium does not
stand in for WebKitGTK or a physical Chromebook. Full repository validation is
only appropriate if the final planner escalates it or a release checkpoint
requires it.
