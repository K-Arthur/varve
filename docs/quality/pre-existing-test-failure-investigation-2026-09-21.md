# Pre-existing test failure investigation and resolution

Date: 2026-09-21

Scope: the dirty `master` worktree supplied for the investigation, including
the editor, engine, scene, website, and shared UI packages. Existing user work
was preserved; only the paths listed in the commits below were changed.

## Baseline and triage

The first repository plan was run before changes:

```text
pnpm verify:plan
Changed files: 250
FULL-SUITE ESCALATION: YES
reason: workspace/toolchain/validation-infrastructure change — selection logic or every package contract may be affected
```

The normal `pnpm test` launcher stopped before Vitest with `unable to open
database file`, so it was recorded as an environment/launcher failure rather
than a test result. The direct baseline was then run with:

```text
pnpm exec vitest run
Test Files 18 failed | 1746 passed | 13 skipped (1777)
Tests      49 failed | 20467 passed | 16 skipped (20532)
```

The independent CI-tooling lane also passed:

```text
pnpm test:ci:tools
```

The 49 failures were deterministic contract or fixture failures, not one
single product defect:

| Area | Failures | Finding | Resolution |
| --- | ---: | --- | --- |
| Editor inspector and overlay | 27 | Tests predated the current token, disclosure, mock, icon, and object-review contracts | Test fixtures and assertions corrected; implementation guards retained |
| Website and canonical fixtures | 9 | Schema 2.29 and the comic screenshot existed without regenerated fixtures/manifest entry | Fixtures regenerated and screenshot manifest synchronized |
| Model loader and stored blobs | 7 | Synthetic downloads used production checksums; reset leaked cached object URLs across tests | Tests use a checksum-matched test manifest; reset cleans URLs; bounded integrity path retained |
| Model manifest validation | 2 | DDColor entries claimed verified integrity/inference without timestamps | Verification timestamps added |
| LUT parser | 1 | Normalized `.3dl` fixture used integer-looking `0/1`, which is intentionally ambiguous | Fixture now uses visible decimal normalized values |
| Shared UI guards | 3 | Current `master` had duplicate local slider skins and lacked shared segmented-control layout rules | Canonical range skin and content-driven segmented layout restored |

## Changes committed progressively

1. `14757a9a9 fix(website): sync schema and captured screenshot fixtures`
   regenerated schema-2.29 canonical/demo fixtures, corrected the website file
   format claim, and preserved the externally sourced comic screenshot in the
   manifest.
2. `e95e6ed19 test(editor): align stale inspector contracts` corrected the
   eight editor test files. It did not remove assertions or disable controls.
3. `aea1ffcc2 fix(engine): restore integrity and shared control contracts`
   restored the canonical slider and segmented-control CSS contracts, added
   missing model validation timestamps, isolated the model-loader fixtures,
   cleaned the loader reset path, and corrected the normalized LUT fixture.
4. `637db8889 docs(website): publish failure-informed trust boundaries`
   added the marketing press-page trust-boundary section, its narrow-viewport
   visual test/snapshot, the complaint-informed research note, and this report.
5. `ce8d8f58 fix(engine): satisfy full-gate type contracts` made loader disposal
   explicit and narrowed LUT union fixtures without changing runtime behavior.
6. `6bb900330 test(scene): restore stale document fixtures` corrected the stale
   scene `Document` import and supplied the required bend-warp fixture fields.
7. `0781b8fac test(editor): refresh stale type fixtures` repaired 13 stale editor
   test contracts exposed by workspace typecheck; the pre-existing new ranking
   evidence file was deliberately left uncommitted and user-owned.

## Regression evidence after repairs

The exact original failure set was rerun as one command:

```text
pnpm exec vitest run \
  packages/editor/src/SelectionOverlay.test.tsx \
  packages/editor/src/components/StateMachinePanel.test.tsx \
  packages/editor/src/components/LogoPanel/LogoTypographySection.test.tsx \
  packages/editor/src/components/Inspector/sections/AiToolsHintSection.test.tsx \
  packages/editor/src/components/Inspector/sections/__tests__/VariableAxes.test.tsx \
  packages/editor/src/components/Inspector/sections/ImageTuningSection.test.tsx \
  packages/editor/src/components/Inspector/sections/__tests__/bgRemovalFeatures.test.tsx \
  packages/editor/src/components/Inspector/sections/smartFilterCatalog.test.ts \
  apps/website/src/test/demoDocuments.test.ts \
  apps/website/src/test/screenshots.test.ts \
  packages/scene/src/__tests__/canonicalGolden.test.ts \
  packages/scene/src/__tests__/canonicalProperties.fuzz.test.ts \
  packages/engine/src/backgroundRemoval/__tests__/modelLoader.test.ts \
  packages/engine/src/backgroundRemoval/__tests__/storedBlobIntegrity.test.ts \
  packages/engine/src/inference/__tests__/manifestContracts.test.ts \
  packages/engine/src/lut/lut-edge.test.ts \
  tests/unit/slider-system.test.ts \
  tests/unit/radio-group-system.test.ts

Test Files 18 passed (18)
Tests      486 passed (486)
```

