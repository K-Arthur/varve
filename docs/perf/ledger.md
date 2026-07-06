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

## Environment Notes

- **Primary dev:** CachyOS, Wayland, WebKitGTK 2.52 — WebGPU unavailable in Tauri webview.
- **WebGPU targets:** macOS 26+ WKWebView, Windows WebView2 (stable), Chromium browser.
