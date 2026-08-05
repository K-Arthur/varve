# ADR-0115: Generated-code ownership

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Teams generate CSS variables, SCSS maps, TypeScript constants, Android
resources, Swift, and Dart theme objects from token sources. Generated files
are derived artifacts; silently overwriting user-maintained code files is
destructive.

## Decisions

### D1 — Derived artifacts with explicit profiles

Output profiles (Web CSS/SCSS/TS/JS/JSON, Android XML/Kotlin, Apple Swift,
Flutter Dart) each specify: naming transform, type transform, unit transform
(color-space policy, rem/em context), theme permutation, alias preservation
vs resolution, generated-file ownership marker, header, formatting, and
collision policy.

### D2 — Safe writes only

No overwriting of user-maintained files without: a generated ownership
marker (header comment), preview, explicit consent, a conflict check
(file changed since preview), and a safe write (ADR-0112 pipeline).
Generated directories or clearly delimited generated files are preferred.

### D3 — No arbitrary code execution

Generation runs typed, allowlisted transforms. Repository JavaScript,
`package.json` scripts, custom Style Dictionary transforms, and untrusted
node modules are never executed; running an external custom build requires a
separate security design and explicit consent.

### D4 — Style Dictionary is an interop target, not a requirement

Varve can generate Style Dictionary-compatible configuration where
appropriate, preview transformed names/values, detect naming collisions,
show transforms, and export files — without executing Style Dictionary code.

## Alternatives

- In-place mutation of user files — rejected: destructive.
- Treating generated CSS variables as the source of truth — rejected: they
  are outputs, and the token source is canonical.
- Executing the repository's build scripts — rejected: arbitrary code
  execution (security).

## Consequences

- `@varve/codegen` grows a token-output module with a pure generation core
  (node-testable) and a preview UI in the editor.
- Collision detection reports identical transformed names before writing.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

All transforms are pure functions over validated token values; no shell,
no eval, no remote fetch at generation time.

## Rejected shortcuts

- Generating output without a preview.
- Overwriting files without ownership markers.
- Running untrusted transforms "because it's a local repo".
