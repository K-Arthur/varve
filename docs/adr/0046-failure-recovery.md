# ADR-0046: Failure recovery

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0020, ADR-0021

## Context

Crashes can interrupt log appends, snapshot writes, and ref updates. The
existing recovery story is whole-document recovery points + autosave +
backups; the history system needs tail recovery over its own writes.

## Alternatives

1. Recover by falling back to the last autosaved document — loses recent
   committed operations; rejected.
2. Write-ahead staging + last-known-good revision recovery (chosen):
   transactionally staged operations, checksummed segments, atomic refs.

## Decision

- **Append protocol:** operations append to a checksummed segment; the
  revision record and ref update are written in one transactional step
  (ADR-0020). A crash can leave an unreferenced tail segment or an
  uncommitted revision — never a branch pointed at an incomplete revision.
- **Startup recovery:** detect tail corruption (checksum failure, truncated
  segment, revision with missing parent or hash mismatch); truncate to the
  last valid segment; walk back to the last committed revision; report
  exactly what was preserved and what was discarded; reconcile against the
  last-known-good revision (the newest revision whose canonical hash matches
  replay).
- **Recovery refs:** autosave/recovery points remain as whole-document
  fallbacks; recovery never fabricates a revision that did not commit.
- **Repair tooling:** `varve repair <path>` validates structure, truncates
  tails, rebuilds indexes, and always writes a backup before changing
  anything, reporting exactly what changed.
- **Fault injection:** tests inject failures at every stage (append,
  revision record, snapshot write, ref update, migration, merge output,
  conflict manifest, review bundle, Git driver) and assert recovery never
  points a branch at an incomplete revision.

## Consequences

- **Migration impact:** existing recovery points migrate as recovery refs.
- **Backward compatibility:** recovery is additive.
- **Cross-platform/Performance:** checksum cost amortized per segment;
  bounded recovery (latest segments only, full scan only on integrity check).
- **Security:** repair is backup-first and read-only by default; no silent
  data deletion.
- **Accessibility:** recovery dialogs announce what was recovered.
- **Rejected shortcuts:** accepting tail corruption silently; recovering from
  the autosave only; deleting data without a backup.
