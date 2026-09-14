# Generative editing model and workflow landscape — 2026-09-14

Status: research and product-routing decision record. This document broadens
the completion work; it does not turn an unqualified model into a product
capability. The recommendations are for Varve's local-first desktop and
browser architecture, with no silent upload or remote fallback.

## Executive decision

There should not be one “generative fill” path. The user-visible operation is
an intent, and the engine should route it to the smallest qualified method that
can satisfy that intent:

| Intent | Default route | Why |
| --- | --- | --- |
| Dust, wire, blemish, or a small background defect | Deterministic local repair: OpenCV Telea/Navier–Stokes, PatchMatch, or LaMa according to the region | Fast, promptless, predictable, and suitable for low-memory devices. OpenCV documents these methods as neighborhood-based restoration rather than semantic generation. [OpenCV inpainting](https://docs.opencv.org/3.4.7/d7/d8b/group__photo__inpaint.html) |
| Remove a recognisable object | Automatic mask suggestion plus user confirmation/refinement, then deterministic repair first | The mask is the hard part. A segmentation model should propose a mask; it must not silently make a destructive edit. |
| Insert or replace a semantic object | A genuinely mask-conditioned diffusion/editing model | A base text-to-image or image-to-image model is not an inpainting model. The model must consume the mask and pass Varve's real-photograph qualification. |
| Extend the canvas | A qualified outpainting/inpainting model, with explicit output bounds and tiled overlap | Expansion must preserve the source world placement and distinguish revealed source pixels from genuinely generated pixels. |

The current Varve SD 1.5 Inpainting Q4 candidate remains unqualified. Local
tests showed that the prompt-capable path can complete with plausible-looking
bytes while failing the requested semantic result, and alternate Vulkan runs
showed runtime corruption. A base SD 1.5 diagnostic could respond to a text
prompt in text-to-image mode but produced repeated-pattern artefacts in an
image-to-image landscape test. Neither observation justifies using a base model
as a masked-generation fallback. The existing promptless PatchMatch/LaMa
paths remain the honest default for Fill and Remove.

The immediate product conclusion is therefore:

1. Make simple cleanup excellent and available everywhere.
2. Add assisted object masking as a separate, reversible step.
3. Keep semantic Replace and Expand unavailable until a model/runtime pair
   passes the existing quality, resource, cancellation, and persistence gates.
4. Treat device capability as a runtime qualification result, not as a label
   such as “Chromebook”, “ARM”, or “has WebGPU”.

## What users are actually asking for

The complaints reviewed here are anecdotal, but they repeat the same product
requirements across Photoshop, browser photo tools, and local inpainting
communities:

| Observed complaint | Requirement for Varve | Evidence and interpretation |
| --- | --- | --- |
| Pixels change beyond the selection, including faces or nearby objects | Keep the editable mask, provider mask, and compositing mask separate. Expose blend halo and mask expansion independently. Offer a strict “clip generated pixels to the effective mask” option and a before/after difference view. | Photoshop users report edits extending beyond the selection and ask for stricter control. [Adobe community discussion](https://community.adobe.com/questions-712/generative-fill-mask-issue-1619579), [user report](https://www.reddit.com/r/photoshop/comments/1h8wzqd/generative_fill_now_extends_way_beyond_your/) |
| A blank prompt used to mean “continue the scene” but is unavailable for some models | Make promptless reconstruction an explicit mode, not an empty string sent to a semantic model. Do not grey out a useful deterministic mode merely because a diffusion model is absent. | Adobe documents that promptless generation is not supported by every model, and users describe losing the contextual workflow. [Adobe community discussion](https://community.adobe.com/questions-712/why-was-the-prompt-free-generative-fill-workflow-removed-from-adobe-photoshop-when-it-was-one-of-the-most-powerful-and-creative-features-for-fast-retouching-and-visual-exploration-1561141) |
| Removal unexpectedly invents benches, animals, or other objects | Provide a no-prompt deterministic removal route and make generative removal opt-in. The result must be labelled with its provider and recipe. | Users report unwanted semantic insertions and prefer a blank-prompt or deterministic tool for ordinary removal. [Removal-mode discussion](https://www.reddit.com/r/photoshop/comments/1lf52gj/generative_fill_became_awful_all_of_a_sudden/), [non-generative removal request](https://www.reddit.com/r/photoshop/comments/1tpm2wy/how_to_not_use_gen-ai-remove-tool/) |
| Seams, halos, white borders, and colour discontinuities appear at the mask edge | Preview a 100% boundary crop, show the final compositing mask, use context padding and overlap-aware tiles, and let the user refine/feather without losing the prompt or candidates. | Seam reports occur even with simple masks, and Photoshop users describe manually blurring, patching, or refilling. [Diffusers seam issue](https://github.com/huggingface/diffusers/issues/5808), [Adobe expand issue](https://community.adobe.com/questions-700/generative-expand-issue-671957), [user seam report](https://www.reddit.com/r/photoshop/comments/1eqbkq4/removing-generative-fill-seams-lines/) |
| Quality changes after an application or model update | Pin model/runtime/weights/preprocessing versions, record them per variation, retain old candidates, and never invalidate accepted pixels when a model is missing or upgraded. | This is a direct consequence of the current qualification failure and of users reporting sudden quality changes. [Generative-fill quality report](https://www.reddit.com/r/photoshop/comments/1lf52gj/generative_fill_became_awful_all_of_a_sudden/) |
| A good result is hard to compare, recover, or reproduce | Keep one to four candidates with seed, prompt, negative prompt, mask hash, provider, model, runtime, dimensions, and effective settings. Support compare, regenerate, apply, reject, delete, and Restore Original. | This follows from the difference between “bytes were returned” and a reviewable editing result. |
| A tool is slow, drains a laptop, or fails after a long wait | Preflight available memory, model footprint, output size, and backend; use bounded tiles and one heavy job; provide immediate cancellation and a clear fallback. | Local diffusion diagnostics on the development machine exhausted available memory before a 512px run completed. This is a release risk, not a user-facing promise. |
| Users do not know what data leaves their device | Show local/offline status and model storage before generation. Never silently substitute a cloud provider. | Local-first privacy is a product requirement; browser inference can also be local and offline when the model is already present. [ONNX Runtime Web overview](https://onnxruntime.ai/docs/tutorials/web/) |

Adobe's current controls are a useful interaction baseline, even though Varve
will not copy its provider model: its Remove tool distinguishes generative
versus non-generative operation, supports brush or loop input, Sample All Layers,
and whether to remove after each stroke; Content-Aware Fill exposes automatic,
rectangular, custom, and all-layer sampling plus colour/rotation adaptation and
output-layer choices. [Remove tool controls](https://helpx.adobe.com/photoshop/using/tool-techniques/remove-tool.html),
[Content-Aware Fill settings](https://helpx.adobe.com/photoshop/desktop/repair-retouch/remove-objects-fill-space/adjust-content-aware-fill-settings.html),
[mask refinement tools](https://helpx.adobe.com/ca/photoshop/desktop/repair-retouch/remove-objects-fill-space/tools-to-fine-tune-sampling-and-fill-areas.html).
Varve should expose the intent behind those controls—sampling source, mask
refinement, boundary policy, and output history—without pretending that every
provider supports every parameter.

## Candidate model and algorithm families

### Small, deterministic repairs

These are not “AI generation”, and that is a benefit for a large class of
edits.

- OpenCV Telea and Navier–Stokes are appropriate for small scratches, dust,
  wires, and local defects where nearby pixels contain enough information.
  They should not be sold as semantic object removal or used for a large
  missing subject. [OpenCV inpainting](https://docs.opencv.org/3.4.7/d7/d8b/group__photo__inpaint.html)

- PatchMatch is useful when the source contains repeated texture or a nearby
  exemplar. It is fast and model-free, but has no understanding of objects,
  perspective, or language. Varve already has this route and should make its
  strengths visible through a “Quick cleanup” or “Reconstruct” quality choice.

- LaMa is the stronger local promptless route for larger irregular holes and
  periodic structure. Its Fourier-convolution design was explicitly intended
  to generalise to large masks and repeated patterns. It still cannot insert a
  requested semantic object. [LaMa implementation](https://github.com/advimman/lama)

- MAT is a research alternative for large-hole completion. The paper reports
  high-resolution, pluralistic completion, but the released implementation is
  tied to a research-oriented Python/PyTorch/CUDA environment and its README
  documents 512px multiples and research-only code/model use. It is a lab
  candidate, not a low-memory cross-platform default. [MAT repository](https://github.com/JIA-Lab-research/MAT),
  [MAT paper](https://openaccess.thecvf.com/content/CVPR2022/papers/Li_MAT_Mask-Aware_Transformer_for_Large_Hole_Image_Inpainting_CVPR_2022_paper.pdf)

- Adobe's SuperCAF research is a useful systems reference rather than a
  directly shippable dependency: it combines LaMa, guide images, PatchMatch,
  multiple candidates, and curation for high-resolution camera images. It
  supports the decision to build a candidate-and-review workflow instead of
  expecting one sample to be correct. [SuperCAF](https://research.adobe.com/publication/supercaf/)

### Semantic insertion, replacement, and removal

- SD 1.5 Inpainting is a legitimate inpainting architecture, not merely a base
  checkpoint: its model card describes the extra mask/image input channels and
  the white-mask=inpaint convention. It also lists limitations around
  photorealism, text, faces, and compositionality. The model is licensed under
  CreativeML OpenRAIL-M. [SD 1.5 Inpainting model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting)
  Varve's current GGUF candidate additionally carries a patched-runtime
  compatibility warning; its file format does not establish correctness.

- SDXL Inpainting is a quality candidate for a higher-memory desktop tier. Its
  model card uses a 1024px workflow, documents the extra inpainting channels,
  warns about quality at full denoising strength, and lists the same broad
  limitations around faces, text, and composition. It is therefore not a
  Chromebook or 4GB default. [SDXL Inpainting model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1)

- PowerPaint is especially relevant to Varve because its stated task coverage
  includes text-guided insertion, promptless object removal, shape-guided
  insertion, and outpainting in one task-conditioned system. The official
  checkpoint card describes a Diffusers/Safetensors distribution of about
  6.06 GB, based on SD 1.5, and currently has no hosted inference provider.
  It is therefore a high-memory lab candidate until its exact checkpoint
  license, native-runtime parity, and measured peak memory are qualified.
  [PowerPaint repository](https://github.com/open-mmlab/PowerPaint),
  [PowerPaint v2 model card](https://huggingface.co/Sanster/PowerPaint_v2)

- BrushNet is a plug-and-play dual-branch approach intended to preserve
  pixel-level masked image features while using a diffusion model. It may
  address the “semantic result but poor boundary” trade-off better than a base
  image-to-image route. The official repository documents SD 1.5/SDXL-related
  work, but requires an external Python/PyTorch/Diffusers stack and separate
  base/BrushNet checkpoints. The repository code is Apache-2.0; the base and
  learned weights require separate provenance and license review. [BrushNet repository](https://github.com/TencentARC/BrushNet),
  [BrushNet license](https://github.com/TencentARC/BrushNet/blob/main/LICENSE),
  [BrushNet paper](https://arxiv.org/abs/2403.06976)

- BrushEdit is a newer related research direction for brush-guided image
  editing, but its official repository is still under review and documents a
  CUDA/PyTorch-oriented setup. It is a research comparison point, not a
  shippable local-first dependency until code, weights, CPU/ARM behaviour, and
  native cancellation are all qualified. [BrushEdit repository](https://github.com/TencentARC/BrushEdit)

- RePaint and CoPaint are useful research references for preserving known
  pixels during diffusion, but their reference implementations are not
  suitable as an immediate native, low-memory product dependency. They should
  be evaluated only if the current qualified runtime cannot provide acceptable
  boundary consistency. [RePaint paper](https://arxiv.org/abs/2201.09865),
  [CoPaint repository](https://github.com/UCSB-NLP-Chang/CoPaint)

- FLUX Fill is a technically interesting inpainting/outpainting option, but
  its model scale is incompatible with Varve's low-memory default and the
  FLUX.1 dev license is non-commercial. It must not be the bundled default.
  [Diffusers FLUX pipelines](https://huggingface.co/docs/diffusers/api/pipelines/flux),
  [FLUX.1 dev license](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev)

- OpenCV's current LaMa ONNX distribution is a useful small-footprint
  promptless baseline: the model card lists an Apache-2.0 92.6 MB artifact.
  It is appropriate for reconstruction/removal qualification, not semantic
  Replace or prompt-conditioned insertion. [OpenCV LaMa model card](https://huggingface.co/opencv/inpainting_lama)

The current stable-diffusion.cpp inpainting diagnostics are an additional
warning: an upstream issue reports broken inpainting models in the relevant
runtime family. This does not prove that every build or model is broken, but it
does prove that Varve must qualify the exact runtime/checkpoint pair and not
infer readiness from successful model loading. [stable-diffusion.cpp inpainting
issue](https://github.com/leejet/stable-diffusion.cpp/issues/1309)

### Mask proposal and automated object selection

Masking and generation should be separate providers with separate evidence.
The user must see and be able to edit the proposed mask before an expensive
operation starts.

- SAM 2 is the strongest general interactive-segmentation candidate for
  point/box prompting and mask refinement. Its interaction maps naturally to
  “click object”, “brush over object”, and “add/subtract”. The official repo is
  Apache-2.0, but the exact model files still need their own provenance record.
  [SAM 2 research](https://ai.meta.com/research/sam2/),
  [SAM 2 repository](https://github.com/facebookresearch/segment-anything-2)

- SAM 3 adds text and exemplar concept prompts, which could support “select all
  cups” or “select the person”. It has a more restrictive, non-transferable
  license and access/distribution conditions in its official repository, so it
  should remain an optional research integration until legal and packaging
  review is complete. [SAM 3 research](https://ai.meta.com/research/sam3/),
  [SAM 3 license](https://github.com/facebookresearch/sam3/blob/main/LICENSE)

- U²-Net is a smaller salient-object detector, with full and tiny variants. It
  is useful for “select the main foreground subject” or background-removal
  suggestions, but salient-object detection is not arbitrary object selection.
  It should never be presented as a general “understand everything” selector.
  [U²-Net repository](https://github.com/xuebinqin/U-2-Net)

- MediaPipe Image Segmenter accepts TFLite models and can return category or
  confidence masks. Its interactive segmenter API maps well to a point-based
  selection affordance and is a plausible low-footprint browser/native
  candidate, provided a model with suitable categories and license is chosen.
  [MediaPipe ImageSegmenter API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/ImageSegmenter),
  [interactive segmenter guide](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter/python)

- BRIA RMBG-2.0 is a foreground/background alpha-matting option, not a general
  object-removal selector. Its model card says commercial self-hosting needs an
  agreement and identifies the weights as CC BY-NC 4.0, so it is not a safe
  bundled default for Varve. [RMBG-2.0 model card](https://huggingface.co/briaai/RMBG-2.0)

The automatic route should therefore be: suggest → show confidence/overlay →
allow add/subtract/paint/feather/grow/shrink → require confirmation → run the
selected repair or generation method. A low-confidence suggestion must fall
back to a brush, not expand its mask silently.

## Device and memory strategy

### Capability classes

The UI should report a measured execution profile, not make a promise based on
the device name. The native app can inspect available memory and backend
features; the browser must use feature detection and a bounded trial because
browser APIs do not reliably expose the same system-memory facts.

| Device profile | Safe default | Explicitly gated | Required behaviour |
| --- | --- | --- | --- |
| Constrained / low available memory, including many entry Chromebooks and ARM laptops | OpenCV/PatchMatch; small segmentation suggestion only when the measured model reservation fits | LaMa and all diffusion profiles unless a measured reservation fits | Downsample preview, process local tiles, keep masks byte-sized, unload model sessions, decode one candidate at a time, reserve one heavy job, and offer a deterministic result immediately. Never allocate a full 33MP model frame merely because the source is large. |
| Standard desktop or Chromebook Plus browser with WebGPU | Browser Fill/Remove reconstruction and optional lightweight segmentation | Prompted diffusion remains unavailable unless a browser model is separately packaged and qualified | Prefer WebGPU for supported ONNX segmentation and WASM for small CPU models. A WebGPU flag is not evidence that a diffusion model will fit or produce acceptable results. |
| Desktop with enough measured RAM/VRAM or unified memory | LaMa and a specifically qualified prompt model | SDXL/PowerPaint/BrushNet only after per-backend qualification | Show model download size, measured peak memory, backend, expected time, and fallback before starting. |
| ARM desktop/mobile-class native build | Deterministic CPU path; quantized ONNX segmentation where qualified | Diffusion until the exact ARM build, instruction set, runtime, and model pass | Build and test native helpers for each supported ARM target. Do not assume x86 GGUF performance, Vulkan driver quality, or GPU memory separation. |

ONNX Runtime's web guidance supports WASM as the broad CPU baseline and WebGPU
for more compute-intensive models; it also notes that WebGL is in maintenance
mode and that only a subset of operators may be available on GPU providers.
[ONNX Runtime Web guidance](https://onnxruntime.ai/docs/tutorials/web/),
[browser provider matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
The WebGPU provider is available in current Chrome/Edge environments including
ChromeOS, but its availability depends on browser version, secure context,
adapter/driver state, and device loss. [WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips)

ChromeOS's built-in AI documentation is a useful warning against overclaiming:
its current foundation-model APIs are limited to supported Chromebook Plus
configurations and list substantial requirements such as 16GB RAM/4 CPU cores
or more, over 4GB VRAM, and substantial profile storage. Those are language
model requirements, not evidence that local image diffusion is available.
[Chrome built-in AI requirements](https://developer.chrome.com/docs/ai/get-started),
[Chromebook Plus AI announcement](https://developer.chrome.com/blog/ai-chromebook-plus)

For native ARM and other heterogeneous machines, ONNX Runtime exposes CPU,
XNNPACK, WebGPU, Android NNAPI, CoreML, and Arm-related providers with
different maturity levels. The provider is an implementation detail that must
be selected and qualified per package; it is not a guarantee of speed or
operator coverage. [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/)
Quantization can reduce memory and may improve ARM performance when the CPU
has suitable dot-product instructions, but the accuracy of each quantized
model must be measured rather than assumed. [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

### Memory rules to implement

1. Model installation is disk-budgeted and resumable. A download must show its
   size, retained versions, free-space requirement, and license before it
   starts. Storage pressure must not turn into a partially “ready” model.

2. Inference admission is byte-budgeted. Reserve weights, runtime workspaces,
   source/context tensors, output tensors, decoded candidate, and preview
   buffers together. A GPU reservation must include unified-memory pressure on
   ARM and integrated graphics systems.

3. Work regionally. Prepare a bounded context around the effective edit region;
   use aspect-preserving padding and overlapping tiles for large expansion.
   Preserve the untouched source from the canonical asset rather than copying
   a full-resolution working buffer for every variation.

4. Use staged degradation: reduce preview resolution first; then use a smaller
   context/tile; then switch from diffusion to LaMa/PatchMatch/OpenCV; finally
   report unsupported if the safe budget still cannot be met. Never silently
   lower quality while recording the original setting as effective.

5. Keep one heavy job by default. Variations are sequential, with cancellation
   between candidates. Candidate thumbnails can be retained while full output
   assets are loaded lazily under the document byte budget.

6. Measure cold start, warm start, peak resident memory, GPU/unified-memory
   usage where available, cancellation time, and editor responsiveness on each
   package. The 4GB constrained run and ARM/Chromebook browser runs are release
   evidence, not optional demos.

## Proposed user-facing modes and controls

The current dialog should be reorganised around intent and capability rather
than around a single “AI” quality switch:

### Quick Cleanup

For a brush, line, or small lasso. No prompt. The default provider is the
smallest qualified deterministic method. The user can choose “sample nearby”,
“repeat texture”, or “preserve edge direction” only when the provider supports
it. Each stroke can be previewed and undone independently before Apply.

### Object Removal

The user clicks, boxes, circles, or paints the object. Varve may propose a
segmentation mask, but the mask is shown before reconstruction. Controls are
Add, Subtract, Intersect, Replace, Invert, Grow, Shrink, Feather, Clear, and
Restore. The default is promptless reconstruction; a separate “semantic
removal” option is available only for a qualified provider.

### Fill / Replace

The user chooses promptless reconstruction or a provider-backed semantic mode.
Prompted mode exposes prompt, negative prompt, model, seed/randomize,
variation count, strength, guidance, steps, and quality only where the selected
provider consumes them. A prompt field must never be present while its value is
silently ignored. Preserve prompt and candidates across mask refinement.

### Expand

The crop/expansion interaction exposes sides, corners, numeric dimensions,
aspect ratio, and output-frame origin. Existing hidden pixels are revealed
first. Only the remaining outside region is generated. The user sees source
versus generated bounds, overlap/feather policy, and a 100% seam preview.

### Shared boundary, context, and review controls

- `Edit boundary`: the exact region allowed to change.
- `Blend halo`: pixels used to make a transition, never silently confused with
  the edit boundary.
- `Clip output`: strict mode that copies every outside pixel unchanged.
- `Context padding`: bounded source context, with aspect-preserving preview.
- `Sampling source`: current image, selected layer, visible/all layers, or a
  custom context where the provider supports it.
- `Mask overlay`: colour plus opacity, hole/disconnected-region visibility,
  confidence overlay for automated suggestions, and before/after/difference.
- `Candidates`: one to four sequential variations, compare at fit and 100%,
  regenerate from the same recipe, delete, duplicate as layer, apply, reject,
  and Restore Original.
- `Device`: local/offline status, model readiness, backend, memory estimate,
  download/setup action, and the exact reason for an unavailable mode.

## Qualification additions

The existing 24-photo/32-task corpus should gain a routing column and at least
these low-resource tasks:

- remove a telephone wire, dust spot, and small person from a repeated-texture
  background using Quick Cleanup;
- click-select a foreground object, refine a hair/leaf boundary, and reject a
  low-confidence mask;
- run the same small removal on a 4GB-constrained configuration and a browser
  WASM path;
- run lightweight segmentation on ChromeOS/WebGPU when available and WASM when
  it is not;
- run the same deterministic operation on an ARM package and record the exact
  backend/model/runtime identity;
- verify that a failed or unavailable semantic provider falls back visibly to
  deterministic cleanup without changing the requested recipe.

For every candidate model/profile, freeze the same masks, prompts, and three
seeds. Score separately:

- task success and prompt adherence;
- boundary overrun and seam visibility;
- preservation of pixels outside the effective mask;
- alpha and colour correctness;
- plausibility at fit and at 100%;
- first-candidate success and all-candidate success;
- peak memory, cold/warm latency, cancellation, and repeated-session safety;
- Apply, undo/redo, reopen, model removal, export, and source-layer deletion.

A model that returns an image but ignores the prompt, changes preserved pixels,
cannot be cancelled, or only works on one unqualified runtime is a failed
profile. “Model loaded” and “test did not throw” are not acceptance evidence.

## Implementation backlog for the completion work

### Now

- Keep the current SD 1.5 Q4 profile unready and update the capability matrix
  whenever a new model/runtime experiment is run.
- Make Quick Cleanup a first-class named mode over the existing PatchMatch,
  LaMa, and future OpenCV providers; keep promptless Remove separate from
  semantic generation.
- Add a segmentation-provider interface returning confidence, source-space
  mask, model provenance, and cancellation. Start with the smallest legally
  distributable interactive model that passes the photo corpus; require user
  confirmation before it enters the generative pipeline.
- Add resource preflight and staged degradation to the per-mode capability
  object. “Unavailable because the safe memory reservation is too high” must be
  a typed, actionable result.
- Add low-memory, ChromeOS/WebGPU/WASM, and ARM lanes to the evidence report;
  do not publish a platform claim without an actual package/browser run.

### Next model lab candidates

1. PowerPaint v2 for one-model task routing across insertion/removal/outpainting.
2. BrushNet/BrushEdit for boundary preservation and prompt adherence.
3. SDXL Inpainting as a higher-memory reference profile.
4. A small, legally distributable interactive segmentation model for mask
   proposals, independent of the generation model.
5. MAT or a stronger LaMa/PatchMatch orchestration for promptless large-hole
   repair if semantic generation remains too resource-heavy.

Each candidate needs pinned weights, license notices, exact runtime/build,
preprocessing contract, mask convention, memory reservation, cancellation
test, and the complete real-photo qualification. No candidate gets a ready
handle from a successful download alone.

### Deliberately not a default

- Base text-to-image or generic image-to-image models used as improvised
  inpainting.
- FLUX.1 dev in a commercial or broadly bundled path.
- SAM 3 or RMBG-2.0 without a separate license/distribution decision.
- Cloud generation, account prompts, or automatic uploads.
- Automatic mask application without a visible, editable confirmation step.

## Sources and research limits

The model facts above are drawn primarily from official model cards, project
repositories, platform documentation, and the cited papers. Complaint evidence
is user-generated and is used to identify failure modes and controls, not to
estimate prevalence. Local Varve observations are labelled as qualification
evidence only when they are retained in the repository's audit artifacts; ad
hoc model experiments are diagnostic and do not count toward release gates.

This landscape does not establish that any candidate is production-ready. It
establishes the routing, licensing, device, and evidence questions that must be
answered before one is enabled.
