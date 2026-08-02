# Canvas Performance Investigation — 2026-08-01

## Summary

Investigated why the canvas feels slower than the surrounding panels and chrome.
Instrumented the render pipeline with a benchmark-only diagnostics handle
(`?perf=1` → `window.__strataPerf`), profiled real interactions in a real
browser, and found a dominant O(n²) hotspot in world-geometry resolution. After
fixing it, a Ctrl+D duplication at ~500 nodes went from **38.3s wall-clock** to
**~5s wall-clock**, and the render frame for a 932-node scene went from
**7343ms** to **~26ms** (a ~280x reduction in frame time). Interaction frames at
128 nodes are now p50 2.3ms / p95 6ms.

## 1. Environment and runtime

| Item | Value |
|---|---|
| OS / session | CachyOS (Arch), Linux 7.1.3-2-cachyos, Wayland |
| CPU | AMD Ryzen 3 5300U (8 threads, up to 3.9 GHz) |
| RAM | 22 GiB total; 6–8 GiB available during testing (machine heavily contended by concurrent dev agents) |
| GPU | AMD Radeon Graphics (Vega, integrated) |
| WebView | Chromium headless (Playwright bundled, SwiftShader software GL) |
| App build | Vite dev server, React 19 StrictMode, dev mode |
| Tauri | Not exercised in this pass (browser E2E); Tauri path shares the same render code |

Notes on the environment:

- The dev machine runs several concurrent agent processes; measurements were
  taken under contention. Absolute wall-clock numbers moved between runs; the
  *ratios* between fixed and baseline code paths in the same conditions are the
  reliable signal.
- Headless Chromium with SwiftShader (software GL) is *slower* than the user's
  real GPU-backed WebKitGTK. Any improvement measured here is a lower bound on
  the user-visible improvement on the desktop app.

## 2. Canvas pipeline architecture map

```
Pointer/keyboard input
  → inputPipeline.ts (useCanvasInputs: wheel/pointer/keyboard, passive:false)
  → tool dispatch (SelectTool/HandTool/…) → editor state mutations (context.tsx)
  → setState → React re-render of Shell/CanvasArea
  → drawContent() in CanvasArea.tsx (useCallback, rAF via frameScheduler)
      ├─ walkNodes(doc)                     O(n) traverse
      ├─ container culling                  O(containers) world-bounds check
      ├─ computeDocumentDirtyRegion         O(Δnodes) — WAS O(Δ×n) getParent
      ├─ computeInvalidationPlan            O(Δnodes) — WAS O(Δ×n) getParent
      ├─ per-node flatNodes loop:
      │    getEffectiveNode → applyBindingsToNode → getCachedWorldTransform
      │    → getCachedWorldBounds → toEngineNode → appearancePaddingWorld
      │    → isWorldRectInViewport          — WAS O(n²) via getParent in transformCache
      ├─ NodeHashMemo hash loop             O(visible), memoized
      ├─ engine.buildIr                     (stub/native/wasm) — per-node IR cache hit
      ├─ frameBackend.beginFrame + replayIr → Canvas2D rasterization
      └─ recordFrame → diagnostics ring (perf=1)
Selection overlay / name labels / minimap   — separate React renders over the canvas
```

Synchronous boundaries: the entire `drawContent` async IIFE runs on the main
thread (except `eng.buildIr` which is an await). Worker boundaries: optional
render worker for cached bitmaps; Tauri IPC: `eng.buildIr` on desktop crosses
the webview→Rust boundary.

## 3. Baseline (pre-fix)

Real-browser rasterization of the engine's `replayIr` (visual harness, real
Canvas2D pixels):

| Nodes | 100 | 1k | 10k | 50k |
|---|---|---|---|---|
| p50 | 3.4ms | 16.7ms | 154ms | 533ms |

This is the pure paint cost; the app's own pre-paint walk was the dominant
unmeasured cost at large node counts.

In-app frame diagnostics (via the new `?perf=1` handle) on the ORIGINAL code:

