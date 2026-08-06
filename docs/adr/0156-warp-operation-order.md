# ADR-0156: Warp operation order

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Nonlinear deformation interacts with strokes, masks, booleans, effects,
text, and transforms. Different backends must not use different orders.

## Decision

Canonical evaluation order (documented in `docs/architecture/warp-system.md`
and enforced by a single shared evaluator in `@varve/engine/src/warp/`):

```
canonical source content
→ source-local path generation (shapeToPathPoints, handles preserved)
→ leaf's own warp stack (array order, first-applied first)
→ affine chain to the warped container
→ container warp stack
→ stroke treatment (per warpSettings.strokeBehavior)
→ clipping/masking (container clip boxes stay straight in local space)
→ object transform (world)
→ visual effects (applied after deformation — shadows follow warped shapes)
→ compositing
→ export conversion (same evaluator, export tolerance)
```

Rules that must not drift:

- Modifiers apply in array order: the first transforms the source first.
- Effects are applied after deformation (documented; a shadow follows the
  warped shape).
- Mask/clip regions are evaluated in local space and clip the warped content.
- Export uses the same evaluator as rendering, never a second approximation.

## Alternatives

- Effects before warp: rejected — shadows/blurs would not follow the
  deformed silhouette, diverging from user expectation.
