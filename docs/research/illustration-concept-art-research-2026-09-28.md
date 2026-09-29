# Illustration and concept-art workflow research

**Accessed:** 2026-09-28
**Scope:** stroke delivery and opacity, hybrid line-art filling, public failure
reports from established drawing applications, and Varve's reproduced baseline.
**Evidence rule:** vendor manuals describe intended behavior; public user
reports are individual observations, not proof of a product-wide defect.

## Source ledger

| Source / version | Finding and confidence | Varve decision supported |
|---|---|---|
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/), Recommendation, 2026-06-30 (normative standard; accessed 2026-09-28) | A trusted parent `pointermove` aggregates its coalesced events. The spec says authors should process the parent or the full coalesced list, not both. Predicted events describe possible future input and are valid only until the next pointer event. High confidence for the web API contract; actual device/WebView delivery still needs runtime tests. | Feed confirmed points once, use predictions only for disposable previews, and retain final confirmed tails and dynamics changes. Do not assume a browser's synthetic test stream models a physical stylus. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/), Candidate Recommendation Draft (accessed 2026-09-28) | Defines source-over and blend behavior including isolated groups. This publication is a draft rather than a final Recommendation. It is useful as a formula reference, not proof that Varve's renderer matches every implementation. | Compare transparent-pixel blending and grouped rendering with the written equations and the authoritative Varve renderer; verify screenshots/exports rather than relying on a blend-mode label. |
| [Krita Manual 5.3: Opacity and Flow](https://docs.krita.org/en/reference_manual/brushes/brush_settings/opacity_and_flow.html), version displayed by the manual site as 5.3.0 (accessed 2026-09-28) | Krita documents opacity as the stroke-level transparency ceiling and flow as deposition per dab. This is a reference for user expectations, not a claim that all applications use identical brush engines. | Preserve Varve's established accumulation for existing presets; add an explicit stroke-opacity mode so artists can choose a stable translucent gesture while leaving repeated gestures able to accumulate. |
| [Krita Fill Tool manual](https://docs.krita.org/en/reference_manual/tools/fill.html), Manual 5.3 (accessed 2026-09-28) | The tool exposes reference scope, threshold, spread, feather and gap-close options. The manual documents available controls but does not measure their quality on Varve or imply every setting is correct for every illustration. | Keep artwork sampling scope distinct from fill destination; make line-art sampling and bounded edge controls explicit rather than silently targeting the selected layer. |
| [Krita Artists: “Help with Fill Tool”](https://krita-artists.org/t/help-with-fill-tool/48910), Krita 5.1 / Windows 10 report (accessed 2026-09-28) | A user reports the bucket filling the whole page instead of a simple enclosed square, and describes repeated animation-frame coloring as costly. This is one forum report; the underlying cause and later resolution are not established by the thread alone. | Add deterministic regression fixtures for open/closed boundaries and make threshold, sampling source, gap closure and output layer visible to the artist. |
| [Krita assistant tool manual](https://docs.krita.org/en/reference_manual/tools/assistant.html), Manual 5.3 (accessed 2026-09-28) | Documents perspective and other drawing assistants as construction aids. It does not establish that Varve already has the same guide behavior. | Reuse Varve's current guide/tool surfaces for a bounded two-point perspective guide; keep it distinct from destructive four-corner image perspective. |
| [Krita reference-images tool manual](https://docs.krita.org/en/reference_manual/tools/reference_images_tool.html), Manual 5.3 (accessed 2026-09-28) | Documents in-canvas reference images. This is a workflow reference only. | Prefer ordinary Varve image nodes and assets with explicit session/document visibility and export treatment over a new document or editor mode. |
| [Adobe Community: Photoshop 27.10 progressive brush lag and masked adjustment layers blinking](https://community.adobe.com/bug-reports-711/photoshop-27-10-becomes-progressively-slower-during-normal-use-with-severe-brush-lag-and-masked-adjustment-layers-blinking-in-and-out-1639263), user report opened 2026-08-28; Adobe Community Manager requested a TIFF, recording, system info and a Wacom-disconnected comparison on 2026-09-16 (accessed 2026-09-28) | The reporter describes slowdown as a multi-layer TIFF grows, severe brush delay, and masked adjustment layers blinking. The thread shows investigation requests; it does not establish a fix, affected population, or root cause. | Measure latency and memory across increasing layer counts; compare brush and mask rendering in recordings. Bound sampling, preview and cache memory so work does not progressively degrade during an ordinary session. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) and [large-model web guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html), live docs (accessed 2026-09-28) | Provider availability, operator coverage and weight loading are separate runtime facts; large browser weights can require special handling. Documentation is mutable and does not certify Varve's bundled artifact or host. | Keep model claims tied to the actual artifact and measured runtime. Do not infer acceleration or safe memory use from an accelerator name or matching checksum. |
| [Real-ESRGAN upstream](https://github.com/xinntao/Real-ESRGAN), repository documentation (accessed 2026-09-28) | Upstream describes its own inference pipeline and model family. This does not establish provenance, licensing or parity for a separately converted ONNX file. | Treat converted-artifact source, conversion process, hash, license, operator support, memory and image quality as independent gates. |

## Baseline probes

These are reproduced function-level defects from the editor resolver, not yet
claims from a complete visible user workflow. Starting-point screenshots and
commands are recorded in the dated capability matrix.

1. With a vector selected and an eligible raster layer supplied as fallback,
   the resolver returned that unrelated raster layer. A paint stroke can thus
   land somewhere other than the explicit selection.
2. A hidden target with a nonexistent mask identity was accepted as a mask
   destination. The target contract did not check ancestor state or confirm
   that the selected mask matched the node's actual raster-mask asset.
3. A deleted fallback id caused a property-access exception rather than a
   described refusal.

The compositor/fill-source and progressive-latency complaints above motivate
targeted regression and workload tests; they are not recorded as reproduced
Varve defects until the relevant UI operation and output have been observed.

## Artifact provenance caution

The existing anime-restoration ONNX file's SHA-256 was found to match the
repository manifest in the initial audit. A matching hash proves byte identity
with that manifest entry only. The model-host repository metadata and Varve's
manifest do not agree on a license label; neither label alone proves the
license or conversion provenance of the original checkpoint and generated
ONNX artifact. Do not present this model as license-cleared or quality-qualified
until the source checkpoint, converter, all notices, target runtime and artist
fixtures are checked independently.
