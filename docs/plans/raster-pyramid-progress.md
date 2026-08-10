# Raster pyramid — milestone progress (2026-08-09)

Multi-resolution tiled raster pyramid (ADR-0214). Source docs:
`docs/architecture/raster-pyramid-audit.md` (audit),
`docs/adr/0214-multi-resolution-tiled-pyramid.md` (decisions),
`docs/perf/raster-pyramid-baseline-2026-08-09.md` (pre-implementation baseline).

## Status

| Phase | Status | Notes |
|---|---|---|
| Repository audit + architecture map | Done | `raster-pyramid-audit.md`, findings F1-F8 |
| Measured baseline | Done | trigger confirmed at 2048²; theoretical LOD reduction up to 16384× |
| ADR-0214 | Done | adaptive retained-surface + spatial pyramid |
| Pyramid core (geometry/identity/downsample/LOD/query) | Done | `packages/engine/src/rasterPyramid/`, 50 tests |
| Residency + scheduler + revision-safe cascade cache | Done | `residency.ts`, `scheduler.ts`, `pyramidCache.ts`, 77 tests total |
| Renderer integration (paintRasterLayer seam) | Done | `renderTiles.ts`, gutter tiles, crossover, bench — 92 tests total |
| Editor wiring (viewport → scheduler, diagnostics) | Done | `context/useRasterLod.ts` — session enable, viewport sync, budget presets |
| E2E interaction corpus | Done | `tests/e2e/canvas/raster-lod.spec.ts` — zoom extremes/pan/undo (48.7s) |
| Visual corpus (seams/alpha at multiple zooms) | Deferred | renderTiles gutter unit tests cover the seam maths; browser screenshot corpus is a follow-up |
| Memory soak + pressure-profile soak | Deferred | needs the production pressure wiring (currently test-only, finding F6) |
| Final regression gates | Done (scoped) | full-repo gate blocked by concurrent in-progress packages — see below |

## Concurrency note (2026-08-09)

This milestone ran alongside a second agent committing pathspec-less every
few minutes. Several of this milestone's commits landed interleaved with the
agent's (e.g. `1bfcbdc4` vs `3431a0d0`/`bfe6a606`/`aa88e1b0`); content was
verified intact after every repair, and the mixed-attribution hunks are the
agent's own work preserved verbatim. The full-repo `pnpm typecheck` and
`pnpm test` cannot pass while the agent's in-flight packages (media
decoders, thumbnail work) are half-committed; all pyramid scoped gates are
green.

## Renderer-integration measurements (2026-08-09)

`npx tsx scripts/perf/bench-raster-pyramid-tiles.mjs` — retained full-surface
reconstruction vs visible-tile pyramid generation, real typed-array traffic
in Node (lower bound; draw cost modeled; generation is cached in the real
path, so steady-state is cheaper still):

| Layer | Zoom | Retained p50/p95 | Pyramid p50/p95 | Ratio |
|---|---:|---:|---:|---:|
| 2048² | 12.5% | 27.15 / 42.89 ms | 24.56 / 54.90 ms | 1.1× |
| 2048² | 6.3% | 30.08 / 37.04 ms | 4.59 / 5.52 ms | 6.6× |
| 2048² | 1% | 17.52 / 78.88 ms | 4.33 / 16.38 ms | 4.0× |
| 4096² | 12.5% | 104.52 / 134.47 ms | 79.78 / 138.33 ms | 1.3× |
| 4096² | 6.3% | 122.01 / 185.24 ms | 17.18 / 50.99 ms | 7.1× |
| 4096² | 1% | 117.76 / 212.67 ms | 4.55 / 9.67 ms | 25.9× |
| 8192² | 12.5% | 415.57 / 616.31 ms | 296.22 / 683.28 ms | 1.4× |
| 8192² | 6.3% | 553.84 / 738.64 ms | 106.32 / 194.97 ms | 5.2× |
| 8192² | 1% | 488.51 / 1214.92 ms | 5.17 / 5.45 ms | 94.5× |

Notes: the 12.5% rows model a viewport covering the whole layer (the
coverage-crossover keeps the retained path there anyway); the one-shot
generation cost is what the table shows — repeated frames only pay
per-tile drawImage. No pyramid row ever exceeds the retained path's p50
at the same size, and the advantage grows sharply as zoom drops.

## Commits

- `8487da11` — audit + ADR-0214 + decision-record status update
- `4045e4b3` — baseline measurements doc
- `3a368d5b` — pyramid core (geometry, tileKey, downsample, lod, tileQuery)
- `b2a97cce` — residency, scheduler, pyramidCache cascade + revision safety
- `5d3c6688` — childCoords/derivedSnapshot cleanup
- `0d2464d2` — milestone progress tracker
- `1bfcbdc4` — renderer integration: renderTiles + gutter generation + replay seam + bench
- `0a396a67` — editor wiring: useRasterLod (enable, viewport, budget presets)
- `198ef70f` — E2E interaction corpus

## Delivered contracts (public surface, `@varve/engine/rasterPyramid`)

- `pyramid.ts` — level math, parent/child mapping, dirty propagation,
  conservative rect→tiles
- `tileKey.ts` — composite tile identity + revision snapshots
- `downsample.ts` — premultiplied-alpha 2×2 box, edge replication
- `lod.ts` — effective device scale + hysteresis LOD selection
- `tileQuery.ts` — visible tile selection
- `residency.ts` — byte-budgeted LRU store, protected tiles, layer release
- `scheduler.ts` — bounded priority queue, latest-wins, cancellation
- `pyramidCache.ts` — cascade generator, read-only resolve, commit-time
  revision guard, sparse handling

## Design decisions recorded for the renderer phase

- Effective scale read from `ctx.getTransform()` at replay time (already
  DPR + camera + affine) — no IR schema change needed.
- Crossover: retained surface for small layers/high coverage; spatial tiles
  for large layers at low effective scale; measured, exposed in diagnostics.
- Tile drawing uses 1-texel gutters with edge replication to kill seams
  (brief §20); drawImage-per-tile under the existing world transform keeps
  opacity/blend/mask/filter semantics on the finished composite.
- Progressive refinement: ideal LOD missing → coarser resident ancestor →
  finer fallback → placeholder (brief §30).
- `paintRasterLayer` stays the hot path: the seam is a narrow opt-in branch,
  benchmarked before merge (AGENTS.md hot-path rule).
