# Local inpainting and outpainting model landscape — 2026-09-15

Status: research and implementation decision record. This review was performed
against the linked Hugging Face model cards and upstream repositories on
2026-09-15. It broadens the candidate set without declaring a model qualified.
Varve remains local-first: no model in this document authorizes a silent upload,
hosted fallback, or arbitrary model-supplied code.

## Decision in one page

The model name is not enough to select an implementation. A model is eligible
for a Varve local qualification lane only when it has all of the following:

1. A pinned local artifact revision and checksum, with the applicable weight,
   code, base-model, and adapter licenses recorded separately.
2. An explicit input contract: masked inpainting, outpainting, or reference
   editing. A model that edits an image from a prompt is not automatically an
   inpainting model.
3. A production adapter that consumes the mask, output frame, seed, and
   settings without silently dropping any of them.
4. A safe, pinned runtime that can run in a supervised local process, report
   real progress, and terminate on cancellation. A successful Python demo is
   not native-runtime qualification.
5. Measured peak memory and latency on every supported OS, backend, and CPU
   architecture. File size and parameter count are not memory requirements.
6. The frozen real-photograph corpus and review gate passing for Fill, Remove,
   Replace, and Expand where the candidate claims those modes.

The current shipped promptless PatchMatch and LaMa routes remain the correct
low-memory defaults. The existing SD 1.5 Q4 artifact remains disabled after
the real-photograph and runtime-integrity failures documented in the [runtime
qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).
No prompt-conditioned model is currently qualified.

The first local research lane should be **PowerPaint v2-1**, because its
published task coverage directly includes object insertion, object removal,
shape-guided insertion, and outpainting. The second high-quality comparison
lane should be **FLUX.1-Fill-dev**, because it is an explicit inpainting and
outpainting model rather than a general image editor. Both require a separate
qualification adapter; neither can be enabled by changing the current SD
profile string. FIBO-Edit is a useful third comparison for structured masked
edits, subject to its non-commercial weight license. None is suitable as the
default for a 4 GB Chromebook or ARM browser session without measured,
target-specific evidence. The current desktop build also rejects arbitrary
model imports: a model-specific adapter must identify and validate every
component and mask/frame contract before a candidate can enter the app.

The review also records **FLUX.2 Klein 4B** as a reference-edit candidate,
not as another inpainting choice. Its official card demonstrates
image-to-image editing with a source image and prompt, while the official
runtime overview lists single- and multi-reference editing rather than an
explicit editable-mask input. The registry therefore gives it no Fill,
Remove, Replace, or Expand mode. This distinction is deliberate: a model can
produce a convincing whole-image edit while still being unsafe for a
protected-pixel workflow.

The local SD 2 diagnostic is represented as its own research profile. The
official card documents a 512 × 512 inpainting model with the OpenRAIL++-M
license; its complete F16 artifact is much larger than the current SD 1.5 Q4
candidate. A retained Linux CPU run produced a recognizable balloon-like
insertion but missed the requested bright-red object, so this is useful
runtime evidence—not a quality promotion. The SD 1.5 helper now rejects the SD
2 profile at its private protocol boundary instead of allowing an arbitrary
checkpoint to inherit the wrong adapter.

## Important naming correction: FLUX.1.1 versus FLUX Fill

“FLUX dev 1.1” combines two different products:

- **FLUX.1-Fill-dev** is the open-weight, 12B masked fill model. Its Hugging
  Face card documents `FluxFillPipeline`, an image plus mask input, and both
  fill and outpaint usage. The card also records a gated
  `flux-1-dev-non-commercial-license`, prompt-following limitations, possible
  colour shifts outside the filled area, and lines at complex-texture edges.
  [FLUX.1-Fill-dev model card](https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev)
