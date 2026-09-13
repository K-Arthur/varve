# Shader system verification (2026-09-13)

Status: independent verification checkpoint plus one repaired production
rendering defect. This document separates hardware-verified behavior from
software-adapter evidence and from code that exists but does not reach a
production consumer.

## Environment and method

- Device: AMD Lucienne (RDNA-2), Linux CachyOS. Chromium (channel
  `chromium`) launched headless with `--enable-unsafe-webgpu
  --enable-features=Vulkan --use-angle=vulkan`, reporting hardware adapter
  vendor `amd`, architecture `rdna-2`. This is real hardware execution, not
  SwiftShader.
- Primary sources consulted before changing shader interfaces:
  WebGPU specification (texture copies), MDN
  `GPUCommandEncoder.copyTextureToBuffer` (destination `bytesPerRow` must be
  a multiple of 256), MDN `GPUQueue.writeTexture` (no such stride rule), MDN
  `GPUShaderModule.getCompilationInfo`, `GPUDevice.lost`.
- Method: code tracing from UI entry points, hardware execution through
  Playwright, image inspection, numerical comparison against the Canvas2D
  reference, and naga validation of every WGSL module.

## Verified by real-hardware execution

### WebGPU live-effect kernels agree with the CPU reference

`tests/e2e/effects/gpu-agreement.spec.ts` under the `chromium-gpu` project,
48 × 32 gradient + noise input, hardware AMD adapter, concurrent request mode:

```text
bloom       meanAbs=42.81 maxAbs=126 p99=119 mismatch=1056/1536
crt         meanAbs=108.20 maxAbs=239 p99=237 mismatch=1525/1536
vhs         meanAbs=46.43 maxAbs=206 p99=149 mismatch=1519/1536
lightShafts meanAbs=10.67 maxAbs=113 p99=85  mismatch=609/1536
lensFlare   meanAbs=14.47 maxAbs=192 p99=180 mismatch=491/1536
lightLeak   meanAbs=27.94 maxAbs=193 p99=181 mismatch=903/1536
caustics    meanAbs=183.57 maxAbs=252 p99=250 mismatch=1536/1536
rgbSplit    meanAbs=40.29 maxAbs=162 p99=150 mismatch=1433/1536
paletteSnap meanAbs=7.98 maxAbs=195 p99=165 mismatch=92/1536
Result: 2 passed (4.5m), 0 failed
```

Every kernel stayed inside its committed agreement bounds. This exercises the
shared runner's input snapshotting, per-pass planning, integer parameter
transport (`array<u32, 16>` seeds), texture pooling, and readback unpacking
under concurrent requests.

### Padded readback for narrow images

`tests/e2e/webgpu/color-halftone-readback.spec.ts` runs the color-halftone
adjustment at 48 × 32 (192-byte rows) and asserts
`getColorHalftoneGpuDiagnostics().backend === 'webgpu'`. A 256-byte padded
`copyTextureToBuffer` layout is now used and rows are unpacked before the
pixels are exposed; the test passed in the same hardware run. Before the fix
the copy used `bytesPerRow: width * 4`, which is a validation error for any
row that is not 256-byte aligned.

### WebGPU primitive-compositor circle parity

`tests/e2e/webgpu/circle-transform-parity.spec.ts` renders the same solid
circle through `Canvas2DBackend` (canonical replay) and `WebGPUBackend`
(hardware) for three transforms and compares coverage bounding boxes, coverage
area, and interior pixel values.

```text
Before the fix: scaled-x2 bbox width ratio 0.545 (GPU clipped the
non-uniformly scaled circle back to the unscaled radius), test failed.
After the fix:  uniform / scaled-x2 / skewed all pass (bbox ratios within
0.92–1.08, coverage within 0.9–1.1, interior channel diff < 12).
Screenshots: /tmp/varve-shader-circles/{uniform,scaled-x2,skewed}-{reference,gpu}.png
```

The naga mirror is updated in lockstep and
`crates/varve-bridge/tests/wgsl_validation.rs` validates both circle modules
(`cargo test -p varve-bridge --test wgsl_validation circle_`: 2 passed).

## Repairs

### Circle coverage used framebuffer space (fixed 2026-09-13, `9e1e7c3f1`)

`CIRCLE_FRAGMENT_WGSL` compared `distance(@builtin(position).xy, center)` to
`r × zoom`. That is only correct while the composed transform is conformal.
A non-uniform item scale or skew maps the object-local circle to an ellipse;
the screen-space test then discarded everything outside a circle of radius
`r`, so a circle with `transform = [2, 0, 0, 1, …]` rendered at ~55% of its
Canvas2D width. `CIRCLE_VERTEX_WGSL` now forwards `pos.localPos` and the
fragment shader tests coverage in object-local space, which is exact for
every affine. `isGpuBatchSupported` additionally fails closed on singular
affines, where Canvas2D paints nothing but a degenerate GPU triangle can
still cover pixels. The `WebGPUBackend` circle uniform no longer reconstructs
camera/DPR space on the CPU.

