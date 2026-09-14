# Native GPU resampling evidence — 2026-09-13

This is a measured qualification record for the installed-desktop native
resampling route. It does not establish a universal speedup or certify the
web/PWA route.

## Environment

- OS: CachyOS rolling on Wayland, x86-64
- GPU: AMD Radeon Graphics, RADV Renoir, integrated GPU
- Driver/graphics stack: Mesa/RADV 26.2.2, Vulkan 1.4.357
- Native graphics API: `wgpu` 30.0.1, Vulkan backend
- Rust: `rustc 1.97.1`
- Workload: RGBA image resize; timings include source upload, shader dispatch,
  synchronization, readback, and the benchmark's result validation
- Policy: the native GPU route was admitted only after the bounded device
  self-test; the CPU path is the reference path

## Command

The workload was run under the repository heavy-task lease so no other local
benchmark was deliberately allowed to compete for the device:

```text
node scripts/quality/heavy-lease.mjs accel-gpu-bench-20260913 -- \
  cargo run --release -p varve-accel --example gpu_resample_bench
```

At the time of measurement the resampler example and shader were in the
native-acceleration working tree. The release gate must rerun this command at
the exact candidate SHA after those files are committed.

## End-to-end timings

| Source → destination | Filter | CPU ms | GPU ms | CPU/GPU ratio |
|---|---:|---:|---:|---:|
| 1920×1080 → 3840×2160 | bicubic | 2001.47 | 43.95 | 45.5× |
| 1920×1080 → 3840×2160 | Lanczos3 | 2153.82 | 81.92 | 26.3× |
| 3000×2000 → 6000×4000 | bicubic | 2805.11 | 288.10 | 9.7× |
| 3000×2000 → 6000×4000 | Lanczos3 | 2940.92 | 382.02 | 7.7× |

These are single-run qualification measurements, not p50/p95 production
baselines. The route must retain a cold/warm and small-request comparison
before changing the automatic threshold: device creation and data movement
can make CPU faster for small or one-off requests.

## Visual and numeric inspection

The companion report generated CPU and GPU images for a gradient/checkerboard
fixture with an RGB split and an alpha edge. I opened the CPU image, GPU image,
and amplified diff images with the image viewer. The inspected result showed
aligned gradients, checkerboard boundaries, the RGB fringe, and transparent
edges without visible seams, clipping, or alpha halos. The amplified diff was
effectively black apart from isolated low-amplitude edge pixels.

Ignored local artifacts (not release assets) are in:

```text
reports/native-gpu-session-20260913/rgb-split-cpu.png
reports/native-gpu-session-20260913/rgb-split-gpu.png
reports/native-gpu-session-20260913/rgb-split-diff-x24.png
reports/native-gpu-session-20260913/resample-cpu.png
reports/native-gpu-session-20260913/resample-gpu.png
reports/native-gpu-session-20260913/resample-diff-x24.png
```

The benchmark and visual report are separate from the browser visual checks:
Chromium screenshots validate the marketing/PWA layout only and do not certify
Tauri/WebKitGTK or native GPU execution.

## Interpretation

The evidence supports a useful native GPU consumer for large non-AI image
resampling on this AMD/Vulkan host. It does not support claims about every
effect, every GPU vendor, NPU inference, or browser rendering. Unsupported
filters and failed device/runtime operations remain on the CPU/reference path;
the source document is not changed by the choice of backend.