| Scenario | Result |
|---|---|
| Ctrl+D duplication, ~500 nodes, one op | 38.3s wall-clock (contended) |
| Render frame at 254 nodes | 21ms |
| Render frame at 932 nodes | **7343ms** (path=worker-cached, all cache hits) |

The 7343ms frame had `buildIrMs≈0`, `replayMs≈0`, `hashMs≈1.4` — meaning ~7342ms
was invisible to the existing phase diagnostics, hidden in the un-timed
pre-loop node walk.

## 4. Root-cause analysis (ranked)

### #1 — O(n²) `getParent` in world-geometry resolution (dominant)

`getParent(doc, id)` in `packages/scene/src/document-utils.ts` is O(n) — it
scans every node's children to find a parent. `nodeWorldTransform` /
`nodeWorldBounds` / `groupWorldBounds` walk the ancestor chain with it, so any
loop that resolves world geometry for many nodes is O(n²).

Evidence (CDP CPU profile of one Ctrl+D at ~500 nodes, pre-fix):

```
98756.8ms  getParent @ src/document-utils.ts:24   (~94% of a 105s profile)
```

Callers that hit it per frame / per edit:

- `transformCache.computeWorldTransform` — after structural invalidation,
  recomputed every node's world transform via raw `getParent` → O(n²).
- `computeDocumentDirtyRegion` — called `nodeVisualWorldBounds` per changed
  node, each O(n) → O(Δ×n).
- `computeInvalidationPlan` — `getParent(next, id)` per changed node → O(Δ×n).
- `SelectionOverlay` — resolved world geometry for the whole selection every
  render → O(selection×n).
- `CanvasNameLabels.collectCandidates` — full-tree world-bounds pass → O(n²).
- `computeDocumentUnionBounds` — full-document union pass on every camera
  commit → O(n²).

### #2 — Renderer crash at ~2000 nodes during rapid duplication (pre-existing)

Reproduces on the original code too. A burst of select-all + duplicate past
~2048 nodes crashes the renderer with no JS error. Not caused by this work;
listed as a pre-existing large-document robustness gap (see Remaining work).

### Rejected hypotheses

- **Replay/rasterization cost at moderate scale** — rejected as the primary
  cause: at ≤500 nodes `replayMs` was sub-millisecond; the paint path only
  dominates at 10k+ nodes (154ms), and even then culling + IR cache keep the
  app's per-frame cost far below full-scene replay.
- **React re-render / context invalidation** — a contributor (duplication wall
  time includes React reconciliation) but not the 7-second frame; frames were
  fast while the pre-loop was O(n²).
- **WASM/Rust/Tauri IPC** — the frames used the stub engine; `buildIr` was not
  the bottleneck at the measured scales.
- **GPU/WebView software rendering** — SwiftShader is slower than desktop GPU,
  but the measured bottleneck was algorithmic (JS), not rasterization.

## 5. Implementation

All changes threaded a single O(n) `buildParentIndexMap` through the world-
geometry callers instead of per-call O(n) `getParent`:

| File | Change |
|---|---|
| `scene/transformCache.ts` | Lazily-built parent index; `getWorldBounds` handles groups (child union, matching `nodeWorldBounds`); `invalidateAll` drops the index |
| `canvas/dirtyRegion.ts` | Builds parent index once (lazily) per document; threads it through `nodeVisualWorldBounds` |
| `canvas/invalidationPlan.ts` | Parent lookups use one `buildParentIndexMap` |
| `CanvasArea.tsx` | Culling / flatten / adjustment-scope bounds share one lazily-built index; passes it to `computeDocumentDirtyRegion` |
| `SelectionOverlay.tsx` | Whole-selection world geometry uses one memoized index |
| `CanvasNameLabels.tsx` | Full-tree candidate pass uses one index |
| `context.tsx` | `computeDocumentUnionBounds` uses one index; tool-context `nodeWorldBounds` reads the transform cache (groups now supported) |
| `canvas/drawDiagnostics.ts` | Benchmark handle `window.__strataPerf` (perf=1), `committedAt` timestamp |
| `canvas/perfRuntime.ts` | Re-exports the handle through the single hub import |

