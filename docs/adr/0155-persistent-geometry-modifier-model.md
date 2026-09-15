# ADR-0155: Persistent geometry-modifier (warp) model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Varve needs non-destructive skew, perspective, envelope, mesh, and bend
deformation of editable vector content. The canonical document must retain
the original source geometry plus an ordered, re-editable modifier stack —
never a replaced, tessellated result.

## Decision

D1 — A typed `warps?: WarpModifier[]` stack on `NodeBase` (scene `types.ts`),
with node-level `warpSettings?: WarpSettings` for evaluation policy. Eligible
kinds: shape, text, group, frame (enforced by `canNodeHaveWarps`).

D2 — Modifier schema and validation are owned by `@varve/engine` (the
geometry core — same ownership as `Shape`/`PathPoint`); `@varve/scene`
re-exports them and owns document ops (`warpOps.ts`), migrations
(`warpMigration.ts`, 2.15→2.16), and bounds integration.

D3 — Every modifier carries a stable `id`; the stack is capped at 8
(`MAX_WARPS_PER_NODE`), matching the VariableModifier precedent. Controls
are validated on ingest: known kinds with malformed payloads are dropped
with diagnostics; unknown future kinds are preserved inert so newer readers
can recover them.

D4 — Derived tessellation is never the only stored representation. Disabling
or removing modifiers restores the exact canonical source.

## Alternatives

- Modifier node wrapping source children: rejected — a node field composes
  with the existing snapshot undo, codec, clipboard, and component sync
  with far smaller blast radius; groups (which are already nodes) provide
  the shared-envelope container.
- Raster/screenshot persistence: rejected (ADR-0001 IR-replay philosophy).
