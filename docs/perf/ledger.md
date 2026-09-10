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
| Adaptive profile integration | Not wired — profile modules existed unused | Profile controls: partial redraw, worker eligibility, cache budget (4 tiers) | jsdom, Vitest, CachyOS | high | Hysteresis prevents tier oscillation; cooldown 30 frames |
| Per-phase frame timing | buildIrMs=0, replayMs=0 (hardcoded) | Real buildIrMs/replayMs per frame in diagnostics ring buffer | jsdom, Vitest, CachyOS | high | Three buildIr timing points + replay section wrapper |
| Cache hit count in diagnostics | cacheHitCount=0 (hardcoded) | Real cacheHitCount tracked per frame | jsdom, Vitest, CachyOS | high | 3 lines added in the cache loop |
| Diagnostics HUD | No overlay | Overlay shows F#, dv#, rc#, tier, path, dirty state, node/culled/cache counts, build/replay/total ms, avg30/p95 | browser, dev mode | high | `renderDrawDiagnostics()` renders to overlay canvas |

## Environment Notes

- **Primary dev:** CachyOS, Wayland, WebKitGTK 2.52 — WebGPU unavailable in Tauri webview.
- **WebGPU targets:** macOS 26+ WKWebView, Windows WebView2 (stable), Chromium browser.

## End-to-end program baseline (2026-07-22)

The measurement audit and raw results are recorded in
[`2026-07-22-end-to-end-baseline.md`](2026-07-22-end-to-end-baseline.md). These
figures are pre-optimization and informational; they are not CI budgets.

## End-to-end program results (2026-07-22)

Implementation, validation, directional before/after measurements, platform
coverage, and evidence-qualified remaining work are recorded in
[`2026-07-22-end-to-end-results.md`](2026-07-22-end-to-end-results.md).

## Settings/UX exposure for the perf runtime (2026-07-22)

Complementary session, run concurrently with the canvas-wiring work recorded
above. This pass did not touch `CanvasArea.tsx` or the render hot path
(another session owned that live) — it focused on exposing already-built
capability to users and closing an untested correctness gap. No throughput
numbers below; this is capability/coverage, not a speed measurement.

| Change | Before | After | Confidence |
|---|---|---|---|
| Memory/cache budget control | Code-only (`settings.render.memoryBudget`), no UI | Exposed via Settings → Performance (Low/Balanced/High) | high |
| Reduced-motion override | `reducedMotionManager.setReducedMotionOverride()` existed, zero callers | Exposed via Settings → Performance; applied at boot from persisted preference (`Shell.tsx`) and live on change | high |
| Diagnostics capture | None | Read-only tier/frame-time/platform-capability stat block + "Copy performance diagnostics" JSON button in Settings | high |
| `drawDiagnostics.ts` force-disable | `enableDrawDiagnostics(false)` was a no-op in any DEV/test build (`false \|\| DEV` always evaluated `true`) | `force` is a true override; omitting it falls back to DEV auto-detect | high — caught by a failing unit test before landing, not observed in production |
| Zero-size viewport correctness | Untested since the 2026-07-14 canvas plan speced it; canvas-mounted-hidden-then-shown path had no regression guard | `tests/e2e/canvas/zero-viewport.spec.ts` added | high |
| `memoryBudget.ts` test coverage | No test file existed | `memoryBudget.test.ts` added (6 cases: presets, ordering, fallback) | high |

**Deferred, not attempted this pass** (see the concurrent session's canvas-wiring
commits and `2026-07-22-end-to-end-results.md` for what *was* actuated):
adaptive render-scale's interaction with the Settings-exposed memory budget
under long sessions is untested past unit level; cross-platform validation
(Windows/WebView2, macOS/WKWebView, low-RAM devices) is still unavailable on
this machine.

## Canvas drawContent per-frame forced-reflow elimination (2026-07-22)

Three forced-reflow/forced-layout sources removed from the per-frame draw path.
All three were previously executed on every single animation frame (60–120 fps)
regardless of whether the underlying value had changed.

