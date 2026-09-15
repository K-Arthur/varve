# ADR-0164: Warp layout-boundary behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Warped geometry can extend far beyond source bounds. Auto Layout, grids,
and constraints must not reflow on every warp edit (feedback loops).

## Decision

D1 — Layout always uses **source bounds** (`layoutBounds: 'source'`,
the default and only evaluated value in v1): warp never feeds back into
layout dimensions, eliminating the
`warp → bounds change → layout resize → warp change` loop.

D2 — `layoutBounds: 'visual'` is accepted by the schema and surfaced in the
Inspector as disabled-with-explanation until convergence and parent-layout
behavior are defined.

D3 — Selection, hit testing, dirty regions, and export use the warped
(visual) bounds; layout-affecting paths (`w`/`h`, auto-layout, constraints)
use source bounds. The distinction is documented in
`scene/src/warpBounds.ts` and `coordinateService.nodeSourceWorldBounds`.

## Alternatives

- Visual-bounds layout by default: rejected — reflow loops.
