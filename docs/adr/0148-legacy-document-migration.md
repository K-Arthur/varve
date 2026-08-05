# ADR-0148: Legacy document migration

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Migrations are versioned in `version.ts` (current 2.16, chain 0.9→2.16);
`migrateToPages` wraps flat docs (document-pages.ts:313-348); the codec
repairs orphan roots/recreated contentRoots (documentCodec.ts:610-652).
Multipage work adds placement (ADR-0124), stories (ADR-0136), spread model
(ADR-0128), master layers (ADR-0134), print geometry (ADR-0141), marks
(ADR-0142).

## Decision

D1 — Versioned migrations v2.17..v2.22 (one per additive change), each pure
and covered by corpus fixtures: placement materialization (deterministic
layout), chain→story promotion with migration report, spread model
defaults, master layers write-through, print geometry defaults, story
recomposition on load.

D2 — Migration rules: preserve page/master/story/frame identities; never
duplicate master content; trust no approximate stored ranges (recompose);
documented layout-change reports for affected stories; a backup snapshot
before destructive file rewrite (existing autosave/recovery can serve).

D3 — Forward compatibility: older readers must not strip new fields —
the codec's pass-through of unknown document fields and `SUPPORTED_VERSIONS`
guard already enforce this; new tests pin older-version reads.

D4 — Shared-root/orphan detection on load (ADR-0126) repairs only with
explicit diagnostics; the migration warning UI lists what changed.

## Alternatives

- One big schema jump — rejected: undo/fork risk and untestable deltas.
- In-place repair without versions — rejected: breaks the migration chain
  contract.

## Consequences

- Baseline corpus: v2.15 and v2.16 fixtures round-trip through v2.22
  migrations with pinned hashes (canonical golden pattern exists:
  `canonicalGolden.test.ts`).

## Migration impact

This ADR *is* the migration policy; each milestone lands its own migration.

## Compatibility impact

Covered by D3.

## Security considerations

Untrusted inputs (imported docs) run the same chain; validation failures
abort before mutation (no partial documents).

## Rejected shortcuts

- Dropping old fields on save.
- Silently reflowing stories without a report.
