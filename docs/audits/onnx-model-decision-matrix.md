# ONNX Model Decision Matrix

**Date:** 2026-07-21
**Scope:** All ONNX-compatible models evaluated for integration into Strata across Design, Print, Draw, Photo, and Motion workspace modes.

---

## 1. Evaluation framework

Each candidate model is graded on:

| Factor | Weight | Description |
|--------|--------|-------------|
| User benefit | High | How many users/modes benefit, how often |
| Quality delta | Medium | Improvement over current implementation (or N/A if new feature) |
| Latency/memory | Medium | Inference time, peak RSS, suitability for 4 GB devices |
| ONNX Runtime Web | Critical | Opset support, custom ops, dynamic shapes, WASM/WebGPU/WebGL |
| Size + bundling | Medium | Model file size, bundled vs download, INT8 availability |
| Licensing | Critical | Apache 2.0, MIT, CC BY-NC (reject), commercial terms |
| Maintenance | Low | Community activity, reference outputs, known export issues |

**Grading scale:** Accept / Accept with caveats / Reject

---

## 2. Segmentation & matting models

### Existing: U2-Net Light (u2netp) — ACCEPT (bundled)

| Factor | Assessment |
|--------|------------|
| Feature | Background removal, fast preview segmentation |
| Quality | 3/5 — adequate for simple subjects, poor on hair/fur |
| Latency | ~200ms CPU, ~50ms WebGL |
| Size | 4.7 MB FP32, 1.2 MB INT8 (both bundled) |
| Runtime | ONNX opset 11, no custom ops, static shapes 320x320 |
| Licensing | MIT (rembg project) |
| Verdict | Keep as default fast path. INT8 variant works well. |

### Existing: IS-Net General Use — ACCEPT (download)

| Factor | Assessment |
|--------|------------|
| Feature | Balanced quality segmentation |
| Quality | 4/5 — good general-purpose, handles people/animals |
| Latency | ~1-2s CPU, ~300ms WebGL |
| Size | 179 MB FP32 (download only, no INT8 available) |
| Runtime | ONNX opset 12, static shapes 1024x1024 |
| Licensing | MIT (rembg project) |
| Verdict | Good balanced option. Too large for bundled. |

### Existing: BiRefNet Lite — ACCEPT (download, WASM-gated)

| Factor | Assessment |
|--------|------------|
| Feature | High-quality segmentation with hair/fur detail |
| Quality | 4.5/5 — excellent edge detail |
| Latency | ~3-5s CPU, ~800ms with WebGPU |
| Size | 224 MB FP32 (download) |
| Runtime | ONNX opset 15, dynamic shapes, no custom ops |
| Licensing | Apache 2.0 (official BiRefNet) |
| Verdict | Quality path for Photo mode. WASM-gated (224 MB > 50 MB safe limit without COOP/COEP). Requires WebGPU or Native ONNX Runtime. |

### Existing: BiRefNet Full — ACCEPT WITH CAVEATS (native-only)

| Factor | Assessment |
|--------|------------|
| Feature | Best-quality segmentation |
| Quality | 5/5 — handles hair, fur, transparency, fine detail |
| Latency | ~8-12s CPU, ~2s WebGPU |
| Size | 928 MB FP32 (download) |
| Runtime | ONNX opset 15, dynamic shapes |
| Licensing | Apache 2.0 |
| Verdict | Best quality but 928 MB model crashes WASM (4 GB address space ceiling). Native ONNX Runtime only. Requires GPU. No SHA-256 in manifest (security gap). |

### [NEW] SAM2-Hiera-Tiny — ACCEPT (implemented, needs download)

