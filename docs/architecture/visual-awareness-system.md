# Demand-driven visual awareness

Status: foundation implemented, task-specific face/hand/pose backends remain a
release-gated follow-up (2026-08-13).

Varve's visual-awareness subsystem is capability-driven. Editor workflows ask
for a result such as `FACE_BOUNDS`, `FACE_KEYPOINTS`, or `PERSON_MASK`; they do
not name MediaPipe, ONNX Runtime, a model file, or a backend. The smallest
backend that can satisfy the request is selected, and unrelated models are not
loaded.

## Repository audit

The audit found the following current boundaries:

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Generic model catalogue | `apps/desktop/public/models/manifest.json`, normalized by `packages/engine/src/inference/manifest.ts` and `modelCatalog.ts` | Checksums, component artifacts, tensor contracts, acquisition state, and memory estimates already exist. The manifest remains ONNX-shaped for current shipped models. |
| Browser inference | `packages/engine/src/inference/inferenceWorker.ts` and `InferenceWorkerHost` | Worker inference supports WASM/WebGL/WebGPU provider selection and cancellation. |
| Desktop inference | Rust model crates plus Tauri commands | Native model storage and ONNX execution exist, with model-specific crates still acting as the native compatibility boundary. |
| Media decoding | `packages/scene` asset metadata plus the engine/media decode path | Orientation and ICC metadata are canonicalized before rendering. Vision input must consume that decoded representation and never rewrite source bytes. |
| Masks | `@varve/scene` raster masks, effect masks, and selection masks | Vision segmentation must convert at a boundary into the existing scalar raster-mask/selection representation; a new `MediaPipeMask` type is prohibited. |
| Image placement | `ImageFillData.crop` and `packages/editor/src/imageCrop.ts` | Crop suggestions can persist as source-pixel placement metadata. Node geometry and source pixels stay unchanged. |
| Existing segmentation | Background removal and promptable SAM2 object selection | Person selection must use genuine segmentation. A face box may guide a workflow, but it is not a person mask. |
| Asset search | Semantic embedding/index lane in `@varve/platform` | Visual-awareness requests must not run during ordinary asset indexing unless a separate product requirement justifies the cost. |

The former model manager is no longer the conceptual owner of every future
vision task, but the Rust background-removal crate still owns the native ONNX
compatibility boundary. A large crate extraction is intentionally deferred
until a second native task-specific backend exists and a measured dependency
cycle requires it.

## Capability contracts

The model-independent contracts live in `packages/engine/src/vision/`:

- `types.ts` defines immutable source-revision-aware results for face boxes,
  semantic face anchors, hands, pose, objects, and scalar segmentation masks.
- `service.ts` provides capability routing, priority scheduling, duplicate
  request coalescing, per-capability caching, cancellation checks, and a
  resident model-memory budget.
- `cropSolver.ts` turns face detections into a source-pixel crop suggestion at
  a target aspect ratio. Confidence, relative face size, optional importance,
  safe margins, multiple faces, edge clamping, and no-face fallback are all
  deterministic and unit-testable.

The cache key is `(assetId, sourceRevision, dimensions, backend, backendVersion,
quality, capability)`. Moving, rotating, scaling, or reopening a node does not
invalidate source analysis. Replacing or destructively editing the source must
increment `sourceRevision` and therefore produces a new key.

Requests are grouped when one backend can satisfy all requested capabilities.
Otherwise each capability is routed independently. This means a crop workflow
can request only `FACE_BOUNDS`; an eye anchor can request `FACE_KEYPOINTS`; a
person selection can request `PERSON_MASK`; and a future live motion workflow
can explicitly request face, hand, and pose results together.

## Crop and persistence contract

`suggestFaceAwareCrop()` never changes pixels. It returns a source-pixel crop
window. `commitSourceImageCrop()` stores that window in the existing
`ImageFillData.crop` field and preserves the fill source, node bounds, masks,
undo/reopen semantics, and export path. If no reliable face is available, the
solver returns the ordinary centered crop. The user can always reposition,
scale, reset, or intentionally cut a face after the suggestion.

The solver treats detector confidence as a ranking signal, not a claim of
certainty. Its expanded box is a safety heuristic, not a portrait contour; a
future face-protected effect should use landmarks or an editable mask when
precise facial boundaries matter.

