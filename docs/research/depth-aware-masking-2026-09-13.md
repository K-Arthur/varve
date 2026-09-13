# Depth-aware masking research record

**Access date:** 2026-09-13
**Repository:** Varve `master` at `604b22b2b` (the working tree was already
dirty with unrelated multi-agent changes; this record describes the depth
surface at that point).

This is the evidence record for the depth-aware masking repair. It separates
facts verified in the repository from claims made by upstream projects and
from decisions that remain conditional on measurement.

## Primary sources

| Source | Version/date checked | Finding | Decision supported |
|---|---|---|---|
| [Depth Anything V2 repository](https://github.com/DepthAnything/Depth-Anything-V2) | `main`, checked 2026-09-13 | V2 publishes relative-depth models. The Small variant is Apache-2.0; Base/Large/Giant are CC-BY-NC-4.0. The README does not establish metric accuracy or a universal near/far sign. | Keep depth typed as relative unless a separately calibrated input is imported. Verify each model/weight license independently. |
| [Depth Anything V2 paper](https://arxiv.org/abs/2406.09414) | arXiv v2, checked 2026-09-13 | Reports stronger generalization for monocular relative depth; this is not a guarantee of correct object boundaries or metric distance on an arbitrary edit. | Treat generated depth as an editable estimate, not scene geometry or a matte. |
| [Official Depth Anything V2 `dpt.py`](https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/depth_anything_v2/dpt.py) and [`transform.py`](https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/depth_anything_v2/util/transform.py) | `main`, checked 2026-09-13 | Reference preprocessing converts BGR to RGB, scales to [0,1], ImageNet-normalizes, resizes with aspect ratio and a lower-bound multiple-of-14 policy, and uses OpenCV cubic interpolation. The model output is ReLU'd and upsampled with bilinear interpolation. | The app's worker transform and the verification harness must be documented and parity-tested; a local zero-padded letterbox is not automatically equivalent to upstream preprocessing. |
| [Exact ONNX Community model card](https://huggingface.co/onnx-community/depth-anything-v2-small/blob/main/README.md) and [ONNX files](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx) | current `main`, checked 2026-09-13 | `model_int8.onnx` is a Transformers.js-compatible conversion, listed under an Apache-2.0 model card; the repository contains multiple precision/quantization variants. The converted artifact is not the original checkpoint. | Pin the exact local file/hash and conversion provenance. Do not infer that another variant has the same license, operators, precision, or quality. |
| [Lightroom Classic masking help](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html) | current help page, checked 2026-09-13 | Depth Range is available only for photos that contain depth data; the UI exposes near/far range picking, an in-image depth visualization, and mask refinement. | Keep range picking and refinement in the existing Mask/Photo surfaces, expose disabled reasons, and make manual coverage refinement distinct from depth editing. |
| [CSS Masking Level 1](https://www.w3.org/TR/css-masking-1/) | current W3C recommendation, checked 2026-09-13 | Alpha and luminance masks have different meanings; masks modulate visibility rather than changing source pixels. | Preserve mask type/coverage semantics and do not confuse a scalar depth field with alpha. |
| [Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | current W3C recommendation, checked 2026-09-13 | Source-over compositing is defined in premultiplied form; output alpha is `αs + αb(1 - αs)`. | Reuse the existing premultiplied adjustment compositor for localized edits and keep source alpha separate from mask coverage. |
| [OpenCV GuidedFilter](https://docs.opencv.org/4.x/de/d73/classcv_1_1ximgproc_1_1GuidedFilter.html) | OpenCV 4.13.0 docs, checked 2026-09-13 | Guided filtering is an edge-aware filtering primitive with an explicit guidance image and radius/regularization parameters. | Evaluate edge-aware refinement against a no-refinement/bilinear baseline; do not silently imprint every texture edge into depth. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) | current docs, checked 2026-09-13 | Provider availability and priority are runtime-specific; a named provider is not proof that a graph can execute or will be faster. | Capability-check the actual graph/provider and preserve the offline saved-map path when inference is unavailable. |
| [ONNX Runtime Web large-model guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html) | current docs, checked 2026-09-13 | WebAssembly memory is bounded and large models may need external data; this is a platform constraint, not a quality claim. | Keep model creation lazy, bounded, and separate from map editing/rendering. |
| [ONNX Runtime Web WebGL deprecation discussion](https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_remove_webgl_backend.md) | current repository doc, checked 2026-09-13 | WebGL is being retired in favour of WebGPU/WASM paths. | Do not advertise WebGL as a required or preferred depth provider and do not silently substitute providers. |
| [PNG Specification, Third Edition](https://www.w3.org/TR/png-3/) | current W3C spec, checked 2026-09-13 | Grayscale PNG can carry 1/2/4/8/16-bit samples, but bit depth is per sample and browser `ImageData` is not a generic 16-bit scalar decoder. | Only accept an import path that reads and validates the actual sample precision; an opaque grayscale alpha channel is not no-data metadata. |
| [OpenEXR technical introduction](https://openexr.com/en/latest/TechnicalIntroduction.html) | current OpenEXR docs, checked 2026-09-13 | EXR can carry arbitrary named channels, including `Z`, and preserves HALF/FLOAT/UINT channel types. `Z` has a conventional meaning only in the documented deep-data context; arbitrary channels still need an application profile. | Defer EXR import until Varve has an actual EXR decoder and an explicit channel/profile contract; never treat a filename as proof of depth. |
| [Apple `AVDepthData`](https://developer.apple.com/documentation/avfoundation/avdepthdata) | current docs, checked 2026-09-13 | Camera depth/disparity includes map type, calibration, lens distortion and orientation transformations; depth is metres while disparity is inverse metres. A map is registered to the accompanying image, not automatically a world-space point cloud. | Do not claim embedded camera-depth support until the container decoder, calibration, orientation and registration path are implemented. |
| [Android `ImageFormat.DEPTH16`](https://developer.android.com/reference/android/graphics/ImageFormat#DEPTH16) and [Dynamic Depth 1.0](https://developer.android.com/static/media/camera/camera2/Dynamic-depth-v1.0.pdf) | current docs/spec, checked 2026-09-13 | DEPTH16 packs millimetre range and confidence bits; Dynamic Depth requires correlated, rectified image/depth assets and metadata. | No silent Android/iPhone extraction from ordinary JPEG/HEIC. Imported profiles must state units, confidence/no-data and registration. |

## Repository evidence and reproduced risks

The following are static findings from call-site inspection; they are not all
runtime failures yet.

| User task | Evidence | Classification | Repair owner |
|---|---|---|---|
| Create a depth mask without blur | `LensBlurSection` evaluates `depthRangeToMask`, then calls `commitRasterMask` with `method: 'quick'`; depth is loaded only through a `depthBlur` effect reference. | Partially wired / misleading provenance | Shared depth-mask workflow + existing raster-mask owner |
| Reopen and revise a range | Raster mask stores a PNG and background-removal provenance, but no map/range/falloff/correction recipe. | Baked-only; not re-editable | Minimal `RasterMaskData.depthRecipe` extension |
| Reuse a map after removing blur | Blur removal scans node `depthBlur` effects only; document closure and node deletion do not include depth-map references from masks. | Reproduced static ownership gap | Central depth reachability helper |
| Preserve an existing mask | `commitRasterMask` updates/replaces the current raster asset without a combine argument. | Incorrect default for requested workflow | Shared soft coverage algebra + explicit Replace/Intersect/Union/Subtract |
| Inspect a preview and pick a value | Preview width/height are independently capped; `putImageData` writes native pixels without scaling. | Reproducible geometry risk | Shared contain layout + pointer mapping |
| Cancel only this generation | `LensBlurSection` calls `getInferenceWorkerHost().dispose()` on cancel/unmount. Host disposal rejects/terminates every pending job in the shared worker. | Reproduced shared-lifecycle bug | Owner-aware cancellation / discard-on-completion |
| Import a scalar map offline | No bounded depth resource importer is exposed from the existing import workflow. | Unreachable | Existing import/resource service + explicit profile |
| Preserve semantic distinction | `packages/engine/src/inference/models/depth.ts` exposes another 8-bit depth shape (`0=far,255=near`); `intelligence/depthEffects.ts` defines a heuristic competing `DepthMap`. | Duplicated / dead legacy surfaces | Canonical adapter or explicit deprecation; no new consumer |
| Validate persisted maps | `deserializeDepthMap` checks payload length but not bounded dimensions, finite metadata, validity byte values, or resource byte-length agreement. | Partially hardened | Canonical codec validation |
| Match the upstream model | The app worker and verifier document zero-padded 518 square letterboxing; upstream source uses aspect-ratio lower-bound resize with OpenCV interpolation. | Unresolved parity decision | Re-run exact checkpoint with both transforms before changing production preprocessing |

The local checkpoint was independently checked on 2026-09-13:

```text
file: apps/desktop/public/models/depth_anything_v2_small_int8.onnx
bytes: 27,258,801
sha256: 01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001
installed onnxruntime-node / onnxruntime-web: 1.27.0
```

The checked-in validation report says `ort_version: "unknown"` and records
roughly 264–361 seconds for its three-fixture run, while its older prose says
roughly 10–20 seconds. That contradiction is a validation-report defect, not
evidence of a usable latency budget. The report also records opposite raw
near/far order on its synthetic corridor versus the other fixtures. A
per-image sign flip cannot be justified by a self-consistency score alone;
the accepted contract therefore keeps the raw convention explicit and
requires a reviewed model/reference fixture before any adapter change.

## What users report failing elsewhere

These reports are workflow evidence, not proof of another application's
implementation. They identify failure modes Varve can realistically avoid:

| Report | Failure pattern | Varve response |
|---|---|---|
| [Adobe Community: depth option unavailable](https://community.adobe.com/questions-675/lightroom-8-update-problem-with-depth-range-mask-937311) and [Lightroom Queen: depth range greyed out](https://www.lightroomqueen.com/community/threads/depth-range-mask-always-greyed-out.37971/) | Users cannot tell why a depth control is disabled or which capture formats provide depth. | Show source identity, map status, relative/metric meaning and a concrete recovery action; support explicit map import/generation rather than a mysterious grey control. |
| [Blackmagic forum: Magic Mask/Depth Map hair and temporal artifacts](https://forum.blackmagicdesign.com/viewtopic.php?f=21&start=0&t=219557&uid=16) | Hair, motion blur, thin structures and changing backgrounds do not behave like clean mattes. | Label depth selection as coverage guidance, provide add/subtract/protect refinement and matting/segmentation as explicit additional operations, and avoid claiming subject extraction. |
| [Affinity forum: external depth-map use](https://forum.affinity.serif.com/index.php?%2Ftopic%2F14825-is-it-possible-to-take-a-depth-map-from-3d-software-and-use-it-to-drive-a-lens-blur%2F=) | Users want to load a depth map, choose a focus/range and reuse it instead of regenerating. | Make accepted maps reusable and offline, with explicit orientation, convention, units and alignment fields. |
| [Affinity forum: missing mask management controls](https://forum.affinity.serif.com/index.php?%2Ftopic%2F175043-why-are-layer-management-tools-missing-in-develop-persona%E2%80%8B-%F0%9F%98%97%E2%80%8B%2F=) | Users ask for show/hide, invert, copy/fix and range-like mask controls. | Reuse the existing Mask/Selection controls and add visible bypass, invert, reset, before/after and combine choices. |
| [Lightroom user report: depth mask selects background](https://www.reddit.com/r/Lightroom/comments/1hjptfq) | A generated depth range can include the wrong surface and there is no adequate correction path. | Preserve manual corrections independently from range edits and expose the active refinement target. |

## Decision log

1. **One canonical depth contract.** Keep `packages/engine/src/depthMap.ts`
   as the only continuous-field contract. Legacy 8-bit APIs may remain as
   compatibility adapters but must not become new storage or UI paths.
2. **Relative means relative.** Generated Depth Anything V2 values are not
   presented as metres. Metric or camera data require an import profile that
   preserves units and calibration metadata.
3. **Coverage is not depth.** A depth range produces bounded coverage; a
   raster mask remains the existing mask owner. A recipe records the map and
   range while a resolved PNG keeps rendering fast and model-free.
4. **Validity is not confidence.** Invalid/no-data samples stay unselected,
   including after inversion. A quality field is only added when its origin
   is explicit; no probability is inferred from smoothness.
5. **No new depth workspace or engine.** Generation, import, inspection,
   range-picking and refinement are states in existing Mask/Photo/Selection
   surfaces. The legacy heuristic effect helper remains outside the new path
   and is not advertised as depth estimation.
6. **No automatic sign guessing.** Convention reversal and mask inversion
   are separate user-visible actions. The model adapter changes only after
   checkpoint/reference parity evidence supports it.
7. **Model-free editing is a release requirement.** Loading a saved map,
   changing a recipe, painting coverage, reopening and exporting a resolved
   result must not instantiate the inference runtime.
