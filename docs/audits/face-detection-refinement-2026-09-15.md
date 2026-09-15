# Face detection and difficult-region refinement — audit and implemented scope (2026-09-15)

Scope: face localization, face-aware crop, hair/fur/glass/smoke/translucency/motion-blur
region discovery and alpha refinement, inside the existing editor surfaces. No new
workspace, mode, editor, model manager, or parallel mask system.

This document records what was researched, what was reproduced with real models and
rights-cleared photographs, what was implemented and verified, and — separately — what
remains a limitation. **Automatic discovery is not claimed for a category unless the
measured evidence below exists.**

## 1. Method

Three independent evidence layers were used, per repository policy:

1. **Upstream numeric reference.** The checked-in ONNX artifact was executed by the
   authoritative upstream predictor (`cv2.FaceDetectorYN`, OpenCV 5.0.0.93) and by the
   production TypeScript path (`onnxruntime-node` 1.27 + the real preprocessor/decoder)
   on **identical input pixels**. Golden detections are checked in at
   [`tests/fixtures/face-corpus/golden.json`](../../tests/fixtures/face-corpus/golden.json).
2. **Reproduced defects.** Each defect below was reproduced before it was fixed, with the
   failing measurement recorded.
3. **Real workflow and visual review.** The editor E2E drives the real UI, the real
   inference worker, and the real committed crop in Chromium
   ([`tests/e2e/canvas/face-aware-crop.spec.ts`](../../tests/e2e/canvas/face-aware-crop.spec.ts)).
   Screenshots from the failing runs were inspected, not assumed.

### Fixtures

| Fixture | Source | Licence |
|---|---|---|
| `tests/e2e/fixtures/real-life-braided-portrait.jpg` | Library of Congress via Wikimedia Commons | Public domain (US) |
| `tests/e2e/fixtures/real-life-smithsonian.jpg` | Wikimedia Commons | Public domain |
| `tests/e2e/fixtures/real-life-ocean-acidification.jpg` | USFWSAlaska via Wikimedia Commons | Public domain |
| `tests/e2e/fixtures/real-life-landscape.jpg` | Wikimedia Commons | Public domain |
| `tests/fixtures/face-corpus/letterbox-*.png` | Derived from the four fixtures above | Derivative of public-domain sources |

