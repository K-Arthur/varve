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

**Validation:** `@strata/editor` typecheck clean (2 pre-existing errors in
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
