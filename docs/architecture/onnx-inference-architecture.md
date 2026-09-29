# ONNX Inference Architecture

## Overview

Varve's ONNX inference system provides on-device, offline-first AI features across
both browser (WASM/WebGL/WebGPU) and Tauri desktop (native ONNX Runtime) runtimes.
Desktop native inference and native GPU effect/resampling are separate from the
webview's presentation backend. A native GPU or an OS-advertised NPU is not
evidence that a particular model used that device.

The system is organized into four layers:

1. **Core Infrastructure** (`packages/engine/src/inference/core/`)
2. **Model Registry & Catalog** (`packages/engine/src/inference/`)
3. **Feature Adapters** (`packages/engine/src/inference/models/`)
4. **Native capability and provider boundary** (`crates/varve-accel/`, `crates/varve-bgremove/`, `crates/varve-upscale/`)
5. **Frontend Integration** (`packages/editor/src/components/Settings/`)

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
- `Content-Range` start/total validation before appending to a partial file
- SHA-256 checksum verification
- Declared-size and HTML-response rejection before installation
- ETag-based freshness checking
- Progress reporting with speed estimation
- Cancel/pause/resume
- Persistent state in the model store (IndexedDB on web; app storage on desktop)
- State change subscriptions

Resumption is conservative: a partial is reused only when its byte count and
URL are consistent, the server returns the requested range, and a stored ETag
matches the response. Otherwise the partial is discarded and a complete
response is fetched. Multipart entries pass each component's checksum,
upstream checksum, repair operation, and expected size through the same
validation path; the parent is not marked ready until every component is
installed.

### Model artifact storage and publication

`ModelStorage` is shared by inference and background-removal downloads. Browser
downloads write each response chunk into a staged artifact while an incremental
SHA-256 and byte count are maintained. A verified commit publishes metadata
only after the declared size and checksum pass. Artifact handles provide
metadata, a backpressured stream, and bounded prefix reads; callers that need a
Blob or `ArrayBuffer` must opt into that materialization.

The browser store prefers Origin Private File System (OPFS) files. When OPFS is
unavailable it writes 256 KiB Blob chunks to IndexedDB and keeps one chunk in
flight while reading. Existing IndexedDB Blob and ArrayBuffer records remain
readable. Legacy localStorage JSON records remain read-only and can be migrated
to IndexedDB; new weights are never written as JSON number arrays. The Tauri
adapter refuses byte-array IPC writes. Desktop acquisition uses the existing
Rust streaming downloader, which verifies the pinned digest before publishing
the app-managed file.

Multipart installs download and verify components under internal staging IDs.
One IndexedDB transaction swaps every verified artifact reference into its
public model ID; if any component is missing or the transaction fails, the
previous public set remains available. A completed component can be reused on
retry only when its stored checksum and size still match the manifest. Graphs
with external ONNX data use the same atomic publication boundary for the graph
and sidecar, so a failed or interrupted companion download cannot replace only
half of an installed pair. Interrupted streams retain a private partial with
its URL and ETag; reuse requires a matching validator and exact
`Content-Range`, otherwise the download restarts from byte zero.