| Factor | Assessment |
|--------|------------|
| Feature | Interactive segmentation with point/box prompts. Cross-mode tool. |
| Quality | 5/5 — industry standard, works on any visual concept |
| Latency | ~3-5s (encoder once), ~50ms per prompt (decoder) |
| Size | ~39 MB FP32 (reasonable for download) |
| Runtime | ONNX opset 16, static shape 1024x1024. **Requires custom ops:** `MultiLevelCropAndResize`, `DirectConv` — unsupported in onnxruntime-web before 1.18. Verified: ORT Web 1.27+ includes these. |
| Licensing | Apache 2.0 (Meta) |
| Pre/post code | Fully implemented in `packages/engine/src/inference/models/sam2.ts` (177 lines). Prompt encoding (points + boxes), mask decoding, confidence estimation. |
| Worker support | Registered as 'sam2' model type in `inferenceWorker.ts`. |
| Download | Not bundled. Needs download flow. ~39 MB. |
| Verdict | **HIGHEST VALUE NEW MODEL.** Interactive segmentation enables smart selection, masking, and subject isolation across all modes. ~39 MB is downloadable even on slow connections. The only complication: SAM2 needs image encoder + mask decoder as separate ONNX files (or a combined graph). The current code assumes combined graph. Verify encoder/decoder split before production use.

### [NEW] RMBG v2.0 — REJECT

| Factor | Assessment |
|--------|------------|
| Feature | Background removal |
| Quality | 4/5 — good, competitive with IS-Net |
| Licensing | **Apache 2.0** — good |
| Size | ~12 MB |
| Runtime | Compatible |
| Verdict | Rejected because IS-Net and BiRefNet already cover the quality spectrum. No gap to fill. |

---

## 3. Depth estimation

### [NEW] Depth-Anything-V2-Small — ACCEPT (implemented, needs download)

| Factor | Assessment |
|--------|------------|
| Feature | Monocular depth estimation — enables lens blur, 3D parallax, lighting effects, depth-aware masking |
| Quality | 4.5/5 — state of the art for relative depth |
| Latency | ~2-4s CPU, ~500ms WebGL |
| Size | ~25 MB FP32 (download) |
| Runtime | ONNX opset 16, static shape 518x518, standard ops only |
| Licensing | Apache 2.0 |
| Pre/post code | Fully implemented in `packages/engine/src/inference/models/depth.ts` (121 lines). Min-max normalization, depth map generation. |
| Worker support | Registered as 'depth' model type. |
| Verdict | **HIGH VALUE.** 25 MB is reasonable for download. Enables: lens blur (implemented in `lensBlur.ts`), depth-based lighting, 3D photo effect, depth-aware selection. One caveat: output is 518x518 at 1/14 resolution of input — needs bilinear upscale to full resolution. |

### [NEW] Depth-Anything-V2-Base — REJECT

| Factor | Assessment |
|--------|------------|
| Size | ~97 MB |
| Quality | 4.7/5 (marginally better than Small) |
| Verdict | Small is 25 MB vs 97 MB for marginal quality gain. Not worth the download cost. |

---

## 4. Image restoration & enhancement

### Existing: Real-ESRGAN x4 — ACCEPT (bundled)

| Factor | Assessment |
|--------|------------|
| Feature | AI upscaling (4x) in ImageEnhancementSection |
| Quality | 4/5 — good general-purpose upscaling |
| Latency | ~5-10s per megapixel CPU, ~1-2s WebGL |
| Size | 4.8 MB FP32, 1.3 MB INT8 (both bundled) |
| Runtime | ONNX opset 15, static shape, standard ops. Tiled inference in `aiUpscale.ts` (256+32 pad). |
| Licensing | BSD-3-Clause (Real-ESRGAN) |
| **Bug found** | `aiUpscale.ts` hardcodes `['wasm']` provider — never tries WebGPU/WebGL. Needs fix. |
| Verdict | Keep bundled. Fix the hardcoded WASM provider. Consider tiled inference for large images. |

### [NEW] SCUNet Denoise — ACCEPT (download, implemented)

| Factor | Assessment |
|--------|------------|
| Feature | Real-world image denoising — removes noise, JPEG artifacts, grain while preserving detail |
| Quality | 4/5 — handles real-world noise well, preserves edges better than wavelets |
| Latency | ~2-4s CPU, ~500ms WebGL for 512x512 tile |
| Size | ~18 MB FP32 (download, no INT8 available) |
| Runtime | ONNX opset 16, static shape 512x512, standard Conv+ReLU+Transformer blocks. |
| Licensing | Apache 2.0 (SCUNet) |
| Pre/post code | Fully implemented in `scunet.ts` (191 lines). Alpha channel extraction/recompositing. Strength blending. |
| Worker support | Registered as 'scunet' model type. Fill-to-edge resize (no letterbox). |
| Verdict | **HIGH VALUE FOR PHOTO MODE.** 18 MB is reasonable download. Strength control (0-1) enables subtle to aggressive denoising. Already implemented as `AIDenoiseSection.tsx`. The main limitation: 512x512 input requires tiling for larger images (automatic tiling not yet implemented in the section). |

