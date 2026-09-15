# ADR-0201: Multimodal proposal pipeline

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The AI package owns trace/assist; it must never own layout authority. The
task requires a deterministic-extract → typed-proposal → validate → preview →
apply pipeline. `@varve/ai` has no layout pipeline today.

## Decision

D1 — Pipeline stages: (A) input inventory (PDF/scan/photo/selected pages) →
(B) deterministic extraction (PDF boxes, vectors, text blocks, fonts,
repeated structures) → (C) bounded visual analysis (model proposes page
bounds, spreads, margins, columns, masters, frames, threads, sections) →
(D) typed `MultiPageLayoutProposal` (schemaVersion, requestId, sourceHash,
entities with coordinate space/unit/confidence/provenance, assumptions,
warnings) → (E) deterministic validation (reject invalid dims, duplicate
ids, missing refs, cyclic threads/masters, negative geometry, stale source
hash, excessive counts) → (F) preview with per-group accept → (G) application
via typed document operations in explicit transactions.

D2 — Models can never mutate the document: no direct writes, no native
commands, no file access; application re-validates the accepted slice against
the current document revision before applying; stale/cancelled results are
rejected.

D3 — The deterministic system is fully functional without the pipeline;
proposals are suggestions only.

D4 — Privacy/consent: before any remote upload, disclose what content (text
included?) and which pages are sent; offer local-only, selected-page,
cropped, text-redacted analysis, per-request consent, cancellation; all
document text is untrusted model input (prompt-injection containment: parsed
as data, never as instructions).

## Alternatives

- AI as layout engine — rejected (spec §2.12).
- Direct mutation from model output — rejected: no undo/validation/consent.

## Consequences

- `@varve/ai` owns proposal generation only; identity, composition, print
  geometry, and mutation application stay in scene/engine/editor (ADR-0185-0150).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Covered by D2/D4 plus bounds on request size (≤ 5 MB) and entity counts.

## Rejected shortcuts

- Accepting model page IDs into the document namespace.
- Applying proposals without revision re-validation.