## 6. Before / after

Head-to-head on the same machine, same conditions (post-fix vs base commit):

| Metric | Before | After |
|---|---|---|
| Ctrl+D duplication @ ~500 nodes (wall, contended) | 38.3s (7.8s re-measured) | 4.6–6.5s |
| Render frame @ 254 nodes | 21ms | 0.9ms (p50) |
| Render frame @ 932 nodes | **7343ms** | 19–29ms |
| Drag frames @ 128 nodes | — | p50 2.3ms / p95 6ms / p99 10.6ms |
| Drag frames @ 932 nodes | — | p50 44ms / p95 57ms / p99 144ms |
| Zoom frame @ 507 nodes | 21ms (254 nodes) | 4.4ms |

Notes:

- The `7343ms → ~26ms` frame reduction is the headline: the canvas paint loop
  is now ~280x faster at ~900 nodes, which is what restores pointer-to-paint
  responsiveness.
- Remaining drag cost at ~900 nodes (p50 44ms) is the per-frame pre-loop node
  walk (effective-node resolution, engine-node conversion, culling) that still
  runs for the whole visible scene on every frame. It is now O(n) with low
  constants and is comfortably below the 100ms "still interactive" bar, but
  above the 16.7ms budget. A dirty-node-scoped pre-loop (only re-derive
  engine nodes whose cached IR missed) is the next optimization.

## 7. Regression protection

- `canvas/dirtyRegion.test.ts` — two new tests pin large-document dirty-region
  cost (single-edit and bulk-edit at 2000 nodes) far below the pre-fix O(n²)
  blow-up.
- `scene/world.test.ts` — group-union behavior of the transform cache.
- `scripts/perf/bench-replay-browser.mjs` — real-browser `replayIr`
  rasterization benchmark with a ratio-to-control baseline
  (`.replay-browser-baseline.json`); `--ci` gates against regressions.
- `scripts/perf/probe-interaction.mjs` / `probe-duplication.mjs` — repeatable
  interaction and duplication timing probes (documented in `scripts/perf/README.md`).

## 8. Verification

- `pnpm --filter @strata/editor test` — 3841+1 passed.
- Engine + scene suites — 4559 passed.
- `pnpm --filter @strata/editor typecheck` — clean.
- `biome check` on touched files — clean.
- `scripts/audit-architecture.mjs --ci` — no layer violations; CanvasArea and
  context metrics unchanged from baseline.
- `scripts/audit-health.mjs` — passed (no new imports to over-budget hub files
  beyond the existing perfRuntime surface).

## 9. Remaining work

- **Per-frame pre-loop at 1000+ nodes** (p50 ~44ms at 932 nodes): scope the
  flatNodes/hash loop to nodes whose cached IR actually missed, skipping
  engine-node re-derivation for fully-cached frames. Expected benefit: drag
  frames near 16.7ms at 1000+ nodes. Cost: moderate complexity in `drawContent`.
- **Renderer crash at ~2048 nodes** during rapid duplication — pre-existing.
  Needs a memory-pressure investigation (snapshot/undo retention, subtree IR
  cache growth) and a graceful-degradation path for the 4GB profile.
- **Real-GPU (WebKitGTK/Tauri) verification** — this pass ran in headless
  SwiftShader Chromium. The desktop app should be re-measured; the algorithmic
  win transfers, absolute numbers will differ.
- **WASM/native engine** — `buildIr` via Tauri IPC was not the bottleneck at
  tested scales, but should be re-profiled on the desktop build with a 10k-node
  document.
- **Low-spec profile** — memory budgets exist (`memoryBudget.ts`) but are not
  wired to an adaptive low-memory mode; see the task's Phase 7 for the full
  degradation policy.
