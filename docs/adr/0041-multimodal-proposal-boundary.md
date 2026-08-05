# ADR-0041: Multimodal proposal boundary

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The program includes an optional multimodal pipeline (screenshots, desk
photographs, PDFs, natural-language instructions → typed workspace
proposals). Models must never directly create, move, close, or mutate
native windows. Deterministic environment data must take precedence over
vision inference. `@varve/ai` already owns auto-trace/assist
orchestration.

## Alternatives

1. Let the model emit imperative window commands (rejected — prompt
   injection and irreversibility risk).
2. Model emits a typed, validated **plan**; the normal workspace engine
   applies it after preview and user approval (chosen).

## Decision

- Pipeline (M14, after command-driven transfers are stable):
  - **Stage A — deterministic inventory:** monitors/work areas/scales,
    current windows, panel instances + capabilities + singleton
    constraints, workspace mode, document context, memory profile —
    collected via platform APIs (ADR-0022) and the registry (ADR-0019).
    A model never infers what APIs already provide.
  - **Stage B — input classification:** Varve layout JSON | screenshot |
    photo | diagram | PDF | natural language | mixed. PDFs use structured
    text/vector extraction before visual interpretation; OCR only when
    unavoidable.
  - **Stage C — layout analysis:** the model proposes regions/groupings/
    orientations/ratios/confidence **using inventory-supplied ids only**.
  - **Stage D — typed proposal:** schema-validated
    `WorkspaceLayoutPlan` (`schemaVersion`, `requestId`,
    `sessionRevision`, `environmentFingerprint`, `proposedWindows`,
    `proposedPanelMoves`, `proposedDockOperations`, `assumptions`,
    `warnings`, `confidence`). No window IDs invented by the model.
  - **Stage E — deterministic validation:** displays exist, revision
    current, instances exist, singletons hold, detachability, min sizes
    fit, no window fully off-screen, window-count limit, dock validity,
    memory estimate.
  - **Stage F — preview:** current vs proposed monitor diagram, moves,
    window creation count, size changes, unsupported requests, memory,
    confidence, assumptions; accept-all / accept-selected / edit /
    exclude / cancel.
  - **Stage G — transactional apply:** accepted selections execute
    through the normal transfer state machine (ADR-0029) — **no AI
    mutation path exists**.
  - **Stage H — cancellation/staleness:** AbortSignal + requestId +
    sessionRevision + environmentFingerprint; latest-request-wins; stale
    results are rejected and can never move windows later.
- Natural-language commands ("Layers and Assets on my left monitor")
  convert to the same typed proposal; ambiguity is surfaced explicitly
  (two left monitors, "second monitor" meaning, which Inspector tab,
  missing/non-detachable panels, too-small monitors, already-hosted
  singletons) — never silently substituting a panel.
- **Security/privacy:** text visible in images/PDFs is untrusted; embedded
  instructions to run commands/open URLs/disable validation/close the app
  are ignored (the schema has no such operations). Remote model use
  requires explicit consent before uploading screenshots/photos/PDFs/
  window titles/document names; sensitive content is redacted where
  possible. A manual, non-AI workspace editor always exists (M10).

## Consequences

- AI can propose; only typed, validated, user-approved plans touch
  windows.
- The feature works fully without AI (all stages degrade to manual).

## Migration impact

None; additive in `@varve/ai` with the plan schema owned by the workspace
module.

## Cross-platform implications

Inventory APIs are the platform service's; identical pipeline on all OSes.

## Security implications

Model output is treated as untrusted input like any other message;
allowlisted operation schema; consent-gated uploads; no new IPC surface
for models.

## Accessibility implications

Preview must be keyboard-operable; the monitor diagram has an accessible
alternative (table/list of proposed moves).

## Performance implications

Inventory is cheap; analysis runs in the AI service with request
coalescing; stale-result rejection prevents wasted window work.

## Rejected shortcuts

Model-called window APIs; auto-apply without preview; trusting image
text as instructions; OCR-first pipelines; letting AI bypass validation.
