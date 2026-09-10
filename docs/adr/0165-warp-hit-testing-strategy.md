# ADR-0165: Warp hit testing

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Selection must follow the visible warped shape, not the unwarped source.

## Decision

D1 — Warped leaves: `HitTestEngine.hitGeometry` evaluates the node's warp
stack (draft quality) and hit-tests the evaluated path shape — the same
canonical evaluator as rendering.

D2 — Warped containers: the hit test evaluates the container's descendant
items (draft quality, bounded) and tests each evaluated path with its world
transform. Deep selection inside warped containers resolves to the
container in v1 (documented).

D3 — Inverse mapping is not used in v1: in folded regions an inverse is
non-unique. Forward evaluation of the visible geometry is deterministic and
correct by construction; the per-query cost is bounded by the draft
tolerance and point budget.

## Alternatives

- Inverse mapping: rejected — non-unique under foldover.
- Source-bounds hit testing: rejected — selection would not follow the
  visible shape.