- **FLUX.1.1 [pro]** is a hosted Black Forest Labs API endpoint, not a local
  Hugging Face checkpoint that Varve can package. It is outside the confirmed
  local-only scope. [BFL endpoint reference](https://github.com/black-forest-labs/skills/blob/master/skills/bfl-api/references/endpoints.md)

The product must never label the hosted API as a local model or use it as a
fallback when a local provider fails.

### Quantized FLUX Fill files are not drop-in local profiles

The Hugging Face search also found several quantized `FLUX.1-Fill-dev` uploads.
They reduce storage size, but they do not remove the adapter and runtime
qualification work:

- [GPUStack FLUX.1-Fill-dev GGUF](https://huggingface.co/gpustack/FLUX.1-Fill-dev-GGUF)
  describes its support as experimental and tied to `llama-box` v0.0.98 or
  newer, using a patched `stable-diffusion.cpp` revision. That is not the
  vendored `diffusion-rs` runtime in Varve.
- [GaiaNet FLUX.1-Fill-dev GGUF](https://huggingface.co/gaianet/FLUX.1-Fill-dev-GGUF)
  lists Q2_K and Q4_0 files in the multi-gigabyte range and identifies a
  particular `stable-diffusion.cpp` conversion revision. The file size is not
  evidence that the tensors or runtime are compatible with Varve.
- [Second State FLUX.1-Fill-dev GGUF](https://huggingface.co/second-state/FLUX.1-Fill-dev-GGUF)
  notes that the text encoders and VAE are not supplied with the quantized
  file. Those components must be version-pinned and managed as part of one
  profile; accepting the single GGUF would create an incomplete provider.

These artifacts therefore remain research inputs, not downloadable or
importable app profiles. A future FLUX adapter must supervise the exact
runtime, resolve every required component from opaque managed handles, verify
the white-edit/black-preserve mask contract, and pass the same real-photo,
memory, cancellation, and platform gates as every other provider. A smaller
file alone is not a low-memory qualification.

## Candidate matrix

“Research-only” means a candidate may be downloaded into a disposable,
explicitly approved qualification environment. It is not exposed in the app,
bundled, or used as marketing evidence.

| Candidate | Actual input contract and likely modes | Local usage requirements and risks | Varve decision |
| --- | --- | --- | --- |
| Current `sd15-inpainting-q4_0-v1` | Masked inpainting; intended for Fill/Remove/Replace/Expand | Pinned GGUF is documented as experimental for a patched runtime. The current `diffusion-rs` helper is not that runtime; real-photo output also failed semantic review. | Disabled and diagnostic only |
| `stabilityai/stable-diffusion-2-inpainting` | Explicit 512px masked text-guided inpainting; a possible Fill/Remove/Replace/Expand candidate | The F16 artifact is about 5.21 GB, uses the OpenRAIL++-M terms, and needs a separate SD 2 adapter/component contract. The retained local CPU run was recognizable but missed the requested object/color and did not pass the real-photo rubric. The SD 1.5 helper rejects this profile rather than guessing its tensor contract. [Model card](https://huggingface.co/stabilityai/stable-diffusion-2-inpainting) · [diagnostic](../audits/generative-editing-native-probe-2026-09-14.md) | Research-only diagnostic; no product route |
| `JunhaoZhuang/PowerPaint-v2-1` | Explicit task-conditioned inpainting; object insertion, removal, shape-guided insertion, and outpainting are listed by the project | Hugging Face documents Diffusers/Safetensors, Python 3.9/Conda setup, and no Inference Provider. It needs a separate pinned Python/PyTorch adapter or a proven native port. The model card reports Apache-2.0; the repository code has its own notice, so both must be retained. [Model card](https://huggingface.co/JunhaoZhuang/PowerPaint-v2-1) · [repository](https://github.com/zhuang2002/PowerPaint) | **First local qualification candidate; research-only** |
| `black-forest-labs/FLUX.1-Fill-dev` | Explicit masked Fill and Outpaint; suitable for prompt-conditioned Fill, Replace, and border generation when the mask and output frame are supplied correctly | 12B BF16 Diffusers workflow, gated non-commercial license, large model/runtime, and no proof of compatibility with Varve’s Rust helper. The official reference implementation and Diffusers pipeline must be treated as a new supervised adapter, not as an SD checkpoint. [Model card](https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev) · [Fill implementation](https://github.com/black-forest-labs/flux/blob/main/docs/fill.md) | **Second local qualification candidate; high-memory research-only** |
| `briaai/Fibo-Edit-1.5-turbo` | Native mask-based editing, structured VGL/JSON controls, and up to four references; useful for precise Replace and reference-guided edits | 8B, four-step distilled pipeline, non-commercial source/weight terms, and a separate prompt-to-JSON example that uses `trust_remote_code` and a Gemini API key. Varve must not use that remote prompt converter or arbitrary remote code; a local hand-authored/validated structured request is required. [Model card](https://huggingface.co/briaai/Fibo-Edit-1.5-turbo) | **Third comparison candidate; research-only pending licensing and safe-runtime review** |
| `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | Masked inpainting; a higher-resolution Fill/Remove/Replace baseline and possible outpaint adapter | Diffusers/PyTorch workflow at a substantially larger working frame. Varve’s 2026-09-15 SDXL probe exhausted the available memory budget before producing a semantically acceptable result. It remains a diagnostic comparison, not a product fallback. [Model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) · [probe](../audits/generative-editing-sdxl-probe-2026-09-15.md) | Disabled until a smaller, compatible runtime and new evidence exist |
| `black-forest-labs/FLUX.2-klein-4B` | Reference/image editing, not an explicitly documented mask-conditioned inpainting pipeline | Apache-2.0 4B model. The Hugging Face card reports about 13 GB VRAM, while the official runtime overview reports about 8 GB for Klein 4B; the transformer file alone is about 7.75 GB and the complete graph also needs Qwen3, the FLUX.2 autoencoder, tokenizer, and scheduler. It may be useful for a future reference-edit command, but routing it through Fill or Expand would discard the mask contract and risk changing protected pixels. [Model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) · [official runtime](https://github.com/black-forest-labs/flux2) | Future reference-edit research; not a Fill provider |
| `Qwen/Qwen-Image-Edit-2509` | Semantic and multi-image reference editing; the official quick start does not establish Varve’s explicit masked inpainting contract | 20B model, Apache-2.0 card, 40-step example, and high memory/runtime cost. ControlNet depth/edge/keypoint support is not equivalent to a source edit mask. [Model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2509) | Future reference/control-edit research; not a Fill provider |
| BrushNet | Adapter/dual-branch masked editing technique, not a complete standalone product model | Requires a compatible base diffusion model, BrushNet weights, and a Python/PyTorch/Diffusers stack. Base, adapter, code, and runtime provenance must be qualified separately. [Repository](https://github.com/TencentARC/BrushNet) · [paper](https://arxiv.org/abs/2403.06976) | Boundary-quality research only |
| `alimama-creative/FLUX.1-dev-Controlnet-Inpainting-Alpha` | Inpainting ControlNet adapter for FLUX.1-dev | The card describes a 768-trained alpha checkpoint and the FLUX.1 dev non-commercial license. It is not a complete standalone provider and its alpha status is not release evidence. [Model card](https://huggingface.co/alimama-creative/FLUX.1-dev-Controlnet-Inpainting-Alpha) | Do not select for the first qualification lane |
| `black-forest-labs/FLUX.1-Kontext-dev` | General reference/image editing, with no explicit mask input in the official example | 12B, gated non-commercial model. It may support a future instruction-edit tool, but using it as masked Fill would require an independently proven protection/compositing contract. [Model card](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev) | Reference-edit research; not a Fill provider |
| FLUX.1.1 [pro] | Hosted Fill/API service | Requires network, account/provider policy, upload consent, and remote data handling. | Out of scope |

PowerPaint is the best first experiment for complete four-mode coverage, but
“best first experiment” is not “qualified.” FLUX Fill is the cleaner direct
comparison for mask correctness and outpainting. FIBO is attractive for
structured controls but is not a commercially clear default. The reference
editors remain separate so the UI cannot imply that an image-to-image model
honours a hard protection mask.

## Local runtime and packaging requirements

### Qualification environment

Each candidate gets an isolated, versioned environment outside the renderer:

- PowerPaint: the upstream card calls for Python 3.9/Conda, Diffusers,
  Transformers, and Accelerate. Capture the exact lockfile, model revision,
  base components, and adapter revision. The upstream Gradio demo is a
  reference, not the production process boundary.
- FLUX Fill: the upstream card documents PyTorch plus Diffusers and a BF16
  pipeline. Access to the gated repository must be explicit during model
  installation, and the accepted license/terms must be recorded locally. The
  production adapter must pass image, mask, frame, seed, and settings through
  without relying on a URL at generation time.
- FIBO: use the pinned Diffusers pipeline and a local, validated structured
  request. Do not include the optional Gemini prompt-to-JSON service or
  `trust_remote_code` in the Varve runtime. A natural-language prompt can be
  converted by a reviewed local parser, or the structured controls can remain
  unavailable until that parser exists.
- SDXL and any BrushNet combination: retain base-model, adapter, VAE, text
  encoder, scheduler, and runtime versions as one qualification identity.
- FLUX.2 Klein 4B: retain the transformer, Qwen3 text encoder, FLUX.2
  autoencoder, tokenizer, scheduler, official runtime commit, and the
  measured GPU/system-memory envelope as one reference-edit identity. It must
  not be installed through the masked inpainting model manager until a
  separate reference-edit command exists.

The helper protocol must use opaque model and asset handles, not arbitrary
filesystem paths or model binaries in JSON. It must run in a separate
supervised process, use an allowlisted executable/runtime build, emit
request-scoped progress and provenance, and stop on cancellation. A failed
model load, missing component, unsupported backend, allocation refusal, or
non-zero exit is a failed qualification result, not a disabled button that
counts as success.

No candidate is downloaded or executed as part of ordinary routing. Downloads
must stream to a partial file, verify the pinned hash, check disk space, and
install atomically. Generation must work with the installed artifact while
offline. Model absence affects regeneration only; it must not break rendering
of an already accepted result.

### Device policy

At the time of this review, the development host had 22 GiB physical memory,
about 3.6 GiB available, and heavily used swap. That is not a safe environment
for an exploratory FLUX, Qwen, FIBO, or SDXL download/run. No large model was
started merely to create a green-looking probe. Qualification should run on a
controlled machine with enough free memory and capture peak usage.

| Device situation | Local behaviour | Prompt-model policy |
| --- | --- | --- |
| 4 GB RAM, entry Chromebook, or low-memory ARM browser | PatchMatch/OpenCV-style repair; bounded source region; explicit manual mask; unload optional small segmentation sessions | No diffusion. LaMa or segmentation is allowed only after a measured safe-peak check for the exact browser/runtime/model; otherwise use Fast cleanup |
| 8–16 GB RAM without a discrete GPU | Promptless local repair and bounded LaMa where measured; one heavy session only | PowerPaint/FIBO/SDXL/FLUX remain gated; FLUX.2 Klein 4B additionally needs a measured GPU budget and is not a mask provider. Do not infer support from model file size |
| High-memory desktop with a supported GPU or unified-memory budget | Candidate-specific supervised sidecar, one job at a time, sequential variations, bounded tiles | PowerPaint first, FLUX Fill second, FIBO third; each OS/backend/architecture needs its own evidence |
| ARM desktop or Apple Silicon | Native deterministic path plus separately built/tested helper | No x86 assumption. Require ARM runtime, instruction-set, backend, memory, cancellation, and real-photo qualification before exposure |

Browser WebGPU support is not a diffusion qualification. Browser provider
selection must remain feature-detected and memory-budgeted; WebGPU operator
coverage varies, while WASM remains the broad CPU fallback. [ONNX Runtime Web
guidance](https://onnxruntime.ai/docs/tutorials/web/) supports this separation.

## Mask, surface-area, and aspect-ratio rules

The model review confirms that incorrect mask semantics can look like bad model
quality. The canonical pipeline therefore has three distinct masks:

1. **Editable mask:** the user’s source-resolution mask, with 0 meaning
   preserve and 255 meaning edit. It comes from paint, selection, alpha, layer
   mask, background-removal preview, or a confirmed object-selection candidate.
2. **Provider mask:** the encoded mask required by the selected model. The
   frame contract now declares `inputKind` and `maskConvention`; the shared
   frame preparation rejects reference-only editors and converts polarity
   explicitly. Letterbox padding is initialized to preserve coverage.
3. **Composite mask:** the exact region allowed to change in the document.
   Generated context may be larger for seam handling, but pixels outside this
   effective mask are copied from the canonical source representation.

This prevents three common errors: feeding a reference editor as if it were an
inpainting model, inverting white/black semantics, and allowing a model’s
context halo to overwrite neighbouring objects. The implementation is in
[`diffusionFrame.ts`](../../packages/engine/src/generativeEdit/diffusionFrame.ts)
and is covered by the opposite-polarity and reference-editor rejection tests.

Before generation, the workflow must show the proposed selection and report
coverage, bounds, disconnected regions, edge contact, and soft coverage. A
selection model only proposes; the user confirms and can add, subtract,
intersect, grow, shrink, feather, invert, or paint. For object removal, the
effective mask should cover the full object and a deliberately reviewable edge
margin, not an arbitrary full bounding box. For Replace, the user can grow the
mask when the old object touches its boundary. For Fill, a smaller mask should
be preferred when only a blemish is being reconstructed. For Expand, the
border mask is derived from the requested output frame and the retained source
rectangle; it must include corners and must not rescale the retained content.

All model-facing image preparation is aspect-preserving. The bounded context
is first fitted toward the model ratio when source pixels permit it, then
letterboxed if an image edge prevents a containing fit. Image and mask use the
same integer content rectangle, and restoration returns to the exact context
geometry. The model never receives a stretched photograph, and the document
never receives letterbox padding.

The official [Diffusers outpainting guide](https://huggingface.co/docs/diffusers/advanced_inference/outpaint)
also models outpainting as an inpainting frame with preserved source pixels and
a generated border. Varve therefore treats outpaint as geometry plus mask
planning, not as a crop-resize shortcut.

## Qualification plan for the selected local candidates

The existing 24-photo/32-task corpus, frozen masks, three seeds, and evidence
gate remain the acceptance baseline. Run the following for each candidate in a
disposable native qualification environment:

1. Verify offline artifact hashes, licenses, component graph, runtime build,
   and backend before loading a photograph.
2. Run empty, one-pixel, holey, disconnected, soft, inverted, edge-touching,
   and out-of-bounds masks through the adapter. Assert the provider receives
   the declared polarity and frame dimensions.
3. Run real photographs for small cleanup, recognisable object removal,
   semantic replacement, and each expansion side/corner. Preserve source,
   prepared context, provider mask, raw output, composite, difference map,
   boundary crop, timing, peak memory, seed, and effective settings.
4. Change only the prompt and verify the requested content changes, rather
   than accepting byte differences as prompt adherence. Compare all three
   fixed seeds and report first-candidate and any-candidate success.
5. Exercise cancellation during model load, preprocessing, sampling, decode,
   and composition. The helper must acknowledge promptly, terminate within
   the product’s two-second bound when unresponsive, and never apply a late
   result.
6. Apply, undo, redo, save, reopen, copy/paste, export, delete the source
   model, and then render the accepted result. The accepted pixels and source
   placement must remain intact; only regeneration may be unavailable.
7. Repeat on Linux CPU, Linux Vulkan, Windows CPU/Vulkan, macOS CPU/Metal,
   and supported ARM targets. A missing platform lane remains an explicit gap.

A candidate qualifies only if it meets the existing 90% task threshold,
passes every required category, scores at least 3/4 on applicable adherence,
seams, preservation, and plausibility, and has no geometry, persistence,
source-corruption, or cancellation failure. Until then its status remains
`research-only` or `disabled-unqualified` and the UI must keep the mode
unavailable with a reason that identifies the missing requirement.

## Implementation consequences

The model review results in these changes to the current work:

- The frame contract now records input kind and mask convention and performs
  explicit polarity conversion. This prevents a future FLUX/PowerPaint/FIBO
  adapter from silently reusing the SD mask assumption.
- The current native profile remains the only executable prompt profile. No
  candidate catalog is presented as a capability list until it is consumed by
  a real adapter and qualification record.
- PowerPaint and FLUX Fill are planned as separate, supervised local adapters;
  they are not interchangeable with the current `diffusion-rs` SD helper.
- Qwen Image Edit, FLUX.2 Klein, and Kontext are kept out of Fill/Expand
  routing because their documented reference-edit contracts do not establish
  hard mask preservation. FLUX.2 Klein 4B is registered explicitly as a
  reference-only research profile with a conservative 13 GiB VRAM floor until
  the conflicting upstream estimates are measured in Varve's complete graph.
- Promptless cleanup stays first-class for Chromebooks, ARM devices, and low
  memory sessions. Automatic object selection remains a reviewed mask step,
  not a hidden semantic guarantee.
- Marketing and user documentation must describe only the verified local
  routes and link to this research status; no new model is advertised as
  available by virtue of appearing on Hugging Face.

## Sources

- [FLUX.1-Fill-dev model card](https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev)
- [FLUX Fill reference implementation](https://github.com/black-forest-labs/flux/blob/main/docs/fill.md)
- [FLUX pipeline documentation](https://github.com/huggingface/diffusers/blob/main/docs/source/en/api/pipelines/flux.md)
- [BFL API endpoint reference](https://github.com/black-forest-labs/skills/blob/master/skills/bfl-api/references/endpoints.md)
- [PowerPaint v2-1 model card](https://huggingface.co/JunhaoZhuang/PowerPaint-v2-1)
- [PowerPaint repository](https://github.com/zhuang2002/PowerPaint)
- [FIBO-Edit 1.5 Turbo model card](https://huggingface.co/briaai/Fibo-Edit-1.5-turbo)
- [FLUX.2 Klein 4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [FLUX.2 official runtime repository](https://github.com/black-forest-labs/flux2)
- [Qwen Image Edit 2509 model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2509)
- [SDXL Inpainting model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1)
- [BrushNet repository](https://github.com/TencentARC/BrushNet)
- [BrushNet paper](https://arxiv.org/abs/2403.06976)
- [FLUX.1-Kontext-dev model card](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev)
- [FLUX.1-dev ControlNet Inpainting Alpha model card](https://huggingface.co/alimama-creative/FLUX.1-dev-Controlnet-Inpainting-Alpha)
- [Diffusers outpainting guide](https://huggingface.co/docs/diffusers/advanced_inference/outpaint)
- [ONNX Runtime Web execution guidance](https://onnxruntime.ai/docs/tutorials/web/)
