# ADR-0168: Multimodal warp proposal boundary

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The deterministic manual warp tool must work fully offline; any AI
assistance must never mutate the document directly.

## Decision

D1 — Every proposal (model or deterministic) is a typed, schema-validated
`WarpPlan` (`@varve/engine/src/warp/plan.ts`): schemaVersion, requestId,
selectionRevision, sourceNodeIds, a validated modifier, confidence,
warnings, assumptions, derivedFrom. `validateWarpPlan` rejects non-finite
coordinates, unknown kinds, oversized meshes, and structural mismatch
before anything reaches the scene.

D2 — v1 ships **deterministic proposal builders only**: `perspectiveFromQuad`
(reference quadrilateral) and `fitEnvelopeFromPath` (cubic edge fit to an
existing path with a fit-error metric). Image-reference analysis is a
documented extension point behind the same typed boundary; it must follow
ADR-0201's privacy rules (no upload by default, disclosure before any
model call, no image text treated as instructions).

D3 — Preview/commit/cancel lifecycle: preview is a non-destructive overlay;
commit applies through `updateWarp` inside one undo transaction with a
stable modifier id; cancellation and stale-result rejection are
latest-request-wins with abort signals (contract defined; the model
transport is follow-up).

## Alternatives

- Free-form scene patches from model output: rejected — unvalidated
  mutation is a security boundary violation.
