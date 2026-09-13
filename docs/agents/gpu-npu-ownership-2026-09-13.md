# Varve native acceleration: ownership, evidence, and implementation plan

Status: active implementation record. This is not a support claim by itself.

Date: 2026-09-13 (America/Vancouver)

Working tree: `master`, HEAD `b08b683ef413d939db3c75853425b68deb0ea49b`.

## Scope and evidence rules

This work treats four different things as separate:

1. webview presentation/compositing;
2. native or browser GPU compute for effects and resampling;
3. native model inference providers; and
4. NPU inference.

An adapter list, a provider registration, a successful session creation, or a
webview that happens to composite with a GPU is not execution evidence. A
support statement is promoted only through these gates:

```text
unknown → discovered → runtime loadable → device usable
→ model/kernel compatible → execution verified → performance evaluated
```

Every result will retain the requested policy, selected provider/device,
initialization result, observed placement when the runtime exposes it, and
fallback reason. `unverified` is a valid result; it is not converted into
`active` for the sake of a status panel.

This document distinguishes:

- **Source claim** — documented by a vendor or upstream project.
- **Code observation** — found in the pinned Varve source or build artifact.
- **Inference** — a risk derived from those observations.
- **Measurement** — a result from a named command, fixture, device, and build.

The current dirty worktree contains unrelated drawing, typography,
colorization, and website work, as well as active effects/resampling and AI
upscale work owned by other agents. Those changes are not treated as merged
baseline evidence and will not be reset, stashed, or overwritten.

## Baseline inventory

### Host and installed application route

The primary verification host is CachyOS/Arch Linux on Wayland:

| Item | Observation | Evidence status |
|---|---|---|
| OS/kernel/architecture | CachyOS rolling, x86-64, kernel `7.2.3-1-cachyos` | measured on 2026-09-13 |
| session | Wayland | measured on 2026-09-13 |
| GPU | AMD integrated Radeon Graphics, RADV Renoir, PCI id `0x164c` | `vulkaninfo --summary`, measured |
| graphics stack | Mesa/RADV `26.2.2`, Vulkan `1.4.357` | measured |
| device nodes | `/dev/dri/renderD128`; no `/dev/accel` | measured; absence is not proof that every NPU is absent |
| WebKitGTK | `2.52.6` from `pkg-config webkit2gtk-4.1` | measured |
| Rust | `rustc 1.97` | repository toolchain record and local check |
| JS tooling | Node `26`, pnpm `11.9` | repository toolchain record |

The repository workspace currently pins `wgpu` `30.0.1` and `ort`
`2.0.0-rc.13`. The local `wgpu` package declares MSRV `1.87` and the local
`ort` package declares MSRV `1.88`, while the workspace manifest still says
Rust `1.82`. This is a packaging/toolchain compatibility defect to resolve or
explicitly gate; it is not evidence that the end-user runtime is supported by
the developer machine.

### Current committed execution paths

- The authoritative desktop presentation path is native scene/IR processing
  followed by webview Canvas2D replay. This is not native GPU presentation.
- `crates/varve-accel` can discover native adapters and has a bounded `wgpu`
  self-test. The committed native effect coverage is deliberately narrow
  (`RgbSplit`); unsupported effects use the existing CPU path.
- The desktop live-effect dispatch can attempt the native provider and fall
  back to CPU. The browser WebGPU effect runner exists, but the current audit
  found no production preview/export consumer for its effect chain.
- Native ONNX Runtime is initialized lazily. The shipped core runtime and the
  optional `onnxruntime-ep-webgpu` plugin are separate artifacts. When the
  plugin is present and registration succeeds, background removal and related
  native consumers can select the native WebGPU provider; CPU remains the
  normal fallback.
- The existing host has no NPU execution evidence. Provider inventory rows
  such as OpenVINO, QNN, Core ML, DirectML, CUDA, TensorRT, MIGraphX, and
  Vitis AI are not enabled selectors unless a compatible runtime and model
  path are actually present.
