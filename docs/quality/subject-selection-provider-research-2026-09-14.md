# Subject-selection provider research ledger (2026-09-14)

Task: audit, repair, extend, and validate Varve's subject-selection and
object-selection providers. This ledger records the external research that
precedes the provider and routing work, with source, access date, applicable
version, artifact identity, license, tensor contract, measured numbers, known
limitations, and the resulting decision. It follows the earlier ledger
`docs/quality/smart-selection-research-2026-09-13.md` (which stays the record
for the SAM2/Object Selection baseline and deterministic-selector repairs) and
the parity methodology in `docs/quality/object-selection-parity.md`.

All measurements in this ledger were taken on 2026-09-14 on the primary dev
machine: CachyOS, 22 GiB RAM, AMD/Intel x86-64 (no CUDA), Python 3.13.15 via
`uv`, `onnx` 1.22.0, `onnxruntime` 1.30.0 CPU execution provider, 4 intra-op
threads. They are first-order artifact checks, not browser-latency claims;
in-app ort-web numbers are measured separately by the E2E gates.

## 1. MobileSAM — official upstream

| Field | Value |
| --- | --- |
| Source | <https://github.com/ChaoningZhang/MobileSAM> (README, LICENSE, `scripts/export_onnx_model.py`, `notebooks/onnx_model_example.ipynb`) |
| Access date | 2026-09-14 |
| Version | `master`; latest release line 2023-07 (MobileSAMv2 in-tree) |
| License | Apache-2.0 (repository); checkpoint `weights/mobile_sam.pt` distributed by the repository under the same project |
| Architecture | Original SAM prompt pipeline with the ViT-H image encoder replaced by TinyViT (~5 M params encoder, ~3.9 M decoder); 1024x1024 input; 256x64x64 image embedding |
| ONNX support | Official export script `scripts/export_onnx_model.py --model-type vit_t`; the official script emits a **single combined graph** (encoder + prompt encoder + decoder), so every prompt re-encodes the image — unsuitable for Varve's cached-embedding interaction |
| Known limitations | Official combined export cannot reuse embeddings; the repository does not publish split ONNX files; checkpoint hosting is a repository asset, not a checksummed release |
| Decision for Varve | Do **not** re-export locally (no torch in the dev environment, and Varve cannot host new artifacts on a CORS-enabled origin). Use a verifiable third-party split export instead (below), or defer. |

## 2. MobileSAM — split ONNX artifact evaluated for integration

