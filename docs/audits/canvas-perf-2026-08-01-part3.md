# Canvas Performance — Measured Continuation, 2026-08-01 (part 3)

This audit continues
[`canvas-perf-2026-08-01-part2.md`](canvas-perf-2026-08-01-part2.md). It starts
at commit `ff4d5ea9` and records the state before this tranche changes runtime
code. Earlier reports already fixed the dominant quadratic parent lookup,
per-frame engine-node conversion, cache eviction, and console/WebGL-context
floods. Those results are the baseline architecture, not work to repeat.

## Evidence rules

- Browser timings below are five-run distributions where stated. They are not
  native WebKitGTK presentation timings.
- Headless Chromium 149 selects ANGLE SwiftShader on this host and exposes no
  `navigator.gpu`; it is a software-rendered fallback-path measurement.
- Deterministic work counts and resource bounds are stronger regression gates
  than absolute milliseconds on a shared development machine.
- No backend rewrite or permanent quality reduction is justified by the
  evidence collected so far.

## Current host and runtime baseline

Captured at approximately 22:17 PDT while the machine load average was below
1.1. Unrelated processes were observed and left untouched.

| Item | Observed value |
|---|---|
| OS/session | CachyOS, Linux 7.1.3-2-cachyos, KDE Wayland |
| CPU | AMD Ryzen 3 5300U, 4 cores / 8 threads, boost enabled, 3.9 GHz maximum |
| Memory | 22 GiB physical, about 12 GiB available |
| Swap | 22.8 GiB zram/zstd, about 9.4 GiB occupied |
| Display | 1920×1080 at 60 Hz, DPR/scale 1, no observed VRR or HDR |
| GPU | AMD Lucienne/Renoir integrated Radeon, amdgpu, Mesa 26.1.5 radeonsi/ACO |
| Host acceleration | Direct-rendered OpenGL 4.6 and Vulkan 1.4 available |
| WebKit/GTK | WebKitGTK 2.52.5, GTK 3.24.52 |
| Tauri | CLI/runtime 2.11.3, wry 0.55.1 |
| Toolchain | Node 26.4.0, pnpm 11.9.0, Rust 1.97.1, just 1.57.0 |
| Browser probe | Playwright Chromium 149, SwiftShader, max texture 8192, DPR 1 |

The earlier part-1 report incorrectly labelled the session X11. The host is
Wayland; that row is corrected in place.

## Architecture and synchronous-boundary map

```text
DOM PointerEvent / WheelEvent / KeyboardEvent                         [main]
  -> inputPipeline + one normalized/coalesced sample                  [sync]
  -> active tool / viewport operation / hit-test                      [sync]
  -> EditorProvider state + history transaction                       [sync]
  -> React context propagation and CanvasArea render                  [sync]
  -> shared latest-wins frame scheduler -> requestAnimationFrame      [async boundary]
  -> CanvasArea.drawContent                                           [main]
       -> walkNodes + container cull + viewport cull                  [O(document)]
       -> dirty-region/invalidation + world transform/bounds caches   [allocation/cache]
       -> effective node/style/variable/motion resolution             [main]
       -> EngineNodeMemo + NodeHashMemo + SubtreeIrCache              [bounded caches]
       -> engine.buildIr for misses
            desktop: Tauri IPC -> Rust strata-engine -> IR            [IPC/copy]
            web: JSON stringify -> WASM -> JSON parse                 [WASM/copy]
            fallback: TypeScript stub                                 [main]
       -> render-path selection
            structural scene -> CanvasArea subtree replay             [main Canvas2D]
            eligible flat scene -> workerHost                         [message boundary]
              -> OffscreenCanvas replay -> ImageBitmap                [worker]
              -> latest-revision acceptance -> bitmap composite       [main/GPU upload]
            compositor -> Canvas2D replay or optional WebGPU          [webview]
       -> overlays, selection adorners, guides, labels                [main/React+Canvas2D]
       -> frame diagnostics ring                                      [opt-in, bounded]
  -> webview/browser compositor -> display presentation               [unmeasured boundary]
```

