# Generative editing selection and model audit

Status: active engineering audit, 2026-09-14. This is a release-gate record,
not a claim that the unqualified semantic diffusion path is production-ready.

## Executive conclusion

Selection accuracy is a prerequisite to a useful generative edit. A plausible
model output is still a failure when the mask contains the wrong object, omits
the intended boundary, or is mapped to the wrong source pixels. Varve therefore
needs two separate decisions before generation:

1. Is this the object/region the user intended?
2. Is the mask geometrically valid for the selected operation and provider?

The current model roles are conceptually correct but the workflow was not yet
complete. Automatic foreground proposals (U²-Net, IS-Net, and BiRefNet) are
saliency/foreground suggestions, not arbitrary object recognition. SAM-style
models are prompted segmenters: points and boxes tell the model what to
segment, but the model does not infer the user's textual intent. PatchMatch
and LaMa reconstruct pixels; they cannot satisfy a semantic Replace prompt.
Diffusion inpainting/outpainting is the only family in the current plan that
can perform semantic insertion, but the local SD 1.5 candidate and the tested
runtime pair have not passed the quality gate.

The important repairs in this slice are source-identity invalidation for
automatic subject proposals, an exact source-locator check before importing an
Object Selection candidate, a visible mask-health report, geometry rejection
for masks with a mismatched aspect ratio, square-frame padding removal during
SAM2 decode, explicit prompt-containment gating, and a PatchMatch known-region
fix. These prevent several wrong-target and wrong-region failures, but they do
not turn an automatic foreground estimate into a semantic selector. The user
must still review the overlay and candidate before applying it.

## Evidence reviewed on real photographs

| Evidence | Observation | Decision |
| --- | --- | --- |
| `tests/e2e/fixtures/real-life-still-life.jpg` and the licensed photograph subject-selection run | The reviewed bouquet proposal followed petals, leaves, and the apple rather than returning a rectangular synthetic region. | One successful real-photo foreground proposal; not sufficient for portraits, hair, architecture, transparency, or arbitrary objects. |
| `tests/e2e/fixtures/real-life-port-campbell-coast.jpg` with the native helper and a balloon prompt | The SD 2 F16 candidate completed but produced a multicolour balloon-like insertion rather than the requested bright-red photorealistic balloon. | Reject as semantic-quality evidence. |
| The same coast photograph with the SD 1.5 Q4 candidate | The candidate was a cyan/white block-like artifact and did not depict the requested object. | Reject the checkpoint/runtime pair; do not mark the model ready. |
| Existing real-photo CAF screenshots and qualification records | Some earlier results looked like visible blocks, striping, or unrelated scene content. | Treat successful bytes and non-empty previews as insufficient acceptance criteria. |
| `tests/e2e/canvas/object-selection-real-model.spec.ts` on the portrait photograph after the decoder and prompt-gate repairs | Cold preview completed in 23 s, warm preview in 1 s, with three eligible candidates, predicted IoU 0.90, and prompt match 100%. The inspected preview, applied mask, and Use as Selection result followed the prompted person, including hair and crossed arms. | Strong evidence for this source/point workflow and the corrected geometry; not broad SAM2 quality qualification. |
| Follow-up run of the same spec with an off-centre torso point | Cold preview completed in 23 s, warm preview in 1 s, with three eligible candidates, predicted IoU 0.91, and prompt match 100%. The inspected mask followed the complete person rather than only the head; a head click remains correctly able to select the head region. | Confirms point location changes the selected region and that a whole-person target should use a torso point, box, or refinement prompts; not broad SAM2 quality qualification. |

The native results are retained under
`tests/e2e/fixtures/generative-evidence/diagnostic-2026-09-14-native-helper/`.
They are diagnostic evidence only; no failed candidate is used in marketing or
as a product-quality baseline.

The prompt gate is independent of predicted IoU: candidates that miss an
include point, cover an exclude point, or miss the supplied box are not exposed
for cycling. Applying a session candidate with missing or failed prompt
containment is rejected as stale review data. The real-photo run above showed
the positive path; the unit suite also covers rejection of a reviewed
candidate whose prompt-containment score is zero.

