# Retention and deletion specification

## Local retention (client)

| Artifact | Retention | Enforced by |
|---|---|---|
| Queued crash reports (IDB `varve-crash-reports` or native `crash-reports/` dir) | 30 days from `createdAt` | `CrashReportQueue.sweepExpired` (runs on enqueue/list) |
| Native emergency records (`emergency-*.json`) | consumed on next boot; otherwise 30 days via queue expiry after import | `CrashCenterController.importEmergencyRecords` |
| Queued report count | ≤ 10 (oldest evicted) | `LIMITS.maxQueuedReports` |
| Queued report bytes | ≤ 25 MB | `LIMITS.maxQueueBytes` |
| Consent record | until user changes it; stored indefinitely (it is a user preference) | consent store |
| Crash-loop markers | 10-minute window, ≤ 3 failures | `crashLoop.ts` |
| Safe-mode state | until user exits safe mode | `safeMode.ts` |
| Reporter metrics (`varve:crash-metrics`) | indefinite, local-only, ≤ 1 KB | `metrics.ts` |

Local deletion paths: per-report delete and "delete all queued reports" in
Privacy & Diagnostics settings; decline-on-dialog deletes that report.
**A successful upload deletes the local copy** (`markUploaded` removes the
report) unless a future deployment documents a justified reason to retain.

Partial-write protection: reports are written atomically (temp + rename on
the native filesystem; single-transaction writes in IndexedDB). Corrupt
entries are isolated and skipped, never blocking startup.

## Ingestion retention (server, when deployed)

- Default retention: **30 days**; adjustable per environment, never
  shorter than the symbol-retention window needed to diagnose a release.
- Enforced by a scheduled purge job with an audit log; backups align with
  retention (no backup outlives the deletion window by more than the
  documented backup cycle).
- Deletion workflows: per-report id, per-fingerprint group, per-release,
  and bulk env purge — all audited, all least-privilege.
- Data-export controls: a support engineer can export a report (or group)
  with a logged reason; exports expire.

## Consent-driven deletion

- **Revocation** stops future uploads immediately and aborts in-flight
  requests. Queued reports remain visible and deletable; the user may also
  choose to clear the queue. Revocation never deletes recovery documents or
  autosaves.
- **Denial** (standing "Never send") leaves the local queue untouched —
  reports expire naturally — but nothing is transmitted.
- **"Don't send"** on the crash dialog deletes that report.
- A privacy-policy change that requires renewed consent downgrades
  automatic reporting to ask-each-time; it never deletes data.

## Documentation of user choice

The consent record stores only: state, policy version, decision timestamp,
app version, scope. It is never used for tracking.