Important cache and allocation boundaries:

- `SubtreeIrCache`, `EngineNodeMemo`, transforms, masked images, gradients,
  backdrops, decoded images, thumbnails, shaping, worker bitmaps, and WebGPU
  buffers are independently owned. Only some share the editor memory preset.
- The worker produces a full-viewport bitmap and replaces/ closes stale bitmap
  identities. Image scenes additionally create transferable `ImageBitmap`s.
- Structural masks/effects allocate bounds-sized or viewport-sized temporary
  canvases; large software blur also reads full `ImageData`.
- Native and WASM engine paths avoid some JS computation but pay full scene/IR
  serialization and copying costs on cache misses.

## Current repeated measurements

Five real-browser Canvas2D replay runs were made against the existing visual
harness. Each harness run performs its own warm-up and reports percentiles; the
table shows the median of the five reported run medians and p95 values.

| Visible items | Median p50 | Median p95 | Interpretation |
|---:|---:|---:|---|
| 100 | 0.7 ms | 5.1 ms | paint is comfortably inside one frame |
| 1,000 | 3.6 ms | 4.8 ms | raw replay is not the current 932-node bottleneck |
| 10,000 | 34.7 ms | 41.9 ms | full visible replay is below 30 FPS |
| 50,000 | 138.0 ms | 175.9 ms | full visible replay is not interactive |

Current in-app interaction probes, using the diagnostics ring:

| Scene | Frame total | Setup | Hash | Engine conversion work |
|---|---|---|---|---|
| 128 nodes | p50 1.4, p95 2.1, p99 6.2 ms | p50 0.5 ms | p50 0.3 ms | p50 0, max 1 |
| 494 nodes | p50 5.4, p95 8.9, p99 11.3 ms | p50 2.2 ms | p50 1.0 ms | p50 0, max 1 |

The existing matched production result at 932 nodes remains p50 33.2 ms,
p95 197.2 ms, and p99 633.4 ms. A current rapid-duplication attempt reached
932 reported nodes but produced no post-drag diagnostic frames. That is a
harness/robustness failure requiring isolation; it is not counted as a new
timing measurement and must not be silently discarded.

## Existing coverage and disconnected infrastructure

The repository already defines eleven deterministic workloads: small, flat
10K, depth-128, raster-heavy, vector-heavy, multilingual text-heavy,
effects/masks, rapid brush, motion, extreme zoom, and document switching. It
also has a structured benchmark-result schema and a deterministic soak harness.

Those three pieces are unit-tested but are not connected to a real browser or
native runner. Current application probes instead construct simple rectangles
through UI duplication or ad-hoc JSON. Consequently the named corpus does not
yet measure open, pan, zoom, drag, resize, duplicate, marquee, undo/redo,
save/reopen, page switching, image decode, or memory reclamation end to end.

Other repeatability gaps:

- Scripts disagree on ports 1420, 1430, 1432, and 1447; most cannot accept a
  common URL.
- `probe-latency.mjs` unconditionally sets a failing exit status.
- Most probe output omits git SHA, build mode, user agent, renderer/backend,
  DPR, refresh rate, and memory metadata even though a result schema exists.
- The real-browser replay gate is not in CI; several older timing tests use
  loose absolute limits that are noisy under contention.
- `pnpm bench` also discovers benchmark files beneath `.worktrees/`, repeating
  unrelated worktree suites after the repository-root suite. A full invocation
  was stopped once that duplicate discovery was observed; root spatial-index
  and snapping results had completed, and the dedicated root render/replay
  gates were run separately.
- No native WebKitGTK performance collector, 4 GiB cgroup run, DevTools
  open/closed comparison, or decoded-image memory/reclamation soak exists.

## Ranked findings and next experiments

