# ADR-0169: Warp collaboration granularity

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Warp edits must compose with Varve's collaboration model (CRDT awareness
over the SQLite document store) without replacing whole documents or large
mesh payloads.

## Decision

D1 — Warp ops are structured per node+modifier with stable identities:
`addWarp` / `removeWarp` / `moveWarp` (reorder) / `setWarpParameter`
(point-patch) / `setWarpEnabled` / `resetWarp` / `expandAppearance`.
Every op is expressed in `warpOps.ts` as an immutable document transform —
the same shape a CRDT op log would carry.

D2 — Mesh editing granularity: single control-point moves are parameter
patches (`setWarpParameter` on one point); multi-point drags are a batched
set of point patches in one transaction. v1 does not replicate large mesh
payloads per pointer event — the transaction model already coalesces them
into one undo/op entry.

D3 — Deterministic conflict behavior (documented): concurrent moves of the
same point apply last-writer-wins per patch at op-apply time; removing a
modifier during a remote drag makes the drag a no-op on the next patch;
source edits during envelope edits re-derive from the normalized controls
per ADR-0157.

D4 — Client-side presence/session state (warpEdit target) is transient and
never replicated.

## Alternatives

- Whole-mesh replacement per move: rejected — wasteful and conflict-prone.
