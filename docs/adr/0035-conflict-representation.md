# ADR-0035: Unresolved conflict representation

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0034, ADR-0037

## Context

When a merge leaves unresolved conflicts, Git needs a recoverable file
representation. Writing ordinary Git conflict markers into document JSON makes
it unparsable; the plan requires a valid, restart-survivable representation.

## Alternatives

1. Conflict markers inside document JSON — unparsable; rejected.
2. Valid Varve document with typed conflict placeholders — renderers must
   detect placeholders everywhere; risky.
3. **A valid merged document + a sidecar conflict manifest** (chosen): the
   target file remains a fully valid document reflecting the safe
   auto-merged state; the unresolved values live in a deterministic manifest
   beside it.
4. Deterministic temporary merge package — adds pack/unpack machinery.

## Decision

The merge driver (ADR-0037) writes: (a) the **merged target file** — a valid
document containing the auto-merged state with unresolved entities left at
their **ours** state (the local branch's values), so the file always parses
and renders; and (b) a **conflict manifest** (`<name>.varve-conflicts.json`)
containing the full `DesignMergeConflict[]` with base/ours/theirs values,
revision ids, candidates, and statuses. Varve detects the manifest on open
(and on open of a file whose driver-exit code was nonzero via `git status`)
and offers the conflict-resolver workflow; the manifest is inert data — it
can never execute, and paths are validated before use. The driver returns the
documented nonzero exit code when conflicts remain, so Git records the merge
as conflicted while every side's data is preserved. Re-running the merge is
deterministic (manifest regenerated identically).

## Consequences

- **Migration impact:** none; manifests are transient merge artifacts.
- **Backward compatibility:** the target file is always a valid `.varve`.
- **Cross-platform/Performance:** manifest is JSON text, bounded by conflict
  count limits.
- **Security:** manifests validated on read; no code paths executed from
  manifest content; safe path handling.
- **Accessibility:** the resolver UI (not the manifest) is the user surface.
- **Rejected shortcuts:** inline `<<<<<<<` markers in document JSON;
  deleting either side's data; blocking Git completion without a resolvable
  artifact.
