# Ingestion contract and security controls

Status: contract defined, reference validator implemented
(`packages/crash/src/ingestion.ts`), **no endpoint is deployed**. The
default uploader is a no-op; no build configures an ingestion URL. This
document is the spec a self-hosted endpoint (or provider) must satisfy
before uploads are enabled.

## Client contract

- Transport: HTTPS only. Endpoints are validated to `https://` in
  production configuration; nothing else is accepted.
- Method: `POST`, one JSON document per request.
- Headers: `content-type: application/json`, `x-varve-report-id` (opaque
  report id), `x-varve-schema-version` (`1`).
- Payload: the canonical transmitted form produced by `toUploadPayload`
  (local-only bookkeeping removed, attachment content stripped, only
  explicitly included attachments present).
- No authentication secrets are embedded in clients. Public ingestion is
  rate-limited and abuse-protected server-side; replay protection uses the
  report id (idempotent inserts).
- Retries: bounded exponential backoff (30s base, ×2, 1h cap, 5 attempts),
  with jitter; no retry after consent revocation; no upload on metered
  connections when the user disabled that; nothing ever retries forever.

## Reference validator (`validateReportForIngestion`)

Rejects with the stated status:

| Check | Status | Notes |
|---|---|---|
| Empty body | 400 | |
| Payload > `maxReportBytes + 4096` | 413 | before parsing |
| Malformed JSON / non-object | 400 | |
| Schema validation (unknown fields, missing required, bounds) | 422 | allowlist-based |
| Attachment content present | 422 | content never arrives |
| Unincluded attachments | 422 | everything transmitted must be explicitly included |
| Payload ≠ its own canonical sanitized form | 422 | redaction-verification: proves scrubbing ran before transmission |

## Server-side requirements (for whoever deploys ingestion)

1. **TLS-only**, HSTS; no HTTP endpoint.
2. **Request-size limits** before parsing (above) and **compression limits**
   / decompression-bomb protection if compression is added.
3. **Authentication**: public ingestion is anonymous; require an
   environment-scoped ingestion token only if the deployment can support
   it without embedding secrets in clients. Otherwise rely on:
4. **Rate limiting** per IP and per report-id, **abuse protection**
   (payload fingerprinting, spike suppression), **replay protection** via
   idempotent report-id inserts.
5. **Tenant/environment separation**: separate ingestion projects for
   dev/nightly/beta/production (`buildChannel` + `releaseId` are immutable
   per release; never co-mingled).
6. **Server-side redaction** as a second line of defense: run
   `sanitizeCrashReport` again at ingest time and store the re-sanitized
   form.
7. **Do not return internal stack traces or ingestion details to the
   client.** Responses are `2xx`/`4xx`/`5xx` with no diagnostic bodies.
8. **No arbitrary file upload** through the crash endpoint. Support bundles
   are separate, deliberately selected, and handled by a distinct
   capability with its own size/scan policy.
9. **Least privilege**: ingestion writes to a quarantined bucket only;
   triage access is read-only and audited.
10. **Audit logs** for administrative access; **retention enforcement**
    server-side (30-day default, see `retention.md`); **deletion
    workflows**; **data-export controls**; documented **incident-response
    procedures** and **provider outage handling** (client already queues
    and retries offline).
11. **Dependency and SDK review** before any third-party ingestion stack is
    adopted; **data-residency review** where required.
12. **Symbols/source maps** are never served from the public web server;
    they are uploaded during trusted CI only (see `docs/privacy/runbooks.md`
    — symbol runbook).

## Why no endpoint today

Budget plan Scenario A (`docs/release/budget-plan.md`): crash reporting
costs $0 until it ships — the consent UX and local capture exist first.
The abstraction (`CrashUploader`) allows replacing the no-op with a
self-hosted ingestion service without touching application code.
