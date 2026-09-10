# ADR-0118: Multimodal proposal boundary

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Style-guide PDFs, screenshots, and documentation can seed token libraries,
but AI must never become the canonical parser, resolver, merge engine, or
sync mechanism. The pipeline must be deterministic-first, typed, previewed,
and cancellable.

## Decisions

### D1 — Deterministic parsing precedes any inference

Stage A classification (DTCG/resolver/Tokens Studio/CSS/SCSS/TS/JSON/XML/
Swift/PDF/image/mixed) runs deterministic classifiers; Stage B extraction
uses real parsers for structured formats and structured PDF extraction
(text + vector + embedded resources) before any vision; OCR only when no
higher-quality source exists.

### D2 — Typed, validated proposals only

Models produce a schema-validated `TokenImportPlan` (schemaVersion,
requestId, documentRevision, sourceFingerprint, proposedGroups/tokens/
aliases/resolver, mappings, warnings). Every proposed token carries
temporaryId, proposedPath/type/value, confidence, provenance, and
assumptions. Proposals are validated by the SAME deterministic DTCG
validator as manual imports and rejected when: unknown executable content,
arbitrary commands, filesystem/network instructions, invalid values,
non-finite numbers, unbounded arrays, duplicate paths, reference cycles,
unsupported resolver structures, or stale document revisions appear.

### D3 — Preview, correction, explicit commit

Stage F shows hierarchy, values, source-region preview, confidence,
duplicates, existing-token matches, naming suggestions, type warnings,
before/after — with accept/edit/ignore/merge controls. Nothing applies
automatically. Accepted proposals commit through normal token commands as
one undo transaction (ADR-0116); AI never mutates scene JSON directly.

### D4 — Cancellation and staleness

Abort signals, request ids, source fingerprints, document revisions, and
latest-request-wins semantics. Cancelled or superseded analyses can never
mutate the document later; workers and models are cleaned up.

### D5 — Image text is untrusted content

Text rendered inside images is data, never instructions; prompt-injection
markers in extracted text cannot trigger actions.

## Alternatives

- Letting AI parse/merge — rejected: non-deterministic and non-auditable.
- Auto-applying proposals — rejected: preview is mandatory.
- Raw model output into the document — rejected: violates typed-proposal
  and atomic-transaction requirements.

## Consequences

- `@varve/ai` gains a proposal protocol (request ids, revisions,
  fingerprints) and typed outputs; the deterministic core stays in
  `@varve/tokens`.
- Consent disclosure precedes any remote upload (ADR-0043 privacy gate).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Uploads require explicit disclosure; proposals are validated before any
mutation; image/PDF payloads are size-bounded (decompression-bomb limits);
no credentials or repo paths are sent to models.

## Rejected shortcuts

- AI-generated automatic conflict resolution (ADR-0108 D2).
- OCR-first extraction.
- Unbounded image/PDF analysis.