- The production export path remains authoritative CPU/native processing.
  No full-frame pixel-push or native-surface replacement is being assumed.

The committed audit and architecture references are:

- [GPU/NPU native-support audit](../audits/gpu-npu-native-support-audit-2026-09-13.md)
- [Native acceleration architecture](../architecture/native-acceleration.md)
- [ADR-0237](../adr/0237-native-gpu-compute.md)
- [Render pipeline and painted-pixel invariant](../architecture/render-pipeline.md)

## Issue matrix

The matrix is ordered by user impact and by the smallest change that can
produce real evidence. “Owner” refers to the current implementation boundary,
not a claim that another agent’s dirty changes are complete.

| ID | Reproduction/evidence | Root cause and impact | Platforms | Owner/proposed change | UI implication | Regression proof |
|---|---|---|---|---|---|---|
| A-01 | Read `packages/engine/src/liveEffects/dispatch.ts`; browser effect-chain construction has no normal preview/export caller. | A browser GPU kernel can be green in an isolated harness while users still receive CPU effects. | Web/PWA, embedded webview | Engine/compositor owner: keep the chain opt-in until semantic parity and output ownership are proven; then wire one real consumer behind the existing facade. | Never show “GPU effects” merely because WebGPU exists. | Reachability test plus representative pixel fixtures and a production Playwright run. |
| A-02 | Native status reports an adapter before lazy `wgpu` device creation and self-test. | “Discovered” is easy to mistake for “usable”; device creation can fail because of driver, sandbox, remote-session, or feature limits. | Desktop Linux, Windows, macOS, virtual/headless | Acceleration owner: expose stage-specific status and make provider selection use a candidate/usable distinction; self-test is the verification action. | Show detected, usable, verified, and fallback separately. | Unit tests for stage transitions; native self-test on the primary host and a software/negative lane. |
| A-03 | `isNativeGpuComputeUsable` currently derives its boolean from the compute report’s availability rather than observed execution. | A status boolean can overstate readiness even though the provider later fails closed. | Desktop | Acceleration/engine owner: rename or tighten the contract and preserve automatic CPU fallback. | Copy must say “candidate” until a real job verifies execution. | Mocked capability tests and a real RGB-split/resample run with backend evidence. |
| A-04 | Native AI status is lazy and plugin registration is separate from core runtime loading. | Opening diagnostics before an AI job can show `not attempted`; a missing optional plugin can look like an unexplained CPU result. | Desktop all; especially packaged installs | Inference/packaging owner: report artifact presence/loadability separately, retry only safe pre-load failures, and retain an explicit missing-artifact reason. | “Installed”, “loadable”, “selected”, and “verified” are distinct labels. | Missing core/plugin fixtures, repair/re-detect test, and a release-like bundle smoke test. |
| A-05 | Existing provider tracking is session/process state, while binary upscale APIs return image bytes without a provider record. | Concurrent or repeated jobs can produce stale or ambiguous attribution. | Desktop AI | Upscale/inference owner: return or publish per-job execution metadata; avoid a process-global “last provider” as the source of truth. | AI result diagnostics show provider/device and mixed/unknown placement. | Single-flight/concurrent-job test, generation test, and provider metadata assertion. |
| A-06 | The conventional GPU resampling implementation is being developed in the dirty tree by another owner. | Creating a `wgpu` device on a command/event path or using GPU for tiny jobs can block interaction or lose to CPU transfer overhead. | Desktop | Resampling owner: create workers inside bounded blocking work, add an evidence-backed workload threshold, and retain CPU fallback. | No new global GPU switch; optional diagnostic records selected backend. | Cold/warm large and small image benchmarks, cancellation, export parity, and UI responsiveness E2E. |
| A-07 | The current native GPU shader coverage is intentionally one effect, while the browser path contains more kernels. | A broad “GPU effects” claim would be false and unsupported passes could lose masks/blending/color semantics. | Desktop/web | Effects owner: extend only with reusable contracts and parity fixtures; unsupported subtrees fall back as a unit. | Per-workload status, not a blanket accelerator badge. | Numeric tolerances plus opened screenshots for alpha, clipping, gradients, and seams. |
| A-08 | Current host has no `/dev/accel` and no vendor NPU runtime evidence. | A device node or product specification would not establish a usable NPU/model route. | Linux/ChromeOS/Crostini, vendor-specific systems | Inference owner: keep NPU routes gated by actual runtime/model/placement evidence; document exact provider blockers rather than adding a stub selector. | NPU is unavailable/unverified, not “enabled”. | Provider artifact matrix and strict diagnostic mode where the provider supports it. |
| A-09 | Existing runtime staging checks whether a library is non-empty when an artifact already exists; archive hashes alone do not validate a pre-existing extracted file. | A corrupted or replaced optional provider can persist across repair/relaunch and cause confusing fallback. | Release packages and offline installs | Packaging owner: verify trusted extracted artifacts with pinned digests/manifest metadata and replace atomically only after verification. | Explain repair/download/clear-cache separately. | Corrupt/truncated/tampered fixture and release asset audit. |
| A-10 | Tauri embeds platform webviews whose versions and graphics behavior differ by OS/distribution. | Native GPU discovery does not prove webview Canvas2D/WebGPU behavior; global environment workarounds can mask or worsen crashes. | WebKitGTK Linux, WebView2 Windows, WKWebView macOS | Desktop owner: keep presentation fallback independent, capture webview capability/reason, and test release-like packages. | Separate canvas presentation from effect compute and inference. | Installed-app visual E2E, context-loss/recovery, dialogs/IME/z-order check. |
| A-11 | User reports and upstream issues show black lines, blank WebGL canvases, WebKit crashes, stale AppImage libraries, and GPU-provider fallback failures. | Users experience “acceleration” as data loss, blank output, or a stuck last frame when recovery is not authoritative. | All desktop/web lanes | QA/recovery owner: generation-guarded results, bounded retries, device reset, authoritative redraw, and safe-start. | Recovery action must be usable while work is running and must preserve the document. | Forced failure fixtures, visual hash vs full redraw oracle, save/reopen/export. |
| A-12 | Browser WebNN `npu` requests are feature-dependent and not portable; Chrome/Edge/Firefox/Safari/embedded support differs. | A browser request is not proof of NPU execution and native tests do not certify PWA behavior. | PWA/browser | Web owner: feature-test the actual model, use WebGPU/WASM fallback, and keep experimental flags out of normal support claims. | Browser status says unsupported/experimental with reason. | Production-origin worker/CSP/cache test on supported browsers; no native bridge. |

