# ADR-0036: Git diff-driver interface

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0028

## Context

Raw Git diffs of `.varve` files show insertion-order noise, base64 payloads,
and whole-file conflicts. The plan requires an opt-in, headless, deterministic
text conversion.

## Alternatives

1. No driver; users diff raw JSON — noise, payload bloat; rejected.
2. `.gitattributes` `diff=varve` + `textconv` driver (chosen): Git asks the
   driver for a display/conversion text per blob; no GUI, no network.

## Decision

Install a `varve diff --git-textconv <path>` command and document the
`.gitattributes` line `*.varve diff=varve` plus
`git config diff.varve.textconv "varve diff --git-textconv"` (installed only
by explicit user action). The driver emits the **canonical text**
(ADR-0027): stable schema ordering, no volatile metadata, no embedded binary
payloads (assets shown as `asset-<hash>` references), persistent ids with
names alongside for readability, human-readable entity grouping, and asset
summaries keyed by hash. Output is deterministic, bounded, and
platform-stable; exit codes: 0 success, 1 invalid input, 2 usage error.
The driver never modifies files, never stages/commits, never touches the
network, and never opens Varve. A merge driver (ADR-0037) complements it for
actual merging; textconv is display-only.

## Consequences

- **Migration impact:** none; opt-in config.
- **Backward compatibility:** no driver = normal JSON diff.
- **Cross-platform:** path-safe (spaces/Unicode), CRLF documented in the
  install docs; works in worktrees; LFS pointers pass through honestly as
  pointer text.
- **Performance:** canonicalization bounded by document size; cached by Git.
- **Security:** no shell assembly from document content; untrusted paths
  validated; bounded input sizes.
- **Accessibility:** textual diff is inherently accessible.
- **Rejected shortcuts:** a driver that opens the GUI; embedding payloads in
  diff text; recursive key sorting as "canonicalization".