| Change | Before | After | Confidence |
|---|---|---|---|
| Board color `getComputedStyle` | `getComputedStyle(document.documentElement).getPropertyValue('--color-surface-sunken')` every frame in `drawContent` | Cached in `sunkenColorRef`, updated only on `state.themeRevision` change | high |
| Accent color `getComputedStyle` | `getComputedStyle(document.documentElement).getPropertyValue('--color-accent-primary')` every frame in `drawOverlay` | Cached in `accentColorRef`, updated only on `state.themeRevision` change | high |
| Viewport `getBoundingClientRect` | `canvas.getBoundingClientRect()` every frame in `drawContent` | Replaced with `cssW`/`cssH` (parent `clientWidth`/`clientHeight`); canvas is sized to fill parent so dimensions are identical | high |
| Duplicate `cacheContentParts` | `cacheContentParts(fn)` called twice per cache-miss node (once for hash lookup, once for cache store) | Computed once into `partsCache` Map during lookup, reused during store | high |

**Impact:** Each `getComputedStyle`/`getBoundingClientRect` call can force a style
recalc or layout flush. At 60 fps that's up to 720 forced flushes/second across
the two draw paths. Eliminating them removes a persistent main-thread cost that
is independent of document complexity. The `cacheContentParts` dedup halves the
JSON serialization work on the IR-build hot path for cache-miss nodes.

**Validation:** `@varve/editor` typecheck clean (2 pre-existing errors in
`AdjustmentEditor.tsx` from concurrent `b90e5b02` — verified present without my
changes). 138/138 canvas tests pass. Biome clean on modified file.
`pnpm bench:canvas` 12/12 pass. No new test failures.

**Replay microbenchmark (jsdom, directional, not presentation timing):**

| Workload | Before | After | Notes |
|---|---:|---:|---|
| 100 rects replay | p50 0.90 ms, p95 1.56 ms | p50 0.35 ms, p95 0.63 ms | jsdom microbenchmark; variance from JIT warmup expected |
| 1000 rects replay | p50 42.56 ms, p95 57.76 ms | p50 3.32 ms, p95 3.37 ms | jsdom microbenchmark; second run benefits from warm caches |

**Files changed:** `packages/editor/src/CanvasArea.tsx` (single file, +24/-18 lines).

## Console flood + Alt-drag duplication (2026-07-26)

Full write-up: [`2026-07-26-input-latency-console-flood.md`](2026-07-26-input-latency-console-flood.md).

Two defects put unbounded work on the interaction hot path; a third made
Alt-drag duplication non-functional rather than merely slow.

| Workload | Before | After | Environment | Confidence | Notes |
|---|---|---|---|---|---|
| Console messages, one 40-step drag | 2339 | 0 | Chromium/Vite dev, CachyOS Wayland | high | exact counts, not timing |
| Console messages, one 40-step Alt-drag | 1194 | 0 | Same | high | |
| Console messages, whole scripted session | 4249 | 11 | Same | high | remainder is one-time boot diagnostics |
| Audit-rule re-registrations per pointer move | ~28 | 0 | Same | high | `Shell.tsx` effect keyed on the editor context value |
| WebGL contexts acquired per rendered frame | 1 (leaked) | 0 after first | Same | high | `detectPlatformCapabilities` reached from `computeProfile` |
| Alt-drag copy tracks the pointer | no (sat at fixed +20/+20) | yes | Same | high | verified by screenshot; original now stays put |
| Drag wall-clock, 40 synthetic moves | 12345 ms | 7016 ms | Same | low | includes CDP overhead and concurrent build load — directional only |

**Not addressed (documented, owned elsewhere):** one drag still produces 3
history entries and one Alt-drag 5, with no-op first/middle undos. That is the
`context.tsx` transaction path, which a concurrent session is actively
refactoring (`context/useHistory.ts`); measurements are recorded in the write-up
as an acceptance check for that work.

## Quadratic getParent fallback across seven hot paths (2026-07-27)

Full write-up: [`2026-07-27-quadratic-getparent-fallback.md`](2026-07-27-quadratic-getparent-fallback.md).

Follow-up to the 2026-07-26 session: chasing "what's the real node-count
ceiling" (asked to inform a rendering-engine choice) found a real ceiling, and
it wasn't the renderer. `nodeWorldTransform`/`nodeWorldBounds` accept an
optional `parentIndex` cache; omitting it falls back to an O(n) linear scan
(`getParent`) per ancestor-chain hop. Found and fixed at seven call sites,
three of them on the live pointer-move/click hot path, not just document-open.

