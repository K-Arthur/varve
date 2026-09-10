# ADR-0189: Text exclusion and shape support

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

No text exclusion or non-rectangular frames exist; frames are axis-aligned
rectangles. ParagraphFormat declares columns but they are unimplemented
(`types.ts:835-839`).

## Decision

D1 — v1 composition supports rectangular frames with columns and insets
(implemented in the compositor: column assignment, column gap, frame insets,
vertical alignment top/center/bottom).

D2 — Exclusion shapes (wrap-around objects) are deferred: the model adds an
optional `exclusions?: NodeId[]` list on the frame binding, validated against
a bounded set of shape kinds, but composition treats them as ignored until
the polygon-clipping composer ships. The field is inert-but-serializable so
documents don't fork.

D3 — Rotated/transformed frames compose in frame-local space; the composed
lines transform with the frame (existing render path already applies frame
transforms to text).

D4 — Text-on-path and warped text remain separate systems (existing
`textWarp.ts`), excluded from story composition; frames inside warps cannot
join stories (validated at link time).

## Alternatives

- Polygon composition now — rejected: geometry pipeline (line clipping vs
  exclusion contours) is a large sub-project; rectangular + columns covers
  the required print workflows.
- Composition in world space — rejected: breaks local-space determinism.

## Consequences

- Golden fixtures cover columns + insets; exclusion fixtures land with the
  deferred composer.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Bounded columns (≤ 64) and exclusion count (≤ 128) per frame.

## Rejected shortcuts

- Faking exclusions with negative insets.
- Treating warped text as composable story frames.
