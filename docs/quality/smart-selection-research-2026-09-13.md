# Smart selection research ledger (2026-09-13)

Task: diagnose, repair, complete, and verify Varve's smart-selection
infrastructure (prompted image selection, automatic subject proposals,
deterministic methods, layer targeting). This ledger records the external
research that informed the implementation, with source, access date,
applicable version, implementation consequence, and uncertainty. It separates
verified facts from observed Varve behavior, hypotheses, and product
decisions, per the task requirements.

## Verified external facts

### F1 — SAM2 image predictor contract (points, boxes, multimask, iterative input)

Source: `facebookresearch/sam2`, `sam2/sam2_image_predictor.py` (main branch,
fetched 2026-09-13). Also referenced by the task:
<https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_image_predictor.py>

- `predict(point_coords, point_labels, box, mask_input, multimask_output,
  return_logits, normalize_coords)`.
- Points are `Nx2` in `(X,Y)`; `normalize_coords=True` expects `[0,1]`
  coordinates relative to image dimensions. Labels: `1` foreground, `0`
  background, and box prompts are internally added as labels `2`/`3`.
- `box` is a length-4 `XYXY` array.
- `mask_input` is a low-resolution previous-iteration mask: `1x256x256`
  logits (SAM2 also clamps logits to `[-32, 32]`). This is the iterative-input
  seam.
- `multimask_output=True` returns three masks for ambiguous prompts — these
  are **alternative interpretations of the same prompt**, not three detected
  objects. The predicted IoU scores rank them.
- `set_image` is expensive and reusable; `predict` reuses the stored
  embeddings.

Consequence for Varve: candidate cycling must be labelled as candidate
interpretations; the reviewed candidate must be pinned at output time; and
`mask_input` iterative refinement is only usable if the exported decoder graph
actually exposes that input (Varve's pinned export does not, so it stays a
documented gap rather than an assumed capability).

Uncertainty: the upstream PyTorch contract does not guarantee parity with the
third-party ONNX export Varve ships (`vietanhdev/segment-anything-2-onnx-models`).
Varve's adapter validates the decoder output shapes and rejects malformed
output rather than assuming parity (verified in
`packages/engine/src/segmentation` and `useSam2Segmentation.ts`).

### F2 — SAM3 requires CUDA, Python, and gated checkpoint access

Source: `facebookresearch/sam3` README (main branch, fetched 2026-09-13):
<https://github.com/facebookresearch/sam3>

- Prerequisites: Python 3.12+, PyTorch 2.7+, CUDA-compatible GPU with CUDA
  12.6+.
- Checkpoints are gated: "request access to the checkpoints on the SAM 3
  Hugging Face repo. Once accepted, you need to be authenticated to download".
- Model is 848M parameters; checkpoints are PyTorch, not ONNX/Web.
- SAM 3.1 checkpoints released 2026-03-27; text/visual prompting, open
  vocabulary concept segmentation.

Consequence for Varve: text-prompted selection is explicitly out of scope for
this task. It cannot be shipped as a key-free, lightweight, offline browser
feature with the current artifacts. No SAM3 code or promises are added.

### F3 — SAM2 is memory-bound on high-resolution images in browsers

Sources (fetched 2026-09-13):

- CVAT SAM plugin WASM OOM on high-resolution images, onnxruntime-web WASM
  backend: <https://github.com/cvat-ai/cvat/issues/10492>.
- webgpu-sam2 project notes: encoders exceed 100 MB hosting limits; models are
  cached in the browser after first download:
  <https://github.com/lucasgelfond/webgpu-sam2>.
- onnxruntime issue #25195: WebGPU EP rejects buffers above
  `maxBufferSize` (commonly 1 GiB) independent of actual GPU VRAM:
  <https://github.com/microsoft/onnxruntime/issues/25195>.
- Image-side guidance: resize before encode; embeddings accumulate unless the
  predictor is reset between images.

Consequence for Varve: keep the existing preflight memory assessment **before**
allocating full-resolution `ImageData`; keep the bounded embedding cache and
always key it by decoded-pixel fingerprint + preprocessing identity; report
out-of-memory as a non-retryable typed error with a manual alternative. Do not
claim GPU acceleration is present — the runtime reports what it has.

