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

1. Enable Settings → General → Render performance → "Prefer WebGPU when available"
   (`settings.render.preferWebGpu`).
2. Reload the document tab so the compositor initializes with that preference.
3. Inspect the status bar or Performance tab. `WebGPU ready` means a device initialized;
   `Canvas2D · GPU ready` means the last completed frame used Canvas2D or worker replay;
   `WebGPU + Canvas2D` means eligible items were actually submitted to WebGPU in that frame.
   `GPU unavailable · Canvas2D` carries the fixed initialization reason in its tooltip,
   a live status for assistive technology, and visible text under Settings → Performance.
   A software adapter is declined by ADR-0003's gate. Device readiness alone is not a
   rendering pass; if ordinary editing never produces `WebGPU + Canvas2D`, record that
   reachability gap instead of claiming acceleration.

## Checklist

- [ ] **Primitives render correctly:** draw two separated solid circles with different
      radii/colors and a plain solid rectangle. Both circles must remain visible;
      line/stroke and rounded rectangles must render through Canvas2D with their
      authored shape. Inspect the output, not just the backend label.
- [ ] **Mixed content composites correctly:** a document with eligible plain solid rectangles/circles
      *and* CPU-only content (text, path, effects) in the same frame — confirm the Canvas2D
      present path draws non-GPU primitives on top of the GPU blit without a visible seam
      (ownership invert 2026-07-13: present canvas is always 2D; GPU is offscreen).
- [ ] **Pan/zoom stays smooth and correct:** no vertex corruption, no stale bundle-cache artifacts
      (the render-bundle cache keys on a content hash — a hash collision or stale-write bug would
      show up as "wrong shape drawn" during rapid edits). Confirm rotated view (view rotation)
      keeps GPU and 2D content aligned.
- [ ] **Resize the window:** present canvas + offscreen GPU canvas both resize; no stretched or
      black frame.
- [ ] **Submit a large solid run and simulate a draw error:** rectangle chunks must
      preserve overlap/order beyond 4 MiB. A synchronous GPU error must replay
      the failed run and all later runs through Canvas2D without losing artwork;
      Performance diagnostics must identify the draw failure.
- [ ] **Force a device loss if your driver/tooling allows it** and confirm the status bar switches
      to "GPU lost · Canvas2D" (`CompositorDiagnostics.deviceLost`). Rendering must
      **continue** on Canvas2D without a remount (ownership invert). Reload only if you want to
      re-acquire the GPU adapter.
- [ ] **Check `pipelineInitMs` via Performance → Copy performance diagnostics** and
      investigate a multi-hundred-ms outlier on this hardware. A null value means no
      WebGPU pipeline was initialized; it is not a zero-millisecond result.

## Automated helper

```bash
./scripts/verify-webgpu.sh
```

The script:
1. Checks prerequisites (`npx`, Playwright).
2. Checks if `navigator.gpu` is exposed in headless Chromium with SwiftShader.
3. Starts the dev server (`pnpm --filter @varve/desktop dev`).
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