| Workload | Before | Bound | Result | Confidence |
|---|---:|---:|---|---|
| `computeFitAllCamera`, 500 → 4,000 nodes (8x) | 54.7 s | 3.3 s | fails pre-fix, 204 ms post-fix | high — reverted by hand and re-run |
| `HitTestEngine.hitTest` (deepSelect), 300 → 2,400 candidates | 9.2 s | 0.68 s | fails pre-fix, passes post-fix | high |
| `HitTestEngine.findNodesAtPoint`, 300 → 2,400 candidates | 8.5 s | 0.44 s | fails pre-fix, passes post-fix | high |
| `flattenVisibleNodesForVideo`, 300 → 2,400 nodes (8x) | 11.4 s | 1.3 s | fails pre-fix, 74 ms post-fix | high |
| Marquee-select (structural: mock call count, not timing) | called 50/50 | 0 calls | fails pre-fix, passes post-fix | high |
| 20,000-node document open, real browser, original discovery | 10+ min, CPU pegged at 96%, never finished | — | not re-measured cleanly post-fix (see below) | high for the *before* number only |

**Not independently re-confirmed end-to-end.** All seven unit-test-level
fixes are proven (each reverted by hand and shown to fail, then restored and
shown to pass). A post-fix real-browser re-run of the original 20,000-node
case did not complete cleanly this session — the app's own boot timed out
before the fixture even loaded, with system load at 15.8/20.4/24.4 and
another agent's `tsc`/`madge` run active concurrently. Confirmed the fix was
genuinely being served (fetched the live module, found `buildParentIndexMap`
in it) rather than assuming. Recommended follow-up: re-run on a quiet
machine; see the write-up for the exact reproduction steps.

**Also recorded:** `git show HEAD:<file>` was not safe to use as "the pre-fix
version" during this session — a concurrent process committed several of this
session's in-progress files under unrelated commit messages within minutes of
editing them, twice causing a false-negative revert (silently restoring the
already-fixed code instead of the original). See the write-up's "Methodology
hazards" section.

## Canvas pre-loop, engine-node memo, and cache eviction (2026-08-01, part 2)

Full write-up: [`../audits/canvas-perf-2026-08-01-part2.md`](../audits/canvas-perf-2026-08-01-part2.md).

Continuation of the same day's O(n²) `getParent` work. Took that audit's top
remaining item (per-frame pre-loop at 1000+ nodes), fixed it, and found it was
not what dominated the frame.

Measured on a heavily contended machine (load 19–34 on 8 threads, 12.4 GiB in
zram swap, dev build, SwiftShader). Wall-clock is directional only; the
work-count rows are deterministic and are what the new tests assert.

| Workload | Before | After | Confidence | Notes |
|---|---|---|---|---|
| Engine-node conversions per drag frame, 932 nodes | 932 (p50), 932 (max) | 0 (p50), 1 (max) | high | deterministic count, load-independent |
| SubtreeIrCache bulk fill, 4000 inserts / 500-entry cap | 1050 ms | 9.2 ms | high | eviction re-sorted the whole map per evicted entry |
| `Array#sort` comparator calls during that fill | many | 0 | high | asserted by `subtreeIrCacheEviction.test.ts` |
| `evictIfNeeded` + comparator + `estimateItemBytes`, drag profile | 5.3% | absent from top-25 | high | CPU profile, 932-node drag |
| Drag frame phase attribution, 932 nodes | ~2 ms of a 63 ms frame explained | setup 9.3 / preLoop 5.5 / hash 1.7 / buildIr 0.2 / replay 0.1 + 46.4 ms unattributed | high | new `setupMs`/`preLoopMs` timers |

**Dev vs production, matched node counts (`vite build` + `vite preview`):**

| Workload | Dev | Production |
|---|---:|---:|
| Drag frame p50, 128 nodes | 2.9 ms | 3.4 ms |
| Drag frame p50, 932 nodes | 63.2 ms | 33.2 ms |
| Drag frame p95 / p99, 932 nodes | 75.1 / 84.3 ms | 197.2 / 633.4 ms |

