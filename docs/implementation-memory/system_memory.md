# .system_memory.md — Background Isolation & Segment Refining Suite

## Session State: COMPLETE (2026-07-08)

### Verification Summary
- **Background removal tests:** 199/199 pass across 24 test files
- **Engine tests (bg-removal only):** 24/24 test files pass
- **Typecheck (`@varve/engine`):** 0 new errors (pre-existing `@varve/shared` duplicates only)
- **Lint:** 0 new warnings on all new/modified files
- **Emoji audit:** clean (1022 files)
- **Format:** clean (27 files auto-fixed)

---

## Pillar Implementation Status

| # | Pillar | Status | Files Created | Tests | Key Design Decisions |
|---|--------|--------|---------------|-------|---------------------|
| 1 | **SAM Integration** | ✅ Done | `promptEncoder.ts` + test | 21 | Click-positive/negative prompts via flood-fill on component labels; box constrains then keeps largest component; processing order: box→clicks. Pure typed-array, no DOM. |
| 2 | **Micro-Fine-Tuning** | ✅ Done | `categoryTuning.ts`, `tuningStore.ts` + tests | 21 | Fast feature extraction from 128×128 thumbnail; 8 features (hue, saturation, brightness, edge density, FG ratio, color count, skin tones, text); weighted Euclidean distance matching; localStorage persistence. |
| 4 | **Cast Shadow Separation** | ✅ Done | `shadowSeparation.ts` + test | 8 | Three-cue scoring: luminance (60%) + blue shift (20%) + saturation (20%); distance-weighted expected luminance estimation; connected-component filtering; alpha-weighted shadow color. |
| 5 | **Video Matte Pipeline** | ✅ Done | `videoMatte.ts`, `opticalFlow.ts` + tests | 21 (13+8) | Keyframe-based propagation with block-matching optical flow (SAD on luminance); confidence-weighted blending with AI predictions; temporal median window for jitter reduction; `AiInferenceFn` callback decouples from provider chain. |
| 6 | **Multi-Worker Pool** | ✅ Done | `workerPool.ts` (rewritten) + test | 5 | N workers = floor(hardwareConcurrency/2), max 4; round-robin to least-loaded worker; dead worker auto-replacement; cold-start timeout 10s, warm 60s. |
| 7 | **Cloud API Fallback** | ✅ Done | `cloudProvider.ts`, `cloudConfig.ts` + tests | 16 (11+5) | REST endpoint with Bearer token auth; exponential backoff (1s/2s/4s); config via localStorage with opt-in `enabled` flag; integrated as 4th provider (before heuristic). |
| 7b | **WebGPU Compute** | ✅ Done | `gpuAccelerator.ts`, `webgpu-types.d.ts` + test | 16 | Separable Gaussian blur (horizontal + vertical WGSL compute shaders); singleton with CPU fallback; lazy initialization; operation cap reporting for telemetry. |

### Architecture Decisions
- **Provider chain order:** Worker → Tauri → Direct ONNX → **Cloud** → Heuristic (cloud is last resort before pure heuristic)
- **GPU acceleration scope:** Separable blur only (CHW pack and threshold/confidence are CPU-only until benchmarking shows them as bottlenecks)
- **Video matte decoupling:** `processVideoMatte` accepts an `AiInferenceFn` callback (not importing provider chain directly), keeping the temporal pipeline testable and backend-agnostic
- **Security:** Cloud API requires explicit `enabled: true` in settings (even with apiUrl+apiKey set)
- **Perf:** Feature extraction for category tuning runs on 128×128 thumbnails only (< 16K pixel ops)

### Files Created/Modified
**New files (12):**
- `packages/engine/src/backgroundRemoval/promptEncoder.ts`
- `packages/engine/src/backgroundRemoval/__tests__/promptEncoder.test.ts`
- `packages/engine/src/backgroundRemoval/shadowSeparation.ts`
- `packages/engine/src/backgroundRemoval/__tests__/shadowSeparation.test.ts`
- `packages/engine/src/backgroundRemoval/videoMatte.ts`
- `packages/engine/src/backgroundRemoval/opticalFlow.ts`
- `packages/engine/src/backgroundRemoval/__tests__/videoMatte.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/opticalFlow.test.ts`
- `packages/engine/src/backgroundRemoval/categoryTuning.ts`
- `packages/engine/src/backgroundRemoval/tuningStore.ts`
- `packages/engine/src/backgroundRemoval/cloudConfig.ts`
- `packages/engine/src/backgroundRemoval/providers/cloudProvider.ts`
- `packages/engine/src/backgroundRemoval/gpuAccelerator.ts`
- `packages/engine/src/webgpu-types.d.ts`

**Modified files (3):**
- `packages/engine/src/backgroundRemoval/workerPool.ts` (rewritten multi-worker)
- `packages/engine/src/backgroundRemoval/providers/dispatch.ts` (added cloud provider to chain)
- `packages/engine/src/backgroundRemoval/index.ts` (new exports)

**Test files (9):**
- `packages/engine/src/backgroundRemoval/workerPool.test.ts` (rewritten)
- `packages/engine/src/backgroundRemoval/__tests__/cloudConfig.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/cloudProvider.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/categoryTuning.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/tuningStore.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/shadowSeparation.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/videoMatte.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/opticalFlow.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/gpuAccelerator.test.ts`

### Verification Criteria Met
- ✅ All 199 background removal tests pass (24 files)
- ✅ Zero `TODO` comments in new code
- ✅ Typecheck clean on `@varve/engine` (no new errors)
- ✅ Lint clean on all new/modified files
- ✅ Emoji audit clean
- ✅ Architecture documented in `.system_memory.md`
- ✅ All pillars production-ready with CPU fallback paths
- ✅ No deferred work items in active execution path