## Workload and platform matrix

| Workload | Current owner/path | Data and sensitivity | Selection rule | Required evidence |
|---|---|---|---|---|
| Canvas presentation/replay | Native scene/IR → webview Canvas2D | Compact IR in; pixels stay in the webview; pointer-frame sensitive | Preserve the working replay path; no native surface until full interaction parity | Frame delivery, input latency, dialogs/IME/z-order, visual oracle |
| Live RGB split | Native `wgpu` effect provider where usable, CPU fallback | Raster/pass-sized data; preview sensitive | Use native GPU only after device creation; fall back per effect/subtree | Shader numeric fixture, hardware self-test, visible screenshot |
| Other effects/masks/blends | CPU authoritative; browser kernels are not assumed reachable | Large raster or nested scene; semantics-sensitive | Do not move irregular/unsupported work solely for utilization | Representative nested masks, alpha/color/clip screenshots |
| Image resize/conversion | CPU baseline; native GPU resampling integration is a separate handoff | Binary pixels, upload/readback costs dominate small jobs | Benchmark cold/warm and choose CPU for small or transfer-heavy jobs | End-to-end source-to-visible/export timing and peak memory |
| Background removal/segmentation | Native Rust ONNX boundary; CPU or registered native WebGPU EP | `NCHW` model inputs, model-specific shapes/normalization | Auto selects only an initialized compatible provider; production model must pass | ORT profile placement, parity, p50/p95 cold/warm, model quality |
| Depth/denoise/content-aware fill | Native Rust model consumers, CPU fallback; provider coverage varies | Larger tensors and possible graph partitioning | Treat mixed placement as mixed/unknown, not full NPU/GPU | Per-model placement and output/visual fixtures |
| AI upscale | Native Rust upscale boundary; provider wiring is an active handoff | Large tensors; compilation and memory are material | Warm suitable provider can win; one-off small jobs may stay CPU | Per-job provider metadata, quality, memory, cold/warm timing |
| Export | Existing authoritative native/CPU path | Final document fidelity and file semantics dominate | Never return a stale preview as final output | Export parity, reopen, screenshot and file validation |
| NPU inference | No verified route on the primary host | Vendor/runtime/model-specific; often static/quantized constraints | Only select after runtime, model, and placement gates pass | Vendor trace/provider diagnostics and representative model |

