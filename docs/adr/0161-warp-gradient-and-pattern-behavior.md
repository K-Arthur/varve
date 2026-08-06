# ADR-0161: Warp gradient and pattern behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Paints must relate to warped geometry deterministically, with one rule for
every renderer and exporter.

## Decision

D1 — `warpSettings.gradientBehavior`:
- `deform-with-object` (default): the fill transforms with the object; the
  gradient coordinate space is the node's local space, so warping the
  geometry deforms the fill with it (the standard expectation).
- `object-paint-space`: gradient stays in the node's paint space (linear/
  radial) — equivalent for affine-only warps; nonlinear warps keep the
  paint space and are documented.
- `canvas-fixed`: gradient stays fixed in canvas space — rejected for v1
  (needs renderer support for fill-space pinning).

D2 — Solid fills are fully supported under warp in every path. Image fills
under warp: v1 renders them warped as part of the node geometry when the
node shape is warped; SVG export bakes them as paths with a warning comment.
Unsupported paint modes are never silently converted.

## Alternatives

- Sampling the paint into a warped raster: rejected — rasterizes the fill
  for a vector operation.
