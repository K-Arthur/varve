# ADR-0037: Git merge-driver interface

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0034, ADR-0035, ADR-0036

## Context

Git must be able to merge `.varve` files semantically and headlessly. The
standard custom merge-driver contract is: `driver <base> <current> <incoming>
<repository-path>` with the driver expected to write the merged result to
`<current>`.

## Alternatives

1. Let Git do a text merge of JSON — line conflicts, corrupted semantics;
   rejected.
2. Custom `merge=varve` driver running the semantic three-way engine
   (chosen).

## Decision

`varve merge-driver <base> <current> <incoming> <repo>`:

1. Reads and validates all three files (migrating compatible schemas in
   memory only).
2. Confirms a valid merge base (unrelated document ids or no common base →
   documented error exit).
3. Runs the deterministic three-way merge (ADR-0034).
4. On success: writes the **canonical merged document** to `<current>`
   atomically (temp+rename), exits `0`.
5. On conflicts: writes the valid merged document + sidecar conflict manifest
   (ADR-0035) to `<current>`, exits the documented nonzero code (Git treats
   the file as conflicted; no side is lost).
6. Never stages, commits, pushes, resets, or cleans; never opens Varve; never
   touches unrelated files; diagnostics on stderr in a structured format.

Handles: missing base, empty files, unsupported schema, invalid hashes,
legacy documents, symlinks, read-only targets, interrupted runs (temp-file
cleanup + recovery), worktrees/submodules/sparse checkouts via Git-provided
paths, detached HEAD, in-progress merges, case-insensitive filesystems, and
LFS pointers (reported honestly as pointers, not decoded).

## Consequences

- **Migration impact:** install requires explicit user action
  (`.gitattributes` + `merge.varve.driver` config).
- **Backward compatibility:** no driver = text merge fallback.
- **Cross-platform:** pure process; bounded memory; signal-safe.
- **Performance:** merge cost bounded by document size; benchmarked.
- **Security:** never executes content or repo config; path validation;
  atomic writes with safe permissions.
- **Accessibility:** none.
- **Rejected shortcuts:** a wrapper that opens Varve; shelling out with
  document-derived arguments; last-writer-wins output; partial writes.
