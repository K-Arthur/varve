# ONNX Inference Architecture

## Overview

Strata's ONNX inference system provides on-device, offline-first AI features across
both browser (WASM/WebGL/WebGPU) and Tauri desktop (native onnxruntime) runtimes.

The system is organized into four layers:

1. **Core Infrastructure** (`packages/engine/src/inference/core/`)
2. **Model Registry & Catalog** (`packages/engine/src/inference/`)
3. **Feature Adapters** (`packages/engine/src/inference/models/`)
4. **Frontend Integration** (`packages/editor/src/components/Settings/`)

## Core Architecture

### Core Module (`inference/core/`)

| File | Purpose |
|------|---------|
| `types.ts` | All shared type definitions (manifest entries, runtime capabilities, selection context, task adapters, etc.) |
| `InferenceError.ts` | Structured error hierarchy with 22 error codes, user-facing messages, technical details, and recovery suggestions |
| `RuntimeCapabilities.ts` | Environment capability detection (WebGPU, WebGL, WASM, Tauri, cross-origin isolation, memory) |
| `ModelSelector.ts` | Central policy engine for automatic model selection based on quality mode, task, hardware, and model metadata |
| `DownloadManager.ts` | Model download lifecycle with resume, cancellation, checksum verification, and state management |
| `TaskAdapter.ts` | Base class for task-specific inference adapters (segmentation, upscaling, depth, etc.) |
| `Diagnostics.ts` | Structured diagnostics collection and reporting for debugging and support |

### Model Metadata

Model metadata is centralized in two locations:

1. **`apps/desktop/public/models/manifest.json`** — Versioned declarative manifest containing
   all known models with tensor contracts, checksums, licensing, and validation status.
   Schema version 1.0.0, manifest version 3.

2. **`packages/engine/src/inference/modelCatalog.ts`** — TypeScript-side fallback entries
   used when the manifest cannot be fetched. Mirrors manifest.json with 26 hardcoded entries.

### Error Handling

The `InferenceError` class provides structured errors with:
- Stable error code (`InferenceErrorCode`)
- Developer message
- User-facing message
- Technical details
- Recovery suggestion
- Retry safety flag
- Fallback availability flag

### Runtime Capability Detection

`getRuntimeCapabilities()` returns a `RuntimeCapabilities` object that reports:
- Environment context (Tauri vs browser, WebKitGTK vs Chromium)
- WebGPU/WebGL availability
- WASM safety limits
- Cross-origin isolation status
- SharedArrayBuffer support
- Network type (for metered connections)
- Estimated memory

### Model Selection

The `ModelSelector` class implements a deterministic selection algorithm:

1. Gather candidates by task category
2. Sort by quality (highest first)
3. For each candidate:
   - Select precision variant based on quality mode and hardware capabilities
   - Select execution provider
   - Check memory safety
   - Determine if download is required
   - Return selection decision with explanation

Quality modes:
- `auto` — Balanced selection, prefers bundled models, may use INT8 if quality-validated
- `fast` — Prioritizes speed, may use INT8 if hardware-accelerated
- `balanced` — Medium quality/speed trade-off
- `high-quality` — Best quality regardless of size
- `custom` — Manual override (not yet implemented)

### Download Management

The `DownloadManager` provides:
- Download with HTTP Range request resume
- SHA-256 checksum verification
- ETag-based freshness checking
- Progress reporting with speed estimation
- Cancel/pause/resume
- State persistence to localStorage
- State change subscriptions

### Bundled Models

Four ONNX models are bundled with the app:

| Model | Size | Precision | Purpose |
|-------|------|-----------|---------|
| `u2netp.onnx` | ~4.7 MB | FP32 | Fast segmentation preview |
| `u2netp-int8.onnx` | ~1.2 MB | INT8 | Fast segmentation (quantized) |
| `realesr-general-x4v3.onnx` | ~4.9 MB | FP32 | Real-ESRGAN x4 upscaling |
| `realesr-general-x4v3-int8.onnx` | ~1.3 MB | INT8 | Real-ESRGAN x4 (quantized) |

### Task Adapters

Each AI feature implements a `BaseTaskAdapter` subclass providing:
- Input validation
- Model-specific preprocessing
- Inference invocation
- Output contract validation
- Postprocessing
- Memory estimation

Current task adapters are in `packages/engine/src/inference/models/`:
- `sam2.ts` — Interactive segmentation
- `lama.ts` — Inpainting
- `depth.ts` — Depth estimation
- `ddcolor.ts` — Colorization
- `scunet.ts` — Denoising
- `lineArt.ts` — Line art extraction
- `detr.ts` — Object detection
- `efficientnet.ts` — Image classification
- `trocr.ts` — Text recognition
- `siglip.ts` — Image embeddings
- `rife.ts` — Frame interpolation
- `paddleocr.ts` — Text detection
- `paddlerec.ts` — Text recognition (CTC decode)

### SDP/IPC Flow

```
User Action
  → Frontend (feature tool)
    → TaskAdapter.validate()
    → TaskAdapter.preprocess()
    → InferenceWorkerHost / SessionManager
      → Web Worker (browser) or Tauri IPC (desktop)
        → onnxruntime-web / ort (Rust)
          → ONNX Model
        ← Tensor output
      ← InferenceResult
    → TaskAdapter.postprocess()
    → Frontend applies result
```

