# Native GPU and NPU Support Audit — 2026-09-13

Status: audit complete; implementation tracked in ADR-0237
(`docs/adr/0237-native-gpu-compute.md`, added in this change set) and
`docs/architecture/native-acceleration.md`.

Base commit: `806522cf1` (`master`, working tree contains unrelated in-flight
work by other agents; this audit reads the working tree as of the date above).
Hardware: AMD Ryzen 3 5300U (Zen 2 APU, Radeon Vega "Lucienne", `gfx90c`),
22 GiB RAM, CachyOS / kernel 7.2.3, Wayland, Mesa 26.2.2 (RADV RENOIR),
Vulkan 1.4.354. No NPU (`/dev/accel` absent, no XDNA device).

## 1. Method and evidence classes

- Source inspection of the working tree (paths + line numbers inline).
- Executable evidence: symbol scan of the *shipped* ONNX Runtime
  (`apps/desktop/src-tauri/onnxruntime-libs/linux-x86_64/libonnxruntime.so`),
  Vulkan/GL probes, cargo dependency graph.
- Measured CPU baselines for the native effect and resampling kernels
  (`crates/varve-effects/examples/effect_cost.rs`,
  `crates/varve-upscale/examples/resample_cost.rs`).
- Primary sources (accessed 2026-09-13):
  - ONNX Runtime WebGPU EP — <https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html>
  - ONNX Runtime plugin EP libraries — <https://onnxruntime.ai/docs/execution-providers/plugin-ep-libraries/usage.html>
  - ONNX Runtime profiling — <https://onnxruntime.ai/docs/performance/tune-performance/profiling-tools.html>
  - Tauri webview versions — <https://v2.tauri.app/reference/webview-versions/>
  - wgpu 30.0.1 (released 2026-08-22) — <https://crates.io/crates/wgpu>
  - AMD XDNA Linux driver state — <https://github.com/amd/xdna-driver/issues/1017>,
    <https://github.com/amd/xdna-driver/issues/1219>, <https://github.com/amd/xdna-driver/issues/1469>
  - Intel NPU Linux driver validation matrix — <https://github.com/intel/linux-npu-driver/issues/134>

## 2. Findings (evidence-backed)

### F1 — The shipped native inference runtime is CPU-only (severity: high)

`nm -D --defined-only libonnxruntime.so` exports exactly two `Ort*` symbols:

```
OrtGetApiBase
OrtSessionOptionsAppendExecutionProvider_CPU
```

No provider shared libraries are staged (`onnxruntime-libs/**` contains only
`libonnxruntime.so`). `scripts/fetch-onnxruntime.mjs` downloads the upstream
CPU tarball (ORT 1.27.1). Every model therefore executes on the ORT CPU EP
regardless of hardware.

### F2 — No execution provider is registered anywhere in Rust (high)

A workspace-wide search for `with_execution_providers`, `register_provider`,
`CUDAExecutionProvider`, `DirectML`, `OpenVINO`, `MIGraphX`, `QNN`,
`TensorRT`, `CoreML` in `crates/` finds no call sites. `OrtInferenceRuntime`
(`crates/varve-bgremove/src/inference.rs:116-153`) and `varve-upscale`
(`crates/varve-upscale/src/ai.rs:275-292`) build sessions without any provider
argument. Provider feature flags are absent from every `Cargo.toml`.

### F3 — No native GPU compute path exists (high)

The workspace has no `wgpu` (or equivalent) dependency: `Cargo.lock` contains
no `wgpu` package; the only `*.wgsl` files in the tree are generated build
artifacts under `target/`. `crates/varve-effects` is CPU-only. The generative
helper can be built with a Vulkan backend (`varve-generative-helper`, diffusion
`RequestedBackend`), but the shipped build script
(`scripts/build-generative-helper.mjs`) uses default features and
`generative_resources.rs:183,254` hardcodes `execution_backend: "native-cpu"`.

### F4 — Browser GPU/accelerated effect providers are built but unreachable (high)

- `gpuEffectProvider` (`packages/compositor/src/webgpu/gpuEffectProvider.ts:25`)
  has no production importer.
- `buildEffectChain` (`packages/engine/src/liveEffects/dispatch.ts:222`) is
  called only from tests; the previous export wiring
  (`packages/editor/src/export/flattenForExport.ts`, added in `e2ccb4742`) was
  lost when the export path was consolidated into
  `packages/editor/src/export/compositor.ts`.
- `SessionManager.ts` and `ProviderChain.ts` have no production callers.
- `WebGPURecovery.ts` is not exported and has no callers.

Unreachable acceleration code is not support.

### F5 — The UI equates "Tauri" with "GPU acceleration" (high, truthfulness)

`packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx:930`
uses `hasGpuAccel = caps.hasWebGPU || caps.hasWebGL || caps.isTauri` and
renders "GPU acceleration recommended" accordingly. Native ONNX inference is
CPU-only today (F1), and a native GPU does not make a DOM canvas use that GPU
(ADR-0001/ADR-0003). This is precisely the conflation the support matrix must
remove.

### F6 — Runtime capability reporting cannot express native devices (medium)

`packages/engine/src/inference/core/RuntimeCapabilities.ts:196-200` hardcodes
`hasAvx2/hasAvx512/hasVnni/hasNeon/hasDotProduct: false`;
`computePreferredProviders` (l.110-130) can only emit `webgpu`/`webgl`/`wasm`
and ignores its `isTauri` input; the `ExecutionProvider` union advertises
`cuda`/`coreml`/`native` values that nothing emits. There is no native
counterpart to `gpuAdapter.ts` (which is browser-only).

### F7 — CPU baseline costs are large at export resolution (high)

Measured on the audit host, 2048×2048 RGBA (`effect_cost`):

| Effect | interactive | export |
|---|---:|---:|
| LightShafts | 1660 ms | 4293 ms |
| Bloom | 738 ms | 1920 ms |
| Caustics | 642 ms | 1334 ms |
| LightLeak | 537 ms | 536 ms |
| RgbSplit | 505 ms | 536 ms |
| Dither | 387 ms | 304 ms |
| CRT | 259 ms | 273 ms |
| VHS | 136 ms | 147 ms |
| LensFlare | 117 ms | 117 ms |
| PaletteSnap | 11 ms | 2 ms |

Resampling (`resample_cost`): 1920×1080 → 3840×2160 bicubic 2131 ms /
Lanczos3 2086 ms; 3000×2000 → 6000×4000 tiled 1915/1791 ms.

### F8 — Manifest hygiene defects adjacent to acceleration (low)

`packages/engine/src/inference/manifest.ts:81-82,270-271` parses SAM2 sizes
with numeric separators in place of decimal points
(`154902133_902_201`, `183344311_344_379`), and the v3 manifest's
`supportedProviders`/`sizeBytes` fields are not consumed by the loader.
Model metadata drives memory admission, so this belongs in the same hardening
pass.

## 3. Issue matrix

| ID | Issue | Repro / evidence | Actual path | Root cause | Severity | Platforms | Fix | UI | Regression test |
|---|---|---|---|---|---|---|---|---|---|
| F1 | CPU-only ORT shipped | `nm -D` on staged `.so` | `ort` default CPU EP | CPU tarball only; no EP artifact | High | all desktop | runtime provider discovery + honest report; plugin-EP path documented | Inference row shows CPU | `varve-accel` capability tests |
| F2 | No EP registration | grep `crates/` | session builder without EP | never implemented | High | all desktop | provider policy module with CPU fallback; no stub selectors | Advanced provider list (verified only) | session policy unit tests |
| F3 | No native GPU compute | `Cargo.lock` no wgpu | CPU kernels | missing subsystem | High | all desktop | `varve-accel` wgpu engine + effect kernels | Compute row + policy | parity + bench tests |
| F4 | Browser GPU effects unreachable | import graph | CPU kernels | lost export wiring | High | web | restore accelerated export dispatch | effect backend in export report | E2E export spec |
| F5 | `isTauri` implies GPU | BackgroundRemovalSection:930 | misleading copy | conflation | High | desktop | capability-driven copy | separate presentation/compute/inference rows | component test |
| F6 | Capability model has no native side | RuntimeCapabilities.ts | browser probes only | missing contract | Medium | all | `NativeAccelerationReport` + Tauri command | Settings > Performance | unit + E2E |
| F7 | CPU bottlenecks | measured table above | sync CPU kernels | no GPU backend | High | all | GPU kernels (Bloom, RgbSplit, LightShafts staged) | backend label | parity + bench |
| F8 | manifest size defects | manifest.ts:81 | catalog parse | decimal separator bug | Low | all | fix parsing + consume sizeBytes | — | manifest tests |

## 4. Why not NPU-first on Linux (failure-mode research)

Community evidence on the exact failure modes users report, and the policy it
implies for Varve:

1. **Whole-app GPU acceleration without per-feature fallback** breaks the
   product. Photoshop users report canvas corruption and crashes fixed only by
   disabling "Use Graphics Processor", losing GPU-only features
   (Adobe community, 2026-07; Adobe GPU troubleshooting, 2026-02). Figma
   desktop users report blank/invisible canvases and failed file loads traced
   to WebGL/GPU-process failures on AMD 780M and hybrid-GPU systems; the
   official workaround is `Disable Hardware Acceleration`
   (Figma forum, 2026-02…2026-06). **Varve rule:** per-workload selection with
   automatic CPU fallback; never gate document access on an accelerator.