| Field | Value |
| --- | --- |
| Source | <https://huggingface.co/Acly/MobileSAM> (model card, `mobile_sam_image_encoder.onnx`, `sam_mask_decoder_multi.onnx`, `sam_mask_decoder_single.onnx`, `mobile_sam_encoder_onnx/export_image_encoder.py`, `mobile_sam_encoder_onnx/onnx_image_encoder.py`) |
| Access date | 2026-09-14 (files downloaded and hashed) |
| Version / revision | Hugging Face revision `main`, last modified 2023-08-03; export environment `pytorch 2.0.1`, opset 17, IR 8 |
| License | MIT declared on the model repository. Upstream artifacts are MobileSAM (Apache-2.0) and the original SAM decoder weights (Apache-2.0); TinyViT (Apache-2.0). MIT redistribution of Apache-2.0-derived weights is compatible. |
| Artifact location | `https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx` (28,157,093 B, SHA-256 `580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749`) and `.../sam_mask_decoder_multi.onnx` (16,496,559 B, SHA-256 `8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe`). `sam_mask_decoder_single.onnx` (16,501,323 B, SHA-256 `93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d`) is the one-candidate variant. |
| Support provenance | The repository ships the exact export scripts (`export_image_encoder.py`, `onnx_image_encoder.py`) written by the repository author (Acly, author of the Krita vision-tools integration). The encoder's weights match the independently published `vietanhdev/segment-anything-onnx-models` `mobile_sam_20230629.zip` encoder: initializer names and all but 54 constant-folded tensors are byte-equal; the differences are folded constants (max absolute difference below float rounding of the folding chain), not model weights. |
| Encoder contract | Input `input_image`: FLOAT `[H, W, 3]` dynamic, **raw RGB 0..255 in HWC order**. The graph normalizes with `(x - [123.675, 116.28, 103.53]) / [58.395, 57.12, 57.375]`, permutes to CHW, and zero-pads bottom/right to 1024 (verified by reading the export wrapper and the graph's leading `Sub`/`Div` constants). Output `image_embeddings`: FLOAT `[1, 256, 64, 64]`. |
| Decoder contract | Inputs: `image_embeddings` `[1,256,64,64]`, `point_coords` `[1,N,2]` in **padded-1024 pixel space**, `point_labels` `[1,N]` (1 foreground, 0 background, box corners as labels 2/3), `mask_input` `[1,1,256,256]` low-resolution logits, `has_mask_input` `[1]`, `orig_im_size` `[2]` as `[height, width]`. Outputs: `masks` `[1,C,H,W]` float logits already bilinearly resized to `orig_im_size`, `iou_predictions` `[1,C]` **raw logits** (values above 1.0 observed; apply sigmoid before displaying a percentage), `low_res_masks`. |
| Candidate count | `sam_mask_decoder_multi.onnx` returns 4 candidates: candidate 0 is the single-mask interpretation, candidates 1..3 are the multimask alternatives (one can be a whole-image interpretation for an ambiguous point, as with SAM2). `sam_mask_decoder_single.onnx` returns 1. |
| Prompt/box convention | Box prompts use the standard SAM export convention: two appended points `(x1,y1)` label 2 and `(x2,y2)` label 3. Points are not normalized; the caller scales source pixels by `1024 / max(sourceWidth, sourceHeight)` with no offset because padding is bottom/right. |
| Preprocessing (caller side) | Resize longest side to 1024 (bilinear), feed unpadded HWC float; the graph pads. Normalization is in-graph. |
| Postprocessing | Threshold mask logits at 0 (sigmoid 0.5). The mask arrives at source resolution, so no Varve-side resize or letterbox reconstruction is required for this provider. |
| Runtime requirements | Standard ONNX opset 17 only; no `com.microsoft` or NHWC-private domains in the FP32 files (verified by graph inspection). `Erf`, `LayerNormalization`, `Resize`, `ConvTranspose` are used. |
| Measured latency (artifact check, Python ort CPU) | Encoder 0.84-1.20 s; decoder 0.11 s; 512x512 and 1080x1920 sources measured. Compare: SAM2-Hiera-Tiny encoder 4.2 s in the recorded parity run. |
| Measured quality (artifact check) | Synthetic circle fixture at 400x600: best candidate IoU 0.997 against the ground-truth circle; 512x512 random-noise prompt returned plausible alternative masks with logits 0.48-1.00. This proves the contract, not production quality; the corpus run is the gate. |
| Known limitations | Third-party export rather than an official release; the 4th candidate can be a whole-image interpretation; IoU scores are logits and are not calibrated probabilities; WebGPU execution-provider support is unverified (WASM is the reference path); the encoder pre-resize must be done by Varve. |
| Decision for Varve | **Accepted as an explicit smaller-download prompted provider.** The real-model corpus, actual Chromium WASM workflow, and memory evidence are recorded below, but the browser gate found a boundary-click ambiguity. It remains experimental and is not eligible for automatic routing. |

### 2.1 Alternative MobileSAM artifact evaluated and not selected

`vietanhdev/segment-anything-onnx-models` (Apache-2.0, same author as the SAM2
exports Varve already ships) publishes `mobile_sam_20230629.zip` (36.7 MB,
SHA-256 `41aff2660b7531becfee21fb257c49933ddc892c554507bdb775bf504d443942`)
containing `mobile_sam.encoder.onnx` (20deef40…), the SAM ViT-H decoder
`sam_vit_h_4b8939.decoder.onnx` (22cf85e3…), and a config. The export is
single-mask (`masks` `[1,1,H,W]`, `iou_predictions` `[1,1]`), which removes
candidate cycling relative to the Acly pairing, and it is a ZIP, which the
model store cannot consume without an archive-extraction and inner-checksum
path. The quantized variant `mobile_sam_20230629_quant.zip` (11 MB) declares
nonstandard opsets `com.ms.internal.nhwc` and `com.microsoft.experimental`;
that graph is not web-portable. Decision: **not selected** — the Acly pairing
offers direct files, a multi-mask decoder, and an equally verifiable export
script chain.

## 3. Prompted-segmentation alternatives reviewed (not shipped)

| Project | Source / access date | License | Finding | Decision |
| --- | --- | --- | --- | --- |
| SAM2 (current provider) | `docs/quality/object-selection-parity.md`, parity run 2026-09-14 | Apache-2.0 (export `vietanhdev`) | Split export already integrated; encoder 134 MB; 3 candidates; corpus mean IoU 0.654 default / 0.720 best candidate | Shipped (prompted provider) |
| EdgeSAM | <https://github.com/chongzhou96/EdgeSAM>, 2026-09-14 | NTU S-Lab License 1.0 (non-commercial redistribution/use restrictions) | ONNX encoder/decoder are published, but the license blocks distributable integration; upstream also warns its IoU predictions are unreliable and recommends stability-score selection | **Rejected** (license blocker; no license-clear artifact) |
| EfficientSAM | <https://github.com/yformer/EfficientSAM>, 2026-09-14 | Apache-2.0 (upstream EfficientViT codebase is stated unmaintained by the task brief) | ONNX encoder/decoder exist (HF Space, separate models); point/box/saliency prompts | **Deferred / A-B experiment only**; no product dependency until it demonstrates an advantage over MobileSAM and SAM2 on the same corpus |
| EfficientViT-SAM | task brief, 2026-09-14 | — | Upstream no longer maintained | **Rejected** as a production dependency |
| FastSAM | MobileSAM README comparison, 2026-09-14 | AGPL-3.0 (YOLOv8-seg derivation) | Not re-evaluated; AGPL is incompatible with Varve's distribution model | **Rejected** |

## 4. Automatic foreground providers already shipped by Varve

The following identities already exist in the unified model catalog
(`packages/engine/src/inference/modelCatalog.ts`) and are reused by this work
through the existing model manager, checksum verification, IndexedDB/native
store, provider chain, and memory preflight. No parallel model manager is
introduced.

| Model | Role in this task | Distribution | Notes |
| --- | --- | --- | --- |
| `u2netp` | Fast automatic foreground proposal | Bundled (4.6 MB, checksum pinned) | MIT; 320x320; ImageNet normalization; sigmoid-in-graph probability output. The zero-download path. |
| `u2netp-int8` | Not routed | Bundled | Quality-gated (`INT8_QUALITY_FAILED` in `precisionPolicy.ts`); the task's INT8 assumptions are not taken as given. |
| `isnet-general-use` | Balanced automatic foreground proposal | Optional download (179 MB) | Apache-2.0 (DIS); 1024x1024; 0.5/1.0 normalization; native execution preferred on desktop. |
| `birefnet-general-lite` | High-quality cutout/refinement proposal | Optional download (224 MB) | MIT; 1024x1024; logits with in-app sigmoid; deliberately native-preferred because bare-WASM can exceed the wasm32 ceiling. |
| `birefnet-general` | High-quality cutout (larger variant) | Optional download (928 MB) | Not offered on constrained devices. |
| `modnet-portrait` | Explicit portrait subject matte | Optional download (26 MB) | Apache-2.0; 512-edge reference contract; fractional alpha for hair/clothing; not a general object selector and no automatic step-down. |
| SAM2-Hiera-Tiny | Prompted object selection | Optional download (155 MB) | Current baseline provider. |
| MobileSAM | Smaller-download prompted selection (experimental) | Optional download (44.7 MB) | See sections 2 and 9; the file size is not a low-memory guarantee. |

## 5. Model-free foreground estimate (current Select subject path)

Source: `packages/engine/src/intelligence/foregroundSelect.ts` (in-tree,
audited 2026-09-14). Border flood plus centre flood, ranked by
`0.55·coverage + 0.25·centrality + 0.20·edgeAlignment`, analysis capped at
1024 px on the long edge. Its documented weakness (landscape/texture scenes)
is the reason model-backed proposals exist; it remains the fallback that
requires no model at all and is retained for offline/low-memory operation.

## 6. Failure modes reported for competing products (user research)

The brief asks what other products' users complain about, not only what works.
These are anecdotal reports, not prevalence data; each is paired with the
concrete Varve behaviour this work ships or preserves.

| Report | Source / access date | Consequence for Varve |
| --- | --- | --- |
| "Select Subject / Remove Background sucks in PS2026? … these are very high contrast images and it's just not working" — opaque failure with no explanation | r/photoshop `1rz0t86`, 2026-09-14 | Never fail silently: every automatic estimate either produces a reviewable proposal or a typed, explained error with a deterministic fallback. |
| "the only thing that fixed it was rebooting my computer" / "going into Preferences … choosing Cloud over Device … But it requires a decent internet connection" | r/photoshop `1rvr5r0`, 2026-09-14 | Local-first is the promise: no cloud dependency for the core workflow, and a failure never requires an app restart because model sessions are disposable worker state. |
| "Select Subject … gives me selections alad [sic], a bunch of random patches the subject, not selected" on a figure against a wall | r/photoshop `1gcpwqe`, 2024-10-26 (still cited 2026) | Honest proposal semantics: candidates are "foreground estimates" a user reviews and cycles; the UI never claims to know the subject. Per-region candidates and All-subjects union make patches fixable. |
| "AI subject selection … entirely incapable of … detecting background inside of loops … jagged edges … clearly processes pixels at below the actual resolution" | r/photoshop `1ijyo9g`, 2025-02-07 | Model proposals are kept at source resolution where the provider supports it (MobileSAM decoder returns source-resolution masks); holes are preserved (no automatic island removal in proposals); refinement tools stay first-class. |
| "it has gotten a lot worse at detecting subjects" / feature broken after an update | r/photoshop `1rrwh0w`, 2026-03-12 | Provider version and artifact checksum are part of every cache identity and diagnostics record; a changed artifact invalidates cached embeddings instead of silently mixing versions. |
| Affinity: Select Subject consolidated into "Object Selection Tool" that "uses the segmentation machine-learning model (included w/ the free version but must be manually installed in settings)" | r/AffinityPhoto `1onndya`, 2025-11-03 | Varve keeps the automatic estimate (zero-download) and prompted selection (optional model) as separate, clearly named capabilities; an optional model is never required for the basic path. |
| Krita vision-tools: "Select Segment from Box" often extracts all foreground objects in the box unless a slower precise mode is used; users report crashes when switching tools after a box selection | `docs/quality/smart-selection-research-2026-09-13.md` F6 (Krita Artists / Acly repo), re-verified 2026-09-14 | Box stays a hint, not a hard clip; switching tools cancels in-flight work synchronously (generation counter); negative points and candidate cycling are the disambiguation path. |
| Users of multiple products report that the automatic result disagrees with the manual-refinement tools they are told to use as fallback | research ledger F5, 2026-09-13/14 | The automatic proposal becomes a normal area selection and enters the same refine/mask pipelines; nothing about it is a separate selection representation. |

## 7. Runtime and hosting constraints re-verified

- Hugging Face `resolve` URLs send `access-control-allow-origin` on the 302
  and serve ranged content (verified again 2026-09-14 with `Origin:
  http://localhost:5495` against the Acly repository). GitHub release assets do
  not (recorded 2026-09-14 in the earlier ledger), so new browser-downloadable
  artifacts must live on a CORS-enabled host.
- ONNX Runtime Web guidance (re-verified 2026-09-13/14): quantization and
  execution providers are not automatically faster; a valid ONNX file is not a
  deployment qualification. The quantized MobileSAM export uses private opsets
  and is therefore not web-portable regardless of size.
- Bundled `u2netp.onnx` served at `/models/u2netp.onnx` matches the pinned
  manifest checksum (`309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`,
  re-verified 2026-09-14), so the fast automatic-proposal path requires no
  download.

## 8. Decisions

1. **Reuse the existing automatic-foreground models** for model-backed
   `Select subject` proposals: `u2netp` (fast, bundled), `isnet-general-use`
   (balanced, optional), `birefnet-general-lite` (high quality, optional,
   native-preferred). No new model manager, no new download path.
2. **Use MODNet as an explicit portrait-only route**, with its existing
   checksum-pinned model-manager entry and browser worker implementation. It
   must not be used as a fallback for arbitrary objects, and portrait intent
   must not fall back to a generic foreground model when MODNet is unavailable.
3. **Keep the model-free estimator** as the no-model fallback and never
   present it as semantic recognition.
4. **Accept MobileSAM as an explicit smaller-download prompted provider**, with
   the Acly split export, pinned checksums, MIT/Apache-2.0 provenance, and a
   documented real-photo browser gate. Its ~1.15 GB Node RSS evidence and
   boundary-click ambiguity keep it out of automatic routing.
5. **Reject EdgeSAM** under its current license; **defer EfficientSAM** to an
   A-B experiment; **do not add EfficientViT-SAM**; keep MODNet portrait-only
   and Grounding DINO optional/future.
6. **No silent capability substitution**: a provider that cannot run its
   requested model reports that, with the download size when a model is the
   answer, and routes to a clearly different capability only with user
   consent or explicit fallback labelling.

## 9. Real-photo browser gate (2026-09-14)

The pinned Acly split artifacts were executed through Varve's actual
Chromium/ort-web WASM worker, not only through a mock or the Node contract
harness. The gate used the public-domain `real-life-elephant.jpg` fixture and
the model preference **Faster local — MobileSAM** so the run could not pass by
silently selecting SAM2.

| Field | Result |
| --- | --- |
| Source / access date | `tests/e2e/fixtures/real-life-elephant.jpg`, 2026-09-14 |
| Artifact | Acly/MobileSAM revision `0d3b403339b4674a82493d5e97964dd78089ddc8`, MIT model card |
| Checksums | Encoder `580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749`; multi-mask decoder `8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe` |
| Contract exercised | Encoder raw RGB HWC after provider-owned ResizeLongestSide; decoder padded-1024 prompt coordinates, point labels, four candidates, source-sized masks, raw predicted-IoU scores, and low-resolution logits |
| Runtime | Headless Chromium, ort-web WASM, COOP/COEP dev server, persistent model profile |
| Scenario | Interior elephant positive click → negative grass click → review four candidates → cycle away and back → Apply as mask |
| Result | Passed 1 test in 1.9 minutes; preview, correction, candidate identity, and persisted mask were visually inspected |
| Memory | Separate Node real-photo sequence peaked at approximately 1.15 GB RSS on a 1920x2560 source; browser peak memory was not instrumented sufficiently for promotion |
| Known failure | A boundary click on the same photograph can select a high-scoring expansive ground patch; predicted-IoU does not identify user intent |
| Decision | Keep MobileSAM explicit-only and experimental. Do not route it automatically or market it as a guaranteed low-memory path. |

The exact real-model command and screenshot names are recorded in
`docs/quality/object-selection-parity.md`. Captures are local temporary
validation artifacts; pixels, prompts, filenames, and embeddings are not sent
to analytics or crash reporting.

## 10. MODNet portrait review (2026-09-15)

The pinned `modnet-portrait` graph was also run through the native contract
harness and the actual Chromium Selection Sources workflow. The numeric
contract passed, and the browser test passed against
`real-life-katharine-hepburn.jpg` with a persisted 1280 × 1696 mask: the
person interior contained 236,181 hard pixels and the clear upper-background
window contained zero. The browser path warms the bounded mask-render cache
before announcing the mask commit, so its screenshot is not an unmasked
transient frame.

The same model was inspected on `real-life-braided-portrait.jpg`. Its 33.89%
hard coverage looked plausible numerically, but the matte included the dark
oval background surrounding the person. That is a concrete semantic failure,
not a renderer failure. It is retained as a rejected real-photo output in
`docs/audits/subject-selection-portrait-model-2026-09-15.md`.

This result tightens the provider decision: MODNet is a reviewed portrait
matte for suitable photographic portraits, never a guarantee of a single
person or object. The UI must direct a user who intends one item inside a
complex or framed photograph to prompted Object Selection or manual paint /
trimap refinement. A model score, coverage percentage, or fractional alpha
edge does not establish target identity.
