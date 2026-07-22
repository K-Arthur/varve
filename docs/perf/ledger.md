# Performance Ledger

Record before/after measurements for render and WASM changes. Do not claim app-wide speedups from microbenchmarks alone.

## Template

| Date | Workload | Before | After | Environment | Confidence | Notes |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | e.g. replay 1K rects, no effects | p50 X ms, p95 Y ms | ... | CachyOS, Wayland, WebKitGTK X.Y, GPU | high/medium/low | trade-offs |

## Workloads

| ID | Description | Harness |
|---|---|---|
| W1 | Replay 100/1K/10K rects, effects off | `packages/engine/src/bench/replay.bench.ts` |
| W2 | IR bytes per frame, 600 shapes | spike harness |
| W3 | Layers panel 10K flatten | `layers10k.bench.test.ts` |
| W4 | Worker render 10K nodes | `renderWorker.test.ts` |

## Baseline (2026-07-06, pre-compositor)

| Workload | Metric | Value | Environment |
|---|---|---|---|
| W1 | 100 rects replay | TBD (run `pnpm test packages/engine/src/bench`) | jsdom/Node |
| W2 | IR-replay spike | 86.4 fps @ 600 shapes | ADR-0001, WebKitGTK 2.52.4 |
| W2 | Pixel-push spike | 8.5 fps @ 600 shapes | ADR-0001 |

## Canvas 2D hardening measurement (2026-07-13)

| Workload | Before | After/current | Environment | Confidence | Notes |
|---|---|---|---|---|---|
| W1, 100 rects | No valid measurement; documented command excluded `.bench.ts` | p50 0.32 ms, p95 0.52 ms, IR 19,781 B | Node 26.4, jsdom/Vitest, CachyOS Wayland, Ryzen 7 3750H | medium | Microbenchmark, not presentation timing |
| W1, 1,000 rects | No valid measurement | p50 4.47 ms, p95 5.14 ms | Same | medium | Three measured iterations after warmup |
| Benchmark discoverability | Command failed with `No test files found` | `pnpm bench:canvas` passes 3/3 and is included in the full suite | Same | high | Harness correctness improvement |

The session changed correctness and resource isolation more than raw replay throughput,
so no unsupported app-wide speedup claim is made. Closed dialogs now unmount expensive
content, removing repeated reconciliation of hidden color pickers during pointer updates.

## Draw pipeline measurement (2026-07-22)

Pre-compute optimisation: moved `resolveAllStyles` and `buildAllVariantCaches`
from per-frame drawContent calls to `useMemo` hooks, eliminating two O(n) full-
document scans on every frame. These are now computed only when the document
reference changes.

| Workload | Before | After | Environment | Confidence | Notes |
|---|---|---|---|---|---|
| Frame with 1000 nodes, style resolution | 2 O(n) scans per frame | 0 scans when doc unchanged | jsdom, Vitest, CachyOS | high | Eliminated by pre-computation |
| Per-frame timing instrumentation | Not available | p50/p95 per frame in ring buffer | jsdom, Vitest, CachyOS | high | `frameBudget.ts` wired into drawContent |
| Dev diagnostics HUD | Not available | Frame timing, cache stats, render path overlay | browser, dev mode only | high | `drawDiagnostics.ts` overlay via `renderDrawDiagnostics` |
| SubtreeIrCache memory budget | Fixed 500 entries / 50MB soft / 100MB hard | Configurable via settings.render.memoryBudget | jsdom, Vitest, CachyOS | high | low=10MB, medium=25MB, default=50MB, high=200MB |

## Environment Notes

- **Primary dev:** CachyOS, Wayland, WebKitGTK 2.52 — WebGPU unavailable in Tauri webview.
- **WebGPU targets:** macOS 26+ WKWebView, Windows WebView2 (stable), Chromium browser.

## End-to-end program baseline (2026-07-22)

The measurement audit and raw results are recorded in
[`2026-07-22-end-to-end-baseline.md`](2026-07-22-end-to-end-baseline.md). These
figures are pre-optimization and informational; they are not CI budgets.