Required platform lanes are: primary CachyOS/Wayland x86-64; CPU-only and
software/virtual adapters; Windows x86-64/ARM64 where artifacts exist; macOS
Intel separately from Apple Silicon; other supported Linux distributions; and
ChromeOS browser/PWA separately from Linux ARM64 inside Crostini. Host hardware
does not grant a guest or webview access to the same device.

## Complaint-driven fixes in scope

The following are realistic failure patterns rather than generic anecdotes:

- Photoshop users report black horizontal canvas lines, freezes, or black
  screens that disappear when “Use Graphics Processor” is disabled. Varve’s
  response is per-workload fallback, authoritative redraw, and a recoverable
  reset—not a permanent global graphics disable.
- Figma users report WebGL initialization failures, lost contexts, or a blank
  canvas with the layer UI still present. Varve’s response is context-loss
  detection, generation-guarded repaint, and a status reason that distinguishes
  webview presentation from application effect compute.
- Tauri/WebKitGTK reports include Linux NVIDIA navigation crashes and
  release/AppImage failures caused by bundled WebKit-adjacent libraries. Varve’s
  response is release-like package testing and precise unmet-prerequisite
  diagnostics; `WEBKIT_DISABLE_GPU`, `LIBGL_ALWAYS_SOFTWARE`, root execution,
  or disabled sandboxing are not the default product fix.
- ONNX Runtime users report GPU-provider initialization/fallback failures. Varve
  keeps automatic CPU fallback for normal use and a strict diagnostic mode for
  exposing unsupported partitions where available; a provider name alone is
  never presented as execution proof.
- AMD XDNA issue reports show firmware, DKMS/kernel, driver, and platform
  coupling failures even when hardware is present. Varve therefore treats
  `/dev/accel`, a product SKU, or a provider enum as discovery only and reports
  the missing runtime/model/placement stage precisely.

Primary complaint and failure references:

