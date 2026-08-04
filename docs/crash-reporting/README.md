# Crash reporting and recovery — overview

Privacy-first crash reporting and crash recovery for Varve.

| Document | Contents |
|---|---|
| `docs/privacy/crash-audit.md` | Existing-system audit, failure-source map, data inventory, prohibited-data list |
| `docs/privacy/consent-state.md` | Versioned consent state machine specification |
| `docs/privacy/redaction.md` | Redaction rules and allowlists (planned) |
| `docs/privacy/ingestion.md` | Backend ingestion contract and security controls (planned) |
| `docs/privacy/retention.md` | Retention and deletion specification (planned) |
| `docs/privacy/runbooks.md` | Triage, symbol, and privacy-incident runbooks (planned) |

## Principles

1. Crash reporting is disabled by default; unknown consent fails closed.
2. No crash report or diagnostic event leaves the device before explicit
   consent. Redaction runs before local storage.
3. Crash reporting is separate from analytics, performance telemetry, and
   update checks.
4. Users can send one report without enabling automatic reporting, review
   what is sent, remove optional attachments, revoke consent, and delete
   queued reports.
5. Recovery and local diagnostics work when reporting is disabled.
6. The reporter never blocks startup, never blocks UI, and has strict
   memory/disk budgets.

## Implementation map

| Layer | Location |
|---|---|
| Core (consent, schema, redaction, queue, uploader, service, safe mode) | `packages/crash/src/` |
| UI (recovery dialog, review dialog, settings, safe mode screen) | `packages/editor/src/crash/` |
| Native panic hook + report filesystem | `apps/desktop/src-tauri/src/crash.rs` |
| Tests | colocated `*.test.ts` in `packages/crash`; component tests in `packages/editor/src/crash/` |