~38% of dev-build drag CPU is React development-mode overhead (`jsxDEV`,
`createElement`, `validateProperties*`) that does not exist in production. It
does not matter at 128 nodes and roughly doubles the frame at 932. But
production at 932 nodes is still 33 ms p50 with 197/633 ms tails, so the dev
tax is not the whole problem. The per-frame node walk the previous audit ranked
first turned out to be ~15 ms of a ~63 ms dev frame; in production `setupMs`
(full-document walk, culling, dirty region, style precompute) is the largest
measured phase at 12.8 ms p50 and is the next target.

**Not fixed, measured:** `groupWorldBounds` ~8% (largest external caller is a
React `useMemo`), autoNamer's `existingNames` running during drag ~1.7%,
renderer crash at ~2048 nodes, and the 4 GB low-memory profile.

**Corrected claim:** routing snap targets through the transform cache was made
while chasing `groupWorldBounds` and did **not** move it; it is recorded as a
consistency fix, not a measured win.

## Measured continuation and resource audit (2026-08-01, part 3)

Full write-up: [`../audits/canvas-perf-2026-08-01-part3.md`](../audits/canvas-perf-2026-08-01-part3.md).
The shared hypothesis/evidence tracker is [`findings.md`](findings.md).

Five current real-browser replay runs produced median run p50 values of
0.7/3.6/34.7/138.0 ms for 100/1K/10K/50K visible items. Current in-app drag
frames were p50 1.4 ms at 128 nodes and 5.4 ms at 494 nodes, with the
engine-node memo performing zero median conversions and at most one conversion
per measured frame. These are SwiftShader Chromium results, not native
WebKitGTK presentation measurements.

The audit also records that the deterministic workload corpus, structured
result collector, and soak harness are not connected to a real application
runner; cache limits do not recover after an adaptive constrained tier;
gradient cache hits do not refresh recency; and the current low-memory preset
does not bound all decoded, worker, mask, shaping, scratch, or GPU resources.

The first safe correction milestone reproduced and fixed the two local cache
defects. A continuously read gradient-cache entry now remains live across 12
test frames while an unread entry still expires after four. Adaptive subtree IR
and engine-node memo limits now restore the configured preset after a
constrained tier and never exceed an explicit low-memory ceiling.

Benchmark discovery is now isolated from `.worktrees` in the shared Vitest
configuration. Normal and benchmark-config collection report 891 and 898 files
respectively, with zero worktree paths. The subsequent root-only `pnpm bench`
run stopped consuming CPU but did not return from runner teardown; that is
tracked separately and the full command is not recorded as passing.

Pending image decode invalidation was also hardened. Failing tests demonstrated
that cancel, clear, and cancel-then-retry could all be undone by late promise
completion. Per-load identities now prevent stale completions from mutating the
cache or retained-byte accounting; the focused image-cache suite passes 11/11.

The canvas memory preset now also controls global decoded-image retention with
64/256/512 MiB low/medium/high ceilings. Lowering the live ceiling triggers LRU
eviction immediately. Focused image-cache and preset tests pass 20/20. This does
not close the wider low-memory finding: worker, mask, shaping, scratch, and GPU
allocations remain outside shared ownership, and no 4 GiB run has passed yet.

Clean-worktree verification passed format, typecheck, lint, 10,895 tests,
repository and canvas benchmarks, render-ratio audit, emoji/tokens, architecture
audit, and production build. The benchmark measured two existing scale cliffs:
zoom 0.01 rectangle queries at 7.72 s mean and 5K-candidate snapping at 1.75 s
mean. Browser interaction budgets passed 4/5 under load; the 50-shape case hit
its fixed 60-second wall timeout twice at host load 22, after passing in 28.2 s
earlier under lower contention.

The extreme-zoom spatial cliff was then removed without changing candidate
semantics. `queryRect` now enumerates whichever is smaller: theoretical query
cells or occupied index cells. A failing work-count test dropped from 10,201
empty lookups to at most two occupied cells. A 200-iteration zoom-0.01 probe
with 9.77M theoretical versus 4K occupied cells measures 1.55 ms mean; the
focused spatial suite passes 30/30.

