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
| 5 | Lab and LCH picker modes | Done | `d3398da2` | Lab/LCH spaces, signed/decimal spinbuttons, hue wrap, achromatic hue memory, out-of-gamut text notice, canonical LabColor/LchColor emission |
| 6 | Soft proofing | Done | `0454d936` | Document-persisted proof config + session toggle; display-only proof transform (icc/unavailable honesty); worker-side IR proofing; picker proof preview + proof-gamut status; DocumentPanel Soft Proof section; CanvasArea kept at its line ceiling |
| 7 | Spot-color library model | Done | `d59679dd` | SpotLibrary CRUD, stable-id refs, tint model, import conflict resolution, search, stabilizeSpotRef embedding, context commands |

## In progress

- M8 Spot-library authoring frontend (panel + editor + application to fills/strokes/text).
- M9 Import/export preservation (SVG spot warnings, PDF Separation validation).

## Affected packages

`@strata/scene`, `@strata/shared`, `@strata/engine`, `@strata/ui`, `@strata/editor` (M1-M7).

## Schema versions

| Format | Version | Notes |
|---|---|---|
| Document | 2.14 | current (2.13→2.14 = text-color tuple migration) |

## Tests run

- `@strata/scene` 1930 passed (colorValidation, colorMode explicit, colorMigration fixtures, spotLibraries, proof).
- `@strata/shared` 738 passed (colorLabLch, proofTransform).
- `@strata/engine` 3104 passed (text layout/replay run-color carry).
- `@strata/ui` 399 passed (ColorPickerLabLch suite, existing suites).
- `@strata/editor` render + inspector suites pass (proofing, worker, popover); full editor suite pending (large).
- Typecheck: all packages clean except pre-existing errors in the user's concurrent in-flight editor files.
- Lint: 0 new errors; audit-emoji clean; audit-health passed.

## Performance results

- Proof transform cached per (config, color) with bounded 4096-entry cache; IR walker identity-preserving when proofing is unavailable (zero replay overhead).
- Picker Lab/LCH editing is O(1) per change; no document-wide conversion on picker edits.

## Known limitations / deferred

- Browser analytical conversion is approximate and labeled; ICC conversion requires the desktop engine.
- Accurate monitor-profile soft proofing unavailable in browser canvases (honest `unavailable` disclosure).
- PDF spot (Separation/DeviceN) export deferred until `strata-print` supports it.
- Spot-library authoring UI (M8) and import/export preservation (M9) not yet implemented.
- Registration color renders as black on screen (all plates).
- Document-load healing of legacy name-only spot refs into stable ids is deferred (refs already resolve by name at render time; `stabilizeSpotRef` is available for explicit normalization).
- Repository is shared with concurrent user work (logo/vectorize/canvas); commits are path-scoped to avoid sweeping unrelated staged changes.