The Generative Edit handoff now requires an explicit review confirmation for
every imported Object Selection candidate, not only candidates whose topology
diagnostics are ambiguous. The confirmation is keyed to the source fingerprint,
current image mapping, model, candidate-set identity, and candidate index, so
cycling candidates, changing the source/placement, or changing the selected
node invalidates it. The direct Inspector/keyboard Apply path uses the same
identity, and a ready session cannot fall through to a new inference when the
review is absent or incomplete. Painting, clearing, or inverting the mask also
leaves the model-candidate trust state and returns control to the editable mask
workflow. This is the product safety boundary for the remaining semantic
uncertainty: a prompt-valid mask can still describe the wrong connected object,
and successful inference cannot prove user intent.

The real-photo CAF removal lane also exposed a client-side selection failure:
the first fast drag produced only a 92 × 92 endpoint region at the right side
of the landscape instead of the intended horizontal stroke. After continuous
segment rasterization, the same pointer interaction produced a 748 × 92 frame,
18,766 nontransparent overlay pixels, 8,682 changed pixels, and 19 colour
buckets, and passed the substantive-output gate. This is interaction evidence,
not a claim that PatchMatch can remove arbitrary semantic objects.

## Selection-to-generation contract

| Stage | Required invariant | Failure allowed |
| --- | --- | --- |
| Target capture | Capture document id, node id, resolved image source locator, decoded source dimensions/fingerprint, and image-placement fingerprint before asynchronous work. | A stale proposal is discarded; it is never applied to the newly replaced image occupying the same node id. |
| User intent | Painted regions, pixel selections, alpha, layer masks, foreground proposals, and prompted Object Selection remain identifiable sources. A foreground estimate is labelled as an estimate. | The user can choose a different candidate, add/subtract/paint, refine, or cancel. |
| Coordinate mapping | Convert document/camera selections into source-image pixel coordinates through the canonical placement transform. Preserve mask width, height, and origin. | Reject invalid dimensions or a mismatched source aspect ratio; never stretch an unrelated mask into the target. |
| Mask representations | Keep the editable user mask, provider inference mask, and final compositing mask distinct. Preserve soft coverage and holes. | A malformed or empty mask blocks Fill/Remove/Replace before inference. |
| Prompt adherence | Score decoded candidates against the normalized include/exclude points and box independently of model IoU. | A candidate that misses an include point, covers an exclude point, or has no box overlap is not eligible for application. |
| Health review | Show percentage, pixel bounds, connected-region count, edge contact, and warnings for broad or soft-only masks. | Warnings require review; empty/tiny masks are blocked. Multiple regions are allowed but explicitly called out. |
| Context preparation | Use an aspect-preserving crop with padding around the effective edit region. The provider receives white=edit and black=preserve only when its contract says so. | A provider with a different polarity or geometry contract is unavailable until adapted and tested. |
| Provider routing | Promptless repair goes to PatchMatch/LaMa; semantic prompts go only to a mask-conditioned provider that actually consumes the prompt. | No silent prompt discard and no base text-to-image or texture fallback for Replace. |
| Acceptance | Composite only inside the effective mask, preserve all outside pixels, retain source and per-candidate provenance, and apply in one undoable transaction. | A stale, cancelled, unreviewed, or geometrically invalid candidate cannot mutate the document. |

This contract distinguishes “the model selected an object” from “the user
selected the object”. A score such as predicted IoU or segmentation stability
is evidence about a mask, not a probability that it matches the user's intent.

## Why the wrong item can be selected

