# ADR-0163: Warp groups and components

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Multiple selected objects must warp as one composition; warped content must
keep children editable; components must keep documented relationships.

## Decision

D1 — Multi-selection warp wraps the selection in a shared warp group
(`warpSelectionAsGroup`) — one envelope for the composition, never one
modifier per child. Children keep identity, ordering, transforms, and
editability.

D2 — Warped containers render by evaluating each descendant leaf's geometry
through the container's warp into a vector path (or cluster-adjusted text)
item in container-local space — no rasterization, no IR changes.

D3 — Components: warps on master children propagate via the existing
deep-clone propagation; instance overrides for warp parameters are not in
v1 (documented). Detaching an instance keeps its (cloned) warp state.

D4 — Expand Appearance on warped containers is unsupported in v1 (returns a
visible reason); use export flattening instead.

## Alternatives

- Copying the modifier onto every child: rejected (task requirement).
- Rasterizing the composition: rejected — breaks child editability.
