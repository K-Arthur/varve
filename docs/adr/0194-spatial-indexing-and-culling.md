# ADR-0194: Spatial indexing and culling

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Hit testing uses a world-space grid (CELL_SIZE=64, `HitTestEngine.ts`);
rendering culls per container; nothing is page-aware. Pages add a natural
partition boundary.

## Decision

D1 — Indexing is hierarchical: page level (page rects → spatial grid of
placed pages) then per-page node grid (existing grid reused per page scene).
The page grid is rebuilt only when placement/trim changes.

D2 — Culling uses page partitions: skip page subtree when its placed rect
(+bleed preview) misses the viewport; inside a page reuse existing
container bounds culling and the subtree IR cache.

D3 — Projection caches (master projections, ADR-0181 D4) are per-page and
invalidated by master/override/placement revision; thumbnails never
synchronously generate (bounded queue exists: `versionThumbnailQueue.ts`).

D4 — The page index is bounded: coordinate limits (ADR-0173) and a
documented maximum grid cell count; degenerate pages (huge size) are clamped
for indexing without mutating authored geometry.

## Alternatives

- One global flat index — rejected: page boundaries and per-page invalidation
  are the optimization surface; a flat index invalidates too broadly.
- Render-tree-only culling (status quo) — rejected: no page-level skip.

## Consequences

- 1,000-page documents: visible pages only pay traversal/replay cost.
- Benchmarks instrument pages projected, nodes replayed, dirty area
  (ADR-0203).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Bounded grid cells prevent index blowups from adversarial placement.

## Rejected shortcuts

- Indexing at canvas-pixel resolution.
- Rebuilding all page indexes on any placement change.