| Failure source | What it looks like | Required handling |
| --- | --- | --- |
| Foreground-vs-object mismatch | Select subject chooses the largest/most salient foreground region, while the user intended one cup, person, or sign. | Keep the command labelled “foreground estimate”; offer Object Selection, Magic Wand, lasso, and brush refinement. |
| Ambiguous point or box | A point lies on a boundary, or a box contains multiple similar objects. | Use positive and negative prompts, retain multimask candidates, show the overlay at fit and 1:1, and require candidate review. SAM's official predictor treats point labels and boxes as prompts rather than semantic labels. |
| Mask too tight | Hair, fur, shadows, anti-aliased edges, or object contact remain in the source and bleed into the result. | Grow/feather controls and boundary-crop review; keep provider mask expansion separate from final composite coverage. |
| Mask too broad | Adjacent people, furniture, text, or reflections are included and changed. | Coverage/bounds/component warnings; add/subtract brush and explicit effective-mask preview before generation. |
| Disconnected regions | A detector selects several unrelated objects or a hole in an object. | Preserve disconnected components and holes, show their count, and let the user remove individual components rather than silently unioning them. |
| Coordinate mismatch | A selection from a transformed/cropped image is shifted, stretched, or placed over a different source revision. | Source-pixel rasterization through canonical placement, source locator/fingerprint checks, and aspect/dimension validation. |
| Sparse brush events | A fast drag delivers only its endpoint, so the apparent stroke becomes a small, misplaced edit region. | Rasterize continuous segments between pointer events and test the resulting output frame on a real photograph. |
| Prompt/model disagreement | A model can report a high predicted-IoU score for a mask that misses an include point or covers an explicit exclude point. | Independently score prompt containment after decoding; reject candidates that fail explicit points or box overlap and show prompt match separately from IoU. |
| Provider limitation | A reconstruction model is asked to create a named object, or a diffusion model receives a bad polarity/too little context. | Route by actual capability, verify white/black polarity, pad the crop, and keep unqualified modes disabled. |

## Model role and suitability matrix

