# Native Acceleration

Canonical architecture for native GPU device discovery, capability reporting,
and offscreen compute. Related decisions: ADR-0001 (IR replay), ADR-0003
(compositor backend selection), ADR-0237 (this system). Audit with evidence
and failure-mode research:
`docs/audits/gpu-npu-native-support-audit-2026-09-13.md`.

## Boundaries

| Concern | Owner | Notes |
|---|---|---|
| Canvas presentation | webview + `@varve/compositor` | Canvas2D replay is authoritative; WebGPU is opt-in per ADR-0003 |
| Native compute | `crates/varve-accel` | Offscreen effects/resampling on a native device |
| Inference | `crates/varve-bgremove`, `crates/varve-upscale` via ONNX Runtime | Provider status is reported from what the *loaded* runtime provides |
| Frontend contract | `@varve/engine` native-acceleration client (added with the desktop wiring milestone) | Mirrors the Rust report; no separate detector |

A native GPU being present does **not** mean the DOM canvas draws on it, and
browser `navigator.gpu` is irrelevant to native discovery. Native discovery
uses `wgpu` over Vulkan/Metal/D3D12.

## Capability model

`crates/varve-accel/src/capability.rs` defines the shared vocabulary:

- `AccelStage`: `unknown`, `discovered`, `runtimeLoadable`, `deviceUsable`,
  `executionVerified`, `unavailable`.
- `UnavailableReason`: `notPresent`, `driverMissing`, `runtimeMissing`,
  `artifactMissing`, `permissionDenied`, `softwareOnly`, `unsupportedPlatform`,
  `unsupportedOperator`, `initFailed`, `timeout`, `deviceLost`, `userDisabled`,
  `unknown`.
- `DeviceKind`: `cpu`, `gpu`, `npu` — compute and inference are separate
  capability rows even on the same silicon.

`NativeAccelerationReport` is versioned (`schemaVersion`) and timestamped so
the UI can discard stale probes and after a re-detect.

## Discovery and selection

`crates/varve-accel/src/discovery.rs`:

1. `discover_compute_devices()` enumerates adapters without creating a device.
2. Software adapters (`DeviceType::Cpu` or a marker match in name/driver/
   driver-info: `swiftshader`, `swift`, `fallback`, `software`, `llvmpipe`,
   `lavapipe`, `basic render`) are reported as `softwareOnly` and scored 0. The
   marker list matches `packages/engine/src/gpuAdapter.ts`.
3. Selection ranks discrete > integrated > virtual > other, never software.
4. `device_id` is descriptive (`vulkan:1002:164c:amd-radeon-graphics-radv-renoir`)
   and never a persisted adapter index.
5. `GpuCompute::self_test()` dispatches a bounded 256-element compute shader and
   verifies the readback; only then may a device be reported as
   `executionVerified`.

Probing is bounded: device creation is budgeted (8 s) and every readback uses a
timeout (30 s). Discovery runs lazily (Settings, explicit re-detect, or the
first GPU workload), never on startup.

## Compute engine

`crates/varve-accel/src/effects.rs` executes effects as storage-buffer compute
passes:

- standard bind group: `src` (read storage), `dst` (read-write storage),
  `params` (80-byte uniform);
- one workgroup per 8×8 pixel tile;
- result readback through a staging buffer (`MAP_READ | COPY_DST`);
- reported duration is end-to-end (upload → dispatch → synchronization →
  readback), not kernel-only time;
- errors map to `deviceLost` (device/test failure), `initFailed`, or
  `execution` so callers can fall back.

Kernels must match the CPU reference in `crates/varve-effects`. RGB split
(`shaders/rgb_split.wgsl`) is byte-exact against the CPU kernel on the parity
corpus. New kernels are only exposed by `gpu_effect_supported` after a parity
test exists; everything else returns an error so the caller falls back.

## Consumer wiring

Desktop:

- `apply_live_effect_binary` accepts an explicit backend
  (`x-varve-effect-backend: gpu|cpu`). `gpu` errors when the GPU path cannot
  produce a result, which is what lets the frontend chain fall through to the
  native CPU provider. There is no ambiguous `auto` mode at the IPC layer —
  the chain already owns fallback ordering.
- `native_acceleration_status` and `native_gpu_self_test` expose the report
  and a bounded verification run to Settings and diagnostics.

Web: the same `LiveEffectProvider` chain is consumed by `dispatchLiveEffect`;
the browser GPU tier is `gpuEffectProvider` from `@varve/compositor`. The
render worker never calls Tauri.

**Not wired by design:** interactive preview and export replay are synchronous
per-frame paths. Effect acceleration is offered to asynchronous consumers.
The previous export flattening implementation (`flattenForExport.ts`) applied
live effects through an async chain and was removed after producing wrong
output; export now replays the real pipeline. Do not reintroduce that design
without a full frame-delivery prototype.

## Inference status

The shipped ONNX Runtime (`scripts/fetch-onnxruntime.mjs`, ORT 1.27.1)
contains only the CPU execution provider — verified by symbol scan of the
staged `libonnxruntime.so` (`OrtSessionOptionsAppendExecutionProvider_CPU`
only) and by the absence of any provider shared library in the bundle. The
capability report therefore lists CPU as available and every accelerated
provider as `runtimeMissing`/`artifactMissing` with the reason named.

Candidate accelerated routes and their exact gates are tracked in the audit
matrix (Windows ML, OpenVINO, CUDA/TensorRT, MIGraphX, QNN, Core ML, and the
native WebGPU plugin EP). None may be exposed as an enabled selector until a
provider artifact ships, a session initializes on real hardware, and
placement is observed.

## Memory and scheduling

- GPU effect surfaces are bounded by the same 33,554,432-pixel ceiling as the
  native effect command.
- Work is submitted on blocking worker threads; the caller serializes GPU
  effect jobs so a single device queue is never saturated by concurrent
  interactive work.
- Buffers are allocated per run in this milestone; pooling arrives with the
  second kernel and is keyed by byte size.
- Device loss drops the cached engine; the next request recreates it and the
  UI reports the fallback rather than freezing a stale surface.

## Verification

```bash
cargo test -p varve-accel
cargo run --release -p varve-accel --example gpu_effect_bench
cargo run --release -p varve-effects --example effect_cost
```

Measured on CachyOS / RADV RENOIR (Ryzen 3 5300U), 2026-09-13:

| Surface | CPU | GPU (end-to-end) | Speedup |
|---|---:|---:|---:|
| RGB split 512² | 80 ms | 2.7 ms | 29× |
| RGB split 1024² | 346 ms | 11.7 ms | 30× |
| RGB split 2048² | 786 ms | 20.4 ms | 39× |
| RGB split 4096² | 3853 ms | 275 ms | 14× |

Self-test: `AMD Radeon Graphics (RADV RENOIR)`, Vulkan, 5–8 ms. Software
adapters are declined; on hosts without a hardware adapter the report explains
`notPresent`/`softwareOnly` and every workload stays on CPU.
