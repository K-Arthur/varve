# End-to-End Performance Baseline — 2026-07-22

## Measurement status

This is the untouched baseline for the end-to-end performance program. Existing
results are microbenchmarks and do not measure input-to-presentation latency,
native WebKitGTK frame pacing, peak memory, or long-session degradation.

Primary host:

- CachyOS Linux 7.1.3, native Wayland session
- WebKitGTK 2.52.5, GTK 3.24.52
- AMD Ryzen 3 5300U, integrated Radeon Renoir, Mesa RADV 26.1.4
- 22 GiB physical RAM; 6.4 GiB available and active swap pressure during audit

## Recorded results

| Workload | Result | Samples | Confidence |
|---|---:|---:|---|
| IR replay spike, 600 shapes | 86.4 fps | historical spike | medium |
| Pixel push spike, 600 shapes | 8.5 fps | historical spike | medium |
| Node/jsdom replay, 100 rectangles | p50 0.87 ms, p95 4.93 ms | 5 | low |
| Node/jsdom replay, 1,000 rectangles | p50 13.01 ms, p95 23.01 ms | 3 | low |
| Viewport bounds/culling, 10,000 nodes | passed 500 ms ceiling | 1 | low |

The cache microbenchmark exceeded its 10 ms threshold when run concurrently
with six other benchmark files (15.64 ms), then passed three isolated reruns.
This confirms that single-run absolute timing assertions are sensitive to suite
contention and must not be treated as application regressions.

## Missing baseline coverage

- Event-to-visible-response and pointer processing p50/p95/p99
- RAF cadence, dropped frames, long animation frames, and presentation timing
- Scene traversal, invalidation, worker queue/clone, WASM, and Tauri IPC phases
- Startup, document open, save/autosave, export, undo/redo, and UI commit latency
- Decode/upload cost, cache hit/eviction behavior, peak RSS, and retained memory
- Release Tauri measurements, browser production builds, and 45-minute soak data

Until repeated release-build captures exist, performance results remain
informational. Correctness, cancellation, resource cleanup, and byte-budget
invariants may be enforced as deterministic gates immediately.
