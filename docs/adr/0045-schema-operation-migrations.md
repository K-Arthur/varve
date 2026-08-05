# ADR-0045: Schema and operation migrations

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0017, ADR-0018

## Context

The document schema migrates linearly (`version.ts:45-759`, currently 2.15).
Persisted operation payloads must migrate too, or replay across schema
versions breaks.

## Alternatives

1. Store operations raw forever; reject documents whose operations predate a
   schema — history loss on upgrade; rejected.
2. Versioned operation registry with per-op migration functions (chosen):
   each `OperationDefinition` carries `schemaVersion`, `validate`,
   `migrate(payload, fromVersion)`, `apply`, `summarize`, `affectedEntities`,
   and optional `invert`/`preconditions`.

## Decision

The operation registry is versioned as part of the document schema: an
operation record stores the schema version under which it was created;
replay and diff migrate payloads in memory before apply. A document schema
bump that changes entity shapes must also register operation migrations
(replay is only as correct as the migrated payloads). Migration steps are
pure, idempotent, and tested with fixtures spanning both formats. The
migration revision origin (`migration`) exists in the revision model
(ADR-0022) for documents converted into history.

## Consequences

- **Migration impact:** every future schema version includes op migrations
  where payload shapes change.
- **Backward compatibility:** old operations replay after migration; downgrade
  refuses unsupported writes (read-only or exported compatible copy only).
- **Cross-platform/Performance:** migration is a one-time per-op cost during
  replay.
- **Security:** payload validation runs before AND after migration.
- **Accessibility:** none.
- **Rejected shortcuts:** versionless payloads; replaying unmigrated payloads;
  silently dropping operations from older schemas.
