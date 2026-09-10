# Canvas Performance — Continuation, 2026-08-01 (part 2)

Continues [`canvas-perf-2026-08-01.md`](canvas-perf-2026-08-01.md), which found
and fixed the dominant O(n²) `getParent` hotspot and left a ranked
remaining-work list. This pass took the top item ("per-frame pre-loop at 1000+
nodes"), fixed it, and then found that it was **not** what dominated the frame.

## 1. Measurement conditions — read this before trusting any number here

The dev machine was heavily contended for the whole session:

| Item | Value |
|---|---|
| Load average | 19–34 on 8 threads (3–4x oversubscribed) |
| RAM | 22 GiB total, ~5.6 GiB available |
| Swap | zram, 12.4 GiB of 22.8 GiB in use |
| Competing work | 3 `opencode` agents, up to 6 concurrent `vitest` runs, `madge`, other worktrees' dev servers |
| Build | Vite dev server, React 19 **development** mode |
| Browser | headless Chromium, SwiftShader software GL |

Consequences, applied throughout this document:

- **Wall-clock numbers are directional only.** The same scripted drag produced
  103s, 60s and 28s profiler wall times across three runs.
- **Deterministic work counts are the primary evidence.** Conversions per
  frame, memo hits, sort-comparator counts and cache entry counts do not vary
  with machine load, so they are what the new regression guards assert on.
- One pre-existing test (`cacheSystem.bench.test.ts`) asserts a <10ms
  wall-clock cache-hit budget and **fails under parallel load** while passing
  3/3 in isolation. It is a flaky gate, not a regression — see §6.

## 2. What was changed

| # | Change | Evidence class | Status |
|---|---|---|---|
| 1 | Cull before engine-node conversion | deterministic | verified |
| 2 | `EngineNodeMemo` — cross-frame memo of scene→engine conversion | deterministic | verified |
| 3 | `SubtreeIrCache` eviction O(n log n)-per-entry → O(1) | deterministic + profile | verified |
| 4 | Frame phase timers (`setupMs`, `preLoopMs`) | instrumentation | verified |
| 5 | Snap targets read through the transform cache | none | consistency only, see §5 |
| 6 | `NodeHashMemo` NUL-byte sentinel → `\0` escape | n/a | tooling defect |

### 2.1 Cull before conversion, and memoize it

The pre-loop converted every visible node to an `EngineNode` every frame, and
did so *before* testing whether the node was on screen. Two fixes:

- The viewport test needs padding that `appearancePaddingWorld` derives from
  `strokes`/`effects` only. `sceneNodeToEngineNode` copies both by reference and
  `applyStyleOverrides` is the same `{...a, ...b}` merge, so padding computed
  from the scene node is *identical* to the value previously computed from the
  engine node. Offscreen nodes now skip conversion entirely.
- `EngineNodeMemo` reuses the converted node while the effective scene node and
  cached world transform keep reference identity. The document is immutable and
  structurally shared, so during a drag only the dragged node changes identity.

Correctness is bounded by the type system: `toEngineNode`'s document parameter
is typed `Pick<Document, 'paints' | 'rasterMaskAssets'>`, so those are the only
document fields the key has to cover (plus `doc.styles` and the
show-original-background id, both keyed at frame level).

`doc.styles` is keyed per frame rather than per node deliberately:
`resolveAllStyles` allocates a fresh override object per call and is memoized on
`state.document`, which changes every drag frame — a per-node key on the
override's identity would miss every frame for every styled node.

Never memoized: text-on-path nodes (engine shape patched from another node's
geometry, which the key cannot observe) and every node during timeline playback
(the motion sampler mutates the produced engine node in place).

**Result — 932-node drag, deterministic:**

| Metric | Before | After |
|---|---:|---:|
| Engine-node conversions per frame (p50) | 932 | **0** |
| Engine-node conversions per frame (max) | 932 | **1** |
| Memo hits per frame (p50) | — | 932 |

### 2.2 SubtreeIrCache eviction

A CPU profile attributed ~5.3% of drag CPU to eviction (`evictIfNeeded` 3.2%,
its sort comparator 1.5%, `estimateItemBytes` 0.6%). `evictIfNeeded` sorted the
entire entry map to find the LRU victim, once **per evicted entry**.

Why it was on the interaction path and not just document load: `maxEntries` is
500, so any document with more than 500 nodes is permanently over the entry cap.
Every `set()` therefore evicted, and every eviction re-sorted ~500 entries.

Fixed by making the Map itself the LRU queue — iteration order is insertion
order, so `get`/`set` re-insert at the back and eviction takes the first key.
O(1), no sort, identical eviction order and reasons.

| Metric | Before | After |
|---|---:|---:|
| `evictIfNeeded` + comparator + `estimateItemBytes` in top-25 profile | 5.3% | **absent** |
| Bulk fill: 4000 inserts into a 500-entry cache | 1050 ms | **9.2 ms** |
| `Array#sort` comparator calls during that fill | many | **0** (asserted) |

## 3. The finding that redirected this work

After the memo landed, the drag frame was still ~60ms p50 while the *measured*
phases summed to ~2ms. Adding `setupMs`/`preLoopMs` showed:

```
total 63.2ms = setup 9.3 + preLoop 5.5 + hash 1.7 + buildIr 0.2 + replay 0.1
               + 46.4ms unattributed
```

So the per-frame node walk — the item the previous audit ranked first — is
**~15ms of a ~63ms frame**, and engine-node conversion within it is now ~0.
A CPU profile of the same drag explains the rest:

| Cost | Share | Nature |
|---|---:|---|
| `jsxDEV` + `jsxDEVImpl` + `createElement` + `validateProperties*` | **~38%** | React **development-mode** overhead |
| `groupWorldBounds` (+ its recursion) | 7.6–8.2% | app — world geometry |
| garbage collector | 4–5% | app — allocation rate |
| `multiplyAffine` / `getParent` / `buildParentIndexMap` / `transformRect` | ~9% | app — world geometry |
| `existingNames` (autoNamer) | ~1.7% | app — runs during drag |

**The single largest cost in a dev-build drag is React dev-mode work, not the
renderer.** `jsxDEV`, `validatePropertiesInDevelopment`, `validateProperty` and
`updatedAncestorInfoDev` do not exist in a production build. This is a strong
candidate explanation for "the canvas feels slower than the panels" *in daily
dev use*: the canvas subtree re-renders on every pointer move, so it pays that
dev tax per move while a static panel does not.

## 3a. Development vs production build — measured

A production build (`vite build` + `vite preview`, verified to contain no
`jsxDEV`) was measured with the same probes at the same node counts.

| Workload | Dev build | Production build |
|---|---:|---:|
| Drag frame p50, **128 nodes** | 2.9 ms | 3.4 ms |
| Drag frame p95, 128 nodes | 7.5 ms | 7.5 ms |
| Drag frame p50, **932 nodes** | 63.2 ms | **33.2 ms** |
| Drag frame p95, 932 nodes | 75.1 ms | 197.2 ms |
| Drag frame p99, 932 nodes | 84.3 ms | 633.4 ms |
| Profiler wall, same 932-node drag script | 27.9 s – 102.7 s | **8.8 s** |
| Browser idle share during drag | 0.6 – 1.9 % | 9.6 % |

Conclusions, and one correction:

- **At small node counts the build mode does not matter.** 128 nodes is ~3 ms
  p50 either way, comfortably inside frame budget.
- **At 932 nodes the dev build roughly doubles the median frame** (63.2 → 33.2
  ms). React's dev-mode cost scales with the number of rendered elements, and
  the canvas subtree re-renders per pointer move — so the dev tax grows with
  document size exactly where it hurts.
- **Correction:** an intermediate reading of this session compared a 932-node
  dev run against a 128-node production run and briefly suggested production was
  3–12x faster. That was an artifact of the two probes carrying different
  duplication counts (`guard < 8` vs `guard < 5`). Node count is now set by
  `STRATA_PERF_DUPS` so the two builds are always compared at parity.
- **Production is still not fast at 932 nodes.** p50 33.2 ms is double the
  16.7 ms budget, and p95/p99 of 197/633 ms are real stalls. Dev-mode overhead
  is a large tax but it is not the whole problem.
- In the production breakdown `setupMs` (12.8 ms p50) is now the largest
  measured phase — `walkNodes`, container culling, dirty region and
  style/variant precomputation — with 14.8 ms still unattributed. That is the
  next target, and it is a real app cost rather than a build artifact.

Independent of build mode, React is reconciling the canvas subtree on every
pointer move; only the dev-mode validation disappears in production.

## 4. Rejected / corrected hypotheses

- **"The per-frame pre-loop is the remaining bottleneck"** (inherited from the
  previous audit) — *partly wrong*. It was ~15ms of ~63ms, and the conversion
  portion is now zero, but the frame did not become fast. Fixing it was
  worthwhile and insufficient.
- **"Snapping drives `groupWorldBounds`"** — *wrong*. Routing snap targets
  through the transform cache did not move the number. Caller attribution
  (`--callers=groupWorldBounds`) shows its own recursion (4.6%) and a React
  `useMemo` (3.1%) dominate; snapping and container culling are far behind.
- **"`NodeHashMemo` is missing from `subtreeIrCache.ts`"** — *wrong, and
  instructive*. The file contained a raw NUL byte, so git classified it binary
  and every ripgrep/ugrep search silently skipped it (`-I`). A search returning
  nothing looked like "the symbol does not exist" rather than "this file was
  excluded". Fixed by writing the sentinel as `'\0uninit'`.

## 5. Change 5 has no measured benefit

`snapPosition` now reads bounds through the transform cache instead of the
uncached `nodeWorldBounds`. It is strictly less work in principle and removes
the last uncached world-bounds call site in `CanvasArea`, but it did **not**
reduce `groupWorldBounds` in the profile. It is recorded here as a consistency
fix so that it is not later mistaken for the fix to that hotspot.

## 6. Regression protection added

- `engineNodeMemo.test.ts` — 16 cases covering every invalidation input
  (node identity, world transform, paints, mask assets, style table,
  compare toggle), bounding/eviction, and the styled-node case that a naive key
  would break.
- `subtreeIrCacheEviction.test.ts` — asserts **zero** `Array#sort` comparator
  invocations while filling a cache far past capacity, plus LRU order and cap.
  A wall-clock version was written first and **rejected**: its sample ratio
  swung between 4x and 10x on this machine, which would have made it flaky
  rather than protective.
- `probe-interaction.mjs` — prints per-frame conversion counts and a VERDICT
  line, so a contended CI box can gate on work-per-frame rather than wall-clock.
- `probe-cpu-profile.mjs` — self-time ranking plus `--callers=<fn>` attribution.

**Pre-existing flaky gate:** `cacheSystem.bench.test.ts` asserts a <10ms
wall-clock cache-hit budget. It failed at 16.7ms during a 34-file parallel run
at load 25 and passed 3/3 in isolation; it references none of this work. It
should be converted to a work-count assertion like the two above.

## 7. Remaining work, ranked

1. **`setupMs` — 12.8 ms p50 of a 33 ms production frame at 932 nodes.** The
   largest measured phase in the production build: `walkNodes`, the container-
   culling pass, dirty-region computation and style/variant precomputation —
   all full-document passes that run every frame. A further 14.8 ms is still
   unattributed post-replay. Now the top target: a real app cost, not a build
   artifact.
2. **Production p95/p99 stalls: 197 ms / 633 ms at 932 nodes.** The median
   (33 ms) is tolerable; the tail is not. Likely GC or a periodic full
   invalidation. Worth investigating before chasing further median wins.
3. **React re-render of the canvas subtree per pointer move.** Dev-mode
   validation disappears in production but reconciliation does not, and it is
   what makes the dev build scale badly with node count (parity at 128 nodes,
   2x worse at 932). Identify what subscribes the subtree to pointer state.
4. **`groupWorldBounds` ~8%.** Its largest external caller is a React `useMemo`
   (3.1%); the rest is its own recursion. A memoized group-bounds path (or
   routing that `useMemo` through the transform cache) is the fix. Identify the
   exact `useMemo` first — this pass guessed wrong once already.
5. **`existingNames` / autoNamer running during drag (~1.7%).** Naming
   intelligence has no reason to run on pointer move; likely a missing guard.
6. **Renderer crash at ~2048 nodes during rapid duplication.** Pre-existing,
   carried over from part 1, still unaddressed. Directly contradicts "heavy
   documents remain usable rather than freezing".
7. **Low-memory / 4GB profile.** `MemoryBudgets` gained
   `engineNodeMemoEntries` (20000 default, 4000 low) and the memo shrinks with
   the adaptive cache multiplier, but there is still no automatic low-memory
   mode, no degradation order, and no recovery path for failed allocation or
   GPU-context loss. Carried over from part 1.
8. **Real-GPU (WebKitGTK/Tauri) verification.** All measurement here is
   headless SwiftShader Chromium.
