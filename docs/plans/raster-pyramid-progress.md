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
| Renderer integration (paintRasterLayer seam) | Pending | next |
| Editor wiring (viewport → scheduler, diagnostics) | Pending | after renderer seam |
| E2E interaction + visual corpus | Pending | |
| Final regression gates | Pending | |

## Commits

- `8487da11` — audit + ADR-0214 + decision-record status update
- `4045e4b3` — baseline measurements doc
- `3a368d5b` — pyramid core (geometry, tileKey, downsample, lod, tileQuery)
- `b2a97cce` — residency, scheduler, pyramidCache cascade + revision safety
- `5d3c6688` — childCoords/derivedSnapshot cleanup

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