### Earlier reliability repairs in the same stack (commit `684b44698`)

The runner now snapshots queued request bytes and parameter objects, keeps a
serial execution queue, retains in-flight pooled textures by key, scopes every
pipeline/module cache entry by device generation, surfaces compilation and
pipeline-validation diagnostics instead of describing them as silent
no-ops, and drops all child resources on device loss with late-completion
generation guards. The bloom streak pass no longer reads and writes the same
storage texture. Integer seeds travel in a `u32` storage buffer, so values
above 2^24 are no longer rounded through f32.

### Dispatch grid contract (`004ac51d1`)

`planEffectPasses` accepted any positive workgroup z and the runner used that
value as the Z dispatch count. Passes write a single 2D storage texture, so
the grid is `(ceil(w/wgX), ceil(h/wgY), 1)`. Every shipped kernel already
declared `[8, 8, 1]`, but a `z` other than 1 would have dispatched a different
grid than the shader's `@workgroup_size`; the planner now rejects it and the
runner dispatches one layer.

## Reachability findings (not repaired here)

These are verified by import tracing; a registered kernel or a passing helper
test is not evidence of production use.

| Capability | State | Evidence |
| --- | --- | --- |
| WebGPU effect runner + 10 kernels | Production-unreachable | `gpuEffectProvider`, `dispatchLiveEffect`, `buildEffectChain` have no callers outside the E2E harness. The async export hook (`packages/editor/src/export/flattenForExport.ts`) was removed in `d07f8877f` as dead code. |
| GPU color halftone (`applyColorHalftoneGpu`) | Production-unreachable | Only re-exported by `packages/engine/src/gpu/index.ts`. The interactive/export adjustment path calls the CPU `applyColorHalftone` via `filterCompositor`. |
| GPU color-halftone algorithm | Guarded legacy-only | The WGSL implements the legacy v1 screening contract; `applyColorHalftoneGpu` rejects other algorithm versions with a `gpu-supports-legacy-color-halftone-only` diagnostic and falls back to CPU, so it cannot silently change corrected V2 artwork if a caller appears. |
| Native GPU compute (desktop) | Wired | `nativeGpuEffectProvider` + `apply_live_effect_binary` backend header (`052339410`); unsupported effects and device loss fall through to native CPU providers. |
| Browser WebGPU primitive presentation | Wired, opt-in | `settings.render.preferWebGpu` (default false); Canvas2D present surface; structural fallback planning. |

Recommendation: before wiring the WebGPU effect provider into preview or
export, port the corrected V2 color-halftone semantics (or drop that kernel
from the GPU set), and add a CPU/GPU agreement case for every kernel that
becomes reachable. The dispatch chain itself already falls through correctly;
the risk is a silent backend-dependent appearance change.

## Marketing/website claim check

`apps/website/src/pages/features/shader-effects.astro` and
`docs/tools/shader-effects.astro` were authored concurrently with this
verification. Claims checked against the implementation:

- "Backend diagnostics distinguish actual execution from API availability" —
  holds for the native acceleration panel and the color-halftone diagnostics;
  there is no user-facing web-effect backend readout yet.
- "Unsupported GPU work falls back to a verified software path" — holds for
  the desktop native GPU provider and for the kernel-level CPU reference the
  harness verifies; the web provider itself is not routed yet.
- The page was missing from the features hub; a `Shader Effects` card was
  added to `apps/website/src/pages/features.astro` on 2026-09-13.

## Residual gaps

- No hardware WebGPU in CI (existing known gap in
  `docs/architecture/render-pipeline.md`). The new parity spec skips with an
  explicit reason when the browser exposes no hardware adapter.
- Circle draws still bypass the render-bundle cache (one render pass per
  circle); the local-space fix does not change that, and no before/after
  measurement is claimed.
- The Playwright `globalSetup` editor warm-up timed out repeatedly while
  several agents ran heavy suites on this 8-core host. Harness-independent
  specs can be run with `VARVE_VISUAL_HARNESS_ONLY=1`, which is what the
  circle-parity verification used; the standard path remains the default for
  editor specs.

## Evidence commands

```bash
# Hardware GPU effect agreement + padded readback
VARVE_E2E_PORT=1507 node scripts/quality/heavy-lease.mjs e2e-shader-validate -- \
  npx playwright test tests/e2e/effects/gpu-agreement.spec.ts \
    tests/e2e/webgpu/color-halftone-readback.spec.ts \
    --project=chromium-gpu --workers=1 --reporter=list

# Circle transform parity (real hardware; skips without a hardware adapter)
VARVE_VISUAL_HARNESS_ONLY=1 VARVE_E2E_PORT=1523 \
  npx playwright test tests/e2e/webgpu/circle-transform-parity.spec.ts \
    --project=chromium --workers=1 --reporter=list

# WGSL drift + naga validation
pnpm vitest run packages/compositor/src/webgpu/wgsl-drift.test.ts
cargo test -p varve-bridge --test wgsl_validation circle_
```
