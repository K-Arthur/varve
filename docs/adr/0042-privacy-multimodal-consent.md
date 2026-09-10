# ADR-0042: Privacy and remote multimodal consent

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0034 (merge), ADR-0038 (review)

## Context

Optional multimodal assistance (summaries, conflict suggestions, risk
classification) may send rendered crops and text to a remote model. Artwork
text, imported PDFs, comments, and screenshots are untrusted prompt content.
Deterministic analysis must always run first and the feature must work fully
without AI.

## Alternatives

1. No multimodal at all — loses the explainability tier.
2. Unconditional remote analysis — violates consent and privacy principles.
3. Consent-gated, bounded, deterministic-first pipeline (chosen).

## Decision

- **Stage A** deterministic evidence collection (ids, hashes, semantic
  changes, conflicts, bounds, font/asset availability) — always runs,
  no model involved.
- **Stage B** bounded rendering: only required crops/regions, deterministic
  settings, never the full document where a crop suffices.
- **Stage C** optional model analysis over that bounded evidence.
- **Stage D** typed, schema-validated `DesignReviewProposal` referencing only
  ids from the deterministic inventory (stale/unknown references rejected).
- **Stage E** deterministic validation: stale revisions, invalid
  environment hash, violated invariants, unapproved actions → reject.
- **Stage F** preview + explicit user approval; resolutions apply through the
  normal merge transaction engine.
- **Stage G** cancellation: abort signals, request ids, latest-request-wins;
  a cancelled analysis can never resolve a conflict later.

Consent: per-request consent before any remote upload; disclosure of exactly
what is sent (screenshots, crops, artwork text, names, comments, summaries);
redaction options; crop selection; "do not include text content"; persistent
setting with revocation; local-model option where available. Artwork content
is treated as untrusted prompt content everywhere.

## Consequences

- **Migration impact:** none; the pipeline is additive and optional.
- **Backward compatibility:** deterministic features unaffected.
- **Cross-platform/Performance:** bounded payloads; concurrent-request
  limits.
- **Security:** no model can create ids, change heads, apply operations,
  run Git, or read unrelated files.
- **Accessibility:** assumptions/confidence presented in text.
- **Rejected shortcuts:** auto-approving suggestions; uploading full
  documents without consent; letting model output drive identity or Git
  actions.
