# Inference Pipeline Audit — 2026-07-21

Audit of Strata's on-device ML inference platform against the model roadmap
and stated objectives. Focus: correctness, completeness, and connectivity of
existing implementations.

## Audit Method

1. Traced every inference feature from UI component through editor context,
   worker, model session, postprocessing, and document mutation.
2. Verified model files, manifests, hashes, and URLs against filesystem.
3. Ran existing targeted tests before and after changes.
4. Verified typecheck and lint on all touched files.

## Findings

### Critical Bugs Fixed

| # | Symptom | Root Cause | Fix |
|---|---------|-----------|-----|
| 1 | SCUNet crashes on any non-512x512 image | `preprocessScunet` packed raw image data at arbitrary dimensions; model expects fixed 512x512 | Added `letterboxResize` to always resize to 512x512 before packing |
| 2 | SAM2 segmentation fails with "Unknown model type: sam2" | `WorkerModelType` included `'sam2'` but only `'depth'` was registered in `modelRegistry` | Added `registerModelType('sam2', {...})` with prompt encoding |
| 3 | Lens Blur "Apply" button does nothing | `handleApply` was a no-op that set an error message | Implemented actual lens blur application via `applyLensBlur` + `insertDerivedImageShape` |
| 4 | AdaptiveContrastSection not reachable | Component existed but was not wired into PropertiesPanel or sectionRegistry | Added to PropertiesPanel (text-node guard) and sectionRegistry |

### Model Assumption Corrections

| Assumption | Reality | Impact |
|-----------|---------|--------|
| SCUNet is bundled | NOT bundled — no `scunet.onnx` in `public/models/`, `sha256: null` in manifest | Requires download; cannot work offline-first |
| SAM2 is bundled | NOT bundled — no model file, no URL, no SHA256 | Cannot work without model acquisition |
| Depth-Anything is bundled | NOT bundled — no model file; LensBlurSection URL points to non-existent GitHub release | Cannot work without model acquisition |
| TrOCR is full PaddleOCR | Codebase implements a simplified single-model TrOCR (printed Latin only), not the multi-component PaddleOCR system | OCR limited to printed Latin text; no handwriting, no complex scripts |
| SAM2 is single-model | SAM2 typically requires separate image-encoder + prompt-decoder ONNX exports | Manifest now notes `components: ["sam2-hiera-tiny-encoder", "sam2-hiera-tiny-decoder"]` |

### Architecture Gaps Identified

1. **Model loader scope**: `AVAILABLE_MODELS` in `backgroundRemoval/modelLoader.ts` only covers bg-removal and upscale models. SCUNet, SAM2, and depth are not registered there, so the shared download/integrity infrastructure does not apply to them.

2. **Worker preprocessing mismatch**: The worker's `inferenceWorker.ts` uses `packNchwTensor` (ImageNet normalization) for all models, but SCUNet uses `/255` only (no normalization). This is why SCUNet runs via `denoiseDirect` (main-thread) instead of the worker. Correct but undocumented.

3. **Prompt encoding in worker**: The worker's prompt-to-input matching now uses name-based matching (case-insensitive fallback) instead of sequential ordering. This is more robust but depends on the ONNX graph's actual input names matching the encoded keys.

4. **Stale result handling**: `useSam2Segmentation` uses a generation counter for stale rejection. The worker itself does not cancel in-flight requests on new submissions — the main thread rejects stale results after they return.

### Model Files Present

| Model | File | Size | Bundled |
|-------|------|------|---------|
| U2-Net Light (FP32) | `u2netp.onnx` | 4.6 MB | Yes |
| U2-Net Light (INT8) | `quantized/u2netp-int8.onnx` | 1.3 MB | Yes |
| Real-ESRGAN x4 (FP32) | `realesr-general-x4v3.onnx` | 4.9 MB | Yes |
| Real-ESRGAN x4 (INT8) | `quantized/realesr-general-x4v3-int8.onnx` | 1.3 MB | Yes |
| SCUNet | — | ~18 MB | No (download) |
| SAM2 Hiera Tiny | — | ~39 MB | No (download) |
| Depth-Anything-V2 Small | — | ~25 MB | No (download) |

### Test Coverage Added

- `packages/engine/src/inference/scunet.test.ts`: +4 tests (resize to 512x512, large images, non-square, any-size acceptance)
- `packages/engine/src/inference/inferenceWorker.test.ts`: 3 new tests (registry exports, depth registration, sam2 registration with prompt encoding)

### Files Modified

| File | Change |
|------|--------|
| `packages/engine/src/inference/models/scunet.ts` | Added letterbox resize to 512x512 in preprocessing; relaxed validation |
| `packages/engine/src/inference/inferenceWorker.ts` | Registered SAM2 model type with prompt encoding; improved input name matching |
| `packages/engine/src/inference/scunet.test.ts` | Updated tests for resize behavior |
| `packages/engine/src/inference/inferenceWorker.test.ts` | New test file |
| `packages/editor/src/components/Inspector/PropertiesPanel.tsx` | Wired AdaptiveContrastSection for text nodes |
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | Added adaptive-contrast section definition |
| `packages/editor/src/components/Inspector/sections/LensBlurSection.tsx` | Fixed handleApply to actually apply lens blur |
| `apps/desktop/public/models/manifest.json` | Added sam2-hiera-tiny and depth-anything-v2-small entries |

## Remaining Work (Not Done)

1. **Model acquisition**: SCUNet, SAM2, and Depth-Anything need real download URLs, SHA256 checksums, and license verification before they can be shipped.

2. **SAM2 multi-model pipeline**: The current implementation assumes a single ONNX file. Real SAM2 requires separate encoder + decoder exports with cached embeddings.

3. **Depth-Anything URL**: The LensBlurSection hardcoded URL points to a non-existent GitHub release. Needs verified source.

4. **Model loader unification**: SCUNet, SAM2, and depth should be registered in the shared model loader (`AVAILABLE_MODELS`) for consistent download, integrity checking, and lifecycle management.

5. **New model vertical slices**: PaddleOCR, LaMa, RIFE, SigLIP, classification, and text-guided detection are not implemented. Each requires: model research, license verification, ONNX export validation, preprocessing/postprocessing, worker registration, UI, and tests.

6. **Performance benchmarking**: No benchmarks exist for any model on representative hardware. The `motion.bench.test.ts` pattern should be extended to inference.

7. **E2E tests**: No Playwright E2E tests for inference workflows exist. The canvas/tools.spec.ts pattern should be extended.