## Runtime decision record

| Candidate | Fit for Varve | Decision |
| --- | --- | --- |
| Existing ONNX Runtime paths | Already present in browser worker and native model infrastructure; CPU fallback, provider selection, checksums, and model lifecycle are available | Default integration path to benchmark first. It minimizes new runtime surface. |
| MediaPipe Tasks | Strong task-specific APIs and modular face/hand/pose/object/segmentation tasks, but task bundles and graph-specific preprocessing must be validated per task | Keep as an adapter candidate, not an editor dependency. Its current privacy notice says Tasks sends performance/utilization metrics to Google, so it cannot be adopted as a silent default under Varve's privacy contract. |
| Direct TFLite/LiteRT | Potentially smaller native surface, but `.task` artifacts may include metadata, preprocessing, postprocessing, and graph assumptions | Evaluate only with a trusted parity fixture. A `.task` file is not assumed to be one callable tensor graph. |
| Candle + safetensors | Useful for a Rust-native architecture when the exact model can be reproduced; safetensors is a weight format, not an inference engine | No first-slice selection. It would add a runtime and conversion/parity burden without a measured benefit for the current ONNX estate. |

The runtime choice remains empirical. Before shipping a face backend, record
cold load, warm p50/p95, preprocessing, postprocessing, peak RAM, model size,
CPU behavior, GPU fallback, and output parity on the same corpus.

The first shipped backend is YuNet (`opencv/face_detection_yunet` 2023mar, MIT,
233 KB), bundled at `apps/desktop/public/models/yunet-face-detect.onnx` with a
SHA-256-pinned manifest entry. It is small enough that bundling removes the
download path entirely, so `Protect Faces` works offline and in CI without a
network dependency. The bundling precedent is u2netp/Real-ESRGAN; larger vision
models must not be silently bundled.

## Model and storage policy

The current manifest already supports composite artifacts, SHA-256, source
provenance, model version, tensor contracts, and explicit acquisition. New
vision artifacts must add task capability metadata, format/runtime, exact
files, preprocessing/postprocessing versions, source revision, license,
attribution, expected size, and checksum. Existing `.onnx` users remain
supported; no unconditional `modelId + '.onnx'` rule may be added to new code.

Native model storage is under the Varve app-data directory. The existing
legacy migration discovers valid files under prior `strata/models` locations,
verifies size/checksum, copies atomically, and leaves the old file untouched.
New visual-awareness models must use the same explicit-download and integrity
verification path.

## Privacy and persistence

- No image, face geometry, landmark, mask, or confidence result is sent to
  analytics, crash reports, or remote services by this subsystem.
- No face recognition or identity template is permitted.
- Model downloads are explicit network operations and are documented as such;
  inference itself is local.
- Auto-crop stores the resolved crop, not raw detector output, unless a future
  feature needs a persisted anchor.
- Editable person/effect masks store the existing mask resource, not a hidden
  model dependency. Reopening a document must not download a model or rerun
  inference to render it.
- MediaPipe Tasks remains blocked until its metrics behavior can be disabled,
  isolated, or replaced with a lower-level implementation that meets the same
  privacy contract.

## Planned vertical slices

1. Add and benchmark a task-specific `FACE_BOUNDS` backend against the service. *(Done: YuNet FACE_BOUNDS + FACE_KEYPOINTS via the shared ONNX worker; decode verified bit-for-bit against OpenCV FaceDetectorYN.)*
2. Connect `Protect Faces` to the existing crop inspector with explicit model,
   analyzing, no-face, unsupported, and download-failure states. *(Done: the model is bundled, so the state is always available; no-face and analyzing states remain.)*
3. Add a landmark backend and semantic anchor resolver for static images.
4. Add precise face-protection masks and compare them with the existing mask
   and background-removal quality corpus.
5. Reuse the existing segmentation boundary for `PERSON_MASK`; do not market
   face detection as person selection.
6. Add hand/pose/object adapters only when an editor workflow consumes them.

Until those slices have a verified backend and browser/native E2E coverage,
the website must describe visual awareness as in development and must not
promise automatic face-aware cropping, face protection, or hand/pose tracking.
