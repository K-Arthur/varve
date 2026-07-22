# End-to-End Performance Program Results — 2026-07-22

## Scope and evidence labels

This report covers commits `b0668550` through `3b6d25b6`. It separates:

- **Measured:** observed in a named harness on the CachyOS host below.
- **Verified:** deterministic behavior or resource invariants covered by tests.
- **Inferred:** an architectural cause removed without reliable end-to-end timing.
- **Unmeasured:** requires native hardware, presentation tooling, models, or a longer run.

Host: CachyOS Linux 7.1.3, Wayland, WebKitGTK 2.52.5, GTK 3.24.52,
AMD Ryzen 3 5300U with integrated Radeon Renoir/Mesa RADV, Node 26, and Rust
1.96. Browser E2E measurements use headless Chromium and are not native
WebKitGTK presentation measurements.

## Architecture findings and root causes

Ranked by observed or expected user impact:

1. **Competing animation loops and duplicate pointer sampling (inferred, fixed).**
   Canvas content, tools, motion playback, and inertia scheduled independent
   frames. Pointer tools also re-read coalesced events. A shared four-lane,
   latest-wins scheduler now coordinates this work, and normalized samples are
   produced once. Predicted samples remain disposable preview data.
2. **Stale asynchronous render acceptance (verified, fixed).** Document history
   version was not sufficient for camera, viewport, DPR, resource, variable, or
   async-result changes. A separate render revision and a one-running/one-pending
   worker queue reject superseded results.
3. **O(N) work in interaction paths (inferred, reduced).** Style and variant
   resolution performed two full-document scans per frame, while snapping
   scanned candidates on pointer moves. Style work is memoized and snapping
   uses a gesture-scoped spatial index with viewport queries.
4. **Unbounded or count-only retained resources (verified, reduced).** Canvas IR
   cache budgets are byte based and profile aware; bitmap cleanup and cache
   diagnostics expose bytes, hits, misses, and eviction behavior. Low, balanced,
   and high cache presets are user configurable.
5. **Large JSON-array native transfer and duplicate expensive jobs (verified,
   fixed for upscale).** Native upscale now returns binary bytes, bounds input
   and output admission, serializes execution, and suppresses cancelled or stale
   results while retaining a compatibility adapter.
6. **Repeated native model-session construction (verified, fixed).** Background
   removal and denoise use a model-keyed ONNX pool with concurrency, idle-entry,
   estimated-byte, LRU, unload, cancellation, and metrics controls.
7. **Incorrect startup readiness and duplicate persistence flushes (verified,
   fixed).** Readiness now means an interactive home surface or first visible
   canvas frame after a paint opportunity. Lifecycle save requests are
   revision-deduplicated and clean shutdown is marked only after the matching
   save completes.
8. **Large initial application chunk (measured, open).** The production browser
   build emits an 8,230.84 kB main JavaScript chunk (1,947.37 kB gzip). Mixed
   static/dynamic imports prevent several intended splits. This remains a
   startup and low-memory priority.

## Implemented systems

- Versioned `PerformanceTrace`, capability, memory-budget, render-revision, and
  workload result types with monotonic timestamps and bounded samples.
- Eleven deterministic workloads: small, flat 10K, deeply nested, raster,
  vector, text, effects/masks, brush, motion, extreme zoom, and document switch.
- Frame phase, p50/p95, invalidation, render path, worker, and cache diagnostics,
  plus a development canvas HUD and copyable settings diagnostics.
- Adaptive render profiles and byte-aware IR cache limits.
- Central four-lane frame scheduler with keyed latest-wins replacement and
  hidden-document suspension.
- Render-revision tracking and latest-only worker publication.
- Gesture-scoped spatial snapping queries and single-pass pointer normalization.
- Binary native upscale responses, bounded task admission, cancellation, and
  compatibility decoding.
- Bounded, reusable native ONNX sessions with warm/cold and eviction metrics.
- Visible-surface startup milestones and lifecycle save deduplication.
- Automatic persisted reduced-motion handling and low/balanced/high memory
  controls in Performance settings.
- Deterministic soak harness that checks cancellation, error continuation,
  worker/object-URL/bitmap counts, and retained-memory plateaus.

## Before and after measurements

These replay numbers came from different full-suite runs with very small sample
counts. They are directional only and must not be described as app-wide speedups.