| Family | Correct role | Low-memory suitability | Current Varve status |
| --- | --- | --- | --- |
| OpenCV Telea/Navier–Stokes | Small scratches, dust, wires, and local defects | Good CPU fallback | Candidate for deterministic repair; not semantic removal. [OpenCV documentation](https://docs.opencv.org/3.4.7/d7/d8b/group__photo__inpaint.html) |
| PatchMatch | Repeated texture and nearby exemplars | Good when the bounded context is small | Implemented promptless path; known-region and propagation repair is in this slice; real-photo quality still needs broader review. |
| LaMa | Larger irregular promptless holes and periodic structures | Possible on desktop and some ARM devices after measured reservation | Existing local path; not semantic insertion. [LaMa repository](https://github.com/advimman/lama) |
| U²-Net / IS-Net / BiRefNet | Foreground/background or salient-subject proposals | U²-Net is the lightest; larger models are explicitly memory-gated | Model-backed subject estimates; never presented as arbitrary object recognition. |
| SAM 2 / MobileSAM | Prompted point/box segmentation and candidate refinement | MobileSAM is the low-footprint candidate; exact browser/native artifacts still need platform qualification | Object Selection path; source and candidate freshness are guarded. [SAM 2 research](https://ai.meta.com/research/sam2/), [MobileSAM repository](https://github.com/ChaoningZhang/MobileSAM) |
| MediaPipe Interactive Segmenter | Lightweight interactive point/ROI segmentation with TFLite | Plausible browser/ARM option if a suitable model is licensed and qualified | Research option; do not substitute it without a task corpus. [InteractiveSegmenter API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/InteractiveSegmenter) |
| SD 1.5 Inpainting | Mask-conditioned semantic Fill/Replace | Not a 4GB/Chromebook default | Candidate checkpoint/runtime failed the real-photo semantic probe; unavailable. [Model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting) |
| SDXL Inpainting | Higher-quality semantic inpaint/outpaint candidate | Higher memory; not a constrained-device default | Not packaged or certified. Its card documents 1024px operation and quality limitations at full denoising strength. [Model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) |
| PowerPaint / BrushNet | Task-conditioned insertion/removal/outpainting or boundary-preserving diffusion research | High-memory lab candidates until native parity and license review | Research candidates; no product fallback. [PowerPaint](https://github.com/open-mmlab/PowerPaint), [BrushNet](https://github.com/TencentARC/BrushNet) |

## Research ledger

Accessed 2026-09-14. Sources are primary documentation, official repositories,
model cards, or upstream issue records. “Publication date” is listed when the
source provides one; otherwise it is current/undated documentation reviewed on
the access date.

| Source / publisher | Publication date | Finding relevant to Varve | Engineering consequence |
| --- | --- | --- | --- |
| [Diffusers inpainting guide](https://huggingface.co/docs/diffusers/main/using-diffusers/inpaint), Hugging Face | Current documentation | `padding_mask_crop` crops the masked area plus padding, processes that crop, then places the result back over the original geometry. | Context padding is part of the quality contract, not an optional stretch-to-square shortcut. |
| [SD 1.5 inpainting card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting), Stable Diffusion v1-5 | Current model card | The inpainting checkpoint has five additional input channels; white means inpaint and black means preserve. It warns about photorealism, legible text, faces, and composition. | Validate polarity and checkpoint type; gate text/face claims and review real photographs. |
| [SDXL inpainting card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1), Diffusers | Current model card | SDXL inpainting is trained around 1024px workflows and quality can degrade at strength 1/full masking. | Do not call a full-mask synthetic probe a quality certificate; retain context and bound strength. |
| [SAM predictor](https://github.com/facebookresearch/segment-anything/blob/main/segment_anything/predictor.py), Meta Research | Current repository | Point labels are foreground/background prompts, boxes are XYXY prompts, and multimask outputs/quality scores address ambiguity. | Preserve candidates and prompts; an IoU-like score is not intent recognition. |
| [SAM 2 overview](https://ai.meta.com/research/sam2/), Meta | 2024 research release page | Image segmentation accepts click/box/mask prompts and additional prompts refine the result. | Use interactive prompts and refinement; do not treat SAM as a text detector. |
| [MobileSAM](https://github.com/ChaoningZhang/MobileSAM), Chaoning Zhang et al. | Current repository | A TinyViT encoder keeps the prompt-guided decoder interface while reducing footprint; the repository reports CPU-oriented demos and ONNX export. | Evaluate as a low-memory prompted selector, but measure real device latency and accuracy before routing automatically. |
| [PowerPaint](https://github.com/open-mmlab/PowerPaint), OpenMMLab | Current repository | The project explicitly covers text-guided insertion, object removal, shape-guided insertion, and outpainting, including promptless removal/outpainting guidance. | It is a useful comparison candidate for task routing, not a reason to enable unqualified diffusion. |
| [LaMa](https://github.com/advimman/lama), Advimman | Current repository | The method is designed for large masks and periodic structures, but it is image-conditioned rather than semantic. | Use for promptless reconstruction, not Replace. |
| [stable-diffusion.cpp issue 1309](https://github.com/leejet/stable-diffusion.cpp/issues/1309), upstream runtime | 2026-03-02 | An upstream report describes broken results with special inpainting checkpoints in the runtime family. It does not prove every build is broken. | Exact runtime/checkpoint qualification is mandatory; successful loading is not readiness. |
| [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/), ONNX Runtime | Current documentation | WASM is the broad CPU baseline; WebGPU can accelerate suitable workloads but operator support and device availability vary. | Feature-detect providers, keep a safe CPU path, and gate memory/latency per device. |
| [ONNX Runtime large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html), ONNX Runtime | Current documentation | Browser buffers, protobuf, and WASM address limits constrain large models; Cache API/OPFS are relevant for local artifacts. | Do not move desktop diffusion weights into the browser by default; stream/cache bounded models and report limits. |
| [WebGPU device loss](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost), MDN | Current documentation | A GPU device can be lost at any time and resources must be recreated. | Treat device loss as a typed recoverable failure; never leave a stale preview or late mutation. |

## Acceptance gates still open

- The selection corpus needs more licensed photographs covering hair, people,
  products, reflective/transparent objects, architecture, text, repeated
  texture, low light, and multiple disconnected subjects. One bouquet pass is
  evidence, not broad qualification.
- Prompted Object Selection needs real-photo point/box cases with positive and
  negative prompts, candidate comparison, mask edge review, and source-change
  invalidation on each supported runtime.
- Prompted Fill, Replace, and Expand remain unavailable until an exact model,
  helper, backend, preprocessing, polarity, cancellation, memory, and
  real-photo quality profile passes the existing qualification gates.
- Promptless Fill/Remove need inspected before/after boundary crops after the
  PatchMatch repair, not only outside-mask byte assertions. PatchMatch is still
  intentionally limited to local reconstruction and may fail on large semantic
  holes.
- 4-GB constrained runs, ChromeOS Linux-container runs, Windows ARM, macOS
  Apple Silicon, and browser WebGPU/WASM paths need separate evidence. Device
  names alone cannot certify a profile.

The correct completion rule is therefore: the mask is visibly reviewed and
geometrically validated, the provider is capable of the requested intent, the
result is acceptable on the real-photo task, and the accepted candidate remains
correct after undo/redo, reopen, export, cancellation, and source deletion.

## Post-audit interaction and memory verification

The selection-to-CAF boundary was rechecked after the initial audit. The brush
path now rasterizes the segment between pointer samples, so a coalesced fast
drag cannot collapse into two endpoint dots. The focused mask suite covers both
single-dab and continuous-segment coverage. Isolated Chromium runs on the
licensed still-life and landscape photographs exercised the actual CAF dialog;
the resulting frames were non-empty and the landscape edit retained the source
layer in place. These are reconstruction and interaction checks, not semantic
object-removal qualification.

The Object Selection wiring lane now uses the real braided-portrait fixture and
checks the persisted source dimensions and fingerprint before importing the
confirmed candidate into CAF. This keeps the difficult hair-boundary case in
the browser lane without allocating a second full-resolution mask for the
33-megapixel portrait. Mutable URL sources above the 16-megapixel identity
verification limit fail closed and ask for a fresh selection; immutable data or
blob sources retain their exact captured identity without a duplicate decode.

The selection system remains deliberately conservative: automatic foreground
proposals and model-free unions are estimates, not proof of object intent.
Candidate review, explicit confirmation, mask-health warnings, and brush
refinement are still required before generation. Semantic Fill, Replace, and
Expand remain unqualified until a capable local model passes the real-photo
quality gates.

The automatic proposal path also captures the decoded source dimensions and
pixel fingerprint before inference. Applying a reviewed proposal rechecks that
identity for mutable URL sources and fails closed when the same URL now serves
different pixels; literal data/blob sources are immutable and avoid a redundant
full-resolution decode. This closes the remaining same-node/same-URL race
without claiming that a foreground model understands the user's object intent.

The prompted adapter also now carries the encoder's exact SAM2 letterbox frame
through decoding. Non-square source images are cropped back out of the padded
decoder square before the mask is resized to source pixels; otherwise a valid
prompt can produce a confidently shifted or squeezed selection. The adapter
regression test covers a non-square source with positive padding rows. This is
an invariant check for source geometry, not a broad model-quality claim.

The latest selection guard adds two further checks before a reviewed result is
trusted. Positive prompts must land on visible source alpha, so a transparent
hole cannot become an arbitrary object anchor. Each eligible candidate also
reports full-resolution coverage/bounds and bounded 8-connected component
evidence: regions touched by an include point or box are marked anchored, and
sizeable unanchored coverage is shown as an ambiguity warning. The workflow
preserves those regions rather than silently pruning legitimate disconnected
subjects; the explicit review step remains responsible for adding prompts or
refining the mask. When such a candidate is imported into Generative Edit, the
Generate action is disabled until the user confirms that every highlighted
region is intentional or paints a refinement. Focused validation covers the
new cases (18 tests across the prompt validator and SAM2 session); this is a
deterministic safety gate, not a new claim of broad semantic-selection
quality. The real-photo browser qualification and cross-platform model gates
listed above remain open.