Provenance for the source photographs is recorded in
[`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md). No
identity, demographic, or emotion inference was performed, and none is implemented.

## 2. Research (primary sources, accessed 2026-09-15)

| Ref | Source | Findings used | Decision |
|---|---|---|---|
| [R1] | <https://docs.opencv.org/4.x/df/d20/classcv_1_1FaceDetectorYN.html> | `setTopK` semantics, `detect()` contract, score/NMS thresholds | Reference behaviour for parity |
| [R2] | <https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet> | `--top_k` documented as *"Keep top_k bounding boxes before NMS"*; 2023mar has a **fixed** input shape; detection band "around 10x10 to 300x300" pixels; licence MIT | topK is a pre-suppression cap; the fixed 640 input must be handled by windows, not by assuming a dynamic graph |
| [R1 source] | <https://raw.githubusercontent.com/opencv/opencv/4.x/modules/objdetect/src/face_detect.cpp> | `blobFromImage(pad_image)` with **default** scalefactor/mean/`swapRB=false`; `padWithDivisor(32)`; `Rect2i(int(x), int(y), int(w), int(h))` boxes; postProcess keeps `score >= threshold` | Channel order is the Mat's own order (**BGR**), values raw [0,255]; no mean/std normalization; suppression runs on int-truncated boxes |
| [R1 nms] | <https://raw.githubusercontent.com/opencv/opencv/4.x/modules/dnn/src/nms.inl.hpp> | `GetMaxScoreIndex` filters `score > threshold`, stable-sorts descending, truncates to `top_k` **before** greedy suppression; `eta = 1` ⇒ constant threshold | Exactly reproducible greedy NMS; `>` (not `>=`) inside NMS |
| [R3] | <https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter> | Face/hair parsing exists as a capability, artifacts and telemetry must be verified before bundling | **Rejected for this slice**: no new runtime added. Hair-finding stays manual/prompted |
| [R4] | <https://github.com/ZHKKKe/MODNet> | Portrait-only matting; not a hair-only mask and not a general segmenter | Reused the already-integrated MODNet path; no new claims |
| [R5] | <https://pymatting.github.io/> | Closed-form matting / preconditioned solvers; known-foreground/background must constrain the reduced solve | Confirmed the existing `mattingSolver` approach; no new dependency |
| [R6] | <https://pymatting.github.io/foreground.html> | Alpha and clean foreground `F` in `I = αF + (1−α)B` are distinct estimates | Foreground colour estimation is **not** silently applied; documented as a separate reversible output |
| [R7] | <https://arxiv.org/abs/1803.04636> (TOm-Net) | Transparent-object matting needs a reflection/transmission representation beyond one scalar alpha | Confirms the limitation to state honestly; **rejected** as a new dependency |
| [R10] | <https://onnxruntime.ai/docs/tutorials/web/large-models.html> | Web runtime limits and large-model handling | No change; the bundled 233 KB graph is already local |

### Rejected alternatives, with reasons

- **Swapping in a dynamic-shape YuNet export.** The 2026may export exists and would allow
  native-resolution inference directly, but it is not the pinned artifact: the repository
  pins `yunet-face-detect.onnx` by SHA-256, and adopting a new artifact requires a new
  checksum, a licence re-check, and re-baselining every face consumer. The bounded window
  tier achieves the same recall gain with the pinned artifact (measured below).
- **A MediaPipe hair/face-parsing runtime.** Not adopted: another runtime, unclear
  weights licensing for redistribution, and no verified telemetry story in this slice.
- **Per-tile independent inference as the only pass.** Measured to *fragment* faces larger
  than a window (580 px face → 340 px partial box), so it is strictly worse than the
  two-tier design.
- **Off-the-shelf Deblur/defocus classification as a blur detector.** Rejected as a
  detector: a crop classifier is not a region localizer, and a deblurring model is not a
  blur-region detector.

## 3. Reproduced defects (before → after)

All measurements below are reproducible:
`VARVE_YUNET_EVIDENCE_DIR=/tmp/varve-yunet-real-evidence pnpm vitest run packages/engine/src/vision/backends/onnxFaceBackendRealModel.test.ts`.

### 3.1 Channel order (preprocessing)

The packer wrote `R,G,B` planes. OpenCV's reference feeds `blobFromImage` with
`swapRB=false`, i.e. the Mat's own order — **BGR**. Measured with the same predictor,
swapping only the channel order:

| Fixture | BGR (reference) | Swapped (RGB) |
|---|---|---|
| `real-life-ocean-acidification.jpg` (group scene) | 0.930, 0.859, 0.852, 0.521 | 0.924, 0.786, 0.736, 0.722 |
| `real-life-smithsonian.jpg` (textured facade, resized) | 1 detection (0.564) | **11** detections (0.768 … 0.644) |

The reference order scores higher on real faces and produces far fewer borderline
detections on textured non-face content. Implemented: `TensorSpec.channelOrder` with
`bgr` for YuNet ([`packages/engine/src/inference/imageTensor.ts`](../../packages/engine/src/inference/imageTensor.ts)),
manifest `preprocessingVersion` 1 → 2.

### 3.2 `topK` applied after suppression

`topK` is documented and implemented upstream as a **pre-suppression** candidate cap
(`GetMaxScoreIndex` truncates before the greedy loop). The decoder capped retained
detections instead. Regression test:
[`faceDetect.test.ts`](../../packages/engine/src/inference/models/faceDetect.test.ts)
→ *"applies topK before suppression, not after"* (with `topK = 2`, the fixed decoder
returns 1 face; the old behaviour returned 2).

### 3.3 Box clipping was not an intersection

Origins were clamped with `max(0, x)` and sizes with `min(width, imageWidth)`
independently. Consequences reproduced in tests: a partially off-image box kept its full
size (a 320 px-source box at `x = 316, w = 8` reported `w = 8` instead of the visible 4),
and a fully off-image box became a **zero-size "face" pinned to the border**. Implemented:
true rectangle intersection with degenerate results dropped
(`clipFaceDetectionToFrame`).

### 3.4 Malformed output degraded to "no faces"

Missing tensors were skipped (`continue`), so a truncated or corrupted model response
returned an empty, successful result. Non-finite values were worse: a `NaN` score passed
the `score < threshold` comparison and produced a `NaN` box, and `Math.exp(1000)` produced
an infinite box width. Implemented: `FaceDecodeError` with codes `FACE_OUTPUT_MALFORMED` /
`FACE_INPUT_INVALID`, covering missing tensors, wrong dims, short storage, non-finite
class/object/box/landmark values, exponential overflow, and impossible source/letterbox
geometry. Eight regression tests cover these paths.

### 3.5 Small-face recall loss from the fixed 640 input

The pinned graph rejects any input other than `[1,3,640,640]` (verified with
onnxruntime-node). A whole-image letterbox therefore downscales large photographs. Against
OpenCV run at native resolution on the same fixtures:

| Fixture | Source | Whole-image letterbox | Native reference | Recall |
|---|---|---|---|---|
| `real-life-smithsonian.jpg` | 1920×1159 | 0 detections | 3 (11–15 px) | **0.00** |
| `real-life-ocean-acidification.jpg` | 1280×960 | 3 detections | 4 | 0.75 |
| `real-life-braided-portrait.jpg` | 1920×2383 | 1 detection | 2 | 0.50 |
| `real-life-landscape.jpg` (control) | 1632×1224 | 0 | 0 | no false positives |

The loss is scale-band, not threshold: the detector's ~10 px floor is reached earlier for
small faces once the whole frame is squeezed into 640 px.

### 3.6 Naive tiling fragments large faces

Tiling at native scale alone was measured to split faces larger than a window: a 580 px
face produced a 340 px partial box (IoU 0.31 against the reference). A fragment can carry
a *higher* score than the intact box, so plain score-ordered NMS can displace the correct
box.

## 4. Implemented changes

| File | Change |
|---|---|
| [`packages/engine/src/inference/models/faceDetect.ts`](../../packages/engine/src/inference/models/faceDetect.ts) | BGR spec; OpenCV-parity decode (strict NMS score gate, int-truncated suppression boxes, pre-suppression `topK`, stable deterministic order); typed malformed-output failures; true-intersection clipping; `landmarksInFrame` so out-of-frame keypoints are flagged instead of clamped |
| [`packages/engine/src/inference/imageTensor.ts`](../../packages/engine/src/inference/imageTensor.ts) | Optional `channelOrder` on `TensorSpec`, honoured by `packNchwTensor` |
| [`packages/engine/src/vision/faceWindows.ts`](../../packages/engine/src/vision/faceWindows.ts) | Pure window planner (tile/overlap/budget, native-scale unless the budget forces a downscale), direct RGBA window crop, source mapping, and tier-priority + containment merge |
| [`packages/engine/src/vision/backends/onnxFaceBackend.ts`](../../packages/engine/src/vision/backends/onnxFaceBackend.ts) | Two-tier detection; window tier skipped when the whole-image pass already runs at ≥ 75 % of native pixels or a single window adds nothing; no full-resolution canvas duplicate at scale 1; cancellation checked between windows |
| [`packages/editor/src/imageCrop.ts`](../../packages/editor/src/imageCrop.ts) | Split **analyze** from **apply**: `analyzeFaceAwareCrop` returns reviewed detections plus the crop suggestion and never mutates the document; `applyFaceAwareCropToDocument` commits one reviewed result. `selectReviewedFaces` applies the reviewer's include-then-exclude selection |
| [`packages/editor/src/components/Inspector/sections/ImageCropSection.tsx`](../../packages/editor/src/components/Inspector/sections/ImageCropSection.tsx) | Two-step review surface: *Detect Faces* shows the reviewed faces (confidence, box size, per-face include/exclude) and a protection margin in real units (% of face size); *Apply Crop* commits; *Discard* leaves the artwork untouched |
| [`apps/desktop/public/models/manifest.json`](../../apps/desktop/public/models/manifest.json) | `preprocessingVersion`/`postprocessingVersion` 2 with the reason recorded |

Design rules encoded:

- **Tier A wins every overlap.** The intact whole-image box suppresses native-scale
  fragments (unit-tested, and measured with the OpenCV oracle: a 658 px bearded-man box
  survives while the tile fragment is suppressed).
- **Merge never joins two faces.** Secondary candidates are suppressed only by IoU or by
  ≥ 60 % containment in an already-kept box; two nearby faces stay separate.
- **No analysis without a request.** The window tier runs only inside an explicit
  `Protect Faces` request. Importing an image still triggers no inference.
- **No silent upsampling.** Windows are cropped at native pixels; a window smaller than
  the model input is zero-padded (the reference padding), never upscaled to invent detail.

## 5. Verification

| Check | Command | Result |
|---|---|---|
| Decoder parity with upstream on identical pixels | `pnpm vitest run packages/engine/src/vision/backends/onnxFaceBackendRealModel.test.ts` | Box/landmark agreement **0.0001 px**, score agreement **0.000000** on all four golden cases |
| Window-tier recovery | same file, second test | Portrait 0.50 → **1.00**, ocean 0.75 → **1.00**, smithsonian 0.00 → **0.67**, landscape 0 → 0 (no false positives) |
| Decoder/window/merge unit tests | `pnpm vitest run packages/engine/src/vision packages/engine/src/inference/models/faceDetect.test.ts packages/engine/src/inference/imageTensor.test.ts` | **80 passed** |
| Real editor workflow (Chromium) | `VARVE_E2E_PORT=1527 npx playwright test tests/e2e/canvas/face-aware-crop.spec.ts --project=chromium` | Existing real-inference crop test **passed** (19.3 s through the review flow); new window-tier test **passed** (23.9 s, 12 window inferences, committed crop) |
| Review-flow unit/engine tests | `pnpm vitest run packages/editor/src/imageCrop.test.ts packages/editor/src/components/Inspector/sections/__tests__/faceCropProtect.test.tsx` | **42 passed** — analysis does not commit, exclusion filters the reviewed set, margin maps to the solver option, discard is inert |

### Residual smithsonian 0.67 — root-caused, not waved away

The unmatched reference is an 11 px face. OpenCV run on a **640 crop of the same region**
places it at `x = 183.5 / 200.0` — exactly where this pipeline reports it — while the
whole-image native run places it at `x = 220.7`. Direct comparison on identical crop
pixels:

| Runner | Detection |
|---|---|
| OpenCV on the crop, from the JS JPEG decode | `(183.49, 8.84, score 0.5284)`, `(200.00, 8.74, 0.5196)` |
| Varve window tier (same crop) | `(183.5, 8.8, 0.5284)`, `(200.0, 8.7, 0.5196)` |

So the residual gap is upstream context instability at a 10 px feature, not a pipeline
defect. This is why the case is gated at 0.6 and the reason is recorded in the test.

## 6. Acceptance rows

Each row states localization method, automatic vs prompted/manual support, instance
selection, refinement method, measured quality, frontend integration, save/reopen/export,
and remaining limitations. **A row is only marked automatic when the measurement above
exists.**

### 6.1 Faces — **implemented and verified**

- **Localization**: YuNet 2023mar (MIT, 233 KB, pinned by SHA-256), two-tier
  (whole-image letterbox + bounded native-scale windows). Boxes + 5 keypoints.
- **Automatic vs manual**: automatic on an explicit request (`Protect Faces` in crop mode).
  Manual correction: adjust the crop by hand; the analysis never mutates artwork.
- **Instance selection**: individual faces are separate detections with deterministic ids
  (`onnx-yunet-face:<index>`); the crop solver weights large/confident faces more heavily
  and reports which faces the chosen crop covers (`coveredFaceIds`).
- **Refinement**: none needed — face bounds are for framing. A face box is explicitly
  *not* a face/hair/person mask; precise extraction uses Object Selection or Background
  Removal.
- **Measured quality**: see §5. Parity with upstream on identical pixels; recall table
  above; zero false positives on the landscape control.
- **Frontend**: Inspector → crop → `Protect Faces`. **Analyze and apply are
  separate**: *Detect Faces* runs the analysis and shows a review list (per-face
  confidence, box size, include/exclude) plus a protection margin in real units
  (% of the larger face dimension); *Apply Crop* commits one undoable crop;
  *Discard* closes the review without touching the artwork. No-crop-on-analysis is
  asserted in unit and E2E tests. Detection is disabled for non-image or
  multi-select, and the error surface distinguishes "no faces above the
  confidence threshold" from download/worker/malformed-output failures.
- **Save/reopen/export**: the committed result is an ordinary `ImageFillData.crop` on the
  image fill — no model is needed to reopen, render, or export it.
- **Remaining limitations**: boxes are approximate; profile/rotated/occluded faces rely on
  the detector's own domain (~10–300 px, frontal-first); no dense mesh; reflections,
  statues, illustrations, and animal faces are undecided — manual exclusion is the answer;
  "no faces detected" means nothing was retained above the confidence floor.

### 6.2 Hair — **manual/prompted only (no automatic discovery)**

- **Localization**: none automatic. Manually paint foreground/unknown/background, or take a
  whole-subject matte from Background Removal / MODNet.
- **Refinement**: `refineHairMatting` — guided filter (default, only touches the 10–245
  band, leaves definite cores byte-exact) or corrected closed-form matting. Binary masks
  do get a real spatial unknown band via `trimapFromMask` (dilate/erode straddling the
  50 % contour), and interior fractional coverage is always unknown regardless of distance.
- **Measured quality**: MODNet portrait gate exists as a real-model test; a general portrait
  matte is **not** a hair-only mask, and no hair-parsing model is bundled.
- **Remaining limitations**: no flyaway/curl-specific model; hats/veils/glasses interactions
  are unmodelled; contrast-preserving refinement cannot invent strands the source does not
  contain. **Not claimed as automatic hair detection.**

### 6.3 Fur — **manual/prompted only**

- **Localization**: none automatic. Material-agnostic edge refinement applies to a
  user-supplied mask; MODNet is portrait-specific and out of domain for animals.
- **Remaining limitations**: whiskers/tufts/long fur are exactly the low-coverage detail a
  generic matte loses; no animal or fur model is bundled. **Not claimed as automatic fur
  detection.**

### 6.4 Glass — **manual/prompted only; footprint selection, not optics**

- **Localization**: none automatic. A detector for "bottle" would be a bottle proposal, not
  proof of glass or transparency, so none is wired.
- **Refinement**: alpha-based selection/refinement on the transparent interior with manual
  constraints; the user can protect solid rims/frames/labels separately.
- **Explicit statement of limits**: a scalar matte cannot reproduce refraction,
  reflection, or an arbitrary background showing through. Per [R7], attenuation/refraction
  would need a representation the compositor does not have. Alpha is never hardcoded to
  zero or a fixed opacity.
- **Verified control**: the glass fixtures produce **no** face false positives in the golden
  corpus, and no automatic glass claim is made.

### 6.5 Smoke — **manual/prompted only**

- **Localization**: none automatic; low contrast, brightness, or intermediate segmentation
  confidence do **not** prove smoke, so no brightness-to-alpha rule exists.
- **Refinement**: broad low-alpha coverage is preserved through fractional alpha; the
  unknown brush lets the user mark interior uncertainty away from the silhouette.
- **Remaining limitations**: no plume/fog model; aggressive denoising that erases faint
  structure is out of scope. This is creative matting, not a fire/smoke safety detector.

### 6.6 General translucency — **manual/prompted; fractional alpha preserved**

- **Localization**: none automatic.
- **Refinement**: existing Replace/Add/Subtract/Intersect mask algebra and scoped
  adjustment masks; source alpha is preserved rather than clamped (full mask coverage on an
  alpha-0.5 source stays 0.5; zero adjustment coverage is the identity).
- **Remaining limitations**: overlapping transparent materials need not sum to one, and
  pigment/tint is distinct from opacity — the UI documents approximations rather than
  pretending to solve them.

### 6.7 Motion-blurred boundaries — **manual/prompted; heuristics only, no detector**

- **Localization**: none. Local sharpness/edge statistics can only ever be *heuristic
  evidence* and would need hard negatives (defocus, atmospheric softness, JPEG artifacts,
  resampling, shallow gradients). No single-image motion direction or shutter time is
  invented.
- **Refinement**: the existing expansion of the unknown band beyond the sharp core is the
  supported path; a deblurring model (NAFNet/SCUNet, already present) is a *restoration*
  tool and is **not** presented as a blur-region detector.
- **Remaining limitations**: still-image motion-blur refinement is supported as manual
  matting with a wider unknown band; automatic blur localization is **not implemented**.

## 7. Not claimed

- No identity recognition, face parsing, landmarks beyond the five keypoints, person
  segmentation, portrait matting inside the face path, emotion/age/gender/ethnicity
  inference, beautification, or medical judgement.
- No automatic library-wide scan on import; no webcam access; no network call.
- No video tracking or temporal matting.
- No automatic hair, fur, glass, smoke, translucency, or motion-blur detection.
- Analysis raw data is ephemeral and not persisted; the persisted artifact is the ordinary
  document crop/mask, which opens without any model installed.

## 8. Coordination notes and handoffs

- `packages/editor/src/imageCrop.ts` consumes the backend directly (not through
  `VisionService`). That is unchanged here; routing it through the service would change
  caching and job-lifecycle semantics and is left to the vision-service owner.
- Working tree during this work contained in-flight changes by other agents, including
  `FloatingToolbar.tsx`, `commitRasterMask.ts`, `BackgroundRemovalSection.tsx`,
  `modelLoader.ts`, and several docs. **No file outside this change's ownership was
  modified.**
- **Resolved — floating toolbar / selection quick bar**: while running the E2E, the
  selection quick bar's `Crop` button was repeatedly unclickable, which blocked the
  face-aware-crop workflow from the quick bar. Two distinct placement bugs were found with
  screenshots and real-app measurements and are now fixed (commit `9b29bb4c8`):
  (a) the bar is centred on the selection and was never horizontally clamped, so at the
  canvas's left edge the leading actions (`Crop` first) were laid out beyond the
  `overflow: hidden` canvas box and were unclickable; (b) with a selection filling most of
  the canvas, "below the selection" landed inside the floating palette's band (measured:
  canvas 682x543, palette band 487-534, bar placed at 491) where the palette, one z-level
  above, swallowed the click. The bar now clamps inside the canvas, derives its max width
  from the canvas, and yields to the palette's measured edge band (top or bottom, so the
  `View > Toolbar at Top` placement is respected). Invariants and evidence are in
  `docs/architecture/toolbar-system.md`; the E2E no longer needs its `Fit selection to
  viewport` workaround and now asserts reachability directly.
- **Pre-existing typecheck failures** in `packages/engine/src/lut/lut.test.ts` and
  `lut-edge.test.ts` (`Property 'size' does not exist on type 'Shaper3D'`) exist on `HEAD`
  and are unrelated to this change.
