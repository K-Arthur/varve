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
4. The marketing/documentation update is being committed separately after
   its browser visual check: the press page now states the local/offline,
   pricing, export, and unfinished-feature boundaries explicitly.

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
engine subset at 48/48. Repeated targeted runs stayed green; no failure was
observed only intermittently after repair.

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

The broad affected gate was escalated by the pre-existing 258-file dirty
worktree. The full repository gate is therefore required and is run after the
marketing/documentation commit. Browser visual regression, full Vitest/Cargo
workspace coverage, native desktop matrices, benchmarks, packaging, signing,
and release checks are not inferred from the 486-test targeted pass; they are
reported separately below when run.

Confidence is high for the 49 baseline failures because every original failing
file passes with its original assertions present. Confidence is medium for
unrelated dirty worktree behavior until the explicit full gate completes.

## Agent Validation Report

```text
Changed scope: website fixtures/manifest, editor contract tests, engine model/LUT/integrity paths, inspector CSS, marketing press page, research and quality reports
Validation plan: pnpm verify:plan selected Tiers 0-4 and escalated to FULL-SUITE because the supplied worktree changed 258 files across packages and validation-sensitive areas
Commands actually run: pnpm verify:plan; pnpm test (launcher failed: unable to open database file); pnpm test:ci:tools; pnpm exec vitest run (baseline); targeted 18-file Vitest regression command; commit checkpoint suites; node scripts/screenshots/validate.mjs; website visual E2E command (pending final report update); pnpm verify:full (pending final report update)
Passed: CI tooling tests; canonical/website fixture tests; editor 111/111; engine/UI 375/375 in targeted subsets; original failure set 486/486
Skipped as unrelated: none of the original 49 failures; full affected closure and release/native lanes were deferred until the explicit escalated gate
Escalations: full-gate escalation caused by the pre-existing dirty worktree; no external write or branch creation
Full suite run: pending final report update
If yes, reason: explicit execution brief requires before/after full-suite evidence and the planner escalated the dirty workspace
```
