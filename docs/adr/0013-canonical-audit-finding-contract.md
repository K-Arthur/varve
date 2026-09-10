# ADR-0013 — Canonical Audit Finding Contract

**Status:** Accepted
**Date:** 2026-07-27
**Decisions:** `@varve/scene` `AuditFinding` is the canonical type

## Context

Two incompatible `AuditFinding` types coexisted:

1. `@varve/scene` `AuditFinding` (`auditFinding.ts`) — used by the audit engine,
   IntelligencePanel, AuditOverlayHost, finding navigation
2. `@varve/shared` `AuditFinding` (`auditTypes.ts`) — used by the intelligence
   subsystem (scheduler, overlay manager, cache, pipeline, suppression)

Key incompatibilities: `nodeId` vs `nodeIds`, `ruleVersion` as number vs string,
different fix models, different cost types, different lifecycle fields. Code importing
one could not interoperate with the other without a mapping layer.

## Decision

Enhance `@varve/scene`'s `AuditFinding` as the canonical contract. Add the fields
that were unique to the shared version (lifecycle, suppression, region, metadata)
while keeping the existing scene fields. Mark `@varve/shared`'s `AuditFinding` as
`@deprecated` and provide bridge converters:

- `sceneFindingToShared()` — converts scene → shared (for the intelligence subsystem)
- `sharedFindingToSceneShape()` — converts shared → scene shape (returns `Record`)

The scene type can't be imported from `@varve/shared` because that would create a
circular dependency (`scene → shared`, `shared` is lower level). The bridge functions
accept/return plain objects to avoid the import cycle.

## Consequences

- **One canonical type** — new code imports `AuditFinding` from `@varve/scene`
- **Backward compatible** — shared type still exists with deprecation notice
- **Bridge converters** — intelligence subsystem can convert at its boundary
- **Forward-compat** — `metadata?: Record<string, unknown>` on scene type absorbs
  future fields without breaking serialization
- **Testable** — round-trip tests prove `sceneFindingToShared` → `sharedFindingToSceneShape`
  preserves key fields

## Fields in the canonical type

- **Identity:** `ruleId`, `ruleVersion`, `fingerprint`, `findingId`
- **Classification:** `severity`, `category`, `confidence`
- **Affected content:** `nodeId`, `nodeIds`, `pageId`, `region`, `interactionId`, `targetName`
- **Description:** `message`, `detail`, `evidence`, `standardReference`, `documentationUrl`, `recommendation`
- **Fix:** `autoFixAvailable`, `fixes`
- **Applicability:** `source`, `cost`, `contextDependent`, `workspaceApplicable`, `applicableModes`
- **Lifecycle:** `revision`, `generatedAt`, `stale`, `resolved`, `scanId`
- **Suppression:** `suppressionEligible`, `suppressionScope`, `suppression`
- **Forward-compat:** `metadata`
