# ADR-0028: Git working representation

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0027, ADR-0029, ADR-0036, ADR-0037

## Context

There is zero Git integration today (no repo detection, no git commands, in
Rust or TS). The Git-facing representation of a Varve design determines diff
quality, merge driver behavior, and repository ergonomics.

## Alternatives

1. **Single canonical text file** (`.varve`): zero migration, existing atomic
   save path (`lib.rs:233-261`), whole-file conflicts, inline payload bloat
   in raw diffs.
2. Deterministic directory package (`design.varve-project/`): content-
   addressed assets, focused diffs, but new save/load machinery, rename/copy
   semantics, packaging burden.
3. Dual representation (portable `.varve` + unpacked working tree): two
   editable sources of truth — forbidden.
4. Manifest + external content-addressed assets: best granularity, highest
   machinery cost.

## Decision

**v1: single canonical text file** — the `.varve` file itself is the Git
working representation. Raw-file diffs are normalized (canonical form)
before comparison via the text conversion driver (ADR-0036): the diff text
excludes binary payloads (assets appear as `asset-<hash>` references) and
volatile metadata, groups entities readably, and retains persistent ids with
names. A whole-file conflict falls back to the semantic merge driver
(ADR-0037), which is the primary merge path. The directory-package and
manifest forms (options 2/4) are documented future extensions; any future
conversion must be deterministic and one-directional (portable package built
from the canonical file, never an independently editable second source).

## Consequences

- **Migration impact:** none — existing files are already the representation.
- **Backward compatibility:** unchanged file format; `.strata` legacy still
  accepted.
- **Cross-platform:** text file is platform-neutral; CRLF configured via
  `.gitattributes` documentation; Unicode/space-containing paths handled by
  the drivers.
- **Performance:** textconv computes canonical bytes per diff — bounded by
  document size; payload exclusion keeps diff text small.
- **Security:** repository setup is opt-in; drivers never stage/commit/push/
  clean; untrusted repo config is not executed.
- **Accessibility:** none.
- **Rejected shortcuts:** a custom binary blob format; two simultaneously
  editable representations; sorting JSON recursively for diff output.
