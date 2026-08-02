# Raster tiling — decision record (2026-08-02)

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
