# Native GPU and NPU support matrix

**Last verified:** 2026-09-13
**Scope:** the native desktop route first, then the browser/PWA route. This
matrix describes the current `master` implementation and the evidence in
[`gpu-npu-native-support-audit-2026-09-13.md`](../audits/gpu-npu-native-support-audit-2026-09-13.md).

The words in this document have a deliberately narrow meaning:

| State | Meaning |
|---|---|
| **Implemented** | A real production-facing route exists behind an existing workload contract. |
| **Compiled** | The relevant crate/bundle and its required runtime artifact build for the stated target. |
| **Integration-tested** | A real command/provider path, not only a device-list or enum test, completed its targeted test. |
| **Hardware-verified** | A physical device completed representative work; where placement matters, a runtime trace or provider diagnostic was inspected. |
| **Experimental** | The route is present but has a stated model, platform, browser, or packaging limitation. |
| **Unavailable** | A required device, driver, runtime, provider artifact, permission, or model contract is missing. |

Provider registration, session creation, a browser `navigator.gpu` result, or
webview composition is not hardware-execution evidence. A model can be
partitioned between devices, so a provider result is reported as mixed or
unprofiled when node placement was not traced.

## Workload matrix

| Workload | Current route | Implemented | Compiled | Integration-tested | Hardware-verified | Current limitation |
|---|---|---:|---:|---:|---:|---|
| Desktop canvas presentation | Webview Canvas2D replay of native scene/render IR | Yes | Yes | Yes | Not an accelerator claim | A native GPU device does not replace the webview presentation surface. |
| Desktop live `RgbSplit` effect provider | Native `wgpu` offscreen compute, then binary result transport | Yes | Yes | Provider and parity tests | Linux AMD RADV diagnostic/command lane | The authoritative synchronous preview/export path does not call the async provider yet; unsupported effects use the CPU path. Do not describe this row as interactive canvas acceleration. |
| Desktop non-AI resampling | Native `wgpu` resampler for nearest, bilinear, bicubic, and Lanczos3 | Yes | Yes | Yes | Linux AMD RADV | Selection is workload-sensitive. A cold, small, or memory-constrained request can stay on CPU. |
| Desktop AI background removal | ONNX Runtime CPU EP, with optional native WebGPU plugin EP | Yes | Yes for configured artifacts | Yes | Linux AMD RADV for U2NetP and ISNet; mixed partitions for LaMa/SCUNet | Model support and graph placement differ. BiRefNet 1024² remains unqualified on the audit host. Automatic mode quarantines a model after a failed GPU run, retries it once on CPU, and reports that fallback. |
| Desktop AI upscaling | Native provider policy with CPU fallback; non-AI resize uses the native resampler | Yes | Yes for configured artifacts | Targeted provider dispatch and native tile-boundary tests | GPU model evidence is workload-specific | Cold setup, model size, and provider coverage can make CPU the better automatic choice. Provider attribution is tied to the individual job, not a process-global last-run value. |
| Desktop NPU inference | No bundled vendor NPU provider | No provider claim | No NPU artifact in the base build | Capability rows only | None | QNN, OpenVINO NPU, AMD XDNA/Vitis AI, Windows ML NPU, and Core ML routes require target-specific runtime, driver, model, and hardware validation. |
| Browser/PWA presentation | Browser Canvas2D/WASM route | Yes | Yes | Browser tests | Browser-specific only | This does not certify Tauri/WebKitGTK or native `wgpu`. |
| Browser/PWA GPU compute | Feature-tested browser WebGPU adapter/provider where exposed | Experimental | Yes | Browser route only | Must be verified per browser/device | No flags or security weakening are required; Canvas2D/WASM remains the fallback. |
| Browser WebNN inference | No portable production claim | No | N/A | No | None | Requesting an `npu` device is not proof of NPU execution; the actual model/browser/device combination must expose and complete a supported path. |

## Platform matrix

| Target | Native GPU compute | Native GPU inference | Native NPU inference | Evidence and prerequisites |
|---|---|---|---|---|
| CachyOS/Arch Linux x86-64, AMD Renoir/RADV | **Hardware-verified** for self-test, `RgbSplit`, and resampling | **Hardware-verified** on the staged WebGPU EP for representative models; LaMa/SCUNet are mixed | **Unavailable** on the audit host | Vulkan/RADV device creation, optional WebGPU EP shared library, model files, and a successful real run. |
| Other Linux x86-64 | Implemented; hardware-unverified | Experimental until the host loads the matching plugin and model | Unavailable unless a separately validated provider is installed | WebKitGTK, graphics driver, permissions, ORT core/plugin ABI, and model compatibility are all independent gates. |
| Linux ARM64, including Crostini | Implemented; hardware-unverified | CPU fallback; the configured WebGPU plugin artifact is not published for this target | Unavailable | Host ChromeOS hardware must not be treated as container access. Crostini has its own WebKit/graphics/device boundary. |
| Windows x86-64 | Implemented; hardware-unverified | Experimental; configured WebGPU plugin artifact is available only after matching runtime load succeeds | Unavailable in the base build | WebView2, graphics driver, provider artifact, OS version, and packaging mode must be tested together. DirectML is a GPU route, not a universal NPU route. |
| Windows ARM64 | Implemented in source; hardware-unverified | CPU fallback in the published target until an ARM64 plugin lane is qualified | Unavailable in the base build | A Windows-on-ARM device, ARM64 provider artifact, and model coverage are required; x86-64 presence is not transferable. |
| macOS Apple Silicon | Implemented; hardware-unverified | Experimental; matching Core ML/WebGPU runtime policy is not bundled as an unconditional claim | Unavailable in the base build | Apple GPU/Neural Engine permission is a policy, not placement evidence. Intel Mac behavior is separate. |
| macOS Intel | Not supported | Not supported | Not supported | The configured native AI dependency does not provide the required current Intel macOS runtime lane. |
| CPU-only, software renderer, remote/headless, or restricted virtual session | CPU/reference path | Unavailable or declined | Unavailable | Software adapters are never advertised as hardware acceleration; documents and exports remain usable. |

