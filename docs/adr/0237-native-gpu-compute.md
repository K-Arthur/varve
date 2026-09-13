# ADR-0237: Native GPU compute and truthful accelerator capability model

- **Status:** Accepted (implemented in this change set)
- **Date:** 2026-09-13
- **Related:** ADR-0001, ADR-0003, `docs/architecture/native-acceleration.md`,
  `docs/audits/gpu-npu-native-support-audit-2026-09-13.md`

## Context

Varve runs native scene processing and emits render IR that the webview
replays (ADR-0001). ADR-0003 deferred a native GPU overlay and kept Canvas2D
authoritative. Neither decision created a native *compute* path: the workspace
had no `wgpu` dependency, live-effect kernels are CPU-only
(`crates/varve-effects`), and the shipped ONNX Runtime exports only the CPU
execution provider. At the same time, measured CPU costs at export resolution
are seconds per effect (LightShafts 4.3 s, Bloom 1.9 s at 2048×2048), and the
browser-side WebGPU effect provider has no production caller.

Users also report the opposite failure pattern across the industry:
whole-application GPU acceleration without per-feature fallback (Photoshop
canvas corruption, Figma blank canvases) and vendor NPU stacks that are
"split-state" on Linux (AMD XDNA firmware/driver coupling, ONNX Runtime Vitis
AI build failures, Intel NPU's narrow validated OS matrix). The capability
model must therefore never conflate *advertised* with *usable*.

## Decision

1. Add `crates/varve-accel`, a native acceleration crate with one capability
   model and two implementations:
   - device discovery and a bounded self-test via `wgpu` (Vulkan/Metal/D3D12),
     independent of `navigator.gpu`;
   - offscreen compute kernels for live effects, with parity tests against the
     CPU reference in `crates/varve-effects`.
2. Track accelerators through explicit stages — `unknown → discovered →
   runtimeLoadable → deviceUsable → executionVerified → unavailable` — with a
   typed reason (`driverMissing`, `runtimeMissing`, `artifactMissing`,
   `softwareOnly`, …) instead of one boolean. Software adapters are discovered
   and reported, never selected.
3. Keep presentation unchanged: the webview still replays IR.
   `packages/compositor` remains the presentation path; native compute only
   produces pixels for workloads that explicitly request them.
4. Inference reporting follows the loaded runtime: the shipped ONNX Runtime
   artifact contains only the CPU execution provider, so no GPU/NPU provider
   may be advertised as active. Accelerated inference targets are documented
   as gated on provider artifacts, with the native WebGPU plugin EP
   (`onnxruntime_providers_webgpu.so`) as the first cross-vendor candidate.
5. Do not reintroduce async effect dispatch into export flattening. The
   current export path replays the real pipeline by design; the earlier
   `flattenForExport.ts` dispatch was removed because it produced wrong
   output. Async GPU effects are wired through the provider chain, and a
   consumer must opt in only where the pipeline is asynchronous end to end.

## Consequences

- Positive: a real, measured native GPU path (RGB split parity is byte-exact;
  measured 14–38× over CPU from 512² to 4096²), a capability report that can
  explain *why* something is unavailable, and a bounded self-test that proves
  execution instead of inferring it.
- Positive: no new runtime artifacts or vendor SDKs ship in the base app;
  `wgpu` is compiled in and uses the system graphics stack.
- Negative: a new heavyweight build dependency (`wgpu`) and a new workspace
  crate that must stay green across Linux, Windows, and macOS. The engine must
  handle device loss, bounded readback, and fall back to the CPU kernels.
- Deferred: canvas presentation on a native surface (ADR-0003 still holds),
  GPU inference, and NPU execution. Each requires its own bounded prototype
  and hardware verification before it may be advertised.

## Verification

- `cargo test -p varve-accel` — capability, discovery, software-adapter refusal,
  self-test, and RGB-split parity (byte-exact on the reference corpus).
- `cargo run --release -p varve-accel --example gpu_effect_bench` — end-to-end
  CPU vs GPU including upload/readback.
- `cargo run --release -p varve-effects --example effect_cost` — CPU baseline
  table used for selection policy.
