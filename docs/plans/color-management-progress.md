# Color-Management Program — Progress

Status log for the color-management program (document profile semantics, managed
text color, Lab/LCH picker, soft proofing, spot-color authoring).

## Completed milestones

| # | Milestone | Status | Commit | Notes |
|---|---|---|---|---|
| 0 | Repository color-architecture audit + implementation map | Done | `0778a8d7` | `docs/plans/color-management-implementation-map.md` |
| 1 | Canonical managed-color model | Done | `b094ee1a` | Lab/LCH/registration/unresolved variants, spotId/library refs, profileFingerprint, `colorValidation.ts` invariants, Lab/LCH (D50) conversions in shared, `EngineColor = ManagedColorShim` |
| 2 | Per-run text color migration | Done | `bf80aa0b` | `CharacterFormat.color`/`columnRuleColor` → ManagedColor; schema 2.13→2.14; `colorMigration.ts` (outside version.ts hub); fixed latent textLayout bug that dropped run color before rendering |
| 3 | Explicit assign/convert mode operations | Done | `939280a2` | `assignDocumentColorMode` (intent-only) vs `convertDocumentColors` (rewrites + report); `switchColorMode` deprecated alias; DocumentPanel assigns with note; dialog has distinct Assign/Convert actions |
| 4 | Shared conversion service consolidation | Done | `4ff26031` | Duplicated RGB<->CMYK formulas removed from colorMode; precision/determinism conventions (equality tolerance, serialization precision, display-only rounding) |

## In progress

- M5 Lab/LCH picker modes (`@strata/ui` ColorPicker).

## Affected packages

`@strata/scene`, `@strata/shared`, `@strata/engine`, `@strata/ui`, `@strata/editor` (M1).

## Schema versions

| Format | Version | Notes |
|---|---|---|
| Document | 2.12 | current; M2 will bump to 2.13 (text color migration) |

## Tests run

- `@strata/shared` 730 passed (incl. new `colorLabLch.test.ts`).
- `@strata/scene` 1837 passed (incl. new `colorValidation.test.ts`).
- `@strata/engine` 3096 passed (1 pre-existing bg-removal WASM env failure).
- `@strata/ui` 385 passed.
- Typecheck 15/15 packages (2 pre-existing editor errors in concurrent logo-panel work).
- Lint: 0 new errors (9 pre-existing on master too).

## Performance results

(pending)

## Known limitations / deferred

- Monitor-profile-accurate soft proofing unavailable in browser canvases —
  documented approximation only.
- PDF spot (Separation/DeviceN) export deferred until `strata-print` supports it.
- Registration color rendering on canvas approximated as black (all plates).
- Note: repository is shared with concurrent user work (logo panel/vectorize);
  commits are path-scoped to avoid sweeping unrelated staged changes.
