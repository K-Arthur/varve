# Redaction rules and tests

Reference implementation: `packages/crash/src/redact.ts`,
`packages/crash/src/schema.ts`; fixtures: `redactFixtures.ts`; tests:
`redact.test.ts`, `ingestion.test.ts`.

## Principles

1. **Structured allowlists, not blacklists.** A report is rebuilt
   field-by-field from a fixed schema (`CRASH_REPORT_SCHEMA_VERSION = 1`).
   Unknown fields are rejected at the boundary (`validateCrashReport`) and
   never pass through `sanitizeCrashReport`.
2. **Redaction runs before storage.** Queued reports are already scrubbed,
   so review and local retention never hold unredacted data.
3. **Client-side redaction is not the only control.** The ingestion boundary
   re-validates the payload and rejects anything that differs from its own
   canonical sanitized form (see `ingestion.md`).
4. **Redaction is best-effort normalization.** Reports are minimized and
   automatically scrubbed, but technical information can still sometimes be
   identifying. The UI says so; the docs say so.

## Rules (applied in order)

| # | Rule | Example in → out |
|---|---|---|
| 1 | Home directories | `/home/alice/x.strata` → `~` |
| 2 | Windows user directories | `C:\Users\Bob\...` → `C:\Users\<user>\...` |
| 3 | Temp directories (Windows, macOS, POSIX) | `/var/folders/.../T/...`, `/tmp/x` → `<tmp>` |
| 4 | Network shares | `\\nas01\share\...` → `<share>` |
| 5 | URLs: userinfo, query, fragment stripped; scheme+host kept | `https://host/path?id=1` → `https://host/<redacted>` |
| 6 | Emails | `alice@example.com` → `<email>` |
| 7 | IPv4/IPv6 addresses (incl. IP hosts inside URLs) | `192.168.1.50` → `<ip>` |
| 8 | Bearer tokens | `Bearer eyJ…` → `Bearer <redacted>` |
| 9 | key=value secrets | `api_key=sk-…` → `api_key=<redacted>` |
| 10 | AWS access key ids and secret keys | `AKIA…` → `<aws-key>`; 40-char base64 → `<aws-secret>` |
| 11 | Long base64 runs (JWTs, refresh tokens) | `…48+ chars…` → `<token>` |
| 12 | UUIDs (document/file/object ids) | `92817d31-…` → `<id>` |
| 13 | Absolute paths → keep basename only when it is a code file | `/home/a/dev/…/CanvasArea.tsx:1031:5` → `…/CanvasArea.tsx:1031:5`; `…/logo-final.strata` → `<path>` |

Rule 13 deliberately collapses design-document filenames (they are
document names) while retaining code-file basenames for triage.

## Bounds

| Bound | Value |
|---|---|
| Stack frames | 32 |
| Breadcrumbs | 32 |
| Crumb event length | 120 chars |
| Crash message | 500 chars |
| Raw stack (technical view) | 8000 chars |
| User comment | 2000 chars |
| User contact | 200 chars |
| Attachment name | 120 chars |
| Report serialized | 256 KB |
| Attachment content | 5 MB each |
| Queue count / bytes | 10 reports / 25 MB |
| Local retention | 30 days |

## Typed breadcrumb gate

Crumb events must match `^[a-z0-9]+(\.[a-z0-9]+){1,5}$` AND start with a
known namespace (`document.`, `renderer.`, `worker.`, `export.`,
`import.`, `autosave.`, `backup.`, `webgpu.`, `webgl.`, `canvas.`,
`workspace.`, `command.`, `model.`, `font.`, `print.`, `persistence.`,
`startup.`, `recovery.`, `safe.`, `consent.`, `crash.`, `hydration.`,
`window.`, `collab.`). Anything else is dropped structurally — user content
cannot enter a breadcrumb by pattern. New namespaces require a privacy
review and a test.

## Attack-resistance

- Prototype-polluted payloads (`__proto__`, `constructor.prototype`) are
  rejected or stripped; output is rebuilt with fresh objects.
- Adversarial payloads are rejected outright when the top-level prototype
  is not plain.
- `redactText` is applied to every free-text field, then truncated.
- Fixtures (`redactFixtures.ts`) contain realistic secrets: home and
  Windows paths, temp paths, network shares, URLs with tokens and doc ids,
  emails, IPv4/IPv6, bearer JWTs, API keys, AWS credentials, long tokens,
  UUIDs, unicode paths, SQL with values, and a stack trace mixing all of
  them. `redact.test.ts` asserts none of them — nor the fixture username or
  document name — survive in any serialized output, including the upload
  payload.
- The "boundary" test stuffs every fixture value into a report and proves
  it cannot cross the consent/upload boundary.

## Consistency across layers

The same rules run in TypeScript (browser + workers), and the ingestion
validator (`validateReportForIngestion`) mirrors them server-side. Rust
panic records are sanitized natively too (`sanitize_panic_payload` in
`apps/desktop/src-tauri/src/crash.rs`) before the webview ever sees them.

## Adding a new field

Every new report field requires (Phase 20 rule):

1. A privacy classification in `FIELD_CLASSIFICATION` (required-minimized /
   optional / attachment / local-only).
2. An entry in `ALLOWED_*` sets so it survives the allowlist.
3. Redaction handling if free-text, plus a fixture and a redaction test.
4. A documented reason in this file and in `docs/privacy/crash-audit.md`.
