# ADR-0183: Multiple master layers

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

A page supports one optional master (`Page.masterPageId`, `types.ts:1593`).
Real publications layer content: base grid master + chapter headers + watermark
overlays.

## Decision

D1 — Support **ordered master layers** v1: `Page.masterLayers?: MasterLayer[]`
where `MasterLayer = { masterId, zIndex }`; `masterPageId` remains as the
single-layer shorthand (migration writes it as `masterLayers: [{masterId,
zIndex: 0}]`).

D2 — Layers project in z order; later layers paint above earlier ones. No
inheritance between masters in v1 (each master is authored independently).

D3 — Override ownership is explicit: an override's `masterNodeId` implies its
layer; a page override is stored against the master node id, so it always
resolves to the owning layer. Conflicts between layers (two masters defining
the same region) are user-resolved; no automatic precedence beyond z.

D4 — All projection operations are deterministic: sorted by zIndex, then
master id tiebreak.

## Alternatives

- Master-to-master inheritance (base master extends another) — deferred to
  v2 (ADR-0184); adds cycle analysis and resolution precedence.
- Single flattened master per page — rejected: cannot express base + overlay
  workflows without duplicating content into one master.

## Consequences

- UI: master layers list with z reorder, layer-level override counts.
- Diff/merge: layer list merges by master id; same-layer ordering conflicts
  surface.

## Migration impact

v2.20 migration materializes `masterLayers` from `masterPageId`.

## Compatibility impact

`masterPageId` kept in sync for old readers (write-through when single layer).

## Security considerations

Bounded layers per page (≤ 16) to cap projection cost.

## Rejected shortcuts

- Fusing multiple masters into one master on apply.
- Implicit z from assignment order.
