# ADR-0029: Portable package representation

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0028

## Context

The brief requires a decision on what users open, distribute, archive, and
attach, and whether it differs from the Git representation.

## Alternatives

1. Separate `.varve` package format (zip/archive with manifest + assets).
2. The canonical `.varve` JSON text file is the portable package (chosen).

## Decision

The single `.varve` text file **is** the portable Varve package for v1: it
already embeds assets content-addressed in one `assets` table with per-fill
references, is validated on load, migrates forward, and equals the Git working
representation (ADR-0028). No archive wrapper in v1. If a directory/archive
distribution form is ever needed (large embedded binaries, external asset
linking), it must be a deterministic pack of the same canonical content with
an explicit unpack (ADR-0028 constraint: one editable source of truth), and
requires its own ADR.

## Consequences

- **Migration impact:** none.
- **Backward compatibility:** identical file semantics to today.
- **Cross-platform:** single file behaves uniformly; attachments/email/drag
  unchanged.
- **Performance:** no pack/unpack cost in v1.
- **Security:** unchanged validation path.
- **Accessibility:** none.
- **Rejected shortcuts:** inventing a zip package now, duplicating the
  payload-stripping logic, or allowing the package and the working file to
  diverge.