The SCUNet graph and external weights are pinned to
[`Heliosoph/scunet-onnx@6d11417`](https://huggingface.co/Heliosoph/scunet-onnx/tree/6d11417ee2fbcc73783c502a238ac115097754fe).
The weights sidecar has a recorded size of 73,138,176 bytes and SHA-256
`98825ea1210b641c71e5f052f582c70c49fd44b35387ebe2c034268c17df3feb`.

This storage contract bounds download-time buffering. It does not yet provide
the same stream-native representation to every session consumer: some feature
paths still create a Blob URL or `ArrayBuffer` when the runtime requires a
single model source. OPFS quota/eviction policy, browser-specific OPFS behavior,
and native ARM64 device storage remain separate validation work.

### User-visible download and cancellation states

The browser model loader reports `connecting` before source resolution,
`downloading` while response bytes are streamed, `verifying` after the final
chunk and before its digest/size-gated commit, and `installing` only when a
verified multipart set is atomically published under public model IDs. These
callbacks drive the explicit-download dialog; a network percentage is not
treated as verification. For a single-artifact writer, verified commit also
publishes the final reference, so the dialog remains in its verification state
through that operation.

Cancel during connection or transfer aborts the request, but the dialog remains
in `cancelling` until the loader has stopped the reader and completed its
partial-artifact decision. A validator-backed partial may remain privately
staged for a later matching range request; it is never advertised as installed.
Digest and atomic-publication calls do not accept cancellation, so the dialog
disables dismissal until they finish and reports their actual result. Native
Tauri downloads currently expose byte progress but not the Rust verifier's
internal phase; they stay in the downloading state until the verified native
command returns rather than inventing a separate verification event.

### Verified bundled model examples

The small segmentation and upscaling models below are examples of models that
may be packaged when their release checks pass. DDColor is intentionally not in
this table: it is a runtime-downloadable, model-gated colorization artifact and
is not bundled in the current checkout. Model binaries are never stored in
localStorage.

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

### Provider timeout and cancellation contract

`ProviderChain` gives each availability probe and inference attempt a private
abort signal derived from the caller's signal. A timeout aborts that attempt
signal, but an abort notification is not proof that arbitrary GPU, WASM, or
native work has stopped. Therefore an ordinary provider that times out fails
closed instead of immediately starting a fallback and potentially doubling
peak memory. A provider may set `supportsHardCancellation` only when it owns a
terminating worker/process or an equivalent contract that stops the underlying
work before fallback; ordinary provider errors may still use the configured
fallback chain. Cancelled caller requests never fall through.

### Shared resource admission

`packages/platform/src/derivedWorkAdmission.ts` is the process-wide admission
gate for local memory-heavy work. Its default unknown/4 GB ceiling is 400 MB;
the supplied 8 GB reference profile has a 600 MB ceiling and is selected
explicitly with `setDerivedWorkMemoryProfile('reference-8gb')`. These are
conservative tracked-work limits, not device-memory measurements or guaranteed
safe maxima. The default is one running job and a queue capped at 64.

Requests identify a job kind, priority, cancellation signal, and estimated byte
reservation before allocating work. Visible/foreground work can move ahead of
background jobs; waiting explicit exports age into foreground order. Hiding
the page aborts speculative active jobs and pauses queued previews, while
explicit exports continue. Callers release a work lease only after execution
has actually stopped. A portion of its reservation can transfer to a resident
lease for a cached session or surface, so the same bytes are not counted once
as active and again as resident. Disposable residents are evicted before new
work only when its eviction callback confirms disposal; asynchronous session
release keeps the bytes reserved until confirmation, and a failed release
remains accounted.

`InferenceAdmission` remains the inference-facing compatibility API but
delegates to this same gate and reports an inference-only snapshot. Browser
inference, effects, thumbnails, and exports therefore contend for shared byte
headroom as their callers migrate. The `estimatedBytes` field remains optional
for existing derived-work callers during migration; callers that omit it
reserve zero bytes and are not yet protected by the byte ceiling. New and
changed allocation paths must provide a conservative estimate before decode,
tensor, transfer, surface, or export-buffer allocation. Native execution also
remains subject to its native process-wide pool; the JS admission ceiling does
not certify Rust-side allocation behavior.

### Browser runtime entrypoint and resident sessions

The generic inference worker owns one ONNX Runtime module for its lifetime.
`createOrtRuntimeLoader` chooses the matching `onnxruntime-web/webgpu` module
when capability detection requests WebGPU, otherwise it loads the ordinary
WASM module. If loading the WebGPU entrypoint itself fails and WASM is allowed,
the loader initializes WASM before creating a session. It never swaps module
entrypoints under an initialized worker: a failed initialization clears its
single-flight promise, while a worker restart creates a new runtime generation.
The installed runtime and companion assets remain pinned to the same 1.27.0
version. WASM worker threads remain disabled (`numThreads = 1`); the worker
proxy path is not used for WebGPU.

Before the first model session, the host reserves the catalog's conservative
session working-set estimate plus request tensors and surfaces. A correlated
`session-ready` message transfers the resident portion to a shared admission
lease only after the worker confirms the exact key and byte estimate. Cache
keys include model type/path, model/artifact revision, sidecar identity,
precision, requested provider profile, runtime settings, and worker/device
generation; the session registry separately records the provider that actually
created the session. Idle eviction releases the host lease only after the
worker confirms disposal. Failed release remains resident-accounted, and
worker termination is the reclamation boundary for the worker's WASM/GPU heap.
This tracks estimated model-session residency in the browser process; it does
not measure allocator fragmentation or guarantee an OS-level RSS reduction.

### Native Path (Tauri Desktop)

1. Frontend calls Tauri IPC command
2. Rust `varve-bgremove` or `varve-upscale` crate handles inference on a
   blocking worker; the Tauri/GTK event thread is not used for model setup or
   execution
3. `ort` crate (Rust ONNX Runtime bindings) loads the app-managed core library
   dynamically; the optional native WebGPU EP is a separately staged plugin
4. Automatic policy prefers the WebGPU EP only after plugin registration and a
   real device are available, while CPU is always a supported fallback; explicit
   GPU policy fails closed instead of silently relabelling CPU work
5. Session pools and job gates bound memory/concurrency; model and runtime
   artifacts are SHA-256 checked before use
6. Results report the provider observed for the completed model run where the
   runtime exposes that evidence (`native-webgpu` or `native-cpu`)

The native WebGPU EP is not the browser JavaScript WebGPU path and is not the
Rust `wgpu` effect engine. The `wgpu` engine currently serves offscreen effects
and conventional resampling; the webview still owns authoritative presentation.

### NPU support boundary

The capability report reserves separate NPU rows for QNN/HTP, OpenVINO NPU,
AMD XDNA/Vitis AI, and Core ML, but the current release does not ship a vendor
NPU runtime or expose an enabled NPU selector. These rows remain
`artifactMissing`/unavailable until a provider artifact, driver/permission
boundary, model contract, and real execution trace are all available. A
Qualcomm, Intel, AMD, or Apple device name alone cannot advance the row beyond
discovery. Core ML's allowed compute-unit policy likewise does not prove that
every operator ran on the Neural Engine. This is an intentional honest state,
not a promise of NPU execution.

### Quantization Policy

INT8 models are NOT automatically selected. The policy engine considers:

1. **CPU capabilities**: VNNI (Ice Lake+/Zen 4+) = INT8 beneficial; AVX2-only = INT8 likely slower
2. **Execution provider**: provider support and precision are model/runtime
   specific; WebGPU/WebGL availability does not prove that an INT8, FP16, or
   NPU graph is supported
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

1. **5 of 20+ manifest models have null SHA-256** — cannot be securely downloaded (mostly legacy/stub entries)
2. **Native runtime artifacts** are optional by target. The fetcher verifies
   archive and extracted-file digests and logs a CPU fallback when a target has
   no published optional provider artifact; a configured core-runtime failure is
   not treated as a valid accelerated installation
3. **Rust session pool** limits are hardcoded (max 2 sessions, 2 concurrent, 1.5 GB)
4. **ORT threads** hardcoded to 2 intra + 1 inter in `varve-upscale/src/ai.rs`
5. **Embedded webviews differ by platform.** Linux WebKitGTK in the supported
   desktop route does not currently provide the browser WebGPU contract used by
   the web compositor; Windows WebView2 and macOS WKWebView must be verified
   independently. Native desktop `wgpu`/ONNX providers do not change that
   presentation boundary.
6. **Large model WASM inference** (BiRefNet at 1024×1024) can cause `std::bad_alloc`

## Model delivery and colorization readiness

The model catalog distinguishes a catalog entry, a reachable URL, a stored
artifact, checksum verification, and a successful runtime smoke test. A row
must not be presented as ready based on its filename or release URL alone.

The DDColor entries are intended to be runtime-downloaded once a verified
release asset is published; they are not shipped inside the app installer:

| Model | Size | License | SHA-256 |
|-------|------|---------|---------|
| `ddcolor-tiny` | expected ~220 MB | Apache-2.0 | listed, not verified in this checkout |
| `ddcolor` | expected ~980 MB | Apache-2.0 | listed, not verified in this checkout |
| `upscale-realesr-general` | 5 MB | BSD-3-Clause | `856e1f4d...` |
| `upscale-realesr-general-int8` | 1.3 MB | BSD-3-Clause | `357ebd67...` |
| `u2netp` | 4.7 MB | MIT | `309c8469...` |
| `u2netp-int8` | 1.2 MB | MIT | `7b3355af...` |

The DDColor code and model terms are Apache-2.0 upstream. The official
PyTorch repository and export script are the provenance; the ONNX bytes still
need to be generated or acquired, hash-verified, and smoke-tested before the
photo workflow is called available. See `models-source/README.md` and the
Colorize architecture record for the current evidence.

## Development

### Adding a New Model

1. Add entry to `apps/desktop/public/models/manifest.json` with full tensor contract and `acquisition` strategy
2. Compute SHA-256 checksum: `node scripts/compute-model-checksum.mjs <file>`
3. Create model module in `packages/engine/src/inference/models/<name>.ts`
4. Register in `packages/engine/src/inference/inferenceWorker.ts` via `registerModelType()`
5. Add to `packages/engine/src/inference/modelCatalog.ts`'s `FALLBACK_ENTRIES` with explicit `acquisition` field
6. Add to `packages/engine/src/inference/manifest.ts`'s `KNOWN_SIZES`, `modelQuality`, `modelDisplayName`
7. Create test file `packages/engine/src/inference/models/<name>.test.ts`
8. If bundled: place `.onnx` in `apps/desktop/public/models/` only after the release asset guard, checksum, and runtime smoke test pass; do not assume Git LFS content is present
9. Add frontend surface in the appropriate tool section

### Acquisition Strategies

Each model declares how it is obtained via the `acquisition` field:

| Kind | Meaning | Example |
|------|---------|---------|
| `bundled` | Ships with the app after release validation | `u2netp`, `realesr-general-x4v3` |
| `remote` | Downloadable from URL at runtime | `scunet`, `font-classify` |
| `generated` | Produced from upstream weights via recipe | DDColor conversion route (artifact pending verification) |
| `manual-import` | User supplies the file | — |
| `unavailable` | Cannot be acquired (reason in `detail`) | Legacy stubs |

Use `resolveAcquisition(entry)` to get the effective strategy (prefers explicit field, falls back to legacy `remoteUrl`/`checksum` truthiness).

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
