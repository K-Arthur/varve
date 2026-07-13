# WebGPU Manual Verification Checklist

**Why this exists:** CI has no real GPU access (see "Known Gaps" in
[render-pipeline.md](render-pipeline.md)). `packages/compositor/src/webgpu/golden.test.ts`'s
real-adapter test, and the `e2e` Playwright job, both self-skip or silently fall back to a
software rasterizer on GitHub-hosted runners. Nothing in the automated pipeline can tell you
the WebGPU path actually works on real hardware — only a human running the app on a real GPU
can. Run this before shipping a release where the WebGPU compositor path
(`settings.render.preferWebGpu`) changed, and periodically otherwise since driver updates can
regress it silently.

This is the cheapest of the three options named in `render-pipeline.md`'s Known Gaps (a
GPU-enabled CI runner, or a scheduled hardware benchmark pass, being the other two — both are
infra/cost decisions for a human, not made here). Use this checklist until/unless one of those
is adopted.

## Setup

1. Enable the flag: Settings → Rendering → "Prefer WebGPU" (`settings.render.preferWebGpu`).
2. Reload the app (required — see the rollback caveat in `render-pipeline.md`).
3. Open the status bar. Confirm it reads `webgpu` (not `canvas2d (cpu)`), and hover the label:
   the tooltip should read `GPU active`, not `GPU fallback` or
   `GPU fallback (software adapter declined)`. If you see the latter, ADR-0003's minimum-baseline
   check (`packages/compositor/src/webgpu/backend.ts`) has detected a software adapter (e.g.
   SwiftShader) on this machine — that's a signal about *this machine*, not a bug, but it means
   you're not actually verifying the GPU path on this hardware. Find a machine with a real GPU.

## Checklist

- [ ] **Primitives render correctly:** draw a rect, circle, and line/stroke. All three should be
      visible with correct fill color and opacity (this is the specific regression Task 2 of the
      original plan fixed — lines rendered nothing before quad tessellation).
- [ ] **Mixed content composites correctly:** a document with GPU primitives (rect/circle/line)
      *and* CPU-only content (text, path, effects) in the same frame — confirm the Canvas2D
      present path draws non-GPU primitives on top of the GPU blit without a visible seam
      (ownership invert 2026-07-13: present canvas is always 2D; GPU is offscreen).
- [ ] **Pan/zoom stays smooth and correct:** no vertex corruption, no stale bundle-cache artifacts
      (the render-bundle cache keys on a content hash — a hash collision or stale-write bug would
      show up as "wrong shape drawn" during rapid edits). Confirm rotated view (view rotation)
      keeps GPU and 2D content aligned.
- [ ] **Resize the window:** present canvas + offscreen GPU canvas both resize; no stretched or
      black frame.
- [ ] **Force a device loss if your driver/tooling allows it** and confirm the status bar switches
      to "GPU lost — using Canvas2D" (`CompositorDiagnostics.deviceLost`). Rendering must
      **continue** on Canvas2D without a remount (ownership invert). Reload only if you want to
      re-acquire the GPU adapter.
- [ ] **Check `pipelineInitMs` via the diagnostics** (status bar tooltip today only shows pool/
      bundle counts — read `compositorDiagnosticsStore`'s current value directly, or add a
      temporary log) and sanity-check it's not a multi-hundred-ms outlier on this hardware.

## Automated helper

```bash
./scripts/verify-webgpu.sh
```

The script:
1. Checks prerequisites (`npx`, Playwright).
2. Checks if `navigator.gpu` is exposed in headless Chromium with SwiftShader.
3. Starts the dev server (`pnpm --filter @strata/desktop dev`).
4. Runs the Playwright WebGPU smoke test (`tests/e2e/webgpu/webgpu-smoke.spec.ts`).
5. Captures a screenshot of the editor with the compositor diagnostics overlay.
6. Prints the manual verification checklist from this doc.
7. Exits 0 if all automated checks pass.

Set `SKIP_PLAYWRIGHT=1` to skip automated tests and print only the checklist.

## Recording results

Note the date, OS, GPU/driver, and browser/webview version alongside pass/fail for each item.
There is no automated home for this log yet — until CI can run this itself (see Known Gaps),
append findings to this file's history via git log, or to `WEBGPU_WASM_ENGINE_MEMORY.md` at the
repo root if this is part of active feature work rather than a pre-release check.