## Interaction observability and raster measurement (2026-08-03)

Instrumentation, calibration and measurement pass. Full evidence in
[`2026-08-03-interaction-observability-report.md`](2026-08-03-interaction-observability-report.md).

No app-wide speedup is claimed: this session added evidence, not optimization.
One hot path (raster reconstruction) was measured and its optimization approved
by a gate; it was deliberately not implemented in the same pass.

| Workload | Before | After / measured | Environment | Confidence | Notes |
|---|---|---|---|---|---|
| Raster reconstruction, 512² (16 tiles) | unmeasured | p50 1.58 ms, p95 4.35 ms, 1.0 MiB intermediate | CachyOS 7.1.5, Node 26.4, 8 cores, perf governor | medium | Node memory-traffic model; lower bound on in-browser cost |
| Raster reconstruction, 1024² (64 tiles) | unmeasured | p50 5.93 ms, p95 10.57 ms, 4.0 MiB | Same | medium | Under the 16.7 ms budget |
| Raster reconstruction, 2048² (256 tiles) | unmeasured | p50 28.57 ms, p95 58.67 ms, 16.0 MiB | Same | medium | **Trigger met** — 3.5x over budget |
| Raster reconstruction, 4096² (1024 tiles) | unmeasured | p50 204.15 ms, p95 252.84 ms, 64.0 MiB | Same | medium | ~12 frame budgets per replay |
| Raster reconstruction, 8192² (4096 tiles) | unmeasured | p50 855.57 ms, p95 968.37 ms, 256.0 MiB | Same | medium | Intermediate exceeds the whole 128 MiB worker budget |
| Tile-replay share of reconstruction | unmeasured | 94.3% – 99.8% across all sizes | Same | high | Dirty-tile replay attacks the right term; allocation reuse alone addresses <6% |
| `interaction.dispatch` span | absent | distinct bounded span | jsdom/Vitest | high | Separable from `pointer.input` handler cost |
| `render.worker` span | absent | distinct span, calibrated, with disposition | jsdom/Vitest | high | Chromium/WebView2/WKWebView only — worker disabled on WebKitGTK |
| Main↔worker clock | assumed identical timeOrigin | NTP-style calibration, uncertainty recorded | jsdom/Vitest | high | Min-RTT sample; 250 ms discontinuity detection |
| Presentation timing | absent | `present.feedback` (±8 ms) / `composite.estimated` (lower bound) | jsdom/Vitest | high | Never named `composite.present` — no OS evidence exists |
| Pre-merge dirty rectangles | merged bound only | individual rects with source + node id, capped at 64 | jsdom/Vitest | high | Fixture: two 20px contributions merge to a 60px bound |
| Nodes rejected by dirty region | unmeasured | structurally 0 — visible list is built before clipping | jsdom/Vitest | high | `prunableByDirty` measures the headroom without changing the pipeline |
| Frame-disposal invariants | untested | 200-trial randomized state machine + 7 host-level paths | jsdom/Vitest | high | Found and fixed a residency leak on context-loss-out-of-installed |

Reproduce the raster figures with `node scripts/perf/bench-raster-reconstruction.mjs`.
Native WebKitGTK samples were **not** collected: `perf` is absent and
`ptrace_scope = 1` blocks attaching to a running session.

## Gate D evidence and dirty-tile raster replay (2026-08-03)

Production build (`vite preview`, Chromium), 121-node spatially-spread scene,
commit `176de9df`, CachyOS 8 cores `performance` governor. Full detail in
[`2026-08-03-interaction-observability-report.md`](2026-08-03-interaction-observability-report.md).