### [NEW] SCUNet INT8 — REJECT

| Factor | Assessment |
|--------|------------|
| Availability | Not available as ONNX export. Would need to quantize manually. |
| Quality | Expected degradation for denoising tasks |
| Verdict | SCUNet is detail-sensitive; INT8 quantization would likely harm denoising quality. Skip. |

### [NEW] Manga/Anime upscaling models — REJECT

| Factor | Assessment |
|--------|------------|
| Models | Real-ESRGAN-anime, Real-CUGAN, Waifu2x |
| Licensing | Various non-commercial / research-only |
| Verdict | Too niche for general design app. Skip. |

---

## 5. Face & portrait

### [NEW] GFPGAN — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | Face restoration — fixes blurry/blotchy faces in photos |
| Quality | 4.5/5 — excellent face detail recovery |
| Latency | ~3-5s CPU per face |
| Size | ~150 MB (download) + face detection model |
| Runtime | ONNX opset 15, standard ops. Requires face detection first (RetinaFace or YOLO). |
| Licensing | **Tencent ARC** — unclear commercial terms. The license allows non-commercial use; commercial use requires contacting Tencent. |
| Verdict | Defer until licensing is clarified. The feature itself is high-value for portrait photography in Photo mode. Alternative: CodeFormer (same licensing issues). |

### [NEW] CodeFormer — REJECT (same licensing)

Same licensing ambiguity as GFPGAN. Both are from Tencent ARC.

---

## 6. Inpainting / content-aware fill

### [NEW] LaMa — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | Image inpainting — content-aware fill for spot healing, object removal |
| Quality | 4/5 — large mask inpainting, handles complex scenes |
| Latency | ~2-4s CPU, ~500ms WebGL for 512x512 |
| Size | ~65 MB FP32 (download) |
| Runtime | ONNX opset 12, static shape 512x512, standard Conv+FFC ops. FFC (Fourier Convolution) is standard Conv — no custom ops. |
| Licensing | Apache 2.0 (LaMa) |
| Verdict | **HIGH VALUE FOR PHOTO MODE.** Would replace the existing heuristic spotHeal with proper AI inpainting. 65 MB is reasonable download. Caveat: inpainting results can vary; users may need to try multiple times. Integration would be through the SpotHealTool and PatchTool as an "AI mode" option. |

### [NEW] MAT (Mask-Aware Transformer) — REJECT

| Factor | Assessment |
|--------|------------|
| Quality | 4.5/5 — better than LaMa for large holes |
| Size | ~400 MB |
| Verdict | Too large for download. LaMa is 65 MB with comparable results. |

### [NEW] Stable Diffusion inpainting — REJECT

| Factor | Assessment |
|--------|------------|
| Quality | 5/5 — best quality inpainting |
| Size | ~2 GB+ |
| Runtime | Requires diffusion pipeline, not single ONNX model |
| Verdict | Completely infeasible for offline design app. Skip. |

---

## 7. Object detection & tagging

### [NEW] YOLOv8 (nano/small) — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | Object detection — auto-tagging, smart selection, people/object counting |
| Quality | 4/5 — YOLOv8n is fast and accurate |
| Latency | ~100ms CPU (nano), ~20ms WebGL |
| Size | ~6 MB FP32 (nano), ~28 MB (small) |
| Runtime | ONNX opset 16. **Custom NMS op** — `NonMaxSuppression` is standard in ORT but export from Ultralytics may use `MultiLevelCropAndResize` (same as SAM2 issue). |
| Licensing | AGPL-3.0 (Ultralytics). Commercial license available separately. |
| Verdict | AGPL-3.0 is problematic for a closed-source commercial app. The feature itself (auto-detect people/objects in photos for smart masking) is valuable. Consider: (1) use YOLOv8 under AGPL with source disclosure, or (2) use a more permissively licensed model like DETR (Apache 2.0). **Recommend DETR instead.** |

