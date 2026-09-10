# Raster tiling — decision record (2026-08-02, measured 2026-08-03)

> **Status update (2026-08-09): a multi-resolution tiled pyramid milestone is
> now in progress.** Step 1 (dirty-tile-only replay) shipped. Step 2
> (visible-tile/LOD rendering) is now approved and implemented under
> ADR-0214 (`docs/adr/0214-multi-resolution-tiled-pyramid.md`), with the full
> repository audit in `docs/architecture/raster-pyramid-audit.md` and the
> measured baseline in `docs/perf/raster-pyramid-baseline-2026-08-09.md`.
> The "not approved without further evidence" statement for pyramids below
> refers to the 2026-08-03 evidence state; the milestone supplies that
> evidence.

> **Status update (2026-08-03): the trigger is now MET for layers of 2048×2048
> and above.** The 2026-08-02 record below deferred the work with an estimated
> trigger of "~1024 tiles (4096²)". Measurement shows the frame budget is blown
> four times earlier than that, at 256 tiles. See
> [Measured evidence](#measured-evidence-2026-08-03). The work is approved but
> deliberately not implemented in the same pass that measured it — it belongs
> in its own milestone with the correctness corpus attached.

## Question

Does Strata need a viewport-aware spatial tile renderer for large images and
rasterized subtrees?

## What already exists

- **Scene-level raster layers tile at the data model.** Paint layers store
  128×128 tiles (`TILE_SIZE = 128`, `scene/src/rasterLayer.ts`); the dirty
  region analysis diffs tile versions (`dirtyRegion.ts`) so a dab edit
  invalidates only the affected tile bounds.
- **Partial redraw avoids full-canvas repaints.** A moved image/layer
  repaints only its old+new dirty region when the profile allows and the
  camera is unrotated (`CanvasArea.tsx` `usePartialRedraw`, <60% viewport).
  The dirty-area ratio is now recorded per frame, so redraw scope is
  measurable.
- **Full-resolution decode memory is bounded.** `ImageCache` is byte-budgeted
  (256 MiB default, 64 MiB low). The render worker's image transport is now
  byte-budgeted (`workerBitmapBytes`, 128 MiB default / 64 MiB low / 32 MiB
  stress-2gb) with admission control: an over-budget render is refused up
  front and falls back to main-thread Canvas2D. There is no uncontrolled
  full-resolution intermediate left.
- **Large embedded image fills replay as a single GPU blit** (`drawImage` of
  the decoded bitmap) — cheap per frame and not a tiling candidate.

## The remaining gap

`replay.ts`'s `paintRasterLayerPrimitive` reconstructs the full layer-sized
OffscreenCanvas from **every** 128px tile on every replay, even when only a
few tiles changed and even when the layer is mostly off-view. This is O(tiles)
per frame with a full-size intermediate. It is only a real cost when a raster
layer is very large (thousands of tiles) AND repaints frequently.

## Why it is deferred

1. **No uncontrolled full-resolution intermediate remains** after the worker
   bitmap budget (memory DoD met without a tile renderer).
2. **Redraw waste is already bounded** by dirty-region partial redraw, and
   that scope is now instrumented (dirty-area ratio per frame).
3. A spatial tile renderer (per-tile offscreen cache keyed by tile version +
   zoom bucket, overlap margins for filters, seams/alpha/colour parity vs
   untiled output) is a new compositor path with real correctness risk in the
   per-frame hot path — the AGENTS.md rule requires such hot-path changes be
   benchmarked at 100/1k/10k/50k and be both faster and correct to ship.
4. The worst case is bounded: a pathological layer rebuilds its offscreen
   once per frame under the existing frame budget, and the IR is cached.

## Trigger conditions for implementing it

Revisit when any of these are reproducibly true (prove with the perf harness
before starting):

- Full-frame replay of a raster-heavy subtree exceeds the frame budget even
  with partial redraw active (measure via `?perf=1` `totalMs` vs budget).
- Worker admission refuses an image-heavy scene under the normal (128 MiB)
  budget — i.e. legitimate scenes are forced to the main-thread path.
- A single raster layer exceeds ~1024 tiles (4096²) and is edited/repainted
  at >15 fps, and profiling attributes the cost to `paintRasterLayerPrimitive`
  (not IR build, hashing, or compositing).
- Export of very large raster subtrees is memory-capped by consumers and the
  tile path would reduce peak intermediates.

If implemented: tile key = `(rasterLayer version, col, row, zoomBucket)`; keep
tiles byte-bounded (reuse `RenderBitmapBudget`), include filter/mask overlap
margins, and parity-test against the untiled renderer (extend
`__goldens__`/`visual/replay.spec.ts`).

## Measured evidence (2026-08-03)

Instrumentation: `packages/engine/src/rasterReplayMetrics.ts` adds an opt-in
sink to `paintRasterLayer` recording layer size, total vs composited tiles,
intermediate bytes, and surface/tile/draw phase times. The sink is null by
default, so the production path is unchanged — a test asserts measurement is
off unless explicitly installed.

Reproduce with `node scripts/perf/bench-raster-reconstruction.mjs`.

**Environment.** CachyOS Linux, kernel 7.1.5-1-cachyos, Node 26.4, 8-core CPU,
`performance` governor. 3 warm-up iterations, 12 measured iterations per size.

| Layer | Tiles | Intermediate | p50 total | p95 total | tile-replay share |
|---|---:|---:|---:|---:|---:|
| 512² | 16 | 1.0 MiB | 1.58 ms | 4.35 ms | 94.3% |
| 1024² | 64 | 4.0 MiB | 5.93 ms | 10.57 ms | 95.2% |
| 2048² | 256 | 16.0 MiB | 28.57 ms | 58.67 ms | 96.2% |
| 4096² | 1024 | 64.0 MiB | 204.15 ms | 252.84 ms | 98.7% |
| 8192² | 4096 | 256.0 MiB | 855.57 ms | 968.37 ms | 99.8% |

**Scope of the measurement.** This models the memory-traffic component
(full-surface allocation plus a per-tile copy) with real typed-array traffic in
Node. It is not a browser measurement: real `putImageData` additionally does
colour-space handling and may touch GPU-backed storage. These figures are
therefore a **lower bound** on in-browser cost, not an estimate of it. The
conclusion is robust to that caveat precisely because it is a lower bound — the
real path cannot be cheaper than this.

### Trigger evaluation

Thresholds are `evaluateRasterTrigger` in `rasterReplayMetrics.ts`, derived
from budgets already in force (16.7ms frame budget; 8 MiB = a quarter of the
32 MiB constrained-tier worker bitmap budget).

| Layer | p95 vs 16.7ms budget | Intermediate vs 8 MiB | Trigger |
|---|---|---|---|
| 512² | under (4.35 ms) | under (1.0 MiB) | not met |
| 1024² | under (10.57 ms) | under (4.0 MiB) | not met |
| 2048² | **over, 3.5×** (58.67 ms) | **over, 2×** (16.0 MiB) | **met** |
| 4096² | **over, 15×** (252.84 ms) | **over, 8×** (64.0 MiB) | **met** |
| 8192² | **over, 58×** (968.37 ms) | **over, 32×** (256.0 MiB) | **met** |

Two corrections to the 2026-08-02 record:

1. **The estimated trigger was four times too permissive.** It named 1024
   tiles (4096²); the budget is actually blown at 256 tiles (2048²) — a size
   well inside ordinary print and photo work, not a pathological case.
2. **"The worst case is bounded" does not hold.** A 4096² layer costs at
   minimum 205ms per reconstruction, which is ~12 frame budgets. On a 4 GB
   system a 64 MiB intermediate allocated per replay is also a real
   memory-pressure contributor, and 8192² reaches 256 MiB — on its own larger
   than the entire 128 MiB default worker bitmap budget.

Tile replay, not surface allocation, dominates at every size (94–99.8%), so a
dirty-tile or visible-tile path attacks the right term: it removes work
proportional to the tiles skipped. Allocation reuse alone (a persistent layer
backing surface) would address at most 6% at 512² and under 1% at 4096².

### Approved next step

Gate E is satisfied for layers ≥ 2048². Recommended design, in priority order:

1. **Dirty-tile-only replay** onto a persistent per-layer backing surface.
   This removes the O(all tiles) term for edits, which is the dominant case
   (a brush dab changes 1–4 tiles out of 256+).
2. **Visible-tile-only replay** for the pan/zoom case, where the layer is
   larger than the viewport.

Not approved without further evidence: tile atlases, multi-resolution
pyramids, and GPU texture residency — none is justified by these numbers, and
each adds correctness surface (seams, sampling, colour management) that the
measured problem does not require.

Correctness gate before shipping either: the raster corpus in the task brief
(opaque/transparent/semi-transparent tiles, rotation, scale, fractional
translation, large blur, shadow, mask, clip path, non-normal blend modes,
colour-profile conversion, sparse and full invalidation, missing/stale tiles,
tile replacement mid-render, context loss mid-reconstruction) must pass
pixel-diff against the current untiled output.