- [Adobe Photoshop GPU canvas complaint](https://community.adobe.com/questions-712/photoshop-displays-random-black-horizontal-lines-on-the-canvas-when-use-graphics-processor-is-enabled-1633188)
- [Figma WebGL blank-canvas report](https://forum.figma.com/ask-the-community-7/why-my-figma-always-black-screen-10903)
- [Figma WebGL initialization report](https://forum.figma.com/ask-the-community-7/fix-launched-could-not-initialize-webgl-14067)
- [Tauri WebKitGTK crash report](https://github.com/tauri-apps/tauri/issues/14721)
- [Tauri AppImage/WebKit library report](https://github.com/tauri-apps/tauri/issues/15665)
- [ONNX Runtime GPU fallback issue](https://github.com/microsoft/onnxruntime/issues/5299)
- [AMD XDNA firmware/driver issue](https://github.com/amd/xdna-driver/issues/1469)

These links were checked on 2026-09-13. They establish reported failure modes,
not Varve-specific reproduction or frequency.

## Source and version register

The following primary sources were refreshed on 2026-09-13. The exact pinned
Varve API must win over examples from a newer release.

| Topic | Source and relevant constraint |
|---|---|
| Tauri webviews | [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/) — WebView2 on Windows, WKWebView on macOS, and distro-provided WebKitGTK on Linux; Linux versions vary by distribution. |
| Native graphics | [`wgpu` 30.0.1](https://docs.rs/wgpu/30.0.1/wgpu/) — native Vulkan/Metal/D3D12/OpenGL-capable API; package MSRV is `1.87`; backend support is not webview/provider interoperability. |
| ORT providers | [Execution providers](https://onnxruntime.ai/docs/execution-providers/) and [profiling](https://onnxruntime.ai/docs/performance/tune-performance/profiling-tools.html) — provider registration and profiler placement are separate evidence. |
| Native WebGPU EP | [Native WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) — a plugin shared library and compatible core runtime; native WebGPU EP is distinct from browser JavaScript/WebGPU execution. |
| Windows | [Windows ML providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers) — CPU/DirectML are in-box while other providers can be downloaded on demand; OpenVINO/QNN/Vitis requirements are OS, driver, architecture, and hardware-specific. |
| Intel | [OpenVINO EP](https://onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider.html) — CPU/GPU/NPU devices, precision and dynamic-shape limits differ; NPU selection is not GPU selection. |
| Qualcomm | [QNN EP](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html) — HTP is the NPU route; quantization/model constraints and strict CPU-fallback controls matter. |
| Apple | [Core ML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html) — allowed compute units are policy; CPU/GPU/Neural Engine placement is not guaranteed per operator. |
| Memory movement | [ORT I/O binding](https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html) — copies can be reduced only where the actual provider/resource interfaces support it. |
| Browser | [ORT WebNN](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html), [ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html), and [WebNN status](https://chromestatus.com/feature/5176273954144256) — feature-test the actual browser/model; browser support is separate from the Tauri route. |

## Ownership and handoffs

This agent owns the new evidence/architecture records, packaging integrity and
release-support documentation, native capability truthfulness, desktop
diagnostic UI/visual validation, and final integration checks.

The following files are currently being modified by other work in the dirty
tree and are not to be overwritten without a handoff:

- `crates/varve-accel/src/effects.rs`, its resampling shader, and benchmark;
- `crates/varve-upscale/Cargo.toml`, `src/ai.rs`, `src/lib.rs`, and the probe;
- drawing/input, typography, colorization, generative-editing, and their
  website/E2E evidence.

Shared interfaces will be re-read immediately before edits. Work is sequential
when no agent coordination primitive is available. Any native provider that
cannot be hardware-verified remains gated and documented as unverified; it is
not exposed as an enabled stub.

## Ordered delivery gates

1. **Audit and baseline** — this record, source refresh, host inventory, code
   path audit, and failure-mode register.
2. **Capability contract** — stage-specific native/browser reports, safe CPU
   baseline, bounded self-test, and explicit failure reasons.
3. **Native GPU compute** — finish the highest-value resampling/effect consumer
   only after cold/warm end-to-end measurements and parity fixtures.
4. **Native inference** — complete real model consumers and per-job provider
   evidence; keep CPU fallback and single-flight/session safety.
5. **Packaging/UI/recovery** — verify release-like artifacts, repair/corruption
   handling, safe reset, visual diagnostics, and interaction preservation.
6. **Web/PWA** — browser adapters and parity fixtures through the same workload
   contracts, with production-origin checks and no native-only assumptions.
7. **Final integration** — support matrix, setup/troubleshooting, marketing
   claims, release notes, exact benchmarks, inspected artifacts, and the
   repository validation report.

Acceptance requires a real installed-app consumer and evidence of its selected
and observed backend. A device list, provider enum, compilation success, or
green synthetic smoke test is insufficient.