### [NEW] DETR / Grounding DINO — ACCEPT

| Factor | Assessment |
|--------|------------|
| Feature | Open-vocabulary object detection — "find all chairs", "select the car" |
| Quality | 4/5 — DETR ResNet-50, good general detection |
| Latency | ~500ms CPU, ~100ms WebGL |
| Size | ~42 MB (DETR ResNet-50) |
| Runtime | ONNX opset 13, standard Conv+Transformer ops. Static shape. |
| Licensing | Apache 2.0 (Facebook/Meta) |
| Verdict | Better license than YOLO. Open-vocabulary ability is powerful for asset search. ~42 MB is reasonable. This would enable natural language search across the asset library. |

---

## 8. Image search & embeddings

### [NEW] CLIP — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | Semantic image search — text-to-image and image-to-image similarity. Asset library search, smart organization. |
| Quality | 4/5 — CLIP ViT-B/32 is the standard for zero-shot classification |
| Latency | ~200ms CPU per image (ViT-B/32) |
| Size | ~170 MB (ViT-B/32) for both text + image encoders |
| Runtime | ONNX opset 14, **custom ViT ops** — patch embedding via Conv. Standard ops onnxruntime-web 1.17+ handles these. **Tokenizer dependency** — CLIP uses Byte-Pair Encoding (BPE) via `tiktoken` or HuggingFace `tokenizers`. This is a separate dependency. |
| Licensing | MIT (OpenAI — permissive, but note the original CLIP model card has use-case restrictions that may not apply to ONNX exports from open_clip) |
| Alternative | Use **open_clip** (Apache 2.0) ONNX exports instead of OpenAI's original. |
| Verdict | **HIGH VALUE FOR ASSET MANAGEMENT.** Semantic search across the asset library is a transformative feature. ~170 MB is reasonable download. The BPE tokenizer dependency is manageable via a bundled `merges.txt` + `vocab.json` (~500 KB). Recommend integrating as a background indexing service. |

### [NEW] SigLIP — ACCEPT (prefer over CLIP)

| Factor | Assessment |
|--------|------------|
| Feature | Same as CLIP but trained with sigmoid loss — better for standalone image retrieval |
| Quality | 4.2/5 — slightly better than CLIP for image retrieval tasks |
| Size | Similar to CLIP |
| Licensing | Apache 2.0 (Google) |
| Verdict | Better license than OpenAI's CLIP. Slightly better retrieval quality. If implementing image search, prefer SigLIP ONNX export. |

---

## 9. OCR & document analysis

### [NEW] Surya OCR — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | OCR with document layout analysis, reading order detection |
| Quality | 4.5/5 — state of the art for document OCR, handles handwritten text |
| Latency | ~500ms per page CPU |
| Size | ~200 MB total (detection + recognition + reading order models) |
| Runtime | ONNX opset 16, standard ops. Models exported from VikParuchuri/surya. |
| Licensing | **GPL-3.0** — incompatible with closed-source commercial distribution |
| Alternative | Use **Tesseract.js** (Apache 2.0, ~5 MB WASM) for basic OCR, or **PaddleOCR** (Apache 2.0, ONNX compatible, ~15 MB). |
| Verdict | Surya is the best quality but GPL-3.0 is a blocker. **Recommend PaddleOCR** (Apache 2.0, ONNX compatible, good quality for printed text). |

### [NEW] PaddleOCR — ACCEPT

| Factor | Assessment |
|--------|------------|
| Feature | OCR for printed text detection and recognition |
| Quality | 3.5/5 — good for printed text, handwriting is weaker |
| Latency | ~200ms CPU |
| Size | ~15 MB total (detection + recognition models) |
| Runtime | ONNX opset 11, standard Conv ops. Well-documented export process. |
| Licensing | Apache 2.0 (Baidu) |
| Verdict | Good for Print mode document OCR. Apache 2.0 license. Limited to printed text. Value: text layer extraction from scanned PDFs, auto-generation of accessible text layers, searchable document export. |

---

