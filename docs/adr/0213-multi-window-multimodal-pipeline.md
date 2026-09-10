# ADR-0213: Multimodal workspace proposal pipeline

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Users may want to construct multi-monitor workspaces from screenshots,
photographs, diagrams, or natural-language instructions. The AI pipeline
must help propose layouts without directly mutating windows.

## Decision

D1 — Pipeline stages:

| Stage | Description |
|-------|-------------|
| A: Environment inventory | Deterministic collection of monitors, panels, constraints via platform APIs |
| B: Input classification | Classify as screenshot/photo/diagram/PDF/NL/structured |
| C: Layout analysis | Model proposes panel regions, monitor placement, grouping |
| D: Typed proposal | Schema-validated `WorkspaceLayoutPlan` with confidence |
| E: Deterministic validation | Display exists, session current, constraints hold |
| F: Preview | Current vs. proposed diagram; accept/edit/cancel |
| G: Transactional apply | Through the same workspace transaction engine |
| H: Cancellation | Abort signals, request IDs, latest-request-wins |

D2 — The model must not directly call native window APIs. It produces
   typed proposals only.

D3 — Deterministic environment inventory runs BEFORE model inference.
   The model receives the inventory as context.

D4 — Preview is mandatory. Users can accept all, accept selected moves,
   edit placements, or cancel.

D5 — Imported layouts and model outputs are validated against the current
   panel registry, singleton constraints, minimum sizes, and window
   count limits.

D6 — Structured workspace JSON takes precedence over vision inference.

## Security implications

- Image text is treated as untrusted.
- Embedded instructions in images are ignored.
- Remote model use requires explicit consent.
- Sensitive information is redacted before upload.
- Models cannot directly mutate native windows.

## Privacy implications

Monitor geometry and machine placement are not shared with remote models
without consent and redaction.

## Rejected shortcuts

- Allowing the model to directly create/move/close windows.
- Trusting model output without deterministic validation.
- Uploading monitor geometry without consent.
