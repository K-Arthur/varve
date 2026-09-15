# ADR-0023: Branch and checkpoint references

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0022, ADR-0024, ADR-0041

## Context

The existing `Branch` record (`types.ts:425-433`) has a `baseVersionId` and a
status but **no head** — a branch cannot point at its current revision, so
branching is cosmetic metadata today. Checkpoints are flat named versions.

## Alternatives

1. Keep branch-as-metadata; add heads via side tables.
2. Branch refs and checkpoint refs as first-class, atomically updated
   references into the revision DAG (chosen).

## Decision

- **BranchRef:** `branchId`, `documentId`, `name`, `headRevisionId`,
  `createdFromRevisionId`, `createdAt`, `updatedAt`, `status`
  (`active|merged|archived`), optional upstream. The head is the single
  source of truth for what the branch contains; branch creation snapshots a
  revision; switching moves the head; merging advances the head with a
  two-parent revision (ADR-0022).
- **CheckpointRef:** `checkpointId`, `documentId`, `revisionId`, `name`,
  `description?`, `pinned`, `createdAt`. Checkpoints always reference an
  immutable revision; renaming/pinning never changes the target.
- Updating a branch head or creating a checkpoint is atomic with the revision
  record write (ADR-0020). Deleting a branch never deletes revisions reachable
  from another ref; GC reachability is defined from heads + checkpoints +
  pinned revisions + merge bases (ADR-0041).
- Branch-name validation handles empty/whitespace/Unicode/reserved names,
  duplicate normalized names, length limits, path separators, and
  Git-invalid names where the branch maps to Git (ADR-0028).

## Consequences

- **Migration impact:** old `Branch` records migrate to BranchRefs with an
  explicit initial head (from `baseVersionId` or the branch-creation point);
  old versions become checkpoint-able snapshot revisions (ADR-0024).
- **Backward compatibility:** `listBranches`/`createBranch` remain as facades.
- **Cross-platform/Performance:** ref updates are small records; branch
  switching is a head-pointer move plus lazy document materialization.
- **Security:** head updates require the parent revision to exist; name
  validation prevents filesystem/Git injection.
- **Accessibility:** branch and checkpoint states are never color-only.
- **Rejected shortcuts:** branch records without heads; checkpoints that
  capture mutable state instead of immutable revisions.