1. **Harness integration is the evidence bottleneck.** Connect the existing
   corpus, collector schema, and soak harness before making broad rendering
   changes. Risk: low. Verification: identical fixtures and metadata across
   repeated dev, production, fallback, and constrained runs.
2. **Full-document setup remains the largest measured production phase at
   ~932 nodes.** `walkNodes`, culling preparation, dirty analysis, and derived
   style/variant work run before the per-node loop. Risk of optimization:
   medium because hierarchy, masks, and ancestor invalidation must remain
   correct. Next evidence: caller-attributed production profile and work
   counters, not a speculative spatial-index rewrite.
3. **Tail stalls remain severe.** Production p95/p99 at 932 nodes are
   197/633 ms. Candidate causes are GC, periodic full invalidation, history,
   React context fan-out, or asynchronous bitmap churn. Next evidence: trace
   allocation/GC and correlate every long frame with diagnostics revisions.
4. **Adaptive cache recovery has an unambiguous defect.** Canvas applies
   reduced cache limits only when the multiplier is below one and never
   restores the configured limits after recovery. A temporary constrained tier
   can therefore cause persistent cache churn. This is safe to fix with pure
   limit tests before broader adaptive-quality wiring.
5. **Gradient cache hits do not refresh recency.** A continuously used gradient
   is swept after four frames and recreated periodically. This is a local,
   behavior-preserving cache bug suitable for a focused regression test.
6. **Worker image transport can churn decoded copies.** Every eligible render
   collects new transferable bitmaps; the declared worker bitmap count is not
   enforced. Measure create/close counts and peak memory with repeated and
   unique 4K images before changing transport.
7. **Low-memory settings are incomplete.** The preset bounds subtree IR,
   transforms, engine-node memo, and backdrop entry count, but does not
   automatically control the global decoded-image cache, worker images,
   masked-image pixels, gradients, shaping, scratch surfaces, or background
   work. A 4 GiB claim is therefore unverified.
8. **Production partial redraw is not proven to scale with dirty content.** It
   clips the destination but still builds/traverses the visible list. The
   current microbenchmark simulates replaying one percent and cannot establish
   production behavior. Add real work counters before changing invalidation.
9. **Raster layers reconstruct full surfaces from tiles on replay.** This is a
   likely brush/raster hotspot but lacks a real dirty-tile benchmark. Measure
   1/10/100 percent dirty workloads before introducing retained bitmaps.
10. **WebGPU is not a justified migration target.** The current route supports
    a restricted primitive subset, does a GPU-to-Canvas2D presentation copy,
    and is unavailable in the Linux WebKitGTK target. Correctness goldens and
    real hardware measurements are prerequisites for further adoption.
11. **Benchmark discovery includes unrelated worktrees.** Exclude `.worktrees`
    in the benchmark config before treating `pnpm bench` as a bounded,
    reproducible gate.

## Safe early cache corrections

Two audit-confirmed defects were reproduced with failing tests before their
fixes were applied:

- `FrameCache.get()` now refreshes an entry's frame recency. Before the fix, a
  gradient read on every frame still disappeared on frame four; the renderer
  then recreated it periodically. The regression test reads the same value for
  twelve frames while a separate cold-entry test preserves expiry behavior.
- Adaptive subtree-IR and engine-node-memo limits are now derived on every
  frame from the current multiplier, capped by the user's configured preset.
  Before the fix, the code only applied multipliers below one, so returning to
  balanced left the reduced limit in place. Deterministic tests cover a low
  preset transitioning from constrained (25 percent) back to its full limit
  and ensure quality mode cannot exceed the explicit preset.

These changes alter neither raster output nor interaction quality. They remove
avoidable regeneration/churn and make low-memory settings remain a ceiling.
They do not establish full 4 GiB support; the wider cache-ownership gaps remain
open.

The live status, risk, evidence, and commit reference for each finding are kept
in [`../perf/findings.md`](../perf/findings.md).
