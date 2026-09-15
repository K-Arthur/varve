# Raster pyramid — measured baseline (2026-08-09)

Pre-implementation baseline for the multi-resolution tiled-pyramid milestone
(ADR-0214, `docs/adr/0214-multi-resolution-tiled-pyramid.md`). Audit:
`docs/architecture/raster-pyramid-audit.md`.

## Environment

CachyOS Linux, kernel 7.1.5-1-cachyos, Node 26.4, 8-core CPU, `performance`
governor. Isolation: no other benchmark/visual agents running (per the
concurrency protocol, §56 of the task brief).

## 1. Current full-surface reconstruction cost (Node lower bound)

`node scripts/perf/bench-raster-reconstruction.mjs` — models the
memory-traffic component of `paintRasterLayer` (full-layer intermediate
allocation + per-tile copy) with real typed-array traffic. A lower bound:
real `putImageData` in browsers is not cheaper than this.

| Layer | Tiles | Intermediate | p50 total | p95 total | tile replay share |
|---|---:|---:|---:|---:|---:|
| 512² | 16 | 1.0 MiB | 2.51 ms | 6.24 ms | 92.7% |
| 1024² | 64 | 4.0 MiB | 9.30 ms | 15.98 ms | 97.8% |
| 2048² | 256 | 16.0 MiB | 31.17 ms | 53.44 ms | 96.3% |
| 4096² | 1024 | 64.0 MiB | 174.58 ms | 219.07 ms | 98.8% |
| 8192² | 4096 | 256.0 MiB | 736.25 ms | 1461.49 ms | 99.7% |

Trigger (16.7 ms frame budget, 8 MiB intermediate threshold) is met at 2048² —
consistent with the 2026-08-03 record. At 8192² the intermediate alone (256
MiB) exceeds the entire default worker bitmap budget (128 MiB).

## 2. Theoretical work reduction the pyramid must realize

LOD chosen so one pyramid texel ≈ one device pixel at DPR 1, without
hysteresis. `reduction = L0 texels / texels read at chosen level`; the layer
is drawn fully on screen (best case for the current path, worst case for
pyramid savings is a small viewport at high zoom).

| Zoom | 2048² | 4096² | 8192² | 16384² |
|---|---:|---:|---:|---:|
| 1% (L7) | 16384× | 16384× | 16384× | 16384× |
| 6.25% (L4) | 256× | 256× | 256× | 256× |
| 12.5% (L3) | 64× | 64× | 64× | 64× |
| 25% (L2) | 16× | 16× | 16× | 16× |
| 50% (L1) | 4× | 4× | 4× | 4× |
| 100% (L0) | 1× | 1× | 1× | 1× |

Cross-multiplying with §1: a 4096² layer at 25% zoom currently costs ~175 ms
p50 / 64 MiB intermediate for work that needs 4 MiB of texels — the pyramid
target is to make the per-frame cost track the texels actually read, not the
source size.

## 3. Memory baseline (current path, whole layer resident)

| Layer | L0 tiles | Resident surface (RGBA) |
|---|---:|---:|
| 2048² | 256 | 16 MiB |
| 4096² | 1024 | 64 MiB |
| 8192² | 4096 | 256 MiB |
| 16384² | 16384 | 1024 MiB — exceeds the 128 MiB RasterLayerCache budget; LRU will evict and thrash |

A 16384² layer cannot stay resident under the current 128 MiB surface budget:
every repaint rebuilds it (full-rebuild path), and low-zoom views are
proportionally wasteful. This is the case spatial LOD exists for.

## 4. What gets measured in-browser at integration time

The following are deferred to the renderer-integration milestone (the Node
numbers above cannot capture them):

- resident raster bytes (pyramid budget vs retained surface);
- tiles drawn per frame at each zoom (visible-tile counts);
- source pixels touched per frame;
- CPU replay time p50/p95 at 3200% → 1% zoom, pan and zoom gestures;
- worker transfer bytes (vs the current `number[]` IR bloat, finding F4);
- memory high-water and GC pressure during zoom/pan;
- cache hit/miss and eviction counts (pyramid residency).

Instrumentation plan: extend `rasterReplayMetrics.ts` sinks with per-frame
`{strategy, lodLevel, sourceTileCount, visibleTileCount, residentTileCount,
requestedTileCount, generatedTileCount, cacheHits, cacheMisses,
sourcePixelsAvoided}` (brief §60), gated behind the same opt-in pattern (null
sink by default, no cost when off).

## 5. Success criteria this baseline anchors

- No regression for ≤1024² layers at 100% (current p95 ≤ 16 ms; retained
  surface stays the active path).
- 4096² at ≤50% zoom: frame cost proportional to visible texels, not 1024
  tiles; resident bytes below the 64 MiB full surface.
- 8192² at ≤25%: no 256 MiB intermediate per frame; resident LOD tiles within
  the pyramid budget.
- Export/print outputs byte-identical policy: unchanged (export never reads
  LOD — ADR-0214 D12).