## Selection and recovery contract

The native report has separate rows for compute devices and inference
providers. Each row advances independently through `unknown → discovered →
runtime loadable → device usable → execution verified`, or records a bounded
unavailable reason. “Execution verified” for inference means that a real
session returned through the selected provider; it does not silently upgrade
to “every graph node ran there.”

The normal desktop policy is workload-specific:

- Native effects and resampling use a verified `wgpu` device when the job is
  eligible, then fall back to the native CPU implementation.
- AI inference `Automatic` prefers the native WebGPU provider only when the
  loaded runtime/plugin/device/model gates pass; `CPU only` is deterministic;
  `WebGPU only` fails clearly if the requested provider cannot initialize.
- NPU controls are not shown as enabled choices until a real provider,
  runtime, device, model, and execution-verification lane exists.
- Device loss, provider initialization failure, unsupported operators, and
  allocation errors return an explainable fallback while preserving the
  document. No stale bitmap is presented as a fresh result.
- A failed Automatic WebGPU execution is discarded rather than returned to the
  session pool. That model is quarantined for the current process, one CPU
  retry is attempted, and a deliberate capability re-detection clears the
  quarantine. Explicit WebGPU policy remains fail-closed. This prevents a
  repeatedly failing model from retrying on every tile while keeping the
  document usable.

Native background-removal results use a bounded binary envelope for the mask
payload rather than JSON arrays or base64 image bytes over IPC. Legacy JSON is
still accepted for older clients. This reduces transport overhead without
changing the editor-facing mask semantics. SCUNet is treated as a complete
two-artifact install: its graph and external weights are downloaded, hashed,
size-checked, and installed atomically before the model becomes selectable.

## Release and claim gates

The base desktop artifact contains the CPU ONNX Runtime and only the optional
native WebGPU plugin artifacts that have passed the packaging integrity and
license checks for that target. Vendor NPU SDKs are not bundled speculatively.
Derived provider/compiler caches are device- and runtime-specific and are
discardable; canonical model assets remain portable.

Before adding a platform to the **hardware-verified** column, run the real
installed/release-like app, inspect provider diagnostics or runtime profiling,
compare output with the CPU/reference path, and open representative output
screenshots. Browser Playwright does not certify the Tauri route. A local
device node, model download, or successful build is not sufficient.

The current primary-host GPU evidence includes a real offscreen resampling
run with upload, dispatch, synchronization, and readback included in the
measurement. See [native GPU resampling evidence](../perf/native-gpu-resample-2026-09-13.md)
when that release record is present. Small or cold requests are intentionally
allowed to remain on CPU; the measured large-image result is not a universal
multiplier.

The public product and image-enhancement pages use the same boundary: native
GPU offscreen work is described separately from webview composition, and no
NPU support is advertised until this matrix has a verified row.

## Release-like desktop smoke evidence — 2026-09-13

On the primary CachyOS/Wayland host, the optimized Tauri binary compiled and
launched in the real desktop session. A release-like AppImage and `.deb` were
then built with `NO_STRIP=1` and a single Cargo build worker. The AppImage
was launched from the produced file and a 1280×800 screenshot was opened for
visual review. The clean isolated-data launch reached the normal update
consent dialog; the direct optimized binary reached the home/workspace view.

The first package pass exposed two packaging hazards that are now covered by
the release scripts: Arch's linuxdeploy strip incompatibility, and stale
foreign-runtime directories retained in a reused Tauri AppDir. The final
AppImage payload contains only `linux-x86_64` under its ONNX Runtime resource
directory; the `.deb` data archive has the same target-only contents. The
local artifacts measured approximately 585 MiB (AppImage) and 591 MiB (`.deb`)
because they include the full desktop/webview payload. The AppImage uses host
WebKit/GTK/GStreamer/Mesa after the documented prune step and is therefore a
smoke artifact for this host, not a portable release-baseline certification.

The package smoke used a Vite-transpiled frontend because the current shared
working tree has unrelated TypeScript errors; it does not waive the release
typecheck. Those errors and the unavailable AppImage signing step remain in
the validation report. Native GPU/inference claims continue to rely on the
separate wgpu and ONNX Runtime provider traces, parity checks, and opened
visual fixtures described above.

## Primary references checked 2026-09-13

- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)
- [wgpu 30.0.1 API and native backends](https://docs.rs/wgpu/30.0.1/wgpu/)
- [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/)
- [ONNX Runtime plugin EP libraries](https://onnxruntime.ai/docs/execution-providers/plugin-ep-libraries/usage.html)
- [ONNX Runtime WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)
- [ONNX Runtime profiling](https://onnxruntime.ai/docs/performance/tune-performance/profiling-tools.html)
- [Windows ML supported providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers)
- [OpenVINO system requirements](https://docs.openvino.ai/2026/about-openvino/release-notes-openvino/system-requirements.html)
- [ONNX Runtime QNN EP](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html)
- [ONNX Runtime Core ML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- [ONNX Runtime I/O binding](https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html)
- [ONNX Runtime WebNN tutorial](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)