### Worker Path (Browser)

1. `InferenceWorkerHost` (main thread singleton) sends requests to
   `inferenceWorker.ts` (Web Worker)
2. Worker loads onnxruntime-web dynamically
3. Session cache with LRU eviction (max 3 sessions)
4. Provider preference: WebGPU → WebGL → WASM
5. WASM memory safety gate before bare WASM session creation

### Native Path (Tauri Desktop)

1. Frontend calls Tauri IPC command
2. Rust `strata-bgremove` or `strata-upscale` crate handles inference
3. `ort` crate (Rust ONNX Runtime bindings) with dynamic library loading
4. Session pool with LRU eviction (max 2, 1.5 GB budget)
5. SHA-256 verification of downloaded models

### Quantization Policy

INT8 models are NOT automatically selected. The policy engine considers:

1. **CPU capabilities**: VNNI (Ice Lake+/Zen 4+) = INT8 beneficial; AVX2-only = INT8 likely slower
2. **Execution provider**: WebGPU/WebGL have no INT8 dot-product; FP16 is native
3. **Quality validation**: INT8 variant must pass quality thresholds (IoU, PSNR, SSIM)
4. **Storage trade-off**: INT8 is always smaller; benefit is communicated separately

### Frontend Surfaces

| Component | Path | Purpose |
|-----------|------|---------|
| `ModelManager.tsx` | `components/Settings/ModelManager.tsx` | Comprehensive model manager with diagnostics |
| `BgRemovalModelsTab.tsx` | `components/Settings/BgRemovalModelsTab.tsx` | Legacy bg removal model list |
| `ColorizationModelsTab.tsx` | `components/Settings/ColorizationModelsTab.tsx` | Colorization model management |
| `ModelDownloadDialog.tsx` | `components/BackgroundRemoval/ModelDownloadDialog.tsx` | Download consent dialog |

### Diagnostics

`Diagnostics.ts` provides:
- `buildDiagnosticsReport()` — Comprehensive report with runtime capabilities, installed models, errors
- `formatDiagnosticsReport()` — Human-readable text format
- `DiagnosticsCollector` — Correlation ID-based timing
- Clipboard copy support for support requests

## Known Limitations

1. **9 of 17 manifest models have null SHA-256** — cannot be securely downloaded
2. **`birefnet-general` (928 MB)** has no checksum and no download URL — effectively unusable
3. **`native_colorize_infer` Tauri command** is a stub that always returns an error
4. **SAM2 small, TrOCR, font-detection** models are listed but have no download URLs
5. **`fetch-onnxruntime.mjs`** silently exits with code 0 on any error
6. **Rust session pool** limits are hardcoded (max 2 sessions, 2 concurrent, 1.5 GB)
7. **ORT threads** hardcoded to 2 intra + 1 inter in `strata-upscale/src/ai.rs`
8. **WebKitGTK** does not support WebGPU; WebGL is unreliable
9. **Large model WASM inference** (BiRefNet at 1024×1024) can cause `std::bad_alloc`

## Development

### Adding a New Model

1. Add entry to `apps/desktop/public/models/manifest.json` with full tensor contract
2. Compute SHA-256 checksum: `node scripts/compute-model-checksum.mjs <file>`
3. Create task adapter in `packages/engine/src/inference/models/<name>.ts`
4. Register in `packages/engine/src/backgroundRemoval/modelLoader.ts`'s `EXTENDED_MODEL_META`
5. Add to `packages/engine/src/inference/modelCatalog.ts`'s `FALLBACK_ENTRIES`
6. Add to `packages/engine/src/inference/manifest.ts`'s `KNOWN_SIZES`, `modelQuality`, `modelDisplayName`
7. Create test file `packages/engine/src/inference/models/<name>.test.ts`
8. Add frontend surface in the appropriate tool section

### Running Tests

```bash
# All inference-related tests
pnpm vitest run packages/engine/src/inference/ packages/engine/src/backgroundRemoval/__tests__/

# Core infrastructure tests only
pnpm vitest run packages/engine/src/inference/core/__tests__/

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Building

```bash
# Copy ONNX Runtime WASM assets
pnpm postinstall

# Fetch native ONNX Runtime libraries
pnpm postinstall

# Build Tauri desktop
just build
```

## Runtime Asset Layout

```
apps/desktop/public/
  ort-wasm/
    ort-wasm-simd-threaded.jsep.mjs
    ort-wasm-simd-threaded.jsep.wasm
    ort-wasm-simd-threaded.mjs
    ort-wasm-simd-threaded.wasm
    manifest.json
  models/
    manifest.json
    u2netp.onnx
    realesr-general-x4v3.onnx
    quantized/
      u2netp-int8.onnx
      realesr-general-x4v3-int8.onnx
```

### Native Runtime Libraries

```
apps/desktop/src-tauri/onnxruntime-libs/
  linux-x86_64/
  linux-aarch64/
  macos-aarch64/
  windows-x86_64/
```