The editor subset was also rerun by the commit checkpoint at 111/111, and the
engine subset at 48/48. The later model/LUT/integrity subset passed 93/93;
the scene compatibility subset passed 12/12; and the editor type-fixture
subset passed 221/221 (one intentionally skipped). Direct package and E2E
typechecks also pass. The two additional failures observed during the first
after-fix full Vitest attempt (Menubar and FillSection) passed when rerun in
isolation and together, so they are recorded as ordering-sensitive/flaky
environment evidence rather than claimed as repaired deterministic failures.

## Test-weakening disclosure

No test was skipped, marked todo, made less strict, or hidden behind a broader
selector. The test changes do the following only:

- open disclosures whose registry defaults are intentionally collapsed;
- provide document state required by the rendered component;
- scope an ambiguous heading to its dialog and use the current token/icon;
- compute a review key from the same dimensions as the test session;
- use valid checksum, stream, and normalized-LUT fixtures.

The production model loader still rejects unverifiable downloads and evicts a
stored blob whose checksum does not match the manifest.

## Deferred, risk, and confidence

The broad affected gate was escalated by the supplied 250-file dirty
worktree. The explicit full-gate executor reached and passed all package
typechecks after the repairs, but repeatedly exited at its E2E typecheck
handoff without a diagnostic; the same `pnpm typecheck` command passes when
run directly. A leased after-fix full Vitest run started, exposed the two
ordering-sensitive failures above, and then made no further progress within
the bounded wait; a second attempt likewise stalled before producing a file
summary and was terminated. Therefore no after-fix full Vitest/Cargo/browser
pass is claimed here. Native desktop matrices, benchmarks, packaging,
signing, and release checks remain deferred.

Confidence is high for the 49 baseline failures because every original failing
file passes with its original assertions present. Confidence is medium for
unrelated dirty-worktree behavior because the after-fix repository-wide
Vitest run did not complete in this environment.

## Agent Validation Report

```text
Changed scope: website fixtures/manifest, editor contract tests, engine model/LUT/integrity paths, inspector CSS, marketing press page, research and quality reports
Validation plan: pnpm verify:plan selected Tiers 0-4 and escalated to FULL-SUITE because the supplied worktree changed 250 files across packages and validation-sensitive areas
Commands actually run: pnpm verify:plan; pnpm test (launcher failed: unable to open database file); pnpm test:ci:tools; pnpm exec vitest run (baseline); targeted 18-file Vitest regression command; direct engine/scene/editor typechecks; commit checkpoint suites; node scripts/screenshots/validate.mjs; direct Astro check/build (105 pages); leased website press visual E2E (snapshot generation and final no-update pass); node scripts/quality/verify.mjs full with VARVE_FULL_GATE_REASON (repeated attempts); pnpm typecheck; leased full Vitest attempt (bounded/incomplete); pnpm audit:docs; pnpm audit:emoji; pnpm audit:tokens
Passed: CI tooling tests; canonical/website fixture tests; original failure set 486/486; model/LUT/integrity subset 93/93; scene compatibility 12/12; editor type-fixture subset 221/221 plus one skipped; all package and E2E typechecks; website build/check; press visual E2E 1/1; audit:docs; audit:emoji; token contrast pairs (315/315)
Skipped as unrelated: no original failure was skipped; after-fix full Vitest/Cargo/browser completion, native desktop matrices, benchmarks, packaging, signing, and release checks were not claimed after the full runner stalled
Escalations: explicit full-gate reason; restricted-sandbox permission for Git staging/commits and the existing font-resolver test; no external write or branch creation. audit:tokens:usage still reports 22 undefined references and 4 literal fallbacks in the pre-existing dirty inspector stylesheet outside the changed control blocks; these were not broadened into this investigation.
Full suite run: baseline yes; after-fix attempted but incomplete (runner stalled after startup/initial file summaries)
If yes, reason: the supplied execution brief required before/after full-suite evidence and the planner escalated the dirty workspace; the incomplete after-fix result is disclosed above rather than presented as a pass
```
