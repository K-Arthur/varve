# ADR-0160: Warp stroke behavior

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Warping centerline geometry vs. visible stroke outlines yields different
results. The Inspector must show which policy is active and export must
honor it.

## Decision

D1 — `warpSettings.strokeBehavior`:
- `preserve-width` (default): the path centerline is warped; the stroke
  renders at its original visual width on the warped centerline.
- `warp-appearance`: strokes are expanded to outline geometry before warp
  (canonical `expandStroke`), then the outline is warped.
- `scale-approx`: stroke width varies by local deformation scale
  (deterministic Jacobian estimate).

D2 — v1 renders `preserve-width` fully; `warp-appearance` is available in
the evaluator pipeline contract and documented as follow-up for variable
width/dash/arrowhead fidelity. `scale-approx` is validated and documented
but not shipped until deterministic behavior is visually justified.

D3 — The Inspector selector always reflects the active policy; export uses
the same policy (SVG bake / PDF raster path).

## Alternatives

- Always expanding strokes: rejected — changes default appearance for thin
  UI strokes and is expensive.