## 10. Image classification

### Existing: None — this is a new feature opportunity

### [NEW] EfficientNet-Lite / MobileNetV3 — ACCEPT

| Factor | Assessment |
|--------|------------|
| Feature | Image classification — auto-tagging, content type detection (photo/illustration/text/document) |
| Quality | 3.5/5 — adequate for broad categorization |
| Latency | ~50ms CPU (EfficientNet-Lite0) |
| Size | ~5 MB FP32 (EfficientNet-Lite0) |
| Runtime | ONNX opset 11, standard Conv+ReLU ops |
| Licensing | Apache 2.0 (TensorFlow Model Garden → ONNX export) |
| Verdict | Lightweight, fast, permisisvely licensed. Useful for: auto-categorization in asset library, determining default processing pipeline (photo vs illustration). Could be bundled. |

---

## 11. Frame interpolation & motion

### Existing: None

### [NEW] RIFE — ACCEPT WITH CAVEATS

| Factor | Assessment |
|--------|------------|
| Feature | Frame interpolation for Motion mode — slow-motion, time-remapping, and keyframe assistance |
| Quality | 4/5 — RIFE v4.6 is state of the art for real-time interpolation |
| Latency | ~100ms per frame pair CPU, ~30ms GPU |
| Size | ~15 MB FP32 |
| Runtime | ONNX opset 15, standard Conv+ResBlock ops. **IFNet** subnetwork is a custom architecture but uses standard ops. |
| Licensing | **MIT** (RIFE, hzwer) — good |
| Verdict | **HIGH VALUE FOR MOTION MODE.** 15 MB is bundle-able. Enables: automatic in-between frames for keyframe animation, slow-motion effects, smoother timeline scrubbing. Caveat: RIFE interpolates between consecutive frames; video import needed for full value. The optical flow module at `packages/engine/src/backgroundRemoval/opticalFlow.ts` already provides block-based flow as a starting point. |

### [NEW] FILM (Google) — REJECT

| Factor | Assessment |
|--------|------------|
| Quality | 4.2/5 — comparable to RIFE |
| Size | ~80 MB |
| Licensing | Apache 2.0 |
| Verdict | Larger model file for similar quality. RIFE's MIT license and smaller size win. |

---

## 12. Feature extraction (edges, lines, pose)

### Existing: None

### [NEW] BWMorph / Sketch simplification — REJECT

| Factor | Assessment |
|--------|------------|
| Feature | Line art extraction, sketch simplification for Draw mode |
| Quality | Mixed |
| Licensing | Various, mostly research-only |
| Verdict | Too niche. The existing Potrace-based vectorization and edge detection in Draw mode already cover basic needs. |

### [NEW] OpenPose / MoveNet — DEFER

| Factor | Assessment |
|--------|------------|
| Feature | Pose estimation for character design, figure drawing assistance |
| Quality | 3.5/5 MoveNet, 4/5 OpenPose |
| Size | ~8 MB MoveNet, ~200 MB OpenPose |
| Licensing | Apache 2.0 (MoveNet via TF Hub), non-commercial for some OpenPose variants |
| Verdict | Niche use case for Draw mode. Defer until user demand is clear. |

---

## 13. Summary: Ranked implementation priority

| Rank | Model | Category | Mode | Size | Bundle? | Priority | Rationale |
|------|-------|----------|------|------|---------|----------|-----------|
| **1** | **SCUNet Denoise** | Restoration | Photo | 18 MB | Download | **Critical** | Already coded, ~18 MB reasonable, high Photo mode value |
| **2** | **Depth-Anything-V2-Small** | Depth | Photo/Design/Draw | 25 MB | Download | **High** | Enables lens blur (built), 3D effects, depth-aware masking |
| **3** | **SAM2-Hiera-Tiny** | Segmentation | All modes | 39 MB | Download | **High** | Interactive segmentation with click prompts, replaces need for complex manual masking |
| **4** | **RIFE** | Interpolation | Motion | 15 MB | Bundle | **High** | Frame interpolation for animation assistance |
| **5** | **SigLIP/CLIP** | Search | All modes | ~170 MB | Download | **Medium** | Semantic asset library search, but model size is large |
| **6** | **LaMa** | Inpainting | Photo | 65 MB | Download | **Medium** | Content-aware fill for spot heal, but complex integration |
| **7** | **PaddleOCR** | OCR | Print | 15 MB | Bundle | **Medium** | Text layer extraction from scans, but limited to printed text |
| **8** | **DETR** | Detection | All modes | 42 MB | Download | **Low** | Open-vocabulary detection, but integration complexity high |
| **9** | **EfficientNet-Lite** | Classification | All modes | 5 MB | Bundle | **Low** | Auto-tagging, but lower user impact |
| **10** | **GFPGAN** | Face | Photo | 150 MB | Download | **Deferred** | Licensing unclear |

