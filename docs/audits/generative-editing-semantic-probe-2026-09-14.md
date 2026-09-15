# Generative editing semantic probe — 2026-09-14

## Decision

The tested local inpainting candidate remains rejected. It completed without
crashing on a real photograph and preserved the surrounding scene, but it did
not follow the requested replacement prompt. Prompt-conditioned Replace must
remain unavailable; this result is diagnostic evidence, not product or
marketing proof.

## Reproducible probe

- Source: `real-life-tsitsikamma-coast.jpg`, a CC BY-SA 4.0 Wikimedia Commons
  photograph by Dietmar Rabich. The exact 512 × 512 center crop used by the
  runtime is retained in the [probe evidence directory](../../tests/e2e/fixtures/generative-evidence/qualification-2026-09-14-semantic-probe/).
- Mask: a 116 × 96 white rectangle over open water at `(360, 250)` in the
  512 × 512 source frame; black means preserve.
- Request: Replace with “a small red canoe floating on the ocean, side view,
  realistic photograph”; negative prompt “text, watermark, blurry, distorted,
  duplicate objects”; seed 42; strength 0.75; CFG 7; eight effective sampling
  steps; 256 × 256 bounded model frame.
- Model: Stable Diffusion 1.5 Inpainting Q4_0, SHA-256
  `ababf34dbf33f8b23d1401afeaa719167ff6a95b16389c61a08d83e8503a1b4d`, under
  CreativeML OpenRAIL-M.
- Runtime: `stable-diffusion.cpp` commit
  `42d6c0ab92fe6595776b28e3f7c8925db79b31f5`, CPU on Linux x86_64; elapsed
  time 89.12 seconds.

The candidate produced a bright neon rectangular object in the masked water,
not a small red canoe. The full raw PNG, source, mask, runtime log, hashes, and
settings are recorded in `manifest.json`. The output was inspected as a full
composition; its semantic failure is visible without relying on pixel-diff
or a passing process exit code.

## Runtime investigation boundary

The latest upstream runtime was also configured for Vulkan in an isolated
build, but this host lacks the Vulkan development headers, so no Vulkan
qualification claim is made. The host's installed Vulkan loader/device does
not substitute for a reproducible helper build. Installing system packages or
changing the desktop environment is outside this probe.

The existing qualification record retains the other failed SD 1.5/SD 2
precision and backend experiments. Together they show that the current
failure is not corrected by merely downloading another copy, changing Q4/F16
precision, or switching to an unqualified Vulkan path.

## Release impact

This probe does not change the product boundary:

- promptless Fill and Remove remain available through Quick Cleanup and the
  qualified LaMa path where the device and runtime permit it;
- Object Selection remains an editable, confirmed mask source, with real SAM2
  corpus evidence recorded separately and its weak categories still below the
  release threshold;
- browser semantic generation and browser photographic Expand remain gated;
- the native diffusion certificate allowlist remains empty until a model,
  runtime, and target package clear the complete real-photo, memory,
  cancellation, persistence, and export gates.

The model landscape records the next candidates—PowerPaint v2, BrushNet or
BrushEdit, SDXL Inpainting, and stronger promptless repair—in priority order,
with licensing and resource constraints. No candidate is promoted by this
single probe.