2. **Vendor NPU stacks are split-state on Linux.** AMD XDNA firmware and
   in-tree `amdxdna` versions are coupled and distribution firmware lags
   (xdna-driver #1219, #1469); ONNX Runtime Vitis AI EP fails to build on
   Ubuntu 24.04 toolchains (xdna-driver #1017); Intel's Linux NPU driver
   validates a narrow Ubuntu/kernel matrix, and `/dev/accel/accel0` presence
   alone does not imply a working OpenVINO path
   (intel/linux-npu-driver #134, #126). **Varve rule:** report
   `unavailable(driver-missing | runtime-missing | unsupported-platform)`
   with the missing component named; never bundle vendor toolkits in the base
   app, never require root/permission changes.
3. **"NPU active" badges that are not backed by observed placement.** Provider
   registration and successful session creation do not prove the graph ran on
   the NPU; providers partition graphs and silently fall back.
   **Varve rule:** requested / selected / initialized / observed are separate
   fields; unverified placement is displayed as unverified.
4. **Hybrid/discrete GPU transitions** (Photoshop black lines resolved by
   forcing discrete mode) make adapter identity and loss handling first-class.
   **Varve rule:** never persist adapter indices; re-detect on device loss and
   explain the fallback.

## 5. Provider decision matrix (updated 2026-09-13)

| Target | Candidate route | Verdict for this repository |
|---|---|---|
| Linux AMD (this host) | ONNX Runtime MIGraphX / ROCm | **Not feasible.** `gfx90c` is outside ROCm support; no ROCm userspace installed. |
| Linux AMD | ONNX Runtime WebGPU **plugin EP** (`onnxruntime_providers_webgpu.so`, Dawn→Vulkan) | **Viable medium-term**, requires shipping a plugin artifact + `ort` plugin-EP binding support (not exposed by `ort 2.0.0-rc.13`; verify before claiming). Documented as gated. |
| Linux Intel | OpenVINO EP (GPU/NPU) | Not applicable to this host; keep as an optional, externally-provided runtime that we discover, never bundle. |
| Windows NVIDIA | CUDA/TensorRT EPs | No bundled runtime; documented as externally provided, unverified. |
| Windows hybrid | Windows ML / DirectML | Requires packaging research; not in this milestone. |
| Windows/Linux ARM | QNN (Snapdragon X) | Out of scope without hardware; artifact inspection would be required. |
| macOS Apple Silicon | Core ML EP | Requires a GPU-enabled ORT artifact; no Python/conversion environment assumed. |
| All desktops | **Native wgpu compute** (effects/resampling) | **Implement now.** Verified on RADV/`gfx90c`; avoids all model-runtime vendor coupling. |
| Web | WebGPU EP / JSEP, WebNN | WebGPU path exists and is wired for inference; WebNN remains unimplemented and must stay opt-in/feature-detected. |

## 6. Planned correction (this change set)

1. New crate `crates/varve-accel`: native capability model, wgpu device
   discovery and bounded self-test, GPU compute kernels for live effects
   (Bloom first, with the browser kernel as the compatibility reference).
2. Tauri commands: `native_acceleration_status`, `native_gpu_self_test`;
   `apply_live_effect_binary` gains explicit backend selection and reports the
   backend actually used.
3. Restore accelerated dispatch in the export path (native GPU → native CPU →
   web GPU → CPU) using the existing `dispatchLiveEffect` chain.
4. Capability UI: separate Canvas presentation / Effect compute / AI inference
   states, truthful fallback reasons, re-detect and reset controls; remove the
   `isTauri ⇒ GPU` claim.
5. Web: wire `gpuEffectProvider` into the restored export chain (feature of the
   same consumer), keeping Canvas2D preview authoritative.
6. Docs, website support matrix, E2E + visual validation, benchmarks.

## 7. Post-audit update (same day): native WebGPU inference verified

After this audit, the native WebGPU plugin EP was implemented and verified on
the audit host:

| Check | Result |
|---|---|
| Plugin registration (`onnxruntime-ep-webgpu` 0.3.0 vs core 1.27.1) | Registered; `WebGpuExecutionProvider` device, hardware id 5708, type GPU |
| Node placement (ORT profiler, u2netp 1×3×320×320, 4 runs) | 1468/1468 node executions on WebGPU, 0 on CPU |
| Output parity vs CPU EP | max abs 2e-6, mean abs 4e-8 |
| Median wall time | CPU 1999 ms vs WebGPU 336 ms (~6×) |

Command:

```bash
cargo run --release -p varve-bgremove --features ai --example webgpu_ep_probe -- \
  apps/desktop/src-tauri/onnxruntime-libs/linux-x86_64/libonnxruntime.so \
  apps/desktop/src-tauri/onnxruntime-libs/linux-x86_64/libonnxruntime_providers_webgpu.so \
  apps/desktop/public/models/u2netp.onnx
```

F1/F2/F5 are superseded accordingly: the core artifact is still CPU-only, but
registered plugin execution is real and observed for this model. Other models
and platforms remain unverified and stay on the CPU policy.