| Workload | Before | After / measured | Confidence | Notes |
|---|---|---|---|---|
| Single-node drag, dirty area | unmeasured | 2.7% of viewport p50, 8.1% p95 | high | 64/120 frames partial redraw |
| Single-node drag, replayed nodes | unmeasured | 121 of 161, unchanged by dirty area | high | **Gate D satisfied** |
| Single-node drag, replays missing the dirty region | unmeasured | 48.5 p50, 108 max (40%–89%) | high | Dirty-area reduction buys ~0 node-work reduction |
| Drag frames with no invalidation reason | unmeasured | 56 of 120 report `redrawReason: clean` | high | Full redraw of 121 nodes for no recorded cause |
| Raster reconstruction 2048², 4 dirty tiles | 89.08 ms p95 | **1.224 ms p95** | medium | 73x; Node traffic model, lower bound |
| Raster reconstruction 4096², 4 dirty tiles | 238.52 ms p95 | **0.203 ms p95** | medium | 1176x; removes 64 MiB per-replay allocation |
| Raster reconstruction 8192², 4 dirty tiles | 979.08 ms p95 | **0.623 ms p95** | medium | 1572x; removes 256 MiB per-replay allocation |
| Frame disposal over 150 drag iterations | untested at scale | 2,321 disposals, 1 frame resident, peak 1.03x resident | high | Exactly-once accounting holds under sustained load |
| Interaction trace retention over 150 gestures | untested at scale | held at the 50-trace cap | high | Bounded retention confirmed under real load |
| JS heap over 150 iterations | unmeasured | flat at 45.2 MB, slope 0.0 MB/iter | low | Chromium quantizes `performance.memory`; coarse |

Reproduce: `node scripts/perf/run-production-workload.mjs` and
`node scripts/perf/bench-dirty-tile-replay.mjs`.

Known gap found by this run: wheel, keyboard and hover interactions produce no
traces at all — `beginInteraction` fires only on pointerdown.

## Benchmark-gate integrity and snap-index freshness (2026-08-07)

Full write-up:
[`2026-08-07-benchmark-integrity-and-snap-index.md`](2026-08-07-benchmark-integrity-and-snap-index.md).

This pass produced one correctness fix and two benchmark-infrastructure fixes.
No app-wide speedup is claimed: the snap fix removes a defect and adds bounded
per-frame work; the other two make the mandatory `pnpm bench` gate trustworthy
and runnable for the first time in this program.

| Workload | Before | After | Environment | Confidence | Notes |
|---|---|---|---|---|---|
| `pnpm bench` file discovery | 90 `.bench.ts` files, 81 under `.worktrees` | 9 root files, 0 under `.worktrees` | CachyOS, Node 26.4, vitest 2.1.9 | high | exact counts; `vitest bench` reads `test.benchmark.*`, not `test.exclude` |
| `pnpm bench` completion | never completed (killed at 400 s, then 900 s) | exit 0 | Same | high | root cause was fixture construction, not runner teardown |
| `spatialIndex.bench.ts` alone | >300 s timeout | 55.5 s, all 13 groups report | Same | high | O(n^2) `addNode` fold at module scope, ~400M property copies at the 20k tier |
| Snap candidates for a node that has moved | **0** | 1 (correct) | jsdom/Vitest | high | deterministic; asserted by `snapIndexFreshness.test.ts`, shown failing without the fix |
| Snap-index maintenance per drag frame | none (index never refreshed) | <=8 grid touches for one moved node | jsdom/Vitest | high | work-count assertion, load-independent |
| `snapPosition`, 5,000 unfiltered candidates | recorded as 1.75 s mean | 52.6 ms mean, 133 ms p99 | Same | medium | **correction** — the 1.75 s figure did not reproduce; it was measured while bench discovery was walking `.worktrees` |

**Correction to the 2026-08-01 part-3 entry.** That entry recorded "5K-candidate
snapping at 1.75 s mean" as a scale cliff (finding P3-18). A clean root-only run
measures 52.6 ms mean / 133 ms p99. The earlier figure was collected while
`vitest bench` was also executing worktree copies of the same suite. P3-18's
proposed change — spatially prefilter candidates — is additionally already
implemented in the app path: `CanvasArea` runs `queryRect` plus
`filterSnapTargets` before calling `snapPosition`, so a real drag never passes
5,000 candidates. The benchmark measures the unfiltered function only.

**Not fixed, observed:** two wall-clock assertions flake under host contention
(`HitTestEngine` near-linear scaling and `cacheSystem.bench.test.ts` cache-hit
under 10 ms). Both failed once at load ~50-58 and passed on rerun; neither is
related to the changes above. They are recorded as fragile gates, not as
regressions.