| Workload | Baseline | Current | Confidence |
|---|---:|---:|---|
| Canvas2D replay, 100 rectangles | p50 0.87 ms, p95 4.93 ms | p50 0.82 ms, p95 3.20 ms | low |
| Canvas2D replay, 1,000 rectangles | p50 13.01 ms, p95 23.01 ms | p50 6.19 ms, p95 7.74 ms | low |
| IR replay spike, 600 shapes | 86.4 fps | not rerun | historical only |
| Pixel push spike, 600 shapes | 8.5 fps | intentionally not retained | historical only |
| Per-frame style/variant scans | 2 O(N) scans | 0 while document reference is stable | high, structural |
| Browser production main JS | not recorded | 8,230.84 kB; 1,947.37 kB gzip | high |

The current image-enhancement informational run recorded 64/256 px bilinear at
27.98/51.73 ms, bicubic at 59.17/134.20 ms, Lanczos3 at 109.20/1,039.47 ms,
and trace-512 at 104.64 ms. These are a current baseline, not an optimization
comparison.

## Validation completed

- Formatting and full TypeScript/E2E type checking: pass.
- Biome lint: pass with the repository's 150 pre-existing warnings.
- JavaScript: 8,680 passed, 6 skipped, 0 failed across 733 files.
- Rust workspace tests and doc tests: pass.
- Strict Rust workspace Clippy (`-D warnings`): pass.
- Emoji, token contrast (120/120), architecture health, and typecheck-regression
  audits: pass. CanvasArea imports decreased from 66 to 64.
- Targeted Chromium: canvas tools 8/8, pen/pencil 3/3, transform 2/2,
  performance-budget 5/5, and hidden/zero-size viewport recovery 1/1.
- Browser production build: pass.
- Deterministic soak correctness and plateau logic: 4/4 unit tests pass.
- Native ONNX pool: 8 non-AI and 25 AI-feature tests pass.

Timing budgets in Chromium remain generous informational smoke limits; they are
not native frame-presentation gates.

## Cross-platform validation matrix

| Target | Build/test status | Native presentation status |
|---|---|---|
| CachyOS/Wayland/WebKitGTK | browser build and Linux native compilation exercised | frame pacing, fractional scale, monitor movement, and touchpad gestures unmeasured |
| Chromium browser | production build and targeted E2E pass | headless compositor only |
| Firefox browser | not run in this tranche | unmeasured |
| WebKit browser | not run in this tranche | unmeasured |
| Windows 10/11 WebView2 | compile/runtime not available on this host | unmeasured |
| macOS WKWebView | compile/runtime not available on this host | unmeasured |
| Ubuntu/Fedora/Mint/Pop!_OS | no native runners available | unmeasured |
| Approximately 4 GB RAM | deterministic admission limits verified | no 45-minute process-capped native run |

WebKitGTK acceleration policy is treated as diagnostic context, not proof of an
accelerated Canvas path. WebGPU, OffscreenCanvas, pointer coalescing/prediction,
and worker RAF are capability-probed rather than inferred from the OS name.

## Remaining limitations and next priorities

1. Capture three comparable release Tauri runs with input-to-photon tooling,
   RAF/presentation cadence, RSS, cache, startup, document-open, save, export,
   and 45-minute soak results under normal and 4 GB limits.
2. Split the 8.23 MB initial chunk, beginning with mixed static/dynamic engine,
   import, image-operation, and model-loader dependencies; remeasure startup.
3. Extend binary/task admission from upscale to trace, PDF/export, thumbnails,
   and remaining large native payloads. Classify every Tauri command and expose
   queue/progress timing through ordered channels.
4. Complete byte accounting for decoded images, thumbnails, backdrops, and all
   GPU resources. ONNX accounting currently estimates model file bytes, not
   live runtime allocations.
5. Measure React context fan-out, layer/inspector commits, document-open,
   undo/redo, save/autosave, and IPC phases in release builds.
6. Add real Windows/WebView2, macOS/WKWebView, and representative Linux runners.
7. Evaluate spatial tile backing only if release traces still identify replay or
   traversal as dominant and an A/B run improves p95 by at least 10% within the
   memory budget.

## Commit history

The 17 implementation commits are intentionally small and independently
reviewable, from `b0668550` (adaptive profile integration) through `3b6d25b6`
(native IPC naming cleanup). The range changes 64 files with 3,592 insertions
and 340 deletions before this report. See `git log --oneline origin/master..HEAD`
for the authoritative list.