### F4 — Magic wand behaviour complaints are consistent across products

Sources (fetched 2026-09-13): Virtual Curiosities Krita selection overview
(<https://www.virtualcuriosities.com/articles/1422/overview-of-selection-tools-in-krita>),
GIMP 2.10 release notes and issue tracker
(<https://gitlab.gnome.org/GNOME/gimp/-/merge_requests/2122>), OmnApps
Affinity background-removal guide
(<https://omniapps.blog/affinity-remove-background>).

- "The magic wand is always going to select either too much or too little" —
  users rely on add/subtract combinations.
- GIMP's select-by-color historically ignored active filters and selected raw
  pixels, surprising users; a merge request changed the default to the layer
  "as seen by the user".
- Affinity/GIMP guidance: tolerance adjust, combine selections, then refine.

Consequence for Varve: keep explicit tolerance + combine modes; be honest about
which pixels are sampled (source pixels, before layer effects/overlays); never
report success when a combination produced nothing.

### F5 — Photoshop Select Subject / Remove Background reliability complaints

Source: r/photoshop threads fetched 2026-09-13, e.g.
"Select Subject/Remove Background sucks in PS2026?"
(<https://www.reddit.com/r/photoshop/comments/1rz0t86/>),
"Remove Background Not Working" (<https://www.reddit.com/r/photoshop/comments/1q322gp/>),
"Select Subject VS Remove Background" (<https://www.reddit.com/r/photoshop/comments/1uabzjl/>),
"Not detecting background in any image" (<https://www.reddit.com/r/photoshop/comments/1s9vwzd/>).

Recurring themes:

- Tools fail opaquely ("always says there is no background"), sometimes fixed
  only by restarting the app or switching cloud/device processing.
- Select Subject and Remove Background disagree on the same image; users
  expect consistency.
- Cloud processing introduces connectivity dependence; device processing is
  sometimes preferred for privacy and latency.
- Users are told to fall back to manual tools and are frustrated when those
  fallbacks do not line up with the automatic result.

Consequence for Varve (product decisions):

1. Every model output stays reviewable before it changes the document.
2. "Use as selection" and "Apply as mask" must consume the exact reviewed
   candidate — no second prediction.
3. Failures are typed, explained, and leave prompts recoverable; the manual
   tools remain first-class and are never disabled by model state.
4. Local processing stays the default; no cloud upload path is added.

### F6 — Krita segmentation plugins: box semantics and lifecycle crashes

Sources (fetched 2026-09-13): Acly/krita-vision-tools README
(<https://github.com/Acly/krita-vision-tools>), Krita Artists plugin thread
(<https://krita-artists.org/t/object-selection-tools/71774>), BMFreed/krita-smart-select
announcement (<https://discuss.pixls.us/t/krita-smart-select-ai-powered-lasso-selection-plugin-for-soft-object-masks/58545>).

- "Select Segment from Box" often extracts **all foreground objects in the
  box**, not one specific object; users must enable a slower "Precise" mode.
- Users report crashes when switching tools after a box selection.
- The lasso-first workflow (draw a region, then run the model, clip to the
  region) is praised for keeping the user in control and for preserving soft
  edges.

Consequence for Varve: document that a box prompt is a hint, not a hard
constraint; keep negative points and candidate cycling as the disambiguation
path; cancellation/tool switching must invalidate in-flight work synchronously
(the existing generation counter does this; new prompt editing must not
regress it). A lasso-region adapter is a documented future option, not a
silent bounding-box approximation.

### F7 — WCAG 2.5.7 requires a single-pointer alternative for drag gestures

Source: W3C WAI, Understanding SC 2.5.7 Dragging Movements (fetched
2026-09-13):
<https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>

- Any functionality that uses a dragging movement must also be operable with a
  single pointer without dragging, unless dragging is essential or the
  underlying function is provided by the user agent.

Consequence for Varve: box creation must keep the existing click-click path
(tap first corner, tap second corner) in addition to drag; candidate cycling
already has buttons; prompt removal must not require a drag. This task adds a
tap-based prompt removal and keeps the two-tap box path.

### F8 — ONNX Runtime web guidance: measure, don't assume

Sources: <https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html>,
<https://onnxruntime.ai/docs/tutorials/web/deploy.html> (cited by the task;
accessed 2026-09-13).

- Execution providers and quantization are not automatically faster; profile
  the real application.
- Deployment requires packaged WASM binaries, correct CSP, and offline assets
  to be tested outside the dev server; model-format validity does not establish
  suitability.

Consequence for Varve: no runtime-replacement claim is made by this task; the
existing worker path is kept with its capability detection; release-packaging
verification for any new asset is listed as unverified where it was not run.

### F9 — GitHub release assets are not CORS-enabled

Source: ranged GET with `Origin: http://localhost:5495` against the
`varve-models-v2` release asset URLs on 2026-09-14. Neither the `302` from
`github.com` nor the final `206` from `release-assets.githubusercontent.com`
carries `Access-Control-Allow-Origin`; HuggingFace sends the header on its
`302` and serves the range. Consequence: the in-browser downloader cannot
consume GitHub release assets. Varve keeps the CORS-enabled upstream host as
the runtime source and publishes GitHub as a verified archival mirror
(checksummed). Bridging this would require a server proxy, which the
local-first architecture and trust boundaries exclude.

## Observed Varve behaviour (evidence, this task's audit)

### V1 — "Use as selection" re-ran inference (defect, fixed)

`packages/editor/src/context/useSam2Segmentation.ts` committed the reviewed
candidate without re-running inference only for `operation: 'mask'`. The
`operation: 'selection'` branch fell through to a full encode/decode, so the
coverage could differ from the preview the user inspected and the interaction
was slower. Root cause: the fast path was written for the mask output before
the selection output existed. Fix: one reviewed-candidate commit path shared by
both outputs.

### V2 — Prompt removal was last-in only (gap, addressed)

`Sam2SegmentationTool` supported Backspace popping the last point/box only.
Users could not remove a specific marker. Addressed with marker tap removal.

### V3 — Luminance selection ignored alpha (defect, fixed)

`packages/engine/src/areaSelectionImage.ts` `areaSelectionFromImageLuminance`
did not multiply coverage by alpha, so fully transparent pixels with dark
hidden RGB became selected. Colour-range selection already did this correctly.

### V4 — Magic wand could announce success after an empty combination (defect, fixed)

`MagicWandTool` called `setAreaSelection(null)` when subtract/intersect had no
base selection and still announced that a selection was created.

### V5 — Model-free foreground selector was dead code (gap, addressed)

`packages/engine/src/intelligence/foregroundSelect.ts` existed with tests but
was not exported and had no editor consumer.

### V6 — Real-model parity run unavailable in this environment (unverified)

The pinned encoder `sam2_hiera_tiny.encoder.onnx` is absent from
`apps/desktop/public/models/` (only the decoder is present). The real-model
corpus gate therefore remains un-run here; the existing
`docs/quality/object-selection-parity.md` procedure stays the release gate.

## Hypotheses (not yet verified)

- H1: Cache-hit `readImageSourceIdentity` (full decode + SHA-256) on every
  Apply is acceptable for commit-time correctness but would be too expensive
  per-prompt; asset revision tracking could avoid it later. Not changed here.
- H2: Users will prefer tap-to-remove for mistaken points over a separate
  prompt list; if not, the prompt list can be added without changing the
  session contract.
- H3: The heuristic foreground proposal will be most useful on plain or
  gradient backgrounds and least useful on landscape/texture scenes; the UI
  copy states that boundary.

## Product decisions

- No model download is required for any selection workflow. The heuristic
  proposal and all deterministic methods work offline.
- Candidate labels never claim semantic recognition: decoder IoU is emitted as
  a model score, the single-output fallback as a heuristic score; foreground
  proposals are labelled as estimates.
- Prompt polarity (include/exclude) and selection combination
  (replace/add/subtract/intersect) stay separate controls.
- The reviewed candidate is the only thing an output may commit.

## Focused recheck before the next implementation slice (2026-09-14)

The primary sources and failure reports were re-opened before the follow-up
implementation. Access date for every source in this section: 2026-09-14.

| Source / applicable version | Verified fact or observed complaint | Implementation consequence | Uncertainty |
|---|---|---|---|
| [Adobe Photoshop Help — Select Subject](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/detect-subject-using-select-subject.html), current web documentation | Adobe separates the most-prominent-subject workflow from Object Selection for a specific object in a multi-subject image. | Keep Varve's promptable Object Selection, model-free subject estimate, and layer selection as separate capabilities and names. | Adobe's product behavior is a workflow reference, not evidence that its detector or defaults should be copied. |
| [SAM2 `SAM2ImagePredictor.predict`](https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_image_predictor.py), `main` source | The reference predictor accepts Nx2 point coordinates, 0/1 point labels, an XYXY box, optional 1xHxW low-resolution mask input, and `multimask_output`; three outputs are alternatives for an ambiguous prompt, not object instances. | Preserve explicit prompt polarity, candidate interpretation labels, and the reviewed-candidate identity. Do not expose the pinned ONNX decoder as supporting iterative logits unless its graph contract proves it. | The upstream PyTorch contract does not prove parity with Varve's repaired split ONNX export; Varve must continue validating the actual graph inputs/outputs. |
| [SAM3 README](https://github.com/facebookresearch/sam3), SAM3/SAM3.1 repository documentation | The official setup requires Python 3.12+, PyTorch 2.7+, and a CUDA 12.6+ GPU; checkpoint access is gated. | Do not promise text-prompted, key-free, lightweight, offline SAM3 selection in the browser or on Chromebook-class hardware. | Requirements may change upstream; re-check before any future model decision. |
| [ONNX Runtime Web performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html) and [deployment guidance](https://onnxruntime.ai/docs/tutorials/web/deploy.html), current docs | Runtime/provider choice, model size, threading, packaging, CSP, worker assets, and model caching all affect real behavior; a valid ONNX file is not a deployment qualification. | Keep preflight memory checks, worker execution, packaged-asset tests, and cold/warm measurements separate. Do not market a warm prompt time as first-use latency. | The docs provide guidance, not Varve-specific latency or peak-memory measurements. |
| [W3C WCAG 2.5.7 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), WCAG 2.2 | A drag interaction needs a single-pointer alternative; the guidance gives click-first-corner/click-second-corner as the rectangle-selection example and says keyboard equivalence alone is insufficient. | Make box prompting selectable as a two-tap mode in addition to drag, and keep prompt removal/output controls pointer-operable. | Compliance still needs real touch/stylus validation; browser mouse automation is not hardware evidence. |
| [Photoshop user report: Remove Background / Select Subject errors](https://www.reddit.com/r/photoshop/comments/1p6w3mr/why_wont_my_backgrounds_remove/) and [hair-selection reports](https://www.reddit.com/r/photoshop/comments/1gk8uz0) | User reports describe opaque failures, restart or cloud/device switching as workarounds, and hair or fine edges disappearing after an apparently successful cutout. These are anecdotal complaints, not prevalence data. | Keep errors typed and recoverable, preserve prompts, disclose local-only processing, and send difficult edges to the existing refinement/matting workflow rather than claiming a perfect mask. | Reddit is user-generated and cannot establish frequency or root cause; it is evidence of failure modes users notice. |
| [Krita vision-tools repository](https://github.com/Acly/krita-vision-tools), current README/issues, and [Krita Artists object-selection discussion](https://krita-artists.org/t/object-selection-tools/71774) | The plugin documents a slower precise mode, while the discussion records imprecise box results and a crash after switching tools. | Keep box semantics explicit as a model hint, invalidate stale work on tool changes, and retain a manual fallback/refinement route. | Reports concern a plugin/version combination, not all Krita releases or all segmentation backends. |
| [CVAT high-resolution SAM issue](https://github.com/cvat-ai/cvat/issues/9673) | A user reports SAM annotation failing at high resolution while downscaled images work. | Keep dimension and memory admission before full decode/model allocation and explain a smaller-image/manual fallback. | The issue does not identify a universal threshold or prove the same failure in Varve. |

The current Varve baseline also revealed a local documentation mismatch: the
ledger and Object Selection docs described a two-tap box path that the live
tool did not implement. The follow-up slice closes that gap and makes prompt
polarity and output combination visible instead of requiring Shift knowledge.