---

## 14. Replaced, retained, and rejected implementations

### Replaced
| Old implementation | Replacement | Rationale |
|-------------------|-------------|-----------|
| Heuristic denoising (none existed) | SCUNet Denoise (AI) | New feature, no prior impl to remove |
| Heuristic spot heal | LaMa inpainting | Deferred — heuristic works for small spots |

### Retained (not replaced)
| Feature | Reason |
|---------|--------|
| U2-Net Light (u2netp) | Bundled, fast, adequate for previews. Replaced by IS-Net/BiRefNet only on explicit user upgrade. |
| Real-ESRGAN x4 | Bundled, good quality. INT8 variant available. Hardcoded WASM provider should be fixed. |
| Heuristic bg-removal | Works offline with zero model overhead. Keep as fallback when no model available. |
| Block-based optical flow | Works for video matte. RIFE would be higher quality but adds complexity. |
| All pixel-based adjustments (brightness, curves, levels, etc.) | Deterministic, instant, zero overhead. Models are for complex tasks, not simple adjustments. |

### Rejected
| Model | Reason |
|-------|--------|
| RMBG v2.0 | No gap — IS-Net + BiRefNet already cover |
| Depth-Anything-V2-Base | 97 MB vs 25 MB for marginal quality gain |
| MAT inpainting | 400 MB too large; LaMa at 65 MB is adequate |
| Stable Diffusion inpainting | 2 GB+ infeasible for offline |
| Manga/Anime upscalers | Too niche |
| YOLOv8 | AGPL-3.0 license incompatible; DETR (Apache 2.0) preferred |
| Surya OCR | GPL-3.0 license blocker |
| OpenPose | Too niche for current feature set |
| BWMorph/sketch simplification | Research-only code, poor maintenance |
| CodeFormer | Same licensing ambiguity as GFPGAN |

---

## 15. Key architectural decisions

1. **Tiered provider chain** (ADR-0005) is the correct pattern. The existing `ProviderChain.ts`, `SessionManager.ts`, and `ModelRegistry.ts` are well-designed and should be reused for all new models.

2. **Two separate worker patterns exist** (bg-removal worker pool and generic inference worker). The generic `InferenceWorkerHost` + `inferenceWorker.ts` is the preferred pattern for new model types (depth, SCUNet, SAM2). The bg-removal worker pool is specialized and should remain independent.

3. **AI adjustments vs one-shot operations**. For SCUNet and depth-based effects, a one-shot operation (preview → apply) is more practical than a live filter compositor integration, because:
   - AI inference takes 2-10s — incompatible with per-frame rendering
   - Users want explicit control over when "heavy" processing happens
   - Preview at lower resolution → apply at full resolution is a proven UX pattern (bg-removal)

4. **Model download strategy**: Bundle models <10 MB, download models 10-200 MB on first use, reject models >200 MB unless they provide transformative value. All downloads go through the existing `ModelLoader` + IndexedDB (`modelStore.ts`) pipeline with SHA-256 verification.

5. **Model card provenance**: Every model should have a `models/MODEL_NAME_card.md` with source URL, SHA-256, ONNX export command, and license text. This is critical for licensing compliance and reproducibility.

6. **Bugs found during audit**:
   - `aiUpscale.ts` hardcodes `['wasm']` provider — should try WebGPU/WebGL first
   - `birefnet-general` has `sha256: null` in manifest — security gap
   - Two manifest loaders (now merged)
   - SAM2 + Depth model IDs not in manifest (now added)
