# ADR-0157: Warp coordinate-space model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Warp controls must stay intuitive when the source resizes, rotates, moves,
or is re-edited, and must not be silently reinterpreted when bounds change.

## Decision

D1 — Controls are stored in **normalized source-bounds coordinates**
(0..1 relative to the node's current source bounds) by default
(`coordinateSpace: 'normalized-source'`): resize the source → the cage
scales with it (normalized deformation preserved).

D2 — `coordinateSpace: 'source-local'` stores absolute source-local
coordinates: the cage stays fixed when the source changes (fixed local
cage). Envelope edge controls may exceed 0..1 (bounded to [-2, 3]) because
curved edges legitimately bulge outside the cage.

D3 — Space ladder (documented): source-local → normalized-source → modifier
local (per-modifier maps) → node local → parent local → world → viewport.
Zero/near-zero source bounds produce identity maps (never NaN).

D4 — Policies surfaced in the Inspector: preserve normalized deformation
(default), fixed local cage (source-local mode), and destructive
Expand Appearance. The UI never silently reinterprets stored controls.

## Alternatives

- Storing an absolute reference `sourceBounds` per modifier and rebasing:
  rejected for v1 — normalized storage with an explicit mode switch covers
  both intuitive behaviors with less state.
